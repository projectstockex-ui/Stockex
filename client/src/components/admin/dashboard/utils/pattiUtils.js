/**
 * Patti sharing utility functions for AdminDashboard
 */

// Patti broker segment keys (defined in the main file)
const PATTI_BROKER_SEGMENT_KEYS = [
  'NSEFUT',
  'NSEOPT',
  'NSE-EQ',
  'MCXFUT',
  'MCXOPT',
  'BSE-FUT',
  'BSE-OPT',
  'FOREXFUT',
  'FOREXOPT',
  'CRYPTOFUT',
  'CRYPTOOPT',
];

/**
 * Merge broker patti segments with defaults
 * @param {object} raw - Raw patti segments data
 * @returns {object} Merged patti segments
 */
export function mergeBrokerPattiSegments(raw) {
  const o = {};
  PATTI_BROKER_SEGMENT_KEYS.forEach((k) => {
    o[k] = { enabled: true, brokerPercentage: 50, ...(raw?.[k] || {}) };
  });
  return o;
}

/**
 * Derive broker percentage from patti form segments
 * @param {object} segments - Patti segments
 * @returns {number} Average broker percentage
 */
export function deriveBrokerPctFromPattiFormSegments(segments) {
  const entries = Object.entries(segments || {}).filter(([, v]) => v?.enabled !== false);
  if (!entries.length) return 50;

  const sum = entries.reduce((acc, [, v]) => {
    const n = Number(v.brokerPercentage);
    const pct = Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 50;
    return acc + pct;
  }, 0);

  return Math.round(sum / entries.length);
}

export { PATTI_BROKER_SEGMENT_KEYS };
