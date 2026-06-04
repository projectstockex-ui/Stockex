/**
 * USD-quoted spot book (crypto USDT, synthetic forex) — quotes in USD/foreign units;
 * wallet economics use INR via getUsdInrRate().
 */

export function orderIsCrypto(o) {
  if (!o) return false;
  if (o.isCrypto === true || o.exchange === 'BINANCE') return true;
  const seg = String(o.segment || o.displaySegment || '').toUpperCase();
  if (seg === 'CRYPTOFUT' || seg === 'CRYPTOOPT' || seg === 'CRYPTO') return true;
  const pair = String(o.pair || o.symbol || '').toUpperCase();
  if (pair.endsWith('USDT')) return true;
  return false;
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

/** Upper/lower circuit rules apply only on NSE / BSE / MCX books — never crypto or forex. */
export function tradeIsIndianMarket(t) {
  if (!t) return false;
  if (orderIsCrypto(t) || orderIsForex(t)) return false;
  const ex = String(t.exchange || '').toUpperCase();
  const seg = String(t.segment || t.displaySegment || '').toUpperCase();
  if (['NSE', 'BSE', 'MCX', 'NFO', 'BFO'].includes(ex)) return true;
  if (
    ['NSE-EQ', 'NSEFUT', 'NSEOPT', 'BSE-FUT', 'BSE-OPT', 'MCXFUT', 'MCXOPT', 'EQUITY', 'FNO', 'MCX'].includes(
      seg
    )
  ) {
    return true;
  }
  return false;
}
