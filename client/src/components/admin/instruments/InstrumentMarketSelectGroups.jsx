import React, { useMemo } from 'react';
import { Layers, List, Settings, ChevronRight } from 'lucide-react';

export const MARKET_SELECT_SEGMENTS = [
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

const CATEGORY_LABELS = {
  NIFTY: 'Nifty',
  BANKNIFTY: 'Bank Nifty',
  FINNIFTY: 'Fin Nifty',
  MIDCPNIFTY: 'Midcap Nifty',
  NIFTYIT: 'Nifty IT',
  STOCKS: 'Stocks',
  INDICES: 'Indices',
  MCX: 'MCX',
  COMMODITY: 'Commodity',
  OTHER: 'Other',
};

function labelForCategory(cat) {
  return CATEGORY_LABELS[cat] || cat;
}

/**
 * Grouped market picker: segment tabs + category cards (BANKNIFTY, NIFTY, …).
 */
export default function InstrumentMarketSelectGroups({
  activeSegment,
  onSegmentChange,
  segments = [],
  scriptsBySegment = {},
  instruments = [],
  onBrowseCategory,
  onCategoryRules,
  rulesLoading = false,
  onShowAllContracts,
}) {
  const categoryGroups = useMemo(() => {
    const map = new Map();
    const scripts = scriptsBySegment[activeSegment] || [];
    for (const s of scripts) {
      const cat = String(s.category || s.baseSymbol || 'OTHER').toUpperCase();
      if (!map.has(cat)) {
        map.set(cat, {
          category: cat,
          label: labelForCategory(cat),
          instrumentCount: 0,
          enabledCount: 0,
        });
      }
      const g = map.get(cat);
      g.instrumentCount += Number(s.instrumentCount) || 1;
    }
    for (const inst of instruments) {
      const seg = inst.displaySegment || inst.segment;
      if (seg !== activeSegment && String(seg).toUpperCase() !== activeSegment) continue;
      const cat = String(inst.category || 'OTHER').toUpperCase();
      if (!map.has(cat)) {
        map.set(cat, {
          category: cat,
          label: labelForCategory(cat),
          instrumentCount: 0,
          enabledCount: 0,
        });
      }
      const g = map.get(cat);
      g.instrumentCount += 1;
      if (inst.isEnabled) g.enabledCount += 1;
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [scriptsBySegment, activeSegment, instruments]);

  const segMeta = segments.find((s) => s.id === activeSegment);
  const segCount = segMeta?.count ?? categoryGroups.reduce((n, g) => n + g.instrumentCount, 0);

  return (
    <div className="mb-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Layers size={18} className="text-amber-400" />
          <span>
            Pick a segment, then a group (e.g. Bank Nifty). Use <strong className="text-gray-200">Rules</strong> for
            segment defaults (leverage, brokerage, lot settings — same as Hierarchy).
          </span>
        </div>
        <button
          type="button"
          onClick={onShowAllContracts}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-dark-700 hover:bg-dark-600 text-sm text-gray-200 border border-dark-600"
        >
          <List size={16} />
          All contracts table
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {MARKET_SELECT_SEGMENTS.map((seg) => {
          const meta = segments.find((s) => s.id === seg);
          const active = activeSegment === seg;
          return (
            <button
              key={seg}
              type="button"
              onClick={() => onSegmentChange(seg)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                active
                  ? 'bg-amber-600/90 border-amber-500 text-white'
                  : 'bg-dark-700 border-dark-600 text-gray-400 hover:border-dark-500'
              }`}
            >
              {seg}
              {meta?.count != null ? (
                <span className={`ml-1.5 ${active ? 'text-amber-100' : 'text-gray-500'}`}>({meta.count})</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-gray-500">
        {activeSegment}: {segCount} instrument(s) in {categoryGroups.length} group(s)
      </p>

      {categoryGroups.length === 0 ? (
        <div className="rounded-lg border border-dark-600 bg-dark-800 p-8 text-center text-gray-500 text-sm">
          No groups for this segment. Sync instruments from Zerodha or seed defaults, then refresh.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {categoryGroups.map((g) => (
            <div
              key={g.category}
              className="rounded-xl border border-dark-600 bg-dark-800 p-4 hover:border-amber-600/40 transition"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <h3 className="font-semibold text-white">{g.label}</h3>
                  <p className="text-[10px] text-gray-500 font-mono mt-0.5">{g.category}</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 shrink-0">
                  {g.instrumentCount} contracts
                </span>
              </div>
              <p className="text-xs text-gray-500 mb-3">
                {g.enabledCount > 0 ? (
                  <span className="text-green-400">{g.enabledCount} enabled</span>
                ) : (
                  <span>Enable trading per contract in table view</span>
                )}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onBrowseCategory(g.category)}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-lg bg-dark-700 hover:bg-dark-600 text-xs text-gray-200"
                >
                  View
                  <ChevronRight size={14} />
                </button>
                <button
                  type="button"
                  disabled={rulesLoading}
                  onClick={() => onCategoryRules(g.category)}
                  className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-amber-600/90 hover:bg-amber-600 text-xs font-medium disabled:opacity-50"
                  title="Trading rules for all contracts in this group"
                >
                  <Settings size={14} />
                  Rules
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
