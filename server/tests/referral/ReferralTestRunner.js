/**
 * Referral Test Runner
 * 
 * Main runner for the referral brokerage test case.
 * Implements the complete monishit -> hamsa referral scenario using SOLID principles.
 */

import { ReferralTestOrchestrator } from './ReferralTestOrchestrator.js';
import { ReferralTestDataService } from './ReferralTestDataService.js';
import { ReferralTestConfigurationService } from './ReferralTestConfigurationService.js';
import { ReferralTestExecutionService } from './ReferralTestExecutionService.js';
import { ReferralTestVerificationService } from './ReferralTestVerificationService.js';
import { ReferralTestCleanupService } from './ReferralTestCleanupService.js';
import referralTestConfig from './config/testConfig.js';

// Import models and services
import User from '../../models/User.js';
import Admin from '../../models/Admin.js';
import Referral from '../../models/Referral.js';
import WalletLedger from '../../models/WalletLedger.js';
import SuperAdminHierarchyEarnings from '../../models/SuperAdminHierarchyEarnings.js';
import SystemSettings from '../../models/SystemSettings.js';
import GameSettings from '../../models/GameSettings.js';

// Import services
import TradeService from '../../services/tradeService.js';
import { processConditionalReferralPayout } from '../../services/referralPayoutService.js';
import { trackHierarchyEarnings } from '../../services/superAdminEarningsService.js';

export class ReferralTestRunner {
  constructor() {
    // Initialize services with dependency injection
    this.orchestrator = new ReferralTestOrchestrator(
      new ReferralTestDataService(User, Admin, Referral),
      new ReferralTestConfigurationService(SystemSettings, GameSettings),
      new ReferralTestExecutionService(
        TradeService,
        null, // Will be set to use TradeService.distributeBrokerage
        { processConditionalReferralPayout },
        { trackHierarchyEarnings }
      ),
      new ReferralTestVerificationService(WalletLedger, SuperAdminHierarchyEarnings, User),
      new ReferralTestCleanupService(User, Admin, Referral, WalletLedger, SuperAdminHierarchyEarnings)
    );
  }

  async runTest(testConfig = referralTestConfig) {
    const testStartTime = new Date();
    
    try {
      console.log('='.repeat(80));
      console.log('🚀 STARTING REFERRAL BROKERAGE TEST');
      console.log('='.repeat(80));
      console.log(`[TestRunner] Test started at: ${testStartTime.toISOString()}`);
      console.log(`[TestRunner] Test scenario: ${testConfig.description || 'Standard monishit -> hamsa referral'}`);
      console.log(`[TestRunner] monishit amount: ${testConfig.monishitAmount}`);
      console.log(`[TestRunner] hamsa amount: ${testConfig.hamsaAmount}`);
      console.log(`[TestRunner] SuperAdmin threshold: ${testConfig.superAdminThreshold}`);
      console.log(`[TestRunner] Expected referral commission: ${testConfig.expectedReferralCommission}`);
      console.log('-'.repeat(80));

      // Validate configuration
      await this.validateTestConfiguration(testConfig);

      // Setup test environment
      await this.setupTestEnvironment(testConfig);

      // Execute the test
      const result = await this.orchestrator.executeReferralTest(testConfig);

      // Generate final report
      const report = await this.generateFinalReport(result, testStartTime);

      console.log('='.repeat(80));
      console.log('📊 FINAL TEST RESULTS');
      console.log('='.repeat(80));
      this.printFinalResults(report);
      console.log('='.repeat(80));

      return report;

    } catch (error) {
      console.error('='.repeat(80));
      console.error('❌ TEST EXECUTION FAILED');
      console.error('='.repeat(80));
      console.error('[TestRunner] Error:', error.message);
      console.error('[TestRunner] Stack:', error.stack);
      console.error('='.repeat(80));
      
      // Attempt cleanup even on failure
      try {
        await this.forceCleanup();
      } catch (cleanupError) {
        console.error('[TestRunner] Cleanup failed:', cleanupError.message);
      }
      
      throw error;
    }
  }

  async validateTestConfiguration(testConfig) {
    console.log('[TestRunner] Validating test configuration...');
    
    const errors = [];
    
    // Validate required fields
    if (!testConfig.users || !testConfig.users.monishit || !testConfig.users.hamsa) {
      errors.push('Missing user configuration for monishit and/or hamsa');
    }
    
    if (!testConfig.hierarchy || !testConfig.hierarchy.superAdmin || !testConfig.hierarchy.admin || 
        !testConfig.hierarchy.broker || !testConfig.hierarchy.subBroker) {
      errors.push('Missing complete hierarchy configuration');
    }
    
    // Validate amounts
    if (!testConfig.monishitAmount || testConfig.monishitAmount <= 0) {
      errors.push('monishitAmount must be a positive number');
    }
    
    if (!testConfig.hamsaAmount || testConfig.hamsaAmount <= 0) {
      errors.push('hamsaAmount must be a positive number');
    }
    
    // Validate referral relationship
    if (testConfig.users.hamsa.referredBy !== testConfig.users.monishit.referralCode) {
      errors.push('hamsa must be referred by monishit');
    }
    
    if (errors.length > 0) {
      throw new Error(`Configuration validation failed: ${errors.join(', ')}`);
    }
    
    console.log('[TestRunner] ✅ Configuration validation passed');
  }

  async setupTestEnvironment(testConfig) {
    console.log('[TestRunner] Setting up test environment...');
    
    try {
      // Configure system settings for test
      const configService = new ReferralTestConfigurationService(SystemSettings, GameSettings);
      await configService.setupTestEnvironment(testConfig);
      
      console.log('[TestRunner] ✅ Test environment setup completed');
      
    } catch (error) {
      console.error('[TestRunner] Error setting up test environment:', error);
      throw error;
    }
  }

  async generateFinalReport(result, testStartTime) {
    const testEndTime = new Date();
    const duration = testEndTime - testStartTime;
    
    const report = {
      testInfo: {
        startTime: testStartTime,
        endTime: testEndTime,
        duration: `${duration}ms`,
        scenario: 'monishit -> hamsa referral test'
      },
      results: result,
      summary: {
        overallPassed: result.overallPassed,
        totalChecks: this.countTotalChecks(result),
        passedChecks: this.countPassedChecks(result),
        failedChecks: this.countFailedChecks(result)
      }
    };
    
    return report;
  }

  printFinalResults(report) {
    const { testInfo, results, summary } = report;
    
    console.log(`⏱️  Test Duration: ${testInfo.duration}`);
    console.log(`📋 Total Checks: ${summary.totalChecks}`);
    console.log(`✅ Passed: ${summary.passedChecks}`);
    console.log(`❌ Failed: ${summary.failedChecks}`);
    console.log(`🎯 Overall Result: ${summary.overallPassed ? 'PASSED' : 'FAILED'}`);
    
    console.log('\n📊 Phase Results:');
    for (const [phase, phaseResults] of Object.entries(results)) {
      if (phase === 'overallPassed' || phase === 'failures') continue;
      
      console.log(`\n  ${phase.toUpperCase()}:`);
      for (const [check, result] of Object.entries(phaseResults)) {
        if (typeof result === 'object' && result.hasOwnProperty('passed')) {
          const status = result.passed ? '✅' : '❌';
          console.log(`    ${status} ${check}: ${result.passed ? 'PASSED' : 'FAILED'}`);
          if (!result.passed && result.expected !== undefined && result.actual !== undefined) {
            console.log(`       Expected: ${result.expected}, Actual: ${result.actual}`);
          }
        }
      }
    }
    
    if (results.failures && results.failures.length > 0) {
      console.log('\n❌ Failed Checks:');
      results.failures.forEach(failure => {
        console.log(`  - ${failure}`);
      });
    }
    
    console.log('\n🎯 Test Scenario Summary:');
    console.log('  Phase 1: monishit trades 2000 → SuperAdmin earns 500 → monishit gets 0 referral');
    console.log('  Phase 2: hamsa trades 2000 → SuperAdmin earns 500 more → monishit gets 1000 referral');
    console.log(`  Expected: monishit receives 1000 referral commission after SuperAdmin reaches 1000 threshold`);
  }

  countTotalChecks(results) {
    let count = 0;
    for (const [phase, phaseResults] of Object.entries(results)) {
      if (phase === 'overallPassed' || phase === 'failures') continue;
      for (const [check, result] of Object.entries(phaseResults)) {
        if (typeof result === 'object' && result.hasOwnProperty('passed')) {
          count++;
        }
      }
    }
    return count;
  }

  countPassedChecks(results) {
    let count = 0;
    for (const [phase, phaseResults] of Object.entries(results)) {
      if (phase === 'overallPassed' || phase === 'failures') continue;
      for (const [check, result] of Object.entries(phaseResults)) {
        if (typeof result === 'object' && result.passed) {
          count++;
        }
      }
    }
    return count;
  }

  countFailedChecks(results) {
    let count = 0;
    for (const [phase, phaseResults] of Object.entries(results)) {
      if (phase === 'overallPassed' || phase === 'failures') continue;
      for (const [check, result] of Object.entries(phaseResults)) {
        if (typeof result === 'object' && !result.passed) {
          count++;
        }
      }
    }
    return count;
  }

  async forceCleanup() {
    console.log('[TestRunner] Performing force cleanup...');
    
    try {
      const cleanupService = new ReferralTestCleanupService(
        User, Admin, Referral, WalletLedger, SuperAdminHierarchyEarnings
      );
      await cleanupService.forceCleanup();
      await cleanupService.restoreOriginalSettings();
      
      console.log('[TestRunner] ✅ Force cleanup completed');
      
    } catch (error) {
      console.error('[TestRunner] Error during force cleanup:', error);
    }
  }
}

// Auto-run the test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const testRunner = new ReferralTestRunner();
  
  testRunner.runTest()
    .then(report => {
      console.log('\n🎉 Test completed successfully!');
      process.exit(report.results.overallPassed ? 0 : 1);
    })
    .catch(error => {
      console.error('\n💥 Test failed:', error.message);
      process.exit(1);
    });
}

export default ReferralTestRunner;
