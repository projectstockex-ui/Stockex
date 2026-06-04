/**
 * Map NIFTY cash LTP (e.g. 23123.65) to the .00–.99 winning index (65).
 * Uses toFixed(2) to avoid float noise.
 */
export function closingPriceToDecimalPart(closingPrice) {
  const x = Number(closingPrice);
  if (!Number.isFinite(x)) return null;
  const s = x.toFixed(2);
  const dot = s.indexOf('.');
  if (dot < 0) return 0;
  const frac = s.slice(dot + 1, dot + 3);
  const n = parseInt(frac, 10);
  if (!Number.isFinite(n) || n < 0 || n > 99) return null;
  return n;
}

/**
 * Map price to the last 2 digits on the left side of decimal.
 * Example: 75,242.89 -> 42
 */
export function closingPriceToLeftTwoDigits(closingPrice) {
  const x = Number(closingPrice);
  if (!Number.isFinite(x)) return null;
  const intPart = Math.trunc(Math.abs(x));
  const n = intPart % 100;
  if (!Number.isFinite(n) || n < 0 || n > 99) return null;
  return n;
}
