/**
 * Brokerage Distribution Service
 * Handles brokerage distribution logic with selective inheritance support
 * Follows SOLID principles with dependency injection
 */

import { shouldRedirectBrokerageToSuperAdminEnhanced } from './brokerageRestrictionService.js';
import { getEffectiveBrokerageRestriction } from './selectiveBrokerageService.js';

/**
 * Brokerage Distribution Service Class
 * Implements dependency inversion for flexible brokerage distribution
 */
export class BrokerageDistributionService {
  constructor(brokerageRestrictionService, selectiveBrokerageService) {
    this.restrictionService = brokerageRestrictionService;
    this.selectiveService = selectiveBrokerageService;
  }

  /**
   * Distribute brokerage considering selective inheritance rules
   * @param {Object} tradeData - Trade/order data
   * @param {Array} hierarchyPath - Array of admin hierarchy [parent, child, etc.]
   * @param {string} segment - 'games' | 'trading'
   * @returns {Array} - Brokerage distribution array
   */
  distributeBrokerage(tradeData, hierarchyPath, segment) {
    if (!tradeData || !hierarchyPath || !segment) {
      throw new Error('Invalid parameters for brokerage distribution');
    }

    const distribution = [];
    let remainingBrokerage = this.calculateTotalBrokerage(tradeData, segment);

    for (let i = 0; i < hierarchyPath.length; i++) {
      const admin = hierarchyPath[i];
      const parentAdmin = i > 0 ? hierarchyPath[i - 1] : null;

      // Check if this admin should receive brokerage
      if (this.shouldReceiveBrokerage(admin, parentAdmin, segment)) {
        const brokerageAmount = this.calculateAdminBrokerage(admin, remainingBrokerage, segment);
        
        distribution.push({
          adminId: admin._id,
          adminName: admin.name || admin.username,
          role: admin.role,
          brokerageAmount,
          segment,
          isRestricted: false,
          inheritanceMode: admin.restrictMode?.hierarchyInheritanceMode || 'FULL_INHERITANCE'
        });

        remainingBrokerage -= brokerageAmount;
      } else {
        // Brokerage goes to Super Admin
        distribution.push({
          adminId: admin._id,
          adminName: admin.name || admin.username,
          role: admin.role,
          brokerageAmount: 0,
          segment,
          isRestricted: true,
          inheritanceMode: admin.restrictMode?.hierarchyInheritanceMode || 'FULL_INHERITANCE',
          redirectedToSuperAdmin: true
        });
      }
    }

    // Add Super Admin share if any brokerage was restricted
    const totalRestricted = distribution
      .filter(d => d.isRestricted)
      .reduce((sum, d) => sum + this.calculateAdminBrokerage(d.admin, tradeData, segment), 0);

    if (totalRestricted > 0) {
      distribution.push({
        adminId: 'SUPER_ADMIN',
        adminName: 'Super Admin',
        role: 'SUPER_ADMIN',
        brokerageAmount: totalRestricted,
        segment,
        isRestricted: false,
        redirectedFromRestrictions: true
      });
    }

    return distribution;
  }

  /**
   * Check if admin should receive brokerage based on selective inheritance
   * @param {Object} admin - Admin document
   * @param {Object} parentAdmin - Parent admin document
   * @param {string} segment - 'games' | 'trading'
   * @returns {boolean} - True if admin should receive brokerage
   */
  shouldReceiveBrokerage(admin, parentAdmin, segment) {
    // Use enhanced restriction check that considers inheritance
    return !shouldRedirectBrokerageToSuperAdminEnhanced(admin, parentAdmin, segment);
  }

  /**
   * Calculate total brokerage for a trade
   * @param {Object} tradeData - Trade data
   * @param {string} segment - 'games' | 'trading'
   * @returns {number} - Total brokerage amount
   */
  calculateTotalBrokerage(tradeData, segment) {
    switch (segment) {
      case 'games':
        return tradeData.gamesBrokerage || 0;
      case 'trading':
        return tradeData.tradingBrokerage || 0;
      default:
        return 0;
    }
  }

  /**
   * Calculate brokerage amount for a specific admin
   * @param {Object} admin - Admin document
   * @param {number} totalBrokerage - Total brokerage amount
   * @param {string} segment - 'games' | 'trading'
   * @returns {number} - Brokerage amount for this admin
   */
  calculateAdminBrokerage(admin, totalBrokerage, segment) {
    // Use admin's specific brokerage rates or default split
    const adminRate = this.getAdminBrokerageRate(admin, segment);
    return totalBrokerage * (adminRate / 100);
  }

  /**
   * Get admin's brokerage rate for a segment
   * @param {Object} admin - Admin document
   * @param {string} segment - 'games' | 'trading'
   * @returns {number} - Brokerage rate percentage
   */
  getAdminBrokerageRate(admin, segment) {
    // Default rates based on role hierarchy
    const defaultRates = {
      'SUPER_ADMIN': 100,
      'ADMIN': 70,
      'BROKER': 50,
      'SUB_BROKER': 30
    };

    // Use custom rates if configured, otherwise defaults
    if (admin.charges && admin.charges.brokerage) {
      return admin.charges.brokerage;
    }

    return defaultRates[admin.role] || 0;
  }

  /**
   * Get brokerage distribution summary for reporting
   * @param {Array} distribution - Distribution array from distributeBrokerage
   * @returns {Object} - Summary statistics
   */
  getDistributionSummary(distribution) {
    const summary = {
      totalBrokerage: 0,
      distributedBrokerage: 0,
      restrictedBrokerage: 0,
      superAdminBrokerage: 0,
      adminBreakdown: {},
      segments: {}
    };

    distribution.forEach(item => {
      summary.totalBrokerage += item.brokerageAmount;

      if (item.isRestricted) {
        summary.restrictedBrokerage += item.brokerageAmount;
      } else {
        summary.distributedBrokerage += item.brokerageAmount;
      }

      if (item.role === 'SUPER_ADMIN') {
        summary.superAdminBrokerage += item.brokerageAmount;
      }

      // Admin breakdown
      const adminKey = `${item.role}_${item.adminId}`;
      if (!summary.adminBreakdown[adminKey]) {
        summary.adminBreakdown[adminKey] = {
          name: item.adminName,
          role: item.role,
          total: 0,
          restricted: item.isRestricted
        };
      }
      summary.adminBreakdown[adminKey].total += item.brokerageAmount;

      // Segment breakdown
      if (!summary.segments[item.segment]) {
        summary.segments[item.segment] = 0;
      }
      summary.segments[item.segment] += item.brokerageAmount;
    });

    return summary;
  }

  /**
   * Validate brokerage distribution parameters
   * @param {Object} tradeData - Trade data
   * @param {Array} hierarchyPath - Admin hierarchy
   * @param {string} segment - Segment
   * @returns {Object} - Validation result
   */
  validateDistributionParameters(tradeData, hierarchyPath, segment) {
    const errors = [];

    if (!tradeData || typeof tradeData !== 'object') {
      errors.push('Invalid trade data');
    }

    if (!Array.isArray(hierarchyPath) || hierarchyPath.length === 0) {
      errors.push('Invalid hierarchy path');
    }

    if (!segment || !['games', 'trading'].includes(segment)) {
      errors.push('Invalid segment');
    }

    // Validate admin objects in hierarchy
    hierarchyPath.forEach((admin, index) => {
      if (!admin || !admin._id || !admin.role) {
        errors.push(`Invalid admin at hierarchy index ${index}`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

/**
 * Create default instance with injected dependencies
 * @returns {BrokerageDistributionService} - Service instance
 */
export function createBrokerageDistributionService() {
  return new BrokerageDistributionService(
    { shouldRedirectBrokerageToSuperAdminEnhanced },
    { getEffectiveBrokerageRestriction }
  );
}
