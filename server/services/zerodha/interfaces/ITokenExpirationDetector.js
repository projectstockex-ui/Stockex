/**
 * Interface for Token Expiration Detection
 * Implements Single Responsibility Principle (SRP)
 */

export class ITokenExpirationDetector {
  /**
   * Check if token is expired
   * @param {Object} session - Zerodha session object
   * @returns {Promise<boolean>} - True if expired
   */
  async isTokenExpired(session) {
    throw new Error('Method must be implemented');
  }

  /**
   * Check if token is near expiration
   * @param {Object} session - Zerodha session object
   * @param {number} thresholdMinutes - Threshold in minutes
   * @returns {Promise<boolean>} - True if near expiration
   */
  async isTokenNearExpiration(session, thresholdMinutes = 30) {
    throw new Error('Method must be implemented');
  }

  /**
   * Get token age in milliseconds
   * @param {Object} session - Zerodha session object
   * @returns {Promise<number>} - Token age in milliseconds
   */
  async getTokenAge(session) {
    throw new Error('Method must be implemented');
  }

  /**
   * Validate token format and structure
   * @param {Object} session - Zerodha session object
   * @returns {Promise<boolean>} - True if valid format
   */
  async validateTokenFormat(session) {
    throw new Error('Method must be implemented');
  }

  /**
   * Get token expiration info
   * @param {Object} session - Zerodha session object
   * @returns {Promise<Object>} - Token expiration info
   */
  async getTokenExpirationInfo(session) {
    throw new Error('Method must be implemented');
  }
}
