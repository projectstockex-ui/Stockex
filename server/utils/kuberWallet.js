import Admin from '../models/Admin.js';
import WalletLedger from '../models/WalletLedger.js';

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

export const KUBER_POOL_DEBIT_KIND = 'PATTI_KUBER_SHARE';
export const SA_PERSONAL_PATTI_DEBIT_KIND = 'PATTI_SA_PERSONAL_SHARE';

async function findActiveSuperAdmin() {
  return Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' }).select(
    '_id adminCode username wallet kuberWallet'
  );
}

/**
 * Split funding using admin's configured patti % (e.g. 75 → 75% Kuber, 25% main wallet).
 */
export function splitPattiFundingByChildPct(total, childPct) {
  const amt = roundMoney(Math.abs(Number(total)));
  const pct = Math.min(100, Math.max(0, Number(childPct) || 0));
  if (amt < 0.01) return { kuber: 0, personal: 0 };
  if (pct <= 0) return { kuber: 0, personal: amt };
  if (pct >= 100) return { kuber: amt, personal: 0 };
  const kuber = roundMoney((amt * pct) / 100);
  const personal = roundMoney(amt - kuber);
  return { kuber, personal };
}

/**
 * Fund patti share credit to a downline admin:
 * - childPct% from Kuber wallet
 * - remainder from Super Admin main wallet
 * Pass negative amount to reverse (admin patti loss).
 */
export async function fundPattiShareToAdmin(amount, childPct, description, meta = {}) {
  const signed = Number(amount);
  const total = roundMoney(Math.abs(signed));
  if (!Number.isFinite(total) || total < 0.01) {
    return { ok: true, skipped: true };
  }

  const isRefund = signed < 0;
  const { kuber, personal } = splitPattiFundingByChildPct(total, childPct);

  const incFields = {};
  if (kuber >= 0.01) {
    incFields['kuberWallet.balance'] = isRefund ? kuber : -kuber;
  }
  if (personal >= 0.01) {
    incFields['wallet.balance'] = isRefund ? personal : -personal;
  }

  if (!Object.keys(incFields).length) {
    return { ok: true, skipped: true };
  }

  const updated = await Admin.findOneAndUpdate(
    { role: 'SUPER_ADMIN', status: 'ACTIVE' },
    { $inc: incFields },
    { new: true, select: '_id adminCode username wallet kuberWallet' }
  );

  if (!updated) {
    return { ok: false, skipped: false };
  }

  const adminLabel =
    meta.targetAdminName || meta.targetAdminCode || meta.pattiRootAdminName || 'admin';
  const baseMeta = {
    pattiFunding: true,
    pattiChildPct: childPct,
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
        `Patti share — Kuber wallet ${isRefund ? 'refund' : '→'} ${adminLabel} (${kuber.toFixed(2)})`,
      meta: {
        ...baseMeta,
        walletSource: 'KUBER',
        kuberWallet: true,
        poolDebitKind: KUBER_POOL_DEBIT_KIND,
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
        `Patti share — Main wallet ${isRefund ? 'refund' : '→'} ${adminLabel} (${personal.toFixed(2)})`,
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
      `[Kuber wallet] Balance negative after patti funding ${kuber.toFixed(2)}: ${kuberBal.toFixed(2)} — top up Kuber wallet`
    );
  }

  return { ok: true, kuberBalanceAfter: kuberBal, mainBalanceAfter: mainBal, kuber, personal };
}

export { findActiveSuperAdmin };
