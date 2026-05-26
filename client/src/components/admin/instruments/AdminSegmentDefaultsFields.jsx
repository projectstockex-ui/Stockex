import React, { useState } from 'react';
import {
  requiredUnitForCommissionType,
  commissionAmountLabel,
  commissionHelperText,
  unitOptionsForCommissionType,
} from '../../../utils/commissionTypeUnit.js';
import { LIMIT_PENDING_HELP_TEXT } from '../../../lib/adminSegmentRoleGates.js';
import { isCryptoQtyOnlySegment } from '../dashboard/utils/cryptoUtils.js';
import CryptoSegmentAdminExtras from '../dashboard/ui/CryptoSegmentAdminExtras.jsx';
import OptionBuySellFields from '../segment/OptionBuySellFields.jsx';
import SegmentBrokerageFields from '../segment/SegmentBrokerageFields.jsx';
import {
  numInputValue,
  intInputValue,
  parseIntInput,
  parseNonNegativeNumInput,
  patchSegmentField,
} from '../../../utils/segmentFormValues.js';
import SegmentNumberInput from '../segment/SegmentNumberInput.jsx';

/**
 * Segment settings fields copied from Hierarchy Management → Settings (admin segment defaults panel).
 */
export default function AdminSegmentDefaultsFields({ segmentKey, slice, onChange }) {
  const s = slice || {};
  const isOpt = ['NSEOPT', 'MCXOPT', 'BSE-OPT', 'FOREXOPT', 'CRYPTOOPT'].includes(segmentKey);
  const [showLotSettingsButton, setShowLotSettingsButton] = useState(true);
  const [showQtySettingsButton, setShowQtySettingsButton] = useState(true);

  const handleChange = (field, value) => {
    onChange(patchSegmentField(s, field, value));
  };

  const handleOptionChange = (optionType, field, value) => {
    onChange({
      ...s,
      [optionType]: { ...(s[optionType] || {}), [field]: value },
    });
  };

  return (
    <div className="space-y-6 text-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex gap-4 items-center">
            <button
              type="button"
              onClick={() => setShowLotSettingsButton(!showLotSettingsButton)}
              className={`w-12 h-6 rounded-full p-1 transition-colors ${showLotSettingsButton ? 'bg-yellow-600' : 'bg-dark-600'}`}
            >
              <div className={`w-4 h-4 rounded-full bg-white transition-transform ${showLotSettingsButton ? 'translate-x-6' : 'translate-x-0'}`} />
            </button>
            <span className="text-xs text-gray-400">Lot</span>
            <button
              type="button"
              onClick={() => setShowQtySettingsButton(!showQtySettingsButton)}
              className={`w-12 h-6 rounded-full p-1 transition-colors ${showQtySettingsButton ? 'bg-blue-600' : 'bg-dark-600'}`}
            >
              <div className={`w-4 h-4 rounded-full bg-white transition-transform ${showQtySettingsButton ? 'translate-x-6' : 'translate-x-0'}`} />
            </button>
            <span className="text-xs text-gray-400">Qty</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => handleChange('enabled', !s.enabled)}
          className={`px-4 py-1.5 rounded font-medium text-sm ${s.enabled !== false ? 'bg-green-600' : 'bg-red-600'}`}
        >
          {s.enabled !== false ? 'Enabled' : 'Disabled'}
        </button>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-yellow-400 mb-3">Leverage Settings</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Intraday Leverage (x)</label>
            <SegmentNumberInput
              value={s.exposureIntraday}
              onChange={(v) => handleChange('exposureIntraday', v)}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Carry Forward Leverage (x)</label>
            <SegmentNumberInput
              value={s.exposureCarryForward}
              onChange={(v) => handleChange('exposureCarryForward', v)}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-dark-600 bg-dark-700/60 p-3">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 shrink-0"
            checked={s.defaultIntradayOnly === true}
            onChange={(e) => handleChange('defaultIntradayOnly', e.target.checked)}
          />
          <span>
            <span className="text-sm font-medium text-gray-200">Default intraday-only orders (EOD auto square)</span>
            <span className="mt-1 block text-xs text-gray-500">
              When enabled, new trades in this segment get the intraday-only flag (no trader toggle). Hierarchy admins and user overrides can adjust per segment.
            </span>
          </span>
        </label>
      </div>

      <div className="rounded-lg border border-dark-600 bg-dark-700/60 p-3">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 shrink-0"
            checked={s.allowLimitPendingOrders !== false}
            onChange={(e) => handleChange('allowLimitPendingOrders', e.target.checked)}
          />
          <span>
            <span className="text-sm font-medium text-gray-200">Allow limit & pending (LIMIT / SL-M) orders</span>
            <span className="mt-1 block text-xs text-gray-500">{LIMIT_PENDING_HELP_TEXT}</span>
          </span>
        </label>
      </div>

      {showLotSettingsButton && (
        <>
          <h4 className="text-sm font-semibold text-yellow-400 mb-4">Lot Settings</h4>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Intraday Leverage (x)</label>
              <SegmentNumberInput
                value={s.lotSettings?.intradayLeverage}
                onChange={(v) => handleChange('lotSettings.intradayLeverage', v)}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Carryforward Leverage (x)</label>
              <SegmentNumberInput
                value={s.lotSettings?.carryForwardLeverage}
                onChange={(v) => handleChange('lotSettings.carryForwardLeverage', v)}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Max Lots</label>
              <input
                type="number"
                min="0"
                value={intInputValue(s.maxLots)}
                onChange={(e) => handleChange('maxLots', parseIntInput(e.target.value))}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Min Lots</label>
              <input
                type="number"
                min="0"
                value={intInputValue(s.minLots)}
                onChange={(e) => handleChange('minLots', parseIntInput(e.target.value))}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Breakup Lots</label>
              <input
                type="number"
                min="0"
                value={intInputValue(s.lotSettings?.breakupLots)}
                onChange={(e) => handleChange('lotSettings.breakupLots', parseIntInput(e.target.value))}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Notification %</label>
              <SegmentNumberInput
                value={s.lotSettings?.notificationPercent}
                onChange={(v) => handleChange('lotSettings.notificationPercent', v)}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Autosquare %</label>
              <SegmentNumberInput
                value={s.lotSettings?.autosquarePercent}
                onChange={(v) => handleChange('lotSettings.autosquarePercent', v)}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
        </>
      )}

      {showQtySettingsButton && (
        <>
          <h4 className="text-sm font-semibold text-blue-400 mb-3">Quantity Settings</h4>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Intraday Leverage (x)</label>
              <SegmentNumberInput
                value={s.quantityModeSettings?.intradayLeverage}
                onChange={(v) => handleChange('quantityModeSettings.intradayLeverage', v)}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Carryforward Leverage (x)</label>
              <SegmentNumberInput
                value={s.quantityModeSettings?.carryForwardLeverage}
                onChange={(v) => handleChange('quantityModeSettings.carryForwardLeverage', v)}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Max Quantity</label>
              <input
                type="number"
                min="0"
                value={intInputValue(s.quantityModeSettings?.maxQuantity)}
                onChange={(e) => handleChange('quantityModeSettings.maxQuantity', parseIntInput(e.target.value))}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Min Quantity</label>
              <input
                type="number"
                min="0"
                value={intInputValue(s.quantityModeSettings?.minQuantity)}
                onChange={(e) => handleChange('quantityModeSettings.minQuantity', parseIntInput(e.target.value))}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Breakup Quantity</label>
              <input
                type="number"
                min="0"
                value={intInputValue(s.quantityModeSettings?.breakupQuantity)}
                onChange={(e) => handleChange('quantityModeSettings.breakupQuantity', parseIntInput(e.target.value))}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Notification %</label>
              <SegmentNumberInput
                value={s.quantityModeSettings?.notificationPercent}
                onChange={(v) => handleChange('quantityModeSettings.notificationPercent', v)}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Autosquare %</label>
              <SegmentNumberInput
                value={s.quantityModeSettings?.autosquarePercent}
                onChange={(v) => handleChange('quantityModeSettings.autosquarePercent', v)}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
        </>
      )}

      {['CRYPTOFUT', 'CRYPTOOPT'].includes(segmentKey) && (
        <CryptoSegmentAdminExtras segmentKey={segmentKey} slice={s} onFieldChange={handleChange} />
      )}

      <div>
        <h4 className="text-sm font-semibold text-orange-400 mb-3">Dynamic Quantity Limits</h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Max Intraday Qty ({['MCXFUT', 'MCXOPT', 'MCX'].includes(segmentKey) ? 'qty' : 'Shares'})
            </label>
            <input
              type="number"
              value={numInputValue(s.maxIntradayQty)}
              onChange={(e) => handleChange('maxIntradayQty', parseIntInput(e.target.value))}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
            />
            <p className="text-[10px] text-gray-500 mt-1">User&apos;s max quantity for intraday trades</p>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Max Carry Forward Qty ({['MCXFUT', 'MCXOPT', 'MCX'].includes(segmentKey) ? 'qty' : 'Shares'})
            </label>
            <input
              type="number"
              value={numInputValue(s.maxCarryQty)}
              onChange={(e) => handleChange('maxCarryQty', parseIntInput(e.target.value))}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
            />
            <p className="text-[10px] text-gray-500 mt-1">User&apos;s max quantity for carry forward trades</p>
          </div>
        </div>
      </div>

      <SegmentBrokerageFields
        slice={s}
        onChange={onChange}
      />

      {['MCXFUT', 'MCXOPT', 'MCX'].includes(segmentKey) && (
        <>
          <h4 className="text-sm font-semibold text-yellow-400 mb-3">Super Admin Brokerage & Incentive</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Incentive Given by Super Admin ()</label>
              <input
                type="number"
                value={s.superAdminIncentive || 0}
                onChange={(e) => handleChange('superAdminIncentive', parseFloat(e.target.value) || 0)}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
              />
              <p className="text-[10px] text-gray-600 mt-1">Incentive/rebate per lot/quantity by Super Admin</p>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Brokerage Charged by Super Admin ()</label>
              <input
                type="number"
                value={s.superAdminBrokerageCharge || 0}
                onChange={(e) => handleChange('superAdminBrokerageCharge', parseFloat(e.target.value) || 0)}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
              />
              <p className="text-[10px] text-gray-600 mt-1">Brokerage charge per lot/quantity by Super Admin</p>
            </div>
          </div>
          <h4 className="text-sm font-semibold text-orange-400 mb-3">Super Admin Brokerage & Incentive (in Crores)</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Incentive Given by Super Admin (in Crores)</label>
              <input
                type="number"
                value={s.superAdminIncentiveInCrore || 0}
                onChange={(e) => handleChange('superAdminIncentiveInCrore', parseFloat(e.target.value) || 0)}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Brokerage Charged by Super Admin (in Crores)</label>
              <input
                type="number"
                value={s.superAdminBrokerageChargeInCrore || 0}
                onChange={(e) => handleChange('superAdminBrokerageChargeInCrore', parseFloat(e.target.value) || 0)}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
        </>
      )}

      {['CRYPTOFUT', 'CRYPTOOPT'].includes(segmentKey) && (
        <div>
          <h4 className="text-sm font-semibold text-orange-400 mb-2">Client spread (Binance crypto)</h4>
          <p className="text-[11px] text-gray-500 mb-2">
            Primary: USDT per side on client quotes (bid −, ask +). If $ spread is 0, legacy total width per coin applies. 0 / 0 = exchange prices.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Spread ($ per side)</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={numInputValue(s.cryptoSpreadUsdPerSide)}
                onChange={(e) => handleChange('cryptoSpreadUsdPerSide', parseNonNegativeNumInput(e.target.value))}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Spread ( total / coin, legacy)</label>
              <input
                type="number"
                min={0}
                step={1}
                value={numInputValue(s.cryptoSpreadInr)}
                onChange={(e) => handleChange('cryptoSpreadInr', parseNonNegativeNumInput(e.target.value))}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>
      )}

      {isOpt && (
        <>
          <h4 className="text-sm font-semibold text-purple-400 mb-3">Option Buy / Sell Settings</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {['optionBuy', 'optionSell'].map((optType) => (
              <OptionBuySellFields
                key={optType}
                segmentKey={segmentKey}
                optType={optType}
                opt={s[optType] || {}}
                onChange={(next) => onChange({ ...s, [optType]: next })}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
