import React from 'react';
import {
  requiredUnitForCommissionType,
  commissionAmountLabel,
  commissionHelperText,
} from '../../../utils/commissionTypeUnit.js';
import { isCryptoQtyOnlySegment } from '../dashboard/utils/cryptoUtils.js';
import SegmentNumberInput from './SegmentNumberInput.jsx';

export const OPTION_LEVERAGE_SEGMENT_KEYS = ['NSEOPT', 'MCXOPT', 'CRYPTOOPT'];

/** All OPT segments use Option Buy/Sell — no Settings in Lot / Qty toggles in hierarchy. */
export const SIMPLIFIED_HIERARCHY_OPT_SEGMENTS = [
  'NSEOPT',
  'MCXOPT',
  'BSE-OPT',
  'FOREXOPT',
  'CRYPTOOPT',
];

export function isSimplifiedHierarchyOptSegment(segmentKey) {
  return SIMPLIFIED_HIERARCHY_OPT_SEGMENTS.includes(String(segmentKey || '').toUpperCase());
}

/** Intraday + carryforward leverage on every OPT segment (BSE-OPT, FOREXOPT, etc.). */
export function segmentHasOptionLeverageFields(segmentKey) {
  const k = String(segmentKey || '').toUpperCase();
  return (
    isSimplifiedHierarchyOptSegment(k) ||
    OPTION_LEVERAGE_SEGMENT_KEYS.includes(k) ||
    k.endsWith('OPT') ||
    k.endsWith('-OPT')
  );
}

export default function OptionBuySellFields({
  segmentKey,
  optType,
  opt = {},
  onChange,
  compact = false,
  showLeverage,
  hideBrokerage = false,
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
        {!hideBrokerage && (
          <>
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
            </div>
            <div>
              <label className={labelCls}>
                {opt.commissionType
                  ? commissionAmountLabel(opt.commissionType)
                  : 'Brokerage amount'}
              </label>
              <SegmentNumberInput
                value={opt.commission}
                onChange={(v) => patch({ commission: v })}
                className={inputCls}
              />
              {opt.commissionType ? (
                <p className="text-[9px] text-gray-500 mt-0.5">{commissionHelperText(opt.commissionType)}</p>
              ) : (
                <p className="text-[9px] text-gray-500 mt-0.5">Select commission type, then enter amount here</p>
              )}
            </div>
          </>
        )}
        <div>
          <label className={labelCls}>Strike Selection</label>
          <SegmentNumberInput
            integer
            value={opt.strikeSelection}
            onChange={(v) => patch({ strikeSelection: v })}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>
            {isCryptoQtyOnlySegment(segmentKey) ? 'Max Exchange Qty' : 'Max Exchange Lots'}
          </label>
          <SegmentNumberInput
            integer
            value={opt.maxExchangeLots}
            onChange={(v) => patch({ maxExchangeLots: v })}
            className={inputCls}
          />
        </div>
      </div>
    </div>
  );
}
