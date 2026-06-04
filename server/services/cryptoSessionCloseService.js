/**
 * Crypto session end: carry-forward open positions + freeze LTP/bid/ask until next session.
 * Intraday 70% autosquare is separate (ledgerAutosquareService).
 * Timing: SystemSettings CRYPTOFUT (same as UI).
 */

import SystemSettings from '../models/SystemSettings.js';
import Trade from '../models/Trade.js';
import { getLTPMapForTrades, cacheKeyForTrade } from './ltpResolutionService.js';
import {
  resolveSystemCryptoClosingTime,
  resolveSystemCryptoStartTime,
  istClockToSeconds,
  nowIstSecondsOfDay,
} from '../utils/cryptoSessionTiming.js';

let cachedStart = '';
let cachedClose = '';
let cachedAt = 0;
const TIMING_CACHE_MS = 10_000;

let frozen = false;
let frozenSnapshot = {};
let frozenAt = null;
let lastCloseSessionIstDate = '';

const CRYPTO_TRADE_QUERY = {
  $or: [
    { isCrypto: true },
    { exchange: 'BINANCE' },
    { segment: { $in: ['CRYPTOFUT', 'CRYPTOOPT', 'CRYPTO'] } },
  ],
};

function todayIstDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function plainSysSegDefaults(sys) {
  const raw = sys?.adminSegmentDefaults;
  if (raw instanceof Map) return Object.fromEntries(raw);
  return raw && typeof raw === 'object' ? { ...raw } : {};
}

export async function refreshCryptoSessionTimingCache() {
  try {
    const sys = await SystemSettings.getSettings();
    const defs = plainSysSegDefaults(sys);
    cachedStart = resolveSystemCryptoStartTime(defs);
    cachedClose = resolveSystemCryptoClosingTime(defs);
    cachedAt = Date.now();
  } catch (err) {
    console.warn('[CryptoSession] timing cache refresh failed:', err?.message || err);
  }
}

/** True when IST is inside [start, close) — no timing configured = always live. */
export function isCryptoSessionLiveSync() {
  if (!cachedClose && !cachedStart) return true;
  const now = nowIstSecondsOfDay();
  if (cachedStart) {
    const startSec = istClockToSeconds(cachedStart);
    if (startSec != null && now < startSec) return false;
  }
  if (cachedClose) {
    const closeSec = istClockToSeconds(cachedClose);
    if (closeSec != null && now >= closeSec) return false;
  }
  return true;
}

export function isCryptoSessionFrozen() {
  return frozen && !isCryptoSessionLiveSync();
}

export function freezeCryptoQuotes(liveCryptoData = {}) {
  frozenSnapshot = JSON.parse(JSON.stringify(liveCryptoData || {}));
  frozen = true;
  frozenAt = new Date();
  console.log(
    `[CryptoSession] Quotes frozen (${Object.keys(frozenSnapshot).length} keys) at ${cachedClose || 'close'} IST`
  );
}

export function clearCryptoSessionFreeze() {
  frozen = false;
  frozenSnapshot = {};
  frozenAt = null;
  lastCloseSessionIstDate = '';
}

export function getEffectiveCryptoData(liveCryptoData = {}) {
  if (!isCryptoSessionLiveSync()) {
    if (Object.keys(frozenSnapshot).length > 0) return frozenSnapshot;
    return liveCryptoData;
  }
  return liveCryptoData;
}

export function getCryptoSessionStatus() {
  return {
    sessionLive: isCryptoSessionLiveSync(),
    frozen: isCryptoSessionFrozen(),
    frozenAt: frozenAt || null,
    cryptoStartTime: cachedStart || '',
    cryptoClosingTime: cachedClose || '',
    quoteKeyCount: Object.keys(frozenSnapshot).length,
  };
}

function resolveTickLtp(trade, liveCryptoData, ltpMap) {
  const ck = cacheKeyForTrade(trade);
  const pairKey = trade.pair || trade.token || '';
  const symbolKey = trade.symbol || '';
  const tick =
    liveCryptoData[pairKey] ||
    liveCryptoData[pairKey?.toUpperCase?.()] ||
    liveCryptoData[symbolKey] ||
    liveCryptoData[`${String(symbolKey).toUpperCase()}USDT`];

  return (
    ltpMap.get(ck) ||
    tick?.ltp ||
    tick?.close ||
    Number(trade.currentPrice) ||
    Number(trade.entryPrice) ||
    0
  );
}

async function cancelAllCryptoPendingOrders() {
  const pending = await Trade.find({
    status: 'PENDING',
    ...CRYPTO_TRADE_QUERY,
  }).select('_id tradeId').lean();

  if (!pending.length) return 0;

  await Trade.updateMany(
    { _id: { $in: pending.map((p) => p._id) } },
    { $set: { status: 'CANCELLED' } }
  );
  console.log(`[CryptoSession] Cancelled ${pending.length} pending crypto order(s)`);
  return pending.length;
}

/** End-time carry-forward (carryForwardLeverage e.g. 50x) — position stays OPEN with nextDayQty. */
async function carryForwardAllCryptoOpenPositions(liveCryptoData, closeTime) {
  const Admin = (await import('../models/Admin.js')).default;
  const { default: EODSettlement } = await import('../cron/eodSettlement.js');

  const trades = await Trade.find({
    status: 'OPEN',
    productType: { $in: ['MIS', 'NRML', 'CARRYFORWARD'] },
    ...CRYPTO_TRADE_QUERY,
  }).lean();

  if (!trades.length) return { carried: 0, closed: 0, failed: 0, skipped: 0 };

  const ltpMap = await getLTPMapForTrades(trades);
  const adminByCode = new Map();
  let carried = 0;
  let closed = 0;
  let failed = 0;
  let skipped = 0;
  const closeKey = String(closeTime || '');

  const { groupTradesForNetCarry, applyNetCarryForwardGroup } = await import('./carryForwardService.js');
  const ready = [];

  for (const trade of trades) {
    try {
      const freshEarly = await Trade.findById(trade._id)
        .select('autoSquareHistory status')
        .lean();
      if (freshEarly?.status !== 'OPEN') continue;

      const alreadyDoneToday = (freshEarly?.autoSquareHistory || []).some(
        (e) =>
          EODSettlement.sameISTDay(e.autoSquaredAt, new Date()) &&
          (!closeKey || String(e.closeTime || '') === closeKey)
      );
      if (alreadyDoneToday) {
        skipped++;
        continue;
      }

      let admin = adminByCode.get(trade.adminCode);
      if (!admin && trade.adminCode) {
        admin = await Admin.findOne({ adminCode: trade.adminCode })
          .select('adminCode segmentPermissions')
          .lean();
        if (admin) adminByCode.set(trade.adminCode, admin);
      }

      const ltp = resolveTickLtp(trade, liveCryptoData, ltpMap);
      if (!ltp || ltp <= 0) {
        console.warn(`[CryptoSession] No LTP for ${trade.tradeId}, skip carry-forward`);
        failed++;
        continue;
      }

      ready.push({ trade, admin, ltp });
    } catch (err) {
      failed++;
      console.error(`[CryptoSession] Carry-forward prep error ${trade.tradeId}:`, err?.message || err);
    }
  }

  const netGroups = groupTradesForNetCarry(ready.map((r) => r.trade));
  for (const groupTrades of netGroups.values()) {
    const meta = ready.find((r) => String(r.trade._id) === String(groupTrades[0]._id));
    if (!meta) continue;
    try {
      const results = await applyNetCarryForwardGroup(groupTrades, {
        ltp: meta.ltp,
        closeTime: closeKey,
        segmentGroup: 'CRYPTO',
        admin: meta.admin,
      });
      for (const result of results) {
        if (result?.skippedDuplicate) skipped++;
        else if (result?.fullyClosed) {
          closed++;
          console.log(`[CryptoSession] Zero carry — closed (${groupTrades[0]?.symbol})`);
        } else {
          carried++;
          console.log(
            `[CryptoSession] Net carry ${groupTrades[0]?.symbol}: orig=${result.originalQty} next=${result.nextDayQty}`
          );
        }
      }
    } catch (err) {
      failed += groupTrades.length;
      console.error(
        `[CryptoSession] Net carry-forward error ${groupTrades[0]?.symbol}:`,
        err?.message || err
      );
    }
  }

  return { carried, closed, failed, skipped };
}

/**
 * Run once per IST day after session close: freeze quotes + carry-forward + cancel pending.
 */
export async function runCryptoSessionEndIfNeeded(liveCryptoData = {}, { io = null, force = false } = {}) {
  await refreshCryptoSessionTimingCache();

  if (isCryptoSessionLiveSync()) {
    if (frozen) clearCryptoSessionFreeze();
    return { ran: false, reason: 'session_live' };
  }

  const today = todayIstDate();

  if (!frozen || Object.keys(frozenSnapshot).length === 0) {
    freezeCryptoQuotes(liveCryptoData);
  }

  const quoteForCarry =
    Object.keys(frozenSnapshot).length > 0 ? frozenSnapshot : liveCryptoData;

  if (!force && lastCloseSessionIstDate === today) {
    return {
      ran: false,
      reason: 'already_processed_today',
      ...getCryptoSessionStatus(),
    };
  }

  const cancelled = await cancelAllCryptoPendingOrders();
  const { carried, closed, failed, skipped } = await carryForwardAllCryptoOpenPositions(
    quoteForCarry,
    cachedClose
  );

  lastCloseSessionIstDate = today;

  const payload = {
    ...getCryptoSessionStatus(),
    carried,
    closed,
    failed,
    skipped,
    cancelled,
    closeTime: cachedClose,
  };

  if (io) {
    io.emit('crypto_session_closed', payload);
  }

  console.log(
    `[CryptoSession] End @ ${cachedClose} IST: carry=${carried} fullClose=${closed} ` +
      `failed=${failed} skipped=${skipped} cancelled=${cancelled} (quotes frozen)`
  );

  return { ran: true, ...payload };
}

export function startCryptoSessionTimingWatcher() {
  void refreshCryptoSessionTimingCache();
  setInterval(() => {
    void refreshCryptoSessionTimingCache();
  }, TIMING_CACHE_MS);
}

export default {
  refreshCryptoSessionTimingCache,
  isCryptoSessionLiveSync,
  isCryptoSessionFrozen,
  freezeCryptoQuotes,
  clearCryptoSessionFreeze,
  getEffectiveCryptoData,
  getCryptoSessionStatus,
  runCryptoSessionEndIfNeeded,
  startCryptoSessionTimingWatcher,
};
