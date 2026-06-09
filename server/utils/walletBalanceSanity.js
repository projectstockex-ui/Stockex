/** Reject corrupted wallet amounts (bad MTM / autosquare writes). */

export const MAX_SANE_SUBWALLET_INR = 1_000_000_000; // 100 crore — above this is always a bug

export function isAbsurdWalletInr(value) {
  const n = Number(value);
  return !Number.isFinite(n) || n < 0 || n > MAX_SANE_SUBWALLET_INR;
}

export function sanitizeInrWalletAmount(value, { field = 'balance', userId = null, log = true } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > MAX_SANE_SUBWALLET_INR) {
    if (log) {
      console.error(
        `[WalletSanity] Absurd ${field}=${n}${userId ? ` user=${userId}` : ''} — clamped to ${MAX_SANE_SUBWALLET_INR}`
      );
    }
    return MAX_SANE_SUBWALLET_INR;
  }
  return Math.round(n * 100) / 100;
}

/**
 * NSE/BSE mark price must stay near entry (blocks crypto-scale LTP leaking into equity).
 */
export function isPlausibleNseBseMarkPrice(trade, markPrice) {
  const entry = Number(trade?.entryPrice) || 0;
  const mark = Number(markPrice) || 0;
  if (!(entry > 0) || !(mark > 0)) return true;
  if (trade?.isCrypto || trade?.isForex || trade?.exchange === 'BINANCE') return true;
  const ratio = mark / entry;
  return ratio >= 0.05 && ratio <= 20;
}

export function resolveSafeNseBseMarkPrice(trade, markPrice) {
  const mark = Number(markPrice) || 0;
  if (isPlausibleNseBseMarkPrice(trade, mark)) return mark;
  const fallback = Number(trade?.currentPrice) || Number(trade?.entryPrice) || 0;
  console.warn(
    `[WalletSanity] Reject mark ${mark} vs entry ${trade?.entryPrice} for ${trade?.symbol || trade?.tradeId} — using ${fallback}`
  );
  return fallback > 0 ? fallback : mark;
}

/** Net balance used in carry-forward qty — never use corrupted wallet snapshots. */
export function capCarryForwardNetBalance(balanceBasis, pnl, netBalance) {
  const basis = Math.max(0, Number(balanceBasis) || 0);
  const p = Number(pnl) || 0;
  let n = Math.max(0, Number(netBalance) || 0);
  if (!Number.isFinite(n)) n = 0;
  const pnlCap = Math.max(-basis, Math.min(p, basis * 5));
  const equityCap = basis > 0 ? basis + pnlCap : n;
  return sanitizeInrWalletAmount(Math.min(n, equityCap, basis * 20 || equityCap), {
    field: 'carryForwardNetBalance',
    log: n > equityCap * 1.01,
  });
}

const MAX_NSE_MCX_CARRY_QTY = 50_000;
const MAX_CRYPTO_FOREX_CARRY_QTY = 500_000;

/**
 * End-time nextDayQty — corrupted balance once produced 3cr+ share qty on NSE.
 */
export function capCarryForwardNextDayQty(segmentGroup, qtyAtEvent, rawNextDayQty) {
  const raw = Math.max(0, Math.floor(Number(rawNextDayQty) || 0));
  const orig = Math.max(0, Math.floor(Number(qtyAtEvent) || 0));
  const cappedByOrig = orig > 0 ? Math.min(raw, orig) : raw;
  const maxQty =
    segmentGroup === 'CRYPTO' || segmentGroup === 'FOREX'
      ? MAX_CRYPTO_FOREX_CARRY_QTY
      : MAX_NSE_MCX_CARRY_QTY;
  return Math.min(cappedByOrig, maxQty);
}

export function isAbsurdOpenQuantity(trade) {
  const q = Number(trade?.quantity) || 0;
  const oq = Number(trade?.originalQty) || 0;
  if (q > MAX_NSE_MCX_CARRY_QTY || q > MAX_CRYPTO_FOREX_CARRY_QTY) return true;
  if (oq > 0 && q > oq * 50) return true;
  return false;
}

/**
 * 24-May crypto/forex carry: trim position notional to wallet × carryForwardLeverage cap.
 * If position value ≤ cap → keep full qty; else nextDayQty = floor(cap / LTP).
 */
export function computeCryptoForexCarryNextDayQty(trade, {
  qtyAtEvent,
  ltp,
  walletEquity,
  carryForwardLeverage,
}) {
  const qty = Math.max(0, Math.floor(Number(qtyAtEvent) || 0));
  const px = Number(ltp) || 0;
  const equity = Math.max(0, Number(walletEquity) || 0);
  const lev = Number(carryForwardLeverage);
  if (!(lev > 0)) {
    return { nextDayQty: 0, carryForwardLimit: 0, positionValue: 0, markPrice: px };
  }

  if (qty <= 0 || px <= 0) {
    return { nextDayQty: 0, carryForwardLimit: 0, positionValue: 0, markPrice: px };
  }

  const carryForwardLimit = Math.round(equity * lev * 100) / 100;
  const positionValue = Math.round(qty * px * 100) / 100;

  let nextDayQty;
  if (positionValue <= carryForwardLimit + 0.01) {
    nextDayQty = qty;
  } else {
    nextDayQty = Math.min(qty, Math.floor(carryForwardLimit / px));
  }

  return {
    nextDayQty: Math.max(0, nextDayQty),
    carryForwardLimit,
    positionValue,
    markPrice: px,
  };
}

export function resolveSafeOpenQuantity(trade) {
  const q = Number(trade?.quantity) || 0;
  const oq = Number(trade?.originalQty) || 0;
  const hist = Array.isArray(trade?.autoSquareHistory) ? trade.autoSquareHistory : [];
  const lastOrig = hist.length
    ? Number(hist[hist.length - 1]?.originalQty) || 0
    : 0;

  if (!isAbsurdOpenQuantity(trade)) return q;

  if (oq > 0 && oq <= MAX_NSE_MCX_CARRY_QTY) return oq;
  if (lastOrig > 0 && lastOrig <= MAX_NSE_MCX_CARRY_QTY) return lastOrig;
  return Math.min(q, MAX_NSE_MCX_CARRY_QTY);
}
