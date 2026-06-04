/**
 * Option Buy/Sell brokerage hierarchy: child rate must be >= parent floor.
 * Template/default commission 0 means "unset" — not an explicit below-parent rate.
 */

export function parseCommissionNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** True when user explicitly set a positive brokerage amount. */
export function isExplicitOptionCommission(value) {
  const n = parseCommissionNumber(value);
  return n !== null && n > 0;
}

/**
 * Clamp unset/zero child commission to parent floor before save.
 * @returns {Record<string, unknown>|undefined}
 */
export function clampOptionCommissionToParentFloor(childOpt, parentOpt) {
  if (!childOpt || typeof childOpt !== 'object') return childOpt;
  if (!parentOpt || typeof parentOpt !== 'object') return childOpt;

  const parentNum = parseCommissionNumber(parentOpt.commission);
  if (parentNum === null || parentNum <= 0) return childOpt;

  const childNum = parseCommissionNumber(childOpt.commission);
  if (childNum !== null && childNum > 0) return childOpt;

  return { ...childOpt, commission: parentNum };
}

/**
 * @returns {string|null} Error message when child is explicitly below parent floor.
 */
export function optionCommissionHierarchyError(childCommission, parentCommission, optionLabel, segName) {
  const parentNum = parseCommissionNumber(parentCommission);
  if (parentNum === null || parentNum <= 0) return null;

  const childNum = parseCommissionNumber(childCommission);
  if (childNum === null || childNum === 0) return null;
  if (childNum >= parentNum) return null;

  return `${segName} ${optionLabel} Brokerage must be at least ${parentNum} (same as or higher than your parent setting). You entered ${childNum}.`;
}
