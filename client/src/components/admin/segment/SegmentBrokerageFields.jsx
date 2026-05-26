import React from 'react';
import {
  commissionAmountLabel,
  commissionHelperText,
  requiredUnitForCommissionType,
} from '../../../utils/commissionTypeUnit.js';
import {
  resolveSegmentCommissionType,
  SEGMENT_COMMISSION_TYPE_OPTIONS,
  segmentCommissionAmountField,
} from '../../../utils/segmentCommissionType.js';
import { numInputValue, parseNumInput } from '../../../utils/segmentFormValues.js';

/**
 * Segment-level brokerage — values & type from saved slice + optional baseline (system/parent defaults).
 */
export default function SegmentBrokerageFields({
  slice = {},
  baseline = null,
  onChange,
  compact = false,
}) {
  const base = baseline && typeof baseline === 'object' ? baseline : {};
  const commType = resolveSegmentCommissionType(slice.commissionType, base.commissionType);
  const amountField = segmentCommissionAmountField(commType);
  const amountRaw =
    commType === 'PER_CRORE' || commType === 'PER_TRADE' ? slice.commission : slice.commissionLot;
  const inputCls = compact
    ? 'w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm'
    : 'w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm';
  const labelCls = 'block text-xs text-gray-400 mb-1';

  const patch = (fields) => onChange({ ...slice, ...fields });

  return (
    <>
      <h4 className={`font-semibold text-green-400 mb-2 ${compact ? 'text-xs' : 'text-sm'}`}>Brokerage</h4>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className={labelCls}>
            {commType ? commissionAmountLabel(commType) : 'Brokerage amount (₹)'}
          </label>
          <input
            type="number"
            min={0}
            value={numInputValue(amountRaw)}
            disabled={!commType}
            onChange={(e) => {
              patch({ [amountField]: parseNumInput(e.target.value) });
            }}
            className={inputCls}
          />
          {commType ? (
            <p className="text-[10px] text-gray-600 mt-1">{commissionHelperText(commType)}</p>
          ) : (
            <p className="text-[10px] text-gray-600 mt-1">Select commission type first</p>
          )}
        </div>
        <div>
          <label className={labelCls}>Commission Type</label>
          <select
            value={commType}
            onChange={(e) => {
              const ct = e.target.value;
              patch({
                commissionType: ct,
                commissionUnit: requiredUnitForCommissionType(ct),
              });
            }}
            className={inputCls}
          >
            {!commType && <option value="">— Select —</option>}
            {SEGMENT_COMMISSION_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
}
