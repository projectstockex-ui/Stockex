import TradeService from '../services/tradeService.js';
import Admin from '../models/Admin.js';

export const CRYPTO_SESSION_TIMING_KEYS = [
  'cryptoStartTime',
  'cryptoClosingTime',
  'startTime',
  'closingTime',
];

export function stripCryptoSessionTimingFromSegmentMap(plain) {
  if (!plain || typeof plain !== 'object') return plain;
  const out = { ...plain };
  for (const [segName, segData] of Object.entries(out)) {
    if (!segData || typeof segData !== 'object') continue;
    const seg = { ...segData };
    for (const k of CRYPTO_SESSION_TIMING_KEYS) delete seg[k];
    out[segName] = seg;
  }
  return out;
}

export function stripCryptoKeysFromSegmentExplicitKeys(explicitKeys) {
  if (!explicitKeys || typeof explicitKeys !== 'object') return explicitKeys;
  const out = {};
  for (const [seg, keys] of Object.entries(explicitKeys)) {
    out[seg] = Array.isArray(keys)
      ? keys.filter((k) => !CRYPTO_SESSION_TIMING_KEYS.includes(k))
      : keys;
  }
  return out;
}

/** SystemSettings CRYPTOFUT close — same source of truth as UI / getUserSegmentSettings. */
export function resolveSystemCryptoClosingTime(sysSegDefaults = {}) {
  const cf = sysSegDefaults.CRYPTOFUT || sysSegDefaults.CRYPTOOPT || sysSegDefaults.CRYPTO || {};
  return String(cf.cryptoClosingTime || cf.closingTime || '').trim();
}

export function resolveSystemCryptoStartTime(sysSegDefaults = {}) {
  const cf = sysSegDefaults.CRYPTOFUT || sysSegDefaults.CRYPTOOPT || sysSegDefaults.CRYPTO || {};
  return String(cf.cryptoStartTime || cf.startTime || '').trim();
}

export function isCryptoSegmentKey(segKey) {
  return String(segKey || '').toUpperCase().startsWith('CRYPTO');
}

function segmentMapPlain(segmentMap) {
  if (!segmentMap) return {};
  if (segmentMap instanceof Map) return Object.fromEntries(segmentMap);
  return typeof segmentMap === 'object' ? segmentMap : {};
}

function cryptoSliceFromPerms(perms) {
  const plain = segmentMapPlain(perms);
  return plain.CRYPTOFUT || plain.CRYPTOOPT || plain.CRYPTO || {};
}

function readCryptoTimingFromSlice(slice) {
  if (!slice || typeof slice !== 'object') return { start: '', close: '' };
  return {
    start: String(slice.cryptoStartTime || slice.startTime || '').trim(),
    close: String(slice.cryptoClosingTime || slice.closingTime || '').trim(),
  };
}

/** Walk direct parent + hierarchyPath admins until crypto start/close are found (CRYPTOFUT slice). */
export async function resolveCryptoTimingFromAdminChain(user) {
  if (!user) return { cryptoStartTime: '', cryptoClosingTime: '' };

  const chainIds = [];
  const seen = new Set();
  const push = (id) => {
    if (!id) return;
    const s = String(id);
    if (seen.has(s)) return;
    seen.add(s);
    chainIds.push(id);
  };

  push(user.admin?._id || user.adminId || user.admin);
  if (Array.isArray(user.hierarchyPath)) {
    for (let i = user.hierarchyPath.length - 1; i >= 0; i--) {
      push(user.hierarchyPath[i]);
    }
  }

  let start = '';
  let close = '';

  for (const adminId of chainIds) {
    const doc = await Admin.findById(adminId).select('segmentPermissions').lean();
    const { start: s, close: c } = readCryptoTimingFromSlice(cryptoSliceFromPerms(doc?.segmentPermissions));
    if (s && !start) start = s;
    if (c && !close) close = c;
    if (start && close) break;
  }

  return { cryptoStartTime: start, cryptoClosingTime: close };
}

/** Parse HH:mm or HH:mm:ss to seconds since midnight (IST wall clock). */
export function istClockToSeconds(hms) {
  const parts = String(hms || '')
    .trim()
    .split(':')
    .map(Number);
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null;
  return parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0);
}

export function nowIstSecondsOfDay() {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  return ist.getHours() * 3600 + ist.getMinutes() * 60 + ist.getSeconds();
}

export function isPastIstClock(closeTime) {
  const target = istClockToSeconds(closeTime);
  if (target == null) return false;
  const now = nowIstSecondsOfDay();
  return now >= target;
}

/**
 * Same merged CRYPTOFUT timing the user sees when opening a trade (SA defaults + hierarchy).
 */
export async function resolveEffectiveCryptoClosingTimeForUser(user) {
  if (!user) return '';
  const settings = await TradeService.getUserSegmentSettings(user, 'CRYPTOFUT', null);
  return String(settings?.cryptoClosingTime || '').trim();
}

/** True when IST is at or after this user's effective crypto session close. */
export async function isPastCryptoCloseForUser(user) {
  const close = await resolveEffectiveCryptoClosingTimeForUser(user);
  if (!close) return false;
  return isPastIstClock(close);
}

/** True when IST is inside [start, close) for merged CRYPTOFUT settings. No timing = always active. */
export async function isCryptoSessionActiveForUser(user) {
  if (!user) return true;
  const settings = await TradeService.getUserSegmentSettings(user, 'CRYPTOFUT', null);
  const start = String(settings?.cryptoStartTime || '').trim();
  const close = String(settings?.cryptoClosingTime || '').trim();
  if (!start && !close) return true;
  const now = nowIstSecondsOfDay();
  if (start) {
    const startSec = istClockToSeconds(start);
    if (startSec != null && now < startSec) return false;
  }
  if (close) {
    const closeSec = istClockToSeconds(close);
    if (closeSec != null && now >= closeSec) return false;
  }
  return true;
}

export function isPastSystemCryptoClose(sysSegDefaults = {}) {
  const close = resolveSystemCryptoClosingTime(sysSegDefaults);
  if (!close) return false;
  return isPastIstClock(close);
}
