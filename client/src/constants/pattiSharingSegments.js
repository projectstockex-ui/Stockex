/** Keep in sync with server/constants/marketWatchSegments.js */
export const PATTI_SHARING_SEGMENT_KEYS = [
  'NSEFUT',
  'NSEOPT',
  'MCXFUT',
  'MCXOPT',
  'NSE-EQ',
  'BSE-FUT',
  'BSE-OPT',
  'FOREXFUT',
  'FOREXOPT',
  'CRYPTOFUT',
  'CRYPTOOPT',
];

export const PATTI_SHARING_SEGMENT_LABELS = {
  NSEFUT: 'NSE Futures',
  NSEOPT: 'NSE Options',
  MCXFUT: 'MCX Futures',
  MCXOPT: 'MCX Options',
  'NSE-EQ': 'NSE Equity',
  'BSE-FUT': 'BSE Futures',
  'BSE-OPT': 'BSE Options',
  FOREXFUT: 'Forex Futures',
  FOREXOPT: 'Forex Options',
  CRYPTOFUT: 'Crypto Futures',
  CRYPTOOPT: 'Crypto Options',
};

export function labelForPattiSegment(key) {
  return PATTI_SHARING_SEGMENT_LABELS[key] || key;
}

export function defaultIndividualPattiSegments(adminPct = 50) {
  const out = {};
  for (const key of PATTI_SHARING_SEGMENT_KEYS) {
    out[key] = { enabled: true, adminPercentage: adminPct };
  }
  return out;
}

export function defaultBrokerPattiSegments(brokerPct = 50) {
  const out = {};
  for (const key of PATTI_SHARING_SEGMENT_KEYS) {
    out[key] = { enabled: true, brokerPercentage: brokerPct };
  }
  return out;
}

export const PATTI_SHARING_ELIGIBLE_ROLES = ['ADMIN', 'BROKER'];

export function isPattiEligibleRole(role) {
  return PATTI_SHARING_ELIGIBLE_ROLES.includes(String(role || '').toUpperCase());
}

export function mergeBrokerPattiSegments(raw) {
  const base = defaultBrokerPattiSegments(50);
  for (const key of PATTI_SHARING_SEGMENT_KEYS) {
    if (raw?.[key]) {
      base[key] = { ...base[key], ...raw[key] };
    }
  }
  return base;
}
