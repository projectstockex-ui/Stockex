import User from '../models/User.js';
import WalletLedger from '../models/WalletLedger.js';
import Referral from '../models/Referral.js';
import Admin from '../models/Admin.js';
import { 
  getHierarchyEarnings, 
  hasReachedThreshold,
  getReferralEligibilitySettings 
} from './superAdminEarningsService.js';
import { isReferralEnabledForUser } from '../utils/referralDistributionHelper.js';
import { atomicGamesWalletUpdate, ensureGamesWallet } from '../utils/gamesWallet.js';
import { recordGamesWalletLedger } from '../utils/gamesWalletLedger.js';

/**
 * Referral Payout Service
 * Handles conditional referral payouts and held commission management
 * Follows SOLID principles with single responsibility
 */

/**
 * Process conditional referral payout with eligibility check
 * @param {ObjectId} referredUserId - User who was referred
 * @param {number} amount - Referral commission amount
 * @param {string} segment - Segment ('games', 'trading', 'mcx', 'forex')
 * @param {Object} metadata - Additional metadata for the payout
 * @returns {Promise<Object>} Payout result
 */
export async function processConditionalReferralPayout(referredUserId, amount, segment, metadata = {}) {
  try {
    if (!referredUserId || !amount || amount <= 0) {
      console.warn(`[ReferralPayout] Invalid parameters: userId=${referredUserId}, amount=${amount}`);
      return { success: false, reason: 'Invalid parameters' };
    }

    const referralAllowed = await isReferralEnabledForUser(referredUserId, segment);
    if (!referralAllowed) {
      return { success: false, reason: `Referral disabled for segment ${segment} in this hierarchy` };
    }

    // Get referral eligibility settings with error handling
    let settings;
    try {
      settings = await getReferralEligibilitySettings();
    } catch (error) {
      console.error('[ReferralPayout] Error getting eligibility settings:', error);
      // Default to enabled if settings fetch fails
      settings = { enabled: true, thresholdAmount: 1000, thresholdUnit: 'PER_CRORE' };
    }

    if (!settings.enabled) {
      // If eligibility checks are disabled, process payout immediately
      return await processImmediatePayout(referredUserId, amount, segment, metadata);
    }

    // Get the referred user and their admin
    const referredUser = await User.findById(referredUserId).select('referredBy admin username');
    if (!referredUser || !referredUser.referredBy) {
      return { success: false, reason: 'User not found or no referrer' };
    }

    // Get the admin and find hierarchy root
    const admin = await Admin.findById(referredUser.admin).select('role parentId username');
    if (!admin) {
      return { success: false, reason: 'Admin not found' };
    }

    const rootAdmin = await findHierarchyRoot(admin);
    if (!rootAdmin) {
      return { success: false, reason: 'Root admin not found' };
    }

    // Check if Super Admin has reached threshold for this hierarchy
    let thresholdReached = false;
    try {
      thresholdReached = await hasReachedThreshold(
        rootAdmin._id, 
        settings.thresholdAmount, 
        settings.thresholdUnit
      );
    } catch (error) {
      console.error('[ReferralPayout] Error checking threshold:', error);
      // Default to false (hold commission) if threshold check fails
      thresholdReached = false;
    }

    if (!thresholdReached) {
      // Hold the commission for later payout
      return await holdReferralCommission(referredUserId, amount, segment, metadata, rootAdmin._id);
    }

    // Process the payout immediately
    return await processImmediatePayout(referredUserId, amount, segment, metadata);
  } catch (error) {
    console.error('[ReferralPayout] Error processing conditional payout:', error);
    return { success: false, reason: 'Error processing payout', error: error.message };
  }
}

/**
 * Process immediate referral payout
 * @param {ObjectId} referredUserId - User who was referred
 * @param {number} amount - Referral commission amount
 * @param {string} segment - Segment
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<Object>} Payout result
 */
async function processImmediatePayout(referredUserId, amount, segment, metadata = {}) {
  try {
    const referredUser = await User.findById(referredUserId).select('referredBy username');
    if (!referredUser || !referredUser.referredBy) {
      return { success: false, reason: 'User not found or no referrer' };
    }

    // Get the referrer
    const referrer = await User.findById(referredUser.referredBy).select('username email wallet gamesWallet mcxWallet');
    if (!referrer) {
      return { success: false, reason: 'Referrer not found' };
    }

    // Credit the appropriate wallet based on segment
    let balanceAfter;
    if (segment === 'games') {
      // Credit games wallet
      ensureGamesWallet(referrer);
      const updatedGamesWallet = await atomicGamesWalletUpdate(User, referrer._id, {
        balance: amount,
        realizedPnL: amount,
        todayRealizedPnL: amount,
      });
      balanceAfter = updatedGamesWallet.balance;

      // Create games wallet ledger entry
      await recordGamesWalletLedger(referrer._id, {
        gameId: metadata.gameKey || 'referral',
        entryType: 'credit',
        amount,
        balanceAfter,
        description: `Referral commission: ${referredUser.username} (${segment})`,
        meta: {
          profitKind: 'REFERRAL_COMMISSION',
          relatedUserId: referredUserId,
          segment,
          referredUsername: referredUser.username,
          kind: 'referral_payout',
          ...metadata
        }
      });
    } else if (segment === 'trading' || segment === 'mcx') {
      // Credit MCX wallet for trading/MCX referrals
      referrer.mcxWallet = referrer.mcxWallet || {};
      referrer.mcxWallet.balance = (referrer.mcxWallet.balance || 0) + amount;
      referrer.mcxWallet.realizedPnL = (referrer.mcxWallet.realizedPnL || 0) + amount;
      referrer.mcxWallet.todayRealizedPnL = (referrer.mcxWallet.todayRealizedPnL || 0) + amount;
      await referrer.save();
      balanceAfter = referrer.mcxWallet.balance;

      // Create wallet ledger entry with MCX segment
      await WalletLedger.create({
        ownerType: 'USER',
        ownerId: referrer._id,
        userId: referrer._id,
        username: referrer.username,
        type: 'CREDIT',
        reason: 'REFERRAL_COMMISSION',
        amount,
        balanceAfter,
        description: `Referral commission: ${referredUser.username} (${segment})`,
        meta: {
          profitKind: 'REFERRAL_COMMISSION',
          relatedUserId: referredUserId,
          segment: 'mcx',
          referredUsername: referredUser.username,
          kind: 'referral_payout',
          ...metadata
        }
      });
    } else {
      // Credit main wallet for other segments (crypto, forex, etc.)
      referrer.wallet = referrer.wallet || {};
      referrer.wallet.cashBalance = (referrer.wallet.cashBalance || 0) + amount;
      referrer.wallet.tradingBalance = (referrer.wallet.tradingBalance || 0) + amount;
      referrer.wallet.realizedPnL = (referrer.wallet.realizedPnL || 0) + amount;
      referrer.wallet.todayRealizedPnL = (referrer.wallet.todayRealizedPnL || 0) + amount;
      referrer.wallet.balance = (referrer.wallet.balance || 0) + amount;
      await referrer.save();
      balanceAfter = referrer.wallet.balance;

      // Create wallet ledger entry
      await WalletLedger.create({
        ownerType: 'USER',
        ownerId: referrer._id,
        userId: referrer._id,
        username: referrer.username,
        type: 'CREDIT',
        reason: 'REFERRAL_COMMISSION',
        amount,
        balanceAfter,
        description: `Referral commission: ${referredUser.username} (${segment})`,
        meta: {
          profitKind: 'REFERRAL_COMMISSION',
          relatedUserId: referredUserId,
          segment,
          referredUsername: referredUser.username,
          kind: 'referral_payout',
          ...metadata
        }
      });
    }

    // Update referral stats
    referrer.referralStats = referrer.referralStats || {};
    referrer.referralStats.totalReferralEarnings = (referrer.referralStats.totalReferralEarnings || 0) + amount;
    await referrer.save();

    // Update referral record
    await Referral.findOneAndUpdate(
      { referredUser: referredUserId },
      { $inc: { earnings: amount } }
    );

    console.log(`[ReferralPayout] Paid ${amount} referral commission to ${referrer.username} for ${referredUser.username} (${segment})`);

    return {
      success: true,
      amount,
      referrer: {
        id: referrer._id,
        username: referrer.username
      },
      referredUser: {
        id: referredUserId,
        username: referredUser.username
      },
      segment
    };
  } catch (error) {
    console.error('[ReferralPayout] Error processing immediate payout:', error);
    throw error;
  }
}

/**
 * Hold referral commission for later payout
 * @param {ObjectId} referredUserId - User who was referred
 * @param {number} amount - Commission amount
 * @param {string} segment - Segment
 * @param {Object} metadata - Additional metadata
 * @param {ObjectId} rootAdminId - Root admin ID
 * @returns {Promise<Object>} Hold result
 */
async function holdReferralCommission(referredUserId, amount, segment, metadata = {}, rootAdminId) {
  try {
    const earnings = await getHierarchyEarnings(rootAdminId);
    const currentEarnings = earnings ? earnings.totalEarnings : 0;
    const settings = await getReferralEligibilitySettings();
    
    // TODO: Implement actual holding mechanism (database table)
    // For now, we'll just log the hold and return the hold information
    console.log(`[ReferralPayout] Holding ${amount} referral commission for user ${referredUserId} in ${segment} segment`);
    console.log(`[ReferralPayout] Hold reason: Super Admin earnings below threshold`);
    console.log(`[ReferralPayout] Current earnings: ${currentEarnings}, Required: ${settings.thresholdAmount} ${settings.thresholdUnit}`);
    
    return {
      success: false,
      held: true,
      amount,
      referredUserId,
      segment,
      rootAdminId,
      currentEarnings,
      requiredThreshold: settings.thresholdAmount,
      thresholdUnit: settings.thresholdUnit,
      reason: 'Super Admin earnings below threshold'
    };
  } catch (error) {
    console.error('[ReferralPayout] Error holding referral commission:', error);
    throw error;
  }
}

/**
 * Release held referral commissions for a hierarchy
 * @param {ObjectId} rootAdminId - Root admin ID
 * @returns {Promise<Object>} Release result
 */
export async function releaseHeldReferralCommissions(rootAdminId) {
  try {
    // TODO: Implement actual release mechanism
    // This would query held commissions for the hierarchy and process them
    
    console.log(`[ReferralPayout] Releasing held referral commissions for hierarchy ${rootAdminId}`);
    
    return {
      success: true,
      released: 0,
      rootAdminId,
      message: 'Held commissions release mechanism not yet implemented'
    };
  } catch (error) {
    console.error('[ReferralPayout] Error releasing held commissions:', error);
    throw error;
  }
}

/**
 * Get held referral commissions for a hierarchy
 * @param {ObjectId} rootAdminId - Root admin ID
 * @returns {Promise<Array>} Array of held commissions
 */
export async function getHeldReferralCommissions(rootAdminId) {
  try {
    // TODO: Implement actual query mechanism
    // This would query the held commissions database table
    
    console.log(`[ReferralPayout] Getting held referral commissions for hierarchy ${rootAdminId}`);
    
    return [];
  } catch (error) {
    console.error('[ReferralPayout] Error getting held commissions:', error);
    throw error;
  }
}

/**
 * Find the root admin of a hierarchy (topmost admin before Super Admin)
 * @param {Object} admin - Admin document
 * @returns {Promise<Object|null>} Root admin document
 */
async function findHierarchyRoot(admin) {
  try {
    let currentAdmin = admin;
    let rootAdmin = null;

    while (currentAdmin) {
      if (currentAdmin.role === 'ADMIN') {
        rootAdmin = currentAdmin;
      }
      
      if (currentAdmin.role === 'SUPER_ADMIN' || !currentAdmin.parentId) {
        break;
      }
      
      currentAdmin = await Admin.findById(currentAdmin.parentId).select('role parentId');
    }

    return rootAdmin;
  } catch (error) {
    console.error('[ReferralPayout] Error finding hierarchy root:', error);
    throw error;
  }
}

/**
 * Get referral payout statistics for a hierarchy
 * @param {ObjectId} rootAdminId - Root admin ID
 * @returns {Promise<Object>} Payout statistics
 */
export async function getReferralPayoutStatistics(rootAdminId) {
  try {
    // TODO: Implement actual statistics calculation
    // This would query referral payouts and held commissions
    
    return {
      rootAdminId,
      totalPaid: 0,
      totalHeld: 0,
      lastPayoutDate: null,
      nextEligibilityDate: null
    };
  } catch (error) {
    console.error('[ReferralPayout] Error getting payout statistics:', error);
    throw error;
  }
}
