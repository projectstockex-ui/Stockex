import Admin from '../models/Admin.js';

/**
 * Hierarchy Validation Service
 * Handles validation of hierarchy-based permissions for segments and restrictions
 * Follows SOLID principles - Single Responsibility Principle
 */
class HierarchyValidationService {
  /**
   * Check if a category permission can be enabled based on grandparent's segment permissions
   * @param {Object} currentAdmin - The admin making the request
   * @param {Object} newRestrictions - The new restrictions being set
   * @returns {Object} { allowed: boolean, message: string }
   */
  async validateCategoryPermissions(currentAdmin, newRestrictions) {
    console.log('[HierarchyValidationService] validateCategoryPermissions called');
    console.log('[HierarchyValidationService] Current Admin:', currentAdmin.name, 'Role:', currentAdmin.role, 'ParentId:', currentAdmin.parentId);
    console.log('[HierarchyValidationService] New restrictions:', JSON.stringify(newRestrictions));

    // SuperAdmin can do anything
    if (currentAdmin.role === 'SUPER_ADMIN') {
      console.log('[HierarchyValidationService] SuperAdmin - allowed');
      return { allowed: true };
    }

    // If no parent, allow
    if (!currentAdmin.parentId) {
      console.log('[HierarchyValidationService] No parent - allowed');
      return { allowed: true };
    }

    // Fetch grandparent to check segment permissions
    const grandParentAdmin = await Admin.findById(currentAdmin.parentId).select('segmentPermissions');
    if (!grandParentAdmin) {
      console.log('[HierarchyValidationService] No grandparent found - allowed');
      return { allowed: true };
    }

    console.log('[HierarchyValidationService] GrandParent:', grandParentAdmin.name, 'Role:', grandParentAdmin.role);

    const grandParentSegPerms = grandParentAdmin.segmentPermissions instanceof Map
      ? Object.fromEntries(grandParentAdmin.segmentPermissions)
      : (grandParentAdmin.segmentPermissions || {});

    console.log('[HierarchyValidationService] GrandParent segmentPermissions:', JSON.stringify(grandParentSegPerms));

    // Check allowFutures - if grandparent has disabled NSEFUT/NSEOPT, child cannot enable futures
    if (newRestrictions.allowFutures === true) {
      const nseFutEnabled = grandParentSegPerms['NSEFUT']?.enabled ?? false;
      const nseOptEnabled = grandParentSegPerms['NSEOPT']?.enabled ?? false;
      if (!nseFutEnabled && !nseOptEnabled) {
        console.log('[HierarchyValidationService] BLOCKING: Futures - parent disabled NSEFUT/NSEOPT');
        return {
          allowed: false,
          message: 'Cannot enable Futures - parent has disabled NSEFUT/NSEOPT segments'
        };
      }
    }

    // Check allowCommodity - if grandparent has disabled MCXFUT/MCXOPT, child cannot enable commodity
    if (newRestrictions.allowCommodity === true) {
      const mcxFutEnabled = grandParentSegPerms['MCXFUT']?.enabled ?? false;
      const mcxOptEnabled = grandParentSegPerms['MCXOPT']?.enabled ?? false;
      if (!mcxFutEnabled && !mcxOptEnabled) {
        console.log('[HierarchyValidationService] BLOCKING: Commodity - parent disabled MCXFUT/MCXOPT');
        return {
          allowed: false,
          message: 'Cannot enable Commodity - parent has disabled MCXFUT/MCXOPT segments'
        };
      }
    }

    // Check allowCrypto - if grandparent has disabled CRYPTOFUT/CRYPTOOPT, child cannot enable crypto
    if (newRestrictions.allowCrypto === true) {
      const cryptoFutEnabled = grandParentSegPerms['CRYPTOFUT']?.enabled ?? false;
      const cryptoOptEnabled = grandParentSegPerms['CRYPTOOPT']?.enabled ?? false;
      if (!cryptoFutEnabled && !cryptoOptEnabled) {
        console.log('[HierarchyValidationService] BLOCKING: Crypto - parent disabled CRYPTOFUT/CRYPTOOPT');
        return {
          allowed: false,
          message: 'Cannot enable Crypto - parent has disabled CRYPTOFUT/CRYPTOOPT segments'
        };
      }
    }

    console.log('[HierarchyValidationService] All checks passed - allowed');
    return { allowed: true };
  }

  /**
   * Check if a specific segment can be enabled based on parent's segment permissions
   * @param {Object} currentAdmin - The admin making the request
   * @param {string} segmentName - The segment being enabled (e.g., 'BSEFUT', 'MCXFUT')
   * @param {boolean} enabled - Whether the segment is being enabled
   * @returns {Object} { allowed: boolean, message: string }
   */
  async validateSegmentPermission(currentAdmin, segmentName, enabled) {
    console.log('[HierarchyValidationService] validateSegmentPermission called');
    console.log('[HierarchyValidationService] Segment:', segmentName, 'Enabled:', enabled);
    console.log('[HierarchyValidationService] Current Admin:', currentAdmin.name, 'Role:', currentAdmin.role, 'ParentId:', currentAdmin.parentId);

    // If not enabling, allow
    if (enabled !== true) {
      console.log('[HierarchyValidationService] Not enabling - allowed');
      return { allowed: true };
    }

    // SuperAdmin can do anything
    if (currentAdmin.role === 'SUPER_ADMIN') {
      console.log('[HierarchyValidationService] SuperAdmin - allowed');
      return { allowed: true };
    }

    // If no parent, allow
    if (!currentAdmin.parentId) {
      console.log('[HierarchyValidationService] No parent - allowed');
      return { allowed: true };
    }

    // Check current admin's own segment permissions (not parent's)
    const currentAdminSegPerms = currentAdmin.segmentPermissions instanceof Map
      ? Object.fromEntries(currentAdmin.segmentPermissions)
      : (currentAdmin.segmentPermissions || {});

    console.log('[HierarchyValidationService] Current Admin segmentPermissions:', JSON.stringify(currentAdminSegPerms));

    // Check if current admin has this segment enabled
    const currentAdminSeg = currentAdminSegPerms[segmentName] || {};
    const currentAdminSegEnabled = currentAdminSeg.enabled ?? false;

    console.log('[HierarchyValidationService] Current Admin segment enabled for', segmentName, ':', currentAdminSegEnabled);

    if (!currentAdminSegEnabled) {
      console.log('[HierarchyValidationService] BLOCKING:', segmentName, '- current admin has disabled it');
      return {
        allowed: false,
        message: `Cannot enable ${segmentName} - you do not have this segment enabled`
      };
    }

    console.log('[HierarchyValidationService] Check passed - allowed');
    return { allowed: true };
  }
}

export default new HierarchyValidationService();
