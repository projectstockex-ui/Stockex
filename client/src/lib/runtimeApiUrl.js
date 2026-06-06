/** API / socket base for web and mobile WebView embed. */
export function getRuntimeApiBase() {
  if (typeof window !== 'undefined' && window.__STOCKEX_API_URL__ != null) {
    const v = String(window.__STOCKEX_API_URL__).replace(/\/$/, '');
    if (v) return v;
    // Empty string = same-origin (Vite dev proxy / production nginx)
    if (isMobileEmbed() && window.location?.origin) {
      return window.location.origin;
    }
  }
  const env = String(import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  if (env) return env;
  return '';
}

export function getRuntimeSocketUrl() {
  if (typeof window !== 'undefined' && window.__STOCKEX_SOCKET_URL__) {
    return String(window.__STOCKEX_SOCKET_URL__).replace(/\/$/, '');
  }
  // Mobile WebView: connect via page origin — Vite/nginx proxies /socket.io → backend
  if (isMobileEmbed() && typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  const fromEnv = import.meta.env.VITE_SOCKET_URL;
  if (fromEnv) return String(fromEnv).replace(/\/$/, '');
  const api = getRuntimeApiBase();
  if (api) return api;
  // Dev: hit API port directly — Vite /socket.io WS proxy often aborts (ECONNABORTED).
  if (import.meta.env.DEV) {
    return String(import.meta.env.VITE_API_URL || 'http://localhost:5001').replace(/\/$/, '');
  }
  return typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'http://localhost:5001';
}

export function isMobileEmbed() {
  return typeof window !== 'undefined' && window.__STOCKEX_MOBILE_EMBED__ === true;
}

/** Socket.io options tuned for React Native WebView (polling first). */
export function getSocketClientOptions() {
  return {
    // WebSocket first — faster tick delivery than long-polling (Kite-like speed).
    transports: ['websocket', 'polling'],
    path: '/socket.io/',
    reconnection: true,
    reconnectionAttempts: 25,
    reconnectionDelay: 1000,
    timeout: 25000,
    withCredentials: true,
    upgrade: true,
  };
}

export function resolveNiftyTickFromBatch(ticks) {
  if (!ticks || typeof ticks !== 'object') return null;
  return (
    ticks['256265'] ||
    ticks['99926000'] ||
    ticks['NIFTY 50'] ||
    ticks.NIFTY ||
    Object.values(ticks).find(
      (t) =>
        t &&
        (t.symbol === 'NIFTY 50' ||
          t.symbol === 'NIFTY' ||
          String(t.token) === '256265' ||
          String(t.token) === '99926000')
    ) ||
    null
  );
}

export function resolveBtcTickFromBatch(ticks) {
  if (!ticks || typeof ticks !== 'object') return null;
  return ticks.BTCUSDT || ticks.BTC || ticks.btcusdt || null;
}
