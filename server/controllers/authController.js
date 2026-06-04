/**
 * Authentication Controller
 * 
 * Clean architecture implementation for user authentication operations.
 * Handles user registration, login, logout, and related authentication functions.
 * 
 * Controller Responsibilities:
 * 1. Request validation and response formatting
 * 2. Authentication business logic orchestration
 * 3. Session management
 * 4. Error handling and status codes
 */

import User from '../models/User.js';
import Admin from '../models/Admin.js';
import { generateToken } from '../middleware/auth.js';
import { sendOTP as sendOTPService, verifyOTP as verifyOTPService } from '../services/otpService.js';

// ==================== USER REGISTRATION ====================

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
    console.error('[AuthController] Error in user registration:', error);
    res.status(500).json({ message: 'Registration failed', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

/**
 * Create demo account
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const registerDemoUser = async (req, res) => {
  try {
    const { username, email, password, fullName, phone, referralCode: referralCodeRaw } = req.body;
    const referralCode = typeof referralCodeRaw === 'string' && referralCodeRaw.trim()
      ? referralCodeRaw.trim().toUpperCase()
      : null;
    
    let admin;
    let referrerUser = null;
    
    // Handle referral code for demo accounts
    if (referralCode) {
      referrerUser = await User.findOne({ referralCode });
      
      if (referrerUser) {
        admin = await Admin.findById(referrerUser.admin);
        if (!admin || admin.status !== 'ACTIVE') {
          return res.status(400).json({ message: 'Referrer admin is not active' });
        }
      } else {
        admin = await Admin.findOne({ referralCode });
        if (!admin || admin.status !== 'ACTIVE') {
          return res.status(400).json({ message: 'Invalid referral code or admin not active' });
        }
      }
    } else {
      // Default to Super Admin for demo accounts
      admin = await Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' });
      if (!admin) {
        return res.status(400).json({ message: 'System not configured' });
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

    // Create demo user
    const user = await User.create({
      username,
      email,
      password,
      fullName,
      phone,
      admin: admin._id,
      adminCode: admin.adminCode,
      createdBy: admin._id,
      referralCode: userReferralCode,
      referredBy: referrerUser?._id || null,
      isDemo: true,
      wallet: 100000, // Demo balance
      cryptoWallet: 100000,
      forexWallet: 100000,
      mcxWallet: 100000,
      gamesWallet: 100000,
      demoExpiresAt: await (async () => {
        const { buildDemoExpiresAt } = await import('../utils/demoAccountUtils.js');
        return buildDemoExpiresAt(new Date());
      })(),
    });

    // Create referral record if applicable
    if (referrerUser) {
      const Referral = (await import('../models/Referral.js')).default;
      await Referral.create({
        referrer: referrerUser._id,
        referredUser: user._id,
        referralCode,
        status: 'ACTIVE',
        createdAt: new Date()
      });
    }

    res.status(201).json({
      message: 'Demo account created successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        isDemo: true,
        adminCode: user.adminCode,
        referralCode: user.referralCode,
        demoExpiresAt: user.demoExpiresAt
      }
    });
  } catch (error) {
    console.error('[AuthController] Error in demo registration:', error);
    res.status(500).json({ message: 'Demo registration failed', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

// ==================== USER LOGIN ====================

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

    // Track login metadata (web + mobile may be active concurrently).
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

    const parentAdmin = user.createdBy
      ? {
          adminCode: user.createdBy.adminCode,
          name: user.createdBy.name || user.createdBy.username,
          role: user.createdBy.role
        }
      : null;

    // Keep response shape backward-compatible with existing client/auth context.
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
      parentAdmin,
      token: generateToken(user._id)
    });
  } catch (error) {
    console.error('[AuthController] Error in user login:', error);
    res.status(500).json({ message: 'Login failed', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

// ==================== USER LOGOUT ====================

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
      { isLogin: false }
    );
    
    res.json({ message: 'Logout successful' });
  } catch (error) {
    console.error('[AuthController] Error in user logout:', error);
    res.status(500).json({ message: 'Logout failed' });
  }
};

// ==================== PARENT INFO ====================

/**
 * Get parent admin info by email
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const getParentInfo = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get user's admin
    const admin = await Admin.findById(user.admin).select('name username adminCode branding');
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    res.json({
      admin: {
        name: admin.name,
        username: admin.username,
        adminCode: admin.adminCode,
        branding: admin.branding || {}
      }
    });
  } catch (error) {
    console.error('[AuthController] Error getting parent info:', error);
    res.status(500).json({ message: 'Failed to get parent information' });
  }
};

// ==================== OTP OPERATIONS ====================

/**
 * Send OTP to phone number
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const sendOTP = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ message: 'Phone number is required' });
    }

    // Validate phone format (10 digits)
    const phoneRegex = /^[0-9]{10}$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({ message: 'Invalid phone number. Must be 10 digits.' });
    }

    // Check if phone already exists
    const existingUser = await User.findOne({ phone });
    if (existingUser) {
      return res.status(400).json({ message: 'Phone number already registered' });
    }

    // Send OTP using OTP service
    const result = await sendOTPService(phone);
    res.json(result);
  } catch (error) {
    console.error('[AuthController] Error sending OTP:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Verify OTP
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const verifyOTP = async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ message: 'Phone and OTP are required' });
    }

    // Verify OTP using OTP service
    const result = verifyOTPService(phone, otp);
    res.json(result);
  } catch (error) {
    console.error('[AuthController] Error verifying OTP:', error);
    res.status(500).json({ message: error.message });
  }
};
