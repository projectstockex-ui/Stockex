import Admin from '../models/Admin.js';
import { 
  validateBrokerageRestrictionData, 
  getBrokerageRestrictionStatus,
  getComprehensiveBrokerageRestrictionStatus,
  shouldRedirectBrokerageToSuperAdminEnhanced
} from '../services/brokerageRestrictionService.js';
import {
  validateSelectiveBrokerageData,
  getEffectiveBrokerageRestriction,
  canModifySelectiveBrokerage
} from '../services/selectiveBrokerageService.js';

/**
 * Get brokerage restriction settings for an admin
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getBrokerageRestriction = async (req, res) => {
  try {
    const { id } = req.params;
    
    const admin = await Admin.findById(id)
      .select('restrictMode username name role adminCode');
    
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    const restrictionStatus = getBrokerageRestrictionStatus(admin);
    
    res.json({
      admin: {
        _id: admin._id,
        username: admin.username,
        name: admin.name,
        role: admin.role,
        adminCode: admin.adminCode
      },
      brokerageRestriction: restrictionStatus
    });
  } catch (error) {
    console.error('Error fetching brokerage restriction:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Update brokerage restriction settings for an admin
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const updateBrokerageRestriction = async (req, res) => {
  try {
    const { id } = req.params;
    const { restrictBrokerage } = req.body;
    
    // Validate input data
    const validation = validateBrokerageRestrictionData({ restrictBrokerage });
    if (!validation.isValid) {
      return res.status(400).json({ 
        message: 'Invalid data', 
        errors: validation.errors 
      });
    }
    
    const admin = await Admin.findById(id);
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    // Initialize restrictMode if it doesn't exist
    if (!admin.restrictMode) {
      admin.restrictMode = {};
    }

    // Update brokerage restriction settings
    admin.restrictMode.restrictBrokerage = {
      games: restrictBrokerage?.games || false,
      trading: restrictBrokerage?.trading || false
    };

    await admin.save();

    const restrictionStatus = getBrokerageRestrictionStatus(admin);

    res.json({
      message: 'Brokerage restriction updated successfully',
      admin: {
        _id: admin._id,
        username: admin.username,
        name: admin.name,
        role: admin.role,
        adminCode: admin.adminCode
      },
      brokerageRestriction: restrictionStatus
    });
  } catch (error) {
    console.error('Error updating brokerage restriction:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Update selective brokerage control settings for an admin
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const updateSelectiveBrokerageControl = async (req, res) => {
  try {
    const { id } = req.params;
    const { hierarchyInheritanceMode, restrictBrokerage } = req.body;
    const requestingAdmin = req.admin;
    
    // Find target admin
    const targetAdmin = await Admin.findById(id)
      .select('username name role adminCode restrictMode createdBy');
    
    if (!targetAdmin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    // Check permissions
    if (!canModifySelectiveBrokerage(requestingAdmin, targetAdmin)) {
      return res.status(403).json({ 
        message: 'Insufficient permissions to modify selective brokerage settings' 
      });
    }

    // Validate data
    const validation = validateSelectiveBrokerageData({ 
      hierarchyInheritanceMode, 
      restrictBrokerage 
    });
    
    if (!validation.isValid) {
      return res.status(400).json({ errors: validation.errors });
    }

    // Update admin with selective control settings
    const updateData = {};
    
    if (hierarchyInheritanceMode !== undefined) {
      updateData['restrictMode.hierarchyInheritanceMode'] = hierarchyInheritanceMode;
    }
    
    if (restrictBrokerage !== undefined) {
      updateData['restrictMode.restrictBrokerage'] = restrictBrokerage;
    }

    const updatedAdmin = await Admin.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).select('username name role adminCode restrictMode');

    // Get comprehensive status
    const comprehensiveStatus = getComprehensiveBrokerageRestrictionStatus(
      updatedAdmin, 
      requestingAdmin.role === 'SUPER_ADMIN' ? null : requestingAdmin
    );

    res.json({
      message: 'Selective brokerage control updated successfully',
      admin: {
        _id: updatedAdmin._id,
        username: updatedAdmin.username,
        name: updatedAdmin.name,
        role: updatedAdmin.role,
        adminCode: updatedAdmin.adminCode
      },
      selectiveBrokerageControl: {
        hierarchyInheritanceMode: updatedAdmin.restrictMode?.hierarchyInheritanceMode,
        restrictBrokerage: updatedAdmin.restrictMode?.restrictBrokerage
      },
      effectiveRestrictions: comprehensiveStatus.effectiveRestrictions
    });

  } catch (error) {
    console.error('Error updating selective brokerage control:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Get comprehensive brokerage restriction status including inheritance
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getComprehensiveBrokerageRestriction = async (req, res) => {
  try {
    const { id } = req.params;
    const requestingAdmin = req.admin;
    
    // Find target admin
    const targetAdmin = await Admin.findById(id)
      .select('username name role adminCode restrictMode createdBy');
    
    if (!targetAdmin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    // Get parent admin for inheritance calculation
    let parentAdmin = null;
    if (targetAdmin.createdBy) {
      parentAdmin = await Admin.findById(targetAdmin.createdBy)
        .select('restrictMode');
    }

    // Get comprehensive status
    const comprehensiveStatus = getComprehensiveBrokerageRestrictionStatus(targetAdmin, parentAdmin);

    res.json({
      admin: {
        _id: targetAdmin._id,
        username: targetAdmin.username,
        name: targetAdmin.name,
        role: targetAdmin.role,
        adminCode: targetAdmin.adminCode
      },
      comprehensiveBrokerageRestriction: comprehensiveStatus
    });

  } catch (error) {
    console.error('Error fetching comprehensive brokerage restriction:', error);
    res.status(500).json({ message: error.message });
  }
};
