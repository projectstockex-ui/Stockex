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

    const clearing = await fetchNifty50SessionClearing15mCached();
    const safeSessionClearing = toPositiveNumber(clearing?.close);
    const isNseOpen = isNseCashSessionOpenNowIST();

    const closeRefInst = await Instrument.findOne({
      $or: [{ token: '256265' }, { symbol: { $in: ['NIFTY', 'NIFTY 50'] } }],
    })
      .select('ltp open high low close previousDayClosePrice')
      .lean();
    const safePrevDayClose = toPositiveNumber(closeRefInst?.previousDayClosePrice);
    const dbLtp = toPositiveNumber(closeRefInst?.ltp);
    const dbClose = toPositiveNumber(closeRefInst?.close);

    const safeKitePrice = toPositiveNumber(await fetchNifty50LastPriceFromKite());

    const liveMap = getMarketData();
    const liveTick = liveMap?.['256265'] || liveMap?.[256265];
    const wsLtp = toPositiveNumber(liveTick?.ltp);
    const wsClose = toPositiveNumber(liveTick?.close);

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

    const ltpPrice = pickFirstPositive(
      bracketDayLtp,
      wsLtp,
      safeKitePrice,
      dbLtp,
      dbClose,
      resultClose,
      safeSessionClearing
    );
    const clearingPrice = pickFirstPositive(
      lockedClearing,
      safeSessionClearing,
      safePrevDayClose,
      dbClose,
      resultClose,
      ltpPrice
    );

    const selectedPrice = isNseOpen ? ltpPrice : closedMode === 'ltp' ? ltpPrice : clearingPrice;

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
        ? bracketDayLtp != null
          ? 'bracket_resolved_ltp'
          : safeKitePrice != null
            ? 'kite_closed_ltp'
            : wsLtp != null
              ? 'ws_closed_ltp'
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

    return {
      symbol: 'NIFTY',
      price: selectedPrice,
      ltpPrice,
      clearingPrice,
      open: pickFirstPositive(liveTick?.open, closeRefInst?.open, selectedPrice),
      high: pickFirstPositive(liveTick?.high, closeRefInst?.high, selectedPrice),
      low: pickFirstPositive(liveTick?.low, closeRefInst?.low, selectedPrice),
      close: pickFirstPositive(wsClose, dbClose, selectedPrice),
      prevDayClose: pickFirstPositive(safePrevDayClose, dbClose, selectedPrice),
      sessionClearing: pickFirstPositive(safeSessionClearing, clearingPrice),
      marketOpen: isNseOpen,
      closedMode,
      source,
      timestamp: new Date().toISOString(),
    };
  }
}
