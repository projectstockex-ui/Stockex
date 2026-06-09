import Admin from '../models/Admin.js';
import WalletLedger from '../models/WalletLedger.js';

/**
 * BTC Jackpot Super Admin pool helpers.
 *
 *  - Bid placement  → Super Admin wallet CREDITED with the stake (points 2, 4).
 *  - Result declare → Super Admin wallet DEBITED to pay winners (point 10) and
 *                     DEBITED again to fund hierarchy brokerage (point 11).
 *
 * A single active SUPER_ADMIN is the counter-party; a negative wallet balance only
 * means the house needs a top-up (users must still be credited). This mirrors the
 * existing BTC Up/Down pool pattern so the game behaves identically at the money-flow
 * level, but all ledger rows are tagged with meta.gameKey (default 'btcJackpot') for filtering.
 * Pass meta.gameKey e.g. 'btcNumber' and poolDebitKind to tag other games using the same pool.
 */

async function findActiveSuperAdmin() {
  return Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' }).select(
    '_id adminCode username wallet'
  );
}

/**
 * Credit Super Admin amount when a user places a ticket.
 * @param {number} amount
 * @param {string} description
 * @param {object} [meta] — e.g. `{ gameKey: 'btcNumber', poolDebitKind: 'BTC_NUMBER_STAKE', relatedUserId }` overrides defaults
 */
export async function creditSuperAdminForBtcJackpotStake(amount, description, meta = {}) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { ok: true, skipped: true };
  }

  const updated = await Admin.findOneAndUpdate(
    { role: 'SUPER_ADMIN', status: 'ACTIVE' },
    { $inc: { 'wallet.balance': amt } },
    { new: true, select: 'wallet adminCode username' }
  );

  if (!updated) {
    throw new Error('No active Super Admin found to credit BTC Jackpot Bank');
  }

  const ledgerMeta = { gameKey: 'btcJackpot', poolDebitKind: 'BTC_JACKPOT_STAKE', ...meta };

  await WalletLedger.create({
    ownerType: 'ADMIN',
    ownerId: updated._id,
    adminCode: updated.adminCode,
    type: 'CREDIT',
    reason: 'ADJUSTMENT',
    amount: amt,
    balanceAfter: updated.wallet?.balance ?? 0,
    description: description || 'BTC Jackpot — stake to Bank (Super Admin)',
    meta: ledgerMeta,
  });

  return { ok: true, balanceAfter: updated.wallet?.balance ?? 0 };
}

/**
 * Debit Super Admin amount to pay a winner or a hierarchy member.
 * @param {number} amount
 * @param {string} description
 * @param {object} [meta]
 */
export async function debitSuperAdminForBtcJackpotPayout(amount, description, meta = {}) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { ok: true, skipped: true };
  }

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
    const gk = meta?.gameKey || 'btcJackpot';
    console.warn(
      `[${gk} pool] Super Admin balance went negative after debit ${amt.toFixed(2)}: ${bal.toFixed(
        2
      )} — top up SA wallet`
    );
  }

  const { hierarchyPayoutToRole, ...restMeta } = meta || {};
  const ledgerMeta = {
    gameKey: 'btcJackpot',
    poolDebitKind: 'BTC_JACKPOT_PAYOUT',
    ...restMeta,
    ...(hierarchyPayoutToRole ? { hierarchyPayoutToRole: String(hierarchyPayoutToRole) } : {}),
  };

  await WalletLedger.create({
    ownerType: 'ADMIN',
    ownerId: updated._id,
    adminCode: updated.adminCode,
    type: 'DEBIT',
    reason: 'ADJUSTMENT',
    amount: amt,
    balanceAfter: bal,
    description: description || 'BTC Jackpot — payout from Bank (Super Admin)',
    meta: ledgerMeta,
  });

  return { ok: true, balanceAfter: bal };
}

/**
 * Full rollback of a single stake — used when bid creation fails mid-flow.
 * Debits SA the exact amount previously credited, tagging it as a rollback.
 */
export async function rollbackBtcJackpotStakeCredit(amount, description, meta = {}) {
  return debitSuperAdminForBtcJackpotPayout(amount, description || 'BTC Jackpot — stake rollback', {
    poolDebitKind: 'BTC_JACKPOT_STAKE_ROLLBACK',
    ...meta,
  });
}

export { findActiveSuperAdmin };
