import React, { useState, useEffect } from 'react';
import { AUTO_REFRESH_EVENT } from '../lib/autoRefresh';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import {
  Home, ArrowLeft, RefreshCw, Calendar, Filter, Download,
  TrendingUp, TrendingDown, Timer, CheckCircle, XCircle, AlertCircle,
  X, ChevronRight, Scissors
} from 'lucide-react';
import { 
  IOSToast, 
  IOSConfirmModal, 
  IOSButton, 
  IOSCard,
  useIOSToast,
  useIOSConfirm 
} from '../components/IOSComponents';

const UserOrders = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode'); // 'mcx' | 'crypto' | 'forex' | null (indian)
  const mcxOnly = mode === 'mcx';
  const cryptoOnly = mode === 'crypto';
  const forexOnly = mode === 'forex';
  
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('positions');
  const [positions, setPositions] = useState([]);
  const [closedTrades, setClosedTrades] = useState([]);
  const [cancelledOrders, setCancelledOrders] = useState([]);
  const [pendingOrders, setPendingOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [closingPosition, setClosingPosition] = useState(null);
  const [dateFilter, setDateFilter] = useState('all');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [stats, setStats] = useState({ totalPnL: 0, winRate: 0, totalTrades: 0 });
  
  // iOS-style hooks
  const { toast, showToast, hideToast } = useIOSToast();
  const { confirm, showConfirm, hideConfirm } = useIOSConfirm();
  const [confirmLoading, setConfirmLoading] = useState(false);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    } else {
      navigate('/user/login');
    }
  }, [navigate]);

  useEffect(() => {
    if (user?.token) {
      fetchAllOrders();
    }
  }, [user?.token, dateFilter, customDateFrom, customDateTo, mcxOnly, cryptoOnly, forexOnly]);

  useEffect(() => {
    if (!user?.token) return;
    const onSoftRefresh = () => fetchAllOrders();
    window.addEventListener(AUTO_REFRESH_EVENT, onSoftRefresh);
    return () => window.removeEventListener(AUTO_REFRESH_EVENT, onSoftRefresh);
  }, [user?.token, dateFilter, customDateFrom, customDateTo, mcxOnly, cryptoOnly, forexOnly]);

  const getDateRange = () => {
    const now = new Date();
    let fromDate = null;
    let toDate = new Date();
    
    switch (dateFilter) {
      case 'today':
        fromDate = new Date(now.setHours(0, 0, 0, 0));
        break;
      case 'week':
        fromDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'month':
        fromDate = new Date(now.setMonth(now.getMonth() - 1));
        break;
      case 'custom':
        fromDate = customDateFrom ? new Date(customDateFrom) : null;
        toDate = customDateTo ? new Date(customDateTo) : new Date();
        break;
      default:
        fromDate = null;
    }
    
    return { fromDate, toDate };
  };

  const fetchAllOrders = async () => {
    try {
      setLoading(true);
      const headers = { Authorization: `Bearer ${user.token}` };
      const { fromDate, toDate } = getDateRange();
      
      let params = {};
      if (fromDate) params.fromDate = fromDate.toISOString();
      if (toDate) params.toDate = toDate.toISOString();

      const [positionsRes, historyRes, pendingRes] = await Promise.all([
        axios.get('/api/trading/positions?status=OPEN', { headers }),
        axios.get('/api/trading/history', { headers, params }),
        axios.get('/api/trading/pending-orders', { headers })
      ]);

      const allPositions = positionsRes.data || [];
      const allHistory = historyRes.data || [];
      const allPending = pendingRes.data || [];

      // Filter by date if needed
      const filterByDate = (items) => {
        if (!fromDate) return items;
        return items.filter(item => {
          const itemDate = new Date(item.closedAt || item.createdAt || item.openedAt);
          return itemDate >= fromDate && itemDate <= toDate;
        });
      };

      // Filter by trading mode (MCX, Crypto, Forex, or Indian)
      const filterByMode = (items) => {
        return items.filter(item => {
          const exchange = item.exchange?.toUpperCase() || '';
          const segment = item.segment?.toUpperCase() || '';
          const isMCXItem = exchange === 'MCX' || segment === 'MCX' || segment === 'MCXFUT' || segment === 'MCXOPT';
          const isCryptoItem = exchange === 'BINANCE' || item.isCrypto;
          const isForexItem = segment === 'FOREX' || exchange === 'FOREX' || item.isForex;
          
          if (mcxOnly) {
            return isMCXItem;
          } else if (cryptoOnly) {
            return isCryptoItem;
          } else if (forexOnly) {
            return isForexItem;
          } else {
            // Indian mode: exclude MCX, Crypto, Forex
            return !isMCXItem && !isCryptoItem && !isForexItem;
          }
        });
      };

      // Apply both filters
      const filteredPositions = filterByMode(filterByDate(allPositions));
      const filteredHistory = filterByMode(filterByDate(allHistory));
      const filteredPending = filterByMode(filterByDate(allPending));

      setPositions(filteredPositions);
      setClosedTrades(filteredHistory.filter(t => t.status === 'CLOSED'));
      setCancelledOrders(filteredHistory.filter(t => t.status === 'CANCELLED'));
      setPendingOrders(filteredPending);

      // Calculate stats from filtered data
      const closed = filteredHistory.filter(t => t.status === 'CLOSED');
      const getPnL = (t) => t.realizedPnL ?? t.netPnL ?? t.pnl ?? t.unrealizedPnL ?? 0;
      const totalPnL = closed.reduce((sum, t) => sum + getPnL(t), 0);
      const wins = closed.filter(t => getPnL(t) > 0).length;
      const winRate = closed.length > 0 ? (wins / closed.length * 100).toFixed(1) : 0;
      
      setStats({
        totalPnL,
        winRate,
        totalTrades: closed.length,
        wins,
        losses: closed.length - wins
      });

    } catch (error) {
      console.error('Error fetching orders:', error);
      showToast('Failed to fetch orders', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Close position handler
  const handleClosePosition = (position) => {
    showConfirm({
      title: 'Close Position',
      message: `Close ${position.side} ${position.quantity} ${position.symbol}?`,
      confirmText: 'Close Trade',
      confirmColor: 'red',
      onConfirm: () => executeClosePosition(position)
    });
  };

  const executeClosePosition = async (position) => {
    try {
      setConfirmLoading(true);
      const headers = { Authorization: `Bearer ${user.token}` };
      
      await axios.post(`/api/trading/close/${position._id}`, {
        bidPrice: position.currentPrice,
        askPrice: position.currentPrice
      }, { headers });
      
      hideConfirm();
      showToast('Position closed successfully', 'success');
      fetchAllOrders();
    } catch (error) {
      console.error('Error closing position:', error);
      showToast(error.response?.data?.message || 'Failed to close position', 'error');
    } finally {
      setConfirmLoading(false);
    }
  };

  // Cancel pending order handler
  const handleCancelOrder = (order) => {
    showConfirm({
      title: 'Cancel Order',
      message: `Cancel ${order.side} order for ${order.symbol}?`,
      confirmText: 'Cancel Order',
      confirmColor: 'orange',
      onConfirm: () => executeCancelOrder(order)
    });
  };

  const executeCancelOrder = async (order) => {
    try {
      setConfirmLoading(true);
      const headers = { Authorization: `Bearer ${user.token}` };
      
      await axios.delete(`/api/trading/pending-orders/${order._id}`, { headers });
      
      hideConfirm();
      showToast('Order cancelled successfully', 'success');
      fetchAllOrders();
    } catch (error) {
      console.error('Error cancelling order:', error);
      showToast(error.response?.data?.message || 'Failed to cancel order', 'error');
    } finally {
      setConfirmLoading(false);
    }
  };

  const tabs = [
    { id: 'positions', label: 'Open Positions', count: positions.length, icon: TrendingUp, color: 'text-blue-400' },
    { id: 'pending', label: 'Pending Orders', count: pendingOrders.length, icon: Timer, color: 'text-yellow-400' },
    { id: 'closed', label: 'Closed Trades', count: closedTrades.length, icon: CheckCircle, color: 'text-green-400' },
    { id: 'cancelled', label: 'Cancelled', count: cancelledOrders.length, icon: XCircle, color: 'text-red-400' },
  ];

  const dateFilters = [
    { id: 'all', label: 'All Time' },
    { id: 'today', label: 'Today' },
    { id: 'week', label: 'This Week' },
    { id: 'month', label: 'This Month' },
    { id: 'custom', label: 'Custom' },
  ];

  const formatDate = (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getCurrentData = () => {
    switch (activeTab) {
      case 'positions': return positions;
      case 'pending': return pendingOrders;
      case 'closed': return closedTrades;
      case 'cancelled': return cancelledOrders;
      default: return [];
    }
  };

  const exportToCSV = () => {
    const data = getCurrentData();
    if (data.length === 0) return;

    const headers = ['Symbol', 'Side', 'Product', 'Qty', 'Entry Price', 'Exit Price', 'P&L', 'Status', 'Date'];
    const rows = data.map(item => [
      item.symbol,
      item.side,
      item.productType || '-',
      item.quantity || item.lots,
      item.entryPrice || item.price,
      item.exitPrice || '-',
      item.realizedPnL ?? item.netPnL ?? item.pnl ?? item.unrealizedPnL ?? 0,
      item.status,
      formatDate(item.closedAt || item.createdAt || item.openedAt)
    ]);

    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orders_${activeTab}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  if (!user) {
    return <div className="min-h-screen bg-dark-900 flex items-center justify-center">
      <RefreshCw className="animate-spin text-green-400" size={32} />
    </div>;
  }

  return (
    <div className="h-screen bg-[#000000] text-white flex flex-col overflow-hidden ios-safe-top">
      {/* iOS Toast Notification */}
      <IOSToast 
        message={toast.message} 
        type={toast.type} 
        isVisible={toast.isVisible} 
        onClose={hideToast} 
      />
      
      {/* iOS Confirmation Modal */}
      <IOSConfirmModal
        isOpen={confirm.isOpen}
        onClose={hideConfirm}
        onConfirm={confirm.onConfirm}
        title={confirm.title}
        message={confirm.message}
        confirmText={confirm.confirmText}
        confirmColor={confirm.confirmColor}
        loading={confirmLoading}
      />

      {/* iOS-style Header */}
      <header className="bg-[#1c1c1e]/95 backdrop-blur-xl border-b border-white/10 px-4 py-3 sticky top-0 z-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() =>
                navigate(
                  mcxOnly
                    ? '/user/trader-room?mode=mcx'
                    : forexOnly
                      ? '/user/trader-room?mode=forex'
                      : cryptoOnly
                        ? '/user/trader-room?mode=crypto'
                        : '/user/trader-room'
                )
              }
              className="flex items-center gap-2 text-blue-500 hover:text-blue-400 transition-colors active:scale-95"
            >
              <ArrowLeft size={20} />
              <span className="text-base font-medium hidden sm:inline">Back</span>
            </button>
            <h1 className="text-lg font-semibold">
              Orders & History
              {mcxOnly && <span className="ml-2 text-xs bg-yellow-600 px-2 py-0.5 rounded">MCX</span>}
              {cryptoOnly && <span className="ml-2 text-xs bg-orange-600 px-2 py-0.5 rounded">Crypto</span>}
              {forexOnly && <span className="ml-2 text-xs bg-cyan-600 px-2 py-0.5 rounded">Forex</span>}
              {!mcxOnly && !cryptoOnly && !forexOnly && <span className="ml-2 text-xs bg-blue-600 px-2 py-0.5 rounded">NSE/BSE</span>}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchAllOrders}
              disabled={loading}
              className="p-2.5 bg-[#2c2c2e] hover:bg-[#3a3a3c] rounded-xl transition-all active:scale-95 disabled:opacity-50"
            >
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={exportToCSV}
              className="p-2.5 bg-green-500/20 text-green-500 hover:bg-green-500/30 rounded-xl transition-all active:scale-95"
            >
              <Download size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* iOS-style Stats Cards */}
      <div className="bg-[#1c1c1e] px-4 py-3">
        <div className="flex gap-3 overflow-x-auto ios-scroll pb-1">
          <div className="flex-shrink-0 bg-[#2c2c2e] rounded-2xl px-4 py-3 min-w-[120px]">
            <div className="text-gray-400 text-xs mb-1">Total P&L</div>
            <div className={`font-bold text-lg ${stats.totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {stats.totalPnL >= 0 ? '+' : ''}₹{stats.totalPnL.toLocaleString()}
            </div>
          </div>
          <div className="flex-shrink-0 bg-[#2c2c2e] rounded-2xl px-4 py-3 min-w-[100px]">
            <div className="text-gray-400 text-xs mb-1">Win Rate</div>
            <div className="font-bold text-lg text-blue-500">{stats.winRate}%</div>
          </div>
          <div className="flex-shrink-0 bg-[#2c2c2e] rounded-2xl px-4 py-3 min-w-[100px]">
            <div className="text-gray-400 text-xs mb-1">Total Trades</div>
            <div className="font-bold text-lg text-white">{stats.totalTrades}</div>
          </div>
          <div className="flex-shrink-0 bg-[#2c2c2e] rounded-2xl px-4 py-3 min-w-[140px]">
            <div className="text-gray-400 text-xs mb-1">Win/Loss</div>
            <div className="flex items-center gap-2">
              <span className="text-green-500 font-bold">{stats.wins}</span>
              <span className="text-gray-500">/</span>
              <span className="text-red-500 font-bold">{stats.losses}</span>
            </div>
          </div>
        </div>
      </div>

      {/* iOS-style Date Filters */}
      <div className="bg-[#1c1c1e] px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-3 overflow-x-auto ios-scroll">
          <Calendar size={16} className="text-gray-500 flex-shrink-0" />
          <div className="flex gap-1 p-1 bg-[#2c2c2e] rounded-xl">
            {dateFilters.map(filter => (
              <button
                key={filter.id}
                onClick={() => setDateFilter(filter.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  dateFilter === filter.id
                    ? 'bg-[#3a3a3c] text-white shadow-lg'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
          {dateFilter === 'custom' && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <input
                type="date"
                value={customDateFrom}
                onChange={(e) => setCustomDateFrom(e.target.value)}
                className="bg-[#2c2c2e] border border-white/10 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
              />
              <span className="text-gray-500">to</span>
              <input
                type="date"
                value={customDateTo}
                onChange={(e) => setCustomDateTo(e.target.value)}
                className="bg-[#2c2c2e] border border-white/10 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>
          )}
        </div>
      </div>

      {/* iOS-style Segmented Tabs */}
      <div className="bg-[#1c1c1e] px-4 py-3">
        <div className="flex gap-1 p-1 bg-[#2c2c2e] rounded-xl overflow-x-auto ios-scroll">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all flex-shrink-0 ${
                  activeTab === tab.id
                    ? 'bg-[#3a3a3c] text-white shadow-lg'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <Icon size={16} className={activeTab === tab.id ? 'text-white' : tab.color} />
                <span className="font-medium text-sm hidden sm:inline">{tab.label}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                  activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-white/10 text-gray-400'
                }`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* iOS-style Content */}
      <div className="flex-1 overflow-auto p-4 ios-scroll bg-[#000000]">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : getCurrentData().length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 bg-[#2c2c2e] rounded-full flex items-center justify-center mb-4">
              <AlertCircle size={32} className="text-gray-500" />
            </div>
            <p className="text-gray-500 text-center">
              No {activeTab === 'positions' ? 'open positions' : activeTab === 'pending' ? 'pending orders' : activeTab === 'closed' ? 'closed trades' : 'cancelled orders'} found
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {getCurrentData().map((item, index) => {
              const pnl = item.realizedPnL || item.pnl || item.unrealizedPnL || 0;
              const isProfitable = pnl >= 0;
              
              return (
                <div 
                  key={item._id || index} 
                  className="bg-[#1c1c1e] rounded-2xl overflow-hidden active:scale-[0.98] transition-transform"
                >
                  {/* Card Header */}
                  <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        item.side === 'BUY' ? 'bg-green-500/20' : 'bg-red-500/20'
                      }`}>
                        {item.side === 'BUY' ? (
                          <TrendingUp size={20} className="text-green-500" />
                        ) : (
                          <TrendingDown size={20} className="text-red-500" />
                        )}
                      </div>
                      <div>
                        <div className="font-semibold text-white">{item.symbol}</div>
                        <div className="text-xs text-gray-500">{item.exchange || 'FOREX'}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-bold text-lg ${isProfitable ? 'text-green-500' : 'text-red-500'}`}>
                        {isProfitable ? '+' : ''}₹{pnl.toLocaleString()}
                      </div>
                      <div className="text-xs text-gray-500">P&L</div>
                    </div>
                  </div>
                  
                  {/* Card Body */}
                  <div className="px-4 py-3">
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <div className="text-gray-500 text-xs mb-1">Side</div>
                        <span className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-semibold ${
                          item.side === 'BUY'
                            ? 'bg-green-500/20 text-green-500'
                            : 'bg-red-500/20 text-red-500'
                        }`}>
                          {item.side}
                        </span>
                      </div>
                      <div>
                        <div className="text-gray-500 text-xs mb-1">Product</div>
                        <span className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-semibold ${
                          item.productType === 'MIS' || item.productType === 'INTRADAY' ? 'bg-yellow-500/20 text-yellow-500' :
                          item.productType === 'NRML' || item.productType === 'CNC' ? 'bg-blue-500/20 text-blue-500' :
                          'bg-gray-500/20 text-gray-400'
                        }`}>
                          {item.productType || '-'}
                        </span>
                      </div>
                      <div>
                        <div className="text-gray-500 text-xs mb-1">Quantity</div>
                        <div className="font-medium text-white">{item.quantity || item.lots || 1}</div>
                      </div>
                      <div>
                        <div className="text-gray-500 text-xs mb-1">Entry</div>
                        <div className="font-medium text-white">₹{(item.entryPrice || item.price || 0).toLocaleString()}</div>
                      </div>
                      {activeTab === 'closed' && (
                        <div>
                          <div className="text-gray-500 text-xs mb-1">Exit</div>
                          <div className="font-medium text-white">₹{(item.exitPrice || 0).toLocaleString()}</div>
                        </div>
                      )}
                      <div>
                        <div className="text-gray-500 text-xs mb-1">Status</div>
                        <span className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-semibold ${
                          item.status === 'OPEN' ? 'bg-blue-500/20 text-blue-500' :
                          item.status === 'CLOSED' ? 'bg-green-500/20 text-green-500' :
                          item.status === 'PENDING' ? 'bg-yellow-500/20 text-yellow-500' :
                          'bg-red-500/20 text-red-500'
                        }`}>
                          {item.status}
                        </span>
                      </div>
                      <div>
                        <div className="text-gray-500 text-xs mb-1">Date</div>
                        <div className="font-medium text-gray-400 text-xs">{formatDate(item.createdAt || item.openedAt)}</div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Action Button for Open Positions */}
                  {activeTab === 'positions' && (
                    <div className="px-4 py-3 border-t border-white/5">
                      <button
                        onClick={() => handleClosePosition(item)}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-xl font-semibold transition-all active:scale-95"
                      >
                        <Scissors size={18} />
                        Close Position
                      </button>
                    </div>
                  )}
                  
                  {/* Action Button for Pending Orders */}
                  {activeTab === 'pending' && (
                    <div className="px-4 py-3 border-t border-white/5">
                      <button
                        onClick={() => handleCancelOrder(item)}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-orange-500/10 hover:bg-orange-500/20 text-orange-500 rounded-xl font-semibold transition-all active:scale-95"
                      >
                        <XCircle size={18} />
                        Cancel Order
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      
      {/* iOS-style Bottom Safe Area */}
      <div className="ios-safe-bottom bg-[#000000]" />
    </div>
  );
};

export default UserOrders;
