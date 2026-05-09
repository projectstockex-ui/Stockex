/**
 * Error Logger Service
 * 
 * Provides structured error logging for Zerodha operations
 * Follows single responsibility principle - only handles logging
 */

class ErrorLogger {
  constructor() {
    this.errorLog = [];
    this.maxLogSize = 1000; // Keep last 1000 errors in memory
  }

  /**
   * Log an error with structured context
   * @param {Error} error - The error to log
   * @param {Object} classification - Error classification from ErrorClassifier
   * @param {Object} context - Additional context (userId, operation, etc.)
   */
  log(error, classification, context = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      errorType: classification.type,
      shouldClearSession: classification.shouldClearSession,
      errorContext: classification.context,
      errorMessage: error?.message || String(error),
      errorStack: error?.stack,
      userId: context.userId || null,
      operation: context.operation || 'unknown',
      metadata: context.metadata || {}
    };

    // Add to in-memory log
    this.errorLog.push(logEntry);

    // Trim log if too large
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog = this.errorLog.slice(-this.maxLogSize);
    }

    // Console log with appropriate level
    if (classification.shouldClearSession) {
      console.error('[ZerodhaErrorLogger] CRITICAL ERROR:', logEntry);
    } else {
      console.warn('[ZerodhaErrorLogger] NON-CRITICAL ERROR:', logEntry);
    }
  }

  /**
   * Get recent errors from log
   * @param {number} limit - Number of recent errors to return
   * @returns {Array} Recent error entries
   */
  getRecentErrors(limit = 10) {
    return this.errorLog.slice(-limit);
  }

  /**
   * Get errors by type
   * @param {string} errorType - Error type to filter by
   * @returns {Array} Filtered error entries
   */
  getErrorsByType(errorType) {
    return this.errorLog.filter(entry => entry.errorType === errorType);
  }

  /**
   * Clear error log
   */
  clearLog() {
    this.errorLog = [];
    console.log('[ZerodhaErrorLogger] Error log cleared');
  }

  /**
   * Get error statistics
   * @returns {Object} Error statistics
   */
  getStatistics() {
    const stats = {
      total: this.errorLog.length,
      byType: {},
      critical: 0,
      nonCritical: 0
    };

    this.errorLog.forEach(entry => {
      // Count by type
      if (!stats.byType[entry.errorType]) {
        stats.byType[entry.errorType] = 0;
      }
      stats.byType[entry.errorType]++;

      // Count critical vs non-critical
      if (entry.shouldClearSession) {
        stats.critical++;
      } else {
        stats.nonCritical++;
      }
    });

    return stats;
  }
}

export default new ErrorLogger();
