/**
 * Nifty Up/Down — IST session windows driven by GameSettings (startTime, endTime, roundDuration in seconds).
 * Aligns with legacy 15m UI when roundDuration = 900.
 */

import { currentTotalSecondsIST } from './btcUpDownWindows.js';

export { currentTotalSecondsIST as currentTotalSecondsISTNifty };

export function parseTimeToSecIST(timeStr) {
  const parts = String(timeStr || '09:15:00').split(':').map(Number);
  const h = parts[0] || 0;
  const m = parts[1] || 0;
  const s = parts[2] || 0;
  return h * 3600 + m * 60 + s;
}

export function getEffectiveNiftySessionBounds(gameConfig = {}) {
  let marketOpenSec = parseTimeToSecIST(gameConfig.startTime ?? '09:15:00');
  marketOpenSec = Math.floor(marketOpenSec / 60) * 60;
  let marketCloseSec = parseTimeToSecIST(gameConfig.endTime ?? '15:30:00');
  if (!Number.isFinite(marketCloseSec) || marketCloseSec <= marketOpenSec) {
    marketCloseSec = parseTimeToSecIST('15:30:00');
  }
  return { marketOpenSec, marketCloseSec };
}

/** Standard Nifty Up/Down leg length (seconds). Sub-900 values in DB are treated as misconfiguration. */
export const NIFTY_UP_DOWN_ROUND_DURATION_SEC = 900;

/**
 * Seconds per betting leg: betting runs D seconds; **LTP** is the last second of the leg (…:59:59);
 * **Result** is on the next quarter-hour **:00** (marketOpen + (k+2)*D). Minimum **900 (15m)**.
 */
export function getNiftyRoundDurationSec(gameConfig = {}) {
  const d = Number(gameConfig.roundDuration);
  if (!Number.isFinite(d) || d < NIFTY_UP_DOWN_ROUND_DURATION_SEC) return NIFTY_UP_DOWN_ROUND_DURATION_SEC;
  return Math.floor(d);
}

/**
 * Window state for UI / server validation (parity with client getTradingWindowInfo).
 */
export function getNiftyUpDownWindowState(nowSec, gameConfig = {}) {
  const { marketOpenSec, marketCloseSec } = getEffectiveNiftySessionBounds(gameConfig);
  const D = getNiftyRoundDurationSec(gameConfig);

  const openH = Math.floor(marketOpenSec / 3600);
  const openM = Math.floor((marketOpenSec % 3600) / 60);
  const openS = marketOpenSec % 60;

  if (nowSec < marketOpenSec) {
    return {
      status: 'pre_market',
      canTrade: false,
      windowNumber: 0,
      message: 'Market not yet open',
      countdown: marketOpenSec - nowSec,
      windowStartSec: null,
      windowEndSec: null,
      ltpTimeSec: null,
      resultTimeSec: null,
      roundDurationSec: D,
      k: -1,
    };
  }

  if (nowSec >= marketCloseSec) {
    return {
      status: 'post_market',
      canTrade: false,
      windowNumber: 0,
      message: 'Market closed for today',
      countdown: 0,
      windowStartSec: null,
      windowEndSec: null,
      ltpTimeSec: null,
      resultTimeSec: null,
      roundDurationSec: D,
      k: -1,
    };
  }

  const secSinceMarketOpen = nowSec - marketOpenSec;
  const windowIndex = Math.floor(secSinceMarketOpen / D);
  const windowStartSec = marketOpenSec + windowIndex * D;
  const windowEndSec = marketOpenSec + (windowIndex + 1) * D;
  // LTP for window W is fixed at the last second of that leg (..:59), not at next window start.
  const ltpTimeSec = marketOpenSec + (windowIndex + 1) * D - 1;
  const resultTimeSec = marketOpenSec + (windowIndex + 2) * D;

  if (windowEndSec >= marketCloseSec) {
    return {
      status: 'post_market',
      canTrade: false,
      windowNumber: 0,
      message: 'Market closed for today',
      countdown: 0,
      windowStartSec: null,
      windowEndSec: null,
      ltpTimeSec: null,
      resultTimeSec: null,
      roundDurationSec: D,
      k: -1,
    };
  }

  return {
    status: 'open',
    canTrade: true,
    message: 'Trading Window Open',
    windowNumber: windowIndex + 1,
    windowStartSec,
    windowEndSec,
    ltpTimeSec,
    resultTimeSec,
    countdown: windowEndSec - nowSec,
    roundDurationSec: D,
    k: windowIndex,
  };
}

export function validateNiftyUpDownBetPlacement(gameConfig, nowSec, clientWindowNumber) {
  const st = getNiftyUpDownWindowState(nowSec, gameConfig);
  if (!st.canTrade) {
    return {
      ok: false,
      message:
        st.status === 'post_market'
          ? 'Nifty Up/Down is outside market hours (IST).'
          : 'Betting is not open for this window. Refresh and try again.',
    };
  }
  const wn = Number(clientWindowNumber);
  if (!Number.isFinite(wn) || wn !== st.windowNumber) {
    return {
      ok: false,
      message: 'Window mismatch — refresh the game and place your bet again.',
    };
  }
  return { ok: true, state: st };
}

/** IST second for end-of-leg **LTP** (start of next window W+1, 1-based): marketOpen + W * D. */
export function niftyOpenFixSecForWindow(W, gameConfig = {}) {
  const { marketOpenSec } = getEffectiveNiftySessionBounds(gameConfig);
  const D = getNiftyRoundDurationSec(gameConfig);
  return marketOpenSec + W * D;
}

/**
 * IST seconds where window W (1-based) **result** price is fixed: start of window W+1 (15 minutes after window ends).
 * Window 1: 09:15-09:30, Result at 09:45
 * Window 2: 09:30-09:45, Result at 10:00
 */
export function niftyResultSecForWindow(W, gameConfig = {}) {
  const { marketOpenSec } = getEffectiveNiftySessionBounds(gameConfig);
  const D = getNiftyRoundDurationSec(gameConfig);
  // Result is at the start of window W+2 (2 windows ahead)
  return marketOpenSec + (W + 1) * D;
}
