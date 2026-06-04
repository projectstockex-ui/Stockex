/** Market-watch segment keys (tabs) — keep in sync with Instrument.displaySegment enum */
export const MARKET_WATCH_SEGMENTS = [
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

export const MARKET_WATCH_SEGMENT_LABELS = {
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

export function labelForMarketWatchSegment(key) {
  return MARKET_WATCH_SEGMENT_LABELS[key] || key;
}
