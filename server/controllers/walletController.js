/**
 * Wallet Controller
 * 
 * Clean architecture implementation for wallet operations following SOLID principles.
 * Handles business logic orchestration for wallet deposit, withdrawal, and permission checks.
 * 
 * Controller Responsibilities:
 * 1. Request validation and response formatting
 * 2. Business logic orchestration
 * 3. Error handling and status codes
 * 4. Service layer coordination
 */

import User from '../models/User.js';
import Admin from '../models/Admin.js';
import WalletLedger from '../models/WalletLedger.js';
import WalletPermissionService from '../services/walletPermissionService.js';

class WalletController {
  
  /**
   * Deposit funds to user wallet with hierarchical permission validation
   * 
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  static async depositToUserWallet(req, res) {
    try {
      const { amount, description } = req.body;
      const targetUserId = req.params.id;
      const requesterId = req.admin._id.toString();

      // Validate amount
      if (!amount || amount <= 0) {
        return res.status(400).json({ message: 'Invalid amount' });
      }

      // Check wallet permission
      const permission = await WalletPermissionService.checkPermission(requesterId, targetUserId, 'deposit');
      
      if (!permission.allowed) {
        return res.status(403).json({ 
          message: permission.reason,
          permissionLevel: permission.permissionLevel
        });
      }

      // Find target user
      const targetUser = await User.findById(targetUserId);
      if (!targetUser) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Deposit funds to main wallet
      const currentBalance = targetUser.wallet?.cashBalance || 0;
      targetUser.wallet = targetUser.wallet || {};
      targetUser.wallet.cashBalance = currentBalance + parseFloat(amount);
      await targetUser.save();

      // Create ledger entry
      await WalletLedger.create({
        userId: targetUserId,
        type: 'CREDIT',
        amount: parseFloat(amount),
        balance: targetUser.wallet.cashBalance,
        description: description || `Funds deposited by admin (permission: ${permission.permissionLevel})`,
        performedBy: requesterId,
        permissionLevel: permission.permissionLevel
      });

      res.json({ 
        message: 'Funds deposited successfully',
        newBalance: targetUser.wallet.cashBalance,
        permissionLevel: permission.permissionLevel
      });

    } catch (error) {
      console.error('Deposit error:', error);
      res.status(500).json({ message: error.message || 'Error depositing funds' });
    }
  }

  /**
   * Withdraw funds from user wallet with hierarchical permission validation
   * 
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  static async withdrawFromUserWallet(req, res) {
    try {
      const { amount, description } = req.body;
      const targetUserId = req.params.id;
      const requesterId = req.admin._id.toString();

      // Validate amount
      if (!amount || amount <= 0) {
        return res.status(400).json({ message: 'Invalid amount' });
      }

      // Check wallet permission
      const permission = await WalletPermissionService.checkPermission(requesterId, targetUserId, 'withdraw');
      
      if (!permission.allowed) {
        return res.status(403).json({ 
          message: permission.reason,
          permissionLevel: permission.permissionLevel
        });
      }

      // Find target user
      const targetUser = await User.findById(targetUserId);
      if (!targetUser) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Check sufficient balance
      const currentBalance = targetUser.wallet?.cashBalance || 0;
      if (currentBalance < parseFloat(amount)) {
        return res.status(400).json({ message: 'Insufficient balance' });
      }

      // Withdraw funds from main wallet
      targetUser.wallet = targetUser.wallet || {};
      targetUser.wallet.cashBalance = currentBalance - parseFloat(amount);
      await targetUser.save();

      // Create ledger entry
      await WalletLedger.create({
        userId: targetUserId,
        type: 'DEBIT',
        amount: parseFloat(amount),
        balance: targetUser.wallet.cashBalance,
        description: description || `Funds withdrawn by admin (permission: ${permission.permissionLevel})`,
        performedBy: requesterId,
        permissionLevel: permission.permissionLevel
      });

      res.json({ 
        message: 'Funds withdrawn successfully',
        newBalance: targetUser.wallet.cashBalance,
        permissionLevel: permission.permissionLevel
      });

    } catch (error) {
      console.error('Withdrawal error:', error);
      res.status(500).json({ message: error.message || 'Error withdrawing funds' });
    }
  }

  /**
   * Get wallet permissions for a target user from requester's perspective
   * 
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  static async getWalletPermissions(req, res) {
    try {
      const targetUserId = req.params.id;
      const requesterId = req.admin._id.toString();

      const permissions = await WalletPermissionService.getWalletPermissions(requesterId, targetUserId);

      res.json(permissions);

    } catch (error) {
      console.error('Get permissions error:', error);
      res.status(500).json({ message: error.message || 'Error fetching permissions' });
    }
  }
}

export default WalletController;
