/**
 * Hierarchical Leverage Validation Service
 * Validates leverage settings across admin hierarchy to ensure children don't exceed parent limits
 */

import Admin from '../models/Admin.js';

class LeverageValidationService {
  /**
   * Validate leverage hierarchy - ensures child admin's leverage doesn't exceed parent's maxLeverageFromParent
   * @param {Object} childAdmin - The child admin document
   * @param {Object} parentAdmin - The parent admin document
   * @returns {Object} { valid: boolean, error: string }
   */
  validateLeverageHierarchy(childAdmin, parentAdmin) {
    if (!parentAdmin || !parentAdmin.leverageSettings) {
      return { valid: true, error: null };
    }

    const parentMaxLeverage = parentAdmin.leverageSettings.maxLeverageFromParent || 1;
    const childLeverageSettings = childAdmin.leverageSettings || {};

    // Check all leverage types against parent's maxLeverageFromParent
    const leverageTypes = [
      { key: 'intradayLeverage', label: 'Intraday' },
      { key: 'carryForwardLeverage', label: 'Carry Forward' },
      { key: 'overnightLeverage', label: 'Overnight' },
      { key: 'deliveryLeverage', label: 'Delivery' }
    ];

    for (const { key, label } of leverageTypes) {
      const childValue = childLeverageSettings[key];
      if (childValue && childValue > parentMaxLeverage) {
        return {
          valid: false,
          error: `limit exceeded: ${label} leverage (${childValue}x) cannot exceed parent's maximum (${parentMaxLeverage}x)`
        };
      }
    }

    // Check legacy maxLeverage field for backward compatibility
    if (childLeverageSettings.maxLeverage && childLeverageSettings.maxLeverage > parentMaxLeverage) {
      return {
        valid: false,
        error: `limit exceeded: Max leverage (${childLeverageSettings.maxLeverage}x) cannot exceed parent's maximum (${parentMaxLeverage}x)`
      };
    }

    return { valid: true, error: null };
  }

  /**
   * Validate leverage at trade execution time
   * @param {Object} admin - The admin executing the trade
   * @param {string} leverageType - Type of leverage (intraday, carryforward, overnight, delivery)
   * @param {number} requestedLeverage - The leverage being requested
   * @returns {Object} { valid: boolean, error: string }
   */
  validateLeverageAtTradeExecution(admin, leverageType, requestedLeverage) {
    if (!admin || !admin.leverageSettings) {
      return { valid: true, error: null };
    }

    const adminMaxLeverage = admin.leverageSettings.maxLeverageFromParent || 1;

    if (requestedLeverage > adminMaxLeverage) {
      return {
        valid: false,
        error: `limit exceeded: Requested ${leverageType} leverage (${requestedLeverage}x) exceeds your maximum (${adminMaxLeverage}x)`
      };
    }

    return { valid: true, error: null };
  }

  /**
   * Get effective leverage settings for an admin (merged with parent's maxLeverageFromParent)
   * @param {Object} admin - The admin document
   * @returns {Object} Effective leverage settings
   */
  getEffectiveLeverageSettings(admin) {
    if (!admin) {
      return {
        intradayLeverage: 1,
        carryForwardLeverage: 1,
        overnightLeverage: 1,
        deliveryLeverage: 1,
        maxLeverage: 1
      };
    }

    const settings = admin.leverageSettings || {};
    const maxLeverage = settings.maxLeverageFromParent || 1;

    // Cap all leverage values at maxLeverageFromParent
    return {
      intradayLeverage: Math.min(settings.intradayLeverage || 1, maxLeverage),
      carryForwardLeverage: Math.min(settings.carryForwardLeverage || 1, maxLeverage),
      overnightLeverage: Math.min(settings.overnightLeverage || 1, maxLeverage),
      deliveryLeverage: Math.min(settings.deliveryLeverage || 1, maxLeverage),
      maxLeverage: Math.min(settings.maxLeverage || 1, maxLeverage)
    };
  }

  /**
   * Validate leverage cap being set by parent admin
   * @param {Object} parentAdmin - The parent admin setting the cap
   * @param {number} newMaxLeverage - The new max leverage being set
   * @returns {Object} { valid: boolean, error: string }
   */
  validateLeverageCap(parentAdmin, newMaxLeverage) {
    // Ensure the cap is at least 1x
    if (newMaxLeverage < 1) {
      return {
        valid: false,
        error: 'Leverage cap must be at least 1x'
      };
    }

    // If parent has their own maxLeverageFromParent, they cannot set a higher cap for their child
    if (parentAdmin && parentAdmin.leverageSettings) {
      const parentMax = parentAdmin.leverageSettings.maxLeverageFromParent || 1;
      if (newMaxLeverage > parentMax) {
        return {
          valid: false,
          error: `limit exceeded: You cannot set leverage cap (${newMaxLeverage}x) higher than your own maximum (${parentMax}x)`
        };
      }
    }

    return { valid: true, error: null };
  }

  /**
   * Get parent's maximum leverage limit based on their leverage settings
   * Priority: maxLeverageFromParent > segmentPermissions leverage values
   * @param {Object} parentAdmin - The parent admin document
   * @returns {number} Maximum leverage limit
   */
  getParentMaxLeverageLimit(parentAdmin) {
    if (!parentAdmin) return 2000;

    // SuperAdmin has unlimited leverage
    if (parentAdmin.role === 'SUPER_ADMIN') return 2000;

    // First priority: maxLeverageFromParent (the cap set by the parent's parent)
    if (parentAdmin.leverageSettings?.maxLeverageFromParent) {
      return parentAdmin.leverageSettings.maxLeverageFromParent;
    }

    // Second priority: check segmentPermissions for maximum leverage value
    // This handles cases where leverage was set via segment settings UI
    if (parentAdmin.segmentPermissions) {
      const segPerms = parentAdmin.segmentPermissions instanceof Map
        ? Object.fromEntries(parentAdmin.segmentPermissions)
        : parentAdmin.segmentPermissions;
      const leverageValues = [];
      for (const segData of Object.values(segPerms)) {
        if (segData && typeof segData === 'object') {
          if (segData.exposureIntraday) leverageValues.push(segData.exposureIntraday);
          if (segData.exposureCarryForward) leverageValues.push(segData.exposureCarryForward);
        }
      }
      if (leverageValues.length > 0) {
        return Math.max(...leverageValues);
      }
    }

    // Default: no limit
    return 2000;
  }

  /**
   * Validate leverage settings when parent admin sets leverage for child admin
   * @param {Object} parentAdmin - The parent admin setting the leverage
   * @param {Object} leverageData - Leverage data being set { maxLeverageFromParent, intradayLeverage, carryForwardLeverage }
   * @returns {Object} { valid: boolean, error: string }
   */
  validateChildLeverageSettings(parentAdmin, leverageData) {
    const { maxLeverageFromParent, intradayLeverage, carryForwardLeverage } = leverageData;
    const parentMaxLeverage = this.getParentMaxLeverageLimit(parentAdmin);

    // Validate maxLeverageFromParent doesn't exceed parent's limit
    if (maxLeverageFromParent && maxLeverageFromParent > parentMaxLeverage) {
      return {
        valid: false,
        error: `Cannot set leverage higher than your limit (${parentMaxLeverage}x)`
      };
    }

    // Validate intradayLeverage doesn't exceed parent's limit
    if (intradayLeverage && intradayLeverage > parentMaxLeverage) {
      return {
        valid: false,
        error: 'Unable to set the leverage more than parent hierarchy'
      };
    }

    // Validate carryForwardLeverage doesn't exceed parent's limit
    if (carryForwardLeverage && carryForwardLeverage > parentMaxLeverage) {
      return {
        valid: false,
        error: 'Unable to set the leverage more than parent hierarchy'
      };
    }

    return { valid: true, error: null };
  }
}

export default new LeverageValidationService();
