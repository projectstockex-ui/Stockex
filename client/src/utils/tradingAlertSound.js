const STORAGE_SOUND_ALERTS = 'stockex:soundAlerts';
const STORAGE_SOUND_AUTOSQUARE = 'stockex:soundAutosquare';

let audioCtx = null;
let lastAutosquareAt = 0;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  return audioCtx;
}

export function isAutosquareSoundEnabled() {
  if (typeof window === 'undefined') return false;
  if (localStorage.getItem(STORAGE_SOUND_AUTOSQUARE) === 'false') return false;
  if (localStorage.getItem(STORAGE_SOUND_ALERTS) === 'false') return false;
  return true;
}

export function setAutosquareSoundEnabled(enabled) {
  localStorage.setItem(STORAGE_SOUND_AUTOSQUARE, enabled ? 'true' : 'false');
}

function playTone(ctx, frequency, startTime, durationSec, volume = 0.28) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(frequency, startTime);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + durationSec + 0.02);
}

/** Urgent three-tone alert when positions are auto-squared (margin cut). */
export function playAutosquareAlert() {
  if (!isAutosquareSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const run = () => {
    const t = ctx.currentTime;
    playTone(ctx, 880, t, 0.12);
    playTone(ctx, 554, t + 0.14, 0.12);
    playTone(ctx, 880, t + 0.28, 0.2);
    playTone(ctx, 440, t + 0.5, 0.25, 0.22);
  };

  if (ctx.state === 'suspended') {
    ctx.resume().then(run).catch(() => {});
  } else {
    run();
  }
}

/** Debounced — avoids double beep from ledger + trade_update. */
export function triggerAutosquareSound() {
  const now = Date.now();
  if (now - lastAutosquareAt < 2500) return;
  lastAutosquareAt = now;
  playAutosquareAlert();
}

/** Call once after user gesture so mobile browsers allow audio. */
export function primeTradingSounds() {
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== 'suspended') return;
  ctx.resume().catch(() => {});
}
