/**
 * Client-side hierarchy gate for segment enable toggles and intraday-only inheritance.
 */

export function isSegmentEnabledInBaseline(baseline, segment) {
  return baseline?.[segment]?.enabled === true;
}

export function isParentIntradayOnlyLocked(parentBaseline, segment) {
  return parentBaseline?.[segment]?.defaultIntradayOnly === true;
}

export function canViewerEnableSegment(viewerRole, parentBaseline, segment) {
  if (viewerRole === 'SUPER_ADMIN') return true;
  return isSegmentEnabledInBaseline(parentBaseline, segment);
}

export function canViewerToggleDefaultIntradayOnly(viewerRole, parentBaseline, segment) {
  if (viewerRole === 'SUPER_ADMIN') return true;
  return !isParentIntradayOnlyLocked(parentBaseline, segment);
}

export function canViewerManageLotQtySettings(viewerRole, parentBaseline, segment) {
  if (viewerRole === 'SUPER_ADMIN') return true;
  return !isParentIntradayOnlyLocked(parentBaseline, segment);
}

export function clampSegmentEnabledToParentBaseline(segDefs, parentBaseline, viewerRole) {
  if (!segDefs || viewerRole === 'SUPER_ADMIN') return segDefs;
  const parent = parentBaseline && typeof parentBaseline === 'object' ? parentBaseline : {};
  const out = { ...segDefs };

  for (const seg of Object.keys(out)) {
    if (out[seg]?.enabled === true && !isSegmentEnabledInBaseline(parent, seg)) {
      out[seg] = { ...out[seg], enabled: false };
    }
  }

  return out;
}

export function clampSegmentIntradayOnlyToParentBaseline(segDefs, parentBaseline, viewerRole) {
  if (!segDefs || viewerRole === 'SUPER_ADMIN') return segDefs;
  const parent = parentBaseline && typeof parentBaseline === 'object' ? parentBaseline : {};
  const out = { ...segDefs };

  for (const seg of Object.keys(out)) {
    if (!isParentIntradayOnlyLocked(parent, seg)) continue;
    out[seg] = {
      ...out[seg],
      defaultIntradayOnly: true,
      enableLotSettings: false,
      enableQuantitySettings: false,
    };
  }

  return out;
}

export const INTRADAY_ONLY_LOCKED_LOT_QTY_MESSAGE =
  'Lot and Quantity settings are not available — your parent has restricted this segment to intraday-only.';

export const INTRADAY_ONLY_LOCKED_DISABLE_MESSAGE =
  'Cannot disable intraday-only — your parent has restricted this segment to intraday-only trading.';
