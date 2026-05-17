import User from '../models/User.js';
import Admin from '../models/Admin.js';

/**
 * WalletPermissionService - Handles hierarchical wallet access permissions
 * 
 * Permission Rules:
 * - Superadmin: Full control over ALL users (deposit + withdraw + view)
 * - Admin: Full control over direct children (deposit + withdraw + view)
 * - Admin: View only for indirect children (grandchildren, etc.)
 * - Non-hierarchy broker: Can deposit only (no withdraw, no view) to users not in their hierarchy
 * 
 * @class WalletPermissionService
 */
class WalletPermissionService {
  
  /**
   * Check if a user has permission to perform an action on another user's wallet
   * 
   * @param {string} requesterId - The ID of the user requesting access
   * @param {string} targetUserId - The ID of the target user whose wallet is being accessed
   * @param {string} action - The action being requested ('view', 'deposit', 'withdraw')
   * @returns {Promise<{allowed: boolean, reason: string, permissionLevel: string}>}
   */
  static async checkPermission(requesterId, targetUserId, action) {
    try {
      // Cannot access own wallet through this service (use regular wallet operations)
      if (requesterId === targetUserId) {
        return {
          allowed: false,
          reason: 'Cannot access own wallet through permission service',
          permissionLevel: 'SELF'
        };
      }

      // Get both users
      const requester = await User.findById(requesterId);
      const targetUser = await User.findById(targetUserId);

      if (!requester || !targetUser) {
        return {
          allowed: false,
          reason: 'User not found',
          permissionLevel: 'NONE'
        };
      }

      // Get requester's admin info to determine role
      const requesterAdmin = await Admin.findOne({ adminCode: requester.adminCode });
      if (!requesterAdmin) {
        return {
          allowed: false,
          reason: 'Requester admin not found',
          permissionLevel: 'NONE'
        };
      }

      // Check if requester is Superadmin
      if (requesterAdmin.role === 'SUPERADMIN') {
        return {
          allowed: true,
          reason: 'Superadmin has full control over all wallets',
          permissionLevel: 'SUPERADMIN'
        };
      }

      // Check if requester is an Admin (not Superadmin)
      if (requesterAdmin.role === 'ADMIN') {
        // Check if requester is direct parent
        // Handle both cases where admin might be populated object or just ID
        const targetAdminId = targetUser.admin?._id ? targetUser.admin._id.toString() : targetUser.admin?.toString();
        const isDirectParent = targetAdminId === requesterId;
        if (isDirectParent) {
          // Direct parent has full control
          return {
            allowed: true,
            reason: 'Admin has full control over direct children',
            permissionLevel: 'DIRECT_PARENT'
          };
        }
        
        // Check if target is in requester's hierarchy (indirect child)
        const isInHierarchy = await this._isInHierarchy(requesterId, targetUserId);
        if (isInHierarchy) {
          // Indirect parent has view-only access
          if (action === 'view') {
            return {
              allowed: true,
              reason: 'Admin has view-only access for indirect children',
              permissionLevel: 'INDIRECT_PARENT'
            };
          }
          return {
            allowed: false,
            reason: 'Admin has view-only access for indirect children (cannot deposit/withdraw)',
            permissionLevel: 'INDIRECT_PARENT'
          };
        }
        
        // Non-hierarchy broker: can only deposit, not withdraw or view
        if (action === 'deposit') {
          return {
            allowed: true,
            reason: 'Broker can deposit to any user (cross-broker deposit allowed)',
            permissionLevel: 'NON_HIERARCHY_BROKER'
          };
        }
        
        // Withdraw and view not allowed for non-hierarchy
        return {
          allowed: false,
          reason: 'Broker can only deposit to users outside their hierarchy (withdrawal not allowed)',
          permissionLevel: 'NON_HIERARCHY_BROKER'
        };
      }

      // Check if requester is direct parent
      const isDirectParent = targetUser.admin && targetUser.admin.toString() === requesterId;
      if (isDirectParent) {
        // Direct parent has full control
        return {
          allowed: true,
          reason: 'Direct parent has full control over child wallet',
          permissionLevel: 'DIRECT_PARENT'
        };
      }

      // Check if requester is indirect parent (grandparent, etc.)
      const isIndirectParent = await this._isIndirectParent(requesterId, targetUserId);
      if (isIndirectParent) {
        // Indirect parent has view-only access
        if (action === 'view') {
          return {
            allowed: true,
            reason: 'Indirect parent has view-only access',
            permissionLevel: 'INDIRECT_PARENT'
          };
        }
        return {
          allowed: false,
          reason: 'Indirect parent has view-only access (cannot deposit/withdraw)',
          permissionLevel: 'INDIRECT_PARENT'
        };
      }

      // No relationship found
      return {
        allowed: false,
        reason: 'No permission - not in hierarchy',
        permissionLevel: 'NONE'
      };

    } catch (error) {
      console.error('[WalletPermissionService] Error checking permission:', error);
      return {
        allowed: false,
        reason: 'Error checking permission',
        permissionLevel: 'ERROR'
      };
    }
  }

  /**
   * Check if target user is in requester's hierarchy
   * 
   * @param {string} requesterId - The ID of the requester
   * @param {string} targetUserId - The ID of the target user
   * @returns {Promise<boolean>}
   * @private
   */
  static async _isInHierarchy(requesterId, targetUserId) {
    try {
      // Get requester to determine their admin
      const requester = await User.findById(requesterId);
      if (!requester || !requester.admin) return false;

      // Get requester's admin to check if they're an Admin role
      const requesterAdmin = await Admin.findById(requester.admin);
      if (!requesterAdmin || requesterAdmin.role !== 'ADMIN') return false;

      // Check if target user is a descendant of the requester's admin tree
      // Only descendants should be in the hierarchy, not users with same adminCode
      return await this._isDescendant(targetUserId, requesterAdmin.adminCode);
    } catch (error) {
      console.error('[WalletPermissionService] Error checking hierarchy:', error);
      return false;
    }
  }

  /**
   * Check if target user is a descendant of the given adminCode
   * 
   * @param {string} targetUserId - The ID of the target user
   * @param {string} adminCode - The adminCode to check against
   * @returns {Promise<boolean>}
   * @private
   */
  static async _isDescendant(targetUserId, adminCode) {
    try {
      const targetUser = await User.findById(targetUserId);
      if (!targetUser) return false;

      // If target has the adminCode, they're a descendant
      if (targetUser.adminCode === adminCode) return true;

      // If target has no admin, they're not a descendant
      if (!targetUser.admin) return false;

      // Get the admin and check if they have the adminCode
      const admin = await Admin.findById(targetUser.admin);
      if (!admin) return false;

      // If the admin has the adminCode, target is a descendant
      if (admin.adminCode === adminCode) return true;

      // Recursively check if the admin is a descendant
      return await this._isDescendant(admin._id.toString(), adminCode);
    } catch (error) {
      console.error('[WalletPermissionService] Error checking descendant:', error);
      return false;
    }
  }

  /**
   * Check if requester is an indirect parent (grandparent, great-grandparent, etc.) of target
   * 
   * @param {string} requesterId - The ID of the requester
   * @param {string} targetUserId - The ID of the target user
   * @returns {Promise<boolean>}
   * @private
   */
  static async _isIndirectParent(requesterId, targetUserId) {
    try {
      const targetUser = await User.findById(targetUserId);
      if (!targetUser || !targetUser.admin) return false;

      // Get the direct parent
      let currentAdminId = targetUser.admin.toString();
      let depth = 0;
      const maxDepth = 10; // Prevent infinite loops

      // Traverse up the hierarchy
      while (depth < maxDepth) {
        if (currentAdminId === requesterId) {
          // Found requester in hierarchy
          return depth > 0; // Return true only if not direct parent
        }

        // Get the next parent
        const admin = await Admin.findById(currentAdminId);
        if (!admin || !admin.admin) break;

        currentAdminId = admin.admin.toString();
        depth++;
      }

      return false;
    } catch (error) {
      console.error('[WalletPermissionService] Error checking indirect parent:', error);
      return false;
    }
  }

  /**
   * Get wallet permissions for a target user from requester's perspective
   * 
   * @param {string} requesterId - The ID of the user requesting access
   * @param {string} targetUserId - The ID of the target user
   * @returns {Promise<{canView: boolean, canDeposit: boolean, canWithdraw: boolean, permissionLevel: string}>}
   */
  static async getWalletPermissions(requesterId, targetUserId) {
    const viewPermission = await this.checkPermission(requesterId, targetUserId, 'view');
    const depositPermission = await this.checkPermission(requesterId, targetUserId, 'deposit');
    const withdrawPermission = await this.checkPermission(requesterId, targetUserId, 'withdraw');

    return {
      canView: viewPermission.allowed,
      canDeposit: depositPermission.allowed,
      canWithdraw: withdrawPermission.allowed,
      permissionLevel: viewPermission.permissionLevel,
      reason: viewPermission.reason
    };
  }
}

export default WalletPermissionService;
