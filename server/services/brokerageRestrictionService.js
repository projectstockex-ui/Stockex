/**
 * Brokerage Restriction Service
 * Handles brokerage restriction logic for games and trading segments
 * Follows SOLID principles with single responsibility
 * Extended with selective inheritance support
 */

/**
 * Check if games brokerage is restricted for an admin
 * @param {Object} admin - Admin document
 * @returns {boolean} - True if games brokerage is restricted
 */
export function isGamesBrokerageRestricted(admin) {
  if (!admin || !admin.restrictMode) return false;
  return admin.restrictMode.restrictBrokerage?.games === true;
}

/**
 * Check if trading brokerage is restricted for an admin
 * @param {Object} admin - Admin document
 * @returns {boolean} - True if trading brokerage is restricted
 */
export function isTradingBrokerageRestricted(admin) {
  if (!admin || !admin.restrictMode) return false;
  return admin.restrictMode.restrictBrokerage?.trading === true;
}

/**
 * Unified check to determine if brokerage should be redirected to Super Admin
 * @param {Object} admin - Admin document
 * @param {string} segment - 'games' | 'trading'
 * @returns {boolean} - True if brokerage should be redirected to Super Admin
 */
export function shouldRedirectBrokerageToSuperAdmin(admin, segment) {
  if (!admin || !segment) return false;
  
  switch (segment.toLowerCase()) {
    case 'games':
      return isGamesBrokerageRestricted(admin);
    case 'trading':
      return isTradingBrokerageRestricted(admin);
    default:
      return false;
  }
}

/**
 * Get brokerage restriction status for both segments
 * @param {Object} admin - Admin document
 * @returns {Object} - Restriction status for games and trading
 */
export function getBrokerageRestrictionStatus(admin) {
  if (!admin || !admin.restrictMode) {
    return {
      games: false,
      trading: false,
      anyRestricted: false
    };
  }

  const gamesRestricted = isGamesBrokerageRestricted(admin);
  const tradingRestricted = isTradingBrokerageRestricted(admin);

  return {
    games: gamesRestricted,
    trading: tradingRestricted,
    anyRestricted: gamesRestricted || tradingRestricted
  };
}

/**
 * Enhanced unified check to determine if brokerage should be redirected to Super Admin
 * Now considers selective inheritance
 * @param {Object} admin - Admin document
 * @param {Object} parentAdmin - Parent admin document
 * @param {string} segment - 'games' | 'trading'
 * @returns {boolean} - True if brokerage should be redirected to Super Admin
 */
export function shouldRedirectBrokerageToSuperAdminEnhanced(admin, parentAdmin, segment) {
  if (!admin || !segment) return false;
  
  // Check direct restriction first
  if (isGamesBrokerageRestricted(admin) && segment === 'games') return true;
  if (isTradingBrokerageRestricted(admin) && segment === 'trading') return true;
  
  // Check inherited restriction based on inheritance mode
  if (parentAdmin && admin.restrictMode?.hierarchyInheritanceMode === 'FULL_INHERITANCE') {
    if (isGamesBrokerageRestricted(parentAdmin) && segment === 'games') return true;
    if (isTradingBrokerageRestricted(parentAdmin) && segment === 'trading') return true;
  }
  
  return false;
}

/**
 * Get comprehensive brokerage restriction status including inheritance
 * @param {Object} admin - Admin document
 * @param {Object} parentAdmin - Parent admin document
 * @returns {Object} - Comprehensive restriction status
 */
export function getComprehensiveBrokerageRestrictionStatus(admin, parentAdmin) {
  const directStatus = getBrokerageRestrictionStatus(admin);
  
  return {
    ...directStatus,
    hierarchyInheritanceMode: admin.restrictMode?.hierarchyInheritanceMode || 'FULL_INHERITANCE',
    inheritedRestrictions: {
      games: parentAdmin && admin.restrictMode?.hierarchyInheritanceMode === 'FULL_INHERITANCE' 
        ? isGamesBrokerageRestricted(parentAdmin) 
        : false,
      trading: parentAdmin && admin.restrictMode?.hierarchyInheritanceMode === 'FULL_INHERITANCE' 
        ? isTradingBrokerageRestricted(parentAdmin) 
        : false
    },
    effectiveRestrictions: {
      games: directStatus.games || (parentAdmin && admin.restrictMode?.hierarchyInheritanceMode === 'FULL_INHERITANCE' && isGamesBrokerageRestricted(parentAdmin)),
      trading: directStatus.trading || (parentAdmin && admin.restrictMode?.hierarchyInheritanceMode === 'FULL_INHERITANCE' && isTradingBrokerageRestricted(parentAdmin))
    }
  };
}

/**
 * Validate brokerage restriction data
 * @param {Object} data - Restriction data to validate
 * @returns {Object} - Validation result with isValid and errors
 */
export function validateBrokerageRestrictionData(data) {
  const errors = [];
  
  if (data.restrictBrokerage) {
    if (typeof data.restrictBrokerage.games !== 'boolean') {
      errors.push('Games brokerage restriction must be a boolean');
    }
    if (typeof data.restrictBrokerage.trading !== 'boolean') {
      errors.push('Trading brokerage restriction must be a boolean');
    }
  }

  // Validate hierarchy inheritance mode
  if (data.hierarchyInheritanceMode) {
    const validModes = ['FULL_INHERITANCE', 'SELECTIVE_INHERITANCE'];
    if (!validModes.includes(data.hierarchyInheritanceMode)) {
      errors.push('Invalid hierarchy inheritance mode');
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}
