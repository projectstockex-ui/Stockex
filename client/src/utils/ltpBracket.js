/**
 * Dynamic LTP ±% bracket (Super Admin per instrument).
 */

export function computeLtpBracketBounds(ltp, percentUp, percentDown) {
  const base = Number(ltp);
  const up = Number(percentUp);
  const down = Number(percentDown);
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(up) || !Number.isFinite(down)) {
    return null;
  }
  return {
    ltp: base,
    lower: base * (1 - down / 100),
    upper: base * (1 + up / 100),
    percentUp: up,
    percentDown: down,
  };
}

/** Recompute bounds from live LTP when user is bracket-enrolled. */
export function resolveActiveLtpBracket(instrument, liveLtp) {
  const b = instrument?.ltpBracket;
  if (!b?.active) return null;
  const ltp = Number(liveLtp) > 0 ? Number(liveLtp) : Number(b.ltp);
  return computeLtpBracketBounds(ltp, b.percentUp, b.percentDown);
}

export function isPriceInLtpBracket(price, bounds) {
  if (!bounds) return true;
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return false;
  return p >= bounds.lower && p <= bounds.upper;
}

export function formatLtpBracketRange(bounds, decimals = 2) {
  if (!bounds) return '';
  const d = decimals;
  return `₹${bounds.lower.toFixed(d)} – ₹${bounds.upper.toFixed(d)}`;
}
