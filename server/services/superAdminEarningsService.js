import Admin from '../models/Admin.js';
import SuperAdminHierarchyEarnings from '../models/SuperAdminHierarchyEarnings.js';

/**
 * Super Admin Earnings Service
 * Tracks Super Admin earnings per hierarchy for referral eligibility
 * Follows SOLID principles with single responsibility
 */

/**
 * Track earnings for a hierarchy
 * @param {ObjectId} adminId - Admin ID who generated earnings
 * @param {number} amount - Amount earned
 * @param {string} segment - Segment ('games', 'trading', 'mcx', 'forex')
 * @returns {Promise<Object>} Updated earnings record
 */
export async function trackHierarchyEarnings(adminId, amount, segment) {
  try {
    if (!adminId || !amount || amount <= 0) {
      console.warn(`[SuperAdminEarnings] Invalid parameters: adminId=${adminId}, amount=${amount}`);
      return null;
    }

    // Get the admin and find their hierarchy root
    const admin = await Admin.findById(adminId).select('role parentId');
    if (!admin) {
      console.warn(`[SuperAdminEarnings] Admin not found: ${adminId}`);
      return null;
    }

    // Find the root admin of this hierarchy (topmost admin before Super Admin)
    const rootAdmin = await findHierarchyRoot(admin);
    if (!rootAdmin) {
      console.warn(`[SuperAdminEarnings] Root admin not found in hierarchy for admin: ${adminId}`);
      return null;
    }

    // Get Super Admin
    const superAdmin = await Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' });
    if (!superAdmin) {
      console.warn(`[SuperAdminEarnings] Super Admin not found`);
      return null;
    }

    // Add earnings to the hierarchy
    const earnings = await SuperAdminHierarchyEarnings.addEarnings(
      superAdmin._id,
      rootAdmin._id,
      amount,
      segment
    );

    console.log(`[SuperAdminEarnings] Tracked ${amount} ${segment} earnings from ${rootAdmin.username}'s hierarchy. Total: ${earnings.totalEarnings}`);
    
    return earnings;
  } catch (error) {
    console.error('[SuperAdminEarnings] Error tracking earnings:', error);
    // Return null instead of throwing to prevent 500 errors
    return null;
  }
}

/**
 * Get earnings for a specific hierarchy
 * @param {ObjectId} rootAdminId - Root admin ID
 * @returns {Promise<Object|null>} Earnings data
 */
export async function getHierarchyEarnings(rootAdminId) {
  try {
    return await SuperAdminHierarchyEarnings.getHierarchyEarnings(rootAdminId);
  } catch (error) {
    console.error('[SuperAdminEarnings] Error getting hierarchy earnings:', error);
    throw error;
  }
}

/**
 * Check if hierarchy has reached the referral threshold
 * @param {ObjectId} rootAdminId - Root admin ID
 * @param {number} threshold - Threshold amount (default 1000)
 * @param {string} unit - Unit ('PER_CRORE' or 'ABSOLUTE')
 * @returns {Promise<boolean>} Whether threshold is reached
 */
export async function hasReachedThreshold(rootAdminId, threshold = 1000, unit = 'PER_CRORE') {
  try {
    return await SuperAdminHierarchyEarnings.hasReachedThreshold(rootAdminId, threshold, unit);
  } catch (error) {
    console.error('[SuperAdminEarnings] Error checking threshold:', error);
    throw error;
  }
}

/**
 * Get all hierarchies for Super Admin
 * @returns {Promise<Array>} Array of earnings documents
 */
export async function getAllSuperAdminHierarchies() {
  try {
    const superAdmin = await Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' });
    if (!superAdmin) {
      throw new Error('Super Admin not found');
    }

    return await SuperAdminHierarchyEarnings.getSuperAdminHierarchies(superAdmin._id);
  } catch (error) {
    console.error('[SuperAdminEarnings] Error getting all hierarchies:', error);
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
    console.error('[SuperAdminEarnings] Error finding hierarchy root:', error);
    throw error;
  }
}

/**
 * Get referral eligibility settings for Super Admin
 * @returns {Promise<Object>} Referral eligibility settings
 */
export async function getReferralEligibilitySettings() {
  try {
    const superAdmin = await Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' })
      .select('referralEligibility');
    
    if (!superAdmin) {
      throw new Error('Super Admin not found');
    }

    return superAdmin.referralEligibility || {
      enabled: true,
      thresholdAmount: 1000,
      thresholdUnit: 'PER_CRORE'
    };
  } catch (error) {
    console.error('[SuperAdminEarnings] Error getting referral eligibility settings:', error);
    throw error;
  }
}

/**
 * Update referral eligibility settings
 * @param {Object} settings - New settings
 * @returns {Promise<Object>} Updated settings
 */
export async function updateReferralEligibilitySettings(settings) {
  try {
    const superAdmin = await Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' });
    if (!superAdmin) {
      throw new Error('Super Admin not found');
    }

    superAdmin.referralEligibility = {
      enabled: settings.enabled !== false,
      thresholdAmount: settings.thresholdAmount || 1000,
      thresholdUnit: settings.thresholdUnit || 'PER_CRORE'
    };

    await superAdmin.save();
    return superAdmin.referralEligibility;
  } catch (error) {
    console.error('[SuperAdminEarnings] Error updating referral eligibility settings:', error);
    throw error;
  }
}
