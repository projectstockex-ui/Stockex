import TradeService from '../services/tradeService.js';
import SystemSettings from '../models/SystemSettings.js';
import { plainSegmentDefaultsMap } from './commissionTypeUnit.js';
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

/** Platform-wide MCX session timing from SystemSettings (same for all admins/users). */
export async function resolveMcxTimingFromSystem() {
  try {
    const sysLean = await SystemSettings.findOne({ settingsType: 'global' })
      .select('adminSegmentDefaults')
      .lean();
    const defaults = plainSegmentDefaultsMap(sysLean?.adminSegmentDefaults || {});
    return {
      mcxStartTime: resolveSystemMcxStartTime(defaults),
      mcxClosingTime: resolveSystemMcxClosingTime(defaults),
    };
  } catch {
    return { mcxStartTime: '', mcxClosingTime: '' };
  }
}

/** @deprecated Use resolveMcxTimingFromSystem — per-admin chain timing removed. */
export async function resolveMcxTimingFromAdminChain(_user) {
  return resolveMcxTimingFromSystem();
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

/** Persist MCXFUT session clocks onto SystemSettings.adminSegmentDefaults (Super Admin source of truth). */
export async function propagateMcxTimingToSystemDefaults(mcxFutData) {
  if (!mcxFutData || typeof mcxFutData !== 'object') return;

  const mcxStart =
    mcxFutData.mcxStartTime !== undefined ? mcxFutData.mcxStartTime : mcxFutData.startTime;
  const mcxClose =
    mcxFutData.mcxClosingTime !== undefined ? mcxFutData.mcxClosingTime : mcxFutData.closingTime;
  if (mcxStart === undefined && mcxClose === undefined) return;

  const settings = await SystemSettings.findOne({ settingsType: 'global' });
  if (!settings?.adminSegmentDefaults) return;

  const updateMcxTiming = (segMap, segName) => {
    if (segMap instanceof Map) {
      const seg = segMap.get(segName) || {};
      if (mcxStart !== undefined) seg.mcxStartTime = mcxStart;
      if (mcxClose !== undefined) {
        seg.mcxClosingTime = mcxClose;
        seg.closingTime = mcxClose;
      }
      segMap.set(segName, seg);
    } else if (segMap && typeof segMap === 'object') {
      segMap[segName] = segMap[segName] || {};
      if (mcxStart !== undefined) segMap[segName].mcxStartTime = mcxStart;
      if (mcxClose !== undefined) {
        segMap[segName].mcxClosingTime = mcxClose;
        segMap[segName].closingTime = mcxClose;
      }
    }
  };

  for (const segName of ['MCXFUT', 'MCX', 'MCXOPT']) {
    updateMcxTiming(settings.adminSegmentDefaults, segName);
  }
  settings.markModified('adminSegmentDefaults');
  await settings.save();
}
