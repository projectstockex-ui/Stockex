/**
 * Selective Brokerage Middleware
 * Automatically checks inheritance mode and sets request context
 * Follows SOLID principles with single responsibility
 */

import { getEffectiveBrokerageRestriction } from '../services/selectiveBrokerageService.js';
import { shouldRedirectBrokerageToSuperAdminEnhanced } from '../services/brokerageRestrictionService.js';

/**
 * Middleware to check selective brokerage inheritance and set request context
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
export const selectiveBrokerageMiddleware = async (req, res, next) => {
  try {
    // Only apply to admin requests
    if (!req.admin || !req.admin._id) {
      return next();
    }

    const admin = req.admin;
    
    // Set inheritance mode in request context
    req.selectiveBrokerageContext = {
      inheritanceMode: admin.restrictMode?.hierarchyInheritanceMode || 'FULL_INHERITANCE',
      isSelectiveMode: admin.restrictMode?.hierarchyInheritanceMode === 'SELECTIVE_INHERITANCE'
    };

    // If admin is in selective mode, flag that inheritance checks should be skipped
    if (req.selectiveBrokerageContext.isSelectiveMode) {
      req.skipInheritanceCheck = true;
    }

    next();
  } catch (error) {
    console.error('Error in selective brokerage middleware:', error);
    next();
  }
};

/**
 * Middleware to check if brokerage should be redirected based on inheritance
 * @param {string} segment - 'games' | 'trading'
 * @returns {Function} - Express middleware function
 */
export const brokerageInheritanceCheck = (segment) => {
  return async (req, res, next) => {
    try {
      // Skip if inheritance check is disabled
      if (req.skipInheritanceCheck) {
        req.brokerageRedirected = false;
        return next();
      }

      const admin = req.admin;
      
      // Get parent admin if available
      let parentAdmin = null;
      if (admin.createdBy) {
        const Admin = (await import('../models/Admin.js')).default;
        parentAdmin = await Admin.findById(admin.createdBy).select('restrictMode');
      }

      // Check if brokerage should be redirected
      const shouldRedirect = shouldRedirectBrokerageToSuperAdminEnhanced(admin, parentAdmin, segment);
      
      req.brokerageRedirected = shouldRedirect;
      req.brokerageRedirectReason = shouldRedirect ? 'Inheritance restriction' : null;

      next();
    } catch (error) {
      console.error('Error in brokerage inheritance check:', error);
      req.brokerageRedirected = false;
      next();
    }
  };
};

/**
 * Middleware to validate selective brokerage permissions
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
export const validateSelectiveBrokeragePermission = async (req, res, next) => {
  try {
    const { adminId } = req.params;
    const requestingAdmin = req.admin;

    if (!adminId) {
      return res.status(400).json({ message: 'Admin ID is required' });
    }

    // Find target admin
    const Admin = (await import('../models/Admin.js')).default;
    const targetAdmin = await Admin.findById(adminId).select('role createdBy');

    if (!targetAdmin) {
      return res.status(404).json({ message: 'Target admin not found' });
    }

    // Check permissions using service
    const { canModifySelectiveBrokerage } = await import('../services/selectiveBrokerageService.js');
    
    if (!canModifySelectiveBrokerage(requestingAdmin, targetAdmin)) {
      return res.status(403).json({ 
        message: 'Insufficient permissions to modify selective brokerage settings' 
      });
    }

    // Add target admin to request for later use
    req.targetAdmin = targetAdmin;
    next();
  } catch (error) {
    console.error('Error validating selective brokerage permission:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * Middleware to add effective brokerage restriction info to request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
export const addEffectiveRestrictionInfo = async (req, res, next) => {
  try {
    const admin = req.admin;
    
    // Get parent admin for inheritance calculation
    let parentAdmin = null;
    if (admin.createdBy) {
      const Admin = (await import('../models/Admin.js')).default;
      parentAdmin = await Admin.findById(admin.createdBy).select('restrictMode');
    }

    // Get effective restriction status
    const effectiveRestriction = getEffectiveBrokerageRestriction(admin, parentAdmin);
    
    req.effectiveBrokerageRestriction = effectiveRestriction;
    next();
  } catch (error) {
    console.error('Error adding effective restriction info:', error);
    next();
  }
};

/**
 * Middleware to audit brokerage restriction changes
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
export const auditBrokerageRestrictionChange = async (req, res, next) => {
  try {
    const originalSend = res.send;
    
    res.send = function(data) {
      // Only audit successful updates
      if (res.statusCode >= 200 && res.statusCode < 300 && req.method === 'PUT') {
        const auditData = {
          timestamp: new Date(),
          adminId: req.admin._id,
          adminName: req.admin.name || req.admin.username,
          action: 'BROKERAGE_RESTRICTION_UPDATE',
          targetAdminId: req.params.id,
          changes: req.body,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        };

        // Log audit data (you can implement actual logging storage)
        console.log('Brokerage Restriction Audit:', JSON.stringify(auditData, null, 2));
      }
      
      originalSend.call(this, data);
    };
    
    next();
  } catch (error) {
    console.error('Error in audit middleware:', error);
    next();
  }
};

/**
 * Combined middleware for selective brokerage operations
 * Applies all selective brokerage checks in sequence
 */
export const selectiveBrokerageProtection = [
  selectiveBrokerageMiddleware,
  addEffectiveRestrictionInfo,
  auditBrokerageRestrictionChange
];
