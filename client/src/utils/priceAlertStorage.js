const STORAGE_PREFIX = 'stockex:priceAlerts_v1_';
const UPDATE_EVENT = 'stockex:price-alert-updated';
const FIRED_EVENT = 'stockex:price-alert-fired';

export function priceAlertInstrumentKey(instrument) {
  if (!instrument) return '';
  const k = instrument.token ?? instrument.pair ?? instrument.symbol;
  return k != null && k !== '' ? String(k).trim() : '';
}

function storageKey(userId) {
  return `${STORAGE_PREFIX}${userId || 'anon'}`;
}

function readAll(userId) {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(userId, map) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(storageKey(userId), JSON.stringify(map));
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: { userId } }));
}

export function getPriceAlert(userId, instrument) {
  const key = priceAlertInstrumentKey(instrument);
  if (!key) return null;
  const all = readAll(userId);
  const row = all[key];
  if (!row || row.enabled === false) return null;
  return row;
}

export function listActivePriceAlerts(userId) {
  const all = readAll(userId);
  return Object.values(all).filter((a) => a?.enabled !== false && Number(a?.price) > 0);
}

export function savePriceAlert(userId, instrument, price) {
  const instrumentKey = priceAlertInstrumentKey(instrument);
  const px = Number(price);
  if (!instrumentKey || !Number.isFinite(px) || px <= 0) {
    return { ok: false, message: 'Enter a valid alert price' };
  }
  const all = readAll(userId);
  all[instrumentKey] = {
    instrumentKey,
    symbol: instrument.symbol || instrument.pair || 'Instrument',
    token: instrument.token != null ? String(instrument.token) : null,
    pair: instrument.pair || null,
    tradingSymbol: instrument.tradingSymbol || null,
    exchange: instrument.exchange || null,
    isCrypto: !!(instrument.isCrypto || instrument.exchange === 'BINANCE'),
    isForex: !!instrument.isForex,
    price: px,
    enabled: true,
    triggered: false,
    savedAt: Date.now(),
  };
  writeAll(userId, all);
  return { ok: true, alert: all[instrumentKey] };
}

export function clearPriceAlert(userId, instrument) {
  const instrumentKey = priceAlertInstrumentKey(instrument);
  if (!instrumentKey) return;
  const all = readAll(userId);
  delete all[instrumentKey];
  writeAll(userId, all);
}

export function markPriceAlertTriggered(userId, instrumentKey) {
  const all = readAll(userId);
  const row = all[instrumentKey];
  if (!row) return;
  row.triggered = true;
  row.enabled = false;
  row.triggeredAt = Date.now();
  writeAll(userId, all);
}

export function dispatchPriceAlertFired(detail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(FIRED_EVENT, { detail }));
}

export const PRICE_ALERT_UPDATE_EVENT = UPDATE_EVENT;
export const PRICE_ALERT_FIRED_EVENT = FIRED_EVENT;
