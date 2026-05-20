/**
 * User Controller
 * 
 * Clean architecture implementation for user operations following SOLID principles.
 * Handles business logic orchestration for user management, authentication, and operations.
 * 
 * Controller Responsibilities:
 * 1. Request validation and response formatting
 * 2. Business logic orchestration
 * 3. Error handling and status codes
 * 4. Service layer coordination
 */

import User from '../models/User.js';
import Admin from '../models/Admin.js';
import SystemSettings from '../models/SystemSettings.js';
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
import GamesWalletLedger from '../models/GamesWalletLedger.js';
import WalletLedger from '../models/WalletLedger.js';
import WalletTransferService from '../services/walletTransferService.js';
import { buildUserPlatformChargeStatus } from '../services/platformChargeService.js';
import {
  assertHierarchyGameNotDeniedForUserId,
} from '../services/gameRestrictionService.js';
import { 
  createTransactionSlip, 
  addDebitEntry, 
  findTransactionSlipByTransactionId,
  addCreditEntry,
  addBrokerageDistributionEntries
} from '../services/gameTransactionSlipService.js';
import { getTodayISTString, startOfISTDayFromKey, endOfISTDayFromKey } from '../utils/istDate.js';
import { 
  sumUpDownSideTicketsInWindow,
  sumBracketSideTicketsInDay,
} from '../utils/gameStakeSideLimits.js';
import { plainSegmentDefaultsMap } from '../utils/commissionTypeUnit.js';
import TradeService from '../services/tradeService.js';

// ==================== AUTHENTICATION CONTROLLERS ====================

/**
 * Register a new user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const registerUser = async (req, res) => {
  try {
    const { username, email, password, fullName, phone, phoneVerified, adminCode, referralCode } = req.body;
    
    let admin;
    let referrerUser = null;
    
    // Find admin based on admin code or referral code
    if (adminCode) {
      admin = await Admin.findOne({ adminCode: adminCode.trim().toUpperCase() });
      if (!admin) {
        return res.status(400).json({ message: 'Invalid admin code' });
      }
      if (admin.status !== 'ACTIVE') {
        return res.status(400).json({ message: 'Admin is not active. Contact support.' });
      }
    } else if (referralCode) {
      // Check user referral first
      referrerUser = await User.findOne({ referralCode: referralCode.trim().toUpperCase() });
      
      if (referrerUser) {
        admin = await Admin.findById(referrerUser.admin);
        if (!admin || admin.status !== 'ACTIVE') {
          return res.status(400).json({ message: 'Referrer admin is not active. Contact support.' });
        }
      } else {
        // Check admin referral
        admin = await Admin.findOne({ referralCode: referralCode.trim().toUpperCase() });
        if (!admin) {
          return res.status(400).json({ message: 'Invalid referral code' });
        }
        if (admin.status !== 'ACTIVE') {
          return res.status(400).json({ message: 'Admin is not active. Contact support.' });
        }
      }
    } else {
      // Default to Super Admin
      admin = await Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' });
      if (!admin) {
        return res.status(400).json({ message: 'System not configured. Please contact support.' });
      }
    }
    
    // Check if user already exists
    const userExists = await User.findOne({ $or: [{ email }, { username }] });
    if (userExists) {
      return res.status(400).json({ message: 'User with this email or username already exists' });
    }

    // Generate unique referral code
    const generateUserReferralCode = () => {
      const timestamp = Date.now().toString(36).toUpperCase();
      const random = Math.random().toString(36).substring(2, 6).toUpperCase();
      return `REF${timestamp}${random}`;
    };

    let userReferralCode = generateUserReferralCode();
    let existingUserWithCode = await User.findOne({ referralCode: userReferralCode });
    while (existingUserWithCode) {
      userReferralCode = generateUserReferralCode();
      existingUserWithCode = await User.findOne({ referralCode: userReferralCode });
    }

    // Create user
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

    // Create referral record if applicable
    if (referrerUser) {
      const Referral = (await import('../models/Referral.js')).default;
      await Referral.create({
        referrer: referrerUser._id,
        referredUser: user._id,
        referralCode: referralCode.trim().toUpperCase(),
        status: 'ACTIVE',
        createdAt: new Date()
      });
    }

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        adminCode: user.adminCode,
        referralCode: user.referralCode
      }
    });
  } catch (error) {
    console.error('[UserController] Error in user registration:', error);
    res.status(500).json({ message: 'Registration failed', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

/**
 * User login
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).populate('createdBy', 'adminCode name username role');
    
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (!user.isActive) {
      return res.status(401).json({ message: 'Your account has been deactivated. Contact your admin.' });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate tokens
    const { generateToken, generateSessionToken } = await import('../middleware/auth.js');
    const token = generateToken(user._id);
    const sessionToken = generateSessionToken();

    // Update session token
    user.activeSessionToken = sessionToken;
    await user.save();

    res.json({
      message: 'Login successful',
      token,
      sessionToken,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        phoneVerified: user.phoneVerified,
        isDemo: user.isDemo,
        adminCode: user.adminCode,
        referralCode: user.referralCode,
        referredBy: user.referredBy,
        referralStats: user.referralStats,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        createdBy: user.createdBy
      }
    });
  } catch (error) {
    console.error('[UserController] Error in user login:', error);
    res.status(500).json({ message: 'Login failed', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

/**
 * User logout
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const logoutUser = async (req, res) => {
  try {
    await User.updateOne(
      { _id: req.user._id },
      { $unset: { activeSessionToken: 1 } }
    );
    
    res.json({ message: 'Logout successful' });
  } catch (error) {
    console.error('[UserController] Error in user logout:', error);
    res.status(500).json({ message: 'Logout failed' });
  }
};

// ==================== PROFILE CONTROLLERS ====================

/**
 * Get user profile
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.json(user);
  } catch (error) {
    console.error('[UserController] Error getting user profile:', error);
    res.status(500).json({ message: 'Failed to get profile' });
  }
};

/**
 * Update user profile
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const updateUserProfile = async (req, res) => {
  try {
    const { fullName, phone } = req.body;
    
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (fullName) user.fullName = fullName;
    if (phone) user.phone = phone;

    await user.save();

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        phoneVerified: user.phoneVerified,
        adminCode: user.adminCode,
        referralCode: user.referralCode
      }
    });
  } catch (error) {
    console.error('[UserController] Error updating user profile:', error);
    res.status(500).json({ message: 'Failed to update profile' });
  }
};

/**
 * Change user password
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const changeUserPassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Verify old password
    const isOldPasswordValid = await user.comparePassword(oldPassword);
    if (!isOldPasswordValid) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('[UserController] Error changing password:', error);
    res.status(500).json({ message: 'Failed to change password' });
  }
};

// ==================== WALLET CONTROLLERS ====================

/**
 * Get user wallet information
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const getUserWallet = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('wallet cryptoWallet forexWallet mcxWallet gamesWallet marginSettings rmsSettings');
    let gamesTicketValue = 300;
    
    // Get games ticket value from settings
    try {
      const settings = await GameSettings.getSettings();
      if (settings?.games?.ticketValue) {
        gamesTicketValue = settings.games.ticketValue;
      }
    } catch (settingsError) {
      console.warn('[UserController] Could not fetch game settings for ticket value:', settingsError);
    }

    // Calculate games wallet ticket count
    const gamesTicketCount = user.gamesWallet ? Math.floor(user.gamesWallet / gamesTicketValue) : 0;

    res.json({
      wallet: user.wallet || 0,
      cryptoWallet: user.cryptoWallet || 0,
      forexWallet: user.forexWallet || 0,
      mcxWallet: user.mcxWallet || 0,
      gamesWallet: user.gamesWallet || 0,
      gamesTicketValue,
      gamesTicketCount,
      marginSettings: user.marginSettings || {},
      rmsSettings: user.rmsSettings || {}
    });
  } catch (error) {
    console.error('[UserController] Error getting user wallet:', error);
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
    console.error('[UserController] Error getting platform charge status:', error);
    res.status(500).json({ message: 'Failed to get platform charge status' });
  }
};

// ==================== PUBLIC CONTROLLERS ====================

/**
 * Get broker info by referral code
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const getBrokerInfoByReferralCode = async (req, res) => {
  try {
    const { referralCode } = req.params;
    
    const broker = await Admin.findOne({ 
      referralCode: referralCode.toUpperCase(),
      status: 'ACTIVE'
    })
    .select('name username branding certificate adminCode referralCode')
    .populate('parentId', 'name adminCode role');

    if (!broker) {
      return res.status(404).json({ message: 'Broker not found' });
    }

    res.json({
      name: broker.name,
      username: broker.username,
      adminCode: broker.adminCode,
      referralCode: broker.referralCode,
      branding: broker.branding || {},
      certificate: broker.certificate || {},
      parent: broker.parentId || null
    });
  } catch (error) {
    console.error('[UserController] Error getting broker info:', error);
    res.status(500).json({ message: 'Failed to get broker information' });
  }
};

/**
 * Get certified brokers for landing page
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const getCertifiedBrokers = async (req, res) => {
  try {
    const brokers = await Admin.find({
      role: 'BROKER',
      status: 'ACTIVE',
      'certificate.isCertified': true
    })
    .select('name username branding certificate adminCode referralCode stats')
    .populate('parentId', 'name adminCode role')
    .sort({ 'certificate.rating': -1, createdAt: -1 });

    const formattedBrokers = await Promise.all(brokers.map(async (broker) => ({
      id: broker._id,
      name: broker.name,
      username: broker.username,
      branding: broker.branding || {},
      logoUrl: broker.branding?.logoUrl || '',
      certificateNumber: broker.certificate?.certificateNumber || '',
      description: broker.certificate?.description || '',
      specialization: broker.certificate?.specialization || '',
      yearsOfExperience: broker.certificate?.yearsOfExperience || 0,
      totalClients: broker.certificate?.totalClients || broker.stats?.totalUsers || 0,
      rating: broker.certificate?.rating || 5,
      referralCode: broker.referralCode,
      adminCode: broker.adminCode
    })));

    res.json({ brokers: formattedBrokers });
  } catch (error) {
    console.error('[UserController] Error fetching certified brokers:', error);
    res.status(500).json({ message: 'Failed to fetch brokers' });
  }
};
