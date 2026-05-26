/**
 * Client-side commission type helpers (must match server/utils/commissionTypeUnit.js).
 * All commission types use ₹ (INR) as the unit.
 * PER_CRORE = ₹ per crore turnover (not percentage).
 */

export function requiredUnitForCommissionType(commissionType) {
  return 'INR';
}

/** Label for the numeric commission field. */
export function commissionAmountLabel(commissionType) {
  switch (commissionType) {
    case 'PER_LOT':
      return 'Brokerage (₹ / lot)';
    case 'PER_CRORE':
      return 'Brokerage (₹ / crore)';
    case 'PER_TRADE':
      return 'Brokerage (₹ / trade)';
    case 'PER_QUANTITY':
      return 'Brokerage (₹ / qty)';
    default:
      return 'Amount (₹)';
  }
}

export function commissionHelperText(commissionType) {
  switch (commissionType) {
    case 'PER_LOT':
    case 'PER_QUANTITY':
      return 'Charge per quantity (₹)';
    case 'PER_TRADE':
      return 'Flat fee per trade';
    case 'PER_CRORE':
      return '₹ per crore turnover';
    default:
      return '';
  }
}

/** Read-only options for UX: only INR is valid now. */
export function unitOptionsForCommissionType(commissionType) {
  return [{ value: 'INR', label: 'Rupees (₹)' }];
}
