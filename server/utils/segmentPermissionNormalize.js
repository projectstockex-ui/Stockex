/**
 * Normalize segment permission payloads from clients before Mongoose save.
 * Maps legacy `quantitySettings` fields into `quantityModeSettings` so values persist.
 */

const QTY_MODE_FIELDS = [
  'intradayLeverage',
  'carryForwardLeverage',
  'maxQuantity',
  'minQuantity',
  'breakupQuantity',
  'notificationPercent',
  'autosquarePercent',
];

export function coalesceSegmentPermissionSlice(seg) {
  if (!seg || typeof seg !== 'object') return seg;
  const out = { ...seg };
  const qs = out.quantitySettings;
  if (qs && typeof qs === 'object') {
    const qm =
      out.quantityModeSettings && typeof out.quantityModeSettings === 'object'
        ? { ...out.quantityModeSettings }
        : {};
    for (const k of QTY_MODE_FIELDS) {
      if (qs[k] !== undefined && qs[k] !== null && qm[k] === undefined) {
        qm[k] = qs[k];
      }
    }
    out.quantityModeSettings = qm;
  }
  return out;
}

export function normalizeSegmentPermissionsPayload(plain) {
  if (!plain || typeof plain !== 'object') return plain;
  const out = {};
  for (const [seg, segData] of Object.entries(plain)) {
    out[seg] = coalesceSegmentPermissionSlice(segData);
  }
  return out;
}
