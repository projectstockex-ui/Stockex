/**
 * WebSocket Reconnection Manager
 * Implements Single Responsibility Principle (SRP)
 */

import { IWebSocketManager } from '../interfaces/IWebSocketManager.js';
import KiteTicker from 'kiteconnect';

export class WebSocketReconnectionManager extends IWebSocketManager {
  constructor(logger, config = {}) {
    super();
    this.logger = logger;
    this.config = {
      maxReconnectAttempts: 10,
      reconnectDelay: 5000,
      heartbeatInterval: 30000,
      autoReconnect: false, // Disabled to prevent connection without valid session
      exponentialBackoff: true,
      maxReconnectDelay: 60000,
      ...config
    };
    
    this.ticker = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.eventHandlers = {};
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
  }

  /**
   * Connect to WebSocket
   * @param {Object} session - Session object with access token
   * @returns {Promise<boolean>} - True if connected successfully
   */
  async connect(session) {
    try {
      if (!session || !session.access_token) {
        this.logger.error('Invalid session or missing access token');
        return false;
      }

      if (this.isConnected) {
        this.logger.info('WebSocket already connected');
        return true;
      }

      this.logger.info('Connecting to WebSocket', {
        userId: session.user_id,
        hasAccessToken: !!session.access_token
      });

      // Create new ticker instance
      this.ticker = new KiteTicker({
        api_key: process.env.ZERODHA_API_KEY,
        access_token: session.access_token
      });

      // Set up event handlers
      this.setupEventHandlers();

      // Connect to WebSocket
      await new Promise((resolve, reject) => {
        this.ticker.connect();
        
        this.ticker.on('connect', () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.logger.info('WebSocket connected successfully');
          this.startHeartbeat();
          this.emitEvent('connected', { userId: session.user_id });
          resolve();
        });

        this.ticker.on('error', (error) => {
          this.logger.error('WebSocket connection error:', error);
          this.emitEvent('error', { error: error.message });
          if (!this.isConnected) {
            reject(error);
          }
        });

        this.ticker.on('disconnect', (reason) => {
          this.logger.warn('WebSocket disconnected', { reason });
          this.isConnected = false;
          this.stopHeartbeat();
          this.emitEvent('disconnected', { reason });
          
          // Auto-reconnection enabled for stable connection like Binance
          if (this.config.autoReconnect) {
            this.scheduleReconnect();
          } else {
            this.logger.error('Auto-reconnection is disabled - connection will not recover automatically');
          }
        });

        // Timeout after 30 seconds
        setTimeout(() => {
          if (!this.isConnected) {
            reject(new Error('WebSocket connection timeout'));
          }
        }, 30000);
      });

      return true;
    } catch (error) {
      this.logger.error('Failed to connect to WebSocket:', error);
      this.emitEvent('error', { error: error.message });
      return false;
    }
  }

  /**
   * Disconnect from WebSocket
   * @returns {Promise<boolean>} - True if disconnected successfully
   */
  async disconnect() {
    try {
      if (!this.isConnected) {
        this.logger.info('WebSocket already disconnected');
        return true;
      }

      this.logger.info('Disconnecting WebSocket');

      // Clear timers
      this.stopHeartbeat();
      this.clearReconnectTimer();

      // Disconnect ticker
      if (this.ticker) {
        this.ticker.disconnect();
        this.ticker = null;
      }

      this.isConnected = false;
      this.logger.info('WebSocket disconnected successfully');
      this.emitEvent('disconnected', { reason: 'manual' });

      return true;
    } catch (error) {
      this.logger.error('Error disconnecting WebSocket:', error);
      return false;
    }
  }

  /**
   * Check if WebSocket is connected
   * @returns {boolean} - True if connected
   */
  isConnected() {
    return this.isConnected;
  }

  /**
   * Subscribe to instruments
   * @param {Array} instruments - Array of instrument tokens
   * @returns {Promise<boolean>} - True if subscribed successfully
   */
  async subscribe(instruments) {
    try {
      if (!this.isConnected || !this.ticker) {
        this.logger.error('WebSocket not connected, cannot subscribe');
        return false;
      }

      if (!Array.isArray(instruments) || instruments.length === 0) {
        this.logger.error('Invalid instruments array');
        return false;
      }

      this.logger.info('Subscribing to instruments', { count: instruments.length });

      this.ticker.subscribe(instruments);
      this.ticker.mode(this.ticker.modeFull);

      this.logger.info('Successfully subscribed to instruments');
      this.emitEvent('subscribed', { instruments });

      return true;
    } catch (error) {
      this.logger.error('Error subscribing to instruments:', error);
      return false;
    }
  }

  /**
   * Unsubscribe from instruments
   * @param {Array} instruments - Array of instrument tokens
   * @returns {Promise<boolean>} - True if unsubscribed successfully
   */
  async unsubscribe(instruments) {
    try {
      if (!this.isConnected || !this.ticker) {
        this.logger.error('WebSocket not connected, cannot unsubscribe');
        return false;
      }

      if (!Array.isArray(instruments) || instruments.length === 0) {
        this.logger.error('Invalid instruments array');
        return false;
      }

      this.logger.info('Unsubscribing from instruments', { count: instruments.length });

      this.ticker.unsubscribe(instruments);

      this.logger.info('Successfully unsubscribed from instruments');
      this.emitEvent('unsubscribed', { instruments });

      return true;
    } catch (error) {
      this.logger.error('Error unsubscribing from instruments:', error);
      return false;
    }
  }

  /**
   * Set connection event handlers
   * @param {Object} handlers - Event handlers
   */
  setEventHandlers(handlers) {
    this.eventHandlers = { ...this.eventHandlers, ...handlers };
  }

  /**
   * Monitor connection health
   * @param {Function} callback - Status callback
   */
  monitorConnection(callback) {
    this.healthCallback = callback;
    
    // Start monitoring if connected
    if (this.isConnected) {
      this.startHeartbeat();
    }
  }

  /**
   * Setup event handlers for ticker
   */
  setupEventHandlers() {
    if (!this.ticker) return;

    this.ticker.on('ticks', (ticks) => {
      this.emitEvent('ticks', ticks);
    });

    this.ticker.on('connect', () => {
      this.logger.info('WebSocket connected');
      this.emitEvent('connected');
    });

    this.ticker.on('disconnect', (reason) => {
      this.logger.warn('WebSocket disconnected', { reason });
      this.emitEvent('disconnected', { reason });
    });

    this.ticker.on('error', (error) => {
      this.logger.error('WebSocket error:', error);
      this.emitEvent('error', { error: error.message });
    });

    this.ticker.on('reconnect', () => {
      this.logger.info('WebSocket reconnected');
      this.emitEvent('reconnected');
    });
  }

  /**
   * Emit event to handlers
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  emitEvent(event, data = {}) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event](data);
    }
  }

  /**
   * Start heartbeat monitoring
   */
  startHeartbeat() {
    this.stopHeartbeat();
    
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected && this.ticker) {
        // Check connection health like Binance WebSocket
        this.checkConnectionHealth();
      } else {
        this.logger.warn('Heartbeat: WebSocket not connected');
        this.emitEvent('heartbeatFailed', { reason: 'not_connected' });
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Check connection health
   */
  checkConnectionHealth() {
    try {
      // For KiteTicker, we can check if the connection is still active
      if (this.ticker && this.isConnected) {
        this.logger.debug('Heartbeat: Connection healthy');
        this.emitEvent('heartbeat', { 
          connected: true, 
          timestamp: new Date().toISOString(),
          reconnectAttempts: this.reconnectAttempts
        });
      } else {
        this.logger.warn('Heartbeat: Connection lost, triggering reconnection');
        this.isConnected = false;
        this.emitEvent('heartbeatFailed', { reason: 'connection_lost' });
        
        if (this.config.autoReconnect) {
          this.scheduleReconnect();
        }
      }
    } catch (error) {
      this.logger.error('Heartbeat check failed:', error);
      this.emitEvent('heartbeatFailed', { reason: 'check_failed', error: error.message });
    }
  }

  /**
   * Stop heartbeat monitoring
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.logger.error('Max reconnection attempts reached');
      this.emitEvent('reconnectFailed');
      return;
    }

    // Calculate delay with exponential backoff and max limit
    let delay;
    if (this.config.exponentialBackoff) {
      delay = Math.min(this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts), this.config.maxReconnectDelay);
    } else {
      delay = this.config.reconnectDelay;
    }
    
    this.reconnectAttempts++;

    this.logger.info(`Scheduling reconnection attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts} in ${delay/1000}s (exponential backoff: ${this.config.exponentialBackoff})`);

    this.reconnectTimer = setTimeout(async () => {
      this.logger.info(`Attempting reconnection ${this.reconnectAttempts}`);
      this.emitEvent('reconnecting', { attempt: this.reconnectAttempts });
      
      // Emit event for parent to handle actual reconnection
      this.emitEvent('reconnectRequested', { attempt: this.reconnectAttempts });
    }, delay);
  }

  /**
   * Clear reconnection timer
   */
  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Get connection status
   * @returns {Object} - Connection status
   */
  getConnectionStatus() {
    return {
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.config.maxReconnectAttempts,
      autoReconnect: this.config.autoReconnect
    };
  }
}
