import SystemSettings from '../models/SystemSettings.js';

let cachedWindows = null;
let cachedAt = 0;
const CACHE_MS = 3000;

/** Super-admin saved panel from/until per segment (contract expiry window for user lists). */
export async function getSavedSegmentPanelWindows() {
  const now = Date.now();
  if (cachedWindows && now - cachedAt < CACHE_MS) {
    return cachedWindows;
  }
  try {
    const settings = await SystemSettings.findOne({ settingsType: 'global' })
      .select('userPanelWindowBySegment')
      .lean();
    cachedWindows = settings?.userPanelWindowBySegment || {};
    cachedAt = now;
    return cachedWindows;
  } catch {
    return {};
  }
}

export function invalidateSegmentPanelWindowsCache() {
  cachedWindows = null;
  cachedAt = 0;
}

export function resolveSegmentPanelWindow(panelWindows, segment, displaySegment) {
  const key = String(segment || displaySegment || '').trim();
  if (!key || !panelWindows || typeof panelWindows !== 'object') return null;
  const row = panelWindows[key];
  if (!row?.panelFrom && !row?.panelUntil) return null;
  return {
    panelFrom: row.panelFrom || null,
    panelUntil: row.panelUntil || null,
  };
}

/** Best-effort segment key for watchlist / favorites rows. */
export function inferInstrumentSegmentKey(inst) {
  if (!inst) return '';
  const disp = String(inst.displaySegment || '').trim();
  if (disp) return disp;
  const ex = String(inst.exchange || '').toUpperCase();
  const type = String(inst.instrumentType || '').toUpperCase();
  if (ex === 'MCX') return type === 'OPTIONS' || type === 'OPTION' ? 'MCXOPT' : 'MCXFUT';
  if (ex === 'NFO') return type === 'OPTIONS' || type === 'OPTION' ? 'NSEOPT' : 'NSEFUT';
  if (ex === 'BFO') return type === 'OPTIONS' || type === 'OPTION' ? 'BSE-OPT' : 'BSE-FUT';
  if (ex === 'BINANCE') return type === 'OPTIONS' ? 'CRYPTOOPT' : 'CRYPTOFUT';
  if (ex === 'FOREX') return type === 'OPTIONS' ? 'FOREXOPT' : 'FOREXFUT';
  if (ex === 'NSE') return 'NSE-EQ';
  return String(inst.segment || '').trim();
}
