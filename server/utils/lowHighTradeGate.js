import { MARKET_WATCH_SEGMENTS } from '../constants/marketWatchSegments.js';

/** Map client segment (e.g. CRYPTO spot) to Segment Grouping displaySegment key. */
export function resolveGroupingDisplaySegment(inst, ctx = {}) {
  const ds = String(inst?.displaySegment || ctx.displaySegment || ctx.segment || '').toUpperCase();
  if (ds && MARKET_WATCH_SEGMENTS.includes(ds)) return ds;

  const exchange = String(inst?.exchange || ctx.exchange || '').toUpperCase();
  const it = String(inst?.instrumentType || ctx.instrumentType || '').toUpperCase();

  if (exchange === 'BINANCE' || inst?.isCrypto || ctx.isCrypto) {
    if (it === 'OPTIONS' || ds === 'CRYPTOOPT') return 'CRYPTOOPT';
    return 'CRYPTOFUT';
  }
  if (exchange === 'FOREX' || inst?.isForex || ctx.isForex) {
    if (it === 'OPTIONS' || ds === 'FOREXOPT') return 'FOREXOPT';
    return 'FOREXFUT';
  }
  return ds;
}

export function synthInstrumentFromOrderContext(ctx = {}) {
  if (!ctx || typeof ctx !== 'object') return null;
  const symbol = ctx.symbol || ctx.tradingSymbol;
  if (!symbol && !ctx.token && !ctx.pair) return null;
  return {
    symbol: ctx.symbol,
    tradingSymbol: ctx.tradingSymbol || ctx.symbol,
    token: ctx.token,
    pair: ctx.pair,
    exchange: ctx.exchange,
    displaySegment: ctx.displaySegment || ctx.segment,
    instrumentType: ctx.instrumentType,
    isCrypto: ctx.isCrypto,
    isForex: ctx.isForex,
    low: ctx.dayLow ?? ctx.low,
    high: ctx.dayHigh ?? ctx.high,
    ltp: ctx.price ?? ctx.ltp,
  };
}

/** Day low/high from DB instrument or live tick fields on the order body. */
export function resolveDayLowHighRange(inst, ctx = {}) {
  const low = Number(inst?.low ?? ctx.dayLow ?? ctx.low) || 0;
  const high = Number(inst?.high ?? ctx.dayHigh ?? ctx.high) || 0;
  if (low > 0 && high > 0 && high >= low) {
    return { low, high };
  }
  return null;
}

export function resolveOrderPriceForLowHighCheck(orderData = {}, instrument = null) {
  const orderType = String(orderData.orderType || '').toUpperCase();
  if (orderType === 'SL' || orderType === 'SL-M') {
    return Number(orderData.triggerPrice || orderData.price || 0);
  }
  if (orderType === 'LIMIT') {
    return Number(orderData.limitPrice || orderData.price || 0);
  }
  const side = String(orderData.side || '').toUpperCase();
  if (side === 'BUY') {
    return Number(orderData.askPrice || orderData.price || orderData.ltp || instrument?.ltp || 0);
  }
  if (side === 'SELL') {
    return Number(orderData.bidPrice || orderData.price || orderData.ltp || instrument?.ltp || 0);
  }
  return Number(orderData.price || orderData.ltp || instrument?.ltp || 0);
}

export function assertOrderWithinDayLowHigh({
  enforceLowHigh,
  segmentLowHigh,
  range,
  orderPrice,
}) {
  if (!enforceLowHigh || !range) return;
  const lowPrice = Number(range.low) || 0;
  const highPrice = Number(range.high) || 0;
  const px = Number(orderPrice) || 0;
  if (!(lowPrice > 0 && highPrice > 0 && px > 0)) return;
  if (px < lowPrice || px > highPrice) {
    const groupHint = segmentLowHigh?.groupLabel ? ` (${segmentLowHigh.groupLabel} group)` : '';
    const err = new Error(
      `Order price ${px} is outside the allowed range (${lowPrice} - ${highPrice})${groupHint}. Trading is restricted to within day low–high for this instrument group.`
    );
    err.statusCode = 400;
    throw err;
  }
}
