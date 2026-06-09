import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from '../../config/axios';
import {
  Bitcoin,
  Lock,
  Unlock,
  RefreshCw,
  Save,
  Trophy,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

/**
 * BTC Jackpot admin panel — mounted inside AdminDashboard.
 * Uses only /api/admin/btc-jackpot/* endpoints (separate from Nifty Jackpot).
 *
 * Capabilities:
 *   - View today's bids
 *   - Lock the BTC closing price (manual override of scheduler) for any IST date
 *   - Manually declare result (scheduler auto-runs after bidding ends, or at BTC Number result time if both games are on)
 *   - Edit config (ticket price, times, prize ladder, hierarchy %s)
 */

function inr(n, dp = 2) {
  if (!Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function usd(n, dp = 2) {
  if (!Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function todayIST() {
  const d = new Date();
  const offset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(d.getTime() + offset);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
}

const BtcJackpotAdminPanel = ({ adminToken, onSettingsSaved }) => {
  const headers = useMemo(
    () => (adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
    [adminToken]
  );

  const [date, setDate] = useState(todayIST());
  const [bids, setBids] = useState([]);
  const [bidsReferenceBtc, setBidsReferenceBtc] = useState(null);
  const [bank, setBank] = useState(null);
  const [locked, setLocked] = useState(null);
  const [settings, setSettings] = useState(null);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [manualPrice, setManualPrice] = useState('');
  const [settingsDraft, setSettingsDraft] = useState(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [bidsRes, bankRes, lockRes, setRes] = await Promise.all([
        axios.get(`/api/admin/btc-jackpot/bids?date=${date}`, { headers }),
        axios.get(`/api/admin/btc-jackpot/bank/${date}`, { headers }),
        axios.get(`/api/admin/btc-jackpot/locked-price?date=${date}`, { headers }),
        axios.get('/api/admin/btc-jackpot/settings', { headers }),
      ]);
      setBids(Array.isArray(bidsRes.data?.bids) ? bidsRes.data.bids : []);
      setBidsReferenceBtc(
        bidsRes.data?.referenceBtc != null && Number.isFinite(Number(bidsRes.data.referenceBtc))
          ? Number(bidsRes.data.referenceBtc)
          : null
      );
      setBank(bankRes.data || null);
      setLocked(lockRes.data || null);
      setSettings(setRes.data?.btcJackpot || null);
      setSettingsDraft(setRes.data?.btcJackpot || null);
    } catch (e) {
      setError(e?.response?.data?.message || e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [date, headers]);

  useEffect(() => {
    if (!adminToken) return;
    loadAll();
  }, [loadAll, adminToken]);

  /* ------------------------------- actions ------------------------------- */

  const lockPrice = async (useManual) => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const body = { date };
      if (useManual) {
        const n = Number(manualPrice);
        if (!Number.isFinite(n) || n <= 0) {
          setError('Enter a valid BTC price');
          setBusy(false);
          return;
        }
        body.price = n;
      }
      const { data } = await axios.post('/api/admin/btc-jackpot/lock-price', body, { headers });
      setSuccess(`Locked at $${inr(data?.lockedBtcPrice, 2)} (${data?.source || 'manual'})`);
      setManualPrice('');
      await loadAll();
    } catch (e) {
      setError(e?.response?.data?.message || e.message || 'Lock failed');
    } finally {
      setBusy(false);
    }
  };

  const declare = async () => {
    if (!confirm(`Declare BTC Jackpot for ${date}? This will pay winners & hierarchy and cannot be undone.`)) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const { data } = await axios.post('/api/admin/btc-jackpot/declare', { date }, { headers });
      setSuccess(
        `Declared ${data?.summary?.winnersCount || 0}W / ${data?.summary?.losersCount || 0}L. Paid ${inr(
          data?.summary?.totalPaidOut,
          2
        )}.`
      );
      await loadAll();
    } catch (e) {
      setError(e?.response?.data?.message || e.message || 'Declare failed');
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    if (!settingsDraft) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const { data } = await axios.patch(
        '/api/admin/btc-jackpot/settings',
        {
          enabled: !!settingsDraft.enabled,
          ticketPrice: Number(settingsDraft.ticketPrice),
          bidsPerDay: Number(settingsDraft.bidsPerDay),
          biddingStartTime: settingsDraft.biddingStartTime,
          biddingEndTime: settingsDraft.biddingEndTime,
          topWinners: Number(settingsDraft.topWinners),
          prizePercentages: Array.isArray(settingsDraft.prizePercentages)
            ? settingsDraft.prizePercentages.map((p) => ({
                rank: Number(p.rank),
                percent: Number(p.percent),
              }))
            : [],
          hierarchy: {
            subBrokerPercent: Number(settingsDraft.hierarchy?.subBrokerPercent) || 0,
            brokerPercent: Number(settingsDraft.hierarchy?.brokerPercent) || 0,
            adminPercent: Number(settingsDraft.hierarchy?.adminPercent) || 0,
          },
          referralDistribution: {
            winPercent: Number(settingsDraft.referralDistribution?.winPercent) || 0,
            topRanksOnly: !!settingsDraft.referralDistribution?.topRanksOnly,
            topRanksCount: Number(settingsDraft.referralDistribution?.topRanksCount) || 0,
          },
        },
        { headers }
      );
      setSuccess('Settings saved');
      const saved = data?.btcJackpot || null;
      setSettings(saved);
      setSettingsDraft(saved);
      if (typeof onSettingsSaved === 'function') onSettingsSaved();
    } catch (e) {
      setError(e?.response?.data?.message || e.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const updatePrizePct = (rank, percent) => {
    setSettingsDraft((s) => {
      if (!s) return s;
      const ladder = Array.isArray(s.prizePercentages) ? [...s.prizePercentages] : [];
      const idx = ladder.findIndex((p) => Number(p.rank) === Number(rank));
      if (idx >= 0) ladder[idx] = { ...ladder[idx], percent: Number(percent) };
      else ladder.push({ rank: Number(rank), percent: Number(percent) });
      ladder.sort((a, b) => (Number(a.rank) || 0) - (Number(b.rank) || 0));
      return { ...s, prizePercentages: ladder };
    });
  };

  const totalPrizePct = useMemo(() => {
    const arr = settingsDraft?.prizePercentages || [];
    return arr.reduce((s, r) => s + (Number(r.percent) || 0), 0);
  }, [settingsDraft]);

  /** Superadmin list: only the prize-relevant head of the leaderboard (same as configured top winners). */
  const bidListCap = Math.max(1, Math.min(100, Number(settings?.topWinners ?? settingsDraft?.topWinners) || 20));
  const bidsDisplayed = useMemo(() => bids.slice(0, bidListCap), [bids, bidListCap]);

  if (!adminToken) {
    return (
      <div className="p-6 text-gray-400 flex items-center gap-2">
        <AlertCircle size={16} /> Admin token missing
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 font-semibold text-yellow-400">
          <Bitcoin size={20} /> BTC Jackpot — Admin
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-xs text-gray-400">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-2 py-1 rounded bg-dark-900 border border-dark-600 text-white text-sm"
          />
          <button
            onClick={loadAll}
            disabled={loading}
            className="px-3 py-1 text-sm bg-dark-700 hover:bg-dark-600 rounded flex items-center gap-1 disabled:opacity-60"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {(error || success) && (
        <div
          className={`rounded p-3 text-sm flex items-center gap-2 ${
            error
              ? 'bg-red-900/30 border border-red-500/40 text-red-300'
              : 'bg-green-900/30 border border-green-500/40 text-green-300'
          }`}
        >
          {error ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
          {error || success}
        </div>
      )}

      {/* Price lock + declare */}
      <div className="bg-dark-800 border border-dark-600 rounded p-4">
        <div className="flex items-center gap-2 mb-3 font-semibold">
          <Lock size={16} className="text-yellow-400" /> Result Controls
        </div>
        <div className="grid md:grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-xs text-gray-400">Locked BTC close</div>
            <div className="text-lg font-bold">
              {locked?.lockedBtcPrice != null ? `$${inr(locked.lockedBtcPrice, 2)}` : '— not locked —'}
            </div>
            <div className="text-[11px] text-gray-500">
              {locked?.lockedAt ? new Date(locked.lockedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : ''}
              {locked?.lockedSource ? ` · ${locked.lockedSource}` : ''}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-400">Total Bids Today</div>
            <div className="text-lg font-bold">{bids.length}</div>
            <div className="text-[11px] text-gray-500">
              Bank {inr(bank?.bank?.totalStake || 0, 2)} · Paid {inr(bank?.bank?.totalPaidOut || 0, 2)}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-400">Status</div>
            <div className="text-lg font-bold">
              {locked?.resultDeclared ? (
                <span className="text-green-400">DECLARED</span>
              ) : locked?.lockedBtcPrice ? (
                <span className="text-yellow-400">LOCKED — ready to declare</span>
              ) : (
                <span className="text-gray-400">PENDING</span>
              )}
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-3 mt-4">
          <div className="bg-dark-900 border border-dark-600 rounded p-3">
            <div className="text-xs text-gray-400 mb-2">Manual BTC price override</div>
            <div className="flex gap-2">
              <input
                type="number"
                step="0.01"
                min="1"
                value={manualPrice}
                onChange={(e) => setManualPrice(e.target.value)}
                placeholder="e.g. 92850.50"
                className="flex-1 px-3 py-2 rounded bg-dark-800 border border-dark-600 outline-none text-white"
                disabled={busy || locked?.resultDeclared}
              />
              <button
                onClick={() => lockPrice(true)}
                disabled={busy || locked?.resultDeclared || !manualPrice}
                className="px-3 py-2 rounded bg-yellow-500 text-black font-semibold disabled:opacity-60"
              >
                <Lock size={14} className="inline mr-1" /> Lock
              </button>
            </div>
            <button
              onClick={() => lockPrice(false)}
              disabled={busy || locked?.resultDeclared}
              className="mt-2 text-xs text-gray-300 hover:text-white flex items-center gap-1"
            >
              <Unlock size={12} /> Auto-fetch from Binance spot instead
            </button>
          </div>

          <div className="bg-dark-900 border border-dark-600 rounded p-3">
            <div className="text-xs text-gray-400 mb-2">Declare result (manual override)</div>
            <button
              onClick={declare}
              disabled={busy || locked?.resultDeclared || !locked?.lockedBtcPrice}
              className="w-full px-3 py-2 rounded bg-green-500 text-white font-semibold disabled:opacity-60"
            >
              <Trophy size={14} className="inline mr-1" /> Declare &amp; Distribute
            </button>
            <div className="text-[11px] text-gray-500 mt-2">
              Scheduler auto-runs after today&apos;s bidding window ends (IST). If BTC Number is enabled too, the same job uses BTC Number&apos;s result time.
            </div>
          </div>
        </div>
      </div>

      {/* Bids table */}
      <div className="bg-dark-800 border border-dark-600 rounded p-4 overflow-x-auto">
        <div className="font-semibold mb-1">Bids for {date}</div>
        <div className="text-[11px] text-gray-500 mb-2">
          Showing top {bidListCap} by rank / distance
          {bids.length > bidListCap ? ` (${bids.length} total bids — list trimmed for display)` : ''}.
        </div>
        {(locked?.lockedBtcPrice != null && Number.isFinite(Number(locked.lockedBtcPrice))) ||
        bidsReferenceBtc != null ? (
          <div className="text-[11px] text-gray-500 mb-2">
            Distance = |predicted − reference|; reference BTC $
            {usd(
              locked?.lockedBtcPrice != null && Number.isFinite(Number(locked.lockedBtcPrice))
                ? locked.lockedBtcPrice
                : bidsReferenceBtc,
              2
            )}{' '}
            ({locked?.lockedBtcPrice != null ? 'locked' : 'live spot'}).
          </div>
        ) : null}
        {bids.length === 0 ? (
          <div className="text-gray-400 text-sm py-4">No bids placed.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 text-xs uppercase border-b border-dark-600">
                <th className="py-2 pr-2">User</th>
                <th className="py-2 pr-2">Predicted BTC</th>
                <th className="py-2 pr-2">Distance</th>
                <th className="py-2 pr-2">Amount</th>
                <th className="py-2 pr-2">Status</th>
                <th className="py-2 pr-2">Rank</th>
                <th className="py-2 pr-2">Prize</th>
                <th className="py-2 pr-2">Placed</th>
              </tr>
            </thead>
            <tbody>
              {bidsDisplayed.map((b) => (
                <tr key={b._id} className="border-b border-dark-700/60">
                  <td className="py-1 pr-2">
                    <div className="font-medium">{b.user?.username || '—'}</div>
                    <div className="text-[10px] text-gray-500">{b.user?.clientId || ''}</div>
                  </td>
                  <td className="py-1 pr-2">${usd(b.predictedBtc, 2)}</td>
                  <td className="py-1 pr-2 text-cyan-300/90 tabular-nums">
                    {b.distance != null && Number.isFinite(Number(b.distance)) ? `$${usd(b.distance, 2)}` : '—'}
                  </td>
                  <td className="py-1 pr-2">{inr(b.amount, 2)}</td>
                  <td className="py-1 pr-2">
                    <span
                      className={`text-[10px] uppercase px-2 py-0.5 rounded ${
                        b.status === 'won'
                          ? 'bg-green-500/20 text-green-300'
                          : b.status === 'lost'
                          ? 'bg-red-500/20 text-red-300'
                          : 'bg-yellow-500/20 text-yellow-300'
                      }`}
                    >
                      {b.status}
                    </span>
                  </td>
                  <td className="py-1 pr-2">{b.rank ?? '—'}</td>
                  <td className="py-1 pr-2">{b.prize ? `${inr(b.prize, 2)}` : '—'}</td>
                  <td className="py-1 pr-2 text-[11px] text-gray-400">{b.placedAtIst || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Settings form */}
      {settingsDraft && (
        <div className="bg-dark-800 border border-dark-600 rounded p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold">Game Configuration</div>
            <button
              onClick={saveSettings}
              disabled={busy}
              className="px-3 py-1 bg-yellow-500 text-black rounded text-sm font-semibold flex items-center gap-1 disabled:opacity-60"
            >
              <Save size={14} /> Save
            </button>
          </div>

          <div className="grid md:grid-cols-3 gap-3 text-sm">
            <label className="block">
              <span className="text-xs text-gray-400">Enabled</span>
              <select
                value={settingsDraft.enabled ? 'on' : 'off'}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, enabled: e.target.value === 'on' })}
                className="w-full mt-1 px-2 py-1 rounded bg-dark-900 border border-dark-600 text-white"
              >
                <option value="on">Enabled</option>
                <option value="off">Disabled</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-gray-400">Ticket Price ()</span>
              <input
                type="number"
                value={settingsDraft.ticketPrice}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, ticketPrice: e.target.value })}
                className="w-full mt-1 px-2 py-1 rounded bg-dark-900 border border-dark-600 text-white"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-400">Bids / Day</span>
              <input
                type="number"
                value={settingsDraft.bidsPerDay}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, bidsPerDay: e.target.value })}
                className="w-full mt-1 px-2 py-1 rounded bg-dark-900 border border-dark-600 text-white"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-400">Bidding Start (IST)</span>
              <input
                type="time"
                value={settingsDraft.biddingStartTime}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, biddingStartTime: e.target.value })}
                className="w-full mt-1 px-2 py-1 rounded bg-dark-900 border border-dark-600 text-white"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-400">Bidding End (IST)</span>
              <input
                type="time"
                value={settingsDraft.biddingEndTime}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, biddingEndTime: e.target.value })}
                className="w-full mt-1 px-2 py-1 rounded bg-dark-900 border border-dark-600 text-white"
              />
            </label>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-gray-400">
                Prize Ladder (sum: {totalPrizePct.toFixed(2)}% — keep at or under 100%)
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {(settingsDraft.prizePercentages || []).map((row) => (
                <div
                  key={row.rank}
                  className="flex items-center gap-2 bg-dark-900 border border-dark-600 rounded px-2 py-1"
                >
                  <span className="text-xs text-gray-400 w-10">#{row.rank}</span>
                  <input
                    type="number"
                    step="0.01"
                    value={row.percent}
                    onChange={(e) => updatePrizePct(row.rank, e.target.value)}
                    className="flex-1 px-1 py-0.5 bg-dark-800 border border-dark-700 rounded text-white text-sm"
                  />
                  <span className="text-xs text-gray-500">%</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-3 text-sm mt-4">
            <label className="block">
              <span className="text-xs text-gray-400">Sub-Broker %</span>
              <input
                type="number"
                step="0.01"
                value={settingsDraft.hierarchy?.subBrokerPercent || 0}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    hierarchy: { ...settingsDraft.hierarchy, subBrokerPercent: e.target.value },
                  })
                }
                className="w-full mt-1 px-2 py-1 rounded bg-dark-900 border border-dark-600 text-white"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-400">Broker %</span>
              <input
                type="number"
                step="0.01"
                value={settingsDraft.hierarchy?.brokerPercent || 0}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    hierarchy: { ...settingsDraft.hierarchy, brokerPercent: e.target.value },
                  })
                }
                className="w-full mt-1 px-2 py-1 rounded bg-dark-900 border border-dark-600 text-white"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-400">Admin %</span>
              <input
                type="number"
                step="0.01"
                value={settingsDraft.hierarchy?.adminPercent || 0}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    hierarchy: { ...settingsDraft.hierarchy, adminPercent: e.target.value },
                  })
                }
                className="w-full mt-1 px-2 py-1 rounded bg-dark-900 border border-dark-600 text-white"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
};

export default BtcJackpotAdminPanel;
