import {
  MARKET_WATCH_SEGMENTS,
  MARKET_WATCH_SEGMENT_LABELS,
  labelForMarketWatchSegment,
} from './marketWatchSegments.js';

/** Granular segment keys for individual + broker patti sharing (market-watch aligned). */
export const PATTI_SHARING_SEGMENT_KEYS = [...MARKET_WATCH_SEGMENTS];

export const PATTI_SHARING_SEGMENT_LABELS = MARKET_WATCH_SEGMENT_LABELS;

/** Roles that may have Admin.pattiSharing vs their parent. */
export const PATTI_SHARING_ELIGIBLE_ROLES = ['ADMIN', 'BROKER', 'SUB_BROKER'];

export { labelForMarketWatchSegment };

/** Coarse legacy keys → granular keys (migration when loading saved config). */
const LEGACY_TO_GRANULAR = {
  EQUITY: ['NSE-EQ'],
  FNO: ['NSEFUT', 'NSEOPT', 'BSE-FUT', 'BSE-OPT'],
  MCX: ['MCXFUT', 'MCXOPT'],
  COMMODITY: ['MCXFUT', 'MCXOPT'],
  CURRENCY: ['FOREXFUT', 'FOREXOPT'],
  FOREX: ['FOREXFUT', 'FOREXOPT'],
  CRYPTO: ['CRYPTOFUT', 'CRYPTOOPT'],
};

function clampSharePct(n, fallback = 50) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(100, Math.max(0, Math.round(x)));
}

function applyLegacySegmentMigration(rawSegments) {
  const raw = { ...(rawSegments || {}) };
  for (const [legacy, targets] of Object.entries(LEGACY_TO_GRANULAR)) {
    const leg = raw[legacy];
    if (!leg || typeof leg !== 'object') continue;
    for (const key of targets) {
      const existing = raw[key];
      const hasPct =
        existing &&
        (Number.isFinite(Number(existing.adminPercentage)) ||
          Number.isFinite(Number(existing.brokerPercentage)) ||
          Number.isFinite(Number(existing.parentPercentage)));
      if (!hasPct) {
        raw[key] = {
          ...leg,
          adminPercentage:
            leg.adminPercentage ??
            (Number.isFinite(Number(leg.brokerPercentage)) ? leg.brokerPercentage : undefined),
          brokerPercentage:
            leg.brokerPercentage ??
            (Number.isFinite(Number(leg.adminPercentage)) ? leg.adminPercentage : undefined),
        };
      }
    }
  }
  return raw;
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

export function normalizeIndividualPattiSegments(rawSegments) {
  const migrated = applyLegacySegmentMigration(rawSegments);
  const out = {};
  for (const key of PATTI_SHARING_SEGMENT_KEYS) {
    const raw = migrated[key] || {};
    const enabled = raw.enabled !== false;
    let adminPct = Number(raw.adminPercentage);
    if (!Number.isFinite(adminPct)) {
      const legacyParent = Number(raw.parentPercentage);
      const legacyBroker = Number(raw.brokerPercentage);
      if (Number.isFinite(legacyParent)) {
        adminPct = clampSharePct(100 - legacyParent);
      } else if (Number.isFinite(legacyBroker)) {
        adminPct = clampSharePct(legacyBroker);
      } else {
        adminPct = 50;
      }
    } else {
      adminPct = clampSharePct(adminPct);
    }
    out[key] = { enabled, adminPercentage: adminPct };
  }
  return out;
}

export function normalizeBrokerPattiSegments(rawSegments) {
  const migrated = applyLegacySegmentMigration(rawSegments);
  const out = {};
  for (const key of PATTI_SHARING_SEGMENT_KEYS) {
    const raw = migrated[key] || {};
    const enabled = raw.enabled !== false;
    let brokerPct = Number(raw.brokerPercentage);
    if (!Number.isFinite(brokerPct)) {
      const adminPct = Number(raw.adminPercentage);
      brokerPct = Number.isFinite(adminPct) ? clampSharePct(adminPct) : 50;
    } else {
      brokerPct = clampSharePct(brokerPct);
    }
    out[key] = { enabled, brokerPercentage: brokerPct };
  }
  return out;
}

const GRANULAR_SET = new Set(PATTI_SHARING_SEGMENT_KEYS);

/**
 * Map trade → granular patti segment key (must match Admin.pattiSharing.segments keys).
 */
export function pattiSegmentKeyFromTrade(trade) {
  const seg = String(trade?.segment || '').toUpperCase();
  const ex = String(trade?.exchange || '').toUpperCase();
  const inst = String(trade?.instrumentType || '').toUpperCase();

  if (GRANULAR_SET.has(seg)) return seg;

  if (trade?.isCrypto || ex === 'BINANCE') {
    if (seg === 'CRYPTOOPT' || inst === 'OPTIONS') return 'CRYPTOOPT';
    return 'CRYPTOFUT';
  }

  if (trade?.isForex || seg.startsWith('FOREX') || ex === 'FOREX') {
    if (seg === 'FOREXOPT' || inst === 'OPTIONS') return 'FOREXOPT';
    return 'FOREXFUT';
  }

  if (seg === 'MCXOPT' || (seg === 'MCX' && inst === 'OPTIONS')) return 'MCXOPT';
  if (
    seg === 'MCXFUT' ||
    seg === 'MCX' ||
    ex === 'MCX' ||
    seg === 'COMMODITY'
  ) {
    if (inst === 'OPTIONS') return 'MCXOPT';
    return 'MCXFUT';
  }

  if (seg === 'BSE-OPT' || (ex === 'BFO' && inst === 'OPTIONS')) return 'BSE-OPT';
  if (seg === 'BSE-FUT' || (ex === 'BFO' && inst === 'FUTURES')) return 'BSE-FUT';

  if (
    seg === 'NSEOPT' ||
    seg === 'FNO' && inst === 'OPTIONS' ||
    (ex === 'NFO' && inst === 'OPTIONS')
  ) {
    return 'NSEOPT';
  }

  if (seg === 'NSEFUT' || seg === 'FNO' || ex === 'NFO') return 'NSEFUT';

  if (seg === 'CDS' || seg === 'CURRENCY') return 'FOREXFUT';

  if (seg === 'EQUITY' || seg === 'NSE-EQ' || (ex === 'NSE' && inst === 'STOCK')) {
    return 'NSE-EQ';
  }

  return 'NSEFUT';
}

/** Broker PattiSharing doc may still store legacy coarse keys. */
export function brokerPattiSegmentConfig(docSegments, segKey) {
  return pattiSegmentConfigWithLegacy(docSegments, segKey, 'brokerPercentage');
}

/** Admin.pattiSharing may still store legacy coarse keys until re-saved. */
export function individualPattiSegmentConfig(docSegments, segKey) {
  return pattiSegmentConfigWithLegacy(docSegments, segKey, 'adminPercentage');
}

function pattiSegmentConfigWithLegacy(docSegments, segKey, pctField) {
  if (!docSegments || typeof docSegments !== 'object') return null;
  let seg = docSegments[segKey];
  if (seg && seg.enabled !== false && Number.isFinite(Number(seg[pctField] ?? seg.brokerPercentage ?? seg.adminPercentage))) {
    return seg;
  }

  const legacyMap = {
    'NSE-EQ': 'EQUITY',
    NSEFUT: 'FNO',
    NSEOPT: 'FNO',
    'BSE-FUT': 'FNO',
    'BSE-OPT': 'FNO',
    MCXFUT: 'MCX',
    MCXOPT: 'MCX',
    FOREXFUT: 'FOREX',
    FOREXOPT: 'FOREX',
    CRYPTOFUT: 'CRYPTO',
    CRYPTOOPT: 'CRYPTO',
  };
  const legacy = legacyMap[segKey];
  if (legacy) {
    seg = docSegments[legacy];
    if (seg && seg.enabled !== false) return seg;
    if (legacy === 'FOREX' || legacy === 'CRYPTO') {
      seg = docSegments.CURRENCY;
      if (seg && seg.enabled !== false) return seg;
    }
  }
  return null;
}

export function isPattiEligibleRole(role) {
  return PATTI_SHARING_ELIGIBLE_ROLES.includes(String(role || '').toUpperCase());
}
