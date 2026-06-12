import React from 'react';
import { Share2 } from 'lucide-react';

const JACKPOT_GAMES = new Set(['niftyJackpot', 'btcJackpot']);
const UP_DOWN_GAMES = new Set(['niftyUpDown', 'btcUpDown']);

export function referralPercentLabel(gameKey) {
  if (JACKPOT_GAMES.has(gameKey)) return '% of the bank';
  if (UP_DOWN_GAMES.has(gameKey)) return '% of one ticket (current price)';
  return '% of ticket price';
}

export function referralPercentHint(gameKey) {
  if (JACKPOT_GAMES.has(gameKey)) {
    return 'Percentage of the total Bank (prize pool) to give to the referrer when applicable';
  }
  if (UP_DOWN_GAMES.has(gameKey)) {
    return "Uses the current ticket price from this game's settings (or global token value). Credited once when the referred user gets their first win in this game — not on every window.";
  }
  return 'Percentage of the ticket price (stake per ticket) to give to the referrer when applicable';
}

/**
 * Per-game referral reward fields — used inside Game Settings for each game.
 */
export default function GameReferralDistributionFields({
  gameKey,
  referralDistribution = {},
  onChange,
  disabled = false,
  className = '',
}) {
  if (!gameKey || typeof onChange !== 'function') return null;

  const isJackpot = JACKPOT_GAMES.has(gameKey);

  return (
    <div className={`space-y-4 rounded-lg border border-purple-500/30 bg-purple-900/10 p-4 ${className}`}>
      <h4 className="font-medium text-purple-300 flex items-center gap-2">
        <Share2 size={16} /> Referral Distribution
      </h4>
      <p className="text-xs text-gray-500">
        Referrer reward for this game only. Click <span className="text-purple-300">Save Settings</span> after editing.
      </p>

      <div>
        <label className="block text-sm text-gray-400 mb-2">{referralPercentLabel(gameKey)}</label>
        <input
          type="number"
          min="0"
          max="100"
          step="0.1"
          value={referralDistribution?.winPercent ?? 5}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            onChange('winPercent', Number.isFinite(v) ? v : 0);
          }}
          disabled={disabled}
          className="w-full bg-dark-700 border border-dark-600 rounded px-4 py-2"
        />
        <p className="text-xs text-gray-500 mt-1">{referralPercentHint(gameKey)}</p>
      </div>

      {isJackpot && (
        <>
          <div>
            <label className="block text-sm text-gray-400 mb-2">Top Ranks Only</label>
            <select
              value={referralDistribution?.topRanksOnly ?? false}
              onChange={(e) => onChange('topRanksOnly', e.target.value === 'true')}
              disabled={disabled}
              className="w-full bg-dark-700 border border-dark-600 rounded px-4 py-2"
            >
              <option value="true">Yes - Only top ranks</option>
              <option value="false">No - All winners</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">Only apply referral bonus to top X ranks</p>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Top Ranks Count</label>
            <input
              type="number"
              min="1"
              max="20"
              step="1"
              value={referralDistribution?.topRanksCount ?? 3}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                onChange('topRanksCount', Number.isFinite(v) ? v : 1);
              }}
              disabled={disabled}
              className="w-full bg-dark-700 border border-dark-600 rounded px-4 py-2"
            />
            <p className="text-xs text-gray-500 mt-1">Number of top ranks to apply referral bonus</p>
          </div>
        </>
      )}
    </div>
  );
}
