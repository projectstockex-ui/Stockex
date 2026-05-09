/**
 * Zerodha Middleware
 * 
 * Provides Zerodha-specific middleware functions for authentication and validation.
 * Follows SOLID principles with single responsibility.
 */

import zerodhaController from '../controllers/zerodhaController.js';
import zerodhaErrorHandler from '../services/zerodha/error/ZerodhaErrorHandler.js';

/**
 * Middleware to ensure Zerodha is connected
 */
export const requireZerodhaConnection = (req, res, next) => {
  try {
    const status = zerodhaController.orchestrator?.getConnectionStatus();
    
    if (!status?.connected) {
      return res.status(400).json({
        message: 'Zerodha connection required',
        error: 'Please connect to Zerodha first'
      });
    }
    
    next();
  } catch (error) {
    console.error('Zerodha connection check failed:', error);
    return res.status(500).json({
      message: 'Failed to check Zerodha connection',
      error: error.message
    });
  }
};

/**
 * Middleware to ensure Zerodha session exists
 */
export const requireZerodhaSession = (req, res, next) => {
  try {
    if (!zerodhaController.session?.accessToken) {
      return res.status(401).json({
        message: 'Zerodha session required',
        error: 'Please login to Zerodha first'
      });
    }
    
    next();
  } catch (error) {
    console.error('Zerodha session check failed:', error);
    return res.status(500).json({
      message: 'Failed to check Zerodha session',
      error: error.message
    });
  }
};

/**
 * Middleware to validate tokens array
 */
export const validateTokensArray = (req, res, next) => {
  try {
    const { tokens } = req.body;
    
    if (!Array.isArray(tokens)) {
      return res.status(400).json({
        message: 'Tokens must be an array',
        error: 'Invalid tokens format'
      });
    }
    
    if (tokens.length === 0) {
      return res.status(400).json({
        message: 'Tokens array cannot be empty',
        error: 'At least one token is required'
      });
    }
    
    // Validate each token
    const invalidTokens = tokens.filter(token => 
      token === null || 
      token === undefined || 
      token === '' || 
      (typeof token !== 'string' && typeof token !== 'number')
    );
    
    if (invalidTokens.length > 0) {
      return res.status(400).json({
        message: 'Invalid tokens found',
        error: `Invalid tokens: ${invalidTokens.join(', ')}`
      });
    }
    
    // Limit tokens to prevent overload
    const maxTokens = parseInt(process.env.ZERODHA_MAX_TOKENS_PER_REQUEST || '1000');
    if (tokens.length > maxTokens) {
      return res.status(400).json({
        message: `Too many tokens requested`,
        error: `Maximum ${maxTokens} tokens allowed per request`
      });
    }
    
    next();
  } catch (error) {
    console.error('Token validation failed:', error);
    return res.status(500).json({
      message: 'Failed to validate tokens',
      error: error.message
    });
  }
};

/**
 * Middleware to validate job ID
 */
export const validateJobId = (req, res, next) => {
  try {
    const { jobId } = req.params;
    
    if (!jobId || typeof jobId !== 'string') {
      return res.status(400).json({
        message: 'Valid job ID required',
        error: 'Job ID must be a non-empty string'
      });
    }
    
    // Check if job exists
    const job = zerodhaController.orchestrator?.progressService?.getJob(jobId);
    if (!job) {
      return res.status(404).json({
        message: 'Job not found',
        error: `No job found with ID: ${jobId}`
      });
    }
    
    // Attach job to request for later use
    req.zerodhaJob = job;
    next();
  } catch (error) {
    console.error('Job ID validation failed:', error);
    return res.status(500).json({
      message: 'Failed to validate job ID',
      error: error.message
    });
  }
};

/**
 * Middleware to rate limit Zerodha operations
 */
export const rateLimitZerodha = (maxRequests = 10, windowMs = 60000) => {
  const requests = new Map();
  
  return (req, res, next) => {
    try {
      const key = req.user?.id || req.ip;
      const now = Date.now();
      const windowStart = now - windowMs;
      
      // Clean old requests
      if (requests.has(key)) {
        const userRequests = requests.get(key).filter(time => time > windowStart);
        requests.set(key, userRequests);
      } else {
        requests.set(key, []);
      }
      
      // Check rate limit
      const userRequests = requests.get(key);
      if (userRequests.length >= maxRequests) {
        return res.status(429).json({
          message: 'Too many requests',
          error: `Rate limit exceeded. Maximum ${maxRequests} requests per ${windowMs/1000} seconds`
        });
      }
      
      // Add current request
      userRequests.push(now);
      
      next();
    } catch (error) {
      console.error('Rate limiting failed:', error);
      next(); // Continue on error
    }
  };
};

/**
 * Middleware to add Zerodha context to request
 */
export const addZerodhaContext = (req, res, next) => {
  try {
    req.zerodha = {
      connected: zerodhaController.orchestrator?.getConnectionStatus()?.connected || false,
      hasSession: !!zerodhaController.session?.accessToken,
      userId: zerodhaController.session?.userId,
      loginTime: zerodhaController.session?.loginTime
    };
    
    next();
  } catch (error) {
    console.error('Failed to add Zerodha context:', error);
    req.zerodha = {
      connected: false,
      hasSession: false,
      userId: null,
      loginTime: null
    };
    next();
  }
};

/**
 * Middleware to handle Zerodha-specific errors
 */
export const handleZerodhaErrors = (error, req, res, next) => {
  try {
    console.error('Zerodha error:', error);
    
    // Use error handler to classify and log the error
    const errorResult = zerodhaErrorHandler.handleError(
      error,
      'middleware',
      zerodhaController,
      {
        userId: req.user?.id || req.admin?._id,
        operation: req.path,
        metadata: { method: req.method }
      }
    );
    
    // Handle specific Zerodha errors
    if (error.message?.includes('403')) {
      return res.status(401).json({
        message: 'Zerodha authentication failed',
        error: 'Access token expired or invalid. Please reconnect to Zerodha.',
        errorType: errorResult.errorType
      });
    }
    
    if (error.message?.includes('timeout')) {
      return res.status(504).json({
        message: 'Zerodha operation timeout',
        error: 'The operation took too long. Please try again.',
        errorType: errorResult.errorType
      });
    }
    
    if (error.message?.includes('connection')) {
      return res.status(503).json({
        message: 'Zerodha connection error',
        error: 'Unable to connect to Zerodha. Please check your connection and try again.',
        errorType: errorResult.errorType
      });
    }
    
    // Generic error
    res.status(500).json({
      message: 'Zerodha operation failed',
      error: error.message || 'An unexpected error occurred',
      errorType: errorResult.errorType,
      errorDescription: errorResult.errorDescription
    });
    
  } catch (handlerError) {
    console.error('Error handler failed:', handlerError);
    res.status(500).json({
      message: 'Internal server error',
      error: 'An unexpected error occurred'
    });
  }
};

/**
 * Middleware to validate sync operation
 */
export const validateSyncOperation = (req, res, next) => {
  try {
    // Check if another sync is already running
    const runningJobs = zerodhaController.orchestrator?.progressService?.getRunningJobs()
      ?.filter(job => job.type === 'full_sync') || [];
    
    if (runningJobs.length > 0) {
      return res.status(409).json({
        message: 'Sync operation already in progress',
        error: 'Another sync is already running. Please wait for it to complete.',
        job: runningJobs[0]
      });
    }
    
    next();
  } catch (error) {
    console.error('Sync validation failed:', error);
    return res.status(500).json({
      message: 'Failed to validate sync operation',
      error: error.message
    });
  }
};
