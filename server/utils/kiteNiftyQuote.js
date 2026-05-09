import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(__dirname, '../.zerodha-session.json');

/** Same file as Zerodha routes — read valid access token for Kite REST. */
export function loadZerodhaSessionFromFile() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      // Accept both old + new session shapes:
      // - current controller persists { accessToken, apiKey, userId, loginTime }
      // - older flows may persist expiresAt
      if (data?.accessToken) {
        if (!data.expiresAt) return data;
        if (new Date(data.expiresAt) > new Date()) return data;
      }
    }
  } catch (e) {
    console.warn('[kiteNiftyQuote] session read:', e.message);
  }
  return null;
}

/**
 * NIFTY 50 last_price from Kite quote API (matches Kite app LTP when session valid).
 */
export async function fetchNifty50LastPriceFromKite() {
  const session = loadZerodhaSessionFromFile();
  const apiKey = process.env.ZERODHA_API_KEY;
  if (!session?.accessToken || !apiKey) return null;
  try {
    const response = await axios.get('https://api.kite.trade/quote?i=NSE:NIFTY%2050', {
      headers: {
        'X-Kite-Version': '3',
        Authorization: `token ${apiKey}:${session.accessToken}`,
      },
    });
    if (response.data?.status !== 'success' || !response.data?.data) return null;
    const quote = Object.values(response.data.data)[0];
    const lp = quote?.last_price;
    if (lp == null || !Number.isFinite(Number(lp))) return null;
    return Number(lp);
  } catch (e) {
    console.warn('[kiteNiftyQuote] quote failed:', e.message);
    return null;
  }
}

/**
 * NIFTY 50 index OHLCV from Kite historical API (instrument_token 256265).
 * Same source as Kite charts when interval matches.
 *
 * @param {{ interval?: string, daysBack?: number, maxCandles?: number }} [opts]
 * @returns {Promise<Array<{time:number,timestamp:string,open:number,high:number,low:number,close:number,volume:number}>|null>}
 */
export async function fetchNifty50HistoricalFromKite(opts = {}) {
  const { interval = '5minute', daysBack = 15, maxCandles = 120 } = opts;
  const session = loadZerodhaSessionFromFile();
  const apiKey = process.env.ZERODHA_API_KEY;
  if (!session?.accessToken || !apiKey) return null;

  const instrumentToken = 256265;
  const now = new Date();
  const to = now.toISOString().split('T')[0];
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - daysBack);
  const from = fromDate.toISOString().split('T')[0];

  try {
    const response = await axios.get(
      `https://api.kite.trade/instruments/historical/${instrumentToken}/${interval}?from=${from}&to=${to}`,
      {
        headers: {
          'X-Kite-Version': '3',
          Authorization: `token ${apiKey}:${session.accessToken}`,
        },
      }
    );
    if (response.data?.status !== 'success' || !Array.isArray(response.data?.data?.candles)) {
      return null;
    }
    const candles = response.data.data.candles.map((c) => ({
      time: Math.floor(new Date(c[0]).getTime() / 1000),
      timestamp: new Date(c[0]).toISOString(),
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: c[5] != null ? Number(c[5]) : 0,
    }));
    return candles.slice(-maxCandles);
  } catch (e) {
    console.warn('[kiteNiftyQuote] historical failed:', e.response?.data?.message || e.message);
    return null;
  }
}

/** YYYY-MM-DD in Asia/Kolkata for a given Date (default: now). */
export function istCalendarDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Check if NSE cash market is currently open (9:15 AM - 3:30 PM IST). */
export function isNseCashMarketOpen() {
  const now = new Date();
  const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const hours = istTime.getHours();
  const minutes = istTime.getMinutes();
  const minutesFromMidnight = hours * 60 + minutes;
  // Market hours: 9:15 (555 min) to 15:30 (930 min)
  return minutesFromMidnight >= 555 && minutesFromMidnight < 930;
}

/**
 * Close of the last completed 15m candle for today's IST session (Kite historical).
 * Aligns with Kite 15m chart "C" on the final bar of the day after 15:30.
 * Cached ~45s to avoid hammering the historical API on each game-price poll.
 *
 * @returns {Promise<{ close: number, barTime: number, barTimeISO: string } | null>}
 */
const CLEARING_CACHE_MS = 0;
let clearing15mCache = { dateKey: '', value: null, fetchedAt: 0 };

export async function fetchNifty50SessionClearing15mCached() {
  const todayKey = istCalendarDateString();
  const now = Date.now();
  
  // Normal cache check (45 seconds)
  if (
    clearing15mCache.dateKey === todayKey &&
    clearing15mCache.value != null &&
    now - clearing15mCache.fetchedAt < CLEARING_CACHE_MS
  ) {
    return clearing15mCache.value;
  }

  const candles = await fetchNifty50HistoricalFromKite({
    interval: '15minute',
    daysBack: 5,
    maxCandles: 250,
  });
  if (!candles || candles.length === 0) {
    clearing15mCache = { dateKey: todayKey, value: null, fetchedAt: now };
    return null;
  }

  const todays = candles.filter((c) => istCalendarDateString(new Date(c.time * 1000)) === todayKey);
  if (todays.length === 0) {
    clearing15mCache = { dateKey: todayKey, value: null, fetchedAt: now };
    return null;
  }

  const last = todays[todays.length - 1];
  const out = {
    close: last.close, // Use last candle's close as clearing price
    barTime: last.time,
    barTimeISO: last.timestamp,
  };
  clearing15mCache = { dateKey: todayKey, value: out, fetchedAt: now };
  return out;
}
