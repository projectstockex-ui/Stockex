import { useState, useCallback, useEffect } from 'react';
import axios from '../../config/axios';
import { AUTO_REFRESH_EVENT } from '../../lib/autoRefresh';
import { History, RefreshCw, ChevronDown, ChevronUp, Calendar } from 'lucide-react';
import { formatGamesLedgerWhen } from '../../lib/gamesLedgerWhen.js';

function getTodayISTDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function formatLedgerTickets(row, fallbackTokenValue) {
  const gid = row.gameId || '';
  if (gid === 'transfer_in' || gid === 'transfer_out') return '—';
  const tv =
    row.meta && Number(row.meta.tokenValue) > 0 ? Number(row.meta.tokenValue) : fallbackTokenValue;
  if (row.meta != null && row.meta.tickets != null && Number.isFinite(Number(row.meta.tickets))) {
    return `${Number(row.meta.tickets).toLocaleString('en-IN', { maximumFractionDigits: 2 })} T`;
  }
  if (row.entryType === 'debit' && row.amount != null && tv > 0) {
    const t = parseFloat((Number(row.amount) / tv).toFixed(2));
    return `${t.toLocaleString('en-IN', { maximumFractionDigits: 2 })} T`;
  }
  if (row.entryType === 'credit' && row.meta?.stake != null && tv > 0) {
    const t = parseFloat((Number(row.meta.stake) / tv).toFixed(2));
    return `${t.toLocaleString('en-IN', { maximumFractionDigits: 2 })} T`;
  }
  return '—';
}

/**
 * Full games-wallet ledger for one gameId (matches GamesWalletLedger.gameId).
 */
export default function GamesWalletGameLedgerPanel({
  gameId,
  userToken,
  tokenValue = 300,
  title = 'Games wallet activity',
  limit = 200,
  defaultOpen = true,
  bodyClassName = 'max-h-64',
  /** Show IST date picker; fetches rows for that calendar day only */
  enableDateFilter = false,
  /** Optional note below the table (e.g. sort order / how to read Balance) */
  footerNote = '',
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => getTodayISTDateKey());

  useEffect(() => {
    if (enableDateFilter) {
      setSelectedDate(getTodayISTDateKey());
    }
  }, [gameId, enableDateFilter]);

  const fetchLedger = useCallback(async () => {
    if (!userToken || !gameId) return;
    setLoading(true);
    setRows([]);
    try {
      const params = { gameId, limit };
      if (enableDateFilter && selectedDate) {
        params.date = selectedDate;
      }
      const { data } = await axios.get('/api/user/games-wallet/ledger', {
        headers: { Authorization: `Bearer ${userToken}` },
        params,
      });
      const list = Array.isArray(data) ? data : [];
      // Server already filters by gameId; avoid dropping rows on any id mismatch.
      setRows(list);
    } catch (e) {
      console.error('[GamesWalletGameLedgerPanel]', e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [userToken, gameId, limit, enableDateFilter, selectedDate]);

  useEffect(() => {
    fetchLedger();
  }, [fetchLedger]);

  useEffect(() => {
    const onRefresh = () => fetchLedger();
    window.addEventListener(AUTO_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(AUTO_REFRESH_EVENT, onRefresh);
  }, [fetchLedger]);

  if (!gameId) return null;

  const todayIst = getTodayISTDateKey();

  return (
    <div className="mt-3 rounded-xl border border-dark-600 bg-dark-800/80 overflow-hidden flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-dark-700/50 transition">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex-1 flex items-center gap-2 text-left min-w-0"
        >
          <History size={14} className="text-purple-400 shrink-0" />
          <span className="text-xs font-bold text-gray-300 truncate">{title}</span>
          {open ? <ChevronUp size={16} className="text-gray-500 shrink-0 ml-auto" /> : <ChevronDown size={16} className="text-gray-500 shrink-0 ml-auto" />}
        </button>
        <button
          type="button"
          onClick={() => fetchLedger()}
          disabled={loading}
          className="p-1.5 rounded text-purple-400 hover:text-purple-300 disabled:opacity-50 shrink-0"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {enableDateFilter && (
        <div className="px-3 pb-2 flex flex-wrap items-center gap-2 border-b border-dark-700/80">
          <label className="flex items-center gap-1.5 text-[10px] text-gray-400 shrink-0">
            <Calendar size={12} className="text-cyan-400/90" />
            <span>Date (IST)</span>
          </label>
          <input
            type="date"
            value={selectedDate}
            max={todayIst}
            onChange={(e) => setSelectedDate(e.target.value || todayIst)}
            className="flex-1 min-w-[9rem] bg-dark-700 border border-dark-600 rounded px-2 py-1 text-xs text-white [color-scheme:dark]"
          />
          <button
            type="button"
            onClick={() => setSelectedDate(todayIst)}
            className="text-[10px] px-2 py-1 rounded bg-dark-600 text-cyan-300 hover:bg-dark-500"
          >
            Today
          </button>
        </div>
      )}
      {open && (
        <div className={`border-t border-dark-600 overflow-y-auto scrollbar-thin px-0 pb-2 ${bodyClassName}`}>
          {enableDateFilter && (
            <p className="px-2 pt-2 text-[9px] text-gray-600 leading-snug">
              All activity for this game on the selected IST day: bets, wins, refunds — by when each line was posted
              (ledger time). Order column still shows placement time when available.
            </p>
          )}
          {loading && rows.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-xs">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-xs">
              {enableDateFilter ? `No orders on ${selectedDate} (IST).` : 'No debits or credits for this game yet.'}
            </div>
          ) : (
            <table className="w-full text-left text-[10px]">
              <thead className="sticky top-0 bg-dark-800 text-gray-500 z-[1]">
                <tr>
                  <th
                    className="px-2 py-1.5 font-medium"
                    title="When the bet or trade was placed (IST)"
                  >
                    Order time
                  </th>
                  <th className="px-2 py-1.5 font-medium">Description</th>
                  <th className="px-2 py-1.5 font-medium text-right whitespace-nowrap">Tickets</th>
                  <th className="px-2 py-1.5 font-medium text-right">Amount</th>
                  <th
                    className="px-2 py-1.5 font-medium text-right"
                    title="Games wallet balance after this entry. Rows are newest-first, so read Balance from bottom to top for chronological order."
                  >
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700">
                {rows.map((row) => (
                  <tr key={row._id} className="hover:bg-dark-800/60">
                    <td className="px-2 py-1.5 text-gray-400 whitespace-nowrap align-top">
                      <span>{formatGamesLedgerWhen(row)}</span>
                      {row.meta?.orderPlacedAt &&
                        row.createdAt &&
                        Math.abs(
                          new Date(row.meta.orderPlacedAt).getTime() -
                            new Date(row.createdAt).getTime()
                        ) > 60_000 && (
                          <div className="text-[8px] text-gray-600 mt-0.5 leading-tight">
                            Settled{' '}
                            {new Date(row.createdAt).toLocaleString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                        )}
                    </td>
                    <td className="px-2 py-1.5 align-top text-gray-200 leading-snug">
                      {row.description || row.gameLabel || '—'}
                      {row.meta != null &&
                        row.meta.windowNumber != null &&
                        (row.gameId === 'updown' || row.gameId === 'btcupdown') && (
                          <div className="text-[9px] text-amber-400/90 mt-0.5 tabular-nums">
                            Window #{row.meta.windowNumber}
                            {row.meta.prediction ? ` · ${row.meta.prediction}` : ''}
                            {row.meta.tickets != null && Number.isFinite(Number(row.meta.tickets))
                              ? ` · ${Number(row.meta.tickets).toLocaleString('en-IN', { maximumFractionDigits: 2 })} T`
                              : ''}
                          </div>
                        )}
                      {row.gameId === 'niftyNumber' &&
                        row.meta != null &&
                        Array.isArray(row.meta.numbers) &&
                        row.meta.numbers.length > 0 && (
                          <div className="text-[9px] text-violet-300/90 mt-0.5">
                            Numbers:{' '}
                            {row.meta.numbers
                              .map((n) => `.${String(Number(n)).padStart(2, '0')}`)
                              .join(', ')}
                            {row.meta.tickets != null && Number.isFinite(Number(row.meta.tickets))
                              ? ` · ${Number(row.meta.tickets).toLocaleString('en-IN', { maximumFractionDigits: 2 })} T`
                              : ''}
                          </div>
                        )}
                      {row.gameId === 'niftyBracket' && row.meta != null && (
                        <div className="text-[9px] text-cyan-300/90 mt-0.5 tabular-nums">
                          {row.meta.prediction ? String(row.meta.prediction) : 'Trade'}
                          {row.meta.entryPrice != null && Number.isFinite(Number(row.meta.entryPrice))
                            ? ` · line ${Number(row.meta.entryPrice).toLocaleString('en-IN', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}${row.meta.spotAtOrder != null && Number.isFinite(Number(row.meta.spotAtOrder)) ? ` (Nifty ${Number(row.meta.spotAtOrder).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} @ order)` : ''}`
                            : ''}
                          {row.meta.tickets != null && Number.isFinite(Number(row.meta.tickets))
                            ? ` · ${Number(row.meta.tickets).toLocaleString('en-IN', { maximumFractionDigits: 2 })} T`
                            : ''}
                        </div>
                      )}
                      {row.gameId === 'niftyJackpot' && row.meta != null && (
                        <div className="text-[9px] text-amber-300/90 mt-0.5 tabular-nums">
                          {row.meta.tickets != null && Number.isFinite(Number(row.meta.tickets))
                            ? `${Number(row.meta.tickets)} ticket(s)`
                            : ''}
                          {row.meta.niftyPriceAtBid != null &&
                            Number.isFinite(Number(row.meta.niftyPriceAtBid)) && (
                              <>
                                {' '}
                                · predicted NIFTY 
                                {Number(row.meta.niftyPriceAtBid).toLocaleString('en-IN', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </>
                            )}
                        </div>
                      )}
                      {row.meta != null &&
                        row.meta.niftyPriceAtBid != null &&
                        Number.isFinite(Number(row.meta.niftyPriceAtBid)) && (
                          <div className="text-[9px] text-cyan-400/90 mt-0.5 tabular-nums">
                            Predicted NIFTY 
                            {Number(row.meta.niftyPriceAtBid).toLocaleString('en-IN', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </div>
                        )}
                      {row.transactionSlip && (
                        <div className="text-[8px] text-purple-400/90 mt-1 p-1 bg-purple-900/20 rounded border border-purple-700/30">
                          <div className="flex items-center gap-1 mb-0.5">
                            <span className="font-mono">TXN: {row.transactionSlip.transactionId.slice(-8)}</span>
                            <span className={`px-1 py-0.5 rounded text-[7px] ${
                              row.transactionSlip.status === 'PENDING' ? 'bg-yellow-600/20 text-yellow-400' :
                              row.transactionSlip.status === 'PARTIALLY_SETTLED' ? 'bg-blue-600/20 text-blue-400' :
                              'bg-green-600/20 text-green-400'
                            }`}>
                              {row.transactionSlip.status.replace('_', ' ')}
                            </span>
                          </div>
                          <div className="flex justify-between text-[7px]">
                            <span>Games: {row.transactionSlip.gameIds.join(', ')}</span>
                          </div>
                          <div className="flex justify-between text-[7px] mt-0.5">
                            <span className="text-red-400">-{row.transactionSlip.totalDebitAmount.toFixed(2)}</span>
                            <span className="text-green-400">+{row.transactionSlip.totalCreditAmount.toFixed(2)}</span>
                            <span className={`font-semibold ${row.transactionSlip.netPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {row.transactionSlip.netPnL >= 0 ? '+' : ''}{row.transactionSlip.netPnL.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right align-top whitespace-nowrap text-gray-300 tabular-nums">
                      {formatLedgerTickets(row, tokenValue)}
                    </td>
                    <td className="px-2 py-1.5 text-right align-top whitespace-nowrap">
                      <span
                        className={
                          row.entryType === 'credit' ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'
                        }
                      >
                        {row.entryType === 'credit' ? '+' : '−'}
                        {(row.amount ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </span>
                      <div className="text-[9px] text-gray-600 uppercase mt-0.5">{row.entryType}</div>
                    </td>
                    <td className="px-2 py-1.5 text-right text-gray-300 align-top whitespace-nowrap">
                      
                      {(row.balanceAfter ?? 0).toLocaleString('en-IN', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {footerNote ? (
            <p className="px-2 pt-2 pb-1 text-[9px] text-gray-500 leading-snug border-t border-dark-700/80">
              {footerNote}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export const GAMES_LEDGER_FILTER_OPTIONS = [
  { value: '', label: 'All games & transfers' },
  { value: 'updown', label: 'Nifty Up/Down' },
  { value: 'btcupdown', label: 'BTC Up/Down' },
  { value: 'niftyNumber', label: 'Nifty Number' },
  { value: 'niftyBracket', label: 'Nifty Bracket' },
  { value: 'niftyJackpot', label: 'Nifty Jackpot' },
  { value: 'btcNumber', label: 'BTC Number' },
  { value: 'transfer_in', label: 'Main → Games (deposit)' },
  { value: 'transfer_out', label: 'Games → Main (withdraw)' },
];
