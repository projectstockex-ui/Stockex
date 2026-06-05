/** Client-side NSE/BSE session window (matches server merged NSEFUT timing). */

function clockToIstSeconds(clockStr) {
  const m = String(clockStr || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3] || 0);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 3600 + min * 60 + sec;
}

function nowIstSecondsOfDay() {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  return ist.getHours() * 3600 + ist.getMinutes() * 60 + ist.getSeconds();
}

export function isNseBseWindowLive(nseSettings = {}) {
  const startTimeStr = String(nseSettings.nseStartTime || nseSettings.startTime || '').trim();
  const closeTimeStr = String(nseSettings.nseClosingTime || nseSettings.closingTime || '').trim();
  if (!startTimeStr && !closeTimeStr) return true;

  const now = nowIstSecondsOfDay();
  const startSec = startTimeStr ? clockToIstSeconds(startTimeStr) : null;
  const closeSec = closeTimeStr ? clockToIstSeconds(closeTimeStr) : null;

  if (startSec != null && now < startSec) return false;
  if (closeSec != null && now >= closeSec) return false;
  return true;
}

export function isNseBseSegmentRow(row = {}) {
  const ex = String(row.exchange || '').toUpperCase();
  const seg = String(row.segment || '').toUpperCase();
  return (
    ['NSE', 'NFO', 'BSE', 'BFO'].includes(ex) ||
    ['NSEFUT', 'NSEOPT', 'NSE-EQ', 'BSE-FUT', 'BSE-OPT'].includes(seg)
  );
}

export function formatNseBseSessionRange(nseSettings = {}) {
  const startTimeStr = String(nseSettings.nseStartTime || nseSettings.startTime || '').trim();
  const closeTimeStr = String(nseSettings.nseClosingTime || nseSettings.closingTime || '').trim();
  if (!startTimeStr || !closeTimeStr) return null;
  const fmt = (s) => {
    const p = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!p) return s.substring(0, 8);
    const h = Number(p[1]);
    const m = String(p[2]).padStart(2, '0');
    const sec = String(p[3] || '0').padStart(2, '0');
    const h12 = h % 12 || 12;
    const ampm = h >= 12 ? 'pm' : 'am';
    return `${h12}:${m}:${sec} ${ampm}`;
  };
  return `${fmt(startTimeStr)} - ${fmt(closeTimeStr)} IST`;
}
