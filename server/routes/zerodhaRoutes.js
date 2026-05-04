/**
 * Zerodha Routes - Clean MVC Structure
 * 
 * FIXED: Prevents 504 errors with proper timeout management and background job processing.
 * Clean separation of concerns - Routes only handle HTTP, business logic in controllers.
 */

import express from 'express';
import { 
  protectAdmin, 
  protectUser, 
  superAdminOnly,
  optionalAuth 
} from '../middleware/authMiddleware.js';
import { 
  requireZerodhaConnection,
  requireZerodhaSession,
  validateTokensArray,
  validateJobId,
  rateLimitZerodha,
  addZerodhaContext,
  handleZerodhaErrors,
  validateSyncOperation
} from '../middleware/zerodhaMiddleware.js';
import zerodhaController from '../controllers/zerodhaController.js';
import environmentConfig from '../utils/environmentConfig.js';

const router = express.Router();

/** Express passes handlers without `this` — bind ZerodhaController instance */
const zc = (fn) => fn.bind(zerodhaController);

/**
 * Set Socket.IO instance for controller
 */
export const setSocketIO = (socketIO) => {
  zerodhaController.initialize(socketIO);
};

/**
 * Apply global middleware
 */
router.use(addZerodhaContext);
router.use(handleZerodhaErrors);

/**
 * Connection Management Routes
 */

// Get Zerodha login URL (public endpoint)
router.get('/login-url', 
  zc(zerodhaController.getLoginUrl)
);

// Connect to Zerodha
router.post('/connect', 
  protectAdmin, 
  superAdminOnly, 
  rateLimitZerodha(5, 60000), // 5 attempts per minute
  zc(zerodhaController.connect)
);

// Disconnect from Zerodha
router.post('/disconnect', 
  protectAdmin, 
  superAdminOnly, 
  zc(zerodhaController.disconnect)
);

// Alias used by admin UI
router.post('/logout',
  protectAdmin,
  superAdminOnly,
  zc(zerodhaController.disconnect)
);

// Get connection status (optional auth - works with or without token)
router.get('/status', 
  optionalAuth,  // ✅ Works with or without authentication
  zc(zerodhaController.getStatus)
);

// Get session info
router.get('/session', 
  protectAdmin, 
  zc(zerodhaController.getSession)
);

/**
 * Synchronization Routes
 */

// Reset and sync instruments (FIXED: prevents 504 errors)
router.post('/reset-and-sync', 
  protectAdmin, 
  superAdminOnly,
  requireZerodhaSession,
  validateSyncOperation,
  rateLimitZerodha(2, 300000), // 2 attempts per 5 minutes
  zc(zerodhaController.resetAndSync)
);

// Get sync job status
router.get('/sync/status/:jobId', 
  protectAdmin, 
  superAdminOnly,
  validateJobId,
  zc(zerodhaController.getSyncStatus)
);

// Get all sync jobs
router.get('/sync/jobs', 
  protectAdmin, 
  superAdminOnly,
  zc(zerodhaController.getSyncJobs)
);

// Cancel sync job
router.post('/sync/cancel/:jobId', 
  protectAdmin, 
  superAdminOnly,
  validateJobId,
  zc(zerodhaController.cancelSyncJob)
);

/**
 * Subscription Management Routes
 */

// Subscribe to tokens
router.post('/subscribe', 
  protectAdmin, 
  requireZerodhaConnection,
  validateTokensArray,
  rateLimitZerodha(10, 60000), // 10 attempts per minute
  zc(zerodhaController.subscribeTokens)
);

// Unsubscribe from tokens
router.post('/unsubscribe', 
  protectAdmin, 
  requireZerodhaConnection,
  validateTokensArray,
  rateLimitZerodha(10, 60000), // 10 attempts per minute
  zc(zerodhaController.unsubscribeTokens)
);

// Get subscription statistics
router.get('/subscriptions', 
  protectAdmin, 
  requireZerodhaConnection,
  zc(zerodhaController.getSubscriptions)
);

/**
 * Market Data Routes
 */

// Get market data
router.get('/market-data', 
  protectUser, 
  requireZerodhaConnection,
  rateLimitZerodha(100, 60000), // 100 requests per minute for users
  zc(zerodhaController.getMarketData)
);

// Public game price endpoint used by client live game panel fallback polling
router.get('/game-price/:symbol', zc(zerodhaController.getGamePrice));

/**
 * Health and Maintenance Routes
 */

// Health check endpoint
router.get('/health', 
  protectAdmin, 
  zc(zerodhaController.healthCheck)
);

// Cleanup old jobs
router.post('/cleanup', 
  protectAdmin, 
  superAdminOnly,
  rateLimitZerodha(5, 300000), // 5 attempts per 5 minutes
  zc(zerodhaController.cleanupJobs)
);

/**
 * Zerodha OAuth Callback
 * This is the callback URL that Zerodha redirects to after authentication
 */
router.get('/callback', async (req, res) => {
  const { success, error } = environmentConfig.getDashboardUrls();
  const redirectError = (msg) =>
    res.redirect(`${error}&message=${encodeURIComponent(msg || 'OAuth failed')}`);

  try {
    const { request_token } = req.query;

    if (!request_token) {
      console.error('Missing request_token in Zerodha callback');
      return redirectError('Missing request_token');
    }

    await zerodhaController.exchangeAndPersistSession(request_token);
    return res.redirect(success);
  } catch (err) {
    console.error('Zerodha callback error:', err?.message || err);
    return redirectError(err?.message || 'Zerodha OAuth failed');
  }
});

export default router;
