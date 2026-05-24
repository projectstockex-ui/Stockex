import axios from 'axios';
import TradingService from './tradingService.js';
import Trade from '../models/Trade.js';

let ioRef = null;
let cachedRates = {
  EUR: 0.92,
  GBP: 0.79,
  INR: 83,
  JPY: 150,
  CHF: 0.88,
  CAD: 1.36,
  AUD: 0.65,
  NZD: 0.6,
  SGD: 1.35,
  SEK: 10.8,
  NOK: 11.2,
  ZAR: 18.5,
  MXN: 17.2,
  TRY: 34,
  HKD: 7.8,
};
let lastFetch = 0;

/** USD-base API: rates.XXX = units of XXX per 1 USD. */
const PAIR_DEFS = [
  { pair: 'EURUSD', symbol: 'EUR', compute: (r) => (r.EUR > 0 ? 1 / r.EUR : 1.08) },
  { pair: 'GBPUSD', symbol: 'GBP', compute: (r) => (r.GBP > 0 ? 1 / r.GBP : 1.27) },
  { pair: 'AUDUSD', symbol: 'AUD', compute: (r) => (r.AUD > 0 ? 1 / r.AUD : 0.65) },
  { pair: 'NZDUSD', symbol: 'NZD', compute: (r) => (r.NZD > 0 ? 1 / r.NZD : 0.59) },
  { pair: 'USDJPY', symbol: 'USDJPY', compute: (r) => (r.JPY > 0 ? r.JPY : 150) },
  { pair: 'USDCHF', symbol: 'USDCHF', compute: (r) => (r.CHF > 0 ? r.CHF : 0.88) },
  { pair: 'USDCAD', symbol: 'USDCAD', compute: (r) => (r.CAD > 0 ? r.CAD : 1.36) },
  { pair: 'EURGBP', symbol: 'EURGBP', compute: (r) => (r.EUR > 0 && r.GBP > 0 ? r.GBP / r.EUR : 0.85) },
  { pair: 'EURJPY', symbol: 'EURJPY', compute: (r) => (r.EUR > 0 && r.JPY > 0 ? r.JPY / r.EUR : 160) },
  { pair: 'GBPJPY', symbol: 'GBPJPY', compute: (r) => (r.GBP > 0 && r.JPY > 0 ? r.JPY / r.GBP : 190) },
  { pair: 'AUDJPY', symbol: 'AUDJPY', compute: (r) => (r.AUD > 0 && r.JPY > 0 ? r.JPY / r.AUD : 96) },
  { pair: 'NZDJPY', symbol: 'NZDJPY', compute: (r) => (r.NZD > 0 && r.JPY > 0 ? r.JPY / r.NZD : 88) },
  { pair: 'CADJPY', symbol: 'CADJPY', compute: (r) => (r.CAD > 0 && r.JPY > 0 ? r.JPY / r.CAD : 110) },
  { pair: 'CHFJPY', symbol: 'CHFJPY', compute: (r) => (r.CHF > 0 && r.JPY > 0 ? r.JPY / r.CHF : 170) },
  { pair: 'AUDNZD', symbol: 'AUDNZD', compute: (r) => (r.AUD > 0 && r.NZD > 0 ? r.NZD / r.AUD : 1.09) },
  { pair: 'EURAUD', symbol: 'EURAUD', compute: (r) => (r.EUR > 0 && r.AUD > 0 ? r.AUD / r.EUR : 1.65) },
  { pair: 'EURCAD', symbol: 'EURCAD', compute: (r) => (r.EUR > 0 && r.CAD > 0 ? r.CAD / r.EUR : 1.47) },
  { pair: 'GBPAUD', symbol: 'GBPAUD', compute: (r) => (r.GBP > 0 && r.AUD > 0 ? r.AUD / r.GBP : 1.95) },
  { pair: 'GBPCAD', symbol: 'GBPCAD', compute: (r) => (r.GBP > 0 && r.CAD > 0 ? r.CAD / r.GBP : 1.72) },
  { pair: 'EURCHF', symbol: 'EURCHF', compute: (r) => (r.EUR > 0 && r.CHF > 0 ? r.CHF / r.EUR : 0.94) },
  { pair: 'GBPCHF', symbol: 'GBPCHF', compute: (r) => (r.GBP > 0 && r.CHF > 0 ? r.CHF / r.GBP : 1.12) },
  { pair: 'AUDCAD', symbol: 'AUDCAD', compute: (r) => (r.AUD > 0 && r.CAD > 0 ? r.CAD / r.AUD : 0.91) },
  { pair: 'NZDCAD', symbol: 'NZDCAD', compute: (r) => (r.NZD > 0 && r.CAD > 0 ? r.CAD / r.NZD : 0.84) },
  { pair: 'USDSGD', symbol: 'USDSGD', compute: (r) => (r.SGD > 0 ? r.SGD : 1.35) },
  { pair: 'USDHKD', symbol: 'USDHKD', compute: (r) => (r.HKD > 0 ? r.HKD : 7.8) },
  { pair: 'USDSEK', symbol: 'USDSEK', compute: (r) => (r.SEK > 0 ? r.SEK : 10.8) },
  { pair: 'USDNOK', symbol: 'USDNOK', compute: (r) => (r.NOK > 0 ? r.NOK : 11.2) },
  { pair: 'USDZAR', symbol: 'USDZAR', compute: (r) => (r.ZAR > 0 ? r.ZAR : 18.5) },
  { pair: 'USDMXN', symbol: 'USDMXN', compute: (r) => (r.MXN > 0 ? r.MXN : 17.2) },
  { pair: 'USDTRY', symbol: 'USDTRY', compute: (r) => (r.TRY > 0 ? r.TRY : 34) },
  { pair: 'USDINR', symbol: 'USDINR', compute: (r) => (r.INR > 0 ? r.INR : 83) },
];

export const FOREX_PAIRS = PAIR_DEFS.map((d) => d.pair.toUpperCase());

/** Last mid (ltp) per pair — for tick-to-tick % and synthetic candles before history fills */
const lastMidByPair = {};
/** { t: unixSec, mid: number }[] per pair for chart OHLC */
const historyByPair = {};
const MAX_SAMPLES = 25000;

function spreadMid(mid, pip = 0.00015) {
  const d = Math.max(mid * 0.00005, pip);
  return { bid: mid - d, ask: mid + d, ltp: mid };
}

function appendSample(pairU, mid, tsSec) {
  if (!historyByPair[pairU]) historyByPair[pairU] = [];
  const h = historyByPair[pairU];
  h.push({ t: tsSec, mid: Number(mid) });
  if (h.length > MAX_SAMPLES) h.splice(0, h.length - MAX_SAMPLES);
}

function mapBinanceIntervalToSeconds(iv) {
  const m = {
    '1m': 60,
    '3m': 180,
    '5m': 300,
    '15m': 900,
    '30m': 1800,
    '1h': 3600,
    '2h': 7200,
    '4h': 14400,
    '6h': 21600,
    '8h': 28800,
    '12h': 43200,
    '1d': 86400,
    '3d': 259200,
    '1w': 604800,
    '1M': 2592000,
  };
  return m[iv] || 900;
}

/**
 * lightweight-charts draws nothing for O=H=L=C (zero body/wick). Nudge high/low slightly for display only.
 */
function widenFlatCandleBar(c) {
  const o = Number(c.open);
  const hi = Number(c.high);
  const lo = Number(c.low);
  const cl = Number(c.close);
  if (![o, hi, lo, cl].every(Number.isFinite)) return c;
  const range = hi - lo;
  const ref = Math.max(Math.abs(o), Math.abs(cl), Math.abs(hi), Math.abs(lo), 1e-15);
  if (range > ref * 1e-12) {
    return { time: c.time, open: o, high: hi, low: lo, close: cl, volume: c.volume ?? 0 };
  }
  const eps =
    ref >= 80 ? ref * 2e-7
    : ref >= 1 ? ref * 5e-7
    : Math.max(ref * 1e-5, 1e-8);
  const mid = (Math.max(hi, lo, o, cl) + Math.min(hi, lo, o, cl)) / 2;
  return {
    time: c.time,
    open: o,
    close: cl,
    high: Math.max(o, cl, hi, mid) + eps,
    low: Math.min(o, cl, lo, mid) - eps,
    volume: c.volume ?? 0,
  };
}

/**
 * Aggregate poll samples into OHLC bars (lightweight-charts).
 * If no samples yet but we have a last mid, return a short flat series so the chart mounts.
 */
export function getForexCandles(pairU, intervalStr, limit = 500) {
  const step = mapBinanceIntervalToSeconds(intervalStr);
  const cap = Math.min(Math.max(10, limit), 1000);
  const h = historyByPair[pairU] || [];

  if (h.length === 0) {
    const mid = lastMidByPair[pairU];
    if (mid == null || !Number.isFinite(mid)) return [];
    const now = Math.floor(Date.now() / 1000);
    const n = Math.min(120, cap);
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const time = (Math.floor(now / step) - i) * step;
      out.push({ time, open: mid, high: mid, low: mid, close: mid, volume: 0 });
    }
    return out.map(widenFlatCandleBar);
  }

  const buckets = new Map();
  for (const row of h) {
    const bt = Math.floor(row.t / step) * step;
    let g = buckets.get(bt);
    if (!g) {
      g = { open: row.mid, high: row.mid, low: row.mid, close: row.mid };
      buckets.set(bt, g);
    } else {
      g.high = Math.max(g.high, row.mid);
      g.low = Math.min(g.low, row.mid);
      g.close = row.mid;
    }
  }

  const sorted = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, g]) => ({
      time,
      open: g.open,
      high: g.high,
      low: g.low,
      close: g.close,
      volume: 0,
    }));

  return sorted.slice(-cap).map(widenFlatCandleBar);
}

async function refreshRates() {
  const now = Date.now();
  if (now - lastFetch < 4000) return cachedRates;
  try {
    const { data } = await axios.get('https://api.exchangerate-api.com/v4/latest/USD', { timeout: 5000 });
    if (data?.rates && typeof data.rates === 'object') {
      cachedRates = { ...cachedRates, ...data.rates };
      lastFetch = now;
    }
  } catch (e) {
    console.warn('[forexMarketService] rate fetch failed:', e.message);
  }
  return cachedRates;
}

async function tickForexOpenPositions(pairU, tick) {
  const openForex = await Trade.find({
    status: 'OPEN',
    isForex: true,
    pair: pairU,
  }).lean();
  for (const t of openForex) {
    const usdPx = t.side === 'BUY' ? tick.bid : tick.ask;
    try {
      await TradingService.checkStopLossTarget(t._id, usdPx);
    } catch (e) {
      console.warn('[forexMarketService] SL/target check:', e.message);
    }
  }
}

async function poll(io) {
  const rates = await refreshRates();
  const tsSec = Math.floor(Date.now() / 1000);

  for (const def of PAIR_DEFS) {
    const mid = def.compute(rates);
    const pip =
      def.pair.includes('JPY') ? 0.02
      : def.pair.includes('INR') || def.pair.includes('TRY') || def.pair.includes('ZAR') ? 0.05
      : def.pair.includes('SEK') || def.pair.includes('NOK') || def.pair.includes('MXN') ? 0.002
      : 0.00015;
    const { bid, ask, ltp } = spreadMid(mid, pip);
    const pairU = def.pair.toUpperCase();
    const prev = lastMidByPair[pairU];
    const change = prev != null && Number.isFinite(prev) ? ltp - prev : 0;
    const changePct = prev != null && Math.abs(prev) > 1e-12 ? (change / Math.abs(prev)) * 100 : 0;

    const tick = {
      symbol: def.symbol,
      pair: def.pair,
      exchange: 'FOREX',
      token: def.pair,
      ltp,
      open: prev != null && Number.isFinite(prev) ? prev : ltp,
      high: Math.max(bid, ask, prev != null && Number.isFinite(prev) ? prev : ltp),
      low: Math.min(bid, ask, prev != null && Number.isFinite(prev) ? prev : ltp),
      close: ltp,
      change,
      changePercent: changePct.toFixed(2),
      volume: 0,
      bid,
      ask,
      lastUpdated: new Date(),
      isForex: true,
    };

    appendSample(pairU, ltp, tsSec);
    lastMidByPair[pairU] = ltp;

    if (!io) continue;

    io.emit('forex_tick', { [pairU]: tick });
    // Removed market_tick emission - forex ticks should only go to forex_tick event
    // This prevents frontend from receiving forex ticks on market_tick event
    // market_tick is reserved for NIFTY/Indian market data from Zerodha
    await TradingService.processPendingOrdersForUsdSpotTick({
      pair: pairU,
      symbol: def.symbol,
      bid: tick.bid,
      ask: tick.ask,
      ltp: tick.ltp,
    });

    // Check and trigger stoploss
    TradingService.checkAndTriggerStopLoss({
      pair: pairU,
      symbol: def.symbol,
      bid: tick.bid,
      ask: tick.ask,
      ltp: tick.ltp,
    }).catch((err) => console.error('checkAndTriggerStopLoss:', err?.message || err));

    await tickForexOpenPositions(pairU, tick);
  }
}

/**
 * Poll FX mids (USD base API) and broadcast ticks + pending fills + SL/target for forex.
 */
export function initForexMarketService(io) {
  ioRef = io;
  console.log('[forexMarketService] started (poll ~5s, exchangerate-api USD base)');
  const run = () => poll(ioRef).catch((e) => console.error('[forexMarketService]', e.message));
  run();
  setInterval(run, 5000);
}

export default { initForexMarketService };
