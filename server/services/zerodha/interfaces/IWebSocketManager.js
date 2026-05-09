/**
 * Interface for WebSocket Connection Management
 * Implements Single Responsibility Principle (SRP)
 */

export class IWebSocketManager {
  /**
   * Connect to WebSocket
   * @param {Object} session - Session object with access token
   * @returns {Promise<boolean>} - True if connected successfully
   */
  async connect(session) {
    throw new Error('Method must be implemented');
  }

  /**
   * Disconnect from WebSocket
   * @returns {Promise<boolean>} - True if disconnected successfully
   */
  async disconnect() {
    throw new Error('Method must be implemented');
  }

  /**
   * Check if WebSocket is connected
   * @returns {boolean} - True if connected
   */
  isConnected() {
    throw new Error('Method must be implemented');
  }

  /**
   * Subscribe to instruments
   * @param {Array} instruments - Array of instrument tokens
   * @returns {Promise<boolean>} - True if subscribed successfully
   */
  async subscribe(instruments) {
    throw new Error('Method must be implemented');
  }

  /**
   * Unsubscribe from instruments
   * @param {Array} instruments - Array of instrument tokens
   * @returns {Promise<boolean>} - True if unsubscribed successfully
   */
  async unsubscribe(instruments) {
    throw new Error('Method must be implemented');
  }

  /**
   * Set connection event handlers
   * @param {Object} handlers - Event handlers
   */
  setEventHandlers(handlers) {
    throw new Error('Method must be implemented');
  }

  /**
   * Monitor connection health
   * @param {Function} callback - Status callback
   */
  monitorConnection(callback) {
    throw new Error('Method must be implemented');
  }
}
