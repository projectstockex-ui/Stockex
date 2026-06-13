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
import zerodhaErrorHandler from '../services/zerodha/error/ZerodhaErrorHandler.js';

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

router.get('/redirect-to-login', zc(zerodhaController.redirectToLogin));

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

// Refresh session (handle expired tokens)
router.post('/refresh-session', 
  protectAdmin, 
  superAdminOnly,
  zc(zerodhaController.refreshSession)
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

// Sync popular instruments only (fast upsert, no full reset)
router.post('/sync-all-instruments',
  protectAdmin,
  superAdminOnly,
  requireZerodhaSession,
  validateSyncOperation,
  rateLimitZerodha(5, 300000),
  zc(zerodhaController.syncAllInstruments)
);

// Refresh lot sizes from Kite master for existing DB instruments
router.post('/sync-lot-sizes',
  protectAdmin,
  superAdminOnly,
  requireZerodhaSession,
  rateLimitZerodha(10, 300000),
  zc(zerodhaController.syncLotSizes)
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

// Subscribe to all tokens (superadmin only)
router.post('/subscribe-all', 
  protectAdmin, 
  superAdminOnly,
  rateLimitZerodha(5, 300000), // 5 attempts per 5 minutes
  zc(zerodhaController.subscribeAllTokens)
);

// Landing page ticker (public, rate-limited)
router.get('/landing-ticker-quotes',
  rateLimitZerodha(120, 60000),
  zc(zerodhaController.getLandingTickerQuotes)
);

router.post('/landing-ticker-subscribe',
  rateLimitZerodha(10, 60000),
  zc(zerodhaController.landingTickerSubscribe)
);

// User-facing tick subscribe (MCX/User dashboard socket flow)
router.post('/tick-subscribe',
  protectUser,
  rateLimitZerodha(30, 60000), // user-side retries can be bursty on watchlist changes
  zc(zerodhaController.tickSubscribe)
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
  rateLimitZerodha(100, 60000), // 100 requests per minute for users
  zc(zerodhaController.getMarketData)
);

// Resolve one contract price (token/symbol/tradingSymbol) for UI hydration
router.get('/contract-price',
  protectUser,
  rateLimitZerodha(120, 60000),
  zc(zerodhaController.getContractPrice)
);

// Read-only MCX diagnostic for verifying live data path
router.get('/mcx-debug',
  protectUser,
  rateLimitZerodha(30, 60000),
  zc(zerodhaController.getMcxDebug)
);

// Public game price endpoint used by client live game panel fallback polling
router.get('/game-price/:symbol', zc(zerodhaController.getGamePrice));

/**
 * Health and Maintenance Routes
 */

// Auto-renewal endpoint
router.get('/auto-renewal', 
  protectAdmin, 
  superAdminOnly,
  zc(zerodhaController.getAutoRenewalUrl)
);

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

// Token renewal routes
import tokenRenewalRoutes from './zerodha/tokenRenewalRoutes.js';
router.use('/token-renewal', tokenRenewalRoutes);

/**
 * Zerodha OAuth Callback
 * This is the callback URL that Zerodha redirects to after authentication
 */
router.get('/callback', zc(zerodhaController.handleCallback));

export default router;
