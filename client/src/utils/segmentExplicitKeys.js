/** Compare segment slice field values (handles nested optionBuy / optionSell). */
export function segmentFieldValuesEqual(a, b) {
  if (a === b) return true;
  if (a != null && typeof a === 'object' && b != null && typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Per segment, top-level keys whose values differ from Super Admin `adminSegmentDefaults`.
 * Handles nested objects by checking if they differ at the top level.
 * For nested objects like lotSettings, always include them if they exist in current data.
 */
export function computeSegmentExplicitKeys(segDefs, systemDefaultsPlain, editorRole) {
  const isSuperAdmin = editorRole === 'SUPER_ADMIN';
  const sys = systemDefaultsPlain || {};
  const out = {};
  for (const seg of Object.keys(segDefs || {})) {
    const cur = segDefs[seg] || {};
    const defSeg = sys[seg] || {};
    const keys = [];
    for (const k of Object.keys(cur)) {
      // Always include nested objects (lotSettings, quantityModeSettings, etc.) if they exist
      if (k === 'lotSettings' || k === 'quantityModeSettings' || k === 'optionBuy' || k === 'optionSell') {
        keys.push(k);
      } else if (!segmentFieldValuesEqual(cur[k], defSeg[k])) {
        keys.push(k);
      }
    }
    // Brokerage 0 is valid — when present in payload, treat as intentional (not inherit parent/system).
    for (const bk of ['commission', 'commissionLot', 'commissionType']) {
      if (Object.prototype.hasOwnProperty.call(cur, bk) && !keys.includes(bk)) {
        keys.push(bk);
      }
    }
    // Session timing must flow to child users via segmentExplicitKeys on parent admin saves (Super Admin only for MCX)
    if (isSuperAdmin) {
      for (const tk of [
        'mcxStartTime',
        'mcxClosingTime',
        'nseStartTime',
        'nseClosingTime',
        'cryptoStartTime',
        'cryptoClosingTime',
        'closingTime',
        'startTime',
      ]) {
        const v = cur[tk];
        if (v != null && String(v).trim() !== '' && !keys.includes(tk)) {
          keys.push(tk);
        }
      }
    } else {
      for (const tk of ['cryptoStartTime', 'cryptoClosingTime']) {
        const v = cur[tk];
        if (v != null && String(v).trim() !== '' && !keys.includes(tk)) {
          keys.push(tk);
        }
      }
    }
    const mcxKeys = ['mcxStartTime', 'mcxClosingTime', 'startTime', 'closingTime'];
    const nseKeys = ['nseStartTime', 'nseClosingTime'];
    out[seg] = isSuperAdmin ? keys : keys.filter((k) => !mcxKeys.includes(k) && !nseKeys.includes(k));
  }
  return out;
}
