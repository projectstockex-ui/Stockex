/**
 * Super Admin: limit when an instrument appears on the user trading panel.
 * Null = no limit on that side.
 */

/** True only for real calendar dates (rejects e.g. 2026-06-31). */
export function isValidCalendarDateString(yyyyMmDd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(yyyyMmDd || ''))) return false;
  const [y, m, d] = String(yyyyMmDd).split('-').map(Number);
  const probe = new Date(y, m - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

/** Store/read panel dates as YYYY-MM-DD in segment summary. */
export function panelDateToStorageString(raw) {
  if (raw === '' || raw == null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return isValidCalendarDateString(s) ? s : null;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const normalized = d.toISOString().slice(0, 10);
  return isValidCalendarDateString(normalized) ? normalized : null;
}

export function parseTradingPanelDateStart(raw) {
  if (raw === '' || raw == null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    if (!isValidCalendarDateString(s)) {
      throw new Error(`Invalid panel start date: ${s}`);
    }
    return new Date(`${s}T00:00:00.000`);
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

export function parseTradingPanelDateEnd(raw) {
  if (raw === '' || raw == null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    if (!isValidCalendarDateString(s)) {
      throw new Error(`Invalid panel end date: ${s} (check month days — e.g. June has 30 days)`);
    }
    return new Date(`${s}T23:59:59.999`);
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(23, 59, 59, 999);
  return d;
}

export function applyTradingPanelVisibilityToQuery(query, now = new Date()) {
  if (!query.$and) query.$and = [];
  query.$and.push({
    $or: [
      { tradingPanelVisibleFrom: null },
      { tradingPanelVisibleFrom: { $exists: false } },
      { tradingPanelVisibleFrom: { $lte: now } },
    ],
  });
  query.$and.push({
    $or: [
      { tradingPanelVisibleUntil: null },
      { tradingPanelVisibleUntil: { $exists: false } },
      { tradingPanelVisibleUntil: { $gte: now } },
    ],
  });
  return query;
}

export function sanitizeTradingPanelVisibilityBody(body) {
  const out = {};
  if (Object.prototype.hasOwnProperty.call(body, 'tradingPanelVisibleFrom')) {
    out.tradingPanelVisibleFrom = parseTradingPanelDateStart(body.tradingPanelVisibleFrom);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'tradingPanelVisibleUntil')) {
    out.tradingPanelVisibleUntil = parseTradingPanelDateEnd(body.tradingPanelVisibleUntil);
  }
  if (
    out.tradingPanelVisibleFrom &&
    out.tradingPanelVisibleUntil &&
    out.tradingPanelVisibleFrom.getTime() > out.tradingPanelVisibleUntil.getTime()
  ) {
    throw new Error('Panel start date must be on or before panel end date');
  }
  return out;
}
