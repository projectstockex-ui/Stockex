/**
 * User Routes
 * 
 * Clean architecture implementation for user operations and gaming activities.
 * Handles user authentication, gaming operations, fund management, and trading activities.
 * 
 * Route Groups:
 * 1. Authentication - User login, logout, and session management
 * 2. User Management - Profile updates and user operations
 * 3. Gaming Operations - Number betting, jackpot games, and bracket trading
 * 4. Fund Management - Fund requests, transfers, and wallet operations
 * 5. Trading Activities - User trading operations and position management
 * 6. Notifications - User notifications and alerts
 */

import express from 'express';
import { protectUser, protectAdmin, generateToken } from '../middleware/auth.js';
import {
  validateUserRegistration,
  validateUserLogin,
  validateProfileUpdate,
  validatePasswordChange,
  validateWalletTransfer,
  validateFundRequest,
  validateNotificationOperation,
  validateGameQuery,
  rejectIfHierarchyGameDenied,
  validateGameAccess
} from '../middleware/userMiddleware.js';
import {
  validateGameBet,
  validateDepositRequest,
  validateWithdrawRequest,
  validateDemoRegistration,
  validateParentInfo,
  validatePositionClose,
  validatePagination
} from '../middleware/validationMiddleware.js';

// ==================== CONTROLLER IMPORTS ====================

// Authentication Controllers
import {
  registerUser,
  registerDemoUser,
  loginUser,
  logoutUser,
  getParentInfo,
  sendOTP,
  verifyOTP
} from '../controllers/authController.js';

// Profile Controllers
import {
  getUserProfile,
  updateUserProfile,
  changeUserPassword
} from '../controllers/profileController.js';

// Financial Controllers
import {
  getUserWallet,
  getPlatformChargeStatus,
  submitDepositRequest,
  submitWithdrawRequest,
  walletTransfer,
  getWalletTransferHistory,
  getReferralEarnings,
  getBankDetails
} from '../controllers/financialController.js';

// Gaming Controllers
import {
  placeGameBet,
  getGameWalletLedger,
  getGameTodayNet,
  getGameLiveActivity,
  getGameRecentWinners,
  getGameStats,
  getGameHistory,
  getNiftyJackpotLast5DaysClearing,
  getNiftyBracketLast5Days,
  getNiftyJackpotLeaderboard
} from '../controllers/gamingController.js';

// Notification Controllers
import {
  getUserNotifications,
  markNotificationRead,
  markNotificationUnread,
  markAllNotificationsRead,
  getNotificationSettings,
  updateNotificationSettings,
  getNotificationStats
} from '../controllers/notificationController.js';

// Trading Controllers
import {
  getUserPositions,
  getUserTrades,
  getUserTradingStats,
  getUserTradingPerformance,
  getUserTradingSummary,
  closePosition,
  getPositionDetails
} from '../controllers/tradingController.js';

// Public Controllers
import {
  getBrokerInfoByReferralCode,
  getCertifiedBrokers
} from '../controllers/userController.js';

// Referral Controllers
import ReferralController from '../controllers/referralController.js';

// ==================== SERVICE IMPORTS ====================

import {
  distributeWinBrokerage,
  computeNiftyJackpotGrossHierarchyBreakdown,
  creditNiftyJackpotGrossHierarchyFromPool,
} from '../services/gameProfitDistribution.js';
import {
  resolveNiftyBracketTrade
} from '../services/niftyBracketResolve.js';
import { autoSettleBtcUpDown } from '../services/gamesAutoSettlement.js';
import { getDummyNiftyWhenMarketClosedForTesting } from '../utils/dummyNiftyLtp.js';
import {
  isNiftyJackpotBiddingHoursBypassedForTesting,
  isNiftyBracketBiddingHoursBypassedForTesting,
} from '../utils/niftyJackpotTestMode.js';
import { isCurrentTimeWithinBracketBiddingIST } from '../utils/niftyBracketBiddingWindow.js';
import { 
  createTransactionSlip, 
  addDebitEntry, 
  findTransactionSlipByTransactionId,
  addCreditEntry,
  addBrokerageDistributionEntries
} from '../services/gameTransactionSlipService.js';
import { getTodayISTString, startOfISTDayFromKey, endOfISTDayFromKey } from '../utils/istDate.js';
import { buildNiftyJackpotIstDayQuery } from '../utils/niftyJackpotDayScope.js';
import {
  sumUpDownSideTicketsInWindow,
  sumBracketSideTicketsInDay,
} from '../utils/gameStakeSideLimits.js';
import { plainSegmentDefaultsMap } from '../utils/commissionTypeUnit.js';
import TradeService from '../services/tradeService.js';
import {
  assertHierarchyGameNotDeniedForUserId,
} from '../services/gameRestrictionService.js';

// ==================== MODEL IMPORTS ====================

import User from '../models/User.js';
import Admin from '../models/Admin.js';
import SystemSettings from '../models/SystemSettings.js';
import { buildDemoExpiresAt, getDemoAccountSettings } from '../utils/demoAccountUtils.js';
import BankSettings from '../models/BankSettings.js';
import BankAccount from '../models/BankAccount.js';
import FundRequest from '../models/FundRequest.js';
import Notification from '../models/Notification.js';
import BrokerChangeRequest from '../models/BrokerChangeRequest.js';
import GameSettings from '../models/GameSettings.js';
import GameResult from '../models/GameResult.js';
import NiftyNumberBet from '../models/NiftyNumberBet.js';
import BtcNumberBet from '../models/BtcNumberBet.js';
import NiftyBracketTrade from '../models/NiftyBracketTrade.js';
import NiftyJackpotBid from '../models/NiftyJackpotBid.js';
import NiftyJackpotResult from '../models/NiftyJackpotResult.js';
import BtcJackpotResult from '../models/BtcJackpotResult.js';
import GamesWalletLedger from '../models/GamesWalletLedger.js';
import UpDownWindowSettlement from '../models/UpDownWindowSettlement.js';
import WalletLedger from '../models/WalletLedger.js';
import Trade from '../models/Trade.js';
import WalletTransferService from '../services/walletTransferService.js';
import { recalculateUsedMargin } from '../utils/recalculateUsedMargin.js';
import {
  migrateNseBseWalletIfNeeded,
  readNseBseWalletFromDb,
} from '../utils/nseBseWallet.js';
import { buildUserWalletResponse } from '../utils/buildUserWalletResponse.js';
import { buildUserPlatformChargeStatus } from '../services/platformChargeService.js';
import { getMarketData } from '../services/zerodhaWebSocket.js';
import {
  fetchNifty50LastPriceFromKite,
  fetchNifty50SessionClearing15mCached,
} from '../utils/kiteNiftyQuote.js';
import { closingPriceToLeftTwoDigits } from '../utils/niftyNumberResult.js';
import {
  niftyResultSecForWindow,
} from '../../lib/niftyUpDownWindows.js';
import { ensureGamesWallet, touchGamesWallet, atomicGamesWalletUpdate, atomicGamesWalletDebit } from '../utils/gamesWallet.js';
import { recordGamesWalletLedger, GAMES_WALLET_GAME_LABELS } from '../utils/gamesWalletLedger.js';
import { creditReferralPerWinFromGameSettings } from '../services/referralPerWin.js';
import { getNextBracketSettlementDateIST } from '../utils/niftyBracketSettlementTime.js';
import {
  creditBtcUpDownSuperAdminPool,
  debitBtcUpDownSuperAdminPool,
} from '../utils/btcUpDownSuperAdminPool.js';
import {
  creditSuperAdminForBtcJackpotStake,
  debitSuperAdminForBtcJackpotPayout,
  rollbackBtcJackpotStakeCredit,
} from '../utils/btcJackpotPool.js';
import {
  resolveNiftyJackpotSpotPrice,
  sortJackpotBidsByDistanceToReference,
} from '../utils/niftyJackpotRank.js';
import { resolveJackpotPrizePercentForRank } from '../utils/niftyJackpotPrize.js';
import {
  validateBtcUpDownBetPlacement,
  currentTotalSecondsIST,
  btcResultRefSecForUiWindow,
  btcOpenRefSecForUiWindow,
  getBtcUpDownWindowState,
  getBtcMaxWindowForSession,
} from '../../lib/btcUpDownWindows.js';
import { fetchBtcFifteenMinuteIstWindowOhlc, fetchBtcUsdt1mCloseAtIstRef } from '../utils/binanceBtcKline.js';
import { resolveBtcUpDownPriceAtIstRef } from '../utils/btcUpDownOpenPrice.js';
import {
  validateNiftyUpDownBetPlacement,
  getNiftyUpDownWindowState,
} from '../../lib/niftyUpDownWindows.js';

const router = express.Router();

// ==================== MIDDLEWARE COMPOSITION ====================

/**
 * Authentication middleware combinations
 */
const userAuth = [protectUser];
const adminAuth = [protectAdmin];

// ==================== PUBLIC ROUTES ====================

/**
 * @route   GET /api/users/broker-info/:referralCode
 * @desc    Get broker information by referral code
 * @access  Public
 * @param   referralCode - Broker referral code
 * @returns Broker information
 */
router.get('/broker-info/:referralCode', getBrokerInfoByReferralCode);

/**
 * @route   GET /api/users/certified-brokers
 * @desc    Get certified brokers for landing page
 * @access  Public
 * @returns Array of certified brokers
 */
router.get('/certified-brokers', getCertifiedBrokers);

// ==================== AUTHENTICATION ROUTES ====================

/**
 * @route   POST /api/users/register
 * @desc    Register a new user
 * @access  Public
 * @body    User registration data
 * @returns Created user information
 */
router.post('/register', validateUserRegistration, registerUser);

/**
 * @route   POST /api/users/login
 * @desc    User login
 * @access  Public
 * @body    Login credentials
 * @returns Authentication tokens and user data
 */
router.post('/login', validateUserLogin, loginUser);

/**
 * @route   POST /api/users/logout
 * @desc    User logout
 * @access  User only
 * @returns Logout success message
 */
router.post('/logout', ...userAuth, logoutUser);

// ==================== USER PROFILE ROUTES ====================

/**
 * @route   GET /api/users/profile
 * @desc    Get user profile
 * @access  User only
 * @returns User profile information
 */
router.get('/profile', ...userAuth, getUserProfile);

/**
 * @route   PUT /api/users/profile
 * @desc    Update user profile
 * @access  User only
 * @body    Profile update data
 * @returns Updated user information
 */
router.put('/profile', ...userAuth, validateProfileUpdate, updateUserProfile);

/**
 * @route   POST /api/users/change-password
 * @desc    Change user password
 * @access  User only
 * @body    Password change data
 * @returns Password change success message
 */
router.post('/change-password', ...userAuth, validatePasswordChange, changeUserPassword);

// ==================== WALLET ROUTES ====================

/**
 * @route   GET /api/users/wallet
 * @desc    Get user wallet information
 * @access  User only
 * @returns Wallet balance and information
 */
router.get('/wallet', ...userAuth, getUserWallet);

/**
 * @route   GET /api/users/platform-charge-status
 * @desc    Get platform charge status
 * @access  User only
 * @returns Platform charge information
 */
router.get('/platform-charge-status', ...userAuth, getPlatformChargeStatus);

const CRYPTO_SPREAD_SEGMENT_CHAIN = ['CRYPTOFUT', 'CRYPTOOPT'];

function pickPositiveCryptoSpreadUsdFromDefaults(asdPlain) {
  for (const seg of CRYPTO_SPREAD_SEGMENT_CHAIN) {
    const v = Number(asdPlain?.[seg]?.cryptoSpreadUsdPerSide);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return 0;
}

function pickPositiveCryptoSpreadInrFromDefaults(asdPlain) {
  for (const seg of CRYPTO_SPREAD_SEGMENT_CHAIN) {
    const v = Number(asdPlain?.[seg]?.cryptoSpreadInr);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return 0;
}

function inferInstrumentTypeForUserSettingsSegment(segment) {
  const u = String(segment || '').toUpperCase();
  if (
    u.endsWith('OPT') ||
    ['NSEOPT', 'MCXOPT', 'BSE-OPT', 'FOREXOPT', 'CRYPTOOPT'].includes(u)
  ) {
    return 'OPTIONS';
  }
  return undefined;
}

/** (Reserved) nudge throttling was removed so every /game-results read forces missing GameResult backfill. */

/** Nifty Jackpot: ticket units per bid (new bids store ticketCount; legacy = amount / unit). */
function niftyJackpotTicketUnitsForBid(bid, oneTicketRs) {
  const unit = Number(oneTicketRs);
  const n = Number(bid?.ticketCount);
  if (Number.isFinite(n) && n >= 1) return Math.round(n);
  if (Number.isFinite(unit) && unit > 0) {
    const k = Math.round((Number(bid?.amount) || 0) / unit);
    return k >= 1 ? k : 1;
  }
  return 1;
}

// PUBLIC: Get Broker Info by Referral Code (for signup page)
router.get('/broker-info/:referralCode', async (req, res) => {
  try {
    const { referralCode } = req.params;
    
    const broker = await Admin.findOne({ 
      referralCode: referralCode.toUpperCase(),
      status: 'ACTIVE'
    })
    .select('name username branding certificate adminCode referralCode')
    .lean();

    if (!broker) {
      return res.status(404).json({ message: 'Broker not found' });
    }

    res.json({
      name: broker.name || broker.branding?.brandName || broker.username,
      username: broker.username,
      adminCode: broker.adminCode,
      referralCode: broker.referralCode,
      certificateNumber: broker.certificate?.certificateNumber || '',
      specialization: broker.certificate?.specialization || '',
      isVerified: broker.certificate?.isVerified || false,
      brandName: broker.branding?.brandName || '',
      logoUrl: broker.branding?.logoUrl || ''
    });
  } catch (error) {
    console.error('Error fetching broker info:', error);
    res.status(500).json({ message: 'Failed to fetch broker info' });
  }
});

// PUBLIC: Get Certified Brokers for Landing Page (No Auth Required)
router.get('/certified-brokers', async (req, res) => {
  try {
    const brokers = await Admin.find({
      role: 'BROKER',
      status: 'ACTIVE',
      'certificate.showOnLandingPage': true,
      'certificate.isVerified': true
    })
    .select('name username branding certificate referralCode adminCode stats.totalUsers')
    .sort({ 'certificate.displayOrder': 1, 'certificate.rating': -1 })
    .lean();

    const formattedBrokers = brokers.map(broker => ({
      id: broker._id,
      name: broker.name || broker.branding?.brandName || broker.username,
      brandName: broker.branding?.brandName || '',
      logoUrl: broker.branding?.logoUrl || '',
      certificateNumber: broker.certificate?.certificateNumber || '',
      description: broker.certificate?.description || '',
      specialization: broker.certificate?.specialization || '',
      yearsOfExperience: broker.certificate?.yearsOfExperience || 0,
      totalClients: broker.certificate?.totalClients || broker.stats?.totalUsers || 0,
      rating: broker.certificate?.rating || 5,
      referralCode: broker.referralCode,
      adminCode: broker.adminCode
    }));

    res.json({ brokers: formattedBrokers });
  } catch (error) {
    console.error('Error fetching certified brokers:', error);
    res.status(500).json({ message: 'Failed to fetch brokers' });
  }
});

// User Registration
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, fullName, phone, phoneVerified, adminCode, referralCode } = req.body;
    
    let admin;
    let referrerUser = null;
    
    // If admin code or referral code provided, use that admin
    if (adminCode) {
      // Admin code takes priority
      admin = await Admin.findOne({ adminCode: adminCode.trim().toUpperCase() });

      if (!admin) {
        return res.status(400).json({ message: 'Invalid admin code' });
      }

      if (admin.status !== 'ACTIVE') {
        return res.status(400).json({ message: 'Admin is not active. Contact support.' });
      }
    } else if (referralCode) {
      // Check if it's a user referral code
      referrerUser = await User.findOne({ referralCode: referralCode.trim().toUpperCase() });
      
      if (referrerUser) {
        // User referral - use the referrer's admin
        admin = await Admin.findById(referrerUser.admin);
        
        if (!admin || admin.status !== 'ACTIVE') {
          return res.status(400).json({ message: 'Referrer admin is not active. Contact support.' });
        }
      } else {
        // Check if it's an admin referral code
        admin = await Admin.findOne({ referralCode: referralCode.trim().toUpperCase() });

        if (!admin) {
          return res.status(400).json({ message: 'Invalid referral code' });
        }

        if (admin.status !== 'ACTIVE') {
          return res.status(400).json({ message: 'Admin is not active. Contact support.' });
        }
      }
    } else {
      // No admin code provided - assign to Super Admin by default
      admin = await Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' });
      
      if (!admin) {
        return res.status(400).json({ message: 'System not configured. Please contact support.' });
      }
    }
    
    const userExists = await User.findOne({ $or: [{ email }, { username }] });
    if (userExists) {
      return res.status(400).json({ message: 'User with this email or username already exists' });
    }

    // Generate unique referral code for user (like brokers)
    const generateUserReferralCode = () => {
      const timestamp = Date.now().toString(36).toUpperCase();
      const random = Math.random().toString(36).substring(2, 6).toUpperCase();
      return `REF${timestamp}${random}`;
    };

    let userReferralCode = generateUserReferralCode();

    // Ensure uniqueness
    let existingUserWithCode = await User.findOne({ referralCode: userReferralCode });
    while (existingUserWithCode) {
      userReferralCode = generateUserReferralCode();
      existingUserWithCode = await User.findOne({ referralCode: userReferralCode });
    }

    const user = await User.create({
      username,
      email,
      password,
      fullName,
      phone,
      phoneVerified: phoneVerified || false,
      admin: admin._id,
      adminCode: admin.adminCode,
      createdBy: admin._id,
      referralCode: userReferralCode,
      referredBy: referrerUser?._id || null
    });

    // Create referral record if referred by a user
    if (referrerUser) {
      const Referral = (await import('../models/Referral.js')).default;
      await Referral.create({
        referrer: referrerUser._id,
        referredUser: user._id,
        referralCode: referralCode.trim().toUpperCase(),
        status: 'ACTIVE',
        activatedAt: new Date()
      });
    }

    // Update admin stats - increment user count
    admin.stats.totalUsers = (admin.stats.totalUsers || 0) + 1;
    admin.stats.activeUsers = (admin.stats.activeUsers || 0) + 1;
    await admin.save();

    res.status(201).json({
      _id: user._id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      adminCode: user.adminCode,
      wallet: user.wallet,
      marginAvailable: user.marginAvailable,
      token: generateToken(user._id)
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create Demo Account - No admin required; trial days from SystemSettings (default 7)
// Optional referralCode: same as /register — if it matches a User, referredBy is set (persists through convert-to-real) so referral rewards work after real play.
router.post('/demo-register', async (req, res) => {
  try {
    const { username, email, password, fullName, phone, referralCode: referralCodeRaw } = req.body;
    const referralCode = typeof referralCodeRaw === 'string' && referralCodeRaw.trim()
      ? referralCodeRaw.trim().toUpperCase()
      : '';

    let referrerUser = null;
    if (referralCode) {
      referrerUser = await User.findOne({ referralCode });
      if (referrerUser) {
        const refAdmin = await Admin.findById(referrerUser.admin);
        if (!refAdmin || refAdmin.status !== 'ACTIVE') {
          return res.status(400).json({ message: 'Referrer admin is not active. Contact support.' });
        }
      } else {
        const adminByRef = await Admin.findOne({ referralCode });
        if (!adminByRef) {
          return res.status(400).json({ message: 'Invalid referral code' });
        }
        if (adminByRef.status !== 'ACTIVE') {
          return res.status(400).json({ message: 'Admin is not active. Contact support.' });
        }
      }
    }
    
    // Check if user already exists
    const userExists = await User.findOne({ $or: [{ email }, { username }] });
    if (userExists) {
      return res.status(400).json({ message: 'User with this email or username already exists' });
    }
    
    // Unique referral code for the new user (same pattern as /register)
    const generateUserReferralCode = () => {
      const ts = Date.now().toString(36).toUpperCase();
      const random = Math.random().toString(36).substring(2, 6).toUpperCase();
      return `REF${ts}${random}`;
    };
    let newUserReferralCode = generateUserReferralCode();
    let codeTaken = await User.findOne({ referralCode: newUserReferralCode });
    while (codeTaken) {
      newUserReferralCode = generateUserReferralCode();
      codeTaken = await User.findOne({ referralCode: newUserReferralCode });
    }
    
    const { trialDays, demoBalance } = await getDemoAccountSettings();
    const demoExpiresAt = await buildDemoExpiresAt(new Date());
    
    // Create demo user without admin (admin chosen at convert-to-real)
    const user = await User.create({
      username,
      email,
      password,
      fullName,
      phone,
      isDemo: true,
      demoExpiresAt,
      demoCreatedAt: new Date(),
      adminCode: null,
      admin: null,
      hierarchyPath: [],
      referralCode: newUserReferralCode,
      referredBy: referrerUser?._id || null,
      wallet: {
        balance: demoBalance,
        cashBalance: demoBalance,
        tradingBalance: 0,
        usedMargin: 0,
        collateralValue: 0,
        realizedPnL: 0,
        unrealizedPnL: 0,
        todayRealizedPnL: 0,
        todayUnrealizedPnL: 0,
        transactions: []
      },
      gamesWallet: {
        balance: demoBalance,
        usedMargin: 0,
        realizedPnL: 0,
        unrealizedPnL: 0,
        todayRealizedPnL: 0,
        todayUnrealizedPnL: 0
      },
      settings: {
        isDemo: true,
        isActivated: true
      }
    });

    if (referrerUser) {
      const Referral = (await import('../models/Referral.js')).default;
      await Referral.create({
        referrer: referrerUser._id,
        referredUser: user._id,
        referralCode,
        status: 'ACTIVE',
        activatedAt: new Date()
      });
    }

    res.status(201).json({
      _id: user._id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      isDemo: true,
      demoExpiresAt: user.demoExpiresAt,
      wallet: user.wallet,
      token: generateToken(user._id),
      trialDays,
      message: `Demo account created! Valid for ${trialDays} days with ${demoBalance.toLocaleString('en-IN')} virtual balance. No brokerage is paid to admins on demo trades.`
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Legacy login route kept for backward compatibility and to avoid duplicate /login registration.
router.post('/login-legacy', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).populate('createdBy', 'adminCode name username role');

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (!user.isActive) {
      return res.status(401).json({ message: 'Your account is not active. Please contact your admin.' });
    }
    
    // Check if demo account has expired
    if (user.isDemo && user.demoExpiresAt && new Date() > user.demoExpiresAt) {
      return res.status(401).json({ message: 'Your demo account has expired. Please create a new account.' });
    }

    if (await user.comparePassword(password)) {
      const userAgent = req.headers['user-agent'] || 'Unknown device';
      const deviceType = userAgent.includes('Mobile') ? 'Mobile' : 'Desktop';

      await User.updateOne(
        { _id: user._id },
        {
          isLogin: true,
          lastLoginAt: new Date(),
          lastLoginDevice: deviceType
        }
      );
      
      // Get parent admin info
      const parentAdmin = user.createdBy ? {
        adminCode: user.createdBy.adminCode,
        name: user.createdBy.name || user.createdBy.username,
        role: user.createdBy.role
      } : null;
      
      res.json({
        _id: user._id,
        userId: user.userId,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        role: user.role,
        wallet: user.wallet,
        marginAvailable: user.marginAvailable,
        isReadOnly: user.isReadOnly || false,
        isDemo: user.isDemo || false,
        demoExpiresAt: user.demoExpiresAt,
        createdAt: user.createdAt,
        parentAdmin: parentAdmin,
        token: generateToken(user._id)
      });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get parent admin info by email (for showing on login form)
router.post('/parent-info', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }
    
    const user = await User.findOne({ email }).populate('createdBy', 'adminCode name username role parentId').populate('admin', 'adminCode name username role parentId');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Use createdBy if available, otherwise fall back to admin field
    const adminToUse = user.createdBy || user.admin;
    
    if (!adminToUse) {
      return res.json({ parentAdmin: null, hierarchy: [] });
    }
    
    // Return only the immediate parent (1 step)
    const parentAdmin = {
      adminCode: adminToUse.adminCode,
      name: adminToUse.name || adminToUse.username || adminToUse.adminCode,
      role: adminToUse.role
    };
    
    res.json({
      parentAdmin: parentAdmin,
      hierarchy: [parentAdmin]
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// User Logout - Clear session token to allow login from other devices
router.post('/logout', protectUser, async (req, res) => {
  try {
    await User.updateOne(
      { _id: req.user._id },
      { isLogin: false }
    );
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get user profile
router.get('/profile', protectUser, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get bank details for deposits - Shows admin's bank accounts, not Super Admin's
router.get('/bank-details', protectUser, async (req, res) => {
  try {
    // Get the user's admin code to fetch their admin's bank accounts
    const userAdminCode = req.user.adminCode;
    
    // First try to get the admin's bank accounts
    const adminBankAccounts = await BankAccount.find({ 
      adminCode: userAdminCode, 
      type: 'BANK',
      isActive: true 
    }).sort({ isPrimary: -1 });
    
    const adminUpiAccounts = await BankAccount.find({ 
      adminCode: userAdminCode, 
      type: 'UPI',
      isActive: true 
    }).sort({ isPrimary: -1 });
    
    // Get global settings for limits and instructions
    const settings = await BankSettings.getSettings();
    
    // If admin has bank accounts configured, use them
    if (adminBankAccounts.length > 0 || adminUpiAccounts.length > 0) {
      const bankAccount = adminBankAccounts[0]; // Primary or first active
      const upiAccount = adminUpiAccounts[0]; // Primary or first active
      
      res.json({
        bankName: bankAccount?.bankName || 'Not configured',
        accountName: bankAccount?.holderName || 'Not configured',
        accountNumber: bankAccount?.accountNumber || 'Not configured',
        ifscCode: bankAccount?.ifsc || 'Not configured',
        branch: bankAccount?.accountType || '',
        upiId: upiAccount?.upiId || 'Not configured',
        upiName: upiAccount?.holderName || 'Not configured',
        depositInstructions: settings.depositInstructions,
        minimumDeposit: settings.minimumDeposit,
        maximumDeposit: settings.maximumDeposit
      });
    } else {
      // Fallback to global settings (Super Admin's bank) if admin hasn't configured any
      const bankAccount = settings.bankAccounts.find(acc => acc.isPrimary && acc.isActive) 
        || settings.bankAccounts.find(acc => acc.isActive);
      
      const upiAccount = settings.upiAccounts.find(acc => acc.isPrimary && acc.isActive)
        || settings.upiAccounts.find(acc => acc.isActive);
      
      res.json({
        bankName: bankAccount?.bankName || 'Not configured',
        accountName: bankAccount?.accountName || 'Not configured',
        accountNumber: bankAccount?.accountNumber || 'Not configured',
        ifscCode: bankAccount?.ifscCode || 'Not configured',
        branch: bankAccount?.branch || '',
        upiId: upiAccount?.upiId || 'Not configured',
        upiName: upiAccount?.name || 'Not configured',
        depositInstructions: settings.depositInstructions,
        minimumDeposit: settings.minimumDeposit,
        maximumDeposit: settings.maximumDeposit
      });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Submit deposit request
router.post('/deposit-request', protectUser, async (req, res) => {
  try {
    const { amount, utrNumber, paymentMethod, remarks } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }
    if (!utrNumber) {
      return res.status(400).json({ message: 'UTR/Transaction ID is required' });
    }

    const request = await FundRequest.create({
      user: req.user._id,
      userId: req.user.userId,
      adminCode: req.user.adminCode || 'SUPER',
      hierarchyPath: req.user.hierarchyPath || [],
      type: 'DEPOSIT',
      amount,
      paymentMethod: paymentMethod || 'BANK',
      referenceId: utrNumber,
      userRemarks: remarks || ''
    });
    
    res.status(201).json({ 
      message: 'Deposit request submitted successfully',
      requestId: request.requestId
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Submit withdrawal request
router.post('/withdraw-request', protectUser, async (req, res) => {
  try {
    const { amount, accountDetails, paymentMethod, remarks } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }

    const user = await User.findById(req.user._id);
    
    // Check if trading account has negative balance - block withdrawal until P&L is settled
    const tradingBalance = user.wallet.tradingBalance || 0;
    const unrealizedPnL = user.wallet.unrealizedPnL || 0;
    const effectiveTradingBalance = tradingBalance + unrealizedPnL;
    
    if (effectiveTradingBalance < 0) {
      return res.status(400).json({ 
        message: `Withdrawal blocked! Your trading account has negative balance of ${Math.abs(effectiveTradingBalance).toLocaleString()}. Please settle your P&L first by depositing funds to your trading account.`,
        code: 'NEGATIVE_TRADING_BALANCE',
        deficit: Math.abs(effectiveTradingBalance)
      });
    }
    
    if (amount > user.wallet.cashBalance) {
      return res.status(400).json({ message: 'Insufficient balance' });
    }
    
    const request = await FundRequest.create({
      user: req.user._id,
      userId: req.user.userId,
      adminCode: req.user.adminCode || 'SUPER',
      hierarchyPath: req.user.hierarchyPath || [],
      type: 'WITHDRAWAL',
      amount,
      paymentMethod: paymentMethod || 'BANK',
      userRemarks: remarks || '',
      withdrawalDetails: {
        notes: accountDetails || ''
      }
    });
    
    res.status(201).json({ 
      message: 'Withdrawal request submitted successfully',
      requestId: request.requestId
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/platform-charge-status', protectUser, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      'wallet createdAt isDemo isActive username userId'
    );
    if (!user) return res.status(404).json({ message: 'User not found' });
    const status = await buildUserPlatformChargeStatus(user);
    res.json(status);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// NSE/BSE ledger autosquare status (real balance = cash + MTM, 90% loss floor)
router.get('/nse-bse-ledger-status', protectUser, async (req, res) => {
  try {
    const { getLedgerStatusForApi } = await import('../services/ledgerAutosquareService.js');
    const status = await getLedgerStatusForApi(req.user._id);
    res.json(status);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Transferable balance per wallet (balance − used margin on open trades)
router.get('/wallet-transfer-limits', protectUser, async (req, res) => {
  try {
    const user = await WalletTransferService.loadUserWithFreshMargins(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ limits: WalletTransferService.getAllTransferableBalanceDetails(user) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Wallet-to-wallet transfer
router.post('/wallet-transfer', protectUser, async (req, res) => {
  try {
    const { sourceWallet, targetWallet, amount, remarks } = req.body;

    if (!sourceWallet || !targetWallet) {
      return res.status(400).json({ message: 'Source and target wallets are required' });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Transfer amount must be greater than 0' });
    }

    const result = await WalletTransferService.executeTransfer(
      req.user._id,
      sourceWallet,
      targetWallet,
      amount,
      remarks || '',
      req.user._id
    );

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get wallet transfer history
router.get('/wallet-transfer-history', protectUser, async (req, res) => {
  try {
    const history = await WalletTransferService.getTransferHistory(req.user._id);
    res.json({ history });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Client → client main wallet transfer (same ADMIN hierarchy)
router.get('/peer-transfer/clients', protectUser, async (req, res) => {
  try {
    const { listEligibleClients } = await import('../services/clientPeerTransferService.js');
    const result = await listEligibleClients(req.user._id, {
      search: req.query.search || req.query.q || '',
      limit: req.query.limit,
    });
    res.json(result);
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
  }
});

router.get('/peer-transfer/lookup', protectUser, async (req, res) => {
  try {
    const recipientUserId = req.query.recipientUserId || req.query.userId;
    const { lookupRecipient } = await import('../services/clientPeerTransferService.js');
    const result = await lookupRecipient(req.user._id, recipientUserId);
    res.json(result);
  } catch (error) {
    res.status(error.statusCode || 400).json({ message: error.message });
  }
});

router.post('/peer-transfer', protectUser, async (req, res) => {
  try {
    const { recipientUserId, amount, remarks } = req.body;
    const { executePeerTransfer } = await import('../services/clientPeerTransferService.js');
    const result = await executePeerTransfer(req.user._id, {
      recipientUserId,
      amount,
      remarks,
    });
    res.json(result);
  } catch (error) {
    res.status(error.statusCode || 400).json({ message: error.message });
  }
});

router.get('/peer-transfer/history', protectUser, async (req, res) => {
  try {
    const { getPeerTransferHistory } = await import('../services/clientPeerTransferService.js');
    const history = await getPeerTransferHistory(req.user._id, { limit: req.query.limit });
    res.json({ history });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Normalize ?gameId= (Express may give a string[] if the key is repeated).
function parseLedgerGameIdQuery(raw) {
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim();
  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0];
    if (typeof first === 'string' && first.trim() !== '') return first.trim();
  }
  return null;
}

// Games wallet transaction history (per-game debits / credits)
// Query: ?limit=50&gameId=btcupdown&date=YYYY-MM-DD (IST calendar day, inclusive start)
// Date filter: rows whose document createdAt falls in that IST day — all activity (bets, wins, refunds) for that day.
router.get('/games-wallet/ledger', protectUser, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const gameId = parseLedgerGameIdQuery(req.query.gameId);
    const rawDate = typeof req.query.date === 'string' ? req.query.date.trim() : '';
    const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;

    const filter = { user: req.user._id };
    if (gameId) filter.gameId = gameId;

    if (dateKey) {
      const dayStart = startOfISTDayFromKey(dateKey);
      const dayEnd = endOfISTDayFromKey(dateKey);
      if (dayStart && dayEnd) {
        filter.createdAt = { $gte: dayStart, $lt: dayEnd };
      }
    }

    const rows = await GamesWalletLedger.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // Enrich with transaction slip information
    const enrichedRows = await Promise.all(rows.map(async (row) => {
      let transactionSlipInfo = null;
      
      // Check if this ledger entry has a transaction ID in meta
      if (row.meta?.transactionId) {
        try {
          const slip = await findTransactionSlipByTransactionId(row.meta.transactionId);
          if (slip) {
            transactionSlipInfo = {
              transactionId: slip.transactionId,
              totalDebitAmount: slip.totalDebitAmount,
              totalCreditAmount: slip.totalCreditAmount,
              netPnL: slip.netPnL,
              status: slip.status,
              gameIds: slip.gameIds,
              createdAt: slip.createdAt
            };
          }
        } catch (error) {
          console.warn('Failed to fetch transaction slip for ledger entry:', error);
        }
      }
      
      return {
        ...row,
        transactionSlip: transactionSlipInfo
      };
    }));

    res.json(enrichedRows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get user's wallet transaction history (main trading wallet - NSE/BSE only)
// Query: ?limit=50
router.get('/wallet-ledger', protectUser, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

    const ledger = await WalletLedger.find({
      ownerType: 'USER',
      ownerId: req.user._id,
      // Exclude crypto, forex, MCX, games transactions - only show NSE/BSE trading transactions
      reason: { 
        $nin: ['CRYPTO_TRANSFER', 'FOREX_TRANSFER', 'MCX_TRANSFER', 'GAMES_TRANSFER', 'INTERNAL_TRANSFER'] 
      }
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // Additional frontend-style filtering for robustness
    const filtered = ledger.filter(row => {
      const reason = (row.reason || '').toLowerCase();
      const description = (row.description || '').toLowerCase();
      const segment = (row.meta?.segment || '').toLowerCase();
      
      // Exclude crypto, forex, MCX, games transactions
      const isCrypto = reason.includes('crypto') || description.includes('crypto') || description.includes('btc') || description.includes('bitcoin') || description.includes('eth') || description.includes('binance') || segment === 'crypto';
      const isForex =
        reason.includes('forex') ||
        description.includes('(forex)') ||
        description.includes('(Forex)') ||
        segment === 'forex';
      const isMcx = reason.includes('mcx') || description.includes('mcx') || description.includes('commodity') || description.includes('gold') || description.includes('silver') || description.includes('crude') || segment === 'mcx';
      const isGames = reason.includes('games') || description.includes('games') || description.includes('fantasy') || segment === 'games';
      
      return !isCrypto && !isForex && !isMcx && !isGames;
    });

    res.json(filtered);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Referral earnings feed for the user's Wallet page "Total Referral Amount" tab.
// Aggregates credits from three disjoint sources into one descending-time list:
//   1) GamesWalletLedger  gameId='referral' — legacy; new referrals use main WalletLedger REFERRAL_COMMISSION
//      (creditReferralPercentOfTotalStake / jackpot & number declare / bracket resolve / Up-Down settle).
//   2) WalletLedger       reason='REFERRAL_COMMISSION' — per-segment profit distribution referral shares
//                         (distributeGameProfit → Super Admin share forwarded to referral client; segment
//                         meta is games/mcx/crypto/forex). Enum was expanded so these now actually persist.
//   3) User.wallet.transactions[] — legacy embedded entries from creditReferralTradingReward (first
//                         winning trade brokerage). Kept so existing credits before the ledger split remain visible.
router.get('/referral-earnings', protectUser, async (req, res) => {
  try {
    const userId = req.user._id;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);

    const SEGMENT_LABELS = {
      games: 'games',
      crypto: 'crypto trading',
      mcx: 'mcx trading',
      forex: 'forex trading',
      trading: 'trading',
    };

    const gameKeyLabel = (k) => {
      if (!k) return null;
      // GamesWalletLedger uses settings keys (btcUpDown, niftyJackpot, …); reuse the same display map
      // but also accept the ledger-level gameId shorthands (updown, btcupdown, …) for robustness.
      const direct = GAMES_WALLET_GAME_LABELS[k];
      if (direct) return direct;
      const normalized = String(k).toLowerCase();
      const altMap = {
        niftyupdown: 'Nifty Up/Down',
        btcupdown: 'BTC Up/Down',
        niftynumber: 'Nifty Number',
        niftybracket: 'Nifty Bracket',
        niftyjackpot: 'Nifty Jackpot',
      };
      return altMap[normalized] || k;
    };

    const parseReferredNameFromDescription = (desc) => {
      const s = String(desc || '');
      // Common patterns written by gameProfitDistribution / referralService:
      //   "Referral commission from <name>'s loss pool (X)"
      //   "Referral commission from <name>'s brokerage (X)"
      //   "Referral bonus: 5% of <name>'s first win in niftyJackpot"
      //   "Referral bonus: Brokerage from <name>'s first winning trade"
      let m = /from\s+([^']+)'s\s+(loss pool|brokerage|first winning)/i.exec(s);
      if (m) return m[1].trim();
      m = /of\s+([^']+)'s\s+first\s+win/i.exec(s);
      if (m) return m[1].trim();
      return null;
    };

    const [gameRows, trailRows, userDoc] = await Promise.all([
      GamesWalletLedger.find({
        user: userId,
        gameId: 'referral',
        entryType: 'credit',
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),

      WalletLedger.find({
        ownerType: 'USER',
        ownerId: userId,
        type: 'CREDIT',
        $or: [
          { reason: 'REFERRAL_COMMISSION' },
          { 'meta.profitKind': 'REFERRAL_COMMISSION' },
        ],
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),

      User.findById(userId)
        .select('referralStats wallet.transactions')
        .lean(),
    ]);

    const entries = [];

    for (const r of gameRows) {
      const gameKey = r.meta?.gameType || null;
      entries.push({
        source: 'games',
        segment: 'games',
        segmentLabel: SEGMENT_LABELS.games,
        referredUsername:
          r.meta?.referredUsername || parseReferredNameFromDescription(r.description) || null,
        gameKey,
        gameLabel: gameKeyLabel(gameKey),
        amount: Number(r.amount) || 0,
        description: r.description || '',
        createdAt: r.createdAt,
      });
    }

    for (const r of trailRows) {
      const rawSegment = (r.meta?.segment || 'trading').toLowerCase();
      const segment = ['games', 'mcx', 'forex'].includes(rawSegment) ? rawSegment : 'trading';
      entries.push({
        source: 'walletLedger',
        segment,
        segmentLabel: SEGMENT_LABELS[segment] || SEGMENT_LABELS.trading,
        referredUsername: parseReferredNameFromDescription(r.description),
        gameKey: r.meta?.gameKey || null,
        gameLabel: segment === 'games' ? gameKeyLabel(r.meta?.gameKey) : null,
        amount: Number(r.amount) || 0,
        description: r.description || '',
        createdAt: r.createdAt,
      });
    }

    // Legacy path: creditReferralTradingReward pushes into referrer.wallet.transactions[] directly.
    // Those rows have no segment metadata — infer "trading" and parse the name from the description.
    const embedded = Array.isArray(userDoc?.wallet?.transactions) ? userDoc.wallet.transactions : [];
    for (const t of embedded) {
      if (t?.type !== 'credit') continue;
      const desc = String(t.description || '');
      if (!/referral\s+(bonus|commission)/i.test(desc)) continue;
      entries.push({
        source: 'embeddedWallet',
        segment: 'trading',
        segmentLabel: SEGMENT_LABELS.trading,
        referredUsername: parseReferredNameFromDescription(desc),
        gameKey: null,
        gameLabel: null,
        amount: Number(t.amount) || 0,
        description: desc,
        createdAt: t.createdAt || null,
      });
    }

    entries.sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });

    const total = entries.reduce((s, e) => s + (Number.isFinite(e.amount) ? e.amount : 0), 0);

    res.json({
      total: parseFloat(total.toFixed(2)),
      totalLifetime: Number(userDoc?.referralStats?.totalReferralEarnings) || parseFloat(total.toFixed(2)),
      count: entries.length,
      entries,
    });
  } catch (error) {
    console.error('Referral earnings fetch error:', error);
    res.status(500).json({ message: error.message });
  }
});

const GAMES_LEDGER_GAME_IDS = ['updown', 'btcupdown', 'niftyNumber', 'niftyBracket', 'niftyJackpot', 'btcNumber', 'btcJackpot'];

/** Net games-wallet change per game for current IST calendar day (credits − debits), keyed by ledger gameId */
router.get('/games-wallet/today-net', protectUser, async (req, res) => {
  try {
    const today = getTodayISTString();
    const dayStart = startOfISTDayFromKey(today);
    const dayEnd = endOfISTDayFromKey(today);
    if (!dayStart || !dayEnd) {
      return res.status(500).json({ message: 'Invalid IST calendar day' });
    }

    // Credits (e.g. win payouts) use meta.orderPlacedAt = bet time — bucket by realizedAt = createdAt so
    // "today" matches when money hit the wallet. Debits still use placement time for the bet day.
    const rows = await GamesWalletLedger.aggregate([
      {
        $match: {
          user: req.user._id,
          gameId: { $in: GAMES_LEDGER_GAME_IDS },
        },
      },
      {
        $addFields: {
          eventAt: {
            $cond: [
              { $eq: ['$entryType', 'credit'] },
              '$createdAt',
              { $ifNull: ['$meta.orderPlacedAt', '$createdAt'] },
            ],
          },
        },
      },
      {
        $match: {
          eventAt: { $gte: dayStart, $lt: dayEnd },
        },
      },
      {
        $group: {
          _id: '$gameId',
          credits: {
            $sum: {
              $cond: [{ $eq: ['$entryType', 'credit'] }, { $toDouble: { $ifNull: ['$amount', 0] } }, 0],
            },
          },
          debits: {
            $sum: {
              $cond: [{ $eq: ['$entryType', 'debit'] }, { $toDouble: { $ifNull: ['$amount', 0] } }, 0],
            },
          },
        },
      },
    ]);

    const byGame = Object.fromEntries(GAMES_LEDGER_GAME_IDS.map((id) => [id, 0]));
    for (const r of rows) {
      if (r._id && Object.prototype.hasOwnProperty.call(byGame, r._id)) {
        const net = (Number(r.credits) || 0) - (Number(r.debits) || 0);
        byGame[r._id] = parseFloat(net.toFixed(2));
      }
    }

    const winRows = await GamesWalletLedger.aggregate([
      {
        $match: {
          user: req.user._id,
          gameId: { $in: GAMES_LEDGER_GAME_IDS },
          entryType: 'credit',
          createdAt: { $gte: dayStart, $lt: dayEnd },
          amount: { $gt: 0 },
          'meta.brokerageRebate': { $ne: true },
          $or: [
            { 'meta.won': true },
            {
              description: {
                $regex:
                  'win \\(gross|win \\(stake|prize payout|Up/Down.*win|BTC Jackpot —|Nifty Number — result: win|Nifty Number —|BTC Number — result: win',
                $options: 'i',
              },
            },
          ],
        },
      },
      {
        $group: {
          _id: '$gameId',
          total: { $sum: { $toDouble: { $ifNull: ['$amount', 0] } } },
        },
      },
    ]);

    const byGameGrossWins = Object.fromEntries(GAMES_LEDGER_GAME_IDS.map((id) => [id, 0]));
    for (const r of winRows) {
      if (r._id && Object.prototype.hasOwnProperty.call(byGameGrossWins, r._id)) {
        byGameGrossWins[r._id] = parseFloat((Number(r.total) || 0).toFixed(2));
      }
    }

    res.json({ istDate: today, byGame, byGameGrossWins });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/** Aggregate UP/DOWN bet debits for one window (all users), IST calendar day slice. */
async function aggregateUpDownBetPoolForWindow(gameId, windowNumber, dayStart, dayEnd) {
  const wn = Number(windowNumber);
  if (!Number.isFinite(wn) || wn < 1) {
    return { upTickets: 0, downTickets: 0, totalTickets: 0, players: 0 };
  }
  const rows = await GamesWalletLedger.aggregate([
    {
      $match: {
        gameId,
        entryType: 'debit',
        description: {
          $regex: 'Up/Down.*bet.*\\(UP\\)|Up/Down.*bet.*\\(DOWN\\)',
          $options: 'i',
        },
        $or: [{ 'meta.windowNumber': wn }, { 'meta.windowNumber': String(wn) }],
        createdAt: { $gte: dayStart, $lt: dayEnd },
      },
    },
    {
      $addFields: {
        predNorm: { $toUpper: { $ifNull: ['$meta.prediction', ''] } },
      },
    },
    {
      $group: {
        _id: '$predNorm',
        tickets: { $sum: { $toDouble: { $ifNull: ['$meta.tickets', 0] } } },
        users: { $addToSet: '$user' },
      },
    },
  ]);

  let upTickets = 0;
  let downTickets = 0;
  const userSet = new Set();
  for (const r of rows) {
    const pred = String(r._id || '').trim();
    const t = Number(r.tickets) || 0;
    if (pred === 'UP') upTickets += t;
    else if (pred === 'DOWN') downTickets += t;
    for (const u of r.users || []) {
      if (u) userSet.add(String(u));
    }
  }

  return {
    upTickets: parseFloat(upTickets.toFixed(2)),
    downTickets: parseFloat(downTickets.toFixed(2)),
    totalTickets: parseFloat((upTickets + downTickets).toFixed(2)),
    players: userSet.size,
  };
}

/** Sum ticket units + distinct players for stake debits today (IST). */
async function aggregateDayStakeDebits(gameId, dayStart, dayEnd, descRegex) {
  const rows = await GamesWalletLedger.aggregate([
    {
      $match: {
        gameId,
        entryType: 'debit',
        createdAt: { $gte: dayStart, $lt: dayEnd },
        description: { $regex: descRegex, $options: 'i' },
      },
    },
    {
      $group: {
        _id: null,
        tickets: { $sum: { $toDouble: { $ifNull: ['$meta.tickets', 0] } } },
        users: { $addToSet: '$user' },
      },
    },
  ]);
  const r = rows[0];
  const t = Number(r?.tickets) || 0;
  const users = r?.users || [];
  return {
    totalTickets: parseFloat(t.toFixed(2)),
    players: Array.isArray(users) ? users.filter(Boolean).length : 0,
  };
}

/**
 * Live pool / order-book style stats for all fantasy games (all users, same shapes the hub uses).
 * Keys: btcupdown, updown, niftyNumber, niftyBracket, niftyJackpot (ledger gameIds).
 */
router.get('/games/live-activity', protectUser, async (req, res) => {
  try {
    const settings = await GameSettings.getSettings().catch(() => null);
    const dayKey = getTodayISTString();
    const dayStart = startOfISTDayFromKey(dayKey);
    const dayEnd = endOfISTDayFromKey(dayKey);
    if (!dayStart || !dayEnd) {
      return res.status(500).json({ message: 'Invalid IST calendar day' });
    }

    const games = {};
    const nowSec = currentTotalSecondsIST();

    const btcCfg = settings?.games?.btcUpDown || {};
    if (btcCfg.enabled === false) {
      games.btcupdown = {
        enabled: false,
        status: 'off',
        windowNumber: 0,
        istDate: dayKey,
        upTickets: 0,
        downTickets: 0,
        totalTickets: 0,
        players: 0,
      };
    } else {
      const st = getBtcUpDownWindowState(nowSec, btcCfg);
      if (st.status !== 'open' || !Number.isFinite(Number(st.windowNumber)) || Number(st.windowNumber) < 1) {
        games.btcupdown = {
          enabled: true,
          status: st.status || 'closed',
          windowNumber: Number(st.windowNumber) || 0,
          istDate: dayKey,
          upTickets: 0,
          downTickets: 0,
          totalTickets: 0,
          players: 0,
        };
      } else {
        const wn = Number(st.windowNumber);
        const pool = await aggregateUpDownBetPoolForWindow('btcupdown', wn, dayStart, dayEnd);
        games.btcupdown = { enabled: true, status: 'open', windowNumber: wn, istDate: dayKey, ...pool };
      }
    }

    const ndCfg = settings?.games?.niftyUpDown || {};
    if (ndCfg.enabled === false) {
      games.updown = {
        enabled: false,
        status: 'off',
        windowNumber: 0,
        istDate: dayKey,
        upTickets: 0,
        downTickets: 0,
        totalTickets: 0,
        players: 0,
      };
    } else {
      const stN = getNiftyUpDownWindowState(nowSec, ndCfg);
      if (stN.status !== 'open' || !Number.isFinite(Number(stN.windowNumber)) || Number(stN.windowNumber) < 1) {
        games.updown = {
          enabled: true,
          status: stN.status || 'closed',
          windowNumber: Number(stN.windowNumber) || 0,
          istDate: dayKey,
          upTickets: 0,
          downTickets: 0,
          totalTickets: 0,
          players: 0,
        };
      } else {
        const wn = Number(stN.windowNumber);
        const pool = await aggregateUpDownBetPoolForWindow('updown', wn, dayStart, dayEnd);
        games.updown = { enabled: true, status: 'open', windowNumber: wn, istDate: dayKey, ...pool };
      }
    }

    const nnCfg = settings?.games?.niftyNumber || {};
    if (nnCfg.enabled === false) {
      games.niftyNumber = { enabled: false, status: 'off', istDate: dayKey, totalTickets: 0, players: 0 };
    } else {
      const pool = await aggregateDayStakeDebits(
        'niftyNumber',
        dayStart,
        dayEnd,
        'Nifty Number.*\\bbet\\b'
      );
      games.niftyNumber = { enabled: true, status: 'open', istDate: dayKey, ...pool };
    }

    const bnCfg = settings?.games?.btcNumber || {};
    if (bnCfg.enabled === false) {
      games.btcNumber = { enabled: false, status: 'off', istDate: dayKey, totalTickets: 0, players: 0 };
    } else {
      const pool = await aggregateDayStakeDebits(
        'btcNumber',
        dayStart,
        dayEnd,
        'BTC Number.*\\bbet\\b'
      );
      const nowSecBtcNum = currentTotalSecondsIST();
      const endSecInclusive = endInclusiveSecondsFromConfig(
        bnCfg.endTime || bnCfg.resultTime || bnCfg.biddingEndTime || '23:30'
      );
      games.btcNumber = {
        enabled: true,
        status: nowSecBtcNum > endSecInclusive ? 'closed' : 'open',
        istDate: dayKey,
        ...pool,
      };
    }

    const nbCfg = settings?.games?.niftyBracket || {};
    if (nbCfg.enabled === false) {
      games.niftyBracket = { enabled: false, status: 'off', istDate: dayKey, totalTickets: 0, players: 0 };
    } else {
      const pool = await aggregateDayStakeDebits(
        'niftyBracket',
        dayStart,
        dayEnd,
        'Nifty Bracket.*trade'
      );
      games.niftyBracket = { enabled: true, status: 'open', istDate: dayKey, ...pool };
    }

    const jpCfg = settings?.games?.niftyJackpot || {};
    if (jpCfg.enabled === false) {
      games.niftyJackpot = { enabled: false, status: 'off', istDate: dayKey, totalTickets: 0, players: 0 };
    } else {
      const pool = await aggregateDayStakeDebits(
        'niftyJackpot',
        dayStart,
        dayEnd,
        'Nifty Jackpot'
      );
      games.niftyJackpot = { enabled: true, status: 'open', istDate: dayKey, ...pool };
    }

    res.json({ istDate: dayKey, games });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

const GAMES_RECENT_WINNER_IDS = ['updown', 'btcupdown', 'niftyNumber', 'niftyBracket', 'niftyJackpot', 'btcNumber', 'btcJackpot'];

// Live feed of real win credits (current user only) for the Fantasy Games hub
router.get('/games/recent-winners', protectUser, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 15, 1), 40);
    const rows = await GamesWalletLedger.find({
      user: req.user._id,
      entryType: 'credit',
      amount: { $gt: 0 },
      gameId: { $in: GAMES_RECENT_WINNER_IDS },
      'meta.brokerageRebate': { $ne: true },
      $or: [
        { 'meta.won': true },
        {
          description: {
            $regex: 'result:\\s*win|prize payout|win \\(stake \\+ profit\\)',
            $options: 'i',
          },
        },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('user gameId amount description createdAt')
      .lean();

    const userIds = [...new Set(rows.map((r) => String(r.user)))];
    const users = await User.find({ _id: { $in: userIds } })
      .select('fullName username')
      .lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));

    const winners = rows.map((r) => {
      const u = byId.get(String(r.user));
      const raw = (u?.fullName && String(u.fullName).trim()) || (u?.username && String(u.username).trim()) || '';
      const displayName = raw || 'Player';
      return {
        id: String(r._id),
        displayName,
        game: GAMES_WALLET_GAME_LABELS[r.gameId] || r.gameId,
        amount: r.amount,
        createdAt: r.createdAt,
      };
    });

    res.json({ winners });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get user settings (margin, exposure, RMS)
router.get('/settings', protectUser, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('userId marginSettings rmsSettings settings segmentPermissions segmentExplicitKeys hierarchyPath admin')
      .populate({ path: 'admin', select: 'segmentPermissions segmentExplicitKeys' })
      .lean();

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Attach parent admin's segment permissions to user for hierarchy inheritance
    if (user.admin?.segmentPermissions) {
      user.parentSegmentPermissions = user.admin.segmentPermissions;
      console.log('[user/settings] Attached parentSegmentPermissions for user:', user.userId);
    }

    // Default segment settings for all Market Watch segments (fills gaps for trading UI)
    const defaultSegment = {
      enabled: false,
      maxExchangeLots: 100,
      commissionType: 'PER_LOT',
      commissionLot: 0,
      maxLots: 50,
      minLots: 1,
      orderLots: 10,
      exposureIntraday: 1,
      exposureCarryForward: 1,
      allowClientIntradayOnly: true,
      defaultIntradayOnly: false,
      /** Admin-only: false = block LIMIT / SL pending orders for this segment (inherits to users under hierarchy). */
      allowLimitPendingOrders: true,
      cryptoSpreadInr: 0,
      cryptoSpreadUsdPerSide: 0,
      cryptoStartTime: '',
      cryptoClosingTime: '',
      mcxStartTime: '',
      mcxClosingTime: '',
      nseStartTime: '',
      nseClosingTime: '',
      closingTime: '',
      cryptoReferenceSymbol: '',
      cryptoPricePerLotInr: 0,
      cryptoLotSizeLots: 1,
      cryptoLotSizeQuantity: 0,
      optionBuy: {
        allowed: true,
        commissionType: 'PER_LOT',
        commission: 0,
        strikeSelection: 50,
        maxExchangeLots: 100,
      },
      optionSell: {
        allowed: true,
        commissionType: 'PER_LOT',
        commission: 0,
        strikeSelection: 50,
        maxExchangeLots: 100,
      },
    };

    const allSegments = [
      'NSEFUT',
      'NSEOPT',
      'MCXFUT',
      'MCXOPT',
      'NSE-EQ',
      'BSE-FUT',
      'BSE-OPT',
      'FOREXFUT',
      'FOREXOPT',
      'CRYPTOFUT',
      'CRYPTOOPT',
    ];

    const segmentPermissions = {};

    let adminSegmentDefaultsPlain = {};
    try {
      const sysLean = await SystemSettings.findOne({ settingsType: 'global' })
        .select('adminSegmentDefaults')
        .lean();
      adminSegmentDefaultsPlain = plainSegmentDefaultsMap(sysLean?.adminSegmentDefaults || {});
    } catch {
      adminSegmentDefaultsPlain = {};
    }

    for (const segment of allSegments) {
      let merged = await TradeService.getUserSegmentSettings(
        user,
        segment,
        inferInstrumentTypeForUserSettingsSegment(segment)
      );
      merged = { ...defaultSegment, ...merged };

      if (CRYPTO_SPREAD_SEGMENT_CHAIN.includes(segment)) {
        const chainUsd = pickPositiveCryptoSpreadUsdFromDefaults(adminSegmentDefaultsPlain);
        const chainInr = pickPositiveCryptoSpreadInrFromDefaults(adminSegmentDefaultsPlain);
        if (!(Number(merged.cryptoSpreadUsdPerSide) > 0) && chainUsd > 0) {
          merged = { ...merged, cryptoSpreadUsdPerSide: chainUsd };
        }
        if (!(Number(merged.cryptoSpreadInr) > 0) && chainInr > 0) {
          merged = { ...merged, cryptoSpreadInr: chainInr };
        }
      }

      const fromAdminDefaults = adminSegmentDefaultsPlain[segment] || {};
      const bu = Number(fromAdminDefaults.cryptoSpreadUsdPerSide);
      const mu = Number(merged.cryptoSpreadUsdPerSide);
      if (!(mu > 0) && bu > 0) merged = { ...merged, cryptoSpreadUsdPerSide: bu };
      const bi = Number(fromAdminDefaults.cryptoSpreadInr);
      const mi = Number(merged.cryptoSpreadInr);
      if (!(mi > 0) && bi > 0) merged = { ...merged, cryptoSpreadInr: bi };

      segmentPermissions[segment] = merged;
      console.log(`[user/settings] Segment ${segment} merged:`, {
        enabled: merged.enabled,
        cryptoStartTime: merged.cryptoStartTime,
        cryptoClosingTime: merged.cryptoClosingTime,
        mcxStartTime: merged.mcxStartTime,
        mcxClosingTime: merged.mcxClosingTime,
        commission: merged.commission
      });
    }

    // Ensure MCX session timing reaches user UI even if populate/merge missed parent admin slice
    try {
      const { resolveMcxTimingFromAdminChain } = await import('../utils/mcxSessionTiming.js');
      const chainMcx = await resolveMcxTimingFromAdminChain(user);
      for (const mcxSeg of ['MCXFUT', 'MCXOPT']) {
        if (!segmentPermissions[mcxSeg]) continue;
        if (chainMcx.mcxStartTime) segmentPermissions[mcxSeg].mcxStartTime = chainMcx.mcxStartTime;
        if (chainMcx.mcxClosingTime) {
          segmentPermissions[mcxSeg].mcxClosingTime = chainMcx.mcxClosingTime;
          segmentPermissions[mcxSeg].closingTime = chainMcx.mcxClosingTime;
        }
      }
    } catch (mcxOverlayErr) {
      console.warn('[user/settings] MCX timing overlay failed:', mcxOverlayErr?.message);
    }

    try {
      const { resolveNseBseTimingFromAdminChain } = await import('../utils/nseBseSessionTiming.js');
      const chainNse = await resolveNseBseTimingFromAdminChain(user);
      for (const nseSeg of ['NSEFUT', 'NSEOPT', 'NSE-EQ', 'BSE-FUT', 'BSE-OPT']) {
        if (!segmentPermissions[nseSeg]) continue;
        if (chainNse.nseStartTime) segmentPermissions[nseSeg].nseStartTime = chainNse.nseStartTime;
        if (chainNse.nseClosingTime) {
          segmentPermissions[nseSeg].nseClosingTime = chainNse.nseClosingTime;
          if (!String(segmentPermissions[nseSeg].closingTime || '').trim()) {
            segmentPermissions[nseSeg].closingTime = chainNse.nseClosingTime;
          }
        }
      }
    } catch (nseOverlayErr) {
      console.warn('[user/settings] NSE/BSE timing overlay failed:', nseOverlayErr?.message);
    }

    console.log('[user/settings] Final segmentPermissions keys:', Object.keys(segmentPermissions));
    console.log('[user/settings] CRYPTOFUT settings:', segmentPermissions.CRYPTOFUT);
    console.log('[user/settings] MCXFUT settings:', segmentPermissions.MCXFUT);

    res.json({
      marginSettings: user.marginSettings || {},
      rmsSettings: user.rmsSettings || {},
      settings: user.settings || {},
      segmentPermissions,
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Update profile
router.put('/profile', protectUser, async (req, res) => {
  try {
    const { fullName, phone } = req.body;
    
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Update allowed fields
    if (fullName) user.fullName = fullName;
    if (phone) user.phone = phone;
    
    await user.save();
    
    res.json({
      message: 'Profile updated successfully',
      user: {
        _id: user._id,
        userId: user.userId,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Change password
router.post('/change-password', protectUser, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: 'Please provide old and new password' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }
    
    const user = await User.findById(req.user._id).select('+password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Check if old password matches
    const isMatch = await user.comparePassword(oldPassword);
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }
    
    // Update password
    user.password = newPassword;
    await user.save();
    
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: error.message });
  }
});

// ==================== NOTIFICATIONS ====================

// Get user notifications
router.get('/notifications', protectUser, async (req, res) => {
  try {
    const userId = req.user._id;
    const userAdminCode = req.user.adminCode;
    
    // Find notifications targeted to this user
    const notifications = await Notification.find({
      isActive: true,
      $or: [
        { targetType: 'ALL_USERS' },
        { targetType: 'ALL_ADMINS_USERS' },
        { targetType: 'SINGLE_USER', targetUserId: userId },
        { targetType: 'SELECTED_USERS', targetUserIds: userId },
        { targetType: 'ADMIN_USERS', targetAdminCode: userAdminCode }
      ]
    }).sort({ createdAt: -1 }).limit(50);
    
    // Format notifications with read status
    const formattedNotifications = notifications.map(notif => {
      const readEntry = notif.readBy.find(r => r.userId.toString() === userId.toString());
      return {
        _id: notif._id,
        title: notif.title,
        subject: notif.subject,
        message: notif.description,
        image: notif.image,
        isRead: !!readEntry,
        readAt: readEntry?.readAt,
        createdAt: notif.createdAt
      };
    });
    
    const unreadCount = formattedNotifications.filter(n => !n.isRead).length;
    
    res.json({
      notifications: formattedNotifications,
      unreadCount,
      total: formattedNotifications.length
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ message: error.message });
  }
});

// Mark notification as read
router.put('/notifications/:id/read', protectUser, async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);
    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    
    // Check if already read
    const alreadyRead = notification.readBy.some(r => r.userId.toString() === req.user._id.toString());
    if (!alreadyRead) {
      notification.readBy.push({ userId: req.user._id, readAt: new Date() });
      await notification.save();
    }
    
    res.json({ message: 'Marked as read' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Mark all notifications as read
router.put('/notifications/read-all', protectUser, async (req, res) => {
  try {
    const userId = req.user._id;
    const userAdminCode = req.user.adminCode;
    
    // Find all unread notifications for this user
    const notifications = await Notification.find({
      isActive: true,
      'readBy.userId': { $ne: userId },
      $or: [
        { targetType: 'ALL_USERS' },
        { targetType: 'ALL_ADMINS_USERS' },
        { targetType: 'SINGLE_USER', targetUserId: userId },
        { targetType: 'SELECTED_USERS', targetUserIds: userId },
        { targetType: 'ADMIN_USERS', targetAdminCode: userAdminCode }
      ]
    });
    
    // Mark all as read
    for (const notif of notifications) {
      notif.readBy.push({ userId, readAt: new Date() });
      await notif.save();
    }
    
    res.json({ message: 'All notifications marked as read', count: notifications.length });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==================== BROKER CHANGE REQUEST ROUTES ====================

// Get available brokers/admins for transfer request
// Only returns brokers under the same parent ADMIN
router.get('/available-brokers', protectUser, async (req, res) => {
  try {
    const currentAdminCode = req.user.adminCode;
    
    // Get current admin
    const currentAdmin = await Admin.findOne({ adminCode: currentAdminCode });
    if (!currentAdmin) {
      return res.status(400).json({ message: 'Current admin not found' });
    }
    
    // Find the parent ADMIN of current admin
    let parentAdminId = null;
    if (currentAdmin.role === 'ADMIN') {
      parentAdminId = currentAdmin._id;
    } else if (currentAdmin.role === 'SUPER_ADMIN') {
      // If under SuperAdmin, show all admins
      parentAdminId = null;
    } else {
      // Find ADMIN in hierarchy path
      const parentAdmin = await Admin.findOne({
        _id: { $in: currentAdmin.hierarchyPath || [] },
        role: 'ADMIN'
      });
      parentAdminId = parentAdmin?._id;
    }
    
    let query = {
      status: 'ACTIVE',
      role: { $in: ['ADMIN', 'BROKER', 'SUB_BROKER'] },
      adminCode: { $ne: currentAdminCode }
    };
    
    // If there's a parent ADMIN, only show brokers under that admin
    if (parentAdminId) {
      query.$or = [
        { _id: parentAdminId }, // The parent admin itself
        { hierarchyPath: parentAdminId } // All admins under the parent
      ];
    }
    
    const admins = await Admin.find(query)
      .select('name username adminCode role')
      .sort({ role: 1, name: 1 });
    
    // Return simple broker info without hierarchy
    const simpleAdmins = admins.map(admin => ({
      _id: admin._id,
      adminCode: admin.adminCode,
      name: admin.name || admin.username || admin.adminCode,
      username: admin.username,
      role: admin.role
    }));
    
    res.json(simpleAdmins);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get user's broker change requests
router.get('/broker-change-requests', protectUser, async (req, res) => {
  try {
    const requests = await BrokerChangeRequest.find({ user: req.user._id })
      .populate('currentAdmin', 'name username adminCode role')
      .populate('requestedAdmin', 'name username adminCode role')
      .populate('processedBy', 'name username')
      .sort({ createdAt: -1 });
    
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create broker change request
router.post('/broker-change-request', protectUser, async (req, res) => {
  try {
    const { requestedAdminCode, reason } = req.body;
    
    if (!requestedAdminCode) {
      return res.status(400).json({ message: 'Please select a broker/admin to transfer to' });
    }
    
    // Check if user already has a pending request
    const existingRequest = await BrokerChangeRequest.findOne({
      user: req.user._id,
      status: 'PENDING'
    });
    
    if (existingRequest) {
      return res.status(400).json({ message: 'You already have a pending broker change request' });
    }
    
    // Get current admin
    const currentAdmin = await Admin.findOne({ adminCode: req.user.adminCode });
    if (!currentAdmin) {
      return res.status(400).json({ message: 'Current admin not found' });
    }
    
    // Get requested admin
    const requestedAdmin = await Admin.findOne({ 
      adminCode: requestedAdminCode.trim().toUpperCase(),
      status: 'ACTIVE'
    });
    
    if (!requestedAdmin) {
      return res.status(400).json({ message: 'Invalid or inactive broker/admin code' });
    }
    
    if (requestedAdmin.adminCode === req.user.adminCode) {
      return res.status(400).json({ message: 'You are already under this broker/admin' });
    }
    
    // Find the parent admin (ADMIN role) of current admin
    // If current admin is ADMIN, they are the parent
    // If current admin is BROKER or SUB_BROKER, find their parent ADMIN
    let parentAdminId = null;
    if (currentAdmin.role === 'ADMIN') {
      parentAdminId = currentAdmin._id;
    } else {
      // Find ADMIN in hierarchy path
      const parentAdmin = await Admin.findOne({
        _id: { $in: currentAdmin.hierarchyPath || [] },
        role: 'ADMIN'
      });
      parentAdminId = parentAdmin?._id;
    }
    
    // Check if requested admin is under the same parent ADMIN
    let requestedParentAdminId = null;
    if (requestedAdmin.role === 'ADMIN') {
      requestedParentAdminId = requestedAdmin._id;
    } else {
      const requestedParentAdmin = await Admin.findOne({
        _id: { $in: requestedAdmin.hierarchyPath || [] },
        role: 'ADMIN'
      });
      requestedParentAdminId = requestedParentAdmin?._id;
    }
    
    // Validate: both must be under the same parent ADMIN (or both are ADMINs under SuperAdmin)
    if (parentAdminId && requestedParentAdminId) {
      if (parentAdminId.toString() !== requestedParentAdminId.toString()) {
        return res.status(400).json({ 
          message: 'You can only change to a broker under the same parent admin' 
        });
      }
    }
    
    // Create the request - will be reviewed by parent ADMIN or SUPER_ADMIN
    const request = await BrokerChangeRequest.create({
      user: req.user._id,
      userId: req.user.userId,
      currentAdminCode: req.user.adminCode,
      currentAdmin: currentAdmin._id,
      requestedAdminCode: requestedAdmin.adminCode,
      requestedAdmin: requestedAdmin._id,
      reason: reason || '',
      parentAdmin: parentAdminId // Track which admin should approve
    });
    
    await request.populate([
      { path: 'currentAdmin', select: 'name username adminCode role' },
      { path: 'requestedAdmin', select: 'name username adminCode role' }
    ]);
    
    res.status(201).json({
      message: 'Broker change request submitted successfully. It will be reviewed by your admin.',
      request
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Cancel broker change request
router.delete('/broker-change-request/:id', protectUser, async (req, res) => {
  try {
    const request = await BrokerChangeRequest.findOne({
      _id: req.params.id,
      user: req.user._id,
      status: 'PENDING'
    });
    
    if (!request) {
      return res.status(404).json({ message: 'Request not found or already processed' });
    }
    
    await BrokerChangeRequest.deleteOne({ _id: request._id });
    
    res.json({ message: 'Request cancelled successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==================== DEMO ACCOUNT ROUTES ====================

// Get available brokers for demo user to select when converting
router.get('/demo/available-brokers', protectUser, async (req, res) => {
  try {
    if (!req.user.isDemo) {
      return res.status(400).json({ message: 'This is not a demo account' });
    }
    
    // Get all active admins/brokers/sub-brokers with parent info
    const admins = await Admin.find({
      status: 'ACTIVE',
      role: { $in: ['ADMIN', 'BROKER', 'SUB_BROKER'] }
    })
    .select('name username adminCode role parentId cityCode cityName certificate.rating certificate.yearsOfExperience')
    .populate('parentId', 'adminCode username')
    .sort({ role: 1, name: 1 });
    
    // Add parent code for sub-brokers
    const brokersWithParentCode = admins.map(admin => ({
      _id: admin._id,
      name: admin.name,
      username: admin.username,
      adminCode: admin.adminCode,
      role: admin.role,
      parentCode: admin.parentId?.adminCode || null,
      cityCode: admin.cityCode || '',
      cityName: admin.cityName || '',
      rating: admin.certificate?.rating || 5,
      yearsOfExperience: admin.certificate?.yearsOfExperience || 0
    }));
    
    res.json(brokersWithParentCode);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Convert demo account to real account
router.post('/demo/convert-to-real', protectUser, async (req, res) => {
  try {
    const { selectedBrokerCode } = req.body;
    const user = await User.findById(req.user._id);
    
    if (!user.isDemo) {
      return res.status(400).json({ message: 'This is not a demo account' });
    }
    
    // Find the admin to assign to
    let admin;
    if (selectedBrokerCode) {
      admin = await Admin.findOne({ adminCode: selectedBrokerCode.trim().toUpperCase() });
      // If not found by adminCode, try searching by username
      if (!admin) {
        admin = await Admin.findOne({ username: selectedBrokerCode.trim().toLowerCase() });
      }
      if (!admin) {
        return res.status(400).json({ message: 'Invalid broker code' });
      }
    } else {
      // Default to Super Admin if no broker selected
      admin = await Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' });
      if (!admin) {
        return res.status(400).json({ message: 'System not configured. Please contact support.' });
      }
    }
    
    // Build hierarchy path
    let hierarchyPath = [];
    if (admin.hierarchyPath && admin.hierarchyPath.length > 0) {
      hierarchyPath = [...admin.hierarchyPath, admin._id];
    } else {
      hierarchyPath = [admin._id];
    }
    
    // Clear demo data and convert to real account
    // Reset all wallets to zero
    user.wallet = {
      balance: 0,
      cashBalance: 0,
      tradingBalance: 0,
      usedMargin: 0,
      collateralValue: 0,
      realizedPnL: 0,
      unrealizedPnL: 0,
      todayRealizedPnL: 0,
      todayUnrealizedPnL: 0,
      transactions: []
    };
    
    user.cryptoWallet = {
      balance: 0,
      realizedPnL: 0,
      unrealizedPnL: 0,
      todayRealizedPnL: 0
    };
    
    user.forexWallet = {
      balance: 0,
      usedMargin: 0,
      realizedPnL: 0,
      unrealizedPnL: 0,
      todayRealizedPnL: 0,
      todayUnrealizedPnL: 0
    };
    
    user.mcxWallet = {
      balance: 0,
      usedMargin: 0,
      realizedPnL: 0,
      unrealizedPnL: 0,
      todayRealizedPnL: 0,
      todayUnrealizedPnL: 0
    };
    
    user.gamesWallet = {
      balance: 0,
      usedMargin: 0,
      realizedPnL: 0,
      unrealizedPnL: 0,
      todayRealizedPnL: 0,
      todayUnrealizedPnL: 0
    };
    
    // Update user to real account
    user.isDemo = false;
    user.demoExpiresAt = null;
    user.demoCreatedAt = null;
    user.convertedToRealAt = new Date();
    
    // Safely update settings if it exists
    if (user.settings) {
      user.settings.isDemo = false;
    }
    
    user.admin = admin._id;
    user.adminCode = admin.adminCode;
    user.hierarchyPath = hierarchyPath;
    user.creatorRole = admin.role;
    
    await user.save();
    
    // Update admin stats
    admin.stats.totalUsers = (admin.stats.totalUsers || 0) + 1;
    admin.stats.activeUsers = (admin.stats.activeUsers || 0) + 1;
    await admin.save();
    
    // Delete all trading history for this user (positions, trades)
    const Position = (await import('../models/Position.js')).default;
    const Trade = (await import('../models/Trade.js')).default;
    const WalletLedger = (await import('../models/WalletLedger.js')).default;
    const FundRequest = (await import('../models/FundRequest.js')).default;
    
    await Position.deleteMany({ user: user._id });
    await Trade.deleteMany({ user: user._id });
    await Trade.deleteMany({ userId: user._id });
    
    // Delete wallet ledger entries
    await WalletLedger.deleteMany({ ownerId: user._id, ownerType: 'USER' });
    
    // Delete fund requests
    await FundRequest.deleteMany({ user: user._id });
    
    // Delete all game-related data
    const GameResult = (await import('../models/GameResult.js')).default;
    const GamesWalletLedger = (await import('../models/GamesWalletLedger.js')).default;
    const NiftyJackpotBid = (await import('../models/NiftyJackpotBid.js')).default;
    const NiftyBracketTrade = (await import('../models/NiftyBracketTrade.js')).default;
    const NiftyNumberBet = (await import('../models/NiftyNumberBet.js')).default;
    
    // Delete game bids/tickets
    await NiftyJackpotBid.deleteMany({ userId: user._id });
    await NiftyBracketTrade.deleteMany({ userId: user._id });
    await NiftyNumberBet.deleteMany({ userId: user._id });
    
    // Delete games wallet ledger entries
    await GamesWalletLedger.deleteMany({ userId: user._id });
    
    // Delete game results (if any user-specific results exist)
    await GameResult.deleteMany({ userId: user._id });
    
    res.json({
      message: 'Account converted to real account successfully!',
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        isDemo: false,
        adminCode: user.adminCode,
        wallet: user.wallet
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get demo account info
router.get('/demo/info', protectUser, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (!user.isDemo) {
      return res.status(400).json({ message: 'This is not a demo account', isDemo: false });
    }
    
    const now = new Date();
    const expiresAt = new Date(user.demoExpiresAt);
    const daysRemaining = Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)));
    const { trialDays } = await getDemoAccountSettings();
    
    res.json({
      isDemo: true,
      demoExpiresAt: user.demoExpiresAt,
      demoCreatedAt: user.demoCreatedAt,
      trialDays,
      daysRemaining,
      demoBalance: user.wallet.balance || user.wallet.cashBalance,
      noBrokerageDistribution: true,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PUBLIC: Get phone verification settings (no auth required for signup flow)
router.get('/phone-verification-settings', async (req, res) => {
  try {
    const settings = await GameSettings.getSettings();
    const settingsObj = settings.toObject();
    
    res.json({
      enabled: settingsObj.phoneVerification?.enabled !== false,
      requireForRegistration: settingsObj.phoneVerification?.requireForRegistration !== false
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PUBLIC: Get game settings for frontend (user-facing)
router.get('/game-settings', protectUser, async (req, res) => {
  try {
    const settings = await GameSettings.getSettings();
    const settingsObj = settings.toObject();

    // Return only what the frontend needs (no internal/admin fields)
    const games = {};
    if (settingsObj.games) {
      for (const [key, game] of Object.entries(settingsObj.games)) {
        games[key] = {
          enabled: game.enabled,
          name: game.name,
          description: game.description,
          winMultiplier: game.winMultiplier,
          brokeragePercent: game.brokeragePercent,
          minTickets: game.minTickets,
          maxTickets: game.maxTickets,
          maxTicketsUpPerWindow: Math.max(0, Number(game.maxTicketsUpPerWindow) || 0),
          maxTicketsDownPerWindow: Math.max(0, Number(game.maxTicketsDownPerWindow) || 0),
          maxTicketsBuyPerDay: Math.max(0, Number(game.maxTicketsBuyPerDay) || 0),
          maxTicketsSellPerDay: Math.max(0, Number(game.maxTicketsSellPerDay) || 0),
          roundDuration: game.roundDuration,
          cooldownBetweenRounds: game.cooldownBetweenRounds,
          startTime: game.startTime,
          endTime: game.endTime,
          // Per-game ticket price (normalize number; Mongoose may return string from JSON)
          ...(Number.isFinite(Number(game.ticketPrice)) && { ticketPrice: Number(game.ticketPrice) }),
          // Nifty Number specific
          ...(game.fixedProfit !== undefined && { fixedProfit: game.fixedProfit }),
          ...(game.resultTime !== undefined && key !== 'btcJackpot' && { resultTime: game.resultTime }),
          ...(game.betsPerDay !== undefined && { betsPerDay: game.betsPerDay }),
          ...(game.biddingStartTime !== undefined && { biddingStartTime: game.biddingStartTime }),
          ...(game.biddingEndTime !== undefined && { biddingEndTime: game.biddingEndTime }),
          // Nifty Bracket specific
          ...(game.bracketGap !== undefined && { bracketGap: game.bracketGap }),
          ...(game.bracketGapType !== undefined && { bracketGapType: game.bracketGapType }),
          ...(game.bracketGapPercent !== undefined && { bracketGapPercent: game.bracketGapPercent }),
          ...(game.expiryMinutes !== undefined && { expiryMinutes: game.expiryMinutes }),
          ...(key === 'niftyBracket' && {
            resultTime:
              game.resultTime != null && String(game.resultTime).trim() !== ''
                ? game.resultTime
                : '15:31',
            settleAtResultTime: game.settleAtResultTime !== false,
            ...(game.bracketAnchorToSpot !== undefined && { bracketAnchorToSpot: game.bracketAnchorToSpot }),
            ...(game.bracketStrictLtpComparison !== undefined && {
              bracketStrictLtpComparison: game.bracketStrictLtpComparison,
            }),
          }),
          // Nifty Jackpot specific
          ...(game.topWinners !== undefined && { topWinners: game.topWinners }),
          ...(game.firstPrize !== undefined && { firstPrize: game.firstPrize }),
          ...(game.prizeStep !== undefined && { prizeStep: game.prizeStep }),
          ...(game.bidsPerDay !== undefined && { bidsPerDay: game.bidsPerDay }),
          ...(game.biddingStartTime !== undefined && { biddingStartTime: game.biddingStartTime }),
          ...(game.biddingEndTime !== undefined && { biddingEndTime: game.biddingEndTime }),
          ...(game.prizePercentages != null && { prizePercentages: game.prizePercentages }),
          ...(game.brokerageDistribution != null && { brokerageDistribution: game.brokerageDistribution }),
          ...(key === 'niftyJackpot' && {
            resultTime:
              game.resultTime != null && String(game.resultTime).trim() !== ''
                ? game.resultTime
                : '15:45',
            ...(game.maxTicketsPerRequest !== undefined && {
              maxTicketsPerRequest: game.maxTicketsPerRequest,
            }),
            ...(game.grossPrizeSubBrokerPercent !== undefined && {
              grossPrizeSubBrokerPercent: game.grossPrizeSubBrokerPercent,
            }),
            ...(game.grossPrizeBrokerPercent !== undefined && {
              grossPrizeBrokerPercent: game.grossPrizeBrokerPercent,
            }),
            ...(game.grossPrizeAdminPercent !== undefined && {
              grossPrizeAdminPercent: game.grossPrizeAdminPercent,
            }),
          }),
          ...(key === 'niftyNumber' && {
            resultTime:
              game.resultTime != null && String(game.resultTime).trim() !== ''
                ? game.resultTime
                : '15:45',
            ...(game.grossPrizeSubBrokerPercent !== undefined && {
              grossPrizeSubBrokerPercent: game.grossPrizeSubBrokerPercent,
            }),
            ...(game.grossPrizeBrokerPercent !== undefined && {
              grossPrizeBrokerPercent: game.grossPrizeBrokerPercent,
            }),
            ...(game.grossPrizeAdminPercent !== undefined && {
              grossPrizeAdminPercent: game.grossPrizeAdminPercent,
            }),
          }),
        };
      }
    }

    res.json({
      gamesEnabled: settingsObj.gamesEnabled,
      maintenanceMode: settingsObj.maintenanceMode,
      maintenanceMessage: settingsObj.maintenanceMessage,
      tokenValue: settingsObj.tokenValue || 300,
      gamePositionExpiryGraceSeconds:
        Number.isFinite(Number(settingsObj.gamePositionExpiryGraceSeconds))
          ? Number(settingsObj.gamePositionExpiryGraceSeconds)
          : 3600,
      games,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==================== UP/DOWN GAME (Nifty & BTC) ====================

/** Normalize client booleans (JSON / form quirks). */
function parseClientBool(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(s)) return true;
    if (['false', '0', 'no'].includes(s)) return false;
  }
  return null;
}

// Place an Up/Down bet (debit gamesWallet)
router.post('/game-bet/place', protectUser, async (req, res) => {
  try {
    const { gameId, prediction, amount, entryPrice, windowNumber, transactionId } = req.body;
    const userId = req.user._id;
    const user = req.user;

    if (!['UP', 'DOWN'].includes(prediction)) {
      return res.status(400).json({ message: 'Prediction must be UP or DOWN' });
    }

    // Map gameId to settings key
    const settingsKey = gameId === 'btcupdown' ? 'btcUpDown' : 'niftyUpDown';
    const settings = await GameSettings.getSettings();
    const gameConfig = settings.games?.[settingsKey];
    if (!gameConfig?.enabled) {
      return res.status(400).json({ message: 'This game is currently disabled' });
    }

    if (await rejectIfHierarchyGameDenied(res, userId, settingsKey)) return;

    const betAmount = parseFloat(amount);
    if (isNaN(betAmount) || betAmount <= 0) {
      return res.status(400).json({ message: 'Invalid bet amount' });
    }
    const tValue = settings.tokenValue || 300;
    const minAmt = (gameConfig.minTickets || 1) * tValue;
    const maxAmt = (gameConfig.maxTickets || 500) * tValue;
    if (betAmount < minAmt) {
      return res.status(400).json({ message: `Minimum bet is ${gameConfig.minTickets || 1} ticket(s) (${minAmt})` });
    }
    if (betAmount > maxAmt) {
      return res.status(400).json({ message: `Maximum bet is ${gameConfig.maxTickets || 500} ticket(s) (${maxAmt})` });
    }

    const settlementDayPlace = getTodayISTString();
    const wnPlace = Number(windowNumber);
    if (!Number.isFinite(wnPlace) || wnPlace < 1) {
      return res.status(400).json({ message: 'Invalid window number' });
    }

    // BTC Up/Down rule (per game instructions): the official result is published 15 minutes AFTER
    // the trading window ends. So a bet placed during window W (e.g. #38, 09:15–09:30) is decided
    // by the GameResult row for window W+1 (published at 09:45 = close@09:45 vs close@09:30).
    // We tag the bet's stored windowNumber with that "settlement window" so the existing auto-settle
    // loop, manual-settle, and /game-bet/resolve match it naturally at the correct IST second.
    // Nifty keeps the original placement window (its result flow already aligns with wnPlace).
    const wnSettle = gameId === 'btcupdown' ? wnPlace + 1 : wnPlace;

    // Guard: BTC's last betting window of the IST session has no +1 result window in the same day
    // (e.g. endSec=24:00 → maxW=96; W=96 bets would need W=97 which never materialises). Reject to
    // avoid stuck debits that can't auto-settle.
    if (gameId === 'btcupdown') {
      const maxW = getBtcMaxWindowForSession(gameConfig);
      if (Number.isFinite(maxW) && maxW > 0 && wnSettle > maxW) {
        return res.status(400).json({
          message:
            'BTC Up/Down: betting is closed for the final 15-minute slot of the IST session (no result window available to settle).',
        });
      }
    }

    const capUp = Math.max(0, Number(gameConfig.maxTicketsUpPerWindow) || 0);
    const capDown = Math.max(0, Number(gameConfig.maxTicketsDownPerWindow) || 0);
    const sideCap = prediction === 'UP' ? capUp : capDown;
    if (sideCap > 0) {
      const usedSide = await sumUpDownSideTicketsInWindow(
        userId,
        gameId,
        wnSettle,
        prediction,
        settlementDayPlace
      );
      const newTicketUnits = betAmount / tValue;
      if (usedSide + newTicketUnits > sideCap + 1e-6) {
        const left = Math.max(0, sideCap - usedSide);
        return res.status(400).json({
          message: `Max ${sideCap} ticket(s) on ${prediction} for this window (${usedSide.toFixed(2)} already used, ~${left.toFixed(2)} remaining).`,
        });
      }
    }

    if (gameId === 'btcupdown') {
      const nowSec = currentTotalSecondsIST();
      const v = validateBtcUpDownBetPlacement(gameConfig, nowSec, wnPlace);
      if (!v.ok) {
        return res.status(400).json({ message: v.message });
      }
    }

    if (gameId === 'updown') {
      const nowSecN = currentTotalSecondsIST();
      const vN = validateNiftyUpDownBetPlacement(gameConfig, nowSecN, wnPlace);
      if (!vN.ok) {
        return res.status(400).json({ message: vN.message });
      }
    }

    // Ensure gamesWallet exists for demo accounts (legacy compatibility)
    const userDoc = await User.findById(userId);
    if (!userDoc.gamesWallet) {
      await User.findByIdAndUpdate(userId, {
        gamesWallet: {
          balance: userDoc.isDemo ? 1000000 : 0,
          usedMargin: 0,
          realizedPnL: 0,
          unrealizedPnL: 0,
          todayRealizedPnL: 0,
          todayUnrealizedPnL: 0
        }
      });
    }

    // Atomic debit — balance check + deduction in one MongoDB op (race-safe)
    const gw = await atomicGamesWalletDebit(User, userId, betAmount, { usedMargin: betAmount });
    if (!gw) {
      return res.status(400).json({ message: 'Insufficient balance in games wallet' });
    }

    // Create or find transaction slip
    let slip, currentTransactionId;
    if (transactionId) {
      // Use existing transaction ID (multiple bets in same session)
      slip = await findTransactionSlipByTransactionId(transactionId);
      currentTransactionId = transactionId;
    }
    
    if (!slip) {
      // Create new transaction slip
      const slipResult = await createTransactionSlip(
        userId, 
        [gameId], 
        betAmount, 
        { totalBets: 1 }
      );
      slip = slipResult.slip;
      currentTransactionId = slipResult.transactionId;
    } else {
      // Update existing slip with new bet
      slip.gameIds = [...new Set([...slip.gameIds, gameId])];
      slip.totalDebitAmount += betAmount;
      slip.metadata.totalBets += 1;
      await slip.save();
    }

    // Record in games wallet ledger
    const ledgerEntry = await recordGamesWalletLedger(userId, {
      gameId,
      entryType: 'debit',
      amount: betAmount,
      balanceAfter: gw.balance,
      description: `${gameId === 'btcupdown' ? 'BTC' : 'Nifty'} Up/Down — bet (${prediction})`,
      meta: {
        prediction,
        windowNumber: wnSettle,
        placementWindowNumber: wnPlace,
        entryPrice,
        tickets: parseFloat((betAmount / tValue).toFixed(2)),
        tokenValue: tValue,
        settlementDay: settlementDayPlace,
        transactionId: currentTransactionId,
      },
    });

    // Add debit entry to transaction slip
    const userCode = user.userCode || user.username || userId.toString();
    await addDebitEntry(
      slip._id,
      currentTransactionId,
      gameId,
      betAmount,
      userId,
      userCode,
      {
        prediction,
        windowNumber: wnSettle,
        placementWindowNumber: wnPlace,
        entryPrice,
        tickets: parseFloat((betAmount / tValue).toFixed(2)),
        tokenValue: tValue,
        settlementDay: settlementDayPlace,
        relatedLedgerId: ledgerEntry?._id
      }
    );

    // BTC Up/Down: stake enters Super Admin pool (no hierarchy split at bet time).
    if (gameId === 'btcupdown') {
      try {
        await creditBtcUpDownSuperAdminPool(
          betAmount,
          `BTC Up/Down — stake to Super Admin pool (bet ${prediction})`
        );
      } catch (poolErr) {
        console.error('[BTC Up/Down] Super Admin pool credit failed, refunding user:', poolErr);
        const gwRef = await atomicGamesWalletUpdate(User, userId, {
          balance: betAmount,
          usedMargin: -betAmount,
        });
        await recordGamesWalletLedger(userId, {
          gameId: 'btcupdown',
          entryType: 'credit',
          amount: betAmount,
          balanceAfter: gwRef.balance,
          description: 'BTC Up/Down — bet reversed (house pool unavailable)',
          meta: { prediction, windowNumber: wnSettle, placementWindowNumber: wnPlace },
        });
        return res.status(503).json({
          message: 'House pool temporarily unavailable; your stake was refunded. Try again later.',
        });
      }
    }

    res.json({
      message: 'Bet placed!',
      betId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      transactionId: currentTransactionId,
      newBalance: gw.balance,
      settlementDay: settlementDayPlace,
    });
  } catch (error) {
    console.error('Game bet place error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get recent game results for Up/Down games
router.get('/game-results/:gameId', protectUser, async (req, res) => {
  try {
    const { gameId } = req.params;
    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 200)) : 20;
    
    if (!['updown', 'btcupdown'].includes(gameId)) {
      return res.status(400).json({ message: 'Invalid game ID' });
    }

    const rawDay = req.query.day;
    const day =
      typeof rawDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDay.trim())
        ? rawDay.trim()
        : getTodayISTString();
    const dayStart = startOfISTDayFromKey(day);
    const dayEnd = endOfISTDayFromKey(day);
    if (!dayStart || !dayEnd) {
      return res.status(400).json({ message: 'Invalid day' });
    }

    const includePrevious =
      req.query.includePrevious === '1' || String(req.query.includePrevious).toLowerCase() === 'true';

    let results;
    if (gameId === 'btcupdown') {
      // Fire-and-forget nudge so the response returns immediately even if Binance is slow — the
      // single-flight guard inside autoSettleBtcUpDown deduplicates concurrent nudges across users
      // and the 5s fast loop. Client polls every 500ms so a fresh row (e.g. the just-closed :15
      // window) shows up on the very next fetch, no page refresh needed.
      if (day === getTodayISTString()) {
        GameSettings.getSettings()
          .then((gs) => autoSettleBtcUpDown(gs, Date.now()))
          .catch((e) => console.warn('[game-results] btcupdown settle nudge', e?.message || e));
      }
      // BTC: return every window for the IST day (no limit). A descending limit could drop
      // lower window #s when many rows exist, breaking W#70–73 + tracker after refresh.
      results = await GameResult.find({
        gameId: 'btcupdown',
        windowDate: { $gte: dayStart, $lt: dayEnd },
      })
        .sort({ windowNumber: 1 })
        .lean();
    } else {
      results = await GameResult.find({
        gameId,
        windowDate: { $gte: dayStart, $lt: dayEnd },
      })
        .sort({ windowNumber: -1 })
        .limit(limit)
        .lean();
    }

    if (results.length === 0 && includePrevious) {
      results = await GameResult.getRecentResultsWithFallback(gameId, gameId === 'btcupdown' ? 200 : limit);
    }

    res.json(results);
  } catch (error) {
    console.error('Error fetching game results:', error);
    res.status(500).json({ message: error.message });
  }
});

/** BTC window baseline prices from published GameResult (window open = openPrice). Legacy route name kept for clients. */
router.get('/btc-updown/window-ltps', protectUser, async (req, res) => {
  try {
    const rawDay = req.query.day;
    const day =
      typeof rawDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDay.trim())
        ? rawDay.trim()
        : getTodayISTString();
    const dayStart = startOfISTDayFromKey(day);
    const dayEnd = endOfISTDayFromKey(day);
    if (!dayStart || !dayEnd) {
      return res.status(400).json({ message: 'Invalid day' });
    }
    const rows = await GameResult.find({
      gameId: 'btcupdown',
      windowDate: { $gte: dayStart, $lt: dayEnd },
    })
      .select({ windowNumber: 1, openPrice: 1, closePrice: 1, resultTime: 1 })
      .sort({ windowNumber: 1 })
      .lean();
    const snapshots = rows.map((r) => ({
      windowNumber: r.windowNumber,
      price: r.openPrice,
      closePrice: r.closePrice,
      sampledAt: r.resultTime,
      source: 'game_result',
    }));
    res.json({ istDayKey: day, snapshots });
  } catch (error) {
    console.error('Error fetching BTC window reference snapshots:', error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * Window-open (15m "O" / baseline) for UI window #W — same as Zerodha 15m: first 1m open in the IST round, or
 * published GameResult.openPrice when that window has settled.
 */
router.get('/btc-updown/canonical-open/:windowNumber', protectUser, async (req, res) => {
  try {
    const W = parseInt(req.params.windowNumber, 10);
    if (!Number.isFinite(W) || W < 1) {
      return res.status(400).json({ message: 'Invalid window number' });
    }
    const rawDay = req.query.day;
    const day =
      typeof rawDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDay.trim())
        ? rawDay.trim()
        : getTodayISTString();
    const dayStart = startOfISTDayFromKey(day);
    const dayEnd = endOfISTDayFromKey(day);
    const refSec = btcOpenRefSecForUiWindow(W);
    const resSec = btcResultRefSecForUiWindow(W);

    if (dayStart && dayEnd) {
      const row = await GameResult.findOne({
        gameId: 'btcupdown',
        windowNumber: W,
        windowDate: { $gte: dayStart, $lt: dayEnd },
      })
        .select({ openPrice: 1, resultTime: 1 })
        .lean();
      const fromGr = Number(row?.openPrice);
      if (Number.isFinite(fromGr) && fromGr > 0) {
        return res.json({
          windowNumber: W,
          refSecIst: refSec,
          price: fromGr,
          source: 'game_result',
          sampledAt: row.resultTime || undefined,
        });
      }
    }

    let px = null;
    let source = null;
    let sampledAt = null;
    try {
      const w15 = await fetchBtcFifteenMinuteIstWindowOhlc(day, refSec, resSec);
      if (w15?.open && Number.isFinite(w15.open) && w15.open > 0) {
        px = w15.open;
        source = 'binance_15m_ist';
      }
      if (px == null) {
        const b = Number(await fetchBtcUsdt1mCloseAtIstRef(day, refSec));
        if (Number.isFinite(b) && b > 0) {
          px = b;
          source = 'binance_1m_fallback';
        }
      }
    } catch {
      /* fall through */
    }

    if (px == null) {
      const resolved = await resolveBtcUpDownPriceAtIstRef({
        istDayKey: day,
        refSecSinceMidnightIST: refSec,
        cacheGet: () => undefined,
        loadPersisted: async () => null,
        loadLedgerMinEntry: async () => null,
      });
      const p = resolved?.price != null ? Number(resolved.price) : null;
      if (Number.isFinite(p) && p > 0) {
        px = p;
        source = resolved.source;
      }
    }

    if (!Number.isFinite(px) || px <= 0) {
      return res.json({ windowNumber: W, refSecIst: refSec, price: null, source: null });
    }
    res.json({
      windowNumber: W,
      refSecIst: refSec,
      price: px,
      source,
      sampledAt,
    });
  } catch (error) {
    console.error('Error resolving BTC canonical open:', error);
    res.status(500).json({ message: error.message });
  }
});

// Save game result — admin only (Nifty). BTC is server-only; users must not publish results.
router.post('/game-result', protectAdmin, async (req, res) => {
  try {
    const { gameId, windowNumber, openPrice, closePrice, windowStartTime, windowEndTime } = req.body;

    if (!['updown', 'btcupdown'].includes(gameId)) {
      return res.status(400).json({ message: 'Invalid game ID' });
    }

    if (gameId === 'btcupdown') {
      return res.status(403).json({
        message:
          'BTC Up/Down results are published only by the server from live prices. Admins cannot override via this route.',
      });
    }

    const priceChange = closePrice - openPrice;
    const priceChangePercent = openPrice ? (priceChange / openPrice) * 100 : 0;
    const result = priceChange > 0 ? 'UP' : priceChange < 0 ? 'DOWN' : 'TIE';

    const istDay = getTodayISTString();
    const dayStart = startOfISTDayFromKey(istDay);
    const dayEnd = endOfISTDayFromKey(istDay);
    if (!dayStart || !dayEnd) {
      return res.status(400).json({ message: 'Invalid IST calendar day' });
    }

    const existingResult = await GameResult.findOne({
      gameId,
      windowNumber,
      windowDate: { $gte: dayStart, $lt: dayEnd },
    });

    if (existingResult) {
      return res.json({ message: 'Result already exists', result: existingResult });
    }

    const gameResult = await GameResult.create({
      gameId,
      windowNumber,
      windowDate: dayStart,
      openPrice,
      closePrice,
      result,
      priceChange,
      priceChangePercent,
      windowStartTime,
      windowEndTime,
      resultTime: new Date(),
    });

    res.status(201).json(gameResult);
  } catch (error) {
    console.error('Error saving game result:', error);
    res.status(500).json({ message: error.message });
  }
});

// Recent Up/Down settled wins for in-game history (persisted credits from ledger)
router.get('/game-bets/:gameId', protectUser, async (req, res) => {
  try {
    const { gameId } = req.params;
    if (!['updown', 'btcupdown'].includes(gameId)) {
      return res.status(400).json({ message: 'Invalid game' });
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const rows = await GamesWalletLedger.find({ user: req.user._id, gameId })
      .sort({ createdAt: -1 })
      .limit(400)
      .lean();

    const upDownDebitRe = /Up\/Down.*bet.*\(UP\)|Up\/Down.*bet.*\(DOWN\)/i;

    const wins = [];
    for (const row of rows) {
      if (row.entryType !== 'credit' || !row.meta?.won) continue;
      const m = row.meta || {};
      wins.push({
        id: String(row._id),
        won: true,
        sortAt: row.createdAt ? new Date(row.createdAt).getTime() : 0,
        pnl: Number(m.pnl) || 0,
        amount: Number(m.stake) || 0,
        prediction: m.prediction || 'UP',
        windowNumber: m.windowNumber != null ? m.windowNumber : 0,
        entryPrice: Number(m.entryPrice) || 0,
        exitPrice: Number(m.exitPrice) || 0,
        time: row.createdAt
          ? new Date(row.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
          : '',
      });
    }

    const settlements = await UpDownWindowSettlement.find({
      user: req.user._id,
      gameId,
    })
      .sort({ updatedAt: -1 })
      .limit(120)
      .lean();

    const settledKey = (wn, day) => `${Number(wn)}|${day}`;
    const settlementKeys = new Set(
      settlements.map((s) => settledKey(s.windowNumber, s.settlementDay))
    );

    const losses = [];
    for (const row of rows) {
      if (row.entryType !== 'debit' || !upDownDebitRe.test(String(row.description || ''))) continue;
      const m = row.meta || {};
      const wn = Number(m.windowNumber);
      if (!Number.isFinite(wn)) continue;
      const day = getTodayISTString(row.createdAt || new Date());
      if (!settlementKeys.has(settledKey(wn, day))) continue;

      const stake = Number(row.amount);
      const matchedWin = rows.some(
        (r) =>
          r.entryType === 'credit' &&
          r.meta?.won === true &&
          Number(r.meta?.windowNumber) === wn &&
          getTodayISTString(r.createdAt || new Date()) === day &&
          Number(r.meta?.stake) === stake
      );
      if (matchedWin) continue;

      losses.push({
        id: `loss-${row._id}`,
        won: false,
        sortAt: row.createdAt ? new Date(row.createdAt).getTime() : 0,
        pnl: -stake,
        amount: stake,
        prediction: m.prediction === 'DOWN' ? 'DOWN' : 'UP',
        windowNumber: wn,
        entryPrice: Number(m.entryPrice) || 0,
        exitPrice: 0,
        time: row.createdAt
          ? new Date(row.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
          : '',
      });
    }

    const combined = [...wins, ...losses]
      .sort((a, b) => (b.sortAt || 0) - (a.sortAt || 0))
      .slice(0, limit)
      .map(({ sortAt, ...rest }) => rest);

    res.json(combined);
  } catch (error) {
    console.error('game-bets list error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Resolve Up/Down bets (credit/debit gamesWallet based on results)
router.post('/game-bet/resolve', protectUser, async (req, res) => {
  let settlementLock = null;
  try {
    const { trades, gameId } = req.body;
    if (!['updown', 'btcupdown'].includes(gameId)) {
      return res.status(400).json({ message: 'Invalid gameId' });
    }
    if (!Array.isArray(trades) || trades.length === 0) {
      return res.status(400).json({ message: 'No trades to resolve' });
    }

    const windowNumber = Number(trades[0]?.windowNumber);
    if (!Number.isFinite(windowNumber)) {
      return res.status(400).json({ message: 'Each trade must include a valid windowNumber' });
    }
    const mixedWindow = trades.some((t) => Number(t.windowNumber) !== windowNumber);
    if (mixedWindow) {
      return res.status(400).json({ message: 'All trades in one request must be for the same window' });
    }

    const rawDay = req.body.settlementDay;
    const tradeDay =
      typeof trades[0]?.settlementDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(trades[0].settlementDay.trim())
        ? trades[0].settlementDay.trim()
        : null;
    let settlementDay =
      typeof rawDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDay.trim())
        ? rawDay.trim()
        : tradeDay;
    if (!settlementDay) {
      const sampleDebit = await GamesWalletLedger.findOne({
        user: req.user._id,
        gameId,
        entryType: 'debit',
        $or: [{ 'meta.windowNumber': windowNumber }, { 'meta.windowNumber': String(windowNumber) }],
        description: {
          $regex: 'Up/Down.*bet.*\\(UP\\)|Up/Down.*bet.*\\(DOWN\\)',
          $options: 'i',
        },
      })
        .sort({ createdAt: -1 })
        .select('meta createdAt')
        .lean();
      const metaD = sampleDebit?.meta?.settlementDay;
      if (typeof metaD === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(metaD)) {
        settlementDay = metaD;
      } else if (sampleDebit?.createdAt) {
        settlementDay = getTodayISTString(new Date(sampleDebit.createdAt));
      } else {
        settlementDay = getTodayISTString();
      }
    }

    try {
      await UpDownWindowSettlement.create({
        user: req.user._id,
        gameId,
        windowNumber,
        settlementDay,
      });
      settlementLock = { windowNumber, settlementDay };
    } catch (e) {
      if (e.code === 11000) {
        const fresh = await User.findById(req.user._id).select('gamesWallet').lean();
        return res.json({
          message: 'This window was already settled for your account',
          newBalance: fresh?.gamesWallet?.balance || 0,
          duplicate: true,
          settledCount: 0,
          totalPnl: 0,
        });
      }
      throw e;
    }

    const dayOfficialStart = startOfISTDayFromKey(settlementDay);
    const dayOfficialEnd = endOfISTDayFromKey(settlementDay);
    if (!dayOfficialStart || !dayOfficialEnd) {
      await UpDownWindowSettlement.deleteOne({ user: req.user._id, gameId, windowNumber, settlementDay });
      return res.status(400).json({ message: 'Invalid settlementDay (use YYYY-MM-DD IST)' });
    }

    const officialRow = await GameResult.findOne({
      gameId,
      windowNumber,
      windowDate: { $gte: dayOfficialStart, $lt: dayOfficialEnd },
    })
      .sort({ createdAt: -1 })
      .lean();

    if (
      !officialRow ||
      !Number.isFinite(Number(officialRow.openPrice)) ||
      !Number.isFinite(Number(officialRow.closePrice)) ||
      Number(officialRow.openPrice) <= 0 ||
      Number(officialRow.closePrice) <= 0
    ) {
      await UpDownWindowSettlement.deleteOne({ user: req.user._id, gameId, windowNumber, settlementDay });
      return res.status(400).json({
        message:
          'Official result is not available for this window yet. Wait for automatic settlement or try again shortly.',
      });
    }

    const officialOpen = Number(officialRow.openPrice);
    const officialClose = Number(officialRow.closePrice);

    let settingsResolve = null;
    try {
      settingsResolve = await GameSettings.getSettings();
    } catch (e) {
      console.warn('[RESOLVE] GameSettings load failed, using defaults', e?.message);
    }

    if (gameId === 'btcupdown' && settlementDay === getTodayISTString()) {
      if (currentTotalSecondsIST() < btcResultRefSecForUiWindow(windowNumber)) {
        await UpDownWindowSettlement.deleteOne({
          user: req.user._id,
          gameId,
          windowNumber,
          settlementDay,
        });
        return res.status(400).json({
          message:
            'BTC Up/Down: settlement opens only after the scheduled result time (IST) for this window.',
        });
      }
    }

    if (gameId === 'updown' && settlementDay === getTodayISTString()) {
      const ndCfg = settingsResolve?.games?.niftyUpDown || {};
      const niftyResultSec = niftyResultSecForWindow(windowNumber, ndCfg);
      if (Number.isFinite(niftyResultSec) && currentTotalSecondsIST() < niftyResultSec) {
        await UpDownWindowSettlement.deleteOne({
          user: req.user._id,
          gameId,
          windowNumber,
          settlementDay,
        });
        return res.status(400).json({
          message:
            'Nifty Up/Down: settlement opens only after the scheduled result time (IST) for this window.',
        });
      }
    }
    const tValueResolve = settingsResolve?.tokenValue || 300;
    const gameKeyCfg = gameId === 'btcupdown' ? 'btcUpDown' : 'niftyUpDown';
    const gcfg = settingsResolve?.games?.[gameKeyCfg] || {};
    const winMult = Number(gcfg.winMultiplier) > 0 ? Number(gcfg.winMultiplier) : 1.95;
    const brokPctCfg =
      gcfg.brokeragePercent != null && Number.isFinite(Number(gcfg.brokeragePercent))
        ? Number(gcfg.brokeragePercent)
        : 5;
    const grossHierarchyPctSumResolve =
      (Number(gcfg?.grossPrizeSubBrokerPercent) || 0) +
      (Number(gcfg?.grossPrizeBrokerPercent) || 0) +
      (Number(gcfg?.grossPrizeAdminPercent) || 0);
    const useGrossPrizeHierarchyResolve = grossHierarchyPctSumResolve > 0;

    const gameKey = gameId === 'btcupdown' ? 'btcUpDown' : 'niftyUpDown';

    const dayStartResolve = dayOfficialStart;
    const dayEndResolve = dayOfficialEnd;
    const debitStakePool =
      dayStartResolve && dayEndResolve
        ? (
            await GamesWalletLedger.find({
              user: req.user._id,
              gameId,
              entryType: 'debit',
              $or: [{ 'meta.windowNumber': windowNumber }, { 'meta.windowNumber': String(windowNumber) }],
              description: {
                $regex: 'Up/Down.*bet.*\\(UP\\)|Up/Down.*bet.*\\(DOWN\\)',
                $options: 'i',
              },
              createdAt: { $gte: dayStartResolve, $lt: dayEndResolve },
            })
              .sort({ createdAt: 1 })
              .select('amount createdAt meta _id')
              .lean()
          ).map((d) => ({
            amount: Number(d.amount),
            placedAt: d.createdAt,
            transactionId: d.meta?.transactionId,
            prediction: d.meta?.prediction === 'DOWN' ? 'DOWN' : 'UP',
            ledgerId: d._id,
          }))
        : [];

    const takePlacedAtForStake = (trade) => {
      const stakeAmt = Number(trade?.amount);
      if (!Number.isFinite(stakeAmt)) return undefined;
      const pred = trade?.prediction === 'DOWN' ? 'DOWN' : 'UP';
      const tid = trade?.transactionId ?? trade?.txnId;
      let idx = -1;
      if (tid) {
        idx = debitStakePool.findIndex(
          (d) =>
            d.transactionId === tid &&
            Number(d.amount) === stakeAmt &&
            d.prediction === pred
        );
      }
      if (idx < 0) {
        idx = debitStakePool.findIndex((d) => Number(d.amount) === stakeAmt && d.prediction === pred);
      }
      if (idx < 0) return undefined;
      const [hit] = debitStakePool.splice(idx, 1);
      return hit.placedAt;
    };

    // Accumulate totals across all trades, then issue one atomic $inc
    let totalBalanceInc = 0;
    let totalMarginDec = 0;
    let totalPnl = 0;
    let totalBrokerage = 0;
    let settledCount = 0;
    /** Sum of stake on winning legs — same as auto/manual settle; drives referral per-win */
    let totalWinningStakeForReferral = 0;
    const ledgerEntries = [];
    const hierarchyJobsResolve = [];

    const userForDistResolve = await User.findById(req.user._id).populate('admin');

    for (const trade of trades) {
      const amount = Number(trade.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        console.warn('[RESOLVE] skip trade: invalid amount', trade);
        continue;
      }

      const prediction = trade.prediction === 'DOWN' ? 'DOWN' : 'UP';
      const authoritative = settleUpDownFromPrices(prediction, officialOpen, officialClose);
      const won = authoritative === true;

      let brokerage = 0;
      let pnl;
      let creditTotal = 0;
      if (won) {
        const grossWin = amount * winMult;
        if (useGrossPrizeHierarchyResolve && userForDistResolve) {
          const grossBreakdown = await computeNiftyJackpotGrossHierarchyBreakdown(
            userForDistResolve,
            grossWin,
            gcfg
          );
          brokerage = grossBreakdown.totalHierarchy;
          if (brokerage > grossWin) brokerage = grossWin;
          pnl = parseFloat((grossWin - amount).toFixed(2));
          creditTotal = parseFloat(Number(grossWin).toFixed(2));
          if (brokerage > 0 && grossBreakdown) {
            hierarchyJobsResolve.push({ breakdown: grossBreakdown });
          }
        } else {
          const parts = computeUpDownWinPayout(amount, winMult, brokPctCfg);
          brokerage = parts.brokerage;
          pnl = parts.pnl;
          creditTotal = parts.creditTotal;
          totalBrokerage += brokerage;
        }
      } else {
        pnl = -amount;
      }

      if (!Number.isFinite(pnl)) {
        console.warn('[RESOLVE] skip trade: could not compute pnl', trade);
        continue;
      }

      if (won) {
        if (!Number.isFinite(creditTotal)) {
          console.warn('[RESOLVE] skip trade: invalid credit total', trade);
          continue;
        }
      }

      console.log(
        `[RESOLVE] Trade: Amount=${amount}, Won=${won}, PnL=${pnl}, Brokerage=${brokerage} officialOpen=${officialOpen} officialClose=${officialClose}`
      );
      
      // Debug logging for Rena's trade
      if (req.user.username === 'rena' || req.user.userCode === 'rena') {
        console.log('[RESOLVE DEBUG] Rena Trade Details:', {
          tradeId: trade.id,
          prediction,
          amount,
          won,
          pnl,
          creditTotal,
          brokerage,
          officialOpen,
          officialClose,
          windowNumber,
          gameId
        });
      }

      totalMarginDec += amount;

      if (won) {
        totalBalanceInc += creditTotal;
        totalWinningStakeForReferral += amount;
        console.log(`[RESOLVE] WIN: Gross credit ${creditTotal} (hierarchy/brokerage ${brokerage} from pool)`);
        const placedAt = takePlacedAtForStake(trade);
        ledgerEntries.push({
          gameId,
          entryType: 'credit',
          amount: creditTotal,
          description: `${gameId === 'btcupdown' ? 'BTC' : 'Nifty'} Up/Down — win (gross payout; hierarchy from pool)`,
          meta: {
            won: true,
            stake: amount,
            pnl,
            brokerage,
            grossPrizeHierarchy: useGrossPrizeHierarchyResolve,
            hierarchyPaidFromPoolExtra: brokerage > 0,
            tickets: parseFloat((amount / tValueResolve).toFixed(2)),
            tokenValue: tValueResolve,
            prediction,
            windowNumber: trade.windowNumber != null ? Number(trade.windowNumber) : undefined,
            entryPrice: officialOpen,
            exitPrice: officialClose,
            ...(placedAt ? { orderPlacedAt: placedAt } : {}),
          },
        });
      } else {
        console.log(`[RESOLVE] LOSS: Amount ${amount} already deducted at bet placement`);
      }
      totalPnl += pnl;
      settledCount += 1;
    }

    if (settledCount === 0) {
      await UpDownWindowSettlement.deleteOne({ user: req.user._id, gameId, windowNumber, settlementDay });
      return res.status(400).json({ message: 'No valid trades could be settled (check amounts/prices).' });
    }

    const isBtcUpDown = gameId === 'btcupdown';
    // BTC: pay wins from Super Admin pool (stakes were credited to SA on bet; losses stay in pool).
    if (isBtcUpDown && totalBalanceInc > 0) {
      const poolDebit = await debitBtcUpDownSuperAdminPool(
        totalBalanceInc,
        `BTC Up/Down — win payout from Super Admin pool (−${totalBalanceInc.toFixed(2)})`
      );
      if (!poolDebit.ok) {
        await UpDownWindowSettlement.deleteOne({ user: req.user._id, gameId, windowNumber, settlementDay });
        return res.status(503).json({
          message:
            'BTC Up/Down payout failed: no active Super Admin wallet found. Configure an active Super Admin and retry settlement.',
        });
      }
    }

    // Single atomic update for the entire window settlement
    const gw = await atomicGamesWalletUpdate(User, req.user._id, {
      balance: totalBalanceInc,
      usedMargin: -totalMarginDec,
      realizedPnL: totalPnl,
      todayRealizedPnL: totalPnl,
    });
    console.log(`[RESOLVE] Atomic update done. New balance: ${gw.balance}`);

    // Record ledger entries with final balance and transaction slip entries
    for (const entry of ledgerEntries) {
      const ledgerRecord = await recordGamesWalletLedger(req.user._id, {
        ...entry,
        balanceAfter: gw.balance,
      });
      
      // Find transaction slip by looking for the original debit transaction
      if (entry.entryType === 'credit' && entry.meta?.won) {
        try {
          // Find the original debit ledger entry for this bet
          const originalDebit = await GamesWalletLedger.findOne({
            user: req.user._id,
            gameId: entry.gameId,
            entryType: 'debit',
            amount: entry.meta.stake,
            'meta.windowNumber': entry.meta.windowNumber,
            'meta.prediction': entry.meta.prediction
          }).sort({ createdAt: -1 });
          
          if (originalDebit?.meta?.transactionId) {
            const slip = await findTransactionSlipByTransactionId(originalDebit.meta.transactionId);
            if (slip) {
              const userCode = req.user.userCode || req.user.username || req.user._id.toString();
              await addCreditEntry(
                slip._id,
                originalDebit.meta.transactionId,
                entry.gameId,
                entry.amount,
                req.user._id,
                userCode,
                {
                  won: entry.meta.won,
                  pnl: entry.meta.pnl,
                  brokerage: entry.meta.brokerage,
                  grossWin: entry.amount,
                  openPrice: entry.meta.entryPrice,
                  closePrice: entry.meta.exitPrice,
                  windowNumber: entry.meta.windowNumber,
                  prediction: entry.meta.prediction,
                  relatedLedgerId: ledgerRecord?._id
                }
              );
            }
          }
        } catch (slipError) {
          console.warn('[RESOLVE] Transaction slip credit entry failed:', slipError);
        }
      }
    }

    if (isBtcUpDown) {
      if (useGrossPrizeHierarchyResolve && userForDistResolve) {
        for (const job of hierarchyJobsResolve) {
          await creditNiftyJackpotGrossHierarchyFromPool(req.user._id, userForDistResolve, job.breakdown, {
            gameLabel: 'BTC Up/Down',
            gameKey: 'btcUpDown',
            logTag: 'UpDownGrossHierarchy',
          });
        }
      } else if (totalBrokerage > 0 && userForDistResolve) {
        // Find transaction ID for brokerage distribution linking
        let transactionId = null;
        try {
          const sampleDebit = await GamesWalletLedger.findOne({
            user: req.user._id,
            gameId,
            entryType: 'debit',
            'meta.windowNumber': windowNumber,
            'meta.transactionId': { $exists: true }
          }).sort({ createdAt: -1 });
          transactionId = sampleDebit?.meta?.transactionId;
        } catch (error) {
          console.warn('[RESOLVE] Failed to find transaction ID for brokerage:', error);
        }

        const brokerageResult = await distributeWinBrokerage(
          req.user._id,
          userForDistResolve,
          totalBrokerage,
          'BTC UpDown',
          gameKey,
          { fundFromBtcPool: true, ledgerGameId: 'btcupdown', skipUserRebate: true, transactionId }
        );
        
        // Add brokerage distribution entries to transaction slips
        if (brokerageResult.distributions && Object.keys(brokerageResult.distributions).length > 0) {
          try {
            // Find any transaction slip from this settlement
            const sampleDebit = await GamesWalletLedger.findOne({
              user: req.user._id,
              gameId,
              entryType: 'debit',
              'meta.windowNumber': windowNumber,
              'meta.transactionId': { $exists: true }
            }).sort({ createdAt: -1 });
            
            if (sampleDebit?.meta?.transactionId) {
              const slip = await findTransactionSlipByTransactionId(sampleDebit.meta.transactionId);
              if (slip) {
                await addBrokerageDistributionEntries(
                  slip._id,
                  sampleDebit.meta.transactionId,
                  gameId,
                  brokerageResult.distributions,
                  totalBrokerage,
                  'WIN_BROKERAGE'
                );
              }
            }
          } catch (brokerageSlipError) {
            console.warn('[RESOLVE] Brokerage distribution slip entries failed:', brokerageSlipError);
          }
        }
      }
    } else {
      if (useGrossPrizeHierarchyResolve && userForDistResolve) {
        for (const job of hierarchyJobsResolve) {
          await creditNiftyJackpotGrossHierarchyFromPool(req.user._id, userForDistResolve, job.breakdown, {
            gameLabel: 'Nifty Up/Down',
            gameKey: 'niftyUpDown',
            logTag: 'UpDownGrossHierarchy',
          });
        }
      } else if (totalBrokerage > 0 && userForDistResolve) {
        // Find transaction ID for brokerage distribution linking
        let transactionId = null;
        try {
          const sampleDebit = await GamesWalletLedger.findOne({
            user: req.user._id,
            gameId,
            entryType: 'debit',
            'meta.windowNumber': windowNumber,
            'meta.transactionId': { $exists: true }
          }).sort({ createdAt: -1 });
          transactionId = sampleDebit?.meta?.transactionId;
        } catch (error) {
          console.warn('[RESOLVE] Failed to find transaction ID for brokerage:', error);
        }

        const brokerageResult = await distributeWinBrokerage(
          req.user._id,
          userForDistResolve,
          totalBrokerage,
          'Nifty UpDown',
          gameKey,
          { fundFromBtcPool: false, ledgerGameId: 'updown', skipUserRebate: true, transactionId }
        );
        
        // Add brokerage distribution entries to transaction slips
        if (brokerageResult.distributions && Object.keys(brokerageResult.distributions).length > 0) {
          try {
            // Find any transaction slip from this settlement
            const sampleDebit = await GamesWalletLedger.findOne({
              user: req.user._id,
              gameId,
              entryType: 'debit',
              'meta.windowNumber': windowNumber,
              'meta.transactionId': { $exists: true }
            }).sort({ createdAt: -1 });
            
            if (sampleDebit?.meta?.transactionId) {
              const slip = await findTransactionSlipByTransactionId(sampleDebit.meta.transactionId);
              if (slip) {
                await addBrokerageDistributionEntries(
                  slip._id,
                  sampleDebit.meta.transactionId,
                  gameId,
                  brokerageResult.distributions,
                  totalBrokerage,
                  'WIN_BROKERAGE'
                );
              }
            }
          } catch (brokerageSlipError) {
            console.warn('[RESOLVE] Brokerage distribution slip entries failed:', brokerageSlipError);
          }
        }
      }
    }

    const refStake = parseFloat(Number(totalWinningStakeForReferral).toFixed(2));
    const totalStakeInWindow = parseFloat(Number(totalMarginDec).toFixed(2));
    if (refStake > 0 && totalStakeInWindow > 0) {
      const gt = gameId === 'btcupdown' ? 'btcUpDown' : 'niftyUpDown';
      try {
        const refOut = await creditReferralPerWinFromGameSettings(
          req.user._id,
          refStake,
          gt,
          { windowNumber, settlementDay, gameId, totalStakeInWindow }
        );
        if (refOut.credited) {
          console.log(
            `[RESOLVE] referral per-win user=${req.user._id} game=${gameId} w=${windowNumber} → referrer ${refOut.amount}`
          );
        } else if (refOut.reason) {
          console.log(`[RESOLVE] referral per-win skipped: ${refOut.reason}`);
        }
      } catch (refErr) {
        console.warn('[RESOLVE] referral per-win failed:', refErr?.message || refErr);
      }
    }

    res.json({
      message: `${settledCount} trade(s) resolved`,
      totalPnl,
      newBalance: gw.balance,
    });
  } catch (error) {
    if (settlementLock != null && req.user?._id && req.body?.gameId) {
      await UpDownWindowSettlement.deleteOne({
        user: req.user._id,
        gameId: req.body.gameId,
        windowNumber: settlementLock.windowNumber,
        settlementDay: settlementLock.settlementDay,
      }).catch(() => {});
    }
    console.error('Game bet resolve error:', error);
    res.status(500).json({ message: error.message });
  }
});

// ==================== NIFTY NUMBER GAME ====================

// Helper: Get today's calendar date in IST (YYYY-MM-DD). Must match `getTodayISTString` (Intl) — do not use UTC shift + toISOString.
function getTodayIST() {
  return getTodayISTString(new Date());
}

function parseClockToSecondsIST(raw, fallback = '00:00') {
  const s = String(raw || fallback).trim();
  const [hh = '0', mm = '0', ss = '0'] = s.split(':');
  return (parseInt(hh, 10) || 0) * 3600 + (parseInt(mm, 10) || 0) * 60 + (parseInt(ss, 10) || 0);
}

function endInclusiveSecondsFromConfig(rawEnd, fallback = '23:24') {
  const s = String(rawEnd || fallback).trim();
  const parts = s.split(':').filter(Boolean);
  const base = parseClockToSecondsIST(s, fallback);
  if (parts.length >= 3) return base;
  return Math.floor(base / 60) * 60 + 59;
}

// Nifty Number: bets cannot be deleted after placement (use PUT to adjust pending stake only).
router.delete('/nifty-number/bet/:id', protectUser, async (req, res) => {
  return res.status(400).json({
    message: 'Nifty Number bets cannot be deleted once placed. You can edit a pending bet if allowed.',
  });
});

// Place a Nifty Number bet (multiple numbers allowed per day)
router.post('/nifty-number/bet', protectUser, async (req, res) => {
  try {
    const { selectedNumbers, amount } = req.body;
    const userId = req.user._id;
    const today = getTodayIST();

    // Support both single number (legacy) and array of numbers
    const numbers = Array.isArray(selectedNumbers)
      ? selectedNumbers.map(n => parseInt(n))
      : [parseInt(selectedNumbers ?? req.body.selectedNumber)];

    // Validate numbers
    if (numbers.length === 0) {
      return res.status(400).json({ message: 'Please select at least one number' });
    }
    for (const num of numbers) {
      if (isNaN(num) || num < 0 || num > 99) {
        return res.status(400).json({ message: 'All numbers must be between .00 and .99' });
      }
    }
    // Check for duplicates in the request
    if (new Set(numbers).size !== numbers.length) {
      return res.status(400).json({ message: 'Duplicate numbers are not allowed' });
    }

    // Get game settings
    const settings = await GameSettings.getSettings();
    const gameConfig = settings.games?.niftyNumber;
    if (!gameConfig?.enabled) {
      return res.status(400).json({ message: 'Nifty Number game is currently disabled' });
    }

    if (await rejectIfHierarchyGameDenied(res, userId, 'niftyNumber')) return;

    // Check betting time window (9:15:00 to 15:24:59 IST)
    // TEMPORARILY DISABLED FOR TESTING - uncomment below to enable
    /*
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const currentHour = nowIST.getHours();
    const currentMinute = nowIST.getMinutes();
    const currentTimeMinutes = currentHour * 60 + currentMinute;
    
    const biddingStartTime = gameConfig.biddingStartTime || '09:15';
    const biddingEndTime = gameConfig.biddingEndTime || '15:24';
    const [startH, startM] = biddingStartTime.split(':').map(Number);
    const [endH, endM] = biddingEndTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    
    if (currentTimeMinutes < startMinutes || currentTimeMinutes > endMinutes) {
      return res.status(400).json({ 
        message: `Betting is only allowed from ${biddingStartTime} to ${biddingEndTime} IST. Current time: ${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')} IST` 
      });
    }
    */

    // Validate amount (per number)
    const betAmount = parseFloat(amount);
    if (isNaN(betAmount) || betAmount <= 0) {
      return res.status(400).json({ message: 'Invalid bet amount' });
    }
    const tValue = gameConfig.ticketPrice || settings.tokenValue || 300;
    const minAmt = (gameConfig.minTickets || 1) * tValue;
    const maxAmt = (gameConfig.maxTickets || 100) * tValue;
    if (betAmount < minAmt) {
      return res.status(400).json({ message: `Minimum bet is ${gameConfig.minTickets || 1} ticket(s) (${minAmt}) per number` });
    }
    if (betAmount > maxAmt) {
      return res.status(400).json({ message: `Maximum bet is ${gameConfig.maxTickets || 100} ticket(s) (${maxAmt}) per number` });
    }

    // Support quantity (number of bets per number)
    const qty = parseInt(req.body.quantity) || 1;
    if (qty < 1) return res.status(400).json({ message: 'Invalid quantity' });

    const perNumberTotal = betAmount * qty; // total for one number = per-ticket-amount * quantity
    const totalCost = perNumberTotal * numbers.length;

    // Check how many bets user already placed today (count quantity of each bet)
    const todayBets = await NiftyNumberBet.find({ user: userId, betDate: today });
    const todayBetsCount = todayBets.reduce((sum, b) => sum + (b.quantity || 1), 0);
    const maxBetsPerDay = gameConfig.betsPerDay || 1;
    const newBetsCount = qty * numbers.length;
    if (todayBetsCount + newBetsCount > maxBetsPerDay) {
      const remaining = Math.max(0, maxBetsPerDay - todayBetsCount);
      return res.status(400).json({ message: `You can only place ${maxBetsPerDay} bets per day. You have ${remaining} remaining.` });
    }

    // Check if user already bet on any of these numbers today
    const existingBets = await NiftyNumberBet.find({ user: userId, betDate: today, selectedNumber: { $in: numbers } });
    if (existingBets.length > 0) {
      const dupes = existingBets.map(b => `.${b.selectedNumber.toString().padStart(2, '0')}`).join(', ');
      return res.status(400).json({ message: `You already bet on ${dupes} today` });
    }

    // Atomic debit — balance check + deduction in one MongoDB op (race-safe)
    const gw = await atomicGamesWalletDebit(User, userId, totalCost, { usedMargin: totalCost });
    if (!gw) {
      return res.status(400).json({ message: `Insufficient balance. Need ${totalCost.toLocaleString()} for ${numbers.length} number(s)` });
    }

    let saCredited = false;
    try {
      await creditBtcUpDownSuperAdminPool(
        totalCost,
        'Nifty Number — stake to Super Admin pool (bet)'
      );
      saCredited = true;
    } catch (poolErr) {
      console.error('Nifty Number: Super Admin pool credit failed:', poolErr);
      await atomicGamesWalletUpdate(User, userId, { balance: totalCost, usedMargin: -totalCost });
      return res.status(503).json({
        message: 'Could not route stake to house pool. Your games wallet was not charged.',
      });
    }

    // Get user admin info for bet records after successful debit
    const user = await User.findById(userId).select('admin');

    // Create bets for each number (single record per number with quantity)
    const betDocs = numbers.map(num => ({
      user: userId,
      selectedNumber: num,
      amount: perNumberTotal,
      quantity: qty,
      betDate: today,
      admin: user?.admin || null,
      status: 'pending'
    }));
    let bets;
    try {
      bets = await NiftyNumberBet.insertMany(betDocs);
    } catch (innerErr) {
      if (saCredited) {
        await debitBtcUpDownSuperAdminPool(
          totalCost,
          'Nifty Number — rollback Super Admin pool (bet persist failed)'
        );
      }
      await atomicGamesWalletUpdate(User, userId, { balance: totalCost, usedMargin: -totalCost });
      console.error('Nifty Number insertMany error:', innerErr);
      throw innerErr;
    }

    const placedAt = bets[0]?.createdAt || new Date();
    await recordGamesWalletLedger(userId, {
      gameId: 'niftyNumber',
      entryType: 'debit',
      amount: totalCost,
      balanceAfter: gw.balance,
      description: `Nifty Number — bet (${numbers.length} number${numbers.length > 1 ? 's' : ''})`,
      orderPlacedAt: placedAt,
      meta: {
        numbers,
        perNumberAmount: betAmount,
        tickets: parseFloat((totalCost / tValue).toFixed(2)),
        tokenValue: tValue,
      },
    });

    res.json({
      message: `${numbers.length} bet(s) placed successfully!`,
      bets: bets.map(b => ({
        _id: b._id,
        selectedNumber: b.selectedNumber,
        amount: b.amount,
        betDate: b.betDate,
        status: b.status,
      })),
      newBalance: gw.balance
    });
  } catch (error) {
    console.error('Nifty Number bet error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Modify a pending Nifty Number bet amount
router.put('/nifty-number/bet/:id', protectUser, async (req, res) => {
  try {
    const { newAmount } = req.body;
    const betId = req.params.id;
    const userId = req.user._id;

    const bet = await NiftyNumberBet.findOne({ _id: betId, user: userId });
    if (!bet) return res.status(404).json({ message: 'Bet not found' });
    if (bet.status !== 'pending') return res.status(400).json({ message: 'Can only modify pending bets' });

    const settings = await GameSettings.getSettings();
    const gameConfig = settings.games?.niftyNumber;

    const amount = parseFloat(newAmount);
    if (isNaN(amount) || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });
    const tValue = gameConfig?.ticketPrice || settings.tokenValue || 300;
    const minAmt = (gameConfig?.minTickets || 1) * tValue;
    const maxAmt = (gameConfig?.maxTickets || 100) * tValue;
    if (amount < minAmt) return res.status(400).json({ message: `Minimum bet is ${gameConfig?.minTickets || 1} ticket(s) (${minAmt})` });
    if (amount > maxAmt) return res.status(400).json({ message: `Maximum bet is ${gameConfig?.maxTickets || 100} ticket(s) (${maxAmt})` });

    const oldAmount = bet.amount;
    const diff = amount - oldAmount;

    let gw;
    if (diff > 0) {
      if (await rejectIfHierarchyGameDenied(res, userId, 'niftyNumber')) return;
      gw = await atomicGamesWalletUpdate(User, userId, { balance: -diff, usedMargin: diff });
      if (!gw) {
        return res.status(400).json({ message: `Insufficient balance. Need ${diff} more` });
      }
      try {
        await creditBtcUpDownSuperAdminPool(
          diff,
          'Nifty Number — additional stake to Super Admin pool (bet modified)'
        );
      } catch (poolErr) {
        await atomicGamesWalletUpdate(User, userId, { balance: diff, usedMargin: -diff });
        console.error('Nifty Number modify: SA credit failed:', poolErr);
        return res.status(503).json({ message: 'Could not route additional stake to house pool.' });
      }
    } else if (diff < 0) {
      const refund = -diff;
      const poolOut = await debitBtcUpDownSuperAdminPool(
        refund,
        'Nifty Number — reduce stake from Super Admin pool (bet modified)'
      );
      if (!poolOut.ok) {
        return res.status(503).json({ message: 'Could not adjust house pool for reduced stake.' });
      }
      gw = await atomicGamesWalletUpdate(User, userId, { balance: refund, usedMargin: -refund });
      if (!gw) {
        await creditBtcUpDownSuperAdminPool(
          refund,
          'Nifty Number — rollback SA (wallet credit failed after modify)'
        );
        return res.status(500).json({ message: 'Could not credit games wallet' });
      }
    } else {
      const u = await User.findById(userId).select('gamesWallet.balance').lean();
      gw = { balance: u?.gamesWallet?.balance ?? 0 };
    }

    if (diff !== 0) {
      await recordGamesWalletLedger(userId, {
        gameId: 'niftyNumber',
        entryType: diff > 0 ? 'debit' : 'credit',
        amount: Math.abs(diff),
        balanceAfter: gw.balance,
        description: `Nifty Number — bet size ${diff > 0 ? 'increased' : 'reduced'}`,
        orderPlacedAt: bet.createdAt,
        meta: {
          betId: bet._id,
          oldAmount,
          newAmount: amount,
          tickets: parseFloat((Math.abs(diff) / tValue).toFixed(2)),
          tokenValue: tValue,
        },
      });
    }

    bet.amount = amount;
    await bet.save();

    res.json({
      message: `Bet updated to ${amount}`,
      bet: { _id: bet._id, selectedNumber: bet.selectedNumber, amount: bet.amount, status: bet.status },
      newBalance: gw.balance
    });
  } catch (error) {
    console.error('Nifty Number modify bet error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get today's bets for current user
router.get('/nifty-number/today', protectUser, async (req, res) => {
  try {
    const today = getTodayIST();
    const bets = await NiftyNumberBet.find({ user: req.user._id, betDate: today }).sort({ createdAt: -1 });

    const settings = await GameSettings.getSettings();
    const maxBetsPerDay = settings.games?.niftyNumber?.betsPerDay || 1;
    const nnCfg = settings.games?.niftyNumber || {};

    const totalBetsCount = bets.reduce((sum, b) => sum + (b.quantity || 1), 0);
    res.json({
      hasBet: bets.length > 0,
      betsCount: totalBetsCount,
      maxBetsPerDay,
      remaining: Math.max(0, maxBetsPerDay - totalBetsCount),
      bets: bets.map(b => ({
        _id: b._id,
        selectedNumber: b.selectedNumber,
        amount: b.amount,
        quantity: b.quantity || 1,
        betDate: b.betDate,
        createdAt: b.createdAt,
        status: b.status,
        resultNumber: b.resultNumber,
        closingPrice: b.closingPrice,
        profit: b.profit,
        resultDeclaredAt: b.resultDeclaredAt,
      })),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get bet history for current user
router.get('/nifty-number/history', protectUser, async (req, res) => {
  try {
    const bets = await NiftyNumberBet.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(30);

    const settings = await GameSettings.getSettings();
    const nnCfg = settings.games?.niftyNumber || {};

    res.json(
      bets.map((b) => ({
        _id: b._id,
        selectedNumber: b.selectedNumber,
        amount: b.amount,
        quantity: b.quantity || 1,
        betDate: b.betDate,
        createdAt: b.createdAt,
        status: b.status,
        resultNumber: b.resultNumber,
        closingPrice: b.closingPrice,
        profit: b.profit,
        resultDeclaredAt: b.resultDeclaredAt,
      }))
    );
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Declared Nifty Number result for a calendar day (any bet row with resultNumber set after admin clearing)
router.get('/nifty-number/daily-result', protectUser, async (req, res) => {
  try {
    const date = typeof req.query.date === 'string' && req.query.date.trim() ? req.query.date.trim() : getTodayIST();
    const row = await NiftyNumberBet.findOne({
      betDate: date,
      resultNumber: { $ne: null },
    })
      .sort({ resultDeclaredAt: -1, updatedAt: -1 })
      .select('resultNumber closingPrice resultDeclaredAt betDate')
      .lean();

    if (!row || row.resultNumber == null) {
      return res.json({ declared: false, betDate: date });
    }

    res.json({
      declared: true,
      betDate: date,
      resultNumber: row.resultNumber,
      closingPrice:
        Number.isFinite(Number(row.closingPrice)) && Number(row.closingPrice) > 0
          ? Number(row.closingPrice)
          : null,
      resultDeclaredAt: row.resultDeclaredAt ?? null,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==================== BTC NUMBER GAME (stake via BTC Jackpot Bank ledger tags) ====================

const BTC_NUM_POOL = { gameKey: 'btcNumber', poolDebitKind: 'BTC_NUMBER_STAKE' };
const BTC_NUM_POOL_RB = { gameKey: 'btcNumber', poolDebitKind: 'BTC_NUMBER_STAKE_ROLLBACK' };

router.delete('/btc-number/bet/:id', protectUser, async (req, res) => {
  return res.status(400).json({
    message: 'BTC Number bets cannot be deleted once placed. You can edit a pending bet if allowed.',
  });
});

router.post('/btc-number/bet', protectUser, async (req, res) => {
  try {
    const { selectedNumbers, amount } = req.body;
    const userId = req.user._id;
    const today = getTodayIST();

    const numbers = Array.isArray(selectedNumbers)
      ? selectedNumbers.map((n) => parseInt(n, 10))
      : [parseInt(selectedNumbers ?? req.body.selectedNumber, 10)];

    if (numbers.length === 0) {
      return res.status(400).json({ message: 'Please select at least one number' });
    }
    for (const num of numbers) {
      if (isNaN(num) || num < 0 || num > 99) {
        return res.status(400).json({ message: 'All numbers must be between .00 and .99' });
      }
    }
    if (new Set(numbers).size !== numbers.length) {
      return res.status(400).json({ message: 'Duplicate numbers are not allowed' });
    }

    const settings = await GameSettings.getSettings();
    const gameConfig = settings.games?.btcNumber;
    if (!gameConfig?.enabled) {
      return res.status(400).json({ message: 'BTC Number game is currently disabled' });
    }
    const nowSec = currentTotalSecondsIST();
    const bidStartSec = parseClockToSecondsIST(gameConfig.biddingStartTime || '00:00');
    const bidEndSecInclusive = endInclusiveSecondsFromConfig(
      gameConfig.endTime || gameConfig.maxBidTime || gameConfig.biddingEndTime || '23:24'
    );
    if (nowSec < bidStartSec || nowSec > bidEndSecInclusive) {
      const bidEndLabel = gameConfig.endTime || gameConfig.maxBidTime || gameConfig.biddingEndTime || '23:24';
      return res.status(400).json({
        message: `Betting is only allowed from ${gameConfig.biddingStartTime || '00:00'} to ${bidEndLabel} IST.`,
      });
    }

    if (await rejectIfHierarchyGameDenied(res, userId, 'btcNumber')) return;

    const betAmount = parseFloat(amount);
    if (isNaN(betAmount) || betAmount <= 0) {
      return res.status(400).json({ message: 'Invalid bet amount' });
    }
    const tValue = gameConfig.ticketPrice || settings.tokenValue || 300;
    const minAmt = (gameConfig.minTickets || 1) * tValue;
    const maxAmt = (gameConfig.maxTickets || 100) * tValue;
    if (betAmount < minAmt) {
      return res.status(400).json({ message: `Minimum bet is ${gameConfig.minTickets || 1} ticket(s) (${minAmt}) per number` });
    }
    if (betAmount > maxAmt) {
      return res.status(400).json({ message: `Maximum bet is ${gameConfig.maxTickets || 100} ticket(s) (${maxAmt}) per number` });
    }

    const qty = parseInt(req.body.quantity, 10) || 1;
    if (qty < 1) return res.status(400).json({ message: 'Invalid quantity' });

    const perNumberTotal = betAmount * qty;
    const totalCost = perNumberTotal * numbers.length;

    const todayBets = await BtcNumberBet.find({ user: userId, betDate: today });
    const todayBetsCount = todayBets.reduce((sum, b) => sum + (b.quantity || 1), 0);
    const maxBetsPerDay = gameConfig.betsPerDay || 1;
    const newBetsCount = qty * numbers.length;
    if (todayBetsCount + newBetsCount > maxBetsPerDay) {
      const remaining = Math.max(0, maxBetsPerDay - todayBetsCount);
      return res.status(400).json({ message: `You can only place ${maxBetsPerDay} bets per day. You have ${remaining} remaining.` });
    }

    const existingBets = await BtcNumberBet.find({ user: userId, betDate: today, selectedNumber: { $in: numbers } });
    if (existingBets.length > 0) {
      const dupes = existingBets.map((b) => b.selectedNumber.toString().padStart(2, '0')).join(', ');
      return res.status(400).json({ message: `You already bet on ${dupes} today` });
    }

    const gw = await atomicGamesWalletDebit(User, userId, totalCost, { usedMargin: totalCost });
    if (!gw) {
      return res.status(400).json({ message: `Insufficient balance. Need ${totalCost.toLocaleString()} for ${numbers.length} number(s)` });
    }

    let saCredited = false;
    try {
      await creditSuperAdminForBtcJackpotStake(
        totalCost,
        'BTC Number — stake to Bank (Super Admin)',
        { ...BTC_NUM_POOL, relatedUserId: userId, betDate: today }
      );
      saCredited = true;
    } catch (poolErr) {
      console.error('BTC Number: Super Admin pool credit failed:', poolErr);
      await atomicGamesWalletUpdate(User, userId, { balance: totalCost, usedMargin: -totalCost });
      return res.status(503).json({
        message: 'Could not route stake to house pool. Your games wallet was not charged.',
      });
    }

    const user = await User.findById(userId).select('admin');
    const betDocs = numbers.map((num) => ({
      user: userId,
      selectedNumber: num,
      amount: perNumberTotal,
      quantity: qty,
      betDate: today,
      admin: user?.admin || null,
      status: 'pending',
    }));
    let bets;
    try {
      bets = await BtcNumberBet.insertMany(betDocs);
    } catch (innerErr) {
      if (saCredited) {
        await rollbackBtcJackpotStakeCredit(
          totalCost,
          'BTC Number — rollback Bank (bet persist failed)',
          BTC_NUM_POOL_RB
        );
      }
      await atomicGamesWalletUpdate(User, userId, { balance: totalCost, usedMargin: -totalCost });
      console.error('BTC Number insertMany error:', innerErr);
      throw innerErr;
    }

    const placedAt = bets[0]?.createdAt || new Date();
    await recordGamesWalletLedger(userId, {
      gameId: 'btcNumber',
      entryType: 'debit',
      amount: totalCost,
      balanceAfter: gw.balance,
      description: `BTC Number — bet (${numbers.length} number${numbers.length > 1 ? 's' : ''})`,
      orderPlacedAt: placedAt,
      meta: {
        numbers,
        perNumberAmount: betAmount,
        tickets: parseFloat((totalCost / tValue).toFixed(2)),
        tokenValue: tValue,
      },
    });

    res.json({
      message: `${numbers.length} bet(s) placed successfully!`,
      bets: bets.map((b) => ({
        _id: b._id,
        selectedNumber: b.selectedNumber,
        amount: b.amount,
        betDate: b.betDate,
        status: b.status,
      })),
      newBalance: gw.balance,
    });
  } catch (error) {
    console.error('BTC Number bet error:', error);
    res.status(500).json({ message: error.message });
  }
});

router.put('/btc-number/bet/:id', protectUser, async (req, res) => {
  try {
    const { newAmount } = req.body;
    const betId = req.params.id;
    const userId = req.user._id;

    const bet = await BtcNumberBet.findOne({ _id: betId, user: userId });
    if (!bet) return res.status(404).json({ message: 'Bet not found' });
    if (bet.status !== 'pending') return res.status(400).json({ message: 'Can only modify pending bets' });

    const settings = await GameSettings.getSettings();
    const gameConfig = settings.games?.btcNumber;

    const amount = parseFloat(newAmount);
    if (isNaN(amount) || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });
    const tValue = gameConfig?.ticketPrice || settings.tokenValue || 300;
    const minAmt = (gameConfig?.minTickets || 1) * tValue;
    const maxAmt = (gameConfig?.maxTickets || 100) * tValue;
    if (amount < minAmt) return res.status(400).json({ message: `Minimum bet is ${gameConfig?.minTickets || 1} ticket(s) (${minAmt})` });
    if (amount > maxAmt) return res.status(400).json({ message: `Maximum bet is ${gameConfig?.maxTickets || 100} ticket(s) (${maxAmt})` });

    const oldAmount = bet.amount;
    const diff = amount - oldAmount;

    let gw;
    if (diff > 0) {
      if (await rejectIfHierarchyGameDenied(res, userId, 'btcNumber')) return;
      gw = await atomicGamesWalletUpdate(User, userId, { balance: -diff, usedMargin: diff });
      if (!gw) {
        return res.status(400).json({ message: `Insufficient balance. Need ${diff} more` });
      }
      try {
        await creditSuperAdminForBtcJackpotStake(
          diff,
          'BTC Number — additional stake to Bank (bet modified)',
          { ...BTC_NUM_POOL, relatedUserId: userId, betId }
        );
      } catch (poolErr) {
        await atomicGamesWalletUpdate(User, userId, { balance: diff, usedMargin: -diff });
        console.error('BTC Number modify: SA credit failed:', poolErr);
        return res.status(503).json({ message: 'Could not route additional stake to house pool.' });
      }
    } else if (diff < 0) {
      const refund = -diff;
      const poolOut = await debitSuperAdminForBtcJackpotPayout(
        refund,
        'BTC Number — reduce stake from Bank (bet modified)',
        { gameKey: 'btcNumber', poolDebitKind: 'BTC_NUMBER_PAYOUT', relatedUserId: userId, betId }
      );
      if (!poolOut.ok) {
        return res.status(503).json({ message: 'Could not adjust house pool for reduced stake.' });
      }
      gw = await atomicGamesWalletUpdate(User, userId, { balance: refund, usedMargin: -refund });
      if (!gw) {
        await creditSuperAdminForBtcJackpotStake(
          refund,
          'BTC Number — rollback Bank (wallet credit failed after modify)',
          { ...BTC_NUM_POOL, relatedUserId: userId, betId }
        );
        return res.status(500).json({ message: 'Could not credit games wallet' });
      }
    } else {
      const u = await User.findById(userId).select('gamesWallet.balance').lean();
      gw = { balance: u?.gamesWallet?.balance ?? 0 };
    }

    if (diff !== 0) {
      await recordGamesWalletLedger(userId, {
        gameId: 'btcNumber',
        entryType: diff > 0 ? 'debit' : 'credit',
        amount: Math.abs(diff),
        balanceAfter: gw.balance,
        description: `BTC Number — bet size ${diff > 0 ? 'increased' : 'reduced'}`,
        orderPlacedAt: bet.createdAt,
        meta: {
          betId: bet._id,
          oldAmount,
          newAmount: amount,
          tickets: parseFloat((Math.abs(diff) / tValue).toFixed(2)),
          tokenValue: tValue,
        },
      });
    }

    bet.amount = amount;
    await bet.save();

    res.json({
      message: `Bet updated to ${amount}`,
      bet: { _id: bet._id, selectedNumber: bet.selectedNumber, amount: bet.amount, status: bet.status },
      newBalance: gw.balance,
    });
  } catch (error) {
    console.error('BTC Number modify bet error:', error);
    res.status(500).json({ message: error.message });
  }
});

router.get('/btc-number/today', protectUser, async (req, res) => {
  try {
    const today = getTodayIST();
    const bets = await BtcNumberBet.find({ user: req.user._id, betDate: today }).sort({ createdAt: -1 });
    const settings = await GameSettings.getSettings();
    const maxBetsPerDay = settings.games?.btcNumber?.betsPerDay || 1;
    const totalBetsCount = bets.reduce((sum, b) => sum + (b.quantity || 1), 0);
    res.json({
      hasBet: bets.length > 0,
      betsCount: totalBetsCount,
      maxBetsPerDay,
      remaining: Math.max(0, maxBetsPerDay - totalBetsCount),
      bets: bets.map((b) => ({
        _id: b._id,
        selectedNumber: b.selectedNumber,
        amount: b.amount,
        quantity: b.quantity || 1,
        betDate: b.betDate,
        createdAt: b.createdAt,
        status: b.status,
        resultNumber: b.resultNumber,
        closingPrice: b.closingPrice,
        profit: b.profit,
        resultDeclaredAt: b.resultDeclaredAt,
      })),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/btc-number/history', protectUser, async (req, res) => {
  try {
    const bets = await BtcNumberBet.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(30);
    res.json(
      bets.map((b) => ({
        _id: b._id,
        selectedNumber: b.selectedNumber,
        amount: b.amount,
        quantity: b.quantity || 1,
        betDate: b.betDate,
        createdAt: b.createdAt,
        status: b.status,
        resultNumber: b.resultNumber,
        closingPrice: b.closingPrice,
        profit: b.profit,
        resultDeclaredAt: b.resultDeclaredAt,
      }))
    );
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/btc-number/daily-result', protectUser, async (req, res) => {
  try {
    const date = typeof req.query.date === 'string' && req.query.date.trim() ? req.query.date.trim() : getTodayIST();
    const settings = await GameSettings.getSettings();
    const bnCfg = settings?.games?.btcNumber || {};
    const isTodayQuery = date === getTodayIST();
    if (isTodayQuery) {
      const nowSec = currentTotalSecondsIST();
      const endSecInclusive = endInclusiveSecondsFromConfig(
        bnCfg.endTime || bnCfg.maxBidTime || bnCfg.biddingEndTime || '23:24'
      );
      // Until current configured endTime arrives, today's lock/result should be treated as not declared.
      if (nowSec < endSecInclusive) {
        return res.json({ declared: false, betDate: date });
      }
    }

    const settledBetRow = await BtcNumberBet.findOne({
      betDate: date,
      resultNumber: { $ne: null },
    })
      .sort({ resultDeclaredAt: -1, updatedAt: -1 })
      .select('resultNumber closingPrice resultDeclaredAt betDate')
      .lean();

    if (settledBetRow && settledBetRow.resultNumber != null) {
      return res.json({
        declared: true,
        betDate: date,
        resultNumber: settledBetRow.resultNumber,
        closingPrice:
          Number.isFinite(Number(settledBetRow.closingPrice)) && Number(settledBetRow.closingPrice) > 0
            ? Number(settledBetRow.closingPrice)
            : null,
        resultDeclaredAt: settledBetRow.resultDeclaredAt ?? null,
      });
    }

    // Fallback: show lock-based BTC Number result even when no bets were settled.
    const lockRow = await BtcJackpotResult.findOne({ resultDate: date })
      .select('resultDate lockedBtcPrice lockedAt')
      .lean();
    const lockPrice = Number(lockRow?.lockedBtcPrice);
    if (Number.isFinite(lockPrice) && lockPrice > 0) {
      const derived = closingPriceToLeftTwoDigits(lockPrice);
      if (derived != null) {
        return res.json({
          declared: true,
          betDate: date,
          resultNumber: derived,
          closingPrice: lockPrice,
          resultDeclaredAt: lockRow?.lockedAt || null,
          source: 'lock_price',
        });
      }
    }

    return res.json({ declared: false, betDate: date });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/btc-number/reference-price', protectUser, async (req, res) => {
  try {
    const date = typeof req.query.date === 'string' && req.query.date.trim() ? req.query.date.trim() : getTodayIST();
    const settings = await GameSettings.getSettings();
    const bnCfg = settings?.games?.btcNumber || {};
    const isTodayQuery = date === getTodayIST();
    if (isTodayQuery) {
      const nowSec = currentTotalSecondsIST();
      const endSecInclusive = endInclusiveSecondsFromConfig(
        bnCfg.endTime || bnCfg.maxBidTime || bnCfg.biddingEndTime || '23:24'
      );
      // If admin moved endTime ahead, keep today's reference in live mode until that new endTime hits.
      if (nowSec < endSecInclusive) {
        return res.json({ locked: false, betDate: date, referencePrice: null, lockedAt: null });
      }
    }

    const row = await BtcJackpotResult.findOne({ resultDate: date })
      .select('resultDate lockedBtcPrice lockedAt')
      .lean();

    if (!row || !Number.isFinite(Number(row.lockedBtcPrice)) || Number(row.lockedBtcPrice) <= 0) {
      return res.json({ locked: false, betDate: date, referencePrice: null, lockedAt: null });
    }

    return res.json({
      locked: true,
      betDate: date,
      referencePrice: Number(row.lockedBtcPrice),
      lockedAt: row.lockedAt || null,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/btc-number/last-5-days-results', protectUser, async (req, res) => {
  try {
    const settings = await GameSettings.getSettings();
    const bnCfg = settings?.games?.btcNumber || {};
    const today = getTodayIST();
    const nowSec = currentTotalSecondsIST();
    const todayEndInclusive = endInclusiveSecondsFromConfig(
      bnCfg.endTime || bnCfg.maxBidTime || bnCfg.biddingEndTime || '23:24'
    );

    const lockRows = await BtcJackpotResult.find({
      lockedBtcPrice: { $gt: 0 },
    })
      .sort({ resultDate: -1, lockedAt: -1 })
      .select('resultDate lockedBtcPrice lockedAt')
      .limit(20)
      .lean();

    const out = [];
    for (const r of lockRows) {
      // Don't show today's old lock while current configured endTime has not arrived yet.
      if (r.resultDate === today && nowSec < todayEndInclusive) continue;
      const closingPrice = Number(r?.lockedBtcPrice);
      const resultNumber = closingPriceToLeftTwoDigits(closingPrice);
      if (!Number.isFinite(closingPrice) || closingPrice <= 0 || resultNumber == null) continue;
      out.push({
        betDate: r.resultDate,
        resultNumber,
        closingPrice,
        resultDeclaredAt: r.lockedAt || null,
      });
      if (out.length >= 5) break;
    }

    return res.json(out);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==================== NIFTY BRACKET GAME ====================

// Place a bracket trade
router.post('/nifty-bracket/trade', protectUser, async (req, res) => {
  try {
    const { prediction, amount, entryPrice } = req.body;
    const userId = req.user._id;

    // Validate prediction
    if (!['BUY', 'SELL'].includes(prediction)) {
      return res.status(400).json({ message: 'Prediction must be BUY or SELL' });
    }

    // Get game settings
    const settings = await GameSettings.getSettings();
    const gameConfig = settings.games?.niftyBracket;
    if (!gameConfig?.enabled) {
      return res.status(400).json({ message: 'Nifty Bracket game is currently disabled' });
    }

    if (await rejectIfHierarchyGameDenied(res, userId, 'niftyBracket')) return;

    if (!isNiftyBracketBiddingHoursBypassedForTesting()) {
      const bidStart = gameConfig.biddingStartTime != null && String(gameConfig.biddingStartTime).trim() !== ''
        ? gameConfig.biddingStartTime
        : '09:15:29';
      const bidEnd = gameConfig.biddingEndTime != null && String(gameConfig.biddingEndTime).trim() !== ''
        ? gameConfig.biddingEndTime
        : '15:29';
      if (!isCurrentTimeWithinBracketBiddingIST(bidStart, bidEnd)) {
        return res.status(400).json({
          message: 'Nifty Bracket bidding is only open during market hours (see game settings).',
        });
      }
    }

    // Validate amount
    const betAmount = parseFloat(amount);
    if (isNaN(betAmount) || betAmount <= 0) {
      return res.status(400).json({ message: 'Invalid bet amount' });
    }
    const tValue =
      gameConfig.ticketPrice != null && Number.isFinite(Number(gameConfig.ticketPrice)) && Number(gameConfig.ticketPrice) > 0
        ? Number(gameConfig.ticketPrice)
        : settings.tokenValue || 300;
    const minAmt = (gameConfig.minTickets || 1) * tValue;
    const maxAmt = (gameConfig.maxTickets || 250) * tValue;
    if (betAmount < minAmt) {
      return res.status(400).json({ message: `Minimum bet is ${gameConfig.minTickets || 1} ticket(s) (${minAmt})` });
    }
    if (betAmount > maxAmt) {
      return res.status(400).json({ message: `Maximum bet is ${gameConfig.maxTickets || 250} ticket(s) (${maxAmt})` });
    }

    const bracketDayKey = getTodayISTString();
    const capBuyDay = Math.max(0, Number(gameConfig.maxTicketsBuyPerDay) || 0);
    const capSellDay = Math.max(0, Number(gameConfig.maxTicketsSellPerDay) || 0);
    const bracketSideCap = prediction === 'SELL' ? capSellDay : capBuyDay;
    if (bracketSideCap > 0) {
      const usedBracket = await sumBracketSideTicketsInDay(userId, prediction, bracketDayKey, tValue);
      const newBracketTickets = betAmount / tValue;
      if (usedBracket + newBracketTickets > bracketSideCap + 1e-6) {
        const leftB = Math.max(0, bracketSideCap - usedBracket);
        return res.status(400).json({
          message: `Max ${bracketSideCap} ${prediction} ticket(s) per day (${usedBracket.toFixed(2)} already used, ~${leftB.toFixed(2)} remaining).`,
        });
      }
    }

    const anchorToSpot = gameConfig.bracketAnchorToSpot !== false;
    let price;
    if (anchorToSpot) {
      const spot = await resolveNiftyJackpotSpotPrice();
      if (spot == null || !Number.isFinite(Number(spot)) || Number(spot) <= 0) {
        return res.status(503).json({ message: 'Nifty spot unavailable; try again shortly.' });
      }
      price = parseFloat(Number(spot).toFixed(2));
    } else {
      const ep = parseFloat(entryPrice);
      if (isNaN(ep) || ep <= 0) {
        return res.status(400).json({ message: 'Invalid entry price' });
      }
      price = ep;
    }

    const bracketGap = gameConfig.bracketGap || 20;
    const bracketGapType = gameConfig.bracketGapType || 'point';
    const bracketGapPercent = gameConfig.bracketGapPercent || 0.1;
    const expiryMinutes = gameConfig.expiryMinutes || 5;
    const winMultiplier =
      Number(gameConfig.winMultiplier) > 0 ? Number(gameConfig.winMultiplier) : 1.9;
    const brokeragePercent = gameConfig.brokeragePercent || 5;
    const settleAtResultTime = gameConfig.settleAtResultTime !== false;

    // Calculate bracket gap based on type (point or percentage)
    let gapValue;
    if (bracketGapType === 'percentage') {
      gapValue = price * (bracketGapPercent / 100);
    } else {
      gapValue = bracketGap;
    }

    const upperTarget = parseFloat((price + gapValue).toFixed(2));
    const lowerTarget = parseFloat((price - gapValue).toFixed(2));
    const refLine = prediction === 'BUY' ? upperTarget : lowerTarget;

    // Atomic debit — balance check + deduction in one MongoDB op (race-safe)
    const gw = await atomicGamesWalletDebit(User, userId, betAmount, { usedMargin: betAmount });
    if (!gw) {
      return res.status(400).json({ message: 'Insufficient balance in games wallet' });
    }

    // Create the trade — default: settle once at result time IST (e.g. 3:31 PM), not on short intraday expiry
    const resultTimeStr = gameConfig.resultTime != null && String(gameConfig.resultTime).trim() !== ''
      ? gameConfig.resultTime
      : '15:31';
    const expiresAt = settleAtResultTime
      ? getNextBracketSettlementDateIST(resultTimeStr)
      : new Date(Date.now() + expiryMinutes * 60 * 1000);
    const tradeData = {
      user: userId,
      entryPrice: refLine,
      spotAtOrder: price,
      upperTarget,
      lowerTarget,
      bracketGap,
      prediction,
      amount: betAmount,
      winMultiplier,
      brokeragePercent,
      expiresAt,
      status: 'active',
      settlesAtSessionClose: settleAtResultTime,
    };
    const uForAdmin = await User.findById(userId).select('admin').lean();
    if (uForAdmin?.admin) tradeData.admin = uForAdmin.admin;
    const trade = await NiftyBracketTrade.create(tradeData);

    await recordGamesWalletLedger(userId, {
      gameId: 'niftyBracket',
      entryType: 'debit',
      amount: betAmount,
      balanceAfter: gw.balance,
      description: `Nifty Bracket — ${prediction} trade`,
      orderPlacedAt: trade.createdAt,
      meta: {
        prediction,
        entryPrice: refLine,
        spotAtOrder: price,
        tickets: parseFloat((betAmount / tValue).toFixed(2)),
        tokenValue: tValue,
        tradeId: trade._id,
      },
    });

    res.json({
      message: 'Trade placed!',
      trade: {
        _id: trade._id,
        entryPrice: trade.entryPrice,
        spotAtOrder: trade.spotAtOrder,
        upperTarget: trade.upperTarget,
        lowerTarget: trade.lowerTarget,
        prediction: trade.prediction,
        amount: trade.amount,
        status: trade.status,
        expiresAt: trade.expiresAt,
        winMultiplier,
        brokeragePercent
      },
      newBalance: gw.balance
    });
  } catch (error) {
    console.error('Nifty Bracket trade error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get active Up/Down bets for current user
router.get('/updown/active', protectUser, async (req, res) => {
  try {
    const { gameId = 'updown' } = req.query;
    if (!['updown', 'btcupdown'].includes(gameId)) {
      return res.status(400).json({ message: 'Invalid game ID' });
    }

    const allDebitBets = await GamesWalletLedger.find({
      user: req.user._id,
      gameId,
      entryType: 'debit',
      description: { $regex: 'Up/Down.*bet.*\\(UP\\)|Up/Down.*bet.*\\(DOWN\\)', $options: 'i' },
    })
      .sort({ createdAt: -1 })
      .lean();

    const settlements = await UpDownWindowSettlement.find({
      user: req.user._id,
      gameId,
    })
      .select({ windowNumber: 1, settlementDay: 1 })
      .lean();

    const settledKey = (wn, day) => `${Number(wn)}|${day}`;
    const settledSet = new Set(
      settlements.map((s) => settledKey(s.windowNumber, s.settlementDay))
    );

    const winCredits = await GamesWalletLedger.find({
      user: req.user._id,
      gameId,
      entryType: 'credit',
      'meta.won': true,
    })
      .select({ meta: 1 })
      .sort({ createdAt: -1 })
      .limit(400)
      .lean();
    const paidWinKey = new Set();
    for (const c of winCredits) {
      const m = c.meta || {};
      const w = Number(m.windowNumber);
      const stake = Number(m.stake);
      if (!Number.isFinite(w) || !Number.isFinite(stake) || stake <= 0) continue;
      paidWinKey.add(`${w}|${stake.toFixed(2)}`);
    }

    const activeTrades = [];
    for (const bet of allDebitBets) {
      const wn = Number(bet.meta?.windowNumber);
      if (!Number.isFinite(wn)) continue;
      const day =
        typeof bet.meta?.settlementDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(bet.meta.settlementDay)
          ? bet.meta.settlementDay
          : getTodayISTString(bet.createdAt || new Date());
      const dayFromCreated = getTodayISTString(bet.createdAt || new Date());
      if (settledSet.has(settledKey(wn, day)) || settledSet.has(settledKey(wn, dayFromCreated))) continue;

      const stakeAmt = Number(bet.amount);
      if (Number.isFinite(stakeAmt) && stakeAmt > 0 && paidWinKey.has(`${wn}|${stakeAmt.toFixed(2)}`)) continue;

      activeTrades.push({
        _id: bet._id,
        prediction: bet.meta?.prediction || 'UP',
        amount: bet.amount,
        entryPrice: bet.meta?.entryPrice || 0,
        windowNumber: bet.meta?.windowNumber ?? wn,
        settlementDay: day,
        createdAt: bet.createdAt,
      });
    }

    res.json(activeTrades);
  } catch (error) {
    console.error('Error fetching active Up/Down bets:', error);
    res.status(500).json({ message: 'Failed to fetch active bets' });
  }
});

// Get Up/Down trade results for current user
router.get('/updown/results', protectUser, async (req, res) => {
  try {
    const { gameId = 'updown' } = req.query;
    if (!['updown', 'btcupdown'].includes(gameId)) {
      return res.status(400).json({ message: 'Invalid game ID' });
    }

    // Get recent credit entries (settled bets) from GamesWalletLedger
    const settledBets = await GamesWalletLedger.find({
      user: req.user._id,
      gameId,
      entryType: 'credit',
      'meta.won': { $exists: true }
    })
    .sort({ createdAt: -1 })
    .limit(10);

    const debitBetRe = /Up\/Down.*bet.*\(UP\)|Up\/Down.*bet.*\(DOWN\)/i;
    const toBetPlacedIso = (v) => {
      if (v == null || v === '') return null;
      const d = v instanceof Date ? v : new Date(v);
      const t = d.getTime();
      return Number.isFinite(t) ? d.toISOString() : null;
    };

    const results = await Promise.all(
      settledBets.map(async (bet) => {
        const m = bet.meta || {};
        let betPlacedAt = toBetPlacedIso(m.orderPlacedAt);
        if (!betPlacedAt) {
          const wn = Number(m.windowNumber);
          const stake = Number(m.stake);
          if (Number.isFinite(wn)) {
            const debitQ = {
              user: req.user._id,
              gameId,
              entryType: 'debit',
              description: { $regex: debitBetRe, $options: 'i' },
              $or: [{ 'meta.windowNumber': wn }, { 'meta.windowNumber': String(wn) }],
              createdAt: { $lte: bet.createdAt || new Date() },
            };
            if (Number.isFinite(stake) && stake > 0) debitQ.amount = stake;
            const debit = await GamesWalletLedger.findOne(debitQ)
              .sort({ createdAt: 1 })
              .select('createdAt')
              .lean();
            if (debit?.createdAt) betPlacedAt = new Date(debit.createdAt).toISOString();
          }
        }
        return {
          windowNumber: m.windowNumber || 0,
          prediction: m.prediction || 'UP',
          resultPrice: m.exitPrice || 0,
          won: m.won || false,
          pnl: bet.amount,
          createdAt: bet.createdAt,
          betPlacedAt,
        };
      })
    );

    res.json({ results });
  } catch (error) {
    console.error('Error fetching Up/Down results:', error);
    res.status(500).json({ message: 'Failed to fetch results' });
  }
});

// Manual settlement for Up/Down trades (ledger-based fallback; mirrors /game-bet/resolve economics)
router.post('/updown/manual-settle', protectUser, async (req, res) => {
  let settlementLock = null;
  try {
    const {
      gameId: rawGameId = 'updown',
      windowNumber,
      openPrice,
      closePrice,
      resultPrice,
      settlementDay: rawSettlementDay,
    } = req.body;
    const gameId = rawGameId === 'btcupdown' ? 'btcupdown' : 'updown';
    const wn = Number(windowNumber);

    if (!['updown', 'btcupdown'].includes(gameId)) {
      return res.status(400).json({ message: 'Invalid gameId' });
    }
    if (!Number.isFinite(wn)) {
      return res.status(400).json({ message: 'Window number is required' });
    }

    const settlementDay =
      typeof rawSettlementDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(String(rawSettlementDay).trim())
        ? String(rawSettlementDay).trim()
        : getTodayISTString();
    const dayStart = startOfISTDayFromKey(settlementDay);
    const dayEnd = endOfISTDayFromKey(settlementDay);
    if (!dayStart || !dayEnd) {
      return res.status(400).json({ message: 'Invalid settlementDay (use YYYY-MM-DD IST)' });
    }

    const officialManual = await GameResult.findOne({
      gameId,
      windowNumber: wn,
      windowDate: { $gte: dayStart, $lt: dayEnd },
    })
      .sort({ createdAt: -1 })
      .lean();
    const hasOfficial =
      officialManual &&
      Number.isFinite(Number(officialManual.openPrice)) &&
      Number.isFinite(Number(officialManual.closePrice)) &&
      Number(officialManual.openPrice) > 0 &&
      Number(officialManual.closePrice) > 0;

    let closePx = hasOfficial
      ? Number(officialManual.closePrice)
      : Number(closePrice ?? resultPrice);
    if (!Number.isFinite(closePx) || closePx <= 0) {
      return res.status(400).json({
        message:
          'closePrice or resultPrice (positive number) is required when no official GameResult exists for this window',
      });
    }

    if (gameId === 'btcupdown' && settlementDay === getTodayISTString()) {
      if (currentTotalSecondsIST() < btcResultRefSecForUiWindow(wn)) {
        return res.status(400).json({
          message:
            'BTC Up/Down: manual settlement is only allowed after the scheduled result time (IST) for this window.',
        });
      }
    }

    try {
      await UpDownWindowSettlement.create({
        user: req.user._id,
        gameId,
        windowNumber: wn,
        settlementDay,
      });
      settlementLock = { windowNumber: wn, settlementDay };
    } catch (e) {
      if (e.code === 11000) {
        return res.status(409).json({ message: 'This window was already settled for your account' });
      }
      throw e;
    }

    const debitBets = await GamesWalletLedger.find({
      user: req.user._id,
      gameId,
      entryType: 'debit',
      $or: [{ 'meta.windowNumber': wn }, { 'meta.windowNumber': String(wn) }],
      description: { $regex: 'Up/Down.*bet.*\\(UP\\)|Up/Down.*bet.*\\(DOWN\\)', $options: 'i' },
      createdAt: { $gte: dayStart, $lt: dayEnd },
    });

    if (debitBets.length === 0) {
      await UpDownWindowSettlement.deleteOne({ user: req.user._id, gameId, windowNumber: wn, settlementDay });
      return res.status(404).json({ message: 'No trades found for this window' });
    }

    let openPx = hasOfficial ? Number(officialManual.openPrice) : Number(openPrice);
    if (!hasOfficial && (!Number.isFinite(openPx) || openPx <= 0)) {
      const entries = debitBets
        .map((b) => Number(b.meta?.entryPrice))
        .filter((x) => Number.isFinite(x) && x > 0);
      openPx = entries.length ? Math.min(...entries) : NaN;
    }
    if (!Number.isFinite(openPx) || openPx <= 0) {
      await UpDownWindowSettlement.deleteOne({ user: req.user._id, gameId, windowNumber: wn, settlementDay });
      return res.status(400).json({
        message: 'openPrice is required (window open LTP), or bets must have entryPrice on ledger meta',
      });
    }

    let settingsResolve = null;
    try {
      settingsResolve = await GameSettings.getSettings();
    } catch (e) {
      console.warn('[MANUAL SETTLE] GameSettings load failed', e?.message);
    }
    const gameKeyCfg = gameId === 'btcupdown' ? 'btcUpDown' : 'niftyUpDown';
    const gcfg = settingsResolve?.games?.[gameKeyCfg] || {};
    const winMult = Number(gcfg.winMultiplier) > 0 ? Number(gcfg.winMultiplier) : 1.95;
    const brokPctManual =
      gcfg.brokeragePercent != null && Number.isFinite(Number(gcfg.brokeragePercent))
        ? Number(gcfg.brokeragePercent)
        : 0;
    const perTicket =
      gcfg?.ticketPrice != null && Number.isFinite(Number(gcfg.ticketPrice))
        ? Number(gcfg.ticketPrice)
        : (settingsResolve?.tokenValue || 300);
    const grossHierarchyPctSumManual =
      (Number(gcfg?.grossPrizeSubBrokerPercent) || 0) +
      (Number(gcfg?.grossPrizeBrokerPercent) || 0) +
      (Number(gcfg?.grossPrizeAdminPercent) || 0);
    const useGrossPrizeHierarchyManual = grossHierarchyPctSumManual > 0;

    let totalBalanceInc = 0;
    let totalMarginDec = 0;
    let totalPnl = 0;
    let totalBrokerage = 0;
    let settledCount = 0;
    let totalWinningStakeForReferral = 0;
    const ledgerEntries = [];
    const hierarchyJobsManual = [];

    const userDocManual = await User.findById(req.user._id).populate('admin');

    for (const bet of debitBets) {
      const amount = Number(bet.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      const prediction = bet.meta?.prediction === 'DOWN' ? 'DOWN' : 'UP';
      const authoritative = settleUpDownFromPrices(prediction, openPx, closePx);
      const won = authoritative === true;

      let brokerage = 0;
      let pnl;
      let creditTotal = 0;
      if (won) {
        const grossWin = amount * winMult;
        totalWinningStakeForReferral += amount;
        if (useGrossPrizeHierarchyManual && userDocManual) {
          const grossBreakdown = await computeNiftyJackpotGrossHierarchyBreakdown(
            userDocManual,
            grossWin,
            gcfg
          );
          brokerage = grossBreakdown.totalHierarchy;
          if (brokerage > grossWin) brokerage = grossWin;
          pnl = parseFloat((grossWin - amount).toFixed(2));
          creditTotal = parseFloat(Number(grossWin).toFixed(2));
          if (brokerage > 0 && grossBreakdown) {
            hierarchyJobsManual.push({ breakdown: grossBreakdown });
          }
        } else {
          const parts = computeUpDownWinPayout(amount, winMult, brokPctManual);
          brokerage = parts.brokerage;
          pnl = parts.pnl;
          creditTotal = parts.creditTotal;
          totalBrokerage += brokerage;
        }
      } else {
        pnl = -amount;
      }
      if (!Number.isFinite(pnl)) continue;

      totalMarginDec += amount;
      if (won) {
        totalBalanceInc += creditTotal;
        ledgerEntries.push({
          gameId,
          entryType: 'credit',
          amount: creditTotal,
          description: `${gameId === 'btcupdown' ? 'BTC' : 'Nifty'} Up/Down — win (gross payout; hierarchy from pool) [manual]`,
          meta: {
            won: true,
            stake: amount,
            pnl,
            brokerage,
            grossPrizeHierarchy: useGrossPrizeHierarchyManual,
            hierarchyPaidFromPoolExtra: brokerage > 0,
            tickets: parseFloat((amount / perTicket).toFixed(2)),
            tokenValue: perTicket,
            prediction,
            windowNumber: wn,
            entryPrice: openPx,
            exitPrice: closePx,
            manualSettle: true,
            orderPlacedAt: bet.createdAt,
          },
        });
      }
      totalPnl += pnl;
      settledCount += 1;
    }

    if (settledCount === 0) {
      await UpDownWindowSettlement.deleteOne({ user: req.user._id, gameId, windowNumber: wn, settlementDay });
      return res.status(400).json({ message: 'No valid trades could be settled' });
    }

    const isBtcManual = gameId === 'btcupdown';
    if (isBtcManual && totalBalanceInc > 0) {
      const poolDebit = await debitBtcUpDownSuperAdminPool(
        totalBalanceInc,
        `BTC Up/Down — win payout from pool [manual] (−${totalBalanceInc.toFixed(2)})`
      );
      if (!poolDebit.ok) {
        await UpDownWindowSettlement.deleteOne({ user: req.user._id, gameId, windowNumber: wn, settlementDay });
        return res.status(503).json({
          message:
            'BTC Up/Down payout failed: no active Super Admin wallet found. Configure an active Super Admin and retry settlement.',
        });
      }
    }

    const gw = await atomicGamesWalletUpdate(User, req.user._id, {
      balance: totalBalanceInc,
      usedMargin: -totalMarginDec,
      realizedPnL: totalPnl,
      todayRealizedPnL: totalPnl,
    });

    for (const entry of ledgerEntries) {
      await recordGamesWalletLedger(req.user._id, {
        ...entry,
        balanceAfter: gw.balance,
      });
    }

    if (isBtcManual) {
      if (useGrossPrizeHierarchyManual && userDocManual) {
        for (const job of hierarchyJobsManual) {
          await creditNiftyJackpotGrossHierarchyFromPool(req.user._id, userDocManual, job.breakdown, {
            gameLabel: 'BTC Up/Down',
            gameKey: gameKeyCfg,
            logTag: 'UpDownGrossHierarchy',
          });
        }
      } else if (totalBrokerage > 0 && userDocManual) {
        await distributeWinBrokerage(req.user._id, userDocManual, totalBrokerage, 'BTC UpDown', gameKeyCfg, {
          fundFromBtcPool: true,
          ledgerGameId: 'btcupdown',
          skipUserRebate: true,
        });
      }
    } else {
      if (useGrossPrizeHierarchyManual && userDocManual) {
        for (const job of hierarchyJobsManual) {
          await creditNiftyJackpotGrossHierarchyFromPool(req.user._id, userDocManual, job.breakdown, {
            gameLabel: 'Nifty Up/Down',
            gameKey: gameKeyCfg,
            logTag: 'UpDownGrossHierarchy',
          });
        }
      } else if (totalBrokerage > 0 && userDocManual) {
        await distributeWinBrokerage(req.user._id, userDocManual, totalBrokerage, 'Nifty UpDown', gameKeyCfg, {
          fundFromBtcPool: false,
          ledgerGameId: 'updown',
          skipUserRebate: true,
        });
      }
    }

    if (Number(totalWinningStakeForReferral) > 0) {
      const totalStakeInWindow = parseFloat(Number(totalMarginDec).toFixed(2));
      const gt = gameId === 'btcupdown' ? 'btcUpDown' : 'niftyUpDown';
      if (totalStakeInWindow > 0) {
        try {
          await creditReferralPerWinFromGameSettings(req.user._id, totalWinningStakeForReferral, gt, {
            windowNumber: wn,
            settlementDay,
            gameId,
            totalStakeInWindow,
          });
        } catch (refErr) {
          console.warn('[updown/manual-settle] referral per-win failed:', refErr?.message || refErr);
        }
      }
    }

    res.json({
      message: `Manual settle: ${settledCount} trade(s) for window ${wn}`,
      settledCount: ledgerEntries.length,
      totalCredited: totalBalanceInc,
      newBalance: gw.balance,
      openPrice: openPx,
      closePrice: closePx,
    });
  } catch (error) {
    if (settlementLock != null && req.user?._id) {
      const gid = req.body?.gameId === 'btcupdown' ? 'btcupdown' : 'updown';
      await UpDownWindowSettlement.deleteOne({
        user: req.user._id,
        gameId: gid,
        windowNumber: settlementLock.windowNumber,
        settlementDay: settlementLock.settlementDay,
      }).catch(() => {});
    }
    console.error('Error in manual settlement:', error);
    res.status(500).json({ message: error.message || 'Failed to settle trades' });
  }
});

// Get active bracket trades for current user
router.get('/nifty-bracket/active', protectUser, async (req, res) => {
  try {
    const trades = await NiftyBracketTrade.find({
      user: req.user._id,
      status: 'active'
    }).sort({ createdAt: -1 });

    res.json(trades.map(t => ({
        _id: t._id,
        entryPrice: t.entryPrice,
        spotAtOrder: t.spotAtOrder != null ? t.spotAtOrder : null,
        upperTarget: t.upperTarget,
        lowerTarget: t.lowerTarget,
        prediction: t.prediction,
        amount: t.amount,
        status: t.status,
        expiresAt: t.expiresAt,
        winMultiplier: t.winMultiplier,
        brokeragePercent: t.brokeragePercent,
        createdAt: t.createdAt,
        settlesAtSessionClose: t.settlesAtSessionClose === true,
      })));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get bracket trade history for current user
router.get('/nifty-bracket/history', protectUser, async (req, res) => {
  try {
    const trades = await NiftyBracketTrade.find({
      user: req.user._id,
      status: { $ne: 'active' }
    }).sort({ createdAt: -1 }).limit(50);

    res.json(trades.map(t => ({
      _id: t._id,
      entryPrice: t.entryPrice,
      spotAtOrder: t.spotAtOrder != null ? t.spotAtOrder : null,
      upperTarget: t.upperTarget,
      lowerTarget: t.lowerTarget,
      prediction: t.prediction,
      amount: t.amount,
      status: t.status,
      exitPrice: t.exitPrice,
      profit: t.profit,
      brokerageAmount: t.brokerageAmount,
      resolvedAt: t.resolvedAt,
      createdAt: t.createdAt
    })));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Resolve a bracket trade (called by socket/cron when price hits target or expires)
router.post('/nifty-bracket/resolve', protectUser, async (req, res) => {
  try {
    const { tradeId, currentPrice, forceMidRangeAsExpired: forceBody } = req.body;
    const trade = await NiftyBracketTrade.findOne({ _id: tradeId, user: req.user._id, status: 'active' });
    if (!trade) {
      return res.status(404).json({ message: 'Active trade not found' });
    }

    const manualSettleAllowed =
      process.env.NODE_ENV !== 'production' || process.env.ALLOW_USER_BRACKET_MANUAL_SETTLE === 'true';
    const forceMidRangeAsExpired = !!forceBody && manualSettleAllowed;

    try {
      const out = await resolveNiftyBracketTrade(trade, currentPrice, { forceMidRangeAsExpired });
      res.json({
        message: out.message,
        trade: out.trade,
        newBalance: out.newBalance,
      });
    } catch (e) {
      if (e.message === 'Trade is still active, no target hit yet') {
        return res.status(400).json({ message: e.message });
      }
      throw e;
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==================== NIFTY JACKPOT GAME ====================

/**
 * User-entered NIFTY level stored as niftyPriceAtBid (ranking vs live spot / locked close).
 * @returns {{ ok: true, value: number } | { ok: false, error: string }}
 */
function parseJackpotPredictedNiftyPrice(raw) {
  if (raw === undefined || raw === null || (typeof raw === 'string' && String(raw).trim() === '')) {
    return { ok: false, error: 'Predicted NIFTY price is required' };
  }
  const n =
    typeof raw === 'number' && Number.isFinite(raw)
      ? raw
      : parseFloat(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: 'Enter a valid positive NIFTY price' };
  }
  if (n < 1000 || n > 200000) {
    return { ok: false, error: 'Predicted price must be between 1,000 and 200,000' };
  }
  return { ok: true, value: Math.round(n * 100) / 100 };
}

// Place a jackpot bid — stake must be an integer number of tickets (amount = k × ticketPrice)
router.post('/nifty-jackpot/bid', protectUser, async (req, res) => {
  try {
    const { amount, predictedPrice } = req.body;
    const userId = req.user._id;
    const today = getTodayIST();

    // Get game settings
    const settings = await GameSettings.getSettings();
    const gameConfig = settings.games?.niftyJackpot;
    if (!gameConfig?.enabled) {
      return res.status(400).json({ message: 'Nifty Jackpot game is currently disabled' });
    }

    if (await rejectIfHierarchyGameDenied(res, userId, 'niftyJackpot')) return;

    // Check bidding time window (default: 09:15 to 14:59 IST)
    const biddingStartTime = gameConfig?.biddingStartTime || '09:15';
    const biddingEndTime = gameConfig?.biddingEndTime || '14:59';
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
    const istNow = new Date(now.getTime() + istOffset);
    const currentHours = istNow.getUTCHours();
    const currentMinutes = istNow.getUTCMinutes();
    const currentTimeMinutes = currentHours * 60 + currentMinutes;
    
    const [startH, startM] = biddingStartTime.split(':').map(Number);
    const [endH, endM] = biddingEndTime.split(':').map(Number);
    const startTimeMinutes = startH * 60 + startM;
    const endTimeMinutes = endH * 60 + endM + 1; // +1 to include 14:59:59

    if (!isNiftyJackpotBiddingHoursBypassedForTesting()) {
      if (currentTimeMinutes < startTimeMinutes || currentTimeMinutes > endTimeMinutes) {
        return res.status(400).json({
          message: `Bidding is only allowed from ${biddingStartTime} to ${biddingEndTime} IST. Current time: ${String(currentHours).padStart(2, '0')}:${String(currentMinutes).padStart(2, '0')} IST`,
        });
      }
    }

    // Validate amount
    const bidAmount = parseFloat(amount);
    if (isNaN(bidAmount) || bidAmount <= 0) {
      return res.status(400).json({ message: 'Invalid bid amount' });
    }
    const tValue = gameConfig?.ticketPrice || settings.tokenValue || 300;
    const oneTicketRs = Number(tValue);
    if (!Number.isFinite(oneTicketRs) || oneTicketRs <= 0) {
      return res.status(500).json({ message: 'Invalid ticket price configuration' });
    }
    const ticketUnits = Math.round(bidAmount / oneTicketRs);
    if (
      ticketUnits < 1 ||
      !Number.isFinite(ticketUnits) ||
      Math.abs(bidAmount - ticketUnits * oneTicketRs) > 0.01
    ) {
      return res.status(400).json({
        message: `Stake must be a whole number of tickets (multiple of ${oneTicketRs.toLocaleString('en-IN')} per ticket).`,
      });
    }
    const minTickets = Math.max(1, Math.min(5000, Number(gameConfig.minTickets) || 1));
    const maxPerRequest = Math.max(
      minTickets,
      Math.min(
        5000,
        Number(gameConfig.maxTicketsPerRequest) || Number(gameConfig.maxTickets) || 100
      )
    );
    if (ticketUnits < minTickets || ticketUnits > maxPerRequest) {
      return res.status(400).json({
        message: `Each request must be between ${minTickets} and ${maxPerRequest} ticket(s) (${oneTicketRs.toLocaleString('en-IN')} each).`,
      });
    }

    // One ticket per request: cap by number of separate bids today (not sum of tickets), so users can
    // place many sequential single-ticket bids. Multi-ticket requests: keep legacy total-tickets cap.
    const singleTicketFlow = maxPerRequest <= 1;
    if (singleTicketFlow) {
      let maxDailyBids = Math.min(
        5000,
        Number(gameConfig.bidsPerDay) || Number(gameConfig.maxTickets) || 100
      );
      // bidsPerDay was sometimes set to 1 together with maxTicketsPerRequest=1 meaning "one ticket per
      // click", which incorrectly limited the whole day to one ticket; treat as default daily bid budget.
      if (maxDailyBids === 1) maxDailyBids = 100;
      const bidsToday = await NiftyJackpotBid.countDocuments({
        $and: [{ user: userId }, buildNiftyJackpotIstDayQuery(today)],
      });
      if (bidsToday >= maxDailyBids) {
        return res.status(400).json({
          message: `Maximum ${maxDailyBids} bid(s) per day for Nifty Jackpot (${bidsToday} already placed). Try again tomorrow.`,
        });
      }
    } else {
      const maxTicketsDay = Math.max(
        1,
        Math.min(5000, Number(gameConfig.bidsPerDay) || Number(gameConfig.maxTickets) || 100)
      );
      const agg = await NiftyJackpotBid.aggregate([
        { $match: { $and: [{ user: userId }, buildNiftyJackpotIstDayQuery(today)] } },
        { $group: { _id: null, totalAmount: { $sum: '$amount' } } },
      ]);
      const amountUsedToday = Number(agg[0]?.totalAmount) || 0;
      const ticketsUsedToday = Math.round(amountUsedToday / oneTicketRs);
      if (ticketsUsedToday + ticketUnits > maxTicketsDay) {
        return res.status(400).json({
          message: `Maximum ${maxTicketsDay} ticket(s) per day for Nifty Jackpot (${ticketsUsedToday} already used). Try again tomorrow.`,
        });
      }
    }

    // Atomic debit — balance check + deduction in one MongoDB op (race-safe)
    const gw = await atomicGamesWalletDebit(User, userId, bidAmount, { usedMargin: bidAmount });
    if (!gw) {
      return res.status(400).json({ message: 'Insufficient balance in games wallet' });
    }

    let saCredited = false;
    try {
      await creditBtcUpDownSuperAdminPool(
        bidAmount,
        'Nifty Jackpot — stake to Super Admin pool (bet)'
      );
      saCredited = true;
    } catch (poolErr) {
      console.error('Nifty Jackpot: Super Admin pool credit failed:', poolErr);
      await atomicGamesWalletUpdate(User, userId, { balance: bidAmount, usedMargin: -bidAmount });
      return res.status(503).json({
        message: 'Could not route stake to house pool. Your games wallet was not charged.',
      });
    }

    // Get user admin info for bid record after successful debit
    const user = await User.findById(userId).select('admin');

    const priceParse = parseJackpotPredictedNiftyPrice(predictedPrice);
    if (!priceParse.ok) {
      if (saCredited) {
        await debitBtcUpDownSuperAdminPool(
          bidAmount,
          'Nifty Jackpot — rollback Super Admin pool (invalid predicted price)'
        );
      }
      await atomicGamesWalletUpdate(User, userId, { balance: bidAmount, usedMargin: -bidAmount });
      return res.status(400).json({ message: priceParse.error });
    }
    const niftyPriceAtBid = priceParse.value;

    try {
      const bidData = {
        user: userId,
        amount: bidAmount,
        ticketCount: ticketUnits,
        betDate: today,
        status: 'pending',
        niftyPriceAtBid,
      };
      if (user?.admin) bidData.admin = user.admin;
      const bid = await NiftyJackpotBid.create(bidData);

      await recordGamesWalletLedger(userId, {
        gameId: 'niftyJackpot',
        entryType: 'debit',
        amount: bidAmount,
        balanceAfter: gw.balance,
        description:
          ticketUnits === 1 ? 'Nifty Jackpot — 1 ticket' : `Nifty Jackpot — ${ticketUnits} tickets`,
        orderPlacedAt: bid.createdAt,
        meta: {
          betDate: today,
          tickets: ticketUnits,
          tokenValue: tValue,
          niftyPriceAtBid,
          bidId: bid._id,
        },
      });

      res.json({
        message: 'Bid placed successfully!',
        bid: {
          _id: bid._id,
          amount: bid.amount,
          betDate: bid.betDate,
          status: bid.status,
          niftyPriceAtBid: bid.niftyPriceAtBid,
        },
        newBalance: gw.balance,
      });
    } catch (innerErr) {
      if (saCredited) {
        await debitBtcUpDownSuperAdminPool(
          bidAmount,
          'Nifty Jackpot — rollback Super Admin pool (bid persist failed)'
        );
      }
      await atomicGamesWalletUpdate(User, userId, { balance: bidAmount, usedMargin: -bidAmount });
      console.error('Nifty Jackpot bid error:', innerErr);
      throw innerErr;
    }
  } catch (error) {
    console.error('Nifty Jackpot bid error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Update pending bid: set predicted NIFTY (body.predictedPrice), or refresh from live spot if omitted (no cancel, no stake change)
router.put('/nifty-jackpot/bid/:id', protectUser, async (req, res) => {
  try {
    const bidId = req.params.id;
    if (!bidId || !/^[a-fA-F0-9]{24}$/.test(bidId)) {
      return res.status(400).json({ message: 'Invalid bid id' });
    }
    const userId = req.user._id;
    const today = getTodayIST();

    const settings = await GameSettings.getSettings();
    const gameConfig = settings.games?.niftyJackpot;
    if (!gameConfig?.enabled) {
      return res.status(400).json({ message: 'Nifty Jackpot game is currently disabled' });
    }

    const biddingStartTime = gameConfig?.biddingStartTime || '09:15';
    const biddingEndTime = gameConfig?.biddingEndTime || '14:59';
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);
    const currentHours = istNow.getUTCHours();
    const currentMinutes = istNow.getUTCMinutes();
    const currentTimeMinutes = currentHours * 60 + currentMinutes;
    const [startH, startM] = biddingStartTime.split(':').map(Number);
    const [endH, endM] = biddingEndTime.split(':').map(Number);
    const startTimeMinutes = startH * 60 + startM;
    const endTimeMinutes = endH * 60 + endM + 1;

    if (!isNiftyJackpotBiddingHoursBypassedForTesting()) {
      if (currentTimeMinutes < startTimeMinutes || currentTimeMinutes > endTimeMinutes) {
        return res.status(400).json({
          message: `Bidding window closed (${biddingStartTime}–${biddingEndTime} IST). Orders cannot be modified.`,
        });
      }
    }

    const bid = await NiftyJackpotBid.findOne({
      $and: [{ _id: bidId }, { user: userId }, buildNiftyJackpotIstDayQuery(today)],
    });
    if (!bid) {
      return res.status(404).json({ message: 'Bid not found' });
    }
    if (bid.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending bids can be modified' });
    }

    const { predictedPrice } = req.body;
    let niftyPriceAtBid;

    if (predictedPrice !== undefined && predictedPrice !== null && String(predictedPrice).trim() !== '') {
      const priceParse = parseJackpotPredictedNiftyPrice(predictedPrice);
      if (!priceParse.ok) {
        return res.status(400).json({ message: priceParse.error });
      }
      niftyPriceAtBid = priceParse.value;
    } else {
      niftyPriceAtBid = null;
      const md = getMarketData();
      const niftyWs = md['256265'] || md['99926000'];
      if (niftyWs?.ltp != null && Number.isFinite(Number(niftyWs.ltp))) {
        niftyPriceAtBid = Number(niftyWs.ltp);
      }
      if (niftyPriceAtBid == null) {
        niftyPriceAtBid = await fetchNifty50LastPriceFromKite();
      }
      if (niftyPriceAtBid == null) {
        niftyPriceAtBid = getDummyNiftyWhenMarketClosedForTesting();
      }
    }

    bid.niftyPriceAtBid = niftyPriceAtBid;
    await bid.save();

    res.json({
      message:
        predictedPrice !== undefined && predictedPrice !== null && String(predictedPrice).trim() !== ''
          ? 'Order updated (predicted NIFTY saved)'
          : 'Order updated (NIFTY at bid refreshed from live)',
      bid: {
        _id: bid._id,
        amount: bid.amount,
        betDate: bid.betDate,
        status: bid.status,
        niftyPriceAtBid: bid.niftyPriceAtBid,
      },
    });
  } catch (error) {
    console.error('Nifty Jackpot modify error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get today's bids for current user (multiple entries; ticket count may be >1 per bid)
router.get('/nifty-jackpot/today', protectUser, async (req, res) => {
  try {
    const today = getTodayIST();
    const settings = await GameSettings.getSettings();
    const settingsObj = settings && typeof settings === 'object' ? settings : {};
    const gamesCfg = settingsObj.games && typeof settingsObj.games === 'object' ? settingsObj.games : {};
    const oneTicketRs = Number(gamesCfg?.niftyJackpot?.ticketPrice || settingsObj.tokenValue || 300);
    const safeTicketRs = Number.isFinite(oneTicketRs) && oneTicketRs > 0 ? oneTicketRs : 300;
    const bids = await NiftyJackpotBid.find({
      $and: [{ user: req.user._id }, buildNiftyJackpotIstDayQuery(today)],
    }).sort({ createdAt: -1 });
    const ticketsToday = bids.reduce(
      (s, b) => s + niftyJackpotTicketUnitsForBid(b, safeTicketRs),
      0
    );
    const totalStakedToday = bids.reduce((s, b) => s + (Number(b.amount) || 0), 0);
    const latestBid = bids[0] || null;

    res.json({
      hasBid: ticketsToday > 0,
      ticketsToday,
      totalStakedToday,
      bid: latestBid
        ? {
            _id: latestBid._id,
            amount: latestBid.amount,
            betDate: latestBid.betDate,
            status: latestBid.status,
            rank: latestBid.rank,
            prize: latestBid.prize,
            resultDeclaredAt: latestBid.resultDeclaredAt,
            niftyPriceAtBid: latestBid.niftyPriceAtBid,
          }
        : null,
      bids: bids.map((b) => ({
          _id: b._id,
          amount: b.amount,
          ticketCount: niftyJackpotTicketUnitsForBid(b, safeTicketRs),
          status: b.status,
          rank: b.rank,
          prize: b.prize,
          niftyPriceAtBid: b.niftyPriceAtBid,
          createdAt: b.createdAt,
        })),
    });
  } catch (error) {
    console.error('[nifty-jackpot/today] error:', error);
    // Avoid repeated 500 polling loops on client.
    return res.json({
      hasBid: false,
      ticketsToday: 0,
      totalStakedToday: 0,
      bid: null,
      bids: [],
      degraded: true,
      message: error.message,
    });
  }
});

// Get live leaderboard — each row is one ticket; nearest to reference, then earlier bid time.
// Before result: reference = live NIFTY spot. After declare: reference = locked close (same as settlement).
router.get('/nifty-jackpot/leaderboard', protectUser, getNiftyJackpotLeaderboard);

// Get bid history for current user
router.get('/nifty-jackpot/history', protectUser, async (req, res) => {
  try {
    const bids = await NiftyJackpotBid.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(30);

    res.json(bids.map(b => ({
      _id: b._id,
      amount: b.amount,
      betDate: b.betDate,
      status: b.status,
      rank: b.rank,
      prize: b.prize,
      resultDeclaredAt: b.resultDeclaredAt,
      niftyPriceAtBid: b.niftyPriceAtBid ?? null,
    })));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get locked Nifty price for today (user-facing)
router.get('/nifty-jackpot/locked-price', protectUser, async (req, res) => {
  try {
    const date = req.query.date || getTodayIST();
    const result = await NiftyJackpotResult.findOne({ resultDate: date });
    res.json({
      date,
      locked: !!result,
      lockedPrice: result?.lockedPrice || null,
      lockedAt: result?.lockedAt || null,
      resultDeclared: result?.resultDeclared || false
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Nifty jackpot clearing
router.get('/nifty-jackpot/last-5-days-clearing', protectUser, getNiftyJackpotLast5DaysClearing);

// Get last 5 days closing prices for Nifty Jackpot
router.get('/nifty-jackpot/last-5-days', protectUser, async (req, res) => {
  try {
    const results = await NiftyJackpotResult.find({
      lockedPrice: { $exists: true, $ne: null }
    })
      .sort({ resultDate: -1 })
      .limit(5)
      .select('resultDate lockedPrice lockedAt resultDeclared')
      .lean();
    
    res.json(results);
  } catch (error) {
    console.error('Error fetching last 5 days for Nifty Jackpot:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get last 5 days closing LTP for Nifty Bracket
router.get('/nifty-bracket/last-5-days', protectUser, getNiftyBracketLast5Days);

// Get current Nifty LTP (for testing)
router.get('/nifty-current-ltp', protectUser, async (req, res) => {
  try {
    const { fetchNifty50LastPriceFromKite } = await import('../utils/kiteNiftyQuote.js');
    
    const currentLTP = await fetchNifty50LastPriceFromKite();
    
    if (currentLTP) {
      res.json({
        currentLTP: Number(currentLTP),
        timestamp: new Date().toISOString(),
        note: 'Current real-time LTP from Kite'
      });
    } else {
      res.status(404).json({ 
        message: 'Could not fetch current LTP',
        error: 'No session or API unavailable'
      });
    }
  } catch (error) {
    console.error('Error fetching current LTP:', error);
    res.status(500).json({ message: error.message });
  }
});

// OTP operations
router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTP);

// Get user's referral amounts
// Referral operations
router.get('/referral-amounts', protectUser, ReferralController.getReferralAmounts);

export default router;
