/**
 * Simple Test Runner for Referral Brokerage Test
 * 
 * Simplified runner to test the monishit -> hamsa referral scenario.
 */

console.log('🚀 Starting Referral Brokerage Test...');
console.log('Test Scenario: monishit -> hamsa referral');
console.log('Expected: monishit gets 1000 referral after SuperAdmin earns 1000 from both users');

try {
  // Import required modules
  const { ReferralTestOrchestrator } = require('./ReferralTestOrchestrator.js');
  const { ReferralTestDataService } = require('./ReferralTestDataService.js');
  const { ReferralTestConfigurationService } = require('./ReferralTestConfigurationService.js');
  const { ReferralTestExecutionService } = require('./ReferralTestExecutionService.js');
  const { ReferralTestVerificationService } = require('./ReferralTestVerificationService.js');
  const { ReferralTestCleanupService } = require('./ReferralTestCleanupService.js');
  const referralTestConfig = require('./config/testConfig.js');

  // Import models
  const User = require('../../models/User.js');
  const Admin = require('../../models/Admin.js');
  const Referral = require('../../models/Referral.js');
  const WalletLedger = require('../../models/WalletLedger.js');
  const SuperAdminHierarchyEarnings = require('../../models/SuperAdminHierarchyEarnings.js');
  const SystemSettings = require('../../models/SystemSettings.js');
  const GameSettings = require('../../models/GameSettings.js');

  // Import services
  const TradeService = require('../../services/tradeService.js');
  const { processConditionalReferralPayout } = require('../../services/referralPayoutService.js');
  const { trackHierarchyEarnings } = require('../../services/superAdminEarningsService.js');

  // Test configuration
  const testConfig = {
    users: {
      monishit: {
        username: 'monishit_test',
        email: 'monishit@test.com',
        password: 'password123',
        referralCode: 'MON123',
        referredBy: null
      },
      hamsa: {
        username: 'hamsa_test',
        email: 'hamsa@test.com',
        password: 'password123',
        referralCode: 'HAM123',
        referredBy: 'MON123'
      }
    },
    
    hierarchy: {
      superAdmin: {
        username: 'sa_test',
        adminCode: 'SA001',
        role: 'SUPER_ADMIN',
        parentId: null
      },
      admin: {
        username: 'admin_test',
        adminCode: 'ADM001',
        role: 'ADMIN',
        parentId: 'sa_test'
      },
      broker: {
        username: 'broker_test',
        adminCode: 'BRK001',
        role: 'BROKER',
        parentId: 'admin_test'
      },
      subBroker: {
        username: 'subbroker_test',
        adminCode: 'SUB001',
        role: 'SUB_BROKER',
        parentId: 'broker_test'
      }
    },
    
    monishitAmount: 2000,
    hamsaAmount: 2000,
    
    brokeragePercentages: {
      superAdmin: 25,  // 125 from 500 brokerage (2000 * 5%)
      admin: 15,       // 75 from 500 brokerage
      broker: 35,      // 175 from 500 brokerage
      subBroker: 25    // 125 from 500 brokerage
    },
    
    superAdminThreshold: 1000,
    expectedReferralCommission: 1000
  };

  // Initialize services
  const testDataService = new ReferralTestDataService(User, Admin, Referral);
  const configurationService = new ReferralTestConfigurationService(SystemSettings, GameSettings);
  const verificationService = new ReferralTestVerificationService(WalletLedger, SuperAdminHierarchyEarnings, User);
  const cleanupService = new ReferralTestCleanupService(User, Admin, Referral, WalletLedger, SuperAdminHierarchyEarnings);

  // Execution service with mock implementations
  const executionService = new ReferralTestExecutionService(
    TradeService,
    null, // Will use mock implementation
    { processConditionalReferralPayout },
    { trackHierarchyEarnings }
  );

  const orchestrator = new ReferralTestOrchestrator(
    testDataService,
    configurationService,
    executionService,
    verificationService,
    cleanupService
  );

  // Run the test
  orchestrator.executeReferralTest(testConfig)
    .then(result => {
      console.log('\n🎉 TEST COMPLETED');
      console.log('='.repeat(50));
      
      if (result.overallPassed) {
        console.log('✅ ALL TESTS PASSED - Referral logic working correctly');
        console.log('✅ Phase 1: monishit got 0 referral (SuperAdmin: 500)');
        console.log('✅ Phase 2: monishit got 1000 referral (SuperAdmin: 1000 total)');
      } else {
        console.log('❌ TESTS FAILED - Referral logic needs attention');
        console.log('❌ Failures:', result.failures);
      }
      
      console.log('='.repeat(50));
      process.exit(result.overallPassed ? 0 : 1);
    })
    .catch(error => {
      console.error('\n💥 TEST FAILED');
      console.error('='.repeat(50));
      console.error('Error:', error.message);
      console.error('Stack:', error.stack);
      console.error('='.repeat(50));
      process.exit(1);
    });

} catch (error) {
  console.error('\n💥 INITIALIZATION FAILED');
  console.error('='.repeat(50));
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);
  console.error('='.repeat(50));
  process.exit(1);
}
