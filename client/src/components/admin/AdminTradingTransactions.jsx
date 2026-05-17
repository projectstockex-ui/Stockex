import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import axios from '../../config/axios';
import { TrendingUp, TrendingDown, Calendar, Filter, RefreshCw } from 'lucide-react';

const AdminTradingTransactions = () => {
  const { admin } = useAuth();
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [filterType, setFilterType] = useState('status');

  useEffect(() => {
    fetchTrades();
  }, []);

  const fetchTrades = async () => {
    try {
      const { data } = await axios.get('/api/admin/all-trades', {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setTrades(data || []);
    } catch (error) {
      console.error('Error fetching trades:', error);
    } finally {
      setLoading(false);
    }
  };

  const getFilteredTrades = () => {
    if (filter === 'all') return trades;
    if (filterType === 'status') {
      return trades.filter(t => t.status === filter);
    }
    if (filterType === 'side') {
      return trades.filter(t => t.side === filter);
    }
    return trades;
  };

  const filteredTrades = getFilteredTrades();

  return (
    <div className="p-4 md:p-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Trading Transactions</h1>
        <div className="flex items-center gap-2">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm"
          >
            <option value="status">Filter by Status</option>
            <option value="side">Filter by Side</option>
          </select>
          <div className="flex gap-2">
            {filterType === 'status' ? (
              ['all', 'OPEN', 'CLOSED', 'PENDING'].map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-2 rounded-lg text-sm ${filter === f ? 'bg-green-600' : 'bg-dark-700'}`}
                >
                  {f === 'all' ? 'All' : f}
                </button>
              ))
            ) : (
              ['all', 'BUY', 'SELL'].map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-2 rounded-lg text-sm ${filter === f ? 'bg-green-600' : 'bg-dark-700'}`}
                >
                  {f === 'all' ? 'All' : f}
                </button>
              ))
            )}
          </div>
          <button
            onClick={fetchTrades}
            className="p-2 bg-dark-700 hover:bg-dark-600 rounded-lg"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-400">Loading...</div>
      ) : filteredTrades.length === 0 ? (
        <div className="text-center py-8 text-gray-400">No trading transactions found</div>
      ) : (
        <div className="space-y-3">
          {filteredTrades.map(trade => (
            <div key={trade._id} className="bg-dark-800 rounded-lg p-4 border border-dark-700">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    trade.side === 'BUY' ? 'bg-green-600/20' : 'bg-red-600/20'
                  }`}>
                    {trade.side === 'BUY' ? (
                      <TrendingUp size={20} className="text-green-400" />
                    ) : (
                      <TrendingDown size={20} className="text-red-400" />
                    )}
                  </div>
                  <div>
                    <div className="font-semibold text-lg">{trade.symbol}</div>
                    <div className="text-sm text-gray-400">{trade.exchange} • {trade.segment}</div>
                    <div className="text-xs text-gray-500">{trade.user?.username || 'Unknown User'}</div>
                  </div>
                </div>
                <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                  trade.status === 'OPEN' ? 'bg-green-600/20 text-green-400' :
                  trade.status === 'CLOSED' ? 'bg-blue-600/20 text-blue-400' :
                  trade.status === 'PENDING' ? 'bg-yellow-600/20 text-yellow-400' :
                  'bg-gray-600/20 text-gray-400'
                }`}>
                  {trade.status}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-gray-400 mb-1">Side</div>
                  <div className={trade.side === 'BUY' ? 'text-green-400 font-medium' : 'text-red-400 font-medium'}>
                    {trade.side}
                  </div>
                </div>
                <div>
                  <div className="text-gray-400 mb-1">Quantity</div>
                  <div className="font-medium">{trade.quantity}</div>
                </div>
                <div>
                  <div className="text-gray-400 mb-1">Entry Price</div>
                  <div className="font-medium">₹{trade.entryPrice?.toFixed(2) || '-'}</div>
                </div>
                <div>
                  <div className="text-gray-400 mb-1">Exit Price</div>
                  <div className="font-medium">₹{trade.exitPrice?.toFixed(2) || '-'}</div>
                </div>
                <div>
                  <div className="text-gray-400 mb-1">Brokerage</div>
                  <div className="font-medium">₹{trade.brokerage?.toFixed(2) || '0.00'}</div>
                </div>
                <div>
                  <div className="text-gray-400 mb-1">P&L</div>
                  <div className={`font-medium ${trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ₹{trade.pnl?.toFixed(2) || '0.00'}
                  </div>
                </div>
                <div className="col-span-2 md:col-span-2">
                  <div className="text-gray-400 mb-1">Trade ID</div>
                  <div className="font-medium text-xs">{trade.tradeId}</div>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-dark-700 flex items-center justify-between text-xs text-gray-500">
                <div className="flex items-center gap-1">
                  <Calendar size={14} />
                  <span>{new Date(trade.createdAt).toLocaleString()}</span>
                </div>
                {trade.closedAt && (
                  <div className="flex items-center gap-1">
                    <span>Closed: {new Date(trade.closedAt).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminTradingTransactions;
