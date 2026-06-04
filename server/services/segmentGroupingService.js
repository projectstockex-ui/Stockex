import Instrument from '../models/Instrument.js';
import SegmentGrouping from '../models/SegmentGrouping.js';
import {
  MARKET_WATCH_SEGMENTS,
  labelForMarketWatchSegment,
} from '../constants/marketWatchSegments.js';
import {
  buildNseSectorSeedGroups,
  getNseFnOSectorLabel,
  inferNseFnoUnderlying,
} from '../utils/nseFnOSectorsServer.js';

const MCX_GROUP_SEEDS = [
  { key: 'precious_metals', label: 'Precious Metals', groupType: 'commodity', underlyings: ['GOLD', 'SILVER', 'GOLDM', 'SILVERM'] },
  { key: 'energy', label: 'Energy', groupType: 'commodity', underlyings: ['CRUDEOIL', 'NATURALGAS', 'CRUDEOILM'] },
  { key: 'base_metals', label: 'Base Metals', groupType: 'commodity', underlyings: ['COPPER', 'ZINC', 'NICKEL', 'ALUMINIUM', 'LEAD'] },
  { key: 'agri', label: 'Agri Commodities', groupType: 'commodity', underlyings: ['COTTON', 'CARDAMOM', 'MENTHAOIL', 'CASTOR'] },
];

const CRYPTO_GROUP_SEEDS = [
  { key: 'major', label: 'Major Coins', groupType: 'crypto', underlyings: ['BTC', 'ETH', 'BNB', 'SOL', 'XRP'] },
  { key: 'altcoins', label: 'Altcoins', groupType: 'crypto', underlyings: ['ADA', 'DOGE', 'AVAX', 'DOT', 'LINK'] },
];

const FOREX_GROUP_SEEDS = [
  { key: 'majors', label: 'Major Pairs', groupType: 'forex', underlyings: ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD'] },
  { key: 'crosses', label: 'Cross Pairs', groupType: 'forex', underlyings: ['EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'EURAUD'] },
];

function normUnderlying(u) {
  return String(u || '')
    .toUpperCase()
    .replace(/[^A-Z0-9&]/g, '');
}

function inferUnderlyingForInstrument(inst, displaySegment) {
  const seg = String(displaySegment || inst?.displaySegment || '').toUpperCase();
  if (['NSEFUT', 'NSEOPT', 'NSE-EQ', 'BSE-FUT', 'BSE-OPT'].includes(seg)) {
    return inferNseFnoUnderlying(inst?.tradingSymbol, inst?.symbol);
  }
  const sym = normUnderlying(inst?.symbol || inst?.tradingSymbol);
  const m = sym.match(/^([A-Z]{2,})/);
  return m ? m[1] : sym.slice(0, 12) || 'OTHER';
}

function instrumentMatchesGroup(inst, group, displaySegment) {
  const u = normUnderlying(inferUnderlyingForInstrument(inst, displaySegment));
  const list = (group.underlyings || []).map(normUnderlying).filter(Boolean);
  if (list.length === 0) return false;
  return list.some((x) => u === x || u.startsWith(x) || x.startsWith(u));
}

let groupingCache = { at: 0, bySegment: new Map() };
const GROUPING_CACHE_MS = 30_000;

export function invalidateSegmentGroupingCache() {
  groupingCache = { at: 0, bySegment: new Map() };
}

async function loadAllGroupingsMap() {
  if (Date.now() - groupingCache.at < GROUPING_CACHE_MS && groupingCache.bySegment.size > 0) {
    return groupingCache.bySegment;
  }
  const docs = await SegmentGrouping.find({}).lean();
  groupingCache.bySegment = new Map(docs.map((d) => [d.displaySegment, d]));
  groupingCache.at = Date.now();
  return groupingCache.bySegment;
}

/**
 * If instrument belongs to a group with allowWithinLowHigh, trading is restricted to day low–high.
 */
export async function resolveSegmentGroupLowHighForInstrument(inst) {
  if (!inst) return { restrict: false };
  const seg = String(inst.displaySegment || inst.segment || '').toUpperCase();
  if (!seg) return { restrict: false };

  const map = await loadAllGroupingsMap();
  const doc = map.get(seg);
  if (!doc?.groups?.length) return { restrict: false };

  const candidates = [...doc.groups]
    .filter((g) => g.enabled !== false && g.allowWithinLowHigh === true)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  for (const g of candidates) {
    if (instrumentMatchesGroup(inst, g, seg)) {
      return {
        restrict: true,
        groupKey: g.key,
        groupLabel: g.label || g.key,
      };
    }
  }
  return { restrict: false };
}

/**
 * Resolve whether client users may open trades for this instrument (segment group rule).
 * Ungrouped instruments are allowed unless another active group matches and blocks.
 */
export async function resolveSegmentGroupClientTradingForInstrument(inst) {
  if (!inst) return { allowed: true };
  const seg = String(inst.displaySegment || inst.segment || '').toUpperCase();
  if (!seg) return { allowed: true };

  const map = await loadAllGroupingsMap();
  const doc = map.get(seg);
  if (!doc?.groups?.length) return { allowed: true };

  const activeGroups = [...doc.groups]
    .filter((g) => g.enabled !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  for (const g of activeGroups) {
    if (instrumentMatchesGroup(inst, g, seg)) {
      const allowed = g.allowClientTrading !== false;
      return {
        allowed,
        groupKey: g.key,
        groupLabel: g.label || g.key,
      };
    }
  }
  return { allowed: true };
}

export async function assertSegmentGroupClientTradingAllowed(inst) {
  const result = await resolveSegmentGroupClientTradingForInstrument(inst);
  if (result.allowed) return result;
  const label = result.groupLabel || result.groupKey || 'this group';
  const err = new Error(
    `Trading is disabled for instruments in "${label}" (Segment Grouping → Client trading OFF). Contact administrator.`
  );
  err.status = 403;
  throw err;
}

function defaultSeedGroups(displaySegment) {
  const seg = String(displaySegment || '').toUpperCase();
  if (['NSEFUT', 'NSEOPT', 'NSE-EQ', 'BSE-FUT', 'BSE-OPT'].includes(seg)) {
    return buildNseSectorSeedGroups();
  }
  if (['MCXFUT', 'MCXOPT'].includes(seg)) {
    return MCX_GROUP_SEEDS.map((g, i) => ({
      ...g,
      sortOrder: i,
      enabled: true,
      allowClientTrading: true,
      allowWithinLowHigh: false,
    }));
  }
  if (['CRYPTOFUT', 'CRYPTOOPT'].includes(seg)) {
    return CRYPTO_GROUP_SEEDS.map((g, i) => ({
      ...g,
      sortOrder: i,
      enabled: true,
      allowClientTrading: true,
      allowWithinLowHigh: false,
    }));
  }
  if (['FOREXFUT', 'FOREXOPT'].includes(seg)) {
    return FOREX_GROUP_SEEDS.map((g, i) => ({
      ...g,
      sortOrder: i,
      enabled: true,
      allowClientTrading: true,
      allowWithinLowHigh: false,
    }));
  }
  return [
    {
      key: 'all',
      label: 'All Instruments',
      sortOrder: 0,
      groupType: 'custom',
      underlyings: [],
      enabled: true,
      allowClientTrading: true,
      allowWithinLowHigh: false,
    },
  ];
}

async function loadInstruments(displaySegment) {
  return Instrument.find({
    displaySegment,
    isEnabled: true,
  })
    .select('token symbol tradingSymbol name category exchange displaySegment instrumentType')
    .sort({ symbol: 1, tradingSymbol: 1 })
    .limit(8000)
    .lean();
}

function attachInstrumentsToGroups(instruments, groups, displaySegment) {
  const enabledGroups = (groups || [])
    .filter((g) => g.enabled !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const assigned = new Set();
  const grouped = enabledGroups.map((g) => {
    const items = [];
    for (const inst of instruments) {
      const token = String(inst.token || inst._id);
      if (assigned.has(token)) continue;
      if (instrumentMatchesGroup(inst, g, displaySegment)) {
        items.push(inst);
        assigned.add(token);
      }
    }
    return {
      ...g,
      instrumentCount: items.length,
      instruments: items,
    };
  });

  const ungrouped = instruments.filter((inst) => {
    const token = String(inst.token || inst._id);
    return !assigned.has(token);
  });

  return { groups: grouped, ungrouped, totalInstruments: instruments.length };
}

export async function listSegmentGroupingOverview() {
  const docs = await SegmentGrouping.find({}).lean();
  const bySeg = new Map(docs.map((d) => [d.displaySegment, d]));

  return MARKET_WATCH_SEGMENTS.map((key) => {
    const doc = bySeg.get(key);
    return {
      displaySegment: key,
      label: labelForMarketWatchSegment(key),
      groupCount: doc?.groups?.length ?? 0,
      hasConfig: !!doc,
    };
  });
}

export async function getSegmentGroupingDetail(displaySegment) {
  const seg = String(displaySegment || '').toUpperCase();
  if (!MARKET_WATCH_SEGMENTS.includes(seg)) {
    const err = new Error('Invalid segment');
    err.status = 400;
    throw err;
  }

  let doc = await SegmentGrouping.findOne({ displaySegment: seg }).lean();
  if (!doc?.groups?.length) {
    doc = {
      displaySegment: seg,
      groups: defaultSeedGroups(seg),
      isDraft: true,
    };
  }

  const instruments = await loadInstruments(seg);
  const { groups, ungrouped, totalInstruments } = attachInstrumentsToGroups(
    instruments,
    doc.groups,
    seg
  );

  return {
    displaySegment: seg,
    label: labelForMarketWatchSegment(seg),
    groups,
    ungrouped,
    totalInstruments,
    isDraft: !!doc.isDraft,
    updatedAt: doc.updatedAt,
  };
}

export async function saveSegmentGrouping(displaySegment, groups, adminId) {
  const seg = String(displaySegment || '').toUpperCase();
  if (!MARKET_WATCH_SEGMENTS.includes(seg)) {
    const err = new Error('Invalid segment');
    err.status = 400;
    throw err;
  }

  const sanitized = (Array.isArray(groups) ? groups : []).map((g, idx) => ({
    key: String(g.key || `group_${idx}`).trim().slice(0, 64),
    label: String(g.label || `Group ${idx + 1}`).trim().slice(0, 120),
    sortOrder: Number(g.sortOrder) || idx,
    groupType: g.groupType || 'custom',
    underlyings: [...new Set((g.underlyings || []).map((u) => normUnderlying(u)).filter(Boolean))],
    enabled: g.enabled !== false,
    allowClientTrading: g.allowClientTrading !== false,
    allowWithinLowHigh: Boolean(g.allowWithinLowHigh),
  }));

  const doc = await SegmentGrouping.findOneAndUpdate(
    { displaySegment: seg },
    {
      displaySegment: seg,
      groups: sanitized,
      updatedBy: adminId,
    },
    { upsert: true, new: true, runValidators: true }
  ).lean();

  invalidateSegmentGroupingCache();
  return getSegmentGroupingDetail(seg);
}

export async function seedSegmentGroupingDefaults(displaySegment, adminId) {
  const seg = String(displaySegment || '').toUpperCase();
  const groups = defaultSeedGroups(seg);
  return saveSegmentGrouping(seg, groups, adminId);
}

/** Suggest sector label for an instrument (admin UI helper) */
export function suggestSectorForInstrument(inst) {
  return getNseFnOSectorLabel(inst);
}
