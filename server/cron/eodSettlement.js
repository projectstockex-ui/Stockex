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
    
    // Monitor for balance-based auto-square trigger
    // This runs every 10 seconds to check if wallet balance drops below autosquarePercent threshold
    const checkBalanceBasedAutoSquare = async () => {
      await this.checkBalanceBasedAutoSquare();
    };
    
    // Run immediately and then every minute
    checkLiveDataStop();
    setInterval(checkLiveDataStop, 60 * 1000);
    
    // Run immediately and then every 10 seconds
    checkBalanceBasedAutoSquare();
    setInterval(checkBalanceBasedAutoSquare, 10 * 1000);
    
    console.log('EODSettlement: Dynamic auto-square scheduler initialized (checks every minute for live data stop, every 10 seconds for balance threshold)');
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
          const segSettings = segPerms[segKey] || {};
          let closeTime = segSettings.closingTime || segSettings.cryptoClosingTime || '';
          
          // For CRYPTO segments: Always use SystemSettings as primary source (Super Admin's setting)
          if ((segKey === 'CRYPTOFUT' || segKey === 'CRYPTOOPT') && sysSegDefaults['CRYPTOFUT']) {
            const cryptoFutSettings = sysSegDefaults['CRYPTOFUT'];
            closeTime = cryptoFutSettings.cryptoClosingTime || closeTime;
            console.log(`[Auto-square] Using SystemSettings CRYPTOFUT closing time: ${closeTime}`);
          }
          
          // Fallback to system defaults if admin hasn't set closing time
          if (!closeTime) {
            const sysSeg = sysSegDefaults[segKey] || {};
            closeTime = sysSeg.closingTime || sysSeg.cryptoClosingTime || '';
            
            // If still no closing time, use default market close times
            if (!closeTime) {
              if (segKey.startsWith('NSE') || segKey.startsWith('BSE')) {
                closeTime = '15:30:00'; // NSE/BSE market close
                console.log(`[Auto-square] Using default NSE/BSE closing time: ${closeTime}`);
              } else if (segKey.startsWith('MCX')) {
                closeTime = '23:30:00'; // MCX commodity close
                console.log(`[Auto-square] Using default MCX closing time: ${closeTime}`);
              } else if (segKey.startsWith('FOREX')) {
                closeTime = '23:59:00'; // Forex end of day
                console.log(`[Auto-square] Using default FOREX closing time: ${closeTime}`);
              }
            }
          }
          
          if (closeTime) {
            // Check if current time is past closing time (handle HH:MM or HH:MM:SS format)
            const timeParts = closeTime.split(':').map(Number);
            const hours = timeParts[0];
            const minutes = timeParts[1];
            const seconds = timeParts[2] || 0;
            
            if (!isNaN(hours) && !isNaN(minutes)) {
              const now = new Date();
              const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
              const currentHours = istTime.getHours();
              const currentMinutes = istTime.getMinutes();
              const currentSeconds = istTime.getSeconds();
              
              // If current time is at or past closing time, trigger auto-square for this admin's hierarchy
              if (currentHours > hours || 
                  (currentHours === hours && currentMinutes > minutes) ||
                  (currentHours === hours && currentMinutes === minutes && currentSeconds >= seconds)) {
                // Map segment key to segment group
                let segmentGroup;
                if (segKey.startsWith('NSE')) segmentGroup = 'NSE';
                else if (segKey.startsWith('BSE')) segmentGroup = 'BSE';
                else if (segKey.startsWith('MCX')) segmentGroup = 'MCX';
                else if (segKey.startsWith('CRYPTO')) segmentGroup = 'CRYPTO';
                else if (segKey.startsWith('FOREX')) segmentGroup = 'FOREX';
                
                if (segmentGroup) {
                  console.log(`Auto-square: Triggering for admin ${admin._id} segment ${segmentGroup} (past closing time ${closeTime})`);
                  try {
                    await this.executeAdminHierarchyAutoSquare(admin._id, segmentGroup, closeTime);
                    console.log(`Auto-square: Successfully completed for admin ${admin._id} segment ${segmentGroup}`);
                  } catch (error) {
                    console.error(`Auto-square: Failed for admin ${admin._id} segment ${segmentGroup}:`, error);
                  }
                }
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
   * Check if wallet balance drops below autosquarePercent threshold and trigger auto-square
   */
  static async checkBalanceBasedAutoSquare() {
    try {
      const Admin = (await import('../models/Admin.js')).default;
      const Trade = (await import('../models/Trade.js')).default;
      const User = (await import('../models/User.js')).default;
      
      // Get all admins with segmentPermissions
      const admins = await Admin.find({ segmentPermissions: { $exists: true, $ne: null } }).lean();
      
      for (const admin of admins) {
        const segPerms = admin.segmentPermissions instanceof Map 
          ? Object.fromEntries(admin.segmentPermissions) 
          : admin.segmentPermissions || {};
        
        // Get autosquarePercent from admin settings
        let autosquarePercent = 90; // default
        for (const [segKey, segSettings] of Object.entries(segPerms)) {
          if (segSettings?.lotSettings?.autosquarePercent) {
            autosquarePercent = segSettings.lotSettings.autosquarePercent;
          }
        }
        
        // Find all users under this admin with open crypto positions
        const trades = await Trade.find({
          adminCode: admin?.adminCode,
          isCrypto: true,
          status: 'OPEN',
          isAutoSquared: { $ne: true }
        }).lean();
        
        if (trades.length === 0) continue;
        
        // Group trades by userId
        const userTrades = {};
        for (const trade of trades) {
          if (!userTrades[trade.userId]) {
            userTrades[trade.userId] = [];
          }
          userTrades[trade.userId].push(trade);
        }
        
        // Check each user's wallet balance
        for (const [userId, userTradeList] of Object.entries(userTrades)) {
          const user = await User.findOne({ userId }).select('cryptoWallet wallet').lean();
          if (!user) continue;
          
          const currentBalance = user.cryptoWallet?.balance || 0;
          const usedMargin = user.cryptoWallet?.usedMargin || 0;
          
          // Calculate initial balance (current balance + used margin)
          const initialBalance = currentBalance + usedMargin;
          
          // Calculate threshold (autosquarePercent of initial balance)
          const threshold = (initialBalance * autosquarePercent) / 100;
          
          console.log(`[Balance Auto-Square Check] User: ${userId}, Initial: ${initialBalance.toFixed(2)}, Current: ${currentBalance.toFixed(2)}, Threshold: ${threshold.toFixed(2)} (${autosquarePercent}%)`);
          
          // If current balance is below threshold, trigger auto-square
          if (currentBalance < threshold) {
            console.log(`[Balance Auto-Square] TRIGGERED for user ${userId}: Current balance ${currentBalance.toFixed(2)} < threshold ${threshold.toFixed(2)}`);
            
            try {
              await this.executeAdminHierarchyAutoSquare(admin._id, 'CRYPTO', null);
              console.log(`[Balance Auto-Square] Successfully completed for user ${userId}`);
            } catch (error) {
              console.error(`[Balance Auto-Square] Failed for user ${userId}:`, error);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error checking balance-based auto-square:', error);
    }
  }
  
  /**
   * Execute auto-square for a specific admin hierarchy
   */
  static async executeAdminHierarchyAutoSquare(adminId, segment, closeTime = null) {
    try {
      console.log(`Auto-square: Starting for admin ${adminId} segment ${segment}`);
      
      const Admin = (await import('../models/Admin.js')).default;
      
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
            // Carry-forward calculation for CRYPTO
            const user = await User.findOne({ userId: trade.userId }).select('wallet').lean();
            const initialBalance = user?.wallet?.balance || 0;
            // Use originalQty if already saved (re-processing), else trade.quantity
            const originalQty = trade.originalQty || trade.quantity || trade.lots || 1;
            const entryLtp = trade.entryPrice || trade.price || 0;

            console.log(`Auto-square DEBUG: ${trade.tradeId} userId=${trade.userId} initialBalance=${initialBalance} trade.originalQty=${trade.originalQty} trade.quantity=${trade.quantity} using originalQty=${originalQty}`);

            // P&L = (End LTP - Entry LTP) × Qty (BUY side)
            // P&L = (Entry LTP - End LTP) × Qty (SELL side)
            const multiplier = trade.side === 'BUY' ? 1 : -1;
            const pnl = (ltp - entryLtp) * originalQty * multiplier;

            // Net Balance = Initial Balance + P&L
            const netBalance = initialBalance + pnl;

            // Next Day Qty = (Net Balance × Carry Forward Leverage) / End LTP
            const nextDayQty = Math.floor((netBalance * carryForwardLeverage) / ltp);
            // Carry Forward Qty = Next Day Qty - Original Qty (for display in autosquare tab)
            const carryForwardQty = nextDayQty - originalQty;

            console.log(`Auto-square: ${trade.tradeId}: origQty=${originalQty} netBalance=${netBalance} carryFwdLeverage=${carryForwardLeverage}x nextDayQty=${nextDayQty} carryFwdQty=${carryForwardQty} pnl=${pnl}`);

            // Update user wallet balance with P&L
            await User.updateOne(
              { userId: trade.userId },
              { $set: { 'wallet.balance': netBalance } }
            );

            await Trade.findByIdAndUpdate(trade._id, {
              isAutoSquared: true,
              autoSquaredAt: EODSettlement.parseCloseTimeToDate(closeTime),
              autoSquareLtp: ltp,
              originalQty: originalQty,
              pnlAtAutoSquare: pnl,
              carryForwardQty: carryForwardQty,
              netBalanceAtAutoSquare: netBalance,
              quantity: nextDayQty
            });
            markedCount++;
            console.log(`Auto-square: Marked CRYPTO position ${trade.tradeId} as auto-squared with LTP ${ltp} (trade remains OPEN for next day, carry qty: ${carryForwardQty})`);
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
            // NRML/CARRYFORWARD: carry-forward calculation and mark as auto-squared, keep OPEN for next day
            const user = await User.findOne({ userId: trade.userId }).select('wallet').lean();
            const initialBalance = user?.wallet?.balance || 0;
            // Use originalQty if already saved (re-processing), else trade.quantity
            const originalQty = trade.originalQty || trade.quantity || trade.lots || 1;
            const entryLtp = trade.entryPrice || trade.price || 0;

            console.log(`Auto-square NRML DEBUG: ${trade.tradeId} userId=${trade.userId} initialBalance=${initialBalance} trade.originalQty=${trade.originalQty} trade.quantity=${trade.quantity} using originalQty=${originalQty}`);

            // P&L = (End LTP - Entry LTP) × Qty (BUY) or (Entry - End) × Qty (SELL)
            const multiplier = trade.side === 'BUY' ? 1 : -1;
            const pnl = (ltp - entryLtp) * originalQty * multiplier;

            // Net Balance = Initial Balance + P&L
            const netBalance = initialBalance + pnl;

            // Next Day Qty = (Net Balance × Carry Forward Leverage) / End LTP
            const nextDayQty = Math.floor((netBalance * carryForwardLeverage) / ltp);
            // Carry Forward Qty = Next Day Qty - Original Qty (for display in autosquare tab)
            const carryForwardQty = nextDayQty - originalQty;

            console.log(`Auto-square NRML: ${trade.tradeId}: origQty=${originalQty} netBalance=${netBalance} carryFwdLeverage=${carryForwardLeverage}x nextDayQty=${nextDayQty} carryFwdQty=${carryForwardQty} pnl=${pnl}`);

            // Update user wallet balance with P&L
            await User.updateOne(
              { userId: trade.userId },
              { $set: { 'wallet.balance': netBalance } }
            );

            await Trade.findByIdAndUpdate(trade._id, {
              isAutoSquared: true,
              autoSquaredAt: EODSettlement.parseCloseTimeToDate(closeTime),
              autoSquareLtp: ltp,
              originalQty: originalQty,
              pnlAtAutoSquare: pnl,
              carryForwardQty: carryForwardQty,
              netBalanceAtAutoSquare: netBalance,
              quantity: nextDayQty
            });
            markedCount++;
            console.log(`Auto-square: Marked NRML position ${trade.tradeId} as auto-squared with LTP ${ltp} (trade remains OPEN for next day, carry qty: ${carryForwardQty})`);
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
