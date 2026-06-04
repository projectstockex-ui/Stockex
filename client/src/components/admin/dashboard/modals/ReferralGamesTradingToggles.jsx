import React from 'react';
import { Gamepad2, TrendingUp } from 'lucide-react';

/** Referral in Games + Referral in Trading toggles (ADMIN root / franchise). */
export default function ReferralGamesTradingToggles({ value, onChange, compact = false }) {
  const gamesOn = value?.games !== false;
  const tradingOn = value?.trading !== false;

  const setGames = (on) => onChange({ ...value, games: on, trading: tradingOn });
  const setTrading = (on) => onChange({ ...value, games: gamesOn, trading: on });

  return (
    <div
      className={`rounded-lg border border-emerald-600/30 bg-dark-700/80 ${
        compact ? 'p-3' : 'p-4'
      }`}
    >
      <h3 className="text-sm font-semibold text-emerald-300 mb-1">Referral distribution</h3>
      <p className="text-[11px] text-gray-500 mb-3">
        When OFF, referrers under this admin tree will not receive commission for that category.
      </p>
      <div className="space-y-2">
        <div className="flex items-center justify-between p-2.5 bg-dark-600/80 rounded-lg">
          <div className="flex items-center gap-2">
            <Gamepad2 size={18} className="text-purple-400 shrink-0" />
            <div>
              <div className="text-sm font-medium">Referral in Games</div>
              <div className="text-[10px] text-gray-500">Nifty/BTC games, jackpots, etc.</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setGames(!gamesOn)}
            className={`px-3 py-1.5 rounded text-xs font-semibold ${
              gamesOn ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-600 hover:bg-gray-700'
            }`}
          >
            {gamesOn ? 'ON' : 'OFF'}
          </button>
        </div>
        <div className="flex items-center justify-between p-2.5 bg-dark-600/80 rounded-lg">
          <div className="flex items-center gap-2">
            <TrendingUp size={18} className="text-blue-400 shrink-0" />
            <div>
              <div className="text-sm font-medium">Referral in Trading</div>
              <div className="text-[10px] text-gray-500">NSE, MCX, crypto, forex — first win &amp; brokerage share</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setTrading(!tradingOn)}
            className={`px-3 py-1.5 rounded text-xs font-semibold ${
              tradingOn ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-600 hover:bg-gray-700'
            }`}
          >
            {tradingOn ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>
    </div>
  );
}
