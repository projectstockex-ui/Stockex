import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSegmentEnabledInPermissions,
  isParentIntradayOnlyLocked,
  validateEditorCanEnableSegmentForChild,
  validateEditorCanSetDefaultIntradayOnly,
  validateEditorCanEnableLotQtyMode,
  validateSegmentIntradayOnlyHierarchy,
  enforceIntradayOnlyHierarchyOnSegment,
} from '../utils/segmentHierarchyGate.js';

test('validateEditorCanEnableSegmentForChild blocks when editor lacks segment', () => {
  const editorPerms = {
    NSEFUT: { enabled: true },
    MCXOPT: { enabled: false },
  };

  assert.equal(isSegmentEnabledInPermissions(editorPerms, 'MCXOPT'), false);

  const blocked = validateEditorCanEnableSegmentForChild(editorPerms, 'MCXOPT', true, 'ADMIN');
  assert.equal(blocked.allowed, false);
  assert.match(blocked.message, /MCXOPT/);

  const allowed = validateEditorCanEnableSegmentForChild(editorPerms, 'NSEFUT', true, 'ADMIN');
  assert.equal(allowed.allowed, true);

  const superAdmin = validateEditorCanEnableSegmentForChild(editorPerms, 'MCXOPT', true, 'SUPER_ADMIN');
  assert.equal(superAdmin.allowed, true);

  const disable = validateEditorCanEnableSegmentForChild(editorPerms, 'MCXOPT', false, 'ADMIN');
  assert.equal(disable.allowed, true);
});

test('intraday-only parent locks child from disabling flag or opening lot/qty settings', () => {
  const parentSeg = { defaultIntradayOnly: true, enableLotSettings: true, enableQuantitySettings: true };

  assert.equal(isParentIntradayOnlyLocked(parentSeg), true);

  const disableBlocked = validateEditorCanSetDefaultIntradayOnly(parentSeg, false, 'ADMIN');
  assert.equal(disableBlocked.allowed, false);

  const enableAllowed = validateEditorCanSetDefaultIntradayOnly(parentSeg, true, 'ADMIN');
  assert.equal(enableAllowed.allowed, true);

  const lotBlocked = validateEditorCanEnableLotQtyMode(parentSeg, 'enableLotSettings', true, 'ADMIN');
  assert.equal(lotBlocked.allowed, false);
  assert.match(lotBlocked.message, /intraday-only/i);

  const qtyBlocked = validateEditorCanEnableLotQtyMode(parentSeg, 'enableQuantitySettings', true, 'ADMIN');
  assert.equal(qtyBlocked.allowed, false);

  const superAdminLot = validateEditorCanEnableLotQtyMode(parentSeg, 'enableLotSettings', true, 'SUPER_ADMIN');
  assert.equal(superAdminLot.allowed, true);
});

test('CRYPTOFUT lot/qty settings allowed when parent intraday-only locked', () => {
  const parentSeg = { defaultIntradayOnly: true, enableLotSettings: true, enableQuantitySettings: true };

  const lotAllowed = validateEditorCanEnableLotQtyMode(parentSeg, 'enableLotSettings', true, 'ADMIN', 'CRYPTOFUT');
  assert.equal(lotAllowed.allowed, true);

  const qtyAllowed = validateEditorCanEnableLotQtyMode(parentSeg, 'enableQuantitySettings', true, 'ADMIN', 'CRYPTOFUT');
  assert.equal(qtyAllowed.allowed, true);

  const childAttempt = {
    defaultIntradayOnly: true,
    enableLotSettings: true,
    enableQuantitySettings: true,
  };
  const enforced = enforceIntradayOnlyHierarchyOnSegment(parentSeg, childAttempt, 'ADMIN', 'CRYPTOFUT');
  assert.equal(enforced.defaultIntradayOnly, true);
  assert.equal(enforced.enableLotSettings, true);
  assert.equal(enforced.enableQuantitySettings, true);
});

test('validateSegmentIntradayOnlyHierarchy and enforce on save', () => {
  const parentSeg = { defaultIntradayOnly: true };
  const childAttempt = {
    defaultIntradayOnly: false,
    enableLotSettings: true,
    enableQuantitySettings: true,
  };

  const blocked = validateSegmentIntradayOnlyHierarchy(parentSeg, childAttempt, 'ADMIN', 'NSEFUT');
  assert.equal(blocked.allowed, false);

  const enforced = enforceIntradayOnlyHierarchyOnSegment(parentSeg, childAttempt, 'ADMIN', 'NSEFUT');
  assert.equal(enforced.defaultIntradayOnly, true);
  assert.equal(enforced.enableLotSettings, false);
  assert.equal(enforced.enableQuantitySettings, false);
});

test('parent enableLotSettings false still blocks when not intraday-only locked', () => {
  const parentSeg = { defaultIntradayOnly: false, enableLotSettings: false };
  const lotBlocked = validateEditorCanEnableLotQtyMode(parentSeg, 'enableLotSettings', true, 'ADMIN');
  assert.equal(lotBlocked.allowed, false);
  assert.match(lotBlocked.message, /Lot settings/i);
});
