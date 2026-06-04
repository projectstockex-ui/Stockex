import User from '../models/User.js';
import Trade from '../models/Trade.js';
import Instrument from '../models/Instrument.js';
import RiskConfig from '../models/RiskConfig.js';
import Notification from '../models/Notification.js';
import WalletService from './walletService.js';
import { setLTPInRedis } from './ltpResolutionService.js';
import CircuitBreakerService from './circuitBreakerService.js';
import { isCryptoSessionActiveForUser } from '../utils/cryptoSessionTiming.js';
import { isMcxSessionActiveForUser } from '../utils/mcxSessionTiming.js';

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
  const trades = await Trade.find({ status: 'OPEN' }).select('token pair symbol').lean();
  const keys = new Set();
  for (const t of trades) {
    for (const k of [t.token, t.pair, t.symbol]) {
      if (k != null && String(k).trim()) keys.add(String(k).trim());
    }
    const pair = String(t.pair || '').trim();
    if (pair.toUpperCase().endsWith('USDT')) {
      keys.add(pair.slice(0, -4));
    }
  }
  _openTokenSet = keys;
  _openTokenSetAt = Date.now();
}

function buildTickMatchKeys(tokenStr, tickData = {}) {
  const keys = new Set();
  if (tokenStr) keys.add(tokenStr);
  for (const k of [tickData.pair, tickData.symbol, tickData.token]) {
    if (k != null && String(k).trim()) keys.add(String(k).trim());
  }
  if (tokenStr.toUpperCase().endsWith('USDT')) {
    keys.add(tokenStr.slice(0, -4));
  }
  return keys;
}

function buildPositionQueryForTick(tokenStr, tickData = {}) {
  const keys = [...buildTickMatchKeys(tokenStr, tickData)];
  const or = [];
  for (const k of keys) {
    or.push({ token: k }, { pair: k }, { symbol: k });
  }
  return { status: 'OPEN', $or: or };
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
      const tickKeys = buildTickMatchKeys(tokenStr, tickData);
      if (![...tickKeys].some((k) => _openTokenSet.has(k))) return;

      const positions = await Trade.find(buildPositionQueryForTick(tokenStr, tickData)).lean();

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
      const walletField = WalletService.getWalletFieldFromTrade(positions[0]);

      // Get segment-specific settings for autosquare/notification (inherit from admin hierarchy)
      const TradeService = (await import('./tradeService.js')).default;
      const segmentSettings = await TradeService.getUserSegmentSettings(user, segment);
      const segmentNotificationPercent = segmentSettings?.lotSettings?.notificationPercent;
      const segmentAutosquarePercent =
        segmentSettings?.lotSettings?.autosquarePercent ??
        segmentSettings?.quantityModeSettings?.autosquarePercent;
      const isUsdSpotWallet = walletField === 'cryptoWallet' || walletField === 'forexWallet';
      const isMcxWallet = walletField === 'mcxWallet';
      const hasBidAsk = Number(tickData?.bid) > 0 || Number(tickData?.ask) > 0;
      const preferBidAsk = (isUsdSpotWallet || isMcxWallet) && hasBidAsk;

      const runLedgerAutosquareOnly = async () => {
        const { checkAndRunLedgerAutosquare } = await import('./ledgerAutosquareService.js');
        return checkAndRunLedgerAutosquare(userId, walletField, {
          preferBidAsk,
          segment,
          autosquarePercent: segmentAutosquarePercent,
        });
      };

      // Crypto: off-session skip live MTM; segment autosquare% (e.g. 70) still runs
      if (walletField === 'cryptoWallet') {
        let sessionUser = user;
        if (!sessionUser.admin?.segmentPermissions) {
          sessionUser = await User.findById(userId)
            .populate('admin', 'segmentPermissions')
            .lean();
        }
        if (sessionUser?.admin?.segmentPermissions) {
          sessionUser.parentSegmentPermissions = sessionUser.admin.segmentPermissions;
        }
        const sessionActive = await isCryptoSessionActiveForUser(sessionUser);
        if (!sessionActive) {
          try {
            await runLedgerAutosquareOnly();
          } catch (ledgerErr) {
            console.error('[MarginMonitor] crypto ledger autosquare (off-session):', ledgerErr.message);
          }
          return;
        }
      }

      // MCX: off-session skip live MTM; segment autosquare% (e.g. 90) still runs
      if (isMcxWallet) {
        let sessionUser = user;
        if (!sessionUser.admin?.segmentPermissions) {
          sessionUser = await User.findById(userId)
            .populate('admin', 'segmentPermissions')
            .lean();
        }
        if (sessionUser?.admin?.segmentPermissions) {
          sessionUser.parentSegmentPermissions = sessionUser.admin.segmentPermissions;
        }
        const sessionActive = await isMcxSessionActiveForUser(sessionUser);
        if (!sessionActive) {
          try {
            const ledgerResult = await runLedgerAutosquareOnly();
            if (ledgerResult?.triggered) {
              console.log(
                `[MarginMonitor] MCX autosquare (off-session) user=${userId} ` +
                  `loss=${ledgerResult.snapshot?.lossPercent}%`
              );
            }
          } catch (ledgerErr) {
            console.error('[MarginMonitor] MCX ledger autosquare (off-session):', ledgerErr.message);
          }
          return;
        }
      }

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
      const walletState = await WalletService.recalculateWallet(userId, segment);
      
      const currentWalletState = walletState[walletField];
      if (!currentWalletState) return;
      
      let marginStatus = { action: 'NONE', status: 'HEALTHY', marginLevel: currentWalletState.marginLevel };

      // Intraday autosquare when equity loss >= segment autosquarePercent (70 / 90 etc.)
      let ledgerTriggered = false;
      if (['nseBseWallet', 'mcxWallet', 'cryptoWallet', 'forexWallet'].includes(walletField)) {
        try {
          const { checkAndRunLedgerAutosquare, computeLedgerRealBalance } = await import(
            './ledgerAutosquareService.js'
          );
          const ledgerResult = await checkAndRunLedgerAutosquare(userId, walletField, {
            preferBidAsk,
            segment,
            autosquarePercent: segmentAutosquarePercent,
          });
          if (ledgerResult?.triggered) {
            ledgerTriggered = true;
            marginStatus = { action: 'STOP_OUT', status: 'CRITICAL', marginLevel: 0 };
            const refreshed = await WalletService.recalculateWallet(userId, segment);
            Object.assign(currentWalletState, refreshed[walletField] || {});
          } else if (!ledgerTriggered) {
            const snapshot = await computeLedgerRealBalance(userId, walletField, {
              preferBidAsk,
              segment,
            });
            const notifyPct = Number(segmentNotificationPercent);
            const cushion = Number(snapshot?.marginCushion) || 0;
            const warnFloor =
              cushion > 0 && Number.isFinite(notifyPct) && notifyPct > 0
                ? cushion * ((100 - notifyPct) / 100)
                : null;
            if (
              snapshot &&
              warnFloor != null &&
              Number(snapshot.availableMargin) <= warnFloor + 0.01
            ) {
              await this.triggerLowMarginWarning(userId, walletField, snapshot, notifyPct);
            } else if (currentWalletState.marginCallActive) {
              await this.handleMarginCallRecovery(userId, walletField, currentWalletState);
            }
          }
        } catch (ledgerErr) {
          console.error('[MarginMonitor] ledger autosquare:', ledgerErr.message);
        }
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
    const { validatedPrice, circuitHit, circuitType } = CircuitBreakerService.validatePrice(
      instrument,
      newPrice
    );

    if (circuitHit && circuitType === 'UPPER' && !instrument.upperCircuitHit) {
      instrument.upperCircuitHit = true;
      instrument.lowerCircuitHit = false;
      instrument.allowBuy = false;
      instrument.allowSell = true;
      instrument.save().catch((err) => console.error('Error saving circuit state:', err));
      this.notifyCircuitHit(instrument, 'UPPER', instrument.upperCircuit);
    } else if (circuitHit && circuitType === 'LOWER' && !instrument.lowerCircuitHit) {
      instrument.upperCircuitHit = false;
      instrument.lowerCircuitHit = true;
      instrument.allowBuy = true;
      instrument.allowSell = false;
      instrument.save().catch((err) => console.error('Error saving circuit state:', err));
      this.notifyCircuitHit(instrument, 'LOWER', instrument.lowerCircuit);
    } else if (!circuitHit && (instrument.upperCircuitHit || instrument.lowerCircuitHit)) {
      instrument.upperCircuitHit = false;
      instrument.lowerCircuitHit = false;
      instrument.allowBuy = true;
      instrument.allowSell = true;
      instrument.save().catch((err) => console.error('Error saving circuit state:', err));
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
   * Warn when available margin is low (notification % of initial cushion before zero).
   */
  static async triggerLowMarginWarning(userId, walletField, snapshot, notificationPercent) {
    try {
      const user = await User.findById(userId);
      if (!user) return;

      const wallet = user[walletField];
      if (wallet?.marginCallActive) return;

      await WalletService.setMarginCallStatus(userId, walletField, true);

      await Notification.create({
        title: 'Low Margin Warning',
        subject: `⚠️ Available margin low (notify at ${notificationPercent}% cushion used)`,
        description:
          `Available margin is ₹${Number(snapshot.availableMargin).toLocaleString('en-IN')}. ` +
          `All positions will be auto-squared when available margin reaches ₹0.`,
        senderType: 'SYSTEM',
        targetType: 'SINGLE_USER',
        targetUserId: userId,
        priority: 'HIGH',
      });

      if (io) {
        io.to(userId).emit('margin_call', {
          walletField,
          availableMargin: snapshot.availableMargin,
          marginCushion: snapshot.marginCushion,
          notificationPercent,
          realBalance: snapshot.realBalance,
          timestamp: new Date(),
        });
      }
    } catch (error) {
      console.error('Error triggering low margin warning:', error);
    }
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
