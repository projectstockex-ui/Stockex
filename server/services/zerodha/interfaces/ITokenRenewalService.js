/**
 * Interface for Token Renewal Service
 * Implements Single Responsibility Principle (SRP)
 */

export class ITokenRenewalService {
  /**
   * Initiate token renewal process
   * @returns {Promise<Object>} - Renewal result with URL
   */
  async initiateRenewal() {
    throw new Error('Method must be implemented');
  }

  /**
   * Handle OAuth callback
   * @param {string} requestToken - Request token from callback
   * @returns {Promise<Object>} - Renewal result
   */
  async handleCallback(requestToken) {
    throw new Error('Method must be implemented');
  }

  /**
   * Validate token
   * @param {string} accessToken - Access token to validate
   * @returns {Promise<boolean>} - True if valid
   */
  async validateToken(accessToken) {
    throw new Error('Method must be implemented');
  }

  /**
   * Check if renewal is needed
   * @param {Object} session - Current session
   * @returns {Promise<boolean>} - True if renewal needed
   */
  async isRenewalNeeded(session) {
    throw new Error('Method must be implemented');
  }

  /**
   * Get renewal URL
   * @returns {Promise<string>} - Renewal URL
   */
  async getRenewalUrl() {
    throw new Error('Method must be implemented');
  }
}
