/**
 * Commission type helpers.
 * All commission types use ₹ (INR) as the unit.
 * PER_CRORE = ₹ per crore turnover (not percentage).
 */

export const COMMISSION_TYPES = ['PER_LOT', 'PER_QUANTITY', 'PER_TRADE', 'PER_CRORE'];

/** All commission types use INR — no PERCENT mode. */
export function requiredUnitForCommissionType(commissionType) {
  return 'INR';
}

/**
 * @param {'PER_LOT'|'PER_QUANTITY'|'PER_TRADE'|'PER_CRORE'} commissionType
 * @param {'INR'|'PERCENT'|null} unit
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateCommissionTypeUnit(commissionType, unit) {
  // All types are INR now, accept anything
  return { ok: true };
}

export function assertValidCommissionTypeUnit(commissionType, unit) {
  // No-op: all units are valid (INR-based)
}

/**
 * Ensures segment slice has commissionUnit set to INR.
 * @param {Record<string, unknown>} seg
 * @returns {Record<string, unknown>}
 */
export function withAlignedSegmentCommissionUnit(seg) {
  if (!seg || typeof seg !== 'object') return seg;
  const out = { ...seg };
  out.commissionUnit = 'INR';
  for (const key of ['optionBuy', 'optionSell']) {
    if (out[key] && typeof out[key] === 'object') {
      const opt = { ...out[key] };
      opt.commissionUnit = 'INR';
      out[key] = opt;
    }
  }
  return out;
}

/**
 * When Brokers/Sub Brokers save segment maps, preserve `allowLimitPendingOrders` from existing DB rows
 * so UI-hidden fields cannot overwrite Admin-set values.
 */
export function preserveAllowLimitPendingOrdersFromExisting(incomingPlain, existingPlain) {
  if (!incomingPlain || typeof incomingPlain !== 'object') return incomingPlain;
  const ex =
    !existingPlain
      ? {}
      : existingPlain instanceof Map
        ? Object.fromEntries(existingPlain)
        : typeof existingPlain === 'object' && typeof existingPlain.toObject === 'function'
          ? existingPlain.toObject()
          : { ...existingPlain };
  const out = { ...incomingPlain };
  for (const seg of Object.keys(out)) {
    if (!out[seg] || typeof out[seg] !== 'object') continue;
    out[seg] = { ...out[seg] };
    if (ex[seg] && Object.prototype.hasOwnProperty.call(ex[seg], 'allowLimitPendingOrders')) {
      out[seg].allowLimitPendingOrders = ex[seg].allowLimitPendingOrders;
    } else {
      delete out[seg].allowLimitPendingOrders;
    }
  }
  return out;
}

/**
 * Convert Mongoose Map / hydrated subdocs into plain POJO slices so merges keep nested fields (e.g. cryptoSpreadUsdPerSide).
 */
export function plainSegmentDefaultsMap(val) {
  if (!val || typeof val !== 'object') return {};
  const obj = val instanceof Map ? Object.fromEntries(val) : { ...val };
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || typeof v !== 'object') continue;
    try {
      out[k] = JSON.parse(JSON.stringify(v));
    } catch {
      out[k] = { ...v };
    }
  }
  return out;
}

/** Client payload → DB-safe segmentExplicitKeys. `undefined` means omit field (no update). */
export function sanitizeSegmentExplicitKeysForSave(raw) {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== 'object') return undefined;
  const plain = raw instanceof Map ? Object.fromEntries(raw) : raw;
  const out = {};
  for (const [seg, keys] of Object.entries(plain)) {
    if (!Array.isArray(keys)) continue;
    out[seg] = keys.filter((k) => typeof k === 'string' && k.length > 0);
  }
  return out;
}

/** PER_CRORE / PER_TRADE use `commission`; PER_LOT / PER_QUANTITY use `commissionLot`. Keep both in sync — 0 is valid. */
export function syncSegmentCommissionFields(segData) {
  if (!segData || typeof segData !== 'object') return segData;
  const type = segData.commissionType;
  const hasLot = Object.prototype.hasOwnProperty.call(segData, 'commissionLot');
  const hasComm = Object.prototype.hasOwnProperty.call(segData, 'commission');

  const readNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  };

  if (type === 'PER_CRORE' || type === 'PER_TRADE') {
    // UI edits `commission` for these types — prefer it over stale `commissionLot`.
    if (hasComm) {
      const n = readNum(segData.commission);
      segData.commission = n;
      segData.commissionLot = n;
    } else if (hasLot) {
      const n = readNum(segData.commissionLot);
      segData.commission = n;
      segData.commissionLot = n;
    }
  } else if (type === 'PER_LOT' || type === 'PER_QUANTITY') {
    if (hasLot) {
      const n = readNum(segData.commissionLot);
      segData.commissionLot = n;
      segData.commission = n;
    } else if (hasComm) {
      const n = readNum(segData.commission);
      segData.commission = n;
      segData.commissionLot = n;
    }
  }
  return segData;
}

export function syncSegmentCommissionMap(plain) {
  if (!plain || typeof plain !== 'object') return plain;
  for (const segData of Object.values(plain)) {
    syncSegmentCommissionFields(segData);
  }
  return plain;
}

/** True when explicit keys list includes brokerage fields (user/admin intentionally set them). */
export function explicitKeysTouchCommission(explicitKeysMaybe) {
  return (
    Array.isArray(explicitKeysMaybe) &&
    (explicitKeysMaybe.includes('commission') ||
      explicitKeysMaybe.includes('commissionLot') ||
      explicitKeysMaybe.includes('commissionType'))
  );
}

/**
 * Walk segment map and sync commission fields before persistence.
 */
export function alignSegmentDefaultsMap(segmentDefaults) {
  if (!segmentDefaults || typeof segmentDefaults !== 'object') return segmentDefaults;
  const out = { ...segmentDefaults };
  for (const k of Object.keys(out)) {
    if (out[k] && typeof out[k] === 'object') {
      out[k] = syncSegmentCommissionFields(
        withAlignedSegmentCommissionUnit(normalizeLegacySystemSegmentDefaultsSlice(k, out[k]))
      );
    }
  }
  return out;
}

const SESSION_TIMING_KEYS = [
  'cryptoStartTime',
  'cryptoClosingTime',
  'mcxStartTime',
  'mcxClosingTime',
  'startTime',
  'closingTime',
];

/** alignSegmentDefaultsMap + re-apply session timing fields from raw payload (never drop on save). */
export function alignSegmentDefaultsMapPreservingSessionTiming(plain) {
  const aligned = alignSegmentDefaultsMap(plain);
  if (!plain || typeof plain !== 'object') return aligned;
  for (const [segName, segData] of Object.entries(plain)) {
    if (!segData || typeof segData !== 'object') continue;
    for (const tk of SESSION_TIMING_KEYS) {
      if (segData[tk] !== undefined) {
        aligned[segName] = aligned[segName] || {};
        aligned[segName][tk] = segData[tk];
      }
    }
  }
  return aligned;
}

/**
 * Deep-merge two segment-default maps (e.g. existing DB + incoming PUT). Preserves segment keys omitted from the client payload.
 */
export function mergeSegmentDefaultsMaps(existingPlain, incomingPlain) {
  const existing = existingPlain && typeof existingPlain === 'object' ? existingPlain : {};
  const incoming = incomingPlain && typeof incomingPlain === 'object' ? incomingPlain : {};
  const keys = new Set([...Object.keys(existing), ...Object.keys(incoming)]);
  const out = {};
  for (const k of keys) {
    const mergedSlice = {
      ...(existing[k] && typeof existing[k] === 'object' ? existing[k] : {}),
      ...(incoming[k] && typeof incoming[k] === 'object' ? incoming[k] : {}),
    };
    for (const numKey of ['cryptoSpreadUsdPerSide', 'cryptoSpreadInr']) {
      if (mergedSlice[numKey] != null && mergedSlice[numKey] !== '') {
        const n = Number(mergedSlice[numKey]);
        mergedSlice[numKey] = Number.isFinite(n) ? n : 0;
      }
    }
    out[k] = withAlignedSegmentCommissionUnit(normalizeLegacySystemSegmentDefaultsSlice(k, mergedSlice));
  }
  return out;
}

/**
 * Apply crypto spread numbers straight from the raw client map onto merged slices so saves never silently drop them.
 */
export function overlayCryptoSpreadFromRaw(rawPlain, merged) {
  const raw = rawPlain && typeof rawPlain === 'object' ? rawPlain : {};
  const out = merged && typeof merged === 'object' ? { ...merged } : {};
  for (const segKey of Object.keys(raw)) {
    const src = raw[segKey];
    if (!src || typeof src !== 'object') continue;
    const hasUsd = Object.prototype.hasOwnProperty.call(src, 'cryptoSpreadUsdPerSide');
    const hasInr = Object.prototype.hasOwnProperty.call(src, 'cryptoSpreadInr');
    if (!hasUsd && !hasInr) continue;
    const base = out[segKey] && typeof out[segKey] === 'object' ? { ...out[segKey] } : {};
    if (hasUsd) {
      const n = Number(src.cryptoSpreadUsdPerSide);
      base.cryptoSpreadUsdPerSide = Number.isFinite(n) ? Math.max(0, n) : 0;
    }
    if (hasInr) {
      const n = Number(src.cryptoSpreadInr);
      base.cryptoSpreadInr = Number.isFinite(n) ? Math.max(0, n) : 0;
    }
    out[segKey] = withAlignedSegmentCommissionUnit(normalizeLegacySystemSegmentDefaultsSlice(segKey, base));
  }
  return out;
}

/**
 * SystemSettings.segmentDefaults.MCX uses PER_QUANTITY, not PER_LOT. Older DB / clients may send PER_LOT.
 * @param {string} segmentKey - e.g. EQUITY, FNO, MCX
 * @param {Record<string, unknown>} seg
 */
export function normalizeLegacySystemSegmentDefaultsSlice(segmentKey, seg) {
  if (!seg || typeof seg !== 'object') return seg;
  const key = String(segmentKey || '').toUpperCase();
  if (key !== 'MCX') return seg;
  const out = { ...seg };
  const coerce = (ct) => (ct === 'PER_LOT' ? 'PER_QUANTITY' : ct);
  if (out.commissionType) out.commissionType = coerce(out.commissionType);
  for (const opt of ['optionBuy', 'optionSell']) {
    if (out[opt] && typeof out[opt] === 'object' && out[opt].commissionType != null) {
      out[opt] = { ...out[opt], commissionType: coerce(out[opt].commissionType) };
    }
  }
  return out;
}

/**
 * Validate segment permission / segment default object (throws on invalid explicit unit).
 * @param {Record<string, unknown>} seg
 */
export function assertSegmentCommissionUnitsValid(seg) {
  if (!seg || typeof seg !== 'object') return;
  const ct = seg.commissionType || 'PER_LOT';
  const cu = seg.commissionUnit;
  if (cu != null) assertValidCommissionTypeUnit(ct, cu);
  for (const key of ['optionBuy', 'optionSell']) {
    const opt = seg[key];
    if (!opt || typeof opt !== 'object') continue;
    const oct = opt.commissionType || 'PER_LOT';
    const ocu = opt.commissionUnit;
    if (ocu != null) assertValidCommissionTypeUnit(oct, ocu);
  }
}

/**
 * Walk system segmentDefaults or adminSegmentDefaults map.
 * @param {Record<string, Record<string, unknown>>} segmentMap
 */
export function assertSegmentDefaultsCommissionBlocks(segmentMap) {
  if (!segmentMap || typeof segmentMap !== 'object') return;
  for (const segKey of Object.keys(segmentMap)) {
    assertSegmentCommissionUnitsValid(segmentMap[segKey]);
  }
}

/**
 * Normalize instrument tradingDefaults.additionalCharges for persistence.
 * - Forces per-line units: trade & lot = INR, crore = PERCENT.
 * - Rejects explicit wrong pairs.
 * @param {Record<string, unknown>} ch
 * @returns {Record<string, unknown>}
 */
export function sanitizeInstrumentAdditionalCharges(ch) {
  if (!ch || typeof ch !== 'object') return ch;
  const out = { ...ch };

  const coerceLineUnit = (unitKey, logicalCommissionType) => {
    const need = requiredUnitForCommissionType(logicalCommissionType);
    const v = out[unitKey];
    if (v != null && v !== '') {
      assertValidCommissionTypeUnit(logicalCommissionType, v);
    }
    out[unitKey] = need;
  };

  coerceLineUnit('perTradeUnit', 'PER_TRADE');
  coerceLineUnit('perLotUnit', 'PER_LOT');
  coerceLineUnit('perCroreUnit', 'PER_CRORE');

  return out;
}
