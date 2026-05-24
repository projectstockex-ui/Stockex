import cron from 'node-cron';
import StopOutService from '../services/stopOutService.js';
import CircuitBreakerService from '../services/circuitBreakerService.js';
import WalletService from '../services/walletService.js';
import User from '../models/User.js';
import Trade from '../models/Trade.js';
import SystemSettings from '../models/SystemSettings.js';
import { getLTPMapForTrades, cacheKeyForTrade } from '../services/ltpResolutionService.js';
import TradingService from '../services/tradingService.js';
import { getCryptoData } from '../services/binanceWebSocket.js';
import { recalculateUsedMargin } from '../utils/recalculateUsedMargin.js';

/**
 * TradePro Trading Engine - EOD Settlement Cron Jobs
 * 
 * Scheduled tasks for:
 * 1. Daily circuit reset (before market open)
 * 2. Dynamic market close auto-square (based on backend settings)
 * 3. Daily counter reset (after market close)
 * 4. NRML margin recalculation (after market close)
 */

class EODSettlement {
  
  // Store scheduled tasks to allow dynamic updates
  static scheduledTasks = new Map();

  /**
   * Parse HH:MM(:SS) string into today's IST Date
   */
  static parseCloseTimeToDate(closeTime) {
    if (!closeTime) return new Date();
    const parts = String(closeTime).split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseInt(parts[2] || '0', 10);
    if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) return new Date();

    // Build date in IST timezone
    const now = new Date();
    const istString = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    const istDate = new Date(istString);
    istDate.setHours(hours, minutes, seconds, 0);

    // Convert IST date back to UTC timestamp
    const offset = now.getTime() - new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getTime();
    return new Date(istDate.getTime() + offset);
  }

  /** Resolve segment permission keys for autosquare settings lookup */
  static segmentPermissionKeysForTrade(trade, segmentGroup) {
    if (segmentGroup === 'CRYPTO' || trade.isCrypto || trade.exchange === 'BINANCE') {
      return ['CRYPTOFUT', 'CRYPTOOPT', 'CRYPTO'];
    }
    if (segmentGroup === 'FOREX' || trade.isForex || trade.exchange === 'FOREX') {
      return ['FOREXFUT', 'FOREXOPT', 'FOREX'];
    }
    if (segmentGroup === 'MCX' || trade.exchange === 'MCX') {
      return ['MCXFUT', 'MCXOPT', 'MCX'];
    }
    const seg = String(trade.segment || '').toUpperCase();
    if (seg) return [seg];
    return [];
  }

  static getAutosquareSettingsForTrade(admin, trade, segmentGroup) {
    let autosquarePercent = 90;
    let carryForwardLeverage = 50;
    const segPerms = admin?.segmentPermissions instanceof Map
      ? Object.fromEntries(admin.segmentPermissions)
      : admin?.segmentPermissions || {};

    const keys = EODSettlement.segmentPermissionKeysForTrade(trade, segmentGroup);
    for (const key of keys) {
      const segSettings = segPerms[key];
      if (!segSettings) continue;
      const lot = segSettings.lotSettings || {};
      const qty = segSettings.quantityModeSettings || {};
      if (lot.autosquarePercent != null) autosquarePercent = Number(lot.autosquarePercent);
      else if (qty.autosquarePercent != null) autosquarePercent = Number(qty.autosquarePercent);
      if (lot.carryForwardLeverage > 0) carryForwardLeverage = Number(lot.carryForwardLeverage);
      else if (qty.carryForwardLeverage > 0) carryForwardLeverage = Number(qty.carryForwardLeverage);
      else if (segSettings.exposureCarryForward > 0) {
        carryForwardLeverage = Number(segSettings.exposureCarryForward);
      }
      break;
    }
    return {
      autosquarePercent: Number.isFinite(autosquarePercent) ? autosquarePercent : 90,
      carryForwardLeverage: Number.isFinite(carryForwardLeverage) && carryForwardLeverage > 0
        ? carryForwardLeverage
        : 50,
    };
  }

  /** Closing time for one segment key: admin setting first, then system default */
  static getSegmentCloseTime(admin, segKey, sysSegDefaults = {}) {
    const segPerms = admin?.segmentPermissions instanceof Map
      ? Object.fromEntries(admin.segmentPermissions)
      : admin?.segmentPermissions || {};
    const segSettings = segPerms[segKey] || {};
    let closeTime = String(segSettings.cryptoClosingTime || segSettings.closingTime || '').trim();
    if (!closeTime) {
      const sysSeg = sysSegDefaults[segKey] || {};
      closeTime = String(sysSeg.cryptoClosingTime || sysSeg.closingTime || '').trim();
    }
    return closeTime;
  }

  /** Crypto end time for an admin hierarchy (Ram 23:15, Radga 22:30, etc.) */
  static getCryptoClosingTimeForAdmin(admin, sysSegDefaults = {}) {
    for (const key of ['CRYPTOFUT', 'CRYPTOOPT', 'CRYPTO']) {
      const t = EODSettlement.getSegmentCloseTime(admin, key, sysSegDefaults);
      if (t) return t;
    }
    return '';
  }

  static isPastClosingTimeIST(closeTime) {
    const timeParts = String(closeTime).split(':').map(Number);
    const hours = timeParts[0];
    const minutes = timeParts[1];
    const seconds = timeParts[2] || 0;
    if (isNaN(hours) || isNaN(minutes)) return false;

    const now = new Date();
    const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const currentHours = istTime.getHours();
    const currentMinutes = istTime.getMinutes();
    const currentSeconds = istTime.getSeconds();

    return (
      currentHours > hours ||
      (currentHours === hours && currentMinutes > minutes) ||
      (currentHours === hours && currentMinutes === minutes && currentSeconds >= seconds)
    );
  }

  /** Wallet field paths for segment-group autosquare (balance + usedMargin) */
  static walletFieldsForSegmentGroup(segmentGroup) {
    if (segmentGroup === 'CRYPTO') {
      return { balancePath: 'cryptoWallet.balance', usedMarginPath: 'cryptoWallet.usedMargin' };
    }
    if (segmentGroup === 'FOREX') {
      return { balancePath: 'forexWallet.balance', usedMarginPath: 'forexWallet.usedMargin' };
    }
    if (segmentGroup === 'MCX') {
      return { balancePath: 'mcxWallet.balance', usedMarginPath: 'mcxWallet.usedMargin' };
    }
    return { balancePath: 'wallet.tradingBalance', usedMarginPath: 'wallet.usedMargin' };
  }

  /**
   * Carry-forward qty for next session:
   * nextDayQty = floor((walletBalance + positionPnL) × carryForwardLeverage / endLtp)
   */
  static async applyCarryForwardAutosquare(trade, { ltp, closeTime, segmentGroup, admin }) {
    const { carryForwardLeverage } = EODSettlement.getAutosquareSettingsForTrade(
      admin,
      trade,
      segmentGroup
    );
    const { balancePath, usedMarginPath } = EODSettlement.walletFieldsForSegmentGroup(segmentGroup);

    const user = await User.findOne({ userId: trade.userId })
      .select(`${balancePath.split('.')[0]} wallet.tradingBalance wallet.usedMargin`)
      .lean();
    if (!user) throw new Error(`User ${trade.userId} not found`);

    const walletRoot = balancePath.split('.')[0];
    const initialBalance = Number(user[walletRoot]?.balance) || 0;
    const originalQty = trade.originalQty || trade.quantity || trade.lots || 1;
    const entryLtp = Number(trade.entryPrice) || 0;
    const multiplier = trade.side === 'BUY' ? 1 : -1;
    const pnl = (Number(ltp) - entryLtp) * originalQty * multiplier;
    const netBalance = Math.max(0, initialBalance + pnl);
    const nextDayQty = Math.max(
      0,
      Math.floor((netBalance * carryForwardLeverage) / Number(ltp))
    );
    const carryForwardQty = nextDayQty;
    const prevMargin = Number(trade.marginUsed) || Number(trade.requiredMargin) || 0;
    const nextMargin =
      originalQty > 0 && prevMargin > 0
        ? Math.round((prevMargin * nextDayQty) / originalQty * 100) / 100
        : Math.round(((nextDayQty * Number(ltp)) / carryForwardLeverage) * 100) / 100;

    await User.updateOne({ userId: trade.userId }, { $set: { [balancePath]: netBalance } });

    await Trade.findByIdAndUpdate(trade._id, {
      isAutoSquared: true,
      autoSquaredAt: EODSettlement.parseCloseTimeToDate(closeTime),
      autoSquareLtp: ltp,
      originalQty,
      pnlAtAutoSquare: pnl,
      carryForwardQty: nextDayQty,
      netBalanceAtAutoSquare: netBalance,
      quantity: nextDayQty,
      productType: 'NRML',
      leverage: carryForwardLeverage,
      marginUsed: nextMargin,
      requiredMargin: nextMargin,
    });

    const userDoc = await User.findOne({ userId: trade.userId }).select('_id').lean();
    if (userDoc?._id) {
      try {
        await recalculateUsedMargin(userDoc._id);
      } catch (err) {
        console.warn(`[Auto-square] usedMargin recalc failed for ${trade.userId}:`, err.message);
      }
    }

    return { originalQty, nextDayQty, carryForwardQty: nextDayQty, pnl, netBalance, carryForwardLeverage };
  }
  
  /**
   * Initialize all cron jobs
   */
  static init() {
    console.log('EODSettlement: Initializing cron jobs...');
    
    // ==================== DAILY CIRCUIT RESET ====================
    // Run at 9:00 AM IST (before NSE/BSE market open at 9:15 AM)
    cron.schedule('0 9 * * 1-5', async () => {
      console.log('CRON: Daily circuit reset starting...');
      try {
        const result = await CircuitBreakerService.dailyCircuitReset();
        console.log(`CRON: Circuit reset complete. Updated ${result.updatedCount} instruments`);
      } catch (error) {
        console.error('CRON: Circuit reset error:', error);
      }
    }, {
      timezone: 'Asia/Kolkata'
    });
    
    // ==================== DYNAMIC MARKET CLOSE AUTO-SQUARE ====================
    // Initialize dynamic scheduler for all segments
    this.initDynamicAutoSquareScheduler();
    
    // ==================== DAILY COUNTER RESET ====================
    // Run at 12:00 AM IST (midnight) - reset daily P&L counters
    cron.schedule('0 0 * * *', async () => {
      console.log('CRON: Daily counter reset starting...');
      try {
        await WalletService.resetDailyCounters();
        
        // Also reset trading blocked status for users
        await User.updateMany(
          { tradingBlockedUntil: { $lte: new Date() } },
          { 
            $unset: { tradingBlockedUntil: 1 },
            $set: { tradingStatus: 'ACTIVE' }
          }
        );
        
        console.log('CRON: Daily counter reset complete');
      } catch (error) {
        console.error('CRON: Daily counter reset error:', error);
      }
    }, {
      timezone: 'Asia/Kolkata'
    });
    
    // ==================== NRML MARGIN RECALCULATION ====================
    // Run at 4:00 PM IST (after NSE/BSE close)
    // Recalculate margin for carry-forward positions
    cron.schedule('0 16 * * 1-5', async () => {
      console.log('CRON: NRML margin recalculation starting...');
      try {
        await this.recalculateNRMLMargins();
        console.log('CRON: NRML margin recalculation complete');
      } catch (error) {
        console.error('CRON: NRML margin recalculation error:', error);
      }
    }, {
      timezone: 'Asia/Kolkata'
    });
    
    // ==================== MCX NRML MARGIN RECALCULATION ====================
    // Run at 11:45 PM IST (after MCX close)
    cron.schedule('45 23 * * 1-5', async () => {
      console.log('CRON: MCX NRML margin recalculation starting...');
      try {
        await this.recalculateNRMLMargins('MCX');
        console.log('CRON: MCX NRML margin recalculation complete');
      } catch (error) {
        console.error('CRON: MCX NRML margin recalculation error:', error);
      }
    }, {
      timezone: 'Asia/Kolkata'
    });
    
    console.log('EODSettlement: All cron jobs initialized');
  }
  
  /**
   * Initialize dynamic auto-square scheduler based on live data stop detection
   * Auto-square triggers when market closes (live data stops) - no hardcoded times
   */
  static initDynamicAutoSquareScheduler() {
    console.log('EODSettlement: Initializing dynamic auto-square scheduler...');
    
    // Monitor for live data stop and trigger auto-square
    // This runs every minute to check if live data has stopped for each segment
    const checkLiveDataStop = async () => {
      await this.checkAndTriggerAutoSquare();
    };
    
    // Run immediately and then every minute
    checkLiveDataStop();
    setInterval(checkLiveDataStop, 60 * 1000);
    
    // NOTE: Balance-based autosquare removed — it fired immediately after trade open
    // (free balance < 90% of balance+margin) and stamped wrong time (10:22 pm).
    // Intraday 90% stop-out is handled by MarginMonitorService (margin level).
    // EOD carry-forward runs only at each admin's cryptoClosingTime below.

    console.log('EODSettlement: Dynamic auto-square scheduler initialized (checks every minute at admin segment close times)');
  }
  
  /**
   * Check if live data has stopped for each segment and trigger auto-square
   */
  static async checkAndTriggerAutoSquare() {
    try {
      const Admin = (await import('../models/Admin.js')).default;
      const SystemSettings = (await import('../models/SystemSettings.js')).default;
      
      // Get system defaults for fallback
      const sys = await SystemSettings.getSettings();
      const sysSegDefaults = sys.adminSegmentDefaults instanceof Map
        ? Object.fromEntries(sys.adminSegmentDefaults)
        : sys.adminSegmentDefaults || {};
      
      // Get all admins with segmentPermissions that have closing times
      const admins = await Admin.find({ segmentPermissions: { $exists: true, $ne: null } }).lean();
      
      for (const admin of admins) {
        const segPerms = admin.segmentPermissions instanceof Map 
          ? Object.fromEntries(admin.segmentPermissions) 
          : admin.segmentPermissions || {};
        
        // Check each segment for closing time
        const segmentsToCheck = ['NSEFUT', 'NSEOPT', 'NSE-EQ', 'BSE-FUT', 'BSE-OPT', 'MCXFUT', 'MCXOPT', 'CRYPTOFUT', 'CRYPTOOPT', 'FOREXFUT', 'FOREXOPT'];
        
        for (const segKey of segmentsToCheck) {
          let closeTime = EODSettlement.getSegmentCloseTime(admin, segKey, sysSegDefaults);

          // Hardcoded fallbacks only when neither admin nor system has a close time
          if (!closeTime) {
            if (segKey.startsWith('NSE') || segKey.startsWith('BSE')) {
              closeTime = '15:30:00';
            } else if (segKey.startsWith('MCX')) {
              closeTime = '23:30:00';
            } else if (segKey.startsWith('FOREX')) {
              closeTime = '23:59:00';
            }
          }

          if (closeTime && EODSettlement.isPastClosingTimeIST(closeTime)) {
            let segmentGroup;
            if (segKey.startsWith('NSE')) segmentGroup = 'NSE';
            else if (segKey.startsWith('BSE')) segmentGroup = 'BSE';
            else if (segKey.startsWith('MCX')) segmentGroup = 'MCX';
            else if (segKey.startsWith('CRYPTO')) segmentGroup = 'CRYPTO';
            else if (segKey.startsWith('FOREX')) segmentGroup = 'FOREX';

            if (segmentGroup) {
              console.log(
                `Auto-square: Triggering for admin ${admin.adminCode || admin._id} ` +
                  `segment ${segmentGroup} (close ${closeTime} IST)`
              );
              try {
                await this.executeAdminHierarchyAutoSquare(admin._id, segmentGroup, closeTime);
              } catch (error) {
                console.error(`Auto-square: Failed for admin ${admin._id} segment ${segmentGroup}:`, error);
              }
            }
          }
        }
      }
      
    } catch (error) {
      console.error('Error checking live data stop:', error);
    }
  }
  
  /**
   * Execute auto-square for a specific admin hierarchy
   */
  static async executeAdminHierarchyAutoSquare(adminId, segment, closeTime = null) {
    try {
      console.log(`Auto-square: Starting for admin ${adminId} segment ${segment}`);
      
      const Admin = (await import('../models/Admin.js')).default;
      const SystemSettings = (await import('../models/SystemSettings.js')).default;
      
      // Build segment query
      let segmentQuery = {};
      if (segment === 'MCX') {
        segmentQuery = {
          $or: [
            { exchange: 'MCX' },
            { segment: 'MCX' },
            { segment: 'MCXFUT' },
            { segment: 'MCXOPT' }
          ]
        };
      } else if (segment === 'CRYPTO') {
        segmentQuery = {
          $or: [
            { isCrypto: true },
            { exchange: 'BINANCE' },
            { segment: 'CRYPTOFUT' },
            { segment: 'CRYPTOOPT' }
          ]
        };
      } else if (segment === 'FOREX') {
        segmentQuery = {
          $or: [
            { isForex: true },
            { segment: 'FOREXFUT' },
            { segment: 'FOREXOPT' }
          ]
        };
      } else if (segment === 'NSE') {
        segmentQuery = {
          $or: [
            { exchange: 'NSE' },
            { segment: 'NSEFUT' },
            { segment: 'NSEOPT' },
            { segment: 'NSE-EQ' }
          ]
        };
      } else if (segment === 'BSE') {
        segmentQuery = {
          $or: [
            { exchange: 'BSE' },
            { segment: 'BSE-FUT' },
            { segment: 'BSE-OPT' }
          ]
        };
      } else {
        segmentQuery = { segment: segment };
      }
      
      // Find all trades under this admin hierarchy with open positions for this segment
      const Trade = (await import('../models/Trade.js')).default;
      const User = (await import('../models/User.js')).default;
      const admin = await Admin.findById(adminId).select('adminCode segmentPermissions').lean();

      if (!closeTime && segment === 'CRYPTO') {
        const sys = await SystemSettings.getSettings();
        const sysSegDefaults = sys.adminSegmentDefaults instanceof Map
          ? Object.fromEntries(sys.adminSegmentDefaults)
          : sys.adminSegmentDefaults || {};
        closeTime = EODSettlement.getCryptoClosingTimeForAdmin(admin, sysSegDefaults);
      }

      if (!closeTime) {
        console.warn(`Auto-square: No closeTime for admin ${adminId} segment ${segment}; using current IST for stamp only`);
      }
      
      // For ALL segments: select both MIS and NRML positions
      // MIS will be closed, NRML will be marked as auto-squared for carry-forward
      // Exclude already auto-squared trades to avoid re-processing
      const trades = await Trade.find({
        adminCode: admin?.adminCode,
        productType: { $in: ['MIS', 'NRML', 'CARRYFORWARD'] },
        status: 'OPEN',
        isAutoSquared: { $ne: true },
        ...segmentQuery
      }).lean();
      
      console.log(`Auto-square: Found ${trades.length} trades under admin ${adminId} with open ${segment} positions`);
      
      // Get autosquarePercent and carryForwardLeverage from admin segment permissions
      let autosquarePercent = 90; // default
      let carryForwardLeverage = 40; // default
      if (admin?.segmentPermissions) {
        const segPerms = admin.segmentPermissions instanceof Map
          ? Object.fromEntries(admin.segmentPermissions)
          : (admin.segmentPermissions || {});

        // Get segment-specific settings
        for (const [segKey, segSettings] of Object.entries(segPerms)) {
          if (segSettings?.lotSettings?.autosquarePercent) {
            autosquarePercent = segSettings.lotSettings.autosquarePercent;
          }
          // Prefer lotSettings.carryForwardLeverage, fallback to exposureCarryForward
          if (segSettings?.lotSettings?.carryForwardLeverage) {
            carryForwardLeverage = segSettings.lotSettings.carryForwardLeverage;
          } else if (segSettings?.exposureCarryForward) {
            carryForwardLeverage = segSettings.exposureCarryForward;
          }
        }
      }

      console.log(`Auto-square: Using autosquarePercent = ${autosquarePercent}%`);
      console.log(`Auto-square: Using carryForwardLeverage = ${carryForwardLeverage}x`);

      // For CRYPTO: mark ALL positions as auto-squared and keep OPEN (no closing)
      // For other segments: close MIS positions, mark NRML as auto-squared for carry-forward
      const markAllCrypto = segment === 'CRYPTO';
      console.log(`Auto-square: Segment ${segment}, ${markAllCrypto ? 'will mark ALL positions as auto-squared (keep OPEN)' : 'will close MIS positions and mark NRML as auto-squared'}`);

      // Get LTP map for all trades
      const posObjs = trades.map((t) => (typeof t.toObject === 'function' ? t.toObject() : t));
      const ltpMap = await getLTPMapForTrades(posObjs);

      let closedCount = 0;
      let markedCount = 0;
      let failedCount = 0;

      for (const trade of trades) {
        try {
          const po = typeof trade.toObject === 'function' ? trade.toObject() : trade;
          const ck = cacheKeyForTrade(po);
          const ltpFromMap = ltpMap.get(ck);

          // Direct fallback: read from in-memory Binance data using pair/token
          let directCryptoLtp = 0;
          if (!ltpFromMap && (segment === 'CRYPTO' || trade.isCrypto || trade.exchange === 'BINANCE')) {
            const allCrypto = getCryptoData();
            const pairKey = trade.pair || trade.token || '';
            const symbolKey = trade.symbol || '';
            const tick = allCrypto[pairKey] || allCrypto[pairKey.toUpperCase()] || allCrypto[symbolKey] || allCrypto[symbolKey.toUpperCase() + 'USDT'];
            directCryptoLtp = tick?.ltp || 0;
            console.log(`Auto-square: Direct crypto lookup for ${pairKey}/${symbolKey} → ltp=${directCryptoLtp}`);
          }

          const ltp = ltpFromMap || directCryptoLtp || trade.currentPrice || trade.entryPrice;

          console.log(`Auto-square: ${trade.tradeId} (${trade.symbol}) cacheKey=${ck} ltpFromMap=${ltpFromMap} directCryptoLtp=${directCryptoLtp} currentPrice=${trade.currentPrice} entryPrice=${trade.entryPrice} → ltp=${ltp}`);

          if (!ltp || ltp <= 0) {
            console.warn(`Auto-square: No LTP for ${trade.tradeId}, skipping`);
            failedCount++;
            continue;
          }

          // For CRYPTO: mark ALL positions as auto-squared and keep OPEN (no closing)
          // For other segments: close MIS positions, mark NRML as auto-squared
          if (markAllCrypto) {
            const result = await EODSettlement.applyCarryForwardAutosquare(trade, {
              ltp,
              closeTime,
              segmentGroup: 'CRYPTO',
              admin,
            });
            markedCount++;
            console.log(
              `Auto-square CRYPTO ${trade.tradeId}: origQty=${result.originalQty} ` +
                `walletAfterPnl=${result.netBalance.toFixed(2)} carryFwdLeverage=${result.carryForwardLeverage}x ` +
                `nextDayQty=${result.nextDayQty} pnl=${result.pnl.toFixed(2)}`
            );
          } else if (trade.productType === 'MIS') {
            const result = await TradingService.squareOffPosition(
              trade._id.toString(),
              'TIME_BASED',
              ltp,
              ltp, // bidPrice
              ltp  // askPrice
            );

            if (result.success) {
              closedCount++;
              console.log(`Auto-square: Closed MIS position ${trade.tradeId} at ${ltp}`);
            } else {
              failedCount++;
              console.error(`Auto-square: Failed to close MIS position ${trade.tradeId}: ${result.message}`);
            }
          } else {
            const segGroup =
              segment === 'MCX' || trade.exchange === 'MCX'
                ? 'MCX'
                : trade.isForex
                  ? 'FOREX'
                  : 'NSE';
            const result = await EODSettlement.applyCarryForwardAutosquare(trade, {
              ltp,
              closeTime,
              segmentGroup: segGroup,
              admin,
            });
            markedCount++;
            console.log(
              `Auto-square NRML ${trade.tradeId} (${segGroup}): origQty=${result.originalQty} ` +
                `nextDayQty=${result.nextDayQty} pnl=${result.pnl.toFixed(2)}`
            );
          }
        } catch (error) {
          failedCount++;
          console.error(`Auto-square: Error processing ${trade.tradeId}:`, error.message);
        }
      }

      console.log(`Auto-square: Completed for admin ${adminId} segment ${segment}. Closed: ${closedCount}, Marked: ${markedCount}, Failed: ${failedCount}`);
      
    } catch (error) {
      console.error(`Auto-square: Error for admin ${adminId} segment ${segment}:`, error);
    }
  }
  
  /**
   * Square positions for a specific user
   */
  static async squareUserPositions(userId, segment) {
    try {
      // Build segment query
      let segmentQuery = {};
      if (segment === 'MCX') {
        segmentQuery = {
          $or: [
            { exchange: 'MCX' },
            { segment: 'MCX' },
            { segment: 'MCXFUT' },
            { segment: 'MCXOPT' }
          ]
        };
      } else if (segment === 'CRYPTO') {
        segmentQuery = {
          $or: [
            { isCrypto: true },
            { exchange: 'BINANCE' },
            { segment: 'CRYPTOFUT' },
            { segment: 'CRYPTOOPT' }
          ]
        };
      } else if (segment === 'FOREX') {
        segmentQuery = {
          $or: [
            { isForex: true },
            { segment: 'FOREXFUT' },
            { segment: 'FOREXOPT' }
          ]
        };
      } else if (segment === 'NSE') {
        segmentQuery = {
          $or: [
            { exchange: 'NSE' },
            { segment: 'NSEFUT' },
            { segment: 'NSEOPT' },
            { segment: 'NSE-EQ' }
          ]
        };
      } else if (segment === 'BSE') {
        segmentQuery = {
          $or: [
            { exchange: 'BSE' },
            { segment: 'BSE-FUT' },
            { segment: 'BSE-OPT' }
          ]
        };
      } else {
        segmentQuery = { segment: segment };
      }
      
      // Find all OPEN MIS positions for this user and segment
      const positions = await Trade.find({
        user: userId,
        productType: 'MIS',
        status: 'OPEN',
        ...segmentQuery
      }).populate('user');
      
      console.log(`Auto-square: Found ${positions.length} MIS positions for user ${userId} segment ${segment}`);
      
      if (positions.length === 0) {
        return;
      }
      
      // Get LTP map for all trades
      const posObjs = positions.map((p) => (typeof p.toObject === 'function' ? p.toObject() : p));
      const ltpMap = await getLTPMapForTrades(posObjs);
      
      let closedCount = 0;
      let failedCount = 0;
      
      for (const position of positions) {
        if (!position.user) continue;
        const po = position.toObject?.() ? position.toObject() : position;
        const ck = cacheKeyForTrade(po);
        const ltp = ltpMap.get(ck) || position.currentPrice || position.entryPrice;
        
        if (!ltp || ltp <= 0) {
          console.warn(`Auto-square: No LTP for ${position.tradeId}, skipping`);
          failedCount++;
          continue;
        }
        
        try {
          const result = await TradingService.squareOffPosition(
            position._id.toString(),
            'TIME_BASED',
            ltp,
            ltp, // bidPrice
            ltp  // askPrice
          );
          
          if (result.success) {
            closedCount++;
            console.log(`Auto-square: Closed ${position.tradeId} at ${ltp}`);
          } else {
            failedCount++;
            console.error(`Auto-square: Failed to close ${position.tradeId}: ${result.message}`);
          }
        } catch (error) {
          failedCount++;
          console.error(`Auto-square: Error closing ${position.tradeId}:`, error.message);
        }
      }
      
      console.log(`Auto-square: Completed for user ${userId} segment ${segment}. Closed: ${closedCount}, Failed: ${failedCount}`);
      
    } catch (error) {
      console.error(`Auto-square: Error for user ${userId} segment ${segment}:`, error);
      throw error;
    }
  }
  
  /**
   * Recalculate margins for NRML (carry-forward) positions
   * Carry-forward positions may require higher margin overnight
   * 
   * @param {String} segment - Segment to process (default: NSE/NFO)
   */
  static async recalculateNRMLMargins(segment = 'NSE') {
    try {
      // Build segment query
      let segmentQuery = {};
      if (segment === 'MCX') {
        segmentQuery = {
          $or: [
            { exchange: 'MCX' },
            { segment: 'MCX' },
            { segment: 'MCXFUT' },
            { segment: 'MCXOPT' }
          ]
        };
      } else {
        segmentQuery = {
          exchange: { $in: ['NSE', 'BSE', 'NFO'] },
          segment: { $nin: ['MCX', 'MCXFUT', 'MCXOPT'] }
        };
      }
      
      // Find all NRML positions
      const positions = await Trade.find({
        status: 'OPEN',
        productType: { $in: ['NRML', 'CNC', 'CARRYFORWARD'] },
        ...segmentQuery
      }).populate('user');
      
      console.log(`Found ${positions.length} NRML positions to recalculate`);
      
      // Group by user
      const userPositions = new Map();
      for (const pos of positions) {
        if (!pos.user) continue;
        const userId = pos.user._id.toString();
        if (!userPositions.has(userId)) {
          userPositions.set(userId, []);
        }
        userPositions.get(userId).push(pos);
      }
      
      // Recalculate wallet for each user
      for (const [userId, positions] of userPositions) {
        await WalletService.recalculateWallet(userId, segment);
      }
      
      return { processedUsers: userPositions.size, totalPositions: positions.length };
      
    } catch (error) {
      console.error('Error recalculating NRML margins:', error);
      throw error;
    }
  }
  
  /**
   * Manual trigger for MIS square-off (for testing or emergency)
   * @param {String} segment - Segment to square off
   */
  static async manualMISSquareOff(segment = 'NSE') {
    console.log(`Manual MIS square-off triggered for ${segment}`);
    return await StopOutService.executeEODSquareOff(segment);
  }
  
  /**
   * Manual trigger for circuit reset (for testing)
   */
  static async manualCircuitReset() {
    console.log('Manual circuit reset triggered');
    return await CircuitBreakerService.dailyCircuitReset();
  }
  
  /**
   * Get next scheduled job times
   */
  static getScheduledTimes() {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
    
    return {
      circuitReset: '09:00 AM IST (before market open)',
      nseMISSquareOff: '03:30 PM IST (NFO / NSE close)',
      mcxMISSquareOff: '11:30 PM IST (MCX close)',
      dailyReset: '12:00 AM IST (midnight)',
      nseNRMLRecalc: '04:00 PM IST (after NSE close)',
      mcxNRMLRecalc: '11:45 PM IST (after MCX close)',
      currentTime: now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    };
  }
}

export default EODSettlement;
