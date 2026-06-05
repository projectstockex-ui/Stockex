import User from '../models/User.js';
import WalletLedger from '../models/WalletLedger.js';
import {
  atomicGamesWalletUpdate,
  atomicGamesWalletDebitForTransfer,
} from '../utils/gamesWallet.js';
import {
  atomicMarginSegmentDebitForTransfer,
  getStampedSegmentBalance,
} from '../utils/segmentWalletDebit.js';
import { recalculateUsedMargin } from '../utils/recalculateUsedMargin.js';
import {
  getNseBseBalance,
  getNseBseUsedMargin,
  migrateNseBseWalletIfNeeded,
  prepareNseBseWalletForTransfer,
  readNseBseWalletFromDb,
} from '../utils/nseBseWallet.js';

/** Source wallets that debit full stamped balance and clamp usedMargin on transfer out. */
const MARGIN_SEGMENT_SOURCES = ['nseBseWallet', 'mcxWallet', 'cryptoWallet', 'forexWallet'];

const roundTransferAmount = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Wallet Transfer Service
 * Handles interconnected wallet-to-wallet transfers for users
 * Supported wallets: wallet (main cash), nseBseWallet / tradingAccount alias (NSE & BSE card),
 * cryptoWallet, forexWallet, mcxWallet, gamesWallet
 */
class WalletTransferService {
  
  /**
   * Get wallet balance for a specific wallet type
   * @param {Object} user - User document
   * @param {String} walletType - Wallet type (wallet, cryptoWallet, forexWallet, mcxWallet, gamesWallet)
   * @returns {Number} - Available balance (free balance considering used margin)
   */
  static getWalletBalance(user, walletType) {
    switch(walletType) {
      case 'wallet':
        return user.wallet?.cashBalance || 0;
      case 'tradingAccount':
      case 'nseBseWallet':
        return getNseBseAvailable(user);
      case 'cryptoWallet':
        return (user.cryptoWallet?.balance || 0) - (user.cryptoWallet?.usedMargin || 0);
      case 'forexWallet':
        return (user.forexWallet?.balance || 0) - (user.forexWallet?.usedMargin || 0);
      case 'mcxWallet':
        return (user.mcxWallet?.balance || 0) - (user.mcxWallet?.usedMargin || 0);
      case 'gamesWallet':
        return (user.gamesWallet?.balance || 0) - (user.gamesWallet?.usedMargin || 0);
      default:
        return 0;
    }
  }

  /**
   * Balance user can move in one inter-wallet transfer:
   * games + segment wallets → full stamped balance; main + trading account → existing free-balance rules.
   * For crypto/mcx/forex wallets: max transfer = balance - usedMargin (cannot transfer locked margin)
   */
  static getTransferSourceBalance(user, walletType) {
    return this.getTransferableBalanceDetails(user, walletType).transferable;
  }

  /**
   * Balance breakdown for inter-wallet transfers (free = balance − usedMargin).
   */
  static getTransferableBalanceDetails(user, walletType) {
    const displayName = this.getWalletDisplayName(walletType);
    switch (walletType) {
      case 'wallet': {
        const totalBalance = Number(user?.wallet?.cashBalance) || 0;
        return {
          walletType,
          displayName,
          totalBalance,
          usedMargin: 0,
          transferable: roundTransferAmount(totalBalance),
        };
      }
      case 'tradingAccount':
      case 'nseBseWallet': {
        const totalBalance = getNseBseBalance(user);
        const usedMargin = getNseBseUsedMargin(user);
        return {
          walletType: 'nseBseWallet',
          displayName: 'NSE & BSE Wallet',
          totalBalance,
          usedMargin,
          transferable: roundTransferAmount(Math.max(0, totalBalance - usedMargin)),
        };
      }
      case 'cryptoWallet':
      case 'forexWallet':
      case 'mcxWallet': {
        const totalBalance = Number(user?.[walletType]?.balance) || 0;
        const usedMargin = Number(user?.[walletType]?.usedMargin) || 0;
        return {
          walletType,
          displayName,
          totalBalance,
          usedMargin,
          transferable: roundTransferAmount(Math.max(0, totalBalance - usedMargin)),
        };
      }
      case 'gamesWallet': {
        const totalBalance = Number(user?.gamesWallet?.balance) || 0;
        const usedMargin = Number(user?.gamesWallet?.usedMargin) || 0;
        return {
          walletType,
          displayName,
          totalBalance,
          usedMargin,
          transferable: roundTransferAmount(Math.max(0, totalBalance - usedMargin)),
        };
      }
      default:
        return { walletType, displayName, totalBalance: 0, usedMargin: 0, transferable: 0 };
    }
  }

  static getAllTransferableBalanceDetails(user) {
    const walletTypes = [
      'wallet',
      'nseBseWallet',
      'cryptoWallet',
      'forexWallet',
      'mcxWallet',
      'gamesWallet',
    ];
    return walletTypes.reduce((acc, key) => {
      acc[key] = this.getTransferableBalanceDetails(user, key);
      return acc;
    }, {});
  }

  /** User-facing error when transfer exceeds free (non-locked) balance. */
  static buildTransferInsufficientError(user, sourceWallet, amount) {
    const { displayName, totalBalance, usedMargin, transferable } =
      this.getTransferableBalanceDetails(user, sourceWallet);
    const fmt = (n) =>
      `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const amt = roundTransferAmount(amount);
    const max = roundTransferAmount(transferable);
    if (usedMargin > 0 && amt > max) {
      return (
        `You have already used margin (${fmt(usedMargin)}) in open trades. You can transfer up to ${fmt(max)} only (not more). ` +
        `(${displayName} balance: ${fmt(totalBalance)} − Used margin: ${fmt(usedMargin)} = Transferable: ${fmt(transferable)})`
      );
    }

    return `Insufficient balance in ${displayName}. Maximum you can transfer is ${fmt(transferable)}.`;
  }

  /**
   * Get the actual balance field name for a wallet type
   * @param {String} walletType - Wallet type
   * @returns {String} - Balance field name
   */
  static getBalanceFieldName(walletType) {
    switch(walletType) {
      case 'wallet':
        return 'wallet.cashBalance';
      case 'tradingAccount':
      case 'nseBseWallet':
        return 'nseBseWallet.balance';
      case 'cryptoWallet':
        return 'cryptoWallet.balance';
      case 'forexWallet':
        return 'forexWallet.balance';
      case 'mcxWallet':
        return 'mcxWallet.balance';
      case 'gamesWallet':
        return 'gamesWallet.balance';
      default:
        return `${walletType}.balance`;
    }
  }

  /**
   * Validate wallet transfer request
   * @param {Object} user - User document
   * @param {String} sourceWallet - Source wallet type
   * @param {String} targetWallet - Target wallet type
   * @param {Number} amount - Transfer amount
   * @returns {Object} - { valid: boolean, error: string }
   */
  static validateTransfer(user, sourceWallet, targetWallet, amount) {
    // Check if source and target wallets are different
    if (sourceWallet === targetWallet) {
      return { valid: false, error: 'Source and target wallets cannot be the same' };
    }

    // Check if wallet types are valid
    const validWallets = ['wallet', 'nseBseWallet', 'tradingAccount', 'cryptoWallet', 'forexWallet', 'mcxWallet', 'gamesWallet'];
    if (!validWallets.includes(sourceWallet)) {
      return { valid: false, error: 'Invalid source wallet type' };
    }
    if (!validWallets.includes(targetWallet)) {
      return { valid: false, error: 'Invalid target wallet type' };
    }

    // Check if amount is valid
    if (!amount || amount <= 0) {
      return { valid: false, error: 'Transfer amount must be greater than 0' };
    }

    const details = this.getTransferableBalanceDetails(user, sourceWallet);
    const amt = roundTransferAmount(amount);
    if (roundTransferAmount(details.transferable) < amt) {
      return {
        valid: false,
        error: this.buildTransferInsufficientError(user, sourceWallet, amt),
        ...details,
      };
    }

    return { valid: true, ...details };
  }

  /**
   * Get display name for wallet type
   * @param {String} walletType - Wallet type
   * @returns {String} - Display name
   */
  static getWalletDisplayName(walletType) {
    switch(walletType) {
      case 'wallet': return 'Main Wallet (cash)';
      case 'tradingAccount':
      case 'nseBseWallet': return 'NSE & BSE Wallet';
      case 'cryptoWallet': return 'Crypto Wallet';
      case 'forexWallet': return 'Forex Wallet';
      case 'mcxWallet': return 'MCX Wallet';
      case 'gamesWallet': return 'Games Wallet';
      default: return walletType;
    }
  }

  /** Reverse of getWalletDisplayName — used to repair ledger rows missing meta.sourceWallet/targetWallet (legacy stripped meta). */
  static displayNameToWalletKey(displayName) {
    const k = String(displayName || '').trim();
    const map = {
      'Trading Wallet': 'wallet',
      'Main Wallet (cash)': 'wallet',
      'Trading Account': 'nseBseWallet',
      'NSE & BSE Wallet': 'nseBseWallet',
      'Crypto Wallet': 'cryptoWallet',
      'Forex Wallet': 'forexWallet',
      'MCX Wallet': 'mcxWallet',
      'Games Wallet': 'gamesWallet',
    };
    return map[k] || null;
  }

  static _balanceAfterSourceDebit(finalUser, sourceWallet) {
    if (sourceWallet === 'wallet') return finalUser?.wallet?.cashBalance ?? 0;
    if (sourceWallet === 'tradingAccount' || sourceWallet === 'nseBseWallet') return getNseBseBalance(finalUser);
    return finalUser?.[sourceWallet]?.balance ?? 0;
  }

  static _balanceAfterTargetCredit(finalUser, targetWallet) {
    if (targetWallet === 'wallet') return finalUser?.wallet?.cashBalance ?? 0;
    if (targetWallet === 'tradingAccount' || targetWallet === 'nseBseWallet') return getNseBseBalance(finalUser);
    return finalUser?.[targetWallet]?.balance ?? 0;
  }

  static _shouldIncDepositTotal(targetWallet) {
    return targetWallet !== 'wallet' && targetWallet !== 'tradingAccount' && targetWallet !== 'nseBseWallet';
  }

  /**
   * Execute wallet transfer (atomic operation)
   * @param {String} userId - User ID
   * @param {String} sourceWallet - Source wallet type
   * @param {String} targetWallet - Target wallet type
   * @param {Number} amount - Transfer amount
   * @param {String} remarks - Transfer remarks
   * @param {String} performedBy - Admin ID who performed the transfer
   * @returns {Object} - Transfer result
   */
  /** Load user and sync usedMargin from open positions before transfer validation. */
  static async loadUserWithFreshMargins(userId) {
    const user = await User.findById(userId);
    if (!user) return null;

    const recalculated = await recalculateUsedMargin(userId);
    const liveNse = await readNseBseWalletFromDb(userId);
    if (!user.wallet) user.wallet = {};
    if (!user.nseBseWallet) user.nseBseWallet = {};
    user.nseBseWallet.balance = liveNse.balance;
    user.nseBseWallet.usedMargin = recalculated.nseBseWallet ?? recalculated.wallet ?? 0;
    user.wallet.usedMargin = 0;
    if (!user.cryptoWallet) user.cryptoWallet = {};
    user.cryptoWallet.usedMargin = recalculated.cryptoWallet;
    if (!user.forexWallet) user.forexWallet = {};
    user.forexWallet.usedMargin = recalculated.forexWallet;
    if (!user.mcxWallet) user.mcxWallet = {};
    user.mcxWallet.usedMargin = recalculated.mcxWallet;
    if (!user.gamesWallet) user.gamesWallet = {};
    user.gamesWallet.usedMargin = recalculated.gamesWallet;

    return user;
  }

  static async executeTransfer(userId, sourceWallet, targetWallet, amount, remarks = '', performedBy = null) {
    const transferAmount = roundTransferAmount(amount);
    if (!Number.isFinite(transferAmount) || transferAmount <= 0) {
      throw new Error('Transfer amount must be greater than 0');
    }

    const user = await this.loadUserWithFreshMargins(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const { assertTransferWalletsAllowed } = await import('../utils/walletBlock.js');
    assertTransferWalletsAllowed(user, sourceWallet, targetWallet);

    // Validate transfer
    const validation = this.validateTransfer(user, sourceWallet, targetWallet, transferAmount);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const transferId = `WT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Execute transfer based on wallet types
    if (sourceWallet === 'gamesWallet' || targetWallet === 'gamesWallet') {
      return await this.executeGamesWalletTransfer(user, sourceWallet, targetWallet, transferAmount, transferId, remarks, performedBy);
    } else {
      return await this.executeStandardWalletTransfer(user, sourceWallet, targetWallet, transferAmount, transferId, remarks, performedBy);
    }
  }

  /**
   * Execute standard wallet transfer (wallet, cryptoWallet, forexWallet, mcxWallet)
   */
  static async _syncNseBseOnUser(user) {
    if (!user?._id) return user;
    await migrateNseBseWalletIfNeeded(user._id);
    const liveNse = await readNseBseWalletFromDb(user._id);
    if (!user.nseBseWallet) user.nseBseWallet = {};
    user.nseBseWallet.balance = liveNse.balance;
    user.nseBseWallet.usedMargin = liveNse.usedMargin;
    user.wallet = user.wallet || {};
    user.wallet.usedMargin = 0;
    return user;
  }

  static async executeStandardWalletTransfer(user, sourceWallet, targetWallet, amount, transferId, remarks, performedBy) {
    try {
      const nseInvolved =
        sourceWallet === 'nseBseWallet' ||
        sourceWallet === 'tradingAccount' ||
        targetWallet === 'nseBseWallet' ||
        targetWallet === 'tradingAccount';
      if (nseInvolved) {
        await this._syncNseBseOnUser(user);
      }

      const sourceBalanceField = this.getBalanceFieldName(sourceWallet);
      const targetBalanceField = this.getBalanceFieldName(targetWallet);

      const currentSourceBalance = this.getTransferSourceBalance(user, sourceWallet);
      if (currentSourceBalance < amount) {
        throw new Error(this.buildTransferInsufficientError(user, sourceWallet, amount));
      }

      let finalUser;

      if (MARGIN_SEGMENT_SOURCES.includes(sourceWallet)) {
        const debitUser = await atomicMarginSegmentDebitForTransfer(User, user._id, sourceWallet, amount);
        if (!debitUser) {
          if (sourceWallet === 'nseBseWallet' || sourceWallet === 'tradingAccount') {
            await this._syncNseBseOnUser(user);
          }
          const details = this.getTransferableBalanceDetails(user, sourceWallet);
          throw new Error(
            details.transferable >= roundTransferAmount(amount)
              ? 'Transfer could not be completed. Please refresh the page and try again.'
              : this.buildTransferInsufficientError(user, sourceWallet, amount)
          );
        }

        const targetInc = {};
        targetInc[targetBalanceField] = amount;
        if (this._shouldIncDepositTotal(targetWallet)) {
          targetInc[`${targetWallet}.depositTotal`] = amount;
        }

        finalUser = await User.findByIdAndUpdate(user._id, { $inc: targetInc }, { new: true });
        if (!finalUser) {
          throw new Error('Failed to update target wallet');
        }
      } else {
        const updates = {};
        updates[sourceBalanceField] = -amount;
        updates[targetBalanceField] = amount;

        if (this._shouldIncDepositTotal(targetWallet)) {
          updates[`${targetWallet}.depositTotal`] = amount;
        }

        finalUser = await User.findByIdAndUpdate(user._id, { $inc: updates }, { new: true });

        if (!finalUser) {
          throw new Error('Failed to update wallet balances');
        }

        const afterSource = this._balanceAfterSourceDebit(finalUser, sourceWallet);
        const usedMargin = finalUser.wallet?.usedMargin || 0;

        const rollbackMirror = async () => {
          const rollbackUpdates = {};
          rollbackUpdates[sourceBalanceField] = amount;
          rollbackUpdates[targetBalanceField] = -amount;
          if (this._shouldIncDepositTotal(targetWallet)) {
            rollbackUpdates[`${targetWallet}.depositTotal`] = -amount;
          }
          await User.findByIdAndUpdate(user._id, { $inc: rollbackUpdates });
        };

        if (sourceWallet === 'tradingAccount' || sourceWallet === 'nseBseWallet') {
          const nseUm = finalUser.nseBseWallet?.usedMargin ?? finalUser.wallet?.usedMargin ?? 0;
          if (afterSource < nseUm) {
            await rollbackMirror();
            throw new Error(this.buildTransferInsufficientError(finalUser, sourceWallet, amount));
          }
        } else if (afterSource < 0) {
          await rollbackMirror();
          throw new Error(this.buildTransferInsufficientError(finalUser, sourceWallet, amount));
        }
      }

      const ledgerSourceAfter = this._balanceAfterSourceDebit(finalUser, sourceWallet);
      const ledgerTargetAfter = this._balanceAfterTargetCredit(finalUser, targetWallet);

      try {
        await WalletLedger.create([
          {
            ownerType: 'USER',
            ownerId: user._id,
            adminCode: user.adminCode || 'SUPER',
            type: 'DEBIT',
            reason: 'WALLET_TRANSFER_DEBIT',
            amount: amount,
            balanceAfter: ledgerSourceAfter,
            description: `Transfer to ${this.getWalletDisplayName(targetWallet)}`,
            performedBy: performedBy,
            meta: {
              transferId,
              sourceWallet,
              targetWallet,
            },
          },
          {
            ownerType: 'USER',
            ownerId: user._id,
            adminCode: user.adminCode || 'SUPER',
            type: 'CREDIT',
            reason: 'WALLET_TRANSFER_CREDIT',
            amount: amount,
            balanceAfter: ledgerTargetAfter,
            description: `Transfer from ${this.getWalletDisplayName(sourceWallet)}`,
            performedBy: performedBy,
            meta: {
              transferId,
              sourceWallet,
              targetWallet,
            },
          },
        ]);
      } catch (ledgerError) {
        console.error('Failed to create ledger entries for wallet transfer:', ledgerError);
      }

      return {
        success: true,
        transferId,
        message: `Successfully transferred ₹${amount.toLocaleString()} from ${this.getWalletDisplayName(sourceWallet)} to ${this.getWalletDisplayName(targetWallet)}`,
        sourceBalance: ledgerSourceAfter,
        targetBalance: ledgerTargetAfter,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Execute transfer involving games wallet
   */
  static async executeGamesWalletTransfer(user, sourceWallet, targetWallet, amount, transferId, remarks, performedBy) {
    try {
      if (sourceWallet === 'gamesWallet') {
        const gamesWalletDebit = await atomicGamesWalletDebitForTransfer(User, user._id, amount);
        if (!gamesWalletDebit) {
          throw new Error('Insufficient balance in games wallet');
        }

        const targetUpdate = {};
        if (targetWallet === 'tradingAccount' || targetWallet === 'nseBseWallet') {
          targetUpdate['nseBseWallet.balance'] = amount;
        } else {
          const targetBalanceField = this.getBalanceFieldName(targetWallet);
          targetUpdate[targetBalanceField] = amount;
          if (this._shouldIncDepositTotal(targetWallet)) {
            targetUpdate[`${targetWallet}.depositTotal`] = amount;
          }
        }

        const finalUser = await User.findByIdAndUpdate(
          user._id,
          { $inc: targetUpdate },
          { new: true }
        );

        if (!finalUser) {
          throw new Error('Failed to credit target wallet');
        }

        const ledgerTargetAfter = this._balanceAfterTargetCredit(finalUser, targetWallet);

        try {
          await WalletLedger.create([
            {
              ownerType: 'USER',
              ownerId: user._id,
              adminCode: user.adminCode || 'SUPER',
              type: 'DEBIT',
              reason: 'WALLET_TRANSFER_DEBIT',
              amount: amount,
              balanceAfter: gamesWalletDebit.balance,
              description: `Transfer to ${this.getWalletDisplayName(targetWallet)}`,
              performedBy: performedBy,
              meta: {
                transferId,
                sourceWallet,
                targetWallet
              }
            },
            {
              ownerType: 'USER',
              ownerId: user._id,
              adminCode: user.adminCode || 'SUPER',
              type: 'CREDIT',
              reason: 'WALLET_TRANSFER_CREDIT',
              amount: amount,
              balanceAfter: ledgerTargetAfter,
              description: `Transfer from ${this.getWalletDisplayName(sourceWallet)}`,
              performedBy: performedBy,
              meta: {
                transferId,
                sourceWallet,
                targetWallet
              }
            }
          ]);
        } catch (ledgerError) {
          console.error('Failed to create ledger entries for games wallet transfer:', ledgerError);
        }

        return {
          success: true,
          transferId,
          message: `Successfully transferred ₹${amount.toLocaleString()} from ${this.getWalletDisplayName(sourceWallet)} to ${this.getWalletDisplayName(targetWallet)}`,
          sourceBalance: gamesWalletDebit.balance,
          targetBalance: ledgerTargetAfter
        };
      } else {
        const nseInvolved =
          sourceWallet === 'nseBseWallet' ||
          sourceWallet === 'tradingAccount' ||
          targetWallet === 'nseBseWallet' ||
          targetWallet === 'tradingAccount';
        if (nseInvolved) {
          await this._syncNseBseOnUser(user);
        }

        const sourceBalanceField = this.getBalanceFieldName(sourceWallet);

        const currentSourceBalance = this.getTransferSourceBalance(user, sourceWallet);

        if (currentSourceBalance < amount) {
          throw new Error(this.buildTransferInsufficientError(user, sourceWallet, amount));
        }

        let updatedUser;

        if (MARGIN_SEGMENT_SOURCES.includes(sourceWallet)) {
          const debited = await atomicMarginSegmentDebitForTransfer(User, user._id, sourceWallet, amount);
          if (!debited) {
            throw new Error(this.buildTransferInsufficientError(user, sourceWallet, amount));
          }
          updatedUser = await User.findById(user._id);
        } else {
          const sourceUpdate = {};
          sourceUpdate[sourceBalanceField] = -amount;

          updatedUser = await User.findByIdAndUpdate(
            user._id,
            { $inc: sourceUpdate },
            { new: true }
          );

          if (!updatedUser) {
            throw new Error('Failed to debit source wallet');
          }

          const afterSource = this._balanceAfterSourceDebit(updatedUser, sourceWallet);
          const um = updatedUser.wallet?.usedMargin || 0;

          if (sourceWallet === 'tradingAccount' || sourceWallet === 'nseBseWallet') {
            const nseUm = updatedUser.nseBseWallet?.usedMargin ?? um;
            if (afterSource < nseUm) {
              await User.findByIdAndUpdate(user._id, { $inc: { [sourceBalanceField]: amount } });
              throw new Error(this.buildTransferInsufficientError(updatedUser, sourceWallet, amount));
            }
          } else if (afterSource < 0) {
            const rollbackUpdates = {};
            rollbackUpdates[sourceBalanceField] = amount;
            await User.findByIdAndUpdate(user._id, { $inc: rollbackUpdates });
            throw new Error(this.buildTransferInsufficientError(updatedUser, sourceWallet, amount));
          }
        }

        const newSourceBalance = this._balanceAfterSourceDebit(updatedUser, sourceWallet);

        // Credit to games wallet
        await atomicGamesWalletUpdate(User, user._id, { balance: amount });

        const finalUser = await User.findById(user._id).select('gamesWallet').lean();

        // Create ledger entries (non-critical)
        try {
          await WalletLedger.create([
            {
              ownerType: 'USER',
              ownerId: user._id,
              adminCode: user.adminCode || 'SUPER',
              type: 'DEBIT',
              reason: 'WALLET_TRANSFER_DEBIT',
              amount: amount,
              balanceAfter: newSourceBalance,
              description: `Transfer to ${this.getWalletDisplayName(targetWallet)}`,
              performedBy: performedBy,
              meta: {
                transferId,
                sourceWallet,
                targetWallet
              }
            },
            {
              ownerType: 'USER',
              ownerId: user._id,
              adminCode: user.adminCode || 'SUPER',
              type: 'CREDIT',
              reason: 'WALLET_TRANSFER_CREDIT',
              amount: amount,
              balanceAfter: finalUser?.gamesWallet?.balance || 0,
              description: `Transfer from ${this.getWalletDisplayName(sourceWallet)}`,
              performedBy: performedBy,
              meta: {
                transferId,
                sourceWallet,
                targetWallet
              }
            }
          ]);
        } catch (ledgerError) {
          console.error('Failed to create ledger entries for games wallet transfer:', ledgerError);
        }

        return {
          success: true,
          transferId,
          message: `Successfully transferred ₹${amount.toLocaleString()} from ${this.getWalletDisplayName(sourceWallet)} to ${this.getWalletDisplayName(targetWallet)}`,
          sourceBalance: this.getTransferSourceBalance(updatedUser, sourceWallet),
          targetBalance: finalUser?.gamesWallet?.balance || 0,
        };
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get transfer history for a user
   * @param {String} userId - User ID
   * @returns {Array} - Transfer history
   */
  static async getTransferHistory(userId) {
    const transfers = await WalletLedger.find({
      ownerType: 'USER',
      ownerId: userId,
      reason: { $in: ['WALLET_TRANSFER_DEBIT', 'WALLET_TRANSFER_CREDIT'] },
    })
      .sort({ createdAt: -1 })
      .lean();

    const parseTransferTo = (desc) => {
      const m = String(desc || '').match(/^Transfer to (.+)$/);
      if (!m) return null;
      return this.displayNameToWalletKey(m[1].trim());
    };
    const parseTransferFrom = (desc) => {
      const m = String(desc || '').match(/^Transfer from (.+)$/);
      if (!m) return null;
      return this.displayNameToWalletKey(m[1].trim());
    };

    // Group by meta.transferId (works when meta fields are persisted in schema)
    const grouped = {};
    const consumedIds = new Set();

    transfers.forEach((t) => {
      const transferId = t.meta?.transferId;
      if (transferId) {
        if (!grouped[transferId]) {
          grouped[transferId] = {
            transferId,
            createdAt: t.createdAt,
            amount: t.amount,
            sourceWallet: t.meta?.sourceWallet,
            targetWallet: t.meta?.targetWallet,
            description: t.description,
            performedBy: t.performedBy,
          };
        }
        if (t._id) consumedIds.add(String(t._id));
      }
    });

    // Legacy: meta.transferId/sourceWallet/targetWallet were stripped by Mongoose strict schema —
    // pair DEBIT ("Transfer to Target") + CREDIT ("Transfer from Source") by amount & time window.
    const TIME_PAIR_MS = 15_000;
    const orphans = transfers.filter((t) => !consumedIds.has(String(t._id)));

    const amtEq = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

    const debits = orphans.filter((t) => t.type === 'DEBIT');
    const credits = orphans.filter((t) => t.type === 'CREDIT');

    for (const d of debits) {
      const idStr = String(d._id);
      if (consumedIds.has(idStr)) continue;
      const targetKey = parseTransferTo.call(this, d.description);
      if (!targetKey) continue;

      let best = null;
      let bestDt = Infinity;
      for (const cred of credits) {
        if (consumedIds.has(String(cred._id))) continue;
        if (!amtEq(cred.amount, d.amount)) continue;
        const srcKey = parseTransferFrom.call(this, cred.description);
        if (!srcKey || srcKey === targetKey) continue;
        const dt = Math.abs(new Date(cred.createdAt).getTime() - new Date(d.createdAt).getTime());
        if (dt > TIME_PAIR_MS) continue;
        if (dt < bestDt) {
          bestDt = dt;
          best = cred;
        }
      }

      const c = best;
      if (!c) continue;

      const sourceKey = parseTransferFrom.call(this, c.description);
      const syntheticId = `WT-fallback-${idStr}-${c._id}`;
      grouped[syntheticId] = {
        transferId: syntheticId,
        createdAt: d.createdAt > c.createdAt ? d.createdAt : c.createdAt,
        amount: Number(d.amount),
        sourceWallet: sourceKey,
        targetWallet: targetKey,
        description: `${this.getWalletDisplayName(sourceKey)} → ${this.getWalletDisplayName(targetKey)}`,
        performedBy: d.performedBy || c.performedBy,
      };
      consumedIds.add(idStr);
      consumedIds.add(String(c._id));
    }

    return Object.values(grouped).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
}

export default WalletTransferService;
