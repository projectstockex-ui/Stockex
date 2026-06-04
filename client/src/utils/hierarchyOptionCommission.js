/**
 * Option Buy/Sell brokerage hierarchy (client): child >= parent floor.
 * Commission 0 in templates = unset, not an explicit below-parent rate.
 */

export function parseCommissionNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function isExplicitOptionCommission(value) {
  const n = parseCommissionNumber(value);
  return n !== null && n > 0;
}

export function clampOptionCommissionToParentFloor(childOpt, parentOpt) {
  if (!childOpt || typeof childOpt !== 'object') return childOpt;
  if (!parentOpt || typeof parentOpt !== 'object') return childOpt;

  const parentNum = parseCommissionNumber(parentOpt.commission);
  if (parentNum === null || parentNum <= 0) return childOpt;

  const childNum = parseCommissionNumber(childOpt.commission);
  if (childNum !== null && childNum > 0) return childOpt;

  return { ...childOpt, commission: parentNum };
}

export function clampSegmentPermissionsOptionCommissions(segDefs, parentBaseline) {
  if (!segDefs || typeof segDefs !== 'object') return segDefs;
  const parent = parentBaseline && typeof parentBaseline === 'object' ? parentBaseline : {};
  const out = { ...segDefs };

  for (const seg of Object.keys(out)) {
    const parentSeg = parent[seg];
    if (!parentSeg || typeof parentSeg !== 'object') continue;
    const segSlice = { ...out[seg] };
    let changed = false;

    for (const key of ['optionBuy', 'optionSell']) {
      if (!segSlice[key] || !parentSeg[key]) continue;
      const clamped = clampOptionCommissionToParentFloor(segSlice[key], parentSeg[key]);
      if (clamped !== segSlice[key]) {
        segSlice[key] = clamped;
        changed = true;
      }
    }

    if (changed) out[seg] = segSlice;
  }

  return out;
}

export function optionCommissionBelowParent(value, parentValue) {
  const parentNum = parseCommissionNumber(parentValue);
  if (parentNum === null || parentNum <= 0) return false;
  const childNum = parseCommissionNumber(value);
  if (childNum === null || childNum === 0) return false;
  return childNum < parentNum;
}
