/** Autosquare UI: show admin session end time (closeTime), not server process timestamp. */

function parseCloseParts(closeTime) {
  const s = String(closeTime ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return {
    h: Number(m[1]),
    min: Number(m[2]),
    sec: Number(m[3] || 0),
    clock: `${String(Number(m[1])).padStart(2, '0')}:${String(Number(m[2])).padStart(2, '0')}:${String(Number(m[3] || 0)).padStart(2, '0')}`,
  };
}

/** HH:mm:ss for LTP @ End Time row */
export function formatAutosquareEndClock(item) {
  const p = parseCloseParts(item?.closeTime);
  return p?.clock || null;
}

/** Date column: session end on trade's IST day, e.g. "04 Jun 2026, 10:45 am" */
export function formatAutosquareSessionDate(item) {
  const p = parseCloseParts(item?.closeTime);
  const base = item?.openedAt || item?.autoSquaredAt || item?.createdAt;
  if (!p || !base) {
    if (!item?.autoSquaredAt) return '-';
    return new Date(item.autoSquaredAt).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    });
  }

  const dayLabel = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(base));

  const h12 = p.h % 12 || 12;
  const ampm = p.h >= 12 ? 'pm' : 'am';
  const min = String(p.min).padStart(2, '0');
  return `${dayLabel}, ${h12}:${min} ${ampm}`;
}
