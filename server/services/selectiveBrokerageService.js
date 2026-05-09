/**
 * Selective Brokerage Service
 * Handles selective brokerage inheritance logic following SOLID principles
 * Single Responsibility: Manages selective inheritance rules
 */

/**
 * Check if child admin should inherit parent's brokerage restrictions
 * @param {Object} parentAdmin - Parent admin document
 * @param {Object} childAdmin - Child admin document
 * @returns {boolean} - True if child should inherit parent's restrictions
 */
export function shouldInheritBrokerageRestriction(parentAdmin, childAdmin) {
  if (!parentAdmin || !parentAdmin.restrictMode) {
    return false;
  }

  // If parent has selective inheritance mode, child does not inherit
  if (parentAdmin.restrictMode.hierarchyInheritanceMode === 'SELECTIVE_INHERITANCE') {
    return false;
  }

  // Default: full inheritance
  return true;
}

/**
 * Check if brokerage should be redirected to Super Admin based on inheritance rules
 * @param {Object} admin - Admin document to check
 * @param {Object} parentAdmin - Parent admin document
 * @param {string} segment - 'games' | 'trading'
 * @returns {boolean} - True if brokerage should be redirected to Super Admin
 */
export function shouldRedirectBrokerageToSuperAdmin(admin, parentAdmin, segment) {
  if (!admin || !segment) {
    return false;
  }

  // Check if admin has direct restriction
  if (isDirectlyRestricted(admin, segment)) {
    return true;
  }

  // Check if admin inherits restriction from parent
  if (shouldInheritBrokerageRestriction(parentAdmin, admin)) {
    return isDirectlyRestricted(parentAdmin, segment);
  }

  return false;
}

/**
 * Check if admin has direct brokerage restriction (not inherited)
 * @param {Object} admin - Admin document
 * @param {string} segment - 'games' | 'trading'
 * @returns {boolean} - True if admin has direct restriction
 */
export function isDirectlyRestricted(admin, segment) {
  if (!admin || !admin.restrictMode || !admin.restrictMode.restrictBrokerage) {
    return false;
  }

  switch (segment.toLowerCase()) {
    case 'games':
      return admin.restrictMode.restrictBrokerage.games === true;
    case 'trading':
      return admin.restrictMode.restrictBrokerage.trading === true;
    default:
      return false;
  }
}

/**
 * Get effective brokerage restriction status considering inheritance
 * @param {Object} admin - Admin document
 * @param {Object} parentAdmin - Parent admin document
 * @returns {Object} - Effective restriction status for all segments
 */
export function getEffectiveBrokerageRestriction(admin, parentAdmin) {
  const result = {
    games: false,
    trading: false,
    inheritanceMode: 'FULL_INHERITANCE',
    isRestricted: false
  };

  if (!admin) {
    return result;
  }

  // Set inheritance mode
  result.inheritanceMode = admin.restrictMode?.hierarchyInheritanceMode || 'FULL_INHERITANCE';

  // Check direct restrictions
  result.games = isDirectlyRestricted(admin, 'games');
  result.trading = isDirectlyRestricted(admin, 'trading');

  // Check inherited restrictions if in full inheritance mode
  if (result.inheritanceMode === 'FULL_INHERITANCE' && parentAdmin) {
    if (!result.games) {
      result.games = isDirectlyRestricted(parentAdmin, 'games');
    }
    if (!result.trading) {
      result.trading = isDirectlyRestricted(parentAdmin, 'trading');
    }
  }

  result.isRestricted = result.games || result.trading;
  return result;
}

/**
 * Validate selective brokerage control data
 * @param {Object} data - Control data to validate
 * @returns {Object} - Validation result with isValid and errors
 */
export function validateSelectiveBrokerageData(data) {
  const errors = [];

  // Validate hierarchy inheritance mode
  if (data.hierarchyInheritanceMode) {
    const validModes = ['FULL_INHERITANCE', 'SELECTIVE_INHERITANCE'];
    if (!validModes.includes(data.hierarchyInheritanceMode)) {
      errors.push('Invalid hierarchy inheritance mode. Must be FULL_INHERITANCE or SELECTIVE_INHERITANCE');
    }
  }

  // Validate restrict brokerage data
  if (data.restrictBrokerage) {
    if (typeof data.restrictBrokerage.games !== 'boolean') {
      errors.push('Games brokerage restriction must be a boolean');
    }
    if (typeof data.restrictBrokerage.trading !== 'boolean') {
      errors.push('Trading brokerage restriction must be a boolean');
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Check if admin can modify selective brokerage settings
 * @param {Object} admin - Admin document
 * @param {Object} targetAdmin - Target admin to modify
 * @returns {boolean} - True if admin can modify target's selective settings
 */
export function canModifySelectiveBrokerage(admin, targetAdmin) {
  if (!admin || !targetAdmin) {
    return false;
  }

  // Super Admin can modify anyone
  if (admin.role === 'SUPER_ADMIN') {
    return true;
  }

  // Admin can modify their direct brokers/sub-brokers
  if (admin.role === 'ADMIN') {
    return targetAdmin.createdBy?.toString() === admin._id.toString();
  }

  // Broker can modify their direct sub-brokers
  if (admin.role === 'BROKER') {
    return targetAdmin.role === 'SUB_BROKER' && 
           targetAdmin.createdBy?.toString() === admin._id.toString();
  }

  return false;
}
