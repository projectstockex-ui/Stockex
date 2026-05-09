/**
 * USD-quoted spot book (crypto USDT, synthetic forex) — quotes in USD/foreign units;
 * wallet economics use INR via getUsdInrRate().
 */

export function orderIsCrypto(o) {
  if (!o) return false;
  return o.exchange === 'BINANCE' || o.isCrypto === true;
}

export function orderIsForex(o) {
  if (!o) return false;
  const seg = String(o.segment || '').toUpperCase();
  return seg === 'FOREX' || seg === 'FOREXFUT' || seg === 'FOREXOPT' || o.exchange === 'FOREX' || o.isForex === true;
}

/** Crypto or synthetic forex: fractional qty, USDT-style quote, INR notional on server (spot only — not crypto F&O) */
export function orderIsUsdSpot(o) {
  if (orderIsForex(o)) {
    const it = String(o.instrumentType || '').toUpperCase();
    const ds = String(o.displaySegment || '').toUpperCase();
    if (ds === 'FOREXOPT' || it === 'OPTIONS' || it === 'OPT' || it === 'FUTURES') return false;
    return true;
  }
  if (!orderIsCrypto(o)) return false;
  const it = String(o.instrumentType || '').toUpperCase();
  if (it === 'FUTURES' || it === 'OPTIONS' || it === 'OPT') return false;
  const ds = String(o.displaySegment || '').toUpperCase();
  if (ds === 'CRYPTOFUT' || ds === 'CRYPTOOPT') return false;
  return true;
}

export function tradeIsUsdSpot(t) {
  if (!t) return false;
  return orderIsUsdSpot(t);
}

export function tradeIsForex(t) {
  if (!t) return false;
  return !!(t.isForex || orderIsForex(t));
}

export function tradeIsCryptoOnly(t) {
  if (!t) return false;
  return !!(t.isCrypto || orderIsCrypto(t)) && !tradeIsForex(t);
}
