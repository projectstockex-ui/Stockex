import BtcJackpotResult from '../models/BtcJackpotResult.js';
import GameResult from '../models/GameResult.js';
import { getTodayISTString, startOfISTDayFromKey, endOfISTDayFromKey } from './istDate.js';
import { biddingEndInclusiveSecondsFromConfig } from './btcJackpotBiddingWindow.js';
import {
  parseTimeToSecIST,
  currentTotalSecondsIST,
  getEffectiveBtcSessionBounds,
} from '../../lib/btcUpDownWindows.js';

const BTC_PREVIOUS_LTP_GAMES = new Set(['btcJackpot', 'btcNumber', 'btcUpDown']);

function shiftISTDay(yyyyMmDd, deltaDays) {
  const start = startOfISTDayFromKey(yyyyMmDd);
  if (!start) return yyyyMmDd;
  return getTodayISTString(new Date(start.getTime() + deltaDays * 86400000));
}

function formatHmsFromSec(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n < 0) return '—';
  const h = Math.floor(n / 3600) % 24;
  const m = Math.floor((n % 3600) / 60);
  const s = Math.floor(n % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Normalize config clock to HH:mm:ss for display (HH:mm → through :59 of that minute). */
export function formatConfigEndTimeForDisplay(raw, fallback = '23:30:00') {
  const s = String(raw || fallback).trim();
  const parts = s.split(':').filter((x) => x !== '');
  if (parts.length >= 3) {
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    const sec = parseInt(parts[2], 10) || 0;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  const base = parseTimeToSecIST(s);
  const minuteStart = Math.floor(base / 60) * 60;
  return formatHmsFromSec(minuteStart + 59);
}

function endInclusiveSecondsFromConfig(rawEnd, fallback = '23:30') {
  const s = String(rawEnd || fallback).trim();
  const parts = s.split(':').filter(Boolean);
  const base = parseTimeToSecIST(s || fallback);
  if (parts.length >= 3) return base;
  return Math.floor(base / 60) * 60 + 59;
}

async function fetchJackpotLockPreviousLtps(endTimeDisplay, endSecInclusive, limit = 5) {
  const today = getTodayISTString();
  const nowSec = currentTotalSecondsIST();

  const lockRows = await BtcJackpotResult.find({ lockedBtcPrice: { $gt: 0 } })
    .sort({ resultDate: -1, lockedAt: -1 })
    .select('resultDate lockedBtcPrice lockedAt lockedSource')
    .limit(30)
    .lean();

  const rows = [];
  for (const r of lockRows) {
    if (r.resultDate === today && nowSec < endSecInclusive) continue;
    const ltp = Number(r.lockedBtcPrice);
    if (!Number.isFinite(ltp) || ltp <= 0) continue;
    rows.push({
      date: r.resultDate,
      endTime: endTimeDisplay,
      ltp,
      recordedAt: r.lockedAt || null,
      source: r.lockedSource || null,
    });
    if (rows.length >= limit) break;
  }

  return rows;
}

async function fetchBtcUpDownPreviousLtps(cfg, limit = 5) {
  const { endSec } = getEffectiveBtcSessionBounds(cfg);
  const endTimeDisplay = formatHmsFromSec(endSec);
  const today = getTodayISTString();
  const nowSec = currentTotalSecondsIST();

  const rows = [];
  for (let offset = 0; offset < 21 && rows.length < limit; offset += 1) {
    const dayKey = shiftISTDay(today, -offset);
    if (dayKey === today && nowSec < endSec) continue;

    const dayStart = startOfISTDayFromKey(dayKey);
    const dayEnd = endOfISTDayFromKey(dayKey);
    if (!dayStart || !dayEnd) continue;

    const row = await GameResult.findOne({
      gameId: 'btcupdown',
      windowDate: { $gte: dayStart, $lt: dayEnd },
    })
      .sort({ windowNumber: -1 })
      .select('closePrice windowEndTime windowNumber resultTime settlementProcessedAt')
      .lean();

    const ltp = Number(row?.closePrice);
    if (!row || !Number.isFinite(ltp) || ltp <= 0) continue;

    rows.push({
      date: dayKey,
      endTime: row.windowEndTime || endTimeDisplay,
      ltp,
      windowNumber: row.windowNumber ?? null,
      recordedAt: row.resultTime || row.settlementProcessedAt || null,
      source: 'game_result',
    });
  }

  return rows;
}

/**
 * Last N days BTC LTP at each game's configured session end / result time (Super Admin).
 */
export async function getBtcGamePreviousLtps(gameKey, games = {}, limit = 5) {
  const key = String(gameKey || '').trim();
  if (!BTC_PREVIOUS_LTP_GAMES.has(key)) {
    return { game: key, endTime: null, rows: [], message: 'Unsupported game' };
  }

  const cfg = games[key] || {};
  let endTimeDisplay = '—';
  let endSecInclusive = 0;
  let rows = [];

  if (key === 'btcJackpot') {
    const rawEnd = cfg.resultTime || cfg.biddingEndTime || '23:30';
    endTimeDisplay = formatConfigEndTimeForDisplay(rawEnd, '23:30:00');
    endSecInclusive = cfg.resultTime
      ? parseTimeToSecIST(cfg.resultTime)
      : biddingEndInclusiveSecondsFromConfig(cfg.biddingEndTime || '23:29');
    rows = await fetchJackpotLockPreviousLtps(endTimeDisplay, endSecInclusive, limit);
  } else if (key === 'btcNumber') {
    const rawEnd = cfg.endTime || cfg.resultTime || cfg.maxBidTime || '23:30';
    endTimeDisplay = formatConfigEndTimeForDisplay(rawEnd, '23:30:00');
    endSecInclusive = endInclusiveSecondsFromConfig(rawEnd, '23:30');
    rows = await fetchJackpotLockPreviousLtps(endTimeDisplay, endSecInclusive, limit);
  } else if (key === 'btcUpDown') {
    const rawEnd = cfg.endTime || '23:45:00';
    endTimeDisplay = formatConfigEndTimeForDisplay(rawEnd, '23:45:00');
    endSecInclusive = parseTimeToSecIST(rawEnd);
    rows = await fetchBtcUpDownPreviousLtps(cfg, limit);
  }

  return {
    game: key,
    endTime: endTimeDisplay,
    endTimeLabel: `${endTimeDisplay} IST`,
    rows,
  };
}

export { BTC_PREVIOUS_LTP_GAMES };
