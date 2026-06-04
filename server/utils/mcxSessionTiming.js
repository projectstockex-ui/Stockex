import TradeService from '../services/tradeService.js';
import Admin from '../models/Admin.js';
import {
  istClockToSeconds,
  nowIstSecondsOfDay,
  isPastIstClock,
} from './cryptoSessionTiming.js';

export const MCX_SESSION_TIMING_KEYS = ['mcxStartTime', 'mcxClosingTime', 'startTime', 'closingTime'];

export function stripMcxSessionTimingFromSegmentMap(plain) {
  if (!plain || typeof plain !== 'object') return plain;
  const out = { ...plain };
  for (const [segName, segData] of Object.entries(out)) {
    if (!segData || typeof segData !== 'object') continue;
    const seg = { ...segData };
    for (const k of MCX_SESSION_TIMING_KEYS) delete seg[k];
    out[segName] = seg;
  }
  return out;
}

export function stripMcxKeysFromSegmentExplicitKeys(explicitKeys) {
  if (!explicitKeys || typeof explicitKeys !== 'object') return explicitKeys;
  const out = {};
  for (const [seg, keys] of Object.entries(explicitKeys)) {
    out[seg] = Array.isArray(keys)
      ? keys.filter((k) => !MCX_SESSION_TIMING_KEYS.includes(k))
      : keys;
  }
  return out;
}

function segmentMapPlain(segmentMap) {
  if (!segmentMap) return {};
  if (segmentMap instanceof Map) return Object.fromEntries(segmentMap);
  return typeof segmentMap === 'object' ? segmentMap : {};
}

function mcxSliceFromPerms(perms) {
  const plain = segmentMapPlain(perms);
  return plain.MCXFUT || plain.MCX || {};
}

function readMcxTimingFromSlice(slice) {
  if (!slice || typeof slice !== 'object') return { start: '', close: '' };
  return {
    start: String(slice.mcxStartTime || slice.startTime || '').trim(),
    close: String(slice.mcxClosingTime || slice.closingTime || '').trim(),
  };
}

/** Walk direct parent + hierarchyPath admins until both MCX start/close are found. */
export async function resolveMcxTimingFromAdminChain(user) {
  if (!user) return { mcxStartTime: '', mcxClosingTime: '' };

  const chainIds = [];
  const seen = new Set();
  const push = (id) => {
    if (!id) return;
    const s = String(id);
    if (seen.has(s)) return;
    seen.add(s);
    chainIds.push(id);
  };

  push(user.admin?._id || user.admin);
  if (Array.isArray(user.hierarchyPath)) {
    for (let i = user.hierarchyPath.length - 1; i >= 0; i--) {
      push(user.hierarchyPath[i]);
    }
  }

  let start = '';
  let close = '';

  for (const adminId of chainIds) {
    const doc = await Admin.findById(adminId).select('segmentPermissions').lean();
    const { start: s, close: c } = readMcxTimingFromSlice(mcxSliceFromPerms(doc?.segmentPermissions));
    if (s && !start) start = s;
    if (c && !close) close = c;
    if (start && close) break;
  }

  return { mcxStartTime: start, mcxClosingTime: close };
}

export function isMcxSegmentKey(segKey) {
  const k = String(segKey || '').toUpperCase();
  return k === 'MCX' || k.startsWith('MCX');
}

export function resolveSystemMcxClosingTime(sysSegDefaults = {}) {
  const m = sysSegDefaults.MCXFUT || sysSegDefaults.MCXOPT || sysSegDefaults.MCX || {};
  return String(m.mcxClosingTime || m.closingTime || '').trim();
}

export function resolveSystemMcxStartTime(sysSegDefaults = {}) {
  const m = sysSegDefaults.MCXFUT || sysSegDefaults.MCXOPT || sysSegDefaults.MCX || {};
  return String(m.mcxStartTime || m.startTime || '').trim();
}

function resolveCloseFromSettings(settings) {
  return String(settings?.mcxClosingTime || settings?.closingTime || '').trim();
}

function resolveStartFromSettings(settings) {
  return String(settings?.mcxStartTime || settings?.startTime || '').trim();
}

export async function resolveEffectiveMcxClosingTimeForUser(user) {
  if (!user) return '';
  const settings = await TradeService.getUserSegmentSettings(user, 'MCXFUT', null);
  return resolveCloseFromSettings(settings);
}

export async function resolveEffectiveMcxStartTimeForUser(user) {
  if (!user) return '';
  const settings = await TradeService.getUserSegmentSettings(user, 'MCXFUT', null);
  return resolveStartFromSettings(settings);
}

export async function isPastMcxCloseForUser(user) {
  const close = await resolveEffectiveMcxClosingTimeForUser(user);
  if (!close) return false;
  return isPastIstClock(close);
}

/** True when IST is inside [start, close) for merged MCXFUT settings. No timing = always active. */
export async function isMcxSessionActiveForUser(user) {
  if (!user) return true;
  const settings = await TradeService.getUserSegmentSettings(user, 'MCXFUT', null);
  const start = resolveStartFromSettings(settings);
  const close = resolveCloseFromSettings(settings);
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

export function isPastSystemMcxClose(sysSegDefaults = {}) {
  const close = resolveSystemMcxClosingTime(sysSegDefaults);
  if (!close) return false;
  return isPastIstClock(close);
}

export function resolveMcxCloseFromSegSettings(segSettings = {}) {
  return String(segSettings.mcxClosingTime || segSettings.closingTime || '').trim();
}
