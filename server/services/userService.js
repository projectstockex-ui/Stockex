/**
 * User Service
 * 
 * Clean architecture implementation for user business logic.
 * Handles user creation, authentication, validation, and related operations.
 * 
 * Service Responsibilities:
 * 1. User creation and validation logic
 * 2. Authentication business rules
 * 3. Referral code generation and validation
 * 4. User hierarchy management
 */

import User from '../models/User.js';
import Admin from '../models/Admin.js';
import bcrypt from 'bcryptjs';

// ==================== USER CREATION ====================

/**
 * Create a new user with proper validation
 * @param {Object} userData - User data
 * @returns {Promise<Object>} - Created user object
 */
export const createUser = async (userData) => {
  const {
    username,
    email,
    password,
    fullName,
    phone,
    phoneVerified,
    adminCode,
    referralCode,
    isDemo = false
  } = userData;

  // Validate user data
  await validateUserData(userData);

  // Find admin
  const admin = await findUserAdmin(adminCode, referralCode);
  if (!admin) {
    throw new Error('Invalid admin or referral code');
  }

  // Check for existing user
  const existingUser = await User.findOne({ $or: [{ email }, { username }] });
  if (existingUser) {
    throw new Error('User with this email or username already exists');
  }

  // Generate referral code
  const userReferralCode = await generateUniqueReferralCode();

  // Create user object
  const userObject = {
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
    isDemo
  };

  // Add demo-specific fields if demo account
  if (isDemo) {
    userObject.wallet = 100000;
    userObject.cryptoWallet = 100000;
    userObject.forexWallet = 100000;
    userObject.mcxWallet = 100000;
    userObject.gamesWallet = 100000;
    const { buildDemoExpiresAt } = await import('../utils/demoAccountUtils.js');
    userObject.demoExpiresAt = await buildDemoExpiresAt(new Date());
  }

  // Handle referral
  let referrerUser = null;
  if (referralCode) {
    referrerUser = await handleReferralCode(referralCode, admin._id);
    if (referrerUser) {
      userObject.referredBy = referrerUser._id;
    }
  }

  // Create user
  const user = await User.create(userObject);

  // Create referral record if applicable
  if (referrerUser) {
    await createReferralRecord(referrerUser._id, user._id, referralCode);
  }

  return user;
};

// ==================== USER AUTHENTICATION ====================

/**
 * Authenticate user credentials
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<Object>} - Authenticated user object
 */
export const authenticateUser = async (email, password) => {
  const user = await User.findOne({ email }).populate('createdBy', 'adminCode name username role');
  
  if (!user) {
    throw new Error('Invalid email or password');
  }

  if (!user.isActive) {
    throw new Error('Your account has been deactivated. Contact your admin.');
  }

  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    throw new Error('Invalid email or password');
  }

  return user;
};

/**
 * Update user session information
 * @param {string} userId - User ID
 * @param {string} sessionToken - Session token
 * @returns {Promise<void>}
 */
export const updateUserSession = async (userId, sessionToken) => {
  await User.updateOne(
    { _id: userId },
    { 
      lastLogin: new Date(),
      activeSessionToken: sessionToken
    }
  );
};

/**
 * Clear user session
 * @param {string} userId - User ID
 * @returns {Promise<void>}
 */
export const clearUserSession = async (userId) => {
  await User.updateOne(
    { _id: userId },
    { $unset: { activeSessionToken: 1 } }
  );
};

// ==================== USER VALIDATION ====================

/**
 * Validate user data
 * @param {Object} userData - User data to validate
 * @returns {Promise<void>}
 */
export const validateUserData = async (userData) => {
  const { username, email, password, fullName, phone } = userData;

  // Validate required fields
  if (!username || !email || !password || !fullName) {
    throw new Error('Username, email, password, and full name are required');
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Invalid email format');
  }

  // Validate password strength
  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters long');
  }

  // Validate username format
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  if (!usernameRegex.test(username)) {
    throw new Error('Username must be 3-20 characters long and contain only letters, numbers, and underscores');
  }

  // Validate phone if provided
  if (phone && !/^\d{10}$/.test(phone)) {
    throw new Error('Phone number must be exactly 10 digits');
  }
};

/**
 * Validate profile update data
 * @param {Object} updateData - Profile update data
 * @returns {Promise<void>}
 */
export const validateProfileUpdate = async (updateData) => {
  const { fullName, phone } = updateData;

  // Validate at least one field is provided
  if (!fullName && !phone) {
    throw new Error('At least one field (fullName or phone) must be provided');
  }

  // Validate full name if provided
  if (fullName && fullName.length < 2) {
    throw new Error('Full name must be at least 2 characters long');
  }

  // Validate phone if provided
  if (phone && !/^\d{10}$/.test(phone)) {
    throw new Error('Phone number must be exactly 10 digits');
  }
};

/**
 * Validate password change data
 * @param {Object} passwordData - Password change data
 * @returns {Promise<void>}
 */
export const validatePasswordChange = async (passwordData) => {
  const { oldPassword, newPassword } = passwordData;

  // Validate required fields
  if (!oldPassword || !newPassword) {
    throw new Error('Old password and new password are required');
  }

  // Validate new password strength
  if (newPassword.length < 6) {
    throw new Error('New password must be at least 6 characters long');
  }

  // Check if new password is different from old password
  if (oldPassword === newPassword) {
    throw new Error('New password must be different from old password');
  }
};

// ==================== REFERRAL MANAGEMENT ====================

/**
 * Generate unique referral code
 * @returns {Promise<string>} - Unique referral code
 */
export const generateUniqueReferralCode = async () => {
  const generateCode = () => {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `REF${timestamp}${random}`;
  };

  let referralCode = generateCode();
  let existingUser = await User.findOne({ referralCode });
  
  while (existingUser) {
    referralCode = generateCode();
    existingUser = await User.findOne({ referralCode });
  }

  return referralCode;
};

/**
 * Handle referral code logic
 * @param {string} referralCode - Referral code
 * @param {string} adminId - Admin ID
 * @returns {Promise<Object|null>} - Referrer user or null
 */
export const handleReferralCode = async (referralCode, adminId) => {
  const normalizedCode = referralCode.trim().toUpperCase();

  // Check if it's a user referral code
  const referrerUser = await User.findOne({ referralCode: normalizedCode });
  
  if (referrerUser) {
    // Verify referrer's admin matches the target admin
    if (referrerUser.admin.toString() !== adminId.toString()) {
      throw new Error('Referral admin mismatch');
    }
    return referrerUser;
  }

  // Check if it's an admin referral code
  const admin = await Admin.findOne({ referralCode: normalizedCode });
  if (admin && admin._id.toString() === adminId.toString()) {
    return null; // Admin referral, no user referrer
  }

  throw new Error('Invalid referral code');
};

/**
 * Create referral record
 * @param {string} referrerId - Referrer user ID
 * @param {string} referredUserId - Referred user ID
 * @param {string} referralCode - Referral code used
 * @returns {Promise<void>}
 */
export const createReferralRecord = async (referrerId, referredUserId, referralCode) => {
  const Referral = (await import('../models/Referral.js')).default;
  
  await Referral.create({
    referrer: referrerId,
    referredUser: referredUserId,
    referralCode: referralCode.trim().toUpperCase(),
    status: 'ACTIVE',
    createdAt: new Date()
  });
};

// ==================== USER HIERARCHY ====================

/**
 * Find user's admin based on admin code or referral code
 * @param {string} adminCode - Admin code
 * @param {string} referralCode - Referral code
 * @returns {Promise<Object>} - Admin object
 */
export const findUserAdmin = async (adminCode, referralCode) => {
  let admin;

  if (adminCode) {
    // Admin code takes priority
    admin = await Admin.findOne({ adminCode: adminCode.trim().toUpperCase() });
    
    if (!admin) {
      throw new Error('Invalid admin code');
    }
    
    if (admin.status !== 'ACTIVE') {
      throw new Error('Admin is not active. Contact support.');
    }
  } else if (referralCode) {
    // Handle referral code
    const normalizedCode = referralCode.trim().toUpperCase();
    
    // Check user referral first
    const referrerUser = await User.findOne({ referralCode: normalizedCode });
    
    if (referrerUser) {
      admin = await Admin.findById(referrerUser.admin);
      
      if (!admin || admin.status !== 'ACTIVE') {
        throw new Error('Referrer admin is not active. Contact support.');
      }
    } else {
      // Check admin referral code
      admin = await Admin.findOne({ referralCode: normalizedCode });
      
      if (!admin) {
        throw new Error('Invalid referral code');
      }
      
      if (admin.status !== 'ACTIVE') {
        throw new Error('Admin is not active. Contact support.');
      }
    }
  } else {
    // Default to Super Admin
    admin = await Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' });
    
    if (!admin) {
      throw new Error('System not configured. Please contact support.');
    }
  }

  return admin;
};

/**
 * Get parent admin information
 * @param {string} email - User email
 * @returns {Promise<Object>} - Parent admin information
 */
export const getParentInfo = async (email) => {
  const user = await User.findOne({ email });
  if (!user) {
    throw new Error('User not found');
  }

  const admin = await Admin.findById(user.admin).select('name username adminCode branding');
  if (!admin) {
    throw new Error('Admin not found');
  }

  return {
    admin: {
      name: admin.name,
      username: admin.username,
      adminCode: admin.adminCode,
      branding: admin.branding || {}
    }
  };
};

// ==================== USER PROFILE MANAGEMENT ====================

/**
 * Update user profile
 * @param {string} userId - User ID
 * @param {Object} updateData - Profile update data
 * @returns {Promise<Object>} - Updated user object
 */
export const updateUserProfile = async (userId, updateData) => {
  await validateProfileUpdate(updateData);

  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  // Update fields
  if (updateData.fullName) user.fullName = updateData.fullName;
  if (updateData.phone) user.phone = updateData.phone;

  await user.save();

  return {
    id: user._id,
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    phoneVerified: user.phoneVerified,
    adminCode: user.adminCode,
    referralCode: user.referralCode
  };
};

/**
 * Change user password
 * @param {string} userId - User ID
 * @param {Object} passwordData - Password change data
 * @returns {Promise<void>}
 */
export const changeUserPassword = async (userId, passwordData) => {
  await validatePasswordChange(passwordData);

  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  // Verify old password
  const isOldPasswordValid = await user.comparePassword(passwordData.oldPassword);
  if (!isOldPasswordValid) {
    throw new Error('Current password is incorrect');
  }

  // Update password
  user.password = passwordData.newPassword;
  await user.save();
};

/**
 * Get user profile by ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - User profile object
 */
export const getUserProfile = async (userId) => {
  const user = await User.findById(userId).select('-password');
  
  if (!user) {
    throw new Error('User not found');
  }

  return user;
};
