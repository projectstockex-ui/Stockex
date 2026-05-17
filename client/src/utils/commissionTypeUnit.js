/**
 * Client-side commission type ↔ unit (must match server/utils/commissionTypeUnit.js).
 */

export function requiredUnitForCommissionType(commissionType) {
  if (commissionType === 'PER_CRORE') return 'PERCENT';
  if (commissionType === 'PER_LOT' || commissionType === 'PER_TRADE') return 'INR';
  return 'INR';
}

/** Label for the numeric commission field. */
export function commissionAmountLabel(commissionType) {
  return 'Amount (₹)';
}

export function commissionHelperText(commissionType) {
  switch (commissionType) {
    case 'PER_LOT':
      return 'Charge per lot (₹)';
    case 'PER_TRADE':
      return 'Flat fee per trade';
    case 'PER_CRORE':
      return 'Percentage of trade value';
    default:
      return '';
  }
}

/** Read-only options for UX: only the valid unit is shown. */
export function unitOptionsForCommissionType(commissionType) {
  const u = requiredUnitForCommissionType(commissionType);
  if (u === 'INR') return [{ value: 'INR', label: 'Rupees (₹)' }];
  return [{ value: 'PERCENT', label: 'Percentage (%)' }];
}
