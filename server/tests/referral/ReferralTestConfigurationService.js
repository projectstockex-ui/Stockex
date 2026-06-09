/**
 * Referral Test Configuration Service
 * 
 * Manages dynamic configuration for referral test scenarios.
 * Follows SOLID principles with single responsibility for configuration management.
 */

export class ReferralTestConfigurationService {
  constructor(systemSettingsRepository, gameSettingsRepository) {
    this.systemSettingsRepository = systemSettingsRepository;
    this.gameSettingsRepository = gameSettingsRepository;
  }

  async getConfiguration(testConfig) {
    try {
      console.log('[ConfigurationService] Getting test configuration...');
      
      // Get current system settings
      const systemSettings = await this.systemSettingsRepository.getSettings();
      
      // Configure brokerage distribution percentages
      const brokerageDistribution = {
        enabled: true,
        mode: 'PERCENTAGE',
        superAdminShare: testConfig.brokeragePercentages?.superAdmin || 25,
        adminShare: testConfig.brokeragePercentages?.admin || 15,
        brokerShare: testConfig.brokeragePercentages?.broker || 35,
        subBrokerShare: testConfig.brokeragePercentages?.subBroker || 25
      };

      // Configure referral settings
      const referralSettings = {
        enabled: true,
        thresholdAmount: testConfig.superAdminThreshold || 1000,
        thresholdUnit: 'PER_CRORE',
        referralCommission: testConfig.expectedReferralCommission || 1000
      };

      // Calculate expected distributions
      const expectedDistribution = this.calculateExpectedDistribution(testConfig);

      const configuration = {
        monishitAmount: testConfig.monishitAmount || 2000,
        hamsaAmount: testConfig.hamsaAmount || 2000,
        brokerageDistribution,
        referralSettings,
        expectedDistribution,
        testConfig
      };

      console.log('[ConfigurationService] Configuration loaded:');
      console.log(`[ConfigurationService] - monishitAmount: ${configuration.monishitAmount}`);
      console.log(`[ConfigurationService] - hamsaAmount: ${configuration.hamsaAmount}`);
      console.log(`[ConfigurationService] - SuperAdmin threshold: ${referralSettings.thresholdAmount}`);
      console.log(`[ConfigurationService] - Expected referral commission: ${referralSettings.referralCommission}`);
      console.log(`[ConfigurationService] - Brokerage distribution:`, brokerageDistribution);

      return configuration;
      
    } catch (error) {
      console.error('[ConfigurationService] Error getting configuration:', error);
      throw error;
    }
  }

  calculateExpectedDistribution(testConfig) {
    try {
      console.log('[ConfigurationService] Calculating expected distribution...');
      
      const { monishitAmount, hamsaAmount, brokeragePercentages } = testConfig;
      
      const monishitDistribution = this.calculateUserDistribution(monishitAmount, brokeragePercentages);
      const hamsaDistribution = this.calculateUserDistribution(hamsaAmount, brokeragePercentages);
      
      const result = {
        monishit: monishitDistribution,
        hamsa: hamsaDistribution,
        total: {
          monishit: monishitAmount,
          hamsa: hamsaAmount,
          total: monishitAmount + hamsaAmount,
          superAdmin: monishitDistribution.superAdmin + hamsaDistribution.superAdmin
        }
      };

      console.log('[ConfigurationService] Expected distribution calculated:');
      console.log(`[ConfigurationService] - monishit:`, monishitDistribution);
      console.log(`[ConfigurationService] - hamsa:`, hamsaDistribution);
      console.log(`[ConfigurationService] - Total SuperAdmin earnings: ${result.total.superAdmin}`);

      return result;
      
    } catch (error) {
      console.error('[ConfigurationService] Error calculating expected distribution:', error);
      throw error;
    }
  }

  calculateUserDistribution(amount, percentages) {
    // Assume 5% of amount is brokerage
    const brokerageAmount = amount * 0.05;
    
    return {
      total: amount,
      brokerage: brokerageAmount,
      admin: brokerageAmount * (percentages.admin / 100),
      broker: brokerageAmount * (percentages.broker / 100),
      subBroker: brokerageAmount * (percentages.subBroker / 100),
      superAdmin: brokerageAmount * (percentages.superAdmin / 100)
    };
  }

  async configureSystemSettings(brokerageDistribution) {
    try {
      console.log('[ConfigurationService] Configuring system settings for test...');
      
      // Update system settings with test configuration
      await this.systemSettingsRepository.updateOne(
        {},
        {
          $set: {
            'brokerageSharing': {
              enabled: brokerageDistribution.enabled,
              mode: brokerageDistribution.mode,
              superAdminShare: brokerageDistribution.superAdminShare,
              adminShare: brokerageDistribution.adminShare,
              brokerShare: brokerageDistribution.brokerShare,
              subBrokerShare: brokerageDistribution.subBrokerShare
            }
          }
        },
        { upsert: true }
      );
      
      console.log('[ConfigurationService] System settings configured successfully');
      
    } catch (error) {
      console.error('[ConfigurationService] Error configuring system settings:', error);
      throw error;
    }
  }

  async configureReferralSettings(referralSettings) {
    try {
      console.log('[ConfigurationService] Configuring referral settings for test...');
      
      // Update referral eligibility settings
      await this.systemSettingsRepository.updateOne(
        {},
        {
          $set: {
            'referralEligibility': {
              enabled: referralSettings.enabled,
              thresholdAmount: referralSettings.thresholdAmount,
              thresholdUnit: referralSettings.thresholdUnit
            }
          }
        },
        { upsert: true }
      );
      
      console.log('[ConfigurationService] Referral settings configured successfully');
      
    } catch (error) {
      console.error('[ConfigurationService] Error configuring referral settings:', error);
      throw error;
    }
  }

  async setupTestEnvironment(testConfig) {
    try {
      console.log('[ConfigurationService] Setting up test environment...');
      
      // Configure system settings
      await this.configureSystemSettings(testConfig.brokerageDistribution);
      
      // Configure referral settings
      await this.configureReferralSettings(testConfig.referralSettings);
      
      console.log('[ConfigurationService] Test environment setup completed');
      
    } catch (error) {
      console.error('[ConfigurationService] Error setting up test environment:', error);
      throw error;
    }
  }

  async restoreOriginalSettings() {
    try {
      console.log('[ConfigurationService] Restoring original settings...');
      
      // Reset to default settings
      await this.systemSettingsRepository.updateOne(
        {},
        {
          $set: {
            'brokerageSharing': {
              enabled: true,
              mode: 'PERCENTAGE',
              superAdminShare: 20,
              adminShare: 25,
              brokerShare: 25,
              subBrokerShare: 30
            },
            'referralEligibility': {
              enabled: true,
              thresholdAmount: 1000,
              thresholdUnit: 'PER_CRORE'
            }
          }
        }
      );
      
      console.log('[ConfigurationService] Original settings restored');
      
    } catch (error) {
      console.error('[ConfigurationService] Error restoring original settings:', error);
    }
  }

  validateConfiguration(testConfig) {
    const errors = [];
    
    // Validate amounts
    if (!testConfig.monishitAmount || testConfig.monishitAmount <= 0) {
      errors.push('monishitAmount must be a positive number');
    }
    
    if (!testConfig.hamsaAmount || testConfig.hamsaAmount <= 0) {
      errors.push('hamsaAmount must be a positive number');
    }
    
    // Validate brokerage percentages
    const { brokeragePercentages } = testConfig;
    if (brokeragePercentages) {
      const totalPercentage = Object.values(brokeragePercentages).reduce((sum, val) => sum + val, 0);
      if (Math.abs(totalPercentage - 100) > 0.01) {
        errors.push(`Brokerage percentages must sum to 100%, got ${totalPercentage}%`);
      }
    }
    
    // Validate threshold
    if (!testConfig.superAdminThreshold || testConfig.superAdminThreshold <= 0) {
      errors.push('superAdminThreshold must be a positive number');
    }
    
    // Validate expected commission
    if (!testConfig.expectedReferralCommission || testConfig.expectedReferralCommission <= 0) {
      errors.push('expectedReferralCommission must be a positive number');
    }
    
    if (errors.length > 0) {
      console.error('[ConfigurationService] Configuration validation failed:', errors);
      throw new Error(`Configuration validation failed: ${errors.join(', ')}`);
    }
    
    console.log('[ConfigurationService] Configuration validation passed');
    return true;
  }
}
