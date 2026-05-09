/**
 * Interface for Session Management
 * Implements Single Responsibility Principle (SRP)
 */

export class ISessionManager {
  /**
   * Load session from file
   * @returns {Promise<Object>} - Session object
   */
  async loadSession() {
    throw new Error('Method must be implemented');
  }

  /**
   * Save session to file
   * @param {Object} session - Session object to save
   * @returns {Promise<boolean>} - True if saved successfully
   */
  async saveSession(session) {
    throw new Error('Method must be implemented');
  }

  /**
   * Update session with new data
   * @param {Object} updates - Session updates
   * @returns {Promise<Object>} - Updated session
   */
  async updateSession(updates) {
    throw new Error('Method must be implemented');
  }

  /**
   * Clear session
   * @returns {Promise<boolean>} - True if cleared successfully
   */
  async clearSession() {
    throw new Error('Method must be implemented');
  }

  /**
   * Get current session
   * @returns {Object} - Current session object
   */
  getCurrentSession() {
    throw new Error('Method must be implemented');
  }

  /**
   * Check if session exists
   * @returns {boolean} - True if session exists
   */
  hasSession() {
    throw new Error('Method must be implemented');
  }
}
