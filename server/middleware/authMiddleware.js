
/**
 * Enhanced Authentication Middleware
 * 
 * Proper authentication structure with comprehensive error handling.
 * Supports both admin and user authentication with fallback mechanisms.
 */

import jwt from 'jsonwebtoken';
import Admin from '../models/Admin.js';
import User from '../models/User.js';

/**
 * Enhanced authentication middleware with proper error handling
 */
export const authenticateToken = async (req, res, next) => {
  try {
    let token;
    
    // Check multiple token sources
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.headers['x-access-token']) {
      token = req.headers['x-access-token'];
    } else if (req.cookies?.token) {
      token = req.cookies.token;
    } else if (req.query?.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({ 
        message: 'Authentication required',
        error: 'No token provided',
        code: 'TOKEN_MISSING'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Try admin first, then user
    let user = await Admin.findById(decoded.id).select('-password');
    let userType = 'admin';
    
    if (!user) {
      user = await User.findById(decoded.id).select('-password');
      userType = 'user';
    }

    if (!user) {
      return res.status(401).json({ 
        message: 'Invalid token',
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Check if user is active
    if (user.status === 'SUSPENDED' || user.status === 'INACTIVE') {
      return res.status(401).json({ 
        message: 'Account suspended',
        error: 'Account is not active',
        code: 'ACCOUNT_SUSPENDED'
      });
    }

    // Attach user info to request
    req.user = user;
    req.userType = userType;
    
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        message: 'Invalid token',
        error: 'Token is malformed',
        code: 'TOKEN_INVALID'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        message: 'Token expired',
        error: 'Please login again',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    res.status(500).json({ 
      message: 'Authentication error',
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
};

/**
 * Admin-specific authentication
 */
export const authenticateAdmin = async (req, res, next) => {
  try {
    // First authenticate token
    await authenticateToken(req, res, () => {});
    
    // Check if user is admin
    if (req.userType !== 'admin') {
      return res.status(403).json({ 
        message: 'Admin access required',
        error: 'User is not an admin',
        code: 'NOT_ADMIN'
      });
    }
    
    req.admin = req.user; // For backward compatibility
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * User-specific authentication
 */
export const authenticateUser = async (req, res, next) => {
  try {
    // First authenticate token
    await authenticateToken(req, res, () => {});
    
    // Both admin and user can access user endpoints
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Super Admin authentication
 */
export const authenticateSuperAdmin = async (req, res, next) => {
  try {
    // First authenticate as admin
    await authenticateAdmin(req, res, () => {});
    
    // Check if super admin
    if (req.admin.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ 
        message: 'Super Admin access required',
        error: 'User is not a super admin',
        code: 'NOT_SUPER_ADMIN'
      });
    }
    
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Optional authentication - doesn't fail if no token
 */
export const optionalAuth = async (req, res, next) => {
  try {
    let token;
    
    // Check multiple token sources
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.headers['x-access-token']) {
      token = req.headers['x-access-token'];
    } else if (req.cookies?.token) {
      token = req.cookies.token;
    } else if (req.query?.token) {
      token = req.query.token;
    }

    if (!token) {
      // No token - continue without authentication
      req.user = null;
      req.userType = null;
      return next();
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Try admin first, then user
    let user = await Admin.findById(decoded.id).select('-password');
    let userType = 'admin';
    
    if (!user) {
      user = await User.findById(decoded.id).select('-password');
      userType = 'user';
    }

    if (user && user.status !== 'SUSPENDED' && user.status !== 'INACTIVE') {
      req.user = user;
      req.userType = userType;
    } else {
      req.user = null;
      req.userType = null;
    }
    
    next();
  } catch (error) {
    // On any error, continue without authentication
    req.user = null;
    req.userType = null;
    next();
  }
};

/**
 * Role-based access control
 */
export const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        message: 'Authentication required',
        error: 'No user authenticated',
        code: 'AUTH_REQUIRED'
      });
    }

    const userRoles = Array.isArray(roles) ? roles : [roles];
    
    if (!userRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: 'Insufficient permissions',
        error: `Required roles: ${userRoles.join(', ')}`,
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    next();
  };
};

/**
 * Generate enhanced token with more data
 */
export const generateEnhancedToken = (userId, userType = 'user') => {
  const payload = {
    id: userId,
    userType: userType,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
  };

  return jwt.sign(payload, process.env.JWT_SECRET);
};

// Export aliases for backward compatibility
export { authenticateAdmin as protectAdmin };
export { authenticateUser as protectUser };
export { authenticateSuperAdmin as superAdminOnly };
export { generateEnhancedToken as generateToken };
