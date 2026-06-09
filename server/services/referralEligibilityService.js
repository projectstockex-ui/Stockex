import Admin from '../models/Admin.js';
import User from '../models/User.js';
import { 
  trackHierarchyEarnings, 
  getHierarchyEarnings, 
  hasReachedThreshold,
  getReferralEligibilitySettings 
} from './superAdminEarningsService.js';

/**
 * Referral Eligibility Service
 * Determines referral payout eligibility based on Super Admin earnings
 * Follows SOLID principles with single responsibility
 */

/**
 * Check if referral commission is eligible for payout
 * @param {ObjectId} referredUserId - User who was referred
 * @param {number} amount - Referral commission amount
 * @param {string} segment - Segment ('games', 'trading', 'mcx', 'forex')
 * @returns {Promise<Object>} Eligibility result with details
 */
export async function isReferralEligible(referredUserId, amount, segment) {
  try {
    if (!referredUserId || !amount || amount <= 0) {
      return { eligible: false, reason: 'Invalid parameters' };
    }

    // Get referral eligibility settings
    const settings = await getReferralEligibilitySettings();
    if (!settings.enabled) {
      return { eligible: true, reason: 'Referral eligibility checks disabled' };
    }

    // Get the referred user and their admin
    const referredUser = await User.findById(referredUserId).select('referredBy admin username');
    if (!referredUser || !referredUser.referredBy) {
      return { eligible: false, reason: 'User not found or no referrer' };
    }

    // Get the admin and find hierarchy root
    const admin = await Admin.findById(referredUser.admin).select('role parentId username');
    if (!admin) {
      return { eligible: false, reason: 'Admin not found' };
    }

    const rootAdmin = await findHierarchyRoot(admin);
    if (!rootAdmin) {
      return { eligible: false, reason: 'Root admin not found' };
    }

    // Check if Super Admin has reached threshold for this hierarchy
    const thresholdReached = await hasReachedThreshold(
      rootAdmin._id, 
      settings.thresholdAmount, 
      settings.thresholdUnit
    );

    if (!thresholdReached) {
      const earnings = await getHierarchyEarnings(rootAdmin._id);
      const currentEarnings = earnings ? earnings.totalEarnings : 0;
      
      return {
        eligible: false,
        reason: `Super Admin has not reached threshold. Current: ${currentEarnings}, Required: ${settings.thresholdAmount} ${settings.thresholdUnit}`,
        currentEarnings,
        requiredThreshold: settings.thresholdAmount,
        thresholdUnit: settings.thresholdUnit,
        rootAdminId: rootAdmin._id
      };
    }

    return {
      eligible: true,
      reason: 'Super Admin threshold reached, referral commission eligible',
      rootAdminId: rootAdmin._id
    };
  } catch (error) {
    console.error('[ReferralEligibility] Error checking eligibility:', error);
    return { eligible: false, reason: 'Error checking eligibility', error: error.message };
  }
}

/**
 * Update earnings and check eligibility in one operation
 * @param {ObjectId} adminId - Admin ID who generated earnings
 * @param {number} amount - Amount earned by Super Admin
 * @param {string} segment - Segment
 * @returns {Promise<Object>} Updated earnings and eligibility status
 */
export async function updateEarningsAndCheckEligibility(adminId, amount, segment) {
  try {
    // Track the earnings first
    const earnings = await trackHierarchyEarnings(adminId, amount, segment);
    
    // Get referral eligibility settings
    const settings = await getReferralEligibilitySettings();
    
    // Check if threshold is now reached
    const thresholdReached = await hasReachedThreshold(
      earnings.rootAdminId,
      settings.thresholdAmount,
      settings.thresholdUnit
    );

    return {
      earnings,
      thresholdReached,
      settings,
      eligibleForReferral: thresholdReached || !settings.enabled
    };
  } catch (error) {
    console.error('[ReferralEligibility] Error updating earnings and checking eligibility:', error);
    throw error;
  }
}

/**
 * Process referral commission with eligibility check
 * @param {ObjectId} referredUserId - User who was referred
 * @param {number} amount - Referral commission amount
 * @param {string} segment - Segment
 * @param {Function} payoutFunction - Function to call if eligible
 * @returns {Promise<Object>} Processing result
 */
export async function processReferralWithEligibilityCheck(referredUserId, amount, segment, payoutFunction) {
  try {
    // Check eligibility
    const eligibility = await isReferralEligible(referredUserId, amount, segment);
    
    if (!eligibility.eligible) {
      console.log(`[ReferralEligibility] Referral commission held: ${eligibility.reason}`);
      
      // Hold the commission for later payout
      await holdReferralCommission(referredUserId, amount, segment, eligibility);
      
      return {
        processed: false,
        held: true,
        reason: eligibility.reason,
        eligibility
      };
    }

    // Process the payout
    console.log(`[ReferralEligibility] Referral commission eligible, processing payout`);
    const payoutResult = await payoutFunction();
    
    return {
      processed: true,
      held: false,
      payoutResult,
      eligibility
    };
  } catch (error) {
    console.error('[ReferralEligibility] Error processing referral with eligibility check:', error);
    throw error;
  }
}

/**
 * Hold referral commission for later payout
 * @param {ObjectId} referredUserId - User who was referred
 * @param {number} amount - Commission amount
 * @param {string} segment - Segment
 * @param {Object} eligibility - Eligibility details
 */
async function holdReferralCommission(referredUserId, amount, segment, eligibility) {
  try {
    // This would integrate with a held commissions system
    // For now, we'll just log the hold
    console.log(`[ReferralEligibility] Holding ${amount} referral commission for user ${referredUserId} in ${segment} segment`);
    console.log(`[ReferralEligibility] Hold reason: ${eligibility.reason}`);
    console.log(`[ReferralEligibility] Root admin ID: ${eligibility.rootAdminId}`);
    
    // TODO: Implement actual holding mechanism (database table, etc.)
    // This could be a HeldReferralCommission model
  } catch (error) {
    console.error('[ReferralEligibility] Error holding referral commission:', error);
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
    console.error('[ReferralEligibility] Error finding hierarchy root:', error);
    throw error;
  }
}

/**
 * Get eligibility status for multiple users (batch processing)
 * @param {Array} userRequests - Array of { userId, amount, segment }
 * @returns {Promise<Array>} Array of eligibility results
 */
export async function batchCheckEligibility(userRequests) {
  try {
    const results = [];
    
    for (const request of userRequests) {
      const result = await isReferralEligible(
        request.userId, 
        request.amount, 
        request.segment
      );
      results.push({
        userId: request.userId,
        amount: request.amount,
        segment: request.segment,
        ...result
      });
    }
    
    return results;
  } catch (error) {
    console.error('[ReferralEligibility] Error in batch eligibility check:', error);
    throw error;
  }
}
