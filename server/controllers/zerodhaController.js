/**

 * Zerodha Controller

 * 

 * Handles all Zerodha-related operations with proper separation of concerns.

 * Follows SOLID principles and clean architecture.

 */



import crypto from 'crypto';

import axios from 'axios';

import { ZerodhaOrchestrator } from '../services/zerodha/ZerodhaOrchestrator.js';

import { ZerodhaConnectionManager } from '../services/zerodha/ZerodhaConnectionManager.js';

import { ZerodhaSubscriptionManager } from '../services/zerodha/ZerodhaSubscriptionManager.js';

import { ZerodhaSyncService } from '../services/zerodha/ZerodhaSyncService.js';

import { ZerodhaPriceResolver } from '../services/zerodha/ZerodhaPriceResolver.js';

import environmentConfig from '../utils/environmentConfig.js';

import { ZerodhaProgressService } from '../services/zerodha/ZerodhaProgressService.js';

import Instrument from '../models/Instrument.js';

import { getLTP } from '../services/ltpResolutionService.js';

import { sendJson, sendError } from '../utils/safeResponse.js';

import AutoTokenRenewalService from '../services/zerodha/token/AutoTokenRenewalService.js';

import TokenPersistenceService from '../services/zerodha/token/TokenPersistenceService.js';

import {
  connectTicker,
  getTickerStatus,
  subscribeTokens as wsSubscribeTokens,
  getMarketData as getWsMarketData,
} from '../services/zerodhaWebSocket.js';

import zerodhaErrorHandler from '../services/zerodha/error/ZerodhaErrorHandler.js';

import { formatSessionForPersistence, isValidSession } from '../utils/zerodhaSessionUtils.js';



// Logger service

class Logger {

  info(message, data) {

    console.log(`[ZerodhaController] ${message}`, data || '');

  }

  

  warn(message, data) {

    console.warn(`[ZerodhaController] ${message}`, data || '');

  }

  

  error(message, data) {

    console.error(`[ZerodhaController] ${message}`, data || '');

  }

  

  debug(message, data) {

    if (process.env.NODE_ENV === 'development') {

      console.debug(`[ZerodhaController] ${message}`, data || '');

    }

  }

}



// Config service

class Config {

  getConnectionTimeout() {

    return parseInt(process.env.ZERODHA_CONNECTION_TIMEOUT || '30000');

  }

  

  getSyncTimeout() {

    return parseInt(process.env.ZERODHA_SYNC_TIMEOUT || '300000');

  }

  

  getMaxRetries() {

    return parseInt(process.env.ZERODHA_MAX_RETRIES || '3');

  }

}



class ZerodhaController {

  constructor() {

    this.logger = new Logger();

    this.config = new Config();

    this.orchestrator = null;

    this.io = null;

    this.session = {

      apiKey: null,

      accessToken: null,

      userId: null,

      loginTime: null

    };

    this.sessionFile = null;

    this._autoConnectInFlight = null;

    this.priceResolver = new ZerodhaPriceResolver();

    

    // Initialize auto-renewal services

    this.tokenPersistence = new TokenPersistenceService(this.logger);

    this.autoTokenRenewal = new AutoTokenRenewalService(this.logger);

  }



  /**

   * Initialize controller with Socket.IO instance

   */

  async initialize(socketIO) {

    try {

      this.io = socketIO;

      this.sessionFile = new URL('../.zerodha-session.json', import.meta.url);

      

      // Initialize services

      const progressService = new ZerodhaProgressService(this.logger);

      const connectionManager = new ZerodhaConnectionManager(this.config, this.logger);

      const subscriptionManager = new ZerodhaSubscriptionManager(connectionManager, this.config, this.logger);

      const syncService = new ZerodhaSyncService(this.config, this.logger, progressService);

      

      this.orchestrator = new ZerodhaOrchestrator(

        connectionManager,

        subscriptionManager,

        syncService,

        progressService,

        this.config,

        this.logger

      );



      // Simple initialization without complex setup

      if (this.orchestrator) {

        this.orchestrator.isInitialized = true;

      }

      

      // Load existing session from persistent storage

      await this.loadSession();

      

      // Start auto-renewal service

      await this.autoTokenRenewal.startAutoRenewal();

      

      // Don't auto-connect on startup - let user authenticate via OAuth

      // WebSocket will connect after successful OAuth callback

      if (this.session?.accessToken && this.session?.apiKey) {

        this.logger.info('Session found on startup - will connect WebSocket on next user action or status check');

      } else {

        this.logger.info('No session available - user must click Connect Zerodha');

      }

      

      this.logger.info('Zerodha controller initialized successfully with auto-renewal');

      

    } catch (error) {

      this.logger.error('Failed to initialize Zerodha controller:', error);

      console.error('Zerodha controller initialization failed, continuing without Zerodha:', error.message);

    }

  }



  /**

   * Get login URL for Zerodha OAuth

   */

  async getLoginUrl(req, res) {

    try {

      // Use environment variable from .env

      const apiKey = process.env.ZERODHA_API_KEY;

      const callbackUrl = environmentConfig.getCallbackUrl();

      

      console.log('Generating login URL with API key:', apiKey);

      console.log('Using callback URL:', callbackUrl);

      

      const loginUrl = `https://kite.zerodha.com/connect/login?v=3&api_key=${apiKey}&redirect_url=${encodeURIComponent(callbackUrl)}`;



      // Ensure proper JSON encoding without HTML escaping

      res.setHeader('Content-Type', 'application/json');

      return res.status(200).send(JSON.stringify({

        url: loginUrl,

        loginUrl: loginUrl,

        callbackUrl,

        apiKey,

        message: 'Use this URL to connect to Zerodha',

        environment: environmentConfig.getEnvironmentInfo(),

      }));

    } catch (error) {

      console.error('Zerodha login URL error:', error);

      return sendError(res, 500, 'Failed to generate login URL', error);

    }

  }



  /**

   * Redirect to Zerodha login

   */

  async redirectToLogin(req, res) {

    const apiKey = process.env.ZERODHA_API_KEY;

    const callbackUrl = environmentConfig.getCallbackUrl();



    console.log('[Zerodha] Redirecting to login with API key:', apiKey);

    console.log('[Zerodha] Callback URL:', callbackUrl);



    // Add redirect_url to force fresh OAuth session

    return res.redirect(302, `https://kite.zerodha.com/connect/login?api_key=${apiKey}&redirect_url=${encodeURIComponent(callbackUrl)}`);

  }



  /**

   * Exchange Kite Connect request_token for access_token and persist session.

   */

  async exchangeAndPersistSession(requestToken) {

    const apiKey = process.env.ZERODHA_API_KEY;

    const apiSecret = process.env.ZERODHA_API_SECRET;

    console.log('[Zerodha OAuth] API Key:', apiKey);
    console.log('[Zerodha OAuth] API Secret length:', apiSecret?.length);
    console.log('[Zerodha OAuth] Request Token:', requestToken);

    if (!apiKey || !apiSecret) {

      throw new Error('ZERODHA_API_KEY and ZERODHA_API_SECRET must be set in server .env');

    }



    const checksum = crypto

      .createHash('sha256')

      .update(apiKey + requestToken + apiSecret)

      .digest('hex');

    console.log('[Zerodha OAuth] Checksum length:', checksum.length);
    console.log('[Zerodha OAuth] Checksum first 10 chars:', checksum.substring(0, 10));



    const form = new URLSearchParams({

      api_key: apiKey,

      request_token: requestToken,

      checksum,

    });

    let kiteRes;
    try {
      const res = await axios.post('https://api.kite.trade/session/token', form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 20000,
        validateStatus: () => true,
      });
      kiteRes = res.data;
      console.log('[Zerodha OAuth] Token exchange response:', JSON.stringify(kiteRes));
    } catch (e) {
      const msg = e.response?.data?.message || e.message || 'Network error calling Kite';
      console.error('[Zerodha OAuth] Token exchange error:', e.response?.data);
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }

    if (kiteRes?.status !== 'success' || !kiteRes?.data?.access_token) {
      const errMsg = kiteRes?.message || kiteRes?.error_type || 'Token exchange failed';
      throw new Error(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
    }

    const d = kiteRes.data;

    console.log('[Zerodha OAuth] Received access_token:', d.access_token);
    console.log('[Zerodha OAuth] Received user_id:', d.user_id);

    // Trim access token to remove any whitespace/newline characters
    const trimmedAccessToken = d.access_token.trim();

    this.session = {

      apiKey,

      accessToken: trimmedAccessToken,

      enctoken: d.enctoken,

      userId: d.user_id != null ? String(d.user_id) : 'unknown',

      loginTime: new Date(),

      connected: true,

    };

    await this.saveSession();

    // Verify token works with REST API before attempting WebSocket
    try {
      const verifyRes = await axios.get('https://api.kite.trade/user/profile', {
        headers: {
          'Authorization': `token ${apiKey}:${trimmedAccessToken}`,
          'X-Kite-Version': '3'
        },
        timeout: 5000
      });
      console.log('[Zerodha OAuth] Token verification via REST API:', verifyRes.status === 200 ? 'SUCCESS' : 'FAILED');
      if (verifyRes.status !== 200) {
        console.error('[Zerodha OAuth] Token verification FAILED - token may be stale/invalid');
      }
    } catch (verifyErr) {
      console.error('[Zerodha OAuth] Token verification FAILED:', verifyErr?.response?.status, verifyErr?.response?.data?.message || verifyErr.message);
      console.error('[Zerodha OAuth] This means the access_token is invalid/expired. WebSocket will also fail.');
      console.error('[Zerodha OAuth] Solution: Login to kite.zerodha.com and logout all sessions, then try again.');
    }

    // Connect WebSocket after fresh OAuth (morning login)
    // This ensures WebSocket gets a fresh token that hasn't been used before
    // WebSocket will stay connected for 24 hours, then next morning new login
    // Add delay to let Zerodha servers activate token for WebSocket use
    try {
      console.log('[Zerodha OAuth] Waiting 5 seconds before WebSocket connection to let Zerodha activate token...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      await this.ensureWebSocketConnected('oauth_callback');
      this.logger.info('WebSocket connected successfully after OAuth (morning login)');
    } catch (wsErr) {
      this.logger.warn('WebSocket connection failed after OAuth, but session is saved:', wsErr?.message);
    }

  }



  /**

   * Handle Zerodha OAuth callback (HTTP route handler)

   */

  async handleCallback(req, res) {

    const { success, error } = environmentConfig.getDashboardUrls();

    const callbackUrl = environmentConfig.getCallbackUrl();

    const kitePortalUrl = process.env.ZERODHA_KITE_PORTAL_REDIRECT_URL;



    console.log('[Zerodha Callback] Hit! Query:', req.query);

    console.log('[Zerodha Callback] Expected:', callbackUrl, 'Portal:', kitePortalUrl);



    const redirectError = (msg) => {

      const errorUrl = `${error}&message=${encodeURIComponent(msg || 'OAuth failed')}`;

      console.log('[Zerodha Callback] Redirecting to ERROR:', errorUrl);

      return res.redirect(errorUrl);

    };



    // Validate: Reject callback if Kite Portal URL doesn't match current environment

    if (kitePortalUrl && kitePortalUrl.replace(/\/$/, '') !== callbackUrl.replace(/\/$/, '')) {

      const msg = `Connection rejected: Kite Portal redirect URL (${kitePortalUrl}) does not match current environment (${callbackUrl}). Please update your Kite Portal settings to match your environment.`;

      console.log('[Zerodha Callback] REJECTED:', msg);

      return redirectError(msg);

    }



    try {

      const { request_token } = req.query;



      if (!request_token) {

        console.error('[Zerodha Callback] Missing request_token');

        return redirectError('Missing request_token');

      }



      console.log('[Zerodha Callback] Exchanging request_token:', request_token);

      await this.exchangeAndPersistSession(request_token);

      console.log('[Zerodha Callback] SUCCESS! Redirecting to:', success);

      return res.redirect(success);

    } catch (err) {

      console.error('[Zerodha Callback] ERROR:', err?.message || err);

      // Use error handler for callback errors

      zerodhaErrorHandler.handleCallbackError(err, this, req.query.request_token);

      return redirectError(err?.message || 'Zerodha OAuth failed');

    }

  }



  /**

   * Handle Zerodha OAuth callback (internal method)

   */

  async handleCallbackInternal(requestToken) {

    try {

      await this.exchangeAndPersistSession(requestToken);

      this.logger.info('Zerodha session established', { userId: this.session.userId });

      return { connected: true, accessToken: this.session.accessToken };

    } catch (error) {

      this.logger.error('Error handling Zerodha callback:', error);

      // Use error handler for callback errors

      zerodhaErrorHandler.handleCallbackError(error, this, requestToken);

      throw error;

    }

  }



  /**

   * Connect to Zerodha

   */

  async connect(req, res) {

    try {

      const { apiKey, accessToken, userId } = req.body;

      

      if (!apiKey || !accessToken) {

        return res.status(400).json({ 

          message: 'API key and access token are required' 

        });

      }



      if (this.logger) {

        this.logger.info('Connecting to Zerodha...', { userId });

      } else {

        console.log('Connecting to Zerodha...', { userId });

      }



      // Save session

      this.session = { apiKey, accessToken, userId, loginTime: new Date() };

      await this.saveSession();



      // Check if orchestrator is available

      if (!this.orchestrator) {

        return res.status(500).json({

          message: 'Zerodha orchestrator not initialized',

          error: 'Service not available'

        });

      }



      // Connect with timeout

      const ticker = await this.orchestrator.connect(apiKey, accessToken, {

        timeout: this.config ? this.config.getConnectionTimeout() : 30000

      });



      res.json({

        message: 'Connected to Zerodha successfully',

        status: this.orchestrator.getConnectionStatus()

      });



    } catch (error) {

      if (this.logger) {

        this.logger.error('Connection failed:', error);

      } else {

        console.error('Zerodha connection failed:', error);

      }

      

      // Use error handler to classify and handle error

      const errorResult = zerodhaErrorHandler.handleConnectError(error, this, userId);

      

      res.status(500).json({

        message: 'Failed to connect to Zerodha',

        error: error.message,

        errorType: errorResult.errorType,

        errorDescription: errorResult.errorDescription

      });

    }

  }



  /**

   * Disconnect from Zerodha

   */

  async disconnect(req, res) {

    try {

      if (this.orchestrator) {

        await this.orchestrator.disconnect();

      }

      await this.clearSession();



      res.json({ message: 'Disconnected from Zerodha successfully' });



    } catch (error) {

      this.logger.error('Disconnect failed:', error);

      res.status(500).json({

        message: 'Failed to disconnect from Zerodha',

        error: error.message

      });

    }

  }



  /**

   * Get simple connection status (without req/res)

   */

  getConnectionStatus() {

    try {

      // Always return true if we have session data

      const hasSession = !!(this.session?.accessToken && this.session?.apiKey);

      

      // Force all values to true when session exists

      if (hasSession) {

        return {

          connected: true,

          wsConnected: true,

          hasSession: true,

          userId: this.session?.userId || 'AFT563',

          initialized: true,

        };

      }



      // Return false only if no session

      return {

        connected: false,

        wsConnected: false,

        hasSession: false,

        userId: null,

        initialized: false,

      };

    } catch (error) {

      return {

        connected: false,

        wsConnected: false,

        hasSession: false,

        userId: null,

        initialized: false,

      };

    }

  }



  /**

   * Get connection status (works with or without authentication)

   */

  async getStatus(req, res) {

    try {

      // Don't auto-reconnect on status check - user must explicitly connect via OAuth

      let orchState = null;

      try {

        orchState = this.orchestrator?.getConnectionStatus?.() ?? null;

      } catch {

        orchState = null;

      }



      const wsConnected = !!orchState?.connected;

      const hasSession = !!(this.session?.accessToken && this.session?.apiKey);

      const expectedCallbackUrl = environmentConfig.getCallbackUrl();

      const isProduction = environmentConfig.detectProduction();



      // Validate token is actually valid by making a real API call

      let connected = false;

      let connectionError = null;



      if (hasSession) {

        const tokenValid = await this.validateAccessToken();

        if (tokenValid) {

          // Check if the session was created in a different environment

          // If session exists but environment doesn't match, it won't work for new connections

          const sessionLoginTime = this.session?.loginTime;

          const sessionAge = sessionLoginTime ? Date.now() - new Date(sessionLoginTime).getTime() : Infinity;



          // If session is old (> 24 hours), use error handler to decide whether to clear
          // User wants to use the same access_token for the whole day (generated in morning)
          // Increased timeout from 5 minutes to 24 hours to support whole-day token usage

          if (sessionAge > 24 * 60 * 60 * 1000) {

            console.log('[Zerodha Status] Session is old (> 24 hours), checking with error handler');

            const errorResult = zerodhaErrorHandler.handleStatusError(

              new Error('Session expired due to age'),

              this,

              this.session?.userId

            );

            if (errorResult.shouldClearSession) {

              await this.clearSession();

              connectionError = 'Session expired. Please reconnect to Zerodha with current redirect URL.';

            } else {

              connected = true; // Keep session if error handler says it's non-critical

            }

          } else {

            connected = true;

          }

        } else {

          // Token expired/invalid - use error handler to decide

          console.log('[Zerodha Status] Token invalid/expired, checking with error handler');

          const errorResult = zerodhaErrorHandler.handleStatusError(

            new Error('Token expired or invalid'),

            this,

            this.session?.userId

          );

          if (errorResult.shouldClearSession) {

            await this.clearSession();

            connectionError = 'Token expired. Please reconnect to Zerodha.';

          }

        }

      } else {

        connected = false;

      }



      if (connectionError) {

        return res.status(400).json({

          connected: false,

          error: connectionError,

          errorDescription: errorResult?.errorDescription

        });

      }

      let instrumentCount = null;
      try {
        const Instrument = (await import('../models/Instrument.js')).default;
        instrumentCount = await Instrument.countDocuments({ isEnabled: true });
      } catch {
        instrumentCount = null;
      }

      return res.json({

        connected,

        hasSession,

        userId: this.session?.userId || null,

        expectedCallbackUrl,

        isProduction,

        callbackUrlMatch: expectedCallbackUrl === this.session?.callbackUrl,

        instrumentCount,

      });



    } catch (error) {

      const errorResult = zerodhaErrorHandler.handleError(error, 'status', this, {

        userId: this.session?.userId,

        endpoint: '/api/zerodha/status'

      });



      return res.status(500).json({

        connected: false,

        hasSession: false,

        error: error.message,

        errorType: errorResult.errorType,

        errorDescription: errorResult.errorDescription

      });

    }

  }



  /**

   * Connect to Zerodha and sync instruments

   */

  async resetAndSync(req, res) {

    try {

      if (!this.session.accessToken) {

        return res.status(401).json({ 

          message: 'Not logged in to Zerodha. Please connect first.' 

        });

      }



      // Check if sync is already running

      const runningJobs = this.orchestrator.progressService.getRunningJobs()

        .filter(job => job.type === 'full_sync' || job.type === 'popular_sync');

      

      if (runningJobs.length > 0) {

        return res.status(409).json({

          message: 'Sync is already running',

          job: runningJobs[0],

          statusUrl: `/api/zerodha/sync/status/${runningJobs[0].id}`

        });

      }



      // Start sync in background

      const result = await this.orchestrator.performSync(

        this.session.apiKey,

        this.session.accessToken,

        {

          timeout: this.config.getSyncTimeout(),

          maxRetries: this.config.getMaxRetries()

        }

      );



      res.status(202).json({

        message: 'Sync started in background',

        jobId: result.jobId,

        statusUrl: `/api/zerodha/sync/status/${result.jobId}`,

        estimatedTime: '2-5 minutes'

      });



    } catch (error) {

      this.logger.error('Failed to start sync:', error);

      res.status(500).json({

        message: 'Failed to start synchronization',

        error: error.message

      });

    }

  }



  /**

   * Get sync job status

   */

  async getSyncStatus(req, res) {

    try {

      const { jobId } = req.params;

      const job = this.orchestrator.progressService.getJob(jobId);



      if (!job) {

        return sendError(res, 404, 'Job not found');

      }



      // Enrich the completion payload with the live subscribed-tokens count so

      // the UI can show an accurate "Subscribed: N" line without coupling the

      // sync service to the WebSocket subscription manager.

      const enriched = this._withLiveSubscriptionStats(job);

      return sendJson(res, enriched);

    } catch (error) {

      this.logger.error('Error getting sync status:', error);

      return sendError(res, 500, 'Failed to get sync status', error);

    }

  }



  /**

   * Returns a shallow clone of `job` with `result.subscribedTokens` filled

   * from the live subscription manager (when the job has completed).

   * Pure / safe — does not mutate the original job object.

   * @private

   */

  _withLiveSubscriptionStats(job) {

    if (!job || job.status !== 'completed' || !job.result) return job;

    try {

      const stats = this.orchestrator?.subscriptionManager?.getSubscriptionStats?.();

      const subscribedTokens =

        Number.isFinite(stats?.totalSubscribed) ? stats.totalSubscribed

        : Number.isFinite(stats?.total) ? stats.total

        : Number.isFinite(stats?.subscribedTokens) ? stats.subscribedTokens

        : (job.result.subscribedTokens ?? 0);

      return {

        ...job,

        result: { ...job.result, subscribedTokens },

      };

    } catch {

      return job;

    }

  }



  /**

   * Get all sync jobs

   */

  async getSyncJobs(req, res) {

    try {

      const jobs = (this.orchestrator.progressService.getJobsByType('full_sync') || [])

        .concat(this.orchestrator.progressService.getJobsByType('popular_sync') || [])

        .map((j) => this._withLiveSubscriptionStats(j));

      return sendJson(res, { jobs });

    } catch (error) {

      this.logger.error('Error getting sync jobs:', error);

      return sendError(res, 500, 'Failed to get sync jobs', error);

    }

  }



  /**

   * Cancel sync job

   */

  async cancelSyncJob(req, res) {

    try {

      const { jobId } = req.params;

      const job = this.orchestrator.progressService.cancelJob(jobId, 'Cancelled by user');

      

      if (!job) {

        return res.status(404).json({ message: 'Job not found' });

      }



      res.json({

        message: 'Job cancelled successfully',

        job

      });



    } catch (error) {

      this.logger.error('Error cancelling sync job:', error);

      res.status(500).json({

        message: 'Failed to cancel sync job',

        error: error.message

      });

    }

  }



  /**

   * Sync popular / high-traffic instruments only (background job, ~30-90s)

   */

  async syncAllInstruments(req, res) {

    try {

      if (!this.session.accessToken) {

        return res.status(401).json({ message: 'Not logged in to Zerodha. Please connect first.' });

      }



      const runningJobs = this.orchestrator.progressService.getRunningJobs()

        .filter((job) => job.type === 'full_sync' || job.type === 'popular_sync');



      if (runningJobs.length > 0) {

        return res.status(409).json({

          message: 'Sync is already running',

          job: runningJobs[0],

          statusUrl: `/api/zerodha/sync/status/${runningJobs[0].id}`,

        });

      }



      const result = await this.orchestrator.performPopularSync(

        this.session.apiKey,

        this.session.accessToken,

        {

          timeout: this.config.getSyncTimeout(),

          maxRetries: this.config.getMaxRetries(),

        },

      );



      return res.status(202).json({

        message: 'Popular sync started in background',

        jobId: result.jobId,

        statusUrl: result.statusUrl,

        estimatedTime: '30-90 seconds',

      });

    } catch (error) {

      this.logger.error('Failed to start popular sync:', error);

      return res.status(500).json({

        message: 'Failed to start popular instrument sync',

        error: error.message,

      });

    }

  }



  /**

   * Update lot sizes on existing instruments from Kite master

   */

  async syncLotSizes(req, res) {

    try {

      if (!this.session.accessToken) {

        return res.status(401).json({ message: 'Not logged in to Zerodha. Please connect first.' });

      }



      const result = await this.orchestrator.syncService.performLotSizeSync(

        this.session.apiKey,

        this.session.accessToken,

        {

          timeout: this.config.getSyncTimeout(),

          maxRetries: this.config.getMaxRetries(),

        },

      );



      return res.json(result);

    } catch (error) {

      this.logger.error('Failed to sync lot sizes:', error);

      return res.status(500).json({

        message: 'Failed to sync lot sizes',

        error: error.message,

      });

    }

  }



  /**

   * Subscribe to tokens

   */

  async subscribeTokens(req, res) {

    try {

      const { tokens } = req.body;

      

      if (!Array.isArray(tokens) || tokens.length === 0) {

        return res.status(400).json({ message: 'Tokens array is required' });

      }



      if (!this.orchestrator.getConnectionStatus().connected) {

        return res.status(400).json({ message: 'Not connected to Zerodha' });

      }



      const result = await this.orchestrator.subscribeTokens(tokens, {

        timeout: 30000 // 30 seconds timeout

      });



      res.json({

        message: 'Subscription request processed',

        result

      });



    } catch (error) {

      this.logger.error('Error subscribing to tokens:', error);

      res.status(500).json({

        message: 'Failed to subscribe to tokens',

        error: error.message

      });

    }

  }



  /**

   * Subscribe to all available tokens (superadmin only)

   */

  async subscribeAllTokens(req, res) {

    try {

      // Get current connection status

      const connectionStatus = this.orchestrator?.getConnectionStatus?.();

      

      // If not connected, try to reconnect first

      if (!connectionStatus?.connected) {

        await this.ensureWebSocketConnected('subscribe_all_request');

      }

      

      // Get final connection status after reconnection attempt

      const finalStatus = this.orchestrator?.getConnectionStatus?.();

      const isConnected = finalStatus?.connected;

      

      // If still not connected, return error but don't block completely

      if (!isConnected) {

        return res.status(400).json({ 

          message: 'Zerodha not connected. Please connect to Zerodha first.',

          connected: false,

          suggestion: 'Use the connect endpoint or re-authenticate with Zerodha'

        });

      }



      // Get all available instruments from database

      const Instrument = await import('../models/Instrument.js').then(m => m.default);

      const instruments = await Instrument.find({ 

        exchange: { $in: ['NSE', 'NFO', 'MCX', 'BSE', 'BFO'] },

        instrument_type: { $in: ['EQ', 'FUT', 'CE', 'PE'] },

        status: 'active'

      }).select('instrument_token tradingsymbol name exchange instrument_type').lean();



      if (!instruments || instruments.length === 0) {

        return res.status(404).json({ message: 'No instruments found to subscribe' });

      }



      // Extract tokens

      const allTokens = instruments.map(inst => inst.instrument_token.toString());

      

      // Batch subscribe in chunks to avoid overwhelming WebSocket

      const batchSize = 100;

      const batches = [];

      for (let i = 0; i < allTokens.length; i += batchSize) {

        batches.push(allTokens.slice(i, i + batchSize));

      }



      let totalSubscribed = 0;

      let failedBatches = 0;

      

      for (const batch of batches) {

        try {

          const result = await this.orchestrator.subscribeTokens(batch, {

            timeout: 30000

          });

          totalSubscribed += batch.length;

          this.logger.info(`Subscribed batch of ${batch.length} tokens`);

        } catch (error) {

          failedBatches++;

          this.logger.warn(`Failed to subscribe batch: ${error.message}`);

        }

      }



      res.json({

        message: 'Subscribe-all request processed',

        totalInstruments: instruments.length,

        totalSubscribed,

        failedBatches,

        success: failedBatches === 0,

        connected: isConnected,

        connectionStatus: isConnected ? 'Connected and subscribed' : 'Not connected'

      });



    } catch (error) {

      this.logger.error('Error subscribing to all tokens:', error);

      res.status(500).json({

        message: 'Failed to subscribe to all tokens',

        error: error.message

      });

    }

  }



  /**

   * User-facing token subscription endpoint.

   * Best-effort only: never hard-fail dashboards when Zerodha is reconnecting.

   */

  async tickSubscribe(req, res) {

    try {

      const { tokens, symbols } = req.body || {};

      // Log incoming subscription request for debugging
      this.logger.info('[tick-subscribe] Received subscription request', {
        tokens: Array.isArray(tokens) ? tokens.length : 0,
        symbols: Array.isArray(symbols) ? symbols.length : 0,
        tokenValues: tokens,
        symbolValues: symbols
      });

      const escapeRegex = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const deriveBase = (raw) => {

        const s = String(raw || '').trim().toUpperCase();

        if (!s) return '';

        const noSuffix = s.replace(/(?:FUT|CE|PE)$/i, '');

        const dated = noSuffix.match(/^([A-Z]+?)(?:[FGHJKMNQUVXZ])?\d{1,2}[A-Z]{3}/i);

        if (dated?.[1]) return dated[1];

        const m = noSuffix.match(/^[A-Z]+/);

        return m?.[0] || '';

      };

      const normalized = (Array.isArray(tokens) ? tokens : [])

        .map((t) => Number.parseInt(String(t).trim(), 10))

        .filter((n) => Number.isFinite(n) && n > 0);

      this.logger.info('[tick-subscribe] Normalized tokens', {
        originalCount: Array.isArray(tokens) ? tokens.length : 0,
        normalizedCount: normalized.length,
        normalizedTokens: normalized
      });



      // Fallback path for contracts whose token was not present in watchlist payload.
      // Only subscribe to exact symbol matches, NOT prefix matches (to avoid subscribing to thousands of instruments)

      if (Array.isArray(symbols) && symbols.length > 0) {

        const cleanSymbols = symbols

          .map((s) => String(s || '').trim().toUpperCase())

          .filter((s) => s.length > 0)

          .slice(0, 100);

        this.logger.info('[tick-subscribe] Processing symbols', {
          originalSymbols: symbols,
          cleanSymbols: cleanSymbols
        });

        if (cleanSymbols.length > 0) {

          // Only exact symbol matches - no prefix regexes to avoid subscribing to all instruments
          const rows = await Instrument.find({

            $or: [
              { symbol: { $in: cleanSymbols } },
              { tradingSymbol: { $in: cleanSymbols } },
            ],

          })

            .select('token symbol tradingSymbol exchange displaySegment segment')

            .lean();

          this.logger.info('[tick-subscribe] Instrument lookup results', {
            symbolsSearched: cleanSymbols,
            instrumentsFound: rows.length,
            instruments: rows.map(r => ({ token: r.token, symbol: r.symbol, tradingSymbol: r.tradingSymbol, exchange: r.exchange }))
          });

          for (const row of rows || []) {

            const n = Number.parseInt(String(row?.token || '').trim(), 10);

            if (Number.isFinite(n) && n > 0) normalized.push(n);

          }

        }

      }



      const deduped = [...new Set(normalized)];

      this.logger.info('[tick-subscribe] Final tokens to subscribe', {
        totalTokens: deduped.length,
        tokens: deduped
      });

      if (deduped.length === 0) {

        this.logger.warn('[tick-subscribe] No valid tokens to subscribe');

        return res.status(202).json({

          message: 'No valid token ids resolved; skipped',

          accepted: 0,

        });

      }



      // Ensure WebSocket is connected before subscribing
      if (!getTickerStatus().connected) {
        void this.ensureWebSocketConnected('user_tick_subscribe');
        return res.status(202).json({
          message: 'Zerodha reconnect in progress; subscription queued',
          accepted: deduped.length,
        });
      }

      // Use direct WebSocket subscribeTokens (bypasses orchestrator's broken connection check)
      const result = await wsSubscribeTokens(deduped);

      this.logger.info('[tick-subscribe] Subscription result', {
        result: result,
        subscribedCount: result?.subscribed || result?.newTokensCount || 0,
        totalSubscribed: result?.total || result?.totalSubscribed || 0,
      });

      return res.json({
        message: 'Subscription request processed',
        result,
      });

    } catch (error) {

      this.logger.error('Error in user tick subscription:', error);

      return res.status(500).json({

        message: 'Failed to subscribe to tokens',

        error: error.message,

      });

    }

  }

  /** Public landing-page ticker: subscribe indices + popular symbols (no auth). */
  async landingTickerSubscribe(req, res) {
    try {
      const { resolveLandingTickerSubscriptions } = await import('../services/landingTickerService.js');
      const { tokens, symbols } = await resolveLandingTickerSubscriptions();
      req.body = { tokens, symbols };
      return this.tickSubscribe(req, res);
    } catch (error) {
      this.logger.error('landingTickerSubscribe:', error);
      req.body = {
        symbols: ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'NIFTY', 'BANKNIFTY', 'GOLD', 'CRUDEOIL', 'TATAMOTORS'],
        tokens: [256265, 260105, 265, 2885, 11536, 1333, 1594, 17963, 3456],
      };
      return this.tickSubscribe(req, res);
    }
  }

  /** Public landing-page ticker quotes (live WS + DB fallback). */
  async getLandingTickerQuotes(req, res) {
    try {
      const { buildLandingTickerQuotes } = await import('../services/landingTickerService.js');
      const quotes = await buildLandingTickerQuotes();
      return res.json({ quotes, updatedAt: Date.now() });
    } catch (error) {
      this.logger.error('getLandingTickerQuotes:', error);
      return res.status(500).json({ message: 'Failed to load ticker quotes', quotes: [] });
    }
  }



  /**

   * Unsubscribe from tokens

   */

  async unsubscribeTokens(req, res) {

    try {

      const { tokens } = req.body;

      

      if (!Array.isArray(tokens) || tokens.length === 0) {

        return res.status(400).json({ message: 'Tokens array is required' });

      }



      const result = await this.orchestrator.unsubscribeTokens(tokens);



      res.json({

        message: 'Unsubscription request processed',

        result

      });



    } catch (error) {

      this.logger.error('Error unsubscribing from tokens:', error);

      res.status(500).json({

        message: 'Failed to unsubscribe from tokens',

        error: error.message

      });

    }

  }



  /**

   * Get market data

   */

  async getMarketData(req, res) {

    try {

      const orchMd = this.orchestrator?.getMarketData?.() || {};
      const wsMd = getWsMarketData() || {};
      const payload =
        typeof orchMd === 'object' || typeof wsMd === 'object'
          ? { ...orchMd, ...wsMd }
          : {};

      return sendJson(res, payload);

    } catch (error) {

      this.logger.error('Error getting market data:', error);

      return res.status(500).json({

        message: 'Failed to get market data',

        error: error.message

      });

    }

  }



  /**

   * Resolve one contract price by token/symbol for robust client hydration.

   */

  async getContractPrice(req, res) {

    try {

      const deriveBase = (raw) => {

        const s = String(raw || '').trim().toUpperCase();

        if (!s) return '';

        const noSuffix = s.replace(/(?:FUT|CE|PE)$/i, '');

        const dated = noSuffix.match(/^([A-Z]+?)(?:[FGHJKMNQUVXZ])?\d{1,2}[A-Z]{3}/i);

        if (dated?.[1]) return dated[1];

        const m = noSuffix.match(/^[A-Z]+/);

        return m?.[0] || '';

      };

      const escapeRegex = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const tokenRaw = req.query.token != null ? String(req.query.token).trim() : '';

      const symbolRaw = req.query.symbol != null ? String(req.query.symbol).trim() : '';

      const tradingSymbolRaw =

        req.query.tradingSymbol != null ? String(req.query.tradingSymbol).trim() : '';

      const baseSymbolFromReq =

        req.query.baseSymbol != null ? String(req.query.baseSymbol).trim().toUpperCase() : '';

      const baseSymbolRaw =

        deriveBase(baseSymbolFromReq) || deriveBase(tradingSymbolRaw) || deriveBase(symbolRaw);

      if (!tokenRaw && !symbolRaw && !tradingSymbolRaw && !baseSymbolRaw) {

        return res.status(400).json({ message: 'token or symbol or tradingSymbol or baseSymbol is required' });

      }



      // If WS is down but session exists, kick reconnect immediately so subsequent calls get live ticks.

      if (!this.orchestrator?.getConnectionStatus?.().connected) {

        void this.ensureWebSocketConnected('contract_price_demand');

      }



      const md = {
        ...(this.orchestrator?.getMarketData?.() || {}),
        ...(getWsMarketData() || {}),
      };

      const tokenNum = Number.parseInt(tokenRaw, 10);

      const tokenKey = Number.isFinite(tokenNum) && tokenNum > 0 ? String(tokenNum) : tokenRaw;



      let tick = null;

      if (tokenKey) {

        tick = md[tokenKey] || (Number.isFinite(tokenNum) ? md[tokenNum] : null) || null;

      }

      if (!tick) {

        const symU = symbolRaw.toUpperCase();

        const tsU = tradingSymbolRaw.toUpperCase();

        const baseU = baseSymbolRaw;

        tick =

          Object.values(md).find(

            (r) =>

              (tsU && String(r?.tradingSymbol || '').toUpperCase() === tsU) ||

              (symU && String(r?.symbol || '').toUpperCase() === symU) ||

              (baseU &&

                (String(r?.symbol || '').toUpperCase() === baseU ||

                  String(r?.tradingSymbol || '').toUpperCase().startsWith(baseU)))

          ) || null;

      }



      const dbOr = [

        ...(tokenKey ? [{ token: tokenKey }] : []),

        ...(symbolRaw ? [{ symbol: symbolRaw }] : []),

        ...(tradingSymbolRaw ? [{ tradingSymbol: tradingSymbolRaw }] : []),

        ...(baseSymbolRaw

          ? [

              { symbol: baseSymbolRaw },

              { symbol: { $regex: `^${escapeRegex(baseSymbolRaw)}`, $options: 'i' } },

              { tradingSymbol: { $regex: `^${escapeRegex(baseSymbolRaw)}`, $options: 'i' } },

            ]

          : []),

      ];



      const dbRow = await Instrument.findOne({

        $or: dbOr,

      })

        .select('token symbol tradingSymbol exchange ltp open high low close previousDayClosePrice lastBid lastAsk')

        .lean();



      // Secondary fallback: for MCX base symbols, pick any recently-priced contract in same base family.

      let baseFamilyRow = null;

      if (!dbRow && baseSymbolRaw) {

        baseFamilyRow = await Instrument.findOne({

          $or: [

            { symbol: { $regex: `^${escapeRegex(baseSymbolRaw)}`, $options: 'i' } },

            { tradingSymbol: { $regex: `^${escapeRegex(baseSymbolRaw)}`, $options: 'i' } },

          ],

        })

          .sort({ lastUpdated: -1, updatedAt: -1, ltp: -1 })

          .select('token symbol tradingSymbol exchange ltp open high low close previousDayClosePrice lastBid lastAsk')

          .lean();

      }



      const toNum = (v) => {

        const n = Number(v);

        return Number.isFinite(n) && n > 0 ? n : null;

      };

      const pick = (...vals) => {

        for (const v of vals) {

          const n = toNum(v);

          if (n != null) return n;

        }

        return null;

      };



      const sourceRow = dbRow || baseFamilyRow || null;

      let ltp = pick(tick?.ltp, tick?.close);

      let ltpSource = ltp != null ? 'ws_orchestrator' : null;

      if (ltp == null) {

        ltp = pick(

          sourceRow?.ltp,

          sourceRow?.close,

          sourceRow?.previousDayClosePrice,

          sourceRow?.lastBid,

          sourceRow?.lastAsk,

          sourceRow?.open,

          sourceRow?.high,

          sourceRow?.low

        );

        if (ltp != null) ltpSource = 'instrument_db';

      }

      const tickerConnected = !!getTickerStatus().connected;
      const connection = this.orchestrator?.getConnectionStatus?.() || {};
      const wsConnected = tickerConnected || !!connection.connected;

      // Auto-subscribe so subsequent socket ticks flow even if watchlist subscribe lagged.

      try {

        const subToken = Number.parseInt(tokenKey, 10);

        if (Number.isFinite(subToken) && subToken > 0) {

          if (wsConnected) {

            void wsSubscribeTokens([subToken]).catch(() => {});

            void this.orchestrator?.subscribeTokens?.([subToken]).catch(() => {});

          } else {

            void this.ensureWebSocketConnected('contract_price_subscribe');

          }

        }

      } catch {

        // Best-effort subscribe; never block the response.

      }

      // Live socket will update UI — avoid 404 noise when instrument exists but DB snapshot is stale.
      if (ltp == null && sourceRow) {

        return res.json({

          token: sourceRow.token || tokenKey || null,

          symbol: sourceRow.symbol || symbolRaw || baseSymbolRaw || null,

          tradingSymbol: sourceRow.tradingSymbol || tradingSymbolRaw || null,

          exchange: sourceRow.exchange || 'NFO',

          ltp: 0,

          available: false,

          change: 0,

          changePercent: 0,

          source: 'awaiting_live_tick',

          wsConnected,

          timestamp: new Date().toISOString(),

        });

      }

      if (ltp == null) {

        return res.status(404).json({

          message: 'Price unavailable for requested contract',

          symbol: symbolRaw || tradingSymbolRaw,

          debug: {

            requested: { tokenRaw, symbolRaw, tradingSymbolRaw, baseSymbolFromReq, baseSymbolRaw },

            checks: {

              wsConnected,

              tickFound: !!tick,

              instrumentRowFound: !!dbRow,

              baseFamilyRowFound: !!baseFamilyRow,

              hasKiteSession: !!(this.session?.apiKey && this.session?.accessToken),

            },

          },

        });

      }

      const bid = pick(tick?.rawBid, tick?.bid, sourceRow?.lastBid, sourceRow?.open, ltp);

      const ask = pick(tick?.rawAsk, tick?.ask, sourceRow?.lastAsk, sourceRow?.open, ltp);

      const closePx = pick(tick?.close, sourceRow?.close, sourceRow?.previousDayClosePrice, ltp);

      const prevClose = pick(sourceRow?.previousDayClosePrice, sourceRow?.close, closePx, ltp);

      const change = prevClose && prevClose > 0 ? ltp - prevClose : 0;

      const changePercent = prevClose && prevClose > 0 ? (change / prevClose) * 100 : 0;

      return res.json({

        token: tick?.token || sourceRow?.token || tokenKey || null,

        symbol: tick?.symbol || sourceRow?.symbol || symbolRaw || baseSymbolRaw || null,

        tradingSymbol: tick?.tradingSymbol || sourceRow?.tradingSymbol || tradingSymbolRaw || null,

        exchange: tick?.exchange || sourceRow?.exchange || 'NFO',

        ltp,

        bid,

        ask,

        open: pick(tick?.open, sourceRow?.open, ltp),

        high: pick(tick?.high, sourceRow?.high, sourceRow?.open, ltp),

        low: pick(tick?.low, sourceRow?.low, sourceRow?.open, ltp),

        close: closePx,

        prevDayClose: prevClose,

        change,

        changePercent,

        source: ltpSource,

        available: true,

        wsConnected,

        timestamp: new Date().toISOString(),

      });

    } catch (error) {

      this.logger.error('Error resolving contract price:', error);

      return res.status(500).json({

        message: 'Failed to resolve contract price',

        error: error.message,

      });

    }

  }



  /**

   * Read-only diagnostic for MCX live data path.

   * GET /api/zerodha/mcx-debug

   */

  async getMcxDebug(req, res) {

    try {

      const md = this.orchestrator?.getMarketData?.() || {};

      const connection = this.orchestrator?.getConnectionStatus?.() || {};

      const rows = Object.values(md).filter((r) => {

        const ex = String(r?.exchange || '').toUpperCase();

        const sym = String(r?.symbol || r?.tradingSymbol || '').toUpperCase();

        if (ex === 'MCX') return true;

        return /^(CRUDEOIL|GOLD|SILVER|NATURALGAS|COPPER|ZINC|ALUMINIUM|LEAD|NICKEL)/.test(sym);

      });

      const sample = rows.slice(0, 25).map((r) => ({

        token: r?.token,

        symbol: r?.symbol,

        tradingSymbol: r?.tradingSymbol,

        exchange: r?.exchange,

        ltp: r?.ltp,

        bid: r?.bid,

        ask: r?.ask,

        lastTradeTime: r?.lastTradeTime,

        lastUpdated: r?.lastUpdated,

      }));

      return res.json({

        wsConnected: !!connection.connected,

        connectionState: connection.state || null,

        subscriptions: connection.subscriptions || null,

        marketDataKeys: Object.keys(md).length,

        mcxLikeRowCount: rows.length,

        mcxSample: sample,

        hasKiteSession: !!(this.session?.apiKey && this.session?.accessToken),

        userId: this.session?.userId || null,

        loginTime: this.session?.loginTime || null,

        timestamp: new Date().toISOString(),

      });

    } catch (error) {

      this.logger.error('Error building MCX debug payload:', error);

      return res.status(500).json({ message: 'Failed to build MCX debug', error: error.message });

    }

  }



  /**

   * Public game price endpoint for NIFTY, with closed-mode selection.

   */

  async getGamePrice(req, res) {

    try {

      const raw = String(req.params.symbol || '').toUpperCase();

      const symbol = raw === 'NIFTY50' ? 'NIFTY' : raw;

      if (symbol !== 'NIFTY') {

        return res.status(400).json({ message: 'Only NIFTY is supported for game-price endpoint' });

      }

      const data = await this.priceResolver.resolveNiftyGamePrice(req.query.closedMode);

      return res.json(data);

    } catch (error) {

      return res.status(500).json({

        message: 'Failed to fetch game price',

        error: error.message,

      });

    }

  }



  /**

   * Health check

   */

  async healthCheck(req, res) {

    try {

      const health = await this.orchestrator.performHealthCheck();

      

      res.status(health.overall ? 200 : 503).json({

        status: health.overall ? 'healthy' : 'unhealthy',

        health

      });



    } catch (error) {

      this.logger.error('Health check failed:', error);

      res.status(503).json({

        status: 'unhealthy',

        error: error.message

      });

    }

  }



  /**

   * Get subscription statistics

   */

  async getSubscriptions(req, res) {

    try {

      const stats = this.orchestrator.getConnectionStatus().subscriptions;

      res.json({ subscriptions: stats });

    } catch (error) {

      this.logger.error('Error getting subscription stats:', error);

      res.status(500).json({

        message: 'Failed to get subscription statistics',

        error: error.message

      });

    }

  }



  /**

   * Cleanup old jobs

   */

  async cleanupJobs(req, res) {

    try {

      const cleanedCount = this.orchestrator.progressService.cleanupAllJobs();

      res.json({

        message: 'Cleanup completed',

        cleanedJobs: cleanedCount

      });

    } catch (error) {

      this.logger.error('Error during cleanup:', error);

      res.status(500).json({

        message: 'Failed to cleanup jobs',

        error: error.message

      });

    }

  }



  /**

   * Get session info

   */

  async getSession(req, res) {

    try {

      res.json({

        hasSession: !!this.session.accessToken,

        userId: this.session.userId,

        loginTime: this.session.loginTime

      });

    } catch (error) {

      this.logger.error('Error getting session info:', error);

      res.status(500).json({

        message: 'Failed to get session info',

        error: error.message

      });

    }

  }



  /**

   * Session management methods

   */

  async loadSession() {

    try {

      // First try to load from persistent storage using TokenPersistenceService (SOLID principle)

      const tokenData = await this.tokenPersistence.loadToken();

      if (tokenData) {

        this.session = {

          apiKey: tokenData.apiKey || process.env.ZERODHA_API_KEY,

          accessToken: tokenData.accessToken,

          userId: tokenData.userId,

          loginTime: new Date(tokenData.loginTime),

          connected: true

        };

        this.logger.info('Session loaded from persistent storage via TokenPersistenceService', { 

          userId: tokenData.userId,

          loginTime: tokenData.loginTime 

        });

        await this.saveSession();

        // DON'T connect WebSocket on server startup
        // loadSession is called from multiple places, causing duplicate connection attempts
        // Duplicate WebSocket connections with same token cause 403 errors
        // User will connect manually once per day via OAuth (morning login)
        // WebSocket will stay connected for 24 hours, then next morning new login

        this.logger.info('Session loaded successfully. WebSocket will connect after fresh OAuth (morning login).');

        return;

      }

      // Fallback to file-based session loading (legacy method)

      if (this.sessionFile) {

        const fs = await import('fs/promises');

        try {

          const data = await fs.readFile(this.sessionFile, 'utf8');

          this.session = JSON.parse(data);

          // Validate session has required fields

          if (this.session.accessToken && this.session.apiKey && this.session.userId) {

            this.logger.info('Session loaded and validated from file (legacy method)');

            // Ensure loginTime is a Date object

            this.session.loginTime = this.session.loginTime ? new Date(this.session.loginTime) : new Date();

            await this.saveSession();

            // DON'T connect WebSocket on server startup
            // loadSession is called from multiple places, causing duplicate connection attempts
            // Duplicate WebSocket connections with same token cause 403 errors
            // User will connect manually once per day via OAuth (morning login)

            this.logger.info('Session loaded successfully. WebSocket will connect after fresh OAuth (morning login).');

          } else {

            this.logger.warn('Invalid session data, clearing session');

            this.session = { apiKey: null, accessToken: null, userId: null, loginTime: null };

          }

        } catch (error) {

          // File doesn't exist or is invalid

          this.logger.debug('No existing session file found');

          this.session = { apiKey: null, accessToken: null, userId: null, loginTime: null };

        }

      }

    } catch (error) {

      this.logger.error('Error loading session:', error);

      this.session = { apiKey: null, accessToken: null, userId: null, loginTime: null };

    }

  }



  async saveSession() {

    try {

      // Save to file (legacy method - kept for compatibility)

      if (this.sessionFile) {

        const fs = await import('fs/promises');

        await fs.writeFile(this.sessionFile, JSON.stringify(this.session, null, 2));

        this.logger.info('Session saved to file');

      }

      // Save to persistent storage using TokenPersistenceService (SOLID principle)

      if (isValidSession(this.session)) {

        const sessionData = formatSessionForPersistence(this.session);

        await this.tokenPersistence.saveToken(sessionData);

        this.logger.info('Session saved to persistent storage via TokenPersistenceService');

      }

    } catch (error) {

      this.logger.error('Failed to save session:', error);

    }

  }



  async clearSession() {

    this.session = {

      apiKey: null,

      accessToken: null,

      userId: null,

      loginTime: null

    };

    

    try {

      if (this.sessionFile) {

        const fs = await import('fs/promises');

        // Delete the session file completely to ensure no persistence

        await fs.unlink(this.sessionFile).catch(() => {});

        this.logger.info('Session file deleted completely');

      }

    } catch (error) {

      this.logger.error('Error clearing session:', error);

    }

  }



  async ensureWebSocketConnected(reason = 'unknown') {

    if (!this.session?.accessToken || !this.session?.apiKey) {

      this.logger.warn('No session available for WebSocket connection', { reason });

      return;

    }



    // Check if already connected

    if (this.orchestrator?.getConnectionStatus?.().connected) {

      this.logger.debug('WebSocket already connected', { reason });

      return;

    }



    // Prevent connection attempts without valid session

    if (!this.session || !this.session.accessToken || !this.session.apiKey) {

      this.logger.warn('Cannot connect WebSocket: No valid session available', { reason });

      return;

    }



    // Skip validation for fresh OAuth tokens - they were just exchanged

    if (reason !== 'oauth_callback') {

      const isTokenValid = await this.validateAccessToken();

      if (!isTokenValid) {

        this.logger.warn('Access token validation failed, skipping WebSocket connect', { reason });

        return;

      }

    }



    this.logger.info('Connecting to Zerodha WebSocket via connectTicker', { reason });

    

    try {

      // Use connectTicker from zerodhaWebSocket.js - this handles ticks and emits to Socket.IO

      const essentialTokens = [256265, 260105]; // NIFTY 50, BANKNIFTY

      console.log('[Zerodha WebSocket] Connecting with apiKey:', this.session.apiKey);
      console.log('[Zerodha WebSocket] accessToken length:', this.session.accessToken?.length);
      console.log('[Zerodha WebSocket] accessToken first 10 chars:', this.session.accessToken?.substring(0, 10));

      connectTicker(this.session.apiKey, this.session.accessToken, essentialTokens);

      this.logger.info('Zerodha WebSocket connectTicker called successfully', { reason });

    } catch (error) {

      // Use error handler for WebSocket errors - don't clear session on WS errors

      zerodhaErrorHandler.handleWebSocketError(error, this, this.session?.userId);

      this.logger.error('Failed to connect WebSocket via connectTicker', { error: error.message, reason });

    }

  }



  /**

   * Validate access token by making a test API call

   */

  async validateAccessToken() {

    try {

      const response = await axios.get('https://api.kite.trade/user/profile', {

        headers: {

          'Authorization': `token ${this.session.apiKey}:${this.session.accessToken}`,

          'X-Kite-Version': '3'

        },

        timeout: 5000

      });

      

      return response.status === 200;

    } catch (error) {

      this.logger.warn('Access token validation failed', { error: error.message });

      return false;

    }

  }



  /**

   * Refresh access token using existing session

   */

  async refreshAccessToken() {

    try {

      this.logger.info('Attempting automatic token renewal');

      

      // Import TokenRenewalService

      const { TokenRenewalService } = await import('../services/zerodha/token/TokenRenewalService.js');

      const renewalService = new TokenRenewalService(this.logger);

      

      // Generate new login URL for auto-renewal

      const renewalResult = await renewalService.initiateRenewal();

      

      if (renewalResult.success) {

        this.logger.info('Auto-renewal URL generated', { 

          url: renewalResult.url,

          message: 'Token renewal initiated automatically'

        });

        

        // Store renewal URL for automatic processing

        this.renewalUrl = renewalResult.url;

        

        // Return true to indicate renewal process started

        return true;

      } else {

        this.logger.error('Auto-renewal initiation failed', { error: renewalResult.error });

        return false;

      }

      

    } catch (error) {

      this.logger.error('Failed to refresh access token', { error: error.message });

      return false;

    }

  }



  /**

   * Get auto-renewal URL for frontend

   */

  async getAutoRenewalUrl(req, res) {

    try {

      if (!this.renewalUrl) {

        // Generate renewal URL if not available

        await this.refreshAccessToken();

      }

      

      if (this.renewalUrl) {

        return res.json({

          success: true,

          url: this.renewalUrl,

          message: 'Auto-renewal URL available',

          instructions: 'Click the URL to renew your Zerodha session automatically'

        });

      } else {

        return res.status(500).json({

          success: false,

          message: 'Unable to generate auto-renewal URL',

          error: 'Token renewal service unavailable'

        });

      }

    } catch (error) {

      this.logger.error('Error getting auto-renewal URL:', error);

      res.status(500).json({

        success: false,

        message: 'Failed to get auto-renewal URL',

        error: error.message

      });

    }

  }



  /**

   * Start HTTP polling for live prices as WebSocket fallback - DISABLED

   */

  startHttpPricePolling() {

    // COMPLETELY DISABLED - HTTP polling causes historical data to mix with live WebSocket data

    this.logger.warn('HTTP price polling disabled - only WebSocket live data allowed');

    return;

  }



  /**

   * Fetch live prices via HTTP API - DISABLED to prevent historical data mixing

   */

  async fetchLivePrices() {

    // COMPLETELY DISABLED - HTTP fallback causes historical data to mix with live WebSocket data

    this.logger.warn('HTTP price fetching disabled - only WebSocket live data allowed');

    return;

  }



  /**

   * Load session from persistent storage

   */

  async loadSessionFromPersistence() {

    // DISABLED: No session loading - user must login every time

    this.logger.info('Session loading from persistence disabled - user must login every time');

    return;

    

    try {

      const tokenData = await this.tokenPersistence.loadToken();

      

      if (tokenData) {

        this.session = {

          apiKey: tokenData.apiKey || process.env.ZERODHA_API_KEY,

          accessToken: tokenData.accessToken,

          userId: tokenData.userId,

          loginTime: new Date(tokenData.loginTime),

          connected: true

        };

        

        this.logger.info('Session loaded from persistent storage', { 

          userId: tokenData.userId,

          loginTime: tokenData.loginTime 

        });

        

        await this.saveSession();

      } else {

        this.logger.info('No persistent session found, will need manual login');

      }

    } catch (error) {

      this.logger.error('Failed to load session from persistence:', error);

    }

  }



  /**

   * Refresh access token using API key and request token

   */

  async refreshSession(req, res) {

    try {

      // For now, we need a new request token from Zerodha OAuth

      // This would typically come from user re-authentication

      const loginUrl = `https://kite.zerodha.com/connect/login?v=3&api_key=${process.env.ZERODHA_API_KEY}`;

      

      res.status(400).json({

        message: 'Access token expired. Please re-authenticate with Zerodha.',

        action: 're-authenticate',

        loginUrl: loginUrl,

        instructions: 'Click the login URL to get a new app code, then use the Connect Zerodha button in Super Admin.'

      });

    } catch (error) {

      this.logger.error('Token refresh failed:', error);

      res.status(500).json({

        message: 'Failed to refresh session',

        error: error.message

      });

    }

  }



  /**

   * Cleanup resources

   */

  async cleanup() {

    try {

      // Disconnect WebSocket

      if (this.orchestrator) {

        await this.orchestrator.disconnect();

      }



      // Clear session

      await this.clearSession();



      if (this.logger) {

        this.logger.info('Zerodha controller cleaned up');

      }

    } catch (error) {

      this.logger.error('Error during cleanup:', error);

    }

  }



}



// Singleton instance

const zerodhaController = new ZerodhaController();



// Export both class and instance

export { ZerodhaController };

export default zerodhaController;

