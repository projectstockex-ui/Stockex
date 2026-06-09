import React, { useState, useEffect } from 'react';
import { AUTO_REFRESH_EVENT } from '../lib/autoRefresh';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { 
  ArrowLeft, RefreshCw, Calendar, Download, Filter,
  ArrowUpCircle, ArrowDownCircle, Repeat, Wallet, TrendingUp,
  CreditCard, Building2
} from 'lucide-react';

const UserTransactions = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const [transactions, setTransactions] = useState([]);
  const [fundRequests, setFundRequests] = useState([]);
  const [walletLedger, setWalletLedger] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dateFilter, setDateFilter] = useState('all');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');

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
      fetchAllTransactions();
    }
  }, [user?.token, dateFilter, customDateFrom, customDateTo]);

  useEffect(() => {
    if (!user?.token) return;
    const onSoftRefresh = () => fetchAllTransactions();
    window.addEventListener(AUTO_REFRESH_EVENT, onSoftRefresh);
    return () => window.removeEventListener(AUTO_REFRESH_EVENT, onSoftRefresh);
  }, [user?.token, dateFilter, customDateFrom, customDateTo]);

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

  const fetchAllTransactions = async () => {
    try {
      setLoading(true);
      const headers = { Authorization: `Bearer ${user.token}` };
      
      const [ledgerRes, requestsRes, walletRes] = await Promise.all([
        axios.get('/api/user/funds/ledger?limit=100', { headers }),
        axios.get('/api/user/funds/fund-requests', { headers }),
        axios.get('/api/user/transactions', { headers }).catch(() => ({ data: [] }))
      ]);

      const { fromDate, toDate } = getDateRange();
      
      const filterByDate = (items) => {
        if (!fromDate) return items;
        return items.filter(item => {
          const itemDate = new Date(item.createdAt);
          return itemDate >= fromDate && itemDate <= toDate;
        });
      };

      setWalletLedger(filterByDate(ledgerRes.data || []));
      setFundRequests(filterByDate(requestsRes.data || []));
      setTransactions(filterByDate(walletRes.data || []));

    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    { id: 'all', label: 'All', icon: Wallet },
    { id: 'deposits', label: 'Deposits', icon: ArrowDownCircle },
    { id: 'withdrawals', label: 'Withdrawals', icon: ArrowUpCircle },
    { id: 'transfers', label: 'Internal Transfers', icon: Repeat },
    { id: 'trading', label: 'Trading P&L', icon: TrendingUp },
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

  const getFilteredData = () => {
    let allData = [];

    // Add wallet ledger entries
    walletLedger.forEach(item => {
      allData.push({
        ...item,
        source: 'ledger',
        displayType: item.reason || item.type,
        displayAmount: item.type === 'CREDIT' ? item.amount : -item.amount
      });
    });

    // Add fund requests
    fundRequests.forEach(item => {
      if (item.status === 'APPROVED') {
        allData.push({
          ...item,
          source: 'request',
          displayType: item.type,
          displayAmount: item.type === 'DEPOSIT' ? item.amount : -item.amount
        });
      }
    });

    // Sort by date
    allData.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Filter by tab
    switch (activeTab) {
      case 'deposits':
        return allData.filter(t => 
          t.displayType === 'DEPOSIT' || 
          t.reason === 'DEPOSIT' || 
          (t.type === 'CREDIT' && t.reason !== 'ADJUSTMENT')
        );
      case 'withdrawals':
        return allData.filter(t => 
          t.displayType === 'WITHDRAWAL' || 
          t.reason === 'WITHDRAWAL' ||
          (t.type === 'DEBIT' && t.reason !== 'ADJUSTMENT')
        );
      case 'transfers':
        return allData.filter(t => 
          t.reason === 'ADJUSTMENT' ||
          t.reason === 'CLIENT_TRANSFER_IN' ||
          t.reason === 'CLIENT_TRANSFER_OUT' ||
          t.reason === 'WALLET_TRANSFER_DEBIT' ||
          t.reason === 'WALLET_TRANSFER_CREDIT' ||
          t.description?.includes('transfer')
        );
      case 'trading':
        return allData.filter(t => 
          t.reason === 'TRADE' || 
          t.reason === 'COMMISSION' ||
          t.description?.includes('P&L') ||
          t.description?.includes('trade')
        );
      default:
        return allData;
    }
  };

  const getTypeIcon = (item) => {
    if (item.displayType === 'DEPOSIT' || item.reason === 'DEPOSIT') {
      return <ArrowDownCircle size={16} className="text-green-400" />;
    }
    if (item.displayType === 'WITHDRAWAL' || item.reason === 'WITHDRAWAL') {
      return <ArrowUpCircle size={16} className="text-red-400" />;
    }
    if (item.reason === 'ADJUSTMENT' || item.reason === 'CLIENT_TRANSFER_IN' || item.reason === 'CLIENT_TRANSFER_OUT') {
      return <Repeat size={16} className="text-blue-400" />;
    }
    if (item.reason === 'TRADE' || item.reason === 'COMMISSION') {
      return <TrendingUp size={16} className="text-purple-400" />;
    }
    return <Wallet size={16} className="text-gray-400" />;
  };

  const getTypeLabel = (item) => {
    if (item.reason === 'CLIENT_TRANSFER_OUT') return 'Sent to Client';
    if (item.reason === 'CLIENT_TRANSFER_IN') return 'Received from Client';
    if (item.reason === 'ADJUSTMENT') return 'Internal Transfer';
    if (item.reason === 'DEPOSIT' || item.displayType === 'DEPOSIT') return 'Deposit';
    if (item.reason === 'WITHDRAWAL' || item.displayType === 'WITHDRAWAL') return 'Withdrawal';
    if (item.reason === 'TRADE') return 'Trade P&L';
    if (item.reason === 'COMMISSION') return 'Commission';
    if (item.reason === 'BROKERAGE_OPEN_LEG') return 'BROKERAGE(OPEN)';
    if (item.reason === 'BROKERAGE_CLOSE_LEG') return 'BROKERAGE(CLOSE)';
    if (item.reason === 'BROKERAGE') return 'BROKERAGE(OPEN+CLOSE)';
    return item.displayType || item.type || 'Transaction';
  };

  const exportToCSV = () => {
    const data = getFilteredData();
    if (data.length === 0) return;

    const headers = ['Date', 'Type', 'Description', 'Amount', 'Balance After'];
    const rows = data.map(item => [
      formatDate(item.createdAt),
      getTypeLabel(item),
      item.description || '-',
      item.displayAmount || item.amount,
      item.balanceAfter || '-'
    ]);

    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const filteredData = getFilteredData();
  const totalCredits = filteredData.filter(t => (t.displayAmount || 0) > 0).reduce((sum, t) => sum + (t.displayAmount || 0), 0);
  const totalDebits = filteredData.filter(t => (t.displayAmount || 0) < 0).reduce((sum, t) => sum + Math.abs(t.displayAmount || 0), 0);

  if (!user) {
    return <div className="min-h-screen bg-dark-900 flex items-center justify-center">
      <RefreshCw className="animate-spin text-green-400" size={32} />
    </div>;
  }

  return (
    <div className="h-screen bg-dark-900 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-dark-800 border-b border-dark-600 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-2 bg-dark-700 hover:bg-dark-600 px-3 py-2 rounded-lg transition-colors"
            >
              <ArrowLeft size={18} />
              <span className="text-sm font-medium">Back</span>
            </button>
            <h1 className="text-xl font-bold">Transactions</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={fetchAllTransactions}
              disabled={loading}
              className="flex items-center gap-2 bg-dark-700 hover:bg-dark-600 px-3 py-2 rounded-lg transition-colors"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              <span className="text-sm hidden sm:inline">Refresh</span>
            </button>
            <button
              onClick={exportToCSV}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 px-3 py-2 rounded-lg transition-colors"
            >
              <Download size={16} />
              <span className="text-sm hidden sm:inline">Export</span>
            </button>
          </div>
        </div>
      </header>

      {/* Stats Bar */}
      <div className="bg-dark-800 border-b border-dark-600 px-4 py-3">
        <div className="flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-sm">Total Credits:</span>
            <span className="font-bold text-green-400">+{totalCredits.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-sm">Total Debits:</span>
            <span className="font-bold text-red-400">-{totalDebits.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-sm">Net:</span>
            <span className={`font-bold ${totalCredits - totalDebits >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {totalCredits - totalDebits >= 0 ? '+' : ''}{(totalCredits - totalDebits).toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Date Filters */}
      <div className="bg-dark-800 border-b border-dark-600 px-4 py-3">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-gray-400" />
            <span className="text-sm text-gray-400">Filter:</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {dateFilters.map(filter => (
              <button
                key={filter.id}
                onClick={() => setDateFilter(filter.id)}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${
                  dateFilter === filter.id
                    ? 'bg-green-600 text-white'
                    : 'bg-dark-700 text-gray-400 hover:bg-dark-600'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
          {dateFilter === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customDateFrom}
                onChange={(e) => setCustomDateFrom(e.target.value)}
                className="bg-dark-700 border border-dark-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-green-500"
              />
              <span className="text-gray-400">to</span>
              <input
                type="date"
                value={customDateTo}
                onChange={(e) => setCustomDateTo(e.target.value)}
                className="bg-dark-700 border border-dark-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-green-500"
              />
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-dark-800 border-b border-dark-600 px-4 overflow-x-auto">
        <div className="flex gap-1">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-green-500 text-white bg-dark-700'
                    : 'border-transparent text-gray-400 hover:text-white hover:bg-dark-700'
                }`}
              >
                <Icon size={16} />
                <span className="font-medium">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="animate-spin text-green-400" size={32} />
          </div>
        ) : (
          <div className="bg-dark-800 rounded-xl overflow-hidden">
            {filteredData.length === 0 ? (
              <div className="px-4 py-12 text-center text-gray-500">
                <Wallet size={32} className="mx-auto mb-2 opacity-50" />
                No transactions found
              </div>
            ) : (
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-dark-800 text-gray-500">
                  <tr>
                    <th className="px-2 py-2 font-medium whitespace-nowrap">When (IST)</th>
                    <th className="px-2 py-2 font-medium">Reason</th>
                    <th className="px-2 py-2 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-700">
                  {filteredData.map((item, index) => {
                    // Transform reason for brokerage legs
                    let displayReason = item.reason;
                    if (item.reason === 'BROKERAGE_OPEN_LEG') {
                      displayReason = 'BROKERAGE(OPEN)';
                    } else if (item.reason === 'BROKERAGE_CLOSE_LEG') {
                      displayReason = 'BROKERAGE(CLOSE)';
                    } else if (item.reason === 'BROKERAGE' && item.meta?.leg) {
                      // New entries with leg in meta
                      if (item.meta.leg === 'OPEN') displayReason = 'BROKERAGE(OPEN)';
                      else if (item.meta.leg === 'CLOSE') displayReason = 'BROKERAGE(CLOSE)';
                      else displayReason = 'BROKERAGE(OPEN+CLOSE)';
                    } else if (item.reason === 'BROKERAGE') {
                      // Old entries without leg info - show as plain BROKERAGE
                      displayReason = 'BROKERAGE';
                    }

                    return (
                      <tr key={item._id || index} className="hover:bg-dark-800/60">
                        <td className="px-2 py-2 text-gray-400 whitespace-nowrap align-top">{formatDate(item.createdAt)}</td>
                        <td className="px-2 py-2 align-top">
                          <div className={`text-gray-200 font-medium ${(item.displayAmount || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {displayReason}
                          </div>
                          {item.description && (
                            <div className="text-[10px] text-gray-500 mt-1">{item.description}</div>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right align-top tabular-nums">
                          <span className={(item.displayAmount || 0) >= 0 ? 'text-green-400' : 'text-red-400'}>
                            {(item.displayAmount || 0) >= 0 ? '+' : ''}
                            {Math.abs(item.displayAmount || item.amount || 0).toLocaleString('en-IN', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default UserTransactions;
