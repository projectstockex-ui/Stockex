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
   * Initialize dynamic auto-square scheduler based on backend settings
   * Reads closing times from SystemSettings and schedules jobs accordingly
   */
  static initDynamicAutoSquareScheduler() {
    console.log('EODSettlement: Initializing dynamic auto-square scheduler...');
    
    // Refresh scheduler every 5 minutes to pick up backend changes
    const refreshScheduler = async () => {
      await this.updateDynamicSchedules();
    };
    
    // Run immediately and then every 5 minutes
    refreshScheduler();
    setInterval(refreshScheduler, 5 * 60 * 1000);
    
    console.log('EODSettlement: Dynamic auto-square scheduler initialized (refreshes every 5 minutes)');
  }
  
  /**
   * Update dynamic schedules based on current backend settings
   */
  static async updateDynamicSchedules() {
    try {
      const settings = await SystemSettings.getSettings();
      const adminDefaults = settings?.adminSegmentDefaults || {};
      
      // Define segment mappings - use closingTime for all segments (generic field)
      const segmentConfigs = [
        { key: 'NSEFUT', segment: 'NSE', closeTimeKey: 'closingTime' },
        { key: 'NSEOPT', segment: 'NSE', closeTimeKey: 'closingTime' },
        { key: 'NSE-EQ', segment: 'NSE', closeTimeKey: 'closingTime' },
        { key: 'BSE-FUT', segment: 'BSE', closeTimeKey: 'closingTime' },
        { key: 'BSE-OPT', segment: 'BSE', closeTimeKey: 'closingTime' },
        { key: 'MCXFUT', segment: 'MCX', closeTimeKey: 'closingTime' },
        { key: 'MCXOPT', segment: 'MCX', closeTimeKey: 'closingTime' },
        { key: 'CRYPTOFUT', segment: 'CRYPTO', closeTimeKey: 'cryptoClosingTime' }, // Use cryptoClosingTime for crypto
        { key: 'CRYPTOOPT', segment: 'CRYPTO', closeTimeKey: 'cryptoClosingTime' },
        { key: 'FOREXFUT', segment: 'FOREX', closeTimeKey: 'cryptoClosingTime' }, // Use cryptoClosingTime for forex
        { key: 'FOREXOPT', segment: 'FOREX', closeTimeKey: 'cryptoClosingTime' },
      ];
      
      // Track unique segments and their closing times
      const segmentCloseTimes = new Map();
      
      for (const config of segmentConfigs) {
        const segSettings = adminDefaults[config.key] || {};
        const closeTime = segSettings[config.closeTimeKey] || '';
        
        if (closeTime) {
          // Parse time (HH:mm or HH:mm:ss)
          const [hours, minutes] = closeTime.split(':').map(Number);
          if (!isNaN(hours) && !isNaN(minutes)) {
            const timeKey = `${hours}:${minutes.toString().padStart(2, '0')}`;
            
            // Store the latest closing time for this segment
            if (!segmentCloseTimes.has(config.segment) || timeKey > segmentCloseTimes.get(config.segment)) {
              segmentCloseTimes.set(config.segment, timeKey);
            }
          }
        }
      }
      
      // Only schedule if closing time is set in backend (no hardcoded defaults)
      console.log('Dynamic segment close times from backend:', Object.fromEntries(segmentCloseTimes));
      
      // Schedule jobs for each segment (only if closing time is set in backend)
      for (const [segment, closeTime] of segmentCloseTimes) {
        this.scheduleSegmentAutoSquare(segment, closeTime);
      }
      
      // If no segments have closing times set, log warning
      if (segmentCloseTimes.size === 0) {
        console.log('Auto-square: No closing times set in backend for any segment. Auto-square will not run.');
      }
      
    } catch (error) {
      console.error('Error updating dynamic schedules:', error);
    }
  }
  
  /**
   * Schedule auto-square for a specific segment at a specific time
   */
  static scheduleSegmentAutoSquare(segment, closeTime) {
    const taskKey = `autosquare_${segment}`;
    
    // Destroy existing task if any
    if (this.scheduledTasks.has(taskKey)) {
      const existingTask = this.scheduledTasks.get(taskKey);
      existingTask.stop();
      this.scheduledTasks.delete(taskKey);
      console.log(`Destroyed existing auto-square task for ${segment}`);
    }
    
    // Parse close time
    const [hours, minutes] = closeTime.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) {
      console.error(`Invalid close time for ${segment}: ${closeTime}`);
      return;
    }
    
    // Create cron expression: minute hour * * 1-5 (Mon-Fri)
    const cronExpr = `${minutes} ${hours} * * 1-5`;
    
    console.log(`Scheduling auto-square for ${segment} at ${closeTime} IST (Mon-Fri)`);
    
    // Schedule the task
    const task = cron.schedule(cronExpr, async () => {
      console.log(`CRON: Auto-square starting for ${segment} at ${closeTime} IST`);
      try {
        await this.executeSegmentAutoSquare(segment);
      } catch (error) {
        console.error(`CRON: Auto-square error for ${segment}:`, error);
      }
    }, {
      timezone: 'Asia/Kolkata'
    });
    
    this.scheduledTasks.set(taskKey, task);
  }
  
  /**
   * Execute auto-square for a specific segment
   */
  static async executeSegmentAutoSquare(segment) {
    try {
      console.log(`Auto-square: Starting for ${segment}`);
      
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
        segmentQuery = {
          exchange: { $in: ['NSE', 'BSE', 'NFO'] },
          segment: { $nin: ['MCX', 'MCXFUT', 'MCXOPT', 'CRYPTOFUT', 'CRYPTOOPT', 'FOREXFUT', 'FOREXOPT'] }
        };
      }
      
      // Find all OPEN positions for this segment (all product types)
      const positions = await Trade.find({
        status: 'OPEN',
        ...segmentQuery
      }).populate('user');
      
      console.log(`Auto-square: Found ${positions.length} open positions for ${segment}`);
      
      if (positions.length === 0) {
        return { closedCount: 0, segment };
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
            `AUTO_SQUARE_${segment}`,
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
      
      console.log(`Auto-square: Completed for ${segment}. Closed: ${closedCount}, Failed: ${failedCount}`);
      
      return { closedCount, failedCount, segment };
      
    } catch (error) {
      console.error(`Auto-square: Error for ${segment}:`, error);
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
