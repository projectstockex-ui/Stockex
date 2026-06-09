/**
 * Referral Test Orchestrator
 * 
 * Main coordinator for referral brokerage test case.
 * Orchestrates the complete monishit -> hamsa referral test scenario.
 * Follows SOLID principles with single responsibility.
 */

import { ObjectId } from 'mongoose';

export class ReferralTestOrchestrator {
  constructor(
    testDataService,
    configurationService,
    executionService,
    verificationService,
    cleanupService
  ) {
    this.testDataService = testDataService;
    this.configurationService = configurationService;
    this.executionService = executionService;
    this.verificationService = verificationService;
    this.cleanupService = cleanupService;
  }

  async executeReferralTest(testConfig) {
    let setupResult = null;
    
    try {
      console.log('[ReferralTest] Starting referral test execution...');
      
      // Phase 1: Setup test environment
      console.log('[ReferralTest] Phase 1: Setting up test environment...');
      setupResult = await this.setupTestEnvironment(testConfig);
      
      // Phase 2: Execute monishit trading
      console.log('[ReferralTest] Phase 2: Executing monishit trading activity...');
      const monishitResult = await this.executePhase1(setupResult);
      
      // Phase 3: Execute hamsa trading
      console.log('[ReferralTest] Phase 3: Executing hamsa trading activity...');
      const hamsaResult = await this.executePhase2(setupResult);
      
      // Phase 4: Verify results
      console.log('[ReferralTest] Phase 4: Verifying test results...');
      const verificationResult = await this.verifyTestResults(monishitResult, hamsaResult);
      
      // Phase 5: Cleanup
      console.log('[ReferralTest] Phase 5: Cleaning up test data...');
      await this.cleanupService.cleanup(setupResult);
      
      console.log('[ReferralTest] Test execution completed successfully');
      return verificationResult;
      
    } catch (error) {
      console.error('[ReferralTest] Test execution failed:', error);
      if (setupResult) {
        try {
          await this.cleanupService.cleanup(setupResult);
        } catch (cleanupError) {
          console.error('[ReferralTest] Cleanup failed:', cleanupError);
        }
      }
      throw error;
    }
  }

  async setupTestEnvironment(testConfig) {
    console.log('[ReferralTest] Creating test users...');
    const users = await this.testDataService.createTestUsers(testConfig.users);
    
    console.log('[ReferralTest] Setting up hierarchy...');
    const hierarchy = await this.testDataService.setupHierarchy(testConfig.hierarchy);
    
    console.log('[ReferralTest] Assigning users to admins...');
    await this.testDataService.assignUsersToAdmins(users, hierarchy);
    
    console.log('[ReferralTest] Getting configuration...');
    const configuration = await this.configurationService.getConfiguration(testConfig);
    
    return {
      users,
      hierarchy,
      configuration,
      testConfig,
      startTime: new Date()
    };
  }

  async executePhase1(setupResult) {
    const { users, configuration } = setupResult;
    
    console.log(`[ReferralTest] Phase 1: Simulating monishit trading with ${configuration.monishitAmount}`);
    
    // Simulate monishit trading activity
    const monishitTrading = await this.executionService.executeTradingActivity({
      user: users.monishit,
      amount: configuration.monishitAmount,
      segment: 'trading'
    });
    
    console.log(`[ReferralTest] Phase 1: SuperAdmin earnings from monishit: ${monishitTrading.superAdminEarnings}`);
    
    // Verify monishit gets 0 referral commission
    console.log('[ReferralTest] Phase 1: Verifying monishit gets 0 referral commission...');
    const referralCheck = await this.verificationService.verifyReferralCommission({
      referrer: users.monishit,
      expectedAmount: 0,
      phase: 'phase1',
      startTime: setupResult.startTime
    });
    
    // Verify brokerage distribution
    console.log('[ReferralTest] Phase 1: Verifying brokerage distribution...');
    const brokerageCheck = await this.verificationService.verifyBrokerageDistribution({
      user: users.monishit,
      expectedDistribution: configuration.expectedDistribution.monishit,
      phase: 'phase1',
      startTime: setupResult.startTime
    });
    
    // Verify SuperAdmin earnings
    console.log('[ReferralTest] Phase 1: Verifying SuperAdmin earnings...');
    const earningsCheck = await this.verificationService.verifySuperAdminEarnings({
      hierarchyId: setupResult.hierarchy.admin._id,
      expectedEarnings: configuration.expectedDistribution.monishit.superAdmin,
      segment: 'trading'
    });
    
    return {
      trading: monishitTrading,
      referral: referralCheck,
      brokerage: brokerageCheck,
      earnings: earningsCheck,
      superAdminEarnings: monishitTrading.superAdminEarnings
    };
  }

  async executePhase2(setupResult) {
    const { users, configuration } = setupResult;
    
    console.log(`[ReferralTest] Phase 2: Simulating hamsa trading with ${configuration.hamsaAmount}`);
    
    // Simulate hamsa trading activity
    const hamsaTrading = await this.executionService.executeTradingActivity({
      user: users.hamsa,
      amount: configuration.hamsaAmount,
      segment: 'trading'
    });
    
    console.log(`[ReferralTest] Phase 2: SuperAdmin earnings from hamsa: ${hamsaTrading.superAdminEarnings}`);
    
    // Total SuperAdmin earnings after both users
    const totalSuperAdminEarnings = setupResult.phase1Result?.superAdminEarnings + hamsaTrading.superAdminEarnings;
    console.log(`[ReferralTest] Phase 2: Total SuperAdmin earnings: ${totalSuperAdminEarnings}`);
    
    // Verify monishit gets 1000 referral commission (after threshold reached)
    console.log(`[ReferralTest] Phase 2: Verifying monishit gets ${configuration.expectedReferralCommission} referral commission...`);
    const referralCheck = await this.verificationService.verifyReferralCommission({
      referrer: users.monishit,
      referredUser: users.hamsa,
      expectedAmount: configuration.expectedReferralCommission,
      phase: 'phase2',
      startTime: setupResult.startTime
    });
    
    // Verify brokerage distribution
    console.log('[ReferralTest] Phase 2: Verifying brokerage distribution...');
    const brokerageCheck = await this.verificationService.verifyBrokerageDistribution({
      user: users.hamsa,
      expectedDistribution: configuration.expectedDistribution.hamsa,
      phase: 'phase2',
      startTime: setupResult.startTime
    });
    
    // Verify SuperAdmin earnings
    console.log('[ReferralTest] Phase 2: Verifying total SuperAdmin earnings...');
    const earningsCheck = await this.verificationService.verifySuperAdminEarnings({
      hierarchyId: setupResult.hierarchy.admin._id,
      expectedEarnings: totalSuperAdminEarnings,
      segment: 'trading'
    });
    
    return {
      trading: hamsaTrading,
      referral: referralCheck,
      brokerage: brokerageCheck,
      earnings: earningsCheck,
      superAdminEarnings: hamsaTrading.superAdminEarnings,
      totalSuperAdminEarnings
    };
  }

  async verifyTestResults(monishitResult, hamsaResult) {
    console.log('[ReferralTest] Final verification of test results...');
    
    const results = {
      phase1: {
        referral: monishitResult.referral.passed,
        brokerage: monishitResult.brokerage.passed,
        earnings: monishitResult.earnings.passed
      },
      phase2: {
        referral: hamsaResult.referral.passed,
        brokerage: hamsaResult.brokerage.passed,
        earnings: hamsaResult.earnings.passed
      },
      overallPassed: true,
      failures: []
    };
    
    // Check overall pass status
    for (const [phase, phaseResults] of Object.entries(results)) {
      if (phase === 'overallPassed' || phase === 'failures') continue;
      
      for (const [check, passed] of Object.entries(phaseResults)) {
        if (!passed) {
          results.overallPassed = false;
          results.failures.push(`${phase}-${check} failed`);
        }
      }
    }
    
    // Log final results
    if (results.overallPassed) {
      console.log('[ReferralTest] ✅ ALL TESTS PASSED - Referral logic working correctly');
      console.log('[ReferralTest] Phase 1: monishit got 0 referral (SuperAdmin: 500)');
      console.log('[ReferralTest] Phase 2: monishit got 1000 referral (SuperAdmin: 1000 total)');
    } else {
      console.log('[ReferralTest] ❌ TESTS FAILED - Referral logic needs attention');
      console.log('[ReferralTest] Failures:', results.failures);
    }
    
    return results;
  }
}
