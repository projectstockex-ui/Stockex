/**
 * Token Expiration Detection Service
 * Implements Single Responsibility Principle (SRP)
 */

import { ITokenExpirationDetector } from '../interfaces/ITokenExpirationDetector.js';

export class TokenExpirationDetector extends ITokenExpirationDetector {
  constructor(logger, config = {}) {
    super();
    this.logger = logger;
    this.config = {
      maxTokenAge: 12 * 60 * 60 * 1000, // 12 hours (increased from 6 hours)
      expirationThreshold: 2 * 60 * 60 * 1000, // 2 hours (increased from 30 minutes)
      ...config
    };
  }

  /**
   * Check if token is expired
   * @param {Object} session - Zerodha session object
   * @returns {Promise<boolean>} - True if expired
   */
  async isTokenExpired(session) {
    try {
      if (!session || !session.loginTime) {
        this.logger.warn('Invalid session or missing login time');
        return true;
      }

      const tokenAge = await this.getTokenAge(session);
      const maxAge = this.config.maxTokenAge;
      const isExpired = tokenAge > maxAge;
      
      // Add debug logging to see actual token age
      this.logger.debug('Token expiration check', {
        tokenAgeMinutes: Math.round(tokenAge / 1000 / 60),
        maxAgeMinutes: Math.round(maxAge / 1000 / 60),
        isExpired,
        loginTime: session.loginTime
      });
      
      if (isExpired) {
        this.logger.info('Token expired', { 
          tokenAge: Math.round(tokenAge / 1000 / 60), // minutes
          maxAge: Math.round(maxAge / 1000 / 60) // minutes
        });
      }

      return isExpired;
    } catch (error) {
      this.logger.error('Error checking token expiration:', error);
      return false; // Don't assume expired on error to prevent constant reconnections
    }
  }

  /**
   * Get token age in milliseconds
   * @param {Object} session - Zerodha session object
   * @returns {Promise<number>} - Token age in milliseconds
   */
  async getTokenAge(session) {
    try {
      if (!session || !session.loginTime) {
        return Infinity;
      }

      const loginTime = new Date(session.loginTime).getTime();
      const currentTime = Date.now();
      const tokenAge = currentTime - loginTime;

      this.logger.debug('Token age calculated', { 
        tokenAge: Math.round(tokenAge / 1000 / 60), // minutes
        loginTime: session.loginTime
      });

      return tokenAge;
    } catch (error) {
      this.logger.error('Error calculating token age:', error);
      return Infinity;
    }
  }

  /**
   * Check if token is near expiration
   * @param {Object} session - Zerodha session object
   * @param {number} thresholdMinutes - Threshold in minutes
   * @returns {Promise<boolean>} - True if near expiration
   */
  async isTokenNearExpiration(session, thresholdMinutes = 30) {
    try {
      const tokenAge = await this.getTokenAge(session);
      const threshold = thresholdMinutes * 60 * 1000;
      const maxAge = this.config.maxTokenAge;
      const timeUntilExpiration = maxAge - tokenAge;
      const isNearExpiration = timeUntilExpiration < threshold;

      // Add debug logging to see actual values
      this.logger.debug('Token near expiration check', {
        tokenAgeMinutes: Math.round(tokenAge / 1000 / 60),
        maxAgeMinutes: Math.round(maxAge / 1000 / 60),
        timeUntilExpirationMinutes: Math.round(timeUntilExpiration / 1000 / 60),
        thresholdMinutes,
        isNearExpiration
      });

      if (isNearExpiration) {
        this.logger.info('Token near expiration', {
          timeUntilExpiration: Math.round(timeUntilExpiration / 1000 / 60), // minutes
          threshold: thresholdMinutes
        });
      }

      return isNearExpiration;
    } catch (error) {
      this.logger.error('Error checking token near expiration:', error);
      return false; // Don't assume near expiration on error to prevent constant reconnections
    }
  }

  /**
   * Validate token format and structure
   * @param {Object} session - Zerodha session object
   * @returns {Promise<boolean>} - True if valid format
   */
  async validateTokenFormat(session) {
    try {
      if (!session) {
        this.logger.warn('Session is null or undefined');
        return false;
      }

      const requiredFields = ['access_token', 'loginTime', 'user_id'];
      for (const field of requiredFields) {
        if (!session[field]) {
          this.logger.warn(`Missing required field: ${field}`);
          return false;
        }
      }

      // Validate access token format
      if (typeof session.access_token !== 'string' || session.access_token.length < 10) {
        this.logger.warn('Invalid access token format');
        return false;
      }

      // Validate login time format
      const loginTime = new Date(session.loginTime);
      if (isNaN(loginTime.getTime())) {
        this.logger.warn('Invalid login time format');
        return false;
      }

      this.logger.debug('Token format validation passed');
      return true;
    } catch (error) {
      this.logger.error('Error validating token format:', error);
      return false;
    }
  }

  /**
   * Get token expiration info with production safeguards
   * @param {Object} session - Zerodha session object
   * @returns {Promise<Object>} - Token expiration info
   */
  async getTokenExpirationInfo(session) {
    try {
      const tokenAge = await this.getTokenAge(session);
      const maxAge = this.config.maxTokenAge;
      const timeUntilExpiration = maxAge - tokenAge;
      
      // Production safeguard: Don't treat tokens as expired if they're very new
      const isVeryNewToken = tokenAge < 60000; // Less than 1 minute old
      const isExpired = !isVeryNewToken && tokenAge > maxAge;
      const isNearExpiration = !isVeryNewToken && timeUntilExpiration < this.config.expirationThreshold;

      return {
        tokenAge: Math.round(tokenAge / 1000 / 60), // minutes
        maxAge: Math.round(maxAge / 1000 / 60), // minutes
        timeUntilExpiration: Math.max(0, Math.round(timeUntilExpiration / 1000 / 60)), // minutes
        isExpired,
        isNearExpiration,
        isValid: await this.validateTokenFormat(session),
        isVeryNewToken
      };
    } catch (error) {
      this.logger.error('Error getting token expiration info:', error);
      return {
        tokenAge: 0,
        maxAge: Math.round(this.config.maxTokenAge / 1000 / 60),
        timeUntilExpiration: 0,
        isExpired: false, // Don't assume expired in production
        isNearExpiration: false,
        isValid: false
      };
    }
  }
}
