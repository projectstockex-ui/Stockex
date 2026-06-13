import Admin from '../models/Admin.js';
import WalletLedger from '../models/WalletLedger.js';
import RefundableSecurityDeposit from '../models/RefundableSecurityDeposit.js';
import RefundableSecurityCollection from '../models/RefundableSecurityCollection.js';

export function isRefundableSecurityRole(role) {
  return role === 'BROKER' || role === 'SUB_BROKER' || role === 'ADMIN';
}

function roleLabelForSecurity(role) {
  if (role === 'ADMIN') return 'admin';
  if (role === 'SUB_BROKER') return 'sub-broker';
  return 'broker';
}

export function getPendingSecurityAmount(deposit) {
  if (!deposit) return 0;
  const total = Number(deposit.amount) || 0;
  const collected = Number(deposit.collectedAmount) || 0;
  return Math.max(0, total - collected);
}

export async function findRefundableDeposit(adminId) {
  return RefundableSecurityDeposit.findOne({ adminId }).sort({ createdAt: -1 });
}

/**
 * On broker/sub-broker/admin create: negative opening wallet + deposit record + ledger.
 */
export async function initializeRefundableSecurityOnCreate(admin, securityAmount, createdBy) {
  const amount = Number(securityAmount);
  if (!isRefundableSecurityRole(admin.role) || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  admin.wallet = admin.wallet || {};
  admin.wallet.balance = -amount;
  admin.wallet.totalDeposited = admin.wallet.totalDeposited || 0;
  await admin.save();

  const deposit = await RefundableSecurityDeposit.create({
    adminId: admin._id,
    adminCode: admin.adminCode,
    brokerName: admin.name || admin.username || '',
    role: admin.role,
    stateName: admin.stateName || '',
    stateCode: admin.stateCode || '',
    cityName: admin.cityName || '',
    cityCode: admin.cityCode || '',
    areaName: admin.areaName || '',
    areaPincode: admin.areaPincode || '',
    amount,
    collectedAmount: 0,
    status: 'PENDING',
    createdBy,
  });

  await WalletLedger.create({
    ownerType: 'ADMIN',
    ownerId: admin._id,
    adminCode: admin.adminCode,
    type: 'DEBIT',
    reason: 'REFUNDABLE_SECURITY_DUE',
    amount,
    balanceAfter: admin.wallet.balance,
    description: `Refundable amount due on ${roleLabelForSecurity(admin.role)} creation`,
    performedBy: createdBy,
    meta: { depositId: deposit._id, securityAmount: amount },
  });

  return deposit;
}

/**
 * After full transfer amount is credited to wallet, apply pending refundable slice (if any).
 */
export async function applyRefundableSecurityOnCredit(targetAdmin, transferAmount, ctx = {}) {
  const amount = Number(transferAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      securityApplied: 0,
      pendingBefore: 0,
      pendingAfter: 0,
      netUsableFromTransfer: amount || 0,
    };
  }

  const deposit = await findRefundableDeposit(targetAdmin._id);
  const pendingBefore = getPendingSecurityAmount(deposit);
  const securityApplied = Math.min(amount, pendingBefore);

  if (securityApplied <= 0 || !deposit) {
    return {
      securityApplied: 0,
      pendingBefore,
      pendingAfter: pendingBefore,
      netUsableFromTransfer: amount,
    };
  }

  deposit.collectedAmount = (Number(deposit.collectedAmount) || 0) + securityApplied;
  deposit.status =
    deposit.collectedAmount >= Number(deposit.amount) ? 'COLLECTED' : 'PARTIAL';
  await deposit.save();

  const collection = await RefundableSecurityCollection.create({
    depositId: deposit._id,
    adminId: targetAdmin._id,
    adminCode: targetAdmin.adminCode,
    brokerName: targetAdmin.name || targetAdmin.username || deposit.brokerName || '',
    role: targetAdmin.role,
    amount: securityApplied,
    transferAmount: amount,
    collectedBy: ctx.performedBy || null,
    source: ctx.source || 'ADMIN_DEPOSIT',
    description:
      ctx.description ||
      `Refundable security collected from fund transfer to ${targetAdmin.adminCode}`,
    stateName: deposit.stateName || '',
    stateCode: deposit.stateCode || '',
    cityName: deposit.cityName || '',
    cityCode: deposit.cityCode || '',
    areaName: deposit.areaName || '',
    areaPincode: deposit.areaPincode || '',
  });

  const superAdmin = await Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' }).select(
    '_id adminCode wallet',
  );

  if (superAdmin) {
    await WalletLedger.create({
      ownerType: 'ADMIN',
      ownerId: superAdmin._id,
      adminCode: superAdmin.adminCode,
      type: 'CREDIT',
      reason: 'REFUNDABLE_SECURITY_COLLECTED',
      amount: securityApplied,
      balanceAfter: superAdmin.wallet?.balance ?? 0,
      description: `Refundable security from ${targetAdmin.adminCode} (${targetAdmin.name || targetAdmin.username || roleLabelForSecurity(targetAdmin.role)})`,
      performedBy: ctx.performedBy || null,
      meta: {
        collectionId: collection._id,
        depositId: deposit._id,
        brokerAdminId: targetAdmin._id,
        brokerAdminCode: targetAdmin.adminCode,
        transferAmount: amount,
        netToBrokerWallet: amount - securityApplied,
      },
    });
  }

  const pendingAfter = getPendingSecurityAmount(deposit);

  return {
    securityApplied,
    pendingBefore,
    pendingAfter,
    netUsableFromTransfer: amount - securityApplied,
    depositStatus: deposit.status,
    collectionId: collection._id,
  };
}

/**
 * Build Super Admin refundable security feed (opening dues + collections).
 */
export async function buildRefundableSecurityFeed(filter = {}, limit = 500) {
  const deposits = await RefundableSecurityDeposit.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const depositIds = deposits.map((d) => d._id);
  const collections = depositIds.length
    ? await RefundableSecurityCollection.find({ depositId: { $in: depositIds } })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()
    : [];

  const dueRows = deposits.map((d) => ({
    _id: d._id,
    rowType: 'DUE',
    brokerName: d.brokerName,
    adminCode: d.adminCode,
    role: d.role,
    amount: Number(d.amount) || 0,
    collectedAmount: Number(d.collectedAmount) || 0,
    pendingAmount: getPendingSecurityAmount(d),
    status: d.status || 'PENDING',
    stateName: d.stateName,
    stateCode: d.stateCode,
    cityName: d.cityName,
    cityCode: d.cityCode,
    areaName: d.areaName,
    areaPincode: d.areaPincode,
    createdAt: d.createdAt,
  }));

  const collectedRows = collections.map((c) => ({
    _id: c._id,
    rowType: 'COLLECTED',
    brokerName: c.brokerName,
    adminCode: c.adminCode,
    role: c.role,
    amount: Number(c.amount) || 0,
    transferAmount: Number(c.transferAmount) || 0,
    stateName: c.stateName,
    stateCode: c.stateCode,
    cityName: c.cityName,
    cityCode: c.cityCode,
    areaName: c.areaName,
    areaPincode: c.areaPincode,
    createdAt: c.createdAt,
    description: c.description,
  }));

  const rows = [...collectedRows, ...dueRows].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );

  const totalDue = deposits.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const totalCollected = deposits.reduce((s, d) => s + (Number(d.collectedAmount) || 0), 0);
  const totalPending = deposits.reduce((s, d) => s + getPendingSecurityAmount(d), 0);

  return {
    deposits: rows,
    summary: {
      count: deposits.length,
      totalAmount: totalDue,
      totalCollected,
      totalPending,
      collectionCount: collections.length,
    },
  };
}
