/**
 * Validation Middleware
 * 
 * Clean architecture implementation for request validation.
 * Provides comprehensive validation for different types of requests across the application.
 * 
 * Middleware Responsibilities:
 * 1. Request data validation and sanitization
 * 2. Business rule validation
 * 3. Input format validation
 * 4. Error handling for validation failures
 */

import {
  assertHierarchyGameNotDeniedForUserId,
} from '../services/gameRestrictionService.js';

// ==================== GAME VALIDATION MIDDLEWARE ====================

/**
 * Validate game bet request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {Promise<void>}
 */
export const validateGameBet = async (req, res, next) => {
  try {
    const { gameId, amount, prediction, side } = req.body;
    
    // Validate required fields
    if (!gameId || !amount) {
      return res.status(400).json({ 
        message: 'Game ID and amount are required' 
      });
    }

    // Validate amount
    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ 
        message: 'Amount must be a positive number' 
      });
    }

    // Validate game-specific fields
    if (['updown', 'btcupdown'].includes(gameId) && !side) {
      return res.status(400).json({ 
        message: 'Side is required for up/down games' 
      });
    }

    if (['niftyNumber', 'btcNumber', 'niftyBracket', 'niftyJackpot', 'btcJackpot'].includes(gameId) && !prediction) {
      return res.status(400).json({ 
        message: 'Prediction is required for this game type' 
      });
    }

    // Validate game ID
    const validGameIds = ['updown', 'btcupdown', 'niftyNumber', 'btcNumber', 'niftyBracket', 'niftyJackpot', 'btcJackpot'];
    if (!validGameIds.includes(gameId)) {
      return res.status(400).json({ 
        message: 'Invalid game ID' 
      });
    }

    // Validate side for up/down games
    if (side && !['UP', 'DOWN'].includes(side)) {
      return res.status(400).json({ 
        message: 'Side must be UP or DOWN' 
      });
    }

    req.gameData = { gameId, amount, prediction, side };
    next();
  } catch (error) {
    console.error('[ValidationMiddleware] Game bet validation failed:', error);
    res.status(500).json({ message: 'Validation failed' });
  }
};

/**
 * Validate game access for specific game
 * @param {string} gameId - Game ID to validate
 * @returns {Function} Express middleware function
 */
export const validateGameAccess = (gameId) => {
  return async (req, res, next) => {
    try {
      const userId = req.user._id;
      await assertHierarchyGameNotDeniedForUserId(userId, gameId);
      next();
    } catch (error) {
      console.error('[ValidationMiddleware] Game access validation failed:', error);
      res.status(403).json({ message: error.message });
    }
  };
};

// ==================== FINANCIAL VALIDATION MIDDLEWARE ====================

/**
 * Validate deposit request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {Promise<void>}
 */
export const validateDepositRequest = async (req, res, next) => {
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

    // Validate UTR format if provided
    if (utrNumber && !/^[A-Z0-9]{12,25}$/.test(utrNumber)) {
      return res.status(400).json({ 
        message: 'UTR number must be 12-25 alphanumeric characters' 
      });
    }

    req.depositData = { amount, utrNumber, paymentMethod, remarks };
    next();
  } catch (error) {
    console.error('[ValidationMiddleware] Deposit request validation failed:', error);
    res.status(500).json({ message: 'Validation failed' });
  }
};

/**
 * Validate withdrawal request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {Promise<void>}
 */
export const validateWithdrawRequest = async (req, res, next) => {
  try {
    const { amount, accountDetails, paymentMethod, remarks } = req.body;
    
    // Validate required fields
    if (!amount || !paymentMethod || !accountDetails) {
      return res.status(400).json({ 
        message: 'Amount, payment method, and account details are required' 
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

    // Validate account details
    if (typeof accountDetails !== 'object' || !accountDetails.accountNumber) {
      return res.status(400).json({ 
        message: 'Valid account details are required' 
      });
    }

    // Validate account number format
    if (!/^\d{9,18}$/.test(accountDetails.accountNumber)) {
      return res.status(400).json({ 
        message: 'Account number must be 9-18 digits' 
      });
    }

    req.withdrawData = { amount, accountDetails, paymentMethod, remarks };
    next();
  } catch (error) {
    console.error('[ValidationMiddleware] Withdrawal request validation failed:', error);
    res.status(500).json({ message: 'Validation failed' });
  }
};

/**
 * Validate wallet transfer request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {Promise<void>}
 */
export const validateWalletTransfer = async (req, res, next) => {
  try {
    const { sourceWallet, targetWallet, amount, remarks } = req.body;
    
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

    // Validate amount limits
    if (amount < 10) {
      return res.status(400).json({ 
        message: 'Minimum transfer amount is 10' 
      });
    }

    if (amount > 1000000) {
      return res.status(400).json({ 
        message: 'Maximum transfer amount is 1,000,000' 
      });
    }

    req.transferData = { sourceWallet, targetWallet, amount, remarks };
    next();
  } catch (error) {
    console.error('[ValidationMiddleware] Wallet transfer validation failed:', error);
    res.status(500).json({ message: 'Validation failed' });
  }
};

// ==================== USER VALIDATION MIDDLEWARE ====================

/**
 * Validate demo registration request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {Promise<void>}
 */
export const validateDemoRegistration = async (req, res, next) => {
  try {
    const { username, email, password, fullName, phone, referralCode } = req.body;
    
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

    // Validate referral code if provided
    if (referralCode && typeof referralCode === 'string') {
      const normalizedCode = referralCode.trim();
      if (normalizedCode.length < 3 || normalizedCode.length > 20) {
        return res.status(400).json({ 
          message: 'Referral code must be 3-20 characters long' 
        });
      }
    }

    req.demoData = { username, email, password, fullName, phone, referralCode };
    next();
  } catch (error) {
    console.error('[ValidationMiddleware] Demo registration validation failed:', error);
    res.status(500).json({ message: 'Validation failed' });
  }
};

/**
 * Validate parent info request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {Promise<void>}
 */
export const validateParentInfo = async (req, res, next) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    req.parentInfoData = { email };
    next();
  } catch (error) {
    console.error('[ValidationMiddleware] Parent info validation failed:', error);
    res.status(500).json({ message: 'Validation failed' });
  }
};

// ==================== NOTIFICATION VALIDATION MIDDLEWARE ====================

/**
 * Validate notification operation
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
    console.error('[ValidationMiddleware] Notification validation failed:', error);
    res.status(500).json({ message: 'Validation failed' });
  }
};

// ==================== TRADING VALIDATION MIDDLEWARE ====================

/**
 * Validate position close request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {Promise<void>}
 */
export const validatePositionClose = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { exitPrice } = req.body;
    
    // Validate position ID
    if (!id || !/^[0-9a-fA-F]{24}$/.test(id)) {
      return res.status(400).json({ 
        message: 'Invalid position ID format' 
      });
    }

    // Validate exit price
    if (!exitPrice || typeof exitPrice !== 'number' || exitPrice <= 0) {
      return res.status(400).json({ 
        message: 'Exit price must be a positive number' 
      });
    }

    req.positionCloseData = { id, exitPrice };
    next();
  } catch (error) {
    console.error('[ValidationMiddleware] Position close validation failed:', error);
    res.status(500).json({ message: 'Validation failed' });
  }
};

// ==================== QUERY VALIDATION MIDDLEWARE ====================

/**
 * Validate game query parameters
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

    // Validate game ID if provided
    if (gameId) {
      const validGameIds = ['updown', 'btcupdown', 'niftyNumber', 'btcNumber', 'niftyBracket', 'niftyJackpot', 'btcJackpot'];
      if (!validGameIds.includes(gameId)) {
        return res.status(400).json({ 
          message: 'Invalid game ID' 
        });
      }
    }

    next();
  } catch (error) {
    console.error('[ValidationMiddleware] Game query validation failed:', error);
    res.status(500).json({ message: 'Validation failed' });
  }
};

/**
 * Validate pagination parameters
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @returns {Promise<void>}
 */
export const validatePagination = async (req, res, next) => {
  try {
    const { limit, page } = req.query;
    
    // Validate limit
    if (limit) {
      const parsedLimit = parseInt(limit);
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
        return res.status(400).json({ 
          message: 'Limit must be a number between 1 and 200' 
        });
      }
    }

    // Validate page
    if (page) {
      const parsedPage = parseInt(page);
      if (isNaN(parsedPage) || parsedPage < 1) {
        return res.status(400).json({ 
          message: 'Page must be a positive number' 
        });
      }
    }

    next();
  } catch (error) {
    console.error('[ValidationMiddleware] Pagination validation failed:', error);
    res.status(500).json({ message: 'Validation failed' });
  }
};
