import React, { useState, useEffect } from 'react';
import { AUTO_REFRESH_EVENT } from '../lib/autoRefresh';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { io } from 'socket.io-client';
import { getRuntimeSocketUrl, getSocketClientOptions } from '../lib/runtimeApiUrl';
import { applyMarketTickBatch } from '../lib/marketTickMerge.js';
import { triggerAutosquareSound } from '../utils/tradingAlertSound';
import {
  Home, ArrowLeft, RefreshCw, Calendar, Filter, Download,
  TrendingUp, TrendingDown, Timer, CheckCircle, XCircle, AlertCircle,
  X, ChevronRight, Scissors, Info
} from 'lucide-react';
import TradeCloseBreakdownPanel from '../components/trading/TradeCloseBreakdownPanel.jsx';
import {
  IOSToast,
  IOSConfirmModal,
  IOSButton,
  IOSCard,
  useIOSToast,
  useIOSConfirm
} from '../components/IOSComponents';
import { getTradeQtyLotsDisplay } from '../utils/tradeQtyLotsDisplay.js';
import {
  formatAutosquareEndClock,
  formatAutosquareEventLabel,
  formatAutosquareSessionDate,
  resolveAutosquareSquaredQty,
} from '../utils/autosquareSessionDisplay.js';
import { resolveTradeDisplayPnL } from '../utils/tradePnL.js';

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
  const [autoSquareOrders, setAutoSquareOrders] = useState([]);
  const [pendingOrders, setPendingOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [closingPosition, setClosingPosition] = useState(null);
  const [dateFilter, setDateFilter] = useState('all');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [stats, setStats] = useState({ totalPnL: 0, winRate: 0, totalTrades: 0 });
  const [marketData, setMarketData] = useState({}); // Live market data from WebSocket
  
  // iOS-style hooks
  const { toast, showToast, hideToast } = useIOSToast();
  const { confirm, showConfirm, hideConfirm } = useIOSConfirm();
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [showBreakdownModal, setShowBreakdownModal] = useState(false);
  const [tradeBreakdown, setTradeBreakdown] = useState(null);
  const [loadingBreakdown, setLoadingBreakdown] = useState(false);
  const [breakdownError, setBreakdownError] = useState(null);

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
  }, [user?.token, dateFilter, customDateFrom, customDateTo, mcxOnly, cryptoOnly, forexOnly, activeTab]);

  useEffect(() => {
    if (!user?.token || activeTab !== 'autosquare') return;
    const id = setInterval(fetchAllOrders, 30000);
    return () => clearInterval(id);
  }, [user?.token, activeTab, dateFilter, customDateFrom, customDateTo, mcxOnly, cryptoOnly, forexOnly]);

  useEffect(() => {
    if (!user?.token) return;
    const onSoftRefresh = () => fetchAllOrders();
    window.addEventListener(AUTO_REFRESH_EVENT, onSoftRefresh);
    return () => window.removeEventListener(AUTO_REFRESH_EVENT, onSoftRefresh);
  }, [user?.token, dateFilter, customDateFrom, customDateTo, mcxOnly, cryptoOnly, forexOnly]);

  // Connect to Socket.IO for real-time market data
  useEffect(() => {
    if (!user?.token) return;

    const socketUrl = getRuntimeSocketUrl();
    const socket = io(socketUrl, getSocketClientOptions());
    const myUserId = String(user._id || user.id || '');
    const pending = {};

    const flushBatchedTicks = () => {
      const keys = Object.keys(pending);
      if (keys.length === 0) return;
      const batch = {};
      for (const k of keys) {
        batch[k] = pending[k];
        delete pending[k];
      }
      setMarketData((prev) => applyMarketTickBatch(prev, batch));
    };

    const queueTicks = (ticks) => {
      if (!ticks || typeof ticks !== 'object' || Array.isArray(ticks)) return;
      Object.assign(pending, ticks);
      flushBatchedTicks();
    };

    socket.on('connect', () => {
      console.log('Socket.IO connected for UserOrders');
      if (myUserId) socket.emit('register_user', myUserId);
    });

    socket.on('ledger_autosquare', (data) => {
      if (myUserId && data?.targetUserId && String(data.targetUserId) !== myUserId) return;
      triggerAutosquareSound();
      window.dispatchEvent(new CustomEvent('stockex:ledger-autosquare', { detail: data }));
      fetchAllOrders();
    });

    const onSessionClosed = () => fetchAllOrders();
    socket.on('crypto_session_closed', onSessionClosed);
    socket.on('nse_bse_session_closed', onSessionClosed);
    socket.on('mcx_session_closed', onSessionClosed);

    socket.on('market_tick', (ticks) => {
      queueTicks(ticks);
    });

    socket.on('crypto_tick', (ticks) => {
      queueTicks(ticks);
    });

    return () => {
      socket.disconnect();
    };
  }, [user?.token, user?._id, user?.id]);

  // Get current price from market data for live P&L calculation
  const getCurrentPrice = (position) => {
    const side = position.side;
    const isCrypto = position.isCrypto || position.exchange === 'BINANCE';
    const isForex = position.segment?.toUpperCase() === 'FOREX' || position.exchange?.toUpperCase() === 'FOREX';

    if (isCrypto) {
      // For crypto, use symbol to get market data
      const data = marketData[position.symbol] || marketData[position.pair];
      if (!data) return position.currentPrice || position.entryPrice;
      return side === 'BUY' ? (data.bid || data.ltp || data.close || 0) : (data.ask || data.ltp || data.close || 0);
    }

    if (isForex) {
      const data = marketData[position.symbol] || marketData[position.token];
      if (!data) return position.currentPrice || position.entryPrice;
      return side === 'BUY' ? (data.bid || data.ltp || data.close || 0) : (data.ask || data.ltp || data.close || 0);
    }

    // For Indian markets (NSE, BSE, MCX)
    const token = position.token;
    const symbol = position.symbol;
    const data = marketData[token] || marketData[symbol];
    if (!data) return position.currentPrice || position.entryPrice;
    return data.ltp || data.last_price || data.close || position.currentPrice || position.entryPrice;
  };

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

  const isAutoSquaredTrade = (t) => {
    if (!t) return false;
    const reason = String(t.closeReason || '').toUpperCase();
    if (['TIME_BASED', 'AUTO_SQUARE', 'AUTO_SQUARE_330', 'EOD_SQUAREOFF'].includes(reason)) return true;
    if (t.isAutoSquared === true) return true;
    if (t.autoSquaredAt) return true;
    if (Array.isArray(t.autoSquareHistory) && t.autoSquareHistory.length > 0) return true;
    return false;
  };

  const formatTradeStatusLabel = (t) => {
    if (isAutoSquaredTrade(t)) return 'AUTO-SQUARED';
    const reason = String(t?.closeReason || '').toUpperCase();
    if (reason === 'MANUAL') return 'MANUAL';
    if (reason === 'CANCELLED') return 'CANCELLED';
    return t?.status || t?.closeReason || 'CLOSED';
  };

  const fetchAllOrders = async () => {
    try {
      setLoading(true);
      const headers = { Authorization: `Bearer ${user.token}` };
      const { fromDate, toDate } = getDateRange();
      
      let params = {};
      if (fromDate) params.fromDate = fromDate.toISOString();
      if (toDate) params.toDate = toDate.toISOString();

      const [positionsRes, historyRes, pendingRes, autoSquareRes] = await Promise.all([
        axios.get('/api/trading/positions?status=OPEN', { headers }),
        axios.get('/api/trading/history', { headers, params }),
        axios.get('/api/trading/pending-orders', { headers }),
        axios.get('/api/trading/autosquare-history', { headers, params: { limit: 300 } }),
      ]);

      const allPositions = positionsRes.data || [];
      const allHistory = historyRes.data || [];
      const allPending = pendingRes.data || [];
      const allAutoSquareEvents = autoSquareRes.data || [];

      // Filter by date if needed
      const filterByDate = (items, { dateKey } = {}) => {
        if (!fromDate) return items;
        return items.filter((item) => {
          const raw =
            (dateKey && item[dateKey]) ||
            item.autoSquaredAt ||
            item.closedAt ||
            item.createdAt ||
            item.openedAt;
          const itemDate = new Date(raw);
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
          const isNSEItem = exchange === 'NSE' || exchange === 'NFO' || segment.startsWith('NSE') || segment.startsWith('BSE');
          
          if (mcxOnly) {
            return isMCXItem;
          } else if (cryptoOnly) {
            return isCryptoItem;
          } else if (forexOnly) {
            return isForexItem;
          } else {
            // Indian mode: include NSE, BSE, exclude MCX, Crypto, Forex
            return (isNSEItem || !isMCXItem && !isCryptoItem && !isForexItem);
          }
        });
      };

      // Apply both filters
      const filteredPositions = filterByMode(filterByDate(allPositions));
      const filteredHistory = filterByMode(filterByDate(allHistory));
      const filteredPending = filterByMode(filterByDate(allPending));
      const filteredAutoSquare = filterByMode(
        filterByDate(
          allAutoSquareEvents.map((ev) => ({
            ...ev,
            createdAt: ev.autoSquaredAt || ev.createdAt,
            openedAt: ev.autoSquaredAt || ev.openedAt,
          })),
          { dateKey: 'autoSquaredAt' }
        )
      );

      setPositions(filteredPositions.filter(t => !t.isAutoSquared));
      setClosedTrades(
        filteredHistory.filter((t) => t.status === 'CLOSED' && !isAutoSquaredTrade(t))
      );
      setCancelledOrders(
        filteredHistory.filter(
          (t) => t.status === 'CANCELLED' || String(t.closeReason || '').toUpperCase() === 'CANCELLED'
        )
      );
      setAutoSquareOrders(filteredAutoSquare);
      setPendingOrders(filteredPending);

      // Calculate stats from filtered data
      const closed = filteredHistory.filter((t) => t.status === 'CLOSED' && !isAutoSquaredTrade(t));
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
    { id: 'autosquare', label: 'Autosquare', count: autoSquareOrders.length, icon: AlertCircle, color: 'text-orange-400' },
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
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  };

  const formatTradeEntryTime = (item) => {
    if (!item?.openedAt) return null;
    const dt = new Date(item.openedAt);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toLocaleString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  };

  const resolveTradeClosedAt = (item) => {
    if (item?.closeTime) {
      const base = item.openedAt || item.closedAt || item.autoSquaredAt || item.createdAt || Date.now();
      const d = new Date(base);
      const parts = String(item.closeTime).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (parts && !Number.isNaN(d.getTime())) {
        d.setHours(Number(parts[1]), Number(parts[2]), Number(parts[3] || 0), 0);
        return d;
      }
    }
    if (item?.closedAt) {
      const dt = new Date(item.closedAt);
      if (!Number.isNaN(dt.getTime())) return dt;
    }
    if (item?.autoSquaredAt) {
      const dt = new Date(item.autoSquaredAt);
      if (!Number.isNaN(dt.getTime())) return dt;
    }
    return null;
  };

  const formatTradeExitTime = (item) => {
    const dt = resolveTradeClosedAt(item);
    if (!dt) return null;
    return dt.toLocaleString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  };

  const openTradeBreakdown = async (item) => {
    if (!item?._id || !user?.token) return;
    setShowBreakdownModal(true);
    setTradeBreakdown(null);
    setBreakdownError(null);
    setLoadingBreakdown(true);
    try {
      const { data } = await axios.get(`/api/trading/trades/${item._id}/close-breakdown`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      setTradeBreakdown(data);
    } catch (error) {
      setBreakdownError(error.response?.data?.message || error.message || 'Failed to load');
    } finally {
      setLoadingBreakdown(false);
    }
  };

  const getCurrentData = () => {
    switch (activeTab) {
      case 'positions': return positions;
      case 'pending': return pendingOrders;
      case 'closed': return closedTrades;
      case 'cancelled': return cancelledOrders;
      case 'autosquare': return autoSquareOrders;
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
      formatTradeStatusLabel(item),
      activeTab === 'autosquare'
        ? formatAutosquareSessionDate(item)
        : formatDate(
            item.autoSquaredAt || resolveTradeClosedAt(item) || item.closedAt || item.createdAt || item.openedAt
          )
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
              No {activeTab === 'positions' ? 'open positions' : activeTab === 'pending' ? 'pending orders' : activeTab === 'closed' ? 'closed trades' : activeTab === 'autosquare' ? 'auto-squared orders' : 'cancelled orders'} found
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {getCurrentData().map((item, index) => {
              // Calculate live P&L for open positions using current market data
              let pnl;
              if (activeTab === 'autosquare') {
                const storedSq = Number(item.pnlAtAutoSquare);
                pnl = Number.isFinite(storedSq)
                  ? storedSq
                  : resolveTradeDisplayPnL(item);
              } else if (activeTab === 'positions') {
                const ltp = getCurrentPrice(item) || item.currentPrice || item.entryPrice;
                pnl = item.side === 'BUY'
                  ? (ltp - item.entryPrice) * item.quantity
                  : (item.entryPrice - ltp) * item.quantity;
              } else {
                pnl = resolveTradeDisplayPnL(item);
              }
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
                        <div className="text-xs text-gray-500">
                          {item.exchange || 'FOREX'}
                          {item.tradeId ? ` · ${item.tradeId}` : ''}
                        </div>
                        {activeTab === 'autosquare' && (
                          <div className="text-[10px] text-amber-400/90 mt-0.5">
                            {formatAutosquareEventLabel(item)}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-bold text-lg ${isProfitable ? 'text-green-500' : 'text-red-500'}`}>
                        {isProfitable ? '+' : ''}₹{pnl.toLocaleString()}
                      </div>
                      <div className="text-xs text-gray-500">
                        P&L
                        {activeTab === 'autosquare' && (
                          <span className="block text-[10px] text-gray-600">
                            on {resolveAutosquareSquaredQty(item).toLocaleString('en-IN')} sq. qty
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Card Body - Table View */}
                  <div className="px-4 py-3">
                    <table className="w-full text-left text-xs">
                      <thead className="text-gray-500 border-b border-white/5">
                        <tr>
                          <th className="pb-2">Side</th>
                          <th className="pb-2">Product</th>
                          <th className="pb-2 text-right">
                            {activeTab === 'autosquare' ? 'Orig Qty' : 'Qty'}
                          </th>
                          {mcxOnly && activeTab !== 'autosquare' && (
                            <th className="pb-2 text-right">Lots</th>
                          )}
                          <th className="pb-2 text-right">Entry</th>
                          {activeTab === 'autosquare' && <th className="pb-2 text-right">LTP @ End Time</th>}
                          {activeTab === 'autosquare' && <th className="pb-2 text-right">Next Day Qty</th>}
                          {activeTab === 'closed' && (
                            <th className="pb-2 text-right">Exit / Status</th>
                          )}
                          {activeTab !== 'closed' && <th className="pb-2">Status</th>}
                          <th className="pb-2">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="py-2">
                            <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-semibold ${
                              item.side === 'BUY'
                                ? 'bg-green-500/20 text-green-500'
                                : 'bg-red-500/20 text-red-500'
                            }`}>
                              {item.side}
                            </span>
                          </td>
                          <td className="py-2">
                            <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-semibold ${
                              item.productType === 'MIS' || item.productType === 'INTRADAY' ? 'bg-yellow-500/20 text-yellow-500' :
                              item.productType === 'NRML' || item.productType === 'CNC' ? 'bg-blue-500/20 text-blue-500' :
                              'bg-gray-500/20 text-gray-400'
                            }`}>
                              {item.productType || '-'}
                            </span>
                          </td>
                          <td className="py-2 text-right">
                            {activeTab === 'autosquare'
                              ? (() => {
                                  const orig = item.originalQty ?? item.quantity ?? item.lots;
                                  if (mcxOnly) {
                                    const { qtyText } = getTradeQtyLotsDisplay({
                                      ...item,
                                      quantity: orig,
                                    });
                                    return qtyText !== '—' ? qtyText : orig ?? '—';
                                  }
                                  return orig ?? 1;
                                })()
                              : mcxOnly
                                ? getTradeQtyLotsDisplay(item).qtyText
                                : item.quantity || item.lots || 1}
                          </td>
                          {mcxOnly && activeTab !== 'autosquare' && (
                            <td className="py-2 text-right">
                              {getTradeQtyLotsDisplay(item).lotsText}
                            </td>
                          )}
                          <td className="py-2 text-right align-top">
                            <div>₹{(item.entryPrice || item.price || 0).toLocaleString()}</div>
                            {activeTab === 'closed' && formatTradeEntryTime(item) ? (
                              <div className="text-[10px] text-gray-500 mt-0.5">
                                Entry @ {formatTradeEntryTime(item)}
                              </div>
                            ) : null}
                          </td>
                          {activeTab === 'autosquare' && (
                            <td className="py-2 text-right">
                              {item.autoSquareLtp && item.autoSquareLtp > 0 ? (
                                <div>₹{item.autoSquareLtp.toLocaleString()}</div>
                              ) : (
                                <div className="text-red-400">LTP not captured</div>
                              )}
                              {formatAutosquareEndClock(item) && (
                                <div className="text-[10px] text-gray-500">
                                  @{formatAutosquareEndClock(item)}
                                </div>
                              )}
                            </td>
                          )}
                          {activeTab === 'autosquare' && (
                            <td className="py-2 text-right">
                              <span className="text-purple-400 font-medium">
                                {item.carryForwardQty ?? item.quantity ?? 0}
                              </span>
                            </td>
                          )}
                          {activeTab === 'closed' && (
                            <td className="py-2 text-right align-top">
                              <div>₹{(item.exitPrice || 0).toLocaleString()}</div>
                              {formatTradeExitTime(item) ? (
                                <div className="text-[10px] text-gray-500 mt-0.5">
                                  Exit @ {formatTradeExitTime(item)}
                                </div>
                              ) : null}
                              <div className="mt-1 flex justify-end">
                                <span className="inline-flex px-1.5 py-0.5 rounded text-xs font-semibold bg-green-500/20 text-green-400">
                                  {formatTradeStatusLabel(item)}
                                </span>
                              </div>
                            </td>
                          )}
                          {activeTab !== 'closed' && (
                            <td className="py-2">
                              <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-semibold ${
                                activeTab === 'autosquare'
                                  ? 'bg-green-500/20 text-green-400'
                                  : item.isAutoSquared && item.status === 'OPEN'
                                    ? 'bg-purple-500/20 text-purple-500'
                                    : item.status === 'OPEN'
                                      ? 'bg-blue-500/20 text-blue-500'
                                      : item.status === 'CLOSED'
                                        ? 'bg-green-500/20 text-green-400'
                                        : item.status === 'PENDING'
                                          ? 'bg-yellow-500/20 text-yellow-400'
                                          : 'bg-red-500/20 text-red-400'
                              }`}>
                                {activeTab === 'autosquare'
                                  ? 'AUTO-SQUARED'
                                  : item.isAutoSquared && item.status === 'OPEN' && !item.isHistoryEvent
                                    ? 'OPEN FOR NEXT DAY'
                                    : item.isHistoryEvent
                                      ? 'AUTO-SQUARED'
                                      : formatTradeStatusLabel(item)}
                              </span>
                            </td>
                          )}
                          <td className="py-2 text-gray-400">
                            {activeTab === 'autosquare'
                              ? formatAutosquareSessionDate(item)
                              : activeTab === 'closed'
                                ? formatDate(resolveTradeClosedAt(item) || item.closedAt || item.createdAt || item.openedAt)
                                : formatDate(item.createdAt || item.openedAt)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
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

                  {activeTab === 'closed' && item.status === 'CLOSED' && (
                    <div className="px-4 py-3 border-t border-white/5">
                      <button
                        type="button"
                        onClick={() => openTradeBreakdown(item)}
                        className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-xl text-sm font-medium transition-all active:scale-95"
                      >
                        <Info size={16} />
                        P&L & charges breakdown
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showBreakdownModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1c1c1e] rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto border border-white/10">
            <div className="sticky top-0 bg-[#1c1c1e] border-b border-white/10 p-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Trade P&L & charges</h3>
              <button
                type="button"
                onClick={() => setShowBreakdownModal(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4">
              <TradeCloseBreakdownPanel
                data={tradeBreakdown}
                loading={loadingBreakdown}
                error={breakdownError}
              />
            </div>
          </div>
        </div>
      )}
      
      {/* iOS-style Bottom Safe Area */}
      <div className="ios-safe-bottom bg-[#000000]" />
    </div>
  );
};

export default UserOrders;
