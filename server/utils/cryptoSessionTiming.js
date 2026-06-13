import TradeService from '../services/tradeService.js';
import SystemSettings from '../models/SystemSettings.js';
import { plainSegmentDefaultsMap } from './commissionTypeUnit.js';

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

/** Platform-wide crypto session timing from SystemSettings (same for all admins/users). */
export async function resolveCryptoTimingFromSystem() {
  try {
    const sysLean = await SystemSettings.findOne({ settingsType: 'global' })
      .select('adminSegmentDefaults')
      .lean();
    const defaults = plainSegmentDefaultsMap(sysLean?.adminSegmentDefaults || {});
    return {
      cryptoStartTime: resolveSystemCryptoStartTime(defaults),
      cryptoClosingTime: resolveSystemCryptoClosingTime(defaults),
    };
  } catch {
    return { cryptoStartTime: '', cryptoClosingTime: '' };
  }
}

/** @deprecated Use resolveCryptoTimingFromSystem — per-admin chain timing removed. */
export async function resolveCryptoTimingFromAdminChain(_user) {
  return resolveCryptoTimingFromSystem();
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
