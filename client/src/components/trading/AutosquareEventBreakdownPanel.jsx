import React from 'react';
import {
  formatAutosquareEventLabel,
  formatAutosquareSessionDate,
  resolveAutosquareEventPnL,
  resolveAutosquareSquaredQty,
} from '../../utils/autosquareSessionDisplay.js';

function fmt(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const x = Number(n);
  const prefix = x >= 0 ? '+' : '';
  return `${prefix}₹${Math.abs(x).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function fmtPx(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/** Inline breakdown for one autosquare run — not full trade close. */
export default function AutosquareEventBreakdownPanel({ item }) {
  if (!item) return null;

  const sqQty = resolveAutosquareSquaredQty(item);
  const origQty = Number(item.originalQty) || 0;
  const nextQty = Number(item.carryForwardQty ?? item.quantity) || 0;
  const exitPx = Number(item.autoSquareLtp);
  const entryPx = Number(item.entryPrice);
  const pnl = resolveAutosquareEventPnL(item);
  const sideLabel = item.side === 'BUY' ? 'Long (BUY)' : 'Short (SELL)';
  const formula = item.side === 'BUY' ? '(exit − entry) × sq. qty' : '(entry − exit) × sq. qty';

  return (
    <div className="space-y-3 text-sm pt-2">
      <div className="rounded-lg border border-orange-500/30 bg-orange-900/15 p-3">
        <div className="font-semibold text-orange-200 mb-1">
          {item.symbol} · {sideLabel} · {item.productType || '—'}
        </div>
        <div className="text-[11px] text-orange-300/80 mb-2">{formatAutosquareEventLabel(item)}</div>
        <div className="text-xs text-gray-400 grid grid-cols-2 gap-2">
          <span>Trade: {item.tradeId || '—'}</span>
          <span>Date: {formatAutosquareSessionDate(item)}</span>
          <span>Orig qty @ event: {origQty.toLocaleString('en-IN')}</span>
          <span>Squared qty: {sqQty.toLocaleString('en-IN')}</span>
          <span>Next-day qty: {nextQty.toLocaleString('en-IN')}</span>
          <span>Entry: {fmtPx(entryPx)}</span>
          <span className="col-span-2">LTP @ square: {fmtPx(exitPx)}</span>
        </div>
      </div>

      <div className="rounded-lg bg-[#2c2c2e] p-3">
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
          This run only (not clubbed)
        </h4>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-gray-500">Price P&L {formula}</div>
            <div className={pnl >= 0 ? 'text-green-400' : 'text-red-400'}>{fmt(pnl)}</div>
          </div>
          <div>
            <div className="text-gray-500">Squared quantity</div>
            <div className="text-white">{sqQty.toLocaleString('en-IN')}</div>
          </div>
        </div>
        <p className="text-[11px] text-gray-500 mt-2">
          P&L is for this autosquare run only ({sqQty.toLocaleString('en-IN')} units), not your full position history.
        </p>
      </div>
    </div>
  );
}
