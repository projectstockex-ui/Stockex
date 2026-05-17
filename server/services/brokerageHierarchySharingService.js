import Admin from '../models/Admin.js';
import WalletLedger from '../models/WalletLedger.js';

/**
 * Calculate and distribute extra brokerage between SuperAdmin and Admin
 * Only applies to perCrore brokerage at SuperAdmin ↔ Admin level
 * Sharing is ONLY on the extra amount, not total brokerage
 */
export class BrokerageHierarchySharingService {
  /**
   * Calculate extra brokerage and parent share
   * @param {Object} admin - The admin who charged the brokerage
   * @param {number} actualBrokerage - Actual brokerage charged
   * @returns {Object} - { extraAmount, parentShare, adminShareFromExtra }
   */
  calculateExtraBrokerage(admin, actualBrokerage) {
    // Only apply to Admin role (not Broker/Sub-Broker)
    if (admin.role !== 'ADMIN') {
      return { extraAmount: 0, parentShare: 0, adminShareFromExtra: 0 };
    }

    // Check if admin has brokerageCaps structure
    if (!admin.brokerageCaps || !admin.brokerageCaps.perCrore) {
      return { extraAmount: 0, parentShare: 0, adminShareFromExtra: 0 };
    }

    // Get parent's cap for this admin
    const parentCap = admin.brokerageCaps.perCrore.max || 0;
    
    if (parentCap === 0 || actualBrokerage <= parentCap) {
      return { extraAmount: 0, parentShare: 0, adminShareFromExtra: 0 };
    }

    const extraAmount = actualBrokerage - parentCap;
    const parentSharePercentage = admin.brokerageCaps.parentSharePercentage || 5;
    const parentShare = (extraAmount * parentSharePercentage) / 100;
    const adminShareFromExtra = extraAmount - parentShare;

    console.log('[BrokerageHierarchySharing] Extra brokerage calculation:', {
      admin: admin.name,
      actualBrokerage,
      parentCap,
      extraAmount,
      parentSharePercentage,
      parentShare,
      adminShareFromExtra
    });

    return { extraAmount, parentShare, adminShareFromExtra };
  }

  /**
   * Distribute shared amount to SuperAdmin and Admin wallets
   * @param {Object} admin - The admin who charged the brokerage
   * @param {Object} superAdmin - SuperAdmin document
   * @param {number} parentShare - Amount for SuperAdmin
   * @param {number} adminShareFromExtra - Amount for Admin from extra
   * @param {string} reference - Trade/order reference ID
   */
  async distributeSharedAmount(admin, superAdmin, parentShare, adminShareFromExtra, reference) {
    if (parentShare === 0) return;

    // Credit parent share to SuperAdmin
    if (superAdmin) {
      superAdmin.wallet.balance += parentShare;
      superAdmin.totalBrokerageEarned = (superAdmin.totalBrokerageEarned || 0) + parentShare;
      await superAdmin.save();

      // Add wallet ledger entry for SuperAdmin
      await WalletLedger.create({
        userId: superAdmin._id,
        userType: 'ADMIN',
        amount: parentShare,
        type: 'CREDIT',
        description: `Brokerage hierarchy share from ${admin.name}`,
        referenceId: reference,
        balance: superAdmin.wallet.balance
      });

      console.log('[BrokerageHierarchySharing] Credited to SuperAdmin:', {
        superAdmin: superAdmin.name,
        amount: parentShare,
        reference
      });
    }

    // Credit admin's extra share to Admin
    admin.wallet.balance += adminShareFromExtra;
    admin.totalBrokerageEarned = (admin.totalBrokerageEarned || 0) + adminShareFromExtra;
    await admin.save();

    // Add wallet ledger entry for Admin
    await WalletLedger.create({
      userId: admin._id,
      userType: 'ADMIN',
      amount: adminShareFromExtra,
      type: 'CREDIT',
      description: `Extra brokerage share (after parent share)`,
      referenceId: reference,
      balance: admin.wallet.balance
    });

    console.log('[BrokerageHierarchySharing] Credited to Admin:', {
      admin: admin.name,
      amount: adminShareFromExtra,
      reference
    });
  }

  /**
   * Process brokerage sharing for a trade
   * @param {Object} admin - The admin who charged the brokerage
   * @param {number} actualBrokerage - Actual brokerage charged
   * @param {string} reference - Trade/order reference ID
   */
  async processBrokerageSharing(admin, actualBrokerage, reference) {
    // Calculate sharing
    const { extraAmount, parentShare, adminShareFromExtra } = this.calculateExtraBrokerage(admin, actualBrokerage);

    if (parentShare === 0) return { shared: false, parentShare: 0, adminShareFromExtra };

    // Get SuperAdmin
    const superAdmin = await Admin.findOne({ role: 'SUPER_ADMIN' });
    if (!superAdmin) {
      console.error('[BrokerageHierarchySharing] SuperAdmin not found');
      return { shared: false, parentShare: 0, adminShareFromExtra };
    }

    // Distribute amounts
    await this.distributeSharedAmount(admin, superAdmin, parentShare, adminShareFromExtra, reference);

    return { shared: true, parentShare, adminShareFromExtra, extraAmount };
  }
}

export default new BrokerageHierarchySharingService();
