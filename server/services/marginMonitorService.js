import User from '../models/User.js';
import Trade from '../models/Trade.js';
import Instrument from '../models/Instrument.js';
import RiskConfig from '../models/RiskConfig.js';
import Notification from '../models/Notification.js';
import WalletService from './walletService.js';
import { setLTPInRedis } from './ltpResolutionService.js';

/** Invalidate after open/close trade so margin logic resumes immediately */
export function invalidateMarginOpenTradesCache() {
  _anyOpenCachedAt = 0;
  _openTokenSetAt = 0;
}

// --- Zerodha tick flood protection (was starving Mongo + HTTP API) ---
const ANY_OPEN_TTL_MS = 2500;
const TOKEN_SET_TTL_MS = 4000;
let _anyOpenCached = false;
let _anyOpenCachedAt = 0;
let _openTokenSet = new Set();
let _openTokenSetAt = 0;
let _distinctRefreshPromise = null;

async function refreshOpenTokenSet() {
  const tokens = await Trade.distinct('token', { status: 'OPEN' });
  _openTokenSet = new Set(tokens.map((t) => String(t)));
  _openTokenSetAt = Date.now();
}

async function ensureOpenTokenSetFresh() {
  if (Date.now() - _openTokenSetAt < TOKEN_SET_TTL_MS) return;
  if (_distinctRefreshPromise) return _distinctRefreshPromise;
  _distinctRefreshPromise = refreshOpenTokenSet().finally(() => {
    _distinctRefreshPromise = null;
  });
  return _distinctRefreshPromise;
}

/**
 * TradePro Trading Engine - Margin Monitor Service
 * 
 * This is the HEARTBEAT of the trading system.
 * Runs on every price tick to:
 * 1. Update position PnL
 * 2. Recalculate wallet equity/margin
 * 3. Check for margin call conditions
 * 4. Trigger stop-out if needed
 * 5. Push updates to UI via WebSocket
 */

let io = null; // Socket.IO instance

class MarginMonitorService {
  
  /**
   * Initialize with Socket.IO instance
   * @param {Object} socketIO - Socket.IO server instance
   */
  static init(socketIO) {
    io = socketIO;
    console.log('MarginMonitorService initialized');
  }
  
  /**
   * Main price tick handler - THE HEARTBEAT
   * Called on every price update from WebSocket feed
   * 
   * @param {String} token - Instrument token
   * @param {Number} newPrice - New market price
   * @param {Object} tickData - Full tick data (optional)
   */
  static async onPriceTick(token, newPrice, tickData = {}) {
    try {
      const tokenStr = token != null ? String(token) : '';
      const now = Date.now();

      if (now - _anyOpenCachedAt > ANY_OPEN_TTL_MS) {
        _anyOpenCached = !!(await Trade.exists({ status: 'OPEN' }));
        _anyOpenCachedAt = now;
      }
      if (!_anyOpenCached) return;

      await ensureOpenTokenSetFresh();
      if (!_openTokenSet.has(tokenStr)) return;

      const positions = await Trade.find({
        token: tokenStr,
        status: 'OPEN',
      }).lean();

      if (positions.length === 0) return;

      const instrument = await Instrument.findOne({ token: tokenStr });
      let price = newPrice;
      if (instrument) {
        price = this.validateCircuitLimits(instrument, newPrice);
      }

      if (tokenStr && Number(price) > 0) {
        void setLTPInRedis(tokenStr, price);
      }

      const userPositions = new Map();
      for (const pos of positions) {
        const userId = pos.user.toString();
        if (!userPositions.has(userId)) {
          userPositions.set(userId, []);
        }
        userPositions.get(userId).push(pos);
      }

      for (const [userId, userPos] of userPositions) {
        await this.processUserPositions(userId, userPos, price, tickData);
      }
    } catch (error) {
      console.error('MarginMonitorService.onPriceTick error:', error);
    }
  }
  
  /**
   * Process positions for a single user
   * @param {String} userId - User ID
   * @param {Array} positions - User's open positions for this token
   * @param {Number} newPrice - New market price
   * @param {Object} tickData - Full tick data
   */
  static async processUserPositions(userId, positions, newPrice, tickData) {
    try {
      const user = await User.findById(userId);
      if (!user) return;
      
      // Get segment from first position
      const segment = positions[0].segment;
      const segUpper = String(segment || '').toUpperCase();
      
      // Get segment-specific settings for autosquare/notification (inherit from admin hierarchy)
      // Use TradeService.getUserSegmentSettings to get merged settings with inheritance
      const TradeService = (await import('./tradeService.js')).default;
      const segmentSettings = await TradeService.getUserSegmentSettings(user, segment);
      const segmentAutosquarePercent = segmentSettings?.lotSettings?.autosquarePercent;
      const segmentNotificationPercent = segmentSettings?.lotSettings?.notificationPercent;
      
      console.log(`[MarginMonitor] Segment: ${segUpper}, Autosquare: ${segmentAutosquarePercent}%, Notification: ${segmentNotificationPercent}%`);
      
      // Build risk config with segment-specific settings only if set (no hardcoded fallbacks)
      const riskConfig = {
        STOP_OUT_LEVEL: segmentAutosquarePercent != null && segmentAutosquarePercent > 0 ? segmentAutosquarePercent : null,
        MARGIN_CALL_LEVEL: segmentNotificationPercent != null && segmentNotificationPercent > 0 ? segmentNotificationPercent : null,
        HEALTHY_LEVEL: null
      };
      
      // 4a. Update PnL for each position
      const bulkOps = [];
      for (const pos of positions) {
        const unrealizedPnL = WalletService.calculatePositionPnL(pos, newPrice);
        
        bulkOps.push({
          updateOne: {
            filter: { _id: pos._id },
            update: {
              $set: {
                currentPrice: newPrice,
                unrealizedPnL: Math.round(unrealizedPnL * 100) / 100
              }
            }
          }
        });
      }
      
      if (bulkOps.length > 0) {
        await Trade.bulkWrite(bulkOps);
      }
      
      // 4b. Recalculate wallet for this user
      const walletField = WalletService.getWalletFieldFromTrade(positions[0]);
      const walletState = await WalletService.recalculateWallet(userId, segment);
      
      const currentWalletState = walletState[walletField];
      if (!currentWalletState) return;
      
      // 4c. Check margin status with segment-specific settings (only if set)
      const marginStatus = WalletService.checkMarginStatus(currentWalletState, riskConfig);
      
      // 4d. Handle STOP-OUT (most critical - check first)
      if (marginStatus.action === 'STOP_OUT') {
        console.log(`STOP-OUT triggered for user ${user.userId}. Margin Level: ${marginStatus.marginLevel}%`);
        await this.triggerStopOut(userId, walletField, currentWalletState, riskConfig);
      }
      // 4e. Handle MARGIN CALL
      else if (marginStatus.action === 'MARGIN_CALL') {
        await this.triggerMarginCall(userId, walletField, currentWalletState, riskConfig);
      }
      // 4f. Check for recovery from margin call
      else if (currentWalletState.marginCallActive && marginStatus.action === 'NONE') {
        await this.handleMarginCallRecovery(userId, walletField, currentWalletState);
      }
      
      // 4g. Push wallet update to UI via WebSocket
      this.pushWalletUpdate(userId, walletField, currentWalletState, marginStatus);
      
    } catch (error) {
      console.error(`Error processing user ${userId} positions:`, error);
    }
  }
  
  /**
   * Validate price against circuit limits
   * @param {Object} instrument - Instrument document
   * @param {Number} newPrice - New price
   * @returns {Number} - Validated price (capped at circuit limits)
   */
  static validateCircuitLimits(instrument, newPrice) {
    const upperCircuit = instrument.upperCircuit || 0;
    const lowerCircuit = instrument.lowerCircuit || 0;
    
    // Skip if circuits not set
    if (upperCircuit === 0 && lowerCircuit === 0) {
      return newPrice;
    }
    
    let validatedPrice = newPrice;
    let circuitHit = false;
    let circuitType = null;
    
    if (upperCircuit > 0 && newPrice >= upperCircuit) {
      validatedPrice = upperCircuit;
      circuitHit = true;
      circuitType = 'UPPER';
      
      if (!instrument.upperCircuitHit) {
        // First time hitting upper circuit
        instrument.upperCircuitHit = true;
        instrument.allowBuy = false;
        instrument.allowSell = true;
        instrument.save().catch(err => console.error('Error saving circuit state:', err));
        
        this.notifyCircuitHit(instrument, 'UPPER', upperCircuit);
      }
    } else if (lowerCircuit > 0 && newPrice <= lowerCircuit) {
      validatedPrice = lowerCircuit;
      circuitHit = true;
      circuitType = 'LOWER';
      
      if (!instrument.lowerCircuitHit) {
        // First time hitting lower circuit
        instrument.lowerCircuitHit = true;
        instrument.allowBuy = true;
        instrument.allowSell = false;
        instrument.save().catch(err => console.error('Error saving circuit state:', err));
        
        this.notifyCircuitHit(instrument, 'LOWER', lowerCircuit);
      }
    } else {
      // Price back within range - reset circuit flags
      if (instrument.upperCircuitHit || instrument.lowerCircuitHit) {
        instrument.upperCircuitHit = false;
        instrument.lowerCircuitHit = false;
        instrument.allowBuy = true;
        instrument.allowSell = true;
        instrument.save().catch(err => console.error('Error saving circuit state:', err));
      }
    }
    
    return validatedPrice;
  }
  
  /**
   * Notify all users about circuit hit
   * @param {Object} instrument - Instrument document
   * @param {String} type - 'UPPER' or 'LOWER'
   * @param {Number} price - Circuit price
   */
  static notifyCircuitHit(instrument, type, price) {
    if (io) {
      io.emit('circuit_hit', {
        token: instrument.token,
        symbol: instrument.symbol,
        type: type,
        price: price,
        allowBuy: type === 'LOWER',
        allowSell: type === 'UPPER',
        timestamp: new Date()
      });
    }
    
    console.log(`CIRCUIT HIT: ${instrument.symbol} hit ${type} circuit at ₹${price}`);
  }
  
  /**
   * Trigger margin call for user
   * @param {String} userId - User ID
   * @param {String} walletField - Wallet field name
   * @param {Object} walletState - Current wallet state
   * @param {Object} riskConfig - Risk configuration
   */
  static async triggerMarginCall(userId, walletField, walletState, riskConfig) {
    try {
      const user = await User.findById(userId);
      if (!user) return;
      
      // Check if margin call already active
      const wallet = user[walletField];
      if (wallet?.marginCallActive) return;
      
      // Set margin call active
      await WalletService.setMarginCallStatus(userId, walletField, true);
      
      // Create notification
      await Notification.create({
        title: 'Margin Call Warning',
        subject: `⚠️ Margin Level Critical - ${walletState.marginLevel?.toFixed(1)}%`,
        description: `Your margin level has dropped to ${walletState.marginLevel?.toFixed(1)}%. ` +
          `Stop-out will trigger at ${riskConfig.STOP_OUT_LEVEL}%. ` +
          `Please add funds or close some positions to avoid automatic liquidation.`,
        senderType: 'SYSTEM',
        targetType: 'SINGLE_USER',
        targetUserId: userId,
        priority: 'HIGH'
      });
      
      // Push to UI
      if (io) {
        io.to(userId).emit('margin_call', {
          walletField,
          marginLevel: walletState.marginLevel,
          stopOutLevel: riskConfig.STOP_OUT_LEVEL,
          equity: walletState.equity,
          usedMargin: walletState.usedMargin,
          freeMargin: walletState.freeMargin,
          timestamp: new Date()
        });
      }
      
      console.log(`MARGIN CALL: User ${user.userId} - Margin Level: ${walletState.marginLevel?.toFixed(1)}%`);
      
    } catch (error) {
      console.error('Error triggering margin call:', error);
    }
  }
  
  /**
   * Trigger stop-out (auto square-off)
   * @param {String} userId - User ID
   * @param {String} walletField - Wallet field name
   * @param {Object} walletState - Current wallet state
   * @param {Object} riskConfig - Risk configuration
   */
  static async triggerStopOut(userId, walletField, walletState, riskConfig) {
    // Import StopOutService dynamically to avoid circular dependency
    const StopOutService = (await import('./stopOutService.js')).default;
    await StopOutService.executeStopOut(userId, walletField, walletState, riskConfig);
  }
  
  /**
   * Handle recovery from margin call
   * @param {String} userId - User ID
   * @param {String} walletField - Wallet field name
   * @param {Object} walletState - Current wallet state
   */
  static async handleMarginCallRecovery(userId, walletField, walletState) {
    try {
      // Clear margin call status
      await WalletService.setMarginCallStatus(userId, walletField, false);
      
      // Create recovery notification
      await Notification.create({
        title: 'Margin Call Cleared',
        subject: `✅ Margin Level Recovered - ${walletState.marginLevel?.toFixed(1)}%`,
        description: `Your margin level has recovered to ${walletState.marginLevel?.toFixed(1)}%. ` +
          `The margin call warning has been cleared.`,
        senderType: 'SYSTEM',
        targetType: 'SINGLE_USER',
        targetUserId: userId
      });
      
      // Push to UI
      if (io) {
        io.to(userId).emit('margin_call_cleared', {
          walletField,
          marginLevel: walletState.marginLevel,
          timestamp: new Date()
        });
      }
      
      console.log(`MARGIN CALL CLEARED: User recovered - Margin Level: ${walletState.marginLevel?.toFixed(1)}%`);
      
    } catch (error) {
      console.error('Error handling margin call recovery:', error);
    }
  }
  
  /**
   * Push wallet update to user via WebSocket
   * @param {String} userId - User ID
   * @param {String} walletField - Wallet field name
   * @param {Object} walletState - Current wallet state
   * @param {Object} marginStatus - Margin status object
   */
  static pushWalletUpdate(userId, walletField, walletState, marginStatus) {
    if (!io) return;
    
    io.to(userId).emit('wallet_update', {
      walletField,
      balance: walletState.balance,
      equity: walletState.equity,
      usedMargin: walletState.usedMargin,
      freeMargin: walletState.freeMargin,
      marginLevel: walletState.marginLevel,
      totalUnrealizedPnL: walletState.totalUnrealizedPnL,
      marginStatus: marginStatus.status,
      marginCallActive: marginStatus.action === 'MARGIN_CALL',
      timestamp: new Date()
    });
  }
  
  /**
   * Batch process multiple price ticks
   * More efficient for high-frequency updates
   * 
   * @param {Object} ticks - Map of token -> price
   */
  static async processBatchTicks(ticks) {
    const tokenList = Object.keys(ticks);
    if (tokenList.length === 0) return;
    
    // Find all open positions for these tokens
    const positions = await Trade.find({
      token: { $in: tokenList },
      status: 'OPEN'
    }).lean();
    
    if (positions.length === 0) return;
    
    // Group by user and token
    const userTokenPositions = new Map();
    
    for (const pos of positions) {
      const userId = pos.user.toString();
      const token = pos.token;
      const key = `${userId}:${token}`;
      
      if (!userTokenPositions.has(key)) {
        userTokenPositions.set(key, {
          userId,
          token,
          positions: [],
          newPrice: ticks[token]
        });
      }
      userTokenPositions.get(key).positions.push(pos);
    }
    
    // Process each user-token group
    for (const [key, data] of userTokenPositions) {
      await this.processUserPositions(data.userId, data.positions, data.newPrice, {});
    }
  }
  
  /**
   * Check daily loss limit for a user
   * @param {String} userId - User ID
   * @param {String} walletField - Wallet field name
   * @returns {Boolean} - True if limit exceeded
   */
  static async checkDailyLossLimit(userId, walletField) {
    try {
      const user = await User.findById(userId);
      if (!user) return false;
      
      const riskConfig = await RiskConfig.getConfig(user.adminCode);
      const maxLossPerDay = riskConfig.maxLossPerDay || 100000;
      
      const wallet = user[walletField];
      const todayRealizedPnL = wallet?.todayRealizedPnL || 0;
      const totalUnrealizedPnL = wallet?.totalUnrealizedPnL || 0;
      
      const totalDayLoss = todayRealizedPnL + totalUnrealizedPnL;
      
      if (totalDayLoss <= -maxLossPerDay) {
        console.log(`DAILY LOSS LIMIT: User ${user.userId} exceeded limit. Loss: ₹${Math.abs(totalDayLoss)}`);
        return true;
      }
      
      return false;
      
    } catch (error) {
      console.error('Error checking daily loss limit:', error);
      return false;
    }
  }
}

export default MarginMonitorService;
