/**
 * Segment brokerage helpers — types/amounts from saved settings & baselines only.
 */

export const SEGMENT_COMMISSION_TYPE_OPTIONS = [
  { value: 'PER_LOT', label: 'Per Lot' },
  { value: 'PER_CRORE', label: 'Per Crore' },
  { value: 'PER_TRADE', label: 'Per Trade' },
  { value: 'PER_QUANTITY', label: 'Per Quantity' },
];

export function resolveSegmentCommissionType(...typeSources) {
  for (const t of typeSources) {
    if (t != null && String(t).trim() !== '') return String(t);
  }
  return '';
}

export function segmentCommissionAmountField(commissionType) {
  return commissionType === 'PER_CRORE' || commissionType === 'PER_TRADE' ? 'commission' : 'commissionLot';
}

export function segmentCommissionAmountValue(slice, commissionType) {
  const type = commissionType || '';
  if (type === 'PER_CRORE' || type === 'PER_TRADE') {
    return Number(slice?.commission) || 0;
  }
  return Number(slice?.commissionLot) || 0;
}

/** Only fills missing commission type / amount field mapping — does not inject numeric defaults. */
export function normalizeSegmentCommissionFields(slice = {}, baseline = null) {
  const base = baseline && typeof baseline === 'object' ? baseline : {};
  const commissionType = resolveSegmentCommissionType(slice.commissionType, base.commissionType);
  const next = { ...slice };
  if (commissionType) {
    next.commissionType = commissionType;
    next.commissionUnit = 'INR';
    if (commissionType === 'PER_CRORE' || commissionType === 'PER_TRADE') {
      if (
        (next.commission == null || next.commission === '') &&
        Number(next.commissionLot) > 0
      ) {
        next.commission = next.commissionLot;
      }
    } else if (commissionType === 'PER_LOT' || commissionType === 'PER_QUANTITY') {
      if (
        (next.commissionLot == null || next.commissionLot === '') &&
        Number(next.commission) > 0
      ) {
        next.commissionLot = next.commission;
      }
    }
  }
  return next;
}
