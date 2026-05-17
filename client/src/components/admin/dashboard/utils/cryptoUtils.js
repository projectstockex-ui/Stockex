/**
 * Crypto segment utility functions for AdminDashboard
 */

/**
 * IST clock for crypto segment admin: strict 24h HH:mm:ss. Empty ok; invalid yields null on normalize.
 * @param {string} inputStr - Input time string
 * @returns {string|null} Normalized time string or null if invalid
 */
export function normalizeCryptoIstClock24(inputStr) {
  const s = String(inputStr ?? '').trim();
  if (!s) return '';

  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;

  const H = Number(m[1]);
  const Mi = Number(m[2]);
  const Sec = m[3] != null ? Number(m[3]) : 0;

  if (![H, Mi, Sec].every(Number.isFinite)) return null;
  if (H < 0 || H > 23 || Mi < 0 || Mi > 59 || Sec < 0 || Sec > 59) return null;

  return `${String(H).padStart(2, '0')}:${String(Mi).padStart(2, '0')}:${String(Sec).padStart(2, '0')}`;
}

/**
 * Value shown in crypto IST text boxes (canonical when parseable).
 * @param {string} raw - Raw time value
 * @returns {string} Formatted time string
 */
export function formatStoredCryptoIstClock(raw) {
  const s = raw != null && raw !== '' ? String(raw).trim() : '';
  if (!s) return '';
  const n = normalizeCryptoIstClock24(s);
  return n ?? s;
}

/**
 * Binance crypto segment keys — UI is quantity-only (limits map to exchange step multiples on server).
 * @param {string} seg - Segment name
 * @returns {boolean} True if segment is crypto quantity-only
 */
export function isCryptoQtyOnlySegment(seg) {
  return ['CRYPTOFUT', 'CRYPTOOPT'].includes(String(seg || '').toUpperCase());
}
