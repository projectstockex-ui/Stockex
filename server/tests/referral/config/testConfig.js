/**
 * Referral Test Configuration
 * 
 * Configuration for the monishit -> hamsa referral test case.
 * Dynamic configuration with SOLID principles.
 */

export const referralTestConfig = {
  // Test users configuration
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
      referredBy: 'MON123'  // Referred by monishit
    }
  },
  
  // Hierarchy configuration
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
  
  // Trading amounts
  monishitAmount: 2000,
  hamsaAmount: 2000,
  
  // Brokerage distribution percentages (of brokerage amount, not total amount)
  // Assuming 5% brokerage on total amount
  brokeragePercentages: {
    superAdmin: 25,  // 25% of brokerage = 125 from 500 brokerage (2000 * 5%)
    admin: 15,       // 15% of brokerage = 75 from 500 brokerage
    broker: 35,      // 35% of brokerage = 175 from 500 brokerage
    subBroker: 25    // 25% of brokerage = 125 from 500 brokerage
  },
  
  // SuperAdmin earnings threshold for referral commission
  superAdminThreshold: 1000,
  
  // Expected referral commission for monishit
  expectedReferralCommission: 1000,
  
  // Test execution settings
  testSettings: {
    cleanupAfterTest: true,
    generateReport: true,
    logLevel: 'verbose',
    timeoutMs: 30000
  }
};

// Expected distribution calculations
export const expectedResults = {
  phase1: {
    monishit: {
      tradingAmount: 2000,
      brokerageAmount: 100,  // 5% of 2000
      distribution: {
        admin: 15,      // 15
        broker: 35,     // 35
        subBroker: 25,  // 25
        superAdmin: 25  // 25
      },
      referralCommission: 0,  // No commission yet
      superAdminCumulative: 25
    }
  },
  phase2: {
    hamsa: {
      tradingAmount: 2000,
      brokerageAmount: 100,  // 5% of 2000
      distribution: {
        admin: 15,      // 15
        broker: 35,     // 35
        subBroker: 25,  // 25
        superAdmin: 25  // 25
      },
      referralCommission: 1000,  // Commission paid to monishit
      superAdminCumulative: 50  // Total: 25 + 25
    }
  },
  total: {
    superAdminEarnings: 50,  // 25 + 25
    monishitReferralCommission: 1000,
    totalBrokerageDistributed: 200  // 100 + 100
  }
};

// Test scenarios for different configurations
export const testScenarios = {
  // Standard scenario (as described by user)
  standard: {
    ...referralTestConfig,
    description: 'Standard monishit -> hamsa referral scenario with 2000 trading amounts'
  },
  
  // Low threshold scenario
  lowThreshold: {
    ...referralTestConfig,
    monishitAmount: 500,
    hamsaAmount: 500,
    superAdminThreshold: 25,
    expectedReferralCommission: 50,
    description: 'Low threshold scenario for quick testing'
  },
  
  // High threshold scenario
  highThreshold: {
    ...referralTestConfig,
    monishitAmount: 5000,
    hamsaAmount: 5000,
    superAdminThreshold: 2500,
    expectedReferralCommission: 2500,
    description: 'High threshold scenario'
  },
  
  // Different brokerage percentages
  differentBrokerage: {
    ...referralTestConfig,
    brokeragePercentages: {
      superAdmin: 30,
      admin: 20,
      broker: 30,
      subBroker: 20
    },
    description: 'Different brokerage distribution percentages'
  }
};

export default referralTestConfig;
