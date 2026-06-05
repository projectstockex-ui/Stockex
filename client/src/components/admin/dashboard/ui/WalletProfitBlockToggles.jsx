import React from 'react';
import { Lock } from 'lucide-react';
import { WALLET_PROFIT_BLOCK_ROWS } from '../../../../lib/walletProfitBlock';

const WalletProfitBlockToggles = ({ blocks, blockLoading, onToggle }) => (
  <div className="space-y-2">
    <label className="block text-sm text-gray-400">Wallet Profit Block</label>
    <p className="text-xs text-gray-500 mb-1">
      Toggle ON = wallet disabled (no trade, transfer, or deposit on user panel).
    </p>
    {WALLET_PROFIT_BLOCK_ROWS.map(({ key, label }) => {
      const blocked = !!blocks[key];
      return (
        <div
          key={key}
          className={`flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all ${
            blocked
              ? 'opacity-45 bg-dark-700/80 border-red-900/40 text-gray-500'
              : 'bg-dark-700 border-dark-600 text-gray-200'
          }`}
        >
          <span className="text-sm font-medium flex items-center gap-2">
            {blocked && <Lock size={14} />}
            {label}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={blocked}
            aria-label={`${blocked ? 'Unblock' : 'Block'} ${label}`}
            onClick={() => onToggle(key, !blocked)}
            disabled={blockLoading === key}
            className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
              blocked ? 'bg-red-600' : 'bg-gray-600'
            } ${blockLoading === key ? 'opacity-50 cursor-wait' : ''}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                blocked ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </div>
      );
    })}
  </div>
);

export default WalletProfitBlockToggles;
