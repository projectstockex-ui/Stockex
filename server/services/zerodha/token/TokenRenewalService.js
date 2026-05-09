/**
 * Token Renewal Service
 * Implements Single Responsibility Principle (SRP)
 */

import { ITokenRenewalService } from '../interfaces/ITokenRenewalService.js';
import { KiteConnect } from 'kiteconnect';

export class TokenRenewalService extends ITokenRenewalService {
  constructor(logger, config = {}) {
    super();
    this.logger = logger;
    this.config = {
      apiKey: process.env.ZERODHA_API_KEY,
      apiSecret: process.env.ZERODHA_API_SECRET,
      redirectUrl: process.env.ZERODHA_REDIRECT_URL || 'http://localhost:3000/zerodha/callback',
      ...config
    };
    
    this.kite = new KiteConnect({
      api_key: this.config.apiKey
    });
  }

  /**
   * Initiate token renewal process
   * @returns {Promise<Object>} - Renewal result with URL
   */
  async initiateRenewal() {
    try {
      this.logger.info('Initiating token renewal process');
      
      const loginUrl = this.kite.getLoginURL();
      
      this.logger.info('Token renewal URL generated', {
        url: loginUrl
      });
      
      return {
        success: true,
        url: loginUrl,
        message: 'Please visit the URL to complete OAuth authentication'
      };
    } catch (error) {
      this.logger.error('Error initiating token renewal:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to generate renewal URL'
      };
    }
  }

  /**
   * Handle OAuth callback
   * @param {string} requestToken - Request token from callback
   * @returns {Promise<Object>} - Renewal result
   */
  async handleCallback(requestToken) {
    try {
      this.logger.info('Handling OAuth callback', { requestToken });
      
      const session = await this.kite.generateSession(requestToken, this.config.apiSecret);
      
      // Set the access token for future API calls
      this.kite.setAccessToken(session.access_token);
      
      // Add login time for expiration tracking
      session.loginTime = new Date().toISOString();
      
      this.logger.info('Session generated successfully', {
        userId: session.user_id,
        loginTime: session.loginTime
      });
      
      return {
        success: true,
        session,
        message: 'Token renewed successfully'
      };
    } catch (error) {
      this.logger.error('Error handling OAuth callback:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to generate session from callback'
      };
    }
  }

  /**
   * Validate token
   * @param {string} accessToken - Access token to validate
   * @returns {Promise<boolean>} - True if valid
   */
  async validateToken(accessToken) {
    try {
      if (!accessToken) {
        return false;
      }
      
      // Set the access token
      this.kite.setAccessToken(accessToken);
      
      // Try to make a simple API call to validate token
      const profile = await this.kite.getProfile();
      
      this.logger.info('Token validated successfully', {
        userId: profile.user_id
      });
      
      return true;
    } catch (error) {
      this.logger.error('Token validation failed:', error);
      return false;
    }
  }

  /**
   * Check if renewal is needed
   * @param {Object} session - Current session
   * @returns {Promise<boolean>} - True if renewal needed
   */
  async isRenewalNeeded(session) {
    try {
      if (!session) {
        this.logger.info('No session found, renewal needed');
        return true;
      }
      
      // Check if token is expired
      const isExpired = await this.isTokenExpired(session);
      if (isExpired) {
        this.logger.info('Token expired, renewal needed');
        return true;
      }
      
      // Check if token is near expiration
      const isNearExpiration = await this.isTokenNearExpiration(session, 2 * 60); // 2 hours
      if (isNearExpiration) {
        this.logger.info('Token near expiration, renewal recommended');
        return true;
      }
      
      this.logger.info('Token is valid, no renewal needed');
      return false;
    } catch (error) {
      this.logger.error('Error checking renewal requirement:', error);
      return false;
    }
  }

  /**
   * Get renewal URL
   * @returns {Promise<string>} - Renewal URL
   */
  async getRenewalUrl() {
    try {
      const loginUrl = this.kite.getLoginURL();
      this.logger.info('Renewal URL retrieved');
      return loginUrl;
    } catch (error) {
      this.logger.error('Error getting renewal URL:', error);
      throw error;
    }
  }

  /**
   * Check if token is expired
   * @param {Object} session - Session object
   * @returns {Promise<boolean>} - True if expired
   */
  async isTokenExpired(session) {
    try {
      if (!session || !session.loginTime) {
        return true;
      }
      
      const loginTime = new Date(session.loginTime).getTime();
      const currentTime = Date.now();
      const tokenAge = currentTime - loginTime;
      const maxAge = 12 * 60 * 60 * 1000; // 12 hours
      
      return tokenAge > maxAge;
    } catch (error) {
      this.logger.error('Error checking token expiration:', error);
      return true;
    }
  }

  /**
   * Check if token is near expiration
   * @param {Object} session - Session object
   * @param {number} thresholdMinutes - Threshold in minutes
   * @returns {Promise<boolean>} - True if near expiration
   */
  async isTokenNearExpiration(session, thresholdMinutes = 30) {
    try {
      if (!session || !session.loginTime) {
        return true;
      }
      
      const loginTime = new Date(session.loginTime).getTime();
      const currentTime = Date.now();
      const tokenAge = currentTime - loginTime;
      const maxAge = 12 * 60 * 60 * 1000; // 12 hours
      const threshold = thresholdMinutes * 60 * 1000;
      const timeUntilExpiration = maxAge - tokenAge;
      
      return timeUntilExpiration < threshold;
    } catch (error) {
      this.logger.error('Error checking token near expiration:', error);
      return true;
    }
  }

  /**
   * Get token info
   * @param {Object} session - Session object
   * @returns {Object} - Token info
   */
  getTokenInfo(session) {
    if (!session) {
      return null;
    }
    
    const loginTime = new Date(session.loginTime).getTime();
    const currentTime = Date.now();
    const tokenAge = currentTime - loginTime;
    const maxAge = 12 * 60 * 60 * 1000; // 12 hours
    const timeUntilExpiration = maxAge - tokenAge;
    
    return {
      tokenAge: Math.round(tokenAge / 1000 / 60), // minutes
      maxAge: Math.round(maxAge / 1000 / 60), // minutes
      timeUntilExpiration: Math.max(0, Math.round(timeUntilExpiration / 1000 / 60)), // minutes
      isExpired: tokenAge > maxAge,
      userId: session.user_id
    };
  }
}
