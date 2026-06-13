import React from 'react';
import { numInputValue, parseNonNegativeNumInput } from '../../../utils/segmentFormValues.js';

/** Admin-only: Binance crypto client spread ($ per side on bid/ask). */
export default function CryptoClientSpreadFields({ slice, onFieldChange, compact = false }) {
  const s = slice || {};

  return (
    <div className={compact ? 'mb-4' : 'space-y-3'}>
      <h4 className={`font-semibold text-orange-300 ${compact ? 'text-xs mb-2' : 'text-sm mb-3'}`}>
        Client spread (Binance crypto)
      </h4>
      <p className={`text-gray-500 ${compact ? 'text-[11px] mb-2' : 'text-xs mb-3'}`}>
        USDT per side on client quotes: bid − spread, ask + spread (e.g. 25 → bid −25, ask +25). 0 = exchange prices.
      </p>
      <div className="max-w-xs">
        <label className="block text-xs text-gray-400 mb-1">Spread ($ per side)</label>
        <input
          type="number"
          min={0}
          step={0.01}
          value={numInputValue(s.cryptoSpreadUsdPerSide)}
          onChange={(e) =>
            onFieldChange('cryptoSpreadUsdPerSide', parseNonNegativeNumInput(e.target.value))
          }
          className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
        />
      </div>
    </div>
  );
}
