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
import Instrument from '../models/Instrument.js';
import GameResult from '../models/GameResult.js';
import {
  fetchNifty50LastPriceFromKite,
  fetchNifty50SessionClearing15mCached,
} from '../utils/kiteNiftyQuote.js';
import { getMarketData } from '../services/zerodhaWebSocket.js';

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
router.get('/game-price/:symbol', async (req, res) => {
  try {
    const raw = String(req.params.symbol || '').toUpperCase();
    const symbol = raw === 'NIFTY50' ? 'NIFTY' : raw;
    if (symbol !== 'NIFTY') {
      return res.status(400).json({ message: 'Only NIFTY is supported for game-price endpoint' });
    }

    // Best-effort day-clearing close (used by UI when market is closed).
    const clearing = await fetchNifty50SessionClearing15mCached();
    const sessionClearing = Number(clearing?.close);
    const safeSessionClearing =
      Number.isFinite(sessionClearing) && sessionClearing > 0 ? sessionClearing : null;

    // Prefer authoritative Kite quote from persisted Zerodha session.
    const kitePrice = await fetchNifty50LastPriceFromKite();
    if (Number.isFinite(Number(kitePrice)) && Number(kitePrice) > 0) {
      return res.json({
        symbol: 'NIFTY',
        price: Number(kitePrice),
        close: Number(kitePrice),
        prevDayClose: null,
        sessionClearing: safeSessionClearing,
        source: 'kite',
        timestamp: new Date().toISOString(),
      });
    }

    // Fast fallback: in-memory websocket tick cache (if stream is active).
    const liveMap = getMarketData();
    const liveTick = liveMap?.['256265'] || liveMap?.[256265];
    const livePrice = Number(liveTick?.ltp || 0);
    if (Number.isFinite(livePrice) && livePrice > 0) {
      return res.json({
        symbol: 'NIFTY',
        price: livePrice,
        open: Number(liveTick?.open) || livePrice,
        high: Number(liveTick?.high) || livePrice,
        low: Number(liveTick?.low) || livePrice,
        close: Number(liveTick?.close) || livePrice,
        prevDayClose: Number(liveTick?.close) || livePrice,
        sessionClearing: safeSessionClearing,
        source: 'ws_cache',
        timestamp: new Date().toISOString(),
      });
    }

    // Fallback to last cached instrument row so UI still gets a valid price.
    const inst = await Instrument.findOne({
      $or: [{ token: '256265' }, { symbol: { $in: ['NIFTY', 'NIFTY 50'] } }],
    })
      .select('ltp open high low close previousDayClosePrice')
      .lean();

    const fallback = Number(inst?.ltp || inst?.close || 0);
    if (Number.isFinite(fallback) && fallback > 0) {
      return res.json({
        symbol: 'NIFTY',
        price: fallback,
        open: Number(inst?.open) || fallback,
        high: Number(inst?.high) || fallback,
        low: Number(inst?.low) || fallback,
        close: Number(inst?.close) || fallback,
        prevDayClose: Number(inst?.previousDayClosePrice) || Number(inst?.close) || fallback,
        sessionClearing: safeSessionClearing,
        source: 'db_fallback',
        timestamp: new Date().toISOString(),
      });
    }

    // Final fallback: most recent persisted NIFTY up/down game result close.
    const latestResult = await GameResult.findOne({ gameId: 'updown' })
      .sort({ windowDate: -1, windowNumber: -1 })
      .select('closePrice openPrice')
      .lean();
    const resultClose = Number(latestResult?.closePrice || 0);
    if (Number.isFinite(resultClose) && resultClose > 0) {
      return res.json({
        symbol: 'NIFTY',
        price: resultClose,
        open: Number(latestResult?.openPrice) || resultClose,
        high: resultClose,
        low: resultClose,
        close: resultClose,
        prevDayClose: resultClose,
        sessionClearing: safeSessionClearing ?? resultClose,
        source: 'game_result_fallback',
        timestamp: new Date().toISOString(),
      });
    }

    // Never return 404 here; keep polling endpoint stable to avoid console spam.
    return res.json({
      symbol: 'NIFTY',
      price: safeSessionClearing,
      open: safeSessionClearing,
      high: safeSessionClearing,
      low: safeSessionClearing,
      close: safeSessionClearing,
      prevDayClose: safeSessionClearing,
      sessionClearing: safeSessionClearing,
      source: 'unavailable',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to fetch game price',
      error: error.message,
    });
  }
});

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
