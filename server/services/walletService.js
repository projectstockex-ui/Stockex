import User from '../models/User.js';
import Trade from '../models/Trade.js';
import RiskConfig from '../models/RiskConfig.js';

/**
 * TradePro Trading Engine - Wallet Service
 * Core utility for wallet recalculation and margin monitoring
 * 
 * CRITICAL: This service implements the heartbeat of the trading engine
 * The chain: PnL → Equity → Free Margin → Margin Level → Stop-Out Check
 * must execute on EVERY price tick
 */
class WalletService {
  
  /**
   * Get the appropriate wallet based on segment
   * @param {Object} user - User document
   * @param {String} segment - Trading segment (EQUITY, FNO, MCX, etc.)
   * @returns {Object} - Wallet object reference
   */
  static getWalletBySegment(user, segment) {
    const seg = segment?.toUpperCase() || '';
    
    if (seg === 'BINANCE' || seg === 'CRYPTOFUT' || seg === 'CRYPTOOPT') {
      return { wallet: user.cryptoWallet, field: 'cryptoWallet' };
    }
    if (seg === 'FOREX' || seg === 'FOREXFUT' || seg === 'FOREXOPT') {
      return { wallet: user.forexWallet, field: 'forexWallet' };
    }
    
    if (seg === 'MCX' || seg === 'MCXFUT' || seg === 'MCXOPT' || seg === 'COMMODITY') {
      return { wallet: user.mcxWallet, field: 'mcxWallet' };
    }
    
    // Default to regular trading wallet (NSE, BSE, NFO, etc.)
    return { wallet: user.wallet, field: 'wallet' };
  }
  
  /**
   * Determine segment from trade
   * @param {Object} trade - Trade document
   * @returns {String} - Wallet field name
   */
  static getWalletFieldFromTrade(trade) {
    if (trade.isCrypto || trade.exchange === 'BINANCE') {
      return 'cryptoWallet';
    }
    if (trade.isForex || trade.exchange === 'FOREX') {
      return 'forexWallet';
    }
    const tSeg = String(trade.segment || '').toUpperCase();
    if (tSeg === 'FOREX' || tSeg === 'FOREXFUT' || tSeg === 'FOREXOPT') {
      return 'forexWallet';
    }
    if (trade.exchange === 'MCX' || trade.segment === 'MCX' || 
        trade.segment === 'MCXFUT' || trade.segment === 'MCXOPT') {
      return 'mcxWallet';
    }
    return 'wallet';
  }
  
  /**
   * Calculate unrealized PnL for a single position
   * @param {Object} position - Trade/Position document
   * @param {Number} currentPrice - Current market price
   * @returns {Number} - Unrealized PnL
   */
  static calculatePositionPnL(position, currentPrice) {
    const price = currentPrice || position.currentPrice || position.entryPrice;
    const quantity = position.quantity || 0;
    const contractSize = position.contractSize || position.lotSize || 1;
    const entryPrice = position.entryPrice || 0;
    
    if (position.side === 'BUY') {
      // Long position: profit when price goes up
      return (price - entryPrice) * quantity * contractSize;
    } else {
      // Short position: profit when price goes down
      return (entryPrice - price) * quantity * contractSize;
    }
  }
  
  /**
   * Get user's leverage for a segment
   * @param {Object} user - User document
   * @param {String} segment - Segment name
   * @returns {Number} - Leverage value
   */
  static async getUserLeverage(user, segment) {
    try {
      // Get leverage from user's segment permissions or parent admin's settings
      const segUpper = segment?.toUpperCase() || 'NSEFUT';
      const userSegmentSettings = user.segmentPermissions?.[segUpper];
      
      // Priority: user's lotSettings.intradayLeverage > user's intradayLeverage > default
      let leverage = 1;
      
      if (userSegmentSettings?.lotSettings?.intradayLeverage) {
        leverage = userSegmentSettings.lotSettings.intradayLeverage;
      } else if (userSegmentSettings?.intradayLeverage) {
        leverage = userSegmentSettings.intradayLeverage;
      } else if (userSegmentSettings?.exposureIntraday) {
        leverage = userSegmentSettings.exposureIntraday;
      }
      
      return leverage > 0 ? leverage : 1;
    } catch (error) {
      console.error('Error getting user leverage:', error);
      return 1;
    }
  }

  /**
   * Recalculate wallet state for a user
   * This is the CORE function that maintains wallet integrity
   * 
   * @param {String} userId - User ID
   * @param {String} segment - Segment to recalculate (optional, recalculates all if not provided)
   * @returns {Object} - Updated wallet state
   */
  static async recalculateWallet(userId, segment = null) {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');
    
    // Determine which wallets to recalculate
    const walletsToUpdate = segment 
      ? [this.getWalletBySegment(user, segment)]
      : [
          { wallet: user.wallet, field: 'wallet' },
          { wallet: user.cryptoWallet, field: 'cryptoWallet' },
          { wallet: user.forexWallet, field: 'forexWallet' },
          { wallet: user.mcxWallet, field: 'mcxWallet' }
        ];
    
    const updateFields = {};
    const results = {};
    
    for (const { wallet, field } of walletsToUpdate) {
      if (!wallet) continue;
      
      // Build query for open positions in this wallet's segment
      const segmentQuery = this.buildSegmentQuery(field);
      
      // Get all open positions for this wallet
      const openPositions = await Trade.find({
        user: userId,
        status: 'OPEN',
        ...segmentQuery
      });
      
      // Calculate totals from open positions
      let totalUsedMargin = 0;
      let totalUnrealizedPnL = 0;
      let positionSegment = null;
      
      for (const position of openPositions) {
        totalUsedMargin += position.marginUsed || position.requiredMargin || 0;
        totalUnrealizedPnL += position.unrealizedPnL || 0;
        if (!positionSegment) {
          positionSegment = position.segment;
        }
      }
      
      // Get balance (this should NOT change from price movement)
      const balance = wallet.tradingBalance || wallet.balance || 0;
      
      // Get user's leverage for this segment
      const leverage = await this.getUserLeverage(user, positionSegment);
      
      // Calculate available margin with leverage: (balance * leverage) - usedMargin
      // If there's unrealized loss, subtract it from available margin
      const leveragedBalance = balance * leverage;
      const unrealizedLoss = totalUnrealizedPnL < 0 ? Math.abs(totalUnrealizedPnL) : 0;
      
      // Available margin calculation as per user's logic:
      // Initial: balance * leverage
      // With position: (balance * leverage) - usedMargin
      // With loss: (balance * leverage) - usedMargin - unrealizedLoss
      const availableMargin = leveragedBalance - totalUsedMargin - unrealizedLoss;
      
      // Calculate equity = balance + unrealizedPnL (for margin level calculation)
      const equity = balance + totalUnrealizedPnL;
      
      // Calculate margin level = (equity / usedMargin) * 100
      // Infinity when usedMargin = 0
      const marginLevel = totalUsedMargin > 0 
        ? (equity / totalUsedMargin) * 100 
        : null; // null represents Infinity (display as '--' in UI)
      
      // Update wallet fields
      updateFields[`${field}.equity`] = Math.round(equity * 100) / 100;
      updateFields[`${field}.usedMargin`] = Math.round(totalUsedMargin * 100) / 100;
      updateFields[`${field}.freeMargin`] = Math.round(availableMargin * 100) / 100;
      updateFields[`${field}.marginLevel`] = marginLevel ? Math.round(marginLevel * 100) / 100 : null;
      updateFields[`${field}.totalUnrealizedPnL`] = Math.round(totalUnrealizedPnL * 100) / 100;
      updateFields[`${field}.lastUpdatedAt`] = new Date();
      updateFields[`${field}.leverage`] = leverage;
      
      results[field] = {
        balance,
        equity: Math.round(equity * 100) / 100,
        usedMargin: Math.round(totalUsedMargin * 100) / 100,
        freeMargin: Math.round(availableMargin * 100) / 100,
        marginLevel: marginLevel ? Math.round(marginLevel * 100) / 100 : null,
        totalUnrealizedPnL: Math.round(totalUnrealizedPnL * 100) / 100,
        leverage,
        openPositions: openPositions.length
      };
    }
    
    // Update user document
    if (Object.keys(updateFields).length > 0) {
      await User.updateOne({ _id: userId }, { $set: updateFields });
    }
    
    return results;
  }
  
  /**
   * Build MongoDB query for segment-specific positions
   * @param {String} walletField - Wallet field name
   * @returns {Object} - MongoDB query object
   */
  static buildSegmentQuery(walletField) {
    if (walletField === 'cryptoWallet') {
      return {
        $or: [
          { isCrypto: true },
          { exchange: 'BINANCE' }
        ]
      };
    }
    
    if (walletField === 'forexWallet') {
      return {
        $or: [
          { isForex: true },
          { exchange: 'FOREX' },
          { segment: 'FOREX' },
          { segment: 'FOREXFUT' },
          { segment: 'FOREXOPT' }
        ]
      };
    }
    
    if (walletField === 'mcxWallet') {
      return {
        $or: [
          { exchange: 'MCX' },
          { segment: 'MCX' },
          { segment: 'MCXFUT' },
          { segment: 'MCXOPT' }
        ]
      };
    }
    
    // Regular wallet - exclude crypto, forex, MCX
    return {
      isCrypto: { $ne: true },
      isForex: { $ne: true },
      exchange: { $nin: ['BINANCE', 'MCX', 'FOREX'] },
      segment: { $nin: ['FOREX', 'FOREXFUT', 'FOREXOPT', 'MCX', 'MCXFUT', 'MCXOPT'] }
    };
  }
  
  /**
   * Update position PnL and recalculate wallet
   * Called on every price tick for affected positions
   * 
   * @param {String} token - Instrument token
   * @param {Number} newPrice - New market price
   * @returns {Array} - Array of affected user IDs with their wallet states
   */
  static async updatePositionsByToken(token, newPrice) {
    // Find all open positions for this token
    const positions = await Trade.find({
      token: token.toString(),
      status: 'OPEN'
    });
    
    if (positions.length === 0) return [];
    
    // Group positions by user
    const userPositions = {};
    for (const pos of positions) {
      const userId = pos.user.toString();
      if (!userPositions[userId]) {
        userPositions[userId] = [];
      }
      userPositions[userId].push(pos);
    }
    
    const results = [];
    
    // Update each position and recalculate user wallets
    for (const [userId, userPos] of Object.entries(userPositions)) {
      // Update PnL for each position
      for (const position of userPos) {
        const unrealizedPnL = this.calculatePositionPnL(position, newPrice);
        
        await Trade.updateOne(
          { _id: position._id },
          { 
            $set: { 
              currentPrice: newPrice,
              unrealizedPnL: Math.round(unrealizedPnL * 100) / 100
            }
          }
        );
      }
      
      // Recalculate wallet for this user
      // Determine segment from first position
      const segment = userPos[0].segment;
      const walletState = await this.recalculateWallet(userId, segment);
      
      results.push({
        userId,
        walletState,
        positionsUpdated: userPos.length
      });
    }
    
    return results;
  }
  
  /**
   * Check margin status and return action needed
   * @param {Object} walletState - Wallet state object
   * @param {Object} riskConfig - Risk configuration
   * @returns {Object} - { action: 'NONE'|'MARGIN_CALL'|'STOP_OUT', marginLevel }
   */
  static checkMarginStatus(walletState, riskConfig) {
    const marginLevel = walletState.marginLevel;
    
    // No positions = no margin check needed
    if (marginLevel === null || marginLevel === Infinity) {
      return { action: 'NONE', marginLevel: null, status: 'HEALTHY' };
    }
    
    const stopOutLevel = riskConfig?.STOP_OUT_LEVEL || 50;
    const marginCallLevel = riskConfig?.MARGIN_CALL_LEVEL || 100;
    const healthyLevel = riskConfig?.HEALTHY_LEVEL || 200;
    
    if (marginLevel <= stopOutLevel) {
      return { action: 'STOP_OUT', marginLevel, status: 'CRITICAL' };
    }
    
    if (marginLevel <= marginCallLevel) {
      return { action: 'MARGIN_CALL', marginLevel, status: 'WARNING' };
    }
    
    if (marginLevel < healthyLevel) {
      return { action: 'NONE', marginLevel, status: 'CAUTION' };
    }
    
    return { action: 'NONE', marginLevel, status: 'HEALTHY' };
  }
  
  /**
   * Get wallet summary for UI display
   * @param {String} userId - User ID
   * @returns {Object} - Wallet summary for all segments
   */
  static async getWalletSummary(userId) {
    const user = await User.findById(userId).lean();
    if (!user) throw new Error('User not found');
    
    const riskConfig = await RiskConfig.getConfig(user.adminCode);
    
    const wallets = {
      trading: {
        ...this.extractWalletFields(user.wallet),
        segment: 'NSE/BSE/NFO'
      },
      crypto: {
        ...this.extractWalletFields(user.cryptoWallet),
        segment: 'BINANCE'
      },
      forex: {
        ...this.extractWalletFields(user.forexWallet),
        segment: 'FOREX'
      },
      mcx: {
        ...this.extractWalletFields(user.mcxWallet),
        segment: 'MCX'
      }
    };
    
    // Add margin status for each wallet
    for (const key of Object.keys(wallets)) {
      wallets[key].marginStatus = this.checkMarginStatus(wallets[key], riskConfig);
    }
    
    return {
      wallets,
      riskLevels: {
        stopOutLevel: riskConfig.STOP_OUT_LEVEL,
        marginCallLevel: riskConfig.MARGIN_CALL_LEVEL,
        healthyLevel: riskConfig.HEALTHY_LEVEL
      }
    };
  }
  
  /**
   * Extract wallet fields for summary
   * @param {Object} wallet - Wallet object
   * @returns {Object} - Extracted fields
   */
  static extractWalletFields(wallet) {
    if (!wallet) {
      return {
        balance: 0,
        equity: 0,
        usedMargin: 0,
        freeMargin: 0,
        marginLevel: null,
        totalUnrealizedPnL: 0,
        totalRealizedPnL: 0,
        marginCallActive: false
      };
    }
    
    return {
      balance: wallet.tradingBalance || wallet.balance || 0,
      equity: wallet.equity || 0,
      usedMargin: wallet.usedMargin || 0,
      freeMargin: wallet.freeMargin || 0,
      marginLevel: wallet.marginLevel,
      totalUnrealizedPnL: wallet.totalUnrealizedPnL || 0,
      totalRealizedPnL: wallet.totalRealizedPnL || 0,
      marginCallActive: wallet.marginCallActive || false
    };
  }
  
  /**
   * Set margin call status for a user
   * @param {String} userId - User ID
   * @param {String} walletField - Wallet field name
   * @param {Boolean} active - Margin call active status
   */
  static async setMarginCallStatus(userId, walletField, active) {
    await User.updateOne(
      { _id: userId },
      { 
        $set: { 
          [`${walletField}.marginCallActive`]: active,
          [`${walletField}.lastUpdatedAt`]: new Date()
        }
      }
    );
  }
  
  /**
   * Add commission to wallet totals
   * @param {String} userId - User ID
   * @param {String} walletField - Wallet field name
   * @param {Number} commission - Commission amount
   */
  static async addCommission(userId, walletField, commission) {
    await User.updateOne(
      { _id: userId },
      { 
        $inc: { [`${walletField}.totalCommissions`]: commission }
      }
    );
  }
  
  /**
   * Add realized PnL to wallet
   * @param {String} userId - User ID
   * @param {String} walletField - Wallet field name
   * @param {Number} pnl - Realized PnL
   */
  static async addRealizedPnL(userId, walletField, pnl) {
    await User.updateOne(
      { _id: userId },
      { 
        $inc: { 
          [`${walletField}.totalRealizedPnL`]: pnl,
          [`${walletField}.todayRealizedPnL`]: pnl
        }
      }
    );
  }
  
  /**
   * Reset daily counters (called at start of trading day)
   * @param {String} userId - User ID (optional, resets all if not provided)
   */
  static async resetDailyCounters(userId = null) {
    const query = userId ? { _id: userId } : {};
    
    await User.updateMany(query, {
      $set: {
        'wallet.todayRealizedPnL': 0,
        'wallet.todayUnrealizedPnL': 0,
        'cryptoWallet.todayRealizedPnL': 0,
        'forexWallet.todayRealizedPnL': 0,
        'mcxWallet.todayRealizedPnL': 0,
        'mcxWallet.todayUnrealizedPnL': 0
      }
    });
  }
}

export default WalletService;
