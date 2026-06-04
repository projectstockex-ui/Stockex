import React from 'react';
import { RefreshCw } from 'lucide-react';

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

function LedgerList({ rows, emptyLabel }) {
  if (!rows?.length) {
    return <p className="text-[11px] text-gray-500">{emptyLabel}</p>;
  }
  return (
    <div className="space-y-1.5 max-h-36 overflow-y-auto">
      {rows.map((row) => (
        <div key={row.ledgerId} className="flex justify-between text-xs bg-dark-600/40 rounded px-2 py-1">
          <span className="text-gray-300">
            {row.ownerName} · {row.reason}
            {row.sharePct != null ? ` (${row.sharePct}%)` : ''}
          </span>
          <span className={row.type === 'CREDIT' ? 'text-green-400' : 'text-red-400'}>
            {row.type === 'CREDIT' ? '+' : '-'}₹{row.amount.toLocaleString('en-IN')}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function TradeCloseBreakdownPanel({ data, loading, error, highlightRole }) {
  if (loading) {
    return (
      <div className="text-center py-6 text-gray-400 text-sm">
        <RefreshCw className="animate-spin inline w-5 h-5 mb-2" />
        <div>Loading trade breakdown…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
        {error}
      </div>
    );
  }
  if (!data?.trade) return null;

  const { trade, pnl, patti, brokerageLedger, pattiLedger, notes } = data;
  const closedAt = trade.closedAt
    ? new Date(trade.closedAt).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })
    : '—';

  const sideLabel = trade.side === 'BUY' ? 'Long (BUY)' : 'Short (SELL)';
  const priceFormula =
    trade.side === 'BUY'
      ? '(exit − entry) × qty'
      : '(entry − exit) × qty';

  const brokerageRows =
    brokerageLedger?.length > 0
      ? brokerageLedger
      : (data.ledgerCredits || []).filter((r) => r.isBrokerage || r.reason === 'BROKERAGE');

  const pattiRows =
    pattiLedger?.length > 0
      ? pattiLedger
      : (data.ledgerCredits || []).filter((r) => r.isPatti && r.reason !== 'BROKERAGE');

  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-lg border border-purple-500/30 bg-purple-900/15 p-3">
        <div className="font-semibold text-purple-200 mb-1">
          {trade.symbol} · {sideLabel} · {trade.productType || '—'}
        </div>
        <div className="text-xs text-gray-400 grid grid-cols-2 gap-2">
          <span>Qty: {trade.quantity}</span>
          <span>Closed: {closedAt}</span>
          <span>Entry: {fmtPx(trade.entryPrice)}</span>
          <span>Exit: {fmtPx(trade.exitPrice)}</span>
        </div>
      </div>

      <div className="rounded-lg bg-dark-700 p-3">
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">User P&L</h4>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-gray-500">Price P&L {priceFormula}</div>
            <div className={pnl.grossPnL >= 0 ? 'text-green-400' : 'text-red-400'}>{fmt(pnl.grossPnL)}</div>
          </div>
          <div>
            <div className="text-gray-500">
              {pnl.prepaidBrokerage ? 'Wallet credit (price P&L)' : 'Net (after close charges)'}
            </div>
            <div className={pnl.walletPnL >= 0 ? 'text-green-400' : 'text-red-400'}>{fmt(pnl.walletPnL)}</div>
          </div>
          {pnl.grossSignCorrected && (
            <div className="col-span-2 text-[11px] text-amber-300/90">
              DB had ₹{Math.abs(pnl.grossStoredRaw).toLocaleString('en-IN')} with wrong sign — corrected from
              entry/exit.
            </div>
          )}
          {pnl.commission > 0 && (
            <div>
              <div className="text-gray-500">
                Brokerage (round-trip){pnl.prepaidBrokerage ? ' · debited on open' : ''}
              </div>
              <div className="text-amber-300">−₹{pnl.commission.toLocaleString('en-IN')}</div>
            </div>
          )}
          {pnl.prepaidBrokerage && pnl.commission > 0 && pnl.grossPnL < 0 && (
            <div>
              <div className="text-gray-500">Total impact (P&L + brokerage)</div>
              <div className="text-red-400">{fmt(pnl.totalEconomicImpact)}</div>
            </div>
          )}
          {pnl.closingCharges > 0 && (
            <div>
              <div className="text-gray-500">Exchange charges at close</div>
              <div className="text-amber-300">₹{pnl.closingCharges.toLocaleString('en-IN')}</div>
            </div>
          )}
        </div>
      </div>

      {trade.bookType === 'B_BOOK' && (
        <div className="rounded-lg bg-dark-700 p-3 border border-cyan-500/20">
          <h4 className="text-xs font-semibold text-cyan-300 uppercase tracking-wide mb-2">
            Admin book (B_BOOK counterparty)
          </h4>
          <div className="text-lg font-bold text-cyan-200">{fmt(pnl.adminPnL)}</div>
          <p className="text-[11px] text-gray-500 mt-1">
            Opposite of user price P&L — not brokerage. Franchise brokerage is split separately below.
          </p>
        </div>
      )}

      {patti?.active && (
        <div className="rounded-lg bg-dark-700 p-3">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Patti split (on admin book pool)
            {patti.pattiRoot?.name ? ` · ${patti.pattiRoot.name}` : ''}
          </h4>
          <div className="space-y-2">
            {patti.credits.map((c, i) => {
              const isHighlight = highlightRole && c.role === highlightRole;
              return (
                <div
                  key={i}
                  className={`flex justify-between items-center rounded px-2 py-1.5 ${
                    isHighlight ? 'bg-purple-500/15 border border-purple-500/30' : 'bg-dark-600/50'
                  }`}
                >
                  <div>
                    <div className="text-white font-medium">{c.name}</div>
                    <div className="text-[10px] text-gray-500">{c.label || c.roleLabel}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-cyan-300 text-xs">{c.sharePct != null ? `${c.sharePct}%` : ''}</div>
                    <div className={c.amount >= 0 ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>
                      {fmt(c.amount)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {brokerageRows.length > 0 && (
        <div className="rounded-lg bg-dark-700 p-3 border border-amber-500/15">
          <h4 className="text-xs font-semibold text-amber-300/90 uppercase tracking-wide mb-2">
            Brokerage split (franchise / hierarchy)
          </h4>
          <LedgerList rows={brokerageRows} emptyLabel="No brokerage ledger rows." />
        </div>
      )}

      {pattiRows.length > 0 && (
        <div className="rounded-lg bg-dark-700 p-3">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Patti ledger (trade P&L credits)
          </h4>
          <LedgerList rows={pattiRows} emptyLabel="No patti ledger rows on this trade." />
        </div>
      )}

      {notes?.length > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-[11px] text-amber-200/90 space-y-1">
          {notes.map((n, i) => (
            <p key={i}>{n.message}</p>
          ))}
        </div>
      )}
    </div>
  );
}
