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
import {
  computeLedgerRealBalance,
  executeLedgerAutosquareNil,
} from '../services/ledgerAutosquareService.js';
import {
  isPastCryptoCloseForUser,
  resolveEffectiveCryptoClosingTimeForUser,
  resolveSystemCryptoClosingTime,
  isCryptoSegmentKey,
} from '../utils/cryptoSessionTiming.js';
import {
  isPastMcxCloseForUser,
  resolveEffectiveMcxClosingTimeForUser,
  resolveSystemMcxClosingTime,
  isMcxSegmentKey,
  resolveMcxCloseFromSegSettings,
} from '../utils/mcxSessionTiming.js';
import {
  resolveSystemNseBseClosingTime,
  isNseBseSegmentKey,
  resolveNseBseCloseFromSegSettings,
} from '../utils/nseBseSessionTiming.js';
import {
  applySegmentCarryForward,
  applyCryptoForexCarryForward,
  readSegmentSettingsForCarry,
} from '../services/carryForwardService.js';

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
    const seg = readSegmentSettingsForCarry(admin, trade, segmentGroup);
    return {
      autosquarePercent: seg.autosquarePercent != null ? seg.autosquarePercent : 90,
      carryForwardLeverage:
        seg.carryForwardLeverage != null && seg.carryForwardLeverage > 0 ? seg.carryForwardLeverage : 1,
      carryForwardUseTotalEquity: seg.carryForwardUseTotalEquity,
    };
  }

  /** Closing time for one segment key. Crypto: SystemSettings CRYPTOFUT first (matches UI). */
  static getSegmentCloseTime(admin, segKey, sysSegDefaults = {}) {
    if (isCryptoSegmentKey(segKey)) {
      const sysClose = resolveSystemCryptoClosingTime(sysSegDefaults);
      if (sysClose) return sysClose;
    }
    if (isMcxSegmentKey(segKey)) {
      const sysClose = resolveSystemMcxClosingTime(sysSegDefaults);
      if (sysClose) return sysClose;
    }
    if (isNseBseSegmentKey(segKey)) {
      const sysClose = resolveSystemNseBseClosingTime(sysSegDefaults);
      if (sysClose) return sysClose;
    }

    const segPerms = admin?.segmentPermissions instanceof Map
      ? Object.fromEntries(admin.segmentPermissions)
      : admin?.segmentPermissions || {};
    const segSettings = segPerms[segKey] || {};
    let closeTime = '';
    if (isCryptoSegmentKey(segKey)) {
      closeTime = String(segSettings.cryptoClosingTime || segSettings.closingTime || '').trim();
    } else if (isMcxSegmentKey(segKey)) {
      closeTime = resolveMcxCloseFromSegSettings(segSettings);
    } else if (isNseBseSegmentKey(segKey)) {
      closeTime = resolveNseBseCloseFromSegSettings(segSettings);
    } else {
      closeTime = String(segSettings.closingTime || '').trim();
    }
    if (!closeTime) {
      const sysSeg = sysSegDefaults[segKey] || {};
      if (isCryptoSegmentKey(segKey)) {
        closeTime = String(sysSeg.cryptoClosingTime || sysSeg.closingTime || '').trim();
      } else if (isMcxSegmentKey(segKey)) {
        closeTime = resolveMcxCloseFromSegSettings(sysSeg);
      } else if (isNseBseSegmentKey(segKey)) {
        closeTime = resolveNseBseCloseFromSegSettings(sysSeg);
      } else {
        closeTime = String(sysSeg.closingTime || '').trim();
      }
    }
    return closeTime;
  }

  /** NSE/BSE session end: carry-forward (SystemSettings NSEFUT close). */
  static async executeGlobalNseBseSessionAutosquare(sysSegDefaults = {}) {
    const closeTime = resolveSystemNseBseClosingTime(sysSegDefaults);
    if (!closeTime || !EODSettlement.isPastClosingTimeIST(closeTime)) {
      return { carried: 0, closed: 0, failed: 0, ran: false };
    }

    const { runNseBseSessionEndIfNeeded } = await import('../services/nseBseSessionCloseService.js');
    const { getMarketData } = await import('../services/zerodhaWebSocket.js');
    const { getAppSocket } = await import('../utils/appSocket.js');
    const result = await runNseBseSessionEndIfNeeded(getMarketData(), {
      io: getAppSocket(),
    });

    return {
      carried: result.carried || 0,
      closed: result.closed || 0,
      failed: result.failed || 0,
      skipped: result.skipped || 0,
      cancelled: result.cancelled || 0,
      ran: !!result.ran,
      frozen: result.frozen,
    };
  }

  /** MCX session end: carry-forward + freeze quotes (SystemSettings MCXFUT close). */
  static async executeGlobalMcxSessionAutosquare(sysSegDefaults = {}) {
    const closeTime = resolveSystemMcxClosingTime(sysSegDefaults);
    if (!closeTime || !EODSettlement.isPastClosingTimeIST(closeTime)) {
      return { carried: 0, closed: 0, failed: 0, ran: false };
    }

    const { runMcxSessionEndIfNeeded } = await import('../services/mcxSessionCloseService.js');
    const { getMarketData } = await import('../services/zerodhaWebSocket.js');
    const { getAppSocket } = await import('../utils/appSocket.js');
    const result = await runMcxSessionEndIfNeeded(getMarketData(), {
      io: getAppSocket(),
    });

    return {
      carried: result.carried || 0,
      closed: result.closed || 0,
      failed: result.failed || 0,
      skipped: result.skipped || 0,
      cancelled: result.cancelled || 0,
      ran: !!result.ran,
      frozen: result.frozen,
    };
  }

  /** Crypto session end: carry-forward + freeze quotes (SystemSettings close time). */
  static async executeGlobalCryptoSessionAutosquare(sysSegDefaults = {}) {
    const closeTime = resolveSystemCryptoClosingTime(sysSegDefaults);
    if (!closeTime || !EODSettlement.isPastClosingTimeIST(closeTime)) {
      return { carried: 0, closed: 0, failed: 0, ran: false };
    }

    const { runCryptoSessionEndIfNeeded } = await import('../services/cryptoSessionCloseService.js');
    const { getAppSocket } = await import('../utils/appSocket.js');
    const result = await runCryptoSessionEndIfNeeded(getCryptoData(), {
      io: getAppSocket(),
    });

    return {
      carried: result.carried || 0,
      closed: result.closed || 0,
      failed: result.failed || 0,
      skipped: result.skipped || 0,
      cancelled: result.cancelled || 0,
      ran: !!result.ran,
      frozen: result.frozen,
    };
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
    if (segmentGroup === 'NSE' || segmentGroup === 'BSE') {
      return { balancePath: 'nseBseWallet.balance', usedMarginPath: 'nseBseWallet.usedMargin' };
    }
    return { balancePath: 'nseBseWallet.balance', usedMarginPath: 'nseBseWallet.usedMargin' };
  }

  /**
   * Carry-forward qty for next session:
   * CRYPTO/FOREX (24-May): cap = (balance+usedMargin)×leverage; trim qty to floor(cap/LTP).
   * NSE/BSE/MCX: nextDayQty = floor((walletBalance + PnL) × leverage / endLtp).
   */
  static sameISTDay(a, b) {
    if (!a || !b) return false;
    const fmt = (d) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(d));
    return fmt(a) === fmt(b);
  }

  /** NSE / BSE / NFO / BFO — autosquare keeps position OPEN (carry-forward qty), does not close. */
  static isNseBseAutosquareSegment(segment, trade) {
    if (segment === 'NSE' || segment === 'BSE') return true;
    if (!trade) return false;
    const ex = String(trade.exchange || '').toUpperCase();
    const seg = String(trade.segment || '').toUpperCase();
    if (['NSE', 'BSE', 'NFO', 'BFO'].includes(ex)) return true;
    if (seg.startsWith('NSE') || seg.startsWith('BSE')) return true;
    return false;
  }

  static async applyCarryForwardAutosquare(
    trade,
    { ltp, closeTime, segmentGroup, admin, netBalanceOverride = null, skipWalletUpdate = false } = {}
  ) {
    if (!['CRYPTO', 'FOREX', 'MCX', 'NSE'].includes(segmentGroup)) {
      throw new Error(`Unsupported carry-forward segmentGroup: ${segmentGroup}`);
    }
    return applySegmentCarryForward(trade, {
      ltp,
      closeTime,
      segmentGroup,
      admin,
    });
  }

  /**
   * NSE/BSE EOD: MTM at bid/ask → real balance; 90% ledger loss → nil all; else carry-forward per trade.
   */
  static async processNseBseEodAutosquare(trades, { admin, closeTime, segment, ltpMap }) {
    let markedCount = 0;
    let failedCount = 0;
    let closedCount = 0;

    const byUser = new Map();
    for (const trade of trades) {
      const uid = trade.user?.toString?.() || trade.user;
      if (!uid) continue;
      if (!byUser.has(String(uid))) byUser.set(String(uid), []);
      byUser.get(String(uid)).push(trade);
    }

    for (const [userOid, userTrades] of byUser) {
      try {
        const user = await User.findById(userOid).select('userId settings nseBseWallet').lean();
        if (!user) continue;

        const snapshot = await computeLedgerRealBalance(userOid, 'nseBseWallet', {
          preferBidAsk: true,
        });
        if (!snapshot) continue;

        if (snapshot.shouldTrigger) {
          const nilResult = await executeLedgerAutosquareNil(userOid, 'nseBseWallet', {
            reason: snapshot.triggerReason || `INTRADAY_AUTOSQUARE_${snapshot.autosquarePercent}%`,
            force: false,
            snapshot,
          });
          closedCount += nilResult.closed || 0;
          console.log(
            `[EOD NSE/BSE] Autosquare user ${user.userId}: loss ${snapshot.lossPercent}% ` +
              `(threshold ${snapshot.autosquarePercent}%)`
          );
          continue;
        }

        const { sanitizeInrWalletAmount } = await import('../utils/walletBalanceSanity.js');
        const netBalance = sanitizeInrWalletAmount(snapshot.realBalance, {
          field: 'nseBseEodNetBalance',
          userId: String(user.userId || userOid),
        });
        await User.updateOne(
          { _id: userOid },
          { $set: { 'nseBseWallet.balance': Math.max(0, netBalance), 'wallet.tradingBalance': 0 } }
        );

        for (const trade of userTrades) {
          try {
            const po = typeof trade.toObject === 'function' ? trade.toObject() : trade;
            const ck = cacheKeyForTrade(po);
            const priceRow = snapshot.priceMap?.get?.(String(trade._id));
            const ltp =
              priceRow?.markPrice ||
              ltpMap.get(ck) ||
              trade.currentPrice ||
              trade.entryPrice;

            if (!ltp || ltp <= 0) {
              failedCount++;
              continue;
            }

            const segGroup =
              segment === 'BSE' || trade.exchange === 'BSE' || String(trade.segment || '').startsWith('BSE')
                ? 'NSE'
                : 'NSE';

            await EODSettlement.applyCarryForwardAutosquare(trade, {
              ltp,
              closeTime,
              segmentGroup: segGroup,
              admin,
              netBalanceOverride: netBalance,
              skipWalletUpdate: true,
            });
            markedCount++;
          } catch (err) {
            failedCount++;
            console.error(`[EOD NSE/BSE] carry-forward ${trade.tradeId}:`, err.message);
          }
        }
      } catch (err) {
        failedCount += userTrades.length;
        console.error(`[EOD NSE/BSE] user batch ${userOid}:`, err.message);
      }
    }

    return { markedCount, failedCount, closedCount };
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
        const { resetDailyLedgerReference } = await import('../services/ledgerAutosquareService.js');
        await resetDailyLedgerReference();
        
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
    
    // ==================== MCX EOD AUTO-SQUARE (carry-forward) ====================
    // Hard backup at 11:30 PM IST — dynamic scheduler alone missed positions when server was down
    // or admin closingTime was unset (MCX trades Sun–Fri extended hours).
    cron.schedule('30 23 * * *', async () => {
      console.log('CRON: MCX EOD autosquare starting (23:30 IST)...');
      try {
        const Admin = (await import('../models/Admin.js')).default;
        const SystemSettings = (await import('../models/SystemSettings.js')).default;
        const sys = await SystemSettings.getSettings();
        const sysSegDefaults = sys.adminSegmentDefaults instanceof Map
          ? Object.fromEntries(sys.adminSegmentDefaults)
          : sys.adminSegmentDefaults || {};
        const admins = await Admin.find({ segmentPermissions: { $exists: true, $ne: null } }).lean();
        for (const admin of admins) {
          const closeTime = EODSettlement.getSegmentCloseTime(admin, 'MCXFUT', sysSegDefaults) || '23:30:00';
          await this.executeAdminHierarchyAutoSquare(admin._id, 'MCX', closeTime);
        }
        console.log('CRON: MCX EOD autosquare complete');
      } catch (error) {
        console.error('CRON: MCX EOD autosquare error:', error);
      }
    }, {
      timezone: 'Asia/Kolkata'
    });

    // ==================== MCX NRML MARGIN RECALCULATION ====================
    // Run at 11:45 PM IST (after MCX close)
    cron.schedule('45 23 * * *', async () => {
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
    
    // Run immediately and then every 30 seconds (crypto session close must not wait 60s+)
    checkLiveDataStop();
    setInterval(checkLiveDataStop, 30 * 1000);
    
    // Intraday autosquare: equity loss >= segment autosquarePercent (ledgerAutosquareService).
    // End-time carry-forward runs only at each admin's cryptoClosingTime (separate path).

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

      // Crypto: one global pass at SystemSettings CRYPTOFUT close (same as UI 07:25–14:30)
      const sysCryptoClose = resolveSystemCryptoClosingTime(sysSegDefaults);
      if (sysCryptoClose && EODSettlement.isPastClosingTimeIST(sysCryptoClose)) {
        try {
          await EODSettlement.executeGlobalCryptoSessionAutosquare(sysSegDefaults);
        } catch (cryptoErr) {
          console.error('[Crypto session close] Global autosquare failed:', cryptoErr);
        }
      }

      const sysMcxClose = resolveSystemMcxClosingTime(sysSegDefaults);
      if (sysMcxClose && EODSettlement.isPastClosingTimeIST(sysMcxClose)) {
        try {
          await EODSettlement.executeGlobalMcxSessionAutosquare(sysSegDefaults);
        } catch (mcxErr) {
          console.error('[MCX session close] Global autosquare failed:', mcxErr);
        }
      }

      const sysNseClose = resolveSystemNseBseClosingTime(sysSegDefaults);
      if (sysNseClose && EODSettlement.isPastClosingTimeIST(sysNseClose)) {
        try {
          await EODSettlement.executeGlobalNseBseSessionAutosquare(sysSegDefaults);
        } catch (nseErr) {
          console.error('[NSE/BSE session close] Global autosquare failed:', nseErr);
        }
      }
      
      // Get all admins with segmentPermissions that have closing times
      const admins = await Admin.find({ segmentPermissions: { $exists: true, $ne: null } }).lean();
      
      for (const admin of admins) {
        const segPerms = admin.segmentPermissions instanceof Map 
          ? Object.fromEntries(admin.segmentPermissions) 
          : admin.segmentPermissions || {};
        
        // Check each segment for closing time
        const segmentsToCheck = ['NSEFUT', 'NSEOPT', 'NSE-EQ', 'BSE-FUT', 'BSE-OPT', 'MCXFUT', 'MCXOPT', 'CRYPTOFUT', 'CRYPTOOPT', 'FOREXFUT', 'FOREXOPT'];
        
        for (const segKey of segmentsToCheck) {
          // Crypto global session close handled above (SystemSettings timing)
          if (isCryptoSegmentKey(segKey) && sysCryptoClose) continue;
          // MCX / NSE: global pass + per-admin cron for hierarchy-specific close times
          if (isNseBseSegmentKey(segKey) && sysNseClose) continue;

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
            { exchange: { $in: ['NSE', 'NFO'] } },
            { segment: 'NSEFUT' },
            { segment: 'NSEOPT' },
            { segment: 'NSE-EQ' },
            { segment: 'FNO' },
          ],
        };
      } else if (segment === 'BSE') {
        segmentQuery = {
          $or: [
            { exchange: { $in: ['BSE', 'BFO'] } },
            { segment: 'BSE-FUT' },
            { segment: 'BSE-OPT' },
          ],
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
      
      // 24-May parity:
      // CRYPTO/NSE/BSE/MCX use carry-forward autosquare (position stays OPEN with next-day qty).
      // FOREX keeps full close path.
      const keepOpenCrypto = segment === 'CRYPTO';
      const markAllForex = segment === 'FOREX';
      const keepOpenNseBse = EODSettlement.isNseBseAutosquareSegment(segment, null);
      const keepOpenMcx = segment === 'MCX';
      // NSE/BSE/MCX + Crypto: run every market close (new history row each day).
      const trades = await Trade.find({
        adminCode: admin?.adminCode,
        productType: { $in: ['MIS', 'NRML', 'CARRYFORWARD'] },
        status: 'OPEN',
        ...(keepOpenCrypto || keepOpenNseBse || keepOpenMcx ? {} : { isAutoSquared: { $ne: true } }),
        ...segmentQuery,
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

      console.log(
        `Auto-square: Segment ${segment}, ${
          keepOpenCrypto || keepOpenNseBse || keepOpenMcx
            ? 'MIS/NRML stay OPEN (carry-forward autosquare)'
            : 'will close MIS and mark NRML as auto-squared'
        }`
      );

      let closedCount = 0;
      let markedCount = 0;
      let failedCount = 0;

      const posObjs = trades.map((t) => (typeof t.toObject === 'function' ? t.toObject() : t));
      const ltpMap = await getLTPMapForTrades(posObjs);

      if (keepOpenNseBse) {
        const nseStats = await EODSettlement.processNseBseEodAutosquare(trades, {
          admin,
          closeTime,
          segment,
          ltpMap,
        });
        markedCount += nseStats.markedCount;
        failedCount += nseStats.failedCount;
        closedCount += nseStats.closedCount;
        console.log(
          `Auto-square NSE/BSE batch: marked=${markedCount} closed=${closedCount} failed=${failedCount}`
        );
        return;
      }

      for (const trade of trades) {
        try {
          const po = typeof trade.toObject === 'function' ? trade.toObject() : trade;
          const ck = cacheKeyForTrade(po);
          const ltpFromMap = ltpMap.get(ck);

          // Direct fallback: read from in-memory Binance data using pair/token
          let directCryptoLtp = 0;
          let cryptoBid = 0;
          let cryptoAsk = 0;
          if (!ltpFromMap && (segment === 'CRYPTO' || trade.isCrypto || trade.exchange === 'BINANCE')) {
            const allCrypto = getCryptoData();
            const pairKey = trade.pair || trade.token || '';
            const symbolKey = trade.symbol || '';
            const tick =
              allCrypto[pairKey] ||
              allCrypto[pairKey?.toUpperCase?.()] ||
              allCrypto[symbolKey] ||
              allCrypto[`${String(symbolKey).toUpperCase()}USDT`];
            directCryptoLtp = tick?.ltp || tick?.last_price || 0;
            cryptoBid = Number(tick?.bid || tick?.bestBid || directCryptoLtp) || 0;
            cryptoAsk = Number(tick?.ask || tick?.bestAsk || directCryptoLtp) || 0;
            console.log(`Auto-square: Direct crypto lookup for ${pairKey}/${symbolKey} → ltp=${directCryptoLtp}`);
          }

          const ltp = ltpFromMap || directCryptoLtp || trade.currentPrice || trade.entryPrice;
          const exitBid =
            cryptoBid > 0 ? cryptoBid : trade.side === 'BUY' ? ltp : ltp;
          const exitAsk =
            cryptoAsk > 0 ? cryptoAsk : trade.side === 'SELL' ? ltp : ltp;

          console.log(`Auto-square: ${trade.tradeId} (${trade.symbol}) cacheKey=${ck} ltpFromMap=${ltpFromMap} directCryptoLtp=${directCryptoLtp} currentPrice=${trade.currentPrice} entryPrice=${trade.entryPrice} → ltp=${ltp}`);

          if (!ltp || ltp <= 0) {
            console.warn(`Auto-square: No LTP for ${trade.tradeId}, skipping`);
            failedCount++;
            continue;
          }

          // CRYPTO per-user close gate (same as old parity expectations).
          if (keepOpenCrypto && trade.user) {
            const tradeUser = await User.findById(trade.user)
              .populate('admin', 'name segmentPermissions hierarchyPath role adminCode')
              .lean();
            if (tradeUser) {
              const userEffectiveClose = await resolveEffectiveCryptoClosingTimeForUser(tradeUser);
              const pastUserClose = await isPastCryptoCloseForUser(tradeUser);
              if (!pastUserClose) {
                console.warn(
                  `Auto-square: Skip crypto ${trade.tradeId} (${tradeUser.userId}) — ` +
                    `user effective close ${userEffectiveClose || '—'} not reached yet ` +
                    `(admin cron used ${closeTime || 'n/a'}; SA/default may be 22:30)`
                );
                continue;
              }
            }
          }

          // MCX per-user close gate (Ram hierarchy timing → users).
          if (keepOpenMcx && trade.user) {
            const tradeUser = await User.findById(trade.user)
              .populate('admin', 'name segmentPermissions hierarchyPath role adminCode')
              .lean();
            if (tradeUser) {
              const userEffectiveClose = await resolveEffectiveMcxClosingTimeForUser(tradeUser);
              const pastUserClose = await isPastMcxCloseForUser(tradeUser);
              if (!pastUserClose) {
                console.warn(
                  `Auto-square: Skip MCX ${trade.tradeId} (${tradeUser.userId}) — ` +
                    `user effective close ${userEffectiveClose || '—'} not reached yet ` +
                    `(admin cron used ${closeTime || 'n/a'})`
                );
                continue;
              }
            }
          }

          // FOREX: full square-off at close (wallet + P&L via closeTrade).
          if (markAllForex || (trade.isForex && segment === 'FOREX')) {
            const bidPx = trade.side === 'BUY' ? exitBid : exitBid;
            const askPx = trade.side === 'SELL' ? exitAsk : exitAsk;
            const result = await TradingService.squareOffPosition(
              trade._id.toString(),
              'TIME_BASED',
              trade.side === 'BUY' ? bidPx : askPx,
              bidPx,
              askPx
            );
            if (result?.trade?.status === 'CLOSED' || result?.success) {
              closedCount++;
              console.log(
                `Auto-square ${markAllForex ? 'FOREX' : 'CRYPTO'}: closed ${trade.tradeId} at ${trade.side === 'BUY' ? bidPx : askPx}`
              );
            } else {
              failedCount++;
              console.error(
                `Auto-square ${markAllForex ? 'FOREX' : 'CRYPTO'}: failed ${trade.tradeId}: ${result?.message || 'close did not complete'}`
              );
            }
          } else if (keepOpenCrypto) {
            const result = await applyCryptoForexCarryForward(trade, {
              ltp,
              closeTime,
              segmentGroup: 'CRYPTO',
              admin,
            });
            markedCount++;
            console.log(
              `Auto-square CRYPTO ${trade.productType} ${trade.tradeId} (keep OPEN): origQty=${result.originalQty} ` +
                `nextDayQty=${result.nextDayQty} pnl=${result.pnl.toFixed(2)}`
            );
          } else if (keepOpenMcx) {
            const result = await EODSettlement.applyCarryForwardAutosquare(trade, {
              ltp,
              closeTime,
              segmentGroup: 'MCX',
              admin,
            });
            markedCount++;
            console.log(
              `Auto-square MCX ${trade.productType} ${trade.tradeId} (keep OPEN): origQty=${result.originalQty} ` +
                `nextDayQty=${result.nextDayQty} pnl=${result.pnl.toFixed(2)}`
            );
          } else if (
            EODSettlement.isNseBseAutosquareSegment(segment, trade) ||
            trade.productType === 'NRML' ||
            trade.productType === 'CARRYFORWARD'
          ) {
            const segGroup =
              segment === 'BSE' || trade.exchange === 'BSE' || String(trade.segment || '').startsWith('BSE')
                ? 'NSE'
                : segment === 'MCX' || trade.exchange === 'MCX'
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
              `Auto-square ${trade.productType} ${trade.tradeId} (${segGroup}, keep OPEN): origQty=${result.originalQty} ` +
                `nextDayQty=${result.nextDayQty} pnl=${result.pnl.toFixed(2)}`
            );
          } else if (trade.productType === 'MIS') {
            const result = await TradingService.squareOffPosition(
              trade._id.toString(),
              'TIME_BASED',
              ltp,
              ltp,
              ltp
            );

            if (result?.trade?.status === 'CLOSED' || result?.success) {
              closedCount++;
              console.log(`Auto-square: Closed MIS position ${trade.tradeId} at ${ltp}`);
            } else {
              failedCount++;
              console.error(
                `Auto-square: Failed to close MIS position ${trade.tradeId}: ${result?.message || 'close did not complete'}`
              );
            }
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
            { exchange: { $in: ['NSE', 'NFO'] } },
            { segment: 'NSEFUT' },
            { segment: 'NSEOPT' },
            { segment: 'NSE-EQ' },
            { segment: 'FNO' },
          ],
        };
      } else if (segment === 'BSE') {
        segmentQuery = {
          $or: [
            { exchange: { $in: ['BSE', 'BFO'] } },
            { segment: 'BSE-FUT' },
            { segment: 'BSE-OPT' },
          ],
        };
      } else {
        segmentQuery = { segment: segment };
      }
      
      // Find all OPEN MIS positions for this user and segment
      const positions = await Trade.find({
        user: userId,
        productType: 'MIS',
        status: 'OPEN',
        isAutoSquared: { $ne: true },
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
      let markedCount = 0;
      let failedCount = 0;
      const Admin = (await import('../models/Admin.js')).default;
      
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
          if (EODSettlement.isNseBseAutosquareSegment(segment, po)) {
            const admin = position.adminCode
              ? await Admin.findOne({ adminCode: position.adminCode }).select('adminCode segmentPermissions').lean()
              : null;
            await EODSettlement.applyCarryForwardAutosquare(po, {
              ltp,
              closeTime: '15:30:00',
              segmentGroup: 'NSE',
              admin,
            });
            markedCount++;
            console.log(`Auto-square: NSE/BSE MIS ${position.tradeId} carry-forward (kept OPEN) at ${ltp}`);
          } else {
            const result = await TradingService.squareOffPosition(
              position._id.toString(),
              'TIME_BASED',
              ltp,
              ltp,
              ltp
            );
            
            if (result.success) {
              closedCount++;
              console.log(`Auto-square: Closed ${position.tradeId} at ${ltp}`);
            } else {
              failedCount++;
              console.error(`Auto-square: Failed to close ${position.tradeId}: ${result.message}`);
            }
          }
        } catch (error) {
          failedCount++;
          console.error(`Auto-square: Error closing ${position.tradeId}:`, error.message);
        }
      }
      
      console.log(
        `Auto-square: Completed for user ${userId} segment ${segment}. ` +
          `Marked (OPEN): ${markedCount}, Closed: ${closedCount}, Failed: ${failedCount}`
      );
      
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
