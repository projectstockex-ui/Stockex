import { DEFAULT_INSTRUMENT_SEGMENT_PROFILE } from './instrumentSegmentKey.js';

/** Load hierarchy-style profile for Rules modal from instrument.tradingDefaults. */
export function instrumentToSegmentProfileSlice(inst) {
  const td = inst?.tradingDefaults;
  let slice;
  if (td?.segmentProfile && typeof td.segmentProfile === 'object') {
    try {
      slice = JSON.parse(JSON.stringify(td.segmentProfile));
    } catch {
      slice = { ...td.segmentProfile };
    }
  } else {
    slice = JSON.parse(JSON.stringify(DEFAULT_INSTRUMENT_SEGMENT_PROFILE));
    if (td) {
      if (td.exposureIntraday != null) slice.exposureIntraday = td.exposureIntraday;
      if (td.exposureCarryForward != null) slice.exposureCarryForward = td.exposureCarryForward;
      if (td.lotSettings && typeof td.lotSettings === 'object') {
        slice.lotSettings = { ...(slice.lotSettings || {}), ...td.lotSettings };
      }
      if (td.quantitySettings && typeof td.quantitySettings === 'object') {
        slice.quantityModeSettings = {
          ...(slice.quantityModeSettings || {}),
          ...td.quantitySettings,
        };
      }
      const pc = Number(td.additionalCharges?.perCroreInr);
      if (Number.isFinite(pc) && pc > 0) {
        slice.commissionType = 'PER_CRORE';
        slice.commission = pc;
        slice.commissionLot = pc;
      }
    }
  }
  if (td?.enabled === false) slice.enabled = false;
  else if (td?.enabled) slice.enabled = true;
  return slice;
}
