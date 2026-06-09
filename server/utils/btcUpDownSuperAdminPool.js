import Admin from '../models/Admin.js';
import WalletLedger from '../models/WalletLedger.js';

/**
 * BTC Up/Down and pooled games (e.g. Nifty Jackpot): stakes credit the active Super Admin wallet on bet.
 * On win: SA is debited once for gross payouts to winners, then again for brokerage / gross-hierarchy T when
 * distributeWinBrokerage(..., fundFromBtcPool: true) or creditNiftyJackpotGrossHierarchyFromPool runs
 * (separate debits per settlement path). Nifty Up/Down does not use this pool.
 */

export async function findActiveSuperAdmin() {
  return Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' })
    .select('_id username adminCode wallet stats')
    .lean();
}

/**
 * Credit Super Admin wallet (bet stake enters house pool). No hierarchy distribution.
 */
export async function creditBtcUpDownSuperAdminPool(amount, description) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return null;

  const updated = await Admin.findOneAndUpdate(
    { role: 'SUPER_ADMIN', status: 'ACTIVE' },
    { $inc: { 'wallet.balance': amt } },
    { new: true, select: 'wallet adminCode username' }
  );

  if (!updated) {
    throw new Error('No active Super Admin found to credit BTC Up/Down stake pool');
  }

  await WalletLedger.create({
    ownerType: 'ADMIN',
    ownerId: updated._id,
    adminCode: updated.adminCode,
    type: 'CREDIT',
    reason: 'ADJUSTMENT',
    amount: amt,
    balanceAfter: updated.wallet?.balance ?? 0,
    description: description || 'BTC Up/Down — stake to Super Admin pool (bet)',
  });

  return updated;
}

/**
 * Debit Super Admin wallet to pay BTC Up/Down winners / brokerage splits.
 * Always applies the debit (no $gte guard): a single winner’s payout exceeds their stake,
 * so the pool would often block settlement if we required balance >= amount. Negative SA
 * balance means the house needs a top-up; users must still be credited.
 */
export async function debitBtcUpDownSuperAdminPool(amount, description, ledgerMeta = null) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return { ok: true, skipped: true };

  const updated = await Admin.findOneAndUpdate(
    { role: 'SUPER_ADMIN', status: 'ACTIVE' },
    { $inc: { 'wallet.balance': -amt } },
    { new: true, select: 'wallet adminCode username' }
  );

  if (!updated) {
    return { ok: false, skipped: false };
  }

  const bal = updated.wallet?.balance ?? 0;
  if (bal < 0) {
    console.warn(
      `[BTC Up/Down pool] Super Admin balance went negative after debit ${amt.toFixed(2)}: ${bal.toFixed(2)} — top up SA wallet`
    );
  }

  const meta =
    ledgerMeta && typeof ledgerMeta === 'object' && !Array.isArray(ledgerMeta) ? { ...ledgerMeta } : {};

  await WalletLedger.create({
    ownerType: 'ADMIN',
    ownerId: updated._id,
    adminCode: updated.adminCode,
    type: 'DEBIT',
    reason: 'ADJUSTMENT',
    amount: amt,
    balanceAfter: bal,
    description: description || 'BTC Up/Down — payout from Super Admin pool (win)',
    ...(Object.keys(meta).length ? { meta } : {}),
  });

  return { ok: true, skipped: false };
}
