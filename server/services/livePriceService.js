/**
 * Live Price Service
 * 
 * Provides current live tick-to-tick prices for order placement
 * Ensures orders use only live data, not historical data
 */

class LivePriceService {
  constructor() {
    this.livePrices = new Map(); // symbol -> { price, timestamp, bid, ask }
    this.priceSubscribers = new Map(); // symbol -> Set of callbacks
  }

  /**
   * Update live price from WebSocket tick
   * @param {Object} tick - WebSocket tick data
   */
  updateLivePrice(tick) {
    if (!tick || !tick.tradingsymbol || !tick.last_price) return;

    const symbol = tick.tradingsymbol;
    const now = new Date();
    
    // Only update if tick is within 5 minutes (live data)
    const tickTime = new Date(tick.timestamp || now);
    const timeDiffMinutes = (now - tickTime) / (1000 * 60);
    
    if (timeDiffMinutes > 5) {
      console.log(`⚠️ LIVE PRICE SERVICE: Skipping historical data for ${symbol} (${timeDiffMinutes.toFixed(2)} minutes old)`);
      return;
    }

    const priceData = {
      price: tick.last_price,
      timestamp: tickTime,
      serverTimestamp: now,
      bid: tick.depth?.buy?.[0]?.price || 0,
      ask: tick.depth?.sell?.[0]?.price || 0,
      volume: tick.volume_traded || tick.volume,
      oi: tick.oi,
      change: tick.change,
      changePercent: tick.change_percent,
      ohlc: tick.ohlc
    };

    this.livePrices.set(symbol, priceData);
    
    // Notify subscribers
    const subscribers = this.priceSubscribers.get(symbol);
    if (subscribers) {
      subscribers.forEach(callback => {
        try {
          callback(symbol, priceData);
        } catch (error) {
          console.error(`Live price subscriber error for ${symbol}:`, error);
        }
      });
    }

    console.log(`💰 LIVE PRICE UPDATE: ${symbol} = ${priceData.price} (${timeDiffMinutes.toFixed(2)} minutes old)`);
  }

  /**
   * Get current live price for a symbol
   * @param {string} symbol - Trading symbol
   * @returns {Object|null} Live price data or null if not available
   */
  getLivePrice(symbol) {
    const priceData = this.livePrices.get(symbol);
    if (!priceData) return null;

    // Check if data is still live (within 5 minutes)
    const now = new Date();
    const timeDiffMinutes = (now - priceData.timestamp) / (1000 * 60);
    
    if (timeDiffMinutes > 5) {
      console.log(`⚠️ LIVE PRICE SERVICE: ${symbol} data expired (${timeDiffMinutes.toFixed(2)} minutes old)`);
      this.livePrices.delete(symbol);
      return null;
    }

    return {
      ...priceData,
      ageMinutes: timeDiffMinutes,
      isLive: timeDiffMinutes <= 5
    };
  }

  /**
   * Get live price for order placement (with validation)
   * @param {string} symbol - Trading symbol
   * @returns {Object} Live price data with timestamp for order validation
   * @throws {Error} If no live price available
   */
  getPriceForOrder(symbol) {
    const priceData = this.getLivePrice(symbol);
    
    if (!priceData || !priceData.isLive) {
      throw new Error(`No live price available for ${symbol}. Cannot place order without live tick-to-tick data.`);
    }

    return {
      price: priceData.price,
      bid: priceData.bid,
      ask: priceData.ask,
      timestamp: priceData.timestamp.toISOString(),
      ageMinutes: priceData.ageMinutes,
      symbol: symbol
    };
  }

  /**
   * Subscribe to live price updates for a symbol
   * @param {string} symbol - Trading symbol
   * @param {Function} callback - Callback function (symbol, priceData) => {}
   */
  subscribeToPrice(symbol, callback) {
    if (!this.priceSubscribers.has(symbol)) {
      this.priceSubscribers.set(symbol, new Set());
    }
    this.priceSubscribers.get(symbol).add(callback);

    // Send current price if available
    const currentPrice = this.getLivePrice(symbol);
    if (currentPrice) {
      callback(symbol, currentPrice);
    }

    console.log(`📡 LIVE PRICE SUBSCRIPTION: ${symbol}`);
  }

  /**
   * Unsubscribe from live price updates
   * @param {string} symbol - Trading symbol
   * @param {Function} callback - Callback function to remove
   */
  unsubscribeFromPrice(symbol, callback) {
    const subscribers = this.priceSubscribers.get(symbol);
    if (subscribers) {
      subscribers.delete(callback);
      if (subscribers.size === 0) {
        this.priceSubscribers.delete(symbol);
      }
    }
  }

  /**
   * Get all live prices
   * @returns {Object} All current live prices
   */
  getAllLivePrices() {
    const result = {};
    for (const [symbol, priceData] of this.livePrices) {
      const liveData = this.getLivePrice(symbol);
      if (liveData && liveData.isLive) {
        result[symbol] = liveData;
      }
    }
    return result;
  }

  /**
   * Clean up expired prices (older than 5 minutes)
   */
  cleanupExpiredPrices() {
    const now = new Date();
    const expiredSymbols = [];

    for (const [symbol, priceData] of this.livePrices) {
      const timeDiffMinutes = (now - priceData.timestamp) / (1000 * 60);
      if (timeDiffMinutes > 5) {
        expiredSymbols.push(symbol);
      }
    }

    expiredSymbols.forEach(symbol => {
      this.livePrices.delete(symbol);
      this.priceSubscribers.delete(symbol);
    });

    if (expiredSymbols.length > 0) {
      console.log(`🧹 LIVE PRICE CLEANUP: Removed ${expiredSymbols.length} expired symbols: ${expiredSymbols.join(', ')}`);
    }
  }

  /**
   * Get service statistics
   * @returns {Object} Service statistics
   */
  getStats() {
    return {
      totalSymbols: this.livePrices.size,
      totalSubscribers: Array.from(this.priceSubscribers.values()).reduce((sum, set) => sum + set.size, 0),
      symbols: Array.from(this.livePrices.keys()),
      subscribers: Object.fromEntries(
        Array.from(this.priceSubscribers.entries()).map(([symbol, set]) => [symbol, set.size])
      )
    };
  }
}

// Singleton instance
const livePriceService = new LivePriceService();

// Auto-cleanup every minute (DISABLED FOR TESTING)
// setInterval(() => {
//   livePriceService.cleanupExpiredPrices();
// }, 60 * 1000);

// LivePriceService now uses real WebSocket data only - no mock data
console.log('🏭 LivePriceService initialized - waiting for real WebSocket data...');

export default livePriceService;
