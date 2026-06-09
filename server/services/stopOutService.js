import User from '../models/User.js';
import Trade from '../models/Trade.js';
import Notification from '../models/Notification.js';
import WalletService from './walletService.js';
import WalletLedger from '../models/WalletLedger.js';
import { getLTPMapForTrades, cacheKeyForTrade } from './ltpResolutionService.js';
import { runMarginAwareCloses } from './eodAutoSquareOffService.js';
import {
  alignCryptoExitToEntryUnit,
  computeAdminBookPoolForPatti,
  roundMoney,
} from '../utils/bookPnL.js';
import { profitAllowedForWallet, walletTypeFromWalletField } from '../utils/walletBlock.js';

/**
 * TradePro Trading Engine - Stop-Out Service
 * 
 * Handles automatic position liquidation when margin level drops below stop-out threshold.
 * Closes positions starting with the most losing to restore margin level.
 */

let io = null;

class StopOutService {
  
  /**
   * Initialize with Socket.IO instance
   * @param {Object} socketIO - Socket.IO server instance
   */
  static init(socketIO) {
    io = socketIO;
  }
  
  /**
   * Execute stop-out for a user
   * This is the main entry point called by MarginMonitorService
   * 
   * @param {String} userId - User ID
   * @param {String} walletField - Wallet field name
   * @param {Object} walletState - Current wallet state
   * @param {Object} riskConfig - Risk configuration
   */
  static async executeStopOut(userId, walletField, walletState, riskConfig) {
    try {
      const user = await User.findById(userId);
      if (!user) return;
      
      const stopOutLevel = riskConfig.STOP_OUT_LEVEL || 50;
      const initialMarginLevel = walletState.marginLevel;
      
      console.log(`STOP-OUT STARTED: User ${user.userId}, Margin Level: ${initialMarginLevel?.toFixed(1)}%`);
      
      // Step 1: Cancel all pending/limit orders first
      const cancelledOrders = await this.cancelPendingOrders(userId, walletField);
      console.log(`Cancelled ${cancelledOrders} pending orders`);
      
      // Recalculate wallet after cancelling orders
      let currentWalletState = await WalletService.recalculateWallet(userId);
      currentWalletState = currentWalletState[walletField];
      
      // Check if cancelling pending orders was enough
      if (currentWalletState.marginLevel > stopOutLevel) {
        console.log(`Stop-out resolved by cancelling pending orders. New margin level: ${currentWalletState.marginLevel?.toFixed(1)}%`);
        await this.notifyStopOutComplete(userId, user.userId, walletField, initialMarginLevel, currentWalletState.marginLevel, 0);
        return;
      }
      
      // Step 2: Get open positions sorted by loss (most losing first)
      const segmentQuery = WalletService.buildSegmentQuery(walletField);
      const positions = await Trade.find({
        user: userId,
        status: 'OPEN',
        ...segmentQuery
      }).sort({ unrealizedPnL: 1 }); // Ascending = most negative first
      
      if (positions.length === 0) {
        console.log('No open positions to close');
        return;
      }
      
      // Step 3: Close positions one by one until margin is restored
      let closedCount = 0;
      let totalPnLRealized = 0;
      const closedPositions = [];
      
      for (const position of positions) {
        // Close position at current market price
        const closeResult = await this.closePosition(position, user, 'STOP_OUT');
        
        if (closeResult.success) {
          closedCount++;
          totalPnLRealized += closeResult.realizedPnL;
          closedPositions.push({
            tradeId: position.tradeId,
            symbol: position.symbol,
            side: position.side,
            quantity: position.quantity,
            entryPrice: position.entryPrice,
            closePrice: closeResult.closePrice,
            pnl: closeResult.realizedPnL
          });
          
          // Recalculate wallet after each close
          currentWalletState = await WalletService.recalculateWallet(userId);
          currentWalletState = currentWalletState[walletField];
          
          console.log(`Closed ${position.symbol} ${position.side}. PnL: ${closeResult.realizedPnL.toFixed(2)}. New margin level: ${currentWalletState.marginLevel?.toFixed(1) || '--'}%`);
          
          // Check if margin is restored
          if (currentWalletState.marginLevel === null || currentWalletState.marginLevel > stopOutLevel) {
            console.log(`Margin restored after closing ${closedCount} positions`);
            break;
          }
        }
      }
      
      // Step 4: Handle negative balance
      const finalWallet = user[walletField];
      const balance = finalWallet?.tradingBalance || finalWallet?.balance || 0;
      
      if (balance < 0 && currentWalletState.usedMargin === 0) {
        console.log(`NEGATIVE BALANCE: User ${user.userId} has negative balance: ${balance}`);
        
        // Flag user for admin review
        await User.updateOne(
          { _id: userId },
          { 
            $set: { 
              [`${walletField}.negativeBalanceFlag`]: true,
              tradingStatus: 'BLOCKED'
            }
          }
        );
        
        // Notify admin
        await Notification.create({
          title: 'Negative Balance Alert',
          subject: `🚨 User ${user.userId} has negative balance after stop-out`,
          description: `User ${user.userId} (${user.username}) has a negative balance of ${Math.abs(balance).toFixed(2)} after stop-out. Trading has been blocked. Admin action required.`,
          senderType: 'SYSTEM',
          targetType: 'ADMIN',
          targetAdminCode: user.adminCode,
          priority: 'CRITICAL'
        });
      }
      
      // Step 5: Log and notify
      await this.logStopOut(userId, user.userId, walletField, initialMarginLevel, currentWalletState.marginLevel, closedPositions);
      await this.notifyStopOutComplete(userId, user.userId, walletField, initialMarginLevel, currentWalletState.marginLevel, closedCount);
      
      // Push to UI
      if (io) {
        io.to(userId).emit('stop_out_complete', {
          walletField,
          initialMarginLevel,
          finalMarginLevel: currentWalletState.marginLevel,
          positionsClosed: closedCount,
          totalPnLRealized,
          closedPositions,
          timestamp: new Date()
        });
      }
      
    } catch (error) {
      console.error('StopOutService.executeStopOut error:', error);
    }
  }
  
  /**
   * Cancel all pending orders for a user
   * @param {String} userId - User ID
   * @param {String} walletField - Wallet field name
   * @returns {Number} - Number of orders cancelled
   */
  static async cancelPendingOrders(userId, walletField) {
    const segmentQuery = WalletService.buildSegmentQuery(walletField);
    
    const result = await Trade.updateMany(
      {
        user: userId,
        status: 'PENDING',
        ...segmentQuery
      },
      {
        $set: {
          status: 'CANCELLED',
          closeReason: 'RMS',
          closedBy: 'STOP_OUT',
          closedAt: new Date()
        }
      }
    );
    
    return result.modifiedCount || 0;
  }
  
  /**
   * Close a single position
   * @param {Object} position - Trade document
   * @param {Object} user - User document
   * @param {String} closedBy - Who closed the position
   * @param {Number|null} exitPriceOverride - LTP / mark (preferred over entry for EOD)
   * @returns {Object} - { success, realizedPnL, closePrice }
   */
  static async closePosition(position, user, closedBy = 'STOP_OUT', exitPriceOverride = null) {
    try {
      let closePrice = position.currentPrice || position.entryPrice;
      if (exitPriceOverride != null && Number(exitPriceOverride) > 0) {
        closePrice = Number(exitPriceOverride);
      }
      closePrice = alignCryptoExitToEntryUnit(position, closePrice);
      const quantity = position.quantity || 0;
      const mult = position.side === 'BUY' ? 1 : -1;
      const realizedPnL = roundMoney((closePrice - position.entryPrice) * mult * quantity);

      // Deduct any charges
      const charges = position.charges?.total || position.totalCharges || 0;
      const netPnL = roundMoney(realizedPnL - charges);
      
      const closeReason = closedBy === 'EOD_SQUAREOFF' ? 'TIME_BASED' : 'RMS';
      const allowedClosedBy = new Set([
        'USER',
        'STOP_OUT',
        'MARGIN_CALL',
        'DAILY_LIMIT',
        'EOD_SQUAREOFF',
        'ADMIN',
        'SYSTEM',
      ]);
      const closedByField = allowedClosedBy.has(closedBy) ? closedBy : 'STOP_OUT';

      // Update position
      await Trade.updateOne(
        { _id: position._id },
        {
          $set: {
            status: 'CLOSED',
            exitPrice: closePrice,
            effectiveExitPrice: closePrice,
            closeReason,
            closedBy: closedByField,
            closedAt: new Date(),
            realizedPnL: realizedPnL,
            pnl: realizedPnL,
            netPnL: netPnL,
            unrealizedPnL: 0,
            adminPnL:
              position.bookType === 'B_BOOK'
                ? computeAdminBookPoolForPatti({
                    ...position,
                    exitPrice: closePrice,
                    effectiveExitPrice: closePrice,
                    status: 'CLOSED',
                    realizedPnL,
                    netPnL,
                  })
                : 0
          }
        }
      );
      
      // Update wallet balance
      const walletField = WalletService.getWalletFieldFromTrade(position);
      const marginToRelease = position.marginUsed || position.requiredMargin || 0;
      const blockKind = walletTypeFromWalletField(walletField);
      const balancePnL =
        blockKind != null ? profitAllowedForWallet(user, blockKind, netPnL) : netPnL;
      
      await User.updateOne(
        { _id: user._id },
        {
          $inc: {
            [`${walletField}.tradingBalance`]: balancePnL,
            [`${walletField}.balance`]: balancePnL,
            [`${walletField}.usedMargin`]: -marginToRelease,
            [`${walletField}.totalRealizedPnL`]: balancePnL,
            [`${walletField}.todayRealizedPnL`]: balancePnL
          }
        }
      );
      
      // Create ledger entry
      await WalletLedger.create({
        ownerType: 'USER',
        ownerId: user._id,
        adminCode: user.adminCode,
        type: balancePnL >= 0 ? 'CREDIT' : 'DEBIT',
        reason: 'TRADE_PNL',
        amount: Math.abs(balancePnL),
        balanceAfter: (user[walletField]?.tradingBalance || user[walletField]?.balance || 0) + balancePnL,
        reference: { type: 'Trade', id: position._id },
        description: `Auto-square: ${position.symbol} ${position.side} closed`
      });
      
      return {
        success: true,
        realizedPnL: netPnL,
        closePrice
      };
      
    } catch (error) {
      console.error('Error closing position:', error);
      return {
        success: false,
        realizedPnL: 0,
        closePrice: 0
      };
    }
  }
  
  /**
   * Log stop-out event
   */
  static async logStopOut(userId, userCode, walletField, initialMarginLevel, finalMarginLevel, closedPositions) {
    // Could create a StopOutLog model for detailed tracking
    console.log('STOP-OUT LOG:', {
      userId,
      userCode,
      walletField,
      initialMarginLevel,
      finalMarginLevel,
      positionsClosed: closedPositions.length,
      closedPositions,
      timestamp: new Date()
    });
  }
  
  /**
   * Notify user about stop-out completion
   */
  static async notifyStopOutComplete(userId, userCode, walletField, initialMarginLevel, finalMarginLevel, closedCount) {
    await Notification.create({
      title: 'Stop-Out Executed',
      subject: `🔴 ${closedCount} positions auto-closed due to low margin`,
      description: `Your margin level dropped to ${initialMarginLevel?.toFixed(1)}% which triggered automatic position closure. ` +
        `${closedCount} position(s) were closed. Your new margin level is ${finalMarginLevel?.toFixed(1) || '--'}%. ` +
        `Please add funds to continue trading.`,
      senderType: 'SYSTEM',
      targetType: 'SINGLE_USER',
      targetUserId: userId,
      priority: 'HIGH'
    });
  }
  
  /**
   * Execute daily loss limit stop-out
   * Closes ALL positions when daily loss limit is exceeded
   * 
   * @param {String} userId - User ID
   * @param {String} walletField - Wallet field name
   */
  static async executeDailyLossStopOut(userId, walletField) {
    try {
      const user = await User.findById(userId);
      if (!user) return;
      
      console.log(`DAILY LOSS LIMIT STOP-OUT: User ${user.userId}`);
      
      // Get all open positions
      const segmentQuery = WalletService.buildSegmentQuery(walletField);
      const positions = await Trade.find({
        user: userId,
        status: 'OPEN',
        ...segmentQuery
      });
      
      let closedCount = 0;
      let totalPnL = 0;
      
      for (const position of positions) {
        const result = await this.closePosition(position, user, 'DAILY_LIMIT');
        if (result.success) {
          closedCount++;
          totalPnL += result.realizedPnL;
        }
      }
      
      // Block trading for the day
      const tomorrow = new Date();
      tomorrow.setHours(0, 0, 0, 0);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      await User.updateOne(
        { _id: userId },
        {
          $set: {
            tradingBlockedUntil: tomorrow,
            tradingStatus: 'BLOCKED'
          }
        }
      );
      
      // Notify user
      await Notification.create({
        title: 'Daily Loss Limit Reached',
        subject: `🛑 Trading blocked - Daily loss limit exceeded`,
        description: `You have exceeded your daily loss limit. All ${closedCount} positions have been closed. ` +
          `Total P&L: ${totalPnL.toFixed(2)}. Trading will be re-enabled tomorrow.`,
        senderType: 'SYSTEM',
        targetType: 'SINGLE_USER',
        targetUserId: userId,
        priority: 'CRITICAL'
      });
      
      // Push to UI
      if (io) {
        io.to(userId).emit('daily_loss_limit', {
          walletField,
          positionsClosed: closedCount,
          totalPnL,
          tradingBlockedUntil: tomorrow,
          timestamp: new Date()
        });
      }
      
    } catch (error) {
      console.error('Error executing daily loss stop-out:', error);
    }
  }
  
  /**
   * Execute EOD (End of Day) square-off for MIS positions
   * @param {String} segment - Segment to square off (NSE, MCX, etc.)
   */
  static async executeEODSquareOff(segment = 'NSE') {
    let marginSummary = null;
    try {
      console.log(`EOD SQUARE-OFF: Starting for ${segment}`);
      
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

      marginSummary = await runMarginAwareCloses(segment);
      console.log('[EOD] margin-aware closes:', marginSummary);
      
      // Find all MIS positions (after margin pass)
      const positions = await Trade.find({
        status: 'OPEN',
        productType: { $in: ['MIS', 'INTRADAY'] },
        ...segmentQuery
      }).populate('user');
      
      const posObjs = positions.map((p) => (typeof p.toObject === 'function' ? p.toObject() : p));
      const ltpMap = await getLTPMapForTrades(posObjs);
      
      console.log(`Found ${positions.length} MIS positions to square off`);
      
      let closedCount = 0;
      
      for (const position of positions) {
        if (!position.user) continue;
        const po = position.toObject?.() ? position.toObject() : position;
        const ltp = ltpMap.get(cacheKeyForTrade(po)) || position.currentPrice || position.entryPrice;
        
        const result = await this.closePosition(position, position.user, 'EOD_SQUAREOFF', ltp);
        if (result.success) {
          closedCount++;
        }
      }
      
      console.log(`EOD SQUARE-OFF COMPLETE: Closed ${closedCount} positions`);
      
      // Recalculate wallets for all affected users
      const userIds = [...new Set(positions.map(p => p.user?._id?.toString()).filter(Boolean))];
      for (const userId of userIds) {
        await WalletService.recalculateWallet(userId);
      }
      
      return {
        closedCount,
        totalPositions: positions.length,
        marginSummary,
      };
      
    } catch (error) {
      console.error('Error executing EOD square-off:', error);
      return { closedCount: 0, totalPositions: 0, marginSummary: null, error: error.message };
    }
  }
}

export default StopOutService;
