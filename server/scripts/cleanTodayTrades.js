/**
 * Delete all trades touched today (IST) and related wallet ledger rows, then rebuild sub-wallets.
 *
 * Usage (from repo root):
 *   node server/scripts/cleanTodayTrades.js              # dry-run
 *   node server/scripts/cleanTodayTrades.js --execute    # delete
 *   node server/scripts/cleanTodayTrades.js --execute --user USRMPCRJEJ33YG
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import Trade from '../models/Trade.js';
import User from '../models/User.js';
import WalletLedger from '../models/WalletLedger.js';
import WalletTransferService from '../services/walletTransferService.js';
import { recalculateUsedMargin } from '../utils/recalculateUsedMargin.js';
import { repairCryptoWalletBalance, repairNseBseWalletBalance } from '../utils/repairSubwalletBalance.js';
import { sanitizeInrWalletAmount } from '../utils/walletBalanceSanity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const IST = 'Asia/Kolkata';

function getIstDayBounds(date = new Date()) {
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(date);
  const start = new Date(`${dayKey}T00:00:00+05:30`);
  const end = new Date(`${dayKey}T23:59:59.999+05:30`);
  return { dayKey, start, end };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const userIdx = args.findIndex((a) => a === '--user');
  const userId =
    userIdx >= 0 && args[userIdx + 1] ? String(args[userIdx + 1]).trim() : null;
  return { execute, userId };
}

function buildTodayTradeQuery({ start, end }, userId) {
  const dateOr = [
    { createdAt: { $gte: start, $lte: end } },
    { openedAt: { $gte: start, $lte: end } },
    { closedAt: { $gte: start, $lte: end } },
    { autoSquaredAt: { $gte: start, $lte: end } },
    { 'autoSquareHistory.autoSquaredAt': { $gte: start, $lte: end } },
  ];
  const q = { $or: dateOr };
  if (userId) q.userId = userId;
  return q;
}

async function rebuildMcxWalletBalance(userId) {
  const events = [];
  const mesh = await WalletTransferService.getTransferHistory(userId);
  for (const row of mesh || []) {
    const amt = Number(row.amount) || 0;
    if (amt <= 0) continue;
    if (row.targetWallet === 'mcxWallet') events.push({ at: row.createdAt, delta: amt });
    if (row.sourceWallet === 'mcxWallet') events.push({ at: row.createdAt, delta: -amt });
  }

  const ledgerRows = await WalletLedger.find({
    ownerType: 'USER',
    ownerId: userId,
    $or: [{ reason: 'MCX_TRANSFER' }, { 'meta.segment': 'MCX' }, { description: { $regex: /\(MCX\)/i } }],
  })
    .select('type reason amount createdAt')
    .lean();

  for (const row of ledgerRows) {
    const amt = Number(row.amount) || 0;
    if (amt <= 0) continue;
    if (row.type === 'CREDIT') events.push({ at: row.createdAt, delta: amt });
    else events.push({ at: row.createdAt, delta: -amt });
  }

  events.sort((a, b) => new Date(a.at) - new Date(b.at));
  let balance = 0;
  for (const e of events) balance += e.delta;
  balance = sanitizeInrWalletAmount(balance);

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        'mcxWallet.balance': balance,
        'mcxWallet.ledgerAutosquareActive': false,
        'mcxWallet.ledgerAutosquaredAt': null,
      },
    }
  );
  return balance;
}

async function repairUserWallets(userId) {
  await recalculateUsedMargin(userId);
  let mcxBal = null;
  try {
    mcxBal = await rebuildMcxWalletBalance(userId);
  } catch (e) {
    console.warn(`  [mcx rebuild] ${userId}:`, e.message);
  }
  try {
    await repairNseBseWalletBalance(userId);
  } catch (e) {
    console.warn(`  [nse rebuild] ${userId}:`, e.message);
  }
  try {
    await repairCryptoWalletBalance(userId);
  } catch (e) {
    console.warn(`  [crypto rebuild] ${userId}:`, e.message);
  }
  return mcxBal;
}

async function main() {
  const { execute, userId } = parseArgs();
  const { dayKey, start, end } = getIstDayBounds();

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/stockex');
  console.log('Connected:', mongoose.connection.name);
  console.log(`IST day: ${dayKey} (${start.toISOString()} → ${end.toISOString()})`);
  if (userId) console.log(`Filter userId: ${userId}`);
  console.log(execute ? 'MODE: EXECUTE (will delete)' : 'MODE: dry-run (pass --execute to delete)');

  const tradeQuery = buildTodayTradeQuery({ start, end }, userId);
  const trades = await Trade.find(tradeQuery)
    .select('_id tradeId userId user symbol status openedAt closedAt createdAt')
    .lean();

  console.log(`\nTrades to remove: ${trades.length}`);
  for (const t of trades.slice(0, 30)) {
    console.log(
      `  - ${t.tradeId} ${t.symbol} ${t.status} user=${t.userId} opened=${t.openedAt?.toISOString?.() || '-'}`
    );
  }
  if (trades.length > 30) console.log(`  ... and ${trades.length - 30} more`);

  if (!execute) {
    console.log('\nDry-run complete. Re-run with --execute to delete.');
    await mongoose.disconnect();
    return;
  }

  if (trades.length === 0) {
    console.log('Nothing to delete.');
    await mongoose.disconnect();
    return;
  }

  const tradeIds = trades.map((t) => t._id);
  const tradeIdStrs = trades.map((t) => t.tradeId).filter(Boolean);
  const userIds = [...new Set(trades.map((t) => String(t.user)))];

  const ledgerRefDel = await WalletLedger.deleteMany({
    'reference.type': 'Trade',
    'reference.id': { $in: tradeIds },
  });

  const ledgerTodayDel = await WalletLedger.deleteMany({
    ownerType: 'USER',
    createdAt: { $gte: start, $lte: end },
    $or: [
      { 'reference.type': 'Trade', 'reference.id': { $in: tradeIds } },
      { 'meta.tradeId': { $in: tradeIdStrs } },
      {
        reason: { $in: ['TRADE_PNL', 'BROKERAGE'] },
        $or: [
          { 'meta.segment': { $in: ['MCX', 'NSE/BSE', 'CRYPTO', 'FOREX'] } },
          { description: { $regex: /\(MCX|NSE\/BSE|Crypto|Forex\)/i } },
        ],
      },
    ],
  });

  const tradeDel = await Trade.deleteMany({ _id: { $in: tradeIds } });

  console.log(`\nDeleted trades: ${tradeDel.deletedCount}`);
  console.log(`Deleted ledger (trade ref): ${ledgerRefDel.deletedCount}`);
  console.log(`Deleted ledger (today trading): ${ledgerTodayDel.deletedCount}`);

  console.log('\nRebuilding wallets for affected users...');
  for (const uid of userIds) {
    const u = await User.findById(uid).select('userId').lean();
    const mcxBal = await repairUserWallets(uid);
    console.log(`  ${u?.userId || uid} — mcx balance ≈ ${mcxBal ?? '?'}`);
  }

  console.log('\nDone.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
