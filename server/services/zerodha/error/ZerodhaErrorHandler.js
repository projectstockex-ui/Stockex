/**
 * Zerodha Error Handler
 * 
 * Main error handling service for Zerodha operations
 * Coordinates error classification, logging, and session management
 * Follows SOLID principles with single responsibility
 */

import errorClassifier from './ErrorClassifier.js';
import errorLogger from './ErrorLogger.js';

class ZerodhaErrorHandler {
  /**
   * Handle an error in Zerodha operations
   * @param {Error} error - The error to handle
   * @param {string} context - Context where error occurred (e.g., 'connect', 'status', 'callback', 'websocket')
   * @param {Object} sessionManager - Session manager with clearSession method
   * @param {Object} additionalContext - Additional context (userId, operation, etc.)
   * @returns {Object} Error handling result with shouldClearSession flag
   */
  handleError(error, context = 'unknown', sessionManager = null, additionalContext = {}) {
    // Classify the error
    const classification = errorClassifier.classify(error, context);

    // Log the error
    errorLogger.log(error, classification, additionalContext);

    // Clear session only if critical error and session manager provided
    if (classification.shouldClearSession && sessionManager && typeof sessionManager.clearSession === 'function') {
      console.log(`[ZerodhaErrorHandler] Clearing session due to critical error: ${classification.type}`);
      sessionManager.clearSession();
    }

    return {
      handled: true,
      shouldClearSession: classification.shouldClearSession,
      errorType: classification.type,
      errorDescription: errorClassifier.getErrorDescription(classification.type),
      timestamp: classification.timestamp
    };
  }

  /**
   * Handle connect operation error
   * @param {Error} error - The error to handle
   * @param {Object} sessionManager - Session manager
   * @param {string} userId - User ID
   * @returns {Object} Error handling result
   */
  handleConnectError(error, sessionManager, userId = null) {
    return this.handleError(error, 'connect', sessionManager, {
      userId,
      operation: 'connect',
      metadata: { endpoint: '/api/zerodha/connect' }
    });
  }

  /**
   * Handle status check error
   * @param {Error} error - The error to handle
   * @param {Object} sessionManager - Session manager
   * @param {string} userId - User ID
   * @returns {Object} Error handling result
   */
  handleStatusError(error, sessionManager, userId = null) {
    return this.handleError(error, 'status', sessionManager, {
      userId,
      operation: 'status_check',
      metadata: { endpoint: '/api/zerodha/status' }
    });
  }

  /**
   * Handle OAuth callback error
   * @param {Error} error - The error to handle
   * @param {Object} sessionManager - Session manager
   * @param {string} requestToken - Request token
   * @returns {Object} Error handling result
   */
  handleCallbackError(error, sessionManager, requestToken = null) {
    return this.handleError(error, 'callback', sessionManager, {
      operation: 'oauth_callback',
      metadata: { 
        endpoint: '/api/zerodha/callback',
        hasRequestToken: !!requestToken
      }
    });
  }

  /**
   * Handle WebSocket error
   * @param {Error} error - The error to handle
   * @param {Object} sessionManager - Session manager
   * @param {string} userId - User ID
   * @returns {Object} Error handling result
   */
  handleWebSocketError(error, sessionManager, userId = null) {
    return this.handleError(error, 'websocket', sessionManager, {
      userId,
      operation: 'websocket_connection',
      metadata: { shouldClearSession: false }
    });
  }

  /**
   * Handle API call error
   * @param {Error} error - The error to handle
   * @param {Object} sessionManager - Session manager
   * @param {string} apiEndpoint - API endpoint being called
   * @returns {Object} Error handling result
   */
  handleApiError(error, sessionManager, apiEndpoint = null) {
    return this.handleError(error, 'api', sessionManager, {
      operation: 'api_call',
      metadata: { endpoint: apiEndpoint }
    });
  }

  /**
   * Get error statistics
   * @returns {Object} Error statistics
   */
  getErrorStatistics() {
    return errorLogger.getStatistics();
  }

  /**
   * Get recent errors
   * @param {number} limit - Number of recent errors
   * @returns {Array} Recent error entries
   */
  getRecentErrors(limit = 10) {
    return errorLogger.getRecentErrors(limit);
  }

  /**
   * Clear error log
   */
  clearErrorLog() {
    errorLogger.clearLog();
  }
}

export default new ZerodhaErrorHandler();
