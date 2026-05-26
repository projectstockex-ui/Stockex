import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import axios from '../../../config/axios.js';
import AdminSegmentDefaultsFields from './AdminSegmentDefaultsFields.jsx';
import { resolveInstrumentAdminSegmentKey } from './instrumentSegmentKey.js';
import { instrumentToSegmentProfileSlice } from './instrumentRulesProfile.js';

/**
 * Per-instrument Rules: LTP bracket (add-on) + leverage, brokerage/crore, qty limits, autosquare.
 */
export default function InstrumentRulesModal({ instrument, adminToken, onClose, onSaved }) {
  const [percentUp, setPercentUp] = useState('');
  const [percentDown, setPercentDown] = useState('');
  const [overridesEnabled, setOverridesEnabled] = useState(false);
  const [profile, setProfile] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const segmentKey = useMemo(
    () => (instrument ? resolveInstrumentAdminSegmentKey(instrument) : 'NSEFUT'),
    [instrument]
  );

  useEffect(() => {
    if (!instrument) return;
    const u = instrument.ltpBracketPercentUp;
    const d = instrument.ltpBracketPercentDown;
    setPercentUp(u != null && u !== '' ? String(u) : '');
    setPercentDown(d != null && d !== '' ? String(d) : '');
    setOverridesEnabled(!!instrument.tradingDefaults?.enabled);
    setProfile(instrumentToSegmentProfileSlice(instrument));
    setError('');
  }, [instrument?._id, instrument?.ltpBracketPercentUp, instrument?.ltpBracketPercentDown, instrument?.tradingDefaults]);

  const ltp = Number(instrument?.ltp) || 0;
  const preview = useMemo(() => {
    const up = parseFloat(percentUp);
    const down = parseFloat(percentDown);
    if (ltp <= 0 || !Number.isFinite(up) || up <= 0 || !Number.isFinite(down) || down <= 0) {
      return null;
    }
    return {
      lower: ltp * (1 - down / 100),
      upper: ltp * (1 + up / 100),
    };
  }, [ltp, percentUp, percentDown]);

  const handleSave = async () => {
    if (!adminToken || !instrument?._id) return;
    setSaving(true);
    setError('');
    try {
      const body = {
        ltpBracketPercentUp: percentUp.trim() === '' ? null : parseFloat(percentUp),
        ltpBracketPercentDown: percentDown.trim() === '' ? null : parseFloat(percentDown),
        tradingDefaults: {
          enabled: overridesEnabled,
          blockTrading: !!instrument.tradingDefaults?.blockTrading,
          notes: typeof instrument.tradingDefaults?.notes === 'string' ? instrument.tradingDefaults.notes : '',
          segmentProfile: JSON.parse(JSON.stringify(profile)),
        },
      };
      if (
        body.ltpBracketPercentUp != null &&
        (!Number.isFinite(body.ltpBracketPercentUp) ||
          body.ltpBracketPercentUp < 0 ||
          body.ltpBracketPercentUp > 100)
      ) {
        setError('% up must be between 0 and 100');
        setSaving(false);
        return;
      }
      if (
        body.ltpBracketPercentDown != null &&
        (!Number.isFinite(body.ltpBracketPercentDown) ||
          body.ltpBracketPercentDown < 0 ||
          body.ltpBracketPercentDown > 100)
      ) {
        setError('% down must be between 0 and 100');
        setSaving(false);
        return;
      }
      const { data } = await axios.put(`/api/instruments/admin/${instrument._id}`, body, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      onSaved?.(data);
      onClose?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!instrument) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70"
      onClick={onClose}
    >
      <div
        className="bg-dark-800 border border-dark-600 rounded-xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-dark-600 flex items-start justify-between gap-3 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-white">Rules — {instrument.symbol}</h2>
            <p className="text-xs text-gray-500 mt-1">
              {segmentKey} · {instrument.exchange} · Lot {instrument.lotSize || 1}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white p-1">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5 text-sm">
          <section className="rounded-lg border border-amber-600/40 bg-amber-950/30 p-3 space-y-3">
            <h3 className="text-sm font-semibold text-amber-200">LTP bracket (add-on)</h3>
            <p className="text-[11px] text-gray-500">
              Sirf un users par jinhone is range ke andar trade kiya. Khali = off.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-gray-400">
                % up from LTP
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={percentUp}
                  onChange={(e) => setPercentUp(e.target.value)}
                  placeholder="5"
                  className="mt-1 w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-gray-400">
                % down from LTP
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={percentDown}
                  onChange={(e) => setPercentDown(e.target.value)}
                  placeholder="5"
                  className="mt-1 w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm"
                />
              </label>
            </div>
            {ltp > 0 ? (
              <p className="text-xs text-gray-500">
                LTP: <span className="font-mono text-gray-300">{ltp.toLocaleString()}</span>
              </p>
            ) : null}
            {preview ? (
              <p className="text-xs text-amber-200/90 font-mono">
                Range: {preview.lower.toFixed(2)} – {preview.upper.toFixed(2)}
              </p>
            ) : null}
          </section>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={overridesEnabled}
              onChange={(e) => setOverridesEnabled(e.target.checked)}
            />
            <span className="text-gray-200">Enable per-instrument rules (leverage, brokerage, qty, autosquare)</span>
          </label>

          {overridesEnabled ? (
            <section className="border-t border-dark-600 pt-4">
              <p className="text-[11px] text-gray-500 mb-3">
                Lot / Qty toggle: leverage intraday & carry, max/min/breakup qty, brokerage per crore, autosquare %.
              </p>
              <AdminSegmentDefaultsFields
                segmentKey={segmentKey}
                slice={profile}
                onChange={setProfile}
              />
            </section>
          ) : (
            <p className="text-xs text-gray-500 italic">
              Tick enable above to set Bank Nifty / contract leverage, brokerage, max qty, min qty, break qty, autosquare.
            </p>
          )}

          {error ? <p className="text-xs text-red-400">{error}</p> : null}
        </div>

        <div className="p-4 border-t border-dark-600 flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-dark-700 hover:bg-dark-600 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save rules'}
          </button>
        </div>
      </div>
    </div>
  );
}
