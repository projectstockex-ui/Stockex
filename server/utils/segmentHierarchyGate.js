/**
 * Hierarchy gate: an admin may only enable segments they themselves have enabled,
 * and may not relax intraday-only restrictions imposed by their parent.
 */

export function plainSegmentPermissionsMap(segmentPermissions) {
  if (!segmentPermissions) return {};
  if (segmentPermissions instanceof Map) return Object.fromEntries(segmentPermissions);
  return typeof segmentPermissions === 'object' ? segmentPermissions : {};
}

export function isSegmentEnabledInPermissions(segmentPermissions, segmentName) {
  const plain = plainSegmentPermissionsMap(segmentPermissions);
  const seg = plain[segmentName];
  return seg?.enabled === true;
}

export function isParentIntradayOnlyLocked(parentSeg) {
  return parentSeg?.defaultIntradayOnly === true;
}

export function validateEditorCanEnableSegmentForChild(editorPermissions, segmentName, requestingEnabled, editorRole) {
  if (requestingEnabled !== true) return { allowed: true };
  if (editorRole === 'SUPER_ADMIN') return { allowed: true };
  if (!isSegmentEnabledInPermissions(editorPermissions, segmentName)) {
    return {
      allowed: false,
      message: `Cannot enable ${segmentName} - you do not have this segment enabled. Enable it for yourself first.`,
    };
  }
  return { allowed: true };
}

export function validateEditorCanSetDefaultIntradayOnly(parentSeg, requestingValue, editorRole) {
  if (editorRole === 'SUPER_ADMIN') return { allowed: true };
  if (isParentIntradayOnlyLocked(parentSeg) && requestingValue !== true) {
    return {
      allowed: false,
      message: 'Cannot disable intraday-only — your parent has restricted this segment to intraday-only trading.',
    };
  }
  return { allowed: true };
}

export function validateEditorCanEnableLotQtyMode(parentSeg, field, requestingEnabled, editorRole) {
  if (requestingEnabled !== true) return { allowed: true };
  if (editorRole === 'SUPER_ADMIN') return { allowed: true };

  if (field === 'enableLotSettings' || field === 'enableQuantitySettings') {
    if (isParentIntradayOnlyLocked(parentSeg)) {
      return {
        allowed: false,
        message: 'Lot and Quantity settings are not available — your parent has restricted this segment to intraday-only.',
      };
    }
    if (parentSeg?.[field] === false) {
      const label = field === 'enableLotSettings' ? 'Lot' : 'Quantity';
      return {
        allowed: false,
        message: `You don't have permission to enable ${label} settings. Your parent has disabled it.`,
      };
    }
  }

  return { allowed: true };
}

export function enforceIntradayOnlyHierarchyOnSegment(parentSeg, childSeg, editorRole) {
  if (editorRole === 'SUPER_ADMIN' || !childSeg || typeof childSeg !== 'object') return childSeg;
  if (!isParentIntradayOnlyLocked(parentSeg)) return childSeg;

  return {
    ...childSeg,
    defaultIntradayOnly: true,
    enableLotSettings: false,
    enableQuantitySettings: false,
  };
}

export function validateSegmentIntradayOnlyHierarchy(parentSeg, segData, editorRole) {
  if (!segData || typeof segData !== 'object') return { allowed: true };
  if (editorRole === 'SUPER_ADMIN') return { allowed: true };

  const intradayCheck = validateEditorCanSetDefaultIntradayOnly(
    parentSeg,
    segData.defaultIntradayOnly,
    editorRole
  );
  if (!intradayCheck.allowed) return intradayCheck;

  for (const field of ['enableLotSettings', 'enableQuantitySettings']) {
    const lotQtyCheck = validateEditorCanEnableLotQtyMode(parentSeg, field, segData[field], editorRole);
    if (!lotQtyCheck.allowed) return lotQtyCheck;
  }

  return { allowed: true };
}
