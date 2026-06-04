/**
 * Backup ledger autosquare — segment autosquarePercent (e.g. MCX 90%, Crypto 70%).
 * Runs on interval so loss cuts are not missed when ticks throttle or session gate skips monitor.
 */

import Trade from '../models/Trade.js';
import { checkAndRunLedgerAutosquare } from './ledgerAutosquareService.js';

const WALLET_POLL_CONFIG = [
  {
    walletField: 'mcxWallet',
    label: 'MCX',
    query: {
      status: 'OPEN',
      $or: [
        { exchange: 'MCX' },
        { segment: 'MCX' },
        { segment: 'MCXFUT' },
        { segment: 'MCXOPT' },
      ],
    },
  },
  {
    walletField: 'cryptoWallet',
    label: 'CRYPTO',
    query: {
      status: 'OPEN',
      $or: [
        { isCrypto: true },
        { exchange: 'BINANCE' },
        { segment: 'CRYPTO' },
        { segment: 'CRYPTOFUT' },
        { segment: 'CRYPTOOPT' },
      ],
    },
  },
];

const POLL_MS = 2000;
const PER_USER_THROTTLE_MS = 1500;

let pollTimer = null;
const lastRunByUserWallet = new Map();

async function pollWalletAutosquare({ walletField, label, query }) {
  const userIds = await Trade.distinct('user', query);
  if (!userIds.length) return;

  const now = Date.now();
  for (const userId of userIds) {
    const key = `${walletField}|${String(userId)}`;
    if (now - (lastRunByUserWallet.get(key) || 0) < PER_USER_THROTTLE_MS) continue;
    lastRunByUserWallet.set(key, now);

    const result = await checkAndRunLedgerAutosquare(userId, walletField, {
      preferBidAsk: true,
    });
    if (result?.triggered) {
      console.log(
        `[SegmentLedgerAutosquarePoll] ${label} user=${userId} ` +
          `loss=${result.snapshot?.lossPercent}% limit=${result.snapshot?.autosquarePercent}%`
      );
    }
  }
}

async function pollAll() {
  try {
    for (const cfg of WALLET_POLL_CONFIG) {
      await pollWalletAutosquare(cfg);
    }
  } catch (err) {
    console.error('[SegmentLedgerAutosquarePoll]', err?.message || err);
  }
}

export function startSegmentLedgerAutosquarePoll() {
  if (pollTimer) return;
  void pollAll();
  pollTimer = setInterval(() => void pollAll(), POLL_MS);
  console.log(`[SegmentLedgerAutosquarePoll] MCX + Crypto every ${POLL_MS}ms`);
}

export function stopSegmentLedgerAutosquarePoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
