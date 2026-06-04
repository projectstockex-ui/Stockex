/**
 * Merge autosquare history rows: same user + symbol + side + session closeTime → one line.
 */

import { computeCryptoForexCarryNextDayQty } from './walletBalanceSanity.js';
import { normalizeCloseTimeKey } from './autosquareSessionTime.js';

function mergeKey(row) {
  const sym = String(row.symbol || '').trim().toUpperCase();
  const side = String(row.side || '').toUpperCase();
  const ct = normalizeCloseTimeKey(row.closeTime) || '';
  return `${row.userId}|${sym}|${side}|${ct}`;
}

function resolveMergedNextDayQty(group, totalOrig) {
  const sumNext = group.reduce(
    (s, r) => s + Math.max(0, Number(r.carryForwardQty ?? r.quantity) || 0),
    0
  );
  if (group.length <= 1 || totalOrig <= 0) {
    return Math.min(totalOrig, sumNext);
  }

  const primary = group.reduce(
    (best, r) =>
      Number(r.originalQty) > Number(best?.originalQty || 0) ? r : best,
    group[0]
  );
  const ltp = Number(primary.autoSquareLtp) || 0;
  const equity = Number(primary.netBalanceAtAutoSquare) || 0;
  const lev = Number(primary.carryForwardLeverage) || 0;

  if (ltp > 0 && equity > 0 && lev > 0) {
    const net = computeCryptoForexCarryNextDayQty(
      { side: primary.side },
      {
        qtyAtEvent: totalOrig,
        ltp,
        walletEquity: equity,
        carryForwardLeverage: lev,
      }
    );
    return Math.min(totalOrig, Math.max(0, Math.floor(net.nextDayQty)));
  }

  if (sumNext <= totalOrig) return sumNext;

  const pOrig = Number(primary.originalQty) || 0;
  const pNext = Number(primary.carryForwardQty ?? primary.quantity) || 0;
  if (pOrig > 0 && pNext >= 0) {
    return Math.min(totalOrig, Math.floor((totalOrig * pNext) / pOrig));
  }
  return Math.min(totalOrig, sumNext);
}

function mergeGroup(group) {
  const totalOrig = group.reduce((s, r) => s + (Number(r.originalQty) || 0), 0);
  const mergedNext = resolveMergedNextDayQty(group, totalOrig);
  const totalPnl = group.reduce((s, r) => s + (Number(r.pnlAtAutoSquare) || 0), 0);

  let entryNotional = 0;
  let entryQty = 0;
  for (const r of group) {
    const o = Number(r.originalQty) || 0;
    if (o > 0) {
      entryNotional += (Number(r.entryPrice) || 0) * o;
      entryQty += o;
    }
  }

  const primary = group[0];
  const closeKey = normalizeCloseTimeKey(primary.closeTime) || '';

  return {
    ...primary,
    _id: `merged-${closeKey || 'legacy'}-${String(primary.symbol).toUpperCase()}-${primary.side}-${totalOrig}`,
    originalQty: totalOrig,
    carryForwardQty: mergedNext,
    quantity: mergedNext,
    pnlAtAutoSquare: Math.round(totalPnl * 100) / 100,
    entryPrice: entryQty > 0 ? Math.round((entryNotional / entryQty) * 100) / 100 : primary.entryPrice,
    isMergedAutosquare: true,
    mergedTradeCount: group.length,
    mergedTradeIds: group.map((r) => r.tradeId).filter(Boolean),
  };
}

export function mergeAutosquareHistoryRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const buckets = new Map();
  const passthrough = [];

  for (const row of rows) {
    if (row.isLegacyClosed || row.isMergedAutosquare) {
      passthrough.push(row);
      continue;
    }
    const key = mergeKey(row);
    if (!key.includes('|') || !row.symbol) {
      passthrough.push(row);
      continue;
    }
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }

  const merged = [];
  for (const group of buckets.values()) {
    merged.push(group.length === 1 ? group[0] : mergeGroup(group));
  }

  const out = [...merged, ...passthrough];
  out.sort((a, b) => new Date(b.autoSquaredAt) - new Date(a.autoSquaredAt));
  return out;
}
