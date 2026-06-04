/** Server copy of client nseFnOSectors — sector buckets for NSE F&O / EQ grouping */

export const NSE_FNO_SECTOR_ORDER = [
  'Indices',
  'Banking',
  'IT & Technology',
  'Oil, Gas & Energy',
  'FMCG',
  'Auto',
  'Pharma & Healthcare',
  'Metals & Mining',
  'Infrastructure & Construction',
  'Financial Services (ex-Banks)',
  'Telecom',
  'Power & Utilities',
  'Consumer',
  'Chemicals & Agri',
  'Media & Entertainment',
  'Other',
];

const UNDERLYING_TO_SECTOR = {
  NIFTY: 'Indices',
  BANKNIFTY: 'Indices',
  FINNIFTY: 'Indices',
  MIDCPNIFTY: 'Indices',
  NIFTYIT: 'Indices',
  HDFCBANK: 'Banking',
  ICICIBANK: 'Banking',
  SBIN: 'Banking',
  KOTAKBANK: 'Banking',
  AXISBANK: 'Banking',
  INDUSINDBK: 'Banking',
  TCS: 'IT & Technology',
  INFY: 'IT & Technology',
  HCLTECH: 'IT & Technology',
  WIPRO: 'IT & Technology',
  TECHM: 'IT & Technology',
  LTIM: 'IT & Technology',
  RELIANCE: 'Oil, Gas & Energy',
  ONGC: 'Oil, Gas & Energy',
  BPCL: 'Oil, Gas & Energy',
  COALINDIA: 'Oil, Gas & Energy',
  ITC: 'FMCG',
  HINDUNILVR: 'FMCG',
  BRITANNIA: 'FMCG',
  NESTLEIND: 'FMCG',
  TATACONSUM: 'FMCG',
  MARUTI: 'Auto',
  TATAMOTORS: 'Auto',
  'M&M': 'Auto',
  HEROMOTOCO: 'Auto',
  EICHERMOT: 'Auto',
  BAJAJAUTO: 'Auto',
  SUNPHARMA: 'Pharma & Healthcare',
  DRREDDY: 'Pharma & Healthcare',
  CIPLA: 'Pharma & Healthcare',
  DIVISLAB: 'Pharma & Healthcare',
  APOLLOHOSP: 'Pharma & Healthcare',
  TATASTEEL: 'Metals & Mining',
  JSWSTEEL: 'Metals & Mining',
  HINDALCO: 'Metals & Mining',
  ULTRACEMCO: 'Infrastructure & Construction',
  LT: 'Infrastructure & Construction',
  GRASIM: 'Infrastructure & Construction',
  BAJFINANCE: 'Financial Services (ex-Banks)',
  BAJAJFINSV: 'Financial Services (ex-Banks)',
  SBILIFE: 'Financial Services (ex-Banks)',
  HDFCLIFE: 'Financial Services (ex-Banks)',
  BHARTIARTL: 'Telecom',
  NTPC: 'Power & Utilities',
  POWERGRID: 'Power & Utilities',
  ADANIENT: 'Consumer',
  ADANIPORTS: 'Consumer',
  ASIANPAINT: 'Chemicals & Agri',
  UPL: 'Chemicals & Agri',
  TITAN: 'Consumer',
};

const INDEX_PREFIXES = ['MIDCPNIFTY', 'BANKNIFTY', 'FINNIFTY', 'NIFTYIT', 'NIFTY'];

function normalizeSym(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function inferNseFnoUnderlying(tradingSymbol, symbol) {
  const raw = String(tradingSymbol || symbol || '').toUpperCase();
  if (raw.includes('M&M')) return 'M&M';
  const s = normalizeSym(tradingSymbol || symbol);
  if (!s) return 'OTHER';
  for (const p of INDEX_PREFIXES) {
    if (s.startsWith(p)) return p;
  }
  const m = s.match(/^([A-Z]{2,}?)\d/);
  if (m) return m[1];
  const m2 = s.match(/^([A-Z]{2,})/);
  return m2 ? m2[1] : 'OTHER';
}

export function getNseFnOSectorLabel(inst) {
  const u = inferNseFnoUnderlying(inst?.tradingSymbol, inst?.symbol);
  return UNDERLYING_TO_SECTOR[u] || 'Other';
}

/** Build default groups (sector → underlyings[]) for seeding */
export function buildNseSectorSeedGroups() {
  const bySector = new Map();
  for (const [underlying, sector] of Object.entries(UNDERLYING_TO_SECTOR)) {
    if (!bySector.has(sector)) bySector.set(sector, []);
    bySector.get(sector).push(underlying);
  }
  const groups = [];
  let order = 0;
  for (const label of NSE_FNO_SECTOR_ORDER) {
    const underlyings = bySector.get(label);
    if (!underlyings?.length) continue;
    groups.push({
      key: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
      label,
      sortOrder: order++,
      groupType: 'sector',
      underlyings: [...new Set(underlyings)].sort(),
      enabled: true,
      allowClientTrading: true,
      allowWithinLowHigh: false,
    });
    bySector.delete(label);
  }
  for (const [label, underlyings] of bySector) {
    groups.push({
      key: label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      label,
      sortOrder: order++,
      groupType: 'sector',
      underlyings: [...new Set(underlyings)].sort(),
      enabled: true,
      allowClientTrading: true,
      allowWithinLowHigh: false,
    });
  }
  groups.push({
    key: 'other',
    label: 'Other',
    sortOrder: order,
    groupType: 'custom',
    underlyings: [],
    enabled: true,
    allowClientTrading: true,
    allowWithinLowHigh: false,
  });
  return groups;
}
