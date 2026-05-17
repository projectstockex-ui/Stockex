import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ChevronDown, X, User, Building2, ArrowDown } from 'lucide-react';
import axios from '../../../../config/axios';
import { useAuth } from '../../../../context/AuthContext';
import { WALLET_LEDGER_GAME_OPTIONS } from '../../../../constants/walletLedgerGames.js';

function formatLedgerSharePercent(entry) {
  if (entry?.displaySharePercent) return entry.displaySharePercent;
  if (entry?.reason !== 'GAME_PROFIT') return '—';
  const p = entry?.sharePercentResolved ?? entry?.meta?.sharePercent;
  if (p != null && Number.isFinite(Number(p))) {
    return `${Number(p).toFixed(2)}%`;
  }
  const base = entry?.meta?.baseAmount;
  const amt = entry?.amount;
  if (base != null && Number.isFinite(Number(base)) && Number(base) > 0 && Number.isFinite(Number(amt))) {
    return `${((Number(amt) / Number(base)) * 100).toFixed(2)}%`;
  }
  const desc = String(entry?.description || '');
  const m =
    desc.match(/\((\d+\.?\d*)\s*%\s*of/) ||
    desc.match(/(\d+\.?\d*)\s*%\s*of/i);
  if (m) return `${parseFloat(m[1], 10).toFixed(2)}%`;
  return '—';
}

const LedgerView = () => {
  const { admin } = useAuth();

  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(true);
  const [gameOptions, setGameOptions] = useState(WALLET_LEDGER_GAME_OPTIONS);
  const [ledgerGameFilter, setLedgerGameFilter] = useState('all');
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [hierarchyData, setHierarchyData] = useState(null);
  const [loadingHierarchy, setLoadingHierarchy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get('/api/admin/manage/ledger-games', {
          headers: { Authorization: `Bearer ${admin.token}` },
        });
        if (!cancelled && Array.isArray(data?.games) && data.games.length > 0) {
          setGameOptions(data.games);
        }
      } catch (error) {
        console.error('Error loading ledger games:', error);
      }
    })();
    return () => { cancelled = true; };
  }, [admin.token]);

  const fetchLedger = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (ledgerGameFilter && ledgerGameFilter !== 'all') params.gameKey = ledgerGameFilter;
      const { data } = await axios.get('/api/admin/manage/my-ledger', {
        headers: { Authorization: `Bearer ${admin.token}` },
        params,
      });
      setLedger(data);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  }, [admin.token, ledgerGameFilter]);

  useEffect(() => {
    fetchLedger();
  }, [fetchLedger]);

  const handleShowInfo = async (entry) => {
    setSelectedEntry(entry);
    setShowInfoModal(true);
    setLoadingHierarchy(true);

    // Get user code or username from entry
    const userCode = entry.transactionSlip?.userCode || entry.userCode || entry.userName || entry.transactionSlip?.userName;

    if (!userCode) {
      setLoadingHierarchy(false);
      setHierarchyData(null);
      return;
    }

    try {
      // Try to fetch hierarchy by userCode first, then by username
      const { data } = await axios.get(`/api/admin/manage/user-hierarchy/${userCode}`, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setHierarchyData(data);
    } catch (error) {
      console.error('Error fetching hierarchy:', error);
      setHierarchyData(null);
    } finally {
      setLoadingHierarchy(false);
    }
  };

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold">Wallet Ledger</h1>
        <div className="flex items-center gap-2">
          <label htmlFor="ledger-game-filter" className="text-sm text-gray-400 whitespace-nowrap">Game</label>
          <div className="relative">
            <select
              id="ledger-game-filter"
              value={ledgerGameFilter}
              onChange={(e) => setLedgerGameFilter(e.target.value)}
              className="appearance-none bg-dark-800 border border-dark-600 text-white text-sm rounded-lg pl-3 pr-10 py-2.5 min-w-[200px] focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent"
            >
              <option value="all">All games</option>
              {gameOptions.map((g) => (
                <option key={g.key} value={g.key}>{g.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" aria-hidden />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8"><RefreshCw className="animate-spin inline" /></div>
      ) : ledger.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          {ledgerGameFilter === 'all' ? 'No transactions yet' : 'No transactions for this game'}
        </div>
      ) : (
        <div className="bg-dark-800 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-dark-700">
              <tr>
                <th className="text-left px-4 py-3 text-gray-400">Date</th>
                <th className="text-left px-4 py-3 text-gray-400">Type</th>
                <th className="text-left px-4 py-3 text-gray-400">User/Client</th>
                <th className="text-left px-4 py-3 text-gray-400">Reason</th>
                <th className="text-right px-4 py-3 text-gray-400" title="Your share of the user loss pool, win brokerage, or gross fee (game profit only)">
                  Share %
                </th>
                <th className="text-right px-4 py-3 text-gray-400">Amount</th>
                <th className="text-left px-4 py-3 text-gray-400">Info</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map(entry => (
                <tr key={entry._id} className="border-t border-dark-600">
                  <td className="px-4 py-3 text-sm">{new Date(entry.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${entry.type === 'CREDIT' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                      {entry.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400">
                    <div>{entry.transactionSlip?.userName || entry.userName || 'N/A'}</div>
                    {entry.brokerageRecipientLabel && (
                      <div className="text-[10px] text-amber-400/90 mt-0.5">{entry.brokerageRecipientLabel}</div>
                    )}
                    {entry.hierarchyPayeeLine && (
                      <div className="text-[10px] text-cyan-400/80 mt-0.5">{entry.hierarchyPayeeLine}</div>
                    )}
                    {entry.superAdminPoolLine && (
                      <div className="text-[10px] text-purple-300/90 mt-0.5">{entry.superAdminPoolLine}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400">
                    <div>{entry.reason}</div>
                    {entry.transactionSlip && (
                      <div className="text-[10px] text-purple-400/90 mt-1 p-1.5 bg-purple-900/20 rounded border border-purple-700/30">
                        <div className="flex items-center gap-1 mb-1">
                          <span className="font-mono">TXN: {entry.transactionSlip.transactionId.slice(-8)}</span>
                          <span className={`px-1 py-0.5 rounded text-[8px] ${
                            entry.transactionSlip.status === 'PENDING' ? 'bg-yellow-600/20 text-yellow-400' :
                            entry.transactionSlip.status === 'PARTIALLY_SETTLED' ? 'bg-blue-600/20 text-blue-400' :
                            'bg-green-600/20 text-green-400'
                          }`}>
                            {entry.transactionSlip.status.replace('_', ' ')}
                          </span>
                        </div>
                        <div className="flex justify-between text-[8px] mb-1">
                          <span>User: {entry.transactionSlip.userName || entry.transactionSlip.userCode}</span>
                          <span>Games: {entry.transactionSlip.gameIds.join(', ')}</span>
                        </div>
                        <div className="flex justify-between text-[8px]">
                          <span className="text-red-400">Debit: ₹{entry.transactionSlip.totalDebitAmount.toFixed(2)}</span>
                          <span className="text-green-400">Credit: ₹{entry.transactionSlip.totalCreditAmount.toFixed(2)}</span>
                          <span className={`font-semibold ${entry.transactionSlip.netPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            Net: {entry.transactionSlip.netPnL >= 0 ? '+' : ''}₹{entry.transactionSlip.netPnL.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-cyan-300/90 tabular-nums">
                    {formatLedgerSharePercent(entry)}
                  </td>
                  <td className={`px-4 py-3 text-right ${entry.type === 'CREDIT' ? 'text-green-400' : 'text-red-400'}`}>
                    {entry.type === 'CREDIT' ? '+' : '-'}₹{entry.amount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleShowInfo(entry)}
                      className="px-3 py-1.5 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors text-sm font-medium"
                    >
                      Info
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showInfoModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-dark-600">
            <div className="sticky top-0 bg-dark-800 border-b border-dark-600 p-4 flex items-center justify-between">
              <h3 className="text-lg font-bold">Transaction Info</h3>
              <button onClick={() => setShowInfoModal(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {loadingHierarchy ? (
                <div className="text-center py-8">
                  <RefreshCw className="animate-spin inline mx-auto" />
                  <p className="text-gray-400 mt-2">Loading hierarchy...</p>
                </div>
              ) : (
                <>
                  <div className="bg-dark-700 rounded-lg p-4">
                    <h4 className="font-semibold mb-3 flex items-center gap-2">
                      <User className="w-4 h-4 text-blue-400" />
                      User Details
                    </h4>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-gray-400 text-xs">Name</div>
                        <div className="text-white">{selectedEntry?.transactionSlip?.userName || selectedEntry?.userName || 'N/A'}</div>
                      </div>
                      <div>
                        <div className="text-gray-400 text-xs">User Code</div>
                        <div className="text-white font-mono">{selectedEntry?.transactionSlip?.userCode || selectedEntry?.userCode || 'N/A'}</div>
                      </div>
                      <div>
                        <div className="text-gray-400 text-xs">Transaction Type</div>
                        <div className="text-white">{selectedEntry?.type || 'N/A'}</div>
                      </div>
                      <div>
                        <div className="text-gray-400 text-xs">Amount</div>
                        <div className={`font-semibold ${selectedEntry?.type === 'CREDIT' ? 'text-green-400' : 'text-red-400'}`}>
                          {selectedEntry?.type === 'CREDIT' ? '+' : '-'}₹{selectedEntry?.amount?.toLocaleString() || '0'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {hierarchyData && hierarchyData.hierarchy && hierarchyData.hierarchy.length > 0 ? (
                    <div className="bg-dark-700 rounded-lg p-4">
                      <h4 className="font-semibold mb-3 flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-blue-400" />
                        User Hierarchy
                      </h4>
                      <div className="space-y-2">
                        {hierarchyData.hierarchy.map((admin, index) => (
                          <div key={index} className="flex items-center gap-2 text-sm">
                            {index > 0 && <ArrowDown className="w-4 h-4 text-blue-500/50" />}
                            <div className="flex-1 bg-dark-600 rounded p-2">
                              <div className="flex items-center gap-2">
                                <span className="text-white font-medium">{admin.name}</span>
                                <span className="text-xs px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded">
                                  {admin.role === 'ADMIN' ? 'Admin' :
                                   admin.role === 'BROKER' ? 'Broker' :
                                   admin.role === 'SUB_BROKER' ? 'Sub-Broker' :
                                   admin.role === 'SUPER_ADMIN' ? 'Super Admin' : admin.role}
                                </span>
                              </div>
                              <div className="text-xs text-blue-400 font-mono mt-1">{admin.adminCode}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="bg-dark-700 rounded-lg p-4 text-center text-gray-400">
                      No hierarchy information available
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LedgerView;
