import React, { useState, useEffect } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import axios from '../../../../config/axios';
import { useAuth } from '../../../../context/AuthContext';

const NetPositions = () => {
  const { admin } = useAuth();
  const [positions, setPositions] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [userBreakdown, setUserBreakdown] = useState([]);
  const [showBreakdown, setShowBreakdown] = useState(false);

  useEffect(() => {
    fetchNetPositions();
  }, []);

  const fetchNetPositions = async () => {
    try {
      setLoading(true);
      const { data } = await axios.get('/api/admin/manage/net-positions', {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setPositions(data.positions || []);
      setSummary(data.summary || {});
    } catch (error) {
      console.error('Error fetching net positions:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchUserBreakdown = async (symbol) => {
    try {
      const { data } = await axios.get(`/api/admin/manage/net-positions/${encodeURIComponent(symbol)}/users`, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setUserBreakdown(data);
      setSelectedSymbol(symbol);
      setShowBreakdown(true);
    } catch (error) {
      console.error('Error fetching user breakdown:', error);
    }
  };

  const filteredPositions = positions.filter(pos => 
    pos.symbol.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatExpiry = (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <RefreshCw className="animate-spin mr-2" /> Loading net positions...
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Net Positions</h1>
          <p className="text-gray-400 text-sm mt-1">
            Aggregated positions across {admin.role === 'SUPER_ADMIN' ? 'all users' : 'your users'}
          </p>
        </div>
        <button
          onClick={fetchNetPositions}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg"
        >
          <RefreshCw size={18} /> Refresh
        </button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Total Symbols</div>
          <div className="text-2xl font-bold text-purple-400">{summary.totalSymbols || 0}</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Total Buy Qty</div>
          <div className="text-2xl font-bold text-green-400">{(summary.totalBuyQty || 0).toLocaleString()}</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Total Sell Qty</div>
          <div className="text-2xl font-bold text-red-400">{(summary.totalSellQty || 0).toLocaleString()}</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Net Qty</div>
          <div className={`text-2xl font-bold ${(summary.totalNetQty || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {(summary.totalNetQty || 0).toLocaleString()}
          </div>
        </div>
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Total Positions</div>
          <div className="text-2xl font-bold text-blue-400">{summary.totalPositions || 0}</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Unrealized P&L</div>
          <div className={`text-2xl font-bold ${(summary.totalUnrealizedPnL || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            ₹{(summary.totalUnrealizedPnL || 0).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search by symbol..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full md:w-80 pl-10 pr-4 py-2 bg-dark-700 border border-dark-600 rounded-lg"
          />
        </div>
      </div>

      {/* Positions Table */}
      <div className="bg-dark-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-dark-700">
              <tr>
                <th className="px-4 py-3 text-left">Symbol</th>
                <th className="px-4 py-3 text-left">Exchange</th>
                <th className="px-4 py-3 text-left">Segment</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Expiry</th>
                <th className="px-4 py-3 text-right">Buy Qty</th>
                <th className="px-4 py-3 text-right">Sell Qty</th>
                <th className="px-4 py-3 text-right">Net Qty</th>
                <th className="px-4 py-3 text-right">Avg Buy</th>
                <th className="px-4 py-3 text-right">Avg Sell</th>
                <th className="px-4 py-3 text-right">Unrealized P&L</th>
                <th className="px-4 py-3 text-center">Users</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-600">
              {filteredPositions.length === 0 ? (
                <tr>
                  <td colSpan="13" className="px-4 py-8 text-center text-gray-500">
                    No open positions found
                  </td>
                </tr>
              ) : (
                filteredPositions.map((pos, idx) => (
                  <tr key={idx} className="hover:bg-dark-700">
                    <td className="px-4 py-3 font-medium">{pos.symbol}</td>
                    <td className="px-4 py-3">{pos.exchange}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs ${
                        pos.segment === 'options' ? 'bg-purple-900/50 text-purple-300' :
                        pos.segment === 'futures' ? 'bg-blue-900/50 text-blue-300' :
                        'bg-green-900/50 text-green-300'
                      }`}>
                        {pos.segment?.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {pos.optionType ? (
                        <span className={pos.optionType === 'CE' ? 'text-green-400' : 'text-red-400'}>
                          {pos.strikePrice} {pos.optionType}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3">{formatExpiry(pos.expiry)}</td>
                    <td className="px-4 py-3 text-right text-green-400">{pos.buyQty.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-red-400">{pos.sellQty.toLocaleString()}</td>
                    <td className={`px-4 py-3 text-right font-bold ${pos.netQty >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {pos.netQty > 0 ? '+' : ''}{pos.netQty.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">₹{pos.avgBuyPrice?.toLocaleString() || '-'}</td>
                    <td className="px-4 py-3 text-right">₹{pos.avgSellPrice?.toLocaleString() || '-'}</td>
                    <td className={`px-4 py-3 text-right font-medium ${pos.totalUnrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      ₹{pos.totalUnrealizedPnL?.toLocaleString() || 0}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="px-2 py-1 bg-dark-600 rounded">{pos.userCount}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => fetchUserBreakdown(pos.symbol)}
                        className="px-3 py-1 bg-purple-600 hover:bg-purple-700 rounded text-xs"
                      >
                        View Users
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Breakdown Modal */}
      {showBreakdown && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 rounded-lg w-full max-w-4xl max-h-[80vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-dark-600">
              <h2 className="text-lg font-bold">User Breakdown - {selectedSymbol}</h2>
              <button onClick={() => setShowBreakdown(false)} className="p-1 hover:bg-dark-600 rounded">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 overflow-auto max-h-[60vh]">
              {userBreakdown.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No users found for this symbol</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-dark-700">
                    <tr>
                      <th className="px-4 py-3 text-left">User</th>
                      <th className="px-4 py-3 text-left">Client Code</th>
                      <th className="px-4 py-3 text-right">Buy Qty</th>
                      <th className="px-4 py-3 text-right">Sell Qty</th>
                      <th className="px-4 py-3 text-right">Net Qty</th>
                      <th className="px-4 py-3 text-right">Unrealized P&L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-600">
                    {userBreakdown.map((item, idx) => (
                      <tr key={idx} className="hover:bg-dark-700">
                        <td className="px-4 py-3">{item.user?.name || item.user?.username}</td>
                        <td className="px-4 py-3 font-mono">{item.user?.clientCode || '-'}</td>
                        <td className="px-4 py-3 text-right text-green-400">{item.buyQty.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-red-400">{item.sellQty.toLocaleString()}</td>
                        <td className={`px-4 py-3 text-right font-bold ${item.netQty >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {item.netQty > 0 ? '+' : ''}{item.netQty.toLocaleString()}
                        </td>
                        <td className={`px-4 py-3 text-right ${item.unrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          ₹{item.unrealizedPnL?.toLocaleString() || 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NetPositions;
