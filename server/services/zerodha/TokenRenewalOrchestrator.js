/**
 * Token Renewal Orchestrator
 * Coordinates all token renewal services following SOLID principles
 */

import { TokenExpirationDetector } from './token/TokenExpirationDetector.js';
import { SessionManager } from './token/SessionManager.js';
import { TokenRenewalService } from './token/TokenRenewalService.js';
import { WebSocketReconnectionManager } from './connection/WebSocketReconnectionManager.js';
import { TokenEventEmitter } from './events/TokenEventEmitter.js';

export class TokenRenewalOrchestrator {
  constructor(logger, config = {}) {
    this.logger = logger;
    this.config = config;
    
    // Initialize services following Dependency Inversion Principle
    this.eventEmitter = new TokenEventEmitter(logger);
    this.sessionManager = new SessionManager(logger, config.sessionFilePath);
    this.expirationDetector = new TokenExpirationDetector(logger, config.expiration);
    this.renewalService = new TokenRenewalService(logger, this.sessionManager, this.eventEmitter, config.renewal);
    this.websocketManager = new WebSocketReconnectionManager(logger, this.eventEmitter, config.websocket);
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Start monitoring
    this.isMonitoring = false;
  }

  /**
   * Initialize the orchestrator
   * @param {Object} io - Socket.IO instance
   */
  async initialize(io) {
    try {
      this.logger.info('Initializing Token Renewal Orchestrator');
      
      // Set Socket.IO instance for services
      this.io = io;
      this.websocketManager.io = io;
      
      // Load existing session
      const session = await this.sessionManager.loadSession();
      
      if (session) {
        this.logger.info('Session loaded', { userId: session.userId });
        
        // Check if token needs renewal
        const needsRenewal = await this.expirationDetector.isTokenExpired(session);
        
        if (needsRenewal) {
          this.logger.warn('Token expired, initiating renewal');
          await this.initiateRenewal();
        } else {
          // Connect WebSocket if token is valid
          await this.connectWebSocket(session);
        }
      } else {
        this.logger.info('No existing session found');
      }
      
      // Start monitoring
      this.startMonitoring();
      
      this.logger.info('Token Renewal Orchestrator initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Token Renewal Orchestrator:', error);
    }
  }

  /**
   * Start monitoring token expiration and connection health
   */
  startMonitoring() {
    if (this.isMonitoring) {
      return;
    }

    this.isMonitoring = true;
    this.logger.info('Starting token monitoring');

    // Monitor token expiration every 10 minutes (reduced frequency)
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.checkTokenStatus();
      } catch (error) {
        this.logger.error('Error during token monitoring:', error);
      }
    }, 10 * 60 * 1000); // 10 minutes (reduced from 5 minutes)

    // Monitor WebSocket connection
    this.websocketManager.monitorConnection((status) => {
      if (!status.connected && this.sessionManager.getCurrentSession()) {
        this.logger.warn('WebSocket connection lost, attempting reconnection');
        this.attemptWebSocketReconnection();
      }
    });
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    this.isMonitoring = false;
    this.logger.info('Token monitoring stopped');
  }

  /**
   * Check token status and handle expiration
   */
  async checkTokenStatus() {
    try {
      const session = await this.sessionManager.loadSession();
      
      if (!session) {
        return;
      }

      // Get token expiration info
      const expirationInfo = await this.expirationDetector.getTokenExpirationInfo(session);
      
      this.logger.debug('Token status check', expirationInfo);

      // Emit token status event
      if (this.io) {
        this.io.emit('token_status', expirationInfo);
      }

      // Handle expiration
      if (expirationInfo.isExpired) {
        this.eventEmitter.emitTokenExpired(expirationInfo);
        await this.initiateRenewal();
      } else if (expirationInfo.isNearExpiration) {
        this.eventEmitter.emitTokenNearExpiration(expirationInfo);
      }
    } catch (error) {
      this.logger.error('Error checking token status:', error);
    }
  }

  /**
   * Connect WebSocket with session
   * @param {Object} session - Zerodha session
   */
  async connectWebSocket(session) {
    try {
      this.logger.info('Connecting WebSocket with session');
      
      const connected = await this.websocketManager.connect(session);
      
      if (connected) {
        this.logger.info('WebSocket connected successfully');
        
        // Update session connection status
        await this.sessionManager.updateSession({ connected: true });
      } else {
        this.logger.error('WebSocket connection failed');
      }
    } catch (error) {
      this.logger.error('Error connecting WebSocket:', error);
    }
  }

  /**
   * Attempt WebSocket reconnection
   */
  async attemptWebSocketReconnection() {
    try {
      const session = this.sessionManager.getCurrentSession();
      
      if (!session) {
        this.logger.warn('No session available for WebSocket reconnection');
        return;
      }

      const reconnected = await this.websocketManager.reconnectWithNewToken(session);
      
      if (reconnected) {
        this.logger.info('WebSocket reconnected successfully');
      } else {
        this.logger.error('WebSocket reconnection failed, may need token renewal');
        await this.initiateRenewal();
      }
    } catch (error) {
      this.logger.error('Error during WebSocket reconnection:', error);
    }
  }

  /**
   * Initiate token renewal process
   */
  async initiateRenewal() {
    try {
      this.logger.info('Initiating token renewal process');
      
      // Get renewal URL
      const renewalResult = await this.renewalService.renewToken();
      
      if (renewalResult.success) {
        this.logger.info('Token renewal initiated', { renewalUrl: renewalResult.renewalUrl });
        
        // Send renewal URL to client
        if (this.io) {
          this.io.emit('token_renewal_required', {
            renewalUrl: renewalResult.renewalUrl,
            message: renewalResult.message
          });
        }
      } else {
        this.logger.error('Token renewal initiation failed', renewalResult);
      }
    } catch (error) {
      this.logger.error('Error initiating token renewal:', error);
    }
  }

  /**
   * Handle OAuth callback
   * @param {string} requestToken - Request token from Zerodha
   * @returns {Promise<Object>} - Callback result
   */
  async handleOAuthCallback(requestToken) {
    try {
      this.logger.info('Handling OAuth callback');
      
      const result = await this.renewalService.handleOAuthCallback(requestToken);
      
      if (result.success) {
        this.logger.info('OAuth callback successful, reconnecting WebSocket');
        
        // Reconnect WebSocket with new session
        await this.connectWebSocket(result.session);
        
        // Send success to client
        if (this.io) {
          this.io.emit('token_renewal_completed', {
            success: true,
            message: 'Token renewed successfully',
            session: {
              userId: result.session.userId,
              loginTime: result.session.loginTime
            }
          });
        }
      } else {
        this.logger.error('OAuth callback failed', result);
        
        // Send error to client
        if (this.io) {
          this.io.emit('token_renewal_completed', {
            success: false,
            error: result.error,
            message: result.message
          });
        }
      }
      
      return result;
    } catch (error) {
      this.logger.error('Error handling OAuth callback:', error);
      
      return {
        success: false,
        error: error.message,
        message: 'OAuth callback processing failed'
      };
    }
  }

  /**
   * Get current status
   * @returns {Promise<Object>} - Current status
   */
  async getStatus() {
    try {
      const session = await this.sessionManager.loadSession();
      const websocketStatus = await this.websocketManager.getConnectionStatus();
      const renewalStatus = await this.renewalService.getRenewalStatus();
      
      let expirationInfo = null;
      if (session) {
        expirationInfo = await this.expirationDetector.getTokenExpirationInfo(session);
      }

      return {
        session: {
          hasSession: !!session,
          userId: session?.userId || null,
          loginTime: session?.loginTime || null
        },
        websocket: websocketStatus,
        renewal: renewalStatus,
        expiration: expirationInfo,
        monitoring: this.isMonitoring
      };
    } catch (error) {
      this.logger.error('Error getting status:', error);
      return {
        error: error.message,
        session: { hasSession: false },
        websocket: { connected: false },
        renewal: { needsRenewal: true },
        expiration: null,
        monitoring: this.isMonitoring
      };
    }
  }

  /**
   * Force token renewal
   * @returns {Promise<Object>} - Renewal result
   */
  async forceRenewal() {
    this.logger.info('Force token renewal requested');
    return await this.initiateRenewal();
  }

  /**
   * Set up event listeners
   */
  setupEventListeners() {
    // Handle token expiration
    this.eventEmitter.on('token.expired', (data) => {
      this.logger.warn('Token expired event received', data);
    });

    // Handle token renewal completion
    this.eventEmitter.on('token.renewal.completed', (data) => {
      this.logger.info('Token renewal completed', data);
    });

    // Handle WebSocket events
    this.eventEmitter.on('websocket.connected', (data) => {
      this.logger.info('WebSocket connected', data);
    });

    this.eventEmitter.on('websocket.disconnected', (data) => {
      this.logger.warn('WebSocket disconnected', data);
    });

    this.eventEmitter.on('websocket.error', (data) => {
      this.logger.error('WebSocket error', data);
    });
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    try {
      this.logger.info('Cleaning up Token Renewal Orchestrator');
      
      // Stop monitoring
      this.stopMonitoring();
      
      // Disconnect WebSocket
      await this.websocketManager.disconnect();
      
      // Clear event listeners
      this.eventEmitter.removeAllListeners();
      
      this.logger.info('Token Renewal Orchestrator cleaned up successfully');
    } catch (error) {
      this.logger.error('Error during cleanup:', error);
    }
  }
}
