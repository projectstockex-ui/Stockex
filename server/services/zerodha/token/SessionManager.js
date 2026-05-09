/**
 * Session Management Service
 * Implements Single Responsibility Principle (SRP)
 */

import { ISessionManager } from '../interfaces/ISessionManager.js';
import fs from 'fs/promises';
import path from 'path';

export class SessionManager extends ISessionManager {
  constructor(logger, config = {}) {
    super();
    this.logger = logger;
    this.config = {
      sessionFilePath: '.zerodha-session.json',
      ...config
    };
    this.currentSession = null;
  }

  /**
   * Load session from file
   * @returns {Promise<Object>} - Session object
   */
  async loadSession() {
    try {
      const sessionData = await fs.readFile(this.config.sessionFilePath, 'utf8');
      const session = JSON.parse(sessionData);
      
      this.logger.info('Session loaded successfully', {
        sessionAge: session.loginTime ? Math.round((Date.now() - new Date(session.loginTime).getTime()) / 1000 / 60) : 0,
        userId: session.user_id
      });
      
      this.currentSession = session;
      return session;
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.logger.info('No existing session file found');
      } else {
        this.logger.error('Error loading session:', error);
      }
      this.currentSession = null;
      return null;
    }
  }

  /**
   * Save session to file
   * @param {Object} session - Session object to save
   * @returns {Promise<boolean>} - True if saved successfully
   */
  async saveSession(session) {
    try {
      if (!session) {
        this.logger.warn('Cannot save null session');
        return false;
      }

      // Add timestamp if not present
      if (!session.loginTime) {
        session.loginTime = new Date().toISOString();
      }

      const sessionData = JSON.stringify(session, null, 2);
      await fs.writeFile(this.config.sessionFilePath, sessionData, 'utf8');
      
      this.logger.info('Session saved successfully', {
        userId: session.user_id,
        loginTime: session.loginTime
      });
      
      this.currentSession = session;
      return true;
    } catch (error) {
      this.logger.error('Error saving session:', error);
      return false;
    }
  }

  /**
   * Update session with new data
   * @param {Object} updates - Session updates
   * @returns {Promise<Object>} - Updated session
   */
  async updateSession(updates) {
    try {
      let session = this.currentSession || await this.loadSession();
      
      if (!session) {
        this.logger.warn('No existing session to update');
        return null;
      }

      // Merge updates
      const updatedSession = { ...session, ...updates };
      
      // Update timestamp if access token changed
      if (updates.access_token && updates.access_token !== session.access_token) {
        updatedSession.loginTime = new Date().toISOString();
      }

      const saved = await this.saveSession(updatedSession);
      
      if (saved) {
        this.logger.info('Session updated successfully', {
          updatedFields: Object.keys(updates)
        });
        return updatedSession;
      } else {
        return session;
      }
    } catch (error) {
      this.logger.error('Error updating session:', error);
      return this.currentSession;
    }
  }

  /**
   * Clear session
   * @returns {Promise<boolean>} - True if cleared successfully
   */
  async clearSession() {
    try {
      await fs.unlink(this.config.sessionFilePath);
      this.logger.info('Session cleared successfully');
      this.currentSession = null;
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.logger.info('No session file to clear');
        this.currentSession = null;
        return true;
      } else {
        this.logger.error('Error clearing session:', error);
        return false;
      }
    }
  }

  /**
   * Get current session
   * @returns {Object} - Current session object
   */
  getCurrentSession() {
    return this.currentSession;
  }

  /**
   * Check if session exists
   * @returns {boolean} - True if session exists
   */
  hasSession() {
    return this.currentSession !== null;
  }

  /**
   * Validate session integrity
   * @param {Object} session - Session to validate
   * @returns {boolean} - True if valid
   */
  validateSession(session) {
    if (!session) return false;
    
    const requiredFields = ['access_token', 'loginTime', 'user_id'];
    for (const field of requiredFields) {
      if (!session[field]) {
        this.logger.warn(`Invalid session: missing ${field}`);
        return false;
      }
    }
    
    return true;
  }

  /**
   * Refresh session from file
   * @returns {Promise<Object>} - Fresh session object
   */
  async refreshSession() {
    return await this.loadSession();
  }
}
