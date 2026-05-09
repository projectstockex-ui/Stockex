/**
 * Session Clear Service
 * 
 * Handles clearing of Zerodha session from all storage locations
 * Follows Single Responsibility Principle - only handles session clearing
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import TokenPersistenceService from '../token/TokenPersistenceService.js';

export class SessionClearService {
  constructor(logger) {
    this.logger = logger;
    this.tokenPersistence = new TokenPersistenceService(logger);
    this.sessionFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.zerodha-session.json');
  }

  /**
   * Clear session from all storage locations
   * @param {Object} controller - ZerodhaController instance
   * @returns {Promise<boolean>} Success status
   */
  async clearAll(controller) {
    try {
      this.logger.info('Clearing session from all storage locations');
      
      // Clear in-memory session
      this.clearMemory(controller);
      
      // Clear file storage
      await this.clearFile();
      
      // Clear database storage
      await this.clearDatabase();
      
      this.logger.info('Session cleared from all storage locations successfully');
      return true;
    } catch (error) {
      this.logger.error('Error clearing session:', error);
      return false;
    }
  }

  /**
   * Clear in-memory session
   * @param {Object} controller - ZerodhaController instance
   */
  clearMemory(controller) {
    if (controller && controller.session) {
      controller.session = {
        apiKey: null,
        accessToken: null,
        userId: null,
        loginTime: null,
        connected: false
      };
      this.logger.info('In-memory session cleared');
    }
  }

  /**
   * Clear session file
   * @returns {Promise<void>}
   */
  async clearFile() {
    try {
      if (this.sessionFile) {
        await fs.unlink(this.sessionFile).catch(() => {});
        this.logger.info('Session file cleared');
      }
    } catch (error) {
      this.logger.warn('Error clearing session file:', error.message);
    }
  }

  /**
   * Clear session from database
   * @returns {Promise<void>}
   */
  async clearDatabase() {
    try {
      await this.tokenPersistence.deleteToken();
      this.logger.info('Database session cleared');
    } catch (error) {
      this.logger.warn('Error clearing database session:', error.message);
    }
  }
}

export default SessionClearService;
