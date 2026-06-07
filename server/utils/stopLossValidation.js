/** Minimum distance between entry and SL/target so spread ticks don't instant-trigger. */
export function minStopLossBuffer(entryPrice, spread = 0) {
  const e = Number(entryPrice) || 0;
  if (e <= 0) return 0.01;
  const pctBuf = e * 0.0001;
  const spreadBuf = Number(spread) > 0 ? Number(spread) * 2 : 0;
  return Math.max(0.01, pctBuf, spreadBuf);
}

export function normalizeOptionalPrice(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function isPriceBetweenDayLowHigh(price, dayLow, dayHigh) {
  const px = Number(price);
  const low = Number(dayLow);
  const high = Number(dayHigh);
  if (!(Number.isFinite(px) && px > 0 && low > 0 && high > 0 && high >= low)) return false;
  return px >= low && px <= high;
}

/**
 * Reject stop-loss / target that would fire immediately or sit on the wrong side of entry.
 * When Low–High mode is on: target must be OUTSIDE day range; stop loss MAY be inside range.
 */
export function validateStopLossTarget({
  side,
  entryPrice,
  stopLoss,
  target,
  bid,
  ask,
  spread = 0,
  dayLow,
  dayHigh,
  enforceTargetOutsideDayRange = false,
}) {
  const sideU = String(side || '').toUpperCase();
  const entry = Number(entryPrice) || 0;
  const refBid = Number(bid) || entry;
  const refAsk = Number(ask) || entry;
  const buf = minStopLossBuffer(entry || refBid || refAsk, spread);

  const sl = normalizeOptionalPrice(stopLoss);
  const tp = normalizeOptionalPrice(target);

  if (sl != null) {
    if (sideU === 'BUY') {
      const ceiling = Math.min(entry || refAsk, refBid) - buf;
      if (ceiling <= 0 || sl >= ceiling) {
        return {
          ok: false,
          message: `Stop loss (${sl}) must be below entry/bid for a BUY (max allowed ≈ ${ceiling > 0 ? ceiling.toFixed(2) : '—'}).`,
        };
      }
    } else if (sideU === 'SELL') {
      const floor = Math.max(entry || refBid, refAsk) + buf;
      if (sl <= floor) {
        return {
          ok: false,
          message: `Stop loss (${sl}) must be above entry/ask for a SELL (min allowed ≈ ${floor.toFixed(2)}).`,
        };
      }
    }
  }

  if (tp != null) {
    if (sideU === 'BUY') {
      const floor = Math.max(entry || refAsk, refAsk) + buf;
      if (tp <= floor) {
        return {
          ok: false,
          message: `Target (${tp}) must be above entry/ask for a BUY (min allowed ≈ ${floor.toFixed(2)}).`,
        };
      }
    } else if (sideU === 'SELL') {
      const ceiling = Math.min(entry || refBid, refBid) - buf;
      if (ceiling <= 0 || tp >= ceiling) {
        return {
          ok: false,
          message: `Target (${tp}) must be below entry/bid for a SELL (max allowed ≈ ${ceiling > 0 ? ceiling.toFixed(2) : '—'}).`,
        };
      }
    }

    if (enforceTargetOutsideDayRange && isPriceBetweenDayLowHigh(tp, dayLow, dayHigh)) {
      const low = Number(dayLow);
      const high = Number(dayHigh);
      return {
        ok: false,
        message:
          `Target (${tp}) cannot be between day Low ${low} and High ${high}. ` +
          'Set target below day Low or above day High. Stop loss may be within this range.',
      };
    }
  }

  return { ok: true, stopLoss: sl, target: tp };
}

/** Side-aware exit reference: BUY closes on bid, SELL closes on ask. */
export function stopLossReferencePrice({ side, bid, ask, ltp }) {
  const sideU = String(side || '').toUpperCase();
  if (sideU === 'BUY') return Number(bid) || Number(ltp) || 0;
  if (sideU === 'SELL') return Number(ask) || Number(ltp) || 0;
  return Number(ltp) || 0;
}

const DEFAULT_SL_GRACE_MS = 2500;

/**
 * True when stop-loss should fire. Ignores invalid SL direction and brand-new positions.
 */
export function isStopLossTriggered(
  trade,
  { bid, ask, ltp, graceMs = DEFAULT_SL_GRACE_MS } = {}
) {
  const sl = Number(trade?.stopLoss);
  if (!Number.isFinite(sl) || sl <= 0) return false;

  const openedAt = trade?.openedAt ? new Date(trade.openedAt).getTime() : 0;
  if (openedAt > 0 && Date.now() - openedAt < graceMs) return false;

  const sideU = String(trade?.side || '').toUpperCase();
  const entry = Number(trade?.entryPrice) || 0;
  if (sideU === 'BUY' && entry > 0 && sl >= entry) return false;
  if (sideU === 'SELL' && entry > 0 && sl <= entry) return false;

  const ref = stopLossReferencePrice({ side: sideU, bid, ask, ltp });
  if (ref <= 0) return false;

  if (sideU === 'BUY') return ref <= sl;
  if (sideU === 'SELL') return ref >= sl;
  return false;
}

export function isTargetTriggered(trade, { bid, ask, ltp } = {}) {
  const tp = Number(trade?.target);
  if (!Number.isFinite(tp) || tp <= 0) return false;

  const sideU = String(trade?.side || '').toUpperCase();
  const entry = Number(trade?.entryPrice) || 0;
  if (sideU === 'BUY' && entry > 0 && tp <= entry) return false;
  if (sideU === 'SELL' && entry > 0 && tp >= entry) return false;

  const ref = stopLossReferencePrice({ side: sideU, bid, ask, ltp });
  if (ref <= 0) return false;

  if (sideU === 'BUY') return ref >= tp;
  if (sideU === 'SELL') return ref <= tp;
  return false;
}
