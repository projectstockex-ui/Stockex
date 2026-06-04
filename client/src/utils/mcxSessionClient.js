/** Client-side MCX session window (matches server merged MCXFUT timing). */

export function isMcxWindowLive(mcxSettings = {}) {
  const startTimeStr = String(mcxSettings.mcxStartTime || mcxSettings.startTime || '').trim();
  const closeTimeStr = String(mcxSettings.mcxClosingTime || mcxSettings.closingTime || '').trim();
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

export function formatMcxSessionRange(mcxSettings = {}) {
  const startTimeStr = String(mcxSettings.mcxStartTime || mcxSettings.startTime || '').trim();
  const closeTimeStr = String(mcxSettings.mcxClosingTime || mcxSettings.closingTime || '').trim();
  if (!startTimeStr || !closeTimeStr) return null;
  const start = startTimeStr.substring(0, 5);
  const end = closeTimeStr.substring(0, 5);
  return `${start} - ${end} IST`;
}
