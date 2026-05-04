/**
 * Financial Controller
 * 
 * Clean architecture implementation for user financial operations.
 * Handles wallet management, deposits, withdrawals, transfers, and financial analytics.
 * 
 * Controller Responsibilities:
 * 1. Financial request validation and response formatting
 * 2. Financial business logic orchestration
 * 3. Wallet operations across multiple wallet types
 * 4. Error handling and status codes
 */

import User from '../models/User.js';
import Admin from '../models/Admin.js';
import BankAccount from '../models/BankAccount.js';
import BankSettings from '../models/BankSettings.js';
import FundRequest from '../models/FundRequest.js';
import WalletLedger from '../models/WalletLedger.js';
import GamesWalletLedger from '../models/GamesWalletLedger.js';
import WalletTransferService from '../services/walletTransferService.js';
import { buildUserPlatformChargeStatus } from '../services/platformChargeService.js';
import GameSettings from '../models/GameSettings.js';

// ==================== WALLET OPERATIONS ====================

/**
 * Get user wallet information
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const getUserWallet = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('wallet cryptoWallet forexWallet mcxWallet gamesWallet marginSettings rmsSettings');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    let gamesTicketValue = 300;
    
    // Get games ticket value from settings
    try {
      const settings = await GameSettings.getSettings();
      if (settings?.games?.ticketValue) {
        gamesTicketValue = settings.games.ticketValue;
      }
    } catch (settingsError) {
      console.warn('[FinancialController] Could not fetch game settings for ticket value:', settingsError);
    }

    // Normalize wallet for both legacy and current data shapes
    const walletObj =
      user.wallet && typeof user.wallet === 'object' && !Array.isArray(user.wallet)
        ? user.wallet
        : {};
    const legacyWalletNum = Number(user.wallet);
    const legacyBalance = Number.isFinite(legacyWalletNum) ? legacyWalletNum : 0;

    let mainWalletBalance = Number(walletObj.cashBalance || 0);
    if (mainWalletBalance <= 0 && Number(walletObj.balance || 0) > 0) {
      mainWalletBalance = Number(walletObj.balance);
    }
    if (mainWalletBalance <= 0 && legacyBalance > 0) {
      mainWalletBalance = legacyBalance;
    }

    const tradingBalance = Number(walletObj.tradingBalance || 0);
    const usedMargin = Number(walletObj.usedMargin || walletObj.blocked || 0);
    const unrealizedPnL = Number(walletObj.unrealizedPnL || 0);
    const availableMargin =
      tradingBalance
      + Number(walletObj.collateralValue || 0)
      + Math.max(0, unrealizedPnL)
      - Math.abs(Math.min(0, unrealizedPnL))
      - usedMargin;

    const gamesBalance = Number(user.gamesWallet?.balance || 0);
    const gamesTicketCount =
      gamesTicketValue > 0 ? Math.floor(gamesBalance / gamesTicketValue) : 0;

    res.json({
      // Top-level fields expected by current client
      cashBalance: mainWalletBalance,
      tradingBalance,
      usedMargin,
      collateralValue: Number(walletObj.collateralValue || 0),
      realizedPnL: Number(walletObj.realizedPnL || 0),
      unrealizedPnL,
      todayRealizedPnL: Number(walletObj.todayRealizedPnL || 0),
      todayUnrealizedPnL: Number(walletObj.todayUnrealizedPnL || 0),
      availableMargin,
      totalBalance: mainWalletBalance + tradingBalance,

      // Wallets
      wallet: {
        ...walletObj,
        balance: Number(walletObj.balance || mainWalletBalance),
        cashBalance: mainWalletBalance,
        tradingBalance,
        usedMargin,
        blocked: usedMargin,
      },
      cryptoWallet: user.cryptoWallet || {},
      forexWallet: user.forexWallet || {},
      mcxWallet: user.mcxWallet || {},
      gamesWallet: user.gamesWallet || {},

      // Games helpers
      gamesTicketValue,
      gamesTicketCount,

      // Settings
      marginSettings: user.marginSettings || {},
      rmsSettings: user.rmsSettings || {},
      rmsStatus: user.rmsSettings?.tradingBlocked ? 'BLOCKED' : 'ACTIVE',
      rmsBlockReason: user.rmsSettings?.blockReason || null,
    });
  } catch (error) {
    console.error('[FinancialController] Error getting user wallet:', error);
    res.status(500).json({ message: 'Failed to get wallet information' });
  }
};

/**
 * Get platform charge status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const getPlatformChargeStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      'wallet createdAt isDemo isActive username userId'
    );
    
    const status = buildUserPlatformChargeStatus(user);
    res.json(status);
  } catch (error) {
    console.error('[FinancialController] Error getting platform charge status:', error);
    res.status(500).json({ message: 'Failed to get platform charge status' });
  }
};

// ==================== DEPOSIT/WITHDRAWAL OPERATIONS ====================

/**
 * Submit deposit request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const submitDepositRequest = async (req, res) => {
  try {
    const { amount, utrNumber, paymentMethod, remarks } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }

    // Create deposit request
    const depositRequest = await FundRequest.create({
      user: req.user._id,
      type: 'DEPOSIT',
      amount,
      utrNumber,
      paymentMethod,
      remarks,
      status: 'PENDING',
      createdAt: new Date()
    });

    // Create wallet ledger entry
    await WalletLedger.create({
      ownerType: 'USER',
      ownerId: req.user._id,
      type: 'DEPOSIT_REQUEST',
      amount,
      balance: req.user.wallet || 0,
      description: `Deposit request - ${utrNumber}`,
      referenceId: depositRequest._id,
      createdAt: new Date()
    });

    res.status(201).json({
      message: 'Deposit request submitted successfully',
      request: {
        id: depositRequest._id,
        amount,
        status: 'PENDING',
        createdAt: depositRequest.createdAt
      }
    });
  } catch (error) {
    console.error('[FinancialController] Error submitting deposit request:', error);
    res.status(500).json({ message: 'Failed to submit deposit request' });
  }
};

/**
 * Submit withdrawal request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const submitWithdrawRequest = async (req, res) => {
  try {
    const { amount, accountDetails, paymentMethod, remarks } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }

    // Check if user has sufficient balance
    const user = await User.findById(req.user._id).select('wallet');
    if (!user || user.wallet < amount) {
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    // Create withdrawal request
    const withdrawRequest = await FundRequest.create({
      user: req.user._id,
      type: 'WITHDRAW',
      amount,
      accountDetails,
      paymentMethod,
      remarks,
      status: 'PENDING',
      createdAt: new Date()
    });

    // Create wallet ledger entry
    await WalletLedger.create({
      ownerType: 'USER',
      ownerId: req.user._id,
      type: 'WITHDRAW_REQUEST',
      amount: -amount,
      balance: user.wallet,
      description: `Withdrawal request`,
      referenceId: withdrawRequest._id,
      createdAt: new Date()
    });

    res.status(201).json({
      message: 'Withdrawal request submitted successfully',
      request: {
        id: withdrawRequest._id,
        amount,
        status: 'PENDING',
        createdAt: withdrawRequest.createdAt
      }
    });
  } catch (error) {
    console.error('[FinancialController] Error submitting withdrawal request:', error);
    res.status(500).json({ message: 'Failed to submit withdrawal request' });
  }
};

// ==================== WALLET TRANSFER OPERATIONS ====================

/**
 * Wallet-to-wallet transfer
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const walletTransfer = async (req, res) => {
  try {
    const { sourceWallet, targetWallet, amount, remarks } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }

    const result = await WalletTransferService.transferBetweenWallets(
      req.user._id,
      sourceWallet,
      targetWallet,
      amount,
      remarks
    );

    if (!result.success) {
      return res.status(400).json({ message: result.message });
    }

    res.json({
      message: 'Transfer successful',
      transfer: {
        sourceWallet,
        targetWallet,
        amount,
        newBalances: result.newBalances,
        transactionId: result.transactionId
      }
    });
  } catch (error) {
    console.error('[FinancialController] Error in wallet transfer:', error);
    res.status(500).json({ message: 'Transfer failed' });
  }
};

/**
 * Get wallet transfer history
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const getWalletTransferHistory = async (req, res) => {
  try {
    const history = await WalletTransferService.getTransferHistory(req.user._id);
    res.json({ history });
  } catch (error) {
    console.error('[FinancialController] Error getting wallet transfer history:', error);
    res.status(500).json({ message: 'Failed to get transfer history' });
  }
};

// ==================== REFERRAL EARNINGS ====================

/**
 * Get referral earnings
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const getReferralEarnings = async (req, res) => {
  try {
    const userId = req.user._id;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);
    
    // Get referral records
    const Referral = (await import('../models/Referral.js')).default;
    const referrals = await Referral.find({ referrer: userId })
      .populate('referredUser', 'username fullName email createdAt')
      .sort({ createdAt: -1 })
      .limit(limit);

    // Get wallet ledger entries for referral earnings
    const referralLedgerEntries = await WalletLedger.find({
      ownerType: 'USER',
      ownerId: userId,
      type: 'CREDIT',
      description: { $regex: /referral/i }
    })
    .sort({ createdAt: -1 })
    .limit(limit);

    // Get games wallet ledger entries for referral earnings
    const referralGamesEntries = await GamesWalletLedger.find({
      ownerType: 'USER',
      ownerId: userId,
      type: 'CREDIT',
      description: { $regex: /referral/i }
    })
    .sort({ createdAt: -1 })
    .limit(limit);

    // Combine and format earnings
    const referralAmounts = [
      ...referralLedgerEntries.map(entry => ({
        id: entry._id,
        type: 'wallet',
        amount: entry.amount,
        description: entry.description,
        createdAt: entry.createdAt,
        balance: entry.balance
      })),
      ...referralGamesEntries.map(entry => ({
        id: entry._id,
        type: 'games',
        amount: entry.amount,
        description: entry.description,
        createdAt: entry.createdAt,
        balance: entry.balance
      }))
    ].sort((a, b) => b.createdAt - a.createdAt);

    const totalEarnings = referralAmounts.reduce((sum, item) => sum + item.amount, 0);

    res.json({
      referralAmounts,
      totalEarnings,
      totalReferrals: referrals.length
    });
  } catch (error) {
    console.error('[FinancialController] Error fetching referral earnings:', error);
    res.status(500).json({ message: 'Failed to fetch referral earnings' });
  }
};

// ==================== BANK DETAILS ====================

/**
 * Get bank details for deposits
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const getBankDetails = async (req, res) => {
  try {
    // Get the user's admin code to fetch their admin's bank accounts
    const userAdminCode = req.user.adminCode;
    
    // Get admin's bank accounts
    const admin = await Admin.findOne({ adminCode: userAdminCode })
      .populate('bankAccounts');
    
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    // Get bank settings for display
    const bankSettings = await BankSettings.findOne().sort({ createdAt: -1 });
    
    const bankDetails = {
      adminName: admin.name,
      adminCode: admin.adminCode,
      bankAccounts: admin.bankAccounts || [],
      bankSettings: bankSettings || {},
      instructions: bankSettings?.depositInstructions || 'Please contact your admin for deposit instructions'
    };

    res.json(bankDetails);
  } catch (error) {
    console.error('[FinancialController] Error getting bank details:', error);
    res.status(500).json({ message: 'Failed to get bank details' });
  }
};
