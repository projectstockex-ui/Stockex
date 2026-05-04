import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { createChart } from 'lightweight-charts';
import axios from 'axios';
import { AUTO_REFRESH_EVENT } from '../lib/autoRefresh';
import { io } from 'socket.io-client';
import {
  Search, LogOut, Wallet, RefreshCw, Plus, TrendingUp,
  ChevronRight, Settings, Bell, User, X,
  BarChart2, History, ListOrdered, UserCircle, Menu,
  ArrowDownCircle, ArrowUpCircle, CreditCard, Copy, Check, Building2,
  Home, ArrowLeft, ClipboardList, Star, Info, ArrowRightLeft, Share2
} from 'lucide-react';
import MarketWatch from '../components/MarketWatch';
import ClosedInstrumentsTicker from '../components/ClosedInstrumentsTicker';
import { validateLimitPendingFromSegmentPerms } from '../lib/walletLimitOrderBand.js';

// Demo instruments with mock data for testing trading features
const demoInstrumentsData = {
  'Demo Stocks': {
    stocks: [
      { symbol: 'DEMO-STOCK1', name: 'Demo Stock One', exchange: 'DEMO', isDemo: true, mockPrice: 1250.50, mockChange: 2.5 },
      { symbol: 'DEMO-STOCK2', name: 'Demo Stock Two', exchange: 'DEMO', isDemo: true, mockPrice: 875.25, mockChange: -1.8 },
      { symbol: 'DEMO-STOCK3', name: 'Demo Stock Three', exchange: 'DEMO', isDemo: true, mockPrice: 2340.00, mockChange: 0.75 },
    ]
  },
  'Demo F&O': {
    futures: [
      { symbol: 'DEMO-FUT1', name: 'Demo Future Jan', exchange: 'DEMO', type: 'FUT', isDemo: true, mockPrice: 24500, mockChange: 1.2 },
      { symbol: 'DEMO-FUT2', name: 'Demo Future Feb', exchange: 'DEMO', type: 'FUT', isDemo: true, mockPrice: 24650, mockChange: -0.5 },
    ],
    calls: [
      { symbol: 'DEMO-24500CE', name: 'Demo 24500 CE', exchange: 'DEMO', type: 'CE', strike: 24500, isDemo: true, mockPrice: 250, mockChange: 15.5 },
      { symbol: 'DEMO-24600CE', name: 'Demo 24600 CE', exchange: 'DEMO', type: 'CE', strike: 24600, isDemo: true, mockPrice: 180, mockChange: 12.3 },
      { symbol: 'DEMO-24700CE', name: 'Demo 24700 CE', exchange: 'DEMO', type: 'CE', strike: 24700, isDemo: true, mockPrice: 120, mockChange: -8.2 },
    ],
    puts: [
      { symbol: 'DEMO-24500PE', name: 'Demo 24500 PE', exchange: 'DEMO', type: 'PE', strike: 24500, isDemo: true, mockPrice: 180, mockChange: -5.5 },
      { symbol: 'DEMO-24400PE', name: 'Demo 24400 PE', exchange: 'DEMO', type: 'PE', strike: 24400, isDemo: true, mockPrice: 220, mockChange: 8.7 },
      { symbol: 'DEMO-24300PE', name: 'Demo 24300 PE', exchange: 'DEMO', type: 'PE', strike: 24300, isDemo: true, mockPrice: 280, mockChange: 10.2 },
    ]
  },
  'Demo Crypto': {
    stocks: [
      { symbol: 'DEMO-BTC', name: 'Demo Bitcoin', exchange: 'DEMO', isDemo: true, isCrypto: true, mockPrice: 85000, mockChange: -2.1 },
      { symbol: 'DEMO-ETH', name: 'Demo Ethereum', exchange: 'DEMO', isDemo: true, isCrypto: true, mockPrice: 2950, mockChange: 1.5 },
    ]
  }
};

// Instruments data with Angel One tokens for real-time data
const instrumentsData = {
  ...demoInstrumentsData,
  'Indices': {
    stocks: [
      { symbol: 'NIFTY 50', name: 'Nifty 50 Index', exchange: 'NSE', token: '256265' },
      { symbol: 'BANKNIFTY', name: 'Bank Nifty Index', exchange: 'NSE', token: '260105' },
      { symbol: 'FINNIFTY', name: 'Fin Nifty Index', exchange: 'NSE', token: '257801' },
    ]
  },
  'NSE-EQ': {
    stocks: [
      { symbol: 'RELIANCE', name: 'Reliance Industries', exchange: 'NSE', token: '2885' },
      { symbol: 'SBIN', name: 'State Bank of India', exchange: 'NSE', token: '3045' },
      { symbol: 'HDFCBANK', name: 'HDFC Bank', exchange: 'NSE', token: '1333' },
      { symbol: 'TCS', name: 'Tata Consultancy Services', exchange: 'NSE', token: '11536' },
      { symbol: 'INFY', name: 'Infosys Limited', exchange: 'NSE', token: '1594' },
      { symbol: 'ICICIBANK', name: 'ICICI Bank', exchange: 'NSE', token: '4963' },
      { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank', exchange: 'NSE', token: '1922' },
      { symbol: 'ITC', name: 'ITC Limited', exchange: 'NSE', token: '1660' },
      { symbol: 'AXISBANK', name: 'Axis Bank', exchange: 'NSE', token: '5900' },
      { symbol: 'BHARTIARTL', name: 'Bharti Airtel', exchange: 'NSE', token: '17818' },
      { symbol: 'MARUTI', name: 'Maruti Suzuki', exchange: 'NSE', token: '10999' },
      { symbol: 'WIPRO', name: 'Wipro Limited', exchange: 'NSE', token: '3787' },
      { symbol: 'BAJFINANCE', name: 'Bajaj Finance', exchange: 'NSE', token: '20374' },
      { symbol: 'HINDUNILVR', name: 'Hindustan Unilever', exchange: 'NSE', token: '1394' },
      { symbol: 'TATASTEEL', name: 'Tata Steel', exchange: 'NSE', token: '3426' },
      { symbol: 'SUNPHARMA', name: 'Sun Pharma', exchange: 'NSE', token: '17388' },
      { symbol: 'TITAN', name: 'Titan Company', exchange: 'NSE', token: '3506' },
      { symbol: 'ASIANPAINT', name: 'Asian Paints', exchange: 'NSE', token: '467' },
      { symbol: 'NTPC', name: 'NTPC Limited', exchange: 'NSE', token: '11630' },
      { symbol: 'POWERGRID', name: 'Power Grid Corp', exchange: 'NSE', token: '11532' },
      { symbol: 'M&M', name: 'Mahindra & Mahindra', exchange: 'NSE', token: '2181' },
      { symbol: 'ONGC', name: 'ONGC', exchange: 'NSE', token: '2475' },
      { symbol: 'COALINDIA', name: 'Coal India', exchange: 'NSE', token: '1232' },
      { symbol: 'HCLTECH', name: 'HCL Technologies', exchange: 'NSE', token: '7229' },
      { symbol: 'TECHM', name: 'Tech Mahindra', exchange: 'NSE', token: '3432' },
    ]
  },
  'NSEFUT': {
    futures: [
      { symbol: 'NIFTY25JANFUT', name: 'NIFTY JAN FUT', exchange: 'NFO', type: 'FUT', token: '35001' },
      { symbol: 'BANKNIFTY25JANFUT', name: 'BANKNIFTY JAN FUT', exchange: 'NFO', type: 'FUT', token: '35009' },
      { symbol: 'FINNIFTY25JANFUT', name: 'FINNIFTY JAN FUT', exchange: 'NFO', type: 'FUT', token: '35037' },
    ]
  },
  'NSEOPT': {
    calls: [
      { symbol: 'NIFTY26000CE', name: 'NIFTY 26000 CE', exchange: 'NFO', type: 'CE', strike: 26000, token: '43650' },
      { symbol: 'NIFTY26100CE', name: 'NIFTY 26100 CE', exchange: 'NFO', type: 'CE', strike: 26100, token: '43652' },
      { symbol: 'BANKNIFTY59500CE', name: 'BANKNIFTY 59500 CE', exchange: 'NFO', type: 'CE', strike: 59500, token: '43750' },
    ],
    puts: [
      { symbol: 'NIFTY26000PE', name: 'NIFTY 26000 PE', exchange: 'NFO', type: 'PE', strike: 26000, token: '43651' },
      { symbol: 'BANKNIFTY59500PE', name: 'BANKNIFTY 59500 PE', exchange: 'NFO', type: 'PE', strike: 59500, token: '43751' },
    ]
  },
  'MCXFUT': {
    futures: [
      { symbol: 'GOLDM', name: 'Gold Mini', exchange: 'MCX', type: 'FUT', token: '220822' },
      { symbol: 'SILVERM', name: 'Silver Mini', exchange: 'MCX', type: 'FUT', token: '220823' },
      { symbol: 'CRUDEOIL', name: 'Crude Oil', exchange: 'MCX', type: 'FUT', token: '224570' },
      { symbol: 'NATURALGAS', name: 'Natural Gas', exchange: 'MCX', type: 'FUT', token: '226745' },
      { symbol: 'COPPER', name: 'Copper', exchange: 'MCX', type: 'FUT', token: '220824' },
    ]
  },
  'MCXOPT': {
    calls: [
      { symbol: 'CRUDEOIL8000CE', name: 'CRUDEOIL 8000 CE', exchange: 'MCX', type: 'CE', strike: 8000, token: '230001' },
      { symbol: 'GOLD75000CE', name: 'GOLD 75000 CE', exchange: 'MCX', type: 'CE', strike: 75000, token: '230002' },
    ],
    puts: [
      { symbol: 'CRUDEOIL7500PE', name: 'CRUDEOIL 7500 PE', exchange: 'MCX', type: 'PE', strike: 7500, token: '230003' },
      { symbol: 'GOLD74000PE', name: 'GOLD 74000 PE', exchange: 'MCX', type: 'PE', strike: 74000, token: '230004' },
    ]
  }
};

/** Path segment for GET /api/binance/candles/:symbol (must not produce e.g. DOGEUSDTUSDT). */
function binanceCandleSymbol(instrument) {
  if (!instrument) return '';
  const pair = String(instrument.pair || '').trim();
  if (pair && pair.toUpperCase().endsWith('USDT')) return pair.toUpperCase();
  const sym = String(instrument.symbol || '').trim().toUpperCase();
  if (!sym) return '';
  return sym.endsWith('USDT') ? sym : `${sym}USDT`;
}

/** Binance ticks are emitted on both pair (ETHUSDT) and base symbol (ETH); token may be unset on client. */
function getCryptoMarketQuote(marketData, instrument) {
  if (!instrument || !marketData || typeof marketData !== 'object') return null;
  const rawKeys = [instrument.pair, instrument.symbol, instrument.token].filter(
    (v) => v != null && String(v).trim() !== ''
  );
  for (const raw of rawKeys) {
    const s = String(raw).trim();
    const variants = [s, s.toUpperCase(), s.toLowerCase()];
    for (const k of variants) {
      const q = marketData[k];
      if (q != null && (q.ltp != null || q.close != null)) return q;
    }
  }
  return null;
}

/** Zerodha tick keys are string token ids; instruments may use number or string */
function marketDataRowForInstrumentToken(marketData, token) {
  if (token == null || token === '' || !marketData || typeof marketData !== 'object') return null;
  const s = String(token);
  return marketData[s] ?? marketData[Number.parseInt(s, 10)] ?? null;
}

/** Binance base (e.g. BTC) for {BASE}INR/{BASE}USDT implied multiplier. */
function cryptoBaseForInrMultiplier(inst) {
  if (!inst) return '';
  const p = String(inst.pair || '').toUpperCase().trim();
  if (p.endsWith('USDT')) return p.replace(/USDT$/i, '');
  const sym = String(inst.symbol || '').toUpperCase().trim();
  if (sym.endsWith('USDT')) return sym.replace(/USDT$/i, '');
  if (/^[A-Z]{2,12}$/.test(sym)) return sym;
  return '';
}

let _binanceImpliedInrPerUsdtByBase = {};
function setBinanceImpliedInrPerUsdt(map) {
  _binanceImpliedInrPerUsdtByBase = map && typeof map === 'object' ? { ...map } : {};
}

function isForexInstrument(inst) {
  if (!inst) return false;
  const seg = String(inst.segment || '').toUpperCase();
  const ds = String(inst.displaySegment || '').toUpperCase();
  return (
    inst.isForex === true ||
    inst.exchange === 'FOREX' ||
    seg === 'FOREX' ||
    seg === 'FOREXFUT' ||
    seg === 'FOREXOPT' ||
    ds === 'FOREX' ||
    ds === 'FOREXFUT' ||
    ds === 'FOREXOPT'
  );
}

/** Watchlist bucket for synthetic forex (non-options vs options). */
function forexWatchlistSegmentFromInstrument(inst) {
  const ds = String(inst?.displaySegment || '').toUpperCase();
  if (ds === 'FOREXOPT') return 'FOREXOPT';
  if (ds === 'FOREXFUT' || ds === 'FOREX') return 'FOREXFUT';
  const it = String(inst?.instrumentType || '').toUpperCase();
  if (it === 'OPTIONS' || it === 'OPT') return 'FOREXOPT';
  return 'FOREXFUT';
}

function forexOrderInstrumentType(inst) {
  if (!inst) return 'CURRENCY';
  const it = String(inst.instrumentType || '').toUpperCase();
  if (it === 'OPTIONS' || it === 'OPT') return 'OPTIONS';
  if (it === 'FUTURES') return 'FUTURES';
  return 'CURRENCY';
}

function mergeLegacyForexWatchlistBuckets(merged) {
  const legacy = merged.FOREX;
  if (!legacy?.length) return merged;
  const next = { ...merged, FOREX: [] };
  for (const inst of legacy) {
    const k = forexWatchlistSegmentFromInstrument(inst);
    next[k] = [...(next[k] || []), inst];
  }
  return next;
}

/** Forex ticks/candles are spot units; UI shows ₹ via usdRate — scale chart so it matches header/watchlist. */
function forexChartInrMultiplier(rate) {
  const n = Number(rate);
  return n > 0 && Number.isFinite(n) ? n : 1;
}

/** USDINR quote is already INR per USD; do not multiply by INR/USD again. */
function forexInrDisplayFactor(pairOrInst, rate) {
  const pair = typeof pairOrInst === 'string'
    ? pairOrInst
    : String(pairOrInst?.pair || pairOrInst?.symbol || '').toUpperCase();
  if (pair === 'USDINR') return 1;
  return forexChartInrMultiplier(rate);
}

function scaleForexChartCandle(c, rate, pairUpper) {
  const m = forexInrDisplayFactor(pairUpper, rate);
  return {
    time: c.time,
    open: Number(c.open) * m,
    high: Number(c.high) * m,
    low: Number(c.low) * m,
    close: Number(c.close) * m,
    volume: c.volume || 0,
  };
}

/** Binance OHLC: USDT candles as-is for chart; forex OHLC scaled to ₹ via spotPxToDisplayedInr. */
function scaleUsdSpotChartCandle(c, inst, usdRate) {
  if (isForexInstrument(inst)) {
    return {
      time: c.time,
      open: spotPxToDisplayedInr(inst, c.open, usdRate),
      high: spotPxToDisplayedInr(inst, c.high, usdRate),
      low: spotPxToDisplayedInr(inst, c.low, usdRate),
      close: spotPxToDisplayedInr(inst, c.close, usdRate),
      volume: c.volume || 0,
    };
  }
  if (inst?.isCrypto || inst?.exchange === 'BINANCE') {
    return {
      time: c.time,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: c.volume || 0,
    };
  }
  return {
    time: c.time,
    open: spotPxToDisplayedInr(inst, c.open, usdRate),
    high: spotPxToDisplayedInr(inst, c.high, usdRate),
    low: spotPxToDisplayedInr(inst, c.low, usdRate),
    close: spotPxToDisplayedInr(inst, c.close, usdRate),
    volume: c.volume || 0,
  };
}

/** Display price: Binance USD spot in USDT ($); forex/other paths use ₹ via spotPxToDisplayedInr. */
function spotQuoteDisplayPrice(inst, spotPx, usdRate) {
  if (isUsdSpotInstrument(inst) && !isForexInstrument(inst)) {
    return Number(spotPx) || 0;
  }
  return spotPxToDisplayedInr(inst, spotPx, usdRate);
}

/** ₹ column for crypto (USDT) & forex spot; USDINR is already INR per USD. */
function spotPxToDisplayedInr(inst, spotPx, usdRate) {
  const px = Number(spotPx) || 0;
  if (isForexInstrument(inst)) return px * forexInrDisplayFactor(String(inst.pair || inst.symbol || '').toUpperCase(), usdRate);
  if (inst?.isCrypto || inst?.exchange === 'BINANCE') {
    if (!isUsdSpotInstrument(inst)) {
      return px * forexChartInrMultiplier(usdRate);
    }
    const base = cryptoBaseForInrMultiplier(inst);
    const implied =
      base && _binanceImpliedInrPerUsdtByBase[base] != null
        ? Number(_binanceImpliedInrPerUsdtByBase[base])
        : NaN;
    const mult =
      base && Number.isFinite(implied) && implied > 40 && implied < 200
        ? implied
        : forexChartInrMultiplier(usdRate);
    return px * mult;
  }
  return px;
}

function isUsdSpotInstrument(inst) {
  if (!inst) return false;
  const it = String(inst.instrumentType || '').toUpperCase();
  const ds = String(inst.displaySegment || '').toUpperCase();
  if (isForexInstrument(inst)) {
    if (ds === 'FOREXOPT' || it === 'OPTIONS' || it === 'OPT' || it === 'FUTURES') return false;
    return true;
  }
  if (it === 'FUTURES' || it === 'OPTIONS' || it === 'OPT') return false;
  if (ds === 'CRYPTOFUT' || ds === 'CRYPTOOPT') return false;
  return !!(inst.isCrypto || inst.segment === 'CRYPTO' || inst.exchange === 'BINANCE');
}

/** Watchlist / favorites identity: pair for crypto & forex, else Zerodha token */
function watchlistInstrumentKey(inst) {
  if (!inst) return '';
  if (isUsdSpotInstrument(inst)) return String(inst.pair || inst.symbol || '').trim();
  return inst.token != null ? String(inst.token).trim() : '';
}

/**
 * NSE / MCX: SELL = best bid, BUY = best ask (Kite `rawBid` / `rawAsk` or depth in quote & ticks).
 * If the feed has no book, both map to LTP — then show a tight synthetic spread, not the same LTP on both.
 */
function alignIndianBookBidAskWithLtp(liveData, item, options = {}) {
  const fromFeed = Number(
    liveData?.ltp ?? liveData?.last_price ?? liveData?.close ?? item?.ltp ?? item?.lastPrice ?? 0
  );
  const anchor = Number(options?.chartAnchorLtp);
  const ltp =
    Number.isFinite(fromFeed) && fromFeed > 0
      ? fromFeed
      : Number.isFinite(anchor) && anchor > 0
        ? anchor
        : 0;

  const rawBid = Number(liveData?.rawBid);
  const rawAsk = Number(liveData?.rawAsk);
  if (Number.isFinite(rawBid) && Number.isFinite(rawAsk) && rawBid > 0 && rawAsk > 0) {
    const b = Math.min(rawBid, rawAsk);
    const a = Math.max(rawBid, rawAsk);
    if (b <= a) return { bid: b, ask: a };
  }
  if (rawBid > 0 && ltp > 0 && (!rawAsk || rawAsk <= 0)) {
    return { bid: rawBid, ask: ltp };
  }
  if (rawAsk > 0 && ltp > 0 && (!rawBid || rawBid <= 0)) {
    return { bid: ltp, ask: rawAsk };
  }

  const bid = Number(liveData?.bid);
  const ask = Number(liveData?.ask);
  const rel = (x) =>
    Number.isFinite(x) && x > 0 && ltp > 0 ? Math.abs(x - ltp) / ltp : 1;
  const MAX_REL_DRIFT = 0.02;

  if (!Number.isFinite(ltp) || ltp <= 0) {
    const fbBid = liveData?.bid || item?.lastBid || item?.ltp || item?.currentPrice;
    const fbAsk = liveData?.ask || item?.lastAsk || item?.ltp || item?.currentPrice;
    return { bid: Number(fbBid) || 0, ask: Number(fbAsk) || 0 };
  }

  if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0 && bid <= ask) {
    const bothLtp = Math.abs(bid - ltp) < 0.5 && Math.abs(ask - ltp) < 0.5;
    if (bothLtp) {
      const half = Math.max(ltp * 0.00002, 1);
      return { bid: ltp - half, ask: ltp + half };
    }
    if (rel(bid) <= MAX_REL_DRIFT && rel(ask) <= MAX_REL_DRIFT) {
      return { bid, ask };
    }
  }

  const half = Math.max(ltp * 0.00002, 1);
  return { bid: ltp - half, ask: ltp + half };
}

/** Bid/ask in USD for crypto/forex (server close path multiplies by FX); else token feed prices. */
function getUsdSpotBidAsk(marketData, item, options) {
  if (isUsdSpotInstrument(item)) {
    const q = getCryptoMarketQuote(marketData, item) || {};
    const ltp = Number(q.ltp || q.close || 0);
    let bid = Number(q.bid || ltp || 0);
    let ask = Number(q.ask || ltp || 0);
    if (!(bid > 0)) bid = ltp;
    if (!(ask > 0)) ask = ltp;
    return { bidPrice: bid, askPrice: ask };
  }
  const liveData = marketDataRowForInstrumentToken(marketData, item?.token) || {};
  const { bid, ask } = alignIndianBookBidAskWithLtp(liveData, item, options);
  return { bidPrice: bid, ask: ask };
}

/** Segment `cryptoSpreadInr` = total ₹ width per coin on quote; half widens bid/ask in USDT before FX display. */
function adjustUsdSpotBidAskForSegmentSpread(bidUsd, askUsd, spreadInrTotal, inrPerUsd) {
  const fx = Number(inrPerUsd);
  const w = Number(spreadInrTotal);
  const b = Number(bidUsd);
  const a = Number(askUsd);
  if (!(fx > 0) || !(w > 0) || !Number.isFinite(b) || !Number.isFinite(a)) {
    return { bidUsd: b, askUsd: a };
  }
  const halfUsd = (w / 2) / fx;
  return { bidUsd: b - halfUsd, askUsd: a + halfUsd };
}

/** Binance USD crypto: `cryptoSpreadUsdPerSide` widens bid (−) / ask (+) in USDT; else INR total width via adjustUsdSpotBidAskForSegmentSpread. */
function resolveUsdSpotCryptoDisplayBidAsk(bidUsd, askUsd, cryptoUsdPerSide, cryptoSpreadInr, usdRate) {
  const us = Number(cryptoUsdPerSide);
  const b = Number(bidUsd);
  const a = Number(askUsd);
  if (Number.isFinite(us) && us > 0 && Number.isFinite(b) && Number.isFinite(a)) {
    return { bidUsd: b - us, askUsd: a + us };
  }
  const inr = Number(cryptoSpreadInr);
  if (Number.isFinite(inr) && inr > 0) {
    return adjustUsdSpotBidAskForSegmentSpread(bidUsd, askUsd, inr, usdRate);
  }
  return { bidUsd: b, askUsd: a };
}

const DEFAULT_FOREX_INSTRUMENTS = [
  { symbol: 'EURUSD', name: 'Euro / US Dollar', exchange: 'FOREX', pair: 'EURUSD', token: 'EURUSD', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'GBPUSD', name: 'British Pound / US Dollar', exchange: 'FOREX', pair: 'GBPUSD', token: 'GBPUSD', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'AUDUSD', name: 'Australian Dollar / US Dollar', exchange: 'FOREX', pair: 'AUDUSD', token: 'AUDUSD', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'NZDUSD', name: 'New Zealand Dollar / US Dollar', exchange: 'FOREX', pair: 'NZDUSD', token: 'NZDUSD', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'USDJPY', name: 'US Dollar / Japanese Yen', exchange: 'FOREX', pair: 'USDJPY', token: 'USDJPY', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'USDCHF', name: 'US Dollar / Swiss Franc', exchange: 'FOREX', pair: 'USDCHF', token: 'USDCHF', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'USDCAD', name: 'US Dollar / Canadian Dollar', exchange: 'FOREX', pair: 'USDCAD', token: 'USDCAD', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'EURGBP', name: 'Euro / British Pound', exchange: 'FOREX', pair: 'EURGBP', token: 'EURGBP', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'EURJPY', name: 'Euro / Japanese Yen', exchange: 'FOREX', pair: 'EURJPY', token: 'EURJPY', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'GBPJPY', name: 'British Pound / Japanese Yen', exchange: 'FOREX', pair: 'GBPJPY', token: 'GBPJPY', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'AUDJPY', name: 'Australian Dollar / Japanese Yen', exchange: 'FOREX', pair: 'AUDJPY', token: 'AUDJPY', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'NZDJPY', name: 'NZ Dollar / Japanese Yen', exchange: 'FOREX', pair: 'NZDJPY', token: 'NZDJPY', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'CADJPY', name: 'Canadian Dollar / Japanese Yen', exchange: 'FOREX', pair: 'CADJPY', token: 'CADJPY', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'CHFJPY', name: 'Swiss Franc / Japanese Yen', exchange: 'FOREX', pair: 'CHFJPY', token: 'CHFJPY', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'AUDNZD', name: 'Australian Dollar / NZ Dollar', exchange: 'FOREX', pair: 'AUDNZD', token: 'AUDNZD', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'EURAUD', name: 'Euro / Australian Dollar', exchange: 'FOREX', pair: 'EURAUD', token: 'EURAUD', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'EURCAD', name: 'Euro / Canadian Dollar', exchange: 'FOREX', pair: 'EURCAD', token: 'EURCAD', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'GBPAUD', name: 'British Pound / Australian Dollar', exchange: 'FOREX', pair: 'GBPAUD', token: 'GBPAUD', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'GBPCAD', name: 'British Pound / Canadian Dollar', exchange: 'FOREX', pair: 'GBPCAD', token: 'GBPCAD', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'EURCHF', name: 'Euro / Swiss Franc', exchange: 'FOREX', pair: 'EURCHF', token: 'EURCHF', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'GBPCHF', name: 'British Pound / Swiss Franc', exchange: 'FOREX', pair: 'GBPCHF', token: 'GBPCHF', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'AUDCAD', name: 'Australian Dollar / Canadian Dollar', exchange: 'FOREX', pair: 'AUDCAD', token: 'AUDCAD', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'NZDCAD', name: 'NZ Dollar / Canadian Dollar', exchange: 'FOREX', pair: 'NZDCAD', token: 'NZDCAD', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'USDSGD', name: 'US Dollar / Singapore Dollar', exchange: 'FOREX', pair: 'USDSGD', token: 'USDSGD', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'USDHKD', name: 'US Dollar / Hong Kong Dollar', exchange: 'FOREX', pair: 'USDHKD', token: 'USDHKD', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'USDSEK', name: 'US Dollar / Swedish Krona', exchange: 'FOREX', pair: 'USDSEK', token: 'USDSEK', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'USDNOK', name: 'US Dollar / Norwegian Krone', exchange: 'FOREX', pair: 'USDNOK', token: 'USDNOK', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'USDZAR', name: 'US Dollar / South African Rand', exchange: 'FOREX', pair: 'USDZAR', token: 'USDZAR', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'USDMXN', name: 'US Dollar / Mexican Peso', exchange: 'FOREX', pair: 'USDMXN', token: 'USDMXN', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'USDTRY', name: 'US Dollar / Turkish Lira', exchange: 'FOREX', pair: 'USDTRY', token: 'USDTRY', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
  { symbol: 'USDINR', name: 'US Dollar / Indian Rupee', exchange: 'FOREX', pair: 'USDINR', token: 'USDINR', isForex: true, instrumentType: 'CURRENCY', segment: 'FOREXFUT', displaySegment: 'FOREXFUT' },
];

const UserDashboard = () => {
  const { user, logoutUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Check if we're in crypto-only or mcx-only mode from URL query param
  const searchParams = new URLSearchParams(location.search);
  const cryptoOnly = searchParams.get('mode') === 'crypto';
  const mcxOnly = searchParams.get('mode') === 'mcx';
  const forexOnly = searchParams.get('mode') === 'forex';
  
  const [selectedInstrument, setSelectedInstrument] = useState(null);
  const [walletData, setWalletData] = useState(null);
  const [activeTab, setActiveTab] = useState('positions');
  const [quickMode, setQuickMode] = useState(true); // Always use quick order system
  const [mobileView, setMobileView] = useState('quotes');
  const [showBuySellModal, setShowBuySellModal] = useState(false);
  const [orderType, setOrderType] = useState('buy');
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [tradeInstrument, setTradeInstrument] = useState(null); // For trading panel
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [showWalletTransferModal, setShowWalletTransferModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [showReferralModal, setShowReferralModal] = useState(false);
  const [indicesData, setIndicesData] = useState({});
  const [marketData, setMarketData] = useState({}); // Shared market data for chart and instruments
  const [positionsRefreshKey, setPositionsRefreshKey] = useState(0); // Key to trigger positions refresh
  const [activeSegment, setActiveSegment] = useState(() => localStorage.getItem('stockex_active_segment') || 'FAVORITES'); // Track active segment for currency display
  const [usdRate, setUsdRate] = useState(83.50); // USD to INR rate (default fallback)
  const [usdSpotClientSpreads, setUsdSpotClientSpreads] = useState({
    cryptoInr: 0,
    cryptoUsdPerSide: 0,
    forex: 0,
  });
  const [watchlistRefreshKey, setWatchlistRefreshKey] = useState(0); // Key to trigger watchlist refresh
  /** Bumps on each Socket.IO connect so MCX can re-post /tick-subscribe after server is ready */
  const [socketConnectEpoch, setSocketConnectEpoch] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());
  /** Last bar close from ChartPanel / mobile chart — bid/ask align to this (fixes MCX feed vs Kite chart mismatch). */
  const [chartLtpAnchor, setChartLtpAnchor] = useState({ token: null, ltp: null });

  /** Merged segment permissions from GET /user/settings — limit/pending gate (admin Segment Permissions only). */
  const [segmentPermissionsGate, setSegmentPermissionsGate] = useState({});

  useEffect(() => {
    if (!user?.token) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get('/api/user/settings', {
          headers: { Authorization: `Bearer ${user.token}` },
        });
        if (cancelled || !data?.segmentPermissions) return;
        setSegmentPermissionsGate(data.segmentPermissions);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.token]);

  useEffect(() => {
    setChartLtpAnchor({ token: null, ltp: null });
  }, [selectedInstrument?.token]);

  const handleChartLtp = useCallback((emitToken, ltp) => {
    if (emitToken == null || emitToken === '') return;
    if (String(selectedInstrument?.token) !== String(emitToken)) return;
    const n = Number(ltp);
    if (!Number.isFinite(n) || n <= 0) return;
    setChartLtpAnchor({ token: String(emitToken), ltp: n });
  }, [selectedInstrument?.token]);

  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  
  // Format time as HH:MM:SS (24-hour format)
  const formatTime = (date) => {
    return date.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'Asia/Kolkata'
    });
  };
  
  const [headerSearchTerm, setHeaderSearchTerm] = useState('');
  const [headerSearchResults, setHeaderSearchResults] = useState([]);
  const [showHeaderSearchResults, setShowHeaderSearchResults] = useState(false);
  const [headerSearching, setHeaderSearching] = useState(false);
  const headerSearchRef = useRef(null);
  
  const refreshPositions = () => setPositionsRefreshKey(k => k + 1);
  
  // Fetch USD/INR exchange rate
  useEffect(() => {
    const fetchUsdRate = async () => {
      try {
        // Try to get rate from API or use fallback
        const { data } = await axios
          .get('/api/exchange-rate/usdinr')
          .catch(() => ({ data: { rate: 83.5, impliedInrPerUsdt: {} } }));
        if (data?.rate) setUsdRate(data.rate);
        setBinanceImpliedInrPerUsdt(data?.impliedInrPerUsdt);
      } catch (error) {
        // Use default rate if API fails
      }
    };
    fetchUsdRate();
    // Refresh often — rate drives crypto ₹ display (Binance USDTINR when available)
    const interval = setInterval(fetchUsdRate, 120000);
    return () => clearInterval(interval);
  }, []);
  
  // Convert INR to USD
  const convertToUsd = (inrAmount) => {
    return (inrAmount / usdRate).toFixed(2);
  };
  
  // Check if currently viewing crypto (no longer used since crypto is removed)
  const isCryptoMode = false;

  // Connect to Socket.IO for real-time market data (shared across components)
  useEffect(() => {
    const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5001';
    const socket = io(socketUrl);
    const pending = {};
    const MARKET_TICK_FLUSH_MS = 40;
    let flushTimer = null;
    const flushBatchedTicks = () => {
      flushTimer = null;
      const keys = Object.keys(pending);
      if (keys.length === 0) return;
      const batch = {};
      for (const k of keys) {
        batch[k] = pending[k];
        delete pending[k];
      }
      setMarketData((prev) => ({ ...prev, ...batch }));
      const vals = Object.values(batch);
      const clientReceiveTime = Date.now();
      const nifty = vals.find((d) => d.symbol === 'NIFTY 50' || d.symbol === 'NIFTY');
      if (nifty?.serverTimestamp) {
        const latency = clientReceiveTime - nifty.serverTimestamp;
        if (latency > 1000) {
          console.warn(`[Price Delay] Market tick latency: ${latency}ms`);
        }
      }
      const banknifty = vals.find((d) => d.symbol === 'NIFTY BANK' || d.symbol === 'BANKNIFTY');
      const finnifty = vals.find((d) => d.symbol === 'NIFTY FIN SERVICE' || d.symbol === 'FINNIFTY');
      if (nifty || banknifty || finnifty) {
        setIndicesData((prev) => ({
          nifty: nifty || prev.nifty,
          banknifty: banknifty || prev.banknifty,
          finnifty: finnifty || prev.finnifty
        }));
      }
    };
    const queueTicks = (ticks) => {
      if (!ticks || typeof ticks !== 'object' || Array.isArray(ticks)) return;
      Object.assign(pending, ticks);
      if (flushTimer) return;
      flushTimer = setTimeout(flushBatchedTicks, MARKET_TICK_FLUSH_MS);
    };

    socket.on('connect', () => {
      console.log('Socket.IO connected for real-time ticks');
      setSocketConnectEpoch((e) => e + 1);
    });

    socket.on('market_tick', (ticks) => {
      queueTicks(ticks);
    });

    // Listen for real-time crypto ticks from Binance WebSocket
    socket.on('crypto_tick', (ticks) => {
      queueTicks(ticks);
    });

    socket.on('trade_update', (data) => {
      if (['PENDING_FILLED', 'NEW_TRADE', 'TRADE_CLOSED'].includes(data?.type)) {
        setPositionsRefreshKey((k) => k + 1);
      }
    });

    return () => {
      if (flushTimer) clearTimeout(flushTimer);
      socket.disconnect();
    };
  }, []);

  const fetchWallet = useCallback(async () => {
    if (!user?.token) return;
    try {
      const { data } = await axios.get('/api/user/wallet', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setWalletData(data);
    } catch (error) {
      console.error('Error fetching wallet:', error);
    }
  }, [user]);

  const fetchUsdSpotClientSpreads = useCallback(async () => {
    if (!user?.token) return;
    try {
      const { data } = await axios.get('/api/user/settings', {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      const sp = data?.segmentPermissions || {};
      const pickCryptoSpreadInr = () => {
        for (const seg of ['CRYPTO', 'CRYPTOFUT', 'CRYPTOOPT']) {
          const v = Number(sp[seg]?.cryptoSpreadInr);
          if (Number.isFinite(v) && v > 0) return v;
        }
        return 0;
      };
      const pickCryptoUsdPerSide = () => {
        for (const seg of ['CRYPTO', 'CRYPTOFUT', 'CRYPTOOPT']) {
          const v = Number(sp[seg]?.cryptoSpreadUsdPerSide);
          if (Number.isFinite(v) && v > 0) return v;
        }
        return 0;
      };
      const cInr = pickCryptoSpreadInr();
      const cUsd = pickCryptoUsdPerSide();
      const f = Number(
        sp.FOREXFUT?.cryptoSpreadInr ?? sp.FOREXOPT?.cryptoSpreadInr ?? sp.FOREX?.cryptoSpreadInr
      );
      setUsdSpotClientSpreads({
        cryptoInr: Number.isFinite(cInr) && cInr > 0 ? cInr : 0,
        cryptoUsdPerSide: Number.isFinite(cUsd) && cUsd > 0 ? cUsd : 0,
        forex: Number.isFinite(f) && f > 0 ? f : 0,
      });
    } catch {
      setUsdSpotClientSpreads({ cryptoInr: 0, cryptoUsdPerSide: 0, forex: 0 });
    }
  }, [user]);

  useEffect(() => {
    fetchWallet();
    fetchUsdSpotClientSpreads();
    fetchMarketData();
    const interval = setInterval(fetchMarketData, 3000);
    return () => clearInterval(interval);
  }, [fetchWallet, fetchUsdSpotClientSpreads]);

  const fetchMarketData = async () => {
    if (!user?.token) return;
    try {
      const { data } = await axios.get('/api/zerodha/market-data', {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (data && typeof data === 'object' && Object.keys(data).length > 0) {
        console.log(`Received ${Object.keys(data).length} market data entries`);
        // Merge with existing market data
        setMarketData(prev => ({ ...prev, ...data }));
        // Extract indices data by symbol
        const nifty = Object.values(data).find(d => d.symbol === 'NIFTY 50' || d.symbol === 'NIFTY');
        const banknifty = Object.values(data).find(d => d.symbol === 'NIFTY BANK' || d.symbol === 'BANKNIFTY');
        const finnifty = Object.values(data).find(d => d.symbol === 'NIFTY FIN SERVICE' || d.symbol === 'FINNIFTY');
        setIndicesData({
          nifty: nifty || null,
          banknifty: banknifty || null,
          finnifty: finnifty || null
        });
      }
    } catch (error) {
      // Silent fail
    }
  };

  /**
   * MCX fallback snapshot: when live ticks are unavailable (closed segment / reconnect),
   * hydrate selected contract from instrument DB so UI doesn't stay at 0.00.
   */
  const hydrateSelectedInstrumentSnapshot = useCallback(async () => {
    if (!mcxOnly || !user?.token || !selectedInstrument) return;
    const searchKey = String(
      selectedInstrument.tradingSymbol || selectedInstrument.symbol || ''
    ).trim();
    if (!searchKey) return;

    try {
      const { data } = await axios.get('/api/instruments/user', {
        params: { search: searchKey, segment: 'MCXFUT' },
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!Array.isArray(data) || data.length === 0) return;

      const matched =
        data.find(
          (row) =>
            selectedInstrument.token != null &&
            String(row?.token ?? '') === String(selectedInstrument.token)
        ) ||
        data.find(
          (row) =>
            String(row?.tradingSymbol || '').toUpperCase() ===
            String(selectedInstrument.tradingSymbol || '').toUpperCase()
        ) ||
        data.find(
          (row) =>
            String(row?.symbol || '').toUpperCase() ===
            String(selectedInstrument.symbol || '').toUpperCase()
        );
      if (!matched) return;

      const ltp = Number(matched.ltp);
      const close = Number(matched.close);
      const px =
        Number.isFinite(ltp) && ltp > 0
          ? ltp
          : Number.isFinite(close) && close > 0
            ? close
            : null;
      if (px == null) return;

      const tokenKey =
        matched.token != null && String(matched.token).trim() !== ''
          ? String(matched.token).trim()
          : selectedInstrument.token != null
            ? String(selectedInstrument.token).trim()
            : '';

      if (tokenKey) {
        setMarketData((prev) => ({
          ...prev,
          [tokenKey]: {
            ...(prev[tokenKey] || {}),
            token: tokenKey,
            symbol: matched.symbol || selectedInstrument.symbol,
            tradingSymbol: matched.tradingSymbol || selectedInstrument.tradingSymbol,
            exchange: matched.exchange || selectedInstrument.exchange || 'MCX',
            ltp: px,
            close: Number.isFinite(close) && close > 0 ? close : px,
            open: Number(matched.open) || px,
            high: Number(matched.high) || px,
            low: Number(matched.low) || px,
            bid: Number(matched.lastBid) || px,
            ask: Number(matched.lastAsk) || px,
            change: Number(matched.change) || 0,
            changePercent: Number(matched.changePercent) || 0,
            lastUpdated: new Date().toISOString(),
            source: 'instrument_snapshot_fallback',
          },
        }));
      }

      setSelectedInstrument((prev) => ({
        ...prev,
        ...matched,
        ltp: px,
        lastPrice: px,
        close: Number.isFinite(close) && close > 0 ? close : px,
      }));
    } catch {
      // keep existing live/socket values
    }
  }, [mcxOnly, user?.token, selectedInstrument]);

  /** Merge targeted quote rows (e.g. MCX /instruments-quote) into shared marketData */
  const mergeMarketDataPatch = useCallback((patch) => {
    if (!patch || typeof patch !== 'object' || Object.keys(patch).length === 0) return;
    setMarketData((prev) => ({ ...prev, ...patch }));
  }, []);

  useEffect(() => {
    if (!mcxOnly || !selectedInstrument) return;
    void hydrateSelectedInstrumentSnapshot();
    const id = setInterval(() => {
      void hydrateSelectedInstrumentSnapshot();
    }, 8000);
    return () => clearInterval(id);
  }, [mcxOnly, selectedInstrument?.token, selectedInstrument?.symbol, hydrateSelectedInstrumentSnapshot]);

  useEffect(() => {
    const onSoftRefresh = () => {
      fetchWallet();
      fetchUsdSpotClientSpreads();
    };
    window.addEventListener(AUTO_REFRESH_EVENT, onSoftRefresh);
    return () => window.removeEventListener(AUTO_REFRESH_EVENT, onSoftRefresh);
  }, [fetchWallet, fetchUsdSpotClientSpreads]);

  const handleLogout = () => {
    logoutUser();
    navigate('/login');
  };

  // Header search functionality
  useEffect(() => {
    const doHeaderSearch = async () => {
      if (headerSearchTerm.length >= 2) {
        setHeaderSearching(true);
        setShowHeaderSearchResults(true);
        try {
          const headers = user?.token ? { Authorization: `Bearer ${user.token}` } : {};
          
          if (forexOnly) {
            const searchLower = headerSearchTerm.toLowerCase();
            setHeaderSearchResults(
              DEFAULT_FOREX_INSTRUMENTS.filter(
                (f) =>
                  f.symbol.toLowerCase().includes(searchLower) ||
                  (f.name && f.name.toLowerCase().includes(searchLower))
              )
            );
          } else if (cryptoOnly) {
            // Crypto search
            const cryptoList = [
              { symbol: 'BTC', name: 'Bitcoin', exchange: 'BINANCE', pair: 'BTCUSDT', isCrypto: true },
              { symbol: 'ETH', name: 'Ethereum', exchange: 'BINANCE', pair: 'ETHUSDT', isCrypto: true },
              { symbol: 'BNB', name: 'Binance Coin', exchange: 'BINANCE', pair: 'BNBUSDT', isCrypto: true },
              { symbol: 'XRP', name: 'Ripple', exchange: 'BINANCE', pair: 'XRPUSDT', isCrypto: true },
              { symbol: 'SOL', name: 'Solana', exchange: 'BINANCE', pair: 'SOLUSDT', isCrypto: true },
              { symbol: 'DOGE', name: 'Dogecoin', exchange: 'BINANCE', pair: 'DOGEUSDT', isCrypto: true },
              { symbol: 'ADA', name: 'Cardano', exchange: 'BINANCE', pair: 'ADAUSDT', isCrypto: true },
              { symbol: 'POL', name: 'Polygon', exchange: 'BINANCE', pair: 'POLUSDT', isCrypto: true },
              { symbol: 'LTC', name: 'Litecoin', exchange: 'BINANCE', pair: 'LTCUSDT', isCrypto: true },
              { symbol: 'AVAX', name: 'Avalanche', exchange: 'BINANCE', pair: 'AVAXUSDT', isCrypto: true },
            ];
            const searchLower = headerSearchTerm.toLowerCase();
            setHeaderSearchResults(cryptoList.filter(c => 
              c.symbol.toLowerCase().includes(searchLower) || c.name.toLowerCase().includes(searchLower)
            ));
          } else {
            // Regular trading search - use user endpoint for full results, global search across all instruments
            const { data } = await axios.get(
              `/api/instruments/user?search=${encodeURIComponent(headerSearchTerm)}`,
              { headers }
            );
            setHeaderSearchResults((data || []).filter(item => !item.isCrypto && item.exchange !== 'BINANCE').slice(0, 20));
          }
        } catch (error) {
          setHeaderSearchResults([]);
        }
        setHeaderSearching(false);
      } else {
        setHeaderSearchResults([]);
        setShowHeaderSearchResults(false);
      }
    };
    
    const timer = setTimeout(doHeaderSearch, 200);
    return () => clearTimeout(timer);
  }, [headerSearchTerm, user?.token, cryptoOnly, forexOnly]);

  // Close header search on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (headerSearchRef.current && !headerSearchRef.current.contains(e.target)) {
        setShowHeaderSearchResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Add to watchlist from header search
  const addToWatchlistFromHeader = async (instrument) => {
    // Map exchange + instrumentType to segment format
    let segment = 'NSEFUT';
    if (instrument.isCrypto || instrument.exchange === 'BINANCE') {
      segment = 'CRYPTO';
    } else if (isForexInstrument(instrument)) {
      segment = forexWatchlistSegmentFromInstrument(instrument);
    } else if (instrument.exchange === 'MCX') {
      segment = instrument.instrumentType === 'OPTIONS' ? 'MCXOPT' : 'MCXFUT';
    } else if (instrument.exchange === 'NFO') {
      segment = instrument.instrumentType === 'OPTIONS' ? 'NSEOPT' : 'NSEFUT';
    } else if (instrument.exchange === 'BFO') {
      segment = instrument.instrumentType === 'OPTIONS' ? 'BSE-OPT' : 'BSE-FUT';
    } else if (instrument.exchange === 'NSE') {
      segment = 'NSE-EQ';
    }
    
    try {
      const headers = { Authorization: `Bearer ${user.token}` };
      await axios.post('/api/instruments/watchlist/add', { instrument, segment }, { headers });
      setHeaderSearchTerm('');
      setShowHeaderSearchResults(false);
      // Trigger watchlist refresh in left panel
      setWatchlistRefreshKey(k => k + 1);
    } catch (error) {
      console.error('Error adding to watchlist:', error);
      alert(error.response?.data?.message || 'Error adding to watchlist');
    }
  };

  const openBuySell = (type, instrument = null) => {
    if (instrument) setSelectedInstrument(instrument);
    setOrderType(type);
    setShowBuySellModal(true);
  };

  // Quick Trade handler - opens trading panel in sidebar (keep chart + panel on the same symbol)
  const handleQuickTrade = (type, instrument) => {
    if (instrument) setSelectedInstrument(instrument);
    setTradeInstrument(instrument);
    setOrderType(type);
  };

  return (
    <div className="h-screen bg-dark-900 flex flex-col overflow-hidden">
      {/* Header - Desktop */}
      <header className="bg-dark-800 border-b border-dark-600 px-4 py-2 hidden md:flex items-center justify-between">
        <div className="flex items-center gap-6">
          {/* Home Button */}
          <button 
            onClick={() => navigate('/user/home')}
            className="flex items-center gap-2 bg-dark-700 hover:bg-dark-600 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Home size={18} className="text-green-400" />
            <span className="text-sm font-medium">Home</span>
          </button>
          
          {/* Orders Button - preserve mode */}
          <button 
            onClick={() =>
              navigate(
                mcxOnly
                  ? '/user/orders?mode=mcx'
                  : forexOnly
                    ? '/user/orders?mode=forex'
                    : cryptoOnly
                      ? '/user/orders?mode=crypto'
                      : '/user/orders'
              )
            }
            className="flex items-center gap-2 bg-dark-700 hover:bg-dark-600 px-3 py-1.5 rounded-lg transition-colors"
          >
            <ClipboardList size={18} className="text-blue-400" />
            <span className="text-sm font-medium">Orders</span>
          </button>
          
          {/* Crypto Mode Label */}
          {cryptoOnly && (
            <div className="hidden lg:flex items-center gap-2 text-sm">
              <span className="text-orange-400 font-medium">₿ Crypto Trading</span>
            </div>
          )}
          {/* MCX Mode Label */}
          {mcxOnly && (
            <div className="hidden lg:flex items-center gap-2 text-sm">
              <span className="text-yellow-400 font-medium">💎 MCX Commodity Trading</span>
            </div>
          )}
          {forexOnly && (
            <div className="hidden lg:flex items-center gap-2 text-sm">
              <span className="text-cyan-400 font-medium">Forex Trading</span>
            </div>
          )}
        </div>

        {/* Search - Functional search with dropdown */}
        <div className="flex-1 max-w-md mx-4" ref={headerSearchRef}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder={
                forexOnly ? 'Search FX pairs...' : cryptoOnly ? 'Search Crypto...' : 'Search Instruments...'
              }
              value={headerSearchTerm}
              onChange={(e) => setHeaderSearchTerm(e.target.value)}
              onFocus={() => headerSearchTerm.length >= 2 && setShowHeaderSearchResults(true)}
              className="w-full bg-dark-700 border border-dark-600 rounded-lg pl-10 pr-4 py-1.5 text-sm focus:outline-none focus:border-green-500"
            />
            {headerSearchTerm && (
              <button 
                onClick={() => { setHeaderSearchTerm(''); setShowHeaderSearchResults(false); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
              >
                <X size={14} />
              </button>
            )}
            
            {/* Search Results Dropdown */}
            {showHeaderSearchResults && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-dark-800 border border-dark-600 rounded-lg shadow-xl z-50 max-h-80 overflow-y-auto">
                {headerSearching ? (
                  <div className="p-3 text-center text-gray-400 text-sm">
                    <RefreshCw className="animate-spin inline mr-2" size={14} />
                    Searching...
                  </div>
                ) : headerSearchResults.length === 0 ? (
                  <div className="p-3 text-center text-gray-500 text-sm">
                    {headerSearchTerm.length >= 2 ? 'No results found' : 'Type to search...'}
                  </div>
                ) : (
                  headerSearchResults.map((inst, idx) => (
                    <div 
                      key={inst._id || inst.token || inst.pair || idx}
                      className="flex items-center justify-between px-3 py-2 hover:bg-dark-700 border-b border-dark-700 last:border-0"
                    >
                      <div className="flex-1 min-w-0">
                        <div
                          className={`font-medium text-sm ${
                            inst.isCrypto ? 'text-orange-400' : inst.isForex ? 'text-cyan-400' : 'text-white'
                          }`}
                        >
                          {inst.symbol}
                        </div>
                        <div className="text-xs text-gray-500 truncate">{inst.name}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">{inst.exchange}</span>
                        <button
                          onClick={() => addToWatchlistFromHeader(inst)}
                          className="flex items-center gap-1 bg-green-600 hover:bg-green-500 text-white text-xs px-2 py-1 rounded"
                        >
                          <Plus size={12} /> Add
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right side - Clock and Trading Account Balance */}
        <div className="flex items-center gap-4">
          {/* Live Clock - 24 hour format with seconds */}
          <div className="flex items-center gap-2 bg-dark-700 px-3 py-1.5 rounded-lg font-mono">
            <span className="text-blue-400 font-medium text-sm">{formatTime(currentTime)}</span>
          </div>
          {/* Trading Account Balance: crypto wallet is INR notional */}
          <div className="flex items-center gap-2 bg-dark-700 px-3 py-1.5 rounded-lg">
            <Wallet
              size={18}
              className={
                forexOnly ? 'text-cyan-400' : cryptoOnly ? 'text-orange-400' : mcxOnly ? 'text-yellow-400' : 'text-green-400'
              }
            />
            {forexOnly ? (
              <span className="text-cyan-400 font-medium">
                ₹{(walletData?.forexWallet?.balance || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
            ) : cryptoOnly ? (
              <span className="text-orange-400 font-medium" title="Balances are stored in ₹; US$ is approximate">
                ₹{(walletData?.cryptoWallet?.balance || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                <span className="text-gray-500 text-xs ml-1 font-normal">
                  (≈ $
                  {((walletData?.cryptoWallet?.balance || 0) / usdRate).toLocaleString('en-US', { maximumFractionDigits: 0 })})
                </span>
              </span>
            ) : mcxOnly ? (
              <span className="text-yellow-400 font-medium">₹{(walletData?.mcxWallet?.balance || 0).toLocaleString()}</span>
            ) : (
              <span className="text-green-400 font-medium">₹{(walletData?.tradingBalance || walletData?.wallet?.tradingBalance || 0).toLocaleString()}</span>
            )}
            <button
              onClick={() => setShowWalletTransferModal(true)}
              className="ml-2 p-1 hover:bg-dark-600 rounded transition-colors"
              title="Transfer funds between wallets"
            >
              <ArrowRightLeft size={16} className="text-purple-400" />
            </button>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-sm">
            <User size={18} className="text-gray-400" />
            <span>{user?.username}</span>
          </div>
        </div>
      </header>

      {/* Header - Mobile */}
      <header className="bg-dark-800 border-b border-dark-600 px-4 py-3 flex md:hidden items-center justify-between">
        <button 
          onClick={() => navigate('/user/home')}
          className="flex items-center gap-2 bg-dark-700 hover:bg-dark-600 px-3 py-1.5 rounded-lg transition-colors"
        >
          <Home size={18} className="text-green-400" />
          <span className="text-sm font-medium">Home</span>
        </button>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-dark-700 px-3 py-1.5 rounded-lg">
            <Wallet
              size={16}
              className={
                forexOnly ? 'text-cyan-400' : cryptoOnly ? 'text-orange-400' : mcxOnly ? 'text-yellow-400' : 'text-green-400'
              }
            />
            {forexOnly ? (
              <span className="text-cyan-400 font-medium text-sm">
                ₹{(walletData?.forexWallet?.balance || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
            ) : cryptoOnly ? (
              <span className="text-orange-400 font-medium text-sm" title="Stored in ₹">
                ₹{(walletData?.cryptoWallet?.balance || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                <span className="text-gray-500 text-[10px] ml-0.5">
                  (~${((walletData?.cryptoWallet?.balance || 0) / usdRate).toFixed(0)})
                </span>
              </span>
            ) : mcxOnly ? (
              <span className="text-yellow-400 font-medium text-sm">₹{(walletData?.mcxWallet?.balance || 0).toLocaleString()}</span>
            ) : (
              <span className="text-green-400 font-medium text-sm">₹{(walletData?.tradingBalance || walletData?.wallet?.tradingBalance || 0).toLocaleString()}</span>
            )}
            <button
              onClick={() => setShowWalletTransferModal(true)}
              className="ml-1 p-1 hover:bg-dark-600 rounded transition-colors"
              title="Transfer funds between wallets"
            >
              <ArrowRightLeft size={14} className="text-purple-400" />
            </button>
          </div>
          <div className="flex items-center gap-1 text-sm">
            <User size={16} className="text-gray-400" />
            <span className="text-gray-400">{user?.username}</span>
          </div>
        </div>
      </header>

      <ClosedInstrumentsTicker />

      {/* Mobile Menu Dropdown - Removed, not needed anymore */}
      {false && showMobileMenu && (
        <div 
          className="md:hidden absolute top-14 right-2 bg-dark-700 rounded-lg shadow-xl z-50 py-2 min-w-[200px]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-4 py-2 border-b border-dark-600">
            <p className="text-sm text-gray-400">Logged in as</p>
            <p className="font-medium">{user?.username}</p>
          </div>
          <div className="px-4 py-2 border-b border-dark-600">
            <p className="text-sm text-gray-400">Trading Balance</p>
            <p className="font-medium text-green-400">₹{(walletData?.tradingBalance || walletData?.wallet?.tradingBalance || 0).toLocaleString()}</p>
          </div>
          <button 
            onClick={() => { setShowWalletModal(true); setShowMobileMenu(false); }}
            className="w-full px-4 py-2 text-left hover:bg-dark-600 flex items-center gap-2 text-green-400"
          >
            <Wallet size={18} /> Add Funds
          </button>
          <button 
            onClick={() => { setShowReferralModal(true); setShowMobileMenu(false); }}
            className="w-full px-4 py-2 text-left hover:bg-dark-600 flex items-center gap-2 text-purple-400"
          >
            <Share2 size={18} /> Referral Amount
          </button>
          <button 
            onClick={() => { setShowSettingsModal(true); setShowMobileMenu(false); }}
            className="w-full px-4 py-2 text-left hover:bg-dark-600 flex items-center gap-2"
          >
            <Settings size={18} /> Settings
          </button>
          <button 
            onClick={handleLogout}
            className="w-full px-4 py-2 text-left hover:bg-dark-600 flex items-center gap-2 text-red-400"
          >
            <LogOut size={18} /> Logout
          </button>
          <button 
            onClick={() => setShowMobileMenu(false)}
            className="w-full px-4 py-2 text-left hover:bg-dark-600 flex items-center justify-center gap-2 text-gray-400 border-t border-dark-600 mt-2"
          >
            Close
          </button>
        </div>
      )}

      {/* Main Content - Desktop */}
      <div className="flex-1 hidden md:flex overflow-hidden">
        {/* Left Sidebar - Instruments - Fixed width */}
        <div className="flex-shrink-0 w-64">
          <InstrumentsPanel
            selectedInstrument={selectedInstrument}
            cryptoOnly={cryptoOnly}
            mcxOnly={mcxOnly}
            forexOnly={forexOnly}
            refreshKey={watchlistRefreshKey}
            socketConnectEpoch={socketConnectEpoch}
            usdRate={usdRate}
            mergeMarketDataPatch={mergeMarketDataPatch}
            onSelectInstrument={(inst) => {
              setSelectedInstrument(inst);
              // Also update trading panel when clicking instrument
              if (tradeInstrument) {
                setTradeInstrument(inst);
              }
            }}
            onBuySell={handleQuickTrade}
            user={user}
            marketData={marketData}
            onSegmentChange={setActiveSegment}
          />
        </div>

        {/* Center - Chart - Flexible width */}
        <div className="flex-1 flex flex-col min-w-0">
          <ChartPanel 
            selectedInstrument={selectedInstrument} 
            marketData={marketData}
            sidebarOpen={!!tradeInstrument}
            usdRate={usdRate}
            onChartLtp={handleChartLtp}
          />
          
          {/* Bottom - Positions */}
          <PositionsPanel 
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            walletData={walletData}
            setShowReferralModal={setShowReferralModal}
            user={user}
            marketData={marketData}
            refreshKey={positionsRefreshKey}
            selectedInstrument={selectedInstrument}
            onRefreshPositions={refreshPositions}
            cryptoOnly={cryptoOnly}
            mcxOnly={mcxOnly}
            forexOnly={forexOnly}
            usdRate={usdRate}
          />
        </div>

        {/* Right Sidebar - Trading Panel - Fixed width with smooth animation */}
        <div className={`flex-shrink-0 overflow-hidden transition-all duration-200 ease-out ${tradeInstrument ? 'w-72' : 'w-0'}`}>
          {tradeInstrument && (
            <div className="w-72 h-full">
              <TradingPanel 
                instrument={tradeInstrument}
                orderType={orderType}
                setOrderType={setOrderType}
                walletData={walletData}
                onClose={() => setTradeInstrument(null)}
                user={user}
                marketData={marketData}
                onRefreshWallet={fetchWallet}
                onRefreshPositions={refreshPositions}
                usdRate={usdRate}
                usdSpotClientSpreads={usdSpotClientSpreads}
                chartAnchorLtp={null}
                segmentPermissionsGate={segmentPermissionsGate}
              />
            </div>
          )}
        </div>
      </div>

      {/* Main Content - Mobile */}
      <div className="flex-1 flex flex-col md:hidden overflow-hidden pb-16">
        {mobileView === 'quotes' && (
          <MobileInstrumentsPanel 
            selectedInstrument={selectedInstrument}
            cryptoOnly={cryptoOnly}
            mcxOnly={mcxOnly}
            forexOnly={forexOnly}
            socketConnectEpoch={socketConnectEpoch}
            usdRate={usdRate}
            onSelectInstrument={(inst) => {
              setSelectedInstrument(inst);
              setMobileView('chart');
            }}
            onBuySell={openBuySell}
            user={user}
            marketData={marketData}
            onSegmentChange={setActiveSegment}
          />
        )}
        {mobileView === 'chart' && (
          <MobileChartPanel 
            selectedInstrument={selectedInstrument} 
            onBuySell={openBuySell}
            onBack={() => setMobileView('quotes')}
            marketData={marketData}
            usdRate={usdRate}
            onChartLtp={handleChartLtp}
          />
        )}
        {mobileView === 'positions' && (
          <MobilePositionsPanel activeTab="positions" user={user} marketData={marketData} cryptoOnly={cryptoOnly} mcxOnly={mcxOnly} forexOnly={forexOnly} walletData={walletData} usdRate={usdRate} />
        )}
        {mobileView === 'history' && (
          <MobilePositionsPanel activeTab="history" user={user} marketData={marketData} cryptoOnly={cryptoOnly} mcxOnly={mcxOnly} forexOnly={forexOnly} walletData={walletData} usdRate={usdRate} />
        )}
        {mobileView === 'profile' && (
          <MobileProfilePanel user={user} walletData={walletData} onLogout={handleLogout} />
        )}
      </div>

      {/* Mobile Bottom Navigation - Fixed */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-dark-800 border-t border-dark-600 flex items-center justify-around py-1.5 z-40">
        <button 
          onClick={() => setMobileView('quotes')}
          className={`flex flex-col items-center p-1.5 ${mobileView === 'quotes' ? 'text-green-400' : 'text-gray-400'}`}
        >
          <ListOrdered size={18} />
          <span className="text-[10px] mt-0.5">Quotes</span>
        </button>
        <button 
          onClick={() => setMobileView('chart')}
          className={`flex flex-col items-center p-1.5 ${mobileView === 'chart' ? 'text-green-400' : 'text-gray-400'}`}
        >
          <BarChart2 size={18} />
          <span className="text-[10px] mt-0.5">Chart</span>
        </button>
        <button 
          onClick={() => openBuySell('buy')}
          className="flex flex-col items-center p-2 bg-gradient-to-r from-green-600 to-green-500 rounded-full -mt-5 px-4 shadow-lg shadow-green-600/30"
        >
          <TrendingUp size={22} />
          <span className="text-[10px] mt-0.5 font-medium">Trade</span>
        </button>
        <button 
          onClick={() => setMobileView('positions')}
          className={`flex flex-col items-center p-1.5 ${mobileView === 'positions' || mobileView === 'history' ? 'text-green-400' : 'text-gray-400'}`}
        >
          <Wallet size={18} />
          <span className="text-[10px] mt-0.5">Portfolio</span>
        </button>
        <button 
          onClick={() => setMobileView('profile')}
          className={`flex flex-col items-center p-1.5 ${mobileView === 'profile' ? 'text-green-400' : 'text-gray-400'}`}
        >
          <User size={18} />
          <span className="text-[10px] mt-0.5">Profile</span>
        </button>
      </nav>

      {/* Buy/Sell Modal */}
      {showBuySellModal && (
        <BuySellModal 
          instrument={selectedInstrument}
          orderType={orderType}
          setOrderType={setOrderType}
          onClose={() => setShowBuySellModal(false)}
          walletData={walletData}
          user={user}
          marketData={marketData}
          onRefreshWallet={fetchWallet}
          onRefreshPositions={refreshPositions}
          usdRate={usdRate}
          usdSpotClientSpreads={usdSpotClientSpreads}
          chartAnchorLtp={null}
          segmentPermissionsGate={segmentPermissionsGate}
        />
      )}

      {/* Wallet Modal */}
      {showWalletModal && (
        <WalletModal 
          onClose={() => setShowWalletModal(false)}
          walletData={walletData}
          user={user}
          onRefresh={fetchWallet}
        />
      )}

      {/* Wallet Transfer Modal */}
      {showWalletTransferModal && (
        <WalletTransferModal 
          token={user?.token}
          onClose={() => setShowWalletTransferModal(false)}
          onSuccess={() => { fetchWallet(); }}
        />
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <SettingsModal 
          onClose={() => setShowSettingsModal(false)}
          user={user}
        />
      )}

      {/* Notifications Modal */}
      {showNotificationsModal && (
        <NotificationsModal 
          onClose={() => setShowNotificationsModal(false)}
          user={user}
        />
      )}

      {/* Referral Amount Modal */}
      {showReferralModal && (
        <ReferralAmountModal 
          onClose={() => setShowReferralModal(false)}
          user={user}
        />
      )}
    </div>
  );
};

const InstrumentsPanel = ({ selectedInstrument, onSelectInstrument, onBuySell, user, marketData = {}, onSegmentChange, cryptoOnly = false, mcxOnly = false, forexOnly = false, refreshKey = 0, socketConnectEpoch = 0, mergeMarketDataPatch, usdRate = 83.5 }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeSegment, setActiveSegment] = useState(() => localStorage.getItem('stockex_active_segment') || 'FAVORITES');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [addingToSegment, setAddingToSegment] = useState(null); // Which instrument is being added
  
  // Watchlist stored by segment
  const [watchlistBySegment, setWatchlistBySegment] = useState({
    'FAVORITES': [],
    'NSEFUT': [],
    'NSEOPT': [],
    'MCXFUT': [],
    'MCXOPT': [],
    'NSE-EQ': [],
    'BSE-FUT': [],
    'BSE-OPT': [],
    'CRYPTO': [],
    'CRYPTOFUT': [],
    'CRYPTOOPT': [],
    'FOREXFUT': [],
    'FOREXOPT': [],
    'FOREX': []
  });
  const [watchlistLoaded, setWatchlistLoaded] = useState(false);
  const mcxTickSubscribeTimerRef = useRef(null);
  const [cryptoDerivBrowseList, setCryptoDerivBrowseList] = useState([]);
  const [cryptoDerivBrowseLoading, setCryptoDerivBrowseLoading] = useState(false);
  
  // Notify parent when segment changes
  const handleSegmentChange = (segment) => {
    setActiveSegment(segment);
    try {
      localStorage.setItem('stockex_active_segment', segment);
    } catch (e) {
      // ignore storage errors
    }
    setSearchTerm('');
    setShowSearchResults(false);
    if (onSegmentChange) onSegmentChange(segment);
  };
  
  const [cryptoData, setCryptoData] = useState({});
  const [searchResults, setSearchResults] = useState([]);
  const [closedSearchResults, setClosedSearchResults] = useState([]);
  const [clientOpenDuration, setClientOpenDuration] = useState('7d');
  const [requestingToken, setRequestingToken] = useState(null);
  const [instrumentSearchTick, setInstrumentSearchTick] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const searchInputRef = useRef(null);
  const [segmentTabs, setSegmentTabs] = useState([])
  
  // Favorites helpers
  const isInFavorites = (instrument) => {
    const identifier = watchlistInstrumentKey(instrument);
    if (!identifier) return false;
    return (watchlistBySegment['FAVORITES'] || []).some(i => watchlistInstrumentKey(i) === identifier);
  };
  
  const addToFavorites = async (instrument) => {
    const segment = 'FAVORITES';
    const currentList = watchlistBySegment[segment] || [];
    const identifier = watchlistInstrumentKey(instrument);
    if (currentList.some(i => watchlistInstrumentKey(i) === identifier)) return;
    
    setWatchlistBySegment(prev => ({
      ...prev,
      [segment]: [...(prev[segment] || []), instrument]
    }));
    
    if (user?.token) {
      try {
        const headers = { Authorization: `Bearer ${user.token}` };
        await axios.post('/api/instruments/watchlist/add', { instrument, segment }, { headers });
      } catch (error) {
        console.error('Error saving favorite:', error);
      }
    }
  };
  
  const removeFromFavorites = async (instrument) => {
    const segment = 'FAVORITES';
    const identifier = watchlistInstrumentKey(instrument);
    setWatchlistBySegment(prev => ({
      ...prev,
      [segment]: (prev[segment] || []).filter(i => watchlistInstrumentKey(i) !== identifier)
    }));
    
    if (user?.token) {
      try {
        const headers = { Authorization: `Bearer ${user.token}` };
        await axios.post('/api/instruments/watchlist/remove', { token: instrument.token, pair: instrument.pair, segment }, { headers });
      } catch (error) {
        console.error('Error removing favorite:', error);
      }
    }
  };
  
  // Load watchlist from server on mount and when refreshKey changes
  useEffect(() => {
    const loadWatchlist = async () => {
      if (!user?.token) return;
      try {
        const headers = { Authorization: `Bearer ${user.token}` };
        const { data } = await axios.get('/api/instruments/watchlist', { headers });
        const defaults = {
          'FAVORITES': [],
          'NSEFUT': [],
          'NSEOPT': [],
          'MCXFUT': [],
          'MCXOPT': [],
          'NSE-EQ': [],
          'BSE-FUT': [],
          'BSE-OPT': [],
          'CRYPTO': [],
          'CRYPTOFUT': [],
          'CRYPTOOPT': [],
          'FOREXFUT': [],
          'FOREXOPT': [],
          'FOREX': []
        };
        const merged = { ...defaults, ...(data || {}) };
        setWatchlistBySegment(mergeLegacyForexWatchlistBuckets(merged));
        setWatchlistLoaded(true);
      } catch (error) {
        console.error('Error loading watchlist:', error);
        // Fallback to localStorage if server fails
        const saved = localStorage.getItem('stockex_watchlist_v2');
        if (saved) setWatchlistBySegment(JSON.parse(saved));
        setWatchlistLoaded(true);
      }
    };
    loadWatchlist();
  }, [user?.token, refreshKey]);

  // MCX wallet: subscribe Zerodha ticker to watchlist + selected contract so socket ticks flow (live chart / LTP without full refresh)
  useEffect(() => {
    if (!mcxOnly || !user?.token || !watchlistLoaded) return;
    if (mcxTickSubscribeTimerRef.current) clearTimeout(mcxTickSubscribeTimerRef.current);
    mcxTickSubscribeTimerRef.current = setTimeout(async () => {
      mcxTickSubscribeTimerRef.current = null;
      const ids = new Set();
      const pushTok = (inst) => {
        if (!inst || inst.isCrypto || inst.isForex) return;
        if (isUsdSpotInstrument(inst)) return;
        const t = inst.token;
        if (t == null || t === '') return;
        const n = parseInt(String(t), 10);
        if (!Number.isNaN(n) && n > 0) ids.add(n);
      };
      ['FAVORITES', 'MCXFUT', 'MCXOPT'].forEach((seg) => {
        (watchlistBySegment[seg] || []).forEach(pushTok);
      });
      if (selectedInstrument?.token != null) {
        const n = parseInt(String(selectedInstrument.token), 10);
        if (!Number.isNaN(n) && n > 0) ids.add(n);
      }
      const tokens = [...ids];
      if (tokens.length === 0) return;
      try {
        await axios.post('/api/zerodha/tick-subscribe', { tokens }, {
          headers: { Authorization: `Bearer ${user.token}` },
        });
      } catch {
        // Server may queue when ticker is down; retry on next watchlist/selection change
      }
    }, 500);
    return () => {
      if (mcxTickSubscribeTimerRef.current) clearTimeout(mcxTickSubscribeTimerRef.current);
    };
  }, [mcxOnly, user?.token, watchlistLoaded, watchlistBySegment, selectedInstrument?.token, socketConnectEpoch]);

  // MCX quotes now use socket-first flow via /api/zerodha/subscribe + market_tick.

  // Persist watchlist locally as fallback (including favorites)
  useEffect(() => {
    try {
      localStorage.setItem('stockex_watchlist_v2', JSON.stringify(watchlistBySegment));
    } catch (e) {
      // ignore storage errors
    }
  }, [watchlistBySegment]);
  
  // Set default segment tabs - filter based on cryptoOnly or mcxOnly mode
  useEffect(() => {
    if (forexOnly) {
      setSegmentTabs([
        { id: 'FOREXFUT', label: 'Forex Fut' },
        { id: 'FOREXOPT', label: 'Forex Opt' }
      ]);
      setActiveSegment('FOREXFUT');
    } else if (cryptoOnly) {
      const cryptoTabs = [
        { id: 'CRYPTO', label: '₿ Spot' },
        { id: 'CRYPTOFUT', label: 'Crypto Fut' },
        { id: 'CRYPTOOPT', label: 'Crypto Opt' }
      ];
      setSegmentTabs(cryptoTabs);
      setActiveSegment('CRYPTO');
    } else if (mcxOnly) {
      // MCX-only mode: show Favorites and MCX segments
      const mcxTabs = [
        { id: 'FAVORITES', label: '★ Favorites' },
        { id: 'MCXFUT', label: 'MCX Futures' },
        { id: 'MCXOPT', label: 'MCX Options' }
      ];
      setSegmentTabs(mcxTabs);
      setActiveSegment('FAVORITES');
    } else {
      // Regular trading mode: show Indian market segments (excluding MCX - MCX has separate account)
      const allTabs = [
        { id: 'FAVORITES', label: '★ Favorites' },
        { id: 'NSEFUT', label: 'NSEFUT' },
        { id: 'NSEOPT', label: 'NSEOPT' },
        { id: 'NSE-EQ', label: 'NSE-EQ' },
        { id: 'BSE-FUT', label: 'BSE-FUT' },
        { id: 'BSE-OPT', label: 'BSE-OPT' },
        { id: 'CRYPTO', label: '₿ Crypto' },
        { id: 'CRYPTOFUT', label: 'Crypto Fut' },
        { id: 'CRYPTOOPT', label: 'Crypto Opt' },
        { id: 'FOREXFUT', label: 'Forex Fut' },
        { id: 'FOREXOPT', label: 'Forex Opt' }
      ];
      setSegmentTabs(allTabs);
    }
  }, [cryptoOnly, mcxOnly, forexOnly]);

  // Browse list for crypto F&O / forex F&O (same instruments super-admin sees; no search required)
  useEffect(() => {
    if (
      activeSegment !== 'CRYPTOFUT' &&
      activeSegment !== 'CRYPTOOPT' &&
      activeSegment !== 'FOREXFUT' &&
      activeSegment !== 'FOREXOPT'
    ) {
      setCryptoDerivBrowseList([]);
      return;
    }
    if (!user?.token) return;
    let cancelled = false;
    (async () => {
      try {
        setCryptoDerivBrowseLoading(true);
        const headers = { Authorization: `Bearer ${user.token}` };
        const { data } = await axios.get(
          `/api/instruments/user?segment=${encodeURIComponent(activeSegment)}`,
          { headers }
        );
        if (!cancelled) {
          setCryptoDerivBrowseList(Array.isArray(data) ? data.slice(0, 150) : []);
        }
      } catch (e) {
        if (!cancelled) setCryptoDerivBrowseList([]);
      } finally {
        if (!cancelled) setCryptoDerivBrowseLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeSegment, user?.token, refreshKey]);
  
  // Market status derived from marketData
  const marketStatus = {
    connected: Object.keys(marketData).length > 0,
    lastUpdate: Object.keys(marketData).length > 0 ? new Date() : null
  };

  // Debounce search for performance
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 150); // Fast 150ms debounce
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Global search using API when typing - use crypto search in crypto-only mode
  useEffect(() => {
    const doSearch = async () => {
      const minSearchLen =
        activeSegment === 'CRYPTOFUT' ||
        activeSegment === 'CRYPTOOPT' ||
        activeSegment === 'FOREXFUT' ||
        activeSegment === 'FOREXOPT'
          ? 1
          : 2;
      if (debouncedSearch.length >= minSearchLen) {
        setIsSearching(true);
        setShowSearchResults(true);
        try {
          const headers = user?.token ? { Authorization: `Bearer ${user.token}` } : {};
          
          if (forexOnly) {
            const searchLower = debouncedSearch.toLowerCase();
            const filtered = DEFAULT_FOREX_INSTRUMENTS.filter(
              (f) =>
                f.symbol.toLowerCase().includes(searchLower) ||
                (f.name && f.name.toLowerCase().includes(searchLower))
            );
            setSearchResults(filtered);
            setClosedSearchResults([]);
          } else if (
            activeSegment === 'CRYPTOFUT' ||
            activeSegment === 'CRYPTOOPT' ||
            activeSegment === 'FOREXFUT' ||
            activeSegment === 'FOREXOPT'
          ) {
            const { data } = await axios.get(
              `/api/instruments/user?search=${encodeURIComponent(debouncedSearch)}&segment=${encodeURIComponent(activeSegment)}`,
              { headers }
            );
            setSearchResults(Array.isArray(data) ? data.slice(0, 200) : []);
            if (user?.token) {
              try {
                const { data: closed } = await axios.get(
                  `/api/instruments/client/closed-search?search=${encodeURIComponent(debouncedSearch)}&segment=${encodeURIComponent(activeSegment)}`,
                  { headers }
                );
                setClosedSearchResults(Array.isArray(closed) ? closed : []);
              } catch {
                setClosedSearchResults([]);
              }
            } else {
              setClosedSearchResults([]);
            }
          } else if (cryptoOnly) {
            // In crypto-only mode, search from local crypto list (spot tab)
            const cryptoList = [
              { symbol: 'BTC', name: 'Bitcoin', exchange: 'BINANCE', pair: 'BTCUSDT', isCrypto: true },
              { symbol: 'ETH', name: 'Ethereum', exchange: 'BINANCE', pair: 'ETHUSDT', isCrypto: true },
              { symbol: 'BNB', name: 'Binance Coin', exchange: 'BINANCE', pair: 'BNBUSDT', isCrypto: true },
              { symbol: 'XRP', name: 'Ripple', exchange: 'BINANCE', pair: 'XRPUSDT', isCrypto: true },
              { symbol: 'ADA', name: 'Cardano', exchange: 'BINANCE', pair: 'ADAUSDT', isCrypto: true },
              { symbol: 'DOGE', name: 'Dogecoin', exchange: 'BINANCE', pair: 'DOGEUSDT', isCrypto: true },
              { symbol: 'SOL', name: 'Solana', exchange: 'BINANCE', pair: 'SOLUSDT', isCrypto: true },
              { symbol: 'DOT', name: 'Polkadot', exchange: 'BINANCE', pair: 'DOTUSDT', isCrypto: true },
              { symbol: 'POL', name: 'Polygon', exchange: 'BINANCE', pair: 'POLUSDT', isCrypto: true },
              { symbol: 'LTC', name: 'Litecoin', exchange: 'BINANCE', pair: 'LTCUSDT', isCrypto: true },
              { symbol: 'AVAX', name: 'Avalanche', exchange: 'BINANCE', pair: 'AVAXUSDT', isCrypto: true },
              { symbol: 'LINK', name: 'Chainlink', exchange: 'BINANCE', pair: 'LINKUSDT', isCrypto: true },
              { symbol: 'ATOM', name: 'Cosmos', exchange: 'BINANCE', pair: 'ATOMUSDT', isCrypto: true },
              { symbol: 'UNI', name: 'Uniswap', exchange: 'BINANCE', pair: 'UNIUSDT', isCrypto: true },
              { symbol: 'XLM', name: 'Stellar', exchange: 'BINANCE', pair: 'XLMUSDT', isCrypto: true },
              { symbol: 'SHIB', name: 'Shiba Inu', exchange: 'BINANCE', pair: 'SHIBUSDT', isCrypto: true },
              { symbol: 'TRX', name: 'Tron', exchange: 'BINANCE', pair: 'TRXUSDT', isCrypto: true },
              { symbol: 'ETC', name: 'Ethereum Classic', exchange: 'BINANCE', pair: 'ETCUSDT', isCrypto: true },
              { symbol: 'XMR', name: 'Monero', exchange: 'BINANCE', pair: 'XMRUSDT', isCrypto: true },
              { symbol: 'APT', name: 'Aptos', exchange: 'BINANCE', pair: 'APTUSDT', isCrypto: true },
            ];
            const searchLower = debouncedSearch.toLowerCase();
            const filtered = cryptoList.filter(c => 
              c.symbol.toLowerCase().includes(searchLower) || 
              c.name.toLowerCase().includes(searchLower)
            );
            setSearchResults(filtered);
            setClosedSearchResults([]);
          } else {
            // Regular trading search - search only within the active segment
            // Map segment to exchange/instrumentType for API filtering
            let segmentFilter = '';
            if (activeSegment && activeSegment !== 'FAVORITES') {
              segmentFilter = `&segment=${encodeURIComponent(activeSegment)}`;
            }
            
            const { data } = await axios.get(
              `/api/instruments/user?search=${encodeURIComponent(debouncedSearch)}${segmentFilter}`,
              { headers }
            );
            // Filter out crypto results from regular search
            const nonCryptoResults = (data || []).filter(item => !item.isCrypto && item.exchange !== 'BINANCE');
            setSearchResults(nonCryptoResults.slice(0, 500)); // Limit display to 500 for performance
            if (user?.token) {
              try {
                const { data: closed } = await axios.get(
                  `/api/instruments/client/closed-search?search=${encodeURIComponent(debouncedSearch)}${segmentFilter}`,
                  { headers }
                );
                setClosedSearchResults(Array.isArray(closed) ? closed : []);
              } catch {
                setClosedSearchResults([]);
              }
            } else {
              setClosedSearchResults([]);
            }
          }
        } catch (error) {
          console.error('Search error:', error);
          setSearchResults([]);
          setClosedSearchResults([]);
        }
        setIsSearching(false);
      } else {
        setSearchResults([]);
        setClosedSearchResults([]);
        setShowSearchResults(false);
      }
    };
    doSearch();
  }, [debouncedSearch, user?.token, cryptoOnly, forexOnly, activeSegment, instrumentSearchTick]);

  // Fetch crypto data (separate from Zerodha)
  useEffect(() => {
    fetchCryptoData();
    const interval = setInterval(fetchCryptoData, 30000); // Every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchCryptoData = async () => {
    try {
      const { data } = await axios.get('/api/binance/prices');
      if (data && typeof data === 'object') {
        setCryptoData(data);
        if (typeof mergeMarketDataPatch === 'function') {
          mergeMarketDataPatch(data);
        }
      }
    } catch (error) {
      console.warn(
        'Crypto REST prices unavailable:',
        error.response?.data?.message || error.message,
      );
    }
  };

  // Get price for an instrument
  const getPrice = (token, pair, instrument) => {
    const pairKey = pair ? String(pair).toUpperCase() : '';
    if (pairKey && marketData[pairKey]) return marketData[pairKey];
    if (pair && cryptoData[pair]) return cryptoData[pair];
    if (token != null && token !== '') {
      const s = String(token);
      if (marketData[s]) return marketData[s];
      const n = parseInt(s, 10);
      if (!Number.isNaN(n) && marketData[n]) return marketData[n];
    }
    const fallbackLtp = Number(
      instrument?.ltp ??
      instrument?.lastPrice ??
      instrument?.close ??
      instrument?.previousClose ??
      0
    );
    if (Number.isFinite(fallbackLtp) && fallbackLtp > 0) {
      return { ltp: fallbackLtp, close: fallbackLtp, change: 0, changePercent: 0 };
    }
    return { ltp: 0, change: 0, changePercent: 0 };
  };

  // Get segment from exchange and instrument type automatically
  const getSegmentFromExchange = (exchange, instrumentType) => {
    if (exchange === 'MCX') {
      return instrumentType === 'OPTIONS' ? 'MCXOPT' : 'MCXFUT';
    }
    if (exchange === 'NFO') {
      return instrumentType === 'OPTIONS' ? 'NSEOPT' : 'NSEFUT';
    }
    if (exchange === 'BFO') {
      return instrumentType === 'OPTIONS' ? 'BSE-OPT' : 'BSE-FUT';
    }
    if (exchange === 'NSE') return 'NSE-EQ';
    if (exchange === 'BINANCE') {
      return instrumentType === 'OPTIONS' ? 'CRYPTOOPT' : instrumentType === 'FUTURES' ? 'CRYPTOFUT' : 'CRYPTO';
    }
    if (exchange === 'FOREX') {
      return instrumentType === 'OPTIONS' ? 'FOREXOPT' : 'FOREXFUT';
    }
    return 'NSEFUT';
  };

  // Add instrument to watchlist - auto-detect segment from exchange
  const addToWatchlist = async (instrument) => {
    const segment = instrument.isForex || instrument.exchange === 'FOREX'
      ? forexWatchlistSegmentFromInstrument(instrument)
      : instrument.isCrypto
        ? (instrument.displaySegment || getSegmentFromExchange(instrument.exchange, instrument.instrumentType))
        : getSegmentFromExchange(instrument.exchange, instrument.instrumentType);
    const currentList = watchlistBySegment[segment] || [];
    const identifier = watchlistInstrumentKey(instrument);
    if (currentList.some(i => watchlistInstrumentKey(i) === identifier)) return;
    
    // Update local state immediately
    setWatchlistBySegment(prev => {
      const newState = {
        ...prev,
        [segment]: [...(prev[segment] || []), instrument]
      };
      console.log('New watchlist state for', segment, ':', newState[segment].length, 'items');
      return newState;
    });
    setAddingToSegment(null);
    setSearchTerm('');
    setShowSearchResults(false);
    
    // Save to server
    if (user?.token) {
      try {
        const headers = { Authorization: `Bearer ${user.token}` };
        await axios.post('/api/instruments/watchlist/add', { instrument, segment }, { headers });
      } catch (error) {
        console.error('Error saving to watchlist:', error);
      }
    }
  };

  // Remove instrument from watchlist
  const removeFromWatchlist = async (instrument, segment) => {
    const identifier = watchlistInstrumentKey(instrument);
    setWatchlistBySegment(prev => ({
      ...prev,
      [segment]: (prev[segment] || []).filter(i => watchlistInstrumentKey(i) !== identifier)
    }));
    
    // Save to server
    if (user?.token) {
      try {
        const headers = { Authorization: `Bearer ${user.token}` };
        await axios.post('/api/instruments/watchlist/remove', { token: instrument.token, pair: instrument.pair, segment }, { headers });
      } catch (error) {
        console.error('Error removing from watchlist:', error);
      }
    }
  };

  const isInWatchlist = (instrument) => {
    const identifier = watchlistInstrumentKey(instrument);
    if (!identifier) return false;
    return Object.values(watchlistBySegment).some(list =>
      list.some(i => watchlistInstrumentKey(i) === identifier)
    );
  };

  const requestClientInstrumentAccess = async (inst) => {
    if (!user?.token || !inst?.token) return;
    setRequestingToken(String(inst.token));
    try {
      const headers = { Authorization: `Bearer ${user.token}` };
      await axios.post(
        '/api/instruments/client/request-open',
        { token: String(inst.token), duration: clientOpenDuration },
        { headers }
      );
      setClosedSearchResults((prev) => prev.filter((x) => String(x.token) !== String(inst.token)));
      setInstrumentSearchTick((t) => t + 1);
    } catch (error) {
      alert(error.response?.data?.message || error.message || 'Request failed');
    } finally {
      setRequestingToken(null);
    }
  };

  // Helper to check if instrument is MCX
  const isInstrumentMcx = (inst) => {
    const exchange = inst?.exchange?.toUpperCase() || '';
    const segment = inst?.segment?.toUpperCase() || '';
    return exchange === 'MCX' || segment === 'MCX' || segment === 'MCXFUT' || segment === 'MCXOPT';
  };

  // Get watchlist for current segment - filter favorites by mode
  const getWatchlistForSegment = () => {
    if (forexOnly || activeSegment === 'FOREXFUT' || activeSegment === 'FOREXOPT') {
      const key = activeSegment === 'FOREXOPT' ? 'FOREXOPT' : 'FOREXFUT';
      return watchlistBySegment[key] || [];
    }
    if (cryptoOnly || activeSegment === 'CRYPTO' || activeSegment === 'CRYPTOFUT' || activeSegment === 'CRYPTOOPT') {
      const key = activeSegment === 'CRYPTOFUT' ? 'CRYPTOFUT' : activeSegment === 'CRYPTOOPT' ? 'CRYPTOOPT' : 'CRYPTO';
      return watchlistBySegment[key] || [];
    }
    
    // For FAVORITES segment, filter based on mode
    if (activeSegment === 'FAVORITES') {
      const allFavorites = watchlistBySegment['FAVORITES'] || [];
      if (mcxOnly) {
        // MCX mode: only show MCX instruments in favorites
        return allFavorites.filter(inst => isInstrumentMcx(inst));
      } else {
        // Regular mode: only show non-MCX instruments in favorites
        return allFavorites.filter(inst => !isInstrumentMcx(inst));
      }
    }
    
    const list = watchlistBySegment[activeSegment] || [];
    return list;
  };

  // Get count for segment tab - filter favorites count by mode
  const getSegmentCount = (segmentId) => {
    if (segmentId === 'FAVORITES') {
      const allFavorites = watchlistBySegment['FAVORITES'] || [];
      if (mcxOnly) {
        return allFavorites.filter(inst => isInstrumentMcx(inst)).length;
      } else {
        return allFavorites.filter(inst => !isInstrumentMcx(inst)).length;
      }
    }
    return (watchlistBySegment[segmentId] || []).length;
  };

  return (
    <aside className="w-full h-full bg-dark-800 border-r border-dark-600 flex flex-col">
      {/* Market Status Indicator */}
      <div className="px-3 py-2 border-b border-dark-600 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${marketStatus.connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
          <span className={marketStatus.connected ? 'text-green-400' : 'text-red-400'}>
            {marketStatus.connected ? 'Live' : 'Offline'}
          </span>
        </div>
        {marketStatus.connected && marketStatus.lastUpdate && (
          <span className="text-gray-500">
            {new Date(marketStatus.lastUpdate).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Segment Tabs - Like screenshot */}
      <div className="flex flex-wrap gap-1 p-2 border-b border-dark-600">
        {segmentTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => handleSegmentChange(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded transition ${
              activeSegment === tab.id 
                ? 'bg-green-600 text-white' 
                : 'bg-dark-700 text-gray-400 hover:bg-dark-600 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="p-2 border-b border-dark-600">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search symbols..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="instruments-panel-search w-full bg-dark-700 border border-dark-600 rounded pl-9 pr-8 py-2 text-sm focus:outline-none focus:border-green-500"
          />
          {searchTerm && (
            <button 
              onClick={() => { setSearchTerm(''); searchInputRef.current?.focus(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Search Results or Watchlist */}
      <div className="flex-1 overflow-y-auto">
        {/* Search Results - Show when searching */}
        {showSearchResults &&
        searchTerm.length >=
        (activeSegment === 'CRYPTOFUT' ||
        activeSegment === 'CRYPTOOPT' ||
        activeSegment === 'FOREXFUT' ||
        activeSegment === 'FOREXOPT'
          ? 1
          : 2) ? (
          <div>
            <div className="px-3 py-2 text-xs text-gray-400 bg-dark-700 sticky top-0 z-10 flex justify-between items-center">
              <span>Search Results ({searchResults.length})</span>
              <button 
                onClick={() => { setSearchTerm(''); setShowSearchResults(false); }}
                className="text-green-400 hover:text-green-300"
              >
                Back to Watchlist
              </button>
            </div>
            
            {isSearching ? (
              <div className="p-4 text-center text-gray-400">
                <RefreshCw className="animate-spin inline mr-2" size={16} />
                Searching...
              </div>
            ) : searchResults.length === 0 && closedSearchResults.length === 0 ? (
              <div className="p-4 text-center text-gray-500 text-sm">
                No instruments found for "{searchTerm}"
              </div>
            ) : (
              <>
                {searchResults.map((inst) => {
                  // GET /instruments/user includes broker-forced-close rows (isEnabled false + adminLockedClosed); no trade until Super Admin "List trading" on
                  const cannotTradeSearchRow = inst.isEnabled !== true;
                  return (
                  <div
                    key={inst._id || inst.token}
                    className="flex items-center justify-between px-3 py-2.5 border-b border-dark-700 hover:bg-dark-750"
                  >
                    <div className="flex-1 min-w-0 mr-2">
                      <div className="font-bold text-sm text-white uppercase">{inst.tradingSymbol || inst.symbol}</div>
                      <div className="text-xs text-gray-500 truncate">{inst.category || inst.name} • {inst.exchange}</div>
                      {cannotTradeSearchRow && (
                        <div className="text-[10px] text-amber-300/95 mt-0.5">
                          Closed by broker — Super Admin must turn &quot;List trading&quot; on for clients to trade
                        </div>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => isInFavorites(inst) ? removeFromFavorites(inst) : addToFavorites(inst)}
                        disabled={cannotTradeSearchRow}
                        className={`w-7 h-7 rounded-full flex items-center justify-center disabled:opacity-40 disabled:pointer-events-none ${isInFavorites(inst) ? 'bg-yellow-400 text-black' : 'bg-dark-600 text-gray-300 hover:bg-yellow-500 hover:text-black'}`}
                        title={
                          cannotTradeSearchRow
                            ? 'Not available — closed by administrator'
                            : isInFavorites(inst)
                              ? 'Remove from Favorites'
                              : 'Add to Favorites'
                        }
                      >
                        <Star size={14} />
                      </button>
                      {/* Add to Watchlist Button - Auto adds to correct segment */}
                      {cannotTradeSearchRow ? (
                        <span className="text-xs text-amber-200/85 px-2 py-1">—</span>
                      ) : isInWatchlist(inst) ? (
                        <span className="text-xs text-green-400 px-2 py-1">✓ Added</span>
                      ) : (
                        <button
                          onClick={() => addToWatchlist(inst)}
                          className="flex items-center gap-1 bg-green-600 hover:bg-green-500 text-white text-xs px-2 py-1 rounded"
                        >
                          <Plus size={12} /> Add
                        </button>
                      )}
                    </div>
                  </div>
                  );
                })}
                {closedSearchResults.length > 0 && (
                  <div className="border-t border-amber-600/40">
                    <div className="px-3 py-2 text-xs text-amber-200/90 bg-dark-750">
                      Closed scripts — request temporary access (auto-closes after the period unless Super Admin opened them)
                    </div>
                    <div className="px-3 py-2 flex flex-wrap items-center gap-2 text-xs text-gray-400 border-b border-dark-700">
                      <span>Duration:</span>
                      <select
                        value={clientOpenDuration}
                        onChange={(e) => setClientOpenDuration(e.target.value)}
                        className="bg-dark-700 border border-dark-600 rounded px-2 py-1 text-gray-200"
                      >
                        <option value="1d">1 day</option>
                        <option value="7d">7 days</option>
                        <option value="30d">30 days</option>
                        <option value="90d">90 days</option>
                      </select>
                    </div>
                    {closedSearchResults.map((inst) => (
                      <div
                        key={inst._id || inst.token}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 border-b border-dark-700 hover:bg-dark-750"
                      >
                        <div className="flex-1 min-w-0 mr-2">
                          <div className="font-bold text-sm text-amber-200/90 uppercase">{inst.tradingSymbol || inst.symbol}</div>
                          <div className="text-xs text-gray-500 truncate">{inst.category || inst.name} • {inst.exchange}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => requestClientInstrumentAccess(inst)}
                          disabled={requestingToken === String(inst.token)}
                          className="text-xs px-2 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white disabled:opacity-50"
                        >
                          {requestingToken === String(inst.token) ? '…' : 'Request access'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          /* Watchlist for Current Segment */
          <div>
            <div className="px-3 py-2 text-xs text-gray-400 bg-dark-700 sticky top-0 z-10">
              {activeSegment === 'CRYPTO'
                ? '₿ Spot'
                : activeSegment === 'CRYPTOFUT'
                  ? 'Crypto Futures'
                  : activeSegment === 'CRYPTOOPT'
                    ? 'Crypto Options'
                    : activeSegment === 'FOREXFUT'
                      ? 'Forex Fut'
                      : activeSegment === 'FOREXOPT'
                        ? 'Forex Opt'
                        : activeSegment}{' '}
              Watchlist ({getSegmentCount(activeSegment)})
            </div>
            
            {/* Show default crypto list when in crypto mode and watchlist is empty */}
            {cryptoOnly && activeSegment === 'CRYPTO' && getWatchlistForSegment().length === 0 ? (
              <div>
                <div className="px-3 py-2 text-xs text-orange-400 bg-dark-750">
                  Popular Cryptocurrencies - Click to add to watchlist
                </div>
                {[
                  { symbol: 'BTC', name: 'Bitcoin', exchange: 'BINANCE', pair: 'BTCUSDT', isCrypto: true },
                  { symbol: 'ETH', name: 'Ethereum', exchange: 'BINANCE', pair: 'ETHUSDT', isCrypto: true },
                  { symbol: 'BNB', name: 'Binance Coin', exchange: 'BINANCE', pair: 'BNBUSDT', isCrypto: true },
                  { symbol: 'XRP', name: 'Ripple', exchange: 'BINANCE', pair: 'XRPUSDT', isCrypto: true },
                  { symbol: 'SOL', name: 'Solana', exchange: 'BINANCE', pair: 'SOLUSDT', isCrypto: true },
                  { symbol: 'DOGE', name: 'Dogecoin', exchange: 'BINANCE', pair: 'DOGEUSDT', isCrypto: true },
                  { symbol: 'ADA', name: 'Cardano', exchange: 'BINANCE', pair: 'ADAUSDT', isCrypto: true },
                  { symbol: 'POL', name: 'Polygon', exchange: 'BINANCE', pair: 'POLUSDT', isCrypto: true },
                  { symbol: 'LTC', name: 'Litecoin', exchange: 'BINANCE', pair: 'LTCUSDT', isCrypto: true },
                  { symbol: 'AVAX', name: 'Avalanche', exchange: 'BINANCE', pair: 'AVAXUSDT', isCrypto: true },
                ].map(crypto => {
                  const priceData = cryptoData[crypto.pair] || marketData[crypto.pair] || { ltp: 0, changePercent: 0 };
                  return (
                    <div
                      key={crypto.pair}
                      className="flex items-center justify-between px-3 py-2.5 border-b border-dark-700 hover:bg-dark-750"
                    >
                      <div className="flex-1 min-w-0 mr-2">
                        <div className="font-bold text-sm text-orange-400">{crypto.symbol}</div>
                        <div className="text-xs text-gray-500">{crypto.name}</div>
                      </div>
                      <div className="text-right mr-2">
                        <div className="text-sm font-medium text-gray-300">
                          {`$${spotQuoteDisplayPrice(
                            { ...crypto, segment: 'CRYPTO' },
                            priceData.ltp || 0,
                            usdRate
                          ).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                        </div>
                        <div className={`text-xs ${parseFloat(priceData.changePercent || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {parseFloat(priceData.changePercent || 0) >= 0 ? '+' : ''}{parseFloat(priceData.changePercent || 0).toFixed(2)}%
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => addToWatchlist(crypto)}
                          className="flex items-center gap-1 bg-green-600 hover:bg-green-500 text-white text-xs px-2 py-1 rounded"
                        >
                          <Plus size={12} /> Add
                        </button>
                        <button
                          onClick={() => onBuySell('sell', crypto)}
                          className="w-7 h-7 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center text-white text-xs font-bold"
                        >
                          S
                        </button>
                        <button
                          onClick={() => onBuySell('buy', crypto)}
                          className="w-7 h-7 rounded-full bg-green-500 hover:bg-green-400 flex items-center justify-center text-white text-xs font-bold"
                        >
                          B
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (activeSegment === 'CRYPTOFUT' ||
              activeSegment === 'CRYPTOOPT' ||
              activeSegment === 'FOREXFUT' ||
              activeSegment === 'FOREXOPT') &&
              getWatchlistForSegment().length === 0 ? (
              <div>
                <div className="px-3 py-2 text-xs text-yellow-400 bg-dark-750">
                  {activeSegment === 'CRYPTOFUT'
                    ? 'USDT-M perpetuals — tap + Add to watchlist (search to narrow)'
                    : activeSegment === 'CRYPTOOPT'
                      ? 'Crypto options — tap + Add to watchlist (search to narrow)'
                      : activeSegment === 'FOREXOPT'
                        ? 'Forex options — tap + Add to watchlist (search to narrow)'
                        : 'Forex futures / spot — tap + Add to watchlist (search to narrow)'}
                </div>
                {cryptoDerivBrowseLoading ? (
                  <div className="p-4 text-center text-gray-400 text-sm">
                    <RefreshCw className="animate-spin inline mr-2" size={16} />
                    Loading instruments…
                  </div>
                ) : cryptoDerivBrowseList.length === 0 ? (
                  <div className="p-4 text-center text-gray-500 text-sm">
                    No contracts available. Try again in a moment, or contact support if this persists.
                  </div>
                ) : (
                  cryptoDerivBrowseList.map((inst) => {
                    const priceData = getPrice(inst.token, inst.pair, inst);
                    const pxUsd = Number(priceData.ltp || inst.ltp || 0);
                    const displayLtp = spotPxToDisplayedInr(inst, pxUsd, usdRate);
                    const rowKey = inst.token || inst._id;
                    return (
                      <div
                        key={rowKey}
                        className="flex items-center justify-between px-3 py-2.5 border-b border-dark-700 hover:bg-dark-750"
                      >
                        <div className="flex-1 min-w-0 mr-2">
                          <div className={`font-bold text-sm uppercase truncate ${inst.instrumentType === 'FUTURES' ? 'text-yellow-400' : inst.optionType === 'CE' ? 'text-green-400' : inst.optionType === 'PE' ? 'text-red-400' : 'text-white'}`}>
                            {inst.tradingSymbol || inst.symbol}
                          </div>
                          <div className="text-xs text-gray-500 truncate">{inst.name} • Lot {inst.lotSize ?? '—'}</div>
                        </div>
                        <div className="text-right mr-2 shrink-0">
                          <div className="text-sm font-medium text-gray-300">
                            ₹{displayLtp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {isInWatchlist(inst) ? (
                            <span className="text-xs text-green-400 px-1">✓</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => addToWatchlist(inst)}
                              className="flex items-center gap-1 bg-green-600 hover:bg-green-500 text-white text-xs px-2 py-1 rounded"
                            >
                              <Plus size={12} /> Add
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onBuySell('sell', inst)}
                            className="w-7 h-7 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center text-white text-xs font-bold"
                          >
                            S
                          </button>
                          <button
                            type="button"
                            onClick={() => onBuySell('buy', inst)}
                            className="w-7 h-7 rounded-full bg-green-500 hover:bg-green-400 flex items-center justify-center text-white text-xs font-bold"
                          >
                            B
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            ) : activeSegment === 'FOREXFUT' && getWatchlistForSegment().length === 0 ? (
              <div>
                <div className="px-3 py-2 text-xs text-cyan-400 bg-dark-750">
                  Major FX pairs — click Add, then trade (fund Forex wallet from Main)
                </div>
                {DEFAULT_FOREX_INSTRUMENTS.map((fx) => {
                  const priceData = getPrice(fx.token, fx.pair, fx);
                  const ltpUsd = priceData.ltp || 0;
                  return (
                    <div
                      key={fx.pair}
                      className="flex items-center justify-between px-3 py-2.5 border-b border-dark-700 hover:bg-dark-750"
                    >
                      <div className="min-w-0 mr-2">
                        <div className="font-bold text-sm text-cyan-400">{fx.symbol}</div>
                        <div className="text-xs text-gray-500 truncate">{fx.name}</div>
                      </div>
                      <div className="text-right mr-2">
                        <div className="text-sm font-medium text-gray-300">
                          ₹{spotPxToDisplayedInr(fx, ltpUsd, usdRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => addToWatchlist(fx)}
                          className="flex items-center gap-1 bg-green-600 hover:bg-green-500 text-white text-xs px-2 py-1 rounded"
                        >
                          <Plus size={12} /> Add
                        </button>
                        <button
                          onClick={() => onBuySell('sell', fx)}
                          className="w-7 h-7 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center text-white text-xs font-bold"
                        >
                          S
                        </button>
                        <button
                          onClick={() => onBuySell('buy', fx)}
                          className="w-7 h-7 rounded-full bg-green-500 hover:bg-green-400 flex items-center justify-center text-white text-xs font-bold"
                        >
                          B
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : getWatchlistForSegment().length === 0 ? (
              <div className="p-4 text-center text-gray-500 text-sm">
                <p>No instruments in {activeSegment} watchlist</p>
                <p className="mt-2 text-xs text-gray-600">
                  Search for instruments and add them to your watchlist
                </p>
              </div>
            ) : (
              getWatchlistForSegment().map(inst => {
                const priceData = getPrice(inst.token, inst.pair, inst);
                const pxUsd = priceData.ltp || inst.ltp || 0;
                const displayLtp = isUsdSpotInstrument(inst)
                  ? spotQuoteDisplayPrice(inst, pxUsd, usdRate)
                  : (inst.isCrypto || inst.isForex)
                    ? spotPxToDisplayedInr(inst, pxUsd, usdRate)
                    : pxUsd;
                const rowKey = inst.token || inst.pair || inst.symbol;
                const isSel = watchlistInstrumentKey(selectedInstrument) === watchlistInstrumentKey(inst);
                return (
                  <div
                    key={rowKey}
                    onClick={() => onSelectInstrument({...inst, ltp: priceData.ltp || inst.ltp || 0})}
                    className={`flex flex-col px-3 py-2.5 cursor-pointer border-b border-dark-700 hover:bg-dark-750 ${
                      isSel ? 'bg-green-600/20 border-l-2 border-l-green-500' : ''
                    }`}
                  >
                    {/* Top row: Symbol and Price */}
                    <div className="flex items-center justify-between w-full">
                      <div className={`font-bold text-sm uppercase truncate max-w-[120px] ${
                        inst.instrumentType === 'FUTURES' ? 'text-yellow-400' :
                        inst.optionType === 'CE' ? 'text-green-400' :
                        inst.optionType === 'PE' ? 'text-red-400' :
                        inst.isCrypto ? 'text-orange-400' : inst.isForex ? 'text-cyan-400' : 'text-white'
                      }`}>
                        {inst.tradingSymbol || inst.symbol?.replace(/"/g, '') || inst.symbol}
                      </div>
                      <div className="text-sm font-medium text-gray-300 ml-2">
                        {isUsdSpotInstrument(inst)
                          ? `${isForexInstrument(inst) ? '₹' : '$'}${
                              displayLtp != null && !isNaN(displayLtp)
                                ? displayLtp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                : '--'
                            }`
                          : (inst.isCrypto || inst.isForex)
                            ? `₹${displayLtp != null && !isNaN(displayLtp) ? displayLtp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--'}`
                            : displayLtp != null && !isNaN(displayLtp)
                              ? displayLtp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                              : '--'}
                      </div>
                    </div>
                    
                    {/* Bottom row: Category, Expiry, Change %, and Buttons */}
                    <div className="flex items-center justify-between w-full mt-1">
                      <div className="flex items-center gap-2">
                        <div className="text-xs text-gray-500 truncate max-w-[80px]">{inst.category || inst.name}</div>
                        {/* Show expiry for Futures and Options - extract from symbol if expiry field not available */}
                        {(() => {
                          // Check if it's F&O based on segment, instrumentType, or active tab
                          const isFnO = inst.instrumentType === 'FUTURES' || inst.instrumentType === 'OPTIONS' || 
                                        inst.segment === 'FNO' || inst.segment === 'NSEFUT' || inst.segment === 'NSEOPT' ||
                                        inst.segment === 'MCXFUT' || inst.segment === 'MCXOPT' ||
                                        inst.displaySegment === 'NSEFUT' || inst.displaySegment === 'NSEOPT' ||
                                        activeSegment === 'NSEFUT' || activeSegment === 'NSEOPT' ||
                                        activeSegment === 'BSE-FUT' || activeSegment === 'BSE-OPT' ||
                                        activeSegment === 'MCXFUT' || activeSegment === 'MCXOPT';
                          
                          // Use backend expiry only. Symbol text like BANKNIFTY26APR... can encode year+month,
                          // and parsing it as day+month causes wrong labels such as "26 APR" instead of "28 APR".
                          let expiryDisplay = null;
                          if (inst.expiry) {
                            expiryDisplay = new Date(inst.expiry).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
                          }
                          
                          // If in F&O segment but no expiry found, show "F&O" badge
                          if (!expiryDisplay && isFnO) {
                            expiryDisplay = 'F&O';
                          }
                          if (!expiryDisplay) return null;
                          
                          return (
                            <span className="text-[10px] px-1 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">
                              {expiryDisplay}
                            </span>
                          );
                        })()}
                        <div className={`text-xs ${parseFloat(priceData.changePercent || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {parseFloat(priceData.changePercent || 0) >= 0 ? '+' : ''}{parseFloat(priceData.changePercent || 0).toFixed(2)}%
                        </div>
                      </div>
                      
                      {/* Action Buttons */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); isInFavorites(inst) ? removeFromFavorites(inst) : addToFavorites(inst); }}
                          className={`w-7 h-7 rounded-full flex items-center justify-center ${isInFavorites(inst) ? 'bg-yellow-400 text-black' : 'bg-dark-600 text-gray-300 hover:bg-yellow-500 hover:text-black'}`}
                          title={isInFavorites(inst) ? 'Remove from Favorites' : 'Add to Favorites'}
                        >
                          <Star size={12} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); onBuySell('sell', inst); }}
                          className="w-7 h-7 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center text-white text-xs font-bold"
                        >
                          S
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); onBuySell('buy', inst); }}
                          className="w-7 h-7 rounded-full bg-green-500 hover:bg-green-400 flex items-center justify-center text-white text-xs font-bold"
                        >
                          B
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeFromWatchlist(inst, activeSegment); }}
                          className="w-7 h-7 rounded-full bg-dark-600 hover:bg-red-600 flex items-center justify-center text-gray-400 hover:text-white"
                          title="Remove from watchlist"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </aside>
  );
};

const InstrumentRow = ({ instrument, isSelected, onSelect, isCall, isPut, isFuture, isCrypto, isDemo, onBuySell, inWatchlist, onRemoveFromWatchlist, onAddToWatchlist }) => {
  // Determine symbol color based on type
  const getSymbolColor = () => {
    if (isDemo) return 'text-purple-400';
    if (isCrypto) return 'text-orange-400';
    if (isCall || instrument.optionType === 'CE') return 'text-green-400';
    if (isPut || instrument.optionType === 'PE') return 'text-red-400';
    if (isFuture || instrument.instrumentType === 'FUTURES') return 'text-yellow-400';
    return 'text-white';
  };

  // Format price - use $ for crypto, ₹ for others
  const formatPrice = (price) => {
    if (!price || price <= 0) return '-';
    if (isCrypto || instrument.isCrypto) return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const changePercent = parseFloat(instrument.changePercent) || 0;
  const isPositive = changePercent >= 0;

  return (
    <div
      onClick={onSelect}
      className={`flex items-center justify-between px-3 py-2.5 cursor-pointer border-b border-dark-700 ${
        isSelected 
          ? 'bg-green-600/20 border-l-2 border-l-green-500' 
          : 'hover:bg-dark-750'
      }`}
    >
      {/* Left: Symbol and Name */}
      <div className="flex-1 min-w-0 mr-2">
        <div className={`font-bold text-sm uppercase ${isSelected ? 'text-green-400' : getSymbolColor()}`}>
          {instrument.symbol}
        </div>
        <div className="text-xs text-gray-500 truncate flex items-center gap-1">
          <span>{instrument.name || instrument.symbol}</span>
          {/* Show expiry for Futures and Options */}
          {(instrument.instrumentType === 'FUTURES' || instrument.instrumentType === 'OPTIONS') && instrument.expiry && (
            <span className="text-[10px] px-1 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">
              {instrument.expiry}
            </span>
          )}
        </div>
      </div>
      
      {/* Center: Price and Change */}
      <div className="text-right flex-shrink-0 mr-2">
        <div className="text-sm font-medium text-gray-300">
          {formatPrice(instrument.ltp) || '-'}
        </div>
        <div className={`text-xs font-medium ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
          {changePercent !== 0 ? `${isPositive ? '+' : ''}${changePercent.toFixed(2)}%` : '+0.00%'}
        </div>
      </div>

      {/* Right: B/S Circle Buttons */}
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <button 
          onClick={() => onBuySell('sell', instrument)}
          className="w-7 h-7 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center text-xs font-bold transition-colors"
          title="Sell"
        >
          S
        </button>
        <button 
          onClick={() => onBuySell('buy', instrument)}
          className="w-7 h-7 rounded-full bg-green-600 hover:bg-green-700 flex items-center justify-center text-xs font-bold transition-colors"
          title="Buy"
        >
          B
        </button>
      </div>
    </div>
  );
};

const ChartPanel = ({ selectedInstrument, marketData, sidebarOpen, usdRate = 83.5, onChartLtp }) => {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const candlestickSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const [chartInterval, setChartInterval] = useState('FIFTEEN_MINUTE');
  const [loading, setLoading] = useState(false);
  const [livePrice, setLivePrice] = useState(null);
  const [fallbackPrice, setFallbackPrice] = useState(null);
  const lastCandleRef = useRef(null);

  const chartInstrumentKey = selectedInstrument
    ? selectedInstrument.isCrypto || selectedInstrument.exchange === 'BINANCE'
      ? binanceCandleSymbol(selectedInstrument)
      : isForexInstrument(selectedInstrument)
        ? String(selectedInstrument.pair || selectedInstrument.symbol || '')
        : String(selectedInstrument.token || selectedInstrument.symbol || '')
    : '';

  // Changing instrument or timeframe leaves old last-bar times on the series until new history loads.
  // Live tick updates must not run with a new bucket size against old bars (lightweight-charts: "Cannot update oldest data").
  useEffect(() => {
    lastCandleRef.current = null;
  }, [chartInterval, chartInstrumentKey]);

  // Resize chart when sidebar opens/closes
  useEffect(() => {
    if (chartRef.current && chartContainerRef.current) {
      const timer = setTimeout(() => {
        if (chartRef.current && chartContainerRef.current) {
          chartRef.current.applyOptions({
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
          });
        }
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [sidebarOpen]);

  const tokenKeyForTick =
    selectedInstrument?.token != null && String(selectedInstrument.token) !== ''
      ? String(selectedInstrument.token)
      : '';
  const tickForChart =
    tokenKeyForTick && !isUsdSpotInstrument(selectedInstrument)
      ? (marketData[tokenKeyForTick] ?? marketData[Number.parseInt(tokenKeyForTick, 10)])
      : null;
  const usdChartQuote =
    selectedInstrument && isUsdSpotInstrument(selectedInstrument)
      ? getCryptoMarketQuote(marketData, selectedInstrument)
      : null;

  // Update live price from marketData (Socket.IO) — deps narrow to this symbol’s slice so unrelated ticks do not re-run chart logic
  useEffect(() => {
    const isUsdSpot = isUsdSpotInstrument(selectedInstrument);
    let data = null;

    if (isUsdSpot) {
      data = usdChartQuote;
    } else if (tokenKeyForTick) {
      data = tickForChart;
    }

    if (data) {
      setLivePrice({
        ltp: data.ltp,
        open: data.open,
        high: data.high,
        low: data.low,
        close: data.close,
        change: data.change,
        changePercent: data.changePercent
      });
    } else if (selectedInstrument && !data) {
      // Fallback to instrument's last price when no live data is available
      setFallbackPrice({
        ltp: selectedInstrument.ltp || selectedInstrument.lastPrice || 0,
        open: selectedInstrument.open || selectedInstrument.ltp || 0,
        high: selectedInstrument.high || selectedInstrument.ltp || 0,
        low: selectedInstrument.low || selectedInstrument.ltp || 0,
        close: selectedInstrument.close || selectedInstrument.ltp || 0,
        change: selectedInstrument.change || 0,
        changePercent: selectedInstrument.changePercent || 0
      });
    }

    // Update the last candle in real-time (only when we have a tick and history is in sync)
    const candleSeries = candlestickSeriesRef.current;
    if (candleSeries && lastCandleRef.current && data?.ltp != null) {
      const rawLtp = Number(data.ltp);
      if (!Number.isFinite(rawLtp)) return;
      const pairU = String(selectedInstrument.pair || selectedInstrument.symbol || '').toUpperCase();
      const isUsdSpot = isUsdSpotInstrument(selectedInstrument);
      const ltp = isForexInstrument(selectedInstrument)
        ? rawLtp * forexInrDisplayFactor(pairU, usdRate)
        : isUsdSpotInstrument(selectedInstrument) && !isForexInstrument(selectedInstrument)
          ? rawLtp
          : isUsdSpot
            ? spotPxToDisplayedInr(selectedInstrument, rawLtp, usdRate)
            : rawLtp;
      const now = Math.floor(Date.now() / 1000);
      const intervalSeconds = getIntervalSeconds(chartInterval);
      const candleTime = Math.floor(now / intervalSeconds) * intervalSeconds;

      const lastTimeRaw = lastCandleRef.current.time;
      const lastTime =
        typeof lastTimeRaw === 'number' && Number.isFinite(lastTimeRaw)
          ? Math.floor(lastTimeRaw)
          : null;
      if (lastTime == null) return;

      // Never push/update a bar older than what the series already has (common right after timeframe switch)
      if (candleTime < lastTime) return;

      try {
        if (lastTime === candleTime) {
          const updatedCandle = {
            time: candleTime,
            open: lastCandleRef.current.open,
            high: Math.max(lastCandleRef.current.high, ltp),
            low: Math.min(lastCandleRef.current.low, ltp),
            close: ltp,
          };
          lastCandleRef.current = updatedCandle;
          candleSeries.update(updatedCandle);
        } else if (candleTime > lastTime) {
          const newCandle = {
            time: candleTime,
            open: ltp,
            high: ltp,
            low: ltp,
            close: ltp,
          };
          lastCandleRef.current = newCandle;
          candleSeries.update(newCandle);
        }
        const c = lastCandleRef.current?.close;
        if (Number.isFinite(Number(c)) && Number(c) > 0) onChartLtp?.(selectedInstrument?.token, Number(c));
      } catch (e) {
        console.warn('[ChartPanel] candle update skipped:', e?.message || e);
      }
    }
  }, [selectedInstrument, chartInterval, usdRate, onChartLtp, tokenKeyForTick, tickForChart, usdChartQuote]);

  const getIntervalSeconds = (interval) => {
    const map = {
      'ONE_MINUTE': 60,
      'FIVE_MINUTE': 300,
      'FIFTEEN_MINUTE': 900,
      'THIRTY_MINUTE': 1800,
      'ONE_HOUR': 3600,
      'ONE_DAY': 86400
    };
    return map[interval] || 900;
  };

  const getBinanceInterval = (interval) => {
    const map = {
      'ONE_MINUTE': '1m',
      'FIVE_MINUTE': '5m',
      'FIFTEEN_MINUTE': '15m',
      'THIRTY_MINUTE': '30m',
      'ONE_HOUR': '1h',
      'ONE_DAY': '1d'
    };
    return map[interval] || '15m';
  };

  // Fetch candle data from Zerodha or Binance ({ candles, nativeInr } — USDT OHLC; chart scales to ₹ for USD spot)
  const fetchCandleData = async (instrument, interval) => {
    if (!instrument) return null;

    try {
      setLoading(true);

      if (instrument.isCrypto || instrument.exchange === 'BINANCE') {
        const binanceInterval = getBinanceInterval(interval);
        // api.binance.com has no BASEINR klines; always USDT + scaleUsdSpotChartCandle in chart.
        const sym = binanceCandleSymbol(instrument);
        if (!sym) return null;
        const { data } = await axios.get(`/api/binance/candles/${encodeURIComponent(sym)}`, {
          params: { interval: binanceInterval, limit: 500 },
        });
        if (Array.isArray(data) && data.length > 0) {
          return { candles: data, nativeInr: false };
        }
        return null;
      }

      if (isForexInstrument(instrument)) {
        const pair = String(instrument.pair || instrument.symbol || '').toUpperCase();
        if (!pair) return null;
        const binanceInterval = getBinanceInterval(interval);
        const { data } = await axios.get(`/api/forex/candles/${encodeURIComponent(pair)}`, {
          params: { interval: binanceInterval, limit: 500 },
        });
        return Array.isArray(data) && data.length > 0 ? { candles: data, nativeInr: false } : null;
      }

      // Historical endpoint for arbitrary Zerodha/MCX token is not available in this app.
      // Keep chart stable without 404 spam; live socket ticks continue updating price panels.

      return null;
    } catch (error) {
      console.error('Failed to fetch candle data:', error);
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Initialize chart
  useEffect(() => {
    if (!selectedInstrument || !chartContainerRef.current) return;
    if (chartRef.current) return;
    
    const initTimer = setTimeout(() => {
      if (!chartContainerRef.current || chartRef.current) return;
      
      const containerWidth = chartContainerRef.current.clientWidth || 800;
      const containerHeight = chartContainerRef.current.clientHeight || 400;

      const chart = createChart(chartContainerRef.current, {
        width: containerWidth,
        height: containerHeight,
        layout: {
          background: { color: '#111111' },
          textColor: '#d1d5db',
        },
        grid: {
          vertLines: { color: '#1f1f1f' },
          horzLines: { color: '#1f1f1f' },
        },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: '#2a2a2a' },
        timeScale: {
          borderColor: '#2a2a2a',
          timeVisible: true,
          secondsVisible: false,
        },
      });

      chartRef.current = chart;

      candlestickSeriesRef.current = chart.addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderDownColor: '#ef4444',
        borderUpColor: '#22c55e',
        wickDownColor: '#ef4444',
        wickUpColor: '#22c55e',
      });

      volumeSeriesRef.current = chart.addHistogramSeries({
        color: '#26a69a',
        priceFormat: { type: 'volume' },
        priceScaleId: '',
      });

      chart.priceScale('').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });

      const handleResize = () => {
        if (chartContainerRef.current && chartRef.current) {
          chartRef.current.applyOptions({
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
          });
        }
      };

      window.addEventListener('resize', handleResize);
      setTimeout(handleResize, 100);
    }, 100);

    return () => clearTimeout(initTimer);
  }, [selectedInstrument]);
  
  // Cleanup chart on unmount
  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, []);

  // Load data when instrument or interval changes (wait for chart init — series is created in a 100ms timeout)
  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      if (!selectedInstrument) return;

      for (let i = 0; i < 40; i++) {
        if (cancelled) return;
        if (candlestickSeriesRef.current && volumeSeriesRef.current) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      if (cancelled || !candlestickSeriesRef.current || !volumeSeriesRef.current) return;

      const pack = await fetchCandleData(selectedInstrument, chartInterval);
      const rawCandles = pack?.candles;
      const nativeInr = pack?.nativeInr === true;
      if (rawCandles && Array.isArray(rawCandles) && rawCandles.length > 0) {
        // Validate, deduplicate, and sort candles by time
        const seenTimes = new Set();
        const candles = rawCandles
          .filter(c => {
            // Ensure time is a valid number
            const time = typeof c.time === 'number' ? c.time : Math.floor(new Date(c.time).getTime() / 1000);
            if (isNaN(time) || seenTimes.has(time)) return false;
            seenTimes.add(time);
            return true;
          })
          .map(c => ({
            time: typeof c.time === 'number' ? c.time : Math.floor(new Date(c.time).getTime() / 1000),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume || 0
          }))
          .sort((a, b) => a.time - b.time);
        
        if (candles.length > 0) {
          const pairU = String(selectedInstrument.pair || selectedInstrument.symbol || '').toUpperCase();
          const displayCandles = isForexInstrument(selectedInstrument)
            ? candles.map((c) => scaleForexChartCandle(c, usdRate, pairU))
            : isUsdSpotInstrument(selectedInstrument) && !nativeInr
              ? candles.map((c) => scaleUsdSpotChartCandle(c, selectedInstrument, usdRate))
              : candles;
          candlestickSeriesRef.current.setData(displayCandles);
          
          // Set last candle for real-time updates
          lastCandleRef.current = displayCandles[displayCandles.length - 1];
          const lastClose = displayCandles[displayCandles.length - 1]?.close;
          if (Number.isFinite(Number(lastClose)) && Number(lastClose) > 0) {
            onChartLtp?.(selectedInstrument?.token, Number(lastClose));
          }
          
          // Generate volume data
          const volumeData = displayCandles.map(c => ({
            time: c.time,
            value: c.volume || 0,
            color: c.close >= c.open ? '#22c55e80' : '#ef444480'
          }));
          volumeSeriesRef.current.setData(volumeData);
          
          chartRef.current?.timeScale().fitContent();
        }
      }
    };

    loadData();
    return () => {
      cancelled = true;
    };
  }, [selectedInstrument, chartInterval, usdRate, onChartLtp]);

  const intervals = [
    { label: '1m', value: 'ONE_MINUTE' },
    { label: '5m', value: 'FIVE_MINUTE' },
    { label: '15m', value: 'FIFTEEN_MINUTE' },
    { label: '30m', value: 'THIRTY_MINUTE' },
    { label: '1h', value: 'ONE_HOUR' },
    { label: '1D', value: 'ONE_DAY' },
  ];

  return (
    <div className="flex-1 flex flex-col bg-dark-800">
      {/* Chart Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-dark-600">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="font-medium">Chart</span>
            {loading && <RefreshCw size={14} className="animate-spin text-green-400" />}
          </div>
          {selectedInstrument && (
            <div className="flex items-center gap-3">
              <span className={`font-medium ${
                selectedInstrument.isCrypto || selectedInstrument.exchange === 'BINANCE'
                  ? 'text-orange-400'
                  : isForexInstrument(selectedInstrument)
                    ? 'text-cyan-400'
                    : 'text-green-400'
              }`}>
                {selectedInstrument.symbol}
              </span>
              <span className="text-gray-400 text-sm">{selectedInstrument.exchange}</span>
              {livePrice && (
                <>
                  <span className={`font-mono font-bold ${livePrice.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {isUsdSpotInstrument(selectedInstrument)
                      ? livePrice.ltp != null && !isNaN(livePrice.ltp)
                        ? `${isForexInstrument(selectedInstrument) ? '₹' : '$'}${spotQuoteDisplayPrice(selectedInstrument, livePrice.ltp || 0, usdRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : '--'
                      : livePrice.ltp != null && !isNaN(livePrice.ltp)
                        ? livePrice.ltp.toLocaleString(undefined, {})
                        : '--'}
                  </span>
                  <span className={`text-sm ${livePrice.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {livePrice.change >= 0 ? '+' : ''}{(parseFloat(livePrice.changePercent) || 0).toFixed(2)}%
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        
        {selectedInstrument && livePrice && (
          <div className="flex items-center gap-4 text-xs text-gray-400">
            {isUsdSpotInstrument(selectedInstrument) ? (
              <>
                <span>
                  O:{' '}
                  {`${isForexInstrument(selectedInstrument) ? '₹' : '$'}`}
                  {livePrice.open != null && !isNaN(livePrice.open)
                    ? spotQuoteDisplayPrice(selectedInstrument, livePrice.open || 0, usdRate).toLocaleString(undefined, { maximumFractionDigits: 2 })
                    : '--'}
                </span>
                <span>
                  H:{' '}
                  {`${isForexInstrument(selectedInstrument) ? '₹' : '$'}`}
                  {livePrice.high != null && !isNaN(livePrice.high)
                    ? spotQuoteDisplayPrice(selectedInstrument, livePrice.high || 0, usdRate).toLocaleString(undefined, { maximumFractionDigits: 2 })
                    : '--'}
                </span>
                <span>
                  L:{' '}
                  {`${isForexInstrument(selectedInstrument) ? '₹' : '$'}`}
                  {livePrice.low != null && !isNaN(livePrice.low)
                    ? spotQuoteDisplayPrice(selectedInstrument, livePrice.low || 0, usdRate).toLocaleString(undefined, { maximumFractionDigits: 2 })
                    : '--'}
                </span>
                <span>
                  C:{' '}
                  {`${isForexInstrument(selectedInstrument) ? '₹' : '$'}`}
                  {livePrice.close != null && !isNaN(livePrice.close)
                    ? spotQuoteDisplayPrice(selectedInstrument, livePrice.close || 0, usdRate).toLocaleString(undefined, { maximumFractionDigits: 2 })
                    : '--'}
                </span>
              </>
            ) : (
              <>
                <span>O: ₹{livePrice.open != null && !isNaN(livePrice.open) ? livePrice.open.toLocaleString() : '--'}</span>
                <span>H: ₹{livePrice.high != null && !isNaN(livePrice.high) ? livePrice.high.toLocaleString() : '--'}</span>
                <span>L: ₹{livePrice.low != null && !isNaN(livePrice.low) ? livePrice.low.toLocaleString() : '--'}</span>
                <span>C: ₹{livePrice.close != null && !isNaN(livePrice.close) ? livePrice.close.toLocaleString() : '--'}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Chart Area */}
      <div className="flex-1 relative min-h-[300px]">
        {!selectedInstrument ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
            <BarChart2 size={48} className="mb-4 opacity-30" />
            <p>Select an instrument to view chart</p>
          </div>
        ) : (
          <div ref={chartContainerRef} className="absolute inset-0" />
        )}
      </div>

      {/* Timeframe Selector */}
      {selectedInstrument && (
        <div className="flex items-center gap-2 px-4 py-2 border-t border-dark-600 text-sm">
          {intervals.map(tf => (
            <button
              key={tf.value}
              onClick={() => setChartInterval(tf.value)}
              className={`px-3 py-1 rounded ${chartInterval === tf.value ? 'bg-green-600 text-white' : 'hover:bg-dark-600 text-gray-400 hover:text-white'}`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const PositionsPanel = ({ activeTab, setActiveTab, walletData, user, marketData, refreshKey, selectedInstrument, onRefreshPositions, cryptoOnly = false, mcxOnly = false, forexOnly = false, usdRate = 83.5, setShowReferralModal }) => {
  const [positions, setPositions] = useState([]);
  const [pendingOrders, setPendingOrders] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [totalPnL, setTotalPnL] = useState(0);
  const [quickQty, setQuickQty] = useState('1');
  const [quickTrading, setQuickTrading] = useState(false);
  const [quickError, setQuickError] = useState('');

  useEffect(() => {
    if (user?.token) {
      fetchPositions();
      const interval = setInterval(fetchPositions, 2000); // Refresh every 2 seconds
      return () => clearInterval(interval);
    }
  }, [user?.token, refreshKey]);

  const fetchPositions = async () => {
    try {
      const headers = { Authorization: `Bearer ${user.token}` };
      
      // Fetch all data for all tabs to keep counts updated
      const [positionsRes, pendingRes, historyRes] = await Promise.all([
        axios.get('/api/trading/positions?status=OPEN', { headers }),
        axios.get('/api/trading/pending-orders', { headers }),
        axios.get('/api/trading/history', { headers })
      ]);
      
      // Helper to check if trade is MCX
      const isMcxTrade = (item) => {
        const segment = item?.segment?.toUpperCase() || '';
        const exchange = item?.exchange?.toUpperCase() || '';
        return segment === 'MCX' || segment === 'MCXFUT' || segment === 'MCXOPT' || exchange === 'MCX';
      };

      const isForexTrade = (item) =>
        isForexInstrument(item);
      
      // Filter by mode - crypto, forex, mcx, or regular (excluding spot wallets)
      const filterByMode = (items) => {
        if (cryptoOnly) {
          return (items || []).filter(item => item.isCrypto === true);
        }
        if (forexOnly) {
          return (items || []).filter(item => isForexTrade(item));
        }
        if (mcxOnly) {
          return (items || []).filter(item => isMcxTrade(item));
        }
        return (items || []).filter(
          item => item.isCrypto !== true && !isMcxTrade(item) && !isForexTrade(item)
        );
      };
      
      const filteredPositions = filterByMode(positionsRes.data);
      const filteredPending = filterByMode(pendingRes.data);
      const filteredHistory = filterByMode(historyRes.data);
      
      // Apply netting logic - aggregate positions by symbol and net BUY vs SELL
      const netPositions = (positions) => {
        // Step 1: Group by symbol (not symbol+side)
        const bySymbol = {};
        for (const pos of positions) {
          const key = `${pos.symbol}_${pos.exchange || 'NSE'}`;
          if (!bySymbol[key]) {
            bySymbol[key] = { buys: [], sells: [] };
          }
          if (pos.side === 'BUY') {
            bySymbol[key].buys.push(pos);
          } else {
            bySymbol[key].sells.push(pos);
          }
        }
        
        // Step 2: Net each symbol's positions
        const netted = [];
        for (const key of Object.keys(bySymbol)) {
          const { buys, sells } = bySymbol[key];
          
          // Calculate total BUY quantity and weighted avg price
          let buyQty = 0, buyValue = 0, buyIds = [], buyCommission = 0;
          for (const b of buys) {
            buyQty += b.quantity;
            buyValue += b.quantity * b.entryPrice;
            buyIds.push(b._id);
            buyCommission += b.commission || 0;
          }
          const buyAvgPrice = buyQty > 0 ? buyValue / buyQty : 0;
          
          // Calculate total SELL quantity and weighted avg price
          let sellQty = 0, sellValue = 0, sellIds = [], sellCommission = 0;
          for (const s of sells) {
            sellQty += s.quantity;
            sellValue += s.quantity * s.entryPrice;
            sellIds.push(s._id);
            sellCommission += s.commission || 0;
          }
          const sellAvgPrice = sellQty > 0 ? sellValue / sellQty : 0;
          
          // Net the positions
          const netQty = buyQty - sellQty;
          
          if (netQty === 0) {
            // Fully netted - no open position (but we still track for display if needed)
            continue;
          }
          
          // Use the first position as template
          const template = buys[0] || sells[0];
          
          if (netQty > 0) {
            // Net BUY position
            netted.push({
              ...template,
              side: 'BUY',
              quantity: netQty,
              entryPrice: buyAvgPrice,
              _ids: buyIds,
              _sellIds: sellIds, // Track sell IDs for reference
              commission: buyCommission,
              isNetted: true,
              originalBuyQty: buyQty,
              originalSellQty: sellQty
            });
          } else {
            // Net SELL position
            netted.push({
              ...template,
              side: 'SELL',
              quantity: Math.abs(netQty),
              entryPrice: sellAvgPrice,
              _ids: sellIds,
              _buyIds: buyIds, // Track buy IDs for reference
              commission: sellCommission,
              isNetted: true,
              originalBuyQty: buyQty,
              originalSellQty: sellQty
            });
          }
        }
        
        return netted;
      };
      
      setPositions(netPositions(filteredPositions));
      setPendingOrders(filteredPending);
      setHistory(filteredHistory);
      
      const pnl = filteredPositions.reduce((sum, p) => sum + (p.unrealizedPnL || 0), 0);
      setTotalPnL(pnl);
    } catch (error) {
      console.error('Error fetching positions:', error);
    }
  };

  const handleClosePosition = async (tradeId, position) => {
    try {
      setLoading(true);
      const { bidPrice, askPrice } = getUsdSpotBidAsk(marketData, position);
      
      // Handle netted positions (multiple _ids) - close all underlying positions
      const idsToClose = position?._ids || [tradeId];
      for (const id of idsToClose) {
        await axios.post(`/api/trading/close/${id}`, {
          bidPrice,
          askPrice,
          isCrypto: !!(position?.isCrypto || position?.segment === 'CRYPTO' || position?.exchange === 'BINANCE'),
          isForex: !!isForexInstrument(position)
        }, {
          headers: { Authorization: `Bearer ${user.token}` }
        });
      }
      fetchPositions();
    } catch (error) {
      alert(error.response?.data?.message || 'Error closing position');
    } finally {
      setLoading(false);
    }
  };

  // Close all positions in profit
  const handleCloseProfit = async () => {
    const profitPositions = positions.filter(pos => {
      const ltp = getCurrentPrice(pos) || pos.currentPrice || pos.entryPrice;
      const pnl = pos.side === 'BUY' 
        ? (ltp - pos.entryPrice) * pos.quantity 
        : (pos.entryPrice - ltp) * pos.quantity;
      return pnl > 0;
    });
    
    if (profitPositions.length === 0) {
      alert('No positions in profit to close');
      return;
    }
    
    if (!confirm(`Close ${profitPositions.length} position(s) in profit?`)) return;
    
    setLoading(true);
    try {
      for (const pos of profitPositions) {
        const { bidPrice, askPrice } = getUsdSpotBidAsk(marketData, pos);
        const ids = pos._ids || [pos._id];
        for (const id of ids) {
          await axios.post(`/api/trading/close/${id}`, { bidPrice, askPrice }, { headers: { Authorization: `Bearer ${user.token}` } });
        }
      }
      fetchPositions();
    } catch (error) {
      alert(error.response?.data?.message || 'Error closing positions');
    } finally {
      setLoading(false);
    }
  };

  // Close all positions in loss
  const handleCloseLoss = async () => {
    const lossPositions = positions.filter(pos => {
      const ltp = getCurrentPrice(pos) || pos.currentPrice || pos.entryPrice;
      const pnl = pos.side === 'BUY' 
        ? (ltp - pos.entryPrice) * pos.quantity 
        : (pos.entryPrice - ltp) * pos.quantity;
      return pnl < 0;
    });
    
    if (lossPositions.length === 0) {
      alert('No positions in loss to close');
      return;
    }
    
    if (!confirm(`Close ${lossPositions.length} position(s) in loss?`)) return;
    
    setLoading(true);
    try {
      for (const pos of lossPositions) {
        const { bidPrice, askPrice } = getUsdSpotBidAsk(marketData, pos);
        const ids = pos._ids || [pos._id];
        for (const id of ids) {
          await axios.post(`/api/trading/close/${id}`, { bidPrice, askPrice }, { headers: { Authorization: `Bearer ${user.token}` } });
        }
      }
      fetchPositions();
    } catch (error) {
      alert(error.response?.data?.message || 'Error closing positions');
    } finally {
      setLoading(false);
    }
  };

  // Close all positions
  const handleCloseAll = async () => {
    if (positions.length === 0) {
      alert('No positions to close');
      return;
    }
    
    if (!confirm(`Close ALL ${positions.length} position(s)?`)) return;
    
    setLoading(true);
    try {
      for (const pos of positions) {
        const { bidPrice, askPrice } = getUsdSpotBidAsk(marketData, pos);
        const ids = pos._ids || [pos._id];
        for (const id of ids) {
          await axios.post(`/api/trading/close/${id}`, { bidPrice, askPrice }, { headers: { Authorization: `Bearer ${user.token}` } });
        }
      }
      fetchPositions();
    } catch (error) {
      alert(error.response?.data?.message || 'Error closing positions');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelOrder = async (tradeId) => {
    try {
      await axios.post(`/api/trading/cancel/${tradeId}`, {}, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      fetchPositions();
    } catch (error) {
      alert(error.response?.data?.message || 'Error cancelling order');
    }
  };

  // Quick Trade - Execute market order directly
  const executeQuickTrade = async (side) => {
    const lots = parseFloat(quickQty);
    if (!selectedInstrument || isNaN(lots) || lots <= 0) return;
    
    setQuickTrading(true);
    setQuickError('');
    
    try {
      const isForex = isForexInstrument(selectedInstrument);
      const isCryptoOnly = !!(selectedInstrument.isCrypto || selectedInstrument.segment === 'CRYPTO' || selectedInstrument.exchange === 'BINANCE');
      const isUsdSpot = isUsdSpotInstrument(selectedInstrument);
      const liveData = isUsdSpot
        ? (getCryptoMarketQuote(marketData, selectedInstrument) || {})
        : (marketDataRowForInstrumentToken(marketData, selectedInstrument.token) || {});
      const ltp = liveData.ltp || liveData.close || selectedInstrument.ltp || 0;
      const bidPrice = liveData.bid || ltp;
      const askPrice = liveData.ask || ltp;
      
      // Determine if MCX or lot-based segment
      const isMCX = selectedInstrument.exchange === 'MCX' || selectedInstrument.segment === 'MCX' || selectedInstrument.displaySegment === 'MCX';
      const isFnO = selectedInstrument.instrumentType === 'FUTURES' || selectedInstrument.instrumentType === 'OPTIONS' || isMCX;
      
      // Always use lotSize from database (no hardcoded fallbacks)
      const lotSize = isUsdSpot ? 1 : (selectedInstrument.lotSize || 1);
      if (!isUsdSpot && !selectedInstrument.lotSize) {
        setQuickError(`Lot size missing for ${selectedInstrument.symbol}`);
        setTimeout(() => setQuickError(''), 3000);
        return;
      }
      const quantity = isFnO ? lots * lotSize : lots;
      const inrNotional = isUsdSpot ? quantity * spotPxToDisplayedInr(selectedInstrument, ltp, usdRate) : 0;
      
      await axios.post('/api/trading/order', {
        symbol: selectedInstrument.symbol,
        token: selectedInstrument.token || selectedInstrument.pair,
        pair: selectedInstrument.pair,
        isCrypto: isCryptoOnly,
        isForex,
        exchange: selectedInstrument.exchange || (isForex ? 'FOREX' : isCryptoOnly ? 'BINANCE' : 'NSE'),
        segment: isForex
          ? (selectedInstrument.displaySegment || forexWatchlistSegmentFromInstrument(selectedInstrument))
          : isCryptoOnly ? 'CRYPTO' : (selectedInstrument.segment || 'FNO'),
        instrumentType: isForex
          ? forexOrderInstrumentType(selectedInstrument)
          : isCryptoOnly ? 'CRYPTO' : (selectedInstrument.instrumentType || 'FUTURES'),
        side: side.toUpperCase(),
        quantity: quantity,
        lots: isUsdSpot ? 1 : lots,
        lotSize: lotSize,
        price: ltp,
        orderType: 'MARKET',
        productType: 'MIS',
        bidPrice,
        askPrice,
        leverage: 1,
        cryptoAmount: isCryptoOnly ? inrNotional : null,
        forexAmount: isForex ? inrNotional : null
      }, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      
      fetchPositions();
      if (onRefreshPositions) onRefreshPositions();
    } catch (error) {
      setQuickError(error.response?.data?.message || 'Trade failed');
      setTimeout(() => setQuickError(''), 3000);
    } finally {
      setQuickTrading(false);
    }
  };

  const tabs = [
    { id: 'positions', label: 'Positions', count: positions.length },
    { id: 'pending', label: 'Pending', count: pendingOrders.length },
    { id: 'history', label: 'History', count: history.length },
    { id: 'referral', label: 'Referral Amounts', count: 0 },
  ];

  // Mark in INR: crypto quotes are USDT; server stores entry/current in INR for crypto.
  const getCurrentPrice = (position) => {
    const side = position.side;
    const isC = isUsdSpotInstrument(position);
    if (isC) {
      const q = getCryptoMarketQuote(marketData, position);
      if (!q) return 0;
      const raw =
        side === 'BUY'
          ? Number(q.bid || q.ltp || q.close || 0)
          : Number(q.ask || q.ltp || q.close || 0);
      return spotPxToDisplayedInr(position, raw, usdRate);
    }

    const token = position.token;
    const symbol = position.symbol;

    let data = null;
    if (token && marketData?.[token]) {
      data = marketData[token];
    } else if (symbol && marketData?.[symbol]) {
      data = marketData[symbol];
    } else {
      for (const [, mData] of Object.entries(marketData || {})) {
        if (mData.symbol === symbol) {
          data = mData;
          break;
        }
      }
    }

    if (!data) return 0;

    if (side === 'BUY') {
      return data.bid || data.ltp || data.last_price || 0;
    }
    return data.ask || data.ltp || data.last_price || 0;
  };

  /** Pending orders: LIMIT uses limitPrice; SL / SL-M use triggerPrice; entryPrice if present */
  const getPendingDisplayPrice = (order) => {
    for (const key of ['limitPrice', 'triggerPrice', 'entryPrice']) {
      const n = parseFloat(order[key]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  };

  /** Live quote for pending row (crypto uses pair/symbol keys on marketData) */
  const getPendingLivePrice = (order) => {
    const isUsd = isUsdSpotInstrument(order);
    const quote = isUsd ? getCryptoMarketQuote(marketData, order) : null;
    const data =
      quote ||
      (order.token && marketData?.[order.token]) ||
      (order.symbol && marketData?.[order.symbol]) ||
      null;
    if (!data) return getCurrentPrice(order);
    if (order.side === 'BUY') {
      return data.bid || data.ltp || data.close || data.last_price || 0;
    }
    return data.ask || data.ltp || data.close || data.last_price || 0;
  };

  // Recalculate total P&L using live market data
  useEffect(() => {
    const calculatedPnL = positions.reduce((sum, pos) => {
      const ltp = getCurrentPrice(pos) || pos.currentPrice || pos.entryPrice;
      const pnl = pos.side === 'BUY' 
        ? (ltp - pos.entryPrice) * pos.quantity 
        : (pos.entryPrice - ltp) * pos.quantity;
      return sum + pnl;
    }, 0);
    setTotalPnL(calculatedPnL);
  }, [positions, marketData, usdRate]);

  return (
    <div className="h-48 bg-dark-800 border-t border-dark-600 flex flex-col">
      {/* Tabs */}
      <div className="flex items-center justify-between px-4 border-b border-dark-600">
        <div className="flex">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm border-b-2 transition ${
                activeTab === tab.id
                  ? 'border-green-500 text-green-400'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>
        
        <div className="flex items-center gap-4">
          {/* Quick Trade Section - Always Visible */}
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${selectedInstrument ? 'text-green-400' : 'text-gray-500'}`}>
              {selectedInstrument?.symbol || 'No Symbol'}
            </span>
            <span className="text-xs text-gray-400">
              ₹{(selectedInstrument ? (marketDataRowForInstrumentToken(marketData, selectedInstrument.token)?.ltp || selectedInstrument.ltp || 0) : 0).toLocaleString()}
            </span>
            <button 
              onClick={() => executeQuickTrade('sell')}
              disabled={quickTrading || !selectedInstrument}
              className="w-8 h-8 rounded-full bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center text-xs font-bold transition-colors"
              title={selectedInstrument ? 'Sell' : 'Select an instrument first'}
            >
              S
            </button>
            <input
              type="text"
              value={quickQty}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '' || /^\d*\.?\d*$/.test(val)) {
                  setQuickQty(val);
                }
              }}
              onBlur={(e) => {
                const num = parseFloat(e.target.value);
                if (isNaN(num) || num <= 0) setQuickQty('1');
              }}
              placeholder="Qty"
              className="w-16 h-8 bg-dark-700 rounded text-center text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
            />
            <button 
              onClick={() => executeQuickTrade('buy')}
              disabled={quickTrading || !selectedInstrument}
              className="w-8 h-8 rounded-full bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center text-xs font-bold transition-colors"
              title={selectedInstrument ? 'Buy' : 'Select an instrument first'}
            >
              B
            </button>
            {quickError && <span className="text-xs text-red-400">{quickError}</span>}
          </div>
          <div className="text-sm">
            <span className="text-gray-400">P/L: </span>
            <span className={`font-medium ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {totalPnL >= 0 ? '+' : '-'}₹{Math.abs(parseFloat(totalPnL) || 0).toFixed(2)}
            </span>
          </div>
          
          {/* Bulk Close Buttons */}
          {activeTab === 'positions' && positions.length > 0 && (
            <div className="flex items-center gap-2 ml-4">
              <button
                onClick={handleCloseLoss}
                disabled={loading}
                className="px-2 py-1 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 rounded text-xs font-medium"
                title="Close all positions in loss"
              >
                Close Loss
              </button>
              <button
                onClick={handleCloseAll}
                disabled={loading}
                className="px-2 py-1 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 rounded text-xs font-medium"
                title="Square off all open positions at once"
              >
                All Square Off
              </button>
              <button
                onClick={handleCloseProfit}
                disabled={loading}
                className="px-2 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded text-xs font-medium"
                title="Close all positions in profit"
              >
                Close Profit
              </button>
              <button
                onClick={handleCloseAll}
                disabled={loading}
                className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded text-xs font-medium"
                title="Close all positions"
              >
                Close All
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table Header */}
      <div className={`grid ${activeTab === 'history' ? 'grid-cols-10' : activeTab === 'positions' ? 'grid-cols-11' : 'grid-cols-9'} gap-2 px-4 py-2 text-xs text-gray-400 border-b border-dark-700`}>
        <div>User ID</div>
        <div>Symbol</div>
        <div>Side</div>
        <div className="text-right">Qty</div>
        <div className="text-right">Entry</div>
        <div className="text-right">{activeTab === 'history' ? 'Exit' : 'LTP'}</div>
        {activeTab === 'positions' && (
          <>
            <div className="text-right text-red-400/90">SL</div>
            <div className="text-right text-emerald-400/90">TP</div>
          </>
        )}
        <div className="text-right">Charges</div>
        <div className="text-right">{activeTab === 'pending' ? 'Type' : 'P&L'}</div>
        {activeTab === 'history' && <div className="text-center">Duration</div>}
        <div className="text-center">{activeTab === 'history' ? 'Reason' : 'Action'}</div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'positions' && positions.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">No open positions</div>
        )}
        {activeTab === 'positions' && positions.map(pos => {
          const ltp = getCurrentPrice(pos) || pos.currentPrice || pos.entryPrice;
          const pnl = pos.side === 'BUY' 
            ? (ltp - pos.entryPrice) * pos.quantity 
            : (pos.entryPrice - ltp) * pos.quantity;
          const isCryptoRow = pos.isCrypto || pos.segment === 'CRYPTO' || pos.exchange === 'BINANCE';
          const isForexRow = isForexInstrument(pos);
          const currencySymbol = '₹';
          const cryptoPx = (inr) => {
            const n = parseFloat(inr);
            return Number.isFinite(n) && n !== 0 ? (n / usdRate).toFixed(2) : '0.00';
          };
          const fmtSlTp = (raw) => {
            if (raw == null || raw === '') return '—';
            const n = parseFloat(raw);
            if (!Number.isFinite(n)) return '—';
            if (isCryptoRow) return `$${cryptoPx(n)}`;
            return `${currencySymbol}${n.toFixed(2)}`;
          };
          return (
            <div key={pos._id} className="grid grid-cols-11 gap-2 px-4 py-2 text-sm border-b border-dark-700 hover:bg-dark-700">
              <div className="truncate text-purple-400 font-mono text-xs">{pos.userId || user?.userId || '-'}</div>
              <div className={`truncate font-medium ${isForexRow ? 'text-cyan-400' : isCryptoRow ? 'text-orange-400' : ''}`}>{pos.symbol}</div>
              <div className={pos.side === 'BUY' ? 'text-green-400' : 'text-red-400'}>{pos.side}</div>
              <div className="text-right">{pos.quantity}</div>
              <div className="text-right">{isCryptoRow ? `$${cryptoPx(parseFloat(pos.entryPrice))}` : `${currencySymbol}${(parseFloat(pos.entryPrice) || 0).toFixed(2)}`}</div>
              <div className="text-right">{isCryptoRow ? `$${cryptoPx(parseFloat(ltp))}` : `${currencySymbol}${(parseFloat(ltp) || 0).toFixed(2)}`}</div>
              <div className="text-right text-red-300/90">{fmtSlTp(pos.stopLoss)}</div>
              <div className="text-right text-emerald-300/90">{fmtSlTp(pos.target)}</div>
              <div className="text-right text-yellow-400" title={`Spread: ${pos.spread || 0} pts, Comm: ${currencySymbol}${pos.commission || 0}`}>
                {currencySymbol}{(parseFloat(pos.commission) || 0).toFixed(2)}
              </div>
              <div className={`text-right font-medium ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {pnl >= 0 ? '+' : '-'}₹{Math.abs(parseFloat(pnl) || 0).toFixed(2)}
              </div>
              <div className="text-center">
                <button 
                  onClick={() => handleClosePosition(pos._id, pos)}
                  disabled={loading}
                  className="px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-xs"
                >
                  Close
                </button>
              </div>
            </div>
          );
        })}

        {activeTab === 'pending' && pendingOrders.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">No pending orders</div>
        )}
        {activeTab === 'pending' && pendingOrders.map(order => {
          const isCryptoRow = order.isCrypto || order.segment === 'CRYPTO' || order.exchange === 'BINANCE';
          const isForexRow = isForexInstrument(order);
          const currencySymbol = '₹';
          const displayPx = getPendingDisplayPrice(order);
          const livePx = getPendingLivePrice(order);
          const livePxInr =
            (isCryptoRow || isForexRow) && livePx > 0
              ? spotPxToDisplayedInr(
                  { isCrypto: isCryptoRow, isForex: isForexRow, exchange: order.exchange, segment: order.segment, pair: order.pair, symbol: order.symbol },
                  livePx,
                  usdRate
                )
              : livePx;
          const pendingEntryLabel =
            isCryptoRow && !isForexRow && displayPx != null ? `$${(displayPx / usdRate).toFixed(2)}` : null;
          const pendingLiveLabel =
            isCryptoRow && !isForexRow && livePx > 0 ? `$${Number(livePx).toFixed(2)}` : null;

          return (
            <div key={order._id} className="grid grid-cols-9 gap-2 px-4 py-2 text-sm border-b border-dark-700 hover:bg-dark-700">
              <div className="truncate text-purple-400 font-mono text-xs">{order.userId || user?.userId || '-'}</div>
              <div className={`truncate font-medium ${isForexRow ? 'text-cyan-400' : isCryptoRow ? 'text-orange-400' : ''}`}>{order.symbol}</div>
              <div className={order.side === 'BUY' ? 'text-green-400' : 'text-red-400'}>{order.side}</div>
              <div className="text-right">{order.quantity}</div>
              <div className="text-right">
                {pendingEntryLabel != null
                  ? pendingEntryLabel
                  : displayPx != null
                    ? `${currencySymbol}${displayPx.toFixed(2)}`
                    : '—'}
              </div>
              <div className="text-right">
                {pendingLiveLabel != null ? pendingLiveLabel : livePxInr > 0 ? `${currencySymbol}${Number(livePxInr).toFixed(2)}` : '—'}
              </div>
              <div className="text-right text-yellow-400">{currencySymbol}{(parseFloat(order.commission) || 0).toFixed(2)}</div>
              <div className="text-right text-gray-400">{order.orderType}</div>
              <div className="text-center">
                <button 
                  onClick={() => handleCancelOrder(order._id)}
                  className="px-2 py-1 bg-yellow-600 hover:bg-yellow-700 rounded text-xs"
                >
                  Cancel
                </button>
              </div>
            </div>
          );
        })}

        {activeTab === 'history' && history.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">No trade history</div>
        )}
        {activeTab === 'history' && history.map(trade => {
          const isCryptoRow = trade.isCrypto || trade.segment === 'CRYPTO' || trade.exchange === 'BINANCE';
          const isForexRow = isForexInstrument(trade);
          const currencySymbol = '₹';
          const histCryptoPx = (inr) => {
            const n = parseFloat(inr);
            return Number.isFinite(n) && n !== 0 ? (n / usdRate).toFixed(2) : '0.00';
          };
          // Calculate trade duration
          const getDuration = () => {
            if (!trade.openedAt || !trade.closedAt) return '-';
            const start = new Date(trade.openedAt);
            const end = new Date(trade.closedAt);
            const diffMs = end - start;
            if (diffMs < 0) return '-';
            const diffSecs = Math.floor(diffMs / 1000);
            if (diffSecs < 60) return `${diffSecs}s`;
            const diffMins = Math.floor(diffSecs / 60);
            if (diffMins < 60) return `${diffMins}m ${diffSecs % 60}s`;
            const diffHrs = Math.floor(diffMins / 60);
            return `${diffHrs}h ${diffMins % 60}m`;
          };
          return (
            <div key={trade._id} className="grid grid-cols-10 gap-2 px-4 py-2 text-sm border-b border-dark-700 hover:bg-dark-700">
              <div className="truncate text-purple-400 font-mono text-xs">{trade.userId || user?.userId || '-'}</div>
              <div className={`truncate font-medium ${isForexRow ? 'text-cyan-400' : isCryptoRow ? 'text-orange-400' : ''}`}>{trade.symbol}</div>
              <div className={trade.side === 'BUY' ? 'text-green-400' : 'text-red-400'}>{trade.side}</div>
              <div className="text-right">{trade.quantity}</div>
              <div className="text-right">{isCryptoRow ? `$${histCryptoPx(parseFloat(trade.entryPrice))}` : `${currencySymbol}${(parseFloat(trade.entryPrice) || 0).toFixed(2)}`}</div>
              <div className="text-right">{isCryptoRow ? (trade.exitPrice ? `$${histCryptoPx(parseFloat(trade.exitPrice))}` : '-') : `${currencySymbol}${trade.exitPrice ? (parseFloat(trade.exitPrice) || 0).toFixed(2) : '-'}`}</div>
              <div className="text-right text-yellow-400">{currencySymbol}{(parseFloat(trade.commission) || 0).toFixed(2)}</div>
              <div className={`text-right font-medium ${(trade.netPnL || trade.realizedPnL || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {(trade.netPnL || trade.realizedPnL || 0) >= 0 ? '+' : ''}{currencySymbol}{(parseFloat(trade.netPnL || trade.realizedPnL) || 0).toFixed(2)}
              </div>
              <div className="text-center text-xs text-blue-400" title={`Opened: ${trade.openedAt ? new Date(trade.openedAt).toLocaleString() : '-'}`}>{getDuration()}</div>
              <div className="text-center text-xs text-gray-400">{trade.closeReason || 'CLOSED'}</div>
            </div>
          );
        })}

        {/* Referral Amounts Tab */}
        {activeTab === 'referral' && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Share2 size={48} className="mx-auto mb-4 text-purple-400 opacity-50" />
              <p className="text-gray-400 mb-4">Referral Earnings</p>
              <button 
                onClick={() => { setShowReferralModal(true); }}
                className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded text-white font-medium transition-colors"
              >
                View Referral Details
              </button>
              <p className="text-xs text-gray-500 mt-2">
                Click to see all your referral earnings and details
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Trading Panel - Shows when Quick Trade is ON and instrument is selected
const TradingPanel = ({
  instrument,
  orderType,
  setOrderType,
  walletData,
  onClose,
  user,
  marketData = {},
  onRefreshWallet,
  onRefreshPositions,
  usdRate = 83.5,
  usdSpotClientSpreads = { cryptoInr: 0, cryptoUsdPerSide: 0, forex: 0 },
  /** Optional chart reference LTP; bid/ask use Kite book from marketData, not LTP. */
  chartAnchorLtp = null,
  segmentPermissionsGate = {},
}) => {
  const [lots, setLots] = useState(instrument?.defaultQty?.toString() || '1');
  const [price, setPrice] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [target, setTarget] = useState('');
  const [productType, setProductType] = useState('MIS');
  const [orderMode, setOrderMode] = useState('MARKET');
  const [inputMode, setInputMode] = useState('lots'); // 'lots' or 'quantity' - default to lots, quantity mode only for futures/equity
  const [marginPreview, setMarginPreview] = useState(null);
  const [marketStatus, setMarketStatus] = useState({ open: true });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showSettingsInfo, setShowSettingsInfo] = useState(false);
  const [tradeConfirmOpen, setTradeConfirmOpen] = useState(false);
  
  // Crypto: amount-mode = USD notional (converted to ₹ for wallet/API); units = base qty; lots = stepped lots
  const [cryptoAmount, setCryptoAmount] = useState('150');
  const [cryptoInputMode, setCryptoInputMode] = useState('amount'); // 'amount' | 'units'
  
  const isCryptoOnly = !!(instrument?.isCrypto || instrument?.segment === 'CRYPTO' || instrument?.exchange === 'BINANCE');
  const isForex = isForexInstrument(instrument);
  const isUsdSpot = isCryptoOnly || isForex;
  
  const cryptoQuote = isUsdSpot ? getCryptoMarketQuote(marketData, instrument) : null;
  const liveData = isUsdSpot ? (cryptoQuote || {}) : (marketDataRowForInstrumentToken(marketData, instrument?.token) || {});
  const livePrice = isUsdSpot
    ? (Number(liveData.ltp) || Number(liveData.close) || Number(instrument?.ltp) || 0)
    : (liveData.ltp || instrument?.ltp || 0);
  const indianBook = !isUsdSpot
    ? alignIndianBookBidAskWithLtp(liveData, instrument, { chartAnchorLtp })
    : null;
  const liveBid = isUsdSpot
    ? (Number(liveData.bid) || livePrice || Number(instrument?.ltp) || 0)
    : indianBook.bid;
  const liveAsk = isUsdSpot
    ? (Number(liveData.ask) || livePrice || Number(instrument?.ltp) || 0)
    : indianBook.ask;
  
  const cryptoUnitPrice = livePrice > 0 ? livePrice : 0;
  const cryptoUnitNotionalInr =
    cryptoUnitPrice > 0 && instrument
      ? spotPxToDisplayedInr(instrument, cryptoUnitPrice, usdRate)
      : 0;
  const baseQtyPerCryptoLot =
    isCryptoOnly && instrument?.lotSize > 0
      ? Number(instrument.lotSize)
      : marginPreview?.lotSize != null && Number(marginPreview.lotSize) > 0
        ? Number(marginPreview.lotSize)
        : 1;
  const cryptoUnits =
    cryptoInputMode === 'amount'
      ? cryptoUnitNotionalInr > 0
        ? ((parseFloat(cryptoAmount) || 0) * (isCryptoOnly ? usdRate : 1)) / cryptoUnitNotionalInr
        : 0
      : parseFloat(cryptoAmount) || 0;
  const cryptoTotalCost =
    cryptoInputMode === 'amount'
      ? (isCryptoOnly ? (parseFloat(cryptoAmount) || 0) * usdRate : parseFloat(cryptoAmount) || 0)
      : cryptoUnitNotionalInr > 0
        ? (parseFloat(cryptoAmount) || 0) * cryptoUnitNotionalInr
        : 0;

  const cryptoSpreadInrClient =
    usdSpotClientSpreads.cryptoInr ?? usdSpotClientSpreads.crypto ?? 0;
  const cryptoUsdPerSideClient = usdSpotClientSpreads.cryptoUsdPerSide ?? 0;
  const forexSpreadInrClient = usdSpotClientSpreads.forex ?? 0;

  const segmentSpreadInr = isCryptoOnly ? cryptoSpreadInrClient : isForex ? forexSpreadInrClient : 0;
  const displayBidAsk =
    isUsdSpot && isCryptoOnly
      ? resolveUsdSpotCryptoDisplayBidAsk(liveBid, liveAsk, cryptoUsdPerSideClient, cryptoSpreadInrClient, usdRate)
      : isUsdSpot && segmentSpreadInr > 0
        ? adjustUsdSpotBidAskForSegmentSpread(liveBid, liveAsk, segmentSpreadInr, usdRate)
        : { bidUsd: liveBid, askUsd: liveAsk };
  const stripeBidPx =
    isUsdSpot && displayBidAsk.bidUsd != null && instrument != null && !isNaN(Number(displayBidAsk.bidUsd))
      ? spotQuoteDisplayPrice(instrument, Number(displayBidAsk.bidUsd), usdRate)
      : liveBid;
  const stripeAskPx =
    isUsdSpot && displayBidAsk.askUsd != null && instrument != null && !isNaN(Number(displayBidAsk.askUsd))
      ? spotQuoteDisplayPrice(instrument, Number(displayBidAsk.askUsd), usdRate)
      : liveAsk;

  const priceSymbol =
    isCryptoOnly ? '$' : '₹';

  // Market status (Indian book); USD spot is 24/7
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        if (isUsdSpot) {
          setMarketStatus({ open: true, reason: isForex ? 'Forex quotes 24/7' : 'Crypto markets are 24/7' });
        } else {
          const { data } = await axios.get('/api/trading/market-status', {
            params: { exchange: instrument?.exchange || 'NSE' },
            headers: { Authorization: `Bearer ${user?.token}` }
          });
          setMarketStatus(data);
        }
      } catch (err) {
        console.error('Error fetching settings:', err);
      }
    };
    if (user?.token) fetchSettings();
  }, [user?.token, instrument?.exchange, isUsdSpot, isForex]);

  // When instrument changes, seed price + limit (crypto spot = USDT; forex/US₹ spot = ₹)
  useEffect(() => {
    if (!livePrice || !instrument) return;
    if (isUsdSpot) {
      const p = isCryptoOnly
        ? String(Number(livePrice))
        : spotPxToDisplayedInr(instrument, Number(livePrice), usdRate).toString();
      setPrice(p);
      setLimitPrice(p);
    } else {
      setPrice(livePrice.toString());
      setLimitPrice(livePrice.toString());
    }
  }, [instrument?.token, instrument?.pair, instrument?.symbol, isUsdSpot, isCryptoOnly]);

  useEffect(() => {
    if (!isUsdSpot || !livePrice || !instrument) return;
    setPrice(
      isCryptoOnly
        ? String(Number(livePrice))
        : spotPxToDisplayedInr(instrument, Number(livePrice), usdRate).toString()
    );
    setLimitPrice(
      isCryptoOnly
        ? String(Number(livePrice))
        : spotPxToDisplayedInr(instrument, Number(livePrice), usdRate).toString()
    );
  }, [livePrice, isUsdSpot, usdRate, instrument, isCryptoOnly]);

  // Determine segment type from database fields
  const isEquity = instrument?.segment === 'EQUITY' && instrument?.instrumentType === 'STOCK';
  const isIndex = instrument?.instrumentType === 'INDEX';
  const isFutures = instrument?.instrumentType === 'FUTURES';
  const isOptions = instrument?.instrumentType === 'OPTIONS';
  const isCall = instrument?.optionType === 'CE';
  const isPut = instrument?.optionType === 'PE';
  const isMCX = instrument?.exchange === 'MCX' || instrument?.segment === 'MCX' || instrument?.displaySegment === 'MCX' ||
                instrument?.segment === 'MCXFUT' || instrument?.segment === 'MCXOPT';
  const isFnO = isFutures || isOptions || isMCX; // MCX is always lot-based

  useEffect(() => {
    if (!isUsdSpot && marginPreview?.defaultIntradayOnly && (isFutures || isOptions || isMCX)) {
      setProductType('MIS');
    }
  }, [marginPreview?.defaultIntradayOnly, isUsdSpot, isFutures, isOptions, isMCX]);

  // Determine which wallet to use based on instrument type
  const getActiveWallet = () => {
    if (isCryptoOnly) {
      return {
        balance: walletData?.cryptoWallet?.balance || 0,
        usedMargin: 0,
        available: walletData?.cryptoWallet?.balance || 0
      };
    }
    if (isForex) {
      return {
        balance: walletData?.forexWallet?.balance || 0,
        usedMargin: 0,
        available: walletData?.forexWallet?.balance || 0
      };
    } else if (isMCX) {
      return {
        balance: walletData?.mcxWallet?.balance || 0,
        usedMargin: walletData?.mcxWallet?.usedMargin || 0,
        available: (walletData?.mcxWallet?.balance || 0) - (walletData?.mcxWallet?.usedMargin || 0)
      };
    } else {
      return {
        balance: walletData?.tradingBalance || walletData?.wallet?.tradingBalance || 0,
        usedMargin: walletData?.usedMargin || walletData?.wallet?.usedMargin || 0,
        available: walletData?.marginAvailable || ((walletData?.tradingBalance || 0) - (walletData?.usedMargin || 0))
      };
    }
  };
  const activeWallet = getActiveWallet();

  // Check if segment allows quantity mode (only equity, NOT futures)
  const segment = instrument?.displaySegment || instrument?.segment || '';
  const segmentUpper = segment.toUpperCase();
  // Futures segments - only Lots mode allowed (no quantity toggle)
  const isFuturesSegment = ['NSEFUT', 'MCXFUT', 'BSEFUT', 'NFO', 'BFO', 'BSE-FUT', 'MCX'].includes(segmentUpper) || 
                           segmentUpper.includes('FUT');
  const isEquitySegment = segmentUpper === 'NSE-EQ' || segmentUpper === 'EQUITY' || segmentUpper === 'NSE' || segmentUpper === 'BSE';
  // Only allow quantity mode for Equity segments, NOT for Futures
  const allowsQuantityMode = isEquity || isEquitySegment;

  // Always use lot size from DB (no hardcoded fallbacks)
  const lotSize = isUsdSpot ? 1 : (instrument?.lotSize || 1);
  if (!isUsdSpot && !instrument?.lotSize) {
    setError(`Lot size missing for ${instrument?.symbol || 'instrument'}`);
    return null;
  }
  // For crypto: use calculated units
  // For MCX: handle lots vs quantity modes
  // For other segments: existing logic
  const totalQuantity = isUsdSpot 
    ? cryptoUnits 
    : isMCX
        ? (inputMode === 'quantity' 
            ? parseInt(lots || 0)  // MCX quantity mode: direct quantity
            : parseInt(lots || 0) * lotSize)  // MCX lots mode: lots * lotSize
        : (allowsQuantityMode && inputMode === 'quantity')
            ? parseInt(lots || 0)  // Other segments quantity mode: direct quantity
            : (isFnO 
                ? parseInt(lots || 0) * lotSize  // Other FnO lots mode: lots * lotSize
                : parseInt(lots || 0));  // Other segments: direct quantity

  const buildMarginPreviewBody = (sideLower) => {
    const cryptoStep =
      isCryptoOnly && instrument?.lotSize > 0 ? Number(instrument.lotSize) : 1;
    const body = {
      symbol: instrument.symbol,
      tradingSymbol: instrument.tradingSymbol || instrument.symbol,
      exchange: instrument.exchange,
      token: instrument.token != null ? String(instrument.token) : undefined,
      segment: isForex
        ? (instrument.displaySegment || forexWatchlistSegmentFromInstrument(instrument))
        : (instrument.displaySegment || instrument.segment),
      instrumentType: instrument.instrumentType,
      optionType: instrument.optionType || null,
      strikePrice: instrument.strike || null,
      category: instrument.category,
      productType,
      side: String(sideLower || orderType).toUpperCase(),
      quantity: totalQuantity,
      lotSize: isUsdSpot ? cryptoStep : lotSize,
      price: isUsdSpot ? Number(livePrice) : parseFloat(price),
      leverage: 1,
      isCrypto: isCryptoOnly,
      isForex: isForex
    };
    if (!isUsdSpot) {
      body.lots = parseInt(lots, 10);
    }
    return body;
  };

  // Fetch margin preview when inputs change
  useEffect(() => {
    const fetchMarginPreview = async () => {
      if (!instrument) return;
      if (!isUsdSpot && !lots) return;
      if (isUsdSpot) {
        if (!livePrice) return;
      } else if (!price) {
        return;
      }

      try {
        const body = buildMarginPreviewBody(orderType);
        const { data } = await axios.post('/api/trading/margin-preview', body, {
          headers: { Authorization: `Bearer ${user?.token}` }
        });
        setMarginPreview(data);
      } catch (err) {
        console.error('Margin preview error:', err);
      }
    };

    const debounce = setTimeout(fetchMarginPreview, 300);
    return () => clearTimeout(debounce);
  }, [instrument, lots, price, productType, orderType, user, totalQuantity, lotSize, usdRate, isUsdSpot, isForex, isCryptoOnly, livePrice, cryptoInputMode, cryptoAmount]);

  // Place order (optional explicitSide when confirming from modal with opposite side vs current stripe highlight)
  const handlePlaceOrder = async (explicitSide) => {
    const sideLower =
      explicitSide === 'buy' || explicitSide === 'sell'
        ? explicitSide
        : orderType;

    // Check market status for MARKET orders
    if (orderMode === 'MARKET' && !marketStatus.open) {
      setError(marketStatus.reason || 'Market is closed');
      return;
    }

    let previewGate = marginPreview;
    if (
      (explicitSide === 'buy' || explicitSide === 'sell') &&
      explicitSide !== orderType &&
      user?.token
    ) {
      try {
        const body = buildMarginPreviewBody(explicitSide);
        const { data } = await axios.post('/api/trading/margin-preview', body, {
          headers: { Authorization: `Bearer ${user?.token}` },
        });
        previewGate = data;
      } catch (err) {
        console.error('Margin preview error:', err);
      }
    }

    if (previewGate?.lotsError) {
      setError(previewGate.lotsError);
      return;
    }

    if (previewGate && !previewGate.canPlace) {
      setError(`Insufficient funds. Need ₹${previewGate.shortfall?.toLocaleString()} more`);
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const orderData = {
        symbol: instrument.symbol,
        token: instrument.token || instrument.pair,
        pair: instrument.pair,
        isCrypto: isCryptoOnly,
        isForex: isForex,
        displaySegment: instrument.displaySegment,
        exchange: instrument.exchange || (isForex ? 'FOREX' : isCryptoOnly ? 'BINANCE' : 'NSE'),
        segment: isForex
          ? (instrument.displaySegment || forexWatchlistSegmentFromInstrument(instrument))
          : isCryptoOnly ? (instrument.displaySegment || 'CRYPTO') : (instrument.displaySegment || instrument.segment || (instrument.exchange === 'MCX' ? 'MCXFUT' : 'NSEFUT')),
        instrumentType: isForex
          ? forexOrderInstrumentType(instrument)
          : isCryptoOnly ? (instrument.instrumentType || 'CRYPTO') : (instrument.instrumentType || 'FUTURES'),
        optionType: instrument.optionType || null,
        strike: instrument.strike || null,
        expiry: instrument.expiry || null,
        category: instrument.category,
        productType,
        orderType: orderMode,
        side: sideLower.toUpperCase(),
        quantity: isUsdSpot ? cryptoUnits : totalQuantity,
        lotSize: isUsdSpot ? (instrument?.lotSize > 0 ? Number(instrument.lotSize) : baseQtyPerCryptoLot) : lotSize,
        price: isUsdSpot ? livePrice : parseFloat(price),
        bidPrice: liveBid,
        askPrice: liveAsk,
        leverage: 1,
        stopLoss: stopLoss
          ? isUsdSpot
            ? isCryptoOnly
              ? parseFloat(stopLoss)
              : parseFloat(stopLoss) / usdRate
            : parseFloat(stopLoss)
          : null,
        target: target
          ? isUsdSpot
            ? isCryptoOnly
              ? parseFloat(target)
              : parseFloat(target) / usdRate
            : parseFloat(target)
          : null,
        cryptoAmount: isUsdSpot ? cryptoTotalCost : null,
        forexAmount: isForex ? cryptoTotalCost : null,
      };
      if (!isUsdSpot) {
        orderData.lots = parseInt(lots, 10);
      }

      console.log('Placing order:', orderData);

      // Add limit price for LIMIT orders
      if (orderMode === 'LIMIT') {
        orderData.limitPrice = isUsdSpot
          ? (isCryptoOnly ? parseFloat(limitPrice) : parseFloat(limitPrice) / usdRate)
          : parseFloat(limitPrice);
      }
      // Add trigger price for SL orders
      if (orderMode === 'SL' || orderMode === 'SL-M') {
        orderData.triggerPrice = isUsdSpot
          ? (isCryptoOnly ? parseFloat(limitPrice) : parseFloat(limitPrice) / usdRate)
          : parseFloat(limitPrice);
      }

      const gateSeg = String(orderData.segment || orderData.displaySegment || '').trim();
      const gateErr = validateLimitPendingFromSegmentPerms(segmentPermissionsGate, gateSeg, orderMode);
      if (gateErr) {
        setError(gateErr);
        setLoading(false);
        return;
      }

      const { data } = await axios.post('/api/trading/order', orderData, {
        headers: { Authorization: `Bearer ${user?.token}` }
      });

      const statusMsg = data.trade?.status === 'PENDING' 
        ? `Order placed! Waiting for price to reach ${priceSymbol}${limitPrice}` 
        : isUsdSpot 
          ? `✅ ${instrument.symbol}: ${cryptoUnits.toFixed(6)} units, ₹${cryptoTotalCost.toFixed(2)}`
          : `Order executed! Margin: ₹${data.marginBlocked?.toLocaleString()}`;
      
      setSuccess(statusMsg);
      // Refresh wallet and positions after successful order
      if (onRefreshWallet) onRefreshWallet();
      if (onRefreshPositions) onRefreshPositions();
      setTimeout(() => {
        setSuccess('');
        onClose();
      }, 2000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to place order');
    } finally {
      setLoading(false);
    }
  };

  // Product types based on segment
  const getProductTypes = () => {
    if (isUsdSpot) return [
      { value: 'MIS', label: 'Spot', desc: isForex ? 'Forex spot (synthetic)' : 'Crypto spot trading' }
    ];
    if (isEquity) return [
      { value: 'CNC', label: 'CNC (Delivery)', desc: 'Hold for days/months' },
      { value: 'MIS', label: 'MIS (Intraday)', desc: 'Square off same day' }
    ];
    if (isFutures || isOptions) return [
      { value: 'MIS', label: 'MIS (Intraday)', desc: 'Square off same day' },
      { value: 'NRML', label: 'NRML (Carry Forward)', desc: 'Hold till expiry' }
    ];
    return [{ value: 'MIS', label: 'MIS', desc: 'Intraday' }];
  };

  // Get segment label
  const getSegmentLabel = () => {
    if (isEquity) return 'EQUITY';
    if (isFutures) return 'FUTURES';
    if (isOptions) return isCall ? 'CALL OPTION (CE)' : 'PUT OPTION (PE)';
    return 'UNKNOWN';
  };

  // Get trading hint
  const getTradingHint = () => {
    if (isForex) {
      return orderType === 'buy' ? '🚀 Buy FX — profit if quote rises vs your entry' : '📉 Sell FX — profit if quote falls vs your entry';
    }
    if (isCryptoOnly) {
      return orderType === 'buy' ? '🚀 Buy crypto - Profit if price goes UP' : '📉 Sell crypto - Profit if price goes DOWN';
    }
    if (isEquity) {
      if (orderType === 'buy') return productType === 'CNC' ? 'Buy & hold shares in DEMAT' : 'Buy intraday, auto square-off at 3:15 PM';
      return productType === 'MIS' ? 'Short sell intraday only' : 'Sell from holdings';
    }
    if (isFutures) {
      return orderType === 'buy' ? 'Profit if price goes UP' : 'Profit if price goes DOWN';
    }
    if (isOptions) {
      if (isCall) return orderType === 'buy' ? 'Bullish: Profit if price goes UP' : 'Bearish/Neutral: Collect premium';
      if (isPut) return orderType === 'buy' ? 'Bearish: Profit if price goes DOWN' : 'Bullish/Neutral: Collect premium';
    }
    return '';
  };

  const confirmTickTimeLabel = (() => {
    const t = liveData?.lastTradeTime ?? liveData?.last_trade_time ?? liveData?.lastUpdated;
    if (t == null || t === '') return '—';
    try {
      return new Date(t).toLocaleString();
    } catch {
      return '—';
    }
  })();

  const confirmAvgPriceNum =
    marginPreview?.tradeValue != null &&
    totalQuantity > 0 &&
    Number.isFinite(Number(marginPreview.tradeValue) / totalQuantity)
      ? Number(marginPreview.tradeValue) / totalQuantity
      : null;

  const confirmMinVolumeLabel =
    !isUsdSpot && marginPreview?.minLots != null && Number(lotSize) > 0
      ? `${marginPreview.minLots * Number(lotSize)} qty (min ${marginPreview.minLots} lot)`
      : isUsdSpot && isCryptoOnly && Number(baseQtyPerCryptoLot) > 0
        ? `Exchange step ${baseQtyPerCryptoLot}`
        : !isUsdSpot && marginPreview?.minLots != null
          ? `${marginPreview.minLots} lot(s)`
          : '—';

  const confirmVolumeStepLabel =
    isUsdSpot && isCryptoOnly && Number(baseQtyPerCryptoLot) > 0
      ? `Step ${baseQtyPerCryptoLot}`
      : !isUsdSpot && inputMode === 'quantity'
        ? '1 qty'
        : !isUsdSpot
          ? '1 lot'
          : '—';

  const confirmVolumeDisp =
    liveData?.volume != null && liveData.volume !== ''
      ? Number(liveData.volume).toLocaleString('en-IN')
      : '—';

  /** Prefer per-order qty cap from segment; else show order-lots (breakup) limit from segment/script. */
  const confirmBreakupCapLabel =
    marginPreview?.breakupQuantity != null && Number(marginPreview.breakupQuantity) > 0
      ? `${Number(marginPreview.breakupQuantity)} qty/order`
      : marginPreview?.perOrderLots != null && Number(marginPreview.perOrderLots) > 0
        ? `${Number(marginPreview.perOrderLots)} lots/order`
        : '—';

  const fmtPx = (v) =>
    v != null && v !== '' && !Number.isNaN(Number(v))
      ? `${priceSymbol}${Number(v).toLocaleString(isCryptoOnly ? 'en-US' : 'en-IN', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : '—';

  const closeConfirmAndPlace = async (side) => {
    setTradeConfirmOpen(false);
    setOrderType(side);
    await handlePlaceOrder(side);
  };

  return (
    <aside className="relative w-full h-full bg-dark-800 border-l border-dark-600 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-600">
        <div className="flex items-center gap-2">
          <div>
            <div className={`font-bold ${isCryptoOnly ? 'text-orange-400' : isForex ? 'text-cyan-400' : isCall ? 'text-green-400' : isPut ? 'text-red-400' : isFutures ? 'text-yellow-400' : ''}`}>
              {instrument?.symbol}
            </div>
            <div className="text-xs text-gray-400 flex items-center gap-1">
              <span>{instrument?.exchange} • {isForex ? (instrument?.displaySegment || 'FOREXFUT') : isCryptoOnly ? 'CRYPTO' : getSegmentLabel()}</span>
              {/* Show expiry for Futures and Options */}
              {(isFutures || isOptions) && instrument?.expiry && (
                <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-[10px]">
                  Exp: {instrument.expiry}
                </span>
              )}
            </div>
          </div>
          {!isUsdSpot && (
            <button 
              onClick={() => setShowSettingsInfo(!showSettingsInfo)}
              className="text-blue-400 hover:text-blue-300 p-1"
              title="View trading settings"
            >
              <Info size={18} />
            </button>
          )}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white">
          <X size={20} />
        </button>
      </div>

      {/* Settings Info Popup */}
      {showSettingsInfo && !isUsdSpot && (
        <div className="absolute top-14 left-2 right-2 z-50 bg-dark-700 border border-dark-500 rounded-lg shadow-xl p-4 max-h-80 overflow-y-auto">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-bold text-sm text-blue-400">Trading Settings</h3>
            <button onClick={() => setShowSettingsInfo(false)} className="text-gray-400 hover:text-white">
              <X size={16} />
            </button>
          </div>
          
          {/* Segment Settings */}
          <div className="mb-3">
            <div className="text-xs text-gray-500 uppercase mb-2">Segment: {instrument?.displaySegment || instrument?.segment}</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-dark-800 p-2 rounded">
                <span className="text-gray-400">Max Lots:</span>
                <span className="float-right text-white">{marginPreview?.maxLots || '--'}</span>
              </div>
              <div className="bg-dark-800 p-2 rounded">
                <span className="text-gray-400">Min Lots:</span>
                <span className="float-right text-white">{marginPreview?.minLots || 1}</span>
              </div>
              <div className="bg-dark-800 p-2 rounded">
                <span className="text-gray-400">Per Order:</span>
                <span className="float-right text-white">{marginPreview?.perOrderLots || '--'}</span>
              </div>
              <div className="bg-dark-800 p-2 rounded">
                <span className="text-gray-400">Lot Size:</span>
                <span className="float-right text-white">{lotSize}</span>
              </div>
            </div>
          </div>

          {/* Script Specific Settings */}
          <div className="mb-3">
            <div className="text-xs text-gray-500 uppercase mb-2">Script: {instrument?.symbol}</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-dark-800 p-2 rounded">
                <span className="text-gray-400">Exposure Intraday:</span>
                <span className="float-right text-white">{marginPreview?.exposureIntraday || '--'}x</span>
              </div>
              <div className="bg-dark-800 p-2 rounded">
                <span className="text-gray-400">Exposure CF:</span>
                <span className="float-right text-white">{marginPreview?.exposureCarryForward || '--'}x</span>
              </div>
              <div className="bg-dark-800 p-2 rounded">
                <span className="text-gray-400">Commission:</span>
                <span className="float-right text-white">₹{marginPreview?.commission || 0}</span>
              </div>
              <div className="bg-dark-800 p-2 rounded">
                <span className="text-gray-400">Brokerage:</span>
                <span className="float-right text-white">₹{marginPreview?.brokerage || 0}</span>
              </div>
            </div>
          </div>

          {/* Trading Limits */}
          {(marginPreview?.maxLots || marginPreview?.minLots) && (
            <div className="bg-blue-900/20 border border-blue-500/30 rounded p-2 text-xs">
              <span className="text-blue-400">ℹ️ Lot Range:</span>
              <span className="text-white ml-2">{marginPreview?.minLots || 1} - {marginPreview?.maxLots || 'Unlimited'} lots per order</span>
            </div>
          )}
          {/* Breakup Quantity and Max Bid Limits */}
          {(marginPreview?.breakupQuantity || marginPreview?.maxBid) && (
            <div className="bg-orange-900/20 border border-orange-500/30 rounded p-2 text-xs space-y-1">
              {marginPreview?.breakupQuantity && (
                <div>
                  <span className="text-orange-400">📊 Breakup Quantity:</span>
                  <span className="text-white ml-2">{marginPreview.breakupQuantity} qty per order max</span>
                </div>
              )}
              {marginPreview?.maxBid && (
                <div>
                  <span className="text-orange-400">🎯 Max Bid:</span>
                  <span className="text-white ml-2">{marginPreview.maxBid} orders max</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Buy/Sell Toggle with Live Bid/Ask Prices - Indian Standard: SELL left, BUY right */}
      <div className="flex border-b border-dark-600">
        <button
          type="button"
          onClick={() => {
            setOrderType('sell');
            setTradeConfirmOpen(true);
          }}
          className={`flex-1 py-2 font-semibold transition ${
            orderType === 'sell' ? 'bg-red-600 text-white' : 'bg-dark-700 text-gray-400'
          }`}
        >
          <div className="text-xs opacity-70">{isUsdSpot ? (isCryptoOnly ? 'Bid ($)' : 'Bid (₹)') : 'Bid'}</div>
          <div className="text-lg">{priceSymbol}{stripeBidPx != null && !isNaN(stripeBidPx) ? stripeBidPx.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--'}</div>
          <div className="text-xs">SELL</div>
        </button>
        <button
          type="button"
          onClick={() => {
            setOrderType('buy');
            setTradeConfirmOpen(true);
          }}
          className={`flex-1 py-2 font-semibold transition ${
            orderType === 'buy' ? 'bg-green-600 text-white' : 'bg-dark-700 text-gray-400'
          }`}
        >
          <div className="text-xs opacity-70">{isUsdSpot ? (isCryptoOnly ? 'Ask ($)' : 'Ask (₹)') : 'Ask'}</div>
          <div className="text-lg">{priceSymbol}{stripeAskPx != null && !isNaN(stripeAskPx) ? stripeAskPx.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--'}</div>
          <div className="text-xs">BUY</div>
        </button>
      </div>

      {/* Trading Form */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Trading Hint */}
        <div className={`text-xs p-2 rounded ${orderType === 'buy' ? 'bg-blue-900/30 text-blue-300' : 'bg-red-900/30 text-red-300'}`}>
          {getTradingHint()}
        </div>

        {/* Product Type */}
        <div>
          <label className="block text-xs text-gray-400 mb-2">Product Type</label>
          
          <div className="space-y-2">
            {getProductTypes().map(pt => (
              <button
                  key={pt.value}
                  onClick={() => setProductType(pt.value)}
                  className={`w-full text-left px-3 py-2 rounded border transition ${
                    productType === pt.value 
                      ? 'border-green-500 bg-green-500/10' 
                      : 'border-dark-600 hover:border-dark-500'
                  }`}
                >
                  <div className="font-medium text-sm">{pt.label}</div>
                  <div className="text-xs text-gray-500">{pt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Market Status Warning */}
        {!marketStatus.open && orderMode === 'MARKET' && (
          <div className="bg-yellow-900/30 border border-yellow-500 text-yellow-300 px-3 py-2 rounded text-sm">
            ⚠️ {marketStatus.reason || 'Market is closed'}. Use LIMIT order instead.
          </div>
        )}

        {/* Order Type */}
        <div>
          <label className="block text-xs text-gray-400 mb-2">Order Type</label>
          <div className="grid grid-cols-2 gap-2">
            {['MARKET', 'LIMIT', 'SL', 'SL-M'].map(ot => (
              <button
                key={ot}
                onClick={() => setOrderMode(ot)}
                disabled={ot === 'MARKET' && !marketStatus.open}
                className={`px-3 py-2 rounded text-sm transition ${
                  orderMode === ot 
                    ? 'bg-green-600 text-white' 
                    : ot === 'MARKET' && !marketStatus.open
                    ? 'bg-dark-700 text-gray-600 cursor-not-allowed'
                    : 'bg-dark-700 text-gray-400 hover:bg-dark-600'
                }`}
              >
                {ot}
              </button>
            ))}
          </div>
        </div>

        {!isUsdSpot && marginPreview?.exposureIntraday != null && (
          <div className="text-xs text-cyan-400/95 mb-2">
            Segment exposure (MIS ×{marginPreview.exposureIntraday ?? '—'} · CF ×{marginPreview.exposureCarryForward ?? '—'}) drives margin below
          </div>
        )}
        {isUsdSpot && isForex && marginPreview?.exposureIntraday != null && (
          <div className="text-xs text-cyan-400/95 mb-2">
            Segment exposure MIS ×{marginPreview.exposureIntraday ?? '—'}
            {marginPreview?.exposureCarryForward != null && ` · CF ×${marginPreview.exposureCarryForward}`}; margin follows broker hierarchy + instrument rules only
          </div>
        )}

        {/* Crypto / Forex: USD-quote, INR notional */}
        {isUsdSpot ? (
          <div>
            {/* Crypto / forex: amount or base units (exchange step enforced server-side for Binance crypto). */}
            <div className="grid gap-2 mb-3 grid-cols-2">
              <button
                type="button"
                onClick={() => setCryptoInputMode('amount')}
                className={`py-2 rounded text-sm font-medium transition ${
                  cryptoInputMode === 'amount' ? (isForex ? 'bg-cyan-600 text-white' : 'bg-orange-600 text-white') : 'bg-dark-700 text-gray-400'
                }`}
              >
                {isCryptoOnly ? '$ Amount' : '₹ Amount'}
              </button>
              <button
                type="button"
                onClick={() => setCryptoInputMode('units')}
                className={`py-2 rounded text-sm font-medium transition ${
                  cryptoInputMode === 'units' ? (isForex ? 'bg-cyan-600 text-white' : 'bg-orange-600 text-white') : 'bg-dark-700 text-gray-400'
                }`}
              >
                {isForex ? '◆' : '₿'} Units
              </button>
            </div>
            
            <label className="block text-xs text-gray-400 mb-2">
              {cryptoInputMode === 'amount'
                ? isCryptoOnly
                  ? 'Amount (USD)'
                  : 'Amount (INR)'
                : `${instrument?.symbol} Units`}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                {cryptoInputMode === 'amount' ? (isCryptoOnly ? '$' : '₹') : ''}
              </span>
              <input
                type="number"
                value={cryptoAmount}
                onChange={(e) => setCryptoAmount(e.target.value)}
                placeholder={cryptoInputMode === 'amount' ? (isCryptoOnly ? 'USD notional' : 'Enter INR amount') : 'Enter units'}
                className={`w-full bg-dark-700 border border-dark-600 rounded px-3 py-3 text-lg font-bold focus:outline-none focus:border-orange-500 ${cryptoInputMode === 'amount' ? 'pl-8' : ''}`}
                step="any"
              />
            </div>
            
            {/* Quick notional presets: USD for crypto wallet path, ₹ for forex */}
            <div className="flex gap-1 mt-2 flex-wrap">
              {(isCryptoOnly ? [100, 250, 500, 1000, 2500, 5000] : [5000, 10000, 25000, 50000, 100000]).map((amt) => (
                <button
                  type="button"
                  key={amt}
                  onClick={() => { setCryptoInputMode('amount'); setCryptoAmount(amt.toString()); }}
                  className={`flex-1 min-w-[52px] py-1 text-xs rounded ${
                    cryptoAmount === amt.toString() && cryptoInputMode === 'amount'
                      ? isForex
                        ? 'bg-cyan-600'
                        : 'bg-orange-600'
                      : 'bg-dark-600 hover:bg-dark-500'
                  }`}
                >
                  {isCryptoOnly ? (amt >= 1000 ? `$${amt / 1000}k` : `$${amt}`) : `₹${amt / 1000}k`}
                </button>
              ))}
            </div>
            
            {/* Show conversion */}
            <div className="bg-dark-600 rounded p-3 mt-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">You {orderType === 'buy' ? 'Buy' : 'Sell'}</span>
                <span className="text-orange-400 font-bold">{cryptoUnits.toFixed(6)} {instrument?.symbol}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">{isCryptoOnly ? '@ Price (USD)' : '@ Price (₹)'}</span>
                <span className="text-white">
                  {isCryptoOnly
                    ? `$${Number(cryptoUnitPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : `₹${cryptoUnitNotionalInr.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </span>
              </div>
              <div className="flex justify-between text-sm border-t border-dark-500 pt-1">
                <span className="text-gray-400">Total (₹)</span>
                <span className="text-green-400 font-bold">₹{cryptoTotalCost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>
        ) : (
          /* Indian Trading: Lots/Quantity */
          <div>
            {/* Input Mode Toggle - Show for MCX (always) and other segments that allow quantity mode */}
            {(isMCX || allowsQuantityMode) && (
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs text-gray-400">Trade by:</span>
                <div className="flex bg-dark-700 rounded-lg p-0.5 w-full">
                  <button
                    onClick={() => { setInputMode('lots'); setLots('1'); }}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition ${
                      inputMode === 'lots' 
                        ? 'bg-green-600 text-white shadow-lg' 
                        : 'text-gray-400 hover:text-white hover:bg-dark-600'
                    }`}
                  >
                    {isMCX ? '📊 Trade in Lots' : 'Lots'}
                  </button>
                  <button
                    onClick={() => { setInputMode('quantity'); setLots('1'); }}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition ${
                      inputMode === 'quantity' 
                        ? 'bg-blue-600 text-white shadow-lg' 
                        : 'text-gray-400 hover:text-white hover:bg-dark-600'
                    }`}
                  >
                    {isMCX ? '🔢 Trade in Quantity' : 'Quantity'}
                  </button>
                </div>
              </div>
            )}
            
            <label className="block text-xs text-gray-400 mb-2">
              {inputMode === 'quantity' ? 'Quantity' : (isFnO ? 'Lots' : 'Quantity')} 
              {inputMode === 'quantity' && <span className="text-blue-400">(Direct quantity)</span>}
            </label>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setLots(Math.max(1, parseInt(lots || 1) - 1).toString())}
                className="w-10 h-10 bg-dark-600 hover:bg-dark-500 rounded text-xl font-bold"
              >-</button>
              <input
                type="number"
                value={lots}
                onChange={(e) => setLots(e.target.value)}
                className="w-16 bg-dark-700 border border-dark-600 rounded px-2 py-2 text-center text-lg font-bold focus:outline-none focus:border-green-500"
                min="1"
              />
              <button 
                onClick={() => setLots((parseInt(lots || 1) + 1).toString())}
                className="w-10 h-10 bg-dark-600 hover:bg-dark-500 rounded text-xl font-bold"
              >+</button>
            </div>
            {isFnO && inputMode === 'quantity' && (
              <div className="flex justify-between text-xs mt-2">
                <span className="text-gray-500">Total Qty: <span className="text-white font-medium">{totalQuantity}</span></span>
                <span className="text-gray-500">Value: <span className="text-white">{priceSymbol}{(totalQuantity * parseFloat(price || 0)).toLocaleString()}</span></span>
              </div>
            )}
            {/* Quick lot/qty buttons */}
            {isFnO && inputMode === 'lots' && (
              <div className="flex gap-1 mt-2">
                {[1, 2, 5, 10, 20].map(l => (
                  <button
                    key={l}
                    onClick={() => setLots(l.toString())}
                    className={`flex-1 py-1 text-xs rounded ${lots === l.toString() ? 'bg-green-600' : 'bg-dark-600 hover:bg-dark-500'}`}
                  >
                    {l}L
                  </button>
                ))}
              </div>
            )}
            {/* Quick quantity buttons for quantity mode */}
            {(isMCX || allowsQuantityMode) && inputMode === 'quantity' && (
              <div className="flex gap-1 mt-2">
                {(isMCX ? [1, 5, 10, 25, 50, 100] : [1, 5, 10, 25, 50]).map(q => (
                  <button
                    key={q}
                    onClick={() => setLots(q.toString())}
                    className={`flex-1 py-1 text-xs rounded ${lots === q.toString() ? 'bg-blue-600' : 'bg-dark-600 hover:bg-dark-500'}`}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Limit Price - Only for LIMIT and SL orders */}
        {(orderMode === 'LIMIT' || orderMode === 'SL') && (
          <div>
            <label className="block text-xs text-gray-400 mb-2">
              {orderMode === 'LIMIT' ? 'Limit Price' : 'Trigger Price'}
              {isUsdSpot && (
                <span className="text-orange-400/90">
                  {' '}
                  {isCryptoOnly ? '(USDT per unit)' : '(₹ per unit)'}
                </span>
              )}
            </label>
            <input
              type="number"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder={
                orderMode === 'LIMIT'
                  ? isUsdSpot
                    ? isCryptoOnly
                      ? 'Limit (USDT per unit)'
                      : 'Limit in INR per unit'
                    : 'Enter limit price'
                  : isUsdSpot
                    ? isCryptoOnly
                      ? 'Trigger (USDT per unit)'
                      : 'Trigger in INR per unit'
                    : 'Enter trigger price'
              }
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 focus:outline-none focus:border-green-500"
            />
            <div className="text-xs text-gray-500 mt-1">
              {orderMode === 'LIMIT' 
                ? `Order executes when price ${orderType === 'buy' ? 'falls to' : 'rises to'} ${priceSymbol}${limitPrice || '...'}`
                : `Order triggers when price ${orderType === 'buy' ? 'rises to' : 'falls to'} ${priceSymbol}${limitPrice || '...'}`
              }
            </div>
          </div>
        )}

        {/* Stop Loss & Target */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-2">
              Stop Loss (Optional){isUsdSpot && <span className="text-orange-400/90">{isCryptoOnly ? ' $' : ' ₹'}</span>}
            </label>
            <input
              type="number"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              placeholder={isUsdSpot ? (isCryptoOnly ? 'SL in USD' : 'SL in INR') : 'SL Price'}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-red-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-2">
              Target (Optional){isUsdSpot && <span className="text-orange-400/90">{isCryptoOnly ? ' $' : ' ₹'}</span>}
            </label>
            <input
              type="number"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={isUsdSpot ? (isCryptoOnly ? 'Target in USD' : 'Target in INR') : 'Target Price'}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-green-500"
            />
          </div>
        </div>
        {(stopLoss || target) && (
          <div className="text-xs text-gray-500">
            {stopLoss && <span className="text-red-400">SL: {priceSymbol}{stopLoss}</span>}
            {stopLoss && target && ' | '}
            {target && <span className="text-green-400">Target: {priceSymbol}{target}</span>}
            {' - Auto exit when price hits'}
          </div>
        )}

        {/* Error/Success Messages */}
        {error && (
          <div className="bg-red-900/30 border border-red-500 text-red-300 px-3 py-2 rounded text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-900/30 border border-green-500 text-green-300 px-3 py-2 rounded text-sm">
            {success}
          </div>
        )}

        {/* Balance Info - USD spot vs Indian trading */}
        <div className="bg-dark-700 rounded p-3 space-y-2">
          {isUsdSpot ? (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">{isForex ? 'Forex Wallet' : 'Crypto Wallet'}</span>
                <span className={`font-medium ${isForex ? 'text-cyan-400' : 'text-orange-400'}`}>
                  ₹{((isForex ? walletData?.forexWallet?.balance : walletData?.cryptoWallet?.balance) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between text-sm border-t border-dark-600 pt-2">
                <span className="text-gray-400">Available</span>
                <span className="text-green-400 font-medium">
                  ₹{((isForex ? walletData?.forexWallet?.balance : walletData?.cryptoWallet?.balance) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Trade Cost</span>
                <span className={cryptoTotalCost > ((isForex ? walletData?.forexWallet?.balance : walletData?.cryptoWallet?.balance) || 0) ? 'text-red-400' : 'text-white'}>
                  ₹{cryptoTotalCost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              {cryptoTotalCost > ((isForex ? walletData?.forexWallet?.balance : walletData?.cryptoWallet?.balance) || 0) && (
                <div className="text-xs text-red-400">
                  ⚠️ Insufficient balance. Need ₹{(cryptoTotalCost - ((isForex ? walletData?.forexWallet?.balance : walletData?.cryptoWallet?.balance) || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} more
                </div>
              )}
            </>
          ) : (
            /* Indian/MCX Trading - Margin based system */
            <>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">{isMCX ? 'MCX Balance' : 'Trading Balance'}</span>
                <span className={isMCX ? 'text-yellow-400' : 'text-green-400'}>
                  ₹{activeWallet.balance.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Used Margin</span>
                <span className="text-yellow-400">
                  ₹{activeWallet.usedMargin.toLocaleString()}
                </span>
              </div>
              {(marginPreview?.exposureIntraday != null || marginPreview?.exposureCarryForward != null) && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Segment exposure</span>
                <span className="text-cyan-400 font-medium text-xs text-right">
                  MIS ×{marginPreview.exposureIntraday ?? '—'} · CF ×{marginPreview.exposureCarryForward ?? '—'}
                </span>
              </div>
              )}
              <div className="flex justify-between text-sm border-t border-dark-600 pt-2">
                <span className="text-gray-400">Available</span>
                <span className="text-green-400 font-medium">
                  ₹{activeWallet.available.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Required Margin</span>
                <span className={marginPreview?.canPlace === false ? 'text-red-400' : ''}>
                  ₹{marginPreview?.marginRequired?.toLocaleString() || '--'}
                </span>
              </div>
            </>
          )}
          {marginPreview?.lotsError && (
            <div className="text-xs text-red-400 mt-2">
              ⚠️ {marginPreview.lotsError}
            </div>
          )}
          {marginPreview && !marginPreview.canPlace && !marginPreview.lotsError && marginPreview.shortfall > 0 && (
            <div className="text-xs text-red-400 mt-2">
              ⚠️ Insufficient funds. Need ₹{Number(marginPreview.shortfall || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} more
            </div>
          )}
          {marginPreview?.maxLots && (
            <div className="text-xs text-gray-500 mt-1">
              Lot limit: {marginPreview.minLots} - {marginPreview.maxLots}
            </div>
          )}
          {isOptions && orderType === 'sell' && (
            <div className="text-xs text-yellow-400 mt-2">
              ⚠️ Option selling requires higher margin (SPAN + Exposure)
            </div>
          )}
        </div>
      </div>

      {/* Submit Button — opens confirm modal (breakup, bid/ask, limits) like stripe tap */}
      <div className="p-4 border-t border-dark-600">
        <button
          type="button"
          onClick={() => setTradeConfirmOpen(true)}
          disabled={loading}
          className={`w-full py-3 rounded-lg font-semibold transition ${
            orderType === 'buy' 
              ? 'bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800' 
              : 'bg-red-600 hover:bg-red-700 disabled:bg-red-800'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {loading ? 'Placing Order...' : `${orderType === 'buy' ? 'BUY' : 'SELL'} ${instrument?.symbol}`}
        </button>
        <div className="text-center text-xs text-gray-500 mt-2">
          {productType} • {orderMode}
        </div>
      </div>

      {tradeConfirmOpen && (
        <div
          className="absolute inset-0 z-[70] flex items-center justify-center p-3 bg-black/80"
          role="dialog"
          aria-modal="true"
          aria-labelledby="trade-confirm-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setTradeConfirmOpen(false);
          }}
        >
          <div
            className="bg-dark-800 border border-dark-600 rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-dark-600">
              <h3 id="trade-confirm-title" className="font-bold text-sm text-white">
                Confirm order · {instrument?.symbol}
              </h3>
              <button
                type="button"
                onClick={() => setTradeConfirmOpen(false)}
                className="text-gray-400 hover:text-white p-1 rounded"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto space-y-2 text-sm flex-1">
              <div className="flex rounded-lg overflow-hidden border border-dark-600 mb-3 text-center">
                <div className="flex-1 py-2 px-2 bg-dark-700/90 border-r border-dark-600">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide">
                    {isUsdSpot ? (isCryptoOnly ? 'Bid ($)' : 'Bid (₹)') : 'Bid'}
                  </div>
                  <div className="text-base font-semibold text-white tabular-nums">
                    {stripeBidPx != null && !isNaN(stripeBidPx)
                      ? `${priceSymbol}${stripeBidPx.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : '—'}
                  </div>
                  <div className="text-[10px] text-red-400 font-medium">SELL</div>
                </div>
                <div className="flex-1 py-2 px-2 bg-green-900/25">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide">
                    {isUsdSpot ? (isCryptoOnly ? 'Ask ($)' : 'Ask (₹)') : 'Ask'}
                  </div>
                  <div className="text-base font-semibold text-white tabular-nums">
                    {stripeAskPx != null && !isNaN(stripeAskPx)
                      ? `${priceSymbol}${stripeAskPx.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : '—'}
                  </div>
                  <div className="text-[10px] text-green-400 font-medium">BUY</div>
                </div>
              </div>
              {marginPreview == null && (
                <div className="text-xs text-amber-400/95 mb-2">Loading margin preview…</div>
              )}
              {[
                ['Breakup / order lots', confirmBreakupCapLabel],
                ['Max lot', marginPreview?.maxLots != null ? String(marginPreview.maxLots) : '—'],
                ['Lot size', marginPreview?.lotSize != null ? String(marginPreview.lotSize) : String(lotSize ?? '—')],
                ['Time', confirmTickTimeLabel],
                ['Volume', confirmVolumeDisp],
                [
                  'Avg. price',
                  confirmAvgPriceNum != null
                    ? `${priceSymbol}${confirmAvgPriceNum.toLocaleString(isCryptoOnly ? 'en-US' : 'en-IN', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                    : '—',
                ],
                ['Min volume', confirmMinVolumeLabel],
                ['Volume step', confirmVolumeStepLabel],
                [
                  'Trade margin',
                  marginPreview?.marginRequired != null
                    ? `₹${Number(marginPreview.marginRequired).toLocaleString('en-IN', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                    : '—',
                ],
                ['Allow trades', marginPreview == null ? '…' : marginPreview.canPlace ? 'Yes' : 'No'],
                ['High', fmtPx(liveData?.high)],
                ['Low', fmtPx(liveData?.low)],
              ].map(([label, val]) => (
                <div key={label} className="flex justify-between gap-3 border-b border-dark-700/80 pb-2 last:border-0">
                  <span className="text-gray-400">{label}</span>
                  <span className="text-white text-right font-medium tabular-nums">{val}</span>
                </div>
              ))}
              {marginPreview?.lotsError && (
                <div className="text-xs text-red-400 pt-1">⚠️ {marginPreview.lotsError}</div>
              )}
            </div>
            <div className="p-4 border-t border-dark-600 flex gap-3">
              <button
                type="button"
                onClick={() => closeConfirmAndPlace('sell')}
                disabled={loading || marginPreview == null}
                className="flex-1 py-3 rounded-lg font-semibold bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white"
              >
                {loading ? '…' : 'SELL'}
              </button>
              <button
                type="button"
                onClick={() => closeConfirmAndPlace('buy')}
                disabled={loading || marginPreview == null}
                className="flex-1 py-3 rounded-lg font-semibold bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white"
              >
                {loading ? '…' : 'BUY'}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};

// Mobile Components - Uses watchlist like desktop
const MobileInstrumentsPanel = ({ selectedInstrument, onSelectInstrument, onBuySell, user, marketData = {}, onSegmentChange, cryptoOnly = false, mcxOnly = false, forexOnly = false, socketConnectEpoch = 0, usdRate = 83.5 }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [closedSearchResults, setClosedSearchResults] = useState([]);
  const [clientOpenDuration, setClientOpenDuration] = useState('7d');
  const [requestingToken, setRequestingToken] = useState(null);
  const [instrumentSearchTick, setInstrumentSearchTick] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [cryptoDerivBrowseList, setCryptoDerivBrowseList] = useState([]);
  const [cryptoDerivBrowseLoading, setCryptoDerivBrowseLoading] = useState(false);
  const [activeSegment, setActiveSegment] = useState(() => localStorage.getItem('stockex_active_segment') || 'FAVORITES');
  const [cryptoData, setCryptoData] = useState({});
  const searchInputRef = useRef(null);
  const [addingToSegment, setAddingToSegment] = useState(null);
  
  // Watchlist stored by segment (synced with server)
  const [watchlistBySegment, setWatchlistBySegment] = useState({
    'FAVORITES': [],
    'NSEFUT': [],
    'NSEOPT': [],
    'MCXFUT': [],
    'MCXOPT': [],
    'NSE-EQ': [],
    'BSE-FUT': [],
    'BSE-OPT': [],
    'CRYPTO': [],
    'CRYPTOFUT': [],
    'CRYPTOOPT': [],
    'FOREXFUT': [],
    'FOREXOPT': [],
    'FOREX': []
  });
  const [watchlistLoaded, setWatchlistLoaded] = useState(false);
  const mcxTickSubscribeTimerRef = useRef(null);
  
  // Segment tabs - filter based on cryptoOnly or mcxOnly mode
  const segmentTabs = forexOnly
    ? [
        { id: 'FOREXFUT', label: 'Forex Fut' },
        { id: 'FOREXOPT', label: 'Forex Opt' }
      ]
    : cryptoOnly 
    ? [
        { id: 'CRYPTO', label: '₿ Spot' },
        { id: 'CRYPTOFUT', label: 'Crypto Fut' },
        { id: 'CRYPTOOPT', label: 'Crypto Opt' }
      ]
    : mcxOnly
      ? [
          { id: 'FAVORITES', label: '★ Favorites' },
          { id: 'MCXFUT', label: 'MCX Futures' },
          { id: 'MCXOPT', label: 'MCX Options' }
        ]
      : [
          { id: 'FAVORITES', label: '★ Favorites' },
          { id: 'NSEFUT', label: 'NSEFUT' },
          { id: 'NSEOPT', label: 'NSEOPT' },
          { id: 'NSE-EQ', label: 'NSE-EQ' },
          { id: 'BSE-FUT', label: 'BSE-FUT' },
          { id: 'BSE-OPT', label: 'BSE-OPT' }
        ];
  
  // Set active segment based on mode
  useEffect(() => {
    if (forexOnly) {
      setActiveSegment('FOREXFUT');
    } else if (cryptoOnly) {
      setActiveSegment('CRYPTO');
    } else if (mcxOnly) {
      setActiveSegment('FAVORITES');
    }
  }, [cryptoOnly, mcxOnly, forexOnly]);
  
  // Load watchlist from server
  useEffect(() => {
    const loadWatchlist = async () => {
      if (!user?.token) return;
      try {
        const headers = { Authorization: `Bearer ${user.token}` };
        const { data } = await axios.get('/api/instruments/watchlist', { headers });
        const defaults = {
          FAVORITES: [], NSEFUT: [], NSEOPT: [], MCXFUT: [], MCXOPT: [], 'NSE-EQ': [], 'BSE-FUT': [], 'BSE-OPT': [],
          CRYPTO: [], CRYPTOFUT: [], CRYPTOOPT: [], FOREXFUT: [], FOREXOPT: [], FOREX: []
        };
        const merged = { ...defaults, ...(data || {}) };
        setWatchlistBySegment(mergeLegacyForexWatchlistBuckets(merged));
        setWatchlistLoaded(true);
      } catch (error) {
        console.error('Error loading watchlist:', error);
        setWatchlistLoaded(true);
      }
    };
    loadWatchlist();
  }, [user?.token]);

  // MCX wallet (mobile): subscribe Zerodha tokens for live ticks
  useEffect(() => {
    if (!mcxOnly || !user?.token || !watchlistLoaded) return;
    if (mcxTickSubscribeTimerRef.current) clearTimeout(mcxTickSubscribeTimerRef.current);
    mcxTickSubscribeTimerRef.current = setTimeout(async () => {
      mcxTickSubscribeTimerRef.current = null;
      const ids = new Set();
      const pushTok = (inst) => {
        if (!inst || inst.isCrypto || inst.isForex) return;
        if (isUsdSpotInstrument(inst)) return;
        const t = inst.token;
        if (t == null || t === '') return;
        const n = parseInt(String(t), 10);
        if (!Number.isNaN(n) && n > 0) ids.add(n);
      };
      ['FAVORITES', 'MCXFUT', 'MCXOPT'].forEach((seg) => {
        (watchlistBySegment[seg] || []).forEach(pushTok);
      });
      if (selectedInstrument?.token != null) {
        const n = parseInt(String(selectedInstrument.token), 10);
        if (!Number.isNaN(n) && n > 0) ids.add(n);
      }
      const tokens = [...ids];
      if (tokens.length === 0) return;
      try {
        await axios.post('/api/zerodha/tick-subscribe', { tokens }, {
          headers: { Authorization: `Bearer ${user.token}` },
        });
      } catch {
        /* tick-subscribe may fail until Kite is connected; server queues tokens */
      }
    }, 500);
    return () => {
      if (mcxTickSubscribeTimerRef.current) clearTimeout(mcxTickSubscribeTimerRef.current);
    };
  }, [mcxOnly, user?.token, watchlistLoaded, watchlistBySegment, selectedInstrument?.token, socketConnectEpoch]);

  useEffect(() => {
    if (
      activeSegment !== 'CRYPTOFUT' &&
      activeSegment !== 'CRYPTOOPT' &&
      activeSegment !== 'FOREXFUT' &&
      activeSegment !== 'FOREXOPT'
    ) {
      setCryptoDerivBrowseList([]);
      return;
    }
    if (!user?.token) return;
    let cancelled = false;
    (async () => {
      try {
        setCryptoDerivBrowseLoading(true);
        const headers = { Authorization: `Bearer ${user.token}` };
        const { data } = await axios.get(
          `/api/instruments/user?segment=${encodeURIComponent(activeSegment)}`,
          { headers }
        );
        if (!cancelled) {
          setCryptoDerivBrowseList(Array.isArray(data) ? data.slice(0, 150) : []);
        }
      } catch (e) {
        if (!cancelled) setCryptoDerivBrowseList([]);
      } finally {
        if (!cancelled) setCryptoDerivBrowseLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeSegment, user?.token]);
  
  // Notify parent when segment changes
  const handleSegmentChange = (segment) => {
    setActiveSegment(segment);
    setSearchTerm('');
    setShowSearchResults(false);
    try {
      localStorage.setItem('stockex_active_segment', segment);
    } catch (e) {
      // ignore storage errors
    }
    if (onSegmentChange) onSegmentChange(segment);
  };

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 200);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Global search using API - use crypto search in crypto-only mode
  useEffect(() => {
    const doSearch = async () => {
      const minSearchLen =
        activeSegment === 'CRYPTOFUT' ||
        activeSegment === 'CRYPTOOPT' ||
        activeSegment === 'FOREXFUT' ||
        activeSegment === 'FOREXOPT'
          ? 1
          : 2;
      if (debouncedSearch.length >= minSearchLen) {
        setIsSearching(true);
        setShowSearchResults(true);
        try {
          const headers = user?.token ? { Authorization: `Bearer ${user.token}` } : {};
          
          if (forexOnly) {
            const searchLower = debouncedSearch.toLowerCase();
            setSearchResults(
              DEFAULT_FOREX_INSTRUMENTS.filter(
                (f) =>
                  f.symbol.toLowerCase().includes(searchLower) ||
                  (f.name && f.name.toLowerCase().includes(searchLower))
              )
            );
            setClosedSearchResults([]);
          } else if (
            activeSegment === 'CRYPTOFUT' ||
            activeSegment === 'CRYPTOOPT' ||
            activeSegment === 'FOREXFUT' ||
            activeSegment === 'FOREXOPT'
          ) {
            const { data } = await axios.get(
              `/api/instruments/user?search=${encodeURIComponent(debouncedSearch)}&segment=${encodeURIComponent(activeSegment)}`,
              { headers }
            );
            setSearchResults(Array.isArray(data) ? data.slice(0, 200) : []);
            if (user?.token) {
              try {
                const { data: closed } = await axios.get(
                  `/api/instruments/client/closed-search?search=${encodeURIComponent(debouncedSearch)}&segment=${encodeURIComponent(activeSegment)}`,
                  { headers }
                );
                setClosedSearchResults(Array.isArray(closed) ? closed : []);
              } catch {
                setClosedSearchResults([]);
              }
            } else {
              setClosedSearchResults([]);
            }
          } else if (cryptoOnly) {
            // In crypto-only mode, search from local crypto list (spot tab)
            const cryptoList = [
              { symbol: 'BTC', name: 'Bitcoin', exchange: 'BINANCE', pair: 'BTCUSDT', isCrypto: true },
              { symbol: 'ETH', name: 'Ethereum', exchange: 'BINANCE', pair: 'ETHUSDT', isCrypto: true },
              { symbol: 'BNB', name: 'Binance Coin', exchange: 'BINANCE', pair: 'BNBUSDT', isCrypto: true },
              { symbol: 'XRP', name: 'Ripple', exchange: 'BINANCE', pair: 'XRPUSDT', isCrypto: true },
              { symbol: 'ADA', name: 'Cardano', exchange: 'BINANCE', pair: 'ADAUSDT', isCrypto: true },
              { symbol: 'DOGE', name: 'Dogecoin', exchange: 'BINANCE', pair: 'DOGEUSDT', isCrypto: true },
              { symbol: 'SOL', name: 'Solana', exchange: 'BINANCE', pair: 'SOLUSDT', isCrypto: true },
              { symbol: 'DOT', name: 'Polkadot', exchange: 'BINANCE', pair: 'DOTUSDT', isCrypto: true },
              { symbol: 'POL', name: 'Polygon', exchange: 'BINANCE', pair: 'POLUSDT', isCrypto: true },
              { symbol: 'LTC', name: 'Litecoin', exchange: 'BINANCE', pair: 'LTCUSDT', isCrypto: true },
              { symbol: 'AVAX', name: 'Avalanche', exchange: 'BINANCE', pair: 'AVAXUSDT', isCrypto: true },
              { symbol: 'LINK', name: 'Chainlink', exchange: 'BINANCE', pair: 'LINKUSDT', isCrypto: true },
              { symbol: 'ATOM', name: 'Cosmos', exchange: 'BINANCE', pair: 'ATOMUSDT', isCrypto: true },
              { symbol: 'UNI', name: 'Uniswap', exchange: 'BINANCE', pair: 'UNIUSDT', isCrypto: true },
              { symbol: 'XLM', name: 'Stellar', exchange: 'BINANCE', pair: 'XLMUSDT', isCrypto: true },
              { symbol: 'SHIB', name: 'Shiba Inu', exchange: 'BINANCE', pair: 'SHIBUSDT', isCrypto: true },
              { symbol: 'TRX', name: 'Tron', exchange: 'BINANCE', pair: 'TRXUSDT', isCrypto: true },
              { symbol: 'ETC', name: 'Ethereum Classic', exchange: 'BINANCE', pair: 'ETCUSDT', isCrypto: true },
              { symbol: 'XMR', name: 'Monero', exchange: 'BINANCE', pair: 'XMRUSDT', isCrypto: true },
              { symbol: 'APT', name: 'Aptos', exchange: 'BINANCE', pair: 'APTUSDT', isCrypto: true },
            ];
            const searchLower = debouncedSearch.toLowerCase();
            const filtered = cryptoList.filter(c => 
              c.symbol.toLowerCase().includes(searchLower) || 
              c.name.toLowerCase().includes(searchLower)
            );
            setSearchResults(filtered);
            setClosedSearchResults([]);
          } else {
            // Regular trading search - search ALL instruments globally (no segment filter)
            // Users can search any instrument and add to their watchlist
            const { data } = await axios.get(
              `/api/instruments/user?search=${encodeURIComponent(debouncedSearch)}`,
              { headers }
            );
            const nonCryptoResults = (data || []).filter(item => !item.isCrypto && item.exchange !== 'BINANCE');
            setSearchResults(nonCryptoResults.slice(0, 200)); // Limit display to 200 for performance
            if (user?.token) {
              try {
                let segParam = '';
                if (activeSegment && activeSegment !== 'FAVORITES') {
                  segParam = `&segment=${encodeURIComponent(activeSegment)}`;
                }
                const { data: closed } = await axios.get(
                  `/api/instruments/client/closed-search?search=${encodeURIComponent(debouncedSearch)}${segParam}`,
                  { headers }
                );
                setClosedSearchResults(Array.isArray(closed) ? closed : []);
              } catch {
                setClosedSearchResults([]);
              }
            } else {
              setClosedSearchResults([]);
            }
          }
        } catch (error) {
          setSearchResults([]);
          setClosedSearchResults([]);
        }
        setIsSearching(false);
      } else {
        setSearchResults([]);
        setClosedSearchResults([]);
        setShowSearchResults(false);
      }
    };
    doSearch();
  }, [debouncedSearch, user?.token, cryptoOnly, forexOnly, activeSegment, instrumentSearchTick]);
  
  // Get segment from exchange and instrument type automatically
  const getSegmentFromExchange = (exchange, instrumentType) => {
    if (exchange === 'MCX') {
      return instrumentType === 'OPTIONS' ? 'MCXOPT' : 'MCXFUT';
    }
    if (exchange === 'NFO') {
      return instrumentType === 'OPTIONS' ? 'NSEOPT' : 'NSEFUT';
    }
    if (exchange === 'BFO') {
      return instrumentType === 'OPTIONS' ? 'BSE-OPT' : 'BSE-FUT';
    }
    if (exchange === 'NSE') return 'NSE-EQ';
    if (exchange === 'BINANCE') {
      return instrumentType === 'OPTIONS' ? 'CRYPTOOPT' : instrumentType === 'FUTURES' ? 'CRYPTOFUT' : 'CRYPTO';
    }
    if (exchange === 'FOREX') {
      return instrumentType === 'OPTIONS' ? 'FOREXOPT' : 'FOREXFUT';
    }
    return 'NSEFUT';
  };

  // Add to watchlist - auto-detect segment and sync to server
  const addToWatchlist = async (instrument) => {
    const segment = instrument.isCrypto
      ? (instrument.displaySegment || getSegmentFromExchange(instrument.exchange, instrument.instrumentType))
      : instrument.isForex || instrument.exchange === 'FOREX'
        ? forexWatchlistSegmentFromInstrument(instrument)
        : getSegmentFromExchange(instrument.exchange, instrument.instrumentType);
    const currentList = watchlistBySegment[segment] || [];
    const identifier = isUsdSpotInstrument(instrument)
      ? String(instrument.pair || instrument.symbol || '').trim()
      : instrument.token;
    if (!identifier) return;
    if (currentList.some(i => watchlistInstrumentKey(i) === identifier)) return;
    
    setWatchlistBySegment(prev => ({
      ...prev,
      [segment]: [...(prev[segment] || []), instrument]
    }));
    setAddingToSegment(null);
    setSearchTerm('');
    setShowSearchResults(false);
    
    // Save to server
    if (user?.token) {
      try {
        const headers = { Authorization: `Bearer ${user.token}` };
        await axios.post('/api/instruments/watchlist/add', { instrument, segment }, { headers });
      } catch (error) {
        console.error('Error saving to watchlist:', error);
      }
    }
  };
  
  // Remove from watchlist and sync to server
  const removeFromWatchlist = async (instrument) => {
    const identifier = isUsdSpotInstrument(instrument)
      ? String(instrument.pair || instrument.symbol || '').trim()
      : instrument.token;
    setWatchlistBySegment(prev => ({
      ...prev,
      [activeSegment]: (prev[activeSegment] || []).filter(i => watchlistInstrumentKey(i) !== identifier)
    }));
    
    // Save to server
    if (user?.token) {
      try {
        const headers = { Authorization: `Bearer ${user.token}` };
        await axios.post('/api/instruments/watchlist/remove', { token: instrument.token, pair: instrument.pair, segment: activeSegment }, { headers });
      } catch (error) {
        console.error('Error removing from watchlist:', error);
      }
    }
  };
  
  // Check if in watchlist - support both token and pair for crypto
  const isInWatchlist = (instrument) => {
    const identifier = isUsdSpotInstrument(instrument)
      ? String(instrument.pair || instrument.symbol || '').trim()
      : instrument?.token;
    if (!identifier) return false;
    return Object.values(watchlistBySegment).some(list =>
      list.some(i => watchlistInstrumentKey(i) === identifier)
    );
  };

  const requestClientInstrumentAccess = async (inst) => {
    if (!user?.token || !inst?.token) return;
    setRequestingToken(String(inst.token));
    try {
      const headers = { Authorization: `Bearer ${user.token}` };
      await axios.post(
        '/api/instruments/client/request-open',
        { token: String(inst.token), duration: clientOpenDuration },
        { headers }
      );
      setClosedSearchResults((prev) => prev.filter((x) => String(x.token) !== String(inst.token)));
      setInstrumentSearchTick((t) => t + 1);
    } catch (error) {
      alert(error.response?.data?.message || error.message || 'Request failed');
    } finally {
      setRequestingToken(null);
    }
  };
  
  // Helper to check if instrument is MCX
  const isInstrumentMcx = (inst) => {
    const exchange = inst?.exchange?.toUpperCase() || '';
    const segment = inst?.segment?.toUpperCase() || '';
    return exchange === 'MCX' || segment === 'MCX' || segment === 'MCXFUT' || segment === 'MCXOPT';
  };

  // Get watchlist for current segment - filter favorites by mode
  const getWatchlist = () => {
    if (forexOnly || activeSegment === 'FOREXFUT' || activeSegment === 'FOREXOPT') {
      const key = activeSegment === 'FOREXOPT' ? 'FOREXOPT' : 'FOREXFUT';
      return watchlistBySegment[key] || [];
    }
    if (cryptoOnly || activeSegment === 'CRYPTO' || activeSegment === 'CRYPTOFUT' || activeSegment === 'CRYPTOOPT') {
      const key = activeSegment === 'CRYPTOFUT' ? 'CRYPTOFUT' : activeSegment === 'CRYPTOOPT' ? 'CRYPTOOPT' : 'CRYPTO';
      return watchlistBySegment[key] || [];
    }
    
    // For FAVORITES segment, filter based on mode
    if (activeSegment === 'FAVORITES') {
      const allFavorites = watchlistBySegment['FAVORITES'] || [];
      if (mcxOnly) {
        // MCX mode: only show MCX instruments in favorites
        return allFavorites.filter(inst => isInstrumentMcx(inst));
      } else {
        // Regular mode: only show non-MCX instruments in favorites
        return allFavorites.filter(inst => !isInstrumentMcx(inst));
      }
    }
    
    return watchlistBySegment[activeSegment] || [];
  };
  
  // Get price
  const getPrice = (token) => {
    if (token == null || token === '') return { ltp: 0, change: 0, changePercent: 0 };
    const s = String(token);
    const md = marketData[s] || marketData[Number.parseInt(s, 10)];
    if (md) return md;
    const list = getWatchlist();
    const inst = list.find((x) => String(x?.token ?? '') === s);
    const fallbackLtp = Number(inst?.ltp ?? inst?.lastPrice ?? inst?.close ?? inst?.previousClose ?? 0);
    if (Number.isFinite(fallbackLtp) && fallbackLtp > 0) {
      return { ltp: fallbackLtp, close: fallbackLtp, change: 0, changePercent: 0 };
    }
    return { ltp: 0, change: 0, changePercent: 0 };
  };
  
  // Fetch crypto data from Binance
  useEffect(() => {
    const fetchCryptoData = async () => {
      try {
        const { data } = await axios.get('/api/binance/prices');
        if (data && typeof data === 'object') {
          setCryptoData(data);
        }
      } catch (error) {
        console.warn(
          'Crypto REST prices unavailable (mobile):',
          error.response?.data?.message || error.message,
        );
      }
    };
    fetchCryptoData();
    const interval = setInterval(fetchCryptoData, 30000); // Every 30 seconds
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Segment Tabs */}
      <div className="flex gap-1 p-2 bg-dark-800 border-b border-dark-600 overflow-x-auto">
        {segmentTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => handleSegmentChange(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap transition ${
              activeSegment === tab.id 
                ? 'bg-green-600 text-white' 
                : 'bg-dark-700 text-gray-400 hover:bg-dark-600 hover:text-white'
            }`}
          >
            {tab.label} ({tab.id === 'FAVORITES' ? getWatchlist().length : (watchlistBySegment[tab.id] || []).length})
          </button>
        ))}
      </div>
      
      {/* Search */}
      <div className="p-3 bg-dark-800 border-b border-dark-600">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            ref={searchInputRef}
            type="text"
            placeholder={forexOnly ? 'Search FX pairs...' : cryptoOnly ? 'Search crypto...' : 'Search to add instruments...'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-dark-700 border border-dark-600 rounded-lg pl-10 pr-10 py-2 text-sm focus:outline-none focus:border-green-500"
          />
          {searchTerm && (
            <button 
              onClick={() => { setSearchTerm(''); setShowSearchResults(false); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Search Results with Add button */}
      {showSearchResults &&
      searchTerm.length >=
        (activeSegment === 'CRYPTOFUT' ||
        activeSegment === 'CRYPTOOPT' ||
        activeSegment === 'FOREXFUT' ||
        activeSegment === 'FOREXOPT'
          ? 1
          : 2) ? (
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 py-2 text-xs text-gray-400 bg-dark-700 sticky top-0 flex justify-between">
            <span>Search Results ({searchResults.length})</span>
            <button onClick={() => { setSearchTerm(''); setShowSearchResults(false); }} className="text-green-400">
              Back
            </button>
          </div>
          {isSearching ? (
            <div className="p-4 text-center text-gray-400">
              <RefreshCw className="animate-spin inline mr-2" size={16} />
              Searching...
            </div>
          ) : searchResults.length === 0 && closedSearchResults.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">No results for "{searchTerm}"</div>
          ) : (
            <>
              {searchResults.map((inst) => {
                const cannotTradeSearchRow = inst.isEnabled !== true;
                return (
                <div key={inst._id || inst.token} className="flex items-center justify-between px-3 py-2.5 border-b border-dark-700">
                  <div className="flex-1 min-w-0 mr-2">
                    <div className="font-bold text-sm text-white">{inst.tradingSymbol || inst.symbol}</div>
                    <div className="text-xs text-gray-500 truncate">{inst.category || inst.name} • {inst.exchange}</div>
                    {cannotTradeSearchRow && (
                      <div className="text-[10px] text-amber-300/95 mt-0.5 leading-tight">
                        Closed by broker — enable &quot;List trading&quot; in Super Admin Market Watch to allow trading
                      </div>
                    )}
                  </div>
                  {cannotTradeSearchRow ? (
                    <span className="text-xs text-amber-200/85 shrink-0">—</span>
                  ) : isInWatchlist(inst) ? (
                    <span className="text-xs text-green-400">✓ Added</span>
                  ) : (
                    <button
                      onClick={() => addToWatchlist(inst)}
                      className="bg-green-600 text-white text-xs px-2 py-1 rounded"
                    >
                      + Add
                    </button>
                  )}
                </div>
                );
              })}
              {closedSearchResults.length > 0 && (
                <div className="border-t border-amber-600/40">
                  <div className="px-3 py-2 text-xs text-amber-200/90 bg-dark-750">
                    Closed — request temporary access
                  </div>
                  <div className="px-3 py-2 flex flex-wrap items-center gap-2 text-xs text-gray-400 border-b border-dark-700">
                    <span>Duration:</span>
                    <select
                      value={clientOpenDuration}
                      onChange={(e) => setClientOpenDuration(e.target.value)}
                      className="bg-dark-700 border border-dark-600 rounded px-2 py-1 text-gray-200"
                    >
                      <option value="1d">1 day</option>
                      <option value="7d">7 days</option>
                      <option value="30d">30 days</option>
                      <option value="90d">90 days</option>
                    </select>
                  </div>
                  {closedSearchResults.map((inst) => (
                    <div
                      key={inst._id || inst.token}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 border-b border-dark-700"
                    >
                      <div className="flex-1 min-w-0 mr-2">
                        <div className="font-bold text-sm text-amber-200/90">{inst.tradingSymbol || inst.symbol}</div>
                        <div className="text-xs text-gray-500 truncate">{inst.category || inst.name} • {inst.exchange}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => requestClientInstrumentAccess(inst)}
                        disabled={requestingToken === String(inst.token)}
                        className="text-xs px-2 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white disabled:opacity-50"
                      >
                        {requestingToken === String(inst.token) ? '…' : 'Request'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        /* Watchlist for current segment */
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 py-2 text-xs text-gray-400 bg-dark-700 sticky top-0">
            {activeSegment === 'CRYPTO'
              ? '₿ Spot'
              : activeSegment === 'CRYPTOFUT'
                ? 'Crypto Futures'
                : activeSegment === 'CRYPTOOPT'
                  ? 'Crypto Options'
                  : activeSegment === 'FOREXFUT'
                    ? 'Forex Fut'
                    : activeSegment === 'FOREXOPT'
                      ? 'Forex Opt'
                      : activeSegment}{' '}
            Watchlist ({getWatchlist().length})
          </div>
          {/* Show default crypto list when in crypto mode and watchlist is empty */}
          {cryptoOnly && activeSegment === 'CRYPTO' && getWatchlist().length === 0 ? (
            <div>
              <div className="px-3 py-2 text-xs text-orange-400 bg-dark-750">
                Popular Cryptocurrencies - Click to add
              </div>
              {[
                { symbol: 'BTC', name: 'Bitcoin', exchange: 'BINANCE', pair: 'BTCUSDT', isCrypto: true },
                { symbol: 'ETH', name: 'Ethereum', exchange: 'BINANCE', pair: 'ETHUSDT', isCrypto: true },
                { symbol: 'BNB', name: 'Binance Coin', exchange: 'BINANCE', pair: 'BNBUSDT', isCrypto: true },
                { symbol: 'XRP', name: 'Ripple', exchange: 'BINANCE', pair: 'XRPUSDT', isCrypto: true },
                { symbol: 'SOL', name: 'Solana', exchange: 'BINANCE', pair: 'SOLUSDT', isCrypto: true },
                { symbol: 'DOGE', name: 'Dogecoin', exchange: 'BINANCE', pair: 'DOGEUSDT', isCrypto: true },
                { symbol: 'ADA', name: 'Cardano', exchange: 'BINANCE', pair: 'ADAUSDT', isCrypto: true },
                { symbol: 'POL', name: 'Polygon', exchange: 'BINANCE', pair: 'POLUSDT', isCrypto: true },
              ].map(crypto => {
                const priceData = cryptoData[crypto.pair] || marketData[crypto.pair] || { ltp: 0, changePercent: 0 };
                return (
                  <div
                    key={crypto.pair}
                    className="flex items-center justify-between px-3 py-2.5 border-b border-dark-700 hover:bg-dark-750"
                  >
                    <div className="flex-1 min-w-0 mr-2">
                      <div className="font-bold text-sm text-orange-400">{crypto.symbol}</div>
                      <div className="text-xs text-gray-500">{crypto.name}</div>
                    </div>
                    <div className="text-right mr-2">
                      <div className="text-sm font-medium text-gray-300">
                        {`$${spotQuoteDisplayPrice(
                          { ...crypto, segment: 'CRYPTO' },
                          priceData.ltp || 0,
                          usdRate
                        ).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => addToWatchlist(crypto)}
                        className="bg-green-600 text-white text-xs px-2 py-1 rounded"
                      >
                        + Add
                      </button>
                      <button onClick={() => onBuySell('sell', crypto)} className="w-6 h-6 rounded-full bg-red-500 text-white text-xs font-bold">S</button>
                      <button onClick={() => onBuySell('buy', crypto)} className="w-6 h-6 rounded-full bg-green-500 text-white text-xs font-bold">B</button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (activeSegment === 'CRYPTOFUT' ||
            activeSegment === 'CRYPTOOPT' ||
            activeSegment === 'FOREXFUT' ||
            activeSegment === 'FOREXOPT') &&
            getWatchlist().length === 0 ? (
            <div>
              <div className="px-3 py-2 text-xs text-yellow-400 bg-dark-750">
                {activeSegment === 'CRYPTOFUT'
                  ? 'USDT-M perpetuals — tap + Add (search to narrow)'
                  : activeSegment === 'CRYPTOOPT'
                    ? 'Crypto options — tap + Add (search to narrow)'
                    : activeSegment === 'FOREXOPT'
                      ? 'Forex options — tap + Add (search to narrow)'
                      : 'Forex futures / spot — tap + Add (search to narrow)'}
              </div>
              {cryptoDerivBrowseLoading ? (
                <div className="p-4 text-center text-gray-400 text-sm">
                  <RefreshCw className="animate-spin inline mr-2" size={16} />
                  Loading…
                </div>
              ) : cryptoDerivBrowseList.length === 0 ? (
                <div className="p-4 text-center text-gray-500 text-sm">No contracts returned.</div>
              ) : (
                cryptoDerivBrowseList.map((inst) => {
                  const q = inst.pair ? cryptoData[inst.pair] : null;
                  const pxUsd = Number(q?.ltp || inst.ltp || 0);
                  const displayLtp = spotPxToDisplayedInr(inst, pxUsd, usdRate);
                  return (
                    <div
                      key={inst.token || inst._id}
                      className="flex items-center justify-between px-3 py-2.5 border-b border-dark-700 hover:bg-dark-750"
                    >
                      <div className="flex-1 min-w-0 mr-2">
                        <div className={`font-bold text-xs truncate ${inst.instrumentType === 'FUTURES' ? 'text-yellow-400' : inst.optionType === 'CE' ? 'text-green-400' : 'text-red-400'}`}>
                          {inst.tradingSymbol || inst.symbol}
                        </div>
                        <div className="text-[10px] text-gray-500 truncate">Lot {inst.lotSize ?? '—'}</div>
                      </div>
                      <div className="text-right mr-1 text-xs text-gray-300 shrink-0">
                        ₹{displayLtp != null && !isNaN(displayLtp) ? displayLtp.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '--'}
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        {isInWatchlist(inst) ? (
                          <span className="text-[10px] text-green-400">✓</span>
                        ) : (
                          <button type="button" onClick={() => addToWatchlist(inst)} className="bg-green-600 text-white text-[10px] px-1.5 py-0.5 rounded">
                            +Add
                          </button>
                        )}
                        <button type="button" onClick={() => onBuySell('sell', inst)} className="w-6 h-6 rounded-full bg-red-500 text-white text-[10px] font-bold">S</button>
                        <button type="button" onClick={() => onBuySell('buy', inst)} className="w-6 h-6 rounded-full bg-green-500 text-white text-[10px] font-bold">B</button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : forexOnly && activeSegment === 'FOREXFUT' && getWatchlist().length === 0 ? (
            <div>
              <div className="px-3 py-2 text-xs text-cyan-400 bg-dark-750">
                Major FX pairs — tap Add, then trade (fund Forex wallet from Accounts)
              </div>
              {DEFAULT_FOREX_INSTRUMENTS.map((fx) => {
                const q = getCryptoMarketQuote(marketData, fx) || {};
                const ltpUsd = Number(q.ltp || q.close || 0);
                return (
                  <div
                    key={fx.pair}
                    className="flex items-center justify-between px-3 py-2.5 border-b border-dark-700 hover:bg-dark-750"
                  >
                    <div className="flex-1 min-w-0 mr-2">
                      <div className="font-bold text-sm text-cyan-400">{fx.symbol}</div>
                      <div className="text-xs text-gray-500 truncate">{fx.name}</div>
                    </div>
                    <div className="text-right mr-2">
                      <div className="text-sm font-medium text-gray-300">
                        ₹{spotPxToDisplayedInr(fx, ltpUsd, usdRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => addToWatchlist(fx)}
                        className="bg-green-600 text-white text-xs px-2 py-1 rounded"
                      >
                        + Add
                      </button>
                      <button
                        type="button"
                        onClick={() => onBuySell('sell', fx)}
                        className="w-6 h-6 rounded-full bg-red-500 text-white text-xs font-bold"
                      >
                        S
                      </button>
                      <button
                        type="button"
                        onClick={() => onBuySell('buy', fx)}
                        className="w-6 h-6 rounded-full bg-green-500 text-white text-xs font-bold"
                      >
                        B
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : getWatchlist().length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              <p>No instruments in {activeSegment} watchlist</p>
              <p className="mt-2 text-xs text-gray-600">Search to add instruments</p>
            </div>
          ) : (
            getWatchlist().map(inst => {
              const priceData = getPrice(inst.token);
              const pxNum = Number(priceData.ltp || 0);
              const priceLine = isUsdSpotInstrument(inst)
                ? `${isForexInstrument(inst) ? '₹' : '$'}${spotQuoteDisplayPrice(inst, pxNum, usdRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : pxNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              return (
                <div
                  key={inst.token}
                  onClick={() => onSelectInstrument({...inst, ltp: priceData.ltp || 0})}
                  className="flex flex-col px-3 py-2.5 border-b border-dark-700 hover:bg-dark-750"
                >
                  {/* Top row: Symbol and Price */}
                  <div className="flex items-center justify-between w-full">
                    <div className={`font-bold text-sm truncate max-w-[120px] ${
                      inst.instrumentType === 'FUTURES' ? 'text-yellow-400' :
                      inst.optionType === 'CE' ? 'text-green-400' :
                      inst.optionType === 'PE' ? 'text-red-400' : 'text-white'
                    }`}>{inst.tradingSymbol || inst.symbol?.replace(/"/g, '') || inst.symbol}</div>
                    <div className="text-sm text-gray-300 ml-2">{priceLine}</div>
                  </div>
                  {/* Bottom row: Category, Change %, and Buttons */}
                  <div className="flex items-center justify-between w-full mt-1">
                    <div className="flex items-center gap-2">
                      <div className="text-xs text-gray-500 truncate max-w-[80px]">{inst.category || inst.name}</div>
                      <div className={`text-xs ${parseFloat(priceData.changePercent || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {parseFloat(priceData.changePercent || 0) >= 0 ? '+' : ''}{parseFloat(priceData.changePercent || 0).toFixed(2)}%
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={(e) => { e.stopPropagation(); onBuySell('sell', inst); }} className="w-6 h-6 rounded-full bg-red-500 text-white text-xs font-bold">S</button>
                      <button onClick={(e) => { e.stopPropagation(); onBuySell('buy', inst); }} className="w-6 h-6 rounded-full bg-green-500 text-white text-xs font-bold">B</button>
                      <button onClick={(e) => { e.stopPropagation(); removeFromWatchlist(inst); }} className="w-6 h-6 rounded-full bg-dark-600 text-gray-400 hover:bg-red-600 hover:text-white">
                        <X size={12} className="mx-auto" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
        )}
      </div>
      )}
    </div>
  );
};

const MobileInstrumentRow = ({ instrument, isCall, isPut, isFuture, isCrypto, onSelect, onBuy, onSell }) => {
  const ltp = instrument.ltp || 0;
  const change = instrument.change || 0;
  const changePercent = instrument.changePercent || 0;
  
  // Check if crypto from instrument properties
  const isCryptoInstrument = isCrypto || instrument.isCrypto || instrument.segment === 'CRYPTO' || instrument.exchange === 'BINANCE';
  
  // Determine symbol color based on type (matching desktop InstrumentRow)
  const getSymbolColor = () => {
    if (isCryptoInstrument) return 'text-orange-400';
    if (isCall || instrument.optionType === 'CE') return 'text-green-400';
    if (isPut || instrument.optionType === 'PE') return 'text-red-400';
    if (isFuture || instrument.instrumentType === 'FUTURES') return 'text-yellow-400';
    return 'text-white';
  };
  
  // Format price - use $ for crypto, ₹ for others (matching desktop)
  const formatPrice = (price) => {
    if (!price || price <= 0) return '--';
    if (isCryptoInstrument) return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return `₹${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700">
      <div className="flex-1" onClick={onSelect}>
        <div className={`font-medium text-sm ${getSymbolColor()}`}>
          {instrument.symbol}
        </div>
        <div className="text-xs text-gray-500">
          {instrument.exchange} {instrument.strike ? `• ₹${instrument.strike}` : ''}
        </div>
      </div>
      <div className="text-right mr-3" onClick={onSelect}>
        <div className={`font-mono text-sm ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {formatPrice(ltp)}
        </div>
        <div className={`text-xs ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {changePercent ? `${change >= 0 ? '+' : ''}${parseFloat(changePercent).toFixed(2)}%` : '--'}
        </div>
      </div>
      {/* Buy/Sell Buttons - Indian Standard: S left, B right (matching desktop) */}
      <div className="flex gap-1">
        <button 
          onClick={onSell}
          className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 rounded font-medium"
        >
          S
        </button>
        <button 
          onClick={onBuy}
          className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 rounded font-medium"
        >
          B
        </button>
      </div>
    </div>
  );
};

const MobileChartPanel = ({ selectedInstrument, onBuySell, onBack, marketData = {}, usdRate = 83.5, onChartLtp }) => {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const candlestickSeriesRef = useRef(null);
  const lastCandleRef = useRef(null);

  const isCryptoInstr = selectedInstrument?.isCrypto || selectedInstrument?.exchange === 'BINANCE';
  const tokenStr =
    selectedInstrument?.token != null && String(selectedInstrument.token) !== ''
      ? String(selectedInstrument.token)
      : '';
  const livePrice = isCryptoInstr
    ? getCryptoMarketQuote(marketData, selectedInstrument)
    : tokenStr
      ? (marketData[tokenStr] ?? marketData[Number.parseInt(tokenStr, 10)])
      : null;

  useEffect(() => {
    if (!chartContainerRef.current || !selectedInstrument) return;

    const chart = createChart(chartContainerRef.current, {
      layout: { background: { color: '#111111' }, textColor: '#d1d5db' },
      grid: { vertLines: { color: '#1f1f1f' }, horzLines: { color: '#1f1f1f' } },
      rightPriceScale: { borderColor: '#2a2a2a' },
      timeScale: { borderColor: '#2a2a2a', timeVisible: true },
    });

    chartRef.current = chart;

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444',
      borderDownColor: '#ef4444', borderUpColor: '#22c55e',
      wickDownColor: '#ef4444', wickUpColor: '#22c55e',
    });

    candlestickSeriesRef.current = candlestickSeries;

    // Generate sample data based on current price
    const basePrice = selectedInstrument.ltp || 100;
    const candles = [];
    const now = Math.floor(Date.now() / 1000);
    for (let i = 100; i >= 0; i--) {
      const time = now - i * 900;
      const volatility = basePrice * 0.01;
      const open = basePrice + (Math.random() - 0.5) * volatility;
      const close = open + (Math.random() - 0.5) * volatility;
      const high = Math.max(open, close) + Math.random() * volatility * 0.3;
      const low = Math.min(open, close) - Math.random() * volatility * 0.3;
      candles.push({ time, open, high, low, close });
    }
    const displayCandles =
      selectedInstrument && isUsdSpotInstrument(selectedInstrument)
        ? candles.map((c) => scaleUsdSpotChartCandle(c, selectedInstrument, usdRate))
        : candles;
    candlestickSeries.setData(displayCandles);
    lastCandleRef.current = displayCandles[displayCandles.length - 1];
    const _lc = displayCandles[displayCandles.length - 1]?.close;
    if (Number.isFinite(Number(_lc)) && Number(_lc) > 0) onChartLtp?.(selectedInstrument?.token, Number(_lc));

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [selectedInstrument, usdRate, onChartLtp]);

  // Update chart with real-time price
  useEffect(() => {
    if (candlestickSeriesRef.current && lastCandleRef.current && livePrice?.ltp) {
      try {
        const raw = Number(livePrice.ltp);
        if (!Number.isFinite(raw)) return;
        const tick =
          selectedInstrument &&
          isUsdSpotInstrument(selectedInstrument) &&
          !isForexInstrument(selectedInstrument)
            ? raw
            : selectedInstrument && isUsdSpotInstrument(selectedInstrument)
              ? spotPxToDisplayedInr(selectedInstrument, raw, usdRate)
              : raw;
        const now = Math.floor(Date.now() / 1000);
        const candleTime = Math.floor(now / 900) * 900; // 15 min candles
        const lastTime = typeof lastCandleRef.current.time === 'number' 
          ? lastCandleRef.current.time 
          : Math.floor(Date.now() / 1000);
        
        // Only update if new candle time is >= last candle time
        if (candleTime >= lastTime) {
          if (lastTime === candleTime) {
            const updatedCandle = {
              time: candleTime,
              open: lastCandleRef.current.open,
              high: Math.max(lastCandleRef.current.high, tick),
              low: Math.min(lastCandleRef.current.low, tick),
              close: tick
            };
            lastCandleRef.current = updatedCandle;
            candlestickSeriesRef.current.update(updatedCandle);
          } else {
            const newCandle = {
              time: candleTime,
              open: tick,
              high: tick,
              low: tick,
              close: tick
            };
            lastCandleRef.current = newCandle;
            candlestickSeriesRef.current.update(newCandle);
          }
          const c = lastCandleRef.current?.close;
          if (Number.isFinite(Number(c)) && Number(c) > 0) onChartLtp?.(selectedInstrument?.token, Number(c));
        }
      } catch (err) {
        console.warn('Chart update error:', err.message);
      }
    }
  }, [livePrice, selectedInstrument, usdRate, onChartLtp]);

  return (
    <div className="flex-1 flex flex-col bg-dark-800">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-600">
        <button onClick={onBack} className="text-gray-400">
          <ChevronRight size={20} className="rotate-180" />
        </button>
        {selectedInstrument ? (
          <div className="text-center">
            <div className="font-medium text-green-400">{selectedInstrument.symbol}</div>
            <div className="flex items-center justify-center gap-2 text-xs">
              <span className="text-gray-400">{selectedInstrument.exchange}</span>
              {livePrice && (
                <>
                  <span className={`font-mono font-bold ${livePrice.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {selectedInstrument && isUsdSpotInstrument(selectedInstrument)
                      ? livePrice.ltp != null && !isNaN(livePrice.ltp)
                        ? `${isForexInstrument(selectedInstrument) ? '₹' : '$'}${spotQuoteDisplayPrice(selectedInstrument, livePrice.ltp || 0, usdRate).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                        : '--'
                      : livePrice.ltp != null && !isNaN(livePrice.ltp)
                        ? livePrice.ltp.toLocaleString()
                        : '--'}
                  </span>
                  <span className={`${livePrice.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {livePrice.change >= 0 ? '+' : ''}{(parseFloat(livePrice.changePercent) || 0).toFixed(2)}%
                  </span>
                </>
              )}
            </div>
          </div>
        ) : (
          <span className="text-gray-400">Select Instrument</span>
        )}
        <div className="w-5" />
      </div>

      {/* Chart */}
      <div className="flex-1 relative min-h-[250px]">
        {!selectedInstrument ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
            <RefreshCw size={40} className="mb-4 opacity-30" />
            <p className="text-sm">Select an instrument</p>
          </div>
        ) : (
          <div ref={chartContainerRef} className="absolute inset-0" />
        )}
      </div>

      {/* Timeframes */}
      {selectedInstrument && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 border-t border-dark-600">
          {['1m', '5m', '15m', '1h', '1d'].map(tf => (
            <button key={tf} className="px-3 py-1 text-sm text-gray-400 hover:bg-dark-600 rounded">
              {tf}
            </button>
          ))}
        </div>
      )}

      {/* Buy/Sell Buttons - Indian Standard: SELL left, BUY right */}
      {selectedInstrument && (
        <div className="flex gap-3 p-4 border-t border-dark-600">
          <button 
            onClick={() => onBuySell('sell', selectedInstrument)}
            className="flex-1 py-3 bg-red-600 hover:bg-red-700 rounded-lg font-semibold"
          >
            SELL
          </button>
          <button 
            onClick={() => onBuySell('buy', selectedInstrument)}
            className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold"
          >
            BUY
          </button>
        </div>
      )}
    </div>
  );
};

const MobilePositionsPanel = ({ activeTab, user, marketData, cryptoOnly = false, mcxOnly = false, forexOnly = false, walletData, usdRate = 83.5 }) => {
  const [tab, setTab] = useState(activeTab || 'positions');
  const [positions, setPositions] = useState([]);
  const [pendingOrders, setPendingOrders] = useState([]);
  const [history, setHistory] = useState([]);
  const [cancelledOrders, setCancelledOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [todayPnL, setTodayPnL] = useState({ realized: 0, unrealized: 0 });

  // Helper to check if trade is MCX
  const isMcxTrade = (item) => {
    const segment = item?.segment?.toUpperCase() || '';
    const exchange = item?.exchange?.toUpperCase() || '';
    return segment === 'MCX' || segment === 'MCXFUT' || segment === 'MCXOPT' || exchange === 'MCX';
  };

  const isForexTrade = (item) => isForexInstrument(item);

  // Filter by mode - crypto, forex, mcx, or regular
  const filterByMode = (items) => {
    if (cryptoOnly) {
      return (items || []).filter(item => item.isCrypto === true);
    }
    if (forexOnly) {
      return (items || []).filter(item => isForexTrade(item));
    }
    if (mcxOnly) {
      return (items || []).filter(item => isMcxTrade(item));
    }
    return (items || []).filter(
      item => item.isCrypto !== true && !isMcxTrade(item) && !isForexTrade(item)
    );
  };

  useEffect(() => {
    if (user?.token) {
      fetchAllData();
      const interval = setInterval(fetchAllData, 3000);
      return () => clearInterval(interval);
    }
  }, [user?.token, cryptoOnly, mcxOnly, forexOnly]);

  const fetchAllData = async () => {
    try {
      const headers = { Authorization: `Bearer ${user.token}` };
      const [posRes, pendingRes, historyRes] = await Promise.all([
        axios.get('/api/trading/positions?status=OPEN', { headers }),
        axios.get('/api/trading/pending-orders', { headers }),
        axios.get('/api/trading/history?limit=100', { headers })
      ]);
      const allPositions = filterByMode(posRes.data);
      const allPending = filterByMode(pendingRes.data);
      const allHistory = filterByMode(historyRes.data);
      
      // Apply netting logic - aggregate positions by symbol and net BUY vs SELL
      const netPositions = (positions) => {
        const bySymbol = {};
        for (const pos of positions) {
          const key = `${pos.symbol}_${pos.exchange || 'NSE'}`;
          if (!bySymbol[key]) {
            bySymbol[key] = { buys: [], sells: [] };
          }
          if (pos.side === 'BUY') {
            bySymbol[key].buys.push(pos);
          } else {
            bySymbol[key].sells.push(pos);
          }
        }
        
        const netted = [];
        for (const key of Object.keys(bySymbol)) {
          const { buys, sells } = bySymbol[key];
          
          let buyQty = 0, buyValue = 0, buyIds = [], buyCommission = 0;
          for (const b of buys) {
            buyQty += b.quantity;
            buyValue += b.quantity * b.entryPrice;
            buyIds.push(b._id);
            buyCommission += b.commission || 0;
          }
          const buyAvgPrice = buyQty > 0 ? buyValue / buyQty : 0;
          
          let sellQty = 0, sellValue = 0, sellIds = [], sellCommission = 0;
          for (const s of sells) {
            sellQty += s.quantity;
            sellValue += s.quantity * s.entryPrice;
            sellIds.push(s._id);
            sellCommission += s.commission || 0;
          }
          const sellAvgPrice = sellQty > 0 ? sellValue / sellQty : 0;
          
          const netQty = buyQty - sellQty;
          if (netQty === 0) continue;
          
          const template = buys[0] || sells[0];
          if (netQty > 0) {
            netted.push({
              ...template,
              side: 'BUY',
              quantity: netQty,
              entryPrice: buyAvgPrice,
              _ids: buyIds,
              _sellIds: sellIds,
              commission: buyCommission,
              isNetted: true
            });
          } else {
            netted.push({
              ...template,
              side: 'SELL',
              quantity: Math.abs(netQty),
              entryPrice: sellAvgPrice,
              _ids: sellIds,
              _buyIds: buyIds,
              commission: sellCommission,
              isNetted: true
            });
          }
        }
        return netted;
      };
      
      setPositions(netPositions(allPositions));
      setPendingOrders(allPending.filter(o => o.status === 'PENDING'));
      setCancelledOrders(allHistory.filter(o => o.status === 'CANCELLED' || o.closeReason === 'REJECTED'));
      setHistory(allHistory.filter(o => o.status === 'CLOSED'));
      
// ...
      // Calculate Today's P&L
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayTrades = allHistory.filter(t => new Date(t.closedAt) >= today);
      const realizedToday = todayTrades.reduce((sum, t) => sum + (t.realizedPnL || t.netPnL || 0), 0);
      
      // Calculate unrealized P&L from open positions
      let unrealizedToday = 0;
      allPositions.forEach(pos => {
        const ltp = getCurrentPrice(pos) || pos.currentPrice || pos.entryPrice;
        const pnl = pos.side === 'BUY' 
          ? (ltp - pos.entryPrice) * pos.quantity 
          : (pos.entryPrice - ltp) * pos.quantity;
        unrealizedToday += pnl;
      });
      
      setTodayPnL({ realized: realizedToday, unrealized: unrealizedToday });
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const handleClose = async (id, item) => {
    try {
      setLoading(true);
      const { bidPrice, askPrice } = getUsdSpotBidAsk(marketData, item);
      const isCryptoOnly = !!(item?.isCrypto || item?.segment === 'CRYPTO' || item?.exchange === 'BINANCE');
      const isForexPos = !!isForexInstrument(item);

      const idsToClose = item?._ids || [id];
      for (const posId of idsToClose) {
        await axios.post(`/api/trading/close/${posId}`, {
          bidPrice,
          askPrice,
          isCrypto: isCryptoOnly,
          isForex: isForexPos
        }, { headers: { Authorization: `Bearer ${user.token}` } });
      }
      fetchAllData();
    } catch (error) {
      alert(error.response?.data?.message || 'Error');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelOrder = async (id) => {
    try {
      setLoading(true);
      await axios.post(`/api/trading/cancel/${id}`, {}, { 
        headers: { Authorization: `Bearer ${user.token}` } 
      });
      fetchAllData();
    } catch (error) {
      alert(error.response?.data?.message || 'Error cancelling order');
    } finally {
      setLoading(false);
    }
  };

  const getCurrentPrice = (position) => {
    const side = position.side;
    const isC = isUsdSpotInstrument(position);
    if (isC) {
      const q = getCryptoMarketQuote(marketData, position);
      if (!q) return 0;
      const raw =
        side === 'BUY'
          ? Number(q.bid || q.ltp || q.close || 0)
          : Number(q.ask || q.ltp || q.close || 0);
      return spotPxToDisplayedInr(position, raw, usdRate);
    }

    const token = position.token;
    const symbol = position.symbol;

    let data = null;
    if (token && marketData?.[token]) {
      data = marketData[token];
    } else if (symbol && marketData?.[symbol]) {
      data = marketData[symbol];
    } else {
      for (const [, mData] of Object.entries(marketData || {})) {
        if (mData.symbol === symbol) {
          data = mData;
          break;
        }
      }
    }

    if (!data) return 0;

    if (side === 'BUY') {
      return data.bid || data.ltp || data.last_price || 0;
    }
    return data.ask || data.ltp || data.last_price || 0;
  };

  const tabs = [
    { id: 'positions', label: 'Positions', count: positions.length, icon: '📊' },
    { id: 'pending', label: 'Pending', count: pendingOrders.length, icon: '⏳' },
    { id: 'history', label: 'History', count: history.length, icon: '📜' },
    { id: 'cancelled', label: 'Cancelled', count: cancelledOrders.length, icon: '❌' }
  ];

  const currentData = tab === 'positions' ? positions 
    : tab === 'pending' ? pendingOrders 
    : tab === 'cancelled' ? cancelledOrders 
    : history;

  const totalPnL = todayPnL.realized + todayPnL.unrealized;

  return (
    <div className="flex-1 flex flex-col bg-dark-900">
      {/* Today's P&L Summary Card */}
      <div className="bg-gradient-to-r from-dark-800 to-dark-700 p-4 border-b border-dark-600">
        <div className="flex justify-between items-center mb-2">
          <span className="text-gray-400 text-sm font-medium">Today's P&L</span>
          <span className={`text-xl font-bold ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {totalPnL >= 0 ? '+' : ''}₹{totalPnL.toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <div>
            <span className="text-gray-500">Realized: </span>
            <span className={todayPnL.realized >= 0 ? 'text-green-400' : 'text-red-400'}>
              {todayPnL.realized >= 0 ? '+' : ''}₹{todayPnL.realized.toFixed(2)}
            </span>
          </div>
          <div>
            <span className="text-gray-500">Unrealized: </span>
            <span className={todayPnL.unrealized >= 0 ? 'text-green-400' : 'text-red-400'}>
              {todayPnL.unrealized >= 0 ? '+' : ''}₹{todayPnL.unrealized.toFixed(2)}
            </span>
          </div>
          <div>
            <span className="text-gray-500">Open: </span>
            <span className="text-blue-400">{positions.length}</span>
          </div>
        </div>
      </div>

      {/* Tabs - Professional Style */}
      <div className="flex bg-dark-800 border-b border-dark-600 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 min-w-max px-3 py-3 text-xs font-medium transition-all ${
              tab === t.id 
                ? 'text-green-400 border-b-2 border-green-500 bg-dark-700' 
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            <span className="mr-1">{t.icon}</span>
            {t.label}
            <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${
              tab === t.id ? 'bg-green-600 text-white' : 'bg-dark-600 text-gray-400'
            }`}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {currentData.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 h-64">
            <div className="text-center py-8">
              <div className="text-4xl mb-4 opacity-50">
                {tab === 'positions' ? '📊' : tab === 'pending' ? '⏳' : tab === 'cancelled' ? '❌' : '📜'}
              </div>
              <p className="text-gray-500">
                {tab === 'positions' ? 'No open positions' 
                  : tab === 'pending' ? 'No pending orders' 
                  : tab === 'cancelled' ? 'No cancelled orders'
                  : 'No trade history'}
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-dark-700">
            {currentData.map(item => {
              const ltp = getCurrentPrice(item) || item.currentPrice || item.entryPrice;
              const pnl = item.side === 'BUY' 
                ? (ltp - item.entryPrice) * item.quantity 
                : (item.entryPrice - ltp) * item.quantity;
              const isCrypto = item.isCrypto || item.segment === 'CRYPTO';
              const isCryptoRow = item.isCrypto || item.segment === 'CRYPTO' || item.exchange === 'BINANCE';
              const currencySymbol = '₹';
              const displayPnL = tab === 'history' || tab === 'cancelled' 
                ? (item.realizedPnL || item.netPnL || 0) 
                : pnl;
              const cryptoPxMobile = (inr) => {
                const n = parseFloat(inr);
                return Number.isFinite(n) && n !== 0 ? (n / usdRate).toFixed(2) : '0.00';
              };
              const fmtSlTpMobile = (raw) => {
                if (raw == null || raw === '') return '—';
                const n = parseFloat(raw);
                if (!Number.isFinite(n)) return '—';
                if (isCryptoRow) return `$${cryptoPxMobile(n)}`;
                return `${currencySymbol}${n.toFixed(2)}`;
              };
              
              // Calculate duration for history
              const getDuration = () => {
                if (!item.openedAt || !item.closedAt) return '';
                const diffMs = new Date(item.closedAt) - new Date(item.openedAt);
                if (diffMs < 0) return '';
                const diffMins = Math.floor(diffMs / 60000);
                if (diffMins < 60) return `${diffMins}m`;
                const diffHrs = Math.floor(diffMins / 60);
                return `${diffHrs}h ${diffMins % 60}m`;
              };
              
              return (
                <div key={item._id} className="p-3 bg-dark-800 hover:bg-dark-750 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold ${isCrypto ? 'text-orange-400' : 'text-white'}`}>
                          {item.symbol}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          item.side === 'BUY' 
                            ? 'bg-green-900/50 text-green-400' 
                            : 'bg-red-900/50 text-red-400'
                        }`}>
                          {item.side}
                        </span>
                        {tab === 'cancelled' && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/30 text-red-400">
                            {item.closeReason || 'CANCELLED'}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {item.lots || Math.floor(item.quantity / (item.lotSize || 1))} lots • {item.quantity} qty
                        {(tab === 'history' || tab === 'cancelled') && getDuration() && (
                          <span className="text-blue-400 ml-2">⏱ {getDuration()}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-bold text-lg ${displayPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {displayPnL >= 0 ? '+' : '-'}{currencySymbol}{Math.abs(displayPnL).toFixed(2)}
                      </div>
                      {tab === 'positions' && (
                        <div className="text-xs text-gray-500">
                          LTP: {currencySymbol}{(parseFloat(ltp) || 0).toFixed(2)}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Price Details */}
                  <div className="flex justify-between items-center text-xs mb-2">
                    <div className="flex gap-3">
                      <span className="text-gray-400">
                        Entry: <span className="text-white">{currencySymbol}{(item.entryPrice || 0).toFixed(2)}</span>
                      </span>
                      {(tab === 'history' || tab === 'cancelled') && item.exitPrice && (
                        <span className="text-gray-400">
                          Exit: <span className="text-white">{currencySymbol}{(item.exitPrice || 0).toFixed(2)}</span>
                        </span>
                      )}
                    </div>
                    <span className="text-yellow-400">
                      Charges: {currencySymbol}{(item.commission || 0).toFixed(2)}
                    </span>
                  </div>
                  
                  {tab === 'positions' && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mb-2">
                      <span className="text-gray-400">
                        SL: <span className="text-red-300">{fmtSlTpMobile(item.stopLoss)}</span>
                      </span>
                      <span className="text-gray-400">
                        TP: <span className="text-emerald-300">{fmtSlTpMobile(item.target)}</span>
                      </span>
                    </div>
                  )}
                  
                  {/* Actions */}
                  <div className="flex justify-between items-center">
                    <div className="text-xs text-gray-500">
                      {item.createdAt && new Date(item.closedAt || item.createdAt).toLocaleString('en-IN', {
                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                      })}
                    </div>
                    {tab === 'positions' && (
                      <button 
                        onClick={() => handleClose(item._id, item)}
                        disabled={loading}
                        className="px-4 py-1.5 bg-red-600 hover:bg-red-700 rounded-lg text-white text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        {loading ? 'Closing...' : 'Close Position'}
                      </button>
                    )}
                    {tab === 'pending' && (
                      <button 
                        onClick={() => handleCancelOrder(item._id)}
                        disabled={loading}
                        className="px-4 py-1.5 bg-yellow-600 hover:bg-yellow-700 rounded-lg text-white text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        {loading ? 'Cancelling...' : 'Cancel Order'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const MobileNotificationsContent = ({ user }) => {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 5000);
    return () => clearInterval(interval);
  }, [user?.token]);

  const fetchNotifications = async () => {
    try {
      const headers = { Authorization: `Bearer ${user.token}` };
      const [tradesRes, fundsRes] = await Promise.all([
        axios.get('/api/trading/history?limit=20', { headers }),
        axios.get('/api/user-funds/my-requests', { headers }).catch(() => ({ data: [] }))
      ]);
      
      const tradeNotifs = (tradesRes.data || []).map(trade => ({
        id: trade._id,
        type: 'trade',
        title: `${trade.side} ${trade.symbol}`,
        message: `${trade.quantity} qty @ ₹${trade.entryPrice?.toLocaleString()}`,
        pnl: trade.realizedPnL || 0,
        status: trade.closeReason || 'CLOSED',
        time: new Date(trade.closedAt || trade.createdAt),
        icon: trade.realizedPnL >= 0 ? '📈' : '📉'
      }));
      
      const fundNotifs = (fundsRes.data || []).map(fund => ({
        id: fund._id,
        type: 'fund',
        title: fund.type === 'DEPOSIT' ? 'Deposit Request' : 'Withdrawal Request',
        message: `₹${fund.amount?.toLocaleString()}`,
        status: fund.status,
        time: new Date(fund.updatedAt || fund.createdAt),
        icon: fund.type === 'DEPOSIT' ? '💰' : '💸'
      }));
      
      setNotifications([...tradeNotifs, ...fundNotifs].sort((a, b) => b.time - a.time));
    } catch (err) {
      console.error('Error fetching notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (date) => {
    const diff = Date.now() - date;
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(diff / 3600000);
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <RefreshCw size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
          <Bell size={48} className="mb-4 opacity-30" />
          <p>No notifications</p>
        </div>
      ) : (
        <div className="divide-y divide-dark-700">
          {notifications.map(notif => (
            <div key={notif.id} className="p-4">
              <div className="flex items-start gap-3">
                <span className="text-xl">{notif.icon}</span>
                <div className="flex-1">
                  <div className="flex justify-between">
                    <p className="font-medium text-sm">{notif.title}</p>
                    <span className="text-xs text-gray-500">{formatTime(notif.time)}</span>
                  </div>
                  <p className="text-sm text-gray-400">{notif.message}</p>
                  {notif.type === 'trade' ? (
                    <span className={`text-sm ${notif.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      P&L: {notif.pnl >= 0 ? '+' : ''}₹{notif.pnl.toFixed(2)}
                    </span>
                  ) : (
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      notif.status === 'APPROVED' ? 'text-green-400 bg-green-900/30' :
                      notif.status === 'REJECTED' ? 'text-red-400 bg-red-900/30' :
                      'text-yellow-400 bg-yellow-900/30'
                    }`}>
                      {notif.status}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const MobileProfilePanel = ({ user, walletData, onLogout }) => {
  const [activeSection, setActiveSection] = useState('menu'); // 'menu', 'history', 'settings', 'notifications', 'transfer'
  const [transactions, setTransactions] = useState([]);
  const [tradeHistory, setTradeHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Transfer broker states
  const [availableBrokers, setAvailableBrokers] = useState([]);
  const [brokerRequests, setBrokerRequests] = useState([]);
  const [selectedBroker, setSelectedBroker] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [loadingTransfer, setLoadingTransfer] = useState(false);
  const [transferMessage, setTransferMessage] = useState(null);

  useEffect(() => {
    if (activeSection === 'history') {
      fetchHistory();
      const interval = setInterval(fetchHistory, 2000);
      return () => clearInterval(interval);
    }
    if (activeSection === 'transfer') {
      fetchAvailableBrokers();
      fetchBrokerRequests();
    }
  }, [activeSection, user?.token]);
  
  const fetchAvailableBrokers = async () => {
    try {
      const { data } = await axios.get('/api/user/available-brokers', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setAvailableBrokers(data);
    } catch (err) {
      console.error('Error fetching brokers:', err);
    }
  };
  
  const fetchBrokerRequests = async () => {
    try {
      const { data } = await axios.get('/api/user/broker-change-requests', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setBrokerRequests(data);
    } catch (err) {
      console.error('Error fetching broker requests:', err);
    }
  };
  
  const handleSubmitTransferRequest = async () => {
    if (!selectedBroker) {
      setTransferMessage({ type: 'error', text: 'Please select a broker/admin' });
      return;
    }
    try {
      setLoadingTransfer(true);
      setTransferMessage(null);
      await axios.post('/api/user/broker-change-request', {
        requestedAdminCode: selectedBroker,
        reason: transferReason
      }, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setTransferMessage({ type: 'success', text: 'Request submitted!' });
      setSelectedBroker('');
      setTransferReason('');
      fetchBrokerRequests();
    } catch (err) {
      setTransferMessage({ type: 'error', text: err.response?.data?.message || 'Failed' });
    } finally {
      setLoadingTransfer(false);
    }
  };
  
  const handleCancelRequest = async (requestId) => {
    if (!confirm('Cancel this request?')) return;
    try {
      await axios.delete(`/api/user/broker-change-request/${requestId}`, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      fetchBrokerRequests();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed');
    }
  };

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const headers = { Authorization: `Bearer ${user.token}` };
      const [tradesRes, fundsRes] = await Promise.all([
        axios.get('/api/trading/history', { headers }),
        axios.get('/api/user-funds/my-requests', { headers }).catch(() => ({ data: [] }))
      ]);
      setTradeHistory(tradesRes.data || []);
      setTransactions(fundsRes.data || []);
    } catch (err) {
      console.error('Error fetching history:', err);
    } finally {
      setLoading(false);
    }
  };

  if (activeSection === 'history') {
    return (
      <div className="flex-1 flex flex-col bg-dark-800">
        <div className="flex items-center gap-3 p-4 border-b border-dark-600">
          <button onClick={() => setActiveSection('menu')} className="text-gray-400">
            <ChevronRight size={20} className="rotate-180" />
          </button>
          <h2 className="font-bold">Transaction History</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && tradeHistory.length === 0 ? (
            <div className="flex items-center justify-center h-32">
              <RefreshCw size={24} className="animate-spin text-gray-400" />
            </div>
          ) : (
            <>
              {/* Fund Transactions */}
              {transactions.length > 0 && (
                <div className="p-4 border-b border-dark-600">
                  <h3 className="text-sm text-gray-400 mb-3">Fund Requests</h3>
                  {transactions.slice(0, 5).map(tx => (
                    <div key={tx._id} className="flex justify-between items-center py-2 border-b border-dark-700 last:border-0">
                      <div>
                        <p className="font-medium text-sm">{tx.type}</p>
                        <p className="text-xs text-gray-400">{new Date(tx.createdAt).toLocaleDateString()}</p>
                      </div>
                      <div className="text-right">
                        <p className={`font-medium ${tx.type === 'DEPOSIT' ? 'text-green-400' : 'text-red-400'}`}>
                          {tx.type === 'DEPOSIT' ? '+' : '-'}₹{tx.amount?.toLocaleString()}
                        </p>
                        <p className={`text-xs ${tx.status === 'APPROVED' ? 'text-green-400' : tx.status === 'REJECTED' ? 'text-red-400' : 'text-yellow-400'}`}>
                          {tx.status}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Referral Amount */}
              <div className="p-4 border-b border-dark-600">
                <button 
                  onClick={() => { setShowReferralModal(true); }}
                  className="w-full bg-purple-600 hover:bg-purple-700 py-3 rounded-lg flex items-center justify-center gap-2 text-white font-medium transition-colors"
                >
                  <Share2 size={18} />
                  View Referral Earnings
                </button>
                <p className="text-xs text-gray-500 mt-2 text-center">
                  See all your referral earnings and details
                </p>
              </div>

              {/* Trade History */}
              <div className="p-4">
                <h3 className="text-sm text-gray-400 mb-3">Trade History</h3>
                {tradeHistory.length === 0 ? (
                  <p className="text-center text-gray-500 py-8">No trade history</p>
                ) : (
                  tradeHistory.slice(0, 20).map(trade => (
                    <div key={trade._id} className="flex justify-between items-center py-2 border-b border-dark-700 last:border-0">
                      <div>
                        <p className="font-medium text-sm">{trade.symbol}</p>
                        <p className="text-xs text-gray-400">
                          {trade.side} • {trade.quantity} qty • {new Date(trade.closedAt || trade.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`font-medium ${(trade.realizedPnL || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {(trade.realizedPnL || 0) >= 0 ? '+' : ''}₹{(trade.realizedPnL || 0).toFixed(2)}
                        </p>
                        <p className="text-xs text-gray-400">{trade.closeReason || 'CLOSED'}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (activeSection === 'notifications') {
    return (
      <div className="flex-1 flex flex-col bg-dark-800">
        <div className="flex items-center gap-3 p-4 border-b border-dark-600">
          <button onClick={() => setActiveSection('menu')} className="text-gray-400">
            <ChevronRight size={20} className="rotate-180" />
          </button>
          <h2 className="font-bold">Notifications</h2>
        </div>
        <MobileNotificationsContent user={user} />
      </div>
    );
  }

  if (activeSection === 'settings') {
    return (
      <div className="flex-1 flex flex-col bg-dark-800">
        <div className="flex items-center gap-3 p-4 border-b border-dark-600">
          <button onClick={() => setActiveSection('menu')} className="text-gray-400">
            <ChevronRight size={20} className="rotate-180" />
          </button>
          <h2 className="font-bold">Settings</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="bg-dark-700 rounded-lg p-4">
            <h3 className="font-medium mb-3">Account Info</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Username</span>
                <span>{user?.username}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Email</span>
                <span>{user?.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">User ID</span>
                <span className="font-mono text-xs">{user?.userId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Admin Code</span>
                <span className="font-mono text-xs">{user?.adminCode}</span>
              </div>
            </div>
          </div>
          <div className="bg-dark-700 rounded-lg p-4">
            <h3 className="font-medium mb-3">Trading Settings</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Trading Status</span>
                <span className={user?.tradingStatus === 'ACTIVE' ? 'text-green-400' : 'text-red-400'}>
                  {user?.tradingStatus || 'ACTIVE'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Account Status</span>
                <span className={user?.isActive ? 'text-green-400' : 'text-red-400'}>
                  {user?.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          </div>
          <div className="bg-dark-700 rounded-lg p-4">
            <h3 className="font-medium mb-3">App Info</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Version</span>
                <span>1.0.0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Platform</span>
                <span>Web</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (activeSection === 'transfer') {
    return (
      <div className="flex-1 flex flex-col bg-dark-800">
        <div className="flex items-center gap-3 p-4 border-b border-dark-600">
          <button onClick={() => setActiveSection('menu')} className="text-gray-400">
            <ChevronRight size={20} className="rotate-180" />
          </button>
          <h2 className="font-bold">Change Broker</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {transferMessage && (
            <div className={`p-3 rounded-lg text-sm ${transferMessage.type === 'error' ? 'bg-red-900/50 text-red-400' : 'bg-green-900/50 text-green-400'}`}>
              {transferMessage.text}
            </div>
          )}
          
          <div className="bg-dark-700 rounded-lg p-4">
            <h3 className="font-medium mb-2">Current Broker</h3>
            <p className="text-green-400 font-mono">{user?.adminCode}</p>
          </div>
          
          <div className="bg-dark-700 rounded-lg p-4">
            <h3 className="font-medium mb-3">Request Transfer</h3>
            <p className="text-xs text-gray-400 mb-3">
              Submit a request to transfer to a different broker. Super Admin will review your request.
            </p>
            
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Select New Broker</label>
                <select
                  value={selectedBroker}
                  onChange={(e) => setSelectedBroker(e.target.value)}
                  className="w-full bg-dark-600 border border-dark-500 rounded-lg px-3 py-2"
                >
                  <option value="">-- Select --</option>
                  {availableBrokers.map(broker => (
                    <option key={broker._id} value={broker.adminCode}>
                      {broker.name || broker.username} ({broker.adminCode})
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm text-gray-400 mb-1">Reason (Optional)</label>
                <textarea
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                  className="w-full bg-dark-600 border border-dark-500 rounded-lg px-3 py-2 h-16 resize-none"
                  placeholder="Why do you want to transfer?"
                />
              </div>
              
              <button
                onClick={handleSubmitTransferRequest}
                disabled={loadingTransfer || !selectedBroker}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-600 py-2 rounded-lg font-medium"
              >
                {loadingTransfer ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </div>
          
          {brokerRequests.length > 0 && (
            <div className="bg-dark-700 rounded-lg p-4">
              <h3 className="font-medium mb-3">Your Requests</h3>
              <div className="space-y-2">
                {brokerRequests.map(req => (
                  <div key={req._id} className="bg-dark-600 rounded p-3 text-sm">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-gray-400">To: </span>
                        <span>{req.requestedAdmin?.name || req.requestedAdminCode}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        req.status === 'PENDING' ? 'bg-yellow-500/20 text-yellow-400' :
                        req.status === 'APPROVED' ? 'bg-green-500/20 text-green-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                        {req.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {new Date(req.createdAt).toLocaleDateString()}
                    </div>
                    {req.status === 'PENDING' && (
                      <button
                        onClick={() => handleCancelRequest(req._id)}
                        className="mt-2 text-xs text-red-400"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-dark-800">
      {/* Profile Header */}
      <div className="p-6 text-center border-b border-dark-600">
        <div className="w-20 h-20 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <UserCircle size={48} />
        </div>
        <h2 className="text-xl font-bold">{user?.fullName || user?.username}</h2>
        <p className="text-gray-400 text-sm">@{user?.username}</p>
      </div>

      {/* Wallet Info */}
      <div className="p-4 border-b border-dark-600">
        <div className="bg-dark-700 rounded-xl p-4">
          <p className="text-gray-400 text-sm mb-1">Trading Balance</p>
          <p className="text-2xl font-bold text-green-400">
            ₹{(walletData?.tradingBalance || walletData?.wallet?.tradingBalance || 0).toLocaleString()}
          </p>
          <div className="flex justify-between mt-2 text-sm">
            <span className="text-gray-400">Available Margin</span>
            <span className="text-green-400">₹{walletData?.availableMargin?.toLocaleString() || '0.00'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Used Margin</span>
            <span className="text-yellow-400">₹{walletData?.usedMargin?.toLocaleString() || '0.00'}</span>
          </div>
        </div>
      </div>

      {/* Menu Items */}
      <div className="flex-1 p-4">
        <button 
          onClick={() => setActiveSection('settings')}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-dark-700 rounded-lg text-left"
        >
          <Settings size={20} className="text-gray-400" />
          <span>Settings</span>
          <ChevronRight size={16} className="ml-auto text-gray-500" />
        </button>
        <button 
          onClick={() => setActiveSection('transfer')}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-dark-700 rounded-lg text-left"
        >
          <RefreshCw size={20} className="text-gray-400" />
          <span>Change Broker</span>
          <ChevronRight size={16} className="ml-auto text-gray-500" />
        </button>
        <button 
          onClick={() => setActiveSection('notifications')}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-dark-700 rounded-lg text-left"
        >
          <Bell size={20} className="text-gray-400" />
          <span>Notifications</span>
          <ChevronRight size={16} className="ml-auto text-gray-500" />
        </button>
        <button 
          onClick={() => setActiveSection('history')}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-dark-700 rounded-lg text-left"
        >
          <History size={20} className="text-gray-400" />
          <span>Transaction History</span>
          <ChevronRight size={16} className="ml-auto text-gray-500" />
        </button>
      </div>

      {/* Logout */}
      <div className="p-4 border-t border-dark-600">
        <button 
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 py-3 bg-red-600 hover:bg-red-700 rounded-lg font-medium"
        >
          <LogOut size={20} />
          Logout
        </button>
      </div>
    </div>
  );
};

const NotificationsModal = ({ onClose, user }) => {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all'); // 'all', 'trades', 'funds', 'announcements'

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 5000);
    return () => clearInterval(interval);
  }, [user?.token]);

  const fetchNotifications = async () => {
    try {
      const headers = { Authorization: `Bearer ${user.token}` };
      
      // Fetch trades (closed), fund requests, and admin notifications
      const [tradesRes, fundsRes, announcementsRes] = await Promise.all([
        axios.get('/api/trading/history?limit=20', { headers }),
        axios.get('/api/user-funds/my-requests', { headers }).catch(() => ({ data: [] })),
        axios.get('/api/notifications/user', { headers }).catch(() => ({ data: [] }))
      ]);
      
      // Convert to notifications format
      const tradeNotifications = (tradesRes.data || []).map(trade => ({
        id: trade._id,
        type: 'trade',
        title: `${trade.side} ${trade.symbol}`,
        message: `${trade.quantity} qty @ ₹${trade.entryPrice?.toLocaleString()} → ₹${trade.exitPrice?.toLocaleString()}`,
        pnl: trade.realizedPnL || 0,
        status: trade.closeReason || 'CLOSED',
        time: new Date(trade.closedAt || trade.createdAt),
        icon: trade.realizedPnL >= 0 ? '📈' : '📉'
      }));
      
      const fundNotifications = (fundsRes.data || []).map(fund => ({
        id: fund._id,
        type: 'fund',
        title: fund.type === 'DEPOSIT' ? 'Deposit Request' : 'Withdrawal Request',
        message: `₹${fund.amount?.toLocaleString()}`,
        status: fund.status,
        time: new Date(fund.updatedAt || fund.createdAt),
        icon: fund.type === 'DEPOSIT' ? '💰' : '💸',
        isDeposit: fund.type === 'DEPOSIT'
      }));

      const announcementNotifications = (announcementsRes.data || []).map(notif => ({
        id: notif._id,
        type: 'announcement',
        title: notif.title,
        subject: notif.subject,
        message: notif.description,
        image: notif.image,
        time: new Date(notif.createdAt),
        icon: '📢',
        isRead: notif.isRead
      }));
      
      // Combine and sort by time
      const allNotifications = [...tradeNotifications, ...fundNotifications, ...announcementNotifications]
        .sort((a, b) => b.time - a.time);
      
      setNotifications(allNotifications);
    } catch (err) {
      console.error('Error fetching notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (notifId) => {
    try {
      await axios.put(`/api/notifications/${notifId}/read`, {}, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setNotifications(prev => prev.map(n => 
        n.id === notifId ? { ...n, isRead: true } : n
      ));
    } catch (err) {
      console.error('Error marking notification as read:', err);
    }
  };

  const filteredNotifications = notifications.filter(n => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'trades') return n.type === 'trade';
    if (activeFilter === 'funds') return n.type === 'fund';
    if (activeFilter === 'announcements') return n.type === 'announcement';
    return true;
  });

  const getStatusColor = (status) => {
    switch (status) {
      case 'APPROVED': return 'text-green-400';
      case 'REJECTED': return 'text-red-400';
      case 'PENDING': return 'text-yellow-400';
      case 'MANUAL': case 'CLOSED': return 'text-gray-400';
      case 'SL_HIT': return 'text-red-400';
      case 'TARGET_HIT': return 'text-green-400';
      default: return 'text-gray-400';
    }
  };

  const formatTime = (date) => {
    const now = new Date();
    const diff = now - date;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-xl w-full max-w-md max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-dark-600">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Bell size={20} /> Notifications
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        {/* Filter Tabs */}
        <div className="flex border-b border-dark-600">
          {[
            { id: 'all', label: 'All' },
            { id: 'announcements', label: 'Announcements' },
            { id: 'trades', label: 'Trades' },
            { id: 'funds', label: 'Funds' }
          ].map(filter => (
            <button
              key={filter.id}
              onClick={() => setActiveFilter(filter.id)}
              className={`flex-1 py-2 text-sm font-medium ${activeFilter === filter.id ? 'text-green-400 border-b-2 border-green-400' : 'text-gray-400'}`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {/* Notifications List */}
        <div className="overflow-y-auto max-h-[60vh]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw size={24} className="animate-spin text-gray-400" />
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <Bell size={48} className="mb-4 opacity-30" />
              <p>No notifications</p>
            </div>
          ) : (
            <div className="divide-y divide-dark-700">
              {filteredNotifications.map(notif => (
                <div 
                  key={notif.id} 
                  className={`p-4 hover:bg-dark-700/50 ${notif.type === 'announcement' && !notif.isRead ? 'bg-orange-900/10 border-l-2 border-orange-500' : ''}`}
                  onClick={() => notif.type === 'announcement' && !notif.isRead && markAsRead(notif.id)}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{notif.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className={`font-medium text-sm ${notif.type === 'announcement' && !notif.isRead ? 'text-orange-400' : ''}`}>{notif.title}</p>
                        <span className="text-xs text-gray-500">{formatTime(notif.time)}</span>
                      </div>
                      {notif.type === 'announcement' && notif.subject && (
                        <p className="text-sm text-gray-300 mt-0.5 font-medium">{notif.subject}</p>
                      )}
                      <p className="text-sm text-gray-400 mt-0.5">{notif.message}</p>
                      {notif.type === 'announcement' && notif.image && (
                        <img src={notif.image} alt="Notification" className="mt-2 rounded-lg max-h-32 object-cover" />
                      )}
                      <div className="flex items-center justify-between mt-1">
                        {notif.type === 'trade' ? (
                          <span className={`text-sm font-medium ${notif.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            P&L: {notif.pnl >= 0 ? '+' : ''}₹{notif.pnl.toFixed(2)}
                          </span>
                        ) : notif.type === 'fund' ? (
                          <span className={`text-xs px-2 py-0.5 rounded ${getStatusColor(notif.status)} bg-dark-600`}>
                            {notif.status}
                          </span>
                        ) : notif.type === 'announcement' ? (
                          <span className={`text-xs px-2 py-0.5 rounded ${notif.isRead ? 'text-gray-500 bg-dark-600' : 'text-orange-400 bg-orange-900/30'}`}>
                            {notif.isRead ? 'Read' : 'New'}
                          </span>
                        ) : null}
                        {notif.type === 'trade' && (
                          <span className={`text-xs ${getStatusColor(notif.status)}`}>
                            {notif.status}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const SettingsModal = ({ onClose, user }) => {
  const [activeSection, setActiveSection] = useState('account'); // 'account', 'password', 'margin', 'transfer'
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [marginData, setMarginData] = useState(null);
  const [loadingMargin, setLoadingMargin] = useState(false);
  
  // Broker transfer states
  const [availableBrokers, setAvailableBrokers] = useState([]);
  const [brokerRequests, setBrokerRequests] = useState([]);
  const [selectedBroker, setSelectedBroker] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [loadingTransfer, setLoadingTransfer] = useState(false);
  const [transferMessage, setTransferMessage] = useState(null);

  // Fetch margin/exposure settings
  useEffect(() => {
    if (activeSection === 'margin') {
      fetchMarginSettings();
    }
    if (activeSection === 'transfer') {
      fetchAvailableBrokers();
      fetchBrokerRequests();
    }
  }, [activeSection]);
  
  const fetchAvailableBrokers = async () => {
    try {
      const { data } = await axios.get('/api/user/available-brokers', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setAvailableBrokers(data);
    } catch (err) {
      console.error('Error fetching brokers:', err);
    }
  };
  
  const fetchBrokerRequests = async () => {
    try {
      const { data } = await axios.get('/api/user/broker-change-requests', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setBrokerRequests(data);
    } catch (err) {
      console.error('Error fetching broker requests:', err);
    }
  };
  
  const handleSubmitTransferRequest = async () => {
    if (!selectedBroker) {
      setTransferMessage({ type: 'error', text: 'Please select a broker/admin to transfer to' });
      return;
    }
    
    try {
      setLoadingTransfer(true);
      setTransferMessage(null);
      await axios.post('/api/user/broker-change-request', {
        requestedAdminCode: selectedBroker,
        reason: transferReason
      }, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setTransferMessage({ type: 'success', text: 'Transfer request submitted successfully!' });
      setSelectedBroker('');
      setTransferReason('');
      fetchBrokerRequests();
    } catch (err) {
      setTransferMessage({ type: 'error', text: err.response?.data?.message || 'Failed to submit request' });
    } finally {
      setLoadingTransfer(false);
    }
  };
  
  const handleCancelRequest = async (requestId) => {
    if (!confirm('Cancel this transfer request?')) return;
    try {
      await axios.delete(`/api/user/broker-change-request/${requestId}`, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      fetchBrokerRequests();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to cancel request');
    }
  };

  const fetchMarginSettings = async () => {
    try {
      setLoadingMargin(true);
      const { data } = await axios.get('/api/user/settings', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setMarginData(data);
    } catch (err) {
      console.error('Error fetching margin settings:', err);
    } finally {
      setLoadingMargin(false);
    }
  };

  const handleChangePassword = async () => {
    if (!oldPassword || !newPassword || !confirmPassword) {
      setMessage({ type: 'error', text: 'Please fill all fields' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'New passwords do not match' });
      return;
    }
    if (newPassword.length < 6) {
      setMessage({ type: 'error', text: 'Password must be at least 6 characters' });
      return;
    }

    try {
      setLoading(true);
      await axios.post('/api/user/change-password', {
        oldPassword,
        newPassword
      }, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setMessage({ type: 'success', text: 'Password changed successfully!' });
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.message || 'Failed to change password' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-xl w-full max-w-md max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-dark-600">
          <h2 className="text-lg font-bold">Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-dark-600 overflow-x-auto">
          <button
            onClick={() => setActiveSection('account')}
            className={`flex-1 py-3 text-xs font-medium whitespace-nowrap ${activeSection === 'account' ? 'text-green-400 border-b-2 border-green-400' : 'text-gray-400'}`}
          >
            Account
          </button>
          <button
            onClick={() => setActiveSection('margin')}
            className={`flex-1 py-3 text-xs font-medium whitespace-nowrap ${activeSection === 'margin' ? 'text-green-400 border-b-2 border-green-400' : 'text-gray-400'}`}
          >
            Margin
          </button>
          <button
            onClick={() => setActiveSection('transfer')}
            className={`flex-1 py-3 text-xs font-medium whitespace-nowrap ${activeSection === 'transfer' ? 'text-green-400 border-b-2 border-green-400' : 'text-gray-400'}`}
          >
            Transfer
          </button>
          <button
            onClick={() => setActiveSection('password')}
            className={`flex-1 py-3 text-xs font-medium whitespace-nowrap ${activeSection === 'password' ? 'text-green-400 border-b-2 border-green-400' : 'text-gray-400'}`}
          >
            Password
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto max-h-[60vh]">
          {activeSection === 'account' && (
            <div className="space-y-4">
              <div className="bg-dark-700 rounded-lg p-4">
                <h3 className="font-medium mb-3">Account Information</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Username</span>
                    <span>{user?.username}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Full Name</span>
                    <span>{user?.fullName || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Email</span>
                    <span>{user?.email || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Phone</span>
                    <span>{user?.phone || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">User ID</span>
                    <span className="font-mono text-xs">{user?.userId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Admin Code</span>
                    <span className="font-mono text-xs">{user?.adminCode}</span>
                  </div>
                </div>
              </div>
              <div className="bg-dark-700 rounded-lg p-4">
                <h3 className="font-medium mb-3">Trading Status</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Status</span>
                    <span className={user?.tradingStatus === 'ACTIVE' ? 'text-green-400' : 'text-red-400'}>
                      {user?.tradingStatus || 'ACTIVE'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Account</span>
                    <span className={user?.isActive !== false ? 'text-green-400' : 'text-red-400'}>
                      {user?.isActive !== false ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'margin' && (
            <div className="space-y-4">
              {loadingMargin ? (
                <div className="p-4 text-center text-gray-400">
                  <RefreshCw className="animate-spin inline mr-2" size={16} />
                  Loading margin settings...
                </div>
              ) : marginData ? (
                <>
                  {/* Margin Settings */}
                  <div className="bg-dark-700 rounded-lg p-4">
                    <h3 className="font-medium mb-3">Margin Settings</h3>
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Margin Type</span>
                        <span className="text-yellow-400 font-medium">{marginData.settings?.marginType?.toUpperCase() || 'EXPOSURE'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Equity Intraday Leverage</span>
                        <span className="text-green-400">{marginData.marginSettings?.equityIntradayLeverage || 5}x</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">F&O Leverage</span>
                        <span className="text-green-400">{marginData.marginSettings?.foLeverage || 1}x</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Max Loss %</span>
                        <span className="text-red-400">{marginData.marginSettings?.maxLossPercent || 80}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Auto Square-Off</span>
                        <span className={marginData.marginSettings?.autoSquareOff !== false ? 'text-green-400' : 'text-red-400'}>
                          {marginData.marginSettings?.autoSquareOff !== false ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Ledger Balance Close %</span>
                        <span className="text-yellow-400">{marginData.settings?.ledgerBalanceClosePercent || 90}%</span>
                      </div>
                    </div>
                  </div>

                  {/* Segment Exposure Settings */}
                  <div className="bg-dark-700 rounded-lg p-4">
                    <h3 className="font-medium mb-3">Segment Exposure</h3>
                    <div className="space-y-3 text-sm">
                      {marginData.segmentPermissions && Object.entries(
                        typeof marginData.segmentPermissions === 'object' && marginData.segmentPermissions !== null
                          ? (marginData.segmentPermissions instanceof Map 
                              ? Object.fromEntries(marginData.segmentPermissions) 
                              : marginData.segmentPermissions)
                          : {}
                      ).map(([segment, settings]) => (
                        <div key={segment} className="border-b border-dark-600 pb-2 last:border-0">
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-medium text-white">{segment}</span>
                            <span className={settings?.enabled ? 'text-green-400 text-xs' : 'text-red-400 text-xs'}>
                              {settings?.enabled ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                          {settings?.enabled && (
                            <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
                              <div>Intraday: <span className="text-green-400">{settings?.exposureIntraday || 1}x</span></div>
                              <div>Carry Fwd: <span className="text-blue-400">{settings?.exposureCarryForward || 1}x</span></div>
                              <div>Max Lots: <span className="text-yellow-400">{settings?.maxLots || 50}</span></div>
                              <div>Order Lots: <span className="text-purple-400">{settings?.orderLots || 10}</span></div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* RMS Settings */}
                  <div className="bg-dark-700 rounded-lg p-4">
                    <h3 className="font-medium mb-3">Risk Management (RMS)</h3>
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">RMS Active</span>
                        <span className={marginData.rmsSettings?.isActive !== false ? 'text-green-400' : 'text-red-400'}>
                          {marginData.rmsSettings?.isActive !== false ? 'Yes' : 'No'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Trading Blocked</span>
                        <span className={marginData.rmsSettings?.tradingBlocked ? 'text-red-400' : 'text-green-400'}>
                          {marginData.rmsSettings?.tradingBlocked ? 'Yes' : 'No'}
                        </span>
                      </div>
                      {marginData.rmsSettings?.blockReason && (
                        <div className="flex justify-between">
                          <span className="text-gray-400">Block Reason</span>
                          <span className="text-red-400 text-xs">{marginData.rmsSettings.blockReason}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="p-4 text-center text-gray-500">
                  Unable to load margin settings
                </div>
              )}
            </div>
          )}

          {activeSection === 'transfer' && (
            <div className="space-y-4">
              {transferMessage && (
                <div className={`p-3 rounded-lg text-sm ${transferMessage.type === 'error' ? 'bg-red-900/50 text-red-400' : 'bg-green-900/50 text-green-400'}`}>
                  {transferMessage.text}
                </div>
              )}
              
              {/* Current Broker Info */}
              <div className="bg-dark-700 rounded-lg p-4">
                <h3 className="font-medium mb-3">Current Broker/Admin</h3>
                <div className="text-sm">
                  <span className="text-gray-400">Admin Code: </span>
                  <span className="font-mono text-green-400">{user?.adminCode}</span>
                </div>
              </div>
              
              {/* Request Transfer Form */}
              <div className="bg-dark-700 rounded-lg p-4">
                <h3 className="font-medium mb-3">Request Transfer</h3>
                <p className="text-xs text-gray-400 mb-3">
                  Submit a request to transfer to a different broker/admin. Super Admin will review and approve your request.
                </p>
                
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Select New Broker/Admin</label>
                    <select
                      value={selectedBroker}
                      onChange={(e) => setSelectedBroker(e.target.value)}
                      className="w-full bg-dark-600 border border-dark-500 rounded-lg px-3 py-2"
                    >
                      <option value="">-- Select --</option>
                      {availableBrokers.map(broker => (
                        <option key={broker._id} value={broker.adminCode}>
                          {broker.name || broker.username} ({broker.adminCode}) - {broker.role}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Reason (Optional)</label>
                    <textarea
                      value={transferReason}
                      onChange={(e) => setTransferReason(e.target.value)}
                      className="w-full bg-dark-600 border border-dark-500 rounded-lg px-3 py-2 h-20 resize-none"
                      placeholder="Why do you want to transfer?"
                    />
                  </div>
                  
                  <button
                    onClick={handleSubmitTransferRequest}
                    disabled={loadingTransfer || !selectedBroker}
                    className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-600 py-2 rounded-lg font-medium transition"
                  >
                    {loadingTransfer ? 'Submitting...' : 'Submit Request'}
                  </button>
                </div>
              </div>
              
              {/* Previous Requests */}
              {brokerRequests.length > 0 && (
                <div className="bg-dark-700 rounded-lg p-4">
                  <h3 className="font-medium mb-3">Your Requests</h3>
                  <div className="space-y-3 max-h-48 overflow-y-auto">
                    {brokerRequests.map(req => (
                      <div key={req._id} className="bg-dark-600 rounded-lg p-3 text-sm">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <span className="text-gray-400">To: </span>
                            <span className="font-medium">{req.requestedAdmin?.name || req.requestedAdmin?.username}</span>
                            <span className="text-gray-500 text-xs ml-1">({req.requestedAdminCode})</span>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            req.status === 'PENDING' ? 'bg-yellow-500/20 text-yellow-400' :
                            req.status === 'APPROVED' ? 'bg-green-500/20 text-green-400' :
                            'bg-red-500/20 text-red-400'
                          }`}>
                            {req.status}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500">
                          {new Date(req.createdAt).toLocaleDateString()}
                        </div>
                        {req.status === 'PENDING' && (
                          <button
                            onClick={() => handleCancelRequest(req._id)}
                            className="mt-2 text-xs text-red-400 hover:text-red-300"
                          >
                            Cancel Request
                          </button>
                        )}
                        {req.adminRemarks && (
                          <div className="mt-2 text-xs text-gray-400">
                            <span className="font-medium">Remarks: </span>{req.adminRemarks}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeSection === 'password' && (
            <div className="space-y-4">
              {message && (
                <div className={`p-3 rounded-lg text-sm ${message.type === 'error' ? 'bg-red-900/50 text-red-400' : 'bg-green-900/50 text-green-400'}`}>
                  {message.text}
                </div>
              )}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Current Password</label>
                <input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 focus:outline-none focus:border-green-500"
                  placeholder="Enter current password"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 focus:outline-none focus:border-green-500"
                  placeholder="Enter new password (min 6 chars)"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Confirm New Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 focus:outline-none focus:border-green-500"
                  placeholder="Confirm new password"
                />
              </div>
              <button
                onClick={handleChangePassword}
                disabled={loading}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-600 py-3 rounded-lg font-medium transition"
              >
                {loading ? 'Changing...' : 'Change Password'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const WalletModal = ({ onClose, walletData, user, onRefresh }) => {
  const [activeTab, setActiveTab] = useState('deposit'); // 'deposit' or 'withdraw'
  const [amount, setAmount] = useState('');
  const [utrNumber, setUtrNumber] = useState('');
  const [withdrawAccount, setWithdrawAccount] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [copied, setCopied] = useState(null);
  const [bankDetails, setBankDetails] = useState(null);

  // Fetch bank details on mount
  useEffect(() => {
    fetchBankDetails();
  }, []);

  const fetchBankDetails = async () => {
    try {
      // Fetch admin's bank accounts (specific to user's admin)
      const { data } = await axios.get('/api/user-funds/admin-bank-accounts', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      
      // Find primary or first active bank and UPI accounts
      const bankAccount = data.find(acc => acc.type === 'BANK' && acc.isPrimary) 
        || data.find(acc => acc.type === 'BANK');
      const upiAccount = data.find(acc => acc.type === 'UPI' && acc.isPrimary)
        || data.find(acc => acc.type === 'UPI');
      
      setBankDetails({
        bankName: bankAccount?.bankName || 'Not configured',
        accountName: bankAccount?.holderName || 'Not configured',
        accountNumber: bankAccount?.accountNumber || 'Not configured',
        ifscCode: bankAccount?.ifsc || 'Not configured',
        upiId: upiAccount?.upiId || 'Not configured',
        upiName: upiAccount?.holderName || 'Not configured'
      });
    } catch (error) {
      console.error('Error fetching bank details:', error);
      // Fallback to legacy endpoint
      try {
        const { data } = await axios.get('/api/user/bank-details', {
          headers: { Authorization: `Bearer ${user.token}` }
        });
        setBankDetails(data);
      } catch (err) {
        setBankDetails({
          bankName: 'Not configured',
          accountName: 'Contact your admin',
          accountNumber: '',
          ifscCode: '',
          upiId: ''
        });
      }
    }
  };

  const copyToClipboard = (text, field) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleDeposit = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      setMessage({ type: 'error', text: 'Please enter a valid amount' });
      return;
    }
    if (!utrNumber) {
      setMessage({ type: 'error', text: 'Please enter UTR/Transaction ID' });
      return;
    }

    setLoading(true);
    try {
      await axios.post('/api/user/deposit-request', {
        amount: parseFloat(amount),
        utrNumber,
        paymentMethod: 'BANK'
      }, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setMessage({ type: 'success', text: 'Deposit request submitted! It will be verified shortly.' });
      setAmount('');
      setUtrNumber('');
      onRefresh && onRefresh();
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || 'Failed to submit deposit request' });
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      setMessage({ type: 'error', text: 'Please enter a valid amount' });
      return;
    }
    if (parseFloat(amount) > (walletData?.wallet?.balance || 0)) {
      setMessage({ type: 'error', text: 'Insufficient balance' });
      return;
    }

    setLoading(true);
    try {
      await axios.post('/api/user/withdraw-request', {
        amount: parseFloat(amount),
        accountDetails: withdrawAccount
      }, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setMessage({ type: 'success', text: 'Withdrawal request submitted! It will be processed shortly.' });
      setAmount('');
      setWithdrawAccount('');
      onRefresh && onRefresh();
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || 'Failed to submit withdrawal request' });
    } finally {
      setLoading(false);
    }
  };

  const quickAmounts = [500, 1000, 2000, 5000, 10000, 25000];

  return (
    <div className="fixed inset-0 bg-black/70 flex items-end md:items-center justify-center z-50">
      <div className="bg-dark-800 w-full md:w-[480px] md:rounded-xl rounded-t-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-dark-600">
          <div className="flex items-center gap-3">
            <Wallet className="text-green-400" size={24} />
            <div>
              <h3 className="font-bold text-lg">Wallet</h3>
              <p className="text-sm text-gray-400">Balance: <span className="text-green-400 font-medium">₹{walletData?.wallet?.balance?.toLocaleString() || '0'}</span></p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1">
            <X size={24} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-dark-600">
          <button
            onClick={() => { setActiveTab('deposit'); setMessage(null); }}
            className={`flex-1 py-3 font-medium flex items-center justify-center gap-2 ${
              activeTab === 'deposit' 
                ? 'text-green-400 border-b-2 border-green-400' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <ArrowDownCircle size={18} />
            Deposit
          </button>
          <button
            onClick={() => { setActiveTab('withdraw'); setMessage(null); }}
            className={`flex-1 py-3 font-medium flex items-center justify-center gap-2 ${
              activeTab === 'withdraw' 
                ? 'text-red-400 border-b-2 border-red-400' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <ArrowUpCircle size={18} />
            Withdraw
          </button>
        </div>

        {/* Message */}
        {message && (
          <div className={`mx-4 mt-4 p-3 rounded-lg text-sm ${
            message.type === 'success' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'
          }`}>
            {message.text}
          </div>
        )}

        {/* Deposit Tab */}
        {activeTab === 'deposit' && (
          <div className="p-4 space-y-4">
            {/* Bank Details */}
            <div className="bg-dark-700 rounded-lg p-4">
              <h4 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
                <Building2 size={16} />
                Transfer to Bank Account
              </h4>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">Bank Name</span>
                  <span className="font-medium">{bankDetails?.bankName || '--'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">Account Name</span>
                  <span className="font-medium">{bankDetails?.accountName || '--'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">Account Number</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium">{bankDetails?.accountNumber || '--'}</span>
                    <button 
                      onClick={() => copyToClipboard(bankDetails?.accountNumber, 'account')}
                      className="text-gray-400 hover:text-white"
                    >
                      {copied === 'account' ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">IFSC Code</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium">{bankDetails?.ifscCode || '--'}</span>
                    <button 
                      onClick={() => copyToClipboard(bankDetails?.ifscCode, 'ifsc')}
                      className="text-gray-400 hover:text-white"
                    >
                      {copied === 'ifsc' ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Referral Amount */}
            <div className="bg-dark-700 rounded-lg p-4">
              <h4 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
                <Share2 size={16} />
                Referral Amount
              </h4>
              <button 
                onClick={() => { setShowReferralModal(true); }}
                className="w-full bg-purple-600 hover:bg-purple-700 py-2 rounded flex items-center justify-center gap-2 text-white font-medium transition-colors"
              >
                <Share2 size={16} />
                View Referral Earnings
              </button>
              <p className="text-xs text-gray-500 mt-2 text-center">
                See all your referral earnings and details
              </p>
            </div>

            {/* UPI */}
            <div className="bg-dark-700 rounded-lg p-4">
              <h4 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
                <CreditCard size={16} />
                Or Pay via UPI
              </h4>
              <div className="flex justify-between items-center">
                <span className="font-mono text-lg">{bankDetails?.upiId || '--'}</span>
                <button 
                  onClick={() => copyToClipboard(bankDetails?.upiId, 'upi')}
                  className="px-3 py-1 bg-dark-600 hover:bg-dark-500 rounded text-sm flex items-center gap-1"
                >
                  {copied === 'upi' ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                  {copied === 'upi' ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Amount Input */}
            <div>
              <label className="block text-sm text-gray-400 mb-2">Amount (₹)</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Enter amount"
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-3 text-lg focus:outline-none focus:border-green-500"
              />
              <div className="flex flex-wrap gap-2 mt-2">
                {quickAmounts.map(amt => (
                  <button
                    key={amt}
                    onClick={() => setAmount(amt.toString())}
                    className="px-3 py-1 bg-dark-700 hover:bg-dark-600 rounded text-sm"
                  >
                    ₹{amt.toLocaleString()}
                  </button>
                ))}
              </div>
            </div>

            {/* UTR Input */}
            <div>
              <label className="block text-sm text-gray-400 mb-2">UTR / Transaction ID</label>
              <input
                type="text"
                value={utrNumber}
                onChange={(e) => setUtrNumber(e.target.value)}
                placeholder="Enter UTR or Transaction ID after payment"
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-3 focus:outline-none focus:border-green-500"
              />
            </div>

            {/* Submit Button */}
            <button
              onClick={handleDeposit}
              disabled={loading}
              className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded-lg font-semibold flex items-center justify-center gap-2"
            >
              {loading ? <RefreshCw size={18} className="animate-spin" /> : <ArrowDownCircle size={18} />}
              Submit Deposit Request
            </button>
          </div>
        )}

        {/* Withdraw Tab */}
        {activeTab === 'withdraw' && (
          <div className="p-4 space-y-4">
            {/* Available Balance */}
            <div className="bg-dark-700 rounded-lg p-4 text-center">
              <p className="text-sm text-gray-400">Available for Withdrawal</p>
              <p className="text-3xl font-bold text-green-400 mt-1">₹{walletData?.wallet?.balance?.toLocaleString() || '0'}</p>
            </div>

            {/* Amount Input */}
            <div>
              <label className="block text-sm text-gray-400 mb-2">Withdrawal Amount (₹)</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Enter amount"
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-3 text-lg focus:outline-none focus:border-red-500"
              />
              <div className="flex flex-wrap gap-2 mt-2">
                {quickAmounts.map(amt => (
                  <button
                    key={amt}
                    onClick={() => setAmount(amt.toString())}
                    className="px-3 py-1 bg-dark-700 hover:bg-dark-600 rounded text-sm"
                  >
                    ₹{amt.toLocaleString()}
                  </button>
                ))}
                <button
                  onClick={() => setAmount((walletData?.wallet?.balance || 0).toString())}
                  className="px-3 py-1 bg-dark-700 hover:bg-dark-600 rounded text-sm text-green-400"
                >
                  Max
                </button>
              </div>
            </div>

            {/* Account Details */}
            <div>
              <label className="block text-sm text-gray-400 mb-2">Bank Account / UPI ID</label>
              <textarea
                value={withdrawAccount}
                onChange={(e) => setWithdrawAccount(e.target.value)}
                placeholder="Enter your bank account details or UPI ID"
                rows={3}
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-3 focus:outline-none focus:border-red-500 resize-none"
              />
            </div>

            {/* Submit Button */}
            <button
              onClick={handleWithdraw}
              disabled={loading}
              className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 rounded-lg font-semibold flex items-center justify-center gap-2"
            >
              {loading ? <RefreshCw size={18} className="animate-spin" /> : <ArrowUpCircle size={18} />}
              Submit Withdrawal Request
            </button>

            <p className="text-xs text-gray-500 text-center">
              Withdrawals are processed within 24-48 hours
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

const BuySellModal = ({
  instrument,
  orderType,
  setOrderType,
  onClose,
  walletData,
  user,
  marketData = {},
  onRefreshWallet,
  onRefreshPositions,
  usdRate = 83.5,
  usdSpotClientSpreads = { cryptoInr: 0, cryptoUsdPerSide: 0, forex: 0 },
  chartAnchorLtp = null,
  segmentPermissionsGate = {},
}) => {
  const [quantity, setQuantity] = useState('0.01');
  const [limitPrice, setLimitPrice] = useState('');
  const [productType, setProductType] = useState('MIS');
  const [orderPriceType, setOrderPriceType] = useState('MARKET');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [marginPreview, setMarginPreview] = useState(null);
  const [showTakeProfit, setShowTakeProfit] = useState(false);
  const [showStopLoss, setShowStopLoss] = useState(false);
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [inputMode, setInputMode] = useState('inr'); // 'inr' notional vs coin 'units'
  const [activeOrderTab, setActiveOrderTab] = useState('market'); // 'market' or 'pending'
  const [freshInstrument, setFreshInstrument] = useState(null);
  const [quantityMode, setQuantityMode] = useState('lot'); // 'lot' or 'qty' for FUT instruments

  const isForex = isForexInstrument(instrument);
  const isCryptoOnly = !!(instrument?.isCrypto || instrument?.segment === 'CRYPTO' || instrument?.exchange === 'BINANCE');
  const isUsdSpot = isUsdSpotInstrument(instrument);

  // Fetch fresh instrument data with lastBid/lastAsk when modal opens
  useEffect(() => {
    const fetchFreshInstrument = async () => {
      if (!instrument?.token && !instrument?.symbol) return;
      try {
        const params = new URLSearchParams();
        if (instrument.token) params.append('token', instrument.token);
        if (instrument.symbol) params.append('symbol', instrument.symbol);
        if (instrument.exchange) params.append('exchange', instrument.exchange);
        
        const { data } = await axios.get(`/api/instruments/public?${params.toString()}`);
        if (data?.instruments && data.instruments.length > 0) {
          setFreshInstrument(data.instruments[0]);
        }
      } catch (err) {
        console.error('Error fetching fresh instrument data:', err);
      }
    };
    fetchFreshInstrument();
  }, [instrument?.token, instrument?.symbol, instrument?.exchange]);

  // Use fresh instrument data if available, otherwise use the prop
  const effectiveInstrument = freshInstrument || instrument;

  const cryptoQuoteModal = isUsdSpot ? getCryptoMarketQuote(marketData, effectiveInstrument) : null;
  const liveData = isUsdSpot ? (cryptoQuoteModal || {}) : (marketDataRowForInstrumentToken(marketData, effectiveInstrument?.token) || {});
  const ltp = isUsdSpot
    ? (Number(liveData.ltp) || Number(liveData.close) || Number(effectiveInstrument?.ltp) || 0)
    : (liveData.ltp || effectiveInstrument?.ltp || 0);
  const indianBookModal = !isUsdSpot
    ? alignIndianBookBidAskWithLtp(liveData, effectiveInstrument, { chartAnchorLtp })
    : null;
  const liveBid = isUsdSpot
    ? (Number(liveData.bid) || ltp || Number(effectiveInstrument?.ltp) || 0)
    : indianBookModal.bid;
  const liveAsk = isUsdSpot
    ? (Number(liveData.ask) || ltp || Number(effectiveInstrument?.ltp) || 0)
    : indianBookModal.ask;

  const feedRow = effectiveInstrument?.token
    ? marketDataRowForInstrumentToken(marketData, effectiveInstrument.token)
    : null;
  const ltpFromLiveFeed = !!(
    feedRow &&
    (feedRow.ltp != null ||
      feedRow.last_price != null ||
      feedRow.bid != null ||
      feedRow.ask != null)
  );

  // Determine segment type
  const isFnO = effectiveInstrument?.segment === 'FNO' || effectiveInstrument?.instrumentType === 'OPTIONS' || effectiveInstrument?.instrumentType === 'FUTURES';
  const isMCX = effectiveInstrument?.segment === 'MCX' || effectiveInstrument?.exchange === 'MCX' || effectiveInstrument?.displaySegment === 'MCX' ||
                effectiveInstrument?.segment === 'MCXFUT' || effectiveInstrument?.segment === 'MCXOPT';
  // MCX uses quantity-based trading (no lots), only F&O uses lots
  const isLotBased = isFnO && !isMCX;
  // Determine if instrument is OPTIONS or FUTURES
  const isOptions = effectiveInstrument?.instrumentType === 'OPTIONS' || effectiveInstrument?.segment === 'MCXOPT';
  const isFutures = effectiveInstrument?.instrumentType === 'FUTURES' || effectiveInstrument?.segment === 'MCXFUT';

  // Determine which wallet to use based on instrument type
  const getWalletData = () => {
    if (isCryptoOnly) {
      return {
        balance: walletData?.cryptoWallet?.balance || 0,
        usedMargin: 0,
        available: walletData?.cryptoWallet?.balance || 0
      };
    }
    if (isForex) {
      return {
        balance: walletData?.forexWallet?.balance || 0,
        usedMargin: 0,
        available: walletData?.forexWallet?.balance || 0
      };
    } else if (isMCX) {
      return {
        balance: walletData?.mcxWallet?.balance || 0,
        usedMargin: walletData?.mcxWallet?.usedMargin || 0,
        available: (walletData?.mcxWallet?.balance || 0) - (walletData?.mcxWallet?.usedMargin || 0)
      };
    } else {
      return {
        balance: walletData?.tradingBalance || walletData?.wallet?.tradingBalance || 0,
        usedMargin: walletData?.usedMargin || walletData?.wallet?.usedMargin || 0,
        available: walletData?.marginAvailable || 0
      };
    }
  };
  const activeWallet = getWalletData();

  // Always use lotSize from DB (no hardcoded fallbacks)
  // For MCX, lotSize is not used (quantity-based trading)
  const lotSize = isUsdSpot ? 1 : (isMCX ? 1 : (effectiveInstrument?.lotSize || 1));

  // For crypto: quantity is in units (BTC, ETH, etc.)
  // For MCX: quantity is direct (no lot multiplication)
  // For F&O: quantity = lots * lotSize (if lot mode) or direct quantity (if qty mode for FUT)
  const totalQuantity = isUsdSpot
    ? parseFloat(quantity || 0.01)
    : (isMCX ? parseFloat(quantity || 1) : (isLotBased && (quantityMode === 'lot' || isOptions) ? parseFloat(quantity || 1) * lotSize : parseFloat(quantity || 1)));
  const orderValue = ltp * totalQuantity;
  const marginRequired = orderValue;

  const commissionPerLot = 10;
  const totalCommission = parseFloat(quantity || 0.01) * commissionPerLot;

  const estBrokerageInr = Number.isFinite(Number(marginPreview?.brokerage))
    ? Number(marginPreview.brokerage)
    : totalCommission * (isUsdSpot ? usdRate : 1);
  const estMarginInr = Number.isFinite(Number(marginPreview?.marginRequired))
    ? Number(marginPreview.marginRequired)
    : marginRequired * (isUsdSpot ? usdRate : 1);

  // Fetch margin preview when inputs change
  useEffect(() => {
    const fetchMarginPreview = async () => {
      if (!instrument || !quantity || !ltp) return;
      
      try {
        const { data } = await axios.post('/api/trading/margin-preview', {
          symbol: instrument.symbol,
          tradingSymbol: instrument.tradingSymbol || instrument.symbol,
          exchange: instrument.exchange,
          token: instrument.token != null ? String(instrument.token) : undefined,
          segment: isForex
            ? (instrument.displaySegment || forexWatchlistSegmentFromInstrument(instrument))
            : (instrument.displaySegment || instrument.segment),
          instrumentType: instrument.instrumentType,
          optionType: instrument.optionType || null,
          strikePrice: instrument.strike || null,
          category: instrument.category,
          productType,
          side: orderType.toUpperCase(),
          quantity: totalQuantity,
          lots: parseFloat(quantity),
          lotSize: lotSize,
          price: parseFloat(ltp),
          leverage: 1,
          isCrypto: isCryptoOnly,
          isForex: isForex
        }, {
          headers: { Authorization: `Bearer ${user?.token}` }
        });
        setMarginPreview(data);
      } catch (err) {
        console.error('Margin preview error:', err);
      }
    };

    const debounce = setTimeout(fetchMarginPreview, 300);
    return () => clearTimeout(debounce);
  }, [instrument, quantity, ltp, productType, orderType, user, totalQuantity, lotSize, isForex, isCryptoOnly]);

  // Product types based on segment
  const productTypes = isUsdSpot
    ? [
        { value: 'MIS', label: 'Spot', desc: isForex ? 'Forex spot (INR wallet)' : 'Crypto spot trading' }
      ]
    : isFnO || isMCX
    ? [
        { value: 'MIS', label: 'Intraday', desc: 'Square off same day' },
        { value: 'NRML', label: 'Carry Forward', desc: 'Hold overnight' }
      ]
    : [
        { value: 'MIS', label: 'Intraday', desc: 'Square off same day' },
        { value: 'CNC', label: 'Delivery', desc: 'Hold in demat' }
      ];

  const symbolName = isForex
    ? (instrument?.symbol || instrument?.pair || 'FX')
    : (instrument?.symbol?.replace('USDT', '') || 'BTC');
  const cryptoSpreadInrModal =
    usdSpotClientSpreads.cryptoInr ?? usdSpotClientSpreads.crypto ?? 0;
  const cryptoUsdPerSideModal = usdSpotClientSpreads.cryptoUsdPerSide ?? 0;
  const forexSpreadInrModal = usdSpotClientSpreads.forex ?? 0;

  const segmentSpreadInr = isCryptoOnly ? cryptoSpreadInrModal : isForex ? forexSpreadInrModal : 0;
  const displayBidAsk =
    isUsdSpot && isCryptoOnly
      ? resolveUsdSpotCryptoDisplayBidAsk(liveBid, liveAsk, cryptoUsdPerSideModal, cryptoSpreadInrModal, usdRate)
      : isUsdSpot && segmentSpreadInr > 0
        ? adjustUsdSpotBidAskForSegmentSpread(liveBid, liveAsk, segmentSpreadInr, usdRate)
        : { bidUsd: liveBid, askUsd: liveAsk };
  const bidDisp =
    isUsdSpot && displayBidAsk.bidUsd != null && effectiveInstrument
      ? spotQuoteDisplayPrice(effectiveInstrument, Number(displayBidAsk.bidUsd), usdRate)
      : Number(liveBid) || 0;
  const askDisp =
    isUsdSpot && displayBidAsk.askUsd != null && effectiveInstrument
      ? spotQuoteDisplayPrice(effectiveInstrument, Number(displayBidAsk.askUsd), usdRate)
      : Number(liveAsk) || 0;
  const ltpInr =
    ltp > 0 && effectiveInstrument && isUsdSpot
      ? spotPxToDisplayedInr(effectiveInstrument, Number(ltp), usdRate)
      : ltp > 0
        ? Number(ltp)
        : 0;

  const inrNotionalCalc =
    inputMode === 'inr' ? parseFloat(quantity) || 0 : (parseFloat(quantity) || 0) * ltpInr;
  const cryptoUnitsCalc =
    inputMode === 'inr' ? (ltpInr > 0 ? inrNotionalCalc / ltpInr : 0) : parseFloat(quantity) || 0;

  // Place order handler
  const handlePlaceOrder = async () => {
    if (!user?.token) {
      setError('Please login to place orders');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      // For USD spot: use cryptoUnits calculated from INR notional or direct units
      const cryptoQuantity = isUsdSpot ? cryptoUnitsCalc : totalQuantity;
      
      const orderData = {
        symbol: instrument.symbol,
        token: instrument.token || instrument.pair,
        pair: instrument.pair,
        isCrypto: isCryptoOnly,
        isForex: isForex,
        displaySegment: instrument.displaySegment,
        exchange: instrument.exchange || (isForex ? 'FOREX' : isCryptoOnly ? 'BINANCE' : 'NSE'),
        segment: isForex
          ? (instrument.displaySegment || forexWatchlistSegmentFromInstrument(instrument))
          : isCryptoOnly ? (instrument.displaySegment || 'CRYPTO') : (instrument.displaySegment || instrument.segment || (instrument.exchange === 'MCX' ? 'MCXFUT' : 'NSEFUT')),
        instrumentType: isForex
          ? forexOrderInstrumentType(instrument)
          : isCryptoOnly ? (instrument.instrumentType || 'CRYPTO') : (instrument.instrumentType || 'FUTURES'),
        optionType: instrument.optionType || null,
        strike: instrument.strike || null,
        expiry: instrument.expiry || null,
        category: instrument.category,
        productType,
        orderType: orderPriceType,
        side: orderType.toUpperCase(),
        quantity: cryptoQuantity,
        lots: isUsdSpot ? 1 : parseFloat(quantity),
        lotSize: lotSize,
        price: ltp,
        bidPrice: liveBid,
        askPrice: liveAsk,
        leverage: 1,
        takeProfit: takeProfit
          ? isUsdSpot
            ? isCryptoOnly
              ? parseFloat(takeProfit)
              : parseFloat(takeProfit) / usdRate
            : parseFloat(takeProfit)
          : null,
        stopLoss: stopLoss
          ? isUsdSpot
            ? isCryptoOnly
              ? parseFloat(stopLoss)
              : parseFloat(stopLoss) / usdRate
            : parseFloat(stopLoss)
          : null,
        cryptoAmount: isCryptoOnly ? inrNotionalCalc : null,
        forexAmount: isForex ? inrNotionalCalc : null
      };

      if (orderPriceType === 'LIMIT') {
        orderData.limitPrice = isUsdSpot
          ? (isCryptoOnly ? parseFloat(limitPrice) : parseFloat(limitPrice) / usdRate)
          : parseFloat(limitPrice);
      }

      const gateSegModal = String(orderData.segment || orderData.displaySegment || '').trim();
      const gateErrModal = validateLimitPendingFromSegmentPerms(segmentPermissionsGate, gateSegModal, orderPriceType);
      if (gateErrModal) {
        setError(gateErrModal);
        setLoading(false);
        return;
      }

      const { data } = await axios.post('/api/trading/order', orderData, {
        headers: { Authorization: `Bearer ${user.token}` }
      });

      const trade = data.trade;
      const priceSymbol = '₹';
      const statusMsg = trade?.status === 'PENDING' 
        ? `📋 LIMIT ORDER PLACED - ${instrument.symbol} @ ${priceSymbol}${limitPrice}` 
        : `✅ TRADE EXECUTED - ${trade?.side} ${instrument.symbol} @ ${priceSymbol}${trade?.entryPrice?.toLocaleString()} | Qty: ${trade?.quantity}`;
      
      setSuccess(statusMsg);
      if (onRefreshWallet) onRefreshWallet();
      if (onRefreshPositions) onRefreshPositions();
      setTimeout(() => {
        setSuccess('');
        onClose();
      }, 3000);
    } catch (err) {
      console.error('Order error:', err);
      setError(err.response?.data?.message || 'Failed to place order');
    } finally {
      setLoading(false);
    }
  };

  if (!isUsdSpot && !instrument?.lotSize) {
    return null;
  }

  // Render USD-spot UI (crypto + forex)
  if (isUsdSpot) {
    return (
      <div className="fixed inset-0 bg-black/80 flex items-end md:items-center justify-center z-50">
        <div className="bg-[#0d0d0d] w-full md:w-[380px] md:rounded-xl rounded-t-xl max-h-[95vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-800">
            <h3 className="font-bold text-lg text-white">
              {isCryptoOnly ? `${symbolName}USDT order` : `${symbolName} order`}
            </h3>
            <button onClick={onClose} className="text-gray-400 hover:text-white p-1">
              <X size={20} />
            </button>
          </div>

          {/* Market / Pending Tabs */}
          <div className="flex border-b border-gray-800">
            <button
              onClick={() => { setActiveOrderTab('market'); setOrderPriceType('MARKET'); }}
              className={`flex-1 py-3 text-sm font-medium transition ${
                activeOrderTab === 'market' 
                  ? 'text-white border-b-2 border-white' 
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Market
            </button>
            <button
              onClick={() => { setActiveOrderTab('pending'); setOrderPriceType('LIMIT'); }}
              className={`flex-1 py-3 text-sm font-medium transition ${
                activeOrderTab === 'pending' 
                  ? 'text-white border-b-2 border-white' 
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Pending
            </button>
          </div>

          {/* SELL / BUY Price Buttons */}
          <div className="flex gap-2 p-3">
            <button
              onClick={() => setOrderType('sell')}
              className={`flex-1 py-3 rounded-lg font-bold transition ${
                orderType === 'sell' 
                  ? 'bg-red-600 text-white' 
                  : 'bg-[#1a1a1a] text-gray-400 hover:bg-[#252525]'
              }`}
            >
              <div className="text-[10px] uppercase tracking-wide opacity-70">
                SELL @ Bid {isCryptoOnly ? '($)' : '(₹)'}
              </div>
              <div className="text-xl font-mono">
                {isCryptoOnly ? '$' : '₹'}
                {(bidDisp != null && !isNaN(bidDisp) ? bidDisp : 0).toLocaleString(isCryptoOnly ? 'en-US' : 'en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </button>
            <button
              onClick={() => setOrderType('buy')}
              className={`flex-1 py-3 rounded-lg font-bold transition ${
                orderType === 'buy' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-[#1a1a1a] text-gray-400 hover:bg-[#252525]'
              }`}
            >
              <div className="text-[10px] uppercase tracking-wide opacity-70">
                BUY @ Ask {isCryptoOnly ? '($)' : '(₹)'}
              </div>
              <div className="text-xl font-mono">
                {isCryptoOnly ? '$' : '₹'}
                {(askDisp != null && !isNaN(askDisp) ? askDisp : 0).toLocaleString(isCryptoOnly ? 'en-US' : 'en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </button>
          </div>

          {/* Sell Side / Buy Side buttons */}
          <div className="flex gap-2 px-3 pb-3">
            <button
              onClick={() => setOrderType('sell')}
              className={`flex-1 py-2 rounded border text-sm font-medium transition ${
                orderType === 'sell'
                  ? 'border-white text-white'
                  : 'border-gray-700 text-gray-400 hover:border-gray-500'
              }`}
            >
              Sell Side
            </button>
            <button
              onClick={() => setOrderType('buy')}
              className={`flex-1 py-2 rounded border text-sm font-medium transition ${
                orderType === 'buy'
                  ? 'border-blue-500 text-blue-400 bg-blue-500/10'
                  : 'border-gray-700 text-gray-400 hover:border-gray-500'
              }`}
            >
              Buy Side
            </button>
          </div>

          {/* Volume Input */}
          <div className="px-3 pb-2">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm text-gray-400">Volume</label>
              {isFutures && (
                <div className="flex bg-[#1a1a1a] rounded-lg border border-gray-700">
                  <button
                    onClick={() => setQuantityMode('lot')}
                    className={`px-3 py-1 text-xs font-medium transition ${
                      quantityMode === 'lot'
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Lot
                  </button>
                  <button
                    onClick={() => setQuantityMode('qty')}
                    className={`px-3 py-1 text-xs font-medium transition ${
                      quantityMode === 'qty'
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Qty
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center bg-[#1a1a1a] rounded-lg border border-gray-700">
              <button 
                onClick={() => setQuantity((Math.max(0.01, parseFloat(quantity) - 0.01)).toFixed(2))}
                className="px-4 py-3 text-gray-400 hover:text-white font-bold text-xl border-r border-gray-700"
              >
                −
              </button>
              <input
                type="text"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="flex-1 bg-transparent text-center text-lg font-bold text-white focus:outline-none py-3"
              />
              <button 
                onClick={() => setQuantity((parseFloat(quantity) + 0.01).toFixed(2))}
                className="px-4 py-3 text-gray-400 hover:text-white font-bold text-xl border-l border-gray-700"
              >
                +
              </button>
            </div>
            <div className="text-right text-xs text-gray-500 mt-1">
              {quantityMode === 'lot' || isOptions ? `${quantity} lot` : `${quantity} qty`}
            </div>
          </div>

          {!isCryptoOnly && (
            <div className="px-3 pb-3">
              {(marginPreview?.exposureIntraday != null || marginPreview?.exposureCarryForward != null) && (
                <div className="text-xs text-cyan-400/90 mb-2">
                  Segment exposure: MIS ×{marginPreview?.exposureIntraday ?? '—'}
                  {marginPreview?.exposureCarryForward != null && ` · CF ×${marginPreview.exposureCarryForward}`}; margin follows broker hierarchy + instrument rules only
                </div>
              )}
              <div className="flex gap-2 items-stretch">
                <div className="flex-1 bg-[#1a1a1a] border border-gray-700 rounded-lg px-4 py-3 text-green-400 font-medium text-center">
                  Est. margin ₹{estMarginInr.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </div>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Wallet: ₹{activeWallet.available.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </div>
            </div>
          )}

          {/* Take Profit Section */}
          <div className="px-3 pb-2">
            <button 
              onClick={() => setShowTakeProfit(!showTakeProfit)}
              className="flex items-center justify-between w-full py-2 text-green-400 hover:text-green-300"
            >
              <span className="text-sm font-medium">Take profit</span>
              <Plus size={18} className={`transition-transform ${showTakeProfit ? 'rotate-45' : ''}`} />
            </button>
            {showTakeProfit && (
              <div className="pb-2">
                <input
                  type="number"
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(e.target.value)}
                  placeholder="Enter take profit price"
                  className="w-full bg-[#1a1a1a] border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-green-500"
                />
              </div>
            )}
          </div>

          {/* Stop Loss Section */}
          <div className="px-3 pb-3">
            <button 
              onClick={() => setShowStopLoss(!showStopLoss)}
              className="flex items-center justify-between w-full py-2 text-red-400 hover:text-red-300"
            >
              <span className="text-sm font-medium">Stop loss</span>
              <Plus size={18} className={`transition-transform ${showStopLoss ? 'rotate-45' : ''}`} />
            </button>
            {showStopLoss && (
              <div className="pb-2">
                <input
                  type="number"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                  placeholder="Enter stop loss price"
                  className="w-full bg-[#1a1a1a] border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-red-500"
                />
              </div>
            )}
          </div>

          {/* Trading Charges */}
          <div className="mx-3 mb-3 bg-[#1a1a1a] rounded-lg p-3">
            <div className="text-sm text-white font-medium mb-2">Trading Charges</div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Commission</span>
              <span className="text-white">₹{estBrokerageInr.toFixed(2)} (est.)</span>
            </div>
          </div>

          {/* Margin Required */}
          <div className="px-3 pb-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">Margin Required</span>
              <span className="text-2xl font-bold text-green-400">₹{estMarginInr.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
            </div>
          </div>

          {/* Error/Success Messages */}
          {error && (
            <div className="mx-3 mb-3 bg-red-500/20 border border-red-500 text-red-400 px-3 py-2 rounded text-sm">
              {error}
            </div>
          )}
          {success && (
            <div className="mx-3 mb-3 bg-green-500/20 border border-green-500 text-green-400 px-3 py-2 rounded text-sm">
              {success}
            </div>
          )}

          {/* Submit Button */}
          <div className="p-3 pt-0">
            <button
              onClick={handlePlaceOrder}
              disabled={loading || estMarginInr > activeWallet.available}
              className={`w-full py-4 rounded-lg font-bold text-lg transition ${
                orderType === 'buy' 
                  ? 'bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:opacity-50' 
                  : 'bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:opacity-50'
              }`}
            >
              {loading ? 'Placing Order...' : `Open ${orderType.toUpperCase()} Order`}
            </button>
          </div>

          {/* Footer Info */}
          <div className="px-3 pb-4 text-center text-xs text-gray-500">
            <div>{quantity} {isLotBased ? 'lots' : 'quantity'} @ {ltp?.toLocaleString()}</div>
          </div>
        </div>
      </div>
    );
  }

  // Non-crypto UI (original)
  return (
    <div className="fixed inset-0 bg-black/70 flex items-end md:items-center justify-center z-50">
      <div className="bg-dark-800 w-full md:w-[420px] md:rounded-xl rounded-t-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-dark-600">
          <div>
            <h3 className="font-bold text-lg">{instrument?.symbol || 'Select Instrument'}</h3>
            <p className="text-xs text-gray-400">
              {instrument?.exchange} • {instrument?.segment || 'EQUITY'} 
              {instrument?.instrumentType === 'OPTIONS' && ` • ${instrument?.optionType}`}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1">
            <X size={24} />
          </button>
        </div>

        {/* Buy/Sell Toggle with Live Bid/Ask Prices - Indian Standard: SELL left, BUY right */}
        <div className="flex p-3 gap-2">
          <button
            onClick={() => setOrderType('sell')}
            className={`flex-1 py-2 rounded-lg font-bold transition ${
              orderType === 'sell' 
                ? 'bg-red-600 text-white' 
                : 'bg-dark-700 text-gray-400 hover:bg-dark-600'
            }`}
          >
            <div className="text-xs opacity-70">Bid Price</div>
            <div className="text-xl">₹{liveBid != null && !isNaN(liveBid) ? liveBid.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '--'}</div>
            <div className="text-sm">SELL</div>
          </button>
          <button
            onClick={() => setOrderType('buy')}
            className={`flex-1 py-2 rounded-lg font-bold transition ${
              orderType === 'buy' 
                ? 'bg-green-600 text-white' 
                : 'bg-dark-700 text-gray-400 hover:bg-dark-600'
            }`}
          >
            <div className="text-xs opacity-70">Ask Price</div>
            <div className="text-xl">₹{liveAsk != null && !isNaN(liveAsk) ? liveAsk.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '--'}</div>
            <div className="text-sm">BUY</div>
          </button>
        </div>

        {/* Product Type Selection */}
        <div className="px-4 pb-3">
          <label className="block text-sm text-gray-400 mb-2">Product Type</label>
          <div className="grid grid-cols-2 gap-2">
            {productTypes.map(pt => (
              <button
                key={pt.value}
                onClick={() => setProductType(pt.value)}
                className={`p-3 rounded-lg border-2 text-left transition ${
                  productType === pt.value 
                    ? 'border-green-500 bg-green-500/10' 
                    : 'border-dark-600 bg-dark-700 hover:border-dark-500'
                }`}
              >
                <div className="font-semibold text-sm">{pt.label}</div>
                <div className="text-xs text-gray-500">{pt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Order Type Selection */}
        <div className="px-4 pb-3">
          <label className="block text-sm text-gray-400 mb-2">Order Type</label>
          <div className="flex gap-2">
            <button
              onClick={() => setOrderPriceType('MARKET')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                orderPriceType === 'MARKET' 
                  ? 'bg-purple-600 text-white' 
                  : 'bg-dark-700 text-gray-400 hover:bg-dark-600'
              }`}
            >
              Market
            </button>
            <button
              onClick={() => setOrderPriceType('LIMIT')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                orderPriceType === 'LIMIT' 
                  ? 'bg-purple-600 text-white' 
                  : 'bg-dark-700 text-gray-400 hover:bg-dark-600'
              }`}
            >
              Limit
            </button>
          </div>
        </div>

        {/* Form */}
        <div className="p-4 pt-0 space-y-4">
          {/* Lots/Quantity */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm text-gray-400">
                {isLotBased ? `Lots (1 Lot = ${lotSize} qty)` : 'Quantity'}
              </label>
              {isFutures && (
                <div className="flex bg-dark-700 rounded-lg border border-dark-600">
                  <button
                    onClick={() => setQuantityMode('lot')}
                    className={`px-3 py-1 text-xs font-medium transition ${
                      quantityMode === 'lot'
                        ? 'bg-green-600 text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Lot
                  </button>
                  <button
                    onClick={() => setQuantityMode('qty')}
                    className={`px-3 py-1 text-xs font-medium transition ${
                      quantityMode === 'qty'
                        ? 'bg-green-600 text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Qty
                  </button>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => setQuantity(Math.max(1, parseInt(quantity) - 1).toString())}
                className="px-4 py-3 bg-dark-700 rounded-lg hover:bg-dark-600 font-bold"
              >
                −
              </button>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="flex-1 bg-dark-700 border border-dark-600 rounded-lg px-4 py-3 text-center text-lg font-bold focus:outline-none focus:border-green-500"
                min="1"
              />
              <button 
                onClick={() => setQuantity((parseInt(quantity) + 1).toString())}
                className="px-4 py-3 bg-dark-700 rounded-lg hover:bg-dark-600 font-bold"
              >
                +
              </button>
            </div>
            <div className="text-right text-xs text-gray-500 mt-1">
              {quantityMode === 'lot' || isOptions ? `${quantity} lot` : `${quantity} qty`}
            </div>
          </div>

          {/* Price - Only show for Limit orders */}
          {orderPriceType === 'LIMIT' && (
            <div>
              <label className="block text-sm text-gray-400 mb-2">Limit Price</label>
              <input
                type="number"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder="Enter price"
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-3 focus:outline-none focus:border-green-500"
                step="0.05"
              />
            </div>
          )}

          {/* LTP Display — use scalar `ltp` (BuySellModal has no livePrice object; stray refs crashed MCX modal) */}
          <div className="bg-dark-700 rounded-lg p-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">Last Traded Price</span>
              <span className="text-xl font-bold">
                ₹
                {Number(ltp || 0).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                {!ltpFromLiveFeed && Number(ltp) > 0 && (
                  <span className="text-xs text-blue-400 ml-2">(Last Price)</span>
                )}
              </span>
            </div>
          </div>

          {/* Balance Info - Indian/MCX Trading */}
          <div className="bg-dark-700 rounded-lg p-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">{isMCX ? 'MCX Balance' : 'Trading Balance'}</span>
              <span className={`font-medium ${isMCX ? 'text-yellow-400' : 'text-green-400'}`}>₹{activeWallet.balance.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Used Margin</span>
              <span className="text-yellow-400">₹{activeWallet.usedMargin.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Available</span>
              <span className="text-green-400 font-medium">₹{activeWallet.available.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Required Margin</span>
              <span className={`font-medium ${marginPreview?.canPlace === false ? 'text-red-400' : ''}`}>
                ₹{marginPreview?.marginRequired?.toLocaleString() || '--'}
              </span>
            </div>
            {marginPreview?.canPlace === false && (
              <div className="text-xs text-red-400 flex items-center gap-1">
                <span>⚠</span>
                <span>Insufficient funds. Need ₹{((marginPreview?.marginRequired || 0) - activeWallet.available).toLocaleString()} more</span>
              </div>
            )}
            <div className="flex justify-between text-sm border-t border-dark-600 pt-2">
              <span className="text-gray-400">Order Value</span>
              <span className="font-medium">₹{orderValue.toLocaleString()}</span>
            </div>
          </div>

          {/* Error/Success Messages */}
          {error && (
            <div className="bg-red-500/20 border border-red-500 text-red-400 px-3 py-2 rounded text-sm">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-green-500/20 border border-green-500 text-green-400 px-3 py-2 rounded text-sm">
              {success}
            </div>
          )}

          {/* Submit Button */}
          <button
            onClick={handlePlaceOrder}
            disabled={loading}
            className={`w-full py-4 rounded-lg font-bold text-lg transition ${
              orderType === 'buy' 
                ? 'bg-green-600 hover:bg-green-700 disabled:bg-green-800' 
                : 'bg-red-600 hover:bg-red-700 disabled:bg-red-800'
            }`}
          >
            {loading ? 'Placing Order...' : `${orderType === 'buy' ? 'BUY' : 'SELL'} ${instrument?.symbol}`}
            <span className="ml-2 text-sm opacity-80">
              ({productType === 'MIS' ? 'Intraday' : productType === 'NRML' ? 'Carry Forward' : 'Delivery'})
            </span>
          </button>

          {/* Info Text */}
          <p className="text-xs text-gray-500 text-center">
            {productType === 'MIS' 
              ? 'Intraday position will be auto squared-off before market close'
              : productType === 'NRML'
              ? 'Position will be carried forward to next trading day'
              : 'Shares will be delivered to your demat account (T+1)'}
          </p>
        </div>
      </div>
    </div>
  );
};

// Wallet Transfer Modal - Transfer funds between user's own wallets
const WalletTransferModal = ({ token, onClose, onSuccess }) => {
  const [sourceWallet, setSourceWallet] = useState('wallet');
  const [targetWallet, setTargetWallet] = useState('cryptoWallet');
  const [amount, setAmount] = useState('');
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleTransfer = async () => {
    if (!amount || Number(amount) <= 0) return setError('Enter valid amount');
    if (sourceWallet === targetWallet) return setError('Source and target wallets cannot be the same');
    
    setLoading(true);
    setError('');
    setSuccess('');
    
    try {
      await axios.post('/api/user/wallet-transfer', { 
        sourceWallet,
        targetWallet,
        amount: Number(amount),
        remarks
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSuccess(`Successfully transferred ₹${Number(amount).toLocaleString()} from ${getWalletDisplayName(sourceWallet)} to ${getWalletDisplayName(targetWallet)}`);
      setAmount('');
      setRemarks('');
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (err) {
      setError(err.response?.data?.message || 'Transfer failed');
    } finally {
      setLoading(false);
    }
  };

  const getWalletDisplayName = (walletType) => {
    switch(walletType) {
      case 'wallet': return 'Trading Wallet';
      case 'cryptoWallet': return 'Crypto Wallet';
      case 'forexWallet': return 'Forex Wallet';
      case 'mcxWallet': return 'MCX Wallet';
      case 'gamesWallet': return 'Games Wallet';
      default: return walletType;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-lg w-full max-w-lg p-6">
        <div className="flex justify-between mb-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <ArrowRightLeft size={24} /> Wallet Transfer
          </h2>
          <button onClick={onClose}><X size={24} /></button>
        </div>

        {error && <div className="bg-red-500/20 text-red-400 p-3 rounded mb-4">{error}</div>}
        {success && <div className="bg-green-500/20 text-green-400 p-3 rounded mb-4">{success}</div>}

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Source Wallet</label>
            <select 
              value={sourceWallet} 
              onChange={e => setSourceWallet(e.target.value)}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
            >
              <option value="wallet">Trading Wallet</option>
              <option value="cryptoWallet">Crypto Wallet</option>
              <option value="forexWallet">Forex Wallet</option>
              <option value="mcxWallet">MCX Wallet</option>
              <option value="gamesWallet">Games Wallet</option>
            </select>
          </div>

          <div className="flex justify-center">
            <ArrowDown size={24} className="text-gray-500" />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Target Wallet</label>
            <select 
              value={targetWallet} 
              onChange={e => setTargetWallet(e.target.value)}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
            >
              <option value="wallet">Trading Wallet</option>
              <option value="cryptoWallet">Crypto Wallet</option>
              <option value="forexWallet">Forex Wallet</option>
              <option value="mcxWallet">MCX Wallet</option>
              <option value="gamesWallet">Games Wallet</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Amount (₹)</label>
            <input 
              type="number" 
              placeholder="Enter amount" 
              value={amount} 
              onChange={e => setAmount(e.target.value)} 
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2" 
              min="0"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Remarks (optional)</label>
            <input 
              type="text" 
              placeholder="Transfer remarks" 
              value={remarks} 
              onChange={e => setRemarks(e.target.value)} 
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2" 
            />
          </div>

          <button 
            onClick={handleTransfer} 
            disabled={loading}
            className="w-full bg-purple-600 hover:bg-purple-700 py-2 rounded flex items-center justify-center gap-2"
          >
            {loading ? 'Transferring...' : <><ArrowRightLeft size={18} /> Transfer Funds</>}
          </button>
        </div>
      </div>
    </div>
  );
};

// Referral Amount Modal Component
const ReferralAmountModal = ({ onClose, user }) => {
  const [referralData, setReferralData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchReferralAmounts = async () => {
      if (!user?.token) return;
      
      try {
        setLoading(true);
        setError(null);
        const { data } = await axios.get('/api/user/referral-amounts', {
          headers: { Authorization: `Bearer ${user.token}` }
        });
        setReferralData(data);
      } catch (err) {
        console.error('Error fetching referral amounts:', err);
        setError(err.response?.data?.message || 'Failed to load referral data');
      } finally {
        setLoading(false);
      }
    };

    fetchReferralAmounts();
  }, [user?.token]);

  const formatDate = (dateString) => {
    if (!dateString) return '—';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-dark-800 rounded-lg p-6 max-w-md w-full mx-4">
          <div className="flex items-center justify-center gap-3 text-gray-400">
            <RefreshCw className="animate-spin" size={20} />
            <span>Loading referral data...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-dark-800 rounded-lg p-6 max-w-md w-full mx-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Referral Amount</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-white">
              <X size={20} />
            </button>
          </div>
          <div className="text-red-400 text-center py-4">
            <p>{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-dark-800 rounded-lg p-6 max-w-4xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Share2 size={20} className="text-purple-400" />
            Referral Amount
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-dark-700 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Total Referrals</div>
            <div className="text-2xl font-bold text-white">{referralData?.totalReferrals || 0}</div>
          </div>
          <div className="bg-dark-700 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Total Earnings</div>
            <div className="text-2xl font-bold text-green-400">
              ₹{(referralData?.totalEarnings || 0).toLocaleString('en-IN')}
            </div>
          </div>
          <div className="bg-dark-700 rounded-lg p-4">
            <div className="text-gray-400 text-sm mb-1">Active Referrals</div>
            <div className="text-2xl font-bold text-purple-400">
              {referralData?.referralAmounts?.filter(r => r.status === 'ACTIVE').length || 0}
            </div>
          </div>
        </div>

        {/* Referral List */}
        <div className="flex-1 overflow-y-auto">
          <div className="bg-dark-700 rounded-lg overflow-hidden">
            <div className="space-y-3 p-4">
              {referralData?.referralAmounts?.map((referral) => (
                <div key={referral.id} className="bg-dark-800 rounded-lg p-4 border border-dark-600">
                  {/* Header with referrer and referred user */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-purple-400 font-medium">{referral.referrer?.username}</span>
                        <span className="text-gray-400">→</span>
                        <span className="text-green-400 font-medium">{referral.referredUser.username}</span>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          referral.status === 'ACTIVE' ? 'bg-green-500/20 text-green-400' :
                          referral.status === 'COMPLETED' ? 'bg-blue-500/20 text-blue-400' :
                          'bg-yellow-500/20 text-yellow-400'
                        }`}>
                          {referral.status}
                        </span>
                      </div>
                      <div className="text-sm text-gray-400">{referral.referredUser.phone}</div>
                      <div className="text-xs text-gray-500">Referral Code: {referral.referralCode}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-green-400">
                        ₹{referral.earnings.toLocaleString('en-IN')}
                      </div>
                      <div className="text-xs text-gray-400">Total Earnings</div>
                    </div>
                  </div>
                  
                  {/* Game-wise Earnings Breakdown */}
                  {referral.earningsByGame && Object.keys(referral.earningsByGame).length > 0 && (
                    <div className="space-y-2 mb-3">
                      <div className="text-xs font-semibold text-gray-300 mb-2">Earnings by Game:</div>
                      {Object.entries(referral.earningsByGame).map(([gameName, gameData]) => (
                        <div key={gameName} className="bg-dark-700 rounded p-2">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-sm font-medium text-cyan-400">{gameName}</span>
                            <span className="text-sm font-bold text-green-400">
                              ₹{gameData.totalAmount.toLocaleString('en-IN')}
                            </span>
                          </div>
                          {gameData.entries && gameData.entries.length > 0 && (
                            <div className="space-y-1 mt-2">
                              {gameData.entries.slice(0, 3).map((entry, idx) => (
                                <div key={idx} className="flex justify-between text-xs text-gray-400">
                                  <span className="truncate flex-1 mr-2">{entry.description}</span>
                                  <span>₹{entry.amount.toLocaleString('en-IN')}</span>
                                </div>
                              ))}
                              {gameData.entries.length > 3 && (
                                <div className="text-xs text-gray-500 italic">
                                  +{gameData.entries.length - 3} more entries...
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* Legacy Bonus Details (if available) */}
                  {(referral.firstGameWin || referral.firstTradingWin) && (
                    <div className="border-t border-dark-600 pt-3 space-y-2">
                      {referral.firstGameWin && (
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-400">
                            First Game Win ({referral.firstGameWin.gameName}):
                          </span>
                          <div className="text-right">
                            <span className="text-green-400">₹{referral.firstGameWin.amount.toLocaleString('en-IN')}</span>
                            <span className="text-gray-500 ml-2">{formatDate(referral.firstGameWin.creditedAt)}</span>
                          </div>
                        </div>
                      )}
                      {referral.firstTradingWin && (
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-400">First Trading Win:</span>
                          <div className="text-right">
                            <span className="text-green-400">₹{referral.firstTradingWin.amount.toLocaleString('en-IN')}</span>
                            <span className="text-gray-500 ml-2">{formatDate(referral.firstTradingWin.creditedAt)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Join Date */}
                  <div className="text-xs text-gray-500 mt-3 pt-3 border-t border-dark-600">
                    Referred on: {formatDate(referral.createdAt)}
                  </div>
                </div>
              ))}
            </div>
            
            {referralData?.referralAmounts?.length === 0 && (
              <div className="text-center py-8 text-gray-400">
                <Share2 size={48} className="mx-auto mb-4 opacity-50" />
                <p>No referrals found</p>
                <p className="text-sm mt-2">Start referring friends to earn rewards!</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
// Helper functions to generate sample chart data
function generateSampleData() {
  const data = [];
  const now = new Date();
  let basePrice = 984;
  
  for (let i = 100; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 60000);
    const open = basePrice + (Math.random() - 0.5) * 2;
    const close = open + (Math.random() - 0.5) * 2;
    const high = Math.max(open, close) + Math.random() * 1;
    const low = Math.min(open, close) - Math.random() * 1;
    
    data.push({
      time: Math.floor(time.getTime() / 1000),
      open,
      high,
      low,
      close,
    });
    
    basePrice = close;
  }
  
  return data;
}

function generateVolumeData() {
  const data = [];
  const now = new Date();
  
  for (let i = 100; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 60000);
    const value = Math.floor(Math.random() * 10000) + 1000;
    
    data.push({
      time: Math.floor(time.getTime() / 1000),
      value,
      color: Math.random() > 0.5 ? '#22c55e80' : '#ef444480',
    });
  }
  
  return data;
}

export default UserDashboard;
  