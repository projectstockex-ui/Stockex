import React from 'react';
import {
  requiredUnitForCommissionType,
  commissionAmountLabel,
  commissionHelperText,
  unitOptionsForCommissionType,
} from '../../../utils/commissionTypeUnit.js';
import { isCryptoQtyOnlySegment } from '../dashboard/utils/cryptoUtils.js';
import { numInputValue, intInputValue, parseNumInput, parseIntInput } from '../../../utils/segmentFormValues.js';
import SegmentNumberInput from './SegmentNumberInput.jsx';

export const OPTION_LEVERAGE_SEGMENT_KEYS = ['NSEOPT', 'MCXOPT', 'CRYPTOOPT'];

/** OPT segments: hierarchy hides segment lot/qty + segment brokerage; Option Buy/Sell keeps per-lot brokerage. */
export const SIMPLIFIED_HIERARCHY_OPT_SEGMENTS = OPTION_LEVERAGE_SEGMENT_KEYS;

export function isSimplifiedHierarchyOptSegment(segmentKey) {
  return SIMPLIFIED_HIERARCHY_OPT_SEGMENTS.includes(String(segmentKey || '').toUpperCase());
}

export function segmentHasOptionLeverageFields(segmentKey) {
  return OPTION_LEVERAGE_SEGMENT_KEYS.includes(String(segmentKey || '').toUpperCase());
}

export default function OptionBuySellFields({
  segmentKey,
  optType,
  opt = {},
  onChange,
  compact = false,
  showLeverage,
}) {
  const showOptLev =
    showLeverage !== undefined ? showLeverage : segmentHasOptionLeverageFields(segmentKey);
  const inputCls = compact
    ? 'w-full bg-dark-700 border border-dark-600 rounded px-2 py-1.5 text-xs'
    : 'w-full bg-dark-800 border border-dark-600 rounded px-2 py-1.5 text-sm';
  const labelCls = 'block text-xs text-gray-400 mb-1';

  const patch = (fields) => onChange({ ...opt, ...fields });

  return (
    <div className={compact ? 'bg-dark-800 rounded-lg p-3' : 'bg-dark-700 rounded-lg p-4'}>
      <div className="flex items-center justify-between mb-2">
        <h5 className={`font-semibold ${compact ? 'text-xs' : 'text-sm text-purple-400'}`}>
          {optType === 'optionBuy' ? 'Option Buy (Premium)' : 'Option Sell (Strike Price)'}
        </h5>
        <button
          type="button"
          onClick={() => patch({ allowed: !opt.allowed })}
          className={`px-2 py-0.5 rounded text-xs font-medium ${opt.allowed !== false ? 'bg-green-600' : 'bg-red-600'}`}
        >
          {opt.allowed !== false ? 'Allowed' : 'Blocked'}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {showOptLev && (
          <>
            <div>
              <label className={labelCls}>Leverage in Intraday (x)</label>
              <SegmentNumberInput
                value={opt.intradayLeverage}
                onChange={(v) => patch({ intradayLeverage: v })}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Leverage in Carryforward (x)</label>
              <SegmentNumberInput
                value={opt.carryForwardLeverage}
                onChange={(v) => patch({ carryForwardLeverage: v })}
                className={inputCls}
              />
            </div>
          </>
        )}
        <div>
          <label className={labelCls}>
            {opt.commissionType
              ? commissionAmountLabel(opt.commissionType)
              : 'Brokerage amount (₹)'}
          </label>
          <input
            type="number"
            min={0}
            value={numInputValue(opt.commission)}
            onChange={(e) => patch({ commission: parseNumInput(e.target.value) })}
            className={inputCls}
          />
          {opt.commissionType ? (
            <p className="text-[9px] text-gray-600 mt-0.5">{commissionHelperText(opt.commissionType)}</p>
          ) : null}
        </div>
        <div>
          <label className={labelCls}>Strike Selection</label>
          <input
            type="number"
            value={intInputValue(opt.strikeSelection)}
            onChange={(e) => patch({ strikeSelection: parseIntInput(e.target.value) })}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>
            {isCryptoQtyOnlySegment(segmentKey) ? 'Max Exchange Qty' : 'Max Exchange Lots'}
          </label>
          <input
            type="number"
            value={intInputValue(opt.maxExchangeLots)}
            onChange={(e) => patch({ maxExchangeLots: parseIntInput(e.target.value) })}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Commission Type</label>
          <select
            value={opt.commissionType || ''}
            onChange={(e) => {
              const ct = e.target.value;
              if (!ct) return;
              patch({
                commissionType: ct,
                commissionUnit: requiredUnitForCommissionType(ct),
              });
            }}
            className={inputCls}
          >
            <option value="">— Select —</option>
            <option value="PER_LOT">Per Lot</option>
            <option value="PER_TRADE">Per Trade</option>
          </select>
          {opt.commissionType ? (
            <select
              value={requiredUnitForCommissionType(opt.commissionType)}
              disabled
              className={`${inputCls} mt-1 opacity-90 cursor-not-allowed`}
              title="Unit follows commission type"
            >
              {unitOptionsForCommissionType(opt.commissionType).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>
    </div>
  );
}
