/**
 * LTP for RMS / EOD auto square-off (real-time, not entry).
 *
 * 1. Redis `stockex:ltp:{token}` when REDIS_URL is set
 * 2. Mongo Instrument.ltp
 * 3. Latest OPEN Trade.currentPrice / entryPrice for symbol+exchange
 */

import Instrument from '../models/Instrument.js';
import Trade from '../models/Trade.js';

let _redis;
let _redisDisabled = false;

async function getRedis() {
  if (_redisDisabled) return null;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (_redis) return _redis;
  try {
    const IORedis = (await import('ioredis')).default;
    _redis = new IORedis(url, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    });
    _redis.on('error', (e) => {
      console.warn('[ltpResolutionService] redis error:', e?.message || e);
    });
    return _redis;
  } catch (e) {
    console.warn('[ltpResolutionService] Redis init failed:', e?.message || e);
    _redisDisabled = true;
    return null;
  }
}

function parseRedisLtp(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = parseFloat(s);
  if (Number.isFinite(n) && n > 0) return n;
  try {
    const j = JSON.parse(s);
    const v = typeof j === 'number' ? j : j?.ltp ?? j?.last_price;
    const x = parseFloat(v);
    return Number.isFinite(x) && x > 0 ? x : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ token?: string|null, symbol: string, exchange?: string|null }} key
 * @returns {Promise<number|null>}
 */
export async function getLTP(key) {
  const token = key.token ? String(key.token) : '';
  const symbol = String(key.symbol || '');
  const exchange = key.exchange ? String(key.exchange) : '';

  // 0. In-memory Binance crypto data (most current, no I/O) — lazy import to avoid circular dep
  if (exchange === 'BINANCE' || (token && String(token).toUpperCase().endsWith('USDT'))) {
    try {
      const { getCryptoPrice } = await import('./binanceWebSocket.js');
      const cryptoTick = getCryptoPrice(token || symbol);
      const cLtp = parseFloat(cryptoTick?.ltp);
      if (Number.isFinite(cLtp) && cLtp > 0) return cLtp;
    } catch { /* binance module may not be loaded yet */ }
  }

  // 1. Redis
  const r = await getRedis();
  if (r && token) {
    try {
      const raw = await r.get(`stockex:ltp:${token}`);
      const v = parseRedisLtp(raw);
      if (v != null) return v;
    } catch (e) {
      console.warn('[getLTP] redis get:', e?.message || e);
    }
  }

  // 2. Mongo Instrument.ltp
  const instOr = [];
  if (token) instOr.push({ token });
  if (symbol && exchange) instOr.push({ symbol, exchange });
  if (symbol) instOr.push({ symbol });

  if (instOr.length) {
    const inst = await Instrument.findOne({ $or: instOr }).select('ltp').lean();
    const ltp = parseFloat(inst?.ltp);
    if (Number.isFinite(ltp) && ltp > 0) return ltp;
  }

  // 3. Latest OPEN Trade.currentPrice / entryPrice
  const tradeQ = { status: 'OPEN' };
  if (symbol) tradeQ.symbol = symbol;
  if (exchange) tradeQ.exchange = exchange;

  const t = await Trade.findOne(tradeQ)
    .sort({ updatedAt: -1 })
    .select('currentPrice entryPrice')
    .lean();
  const cp = parseFloat(t?.currentPrice);
  if (Number.isFinite(cp) && cp > 0) return cp;
  const ep = parseFloat(t?.entryPrice);
  if (Number.isFinite(ep) && ep > 0) return ep;

  return null;
}

export function cacheKeyForTrade(tr) {
  return tr.token ? `t:${tr.token}` : `s:${tr.exchange || ''}:${tr.symbol || ''}`;
}

/** @param {Array<{ token?: string, symbol: string, exchange?: string }>} trades */
export async function getLTPMapForTrades(trades) {
  const out = new Map();
  const seen = new Set();
  for (const tr of trades || []) {
    const ck = cacheKeyForTrade(tr);
    if (seen.has(ck)) continue;
    seen.add(ck);
    const ltp = await getLTP({
      token: tr.token,
      symbol: tr.symbol,
      exchange: tr.exchange,
    });
    if (ltp != null) out.set(ck, ltp);
  }
  return out;
}

/** Optional: tick pipeline can call this to align Redis with DB. */
export async function setLTPInRedis(token, ltp) {
  if (!token || !(Number(ltp) > 0)) return;
  const r = await getRedis();
  if (!r) return;
  try {
    await r.set(`stockex:ltp:${String(token)}`, String(ltp), 'EX', 86400);
  } catch (e) {
    console.warn('[setLTPInRedis]', e?.message || e);
  }
}

export default { getLTP, getLTPMapForTrades, cacheKeyForTrade, setLTPInRedis };
