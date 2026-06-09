import Instrument from '../models/Instrument.js';
import RiskConfig from '../models/RiskConfig.js';

/**
 * TradePro Trading Engine - Circuit Breaker Service
 * 
 * Manages circuit limits for instruments:
 * - Daily reset of circuit prices before market open
 * - Per-tick price validation against circuit limits
 * - Circuit hit notifications
 */

let io = null;

// Default circuit percentages by category
const CIRCUIT_DEFAULTS = {
  NIFTY: 10,
  BANKNIFTY: 10,
  FINNIFTY: 10,
  MIDCPNIFTY: 10,
  STOCKS: 10,
  INDICES: 10,
  MCX: 9,
  COMMODITY: 9,
  CURRENCY: 5,
  BSE: 10,
  OTHER: 10
};

class CircuitBreakerService {

  /** Indian exchange segments only — crypto/forex have no  circuit bands. */
  static instrumentUsesIndianCircuits(instrument, orderContext = {}) {
    if (!instrument) return false;
    if (instrument.isCrypto === true || orderContext.isCrypto) return false;
    if (orderContext.isForex) return false;
    const ex = String(instrument.exchange || orderContext.exchange || '').toUpperCase();
    if (ex === 'BINANCE' || ex === 'FOREX') return false;
    const seg = String(instrument.segment || orderContext.segment || '').toUpperCase();
    if (['CRYPTOFUT', 'CRYPTOOPT', 'FOREX', 'FOREXFUT', 'FOREXOPT'].includes(seg)) return false;
    return true;
  }

  static circuitPercentFor(instrument) {
    return (
      instrument.circuitLimitPercent ||
      CIRCUIT_DEFAULTS[instrument.category] ||
      CIRCUIT_DEFAULTS.OTHER
    );
  }

  static computeCircuitBands(previousClose, circuitPercent, tickSize = 0.05) {
    const close = Number(previousClose) || 0;
    if (close <= 0) return { upperCircuit: 0, lowerCircuit: 0 };
    const pct = Number(circuitPercent) || 10;
    return {
      upperCircuit: this.roundToTickSize(close * (1 + pct / 100), tickSize),
      lowerCircuit: this.roundToTickSize(close * (1 - pct / 100), tickSize),
    };
  }

  /**
   * Stored bands are stale when live price is outside them (wrong close / rolled contract).
   */
  static circuitsAreStale(instrument, referencePrice) {
    const ref = Number(referencePrice) || 0;
    if (ref <= 0) return false;
    const upper = Number(instrument.upperCircuit) || 0;
    const lower = Number(instrument.lowerCircuit) || 0;
    if (upper <= 0 && lower <= 0) return false;
    if (upper > 0 && lower > 0 && lower > upper) return true;
    if (lower > 0 && ref < lower) return true;
    if (upper > 0 && ref > upper) return true;
    return false;
  }

  static resolveOrderReferencePrice(instrument, orderContext = {}, fallbackPrice) {
    const side = String(orderContext.side || '').toUpperCase();
    const bid = Number(orderContext.bidPrice) || 0;
    const ask = Number(orderContext.askPrice) || 0;
    const ltp = Number(instrument?.ltp) || Number(fallbackPrice) || 0;
    const orderType = String(orderContext.orderType || '').toUpperCase();
    if (orderType === 'MARKET') {
      if (side === 'BUY') return ask || ltp || Number(fallbackPrice) || 0;
      if (side === 'SELL') return bid || ltp || Number(fallbackPrice) || 0;
      return ltp || ask || bid || Number(fallbackPrice) || 0;
    }
    return Number(fallbackPrice) || ask || bid || ltp || 0;
  }

  static resolveCircuitBands(instrument, referencePrice) {
    if (!this.instrumentUsesIndianCircuits(instrument)) {
      return { upperCircuit: 0, lowerCircuit: 0, skip: true };
    }
    const ref = Number(referencePrice) || Number(instrument.ltp) || 0;
    const tickSize = instrument.tickSize || 0.05;
    const circuitPercent = this.circuitPercentFor(instrument);

    if (this.circuitsAreStale(instrument, ref)) {
      const anchor =
        ref > 0
          ? ref
          : Number(instrument.previousDayClosePrice) || Number(instrument.close) || 0;
      if (anchor <= 0) return { upperCircuit: 0, lowerCircuit: 0, skip: true, repaired: false };
      const bands = this.computeCircuitBands(anchor, circuitPercent, tickSize);
      return { ...bands, skip: false, repaired: true, anchor };
    }

    return {
      upperCircuit: Number(instrument.upperCircuit) || 0,
      lowerCircuit: Number(instrument.lowerCircuit) || 0,
      skip: false,
      repaired: false,
    };
  }

  static async persistCircuitBands(instrumentId, bands, anchor) {
    await Instrument.updateOne(
      { _id: instrumentId },
      {
        $set: {
          previousDayClosePrice: anchor,
          upperCircuit: bands.upperCircuit,
          lowerCircuit: bands.lowerCircuit,
          upperCircuitHit: false,
          lowerCircuitHit: false,
          allowBuy: true,
          allowSell: true,
        },
      }
    );
  }

  /** Repair stale DB circuits before order validation. */
  static async ensureCircuitsForOrder(instrument, orderContext = {}) {
    if (!instrument || !this.instrumentUsesIndianCircuits(instrument, orderContext)) {
      return instrument;
    }
    const ref = this.resolveOrderReferencePrice(instrument, orderContext, orderContext.price);
    if (!ref || ref <= 0) return instrument;
    if (!this.circuitsAreStale(instrument, ref)) return instrument;

    const bands = this.resolveCircuitBands(instrument, ref);
    if (bands.skip || !bands.repaired) return instrument;

    const anchor = bands.anchor || ref;
    await this.persistCircuitBands(instrument._id, bands, anchor);
    instrument.previousDayClosePrice = anchor;
    instrument.upperCircuit = bands.upperCircuit;
    instrument.lowerCircuit = bands.lowerCircuit;
    instrument.upperCircuitHit = false;
    instrument.lowerCircuitHit = false;
    instrument.allowBuy = true;
    instrument.allowSell = true;
    console.log(
      `[Circuit] Repaired stale bands for ${instrument.symbol}: anchor=${anchor}, ` +
        `lower=${bands.lowerCircuit}, upper=${bands.upperCircuit}`
    );
    return instrument;
  }
  
  /**
   * Initialize with Socket.IO instance
   * @param {Object} socketIO - Socket.IO server instance
   */
  static init(socketIO) {
    io = socketIO;
    console.log('CircuitBreakerService initialized');
  }
  
  /**
   * Daily circuit reset - Run via cron job BEFORE market open (9:00 AM IST)
   * Sets previousDayClosePrice and calculates new circuit limits
   */
  static async dailyCircuitReset() {
    try {
      console.log('CIRCUIT RESET: Starting daily circuit limit reset...');
      
      const instruments = await Instrument.find({ isEnabled: true });
      let updatedCount = 0;
      
      for (const instrument of instruments) {
        if (!this.instrumentUsesIndianCircuits(instrument)) continue;

        // Prefer settled close; fall back to LTP
        const previousClose =
          Number(instrument.close) > 0
            ? Number(instrument.close)
            : Number(instrument.ltp) || 0;
        
        if (previousClose <= 0) {
          console.log(`Skipping ${instrument.symbol}: No valid close price`);
          continue;
        }
        
        const circuitPercent = this.circuitPercentFor(instrument);
        const tickSize = instrument.tickSize || 0.05;
        const { upperCircuit, lowerCircuit } = this.computeCircuitBands(
          previousClose,
          circuitPercent,
          tickSize
        );
        
        // Update instrument
        await Instrument.updateOne(
          { _id: instrument._id },
          {
            $set: {
              previousDayClosePrice: previousClose,
              circuitLimitPercent: circuitPercent,
              upperCircuit: upperCircuit,
              lowerCircuit: lowerCircuit,
              upperCircuitHit: false,
              lowerCircuitHit: false,
              allowBuy: true,
              allowSell: true
            }
          }
        );
        
        updatedCount++;
      }
      
      console.log(`CIRCUIT RESET COMPLETE: Updated ${updatedCount} instruments`);
      return { success: true, updatedCount };
      
    } catch (error) {
      console.error('Error in daily circuit reset:', error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Round price to nearest tick size
   * @param {Number} price - Price to round
   * @param {Number} tickSize - Tick size (e.g., 0.05)
   * @returns {Number} - Rounded price
   */
  static roundToTickSize(price, tickSize) {
    if (tickSize <= 0) return price;
    return Math.round(price / tickSize) * tickSize;
  }
  
  /**
   * Validate price against circuit limits
   * Called on every price tick
   * 
   * @param {Object} instrument - Instrument document
   * @param {Number} newPrice - New market price
   * @returns {Object} - { validatedPrice, circuitHit, circuitType }
   */
  static validatePrice(instrument, newPrice) {
    const bands = this.resolveCircuitBands(instrument, newPrice);
    if (bands.skip) {
      return { validatedPrice: newPrice, circuitHit: false, circuitType: null };
    }

    const upperCircuit = bands.upperCircuit || 0;
    const lowerCircuit = bands.lowerCircuit || 0;
    
    if (upperCircuit === 0 && lowerCircuit === 0) {
      return { validatedPrice: newPrice, circuitHit: false, circuitType: null };
    }
    
    let validatedPrice = newPrice;
    let circuitHit = false;
    let circuitType = null;
    
    if (upperCircuit > 0 && newPrice >= upperCircuit) {
      validatedPrice = upperCircuit;
      circuitHit = true;
      circuitType = 'UPPER';
    } else if (lowerCircuit > 0 && newPrice <= lowerCircuit) {
      validatedPrice = lowerCircuit;
      circuitHit = true;
      circuitType = 'LOWER';
    }
    
    return { validatedPrice, circuitHit, circuitType };
  }
  
  /**
   * Update circuit status for an instrument
   * @param {String} token - Instrument token
   * @param {String} circuitType - 'UPPER' or 'LOWER' or null
   */
  static async updateCircuitStatus(token, circuitType) {
    try {
      const instrument = await Instrument.findOne({ token: token.toString() });
      if (!instrument) return;
      
      if (circuitType === 'UPPER') {
        if (!instrument.upperCircuitHit) {
          await Instrument.updateOne(
            { _id: instrument._id },
            {
              $set: {
                upperCircuitHit: true,
                lowerCircuitHit: false,
                allowBuy: false,
                allowSell: true
              }
            }
          );
          this.notifyCircuitHit(instrument, 'UPPER', instrument.upperCircuit);
        }
      } else if (circuitType === 'LOWER') {
        if (!instrument.lowerCircuitHit) {
          await Instrument.updateOne(
            { _id: instrument._id },
            {
              $set: {
                upperCircuitHit: false,
                lowerCircuitHit: true,
                allowBuy: true,
                allowSell: false
              }
            }
          );
          this.notifyCircuitHit(instrument, 'LOWER', instrument.lowerCircuit);
        }
      } else {
        // Price back within range - reset flags
        if (instrument.upperCircuitHit || instrument.lowerCircuitHit) {
          await Instrument.updateOne(
            { _id: instrument._id },
            {
              $set: {
                upperCircuitHit: false,
                lowerCircuitHit: false,
                allowBuy: true,
                allowSell: true
              }
            }
          );
          this.notifyCircuitCleared(instrument);
        }
      }
    } catch (error) {
      console.error('Error updating circuit status:', error);
    }
  }
  
  /**
   * Notify all users about circuit hit
   * @param {Object} instrument - Instrument document
   * @param {String} type - 'UPPER' or 'LOWER'
   * @param {Number} price - Circuit price
   */
  static notifyCircuitHit(instrument, type, price) {
    console.log(`CIRCUIT HIT: ${instrument.symbol} hit ${type} circuit at ${price}`);
    
    if (io) {
      io.emit('circuit_hit', {
        token: instrument.token,
        symbol: instrument.symbol,
        name: instrument.name,
        type: type,
        price: price,
        allowBuy: type === 'LOWER',
        allowSell: type === 'UPPER',
        timestamp: new Date()
      });
    }
  }
  
  /**
   * Notify circuit cleared
   * @param {Object} instrument - Instrument document
   */
  static notifyCircuitCleared(instrument) {
    console.log(`CIRCUIT CLEARED: ${instrument.symbol} back within range`);
    
    if (io) {
      io.emit('circuit_cleared', {
        token: instrument.token,
        symbol: instrument.symbol,
        allowBuy: true,
        allowSell: true,
        timestamp: new Date()
      });
    }
  }
  
  /**
   * Check if order is allowed based on circuit status
   * @param {Object} instrument - Instrument document
   * @param {String} side - 'BUY' or 'SELL'
   * @returns {Object} - { allowed, reason }
   */
  static checkOrderAllowed(instrument, side) {
    if (!instrument) {
      return { allowed: true, reason: null };
    }
    
    if (side === 'BUY' && !instrument.allowBuy) {
      return {
        allowed: false,
        reason: `${instrument.symbol} is at UPPER CIRCUIT (${instrument.upperCircuit}). Only SELL orders allowed.`
      };
    }
    
    if (side === 'SELL' && !instrument.allowSell) {
      return {
        allowed: false,
        reason: `${instrument.symbol} is at LOWER CIRCUIT (${instrument.lowerCircuit}). Only BUY orders allowed.`
      };
    }
    
    return { allowed: true, reason: null };
  }
  
  /**
   * Check if price is within circuit limits
   * @param {Object} instrument - Instrument document
   * @param {Number} price - Order price
   * @returns {Object} - { valid, reason }
   */
  static checkPriceWithinLimits(instrument, price, orderContext = {}) {
    if (!instrument || !this.instrumentUsesIndianCircuits(instrument, orderContext)) {
      return { valid: true, reason: null };
    }

    const ref = this.resolveOrderReferencePrice(instrument, orderContext, price);
    if (!ref || ref <= 0) {
      return { valid: true, reason: null };
    }

    const bands = this.resolveCircuitBands(instrument, ref);
    if (bands.skip) {
      return { valid: true, reason: null };
    }

    const upperCircuit = bands.upperCircuit || 0;
    const lowerCircuit = bands.lowerCircuit || 0;

    if (upperCircuit <= 0 && lowerCircuit <= 0) {
      return { valid: true, reason: null };
    }
    
    if (upperCircuit > 0 && ref > upperCircuit) {
      return {
        valid: false,
        reason: `Price ${ref} exceeds upper circuit limit ${upperCircuit}`
      };
    }
    
    if (lowerCircuit > 0 && ref < lowerCircuit) {
      return {
        valid: false,
        reason: `Price ${ref} is below lower circuit limit ${lowerCircuit}`
      };
    }
    
    return { valid: true, reason: null };
  }
  
  /**
   * Set circuit percentage for an instrument
   * @param {String} token - Instrument token
   * @param {Number} percent - Circuit percentage (2, 5, 10, 15, 20, 30)
   */
  static async setCircuitPercent(token, percent) {
    const validPercents = [2, 5, 10, 15, 20, 30];
    if (!validPercents.includes(percent)) {
      throw new Error(`Invalid circuit percent. Must be one of: ${validPercents.join(', ')}`);
    }
    
    const instrument = await Instrument.findOne({ token: token.toString() });
    if (!instrument) {
      throw new Error('Instrument not found');
    }
    
    const previousClose =
      Number(instrument.previousDayClosePrice) > 0
        ? Number(instrument.previousDayClosePrice)
        : Number(instrument.close) > 0
          ? Number(instrument.close)
          : Number(instrument.ltp) || 0;
    const tickSize = instrument.tickSize || 0.05;
    const { upperCircuit, lowerCircuit } = this.computeCircuitBands(previousClose, percent, tickSize);
    
    await Instrument.updateOne(
      { _id: instrument._id },
      {
        $set: {
          circuitLimitPercent: percent,
          upperCircuit: upperCircuit,
          lowerCircuit: lowerCircuit
        }
      }
    );
    
    return {
      symbol: instrument.symbol,
      circuitPercent: percent,
      upperCircuit,
      lowerCircuit
    };
  }
  
  /**
   * Get circuit status for an instrument
   * @param {String} token - Instrument token
   * @returns {Object} - Circuit status
   */
  static async getCircuitStatus(token) {
    const instrument = await Instrument.findOne({ token: token.toString() }).lean();
    if (!instrument) {
      return null;
    }
    
    return {
      symbol: instrument.symbol,
      token: instrument.token,
      previousDayClose: instrument.previousDayClosePrice,
      circuitPercent: instrument.circuitLimitPercent,
      upperCircuit: instrument.upperCircuit,
      lowerCircuit: instrument.lowerCircuit,
      upperCircuitHit: instrument.upperCircuitHit,
      lowerCircuitHit: instrument.lowerCircuitHit,
      allowBuy: instrument.allowBuy,
      allowSell: instrument.allowSell,
      currentPrice: instrument.ltp
    };
  }
  
  /**
   * Get all instruments at circuit
   * @returns {Array} - List of instruments at circuit
   */
  static async getInstrumentsAtCircuit() {
    const instruments = await Instrument.find({
      isEnabled: true,
      $or: [
        { upperCircuitHit: true },
        { lowerCircuitHit: true }
      ]
    }).select('symbol token upperCircuit lowerCircuit upperCircuitHit lowerCircuitHit ltp').lean();
    
    return instruments.map(inst => ({
      symbol: inst.symbol,
      token: inst.token,
      circuitType: inst.upperCircuitHit ? 'UPPER' : 'LOWER',
      circuitPrice: inst.upperCircuitHit ? inst.upperCircuit : inst.lowerCircuit,
      currentPrice: inst.ltp
    }));
  }
}

export default CircuitBreakerService;
