import Admin from '../models/Admin.js';
import { collectHierarchyAdminIds } from '../utils/hierarchyAdminIds.js';

const MAX_DENY_ENTRIES = 120;

function norm(s) {
  if (s == null || s === '') return '';
  return String(s).trim().toUpperCase();
}

/** Client / API → safe stored deny rows */
export function sanitizeInstrumentDenylist(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const row of raw.slice(0, MAX_DENY_ENTRIES)) {
    if (!row || typeof row !== 'object') continue;
    const exchange = norm(row.exchange);
    const segment = norm(row.segment);
    const symbol = norm(row.symbol);
    const tradingSymbol = norm(row.tradingSymbol);
    if (!exchange) continue;
    if (!symbol && !tradingSymbol) continue;
    out.push({
      exchange,
      segment: segment || '',
      symbol: symbol || '',
      tradingSymbol: tradingSymbol || '',
      allowWithinLowHigh: Boolean(row.allowWithinLowHigh),
      blockOutsideLowHigh: Boolean(row.blockOutsideLowHigh),
    });
  }
  return out;
}

export function buildInstrumentDenyContext(orderData, instrumentDoc) {
  const od = orderData || {};
  const inst = instrumentDoc || {};
  return {
    exchange: norm(od.exchange || inst.exchange || ''),
    segment: norm(od.segment || ''),
    displaySegment: norm(od.displaySegment || inst.displaySegment || ''),
    symbol: norm(od.symbol || inst.symbol || ''),
    tradingSymbol: norm(od.tradingSymbol || od.symbol || inst.symbol || ''),
    category: norm(od.category || inst.category || ''),
    pair: norm(od.pair || inst.pair || ''),
  };
}

/**
 * Hierarchy deny row blocks when exchange matches and symbol/tradingSymbol/segment rules hit.
 */
export function matchesInstrumentDeny(entry, ctx) {
  const exE = norm(entry.exchange);
  const exO = ctx.exchange;
  if (!exE || !exO || exE !== exO) return false;

  const segE = norm(entry.segment);
  if (segE) {
    const candidates = [ctx.segment, ctx.displaySegment].filter(Boolean);
    if (!candidates.some((c) => norm(c) === segE)) return false;
  }

  const ts = norm(entry.tradingSymbol);
  if (ts) {
    const cand = [ctx.tradingSymbol, ctx.symbol].filter(Boolean);
    return cand.some((c) => norm(c) === ts);
  }

  const sym = norm(entry.symbol);
  if (!sym) return false;

  if (ctx.category && ctx.category === sym) return true;
  if (ctx.pair && ctx.pair === sym) return true;
  if (ctx.symbol && ctx.symbol === sym) return true;
  if (ctx.tradingSymbol && ctx.tradingSymbol === sym) return true;

  if (ctx.symbol && ctx.symbol.startsWith(sym)) return true;
  if (ctx.tradingSymbol && ctx.tradingSymbol.startsWith(sym)) return true;

  return false;
}

async function mergeInstrumentDenylistForAdminIds(idsOrdered) {
  if (!idsOrdered?.length) return [];
  const docs = await Admin.find({ _id: { $in: idsOrdered } })
    .select('restrictions.instrumentDenylist')
    .lean();
  const byId = Object.fromEntries(docs.map((d) => [String(d._id), d]));
  const merged = [];
  for (const id of idsOrdered) {
    const list = byId[String(id)]?.restrictions?.instrumentDenylist;
    if (Array.isArray(list)) merged.push(...list);
  }
  return merged;
}

export async function getMergedInstrumentDenylist(adminDoc) {
  if (!adminDoc?._id) return [];
  const ids = collectHierarchyAdminIds({
    hierarchyPath: adminDoc.hierarchyPath,
    admin: adminDoc,
  });
  return mergeInstrumentDenylistForAdminIds(ids);
}

function denyMessage(entry) {
  const bits = [entry.exchange, entry.segment, entry.symbol || entry.tradingSymbol].filter(Boolean);
  return bits.join(' · ');
}

export async function assertHierarchyInstrumentNotDenied(user, ctx) {
  const merged = await mergeInstrumentDenylistForAdminIds(collectHierarchyAdminIds(user));
  if (!merged.length) return;
  for (const entry of merged) {
    if (matchesInstrumentDeny(entry, ctx)) {
      throw new Error(
        `Trading is blocked for "${denyMessage(entry)}" under your hierarchy restrictions. Contact your administrator.`
      );
    }
  }
}

/**
 * Check if user is allowed to trade within low-high range for a specific instrument
 * Returns true if allowWithinLowHigh is enabled for any matching denylist entry
 */
export async function isAllowedWithinLowHigh(user, ctx) {
  const merged = await mergeInstrumentDenylistForAdminIds(collectHierarchyAdminIds(user));
  if (!merged.length) return false;
  for (const entry of merged) {
    if (matchesInstrumentDeny(entry, ctx) && entry.allowWithinLowHigh) {
      return true;
    }
  }
  return false;
}
