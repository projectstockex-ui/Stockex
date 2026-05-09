/**
 * Error Classification Service
 * 
 * Classifies Zerodha errors into critical vs non-critical
 * Critical errors will clear the session
 * Non-critical errors will be logged without clearing session
 */

export class ErrorClassifier {
  /**
   * Error types
   */
  static ErrorTypes = {
    CRITICAL_AUTH: 'CRITICAL_AUTH',
    CRITICAL_TOKEN: 'CRITICAL_TOKEN',
    NON_CRITICAL_NETWORK: 'NON_CRITICAL_NETWORK',
    NON_CRITICAL_API: 'NON_CRITICAL_API',
    NON_CRITICAL_WEBSOCKET: 'NON_CRITICAL_WEBSOCKET',
    NON_CRITICAL_OTHER: 'NON_CRITICAL_OTHER'
  };

  /**
   * Classify an error based on its type and message
   * @param {Error} error - The error to classify
   * @param {string} context - Context where error occurred (e.g., 'connect', 'status', 'callback')
   * @returns {Object} Classification result with type and shouldClearSession flag
   */
  classify(error, context = 'unknown') {
    const errorMessage = error?.message || String(error);
    const errorType = this.determineErrorType(errorMessage, context);
    const shouldClearSession = this.isCritical(errorType);

    return {
      type: errorType,
      shouldClearSession,
      context,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Determine error type based on error message and context
   * @param {string} errorMessage - Error message
   * @param {string} context - Context where error occurred
   * @returns {string} Error type
   */
  determineErrorType(errorMessage, context) {
    const lowerMessage = errorMessage.toLowerCase();

    // Critical authentication errors
    if (lowerMessage.includes('authentication') || 
        lowerMessage.includes('unauthorized') ||
        lowerMessage.includes('invalid api key') ||
        lowerMessage.includes('invalid credentials')) {
      return ErrorClassifier.ErrorTypes.CRITICAL_AUTH;
    }

    // Critical token errors
    if (lowerMessage.includes('token') && 
        (lowerMessage.includes('expired') || 
         lowerMessage.includes('invalid') ||
         lowerMessage.includes('revoked'))) {
      return ErrorClassifier.ErrorTypes.CRITICAL_TOKEN;
    }

    // Network errors (non-critical)
    if (lowerMessage.includes('network') ||
        lowerMessage.includes('timeout') ||
        lowerMessage.includes('econnrefused') ||
        lowerMessage.includes('enotfound') ||
        lowerMessage.includes('etimedout')) {
      return ErrorClassifier.ErrorTypes.NON_CRITICAL_NETWORK;
    }

    // WebSocket errors (non-critical)
    if (context === 'websocket' ||
        lowerMessage.includes('websocket') ||
        lowerMessage.includes('ticker') ||
        lowerMessage.includes('connection lost')) {
      return ErrorClassifier.ErrorTypes.NON_CRITICAL_WEBSOCKET;
    }

    // API errors (non-critical unless auth/token related)
    if (context === 'api' ||
        lowerMessage.includes('api') ||
        lowerMessage.includes('rate limit') ||
        lowerMessage.includes('429') ||
        lowerMessage.includes('500') ||
        lowerMessage.includes('502') ||
        lowerMessage.includes('503')) {
      return ErrorClassifier.ErrorTypes.NON_CRITICAL_API;
    }

    // Default to non-critical other
    return ErrorClassifier.ErrorTypes.NON_CRITICAL_OTHER;
  }

  /**
   * Check if error type is critical
   * @param {string} errorType - Error type
   * @returns {boolean} True if critical
   */
  isCritical(errorType) {
    return (
      errorType === ErrorClassifier.ErrorTypes.CRITICAL_AUTH ||
      errorType === ErrorClassifier.ErrorTypes.CRITICAL_TOKEN
    );
  }

  /**
   * Get human-readable error type description
   * @param {string} errorType - Error type
   * @returns {string} Description
   */
  getErrorDescription(errorType) {
    const descriptions = {
      [ErrorClassifier.ErrorTypes.CRITICAL_AUTH]: 'Authentication failed - credentials invalid',
      [ErrorClassifier.ErrorTypes.CRITICAL_TOKEN]: 'Token expired or invalid - requires re-authentication',
      [ErrorClassifier.ErrorTypes.NON_CRITICAL_NETWORK]: 'Network error - temporary connection issue',
      [ErrorClassifier.ErrorTypes.NON_CRITICAL_API]: 'API error - service temporarily unavailable',
      [ErrorClassifier.ErrorTypes.NON_CRITICAL_WEBSOCKET]: 'WebSocket error - data feed temporarily interrupted',
      [ErrorClassifier.ErrorTypes.NON_CRITICAL_OTHER]: 'General error - operation failed but connection intact'
    };
    return descriptions[errorType] || 'Unknown error type';
  }
}

export default new ErrorClassifier();
