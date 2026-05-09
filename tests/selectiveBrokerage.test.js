/**
 * Selective Brokerage Integration Tests
 * Tests the roshini scenario and other selective brokerage functionality
 */

import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import mongoose from 'mongoose';
import Admin from '../server/models/Admin.js';
import { 
  shouldInheritBrokerageRestriction,
  getEffectiveBrokerageRestriction,
  shouldRedirectBrokerageToSuperAdmin
} from '../server/services/selectiveBrokerageService.js';
import { 
  shouldRedirectBrokerageToSuperAdminEnhanced,
  getComprehensiveBrokerageRestrictionStatus
} from '../server/services/brokerageRestrictionService.js';
import { BrokerageDistributionService } from '../server/services/brokerageDistributionService.js';

describe('Selective Brokerage Integration Tests', () => {
  let superAdmin, roshini, arjun, sohan, manish, dristhi;
  let brokerageService;

  beforeEach(async () => {
    // Create test hierarchy
    superAdmin = new Admin({
      username: 'superadmin',
      name: 'Super Admin',
      role: 'SUPER_ADMIN',
      restrictMode: {
        hierarchyInheritanceMode: 'FULL_INHERITANCE'
      }
    });

    roshini = new Admin({
      username: 'roshini',
      name: 'Roshini',
      role: 'ADMIN',
      createdBy: superAdmin._id,
      restrictMode: {
        hierarchyInheritanceMode: 'SELECTIVE_INHERITANCE',
        restrictBrokerage: {
          games: true,
          trading: true
        }
      }
    });

    arjun = new Admin({
      username: 'arjun',
      name: 'Arjun',
      role: 'BROKER',
      createdBy: roshini._id,
      restrictMode: {
        hierarchyInheritanceMode: 'FULL_INHERITANCE',
        restrictBrokerage: {
          games: false,
          trading: false
        }
      }
    });

    sohan = new Admin({
      username: 'sohan',
      name: 'Sohan',
      role: 'BROKER',
      createdBy: roshini._id,
      restrictMode: {
        hierarchyInheritanceMode: 'FULL_INHERITANCE',
        restrictBrokerage: {
          games: false,
          trading: false
        }
      }
    });

    manish = new Admin({
      username: 'manish',
      name: 'Manish',
      role: 'SUB_BROKER',
      createdBy: sohan._id,
      restrictMode: {
        hierarchyInheritanceMode: 'FULL_INHERITANCE',
        restrictBrokerage: {
          games: false,
          trading: false
        }
      }
    });

    dristhi = new Admin({
      username: 'dristhi',
      name: 'Dristhi',
      role: 'SUB_BROKER',
      createdBy: arjun._id,
      restrictMode: {
        hierarchyInheritanceMode: 'FULL_INHERITANCE',
        restrictBrokerage: {
          games: false,
          trading: false
        }
      }
    });

    await Promise.all([
      superAdmin.save(),
      roshini.save(),
      arjun.save(),
      sohan.save(),
      manish.save(),
      dristhi.save()
    ]);

    // Initialize brokerage distribution service
    brokerageService = new BrokerageDistributionService();
  });

  afterEach(async () => {
    await Admin.deleteMany({});
  });

  describe('Roshini Scenario Tests', () => {
    it('should not restrict brokerage for arjun when roshini is in selective mode', () => {
      // Arjun should NOT inherit roshini's restrictions
      const shouldInherit = shouldInheritBrokerageRestriction(roshini, arjun);
      expect(shouldInherit).to.be.false;
    });

    it('should redirect roshini brokerage to super admin', () => {
      // Roshini has direct restrictions
      const shouldRedirect = shouldRedirectBrokerageToSuperAdmin(roshini, 'games');
      expect(shouldRedirect).to.be.true;
    });

    it('should not redirect arjun brokerage to super admin', () => {
      // Arjun has no restrictions and doesn't inherit from roshini
      const shouldRedirect = shouldRedirectBrokerageToSuperAdminEnhanced(arjun, roshini, 'games');
      expect(shouldRedirect).to.be.false;
    });

    it('should not redirect sohan brokerage to super admin', () => {
      // Sohan has no restrictions and doesn't inherit from roshini
      const shouldRedirect = shouldRedirectBrokerageToSuperAdminEnhanced(sohan, roshini, 'games');
      expect(shouldRedirect).to.be.false;
    });

    it('should distribute brokerage correctly in roshini scenario', () => {
      const tradeData = {
        gamesBrokerage: 1000,
        tradingBrokerage: 500
      };

      const hierarchyPath = [roshini, arjun, sohan, manish];
      const distribution = brokerageService.distributeBrokerage(tradeData, hierarchyPath, 'games');

      // Roshini should be restricted (0 brokerage)
      const roshiniDistribution = distribution.find(d => d.adminId.toString() === roshini._id.toString());
      expect(roshiniDistribution.brokerageAmount).to.equal(0);
      expect(roshiniDistribution.isRestricted).to.be.true;
      expect(roshiniDistribution.redirectedToSuperAdmin).to.be.true;

      // Arjun should receive brokerage
      const arjunDistribution = distribution.find(d => d.adminId.toString() === arjun._id.toString());
      expect(arjunDistribution.brokerageAmount).to.be.greaterThan(0);
      expect(arjunDistribution.isRestricted).to.be.false;

      // Sohan should receive brokerage
      const sohanDistribution = distribution.find(d => d.adminId.toString() === sohan._id.toString());
      expect(sohanDistribution.brokerageAmount).to.be.greaterThan(0);
      expect(sohanDistribution.isRestricted).to.be.false;

      // Manish should receive brokerage
      const manishDistribution = distribution.find(d => d.adminId.toString() === manish._id.toString());
      expect(manishDistribution.brokerageAmount).to.be.greaterThan(0);
      expect(manishDistribution.isRestricted).to.be.false;
    });

    it('should show correct effective restrictions for each admin', () => {
      // Roshini should have effective restrictions
      const roshiniEffective = getEffectiveBrokerageRestriction(roshini, superAdmin);
      expect(roshiniEffective.games).to.be.true;
      expect(roshiniEffective.trading).to.be.true;
      expect(roshiniEffective.inheritanceMode).to.equal('SELECTIVE_INHERITANCE');

      // Arjun should have no effective restrictions
      const arjunEffective = getEffectiveBrokerageRestriction(arjun, roshini);
      expect(arjunEffective.games).to.be.false;
      expect(arjunEffective.trading).to.be.false;
      expect(arjunEffective.inheritanceMode).to.equal('FULL_INHERITANCE');

      // Sohan should have no effective restrictions
      const sohanEffective = getEffectiveBrokerageRestriction(sohan, roshini);
      expect(sohanEffective.games).to.be.false;
      expect(sohanEffective.trading).to.be.false;
      expect(sohanEffective.inheritanceMode).to.equal('FULL_INHERITANCE');
    });
  });

  describe('Full Inheritance Mode Tests', () => {
    beforeEach(async () => {
      // Change roshini to full inheritance mode
      await Admin.findByIdAndUpdate(roshini._id, {
        'restrictMode.hierarchyInheritanceMode': 'FULL_INHERITANCE'
      });
      await roshini.reload();
    });

    it('should restrict brokerage for arjun when roshini is in full inheritance mode', () => {
      // Arjun should inherit roshini's restrictions
      const shouldInherit = shouldInheritBrokerageRestriction(roshini, arjun);
      expect(shouldInherit).to.be.true;
    });

    it('should redirect arjun brokerage to super admin in full inheritance mode', () => {
      // Arjun should inherit roshini's restrictions
      const shouldRedirect = shouldRedirectBrokerageToSuperAdminEnhanced(arjun, roshini, 'games');
      expect(shouldRedirect).to.be.true;
    });

    it('should distribute brokerage correctly in full inheritance mode', () => {
      const tradeData = { gamesBrokerage: 1000 };
      const hierarchyPath = [roshini, arjun, sohan];
      const distribution = brokerageService.distributeBrokerage(tradeData, hierarchyPath, 'games');

      // Both roshini and arjun should be restricted
      const restrictedCount = distribution.filter(d => d.isRestricted).length;
      expect(restrictedCount).to.equal(2);
    });
  });

  describe('Comprehensive Status Tests', () => {
    it('should provide comprehensive brokerage restriction status', () => {
      const comprehensiveStatus = getComprehensiveBrokerageRestrictionStatus(arjun, roshini);

      expect(comprehensiveStatus).to.have.property('games');
      expect(comprehensiveStatus).to.have.property('trading');
      expect(comprehensiveStatus).to.have.property('anyRestricted');
      expect(comprehensiveStatus).to.have.property('hierarchyInheritanceMode');
      expect(comprehensiveStatus).to.have.property('inheritedRestrictions');
      expect(comprehensiveStatus).to.have.property('effectiveRestrictions');

      expect(comprehensiveStatus.hierarchyInheritanceMode).to.equal('FULL_INHERITANCE');
      expect(comprehensiveStatus.inheritedRestrictions.games).to.be.false; // No inheritance in selective mode
      expect(comprehensiveStatus.effectiveRestrictions.games).to.be.false;
    });
  });

  describe('Brokerage Distribution Summary Tests', () => {
    it('should provide accurate distribution summary', () => {
      const tradeData = { gamesBrokerage: 1000 };
      const hierarchyPath = [roshini, arjun, sohan];
      const distribution = brokerageService.distributeBrokerage(tradeData, hierarchyPath, 'games');
      const summary = brokerageService.getDistributionSummary(distribution);

      expect(summary).to.have.property('totalBrokerage');
      expect(summary).to.have.property('distributedBrokerage');
      expect(summary).to.have.property('restrictedBrokerage');
      expect(summary).to.have.property('superAdminBrokerage');
      expect(summary).to.have.property('adminBreakdown');
      expect(summary).to.have.property('segments');

      expect(summary.restrictedBrokerage).to.be.greaterThan(0); // Roshini restricted
      expect(summary.distributedBrokerage).to.be.greaterThan(0); // Others receive
    });
  });

  describe('Validation Tests', () => {
    it('should validate selective brokerage data correctly', async () => {
      const { validateSelectiveBrokerageData } = await import('../server/services/selectiveBrokerageService.js');

      // Valid data
      const validData = {
        hierarchyInheritanceMode: 'SELECTIVE_INHERITANCE',
        restrictBrokerage: {
          games: true,
          trading: false
        }
      };
      const validResult = validateSelectiveBrokerageData(validData);
      expect(validResult.isValid).to.be.true;
      expect(validResult.errors).to.be.empty;

      // Invalid inheritance mode
      const invalidData = {
        hierarchyInheritanceMode: 'INVALID_MODE',
        restrictBrokerage: {
          games: true,
          trading: false
        }
      };
      const invalidResult = validateSelectiveBrokerageData(invalidData);
      expect(invalidResult.isValid).to.be.false;
      expect(invalidResult.errors).to.not.be.empty;
    });

    it('should validate distribution parameters', () => {
      const tradeData = { gamesBrokerage: 1000 };
      const hierarchyPath = [roshini, arjun];
      const segment = 'games';

      const validResult = brokerageService.validateDistributionParameters(tradeData, hierarchyPath, segment);
      expect(validResult.isValid).to.be.true;

      const invalidResult = brokerageService.validateDistributionParameters(null, hierarchyPath, segment);
      expect(invalidResult.isValid).to.be.false;
      expect(invalidResult.errors).to.include('Invalid trade data');
    });
  });

  describe('Permission Tests', () => {
    it('should allow super admin to modify any selective brokerage settings', async () => {
      const { canModifySelectiveBrokerage } = await import('../server/services/selectiveBrokerageService.js');

      const canModify = canModifySelectiveBrokerage(superAdmin, roshini);
      expect(canModify).to.be.true;
    });

    it('should not allow broker to modify admin settings', async () => {
      const { canModifySelectiveBrokerage } = await import('../server/services/selectiveBrokerageService.js');

      const canModify = canModifySelectiveBrokerage(arjun, roshini);
      expect(canModify).to.be.false;
    });

    it('should allow admin to modify their direct brokers', async () => {
      const { canModifySelectiveBrokerage } = await import('../server/services/selectiveBrokerageService.js');

      const canModify = canModifySelectiveBrokerage(roshini, arjun);
      expect(canModify).to.be.true;
    });
  });
});
