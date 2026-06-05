/**
 * NSE/BSE session end: carry-forward open positions + optional quote freeze until next session.
 * Timing: hierarchy NSEFUT + SystemSettings SA defaults.
 */

import SystemSettings from '../models/SystemSettings.js';
import Trade from '../models/Trade.js';
import User from '../models/User.js';
import { getLTPMapForTrades, cacheKeyForTrade } from './ltpResolutionService.js';
import {
  resolveSystemNseBseClosingTime,
  resolveSystemNseBseStartTime,
  isPastNseBseCloseForUser,
} from '../utils/nseBseSessionTiming.js';
import {
  istClockToSeconds,
  nowIstSecondsOfDay,
} from '../utils/cryptoSessionTiming.js';

let cachedStart = '';
let cachedClose = '';
const TIMING_CACHE_MS = 10_000;

let frozen = false;
let frozenSnapshot = {};
let frozenAt = null;
let lastCloseSessionIstDate = '';

const NSE_BSE_TRADE_QUERY = {
  isCrypto: { $ne: true },
  isForex: { $ne: true },
  exchange: { $nin: ['MCX', 'BINANCE', 'FOREX'] },
  segment: { $nin: ['MCX', 'MCXFUT', 'MCXOPT', 'CRYPTO', 'CRYPTOFUT', 'CRYPTOOPT', 'FOREX', 'FOREXFUT', 'FOREXOPT'] },
  $or: [
    { exchange: { $in: ['NSE', 'NFO', 'BSE', 'BFO'] } },
    { segment: { $in: ['NSEFUT', 'NSEOPT', 'NSE-EQ', 'BSE-FUT', 'BSE-OPT', 'FNO', 'EQUITY'] } },
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

export async function refreshNseBseSessionTimingCache() {
  try {
    const sys = await SystemSettings.getSettings();
    const defs = plainSysSegDefaults(sys);
    cachedStart = resolveSystemNseBseStartTime(defs);
    cachedClose = resolveSystemNseBseClosingTime(defs);
  } catch (err) {
    console.warn('[NseBseSession] timing cache refresh failed:', err?.message || err);
  }
}

export function isNseBseSessionLiveSync() {
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

export function isNseBseSessionFrozen() {
  return frozen && !isNseBseSessionLiveSync();
}

export function freezeNseBseQuotes(liveMarketData = {}, tradeKeys = []) {
  const subset = {};
  const keys = new Set((tradeKeys || []).map((k) => String(k)).filter(Boolean));
  if (keys.size > 0) {
    for (const k of keys) {
      if (liveMarketData[k]) subset[k] = liveMarketData[k];
    }
  } else {
    for (const [k, v] of Object.entries(liveMarketData || {})) {
      const n = parseInt(String(k), 10);
      if (Number.isFinite(n) && n >= 735_000_000 && n <= 735_999_999) continue;
      subset[k] = v;
    }
  }
  frozenSnapshot = JSON.parse(JSON.stringify(subset));
  frozen = true;
  frozenAt = new Date();
  console.log(
    `[NseBseSession] Quotes frozen (${Object.keys(frozenSnapshot).length} keys) at ${cachedClose || 'close'} IST`
  );
}

export function clearNseBseSessionFreeze() {
  frozen = false;
  frozenSnapshot = {};
  frozenAt = null;
  lastCloseSessionIstDate = '';
}

export function getNseBseFrozenQuoteMap() {
  if (!frozen || Object.keys(frozenSnapshot).length === 0) return {};
  return frozenSnapshot;
}

export function applyNseBseFreezeToMarketUpdates(updates = {}) {
  if (isNseBseSessionLiveSync() || !frozen) {
    return updates;
  }
  const out = { ...updates };
  for (const [k, row] of Object.entries(out)) {
    if (!row) continue;
    const n = parseInt(String(k), 10);
    if (Number.isFinite(n) && n >= 735_000_000 && n <= 735_999_999) continue;
    out[k] = { ...row, nseBseTradingWindowClosed: true };
  }
  return out;
}

export function getNseBseSessionStatus() {
  return {
    sessionLive: isNseBseSessionLiveSync(),
    frozen: isNseBseSessionFrozen(),
    frozenAt: frozenAt || null,
    nseStartTime: cachedStart || '',
    nseClosingTime: cachedClose || '',
    quoteKeyCount: Object.keys(frozenSnapshot).length,
  };
}

function resolveTickLtp(trade, liveMarketData, ltpMap) {
  const ck = cacheKeyForTrade(trade);
  const tokenKey = trade.token != null ? String(trade.token) : '';
  const symbolKey = trade.symbol || '';
  const tick =
    liveMarketData[tokenKey] ||
    liveMarketData[symbolKey] ||
    liveMarketData[symbolKey?.toUpperCase?.()];

  return (
    ltpMap.get(ck) ||
    tick?.ltp ||
    tick?.close ||
    Number(trade.currentPrice) ||
    Number(trade.entryPrice) ||
    0
  );
}

async function cancelAllNseBsePendingOrders() {
  const pending = await Trade.find({
    status: 'PENDING',
    ...NSE_BSE_TRADE_QUERY,
  })
    .select('_id tradeId')
    .lean();

  if (!pending.length) return 0;

  await Trade.updateMany(
    { _id: { $in: pending.map((p) => p._id) } },
    { $set: { status: 'CANCELLED' } }
  );
  console.log(`[NseBseSession] Cancelled ${pending.length} pending NSE/BSE order(s)`);
  return pending.length;
}

async function carryForwardAllNseBseOpenPositions(liveMarketData, closeTime) {
  const Admin = (await import('../models/Admin.js')).default;
  const { default: EODSettlement } = await import('../cron/eodSettlement.js');

  const trades = await Trade.find({
    status: 'OPEN',
    productType: { $in: ['MIS', 'NRML', 'CARRYFORWARD'] },
    ...NSE_BSE_TRADE_QUERY,
  }).lean();

  if (!trades.length) return { carried: 0, closed: 0, failed: 0, skipped: 0 };

  const ltpMap = await getLTPMapForTrades(trades);
  const adminByCode = new Map();
  let carried = 0;
  let closed = 0;
  let failed = 0;
  let skipped = 0;
  const closeKey = String(closeTime || '');

  const { normalizeCloseTimeKey, parseIstSessionCloseAt } = await import('../utils/autosquareSessionTime.js');
  const { groupTradesForNetCarry, applyNetCarryForwardGroup } = await import('./carryForwardService.js');
  const closeKeyNorm = normalizeCloseTimeKey(closeKey);
  const sessionCloseAt = closeKeyNorm ? parseIstSessionCloseAt(closeKeyNorm, new Date()) : null;
  const ready = [];

  for (const trade of trades) {
    try {
      const freshEarly = await Trade.findById(trade._id)
        .select('autoSquareHistory status user token symbol openedAt createdAt')
        .lean();
      if (freshEarly?.status !== 'OPEN') continue;

      const openedAt = freshEarly.openedAt || freshEarly.createdAt || trade.openedAt || trade.createdAt;
      if (sessionCloseAt && openedAt && new Date(openedAt) > sessionCloseAt) {
        skipped++;
        continue;
      }

      const tradeUser = await User.findById(trade.user || freshEarly.user)
        .populate('admin', 'name segmentPermissions hierarchyPath role adminCode')
        .lean();
      if (tradeUser) {
        const pastUserClose = await isPastNseBseCloseForUser(tradeUser);
        if (!pastUserClose) {
          skipped++;
          continue;
        }
      }

      const alreadyDoneToday = (freshEarly?.autoSquareHistory || []).some(
        (e) =>
          EODSettlement.sameISTDay(e.autoSquaredAt, new Date()) &&
          (!closeKeyNorm || normalizeCloseTimeKey(e.closeTime) === closeKeyNorm)
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

      const ltp = resolveTickLtp(trade, liveMarketData, ltpMap);
      if (!ltp || ltp <= 0) {
        console.warn(`[NseBseSession] No LTP for ${trade.tradeId}, skip carry-forward`);
        failed++;
        continue;
      }

      ready.push({ trade, admin, ltp });
    } catch (err) {
      failed++;
      console.error(`[NseBseSession] Carry-forward prep error ${trade.tradeId}:`, err?.message || err);
    }
  }

  const freezeKeys = ready.flatMap((r) => [
    r.trade.token != null ? String(r.trade.token) : '',
    r.trade.symbol || '',
  ]);

  const netGroups = groupTradesForNetCarry(ready.map((r) => r.trade));
  for (const groupTrades of netGroups.values()) {
    const meta = ready.find((r) => String(r.trade._id) === String(groupTrades[0]._id));
    if (!meta) continue;
    try {
      const results = await applyNetCarryForwardGroup(groupTrades, {
        ltp: meta.ltp,
        closeTime: closeKey,
        segmentGroup: 'NSE',
        admin: meta.admin,
      });
      for (const result of results) {
        if (result?.skippedDuplicate) skipped++;
        else if (result?.fullyClosed) closed++;
        else carried++;
      }
    } catch (err) {
      failed += groupTrades.length;
      console.error(
        `[NseBseSession] Net carry-forward error ${groupTrades[0]?.symbol}:`,
        err?.message || err
      );
    }
  }

  return { carried, closed, failed, skipped };
}

export async function runNseBseSessionEndIfNeeded(liveMarketData = {}, { io = null, force = false } = {}) {
  await refreshNseBseSessionTimingCache();

  if (isNseBseSessionLiveSync()) {
    if (frozen) clearNseBseSessionFreeze();
    return { ran: false, reason: 'session_live' };
  }

  const today = todayIstDate();

  const openTrades = await Trade.find({
    status: 'OPEN',
    ...NSE_BSE_TRADE_QUERY,
  })
    .select('token symbol')
    .lean();

  const tradeKeys = openTrades.flatMap((t) => [
    t.token != null ? String(t.token) : '',
    t.symbol || '',
  ]);

  if (!frozen || Object.keys(frozenSnapshot).length === 0) {
    freezeNseBseQuotes(liveMarketData, tradeKeys);
  }

  const quoteForCarry =
    Object.keys(frozenSnapshot).length > 0 ? frozenSnapshot : liveMarketData;

  if (!force && lastCloseSessionIstDate === today) {
    return {
      ran: false,
      reason: 'already_processed_today',
      ...getNseBseSessionStatus(),
    };
  }

  const cancelled = await cancelAllNseBsePendingOrders();
  const { carried, closed, failed, skipped } = await carryForwardAllNseBseOpenPositions(
    quoteForCarry,
    cachedClose
  );

  lastCloseSessionIstDate = today;

  const payload = {
    ...getNseBseSessionStatus(),
    carried,
    closed,
    failed,
    skipped,
    cancelled,
    closeTime: cachedClose,
  };

  if (io) {
    io.emit('nse_bse_session_closed', payload);
  }

  console.log(
    `[NseBseSession] End @ ${cachedClose} IST: carry=${carried} fullClose=${closed} ` +
      `failed=${failed} skipped=${skipped} cancelled=${cancelled}`
  );

  return { ran: true, ...payload };
}

export function startNseBseSessionTimingWatcher() {
  void refreshNseBseSessionTimingCache();
  setInterval(() => {
    void refreshNseBseSessionTimingCache();
  }, TIMING_CACHE_MS);
  import('./segmentLedgerAutosquarePoll.js')
    .then((m) => m.startSegmentLedgerAutosquarePoll?.())
    .catch((err) => console.warn('[NseBseSession] ledger autosquare poll:', err?.message || err));
}

export default {
  refreshNseBseSessionTimingCache,
  isNseBseSessionLiveSync,
  isNseBseSessionFrozen,
  getNseBseFrozenQuoteMap,
  freezeNseBseQuotes,
  clearNseBseSessionFreeze,
  applyNseBseFreezeToMarketUpdates,
  getNseBseSessionStatus,
  runNseBseSessionEndIfNeeded,
  startNseBseSessionTimingWatcher,
};
