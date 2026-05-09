/**
 * Auto Token Renewal Service
 * Handles automatic token renewal without manual intervention
 */

import TokenPersistenceService from './TokenPersistenceService.js';
import { TokenRenewalService } from './TokenRenewalService.js';

class AutoTokenRenewalService {
  constructor(logger) {
    this.logger = logger;
    this.tokenPersistence = new TokenPersistenceService(logger);
    this.tokenRenewalService = new TokenRenewalService(logger);
    this.renewalTimer = null;
    this.isRenewing = false;
    this.renewalCheckInterval = 5 * 60 * 1000; // Check every 5 minutes
  }

  /**
   * Start automatic token renewal monitoring
   */
  async startAutoRenewal() {
    this.logger.info('Starting automatic token renewal service');
    
    // Stop existing timer if any
    this.stopAutoRenewal();
    
    // Start periodic checks
    this.renewalTimer = setInterval(async () => {
      await this.checkAndRenewToken();
    }, this.renewalCheckInterval);
    
    // Check immediately on start
    await this.checkAndRenewToken();
  }

  /**
   * Stop automatic token renewal monitoring
   */
  stopAutoRenewal() {
    if (this.renewalTimer) {
      clearInterval(this.renewalTimer);
      this.renewalTimer = null;
      this.logger.info('Stopped automatic token renewal service');
    }
  }

  /**
   * Check token and renew if needed
   */
  async checkAndRenewToken() {
    try {
      if (this.isRenewing) {
        this.logger.debug('Token renewal already in progress, skipping check');
        return;
      }

      const tokenStatus = await this.tokenPersistence.getTokenStatus();
      
      if (!tokenStatus.hasToken) {
        this.logger.warn('No token found, manual login required');
        return;
      }

      if (!tokenStatus.isValid) {
        this.logger.info('Token expired or expiring soon, initiating renewal');
        await this.renewToken();
      } else {
        this.logger.debug('Token is valid, no renewal needed');
      }
    } catch (error) {
      this.logger.error('Error during token check:', error);
    }
  }

  /**
   * Renew token automatically
   */
  async renewToken() {
    if (this.isRenewing) {
      this.logger.warn('Token renewal already in progress');
      return false;
    }

    this.isRenewing = true;
    
    try {
      this.logger.info('Starting automatic token renewal');
      
      // Initiate renewal process
      const renewalResult = await this.tokenRenewalService.initiateRenewal();
      
      if (!renewalResult.success) {
        this.logger.error('Failed to initiate token renewal:', renewalResult.error);
        return false;
      }

      this.logger.info('Token renewal initiated, waiting for callback completion');
      
      // Wait for callback completion (this would be handled by the OAuth callback)
      // For now, we'll check periodically if the token was renewed
      const maxWaitTime = 2 * 60 * 1000; // 2 minutes max wait
      const checkInterval = 5000; // Check every 5 seconds
      let elapsed = 0;
      
      while (elapsed < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        elapsed += checkInterval;
        
        const newTokenStatus = await this.tokenPersistence.getTokenStatus();
        
        if (newTokenStatus.isValid && newTokenStatus.loginTime !== (await this.tokenPersistence.loadToken())?.loginTime) {
          this.logger.info('Token renewal completed successfully');
          return true;
        }
      }
      
      this.logger.error('Token renewal timed out');
      return false;
      
    } catch (error) {
      this.logger.error('Error during token renewal:', error);
      return false;
    } finally {
      this.isRenewing = false;
    }
  }

  /**
   * Handle OAuth callback completion
   * @param {Object} callbackData - OAuth callback data
   */
  async handleOAuthCallback(callbackData) {
    try {
      this.logger.info('Handling OAuth callback for token renewal');
      
      if (callbackData.access_token && callbackData.user_id) {
        // Save the new token
        const tokenData = {
          access_token: callbackData.access_token,
          user_id: callbackData.user_id,
          api_key: process.env.ZERODHA_API_KEY,
          login_time: new Date().toISOString(),
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
        };
        
        const saved = await this.tokenPersistence.saveToken(tokenData);
        
        if (saved) {
          this.logger.info('Token renewed and saved successfully');
          return true;
        } else {
          this.logger.error('Failed to save renewed token');
          return false;
        }
      } else {
        this.logger.error('Invalid callback data for token renewal');
        return false;
      }
    } catch (error) {
      this.logger.error('Error handling OAuth callback:', error);
      return false;
    }
  }

  /**
   * Force token renewal (manual trigger)
   */
  async forceRenewal() {
    this.logger.info('Force token renewal requested');
    
    // Delete existing token
    await this.tokenPersistence.deleteToken();
    
    // Initiate renewal
    return await this.renewToken();
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isRunning: !!this.renewalTimer,
      isRenewing: this.isRenewing,
      checkInterval: this.renewalCheckInterval
    };
  }
}

export default AutoTokenRenewalService;
