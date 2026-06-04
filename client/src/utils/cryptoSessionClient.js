/** Client-side crypto session window (matches server SystemSettings CRYPTOFUT timing). */

export function isCryptoWindowLive(cryptoSettings = {}) {
  const startTimeStr = String(cryptoSettings.cryptoStartTime || '').trim();
  const closeTimeStr = String(cryptoSettings.cryptoClosingTime || '').trim();
  if (!startTimeStr && !closeTimeStr) return true;

  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const totalMinutes = ist.getHours() * 60 + ist.getMinutes();

  if (startTimeStr) {
    const [sh, sm] = startTimeStr.split(':').map(Number);
    if (Number.isFinite(sh) && Number.isFinite(sm) && totalMinutes < sh * 60 + sm) {
      return false;
    }
  }
  if (closeTimeStr) {
    const [ch, cm] = closeTimeStr.split(':').map(Number);
    if (Number.isFinite(ch) && Number.isFinite(cm) && totalMinutes >= ch * 60 + cm) {
      return false;
    }
  }
  return true;
}

export function getCryptoMarketQuoteWithSession(marketData, instrument, cryptoSettings = {}, sessionLive = true) {
  if (!instrument || !marketData || typeof marketData !== 'object') return null;
  const rawKeys = [instrument.pair, instrument.symbol, instrument.token].filter(
    (v) => v != null && String(v).trim() !== ''
  );
  let quote = null;
  for (const raw of rawKeys) {
    const s = String(raw).trim();
    for (const k of [s, s.toUpperCase(), s.toLowerCase()]) {
      const q = marketData[k];
      if (q != null && (q.ltp != null || q.close != null)) {
        quote = q;
        break;
      }
    }
    if (quote) break;
  }
  if (!quote) return null;
  if (!sessionLive) {
    return { ...quote, sessionFrozen: true };
  }
  return quote;
}
