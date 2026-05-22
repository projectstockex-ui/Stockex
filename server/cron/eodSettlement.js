import cron from 'node-cron';
import StopOutService from '../services/stopOutService.js';
import CircuitBreakerService from '../services/circuitBreakerService.js';
import WalletService from '../services/walletService.js';
import User from '../models/User.js';
import Trade from '../models/Trade.js';
import SystemSettings from '../models/SystemSettings.js';
import { getLTPMapForTrades, cacheKeyForTrade } from '../services/ltpResolutionService.js';
import TradingService from '../services/tradingService.js';

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
    
    console.log('EODSettlement: Dynamic auto-square scheduler initialized (checks every minute for live data stop)');
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
                  // Check if auto-square already ran for this admin/segment with this specific closing time
                  // Include closing time in key to allow re-triggering when closing time changes
                  const taskKey = `autosquare_admin_${admin._id}_${segmentGroup}_${closeTime}`;
                  if (!this.scheduledTasks.has(taskKey)) {
                    console.log(`Auto-square: Triggering for admin ${admin._id} segment ${segmentGroup} (past closing time ${closeTime})`);
                    try {
                      await this.executeAdminHierarchyAutoSquare(admin._id, segmentGroup);
                      this.scheduledTasks.set(taskKey, true); // Mark as run for this specific closing time
                      console.log(`Auto-square: Successfully completed for admin ${admin._id} segment ${segmentGroup}`);
                    } catch (error) {
                      console.error(`Auto-square: Failed for admin ${admin._id} segment ${segmentGroup}:`, error);
                      // Don't mark as completed if failed, allow retry on next check
                      console.log(`Auto-square: Will retry on next check for admin ${admin._id} segment ${segmentGroup}`);
                    }
                  } else {
                    console.log(`Auto-square: Already ran for admin ${admin._id} segment ${segmentGroup} with closing time ${closeTime}`);
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
   * Execute auto-square for a specific admin hierarchy
   */
  static async executeAdminHierarchyAutoSquare(adminId, segment) {
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
      const admin = await Admin.findById(adminId).select('adminCode segmentPermissions').lean();
      
      // For CRYPTO: close ALL positions (not just MIS)
      // For other segments: only close MIS positions
      const productTypeFilter = segment === 'CRYPTO' 
        ? { $in: ['MIS', 'NRML', 'CNC', 'INTRADAY', 'CARRYFORWARD'] }
        : 'MIS';
      
      const trades = await Trade.find({
        adminCode: admin?.adminCode,
        productType: productTypeFilter,
        status: 'OPEN',
        ...segmentQuery
      }).lean();
      
      console.log(`Auto-square: Found ${trades.length} trades under admin ${adminId} with open ${segment} positions`);
      
      // Get autosquarePercent from admin segment permissions
      let autosquarePercent = 90; // default
      if (admin?.segmentPermissions) {
        const segPerms = admin.segmentPermissions instanceof Map 
          ? Object.fromEntries(admin.segmentPermissions) 
          : (admin.segmentPermissions || {});
        
        // Get segment-specific autosquarePercent
        for (const [segKey, segSettings] of Object.entries(segPerms)) {
          if (segSettings?.lotSettings?.autosquarePercent) {
            autosquarePercent = segSettings.lotSettings.autosquarePercent;
            break;
          }
        }
      }
      
      console.log(`Auto-square: Using autosquarePercent = ${autosquarePercent}%`);
      
      // For ALL segments: only mark as auto-squared, do NOT close (carry-forward to next day)
      // Trades remain OPEN for next day carry-forward
      const shouldCloseTrades = false;
      const closePercent = 0;
      console.log(`Auto-square: Segment ${segment}, shouldCloseTrades: ${shouldCloseTrades} (carry-forward mode)`);
      
      // Process trades - only mark as auto-squared, keep them OPEN
      for (const trade of trades) {
        try {
          // Mark trade as auto-squared, keep trade OPEN for carry-forward
          await Trade.findByIdAndUpdate(trade._id, {
            isAutoSquared: true,
            autoSquaredAt: new Date()
          });
          console.log(`Auto-square: Marked ${trade.tradeId} as auto-squared (trade remains OPEN for carry-forward to next day)`);
        } catch (error) {
          console.error(`Auto-square: Failed to mark ${trade.tradeId} as auto-squared:`, error);
        }
      }
      
      console.log(`Auto-square: Completed for admin ${adminId} segment ${segment}`);
      
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
