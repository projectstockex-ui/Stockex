/**
 * Segment settings inputs: show empty when unset — no placeholder numbers like 1 or 50.
 */

export function numInputValue(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (Number.isNaN(n)) return '';
  return n;
}

/** Parse number input; empty string → undefined (field unset / clearable). */
export function parseNumInput(raw) {
  if (raw === '' || raw === null || raw === undefined) return undefined;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (Number.isNaN(n)) return undefined;
  return n;
}

export function intInputValue(value) {
  return numInputValue(value);
}

export function parseIntInput(raw) {
  if (raw === '' || raw === null || raw === undefined) return undefined;
  const n = parseInt(String(raw), 10);
  if (Number.isNaN(n)) return undefined;
  return n;
}

/** Like parseNumInput but clamps to ≥ 0 when set (spreads, fees). Cleared → undefined. */
export function parseNonNegativeNumInput(raw) {
  const v = parseNumInput(raw);
  if (v === undefined) return undefined;
  return Math.max(0, v);
}

/** Patch segment slice; `undefined` clears the field (no fallback on re-render). */
export function patchSegmentField(slice, field, value) {
  const next = { ...(slice || {}) };
  if (field.includes('.')) {
    const [parent, child] = field.split('.');
    const parentObj = { ...(next[parent] || {}) };
    if (value === undefined) {
      delete parentObj[child];
    } else {
      parentObj[child] = value;
    }
    if (Object.keys(parentObj).length === 0) {
      delete next[parent];
    } else {
      next[parent] = parentObj;
    }
  } else if (value === undefined) {
    delete next[field];
  } else {
    next[field] = value;
  }

  const ct = next.commissionType;
  if (ct === 'PER_CRORE' || ct === 'PER_TRADE') {
    if (field === 'commissionLot' && value !== undefined) {
      next.commission = value;
    } else if (field === 'commission' && value !== undefined) {
      next.commissionLot = value;
    }
  }

  return next;
}
