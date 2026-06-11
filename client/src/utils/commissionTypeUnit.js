/**
 * Client-side commission type helpers (must match server/utils/commissionTypeUnit.js).
 * All commission types use Stockex coins as the unit.
 */

import { CURRENCY_SHORT } from './stockexCoins.js';

export function requiredUnitForCommissionType() {
  return 'COINS';
}

/** Label for the numeric commission field. */
export function commissionAmountLabel(commissionType) {
  switch (commissionType) {
    case 'PER_LOT':
      return `Brokerage (${CURRENCY_SHORT} / lot)`;
    case 'PER_CRORE':
      return `Brokerage (${CURRENCY_SHORT} / crore)`;
    case 'PER_TRADE':
      return `Brokerage (${CURRENCY_SHORT} / trade)`;
    case 'PER_QUANTITY':
      return `Brokerage (${CURRENCY_SHORT} / qty)`;
    default:
      return `Amount (${CURRENCY_SHORT})`;
  }
}

export function commissionHelperText(commissionType) {
  switch (commissionType) {
    case 'PER_LOT':
      return `Enter amount per lot (e.g. 10, 20)`;
    case 'PER_QUANTITY':
      return `Charge per quantity (${CURRENCY_SHORT})`;
    case 'PER_TRADE':
      return 'Flat fee per trade';
    case 'PER_CRORE':
      return `${CURRENCY_SHORT} per crore turnover`;
    default:
      return '';
  }
}

export function unitOptionsForCommissionType() {
  return [{ value: 'COINS', label: '◉' }];
}
