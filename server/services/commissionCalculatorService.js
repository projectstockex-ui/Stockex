/**
 * Modular commission calculation from a stacked config (per lot, per trade, per crore).
 *
 * PER_LOT / PER_TRADE: fixed INR amounts.
 * PER_CRORE: percentage-style rate combined with turnover expressed in crores (see calculatePerCroreCharge).
 */

/** Indian numbering: one crore = 10 million. */
export const ONE_CRORE = 10_000_000;

/** Default guardrails (tune via options.limits if needed). */
export const DEFAULT_COMMISSION_LIMITS = {
  /** Reject PER_CRORE `amount` above this (e.g. 89% flagged as unrealistic). */
  maxPerCrorePercent: 25,
  /** Reject flat lines above this INR (catches mistaken “percentage” inputs). */
  maxFlatInr: 5_000_000,
  maxLots: 1_000_000,
  maxTradeValue: 1e15,
};

const VALID_TYPES = new Set(['PER_LOT', 'PER_TRADE', 'PER_CRORE']);

/**
 * PER_CRORE charge.
 *
 * Spec (this project): charge = (tradeValue / ONE_CRORE) * amount
 * where `amount` is treated as a **percentage-style figure** (validated 0…maxPerCrorePercent).
 * That yields rupees proportional to “how many crores” of notional, scaled by `amount`.
 *
 * If you instead need “percent of full notional”, pass options.perCroreMode === 'percentOfNotional'
 * → charge = tradeValue * (amount / 100).
 */
export function calculatePerCroreCharge(tradeValue, percentageAmount, options = {}) {
  const tv = Number(tradeValue);
  if (!Number.isFinite(tv) || tv < 0) return 0;
  const p = Number(percentageAmount);
  if (!Number.isFinite(p) || p <= 0) return 0;

  const mode = options.perCroreMode || 'croreFractionTimesRate';
  if (mode === 'percentOfNotional') {
    return tv * (p / 100);
  }
  // Default: matches user doc — (tradeValue / 1e7) * percentage
  return (tv / ONE_CRORE) * p;
}

/**
 * @typedef {Object} CommissionLineInput
 * @property {'PER_LOT'|'PER_TRADE'|'PER_CRORE'} type
 * @property {number} amount
 * @property {boolean} [enabled] — default true when omitted
 * @property {'INR'|'PERCENT'} [unit] — PER_LOT/PER_TRADE must not be PERCENT; PER_CRORE must be PERCENT (or omitted = PERCENT)
 */

/**
 * Validate payload; returns { ok, errors } without throwing.
 * @param {object} data
 * @param {CommissionLineInput[]} data.commissionConfig
 * @param {object} [limits]
 */
export function validateCommissionInput(data, limits = DEFAULT_COMMISSION_LIMITS) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    errors.push('Input must be a non-null object');
    return { ok: false, errors };
  }

  const lots = Number(data.lots);
  if (!Number.isFinite(lots) || lots < 0) {
    errors.push(`Invalid lots: expected finite number >= 0, got ${data.lots}`);
  } else if (lots > limits.maxLots) {
    errors.push(`lots exceeds maximum allowed (${limits.maxLots})`);
  }

  const tradeValue = Number(data.tradeValue);
  if (!Number.isFinite(tradeValue) || tradeValue < 0) {
    errors.push(`Invalid tradeValue: expected finite number >= 0, got ${data.tradeValue}`);
  } else if (tradeValue > limits.maxTradeValue) {
    errors.push('tradeValue exceeds maximum allowed');
  }

  const cfg = data.commissionConfig;
  if (!Array.isArray(cfg)) {
    errors.push('commissionConfig must be an array');
    return { ok: false, errors };
  }

  cfg.forEach((line, i) => {
    const prefix = `commissionConfig[${i}]`;
    if (!line || typeof line !== 'object') {
      errors.push(`${prefix}: must be an object`);
      return;
    }
    const type = line.type;
    if (!VALID_TYPES.has(type)) {
      errors.push(`${prefix}.type must be PER_LOT, PER_TRADE, or PER_CRORE (got ${String(type)})`);
    }

    const amount = Number(line.amount);
    if (!Number.isFinite(amount)) {
      errors.push(`${prefix}.amount must be a finite number`);
    } else if (amount < 0) {
      errors.push(`${prefix}.amount cannot be negative`);
    }

    const unit = line.unit == null ? null : String(line.unit).toUpperCase();
    if (unit != null && unit !== 'INR' && unit !== 'PERCENT') {
      errors.push(`${prefix}.unit must be INR, PERCENT, or omitted`);
    }

    if (type === 'PER_LOT' || type === 'PER_TRADE') {
      // Reject explicit percentage unit on flat-INR lines
      if (unit === 'PERCENT') {
        errors.push(`${prefix}: PER_${type === 'PER_LOT' ? 'LOT' : 'TRADE'} cannot use unit PERCENT (fixed  only)`);
      }
      if (Number.isFinite(amount) && amount > limits.maxFlatInr) {
        errors.push(`${prefix}.amount unrealistically high for fixed  line (max ${limits.maxFlatInr})`);
      }
    }

    if (type === 'PER_CRORE') {
      if (unit === 'INR') {
        errors.push(`${prefix}: PER_CRORE accepts percentage values only (do not set unit INR)`);
      }
      if (Number.isFinite(amount) && amount > limits.maxPerCrorePercent) {
        errors.push(
          `${prefix}.amount too high for PER_CRORE (max ${limits.maxPerCrorePercent}% — got ${amount})`
        );
      }
    }
  });

  return { ok: errors.length === 0, errors };
}

/**
 * Sum enabled commission lines.
 *
 * @param {{
 *   lots: number,
 *   tradeValue: number,
 *   commissionConfig: CommissionLineInput[]
 * }} data
 * @param {{
 *   limits?: typeof DEFAULT_COMMISSION_LIMITS,
 *   perCroreMode?: 'croreFractionTimesRate' | 'percentOfNotional',
 *   strict?: boolean
 * }} [options]
 * @returns {{
 *   success: boolean,
 *   total: number,
 *   breakdown: Array<{
 *     type: string,
 *     enabled: boolean,
 *     inputAmount: number,
 *     charge: number,
 *     skippedReason?: string
 *   }>,
 *   errors?: string[]
 * }}
 */
export function calculateCommission(data, options = {}) {
  const limits = { ...DEFAULT_COMMISSION_LIMITS, ...(options.limits || {}) };
  const perCroreMode = options.perCroreMode === 'percentOfNotional' ? 'percentOfNotional' : 'croreFractionTimesRate';

  const validation = validateCommissionInput(data, limits);
  if (!validation.ok) {
    const payload = {
      success: false,
      total: 0,
      breakdown: [],
      errors: validation.errors,
    };
    if (options.strict) {
      const err = new Error(validation.errors.join('; '));
      err.name = 'CommissionValidationError';
      err.errors = validation.errors;
      throw err;
    }
    return payload;
  }

  const lots = Number(data.lots);
  const tradeValue = Number(data.tradeValue);
  const cfg = data.commissionConfig;

  const breakdown = [];
  let total = 0;

  for (let i = 0; i < cfg.length; i++) {
    const line = cfg[i];
    const enabled = line.enabled !== false;
    const amount = Number(line.amount);
    const type = line.type;

    if (!enabled) {
      breakdown.push({
        type,
        enabled: false,
        inputAmount: amount,
        charge: 0,
        skippedReason: 'disabled',
      });
      continue;
    }

    if (!Number.isFinite(amount) || amount < 0) {
      breakdown.push({
        type,
        enabled: true,
        inputAmount: amount,
        charge: 0,
        skippedReason: 'invalid_amount',
      });
      continue;
    }

    let charge = 0;
    if (type === 'PER_LOT') {
      // charge = numberOfLots * amount (fixed  per lot)
      charge = lots * amount;
    } else if (type === 'PER_TRADE') {
      // charge = flat  per executed trade
      charge = amount;
    } else if (type === 'PER_CRORE') {
      charge = calculatePerCroreCharge(tradeValue, amount, { perCroreMode });
    }

    charge = Math.round(charge * 100) / 100;
    total += charge;
    breakdown.push({
      type,
      enabled: true,
      inputAmount: amount,
      charge,
    });
  }

  total = Math.round(total * 100) / 100;

  return {
    success: true,
    total,
    breakdown,
  };
}

export default {
  ONE_CRORE,
  DEFAULT_COMMISSION_LIMITS,
  calculatePerCroreCharge,
  validateCommissionInput,
  calculateCommission,
};
