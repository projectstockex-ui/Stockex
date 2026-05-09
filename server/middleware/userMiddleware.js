/**
 * User Middleware
 * 
 * Clean architecture implementation for user-specific middleware functions.
 * Handles cross-cutting concerns for user operations following SOLID principles.
 * 
 * Middleware Responsibilities:
 * 1. Request validation and sanitization
 * 2. Authentication and authorization
 * 3. Game restriction validation
 * 4. Request preprocessing
 */

import { 
  assertHierarchyGameNotDeniedForUserId,
  getMergedGameDenylistForPrincipal,
} from '../services/gameRestrictionService.js';

// ==================== GAME VALIDATION MIDDLEWARE ====================

/**
 * Helper function to check if game is denied for user hierarchy
 * @param {Object} res - Express response object
 * @param {string} userId - User ID to check
 * @param {string} gameKey - Game key to check
 * @returns {Promise<boolean>} - Returns true if game is denied, false otherwise
 */
export const rejectIfHierarchyGameDenied = async (res, userId, gameKey) => {
  try {
    if (!userId || !gameKey) {
      res.status(400).json({ message: 'User ID and game key are required' });
      return true;
    }

    await assertHierarchyGameNotDeniedForUserId(userId, gameKey);
    return false;
  } catch (error) {
    console.error('[UserMiddleware] Game restriction check failed:', error);
    res.status(403).json({ message: error.message });
    return true;
  }
};

/**
 * Middleware to validate game access for current user
 * @param {string} gameKey - Game key to validate
 * @returns {Function} Express middleware function
 */
export const validateGameAccess = (gameKey) => {
  return async (req, res, next) => {
    try {
      const userId = req.user._id;
      await assertHierarchyGameNotDeniedForUserId(userId, gameKey);
      next();
    } catch (error) {
      console.error('[UserMiddleware] Game access validation failed:', error);
      res.status(403).json({ message: error.message });
    }
  };
};

// ==================== USER VALIDATION MIDDLEWARE ====================

/**
 * Middleware to validate user registration data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {Promise<void>}
 */
export const validateUserRegistration = async (req, res, next) => {
  try {
    const { username, email, password, fullName, phone } = req.body;
    
    // Validate required fields
    if (!username || !email || !password || !fullName) {
      return res.status(400).json({ 
        message: 'Username, email, password, and full name are required' 
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Validate password strength
    if (password.length < 6) {
      return res.status(400).json({ 
        message: 'Password must be at least 6 characters long' 
      });
    }

    // Validate username format
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(username)) {
      return res.status(400).json({ 
        message: 'Username must be 3-20 characters long and contain only letters, numbers, and underscores' 
      });
    }

    // Validate phone if provided
    if (phone && !/^\d{10}$/.test(phone)) {
      return res.status(400).json({ 
        message: 'Phone number must be exactly 10 digits' 
      });
    }

    next();
  } catch (error) {
    console.error('[UserMiddleware] Registration validation failed:', error);
    res.status(500).json({ message: 'Validation failed' });
  }
};

/**
 * Middleware to validate user login data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {Promise<void>}
 */
export const validateUserLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({ 
        message: 'Email and password are required' 
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    next();
  } catch (error) {
    console.error('[UserMiddleware] Login validation failed:', error);
    res.status(500).json({ message: 'Validation failed' });
  }
};

/**
 * Middleware to validate profile update data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {Promise<void>}
 */
export const validateProfileUpdate = async (req, res, next) => {
  try {
    const { fullName, phone } = req.body;
    
    // Validate at least one field is provided
    if (!fullName && !phone) {
      return res.status(400).json({ 
        message: 'At least one field (fullName or phone) must be provided' 
      });
    }

    // Validate full name if provided
    if (fullName && fullName.length < 2) {
      return res.status(400).json({ 
        message: 'Full name must be at least 2 characters long' 
      });
    }

    // Validate phone if provided
    if (phone && !/^\d{10}$/.test(phone)) {
      return res.status(400).json({ 
        message: 'Phone number must be exactly 10 digits' 
      });
    }

    next();
  } catch (error) {
    console.error('[UserMiddleware] Profile update validation failed:', error);
    res.status(500).json({ message: 'Validation failed' });
  }
};

/**
 * Middleware to validate password change data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {Promise<void>}
 */
export const validatePasswordChange = async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body;
    
    // Validate required fields
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ 
        message: 'Old password and new password are required' 
      });
    }

    // Validate new password strength
    if (newPassword.length < 6) {
      return res.status(400).json({ 
        message: 'New password must be at least 6 characters long' 
      });
    }

    // Check if new password is different from old password
    if (oldPassword === newPassword) {
      return res.status(400).json({ 
        message: 'New password must be different from old password' 
      });
    }

    next();
  } catch (error) {
    console.error('[UserMiddleware] Password change validation failed:', error);
    res.status(500).json({ message: 'Validation failed' });
  }
};

// ==================== WALLET VALIDATION MIDDLEWARE ====================

/**
 * Middleware to validate wallet transfer data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {Promise<void>}
 */
export const validateWalletTransfer = async (req, res, next) => {
  try {
    const { sourceWallet, targetWallet, amount } = req.body;
    
    // Validate required fields
    if (!sourceWallet || !targetWallet || !amount) {
      return res.status(400).json({ 
        message: 'Source wallet, target wallet, and amount are required' 
      });
    }

    // Validate amount
    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ 
        message: 'Amount must be a positive number' 
      });
    }

    // Validate wallet types
    const validWallets = ['wallet', 'cryptoWallet', 'forexWallet', 'mcxWallet', 'gamesWallet'];
    if (!validWallets.includes(sourceWallet) || !validWallets.includes(targetWallet)) {
      return res.status(400).json({ 
        message: 'Invalid wallet type. Valid types: ' + validWallets.join(', ') 
      });
    }

    // Prevent same wallet transfer
    if (sourceWallet === targetWallet) {
      return res.status(400).json({ 
        message: 'Source and target wallets must be different' 
      });
    }

    next();
  } catch (error) {
    console.error('[UserMiddleware] Wallet transfer validation failed:', error);
    res.status(500).json({ message: 'Validation failed' });
  }
};

/**
 * Middleware to validate fund request data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {Promise<void>}
 */
export const validateFundRequest = async (req, res, next) => {
  try {
    const { amount, utrNumber, paymentMethod, remarks } = req.body;
    
    // Validate required fields
    if (!amount || !paymentMethod) {
      return res.status(400).json({ 
        message: 'Amount and payment method are required' 
      });
    }

    // Validate amount
    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ 
        message: 'Amount must be a positive number' 
      });
    }

    // Validate payment method
    const validPaymentMethods = ['BANK_TRANSFER', 'UPI', 'CASH', 'CHEQUE'];
    if (!validPaymentMethods.includes(paymentMethod)) {
      return res.status(400).json({ 
        message: 'Invalid payment method. Valid methods: ' + validPaymentMethods.join(', ') 
      });
    }

    // Validate UTR number for bank transfers
    if (paymentMethod === 'BANK_TRANSFER' && !utrNumber) {
      return res.status(400).json({ 
        message: 'UTR number is required for bank transfers' 
      });
    }

    next();
  } catch (error) {
    console.error('[UserMiddleware] Fund request validation failed:', error);
    res.status(500).json({ message: 'Validation failed' });
  }
};

// ==================== NOTIFICATION MIDDLEWARE ====================

/**
 * Middleware to validate notification operations
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {Promise<void>}
 */
export const validateNotificationOperation = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Validate notification ID for specific operations
    if (req.method !== 'GET' && !id) {
      return res.status(400).json({ 
        message: 'Notification ID is required for this operation' 
      });
    }

    // Validate notification ID format
    if (id && !/^[0-9a-fA-F]{24}$/.test(id)) {
      return res.status(400).json({ 
        message: 'Invalid notification ID format' 
      });
    }

    next();
  } catch (error) {
    console.error('[UserMiddleware] Notification validation failed:', error);
    res.status(500).json({ message: 'Validation failed' });
  }
};

// ==================== GAME QUERY MIDDLEWARE ====================

/**
 * Middleware to validate game query parameters
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {Promise<void>}
 */
export const validateGameQuery = async (req, res, next) => {
  try {
    const { limit, date, gameId } = req.query;
    
    // Validate limit
    if (limit) {
      const parsedLimit = parseInt(limit);
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
        return res.status(400).json({ 
          message: 'Limit must be a number between 1 and 1000' 
        });
      }
    }

    // Validate date format if provided
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ 
        message: 'Date must be in YYYY-MM-DD format' 
      });
    }

    next();
  } catch (error) {
    console.error('[UserMiddleware] Game query validation failed:', error);
    res.status(500).json({ message: 'Validation failed' });
  }
};
