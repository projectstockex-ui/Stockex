/**
 * MCX session end: carry-forward open positions + freeze LTP/bid/ask until next session.
 * Intraday 70% autosquare is separate (ledgerAutosquareService).
 * Timing: hierarchy MCXFUT (Ram → users) + SystemSettings SA defaults for global watcher.
 */

import SystemSettings from '../models/SystemSettings.js';
import Trade from '../models/Trade.js';
import User from '../models/User.js';
import { getLTPMapForTrades, cacheKeyForTrade } from './ltpResolutionService.js';
import {
  resolveSystemMcxClosingTime,
  resolveSystemMcxStartTime,
  isPastMcxCloseForUser,
} from '../utils/mcxSessionTiming.js';
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

const MCX_TRADE_QUERY = {
  $or: [
    { exchange: 'MCX' },
    { segment: 'MCX' },
    { segment: 'MCXFUT' },
    { segment: 'MCXOPT' },
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

export async function refreshMcxSessionTimingCache() {
  try {
    const sys = await SystemSettings.getSettings();
    const defs = plainSysSegDefaults(sys);
    cachedStart = resolveSystemMcxStartTime(defs);
    cachedClose = resolveSystemMcxClosingTime(defs);
  } catch (err) {
    console.warn('[McxSession] timing cache refresh failed:', err?.message || err);
  }
}

export function isMcxSessionLiveSync() {
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

export function isMcxSessionFrozen() {
  return frozen && !isMcxSessionLiveSync();
}

export function isMcxTokenKey(token) {
  const n = parseInt(String(token), 10);
  if (Number.isFinite(n) && n >= 735_000_000 && n <= 735_999_999) return true;
  return false;
}

export function freezeMcxQuotes(liveMarketData = {}) {
  const subset = {};
  for (const [k, v] of Object.entries(liveMarketData || {})) {
    if (isMcxTokenKey(k)) subset[k] = v;
  }
  frozenSnapshot = JSON.parse(JSON.stringify(subset));
  frozen = true;
  frozenAt = new Date();
  console.log(
    `[McxSession] Quotes frozen (${Object.keys(frozenSnapshot).length} MCX keys) at ${cachedClose || 'close'} IST`
  );
}

export function clearMcxSessionFreeze() {
  frozen = false;
  frozenSnapshot = {};
  frozenAt = null;
  lastCloseSessionIstDate = '';
}

/**
 * Settlement-only frozen quotes (carry-forward / session-end). Do not use for UI broadcast.
 */
export function getMcxFrozenQuoteMap() {
  if (!frozen || Object.keys(frozenSnapshot).length === 0) return {};
  return frozenSnapshot;
}

/**
 * Tag MCX ticks when admin session window is closed — live Zerodha prices still flow to UI.
 * Frozen snapshot is used only for carry-forward via getMcxFrozenQuoteMap().
 */
export function applyMcxFreezeToMarketUpdates(updates = {}) {
  if (isMcxSessionLiveSync() || !frozen) {
    return updates;
  }
  const out = { ...updates };
  for (const [k, row] of Object.entries(out)) {
    if (row && isMcxTokenKey(k)) {
      out[k] = { ...row, mcxTradingWindowClosed: true };
    }
  }
  return out;
}

export function getMcxSessionStatus() {
  return {
    sessionLive: isMcxSessionLiveSync(),
    frozen: isMcxSessionFrozen(),
    frozenAt: frozenAt || null,
    mcxStartTime: cachedStart || '',
    mcxClosingTime: cachedClose || '',
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

async function cancelAllMcxPendingOrders() {
  const pending = await Trade.find({
    status: 'PENDING',
    ...MCX_TRADE_QUERY,
  })
    .select('_id tradeId')
    .lean();

  if (!pending.length) return 0;

  await Trade.updateMany(
    { _id: { $in: pending.map((p) => p._id) } },
    { $set: { status: 'CANCELLED' } }
  );
  console.log(`[McxSession] Cancelled ${pending.length} pending MCX order(s)`);
  return pending.length;
}

async function carryForwardAllMcxOpenPositions(liveMarketData, closeTime) {
  const Admin = (await import('../models/Admin.js')).default;
  const { default: EODSettlement } = await import('../cron/eodSettlement.js');

  const trades = await Trade.find({
    status: 'OPEN',
    productType: { $in: ['MIS', 'NRML', 'CARRYFORWARD'] },
    ...MCX_TRADE_QUERY,
  }).lean();

  if (!trades.length) return { carried: 0, closed: 0, failed: 0, skipped: 0 };

  const ltpMap = await getLTPMapForTrades(trades);
  const adminByCode = new Map();
  let carried = 0;
  let closed = 0;
  let failed = 0;
  let skipped = 0;
  const closeKey = String(closeTime || '');

  const { normalizeCloseTimeKey } = await import('../utils/autosquareSessionTime.js');
  const { groupTradesForNetCarry, applyNetCarryForwardGroup } = await import('./carryForwardService.js');
  const closeKeyNorm = normalizeCloseTimeKey(closeKey);
  const ready = [];

  for (const trade of trades) {
    try {
      const freshEarly = await Trade.findById(trade._id)
        .select('autoSquareHistory status user')
        .lean();
      if (freshEarly?.status !== 'OPEN') continue;

      const tradeUser = await User.findById(trade.user || freshEarly.user)
        .populate('admin', 'name segmentPermissions hierarchyPath role adminCode')
        .lean();
      if (tradeUser) {
        const pastUserClose = await isPastMcxCloseForUser(tradeUser);
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
        console.warn(`[McxSession] No LTP for ${trade.tradeId}, skip carry-forward`);
        failed++;
        continue;
      }

      ready.push({ trade, admin, ltp });
    } catch (err) {
      failed++;
      console.error(`[McxSession] Carry-forward prep error ${trade.tradeId}:`, err?.message || err);
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
        segmentGroup: 'MCX',
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
        `[McxSession] Net carry-forward error ${groupTrades[0]?.symbol}:`,
        err?.message || err
      );
    }
  }

  return { carried, closed, failed, skipped };
}

export async function runMcxSessionEndIfNeeded(liveMarketData = {}, { io = null, force = false } = {}) {
  await refreshMcxSessionTimingCache();

  if (isMcxSessionLiveSync()) {
    if (frozen) clearMcxSessionFreeze();
    return { ran: false, reason: 'session_live' };
  }

  const today = todayIstDate();

  if (!frozen || Object.keys(frozenSnapshot).length === 0) {
    freezeMcxQuotes(liveMarketData);
  }

  const quoteForCarry =
    Object.keys(frozenSnapshot).length > 0 ? frozenSnapshot : liveMarketData;

  if (!force && lastCloseSessionIstDate === today) {
    return {
      ran: false,
      reason: 'already_processed_today',
      ...getMcxSessionStatus(),
    };
  }

  const cancelled = await cancelAllMcxPendingOrders();
  const { carried, closed, failed, skipped } = await carryForwardAllMcxOpenPositions(
    quoteForCarry,
    cachedClose
  );

  lastCloseSessionIstDate = today;

  const payload = {
    ...getMcxSessionStatus(),
    carried,
    closed,
    failed,
    skipped,
    cancelled,
    closeTime: cachedClose,
  };

  if (io) {
    io.emit('mcx_session_closed', payload);
  }

  console.log(
    `[McxSession] End @ ${cachedClose} IST: carry=${carried} fullClose=${closed} ` +
      `failed=${failed} skipped=${skipped} cancelled=${cancelled} (quotes frozen)`
  );

  return { ran: true, ...payload };
}

export function startMcxSessionTimingWatcher() {
  void refreshMcxSessionTimingCache();
  setInterval(() => {
    void refreshMcxSessionTimingCache();
  }, TIMING_CACHE_MS);
  import('./segmentLedgerAutosquarePoll.js')
    .then((m) => m.startSegmentLedgerAutosquarePoll?.())
    .catch((err) => console.warn('[McxSession] ledger autosquare poll:', err?.message || err));
}

export default {
  refreshMcxSessionTimingCache,
  isMcxSessionLiveSync,
  isMcxSessionFrozen,
  getMcxFrozenQuoteMap,
  freezeMcxQuotes,
  clearMcxSessionFreeze,
  applyMcxFreezeToMarketUpdates,
  getMcxSessionStatus,
  runMcxSessionEndIfNeeded,
  startMcxSessionTimingWatcher,
};
