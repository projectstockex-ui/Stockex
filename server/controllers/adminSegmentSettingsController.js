import Admin from '../models/Admin.js';
import leverageValidationService from '../services/leverageValidationService.js';
import hierarchyValidationService from '../services/hierarchyValidationService.js';

/**
 * Admin Segment Settings Controller
 * Handles business logic for admin segment permissions and script settings
 * Follows SOLID principles - separates business logic from routing
 */

class AdminSegmentSettingsController {
  /**
   * Get admin's segment permissions and script settings
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getSegmentSettings(req, res) {
    try {
      console.log('[Segment Settings GET] CALLED');
      console.log('[Segment Settings GET] Current Admin:', req.admin.name, 'Role:', req.admin.role, 'ParentId:', req.admin.parentId);
      console.log('[Segment Settings GET] Target ID:', req.params.id);

      const targetAdmin = await Admin.findById(req.params.id).select(
        'segmentPermissions segmentExplicitKeys scriptSettings name adminCode role parentId hierarchyPath'
      );

      if (!targetAdmin) {
        return res.status(404).json({ message: 'Admin not found' });
      }

      console.log('[Segment Settings GET] Target Admin:', targetAdmin.name, 'Role:', targetAdmin.role);

      // Verify access - SuperAdmin can see all, others only their subtree
      if (req.admin.role !== 'SUPER_ADMIN') {
        const accessCheck = this._verifyAccess(req.admin, targetAdmin);
        if (!accessCheck.allowed) {
          console.log('[Segment Settings GET] Access denied -', accessCheck.reason);
          return res.status(403).json({ message: 'Access denied - admin not under your management' });
        }
      }

      // Convert Maps to plain objects
      const segmentPermissions = targetAdmin.segmentPermissions instanceof Map
        ? Object.fromEntries(targetAdmin.segmentPermissions)
        : (targetAdmin.segmentPermissions || {});

      const scriptSettings = targetAdmin.scriptSettings instanceof Map
        ? Object.fromEntries(targetAdmin.scriptSettings)
        : (targetAdmin.scriptSettings || {});

      let segmentExplicitKeys = targetAdmin.segmentExplicitKeys;
      if (segmentExplicitKeys instanceof Map) {
        segmentExplicitKeys = Object.fromEntries(segmentExplicitKeys);
      }

      console.log('[Segment Settings GET] Current segments:', Object.keys(segmentPermissions));

      // Return actual segment permissions without filtering
      // The viewer should see the actual permissions of the target admin, not filtered by viewer's parent
      let filteredSegmentPermissions = segmentPermissions;

      // Also return adminSegmentDefaults if available from system settings
      let adminSegmentDefaults = {};
      try {
        const SystemSettings = (await import('../models/SystemSettings.js')).default;
        const sysLean = await SystemSettings.findOne({ settingsType: 'global' })
          .select('adminSegmentDefaults')
          .lean();
        adminSegmentDefaults = sysLean?.adminSegmentDefaults || {};
      } catch (err) {
        // Ignore system settings error
      }

      res.json({
        segmentPermissions: filteredSegmentPermissions,
        scriptSettings,
        segmentExplicitKeys,
        adminSegmentDefaults
      });
    } catch (error) {
      console.log('[Segment Settings GET] Error:', error.message);
      res.status(500).json({ message: error.message });
    }
  }

  /**
   * Update admin's segment permissions and script settings
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updateSegmentSettings(req, res) {
    try {
      const { segmentPermissions, scriptSettings, segmentExplicitKeys } = req.body;
      const parentAdmin = req.admin;

      console.log('[AdminSegmentSettings] UPDATE CALLED');
      console.log('[AdminSegmentSettings] Parent:', parentAdmin.name, 'Role:', parentAdmin.role);
      console.log('[AdminSegmentSettings] Target ID:', req.params.id);
      console.log('[AdminSegmentSettings] Request body segments:', Object.keys(segmentPermissions || {}));

      // Fetch current admin's latest data from database to avoid stale data from JWT token
      const currentAdmin = await Admin.findById(parentAdmin._id).select('segmentPermissions name role parentId');
      if (!currentAdmin) {
        return res.status(404).json({ message: 'Current admin not found' });
      }

      console.log('[AdminSegmentSettings] Fetched latest data for current admin:', currentAdmin.name);
      console.log('[AdminSegmentSettings] Current admin segmentPermissions:', JSON.stringify(currentAdmin.segmentPermissions, null, 2));

      const childAdmin = await Admin.findById(req.params.id);
      if (!childAdmin) {
        return res.status(404).json({ message: 'Admin not found' });
      }

      // Verify hierarchy - parent must be able to manage child
      if (currentAdmin.role !== 'SUPER_ADMIN') {
        const accessCheck = this._verifyAccess(currentAdmin, childAdmin);
        if (!accessCheck.allowed) {
          return res.status(403).json({ message: 'This admin is not under your management' });
        }
      }

      // For non-superadmin, fetch their parent to check hierarchy permissions
      let grandParentAdmin = null;
      if (currentAdmin.role !== 'SUPER_ADMIN' && currentAdmin.parentId) {
        grandParentAdmin = await Admin.findById(currentAdmin.parentId).select('segmentPermissions');
        console.log('[AdminSegmentSettings] Parent:', currentAdmin.name, 'Role:', currentAdmin.role, 'ParentId:', currentAdmin.parentId);
        console.log('[AdminSegmentSettings] GrandParent:', grandParentAdmin?.name, 'Role:', grandParentAdmin?.role);
      }

      const updateFields = {};

      if (segmentPermissions && typeof segmentPermissions === 'object') {
        let plain =
          segmentPermissions instanceof Map ? Object.fromEntries(segmentPermissions) : segmentPermissions;

        // Validate all segment permission fields against parent's limits
        const parentSegPerms = currentAdmin.segmentPermissions instanceof Map
          ? Object.fromEntries(currentAdmin.segmentPermissions)
          : (currentAdmin.segmentPermissions || {});

        // Get grandparent segment permissions to check if parent has the segment enabled by their parent
        let grandParentSegPerms = {};
        if (grandParentAdmin) {
          grandParentSegPerms = grandParentAdmin.segmentPermissions instanceof Map
            ? Object.fromEntries(grandParentAdmin.segmentPermissions)
            : (grandParentAdmin.segmentPermissions || {});
        }

        const parentMaxLeverage = leverageValidationService.getParentMaxLeverageLimit(currentAdmin);

        for (const [segName, segData] of Object.entries(plain)) {
          if (!segData || typeof segData !== 'object') continue;

          const parentSeg = parentSegPerms[segName] || {};

          // Check if current admin has the segment enabled before enabling it for child
          if (segData.enabled === true) {
            const currentAdminHasSegment = parentSeg.enabled ?? false;
            console.log('[AdminSegmentSettings] Checking if current admin has', segName, 'enabled:', currentAdminHasSegment);
            console.log('[AdminSegmentSettings] Current admin:', currentAdmin.name, 'has segments:', Object.keys(parentSegPerms).filter(k => parentSegPerms[k]?.enabled));
            if (!currentAdminHasSegment && currentAdmin.role !== 'SUPER_ADMIN') {
              console.log('[AdminSegmentSettings] BLOCKING:', segName, '- current admin does not have this segment');
              return res.status(400).json({
                message: `Cannot enable ${segName} - you do not have this segment enabled. Enable it for yourself first.`
              });
            }
          }

          // Validate enabled field using hierarchy validation service
          const segmentValidation = await hierarchyValidationService.validateSegmentPermission(currentAdmin, segName, segData.enabled);
          if (!segmentValidation.allowed) {
            return res.status(400).json({ message: segmentValidation.message });
          }

          // Validate leverage fields - check both old and new field names including nested lotSettings
          const intraday = segData.lotSettings?.intradayLeverage ?? segData.exposureIntraday ?? segData.intradayLeverage;
          const parentIntraday = parentSeg.lotSettings?.intradayLeverage ?? parentSeg.exposureIntraday ?? parentSeg.intradayLeverage ?? parentMaxLeverage;
          if (intraday !== undefined && intraday !== null && parentIntraday !== undefined && parentIntraday !== null && intraday > parentIntraday && currentAdmin.role !== 'SUPER_ADMIN') {
            return res.status(400).json({
              message: `Unable to set the leverage more than parent hierarchy. ${segName} Intraday (${intraday}x) exceeds parent's limit (${parentIntraday}x)`
            });
          }

          const carryForward = segData.lotSettings?.carryForwardLeverage ?? segData.exposureCarryForward ?? segData.carryForwardLeverage;
          const parentCarryForward = parentSeg.lotSettings?.carryForwardLeverage ?? parentSeg.exposureCarryForward ?? parentSeg.carryForwardLeverage ?? parentMaxLeverage;
          if (carryForward !== undefined && carryForward !== null && parentCarryForward !== undefined && parentCarryForward !== null && carryForward > parentCarryForward && currentAdmin.role !== 'SUPER_ADMIN') {
            return res.status(400).json({
              message: `Unable to set the leverage more than parent hierarchy. ${segName} Carry Forward (${carryForward}x) exceeds parent's limit (${parentCarryForward}x)`
            });
          }

          // Validate maxLots
          if (segData.maxLots !== undefined && parentSeg.maxLots !== undefined && currentAdmin.role !== 'SUPER_ADMIN') {
            if (segData.maxLots > parentSeg.maxLots) {
              return res.status(400).json({
                message: `Unable to set maxLots more than parent hierarchy. ${segName} maxLots (${segData.maxLots}) exceeds parent's limit (${parentSeg.maxLots})`
              });
            }
          }

          // Validate maxExchangeLots
          if (segData.maxExchangeLots !== undefined && parentSeg.maxExchangeLots !== undefined && currentAdmin.role !== 'SUPER_ADMIN') {
            if (segData.maxExchangeLots > parentSeg.maxExchangeLots) {
              return res.status(400).json({
                message: `Unable to set maxExchangeLots more than parent hierarchy. ${segName} maxExchangeLots (${segData.maxExchangeLots}) exceeds parent's limit (${parentSeg.maxExchangeLots})`
              });
            }
          }

          // Validate minExchangeQty - child cannot set lower than parent (must be >= parent)
          if (segData.minExchangeQty !== undefined && parentSeg.minExchangeQty !== undefined && currentAdmin.role !== 'SUPER_ADMIN') {
            if (segData.minExchangeQty < parentSeg.minExchangeQty) {
              return res.status(400).json({
                message: `Unable to set minExchangeQty lower than parent hierarchy. ${segName} minExchangeQty (${segData.minExchangeQty}) cannot be lower than parent's minimum (${parentSeg.minExchangeQty})`
              });
            }
          }

          // Validate maxExchangeQty - child cannot set higher than parent (must be <= parent)
          if (segData.maxExchangeQty !== undefined && parentSeg.maxExchangeQty !== undefined && currentAdmin.role !== 'SUPER_ADMIN') {
            if (segData.maxExchangeQty > parentSeg.maxExchangeQty) {
              return res.status(400).json({
                message: `Unable to set maxExchangeQty more than parent hierarchy. ${segName} maxExchangeQty (${segData.maxExchangeQty}) exceeds parent's limit (${parentSeg.maxExchangeQty})`
              });
            }
          }

          // Validate quantitySettings fields
          if (segData.quantitySettings && parentSeg.quantitySettings && currentAdmin.role !== 'SUPER_ADMIN') {
            if (segData.quantitySettings.breakupQuantity !== undefined && parentSeg.quantitySettings.breakupQuantity !== undefined) {
              if (segData.quantitySettings.breakupQuantity > parentSeg.quantitySettings.breakupQuantity) {
                return res.status(400).json({
                  message: `Unable to set breakupQuantity more than parent hierarchy. ${segName} breakupQuantity (${segData.quantitySettings.breakupQuantity}) exceeds parent's limit (${parentSeg.quantitySettings.breakupQuantity})`
                });
              }
            }
            if (segData.quantitySettings.maxBid !== undefined && parentSeg.quantitySettings.maxBid !== undefined) {
              if (segData.quantitySettings.maxBid > parentSeg.quantitySettings.maxBid) {
                return res.status(400).json({
                  message: `Unable to set maxBid more than parent hierarchy. ${segName} maxBid (${segData.quantitySettings.maxBid}) exceeds parent's limit (${parentSeg.quantitySettings.maxBid})`
                });
              }
            }
          }

          // Validate orderLots
          if (segData.orderLots !== undefined && parentSeg.orderLots !== undefined && currentAdmin.role !== 'SUPER_ADMIN') {
            if (segData.orderLots > parentSeg.orderLots) {
              return res.status(400).json({
                message: `Unable to set orderLots more than parent hierarchy. ${segName} orderLots (${segData.orderLots}) exceeds parent's limit (${parentSeg.orderLots})`
              });
            }
          }

        }

        if (currentAdmin.role === 'BROKER' || currentAdmin.role === 'SUB_BROKER') {
          const existingSeg =
            childAdmin.segmentPermissions instanceof Map
              ? Object.fromEntries(childAdmin.segmentPermissions)
              : (childAdmin.segmentPermissions || {});
          plain = this._preserveAllowLimitPendingOrdersFromExisting(plain, existingSeg);
        }

        const { alignSegmentDefaultsMap } = await import('../utils/commissionTypeUnit.js');
        const aligned = alignSegmentDefaultsMap(plain);

        // Preserve new leverage and quantity limit fields that might be stripped by alignment
        for (const [segName, segData] of Object.entries(plain)) {
          if (!segData || typeof segData !== 'object') continue;
          // Preserve enabled field
          if (segData.enabled !== undefined) {
            aligned[segName] = aligned[segName] || {};
            aligned[segName].enabled = segData.enabled;
          }
          if (segData.intradayLeverage !== undefined) {
            aligned[segName] = aligned[segName] || {};
            aligned[segName].intradayLeverage = segData.intradayLeverage;
          }
          if (segData.carryForwardLeverage !== undefined) {
            aligned[segName] = aligned[segName] || {};
            aligned[segName].carryForwardLeverage = segData.carryForwardLeverage;
          }
          if (segData.maxIntradayQty !== undefined) {
            aligned[segName] = aligned[segName] || {};
            aligned[segName].maxIntradayQty = segData.maxIntradayQty;
          }
          if (segData.maxCarryQty !== undefined) {
            aligned[segName] = aligned[segName] || {};
            aligned[segName].maxCarryQty = segData.maxCarryQty;
          }
          // Preserve lotSettings
          if (segData.lotSettings !== undefined) {
            aligned[segName] = aligned[segName] || {};
            aligned[segName].lotSettings = segData.lotSettings;
          }
          // Preserve quantityModeSettings
          if (segData.quantityModeSettings !== undefined) {
            aligned[segName] = aligned[segName] || {};
            aligned[segName].quantityModeSettings = segData.quantityModeSettings;
          }
        }

        updateFields.segmentPermissions = aligned;
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

      // Track which segments are being disabled
      const existingSegPerms = childAdmin.segmentPermissions instanceof Map
        ? Object.fromEntries(childAdmin.segmentPermissions)
        : (childAdmin.segmentPermissions || {});

      console.log('[AdminSegmentSettings] Existing segment permissions:', JSON.stringify(existingSegPerms));
      console.log('[AdminSegmentSettings] Update fields segment permissions:', JSON.stringify(updateFields.segmentPermissions));

      const disabledSegments = [];
      const enabledSegments = [];
      if (updateFields.segmentPermissions) {
        for (const [segName, segData] of Object.entries(updateFields.segmentPermissions)) {
          const existingSeg = existingSegPerms[segName] || {};
          const wasEnabled = existingSeg.enabled ?? false;
          const isNowEnabled = segData.enabled ?? false;

          console.log('[AdminSegmentSettings] Segment:', segName, 'Was enabled:', wasEnabled, 'Now enabled:', isNowEnabled);

          // Show message for any segment that is currently disabled
          if (!isNowEnabled) {
            disabledSegments.push(segName);
            console.log('[AdminSegmentSettings] Disabled segment:', segName);
          } else {
            enabledSegments.push(segName);
            console.log('[AdminSegmentSettings] Enabled segment:', segName);
          }
        }
      }

      console.log('[AdminSegmentSettings] Total disabled segments:', disabledSegments);
      console.log('[AdminSegmentSettings] Total enabled segments:', enabledSegments);

      await Admin.updateOne({ _id: childAdmin._id }, { $set: updateFields });

      const updatedAdmin = await Admin.findById(childAdmin._id).select('-password');

      // Build specific message for enabled segments only
      let message = 'Admin segment/script settings updated successfully';
      if (enabledSegments.length > 0) {
        message = `${childAdmin.name || childAdmin.username} is now able to place order on ${enabledSegments.join(', ')}`;
      }

      res.json({
        message,
        admin: {
          _id: updatedAdmin._id,
          name: updatedAdmin.name,
          adminCode: updatedAdmin.adminCode,
          segmentPermissions: updatedAdmin.segmentPermissions,
          segmentExplicitKeys: updatedAdmin.segmentExplicitKeys,
          scriptSettings: updatedAdmin.scriptSettings,
        },
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }

  /**
   * Verify if requesting admin can access target admin's settings
   * @private
   * @param {Object} requestingAdmin - The admin making the request
   * @param {Object} targetAdmin - The admin being accessed
   * @returns {Object} { allowed: boolean, reason: string }
   */
  _verifyAccess(requestingAdmin, targetAdmin) {
    // Check if requesting admin can manage target admin's role
    const canManageTargetRole = requestingAdmin.canManage(targetAdmin.role);
    
    // Check if target admin is in requesting admin's hierarchy subtree
    const isInSubtree = targetAdmin.hierarchyPath?.some(id => id.toString() === requestingAdmin._id.toString());
    const isDirectChild = targetAdmin.parentId?.toString() === requestingAdmin._id.toString();
    
    if (!canManageTargetRole) {
      return {
        allowed: false,
        reason: `Requester role ${requestingAdmin.role} cannot manage target role ${targetAdmin.role}`
      };
    }
    
    if (!isDirectChild && !isInSubtree) {
      return {
        allowed: false,
        reason: `Target admin not in requester's subtree - ParentId: ${targetAdmin.parentId}, HierarchyPath: ${targetAdmin.hierarchyPath}`
      };
    }
    
    return { allowed: true };
  }

  /**
   * Preserve allowLimitPendingOrders from existing segment permissions
   * Used for BROKER/SUB_BROKER to prevent UI-hidden fields from overwriting Admin-set values
   * @private
   * @param {Object} incomingPlain - Incoming segment permissions
   * @param {Object} existingPlain - Existing segment permissions
   * @returns {Object} Updated segment permissions with preserved values
   */
  _preserveAllowLimitPendingOrdersFromExisting(incomingPlain, existingPlain) {
    if (!incomingPlain || typeof incomingPlain !== 'object') return incomingPlain;
    const ex =
      !existingPlain
        ? {}
        : existingPlain instanceof Map
          ? Object.fromEntries(existingPlain)
          : typeof existingPlain === 'object' && typeof existingPlain.toObject === 'function'
            ? existingPlain.toObject()
            : { ...existingPlain };
    const out = { ...incomingPlain };
    for (const seg of Object.keys(out)) {
      if (!out[seg] || typeof out[seg] !== 'object') continue;
      out[seg] = { ...out[seg] };
      if (ex[seg] && Object.prototype.hasOwnProperty.call(ex[seg], 'allowLimitPendingOrders')) {
        out[seg].allowLimitPendingOrders = ex[seg].allowLimitPendingOrders;
      } else {
        delete out[seg].allowLimitPendingOrders;
      }
    }
    return out;
  }
}

export default new AdminSegmentSettingsController();
