/** IST session end clock for autosquare history (display + dedupe). */

export function normalizeCloseTimeKey(closeTime) {
  const s = String(closeTime ?? '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return s;
  const h = String(Number(m[1])).padStart(2, '0');
  const min = String(Number(m[2])).padStart(2, '0');
  const sec = String(Number(m[3] || 0)).padStart(2, '0');
  return `${h}:${min}:${sec}`;
}

/** Build IST instant for today's (or ref) calendar day at HH:mm:ss. */
export function parseIstSessionCloseAt(closeTime, refDate = new Date()) {
  const key = normalizeCloseTimeKey(closeTime);
  if (!key) return new Date(refDate);
  const [h, min, sec] = key.split(':').map(Number);
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
    new Date(refDate)
  );
  const utc = new Date(`${dayKey}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}+05:30`);
  return Number.isNaN(utc.getTime()) ? new Date(refDate) : utc;
}

export function autosquareEventDedupeKey(tradeId, closeTime) {
  const ct = normalizeCloseTimeKey(closeTime);
  return ct ? `${String(tradeId)}|${ct}` : `${String(tradeId)}|legacy`;
}
