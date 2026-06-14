import User from '../models/User.js';
import Admin from '../models/Admin.js';
import leverageValidationService from '../services/leverageValidationService.js';
import hierarchyValidationService from '../services/hierarchyValidationService.js';
import {
  canManageUserSegmentSettings,
  getAllowEditSubordinateClientValues,
} from '../utils/adminClientSettingsAccess.js';
import {
  validateSegmentIntradayOnlyHierarchy,
  enforceIntradayOnlyHierarchyOnSegment,
} from '../utils/segmentHierarchyGate.js';

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

      if (req.admin.role !== 'SUPER_ADMIN') {
        const allowSubordinateClients = await getAllowEditSubordinateClientValues();
        if (!canManageUserSegmentSettings(req.admin, user, allowSubordinateClients)) {
          return res.status(403).json({
            message: allowSubordinateClients
              ? 'This user is not under your management'
              : 'You can only change settings for your direct clients. Ask Super Admin to enable hierarchy client settings.',
          });
        }
      }

      // Convert Maps to plain objects
      let segmentPermissions = user.segmentPermissions instanceof Map
        ? Object.fromEntries(user.segmentPermissions)
        : (user.segmentPermissions || {});

      const scriptSettings = user.scriptSettings instanceof Map
        ? Object.fromEntries(user.scriptSettings)
        : (user.scriptSettings || {});

      let segmentExplicitKeys = user.segmentExplicitKeys;
      if (segmentExplicitKeys instanceof Map) {
        segmentExplicitKeys = Object.fromEntries(segmentExplicitKeys);
      }

      // Filter segment permissions based on parent admin's enabled segments
      // If parent has disabled a segment, child cannot enable it
      if (user.admin) {
        const parentAdmin = await Admin.findById(user.admin).select('name segmentPermissions');
        if (parentAdmin) {
          const parentSegPerms = parentAdmin.segmentPermissions instanceof Map
            ? Object.fromEntries(parentAdmin.segmentPermissions)
            : (parentAdmin.segmentPermissions || {});

          console.log('[UserSegmentSettings GET] Filtering segments based on parent admin permissions');
          console.log('[UserSegmentSettings GET] Parent:', parentAdmin.name || 'Unknown', 'Parent segments:', Object.keys(parentSegPerms));

          // Filter out segments that parent has disabled
          const filteredSegmentPermissions = {};
          for (const [segName, segData] of Object.entries(segmentPermissions)) {
            const parentSeg = parentSegPerms[segName] || {};
            const parentSegEnabled = parentSeg.enabled ?? false;

            if (parentSegEnabled) {
              // Parent has this segment enabled, child can manage it
              filteredSegmentPermissions[segName] = segData;
            } else {
              // Parent has this segment disabled, force it to disabled for child
              filteredSegmentPermissions[segName] = {
                ...segData,
                enabled: false
              };
              console.log('[UserSegmentSettings GET] Forced disabled for child:', segName, '- parent has it disabled');
            }
          }

          // Also add any segments that parent has but child doesn't
          for (const [segName, parentSegData] of Object.entries(parentSegPerms)) {
            if (!filteredSegmentPermissions[segName]) {
              filteredSegmentPermissions[segName] = {
                ...parentSegData,
                enabled: false // Child should explicitly enable if needed
              };
            }
          }

          segmentPermissions = filteredSegmentPermissions;
          console.log('[UserSegmentSettings GET] Filtered segments:', Object.keys(segmentPermissions));
        }
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

      if (parentAdmin.role !== 'SUPER_ADMIN') {
        const allowSubordinateClients = await getAllowEditSubordinateClientValues();
        if (!canManageUserSegmentSettings(parentAdmin, user, allowSubordinateClients)) {
          return res.status(403).json({
            message: allowSubordinateClients
              ? 'This user is not under your management'
              : 'You can only change settings for your direct clients. Ask Super Admin to enable hierarchy client settings.',
          });
        }
      }

      // For non-superadmin, fetch their parent to check hierarchy permissions
      let grandParentAdmin = null;
      if (parentAdmin.role !== 'SUPER_ADMIN' && parentAdmin.parentId) {
        grandParentAdmin = await Admin.findById(parentAdmin.parentId).select('segmentPermissions');
      }

      const updateFields = {};

      if (segmentPermissions && typeof segmentPermissions === 'object') {
        const { normalizeSegmentPermissionsPayload } = await import('../utils/segmentPermissionNormalize.js');
        let plain = normalizeSegmentPermissionsPayload(
          segmentPermissions instanceof Map ? Object.fromEntries(segmentPermissions) : segmentPermissions
        );

        {
          const { stripMcxSessionTimingFromSegmentMap } = await import('../utils/mcxSessionTiming.js');
          const { stripNseBseSessionTimingFromSegmentMap } = await import('../utils/nseBseSessionTiming.js');
          const { stripCryptoSessionTimingFromSegmentMap } = await import('../utils/cryptoSessionTiming.js');
          plain = stripMcxSessionTimingFromSegmentMap(plain);
          plain = stripNseBseSessionTimingFromSegmentMap(plain);
          plain = stripCryptoSessionTimingFromSegmentMap(plain);
        }

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
          ? (parentAdmin.leverageSettings?.maxLeverageFromParent || 2000)
          : (parentAdmin.leverageSettings?.maxLeverageFromParent || 10);

        for (const [segName, segData] of Object.entries(plain)) {
          if (!segData || typeof segData !== 'object') continue;

          const parentSeg = parentSegPerms[segName] || {};

          // EXPLICIT CHECK: If trying to enable a segment, check if user's direct parent admin has it enabled
          if (segData.enabled === true) {
            // Check if user's direct parent admin has the segment enabled
            const userDirectParent = await Admin.findById(user.admin).select('segmentPermissions name role');
            if (userDirectParent) {
              const userParentSegPerms = userDirectParent.segmentPermissions instanceof Map
                ? Object.fromEntries(userDirectParent.segmentPermissions)
                : (userDirectParent.segmentPermissions || {});
              const parentHasSegment = userParentSegPerms[segName]?.enabled ?? false;
              console.log('[UserSegmentSettings] Checking if user parent admin has', segName, 'enabled:', parentHasSegment);
              console.log('[UserSegmentSettings] User parent admin:', userDirectParent.name, 'has segments:', Object.keys(userParentSegPerms).filter(k => userParentSegPerms[k]?.enabled));
              if (!parentHasSegment && userDirectParent.role !== 'SUPER_ADMIN') {
                console.log('[UserSegmentSettings] BLOCKING:', segName, '- user parent admin does not have this segment');
                return res.status(400).json({
                  message: `Cannot enable ${segName} - user's direct parent admin does not have this segment enabled. Contact your broker.`
                });
              }
            }
          }

          // Validate enabled field using hierarchy validation service
          const segmentValidation = await hierarchyValidationService.validateSegmentPermission(parentAdmin, segName, segData.enabled);
          if (!segmentValidation.allowed) {
            return res.status(400).json({ message: segmentValidation.message });
          }

          const intradayOnlyCheck = validateSegmentIntradayOnlyHierarchy(parentSeg, segData, parentAdmin.role, segName);
          if (!intradayOnlyCheck.allowed) {
            return res.status(400).json({ message: intradayOnlyCheck.message });
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

          // Validate breakupQuantity (nested under quantitySettings)
          const userBreakupQty = segData.quantitySettings?.breakupQuantity;
          const parentBreakupQty = parentSeg.quantitySettings?.breakupQuantity;
          if (userBreakupQty !== undefined && parentBreakupQty !== undefined && parentAdmin.role !== 'SUPER_ADMIN') {
            if (userBreakupQty > parentBreakupQty) {
              return res.status(400).json({
                message: `Unable to set breakupQuantity more than parent hierarchy. ${segName} breakupQuantity (${userBreakupQty}) exceeds parent's limit (${parentBreakupQty})`
              });
            }
          }

          // Validate nested lotSettings
          const userLotSettings = segData.lotSettings;
          const parentLotSettings = parentSeg.lotSettings;

          if (userLotSettings && parentLotSettings && parentAdmin.role !== 'SUPER_ADMIN') {
            // Validate lotSettings.intradayLeverage
            if (userLotSettings.intradayLeverage !== undefined && parentLotSettings.intradayLeverage !== undefined) {
              if (userLotSettings.intradayLeverage > parentLotSettings.intradayLeverage) {
                return res.status(400).json({
                  message: `Unable to set lotSettings intradayLeverage more than parent hierarchy. ${segName} intradayLeverage (${userLotSettings.intradayLeverage}x) exceeds parent's limit (${parentLotSettings.intradayLeverage}x)`
                });
              }
            }

            // Validate lotSettings.carryForwardLeverage
            if (userLotSettings.carryForwardLeverage !== undefined && parentLotSettings.carryForwardLeverage !== undefined) {
              if (userLotSettings.carryForwardLeverage > parentLotSettings.carryForwardLeverage) {
                return res.status(400).json({
                  message: `Unable to set lotSettings carryForwardLeverage more than parent hierarchy. ${segName} carryForwardLeverage (${userLotSettings.carryForwardLeverage}x) exceeds parent's limit (${parentLotSettings.carryForwardLeverage}x)`
                });
              }
            }

            // Validate lotSettings.maxLots
            if (userLotSettings.maxLots !== undefined && parentLotSettings.maxLots !== undefined) {
              if (userLotSettings.maxLots > parentLotSettings.maxLots) {
                return res.status(400).json({
                  message: `Unable to set lotSettings maxLots more than parent hierarchy. ${segName} maxLots (${userLotSettings.maxLots}) exceeds parent's limit (${parentLotSettings.maxLots})`
                });
              }
            }

            // Validate lotSettings.minLots
            if (userLotSettings.minLots !== undefined && parentLotSettings.minLots !== undefined) {
              if (userLotSettings.minLots < parentLotSettings.minLots) {
                return res.status(400).json({
                  message: `Unable to set lotSettings minLots less than parent hierarchy. ${segName} minLots (${userLotSettings.minLots}) is less than parent's limit (${parentLotSettings.minLots})`
                });
              }
            }

            // Validate lotSettings.breakupLots
            if (userLotSettings.breakupLots !== undefined && parentLotSettings.breakupLots !== undefined) {
              if (userLotSettings.breakupLots > parentLotSettings.breakupLots) {
                return res.status(400).json({
                  message: `Unable to set lotSettings breakupLots more than parent hierarchy. ${segName} breakupLots (${userLotSettings.breakupLots}) exceeds parent's limit (${parentLotSettings.breakupLots})`
                });
              }
            }
          }

          // Validate nested quantityModeSettings
          const userQtySettings = segData.quantityModeSettings;
          const parentQtySettings = parentSeg.quantityModeSettings;

          if (userQtySettings && parentQtySettings && parentAdmin.role !== 'SUPER_ADMIN') {
            // Validate quantityModeSettings.intradayLeverage
            if (userQtySettings.intradayLeverage !== undefined && parentQtySettings.intradayLeverage !== undefined) {
              if (userQtySettings.intradayLeverage > parentQtySettings.intradayLeverage) {
                return res.status(400).json({
                  message: `Unable to set quantityModeSettings intradayLeverage more than parent hierarchy. ${segName} intradayLeverage (${userQtySettings.intradayLeverage}x) exceeds parent's limit (${parentQtySettings.intradayLeverage}x)`
                });
              }
            }

            // Validate quantityModeSettings.carryForwardLeverage
            if (userQtySettings.carryForwardLeverage !== undefined && parentQtySettings.carryForwardLeverage !== undefined) {
              if (userQtySettings.carryForwardLeverage > parentQtySettings.carryForwardLeverage) {
                return res.status(400).json({
                  message: `Unable to set quantityModeSettings carryForwardLeverage more than parent hierarchy. ${segName} carryForwardLeverage (${userQtySettings.carryForwardLeverage}x) exceeds parent's limit (${parentQtySettings.carryForwardLeverage}x)`
                });
              }
            }

            // Validate quantityModeSettings.maxQuantity
            if (userQtySettings.maxQuantity !== undefined && parentQtySettings.maxQuantity !== undefined) {
              if (userQtySettings.maxQuantity > parentQtySettings.maxQuantity) {
                return res.status(400).json({
                  message: `Unable to set quantityModeSettings maxQuantity more than parent hierarchy. ${segName} maxQuantity (${userQtySettings.maxQuantity}) exceeds parent's limit (${parentQtySettings.maxQuantity})`
                });
              }
            }

            // Validate quantityModeSettings.minQuantity
            if (userQtySettings.minQuantity !== undefined && parentQtySettings.minQuantity !== undefined) {
              if (userQtySettings.minQuantity < parentQtySettings.minQuantity) {
                return res.status(400).json({
                  message: `Unable to set quantityModeSettings minQuantity less than parent hierarchy. ${segName} minQuantity (${userQtySettings.minQuantity}) is less than parent's limit (${parentQtySettings.minQuantity})`
                });
              }
            }

            // Validate quantityModeSettings.breakupQuantity
            if (userQtySettings.breakupQuantity !== undefined && parentQtySettings.breakupQuantity !== undefined) {
              if (userQtySettings.breakupQuantity > parentQtySettings.breakupQuantity) {
                return res.status(400).json({
                  message: `Unable to set quantityModeSettings breakupQuantity more than parent hierarchy. ${segName} breakupQuantity (${userQtySettings.breakupQuantity}) exceeds parent's limit (${parentQtySettings.breakupQuantity})`
                });
              }
            }
          }
        }

        if (parentAdmin.role !== 'SUPER_ADMIN') {
          for (const [segName, segData] of Object.entries(plain)) {
            if (!segData || typeof segData !== 'object') continue;
            const parentSeg = parentSegPerms[segName] || {};
            plain[segName] = enforceIntradayOnlyHierarchyOnSegment(parentSeg, segData, parentAdmin.role, segName);
          }
        }

        const { syncSegmentCommissionMap } = await import('../utils/commissionTypeUnit.js');
        syncSegmentCommissionMap(plain);

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
        let sanitized = sanitizeSegmentExplicitKeysForSave(segmentExplicitKeys);
        if (sanitized) {
          const { stripMcxKeysFromSegmentExplicitKeys } = await import('../utils/mcxSessionTiming.js');
          const { stripNseBseKeysFromSegmentExplicitKeys } = await import('../utils/nseBseSessionTiming.js');
          const { stripCryptoKeysFromSegmentExplicitKeys } = await import('../utils/cryptoSessionTiming.js');
          sanitized = stripMcxKeysFromSegmentExplicitKeys(sanitized);
          sanitized = stripNseBseKeysFromSegmentExplicitKeys(sanitized);
          sanitized = stripCryptoKeysFromSegmentExplicitKeys(sanitized);
        }
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
