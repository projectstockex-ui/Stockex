import Admin from '../models/Admin.js';
import WalletLedger from '../models/WalletLedger.js';

/** 100 crore (₹1,00,00,00,000) — max Kuber wallet balance */
export const KUBER_WALLET_MAX_BALANCE = 1_000_000_000;

export const KUBER_POOL_DEBIT_KIND = 'PATTI_KUBER_SHARE';
export const SA_PERSONAL_PATTI_DEBIT_KIND = 'PATTI_SA_PERSONAL_SHARE';
export const FRANCHISE_KUBER_SHARE_KIND = 'FRANCHISE_KUBER_SHARE';
export const KUBER_TO_MAIN_TRANSFER_KIND = 'KUBER_TO_MAIN_TRANSFER';

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

async function findActiveSuperAdmin() {
  return Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' }).select(
    '_id adminCode username wallet kuberWallet'
  );
}

/**
 * Kuber % of SA funding when crediting a downline admin:
 * - Franchise root → 100% Kuber
 * - Patti credit → admin's patti % (e.g. 75% Kuber, 25% main)
 * - Normal admin → 0% Kuber (100% main)
 */
export const INSUFFICIENT_SA_WALLET_MSG =
  'Not sufficient amount in main wallet or in Kuber wallet — please check';

/** Max enabled patti segment % for manual fund-deposit split. */
export function resolvePattiChildPctForFunding(targetAdmin) {
  if (!targetAdmin?.pattiSharing?.enabled) return null;
  const segments = targetAdmin.pattiSharing.segments || {};
  let best = null;
  for (const cfg of Object.values(segments)) {
    if (cfg?.enabled === false) continue;
    const pct = Number(cfg.adminPercentage ?? cfg.brokerPercentage);
    if (!Number.isFinite(pct)) continue;
    if (best == null || pct > best) best = pct;
  }
  return best;
}

export function resolveFundingPlanForAdmin(targetAdmin) {
  if (!targetAdmin || targetAdmin.role === 'SUPER_ADMIN') {
    return { kuberPct: 0, mode: 'none' };
  }
  if (targetAdmin.isFranchiseRoot === true) {
    return { kuberPct: 100, mode: 'franchise' };
  }
  const pattiPct = resolvePattiChildPctForFunding(targetAdmin);
  if (pattiPct != null) {
    return { kuberPct: pattiPct, mode: 'patti', pattiChildPct: pattiPct };
  }
  return { kuberPct: 0, mode: 'normal' };
}

export function validateSaFundingBalances(saDoc, total, kuberPct) {
  const { kuber, personal } = splitFundingByKuberPct(total, kuberPct);
  const mainBal = roundMoney(saDoc?.wallet?.balance ?? 0);
  const kuberBal = roundMoney(saDoc?.kuberWallet?.balance ?? 0);
  const mainOk = personal < 0.01 || mainBal + 1e-9 >= personal;
  const kuberOk = kuber < 0.01 || kuberBal + 1e-9 >= kuber;
  if (!mainOk || !kuberOk) {
    return {
      ok: false,
      message: INSUFFICIENT_SA_WALLET_MSG,
      mainRequired: personal,
      kuberRequired: kuber,
      mainAvailable: mainBal,
      kuberAvailable: kuberBal,
    };
  }
  return { ok: true, kuber, personal, mainAvailable: mainBal, kuberAvailable: kuberBal };
}

export function resolveSaFundingKuberPct(recipientAdmin, { isPattiCredit = false, pattiChildPct } = {}) {
  if (!recipientAdmin || recipientAdmin.role === 'SUPER_ADMIN') return null;
  if (recipientAdmin.isFranchiseRoot === true) return 100;
  if (
    isPattiCredit &&
    pattiChildPct != null &&
    Number.isFinite(Number(pattiChildPct))
  ) {
    return Math.min(100, Math.max(0, Number(pattiChildPct)));
  }
  return 0;
}

export function splitFundingByKuberPct(total, kuberPct) {
  const amt = roundMoney(Math.abs(Number(total)));
  const pct = Math.min(100, Math.max(0, Number(kuberPct) || 0));
  if (amt < 0.01) return { kuber: 0, personal: 0 };
  if (pct <= 0) return { kuber: 0, personal: amt };
  if (pct >= 100) return { kuber: amt, personal: 0 };
  const kuber = roundMoney((amt * pct) / 100);
  const personal = roundMoney(amt - kuber);
  return { kuber, personal };
}

function fundingLabel(kuberPct, isFranchise) {
  if (isFranchise || kuberPct >= 100) return 'Franchise share';
  if (kuberPct > 0) return 'Patti share';
  return 'Admin share';
}

function kuberDebitKind(kuberPct, isFranchise) {
  if (isFranchise || kuberPct >= 100) return FRANCHISE_KUBER_SHARE_KIND;
  return KUBER_POOL_DEBIT_KIND;
}

/**
 * Fund downline admin credit from Super Admin wallets.
 * kuberPct: % of amount from Kuber wallet; remainder from main wallet.
 */
export async function fundAdminShareFromSaWallets(amount, kuberPct, description, meta = {}) {
  const signed = Number(amount);
  const total = roundMoney(Math.abs(signed));
  if (!Number.isFinite(total) || total < 0.01) {
    return { ok: true, skipped: true };
  }

  const isRefund = signed < 0;
  const pct = Math.min(100, Math.max(0, Number(kuberPct) || 0));
  const isFranchise = meta.recipientIsFranchise === true;
  const { kuber, personal } = splitFundingByKuberPct(total, pct);

  const saBefore = await findActiveSuperAdmin();
  if (!saBefore) return { ok: false, skipped: false };

  if (!isRefund) {
    const check = validateSaFundingBalances(saBefore, total, pct);
    if (!check.ok) {
      const err = new Error(check.message);
      err.code = 'INSUFFICIENT_SA_WALLET';
      err.details = check;
      throw err;
    }
  }

  if (isRefund && kuber >= 0.01) {
    const curKuber = roundMoney(saBefore.kuberWallet?.balance ?? 0);
    if (curKuber + kuber > KUBER_WALLET_MAX_BALANCE) {
      throw new Error(
        `Kuber wallet cannot exceed 100 crore (max ${KUBER_WALLET_MAX_BALANCE.toLocaleString('en-IN')})`
      );
    }
  }

  const incFields = {};
  if (kuber >= 0.01) incFields['kuberWallet.balance'] = isRefund ? kuber : -kuber;
  if (personal >= 0.01) incFields['wallet.balance'] = isRefund ? personal : -personal;

  if (!Object.keys(incFields).length) return { ok: true, skipped: true };

  const updated = await Admin.findOneAndUpdate(
    { role: 'SUPER_ADMIN', status: 'ACTIVE' },
    { $inc: incFields },
    { new: true, select: '_id adminCode username wallet kuberWallet' }
  );

  if (!updated) return { ok: false, skipped: false };

  const adminLabel =
    meta.targetAdminName || meta.targetAdminCode || meta.pattiRootAdminName || 'admin';
  const shareLabel = fundingLabel(pct, isFranchise || meta.recipientIsFranchise);
  const baseMeta = {
    adminFunding: true,
    fundingKuberPct: pct,
    ...meta,
  };

  const kuberBal = roundMoney(updated.kuberWallet?.balance ?? 0);
  const mainBal = roundMoney(updated.wallet?.balance ?? 0);

  if (kuber >= 0.01) {
    await WalletLedger.create({
      ownerType: 'ADMIN',
      ownerId: updated._id,
      adminCode: updated.adminCode,
      type: isRefund ? 'CREDIT' : 'DEBIT',
      reason: 'ADJUSTMENT',
      amount: kuber,
      balanceAfter: kuberBal,
      description:
        description ||
        `${shareLabel} — Kuber wallet ${isRefund ? 'refund' : '→'} ${adminLabel} (${kuber.toFixed(2)})`,
      meta: {
        ...baseMeta,
        walletSource: 'KUBER',
        kuberWallet: true,
        poolDebitKind: kuberDebitKind(pct, meta.recipientIsFranchise),
      },
      reference: meta.reference || undefined,
    });
  }

  if (personal >= 0.01) {
    await WalletLedger.create({
      ownerType: 'ADMIN',
      ownerId: updated._id,
      adminCode: updated.adminCode,
      type: isRefund ? 'CREDIT' : 'DEBIT',
      reason: 'ADJUSTMENT',
      amount: personal,
      balanceAfter: mainBal,
      description:
        description ||
        `${shareLabel} — Main wallet ${isRefund ? 'refund' : '→'} ${adminLabel} (${personal.toFixed(2)})`,
      meta: {
        ...baseMeta,
        walletSource: 'MAIN',
        poolDebitKind: SA_PERSONAL_PATTI_DEBIT_KIND,
      },
      reference: meta.reference || undefined,
    });
  }

  if (kuberBal < 0 && !isRefund) {
    console.warn(
      `[Kuber wallet] Balance negative after funding ${kuber.toFixed(2)}: ${kuberBal.toFixed(2)} — top up Kuber wallet`
    );
  }

  return { ok: true, kuberBalanceAfter: kuberBal, mainBalanceAfter: mainBal, kuber, personal };
}

/** @deprecated Use fundAdminShareFromSaWallets */
export async function fundPattiShareToAdmin(amount, childPct, description, meta = {}) {
  return fundAdminShareFromSaWallets(amount, childPct, description, meta);
}

export function splitPattiFundingByChildPct(total, childPct) {
  return splitFundingByKuberPct(total, childPct);
}

/**
 * Transfer from Kuber wallet → Super Admin main wallet.
 */
export async function transferKuberToMainWallet(amount, meta = {}) {
  const amt = roundMoney(Number(amount));
  if (!Number.isFinite(amt) || amt < 0.01) {
    throw new Error('Enter a valid amount');
  }

  const sa = await findActiveSuperAdmin();
  if (!sa) throw new Error('No active Super Admin');

  const kuberBefore = roundMoney(sa.kuberWallet?.balance ?? 0);
  if (kuberBefore < amt) {
    throw new Error(INSUFFICIENT_SA_WALLET_MSG);
  }

  sa.kuberWallet.balance = roundMoney(kuberBefore - amt);
  sa.wallet.balance = roundMoney((sa.wallet?.balance ?? 0) + amt);
  await sa.save();

  const kuberAfter = sa.kuberWallet.balance;
  const mainAfter = sa.wallet.balance;
  const desc = meta.description || `Kuber wallet → Main wallet transfer (${amt.toFixed(2)})`;

  await WalletLedger.create({
    ownerType: 'ADMIN',
    ownerId: sa._id,
    adminCode: sa.adminCode,
    type: 'DEBIT',
    reason: 'ADJUSTMENT',
    amount: amt,
    balanceAfter: kuberAfter,
    description: desc,
    meta: {
      walletSource: 'KUBER',
      kuberWallet: true,
      poolDebitKind: KUBER_TO_MAIN_TRANSFER_KIND,
      transferDirection: 'KUBER_TO_MAIN',
      ...(meta.performedBy ? { performedBy: meta.performedBy } : {}),
    },
  });

  await WalletLedger.create({
    ownerType: 'ADMIN',
    ownerId: sa._id,
    adminCode: sa.adminCode,
    type: 'CREDIT',
    reason: 'ADJUSTMENT',
    amount: amt,
    balanceAfter: mainAfter,
    description: desc,
    meta: {
      walletSource: 'MAIN',
      poolDebitKind: KUBER_TO_MAIN_TRANSFER_KIND,
      transferDirection: 'KUBER_TO_MAIN',
      ...(meta.performedBy ? { performedBy: meta.performedBy } : {}),
    },
  });

  return {
    ok: true,
    amount: amt,
    kuberBalanceAfter: kuberAfter,
    mainBalanceAfter: mainAfter,
  };
}

export { findActiveSuperAdmin };
