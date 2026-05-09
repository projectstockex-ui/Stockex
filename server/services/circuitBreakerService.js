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
        // Use last traded price as previous day close
        const previousClose = instrument.ltp || instrument.close || 0;
        
        if (previousClose <= 0) {
          console.log(`Skipping ${instrument.symbol}: No valid close price`);
          continue;
        }
        
        // Get circuit percentage (from instrument or category default)
        const circuitPercent = instrument.circuitLimitPercent || 
          CIRCUIT_DEFAULTS[instrument.category] || 
          CIRCUIT_DEFAULTS.OTHER;
        
        // Calculate circuit limits
        const tickSize = instrument.tickSize || 0.05;
        const upperCircuit = this.roundToTickSize(
          previousClose * (1 + circuitPercent / 100),
          tickSize
        );
        const lowerCircuit = this.roundToTickSize(
          previousClose * (1 - circuitPercent / 100),
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
    const upperCircuit = instrument.upperCircuit || 0;
    const lowerCircuit = instrument.lowerCircuit || 0;
    
    // Skip if circuits not set
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
    console.log(`CIRCUIT HIT: ${instrument.symbol} hit ${type} circuit at ₹${price}`);
    
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
        reason: `${instrument.symbol} is at UPPER CIRCUIT (₹${instrument.upperCircuit}). Only SELL orders allowed.`
      };
    }
    
    if (side === 'SELL' && !instrument.allowSell) {
      return {
        allowed: false,
        reason: `${instrument.symbol} is at LOWER CIRCUIT (₹${instrument.lowerCircuit}). Only BUY orders allowed.`
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
  static checkPriceWithinLimits(instrument, price) {
    if (!instrument || !price) {
      return { valid: true, reason: null };
    }
    
    const upperCircuit = instrument.upperCircuit || 0;
    const lowerCircuit = instrument.lowerCircuit || 0;
    
    if (upperCircuit > 0 && price > upperCircuit) {
      return {
        valid: false,
        reason: `Price ₹${price} exceeds upper circuit limit ₹${upperCircuit}`
      };
    }
    
    if (lowerCircuit > 0 && price < lowerCircuit) {
      return {
        valid: false,
        reason: `Price ₹${price} is below lower circuit limit ₹${lowerCircuit}`
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
    
    const previousClose = instrument.previousDayClosePrice || instrument.ltp || instrument.close || 0;
    const tickSize = instrument.tickSize || 0.05;
    
    const upperCircuit = this.roundToTickSize(
      previousClose * (1 + percent / 100),
      tickSize
    );
    const lowerCircuit = this.roundToTickSize(
      previousClose * (1 - percent / 100),
      tickSize
    );
    
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
