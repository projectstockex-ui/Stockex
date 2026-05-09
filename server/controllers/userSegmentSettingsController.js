import User from '../models/User.js';
import Admin from '../models/Admin.js';
import leverageValidationService from '../services/leverageValidationService.js';
import hierarchyValidationService from '../services/hierarchyValidationService.js';

/**
 * User Segment Settings Controller
 * Handles business logic for user segment permissions and script settings
 * Follows SOLID principles - separates business logic from routing
 */

class UserSegmentSettingsController {
  /**
   * Get user's segment permissions and script settings
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getSegmentSettings(req, res) {
    try {
      const user = await User.findById(req.params.id).select(
        'segmentPermissions segmentExplicitKeys scriptSettings username adminCode hierarchyPath admin'
      );

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Verify access - user must belong to this admin or be in hierarchy
      if (req.admin.role !== 'SUPER_ADMIN') {
        const isDirectParent = user.adminCode === req.admin.adminCode;
        const isInHierarchy = user.hierarchyPath?.some(id => id.toString() === req.admin._id.toString());

        if (!isDirectParent && !isInHierarchy) {
          return res.status(403).json({ message: 'This user is not under your management' });
        }
      }

      // Convert Maps to plain objects
      const segmentPermissions = user.segmentPermissions instanceof Map
        ? Object.fromEntries(user.segmentPermissions)
        : (user.segmentPermissions || {});

      const scriptSettings = user.scriptSettings instanceof Map
        ? Object.fromEntries(user.scriptSettings)
        : (user.scriptSettings || {});

      let segmentExplicitKeys = user.segmentExplicitKeys;
      if (segmentExplicitKeys instanceof Map) {
        segmentExplicitKeys = Object.fromEntries(segmentExplicitKeys);
      }

      res.json({
        segmentPermissions,
        scriptSettings,
        segmentExplicitKeys
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }

  /**
   * Update user's segment permissions and script settings
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updateSegmentSettings(req, res) {
    try {
      const { segmentPermissions, scriptSettings, segmentExplicitKeys } = req.body;
      const parentAdmin = req.admin;

      console.log('[UserSegmentSettings] UPDATE CALLED');
      console.log('[UserSegmentSettings] Parent:', parentAdmin.name, 'Role:', parentAdmin.role, 'ParentId:', parentAdmin.parentId);
      console.log('[UserSegmentSettings] Target User ID:', req.params.id);
      console.log('[UserSegmentSettings] Request body segments:', Object.keys(segmentPermissions || {}));
      console.log('[UserSegmentSettings] Received data:', JSON.stringify({ segmentPermissions, scriptSettings, segmentExplicitKeys }, null, 2));

      const user = await User.findById(req.params.id);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      console.log('[UserSegmentSettings] Current user segmentPermissions before update:', JSON.stringify(user.segmentPermissions, null, 2));

      // Verify access - user must belong to this admin or be in hierarchy
      if (parentAdmin.role !== 'SUPER_ADMIN') {
        const isDirectParent = user.adminCode === parentAdmin.adminCode;
        const isInHierarchy = user.hierarchyPath?.some(id => id.toString() === req.admin._id.toString());

        if (!isDirectParent && !isInHierarchy) {
          return res.status(403).json({ message: 'This user is not under your management' });
        }
      }

      // For non-superadmin, fetch their parent to check hierarchy permissions
      let grandParentAdmin = null;
      if (parentAdmin.role !== 'SUPER_ADMIN' && parentAdmin.parentId) {
        grandParentAdmin = await Admin.findById(parentAdmin.parentId).select('segmentPermissions');
      }

      const updateFields = {};

      if (segmentPermissions && typeof segmentPermissions === 'object') {
        let plain =
          segmentPermissions instanceof Map ? Object.fromEntries(segmentPermissions) : segmentPermissions;

        console.log('[UserSegmentSettings] Plain data before validation:', JSON.stringify(plain, null, 2));

        // Validate segment permissions against parent admin's limits
        const parentSegPerms = parentAdmin.segmentPermissions instanceof Map
          ? Object.fromEntries(parentAdmin.segmentPermissions)
          : (parentAdmin.segmentPermissions || {});

        // Get grandparent segment permissions to check if parent has the segment enabled by their parent
        let grandParentSegPerms = {};
        if (grandParentAdmin) {
          grandParentSegPerms = grandParentAdmin.segmentPermissions instanceof Map
            ? Object.fromEntries(grandParentAdmin.segmentPermissions)
            : (grandParentAdmin.segmentPermissions || {});
        }

        const parentMaxLeverage = parentAdmin.role === 'SUPER_ADMIN'
          ? 2000
          : (parentAdmin.leverageSettings?.maxLeverageFromParent || 10);

        for (const [segName, segData] of Object.entries(plain)) {
          if (!segData || typeof segData !== 'object') continue;

          const parentSeg = parentSegPerms[segName] || {};

          // Validate enabled field using hierarchy validation service
          const segmentValidation = await hierarchyValidationService.validateSegmentPermission(parentAdmin, segName, segData.enabled);
          if (!segmentValidation.allowed) {
            return res.status(400).json({ message: segmentValidation.message });
          }

          // Validate leverage fields
          const intraday = segData.intradayLeverage || segData.exposureIntraday;
          const parentIntraday = parentSeg.intradayLeverage || parentSeg.exposureIntraday || parentMaxLeverage;
          if (intraday && intraday > parentIntraday && parentAdmin.role !== 'SUPER_ADMIN') {
            return res.status(400).json({
              message: `Unable to set the leverage more than parent hierarchy. ${segName} Intraday Leverage (${intraday}x) exceeds parent's limit (${parentIntraday}x)`
            });
          }

          const carryForward = segData.carryForwardLeverage || segData.exposureCarryForward;
          const parentCarryForward = parentSeg.carryForwardLeverage || parentSeg.exposureCarryForward || parentMaxLeverage;
          if (carryForward && carryForward > parentCarryForward && parentAdmin.role !== 'SUPER_ADMIN') {
            return res.status(400).json({
              message: `Unable to set the leverage more than parent hierarchy. ${segName} Carry Forward Leverage (${carryForward}x) exceeds parent's limit (${parentCarryForward}x)`
            });
          }

          // Validate maxLots
          if (segData.maxLots !== undefined && parentSeg.maxLots !== undefined && parentAdmin.role !== 'SUPER_ADMIN') {
            if (segData.maxLots > parentSeg.maxLots) {
              return res.status(400).json({
                message: `Unable to set maxLots more than parent hierarchy. ${segName} maxLots (${segData.maxLots}) exceeds parent's limit (${parentSeg.maxLots})`
              });
            }
          }

          // Validate maxExchangeLots
          if (segData.maxExchangeLots !== undefined && parentSeg.maxExchangeLots !== undefined && parentAdmin.role !== 'SUPER_ADMIN') {
            if (segData.maxExchangeLots > parentSeg.maxExchangeLots) {
              return res.status(400).json({
                message: `Unable to set maxExchangeLots more than parent hierarchy. ${segName} maxExchangeLots (${segData.maxExchangeLots}) exceeds parent's limit (${parentSeg.maxExchangeLots})`
              });
            }
          }

          // Validate orderLots
          if (segData.orderLots !== undefined && parentSeg.orderLots !== undefined && parentAdmin.role !== 'SUPER_ADMIN') {
            if (segData.orderLots > parentSeg.orderLots) {
              return res.status(400).json({
                message: `Unable to set orderLots more than parent hierarchy. ${segName} orderLots (${segData.orderLots}) exceeds parent's limit (${parentSeg.orderLots})`
              });
            }
          }

          // Validate commissionLot
          if (segData.commissionLot !== undefined && parentSeg.commissionLot !== undefined && parentAdmin.role !== 'SUPER_ADMIN') {
            if (segData.commissionLot > parentSeg.commissionLot) {
              return res.status(400).json({
                message: `Unable to set commissionLot more than parent hierarchy. ${segName} commissionLot (${segData.commissionLot}) exceeds parent's limit (${parentSeg.commissionLot})`
              });
            }
          }
        }

        // For user segment settings, save directly without alignSegmentDefaultsMap to preserve custom values
        // alignSegmentDefaultsMap is only for admin settings where defaults need to be aligned
        // Save as plain object instead of Map to avoid conversion issues
        updateFields.segmentPermissions = plain;
        console.log('[UserSegmentSettings] Plain object to be saved:', updateFields.segmentPermissions);
      }

      if (scriptSettings && typeof scriptSettings === 'object') {
        updateFields.scriptSettings = scriptSettings;
      }

      if (segmentExplicitKeys !== undefined) {
        const { sanitizeSegmentExplicitKeysForSave } = await import('../utils/commissionTypeUnit.js');
        const sanitized = sanitizeSegmentExplicitKeysForSave(segmentExplicitKeys);
        if (sanitized !== undefined) {
          updateFields.segmentExplicitKeys = sanitized;
        }
      }

      if (Object.keys(updateFields).length === 0) {
        return res.status(400).json({ message: 'No settings provided to update' });
      }

      console.log('[UserSegmentSettings] Update fields:', JSON.stringify(updateFields, null, 2));

      await User.updateOne({ _id: user._id }, { $set: updateFields });

      const updatedUser = await User.findById(user._id).select('-password');

      console.log('[UserSegmentSettings] Updated user segmentPermissions:', JSON.stringify(updatedUser.segmentPermissions, null, 2));

      res.json({
        message: 'User segment settings updated successfully',
        user: {
          _id: updatedUser._id,
          username: updatedUser.username,
          segmentPermissions: updatedUser.segmentPermissions,
          segmentExplicitKeys: updatedUser.segmentExplicitKeys,
          scriptSettings: updatedUser.scriptSettings,
        },
      });
    } catch (error) {
      console.error('[UserSegmentSettings] Error:', error);
      res.status(500).json({ message: error.message });
    }
  }
}

export default new UserSegmentSettingsController();
