const STORAGE_SOUND_ALERTS = 'stockex:soundAlerts';
const STORAGE_SOUND_AUTOSQUARE = 'stockex:soundAutosquare';

let audioCtx = null;
let lastAutosquareAt = 0;
let lastRejectAt = 0;
let lastSuccessAt = 0;
let lastSlTpAt = 0;
let lastPriceAlertAt = 0;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  return audioCtx;
}

export function isTradingSoundEnabled() {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_SOUND_ALERTS) !== 'false';
}

export function isAutosquareSoundEnabled() {
  if (typeof window === 'undefined') return false;
  if (localStorage.getItem(STORAGE_SOUND_AUTOSQUARE) === 'false') return false;
  if (!isTradingSoundEnabled()) return false;
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

function runWithAudioContext(fn) {
  if (!isTradingSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const run = () => fn(ctx);
  if (ctx.state === 'suspended') {
    ctx.resume().then(run).catch(() => {});
  } else {
    run();
  }
}

/** Urgent three-tone alert when positions are auto-squared (margin cut). */
export function playAutosquareAlert() {
  if (!isAutosquareSoundEnabled()) return;
  runWithAudioContext((ctx) => {
    const t = ctx.currentTime;
    playTone(ctx, 880, t, 0.12);
    playTone(ctx, 554, t + 0.14, 0.12);
    playTone(ctx, 880, t + 0.28, 0.2);
    playTone(ctx, 440, t + 0.5, 0.25, 0.22);
  });
}

/** Debounced — avoids double beep from ledger + trade_update. */
export function triggerAutosquareSound() {
  const now = Date.now();
  if (now - lastAutosquareAt < 2500) return;
  lastAutosquareAt = now;
  playAutosquareAlert();
}

/** Short low tone when order is rejected (validation / API error). */
export function playOrderRejectSound() {
  const now = Date.now();
  if (now - lastRejectAt < 600) return;
  lastRejectAt = now;
  runWithAudioContext((ctx) => {
    const t = ctx.currentTime;
    playTone(ctx, 220, t, 0.1, 0.32);
    playTone(ctx, 165, t + 0.1, 0.14, 0.28);
  });
}

/** Two-tone up when order places / executes successfully. */
export function playOrderSuccessSound() {
  const now = Date.now();
  if (now - lastSuccessAt < 800) return;
  lastSuccessAt = now;
  runWithAudioContext((ctx) => {
    const t = ctx.currentTime;
    playTone(ctx, 523, t, 0.08, 0.22);
    playTone(ctx, 784, t + 0.09, 0.12, 0.24);
  });
}

/** Stop-loss hit — descending alert. */
export function playStopLossHitSound() {
  const now = Date.now();
  if (now - lastSlTpAt < 1500) return;
  lastSlTpAt = now;
  runWithAudioContext((ctx) => {
    const t = ctx.currentTime;
    playTone(ctx, 440, t, 0.1, 0.26);
    playTone(ctx, 330, t + 0.12, 0.14, 0.24);
    playTone(ctx, 247, t + 0.26, 0.18, 0.22);
  });
}

/** Target hit — bright ascending chime. */
export function playTargetHitSound() {
  const now = Date.now();
  if (now - lastSlTpAt < 1500) return;
  lastSlTpAt = now;
  runWithAudioContext((ctx) => {
    const t = ctx.currentTime;
    playTone(ctx, 587, t, 0.08, 0.22);
    playTone(ctx, 740, t + 0.1, 0.1, 0.24);
    playTone(ctx, 988, t + 0.2, 0.16, 0.26);
  });
}

/** Price alert — repeating chime when LTP crosses saved level. */
export function playPriceAlertSound() {
  const now = Date.now();
  if (now - lastPriceAlertAt < 2000) return;
  lastPriceAlertAt = now;
  runWithAudioContext((ctx) => {
    const t = ctx.currentTime;
    playTone(ctx, 698, t, 0.1, 0.26);
    playTone(ctx, 932, t + 0.12, 0.1, 0.28);
    playTone(ctx, 1175, t + 0.24, 0.14, 0.3);
    playTone(ctx, 932, t + 0.4, 0.12, 0.26);
  });
}

/** Optional voice announcement (browser speech synthesis). */
export function speakPriceAlert(message) {
  if (typeof window === 'undefined' || !window.speechSynthesis || !message) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(String(message));
    utter.rate = 1;
    utter.pitch = 1;
    utter.volume = 0.9;
    window.speechSynthesis.speak(utter);
  } catch {
    /* ignore */
  }
}

/** Call once after user gesture so mobile browsers allow audio. */
export function primeTradingSounds() {
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== 'suspended') return;
  ctx.resume().catch(() => {});
}
