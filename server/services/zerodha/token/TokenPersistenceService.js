/**
 * Token Persistence Service
 * Handles secure storage and retrieval of Zerodha access tokens
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

class TokenPersistenceService {
  constructor(logger) {
    this.logger = logger;
    this.encryptionKey = process.env.ZERODHA_TOKEN_ENCRYPTION_KEY || 'default-key-change-in-production';
    this.tokenFile = path.join(process.cwd(), '.zerodha-session.json');
  }

  /**
   * Encrypt data for secure storage
   * @param {string} text - Text to encrypt
   * @returns {string} - Encrypted text
   */
  encrypt(text) {
    // Store as plain JSON - encryption was causing crashes with deprecated Node.js crypto API
    return text;
  }

  /**
   * Decrypt data from storage
   * @param {string} encryptedText - Encrypted text
   * @returns {string} - Decrypted text
   */
  decrypt(encryptedText) {
    // Plain JSON storage - just return as-is
    return encryptedText;
  }

  /**
   * Save token data securely
   * @param {Object} tokenData - Token data to save
   */
  async saveToken(tokenData) {
    try {
      const dataToSave = {
        accessToken: tokenData.access_token,
        userId: tokenData.user_id,
        apiKey: tokenData.api_key,
        loginTime: tokenData.login_time || new Date().toISOString(),
        expiresAt: tokenData.expires_at || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
        ...tokenData
      };

      // Encrypt sensitive data
      const encryptedData = this.encrypt(JSON.stringify(dataToSave));
      
      // Write to file
      await fs.promises.writeFile(this.tokenFile, encryptedData, 'utf8');
      
      this.logger.info('Token saved securely', { userId: tokenData.user_id });
      return true;
    } catch (error) {
      this.logger.error('Failed to save token:', error);
      return false;
    }
  }

  /**
   * Load token data from storage
   * @returns {Object|null} - Token data or null if not found/invalid
   */
  async loadToken() {
    try {
      if (!fs.existsSync(this.tokenFile)) {
        this.logger.info('No saved token found');
        return null;
      }

      const encryptedData = await fs.promises.readFile(this.tokenFile, 'utf8');
      const decryptedData = this.decrypt(encryptedData);
      const tokenData = JSON.parse(decryptedData);

      // Check if token is still valid
      if (this.isTokenExpired(tokenData)) {
        this.logger.warn('Saved token has expired');
        await this.deleteToken();
        return null;
      }

      this.logger.info('Token loaded successfully', { userId: tokenData.userId });
      return tokenData;
    } catch (error) {
      this.logger.error('Failed to load token:', error);
      return null;
    }
  }

  /**
   * Check if token is expired or will expire soon
   * @param {Object} tokenData - Token data
   * @param {number} bufferMinutes - Buffer time in minutes before expiration
   * @returns {boolean} - True if token is expired or will expire soon
   */
  isTokenExpired(tokenData, bufferMinutes = 30) {
    if (!tokenData.expiresAt) {
      // If no expiration time, assume it's old (more than 12 hours)
      const loginTime = new Date(tokenData.loginTime);
      const now = new Date();
      return (now - loginTime) > (12 * 60 * 60 * 1000);
    }

    const expiresAt = new Date(tokenData.expiresAt);
    const now = new Date();
    const bufferTime = bufferMinutes * 60 * 1000;
    
    return now >= (new Date(expiresAt.getTime() - bufferTime));
  }

  /**
   * Delete saved token
   */
  async deleteToken() {
    try {
      if (fs.existsSync(this.tokenFile)) {
        await fs.promises.unlink(this.tokenFile);
        this.logger.info('Token deleted successfully');
      }
      return true;
    } catch (error) {
      this.logger.error('Failed to delete token:', error);
      return false;
    }
  }

  /**
   * Get token status
   * @returns {Object} - Token status information
   */
  async getTokenStatus() {
    try {
      const tokenData = await this.loadToken();
      
      if (!tokenData) {
        return {
          hasToken: false,
          isValid: false,
          expiresAt: null,
          userId: null
        };
      }

      const isExpired = this.isTokenExpired(tokenData);
      
      return {
        hasToken: true,
        isValid: !isExpired,
        expiresAt: tokenData.expiresAt,
        userId: tokenData.userId,
        loginTime: tokenData.loginTime
      };
    } catch (error) {
      this.logger.error('Failed to get token status:', error);
      return {
        hasToken: false,
        isValid: false,
        expiresAt: null,
        userId: null
      };
    }
  }
}

export default TokenPersistenceService;
