import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import axios from '../../../../config/axios';
import { useAuth } from '../../../../context/AuthContext';

const RESTRICTION_DENY_EXCHANGES = ['MCX', 'NFO', 'NSE', 'BSE', 'CDS', 'BFO', 'BINANCE', 'FOREX', 'CRYPTO'];

/** Canonical keys — must match server/gameRestrictionService HIERARCHY_BLOCKABLE_GAME_KEYS */
const RESTRICTION_DENY_GAMES = [
  { key: 'niftyUpDown', label: 'Nifty Up/Down' },
  { key: 'btcUpDown', label: 'BTC Up/Down' },
  { key: 'niftyNumber', label: 'Nifty Number' },
  { key: 'niftyBracket', label: 'Nifty Bracket' },
  { key: 'niftyJackpot', label: 'Nifty Jackpot' },
  { key: 'btcJackpot', label: 'BTC Jackpot' },
  { key: 'btcNumber', label: 'BTC Number' },
];

const denyInstrumentsCacheKey = (uiExchange, displaySegment) =>
  `${String(uiExchange || '').toUpperCase()}|${String(displaySegment || '').trim()}`;

const ToggleSwitch = ({ label, checked, onChange }) => (
  <div className="flex items-center justify-between py-2">
    <span className="text-sm text-gray-300">{label}</span>
    <button
      type="button"
      onClick={onChange}
      className={`relative w-12 h-6 rounded-full transition-colors ${checked ? 'bg-green-600' : 'bg-dark-600'}`}
    >
      <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'left-7' : 'left-1'}`} />
    </button>
  </div>
);

function denyInstrumentPickerToken(row, instruments) {
  const sym = String(row.symbol || '').trim();
  const ts = String(row.tradingSymbol || '').trim();
  if (!sym && !ts) return '';
  if (!instruments || instruments.length === 0) return '';
  const n = (s) => String(s || '').trim().toUpperCase();
  const hit = (instruments || []).find((i) => {
    const iSym = n(i.symbol);
    const iTs = n(i.tradingSymbol || i.symbol);
    if (ts && sym) return iSym === n(sym) && iTs === n(ts);
    if (sym) return iSym === n(sym);
    return iTs === n(ts);
  });
  return hit ? hit.token : '';
}

function initialRestrictionsFromAdmin(adminUser) {
  const r = adminUser?.restrictions;
  return {
    intradayLimit: r?.intradayLimit || '',
    carryforwardLimit: r?.carryforwardLimit || '',
    maxLot: r?.maxLot || '',
    minLot: r?.minLot || '',
    breakupQuantity: r?.breakupQuantity || '',
    maxPositionValue: r?.maxPositionValue || '',
    maxExposure: r?.maxExposure || '',
    allowIntraday: r?.allowIntraday ?? true,
    allowCarryforward: r?.allowCarryforward ?? true,
    allowShortSelling: r?.allowShortSelling ?? true,
    allowOptions: r?.allowOptions ?? true,
    allowFutures: r?.allowFutures ?? true,
    allowCommodity: r?.allowCommodity ?? true,
    allowCrypto: r?.allowCrypto ?? true,
    allowWithinLowHigh: r?.allowWithinLowHigh === true,
    instrumentDenylist: Array.isArray(r?.instrumentDenylist)
      ? r.instrumentDenylist.map((row) => ({
          exchange: row.exchange || 'MCX',
          segment: row.segment || '',
          symbol: row.symbol || '',
          tradingSymbol: row.tradingSymbol || '',
          allowWithinLowHigh: row.allowWithinLowHigh || false,
          blockOutsideLowHigh: row.blockOutsideLowHigh || false,
        }))
      : [],
    gameDenylist: Array.isArray(r?.gameDenylist)
      ? r.gameDenylist.filter((k) => typeof k === 'string' && k.trim())
      : [],
  };
}

const RestrictionModal = ({ admin, parentRestrictions, onSave, onClose, loading }) => {
  const { admin: authAdmin } = useAuth();
  const [restrictions, setRestrictions] = useState(() => initialRestrictionsFromAdmin(admin));

  const handleChange = (field, value) => {
    setRestrictions((prev) => ({ ...prev, [field]: value }));
  };

  const updateDenyRow = (idx, key, value) => {
    setRestrictions((prev) => {
      const next = [...(prev.instrumentDenylist || [])];
      next[idx] = { ...next[idx], [key]: value };
      return { ...prev, instrumentDenylist: next };
    });
  };

  const addDenyRow = () => {
    setRestrictions((prev) => ({
      ...prev,
      instrumentDenylist: [
        ...(prev.instrumentDenylist || []),
        {
          exchange: 'MCX',
          segment: '',
          symbol: '',
          tradingSymbol: '',
          allowWithinLowHigh: false,
          blockOutsideLowHigh: false,
        },
      ],
    }));
  };

  const removeDenyRow = (idx) => {
    setRestrictions((prev) => ({
      ...prev,
      instrumentDenylist: (prev.instrumentDenylist || []).filter((_, i) => i !== idx),
    }));
  };

  const toggleGameDeny = (gameKey) => {
    setRestrictions((prev) => {
      const cur = [...(prev.gameDenylist || [])];
      const i = cur.indexOf(gameKey);
      if (i >= 0) cur.splice(i, 1);
      else cur.push(gameKey);
      return { ...prev, gameDenylist: cur };
    });
  };

  const showHierarchyInstrumentDeny = !parentRestrictions;

  const [pickerSegmentsByExchange, setPickerSegmentsByExchange] = useState({});
  const [pickerInstrumentsCache, setPickerInstrumentsCache] = useState({});
  const [pickerSegmentsLoading, setPickerSegmentsLoading] = useState({});
  const [pickerInstrumentsLoading, setPickerInstrumentsLoading] = useState({});

  const denySegmentsLoadedRef = useRef(new Set());
  const denyInstrumentsLoadedRef = useRef(new Set());

  const denyInstrumentSyncKey = JSON.stringify(admin.restrictions?.instrumentDenylist ?? []);
  const denyGameSyncKey = JSON.stringify(admin.restrictions?.gameDenylist ?? []);

  useEffect(() => {
    setRestrictions(initialRestrictionsFromAdmin(admin));
  }, [admin._id, admin.updatedAt, denyInstrumentSyncKey, denyGameSyncKey]);

  useEffect(() => {
    denySegmentsLoadedRef.current.clear();
    denyInstrumentsLoadedRef.current.clear();
    setPickerSegmentsByExchange({});
    setPickerInstrumentsCache({});
  }, [admin._id, denyInstrumentSyncKey]);

  const patchDenyRow = (idx, patch) => {
    setRestrictions((prev) => {
      const next = [...(prev.instrumentDenylist || [])];
      next[idx] = { ...next[idx], ...patch };
      return { ...prev, instrumentDenylist: next };
    });
  };

  const loadSegmentsForExchange = async (uiExchange) => {
    if (!showHierarchyInstrumentDeny || !authAdmin?.token || !uiExchange) return;
    if (denySegmentsLoadedRef.current.has(uiExchange)) return;
    denySegmentsLoadedRef.current.add(uiExchange);
    setPickerSegmentsLoading((s) => ({ ...s, [uiExchange]: true }));
    try {
      const { data } = await axios.get(
        `/api/instruments/admin/restriction-deny-picker?exchange=${encodeURIComponent(uiExchange)}`,
        { headers: { Authorization: `Bearer ${authAdmin.token}` } }
      );
      const list = data.segments || [];
      setPickerSegmentsByExchange((prev) => ({ ...prev, [uiExchange]: list }));
      if (list.length === 0) {
        denySegmentsLoadedRef.current.delete(uiExchange);
      }
    } catch (err) {
      denySegmentsLoadedRef.current.delete(uiExchange);
      console.error(err);
      alert(err.response?.data?.message || 'Could not load segments');
      setPickerSegmentsByExchange((prev) => ({ ...prev, [uiExchange]: [] }));
    } finally {
      setPickerSegmentsLoading((s) => ({ ...s, [uiExchange]: false }));
    }
  };

  const loadInstrumentsForExchangeSegment = async (uiExchange, displaySegment) => {
    const key = denyInstrumentsCacheKey(uiExchange, displaySegment);
    if (!showHierarchyInstrumentDeny || !authAdmin?.token || !uiExchange || !displaySegment) return;
    if (denyInstrumentsLoadedRef.current.has(key)) return;
    denyInstrumentsLoadedRef.current.add(key);
    setPickerInstrumentsLoading((s) => ({ ...s, [key]: true }));
    try {
      const { data } = await axios.get(
        `/api/instruments/admin/restriction-deny-picker?exchange=${encodeURIComponent(uiExchange)}&displaySegment=${encodeURIComponent(displaySegment)}&includeExpired=1`,
        { headers: { Authorization: `Bearer ${authAdmin.token}` } }
      );
      const list = data.instruments || [];
      setPickerInstrumentsCache((prev) => ({ ...prev, [key]: list }));
    } catch (err) {
      denyInstrumentsLoadedRef.current.delete(key);
      console.error(err);
      alert(err.response?.data?.message || 'Could not load instruments');
      setPickerInstrumentsCache((prev) => ({ ...prev, [key]: [] }));
    } finally {
      setPickerInstrumentsLoading((s) => ({ ...s, [key]: false }));
    }
  };

  const denyPickerPrefetchSig = (restrictions.instrumentDenylist || [])
    .map((r) => `${r.exchange || ''}|${r.segment || ''}`)
    .join(';');

  useEffect(() => {
    if (!showHierarchyInstrumentDeny || !authAdmin?.token) return;
    const rows = restrictions.instrumentDenylist || [];
    rows.forEach((row) => {
      const ex = row.exchange;
      if (!ex) return;
      loadSegmentsForExchange(ex);
      if (row.segment) loadInstrumentsForExchangeSegment(ex, row.segment);
    });
  }, [showHierarchyInstrumentDeny, authAdmin?.token, admin._id, denyPickerPrefetchSig]);

  const handleSubmit = (e) => {
    e.preventDefault();

    // Validate against parent restrictions
    if (parentRestrictions) {
      if (parentRestrictions.intradayLimit && restrictions.intradayLimit > parentRestrictions.intradayLimit) {
        alert(`Intraday limit cannot exceed parent's limit of ${parentRestrictions.intradayLimit}`);
        return;
      }
      if (parentRestrictions.carryforwardLimit && restrictions.carryforwardLimit > parentRestrictions.carryforwardLimit) {
        alert(`Carryforward limit cannot exceed parent's limit of ${parentRestrictions.carryforwardLimit}`);
        return;
      }
      if (parentRestrictions.maxLot && restrictions.maxLot > parentRestrictions.maxLot) {
        alert(`Max lot cannot exceed parent's limit of ${parentRestrictions.maxLot}`);
        return;
      }
      if (parentRestrictions.minLot && restrictions.minLot < parentRestrictions.minLot) {
        alert(`Min lot cannot be less than parent's minimum of ${parentRestrictions.minLot}`);
        return;
      }
      if (parentRestrictions.breakupQuantity && restrictions.breakupQuantity > parentRestrictions.breakupQuantity) {
        alert(`Breakup quantity cannot exceed parent's limit of ${parentRestrictions.breakupQuantity}`);
        return;
      }
      if (parentRestrictions.maxPositionValue && restrictions.maxPositionValue > parentRestrictions.maxPositionValue) {
        alert(`Max position value cannot exceed parent's limit of ${parentRestrictions.maxPositionValue}`);
        return;
      }
      if (parentRestrictions.maxExposure && restrictions.maxExposure > parentRestrictions.maxExposure) {
        alert(`Max exposure cannot exceed parent's limit of ${parentRestrictions.maxExposure}`);
        return;
      }
    }

    onSave(restrictions);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold">
              Set Restrictions for {admin.name}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white"
            >
              <X size={24} />
            </button>
          </div>

          {parentRestrictions && (
            <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded">
              <p className="text-xs text-yellow-400">
                ⚠️ You cannot set restrictions that are less restrictive than your parent's restrictions.
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Limit Fields */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Intraday Limit (₹)</label>
                <input
                  type="number"
                  value={restrictions.intradayLimit}
                  onChange={(e) => handleChange('intradayLimit', parseFloat(e.target.value) || '')}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
                  placeholder="Enter limit"
                />
                {parentRestrictions?.intradayLimit && (
                  <p className="text-[10px] text-yellow-400 mt-1">Parent limit: {parentRestrictions.intradayLimit}</p>
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Carryforward Limit (₹)</label>
                <input
                  type="number"
                  value={restrictions.carryforwardLimit}
                  onChange={(e) => handleChange('carryforwardLimit', parseFloat(e.target.value) || '')}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
                  placeholder="Enter limit"
                />
                {parentRestrictions?.carryforwardLimit && (
                  <p className="text-[10px] text-yellow-400 mt-1">Parent limit: {parentRestrictions.carryforwardLimit}</p>
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Max Lot</label>
                <input
                  type="number"
                  value={restrictions.maxLot}
                  onChange={(e) => handleChange('maxLot', parseInt(e.target.value) || '')}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
                  placeholder="Enter max lot"
                />
                {parentRestrictions?.maxLot && (
                  <p className="text-[10px] text-yellow-400 mt-1">Parent limit: {parentRestrictions.maxLot}</p>
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Min Lot</label>
                <input
                  type="number"
                  value={restrictions.minLot}
                  onChange={(e) => handleChange('minLot', parseInt(e.target.value) || '')}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
                  placeholder="Enter min lot"
                />
                {parentRestrictions?.minLot && (
                  <p className="text-[10px] text-yellow-400 mt-1">Parent minimum: {parentRestrictions.minLot}</p>
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Breakup Quantity</label>
                <input
                  type="number"
                  value={restrictions.breakupQuantity}
                  onChange={(e) => handleChange('breakupQuantity', parseInt(e.target.value) || '')}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
                  placeholder="Enter breakup quantity"
                />
                {parentRestrictions?.breakupQuantity && (
                  <p className="text-[10px] text-yellow-400 mt-1">Parent limit: {parentRestrictions.breakupQuantity}</p>
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Max Position Value (₹)</label>
                <input
                  type="number"
                  value={restrictions.maxPositionValue}
                  onChange={(e) => handleChange('maxPositionValue', parseFloat(e.target.value) || '')}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
                  placeholder="Enter max position value"
                />
                {parentRestrictions?.maxPositionValue && (
                  <p className="text-[10px] text-yellow-400 mt-1">Parent limit: {parentRestrictions.maxPositionValue}</p>
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Max Exposure (₹)</label>
                <input
                  type="number"
                  value={restrictions.maxExposure}
                  onChange={(e) => handleChange('maxExposure', parseFloat(e.target.value) || '')}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
                  placeholder="Enter max exposure"
                />
                {parentRestrictions?.maxExposure && (
                  <p className="text-[10px] text-yellow-400 mt-1">Parent limit: {parentRestrictions.maxExposure}</p>
                )}
              </div>

              {/* Permission Toggles */}
              <div className="md:col-span-2">
                <h3 className="text-sm font-semibold text-gray-300 mb-3">Trading Permissions</h3>
              </div>

              <div className="flex items-center justify-between p-3 bg-dark-700 rounded">
                <span className="text-sm">Allow Intraday</span>
                <input
                  type="checkbox"
                  checked={restrictions.allowIntraday}
                  onChange={(e) => handleChange('allowIntraday', e.target.checked)}
                  className="w-5 h-5 rounded"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-dark-700 rounded">
                <span className="text-sm">Allow Carryforward</span>
                <input
                  type="checkbox"
                  checked={restrictions.allowCarryforward}
                  onChange={(e) => handleChange('allowCarryforward', e.target.checked)}
                  className="w-5 h-5 rounded"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-dark-700 rounded">
                <span className="text-sm">Allow Short Selling</span>
                <input
                  type="checkbox"
                  checked={restrictions.allowShortSelling}
                  onChange={(e) => handleChange('allowShortSelling', e.target.checked)}
                  className="w-5 h-5 rounded"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-dark-700 rounded">
                <span className="text-sm">Allow Options</span>
                <input
                  type="checkbox"
                  checked={restrictions.allowOptions}
                  onChange={(e) => handleChange('allowOptions', e.target.checked)}
                  className="w-5 h-5 rounded"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-dark-700 rounded">
                <span className="text-sm">Allow Futures</span>
                <input
                  type="checkbox"
                  checked={restrictions.allowFutures}
                  onChange={(e) => handleChange('allowFutures', e.target.checked)}
                  className="w-5 h-5 rounded"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-dark-700 rounded">
                <span className="text-sm">Allow Commodity</span>
                <input
                  type="checkbox"
                  checked={restrictions.allowCommodity}
                  onChange={(e) => handleChange('allowCommodity', e.target.checked)}
                  className="w-5 h-5 rounded"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-dark-700 rounded">
                <span className="text-sm">Allow Crypto</span>
                <input
                  type="checkbox"
                  checked={restrictions.allowCrypto}
                  onChange={(e) => handleChange('allowCrypto', e.target.checked)}
                  className="w-5 h-5 rounded"
                />
              </div>
            </div>

            {showHierarchyInstrumentDeny && (
              <div className="mt-6 border border-dark-600 rounded-lg p-4 bg-dark-900/40">
                <h3 className="text-sm font-semibold text-gray-200 mb-1">
                  Instrument deny-list (hierarchy)
                </h3>
                <p className="text-xs text-gray-400 mb-4">
                  Choose exchange, then segment (same tabs as Market Watch). Instruments load from the database for that tab.
                  Pick a contract from the list, or Custom to type symbol / trading symbol. Saved values are uppercase.
                </p>
                {(restrictions.instrumentDenylist || []).length === 0 ? (
                  <p className="text-sm text-gray-500 mb-3">No deny rules. Add a row to block specific instruments.</p>
                ) : (
                  <div className="space-y-3 mb-3">
                    {(restrictions.instrumentDenylist || []).map((row, idx) => {
                      const segments = pickerSegmentsByExchange[row.exchange] || [];
                      const instMapKey = denyInstrumentsCacheKey(row.exchange, row.segment);
                      const instruments = pickerInstrumentsCache[instMapKey];
                      const segLoading = pickerSegmentsLoading[row.exchange];
                      const insLoading = pickerInstrumentsLoading[instMapKey];
                      const instrumentPickValue = denyInstrumentPickerToken(row, instruments || []);

                      return (
                        <div
                          key={idx}
                          className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end p-3 bg-dark-700 rounded-lg"
                        >
                          <div className="md:col-span-2">
                            <label className="block text-xs text-gray-400 mb-1">Exchange</label>
                            <select
                              value={row.exchange || 'MCX'}
                              onChange={(e) => {
                                const ex = e.target.value;
                                patchDenyRow(idx, {
                                  exchange: ex,
                                  segment: '',
                                  symbol: '',
                                  tradingSymbol: '',
                                });
                                loadSegmentsForExchange(ex);
                              }}
                              className="w-full bg-dark-600 border border-dark-500 rounded px-2 py-2 text-sm"
                            >
                              {RESTRICTION_DENY_EXCHANGES.map((ex) => (
                                <option key={ex} value={ex}>
                                  {ex}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="md:col-span-3">
                            <label className="block text-xs text-gray-400 mb-1">Segment (tab)</label>
                            <select
                              value={row.segment || ''}
                              disabled={segLoading}
                              onChange={(e) => {
                                const seg = e.target.value;
                                patchDenyRow(idx, {
                                  segment: seg,
                                  symbol: '',
                                  tradingSymbol: '',
                                });
                                if (seg) loadInstrumentsForExchangeSegment(row.exchange, seg);
                              }}
                              className="w-full bg-dark-600 border border-dark-500 rounded px-2 py-2 text-sm disabled:opacity-50"
                            >
                              <option value="">{segLoading ? 'Loading…' : 'Select segment…'}</option>
                              {segments.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="md:col-span-5">
                            <label className="block text-xs text-gray-400 mb-1">Instrument</label>
                            <select
                              value={instrumentPickValue}
                              disabled={!row.segment || insLoading}
                              onChange={(e) => {
                                const v = e.target.value;
                                const list = pickerInstrumentsCache[instMapKey] || [];
                                if (v === '') {
                                  patchDenyRow(idx, { symbol: '', tradingSymbol: '' });
                                } else {
                                  const inst = list.find((i) => i.token === v);
                                  if (inst) {
                                    patchDenyRow(idx, {
                                      exchange: inst.exchange || row.exchange,
                                      segment: inst.displaySegment || row.segment || '',
                                      symbol: inst.symbol || '',
                                      tradingSymbol: inst.tradingSymbol || inst.symbol || '',
                                    });
                                  }
                                }
                              }}
                              className="w-full bg-dark-600 border border-dark-500 rounded px-2 py-2 text-sm disabled:opacity-50"
                            >
                              <option value="">
                                {!row.segment
                                  ? 'Select segment first'
                                  : insLoading
                                    ? 'Loading instruments…'
                                    : 'Select instrument…'}
                              </option>
                              {(instruments || []).map((inst) => {
                                const ts = inst.tradingSymbol || inst.symbol || '';
                                const label = `${inst.symbol || ''}${ts && ts !== inst.symbol ? ` — ${ts}` : ''}${inst.name ? ` (${inst.name})` : ''}`;
                                const short =
                                  label.length > 96 ? `${label.slice(0, 93)}…` : label;
                                return (
                                  <option key={inst.token} value={inst.token}>
                                    {short}
                                  </option>
                                );
                              })}
                            </select>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                              <div>
                                <label className="block text-[10px] text-gray-500 mb-0.5">
                                  Symbol (editable)
                                </label>
                                <input
                                  type="text"
                                  placeholder="e.g. GOLD"
                                  value={row.symbol || ''}
                                  onChange={(e) => updateDenyRow(idx, 'symbol', e.target.value)}
                                  className="w-full bg-dark-600 border border-dark-500 rounded px-2 py-1.5 text-xs"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] text-gray-500 mb-0.5">
                                  Trading symbol (editable)
                                </label>
                                <input
                                  type="text"
                                  placeholder="Exact token"
                                  value={row.tradingSymbol || ''}
                                  onChange={(e) =>
                                    updateDenyRow(idx, 'tradingSymbol', e.target.value)
                                  }
                                  className="w-full bg-dark-600 border border-dark-500 rounded px-2 py-1.5 text-xs"
                                />
                              </div>
                            </div>
                          </div>

                          <div className="md:col-span-2 flex justify-end items-end">
                            <button
                              type="button"
                              onClick={() => removeDenyRow(idx)}
                              className="px-3 py-2 text-sm bg-red-900/50 hover:bg-red-800/60 rounded text-red-200"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <button
                  type="button"
                  onClick={addDenyRow}
                  className="px-3 py-2 text-sm bg-dark-600 hover:bg-dark-500 rounded border border-dark-500"
                >
                  + Add deny rule
                </button>

                {authAdmin?.role === 'SUPER_ADMIN' && (
                <div className="mt-6 pt-4 border-t border-dark-600">
                  <h3 className="text-sm font-semibold text-gray-200 mb-1">Game deny-list (hierarchy)</h3>
                  <p className="text-xs text-gray-400 mb-3">
                    Checked games are blocked for this admin and everyone below them in the hierarchy.
                    Removing a check restores access unless an ancestor still blocks that game.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {RESTRICTION_DENY_GAMES.map(({ key, label }) => (
                      <label
                        key={key}
                        className="flex items-center gap-2 p-2 bg-dark-700 rounded cursor-pointer hover:bg-dark-600/70"
                      >
                        <input
                          type="checkbox"
                          checked={(restrictions.gameDenylist || []).includes(key)}
                          onChange={() => toggleGameDeny(key)}
                          className="w-4 h-4 rounded"
                        />
                        <span className="text-sm text-gray-200">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-dark-700 hover:bg-dark-600 rounded"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Save Restrictions'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default RestrictionModal;
