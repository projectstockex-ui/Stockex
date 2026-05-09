/**
 * Zerodha Session Utilities
 * 
 * Utility functions for Zerodha session management
 * Follows single responsibility principle - only handles session utilities
 */

/**
 * Get API key from session or environment
 * @param {Object} session - Session object
 * @returns {string} API key
 */
export function getApiKey(session) {
  return session?.apiKey || process.env.ZERODHA_API_KEY;
}

/**
 * Format session data for persistence
 * @param {Object} session - Session object
 * @returns {Object} Formatted session data
 */
export function formatSessionForPersistence(session) {
  return {
    access_token: session.accessToken,
    user_id: session.userId,
    api_key: session.apiKey || process.env.ZERODHA_API_KEY,
    login_time: session.loginTime instanceof Date 
      ? session.loginTime.toISOString() 
      : (session.loginTime || new Date().toISOString()),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
  };
}

/**
 * Validate session data
 * @param {Object} session - Session object
 * @returns {boolean} True if session is valid
 */
export function isValidSession(session) {
  return !!(session?.accessToken && session?.userId);
}

/**
 * Check if session has API key
 * @param {Object} session - Session object
 * @returns {boolean} True if session has API key
 */
export function hasApiKey(session) {
  return !!(session?.apiKey || process.env.ZERODHA_API_KEY);
}
