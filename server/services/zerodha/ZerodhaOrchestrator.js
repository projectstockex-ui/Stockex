/**
 * Zerodha Orchestrator
 * 
 * Coordinates all Zerodha services with proper dependency injection and error handling.
 * Follows SOLID principles with single responsibility for orchestration.
 */

export class ZerodhaOrchestrator {
  constructor(
    connectionManager,
    subscriptionManager,
    syncService,
    progressService,
    configService,
    loggerService
  ) {
    this.connectionManager = connectionManager;
    this.subscriptionManager = subscriptionManager;
    this.syncService = syncService;
    this.progressService = progressService;
    this.configService = configService;
    this.loggerService = loggerService;
    this.isInitialized = false;
    this.marketData = new Map();
  }

  /**
   * Initialize all Zerodha services
   */
  async initialize(socketIO) {
    try {
      if (this.isInitialized) {
        this.loggerService.warn('Zerodha orchestrator already initialized');
        return;
      }

      this.loggerService.info('Initializing Zerodha orchestrator...');

      // Setup event handlers
      this.setupEventHandlers();

      this.isInitialized = true;
      this.loggerService.info('Zerodha orchestrator initialized successfully');

    } catch (error) {
      this.loggerService.error('Failed to initialize Zerodha orchestrator:', error);
      throw error;
    }
  }

  /**
   * Connect to Zerodha WebSocket
   */
  async connect(apiKey, accessToken, options = {}) {
    try {
      this.loggerService.info('Connecting to Zerodha WebSocket...');

      // Connect using connection manager
      const ticker = await this.connectionManager.connect(apiKey, accessToken, options);

      // Setup tick processing
      this.setupTickProcessing(ticker);

      // Subscribe to essential tokens
      const essentialTokens = Array.from(this.subscriptionManager.essentialTokens);
      await this.subscriptionManager.subscribeTokens(essentialTokens);

      this.loggerService.info('Zerodha WebSocket connected successfully');
      return ticker;

    } catch (error) {
      this.loggerService.error('Failed to connect to Zerodha:', error);
      throw error;
    }
  }

  /**
   * Disconnect from Zerodha WebSocket
   */
  async disconnect() {
    try {
      this.loggerService.info('Disconnecting from Zerodha WebSocket...');

      await this.connectionManager.disconnect();
      this.subscriptionManager.clearAllSubscriptions();
      this.marketData.clear();

      this.loggerService.info('Zerodha WebSocket disconnected successfully');

    } catch (error) {
      this.loggerService.error('Failed to disconnect from Zerodha:', error);
      throw error;
    }
  }

  /**
   * Perform instrument sync with timeout management
   */
  async performSync(apiKey, accessToken, options = {}) {
    try {
      this.loggerService.info('Starting instrument synchronization...');

      const jobId = this.syncService.generateJobId();
      
      // Start sync in background with timeout
      void this.syncService.performFullSync(apiKey, accessToken, {
        ...options,
        jobId
      }).catch((error) => {
        this.loggerService.error('Background sync execution failed:', error);
      });

      // Return job ID for status polling
      return {
        jobId,
        message: 'Sync started in background',
        statusUrl: `/api/zerodha/sync/status/${jobId}`
      };

    } catch (error) {
      this.loggerService.error('Failed to start instrument sync:', error);
      throw error;
    }
  }

  /**
   * Get sync job status
   */
  getSyncStatus(jobId) {
    return this.progressService.getJob(jobId);
  }

  /**
   * Subscribe to tokens
   */
  async subscribeTokens(tokens, options = {}) {
    try {
      return await this.subscriptionManager.subscribeTokens(tokens, options);
    } catch (error) {
      this.loggerService.error('Failed to subscribe to tokens:', error);
      throw error;
    }
  }

  /**
   * Unsubscribe from tokens
   */
  async unsubscribeTokens(tokens) {
    try {
      return await this.subscriptionManager.unsubscribeTokens(tokens);
    } catch (error) {
      this.loggerService.error('Failed to unsubscribe from tokens:', error);
      throw error;
    }
  }

  /**
   * Get market data
   */
  getMarketData() {
    return Object.fromEntries(this.marketData);
  }

  /**
   * Get connection status
   */
  getConnectionStatus() {
    return {
      connected: this.connectionManager.isConnected(),
      state: this.connectionManager.getConnectionState(),
      subscriptions: this.subscriptionManager.getSubscriptionStats(),
      initialized: this.isInitialized
    };
  }

  /**
   * Perform health check
   */
  async performHealthCheck() {
    try {
      const connectionHealth = await this.connectionManager.healthCheck();
      const subscriptionStats = this.subscriptionManager.getSubscriptionStats();
      const syncStats = this.progressService.getJobStats();

      const health = {
        overall: connectionHealth.healthy && subscriptionStats.utilizationRate < 90,
        connection: connectionHealth,
        subscriptions: subscriptionStats,
        sync: syncStats,
        timestamp: new Date()
      };

      return health;

    } catch (error) {
      this.loggerService.error('Health check failed:', error);
      return {
        overall: false,
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  /**
   * Setup event handlers
   */
  setupEventHandlers() {
    // Connection events
    this.connectionManager.on('connected', (data) => {
      this.loggerService.info('Zerodha connected', data);
      this.broadcastToClients('zerodha_status', { connected: true, ...data });
    });

    this.connectionManager.on('disconnected', (data) => {
      this.loggerService.warn('Zerodha disconnected', data);
      this.broadcastToClients('zerodha_status', { connected: false, ...data });
    });

    this.connectionManager.on('error', (error) => {
      this.loggerService.error('Zerodha connection error:', error);
      this.broadcastToClients('zerodha_error', { error: error.message });
    });

    this.connectionManager.on('reconnecting', (data) => {
      this.loggerService.info('Zerodha reconnecting', data);
      this.broadcastToClients('zerodha_status', { connected: false, reconnecting: true, ...data });
    });

    // Reconnection - resubscribe to tokens
    this.connectionManager.on('connected', () => {
      this.subscriptionManager.processPendingSubscriptions()
        .catch(error => {
          this.loggerService.error('Failed to process pending subscriptions:', error);
        });
    });
  }

  /**
   * Setup tick processing
   */
  setupTickProcessing(ticker) {
    ticker.on('ticks', (ticks) => {
      this.processTicks(ticks);
    });
  }

  /**
   * Process incoming ticks
   */
  processTicks(ticks) {
    try {
      const updates = {};
      const canonicalOnly = {};

      // Phase 1: Process ticks and build updates
      for (const tick of ticks) {
        const token = tick.instrument_token.toString();
        const tickData = this.buildTickData(tick);

        this.marketData.set(token, tickData);
        updates[token] = tickData;
        canonicalOnly[token] = tickData;

        // Handle legacy token mapping
        const legacyTokens = this.getLegacyTokens(tick.instrument_token);
        for (const legacyToken of legacyTokens) {
          const alias = { ...tickData, token: String(legacyToken) };
          this.marketData.set(String(legacyToken), alias);
          updates[String(legacyToken)] = alias;
        }
      }

      // Phase 2: Broadcast to clients immediately
      if (Object.keys(updates).length > 0) {
        this.broadcastToClients('market_tick', updates);
      }

      // Phase 3: Deferred processing (async, non-blocking)
      if (Object.keys(canonicalOnly).length > 0) {
        setImmediate(() => {
          this.processTicksDeferred(canonicalOnly);
        });
      }

    } catch (error) {
      this.loggerService.error('Error processing ticks:', error);
    }
  }

  /**
   * Build tick data object
   */
  buildTickData(tick) {
    const rawBid = tick.depth?.buy?.[0]?.price;
    const rawAsk = tick.depth?.sell?.[0]?.price;
    const bestBid = rawBid && rawBid > 0 ? rawBid : tick.last_price;
    const bestAsk = rawAsk && rawAsk > 0 ? rawAsk : tick.last_price;

    const isUpperCircuit = (!rawAsk || rawAsk === 0) && tick.last_price > 0;
    const isLowerCircuit = (!rawBid || rawBid === 0) && tick.last_price > 0;
    const circuitStatus = isUpperCircuit ? 'UC' : isLowerCircuit ? 'LC' : null;

    return {
      token: tick.instrument_token.toString(),
      symbol: this.getSymbol(tick),
      ltp: tick.last_price,
      bid: bestBid,
      ask: bestAsk,
      rawBid: rawBid || 0,
      rawAsk: rawAsk || 0,
      circuit: circuitStatus,
      open: tick.ohlc?.open,
      high: tick.ohlc?.high,
      low: tick.ohlc?.low,
      close: tick.ohlc?.close,
      change: tick.change,
      changePercent: tick.change_percent || this.calculateChangePercent(tick),
      volume: tick.volume_traded || tick.volume,
      buyQuantity: tick.total_buy_quantity,
      sellQuantity: tick.total_sell_quantity,
      lastTradeTime: tick.last_trade_time,
      oi: tick.oi,
      oiDayHigh: tick.oi_day_high,
      oiDayLow: tick.oi_day_low,
      lastUpdated: new Date(),
      serverTimestamp: Date.now()
    };
  }

  /**
   * Process ticks deferred (async operations)
   */
  async processTicksDeferred(ticks) {
    for (const [token, tickData] of Object.entries(ticks)) {
      try {
        // Update database (async, non-blocking)
        this.updateInstrumentInDatabase(token, tickData)
          .catch(error => {
            this.loggerService.error(`DB update error for token ${token}:`, error.message);
          });

        // Trigger margin monitoring (async, non-blocking)
        this.triggerMarginMonitoring(token, tickData)
          .catch(error => {
            this.loggerService.error(`Margin monitor error for token ${token}:`, error.message);
          });

      } catch (error) {
        this.loggerService.error(`Error in deferred processing for token ${token}:`, error);
      }
    }
  }

  /**
   * Update instrument in database
   */
  async updateInstrumentInDatabase(token, tickData) {
    // This would be implemented with proper database service
    // For now, just log the operation
    this.loggerService.debug(`Updating instrument ${token} in database`);
  }

  /**
   * Trigger margin monitoring
   */
  async triggerMarginMonitoring(token, tickData) {
    // This would be implemented with proper margin monitoring service
    // For now, just log the operation
    this.loggerService.debug(`Triggering margin monitoring for token ${token}`);
  }

  /**
   * Helper methods
   */
  getSymbol(tick) {
    const INDEX_SYMBOL = {
      256265: 'NIFTY 50',
      260105: 'NIFTY BANK',
      257801: 'NIFTY FIN SERVICE',
      288009: 'NIFTY MID SELECT',
    };

    return tick.tradable ? tick.tradingsymbol : INDEX_SYMBOL[tick.instrument_token] || tick.tradingsymbol;
  }

  getLegacyTokens(token) {
    const LEGACY_TOKENS = {
      256265: ['99926000'],
      260105: ['99926009'],
      257801: ['99926037'],
      288009: ['99926074'],
    };

    return LEGACY_TOKENS[token] || [];
  }

  calculateChangePercent(tick) {
    if (!tick.ohlc?.close || !tick.last_price) return 0;
    return ((tick.last_price - tick.ohlc.close) / tick.ohlc.close * 100).toFixed(2);
  }

  broadcastToClients(event, data) {
    // This would be implemented with proper Socket.IO service
    // For now, just log the broadcast
    this.loggerService.debug(`Broadcasting to clients: ${event}`, { dataKeys: Object.keys(data) });
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    try {
      this.loggerService.info('Cleaning up Zerodha orchestrator...');

      await this.disconnect();
      this.progressService.cleanupAllJobs();

      this.isInitialized = false;
      this.loggerService.info('Zerodha orchestrator cleaned up successfully');

    } catch (error) {
      this.loggerService.error('Error during cleanup:', error);
    }
  }
}
