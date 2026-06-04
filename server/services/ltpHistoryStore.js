/**
 * In-memory LTP history store (ring buffer per key).
 * Key: token (Zerodha) or pair (Binance) as string.
 *
 * This is intentionally in-memory:
 * - fast & simple
 * - good enough for "previous LTPs with time" UI
 * - resets on server restart
 */

const MAX_POINTS_DEFAULT = 240; // ~8 minutes if sampled every 2s
const MIN_SAMPLE_MS_DEFAULT = 2000;

/** @type {Map<string, { points: Array<{ t: number, ltp: number, bid?: number, ask?: number }>, lastAt: number }>} */
const store = new Map();

export function recordLtpPoint(key, { ltp, bid = null, ask = null, t = Date.now() } = {}, opts = {}) {
  const k = String(key || '').trim();
  if (!k) return;
  const l = Number(ltp);
  if (!Number.isFinite(l) || l <= 0) return;

  const maxPoints = Math.max(20, Number(opts.maxPoints || MAX_POINTS_DEFAULT) || MAX_POINTS_DEFAULT);
  const minSampleMs = Math.max(0, Number(opts.minSampleMs || MIN_SAMPLE_MS_DEFAULT) || MIN_SAMPLE_MS_DEFAULT);

  let row = store.get(k);
  if (!row) {
    row = { points: [], lastAt: 0 };
    store.set(k, row);
  }

  if (minSampleMs > 0 && t - row.lastAt < minSampleMs) return;
  row.lastAt = t;

  const p = { t, ltp: l };
  const b = Number(bid);
  const a = Number(ask);
  if (Number.isFinite(b) && b > 0) p.bid = b;
  if (Number.isFinite(a) && a > 0) p.ask = a;

  row.points.push(p);
  if (row.points.length > maxPoints) {
    row.points.splice(0, row.points.length - maxPoints);
  }
}

export function getLtpHistory(key, limit = 120) {
  const k = String(key || '').trim();
  const n = Math.min(Math.max(Number(limit) || 120, 1), 500);
  const row = store.get(k);
  if (!row || !row.points.length) return [];
  // Return newest-first
  return row.points.slice(-n).reverse();
}

export default { recordLtpPoint, getLtpHistory };

