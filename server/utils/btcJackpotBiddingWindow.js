/**
 * BTC Jackpot bidding window in Asia/Kolkata (matches GameSettings biddingStartTime / biddingEndTime).
 * HH:mm end times include the full end minute (through :59). HH:mm:ss ends at that second inclusive.
 */

function getNowISTSecondsFromMidnight(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const n = (t) => parseInt(parts.find((p) => p.type === t)?.value || '0', 10);
  const h = n('hour');
  const m = n('minute');
  const s = n('second');
  return h * 3600 + m * 60 + s;
}

function parseClockToSeconds(str) {
  const s = String(str ?? '00:00').trim();
  const parts = s.split(':').map((x) => parseInt(x, 10));
  const h = parts[0] || 0;
  const m = Number.isFinite(parts[1]) ? parts[1] : 0;
  const sec = Number.isFinite(parts[2]) ? parts[2] : 0;
  return h * 3600 + m * 60 + sec;
}

/** Last second inclusive for configured end time. */
export function biddingEndInclusiveSecondsFromConfig(endTimeStr) {
  const s = String(endTimeStr || '23:29').trim();
  const segments = s.split(':').filter((x) => x !== '');
  const base = parseClockToSeconds(s);
  if (segments.length >= 3) return base;
  const minuteStart = Math.floor(base / 60) * 60;
  return minuteStart + 59;
}

/**
 * @returns {{ ok: true } | { ok: false, reason: 'before_start' | 'after_end' }}
 */
export function evaluateBtcJackpotBiddingWindow(gc) {
  if (
    process.env.BTC_JACKPOT_ALLOW_TEST_BIDDING === 'true' ||
    process.env.BTC_JACKPOT_ALLOW_TEST_BIDDING === '1'
  ) {
    return { ok: true };
  }

  // Only apply bidding window restrictions if explicitly set by superadmin
  // Otherwise, BTC games are 24*7 (like BTC up/down)
  const hasExplicitStartTime = gc?.biddingStartTime != null && gc?.biddingStartTime !== '';
  const hasExplicitEndTime = gc?.biddingEndTime != null && gc?.biddingEndTime !== '';
  if (!hasExplicitStartTime || !hasExplicitEndTime) {
    return { ok: true };
  }

  const startSec = parseClockToSeconds(gc.biddingStartTime);
  const endInclusive = biddingEndInclusiveSecondsFromConfig(gc.biddingEndTime);
  const nowSec = getNowISTSecondsFromMidnight();

  if (nowSec < startSec) return { ok: false, reason: 'before_start' };
  if (nowSec > endInclusive) return { ok: false, reason: 'after_end' };
  return { ok: true };
}

export function btcJackpotBiddingWindowUserMessage(gc, reason) {
  if (reason === 'before_start') {
    return `Bidding opens at ${gc?.biddingStartTime || '00:00'} IST.`;
  }
  return "Today's bidding time is over now.";
}
