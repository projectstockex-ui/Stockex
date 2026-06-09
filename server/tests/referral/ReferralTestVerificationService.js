/**
 * Referral Test Verification Service
 * 
 * Verifies test results for referral brokerage distribution scenarios.
 * Follows SOLID principles with single responsibility for result verification.
 */

export class ReferralTestVerificationService {
  constructor(walletLedgerRepository, superAdminEarningsRepository, userRepository) {
    this.walletLedgerRepository = walletLedgerRepository;
    this.superAdminEarningsRepository = superAdminEarningsRepository;
    this.userRepository = userRepository;
  }

  async verifyReferralCommission(params) {
    const { referrer, referredUser, expectedAmount, phase, startTime } = params;
    
    try {
      console.log(`[VerificationService] Verifying referral commission for ${referrer.username} (Phase: ${phase})`);
      console.log(`[VerificationService] Expected amount: ${expectedAmount}`);
      
      // Check wallet ledger for referral commission entries
      const referralEntries = await this.walletLedgerRepository.find({
        ownerType: 'USER',
        ownerId: referrer._id,
        reason: 'REFERRAL_COMMISSION',
        createdAt: { $gte: startTime }
      }).sort({ createdAt: 1 });

      console.log(`[VerificationService] Found ${referralEntries.length} referral commission entries`);

      // Calculate total commission
      const totalCommission = referralEntries.reduce((sum, entry) => {
        console.log(`[VerificationService] - Entry: ${entry.amount} at ${entry.createdAt}`);
        return sum + entry.amount;
      }, 0);

      const passed = Math.abs(totalCommission - expectedAmount) < 0.01;
      
      const verificationResult = {
        expectedAmount,
        actualAmount: totalCommission,
        passed,
        phase,
        entries: referralEntries,
        referrer: referrer.username,
        referredUser: referredUser?.username
      };

      if (passed) {
        console.log(`[VerificationService] ✅ Referral commission verification PASSED for ${referrer.username}`);
        console.log(`[VerificationService] Expected: ${expectedAmount}, Got: ${totalCommission}`);
      } else {
        console.log(`[VerificationService] ❌ Referral commission verification FAILED for ${referrer.username}`);
        console.log(`[VerificationService] Expected: ${expectedAmount}, Got: ${totalCommission}`);
        console.log(`[VerificationService] Entries found:`, referralEntries.map(e => ({ amount: e.amount, createdAt: e.createdAt })));
      }

      return verificationResult;
      
    } catch (error) {
      console.error(`[VerificationService] Error verifying referral commission for ${referrer.username}:`, error);
      throw error;
    }
  }

  async verifyBrokerageDistribution(params) {
    const { user, expectedDistribution, phase, startTime } = params;
    
    try {
      console.log(`[VerificationService] Verifying brokerage distribution for ${user.username} (Phase: ${phase})`);
      console.log(`[VerificationService] Expected distribution:`, expectedDistribution);
      
      // Check wallet ledger entries for brokerage distribution
      const brokerageEntries = await this.walletLedgerRepository.find({
        reason: 'TRADE_PNL',
        createdAt: { $gte: startTime }
      }).sort({ createdAt: 1 });

      console.log(`[VerificationService] Found ${brokerageEntries.length} brokerage entries`);

      // Group entries by role
      const actualDistribution = {};
      
      for (const entry of brokerageEntries) {
        const role = this.getRoleFromDescription(entry.description);
        if (!actualDistribution[role]) {
          actualDistribution[role] = 0;
        }
        actualDistribution[role] += entry.amount;
        console.log(`[VerificationService] - ${role}: ${entry.amount} (${entry.description})`);
      }

      // Compare expected vs actual
      const comparison = this.compareDistributions(expectedDistribution, actualDistribution);
      const passed = comparison.passed;

      const verificationResult = {
        expected: expectedDistribution,
        actual: actualDistribution,
        comparison,
        passed,
        phase,
        entries: brokerageEntries,
        user: user.username
      };

      if (passed) {
        console.log(`[VerificationService] ✅ Brokerage distribution verification PASSED for ${user.username}`);
      } else {
        console.log(`[VerificationService] ❌ Brokerage distribution verification FAILED for ${user.username}`);
        console.log(`[VerificationService] Expected:`, expectedDistribution);
        console.log(`[VerificationService] Actual:`, actualDistribution);
        console.log(`[VerificationService] Differences:`, comparison.differences);
      }

      return verificationResult;
      
    } catch (error) {
      console.error(`[VerificationService] Error verifying brokerage distribution for ${user.username}:`, error);
      throw error;
    }
  }

  async verifySuperAdminEarnings(params) {
    const { hierarchyId, expectedEarnings, segment } = params;
    
    try {
      console.log(`[VerificationService] Verifying SuperAdmin earnings for hierarchy ${hierarchyId}`);
      console.log(`[VerificationService] Expected earnings: ${expectedEarnings}`);
      
      const earningsRecord = await this.superAdminEarningsRepository.findOne({
        hierarchyId,
        segment
      });

      const actualEarnings = earningsRecord?.totalEarnings || 0;
      
      const passed = Math.abs(actualEarnings - expectedEarnings) < 0.01;
      
      const verificationResult = {
        expected: expectedEarnings,
        actual: actualEarnings,
        passed,
        hierarchyId,
        segment,
        record: earningsRecord
      };

      if (passed) {
        console.log(`[VerificationService] ✅ SuperAdmin earnings verification PASSED`);
        console.log(`[VerificationService] Expected: ${expectedEarnings}, Got: ${actualEarnings}`);
      } else {
        console.log(`[VerificationService] ❌ SuperAdmin earnings verification FAILED`);
        console.log(`[VerificationService] Expected: ${expectedEarnings}, Got: ${actualEarnings}`);
      }

      return verificationResult;
      
    } catch (error) {
      console.error('[VerificationService] Error verifying SuperAdmin earnings:', error);
      throw error;
    }
  }

  async verifyUserWalletBalance(params) {
    const { user, expectedBalance, walletType = 'wallet' } = params;
    
    try {
      console.log(`[VerificationService] Verifying ${walletType} balance for ${user.username}`);
      console.log(`[VerificationService] Expected balance: ${expectedBalance}`);
      
      // Get updated user data
      const updatedUser = await this.userRepository.findById(user._id);
      
      const actualBalance = walletType === 'wallet' 
        ? (updatedUser.wallet?.balance || 0)
        : (updatedUser.gamesWallet?.balance || 0);
      
      const passed = Math.abs(actualBalance - expectedBalance) < 0.01;
      
      const verificationResult = {
        expected: expectedBalance,
        actual: actualBalance,
        passed,
        walletType,
        user: user.username
      };

      if (passed) {
        console.log(`[VerificationService] ✅ ${walletType} balance verification PASSED for ${user.username}`);
        console.log(`[VerificationService] Expected: ${expectedBalance}, Got: ${actualBalance}`);
      } else {
        console.log(`[VerificationService] ❌ ${walletType} balance verification FAILED for ${user.username}`);
        console.log(`[VerificationService] Expected: ${expectedBalance}, Got: ${actualBalance}`);
      }

      return verificationResult;
      
    } catch (error) {
      console.error(`[VerificationService] Error verifying ${walletType} balance for ${user.username}:`, error);
      throw error;
    }
  }

  async verifyAdminWalletBalance(params) {
    const { admin, expectedBalance, walletType = 'wallet' } = params;
    
    try {
      console.log(`[VerificationService] Verifying ${walletType} balance for admin ${admin.username}`);
      console.log(`[VerificationService] Expected balance: ${expectedBalance}`);
      
      // Get updated admin data
      const updatedAdmin = await Admin.findById(admin._id);
      
      const actualBalance = walletType === 'wallet' 
        ? (updatedAdmin.wallet?.balance || 0)
        : (updatedAdmin.temporaryWallet?.balance || 0);
      
      const passed = Math.abs(actualBalance - expectedBalance) < 0.01;
      
      const verificationResult = {
        expected: expectedBalance,
        actual: actualBalance,
        passed,
        walletType,
        admin: admin.username
      };

      if (passed) {
        console.log(`[VerificationService] ✅ Admin ${walletType} balance verification PASSED for ${admin.username}`);
        console.log(`[VerificationService] Expected: ${expectedBalance}, Got: ${actualBalance}`);
      } else {
        console.log(`[VerificationService] ❌ Admin ${walletType} balance verification FAILED for ${admin.username}`);
        console.log(`[VerificationService] Expected: ${expectedBalance}, Got: ${actualBalance}`);
      }

      return verificationResult;
      
    } catch (error) {
      console.error(`[VerificationService] Error verifying admin ${walletType} balance for ${admin.username}:`, error);
      throw error;
    }
  }

  async verifyReferralRelationship(params) {
    const { referrer, referredUser } = params;
    
    try {
      console.log(`[VerificationService] Verifying referral relationship: ${referredUser.username} referred by ${referrer.username}`);
      
      // Check if referred user has correct referrer
      const updatedReferredUser = await this.userRepository.findById(referredUser._id);
      const actualReferrer = updatedReferredUser.referredBy;
      
      const passed = actualReferrer === referrer.referralCode;
      
      const verificationResult = {
        expected: referrer.referralCode,
        actual: actualReferrer,
        passed,
        referrer: referrer.username,
        referredUser: referredUser.username
      };

      if (passed) {
        console.log(`[VerificationService] ✅ Referral relationship verification PASSED`);
        console.log(`[VerificationService] ${referredUser.username} correctly referred by ${referrer.username}`);
      } else {
        console.log(`[VerificationService] ❌ Referral relationship verification FAILED`);
        console.log(`[VerificationService] Expected: ${referrer.referralCode}, Got: ${actualReferrer}`);
      }

      return verificationResult;
      
    } catch (error) {
      console.error('[VerificationService] Error verifying referral relationship:', error);
      throw error;
    }
  }

  getRoleFromDescription(description) {
    if (!description) return 'UNKNOWN';
    
    if (description.includes('Super Admin')) return 'SUPER_ADMIN';
    if (description.includes('ADMIN share')) return 'ADMIN';
    if (description.includes('BROKER share')) return 'BROKER';
    if (description.includes('SUB_BROKER share')) return 'SUB_BROKER';
    if (description.includes('Full brokerage')) return 'DIRECT_ADMIN';
    
    return 'UNKNOWN';
  }

  compareDistributions(expected, actual) {
    const differences = [];
    let passed = true;
    
    for (const [role, expectedAmount] of Object.entries(expected)) {
      const actualAmount = actual[role] || 0;
      const difference = Math.abs(actualAmount - expectedAmount);
      
      if (difference > 0.01) {
        passed = false;
        differences.push({
          role,
          expected: expectedAmount,
          actual: actualAmount,
          difference
        });
      }
    }
    
    // Check for unexpected roles in actual distribution
    for (const role of Object.keys(actual)) {
      if (!expected.hasOwnProperty(role)) {
        differences.push({
          role,
          expected: 0,
          actual: actual[role],
          difference: actual[role],
          unexpected: true
        });
        passed = false;
      }
    }
    
    return {
      passed,
      differences
    };
  }

  async generateVerificationReport(results) {
    try {
      console.log('[VerificationService] Generating verification report...');
      
      const report = {
        timestamp: new Date(),
        overallPassed: true,
        summary: {
          totalChecks: 0,
          passedChecks: 0,
          failedChecks: 0
        },
        details: {}
      };
      
      for (const [phase, phaseResults] of Object.entries(results)) {
        if (phase === 'overallPassed') continue;
        
        report.details[phase] = {
          checks: [],
          passed: true
        };
        
        for (const [checkType, result] of Object.entries(phaseResults)) {
          if (typeof result === 'object' && result.hasOwnProperty('passed')) {
            report.summary.totalChecks++;
            
            if (result.passed) {
              report.summary.passedChecks++;
            } else {
              report.summary.failedChecks++;
              report.overallPassed = false;
              report.details[phase].passed = false;
            }
            
            report.details[phase].checks.push({
              type: checkType,
              passed: result.passed,
              expected: result.expected,
              actual: result.actual,
              details: result
            });
          }
        }
      }
      
      console.log('[VerificationService] Verification report generated:');
      console.log(`[VerificationService] - Total checks: ${report.summary.totalChecks}`);
      console.log(`[VerificationService] - Passed: ${report.summary.passedChecks}`);
      console.log(`[VerificationService] - Failed: ${report.summary.failedChecks}`);
      console.log(`[VerificationService] - Overall: ${report.overallPassed ? 'PASSED' : 'FAILED'}`);
      
      return report;
      
    } catch (error) {
      console.error('[VerificationService] Error generating verification report:', error);
      throw error;
    }
  }
}
