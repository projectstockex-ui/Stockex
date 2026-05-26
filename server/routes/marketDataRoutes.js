import express from 'express';
import axios from 'axios';
import { fetchNifty50HistoricalFromKite, fetchZerodhaHistoricalByToken } from '../utils/kiteNiftyQuote.js';

const router = express.Router();

/** Kite `instruments/historical` interval strings (must match api.kite.trade). */
const NIFTY_HISTORY_INTERVALS = new Set([
  'minute',
  '3minute',
  '5minute',
  '10minute',
  '15minute',
  '30minute',
  '60minute',
  'day',
]);

function parseNiftyHistoryInterval(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (NIFTY_HISTORY_INTERVALS.has(s)) return s;
  return '15minute';
}

function mockPeriodMsForInterval(interval) {
  switch (interval) {
    case 'minute':
      return 60 * 1000;
    case '3minute':
      return 3 * 60 * 1000;
    case '10minute':
      return 10 * 60 * 1000;
    case '15minute':
      return 15 * 60 * 1000;
    case '30minute':
      return 30 * 60 * 1000;
    case '60minute':
      return 60 * 60 * 1000;
    case 'day':
      return 24 * 60 * 60 * 1000;
    case '5minute':
    default:
      return 5 * 60 * 1000;
  }
}

// Get BTC historical data with interval parameter (5m, 15m, 30m, 1h)
router.get('/btc-history', async (req, res) => {
  try {
    const intervalParam = req.query.interval || '5m';

    const intervalMap = {
      '5m': '5m',
      '5minute': '5m',
      '15m': '15m',
      '15minute': '15m',
      '30m': '30m',
      '30minute': '30m',
      '1h': '1h',
      '1hour': '1h',
      '60m': '1h',
      '60minute': '1h',
    };
    const binanceInterval = intervalMap[intervalParam] || '5m';

    const response = await axios.get('https://api.binance.com/api/v3/klines', {
      params: {
        symbol: 'BTCUSDT',
        interval: binanceInterval,
        limit: 100,
      },
      timeout: 20000,
      validateStatus: (s) => s < 500,
    });

    if (response.status !== 200 || !Array.isArray(response.data)) {
      const msg =
        response.data?.msg ||
        response.statusText ||
        `HTTP ${response.status}`;
      console.warn('[btc-history] Binance:', msg);
      return res.status(502).json({
        success: false,
        message: 'BTC historical data unavailable from this region',
        data: [],
      });
    }

    const data = response.data.map((candle) => ({
      time: Math.floor(candle[0] / 1000),
      timestamp: new Date(candle[0]).toISOString(),
      open: parseFloat(candle[1]),
      high: parseFloat(candle[2]),
      low: parseFloat(candle[3]),
      close: parseFloat(candle[4]),
      volume: parseFloat(candle[5]),
    }));

    console.log(`BTC History: Returning ${data.length} candles (interval: ${binanceInterval})`);
    res.json({ success: true, interval: binanceInterval, source: 'binance', data });
  } catch (error) {
    const st = error?.response?.status;
    console.warn('[btc-history]', st || error?.message || error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch BTC historical data',
      data: [],
    });
  }
});

// NIFTY 50 chart history — Zerodha Kite when session valid; else mock (dev only)
// ?interval=15minute — align chart candles with Kite (5m / 15m / 30m / 1h etc.)
router.get('/nifty-history', async (req, res) => {
  try {
    const interval = parseNiftyHistoryInterval(req.query.interval);
    const fromKite = await fetchNifty50HistoricalFromKite({
      interval,
      daysBack: 15,
      maxCandles: 120,
    });
    if (fromKite && fromKite.length > 0) {
      return res.json({ success: true, source: 'zerodha', interval, data: fromKite });
    }

    const now = Date.now();
    const periodMs = mockPeriodMsForInterval(interval);
    const basePrice = 24000;
    const data = [];
    for (let i = 100; i >= 0; i--) {
      const time = now - i * periodMs;
      const randomChange = (Math.random() - 0.5) * 100;
      const open = basePrice + randomChange;
      const close = open + (Math.random() - 0.5) * 50;
      const high = Math.max(open, close) + Math.random() * 30;
      const low = Math.min(open, close) - Math.random() * 30;
      data.push({
        time: Math.floor(time / 1000),
        timestamp: new Date(time).toISOString(),
        open: parseFloat(open.toFixed(2)),
        high: parseFloat(high.toFixed(2)),
        low: parseFloat(low.toFixed(2)),
        close: parseFloat(close.toFixed(2)),
        volume: Math.floor(Math.random() * 1000000),
      });
    }

    res.json({
      success: true,
      source: 'mock',
      interval,
      message: 'Zerodha not connected or history unavailable — using placeholder candles',
      data,
    });
  } catch (error) {
    console.error('Error fetching NIFTY history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch NIFTY historical data',
      data: [],
    });
  }
});

/** Map UI/Binance-style intervals to Kite historical API interval names */
function normalizeKiteInterval(interval) {
  const raw = String(interval || '15minute').trim().toLowerCase();
  const map = {
    '1m': 'minute',
    minute: 'minute',
    '5m': '5minute',
    '5minute': '5minute',
    '15m': '15minute',
    '15minute': '15minute',
    '30m': '30minute',
    '30minute': '30minute',
    '1h': '60minute',
    '60minute': '60minute',
    '1d': 'day',
    day: 'day',
    one_minute: 'minute',
    five_minute: '5minute',
    fifteen_minute: '15minute',
    thirty_minute: '30minute',
    one_hour: '60minute',
    one_day: 'day',
  };
  return map[raw] || raw;
}

// Generic Zerodha instrument history by token — for MCX, NSE, BSE instruments
// ?token=220822&interval=15minute&daysBack=15&maxCandles=120
router.get('/zerodha-history', async (req, res) => {
  try {
    const { token, interval = '15minute', daysBack = 15, maxCandles = 120 } = req.query;
    const kiteInterval = normalizeKiteInterval(interval);
    
    if (!token) {
      return res.status(400).json({ 
        success: false, 
        message: 'Instrument token is required',
        data: []
      });
    }

    const fromKite = await fetchZerodhaHistoricalByToken(
      token,
      kiteInterval,
      parseInt(daysBack, 10),
      parseInt(maxCandles, 10)
    );
    
    if (fromKite && fromKite.length > 0) {
      return res.json({ success: true, source: 'zerodha', interval: kiteInterval, data: fromKite });
    }

    res.json({
      success: false,
      message: 'Zerodha not connected or history unavailable',
      data: [],
    });
  } catch (error) {
    console.error('Error fetching Zerodha instrument history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch instrument historical data',
      data: [],
    });
  }
});

export default router;
