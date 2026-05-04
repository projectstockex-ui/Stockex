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
      
      // Load existing session
      await this.loadSession();
      // Reattach live ticker on boot when persisted session exists.
      await this.ensureWebSocketConnected('initialize');
      
      this.logger.info('Zerodha controller initialized successfully');
      
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
      // Use environment variable with fallback for development
      const apiKey = process.env.ZERODHA_API_KEY || 'uenync1h2njo4g5i';
      const callbackUrl = environmentConfig.getCallbackUrl();
      
      console.log('Generating login URL with API key:', apiKey);
      console.log('Using callback URL:', callbackUrl);
      
      const loginUrl = `https://kite.zerodha.com/connect/login?v=3&api_key=${apiKey}`;
      
      res.json({
        loginUrl,
        callbackUrl,
        apiKey,
        message: 'Use this URL to connect to Zerodha',
        environment: environmentConfig.getEnvironmentInfo()
      });
      
    } catch (error) {
      console.error('Zerodha login URL error:', error);
      
      res.status(500).json({
        message: 'Failed to generate login URL',
        error: error.message
      });
    }
  }

  /**
   * Exchange Kite Connect request_token for access_token and persist session.
   */
  async exchangeAndPersistSession(requestToken) {
    const apiKey = process.env.ZERODHA_API_KEY;
    const apiSecret = process.env.ZERODHA_API_SECRET;
    if (!apiKey || !apiSecret) {
      throw new Error('ZERODHA_API_KEY and ZERODHA_API_SECRET must be set in server .env');
    }

    const checksum = crypto
      .createHash('sha256')
      .update(apiKey + requestToken + apiSecret)
      .digest('hex');

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
    } catch (e) {
      const msg = e.response?.data?.message || e.message || 'Network error calling Kite';
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }

    if (kiteRes?.status !== 'success' || !kiteRes?.data?.access_token) {
      const errMsg = kiteRes?.message || kiteRes?.error_type || 'Token exchange failed';
      throw new Error(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
    }

    const d = kiteRes.data;
    this.session = {
      apiKey,
      accessToken: d.access_token,
      userId: d.user_id != null ? String(d.user_id) : 'unknown',
      loginTime: new Date(),
      connected: true,
    };
    await this.saveSession();
    await this.ensureWebSocketConnected('oauth_callback');
  }

  /**
   * Handle Zerodha OAuth callback
   */
  async handleCallback(requestToken) {
    try {
      await this.exchangeAndPersistSession(requestToken);
      this.logger.info('Zerodha session established', { userId: this.session.userId });
      return { connected: true, accessToken: this.session.accessToken };
    } catch (error) {
      this.logger.error('Error handling Zerodha callback:', error);
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
      
      // Clear session on connection failure
      await this.clearSession();
      
      res.status(500).json({
        message: 'Failed to connect to Zerodha',
        error: error.message
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
   * Get connection status (works with or without authentication)
   */
  async getStatus(req, res) {
    try {
      // Best-effort self-heal: if session is present but socket is down, reconnect in background.
      void this.ensureWebSocketConnected('status_probe');
      let orchState = null;
      try {
        orchState = this.orchestrator?.getConnectionStatus?.() ?? null;
      } catch {
        orchState = null;
      }

      const wsConnected = !!orchState?.connected;
      const hasSession = !!(this.session?.accessToken && this.session?.apiKey);
      const connected = hasSession || wsConnected;

      const connectionStatus = {
        connected,
        wsConnected,
        hasSession,
        userId: this.session?.userId || null,
        initialized: !!orchState?.initialized,
        authenticated: !!req.user,
        userType: req.userType || null,
        timestamp: new Date(),
        session: hasSession
          ? { userId: this.session.userId, loginTime: this.session.loginTime }
          : null,
        instruments: [],
        subscriptions: [],
      };

      res.json(connectionStatus);
    } catch (error) {
      console.error('Zerodha status error:', error);
      
      res.status(500).json({
        message: 'Failed to get connection status',
        error: error.message,
        connected: false
      });
    }
  }

  /**
   * Reset and sync instruments
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
        .filter(job => job.type === 'full_sync');
      
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
        estimatedTime: '5-10 minutes'
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
        return res.status(404).json({ message: 'Job not found' });
      }

      res.json(job);

    } catch (error) {
      this.logger.error('Error getting sync status:', error);
      res.status(500).json({
        message: 'Failed to get sync status',
        error: error.message
      });
    }
  }

  /**
   * Get all sync jobs
   */
  async getSyncJobs(req, res) {
    try {
      const jobs = this.orchestrator.progressService.getJobsByType('full_sync');
      res.json({ jobs });
    } catch (error) {
      this.logger.error('Error getting sync jobs:', error);
      res.status(500).json({
        message: 'Failed to get sync jobs',
        error: error.message
      });
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
   * User-facing token subscription endpoint.
   * Best-effort only: never hard-fail dashboards when Zerodha is reconnecting.
   */
  async tickSubscribe(req, res) {
    try {
      const { tokens, symbols } = req.body || {};
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

      // Fallback path for contracts whose token was not present in watchlist payload.
      if (Array.isArray(symbols) && symbols.length > 0) {
        const cleanSymbols = symbols
          .map((s) => String(s || '').trim().toUpperCase())
          .filter((s) => s.length > 0)
          .slice(0, 100);
        if (cleanSymbols.length > 0) {
          const bases = [...new Set(cleanSymbols.map(deriveBase).filter(Boolean))];
          const prefixRegexes = bases.map((b) => new RegExp(`^${escapeRegex(b)}`, 'i'));
          const rows = await Instrument.find({
            $or: [
              { symbol: { $in: cleanSymbols } },
              { tradingSymbol: { $in: cleanSymbols } },
              ...(prefixRegexes.length > 0
                ? [
                    { symbol: { $in: prefixRegexes } },
                    { tradingSymbol: { $in: prefixRegexes } },
                  ]
                : []),
            ],
          })
            .select('token symbol tradingSymbol exchange displaySegment segment')
            .lean();
          for (const row of rows || []) {
            const n = Number.parseInt(String(row?.token || '').trim(), 10);
            if (Number.isFinite(n) && n > 0) normalized.push(n);
          }
        }
      }

      const deduped = [...new Set(normalized)];
      if (deduped.length === 0) {
        return res.status(202).json({
          message: 'No valid token ids resolved; skipped',
          accepted: 0,
        });
      }

      // If WS is reconnecting, keep UI stable instead of throwing 400 loops.
      if (!this.orchestrator?.getConnectionStatus?.().connected) {
        void this.ensureWebSocketConnected('user_tick_subscribe');
        return res.status(202).json({
          message: 'Zerodha reconnect in progress; subscription queued',
          accepted: deduped.length,
        });
      }

      const result = await this.orchestrator.subscribeTokens(deduped, {
        timeout: 30000,
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
      const marketData = this.orchestrator.getMarketData();
      // Keep payload shape flat so dashboards can merge token->tick map directly.
      res.json(marketData && typeof marketData === 'object' ? marketData : {});
    } catch (error) {
      this.logger.error('Error getting market data:', error);
      res.status(500).json({
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

      const md = this.orchestrator?.getMarketData?.() || {};
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

      const sourceRow = dbRow || baseFamilyRow;
      let ltp = pick(
        tick?.ltp,
        sourceRow?.ltp,
        sourceRow?.close,
        sourceRow?.previousDayClosePrice,
        sourceRow?.lastBid,
        sourceRow?.lastAsk,
        sourceRow?.open
      );
      let ltpSource = tick
        ? 'ws_orchestrator'
        : baseFamilyRow
          ? 'instrument_base_family_fallback'
          : baseSymbolRaw
            ? 'instrument_base_fallback'
            : 'instrument_db_fallback';

      // Last-resort resolver: Redis/Instrument/OPEN trades path used by RMS & auto-squareoff.
      if (ltp == null) {
        const candidates = [
          { token: tokenKey, symbol: symbolRaw, exchange: 'MCX' },
          { token: tokenKey, symbol: tradingSymbolRaw, exchange: 'MCX' },
          { token: sourceRow?.token, symbol: sourceRow?.symbol || sourceRow?.tradingSymbol, exchange: sourceRow?.exchange || 'MCX' },
          { token: null, symbol: baseSymbolRaw, exchange: 'MCX' },
        ];
        for (const c of candidates) {
          const s = String(c?.symbol || '').trim();
          const t = String(c?.token || '').trim();
          if (!s && !t) continue;
          const viaLtpResolver = await getLTP({
            token: t || undefined,
            symbol: s || undefined,
            exchange: c?.exchange || 'MCX',
          });
          if (Number.isFinite(viaLtpResolver) && viaLtpResolver > 0) {
            ltp = Number(viaLtpResolver);
            ltpSource = 'ltp_resolution_service_fallback';
            break;
          }
        }
      }

      // Zerodha REST quote fallback (live) when ws/db snapshots don't have contract price.
      const restAttempts = [];
      if (ltp == null && this.session?.apiKey && this.session?.accessToken) {
        const quoteSymbols = [
          String(tradingSymbolRaw || '').trim().toUpperCase(),
          String(symbolRaw || '').trim().toUpperCase(),
          String(sourceRow?.tradingSymbol || '').trim().toUpperCase(),
          String(sourceRow?.symbol || '').trim().toUpperCase(),
        ].filter(Boolean);
        const seen = new Set();
        for (const ts of quoteSymbols) {
          if (seen.has(ts)) continue;
          seen.add(ts);
          const url = `https://api.kite.trade/quote?i=${encodeURIComponent(`MCX:${ts}`)}`;
          try {
            const qr = await axios.get(url, {
              headers: {
                'X-Kite-Version': '3',
                Authorization: `token ${this.session.apiKey}:${this.session.accessToken}`,
              },
              timeout: 6000,
              validateStatus: () => true,
            });
            const q = qr?.data?.data?.[`MCX:${ts}`];
            const restLtp = pick(q?.last_price, q?.ohlc?.close, q?.depth?.buy?.[0]?.price, q?.depth?.sell?.[0]?.price);
            restAttempts.push({
              symbol: `MCX:${ts}`,
              status: qr?.status,
              kiteStatus: qr?.data?.status || null,
              kiteMessage: qr?.data?.message || null,
              hasData: !!q,
              picked: restLtp,
            });
            if (restLtp != null) {
              ltp = restLtp;
              ltpSource = 'kite_rest_quote_fallback';
              break;
            }
          } catch (e) {
            restAttempts.push({
              symbol: `MCX:${ts}`,
              error: e?.message || String(e),
            });
          }
        }
      }
      // Auto-subscribe requested token so subsequent ticks flow even if watchlist subscribe lagged.
      try {
        const subToken = Number.parseInt(tokenKey, 10);
        if (
          Number.isFinite(subToken) &&
          subToken > 0 &&
          this.orchestrator?.getConnectionStatus?.().connected
        ) {
          void this.orchestrator.subscribeTokens([subToken]).catch(() => {});
        }
      } catch {
        // Best-effort subscribe; never block the response.
      }

      const connection = this.orchestrator?.getConnectionStatus?.() || {};
      if (ltp == null) {
        return res.status(404).json({
          message: 'Price unavailable for requested contract',
          debug: {
            requested: { tokenRaw, symbolRaw, tradingSymbolRaw, baseSymbolFromReq, baseSymbolRaw },
            checks: {
              wsConnected: !!connection.connected,
              tickFound: !!tick,
              instrumentRowFound: !!dbRow,
              baseFamilyRowFound: !!baseFamilyRow,
              hasKiteSession: !!(this.session?.apiKey && this.session?.accessToken),
              autoReconnectScheduled: !connection.connected,
            },
            instrumentRowSnapshot: dbRow
              ? {
                  ltp: dbRow.ltp,
                  close: dbRow.close,
                  open: dbRow.open,
                  prevDayClose: dbRow.previousDayClosePrice,
                  lastBid: dbRow.lastBid,
                  lastAsk: dbRow.lastAsk,
                }
              : null,
            restAttempts,
          },
        });
      }
      const bid = pick(tick?.rawBid, tick?.bid, sourceRow?.lastBid, sourceRow?.open, ltp);
      const ask = pick(tick?.rawAsk, tick?.ask, sourceRow?.lastAsk, sourceRow?.open, ltp);

      return res.json({
        token: tick?.token || sourceRow?.token || tokenKey || null,
        symbol: tick?.symbol || sourceRow?.symbol || symbolRaw || baseSymbolRaw || null,
        tradingSymbol: tick?.tradingSymbol || sourceRow?.tradingSymbol || tradingSymbolRaw || null,
        exchange: tick?.exchange || sourceRow?.exchange || 'MCX',
        ltp,
        bid,
        ask,
        open: pick(tick?.open, sourceRow?.open, ltp),
        high: pick(tick?.high, sourceRow?.high, sourceRow?.open, ltp),
        low: pick(tick?.low, sourceRow?.low, sourceRow?.open, ltp),
        close: pick(tick?.close, sourceRow?.close, sourceRow?.previousDayClosePrice, ltp),
        prevDayClose: pick(sourceRow?.previousDayClosePrice, sourceRow?.close, ltp),
        source: ltpSource,
        wsConnected: !!connection.connected,
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
      if (this.sessionFile) {
        const fs = await import('fs/promises');
        try {
          const data = await fs.readFile(this.sessionFile, 'utf8');
          this.session = JSON.parse(data);
          this.logger.info('Session loaded from file');
        } catch (error) {
          // File doesn't exist or is invalid
          this.logger.debug('No existing session file found');
        }
      }
    } catch (error) {
      this.logger.error('Error loading session:', error);
    }
  }

  async saveSession() {
    try {
      if (this.sessionFile) {
        const fs = await import('fs/promises');
        await fs.writeFile(this.sessionFile, JSON.stringify(this.session, null, 2));
        this.logger.info('Session saved to file');
      }
    } catch (error) {
      this.logger.error('Error saving session:', error);
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
        await fs.writeFile(this.sessionFile, JSON.stringify(this.session, null, 2));
      }
    } catch (error) {
      this.logger.error('Error clearing session:', error);
    }
  }

  async ensureWebSocketConnected(reason = 'unknown') {
    if (!this.orchestrator) return;
    const hasSession = !!(this.session?.apiKey && this.session?.accessToken);
    if (!hasSession) return;

    const state = this.orchestrator.getConnectionStatus?.() || {};
    if (state.connected) return;

    if (this._autoConnectInFlight) {
      await this._autoConnectInFlight;
      return;
    }

    this._autoConnectInFlight = (async () => {
      try {
        this.logger.info('Attempting Zerodha WS auto-connect', { reason, userId: this.session.userId });
        await this.orchestrator.connect(this.session.apiKey, this.session.accessToken, {
          timeout: this.config?.getConnectionTimeout?.() || 30000,
        });
        this.logger.info('Zerodha WS auto-connect successful', { reason });
      } catch (error) {
        this.logger.warn('Zerodha WS auto-connect failed', {
          reason,
          message: error?.message || String(error),
        });
      } finally {
        this._autoConnectInFlight = null;
      }
    })();

    await this._autoConnectInFlight;
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    try {
      this.logger.info('Cleaning up Zerodha controller...');
      
      if (this.orchestrator) {
        await this.orchestrator.cleanup();
      }
      
      this.logger.info('Zerodha controller cleaned up successfully');
      
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
