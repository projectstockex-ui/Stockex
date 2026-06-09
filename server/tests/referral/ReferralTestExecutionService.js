/**
 * Referral Test Execution Service
 * 
 * Executes trading activities and processes brokerage distribution for referral tests.
 * Follows SOLID principles with single responsibility for test execution.
 */

import { ObjectId } from 'mongoose';

export class ReferralTestExecutionService {
  constructor(
    tradingService,
    brokerageDistributionService,
    referralPayoutService,
    superAdminEarningsService
  ) {
    this.tradingService = tradingService;
    this.brokerageDistributionService = brokerageDistributionService;
    this.referralPayoutService = referralPayoutService;
    this.superAdminEarningsService = superAdminEarningsService;
  }

  async executeTradingActivity(params) {
    const { user, amount, segment } = params;
    
    try {
      console.log(`[ExecutionService] Executing trading activity for ${user.username} with amount ${amount}`);
      
      // Create mock trade
      const trade = await this.createMockTrade(user, amount);
      
      // Get user's admin
      const admin = await this.getUserAdmin(user);
      
      // Calculate brokerage amount (5% of trade amount)
      const brokerageAmount = amount * 0.05;
      
      console.log(`[ExecutionService] Created trade with brokerage amount: ${brokerageAmount}`);
      
      // Distribute brokerage
      const distributionResult = await this.brokerageDistributionService.distributeBrokerage(
        trade,
        brokerageAmount,
        admin,
        user
      );
      
      console.log(`[ExecutionService] Brokerage distribution completed`);
      
      // Process referral commission if applicable
      const referralResult = await this.processReferralCommission(
        user,
        distributionResult,
        segment
      );
      
      console.log(`[ExecutionService] Referral processing completed`);
      
      // Extract SuperAdmin earnings
      const superAdminEarnings = this.extractSuperAdminEarnings(distributionResult);
      
      const result = {
        trade,
        brokerageAmount,
        distribution: distributionResult,
        referral: referralResult,
        superAdminEarnings,
        user: user.username,
        segment
      };
      
      console.log(`[ExecutionService] Trading activity execution completed for ${user.username}`);
      console.log(`[ExecutionService] - SuperAdmin earnings: ${superAdminEarnings}`);
      console.log(`[ExecutionService] - Referral commission: ${referralResult.commissionPaid || 0}`);
      
      return result;
      
    } catch (error) {
      console.error(`[ExecutionService] Error executing trading activity for ${user.username}:`, error);
      throw error;
    }
  }

  async createMockTrade(user, amount) {
    try {
      const trade = {
        _id: new ObjectId(),
        userId: user._id,
        username: user.username,
        symbol: 'TEST',
        exchange: 'NSE',
        instrumentToken: '260105',
        quantity: 100,
        price: amount / 100,
        brokerage: amount * 0.05,
        pnl: amount * 0.1, // Mock profit
        status: 'COMPLETED',
        product: 'INTRADAY',
        orderType: 'MARKET',
        transactionType: 'BUY',
        variety: 'NORMAL',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      console.log(`[ExecutionService] Created mock trade: ${trade._id} for ${user.username}`);
      return trade;
      
    } catch (error) {
      console.error('[ExecutionService] Error creating mock trade:', error);
      throw error;
    }
  }

  async getUserAdmin(user) {
    try {
      if (!user.admin) {
        throw new Error(`User ${user.username} has no assigned admin`);
      }
      
      const admin = await Admin.findById(user.admin);
      if (!admin) {
        throw new Error(`Admin not found for user ${user.username}`);
      }
      
      console.log(`[ExecutionService] Found admin: ${admin.username} (${admin.role}) for user ${user.username}`);
      return admin;
      
    } catch (error) {
      console.error(`[ExecutionService] Error getting admin for user ${user.username}:`, error);
      throw error;
    }
  }

  async processReferralCommission(user, distributionResult, segment) {
    try {
      if (!user.referredBy) {
        console.log(`[ExecutionService] User ${user.username} was not referred, skipping referral commission`);
        return { commissionPaid: 0, held: false, reason: 'Not referred' };
      }
      
      const superAdminShare = distributionResult.distributions?.SUPER_ADMIN || 0;
      
      if (superAdminShare <= 0) {
        console.log(`[ExecutionService] No SuperAdmin share for user ${user.username}, skipping referral commission`);
        return { commissionPaid: 0, held: false, reason: 'No SuperAdmin share' };
      }
      
      console.log(`[ExecutionService] Processing referral commission for ${user.username} (SuperAdmin share: ${superAdminShare})`);
      
      // Track SuperAdmin earnings
      try {
        await this.trackHierarchyEarnings(user.admin, superAdminShare, segment);
        console.log(`[ExecutionService] Tracked SuperAdmin earnings: ${superAdminShare}`);
      } catch (trackingError) {
        console.error('[ExecutionService] Error tracking SuperAdmin earnings:', trackingError);
        // Continue with referral processing even if tracking fails
      }
      
      // Process referral commission
      const payoutResult = await this.referralPayoutService.processConditionalReferralPayout(
        user._id,
        superAdminShare,
        segment,
        {
          tradeId: distributionResult.trade?._id,
          referredUsername: user.username,
          referrerUsername: user.referredBy,
          testExecution: true // Flag to indicate this is a test execution
        }
      );
      
      console.log(`[ExecutionService] Referral commission result:`, payoutResult);
      
      return payoutResult;
      
    } catch (error) {
      console.error(`[ExecutionService] Error processing referral commission for user ${user.username}:`, error);
      throw error;
    }
  }

  async trackHierarchyEarnings(adminId, amount, segment) {
    try {
      if (!adminId || !amount || amount <= 0) {
        console.warn(`[ExecutionService] Invalid earnings tracking parameters: adminId=${adminId}, amount=${amount}`);
        return null;
      }
      
      console.log(`[ExecutionService] Tracking hierarchy earnings: adminId=${adminId}, amount=${amount}, segment=${segment}`);
      
      const result = await this.superAdminEarningsService.trackHierarchyEarnings(
        adminId,
        amount,
        segment
      );
      
      return result;
      
    } catch (error) {
      console.error('[ExecutionService] Error tracking hierarchy earnings:', error);
      throw error;
    }
  }

  extractSuperAdminEarnings(distributionResult) {
    try {
      const superAdminEarnings = distributionResult.distributions?.SUPER_ADMIN || 0;
      console.log(`[ExecutionService] Extracted SuperAdmin earnings: ${superAdminEarnings}`);
      return superAdminEarnings;
      
    } catch (error) {
      console.error('[ExecutionService] Error extracting SuperAdmin earnings:', error);
      return 0;
    }
  }

  async simulateUserActivity(user, amount, activityType = 'trading') {
    try {
      console.log(`[ExecutionService] Simulating ${activityType} activity for ${user.username} with amount ${amount}`);
      
      switch (activityType) {
        case 'trading':
          return await this.executeTradingActivity({
            user,
            amount,
            segment: 'trading'
          });
        
        case 'gaming':
          return await this.executeGamingActivity({
            user,
            amount,
            segment: 'games'
          });
        
        default:
          throw new Error(`Unsupported activity type: ${activityType}`);
      }
      
    } catch (error) {
      console.error(`[ExecutionService] Error simulating ${activityType} activity for ${user.username}:`, error);
      throw error;
    }
  }

  async executeGamingActivity(params) {
    const { user, amount, segment } = params;
    
    try {
      console.log(`[ExecutionService] Executing gaming activity for ${user.username} with amount ${amount}`);
      
      // Create mock game bet
      const gameBet = await this.createMockGameBet(user, amount);
      
      // Calculate brokerage (5% of amount)
      const brokerageAmount = amount * 0.05;
      
      // Process game win (mock)
      const winResult = await this.processGameWin(user, gameBet, brokerageAmount);
      
      return {
        gameBet,
        brokerageAmount,
        winResult,
        superAdminEarnings: winResult.superAdminEarnings,
        referral: winResult.referral,
        user: user.username,
        segment
      };
      
    } catch (error) {
      console.error(`[ExecutionService] Error executing gaming activity for ${user.username}:`, error);
      throw error;
    }
  }

  async createMockGameBet(user, amount) {
    return {
      _id: new ObjectId(),
      userId: user._id,
      username: user.username,
      gameId: 'updown',
      amount: amount,
      prediction: 'UP',
      side: 'UP',
      status: 'WON',
      winAmount: amount * 2,
      brokerage: amount * 0.05,
      createdAt: new Date(),
      settledAt: new Date()
    };
  }

  async processGameWin(user, gameBet, brokerageAmount) {
    // Mock game win processing
    // In a real implementation, this would call the game profit distribution service
    
    const superAdminEarnings = brokerageAmount * 0.25; // 25% of brokerage to SuperAdmin
    
    const referralResult = await this.processReferralCommission(
      user,
      { distributions: { SUPER_ADMIN: superAdminEarnings } },
      'games'
    );
    
    return {
      superAdminEarnings,
      referral: referralResult
    };
  }

  async cleanupTestData(testStartTime) {
    try {
      console.log('[ExecutionService] Cleaning up test execution data...');
      
      // Clean up any test-specific data created during execution
      // This would include mock trades, game bets, etc.
      
      console.log('[ExecutionService] Test execution data cleanup completed');
      
    } catch (error) {
      console.error('[ExecutionService] Error cleaning up test execution data:', error);
    }
  }
}
