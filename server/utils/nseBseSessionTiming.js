import TradeService from '../services/tradeService.js';
import Admin from '../models/Admin.js';
import {
  istClockToSeconds,
  nowIstSecondsOfDay,
  isPastIstClock,
} from './cryptoSessionTiming.js';

export const NSE_BSE_SESSION_TIMING_KEYS = [
  'nseStartTime',
  'nseClosingTime',
  'startTime',
  'closingTime',
];

export function stripNseBseSessionTimingFromSegmentMap(plain) {
  if (!plain || typeof plain !== 'object') return plain;
  const out = { ...plain };
  for (const [segName, segData] of Object.entries(out)) {
    if (!segData || typeof segData !== 'object') continue;
    const seg = { ...segData };
    for (const k of NSE_BSE_SESSION_TIMING_KEYS) delete seg[k];
    out[segName] = seg;
  }
  return out;
}

export function stripNseBseKeysFromSegmentExplicitKeys(explicitKeys) {
  if (!explicitKeys || typeof explicitKeys !== 'object') return explicitKeys;
  const out = {};
  for (const [seg, keys] of Object.entries(explicitKeys)) {
    out[seg] = Array.isArray(keys)
      ? keys.filter((k) => !NSE_BSE_SESSION_TIMING_KEYS.includes(k))
      : keys;
  }
  return out;
}

function segmentMapPlain(segmentMap) {
  if (!segmentMap) return {};
  if (segmentMap instanceof Map) return Object.fromEntries(segmentMap);
  return typeof segmentMap === 'object' ? segmentMap : {};
}

function nseSliceFromPerms(perms) {
  const plain = segmentMapPlain(perms);
  return plain.NSEFUT || plain['NSE-EQ'] || plain.FNO || {};
}

function readNseTimingFromSlice(slice) {
  if (!slice || typeof slice !== 'object') return { start: '', close: '' };
  return {
    start: String(slice.nseStartTime || slice.startTime || '').trim(),
    close: String(slice.nseClosingTime || slice.closingTime || '').trim(),
  };
}

export async function resolveNseBseTimingFromAdminChain(user) {
  if (!user) return { nseStartTime: '', nseClosingTime: '' };

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
    const { start: s, close: c } = readNseTimingFromSlice(nseSliceFromPerms(doc?.segmentPermissions));
    if (s && !start) start = s;
    if (c && !close) close = c;
    if (start && close) break;
  }

  return { nseStartTime: start, nseClosingTime: close };
}

export function isNseBseSegmentKey(segKey) {
  const k = String(segKey || '').toUpperCase();
  return (
    k.startsWith('NSE') ||
    k.startsWith('BSE') ||
    k === 'FNO' ||
    k === 'EQUITY'
  );
}

export function resolveSystemNseBseClosingTime(sysSegDefaults = {}) {
  const m = sysSegDefaults.NSEFUT || sysSegDefaults['NSE-EQ'] || sysSegDefaults.FNO || {};
  return String(m.nseClosingTime || m.closingTime || '').trim();
}

export function resolveSystemNseBseStartTime(sysSegDefaults = {}) {
  const m = sysSegDefaults.NSEFUT || sysSegDefaults['NSE-EQ'] || sysSegDefaults.FNO || {};
  return String(m.nseStartTime || m.startTime || '').trim();
}

function resolveCloseFromSettings(settings) {
  return String(settings?.nseClosingTime || settings?.closingTime || '').trim();
}

function resolveStartFromSettings(settings) {
  return String(settings?.nseStartTime || settings?.startTime || '').trim();
}

export async function resolveEffectiveNseBseClosingTimeForUser(user) {
  if (!user) return '';
  const settings = await TradeService.getUserSegmentSettings(user, 'NSEFUT', null);
  return resolveCloseFromSettings(settings);
}

export async function resolveEffectiveNseBseStartTimeForUser(user) {
  if (!user) return '';
  const settings = await TradeService.getUserSegmentSettings(user, 'NSEFUT', null);
  return resolveStartFromSettings(settings);
}

export async function isPastNseBseCloseForUser(user) {
  const close = await resolveEffectiveNseBseClosingTimeForUser(user);
  if (!close) return false;
  return isPastIstClock(close);
}

export async function isNseBseSessionActiveForUser(user) {
  if (!user) return true;
  const settings = await TradeService.getUserSegmentSettings(user, 'NSEFUT', null);
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

export function isPastSystemNseBseClose(sysSegDefaults = {}) {
  const close = resolveSystemNseBseClosingTime(sysSegDefaults);
  if (!close) return false;
  return isPastIstClock(close);
}

export function resolveNseBseCloseFromSegSettings(segSettings = {}) {
  return String(segSettings.nseClosingTime || segSettings.closingTime || '').trim();
}
