import User from '../models/User.js';
import Trade from '../models/Trade.js';
import WalletLedger from '../models/WalletLedger.js';
import WalletTransferService from '../services/walletTransferService.js';
import { recalculateUsedMargin } from './recalculateUsedMargin.js';
import {
  isAbsurdOpenQuantity,
  resolveSafeOpenQuantity,
  isAbsurdWalletInr,
} from './walletBalanceSanity.js';

const CRYPTO_TRADE_FILTER = {
  $or: [
    { isCrypto: true },
    { exchange: 'BINANCE' },
    { segment: { $in: ['CRYPTO', 'CRYPTOFUT', 'CRYPTOOPT'] } },
  ],
};

/**
 * Restore qty on broken OPEN rows and square off so P&L + margin release run through closeTrade.
 */
async function repairBrokenOpenCryptoTrades(userId) {
  const broken = await Trade.find({
    user: userId,
    status: 'OPEN',
    quantity: { $lte: 0 },
    originalQty: { $gt: 0 },
    ...CRYPTO_TRADE_FILTER,
  })
    .select('_id side entryPrice currentPrice originalQty')
    .lean();

  if (!broken.length) return 0;

  const { default: TradingService } = await import('../services/tradingService.js');
  let repaired = 0;
  for (const t of broken) {
    try {
      await Trade.updateOne({ _id: t._id }, { $set: { quantity: t.originalQty } });
      const px = Number(t.currentPrice) || Number(t.entryPrice) || 0;
      await TradingService.squareOffPosition(String(t._id), 'REPAIR', px, px, px);
      repaired += 1;
    } catch (err) {
      console.warn('[repairCryptoWallet] square-off failed:', String(t._id), err?.message || err);
    }
  }
  return repaired;
}

/**
 * Close broken OPEN rows left by bad carry-forward autosquare (qty 0, no original qty).
 */
async function closeOrphanCryptoTrades(userId) {
  const result = await Trade.updateMany(
    {
      user: userId,
      status: 'OPEN',
      quantity: { $lte: 0 },
      ...CRYPTO_TRADE_FILTER,
    },
    {
      $set: {
        status: 'CLOSED',
        closeReason: 'ORPHAN_CLEANUP',
        closedAt: new Date(),
        unrealizedPnL: 0,
      },
    }
  );
  return result.modifiedCount || 0;
}

/**
 * Rebuild crypto cash balance from transfer mesh + crypto-tagged ledger rows.
 */
export async function repairCryptoWalletBalance(userId) {
  const user = await User.findById(userId).select('userId cryptoWallet').lean();
  if (!user) throw new Error('User not found');

  const reopened = await repairBrokenOpenCryptoTrades(userId);
  const orphans = await closeOrphanCryptoTrades(userId);
  await recalculateUsedMargin(userId);

  const events = [];

  const mesh = await WalletTransferService.getTransferHistory(userId);
  for (const row of mesh || []) {
    const amt = Number(row.amount) || 0;
    if (amt <= 0) continue;
    if (row.targetWallet === 'cryptoWallet') {
      events.push({ at: row.createdAt, delta: amt });
    }
    if (row.sourceWallet === 'cryptoWallet') {
      events.push({ at: row.createdAt, delta: -amt });
    }
  }

  const ledgerRows = await WalletLedger.find({
    ownerType: 'USER',
    ownerId: userId,
    $or: [
      { reason: 'CRYPTO_TRANSFER' },
      { reason: 'TRADE_PNL', description: { $regex: /\(Crypto\)/i } },
      { 'meta.segment': 'CRYPTO' },
      { reason: 'BROKERAGE', description: { $regex: /\(Crypto\)/i } },
    ],
  })
    .select('type reason amount description createdAt')
    .sort({ createdAt: 1 })
    .lean();

  const closedTrades = await Trade.find({
    user: userId,
    status: 'CLOSED',
    ...CRYPTO_TRADE_FILTER,
  })
    .select('netPnL realizedPnL closedAt updatedAt')
    .lean();

  for (const t of closedTrades) {
    const pnl = Number(t.netPnL ?? t.realizedPnL ?? 0);
    if (Math.abs(pnl) < 0.01) continue;
    const hasPnlLedger = await WalletLedger.exists({
      ownerId: userId,
      reason: 'TRADE_PNL',
      'reference.id': t._id,
    });
    if (!hasPnlLedger) {
      events.push({ at: t.closedAt || t.updatedAt, delta: pnl });
    }
  }

  for (const row of ledgerRows) {
    const amt = Number(row.amount) || 0;
    if (amt <= 0) continue;
    const desc = String(row.description || '');
    if (row.reason === 'CRYPTO_TRANSFER') {
      if (/Crypto\s*→\s*Main/i.test(desc) || /→\s*Main/i.test(desc)) {
        events.push({ at: row.createdAt, delta: -amt });
      } else if (/Main\s*→\s*Crypto/i.test(desc) || /→\s*Crypto/i.test(desc)) {
        events.push({ at: row.createdAt, delta: amt });
      }
      continue;
    }
    if (row.type === 'CREDIT') events.push({ at: row.createdAt, delta: amt });
    else events.push({ at: row.createdAt, delta: -amt });
  }

  events.sort((a, b) => new Date(a.at) - new Date(b.at));

  let balance = 0;
  for (const e of events) {
    balance += e.delta;
  }
  balance = Math.max(0, Math.round(balance * 100) / 100);

  const closedAgg = await Trade.aggregate([
    {
      $match: {
        user: userId,
        status: 'CLOSED',
        ...CRYPTO_TRADE_FILTER,
      },
    },
    {
      $group: {
        _id: null,
        total: {
          $sum: {
            $ifNull: ['$netPnL', { $ifNull: ['$realizedPnL', 0] }],
          },
        },
      },
    },
  ]);
  const realizedPnL = Math.round((closedAgg[0]?.total || 0) * 100) / 100;

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        'cryptoWallet.balance': balance,
        'cryptoWallet.realizedPnL': realizedPnL,
        'cryptoWallet.todayRealizedPnL': realizedPnL,
      },
    }
  );

  return {
    balance,
    realizedPnL,
    tradesRepaired: reopened,
    orphansClosed: orphans,
    eventsApplied: events.length,
  };
}

const NSE_BSE_TRADE_FILTER = {
  isCrypto: { $ne: true },
  isForex: { $ne: true },
  exchange: { $nin: ['BINANCE', 'MCX', 'FOREX'] },
  segment: { $nin: ['FOREX', 'FOREXFUT', 'FOREXOPT', 'MCX', 'MCXFUT', 'MCXOPT', 'CRYPTO', 'CRYPTOFUT', 'CRYPTOOPT'] },
};

/** Fix OPEN rows with carry-forward qty explosion (e.g. 3cr shares on THACKER). */
async function repairAbsurdNseBseOpenTrades(userId) {
  const open = await Trade.find({
    user: userId,
    status: 'OPEN',
    ...NSE_BSE_TRADE_FILTER,
  })
    .select('_id tradeId symbol quantity originalQty autoSquareHistory entryPrice currentPrice side')
    .lean();

  let fixed = 0;
  for (const t of open) {
    if (!isAbsurdOpenQuantity(t)) continue;
    const safeQty = resolveSafeOpenQuantity(t);
    if (!(safeQty > 0)) continue;
    await Trade.updateOne(
      { _id: t._id },
      {
        $set: {
          quantity: safeQty,
          carryForwardQty: safeQty,
          originalQty: Number(t.originalQty) > 0 ? t.originalQty : safeQty,
        },
      }
    );
    fixed += 1;
    console.warn(
      `[repairNseBse] ${t.tradeId} (${t.symbol}) qty ${t.quantity} → ${safeQty}`
    );
  }
  return fixed;
}

/**
 * Rebuild NSE/BSE cash balance from internal transfers + NSE-tagged ledger rows.
 */
export async function repairNseBseWalletBalance(userId) {
  const user = await User.findById(userId).select('userId nseBseWallet wallet').lean();
  if (!user) throw new Error('User not found');

  const tradesFixed = await repairAbsurdNseBseOpenTrades(userId);
  await recalculateUsedMargin(userId);

  const events = [];
  const mesh = await WalletTransferService.getTransferHistory(userId);
  for (const row of mesh || []) {
    const amt = Number(row.amount) || 0;
    if (amt <= 0) continue;
    if (row.targetWallet === 'nseBseWallet' || row.targetWallet === 'tradingAccount') {
      events.push({ at: row.createdAt, delta: amt });
    }
    if (row.sourceWallet === 'nseBseWallet' || row.sourceWallet === 'tradingAccount') {
      events.push({ at: row.createdAt, delta: -amt });
    }
  }

  const ledgerRows = await WalletLedger.find({
    ownerType: 'USER',
    ownerId: userId,
    $or: [
      { reason: 'INTERNAL_TRANSFER' },
      { reason: 'TRADE_PNL', description: { $regex: /\(NSE\/BSE\)/i } },
      { 'meta.segment': { $in: ['NSE/BSE', 'NSE', 'BSE'] } },
      { reason: 'BROKERAGE', description: { $regex: /\(NSE\/BSE\)/i } },
    ],
  })
    .select('type reason amount description createdAt reference')
    .sort({ createdAt: 1 })
    .lean();

  const closedTrades = await Trade.find({
    user: userId,
    status: 'CLOSED',
    ...NSE_BSE_TRADE_FILTER,
  })
    .select('netPnL realizedPnL closedAt updatedAt')
    .lean();

  for (const t of closedTrades) {
    const pnl = Number(t.netPnL ?? t.realizedPnL ?? 0);
    if (Math.abs(pnl) < 0.01) continue;
    const hasPnlLedger = await WalletLedger.exists({
      ownerId: userId,
      reason: 'TRADE_PNL',
      'reference.id': t._id,
    });
    if (!hasPnlLedger) {
      events.push({ at: t.closedAt || t.updatedAt, delta: pnl });
    }
  }

  for (const row of ledgerRows) {
    const amt = Number(row.amount) || 0;
    if (amt <= 0) continue;
    const desc = String(row.description || '');
    if (row.reason === 'INTERNAL_TRANSFER') {
      if (/NSE.*→.*Main|BSE.*→.*Main|→\s*Main/i.test(desc)) {
        events.push({ at: row.createdAt, delta: -amt });
      } else if (/Main\s*→|→\s*NSE|→\s*BSE/i.test(desc)) {
        events.push({ at: row.createdAt, delta: amt });
      }
      continue;
    }
    if (row.type === 'CREDIT') events.push({ at: row.createdAt, delta: amt });
    else events.push({ at: row.createdAt, delta: -amt });
  }

  events.sort((a, b) => new Date(a.at) - new Date(b.at));

  let balance = 0;
  for (const e of events) {
    balance += e.delta;
  }
  const { sanitizeInrWalletAmount } = await import('./walletBalanceSanity.js');
  balance = sanitizeInrWalletAmount(Math.max(0, Math.round(balance * 100) / 100), {
    field: 'nseBseRepair',
    userId: String(user.userId || userId),
  });

  const closedAgg = await Trade.aggregate([
    { $match: { user: userId, status: 'CLOSED', ...NSE_BSE_TRADE_FILTER } },
    {
      $group: {
        _id: null,
        total: { $sum: { $ifNull: ['$netPnL', { $ifNull: ['$realizedPnL', 0] }] } },
      },
    },
  ]);
  const realizedPnL = Math.round((closedAgg[0]?.total || 0) * 100) / 100;

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        'nseBseWallet.balance': balance,
        'nseBseWallet.realizedPnL': realizedPnL,
        'wallet.tradingBalance': 0,
      },
    }
  );

  return {
    balance,
    realizedPnL,
    eventsApplied: events.length,
    tradesQtyFixed: tradesFixed,
    previousBalance: Number(user.nseBseWallet?.balance) || Number(user.wallet?.tradingBalance) || 0,
    wasCorrupted: isAbsurdWalletInr(
      Number(user.nseBseWallet?.balance) || Number(user.wallet?.tradingBalance)
    ),
  };
}
