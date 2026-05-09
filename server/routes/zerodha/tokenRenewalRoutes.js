/**
 * Token Renewal Routes
 * Handles automatic token renewal endpoints
 */

import express from 'express';
import { TokenRenewalOrchestrator } from '../../services/zerodha/TokenRenewalOrchestrator.js';

const router = express.Router();

// Global orchestrator instance
let tokenOrchestrator = null;

/**
 * Initialize token renewal orchestrator
 * @param {Object} logger - Logger instance
 * @param {Object} config - Configuration
 */
export const initializeTokenRenewal = (logger, config = {}) => {
  tokenOrchestrator = new TokenRenewalOrchestrator(logger, config);
  return tokenOrchestrator;
};

/**
 * Get token renewal orchestrator instance
 * @returns {TokenRenewalOrchestrator} - Orchestrator instance
 */
export const getTokenRenewalOrchestrator = () => {
  return tokenOrchestrator;
};

/**
 * GET /api/zerodha/token/status
 * Get current token status
 */
router.get('/status', async (req, res) => {
  try {
    if (!tokenOrchestrator) {
      return res.status(500).json({
        success: false,
        message: 'Token renewal system not initialized'
      });
    }

    const status = await tokenOrchestrator.getStatus();
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('Error getting token status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get token status',
      error: error.message
    });
  }
});

/**
 * POST /api/zerodha/token/renew
 * Force token renewal
 */
router.post('/renew', async (req, res) => {
  try {
    if (!tokenOrchestrator) {
      return res.status(500).json({
        success: false,
        message: 'Token renewal system not initialized'
      });
    }

    const result = await tokenOrchestrator.forceRenewal();
    
    res.json({
      success: result.success,
      data: result,
      message: result.message
    });
  } catch (error) {
    console.error('Error forcing token renewal:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to force token renewal',
      error: error.message
    });
  }
});

/**
 * GET /api/zerodha/token/renewal-url
 * Get token renewal URL
 */
router.get('/renewal-url', async (req, res) => {
  try {
    if (!tokenOrchestrator) {
      return res.status(500).json({
        success: false,
        message: 'Token renewal system not initialized'
      });
    }

    const renewalResult = await tokenOrchestrator.renewalService.renewToken();
    
    res.json({
      success: renewalResult.success,
      data: {
        renewalUrl: renewalResult.renewalUrl,
        message: renewalResult.message
      }
    });
  } catch (error) {
    console.error('Error getting renewal URL:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get renewal URL',
      error: error.message
    });
  }
});

/**
 * GET /api/zerodha/token/callback
 * Handle OAuth callback for token renewal
 */
router.get('/callback', async (req, res) => {
  try {
    const { request_token } = req.query;
    
    if (!request_token) {
      return res.redirect(`${process.env.CLIENT_URL || 'http://localhost:3001'}/superadmin/dashboard?zerodha=error&message=Missing request token`);
    }

    if (!tokenOrchestrator) {
      return res.redirect(`${process.env.CLIENT_URL || 'http://localhost:3001'}/superadmin/dashboard?zerodha=error&message=Token renewal system not initialized`);
    }

    const result = await tokenOrchestrator.handleOAuthCallback(request_token);
    
    if (result.success) {
      return res.redirect(`${process.env.CLIENT_URL || 'http://localhost:3001'}/superadmin/dashboard?zerodha=connected&message=Token renewed successfully`);
    } else {
      return res.redirect(`${process.env.CLIENT_URL || 'http://localhost:3001'}/superadmin/dashboard?zerodha=error&message=${encodeURIComponent(result.error)}`);
    }
  } catch (error) {
    console.error('Error handling token renewal callback:', error);
    return res.redirect(`${process.env.CLIENT_URL || 'http://localhost:3001'}/superadmin/dashboard?zerodha=error&message=${encodeURIComponent(error.message)}`);
  }
});

/**
 * POST /api/zerodha/token/validate
 * Validate current token
 */
router.post('/validate', async (req, res) => {
  try {
    if (!tokenOrchestrator) {
      return res.status(500).json({
        success: false,
        message: 'Token renewal system not initialized'
      });
    }

    const session = await tokenOrchestrator.sessionManager.loadSession();
    
    if (!session) {
      return res.json({
        success: false,
        message: 'No session found'
      });
    }

    const isValid = await tokenOrchestrator.expirationDetector.validateTokenFormat(session);
    const expirationInfo = await tokenOrchestrator.expirationDetector.getTokenExpirationInfo(session);
    
    res.json({
      success: true,
      data: {
        isValid,
        expirationInfo
      }
    });
  } catch (error) {
    console.error('Error validating token:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate token',
      error: error.message
    });
  }
});

/**
 * GET /api/zerodha/token/websocket-status
 * Get WebSocket connection status
 */
router.get('/websocket-status', async (req, res) => {
  try {
    if (!tokenOrchestrator) {
      return res.status(500).json({
        success: false,
        message: 'Token renewal system not initialized'
      });
    }

    const status = await tokenOrchestrator.websocketManager.getConnectionStatus();
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('Error getting WebSocket status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get WebSocket status',
      error: error.message
    });
  }
});

export default router;
