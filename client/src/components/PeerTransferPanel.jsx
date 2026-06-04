import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { Send, Search, RefreshCw, User, Check } from 'lucide-react';
import { resolveMainWalletBalance } from '../utils/resolveMainWalletBalance.js';

/**
 * Send Main Wallet → another client in the same ADMIN hierarchy.
 */
export default function PeerTransferPanel({
  token,
  walletData,
  nseBseSnapshot,
  onSuccess,
  compact = false,
}) {
  const [clients, setClients] = useState([]);
  const [scope, setScope] = useState(null);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState('');
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const mainBalance = resolveMainWalletBalance(walletData, nseBseSnapshot);

  const fetchClients = useCallback(async () => {
    if (!token) return;
    setClientsLoading(true);
    try {
      const { data } = await axios.get('/api/user/peer-transfer/clients', {
        params: { search: search.trim(), limit: 500 },
        headers: { Authorization: `Bearer ${token}` },
      });
      setClients(Array.isArray(data.clients) ? data.clients : []);
      setScope(data.scope || null);
    } catch (e) {
      console.error('peer-transfer clients:', e);
      setClients([]);
      setScope(null);
    } finally {
      setClientsLoading(false);
    }
  }, [token, search]);

  useEffect(() => {
    const t = setTimeout(fetchClients, search.trim() ? 300 : 0);
    return () => clearTimeout(t);
  }, [fetchClients, search]);

  const filteredLocal = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        String(c.userId || '').toLowerCase().includes(q) ||
        String(c.displayName || '').toLowerCase().includes(q) ||
        String(c.username || '').toLowerCase().includes(q)
    );
  }, [clients, search]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selected) {
      setError('Select a client from the list');
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter a valid amount');
      return;
    }
    if (amt > mainBalance + 0.01) {
      setError(`Insufficient balance (₹${mainBalance.toLocaleString('en-IN')})`);
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const { data } = await axios.post(
        '/api/user/peer-transfer',
        {
          recipientUserId: selected.userId,
          amount: amt,
          remarks: remarks.trim(),
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSuccess(
        `Sent ₹${amt.toLocaleString('en-IN')} to ${data.recipient?.displayName || selected.displayName}`
      );
      setAmount('');
      setRemarks('');
      setSelected(null);
      onSuccess?.(data);
    } catch (err) {
      setError(err.response?.data?.message || 'Transfer failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={`space-y-3 ${compact ? '' : 'p-1'}`}>
      <div className="rounded-lg bg-dark-700/80 p-3 text-sm">
        <div className="text-gray-400 text-xs">Available in Main Wallet</div>
        <div className="text-lg font-bold text-blue-400 tabular-nums">
          ₹{mainBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
        </div>
        <p className="text-[11px] text-gray-500 mt-1">
          Same hierarchy — all clients under your Admin tree can receive funds. Pick by{' '}
          <span className="text-gray-400">name + unique User ID</span>.
          {scope?.type === 'hierarchy' && scope.adminName && (
            <span className="block mt-1 text-blue-300/80">
              Tree: {scope.adminName}
              {scope.adminCode ? ` (${scope.adminCode})` : ''}
            </span>
          )}
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-sm p-2.5">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg bg-green-500/15 border border-green-500/30 text-green-300 text-sm p-2.5">
          {success}
        </div>
      )}

      <div>
        <label className="text-xs text-gray-400 block mb-1">Search client (name or User ID)</label>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full bg-dark-700 border border-dark-600 rounded-lg pl-9 pr-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="rounded-lg border border-dark-600 overflow-hidden">
        <div className="px-3 py-2 bg-dark-700/80 text-xs text-gray-400 flex justify-between items-center">
          <span>Available clients ({filteredLocal.length})</span>
          <button
            type="button"
            onClick={() => fetchClients()}
            className="text-blue-400 hover:text-blue-300 flex items-center gap-1"
          >
            <RefreshCw size={12} className={clientsLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
        <div className="max-h-[min(52vh,28rem)] overflow-y-auto divide-y divide-dark-700">
          {clientsLoading && filteredLocal.length === 0 ? (
            <p className="text-center text-xs text-gray-500 py-6">Loading clients…</p>
          ) : filteredLocal.length === 0 ? (
            <p className="text-center text-xs text-gray-500 py-6 px-3">
              No clients found in your hierarchy. Try search by User ID.
            </p>
          ) : (
            filteredLocal.map((c) => {
              const isSel = selected?.userId === c.userId;
              return (
                <button
                  key={c.userId}
                  type="button"
                  onClick={() => {
                    setSelected(c);
                    setError('');
                  }}
                  className={`w-full text-left px-3 py-2.5 flex items-center gap-2 transition ${
                    isSel ? 'bg-blue-600/25 border-l-2 border-blue-500' : 'hover:bg-dark-700/60'
                  }`}
                >
                  <User size={16} className={isSel ? 'text-blue-400' : 'text-gray-500 shrink-0'} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white font-medium truncate">{c.displayName}</div>
                    <div className="text-[11px] text-amber-300/90 font-mono truncate">{c.userId}</div>
                    {c.managerLabel && (
                      <div className="text-[10px] text-gray-500 truncate">Under {c.managerLabel}</div>
                    )}
                    {c.username && c.username !== c.displayName && (
                      <div className="text-[10px] text-gray-500 truncate">@{c.username}</div>
                    )}
                  </div>
                  {isSel && <Check size={18} className="text-blue-400 shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      </div>

      {selected && (
        <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 px-3 py-2 text-xs">
          <span className="text-gray-400">Sending to: </span>
          <span className="text-white font-medium">{selected.displayName}</span>
          <span className="text-gray-500"> · </span>
          <span className="font-mono text-amber-300">{selected.userId}</span>
        </div>
      )}

      <div>
        <label className="text-xs text-gray-400 block mb-1">Amount (₹)</label>
        <input
          type="number"
          min="1"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm"
          placeholder="0.00"
        />
      </div>

      <div>
        <label className="text-xs text-gray-400 block mb-1">Remarks (optional)</label>
        <input
          type="text"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          maxLength={200}
          className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm"
          placeholder="Note"
        />
      </div>

      <button
        type="submit"
        disabled={loading || !selected}
        className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg font-semibold flex items-center justify-center gap-2"
      >
        {loading ? <RefreshCw size={18} className="animate-spin" /> : <Send size={18} />}
        {loading ? 'Sending…' : 'Send to selected client'}
      </button>
    </form>
  );
}
