import User from '../models/User.js';
import { recalculateUsedMargin } from './recalculateUsedMargin.js';
import { isAbsurdWalletInr, sanitizeInrWalletAmount } from './walletBalanceSanity.js';

/**
 * NSE & BSE dedicated wallet — replaces legacy wallet.tradingBalance.
 */

export function defaultNseBseWallet() {
  return {
    balance: 0,
    usedMargin: 0,
    realizedPnL: 0,
    unrealizedPnL: 0,
    todayRealizedPnL: 0,
    todayUnrealizedPnL: 0,
  };
}

export function normalizeWalletTransferKey(key) {
  const k = String(key || '').trim();
  if (k === 'tradingAccount') return 'nseBseWallet';
  return k;
}

/** Always read live balances from MongoDB (avoids stale / un-hydrated Mongoose docs). */
export async function readNseBseWalletFromDb(userId) {
  const doc = await User.collection.findOne(
    { _id: userId },
    {
      projection: {
        'nseBseWallet.balance': 1,
        'nseBseWallet.usedMargin': 1,
        'wallet.tradingBalance': 1,
        'wallet.usedMargin': 1,
        'wallet.cashBalance': 1,
        'wallet.balance': 1,
      },
    }
  );
  const rawBalance =
    doc?.nseBseWallet?.balance != null
      ? Number(doc.nseBseWallet.balance) || 0
      : Number(doc?.wallet?.tradingBalance) || 0;
  const balance = sanitizeInrWalletAmount(rawBalance, {
    field: 'nseBseWallet.balance',
    userId: String(userId),
    log: isAbsurdWalletInr(rawBalance),
  });
  const hasNseWallet = doc?.nseBseWallet != null;
  const usedMargin = hasNseWallet
    ? doc.nseBseWallet.usedMargin != null && doc.nseBseWallet.usedMargin !== ''
      ? Number(doc.nseBseWallet.usedMargin) || 0
      : 0
    : Number(doc?.wallet?.usedMargin) || 0;
  const mainBalance = Number(doc?.wallet?.cashBalance ?? doc?.wallet?.balance) || 0;
  return { balance, usedMargin, mainBalance, raw: doc };
}

export function getNseBseBalance(userOrDoc) {
  const w = userOrDoc?.nseBseWallet;
  if (w != null && w.balance != null && w.balance !== '') {
    return Number(w.balance) || 0;
  }
  return Number(userOrDoc?.wallet?.tradingBalance) || 0;
}

export function getNseBseUsedMargin(userOrDoc) {
  const w = userOrDoc?.nseBseWallet;
  // Dedicated NSE/BSE wallet exists — never read legacy wallet.usedMargin (often MCX margin).
  if (w != null) {
    if (w.usedMargin != null && w.usedMargin !== '') {
      return Number(w.usedMargin) || 0;
    }
    return 0;
  }
  return Number(userOrDoc?.wallet?.usedMargin) || 0;
}

export function getNseBseAvailable(userOrDoc) {
  return Math.max(0, getNseBseBalance(userOrDoc) - getNseBseUsedMargin(userOrDoc));
}

/**
 * One-time legacy migration via $set only — never resets existing nseBseWallet.balance to 0.
 */
export async function migrateNseBseWalletIfNeeded(userId) {
  const { balance, usedMargin, raw } = await readNseBseWalletFromDb(userId);
  const legacyTrading = Number(raw?.wallet?.tradingBalance) || 0;
  const legacyUsed = Number(raw?.wallet?.usedMargin) || 0;
  const storedBal = raw?.nseBseWallet?.balance;
  const storedUm = raw?.nseBseWallet?.usedMargin;
  const updates = {};

  // Move legacy tradingBalance into nseBseWallet.balance when the stamped field is missing/zero
  // (readNseBseWalletFromDb may still report the legacy total as "balance" for display).
  const needsBalanceMigrate =
    legacyTrading > 0 && (storedBal == null || storedBal === '' || Number(storedBal) === 0);
  if (needsBalanceMigrate) {
    updates['nseBseWallet.balance'] = legacyTrading;
    updates['wallet.tradingBalance'] = 0;
  }

  const hasNseWallet = raw?.nseBseWallet != null;
  const needsUmMigrate =
    !hasNseWallet &&
    legacyUsed > 0 &&
    (storedUm == null || storedUm === '') &&
    usedMargin === 0;
  if (needsUmMigrate) {
    updates['nseBseWallet.usedMargin'] = legacyUsed;
    updates['wallet.usedMargin'] = 0;
  }

  if (Object.keys(updates).length > 0) {
    await User.updateOne({ _id: userId }, { $set: updates });
  }
  return readNseBseWalletFromDb(userId);
}

/** Migrate legacy balance + persist recalculated usedMargin before atomic DB debit. */
export async function prepareNseBseWalletForTransfer(userId) {
  await migrateNseBseWalletIfNeeded(userId);
  await recalculateUsedMargin(userId);
  return readNseBseWalletFromDb(userId);
}

/** Sync in-memory user doc from DB — never user.save() (that could wipe nseBseWallet.balance to 0). */
export async function ensureNseBseWalletMigrated(user) {
  if (!user?._id) return user;
  const live = await migrateNseBseWalletIfNeeded(user._id);
  if (!user.nseBseWallet) user.nseBseWallet = {};
  user.nseBseWallet.balance = live.balance;
  user.nseBseWallet.usedMargin = live.usedMargin;
  return user;
}

/**
 * Main → NSE&BSE or reverse. Uses $inc on MongoDB paths (creates nseBseWallet if missing).
 */
export async function applyMainNseBseTransfer(userId, amount, direction) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new Error('Invalid amount');
  }
  if (!['toAccount', 'toWallet'].includes(direction)) {
    throw new Error('Invalid transfer direction');
  }

  await migrateNseBseWalletIfNeeded(userId);
  const before = await readNseBseWalletFromDb(userId);

  if (direction === 'toAccount') {
    if (amt > before.mainBalance) {
      throw new Error(
        `Insufficient balance in Main Wallet. Available: ${before.mainBalance.toLocaleString('en-IN')}`
      );
    }
    const result = await User.findOneAndUpdate(
      { _id: userId, 'wallet.cashBalance': { $gte: amt } },
      {
        $inc: {
          'wallet.cashBalance': -amt,
          'wallet.balance': -amt,
          'nseBseWallet.balance': amt,
        },
        $set: { 'wallet.tradingBalance': 0 },
      },
      { new: true }
    );
    if (!result) {
      throw new Error(`Insufficient balance in Main Wallet. Available: ${before.mainBalance.toLocaleString('en-IN')}`);
    }
    const afterIn = await readNseBseWalletFromDb(userId);
    const { bumpWalletLedgerReferenceOnCredit } = await import('../services/ledgerAutosquareService.js');
    await bumpWalletLedgerReferenceOnCredit(userId, 'nseBseWallet', afterIn.balance);
  } else {
    const available = before.balance - before.usedMargin;
    if (amt > available) {
      throw new Error(
        `Insufficient free balance in NSE & BSE Wallet. Available: ${available.toLocaleString('en-IN')}`
      );
    }
    const result = await User.findOneAndUpdate(
      { _id: userId, 'nseBseWallet.balance': { $gte: amt } },
      {
        $inc: {
          'wallet.cashBalance': amt,
          'wallet.balance': amt,
          'nseBseWallet.balance': -amt,
        },
        $set: { 'wallet.tradingBalance': 0 },
      },
      { new: true }
    );
    if (!result) {
      throw new Error(
        `Insufficient free balance in NSE & BSE Wallet. Available: ${available.toLocaleString('en-IN')}`
      );
    }
  }

  return readNseBseWalletFromDb(userId);
}
