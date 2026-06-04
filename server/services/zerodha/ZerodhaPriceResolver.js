import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Instrument from '../../models/Instrument.js';
import GameResult from '../../models/GameResult.js';
import NiftyJackpotResult from '../../models/NiftyJackpotResult.js';
import NiftyBracketTrade from '../../models/NiftyBracketTrade.js';
import { getTodayISTString } from '../../utils/istDate.js';
import {
  fetchNifty50LastPriceFromKite,
  fetchNifty50SessionClearing15mCached,
} from '../../utils/kiteNiftyQuote.js';
import { getMarketData } from '../zerodhaWebSocket.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRICE_CACHE_FILE = path.join(__dirname, '../../.nifty-last-price.json');

function readCachedPrice() {
  try {
    const raw = fs.readFileSync(PRICE_CACHE_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (data?.price > 0) return { price: Number(data.price), date: data.date || '' };
  } catch {}
  return null;
}

function writeCachedPrice(price, date) {
  try {
    fs.writeFileSync(PRICE_CACHE_FILE, JSON.stringify({ price, date, savedAt: new Date().toISOString() }));
  } catch {}
}

const toPositiveNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const pickFirstPositive = (...vals) => {
  for (const v of vals) {
    const n = toPositiveNumber(v);
    if (n != null) return n;
  }
  return null;
};

function isNseCashSessionOpenNowIST() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const weekday = String(get('weekday') || '');
  const h = Number(get('hour') || 0);
  const m = Number(get('minute') || 0);
  const s = Number(get('second') || 0);
  const sec = h * 3600 + m * 60 + s;
  const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday);
  return isWeekday && sec >= 33300 && sec < 55800;
}

export class ZerodhaPriceResolver {
  async resolveNiftyGamePrice(closedModeInput = 'clearing') {
    const closedMode = String(closedModeInput).toLowerCase() === 'ltp' ? 'ltp' : 'clearing';
    const todayIst = getTodayISTString();

    let clearing = null;
    let safeSessionClearing = null;
    try {
      clearing = await fetchNifty50SessionClearing15mCached();
      safeSessionClearing = toPositiveNumber(clearing?.close);
    } catch (error) {
      console.warn('fetchNifty50SessionClearing15mCached failed:', error.message);
    }
    const isNseOpen = isNseCashSessionOpenNowIST();

    const closeRefInst = await Instrument.findOne({
      $or: [{ token: '256265' }, { symbol: { $in: ['NIFTY', 'NIFTY 50'] } }],
    })
      .select('ltp open high low close previousDayClosePrice')
      .lean();
    const safePrevDayClose = toPositiveNumber(closeRefInst?.previousDayClosePrice);
    const dbLtp = toPositiveNumber(closeRefInst?.ltp);
    const dbClose = toPositiveNumber(closeRefInst?.close);

    let safeKitePrice = null;
    try {
      safeKitePrice = toPositiveNumber(await fetchNifty50LastPriceFromKite());
    } catch (error) {
      console.warn('fetchNifty50LastPriceFromKite failed:', error.message);
    }

    const liveMap = getMarketData();
    const liveTick = liveMap?.['256265'] || liveMap?.[256265];
    const wsLtp = toPositiveNumber(liveTick?.ltp);
    const wsClose = toPositiveNumber(liveTick?.close);
    
    console.log(' WEBSOCKET DATA - liveTick:', JSON.stringify(liveTick), '| wsLtp:', wsLtp, '| wsClose:', wsClose);

    const jackpotLocked = await NiftyJackpotResult.findOne({
      resultDate: todayIst,
      lockedPrice: { $exists: true, $ne: null },
    })
      .select('lockedPrice')
      .lean();
    const lockedClearing = toPositiveNumber(jackpotLocked?.lockedPrice);

    const latestBracketResolved = await NiftyBracketTrade.findOne({
      status: { $in: ['won', 'lost'] },
      exitPrice: { $exists: true, $ne: null },
      resolvedAt: { $exists: true, $ne: null },
    })
      .sort({ resolvedAt: -1, updatedAt: -1 })
      .select('exitPrice resolvedAt')
      .lean();
    let bracketDayLtp = null;
    if (latestBracketResolved?.resolvedAt) {
      const resolvedDay = getTodayISTString(new Date(latestBracketResolved.resolvedAt));
      if (resolvedDay === todayIst) {
        bracketDayLtp = toPositiveNumber(latestBracketResolved.exitPrice);
      }
    }

    const latestResult = await GameResult.findOne({ gameId: 'updown' })
      .sort({ windowDate: -1, windowNumber: -1 })
      .select('closePrice')
      .lean();
    const resultClose = toPositiveNumber(latestResult?.closePrice);

    // Live session: tick LTP first. 15m bar close is reference only (not the flickering "LTP").
    //
    // IMPORTANT:
    // - When market is closed and `closedMode='ltp'`, users expect "real LTP" stick (Kite quote / WS),
    //   not "last bracket resolved" (bracketDayLtp), which can differ from NSE LTP.
    const ltpPrice = isNseOpen
      ? pickFirstPositive(wsLtp, safeKitePrice, dbLtp, bracketDayLtp, safeSessionClearing, dbClose)
      : closedMode === 'ltp'
        ? pickFirstPositive(wsLtp, safeKitePrice, dbLtp, safeSessionClearing, dbClose)
        : pickFirstPositive(bracketDayLtp, wsLtp, safeKitePrice, dbLtp, safeSessionClearing, dbClose);

    const clearingPrice = pickFirstPositive(
      lockedClearing,
      safeKitePrice, // Use Kite LTP as clearing price (matches user requirement)
      safePrevDayClose,
      safeSessionClearing,
      dbClose,
      resultClose,
      ltpPrice
    );

    const fileCache = readCachedPrice();
    const fileCachePrice = toPositiveNumber(fileCache?.price);

    // Game-specific price fixes
    let clearingPriceFinal = pickFirstPositive(clearingPrice, fileCachePrice);
    let ltpPriceFinal = pickFirstPositive(ltpPrice, fileCachePrice);

    // Use live Zerodha data - no hardcoded fixes
    console.log(' LIVE DATA - isNseOpen:', isNseOpen);
    console.log(' LIVE PRICES - wsLtp:', wsLtp, '| safeKitePrice:', safeKitePrice, '| dbLtp:', dbLtp, '| dbClose:', dbClose, '| safeSessionClearing:', safeSessionClearing);
    console.log(' CALCULATED - ltpPriceFinal:', ltpPriceFinal, '| clearingPriceFinal:', clearingPriceFinal, '| closedMode:', closedMode);

    const selectedPrice = isNseOpen ? ltpPriceFinal : (closedMode === 'ltp' ? ltpPriceFinal : clearingPriceFinal); // Respect closedMode parameter

    // Persist the best price we have so it survives server restarts
    if (selectedPrice != null) {
      writeCachedPrice(selectedPrice, todayIst);
    }

    const source = isNseOpen
      ? safeKitePrice != null
        ? 'kite'
        : wsLtp != null
          ? 'ws_cache'
          : dbLtp != null || dbClose != null
            ? 'db_fallback'
            : resultClose != null
              ? 'game_result_fallback'
              : 'unavailable'
      : closedMode === 'ltp'
        ? wsLtp != null
          ? 'ws_closed_ltp'
          : safeKitePrice != null
            ? 'kite_closed_ltp'
            : dbLtp != null
              ? 'db_closed_ltp'
              : resultClose != null
                ? 'game_result_closed_ltp'
                : 'unavailable'
        : lockedClearing != null
          ? 'jackpot_locked_clearing'
          : safeSessionClearing != null
            ? 'session_clearing'
            : safePrevDayClose != null
              ? 'previous_day_close'
              : dbClose != null
                ? 'db_close'
                : resultClose != null
                  ? 'game_result_clearing'
                  : 'unavailable';

    if (!isNseOpen) {
      console.log('[PriceResolver] Market CLOSED → serving:', selectedPrice, '| safeSessionClearing:', safeSessionClearing, '| safeKitePrice:', safeKitePrice, '| wsLtp:', wsLtp, '| fileCache:', fileCachePrice, '| source:', source);
      console.log('💰 PRICE BREAKDOWN - Clearing Price:', clearingPriceFinal, '| Actual LTP:', ltpPriceFinal, '| Selected Price:', selectedPrice);
    }

    return {
      symbol: 'NIFTY',
      price: selectedPrice,
      ltpPrice: ltpPriceFinal,    // Fixed LTP for specific games
      clearingPrice: clearingPriceFinal,  // Fixed clearing price for specific games
      safeSessionClearing: safeSessionClearing, // Raw last completed 15m close (no clearing fallback mix)
      actualLtp: ltpPriceFinal,  // Explicit actual LTP field
      ltp: ltpPriceFinal,       // Alternative LTP field name
      open: pickFirstPositive(liveTick?.open, closeRefInst?.open, selectedPrice),
      high: pickFirstPositive(liveTick?.high, closeRefInst?.high, selectedPrice),
      low: pickFirstPositive(liveTick?.low, closeRefInst?.low, selectedPrice),
      close: pickFirstPositive(wsClose, dbClose, selectedPrice),
      prevDayClose: pickFirstPositive(safePrevDayClose, dbClose, selectedPrice),
      sessionClearing: pickFirstPositive(clearingPriceFinal, safeSessionClearing),
      marketOpen: isNseOpen,
      closedMode,
      source,
      timestamp: new Date().toISOString(),
      
      // Complete Zerodha WebSocket data fields
      token: '256265',
      bid: liveTick?.bid || 0,
      ask: liveTick?.ask || 0,
      rawBid: liveTick?.rawBid || 0,
      rawAsk: liveTick?.rawAsk || 0,
      circuit: liveTick?.circuit || null,
      change: liveTick?.change || 0,
      changePercent: liveTick?.changePercent || 0,
      volume: liveTick?.volume || 0,
      buyQuantity: liveTick?.buyQuantity || 0,
      sellQuantity: liveTick?.sellQuantity || 0,
      lastTradeTime: liveTick?.lastTradeTime || null,
      oi: liveTick?.oi || 0,
      oiDayHigh: liveTick?.oiDayHigh || 0,
      oiDayLow: liveTick?.oiDayLow || 0,
      depth: liveTick?.depth || {},
      lastUpdated: liveTick?.lastUpdated || new Date(),
      serverTimestamp: liveTick?.serverTimestamp || Date.now(),
    };
  }
}
