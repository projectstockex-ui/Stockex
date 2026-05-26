import Instrument from '../models/Instrument.js';
import { getMarketData } from './zerodhaWebSocket.js';
import { LANDING_TICKER_ITEMS } from '../utils/landingTickerConfig.js';
import { addActiveDerivExpiryToQuery } from '../utils/derivativeExpiry.js';

function norm(s) {
  return String(s || '').trim().toUpperCase();
}

function parseNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function scoreInstrument(row, item) {
  let score = 0;
  const sym = norm(row.symbol);
  const want = (item.symbols || []).map(norm);
  if (want.includes(sym)) score += 100;
  if (item.exchanges?.includes(row.exchange)) score += 20;
  if (item.instrumentTypes?.includes(row.instrumentType)) score += 15;
  if (row.isFeatured) score += 5;
  if (item.excludeSymbols?.some((x) => sym === norm(x) || sym.startsWith(norm(x)))) score -= 200;
  if (item.mcxCommodity && row.expiry) {
    const exp = new Date(row.expiry);
    if (!Number.isNaN(exp.getTime())) {
      const days = (exp - Date.now()) / (86400 * 1000);
      if (days >= 0 && days < 120) score += 30 - Math.min(days, 30);
    }
  }
  return score;
}

async function findInstrumentForItem(item) {
  if (item.forex) return null;

  for (const t of item.tokens || []) {
    const tok = String(t);
    const byTok = await Instrument.findOne({ token: tok, isEnabled: true })
      .select('token symbol tradingSymbol exchange ltp change changePercent instrumentType expiry')
      .lean();
    if (byTok) return byTok;
  }

  const symList = (item.symbols || []).map((s) => norm(s)).filter(Boolean);
  if (!symList.length) return null;

  const query = {
    isEnabled: true,
    $or: [
      { symbol: { $in: symList } },
      { tradingSymbol: { $in: symList } },
    ],
  };
  if (item.exchanges?.length) query.exchange = { $in: item.exchanges };
  addActiveDerivExpiryToQuery(query);

  const rows = await Instrument.find(query)
    .select('token symbol tradingSymbol exchange ltp change changePercent instrumentType expiry isFeatured')
    .limit(40)
    .lean();

  if (!rows.length) {
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const loose = await Instrument.find({
      isEnabled: true,
      $or: symList.map((s) => ({ symbol: new RegExp(`^${esc(s)}`, 'i') })),
      ...(item.exchanges?.length ? { exchange: { $in: item.exchanges } } : {}),
    })
      .select('token symbol tradingSymbol exchange ltp change changePercent instrumentType expiry isFeatured')
      .limit(20)
      .lean();
    rows.push(...loose);
  }

  if (!rows.length) return null;

  const live = getMarketData() || {};
  const withLive = rows.filter((r) => parseNum(live[String(r.token)]?.ltp));
  const pool = withLive.length ? withLive : rows;
  pool.sort((a, b) => scoreInstrument(b, item) - scoreInstrument(a, item));
  return pool[0];
}

function quoteFromTick(tick, inst) {
  const ltp =
    parseNum(tick?.ltp) ??
    parseNum(tick?.last_price) ??
    parseNum(inst?.ltp) ??
    parseNum(inst?.close);
  if (ltp == null) return null;

  let changePercent = parseFloat(tick?.changePercent);
  if (!Number.isFinite(changePercent)) changePercent = parseFloat(inst?.changePercent);
  const ch = parseFloat(tick?.change ?? inst?.change);
  if (!Number.isFinite(changePercent)) {
    const open = parseNum(tick?.open ?? tick?.close ?? inst?.open);
    if (open) changePercent = ((ltp - open) / open) * 100;
  }
  const isUp = Number.isFinite(changePercent) ? changePercent >= 0 : Number.isFinite(ch) ? ch >= 0 : true;

  return {
    price: ltp,
    changePercent: Number.isFinite(changePercent) ? changePercent : null,
    isUp,
  };
}

/** @returns {Promise<{ tokens: number[], symbols: string[] }>} */
export async function resolveLandingTickerSubscriptions() {
  const tokens = new Set([256265, 260105, 257801, 288009, 265]);
  const symbols = new Set();

  for (const item of LANDING_TICKER_ITEMS) {
    if (item.forex) continue;
    for (const t of item.tokens || []) {
      const n = Number.parseInt(String(t), 10);
      if (Number.isFinite(n) && n > 0) tokens.add(n);
    }
    const inst = await findInstrumentForItem(item);
    if (!inst) {
      for (const s of item.symbols || []) symbols.add(norm(s));
      continue;
    }
    const n = Number.parseInt(String(inst.token), 10);
    if (Number.isFinite(n) && n > 0) tokens.add(n);
    if (inst.symbol) symbols.add(norm(inst.symbol));
    if (inst.tradingSymbol) symbols.add(norm(inst.tradingSymbol));
  }

  return {
    tokens: [...tokens],
    symbols: [...symbols],
  };
}

/** @returns {Promise<Array<{ label: string, token: string|null, symbol: string|null, price: number, changePercent: number|null, isUp: boolean }>>} */
export async function buildLandingTickerQuotes() {
  const live = getMarketData() || {};
  const out = [];

  for (const item of LANDING_TICKER_ITEMS) {
    if (item.forex) {
      const tick = live.USDINR || live.usdinr;
      const q = quoteFromTick(tick, null);
      if (q) {
        out.push({
          label: item.label,
          token: 'USDINR',
          symbol: 'USDINR',
          ...q,
        });
      }
      continue;
    }

    const inst = await findInstrumentForItem(item);
    const tokenStr = inst ? String(inst.token) : null;
    const tick =
      (tokenStr && (live[tokenStr] || live[Number(tokenStr)])) ||
      (item.tokens || []).map((t) => live[String(t)] || live[Number(t)]).find(Boolean);

    const q = quoteFromTick(tick, inst);
    if (q) {
      out.push({
        label: item.label,
        token: tokenStr,
        symbol: inst?.symbol || item.symbols?.[0] || null,
        ...q,
      });
    }
  }

  return out;
}

export default {
  buildLandingTickerQuotes,
  resolveLandingTickerSubscriptions,
};
