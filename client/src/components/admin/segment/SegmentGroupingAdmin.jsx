import React, { useCallback, useEffect, useState } from 'react';
import axios from '../../../config/axios';
import {
  ChevronDown,
  ChevronRight,
  FolderTree,
  Layers,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';

const MARKET_SEGMENTS = [
  'NSEFUT',
  'NSEOPT',
  'MCXFUT',
  'MCXOPT',
  'NSE-EQ',
  'BSE-FUT',
  'BSE-OPT',
  'FOREXFUT',
  'FOREXOPT',
  'CRYPTOFUT',
  'CRYPTOOPT',
];

const SEGMENT_LABELS = {
  NSEFUT: 'NSE Futures',
  NSEOPT: 'NSE Options',
  MCXFUT: 'MCX Futures',
  MCXOPT: 'MCX Options',
  'NSE-EQ': 'NSE Equity',
  'BSE-FUT': 'BSE Futures',
  'BSE-OPT': 'BSE Options',
  FOREXFUT: 'Forex Futures',
  FOREXOPT: 'Forex Options',
  CRYPTOFUT: 'Crypto Futures',
  CRYPTOOPT: 'Crypto Options',
};

function emptyGroup(sortOrder) {
  return {
    key: `custom_${Date.now()}`,
    label: 'New group',
    sortOrder,
    groupType: 'custom',
    underlyings: [],
    enabled: true,
    allowClientTrading: true,
    allowWithinLowHigh: false,
    enableLtpBracket: false,
    ltpBracketPercentUp: 5,
    ltpBracketPercentDown: 5,
    instruments: [],
    instrumentCount: 0,
  };
}

function GroupClientTradingToggle({ checked, onChange }) {
  return (
    <div
      className="flex flex-col items-center gap-0.5 shrink-0"
      title="ON: users can open new positions in this group. OFF: new trades blocked (existing positions can still be closed)."
    >
      <span className="text-[9px] text-gray-500 text-center leading-tight max-w-[4.5rem]">
        Client trading
      </span>
      <button
        type="button"
        onClick={onChange}
        className={`relative w-10 h-5 rounded-full transition-colors ${checked ? 'bg-green-600' : 'bg-red-700'}`}
        aria-pressed={checked}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'left-5' : 'left-0.5'}`}
        />
      </button>
      <span className={`text-[9px] font-medium ${checked ? 'text-green-400' : 'text-red-400'}`}>
        {checked ? 'ON' : 'OFF'}
      </span>
    </div>
  );
}

function GroupLtpBracketToggle({ checked, onChange }) {
  return (
    <div
      className="flex flex-col items-center gap-0.5 shrink-0"
      title="ON: order price must stay within live LTP ±% for all instruments in this group"
    >
      <span className="text-[9px] text-gray-500 text-center leading-tight max-w-[4.5rem]">
        LTP ±%
      </span>
      <button
        type="button"
        onClick={onChange}
        className={`relative w-10 h-5 rounded-full transition-colors ${checked ? 'bg-green-600' : 'bg-dark-500'}`}
        aria-pressed={checked}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'left-5' : 'left-0.5'}`}
        />
      </button>
      <span className={`text-[9px] font-medium ${checked ? 'text-green-400' : 'text-gray-500'}`}>
        {checked ? 'ON' : 'OFF'}
      </span>
    </div>
  );
}

function GroupLowHighToggle({ checked, onChange }) {
  return (
    <div
      className="flex flex-col items-center gap-0.5 shrink-0"
      title="ON: trade only between day low and high for instruments in this group"
    >
      <span className="text-[9px] text-gray-500 text-center leading-tight max-w-[4.5rem]">
        Low–High only
      </span>
      <button
        type="button"
        onClick={onChange}
        className={`relative w-10 h-5 rounded-full transition-colors ${checked ? 'bg-green-600' : 'bg-dark-500'}`}
        aria-pressed={checked}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'left-5' : 'left-0.5'}`}
        />
      </button>
      <span className={`text-[9px] font-medium ${checked ? 'text-green-400' : 'text-gray-500'}`}>
        {checked ? 'ON' : 'OFF'}
      </span>
    </div>
  );
}

export default function SegmentGroupingAdmin() {
  const [activeSegment, setActiveSegment] = useState('NSEFUT');
  const [overview, setOverview] = useState([]);
  const [detail, setDetail] = useState(null);
  const [groups, setGroups] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadOverview = useCallback(async () => {
    const { data } = await axios.get('/api/admin/manage/segment-grouping');
    setOverview(data.segments || []);
  }, []);

  const loadDetail = useCallback(async (seg) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get(`/api/admin/manage/segment-grouping/${seg}`);
      setDetail(data);
      setGroups(
        (data.groups || []).map((g) => ({
          ...g,
          underlyings: [...(g.underlyings || [])],
        }))
      );
      const exp = {};
      for (const g of data.groups || []) exp[g.key] = true;
      setExpanded(exp);
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Failed to load');
      setDetail(null);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview().catch(() => {});
  }, [loadOverview]);

  useEffect(() => {
    loadDetail(activeSegment);
  }, [activeSegment, loadDetail]);

  const toggleExpand = (key) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const updateGroup = (idx, patch) => {
    setGroups((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  const addGroup = () => {
    setGroups((prev) => [...prev, emptyGroup(prev.length)]);
  };

  const removeGroup = (idx) => {
    setGroups((prev) => prev.filter((_, i) => i !== idx));
  };

  const addUnderlying = (idx, raw) => {
    const u = String(raw || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9&]/g, '');
    if (!u) return;
    setGroups((prev) => {
      const next = [...prev];
      const list = [...(next[idx].underlyings || [])];
      if (!list.includes(u)) list.push(u);
      next[idx] = { ...next[idx], underlyings: list };
      return next;
    });
  };

  const removeUnderlying = (gIdx, uIdx) => {
    setGroups((prev) => {
      const next = [...prev];
      const list = [...(next[gIdx].underlyings || [])];
      list.splice(uIdx, 1);
      next[gIdx] = { ...next[gIdx], underlyings: list };
      return next;
    });
  };

  const handleSeed = async () => {
    setSaving(true);
    setError('');
    try {
      const { data } = await axios.post(
        `/api/admin/manage/segment-grouping/${activeSegment}/seed-defaults`
      );
      setDetail(data);
      setGroups(
        (data.groups || []).map((g) => ({
          ...g,
          underlyings: [...(g.underlyings || [])],
        }))
      );
      await loadOverview();
    } catch (e) {
      setError(e.response?.data?.message || 'Seed failed');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = groups.map((g, idx) => ({
        key: g.key,
        label: g.label,
        sortOrder: g.sortOrder ?? idx,
        groupType: g.groupType || 'custom',
        underlyings: g.underlyings || [],
        enabled: g.enabled !== false,
        allowClientTrading: g.allowClientTrading !== false,
        allowWithinLowHigh: !!g.allowWithinLowHigh,
        enableLtpBracket: !!g.enableLtpBracket,
        ltpBracketPercentUp:
          g.enableLtpBracket && Number(g.ltpBracketPercentUp) > 0
            ? Number(g.ltpBracketPercentUp)
            : 5,
        ltpBracketPercentDown:
          g.enableLtpBracket && Number(g.ltpBracketPercentDown) > 0
            ? Number(g.ltpBracketPercentDown)
            : 5,
      }));
      const { data } = await axios.put(`/api/admin/manage/segment-grouping/${activeSegment}`, {
        groups: payload,
      });
      setDetail(data);
      setGroups(
        (data.groups || []).map((g) => ({
          ...g,
          underlyings: [...(g.underlyings || [])],
        }))
      );
      await loadOverview();
    } catch (e) {
      setError(e.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const meta = overview.find((s) => s.displaySegment === activeSegment);
  const ungroupedCount = detail?.ungrouped?.length ?? 0;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <FolderTree className="text-amber-400" size={28} />
            Grouping of Segments
          </h1>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Organise instruments under each market segment (NSEFUT, NSEOPT, MCXFUT, …).{' '}
            <strong className="text-gray-300">Client trading OFF</strong> blocks new positions for that
            group; <strong className="text-gray-300">Group active</strong> only controls this admin list.
            <strong className="text-gray-300"> Low–High only</strong> restricts order price to the day range.{' '}
            <strong className="text-gray-300">LTP ±%</strong> keeps orders within live LTP up/down % for the whole group.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => loadDetail(activeSegment)}
            disabled={loading || saving}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-dark-700 border border-dark-600 text-sm text-gray-200 hover:bg-dark-600 disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            type="button"
            onClick={handleSeed}
            disabled={saving}
            className="px-3 py-2 rounded-lg bg-dark-700 border border-amber-600/50 text-amber-300 text-sm hover:bg-dark-600 disabled:opacity-50"
          >
            Seed defaults
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-200 text-sm">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 mb-6">
        {MARKET_SEGMENTS.map((seg) => {
          const ov = overview.find((s) => s.displaySegment === seg);
          const active = activeSegment === seg;
          return (
            <button
              key={seg}
              type="button"
              onClick={() => setActiveSegment(seg)}
              className={`px-3 py-2 rounded-lg text-xs font-semibold border transition ${
                active
                  ? 'bg-amber-600/90 border-amber-500 text-white'
                  : 'bg-dark-800 border-dark-600 text-gray-400 hover:border-dark-500'
              }`}
            >
              <span className="block">{seg}</span>
              <span className={`block text-[10px] mt-0.5 ${active ? 'text-amber-100' : 'text-gray-500'}`}>
                {SEGMENT_LABELS[seg] || seg}
                {ov?.groupCount ? ` · ${ov.groupCount} groups` : ''}
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-dark-600 bg-dark-800/80 p-4 mb-4">
        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-300">
          <span className="flex items-center gap-2">
            <Layers size={16} className="text-amber-400" />
            <strong className="text-white">{activeSegment}</strong>
            <span className="text-gray-500">({SEGMENT_LABELS[activeSegment]})</span>
          </span>
          {detail ? (
            <>
              <span>{detail.totalInstruments ?? 0} instruments</span>
              <span>{groups.length} groups</span>
              {ungroupedCount > 0 ? (
                <span className="text-amber-400">{ungroupedCount} ungrouped</span>
              ) : null}
              {detail.isDraft ? (
                <span className="text-xs px-2 py-0.5 rounded bg-amber-900/40 text-amber-200">
                  Preview — click Seed or Save to persist
                </span>
              ) : null}
              {meta?.hasConfig ? (
                <span className="text-xs text-green-400">Saved config</span>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-500">Loading groups…</div>
      ) : (
        <div className="space-y-3">
          {groups.map((g, gIdx) => {
            const isOpen = expanded[g.key] !== false;
            const liveInstruments = detail?.groups?.find((x) => x.key === g.key)?.instruments;
            const instruments = liveInstruments || g.instruments || [];
            const count = instruments.length || g.instrumentCount || 0;

            return (
              <div
                key={g.key || gIdx}
                className="rounded-xl border border-dark-600 bg-dark-800 overflow-hidden"
              >
                <div className="flex flex-wrap items-center gap-2 p-3 bg-dark-700/80">
                  <button
                    type="button"
                    onClick={() => toggleExpand(g.key)}
                    className="p-1 text-gray-400 hover:text-white"
                  >
                    {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </button>
                  <input
                    type="text"
                    value={g.label || ''}
                    onChange={(e) => updateGroup(gIdx, { label: e.target.value })}
                    className="flex-1 min-w-[140px] bg-dark-600 border border-dark-500 rounded px-2 py-1.5 text-sm text-white font-semibold"
                    placeholder="Group name (e.g. Banking)"
                  />
                  <span className="text-xs text-gray-500 font-mono">{g.key}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-dark-600 text-gray-300">
                    {count} instrument{count !== 1 ? 's' : ''}
                  </span>
                  <label
                    className="flex items-center gap-1.5 text-xs text-gray-400 ml-auto"
                    title="Include this group in the segment list (does not block client trading by itself)"
                  >
                    <input
                      type="checkbox"
                      checked={g.enabled !== false}
                      onChange={(e) => updateGroup(gIdx, { enabled: e.target.checked })}
                      className="rounded"
                    />
                    Group active
                  </label>
                  <GroupClientTradingToggle
                    checked={g.allowClientTrading !== false}
                    onChange={() =>
                      updateGroup(gIdx, {
                        allowClientTrading: g.allowClientTrading === false,
                      })
                    }
                  />
                  <button
                    type="button"
                    onClick={() => removeGroup(gIdx)}
                    className="p-2 text-red-400 hover:bg-red-900/30 rounded"
                    title="Remove group"
                  >
                    <Trash2 size={16} />
                  </button>
                  <GroupLowHighToggle
                    checked={!!g.allowWithinLowHigh}
                    onChange={() =>
                      updateGroup(gIdx, { allowWithinLowHigh: !g.allowWithinLowHigh })
                    }
                  />
                  <GroupLtpBracketToggle
                    checked={!!g.enableLtpBracket}
                    onChange={() =>
                      updateGroup(gIdx, {
                        enableLtpBracket: !g.enableLtpBracket,
                        ltpBracketPercentUp: g.ltpBracketPercentUp ?? 5,
                        ltpBracketPercentDown: g.ltpBracketPercentDown ?? 5,
                      })
                    }
                  />
                </div>

                {isOpen ? (
                  <div className="p-4 border-t border-dark-600 space-y-4">
                    {g.enableLtpBracket ? (
                      <div className="flex flex-wrap items-end gap-3 p-3 rounded-lg bg-amber-900/20 border border-amber-700/40">
                        <p className="text-xs text-amber-200 w-full">
                          LTP bracket applies to <strong>all users</strong> and every instrument in this group.
                          Order/limit price must stay within live LTP ±%.
                        </p>
                        <label className="text-xs text-gray-400">
                          % Up
                          <input
                            type="number"
                            min="0.01"
                            max="100"
                            step="0.01"
                            value={g.ltpBracketPercentUp ?? 5}
                            onChange={(e) =>
                              updateGroup(gIdx, { ltpBracketPercentUp: parseFloat(e.target.value) || 5 })
                            }
                            className="block mt-1 w-20 bg-dark-600 border border-dark-500 rounded px-2 py-1 text-sm text-white"
                          />
                        </label>
                        <label className="text-xs text-gray-400">
                          % Down
                          <input
                            type="number"
                            min="0.01"
                            max="100"
                            step="0.01"
                            value={g.ltpBracketPercentDown ?? 5}
                            onChange={(e) =>
                              updateGroup(gIdx, { ltpBracketPercentDown: parseFloat(e.target.value) || 5 })
                            }
                            className="block mt-1 w-20 bg-dark-600 border border-dark-500 rounded px-2 py-1 text-sm text-white"
                          />
                        </label>
                        <span className="text-[10px] text-gray-500 pb-1">Default 5% / 5% if left blank on save</span>
                      </div>
                    ) : null}
                    <div>
                      <p className="text-xs text-gray-500 mb-2">
                        Underlyings (symbol roots) — contracts matching these appear in this group
                      </p>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {(g.underlyings || []).map((u, uIdx) => (
                          <span
                            key={`${u}-${uIdx}`}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-dark-600 text-xs text-gray-200"
                          >
                            {u}
                            <button
                              type="button"
                              onClick={() => removeUnderlying(gIdx, uIdx)}
                              className="text-gray-500 hover:text-red-400"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                      <form
                        className="flex gap-2 max-w-md"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const input = e.currentTarget.elements.namedItem('underlying');
                          addUnderlying(gIdx, input?.value);
                          if (input) input.value = '';
                        }}
                      >
                        <input
                          name="underlying"
                          type="text"
                          placeholder="e.g. HDFCBANK, TCS, GOLD"
                          className="flex-1 bg-dark-600 border border-dark-500 rounded px-2 py-1.5 text-xs"
                        />
                        <button
                          type="submit"
                          className="px-3 py-1.5 rounded bg-dark-600 border border-dark-500 text-xs text-gray-200 hover:bg-dark-500"
                        >
                          Add
                        </button>
                      </form>
                    </div>

                    {instruments.length > 0 ? (
                      <div>
                        <p className="text-xs font-medium text-gray-400 mb-2">Instruments in this group</p>
                        <div className="max-h-48 overflow-y-auto rounded-lg border border-dark-600 bg-dark-900/50">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-dark-700 text-gray-500">
                              <tr>
                                <th className="text-left p-2">Symbol</th>
                                <th className="text-left p-2">Trading symbol</th>
                                <th className="text-left p-2">Name</th>
                              </tr>
                            </thead>
                            <tbody>
                              {instruments.slice(0, 200).map((inst) => (
                                <tr key={inst.token || inst._id} className="border-t border-dark-700/80">
                                  <td className="p-2 font-mono text-gray-200">{inst.symbol}</td>
                                  <td className="p-2 font-mono text-gray-400">{inst.tradingSymbol}</td>
                                  <td className="p-2 text-gray-500 truncate max-w-[200px]">{inst.name}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {instruments.length > 200 ? (
                            <p className="p-2 text-[10px] text-gray-500">
                              Showing first 200 of {instruments.length}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500">
                        No instruments matched. Add underlyings above or run Seed defaults, then Save.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}

          <button
            type="button"
            onClick={addGroup}
            className="flex items-center gap-2 w-full justify-center py-3 rounded-xl border border-dashed border-dark-500 text-gray-400 hover:border-amber-600/50 hover:text-amber-300 text-sm"
          >
            <Plus size={16} />
            Add group (e.g. Bank instruments, IT instruments)
          </button>

          {ungroupedCount > 0 && detail?.ungrouped ? (
            <div className="rounded-xl border border-amber-700/40 bg-amber-900/10 p-4">
              <h3 className="text-sm font-semibold text-amber-200 mb-2">
                Ungrouped ({ungroupedCount})
              </h3>
              <p className="text-xs text-gray-400 mb-2">
                These instruments are not in any group. Add their underlying to a group or create a new
                group.
              </p>
              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                {detail.ungrouped.slice(0, 80).map((inst) => (
                  <span
                    key={inst.token || inst._id}
                    className="px-1.5 py-0.5 rounded bg-dark-700 text-[10px] font-mono text-gray-400"
                  >
                    {inst.symbol || inst.tradingSymbol}
                  </span>
                ))}
                {ungroupedCount > 80 ? (
                  <span className="text-[10px] text-gray-500">+{ungroupedCount - 80} more</span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
