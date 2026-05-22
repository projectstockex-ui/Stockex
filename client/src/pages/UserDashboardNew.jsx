import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import { AUTO_REFRESH_EVENT } from '../lib/autoRefresh';
import {
  Home, Wallet, Users, FileText, Copy, BarChart2, User, HelpCircle,
  LogOut, Menu, X, ChevronDown, Settings, Bell, Sun, Moon,
  TrendingUp, CreditCard, Building2, MoreHorizontal, Receipt, ChevronUp, Share2
} from 'lucide-react';

// Import page components
import UserHome from './UserHome';
import UserAccounts from './UserAccounts';
import UserTradingTransactions from './UserTradingTransactions';

// Orders Component
const UserOrders = () => {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      const { data } = await axios.get('/api/trade/orders', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setOrders(data || []);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredOrders = filter === 'all' ? orders : orders.filter(o => o.status === filter);

  return (
    <div className="p-4 md:p-6 overflow-y-auto h-full">
      <h1 className="text-2xl font-bold mb-6">Orders</h1>
      
      <div className="flex gap-2 mb-4">
        {['all', 'PENDING', 'EXECUTED', 'CANCELLED'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm ${filter === f ? 'bg-green-600' : 'bg-dark-700'}`}
          >
            {f === 'all' ? 'All' : f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-400">Loading...</div>
      ) : filteredOrders.length === 0 ? (
        <div className="text-center py-8 text-gray-400">No orders found</div>
      ) : (
        <div className="space-y-2">
          {filteredOrders.map(order => (
            <div key={order._id} className="bg-dark-800 rounded-lg p-4 flex items-center justify-between">
              <div>
                <div className="font-medium">{order.symbol}</div>
                <div className="text-sm text-gray-400">{order.orderType} • {order.quantity} qty</div>
              </div>
              <div className="text-right">
                <div className={order.side === 'BUY' ? 'text-green-400' : 'text-red-400'}>
                  {order.side} @ ₹{order.price}
                </div>
                <div className="text-xs text-gray-500">{new Date(order.createdAt).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Wallet Component
const UserWalletPage = () => {
  const { user } = useAuth();
  const [walletData, setWalletData] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [fundRequests, setFundRequests] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [adminInfo, setAdminInfo] = useState(null);
  const [referralEarnings, setReferralEarnings] = useState({ total: 0, totalLifetime: 0, count: 0, entries: [] });
  const [loading, setLoading] = useState(true);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [activeTab, setActiveTab] = useState('transactions');

  const fetchData = useCallback(async () => {
    if (!user?.token) return;
    try {
      const headers = { Authorization: `Bearer ${user.token}` };
      const [walletRes, txRes, requestsRes, bankRes, adminRes, refRes] = await Promise.all([
        axios.get('/api/user/wallet', { headers }),
        axios.get('/api/user/funds/ledger?limit=50', { headers }).catch(() => ({ data: [] })),
        axios.get('/api/user/funds/fund-requests', { headers }).catch(() => ({ data: [] })),
        axios.get('/api/user/funds/admin-bank-accounts', { headers }).catch(() => ({ data: [] })),
        axios.get('/api/user/funds/my-admin', { headers }).catch(() => ({ data: null })),
        axios.get('/api/user/referral-earnings', { headers }).catch(() => ({ data: { total: 0, totalLifetime: 0, count: 0, entries: [] } }))
      ]);
      setWalletData(walletRes.data);
      setTransactions(txRes.data || []);
      setFundRequests(requestsRes.data || []);
      setBankAccounts(bankRes.data || []);
      setAdminInfo(adminRes.data);
      setReferralEarnings(refRes.data || { total: 0, totalLifetime: 0, count: 0, entries: [] });
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const onSoftRefresh = () => fetchData();
    window.addEventListener(AUTO_REFRESH_EVENT, onSoftRefresh);
    return () => window.removeEventListener(AUTO_REFRESH_EVENT, onSoftRefresh);
  }, [fetchData]);

  // Main wallet balance (where admin deposits funds)
  // API returns cashBalance at top level and also in wallet object
  const mainWalletBalance = walletData?.cashBalance || walletData?.wallet?.cashBalance || walletData?.wallet?.balance || 0;
  // Trading balance (for trading)
  const tradingBalance = walletData?.tradingBalance || walletData?.wallet?.tradingBalance || 0;
  const usedMargin = walletData?.usedMargin || walletData?.wallet?.usedMargin || walletData?.wallet?.blocked || 0;
  const availableMainWallet = mainWalletBalance; // Main wallet is fully available for withdraw

  if (loading) {
    return <div className="p-6 text-center text-gray-400">Loading...</div>;
  }

  return (
    <div className="p-4 md:p-6 overflow-y-auto h-full">
      <h1 className="text-2xl font-bold mb-6">
        Wallet
        {user?.isDemo && <span className="ml-2 text-yellow-400 text-lg">(Demo)</span>}
      </h1>

      {/* Demo Account Notice */}
      {user?.isDemo && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎮</span>
            <div>
              <h3 className="text-yellow-400 font-medium">Demo Wallet</h3>
              <p className="text-gray-400 text-sm">This is virtual money for practice trading. Deposits and withdrawals are disabled.</p>
            </div>
          </div>
        </div>
      )}

      {/* Balance Card */}
      <div className={`bg-gradient-to-r ${user?.isDemo ? 'from-yellow-600 to-orange-600' : 'from-green-600 to-emerald-600'} rounded-xl p-6 mb-6`}>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-white/70 text-sm mb-1">
              Main Wallet
            </div>
            <div className="text-2xl font-bold text-white">
              ₹{mainWalletBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <div className="text-white/70 text-sm mb-1">
              Trading Wallet
            </div>
            <div className="text-2xl font-bold text-white">
              ₹{tradingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>
        {!user?.isDemo && (
          <div className="flex gap-4 mt-4">
            <button 
              onClick={() => setShowDepositModal(true)}
              className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg text-sm font-medium transition"
            >
              + Deposit
            </button>
            <button 
              onClick={() => setShowWithdrawModal(true)}
              className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg text-sm font-medium transition"
            >
              - Withdraw
            </button>
          </div>
        )}
        {user?.isDemo && (
          <div className="text-white/70 text-sm mt-4">
            💡 Convert to real account to deposit and withdraw real funds
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Total Deposited</div>
          <div className="text-xl font-bold text-green-400">₹{(walletData?.wallet?.totalDeposited || 0).toLocaleString()}</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Total Withdrawn</div>
          <div className="text-xl font-bold text-red-400">₹{(walletData?.wallet?.totalWithdrawn || 0).toLocaleString()}</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Total P&L</div>
          <div className={`text-xl font-bold ${(walletData?.wallet?.totalPnL || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            ₹{(walletData?.wallet?.totalPnL || 0).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 mb-4 border-b border-dark-600 overflow-x-auto whitespace-nowrap">
        {['transactions', 'requests', 'bank', 'referrals'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize transition flex items-center gap-2 ${
              activeTab === tab
                ? 'text-green-400 border-b-2 border-green-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {tab === 'bank'
              ? 'Admin Bank Accounts'
              : tab === 'referrals'
                ? 'Total Referral Amount'
                : tab}
            {tab === 'referrals' && (referralEarnings.total > 0 || referralEarnings.count > 0) && (
              <span className="text-[10px] bg-green-500/20 text-green-300 px-1.5 py-0.5 rounded normal-case">
                ₹{Number(referralEarnings.total || 0).toLocaleString('en-IN')}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="bg-dark-800 rounded-lg p-4">
        {activeTab === 'transactions' && (
          <>
            <h2 className="font-semibold mb-4">Recent Transactions</h2>
            {transactions.length === 0 ? (
              <div className="text-center py-4 text-gray-400">No transactions yet</div>
            ) : (
              <div className="space-y-2">
                {transactions.map((tx, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-dark-600 last:border-0">
                    <div>
                      <div className="font-medium">{tx.description || tx.type}</div>
                      <div className="text-xs text-gray-500">{new Date(tx.createdAt).toLocaleString()}</div>
                    </div>
                    <div className="text-right">
                      <div className={tx.amount >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {tx.amount >= 0 ? '+' : ''}₹{Math.abs(tx.amount || 0).toLocaleString()}
                      </div>
                      <div className="text-xs text-gray-500">Bal: ₹{(tx.balanceAfter || 0).toLocaleString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === 'requests' && (
          <>
            <h2 className="font-semibold mb-4">Fund Requests</h2>
            {fundRequests.length === 0 ? (
              <div className="text-center py-4 text-gray-400">No fund requests yet</div>
            ) : (
              <div className="space-y-3">
                {fundRequests.map((req, i) => (
                  <div key={i} className="bg-dark-700 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-xs px-2 py-1 rounded ${
                        req.type === 'DEPOSIT' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                      }`}>
                        {req.type}
                      </span>
                      <span className={`text-xs px-2 py-1 rounded ${
                        req.status === 'APPROVED' ? 'bg-green-500/20 text-green-400' :
                        req.status === 'REJECTED' ? 'bg-red-500/20 text-red-400' :
                        req.status === 'CANCELLED' ? 'bg-gray-500/20 text-gray-400' :
                        'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {req.status}
                      </span>
                    </div>
                    <div className="text-2xl font-bold">₹{(req.amount || 0).toLocaleString()}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {new Date(req.createdAt).toLocaleString()}
                    </div>
                    {req.referenceId && (
                      <div className="text-xs text-gray-400 mt-1">Ref: {req.referenceId}</div>
                    )}
                    {req.adminRemarks && (
                      <div className="text-xs text-gray-400 mt-2 p-2 bg-dark-600 rounded">
                        Admin: {req.adminRemarks}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === 'bank' && (
          <>
            <h2 className="font-semibold mb-4">Admin Bank Accounts (for Deposit)</h2>
            {bankAccounts.length === 0 ? (
              <div className="text-center py-4 text-gray-400">No bank accounts available</div>
            ) : (
              <div className="space-y-3">
                {bankAccounts.map((acc, i) => (
                  <div key={i} className="bg-dark-700 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                      {acc.type === 'UPI' ? (
                        <CreditCard size={18} className="text-purple-400" />
                      ) : (
                        <Building2 size={18} className="text-blue-400" />
                      )}
                      <span className="font-medium">{acc.type === 'UPI' ? 'UPI' : acc.bankName}</span>
                    </div>
                    
                    {acc.type === 'UPI' ? (
                      <div className="flex items-center justify-between bg-dark-600 rounded p-3">
                        <span className="font-mono text-lg">{acc.upiId}</span>
                        <button 
                          onClick={() => {navigator.clipboard.writeText(acc.upiId); alert('Copied!')}}
                          className="text-xs bg-dark-500 hover:bg-dark-400 px-2 py-1 rounded"
                        >
                          Copy
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between bg-dark-600 rounded p-2">
                          <span className="text-gray-400">Account Number</span>
                          <span className="font-mono">{acc.accountNumber}</span>
                        </div>
                        <div className="flex justify-between bg-dark-600 rounded p-2">
                          <span className="text-gray-400">IFSC Code</span>
                          <span className="font-mono">{acc.ifsc}</span>
                        </div>
                        <div className="flex justify-between bg-dark-600 rounded p-2">
                          <span className="text-gray-400">Account Holder</span>
                          <span>{acc.holderName}</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === 'referrals' && (
          <>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="font-semibold">Total Referral Amount</h2>
              <div className="text-sm text-gray-400">
                Total:{' '}
                <span className="text-green-400 font-bold">
                  ₹{Number(referralEarnings.total || 0).toLocaleString('en-IN', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                {Number(referralEarnings.totalLifetime || 0) > Number(referralEarnings.total || 0) && (
                  <span className="ml-3 text-xs text-gray-500">
                    (Lifetime: ₹{Number(referralEarnings.totalLifetime || 0).toLocaleString('en-IN', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })})
                  </span>
                )}
              </div>
            </div>
            {(!referralEarnings.entries || referralEarnings.entries.length === 0) ? (
              <div className="text-center py-6 text-gray-400">No referral earnings yet</div>
            ) : (
              <div className="space-y-2">
                {referralEarnings.entries.map((e, i) => {
                  const segmentText =
                    e.segment === 'games'
                      ? `games${e.gameLabel ? ` (${e.gameLabel})` : ''}`
                      : e.segmentLabel || e.segment || 'trading';
                  const name = e.referredUsername || 'referred user';
                  const d = e.createdAt ? new Date(e.createdAt) : null;
                  const isValidDate = d && !isNaN(d.getTime());
                  const dateStr = isValidDate
                    ? `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`
                    : '—';
                  const timeStr = isValidDate
                    ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
                    : '';
                  const amtStr = Number(e.amount || 0).toLocaleString('en-IN', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  });
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between py-2 border-b border-dark-600 last:border-0"
                    >
                      <div className="min-w-0 pr-3">
                        <div className="font-medium truncate">
                          <span className="text-white">{name}</span>{' '}
                          <span className="text-gray-400">{segmentText}</span>
                        </div>
                        <div className="text-xs text-gray-500">
                          ₹{amtStr} credited on {dateStr}
                          {timeStr ? ` at ${timeStr}` : ''}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-green-400 font-semibold">+₹{amtStr}</div>
                        <div className="text-[10px] text-gray-500 uppercase tracking-wide">credit</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Deposit Modal */}
      {showDepositModal && (
        <DepositModal 
          user={user}
          bankAccounts={bankAccounts}
          onClose={() => setShowDepositModal(false)}
          onSuccess={() => { fetchData(); setShowDepositModal(false); }}
        />
      )}

      {/* Withdraw Modal */}
      {showWithdrawModal && (
        <WithdrawModal 
          user={user}
          balance={availableMainWallet}
          adminInfo={adminInfo}
          onClose={() => setShowWithdrawModal(false)}
          onSuccess={() => { fetchData(); setShowWithdrawModal(false); }}
        />
      )}
    </div>
  );
};

// Deposit Modal Component
const DepositModal = ({ user, bankAccounts, onClose, onSuccess }) => {
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('UPI');
  const [selectedBank, setSelectedBank] = useState('');
  const [referenceId, setReferenceId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [proofImage, setProofImage] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Get selected bank account details
  const selectedBankDetails = bankAccounts.find(acc => acc._id === selectedBank);

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setError('Image size should be less than 5MB');
        return;
      }
      setProofImage(file);
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('amount', parseFloat(amount));
      formData.append('paymentMethod', paymentMethod);
      if (selectedBank) formData.append('bankAccountId', selectedBank);
      if (referenceId) formData.append('referenceId', referenceId);
      if (remarks) formData.append('remarks', remarks);
      if (proofImage) formData.append('proofImage', proofImage);

      await axios.post('/api/user/funds/fund-request/deposit', formData, {
        headers: { 
          Authorization: `Bearer ${user.token}`,
          'Content-Type': 'multipart/form-data'
        }
      });
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit deposit request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-dark-800 rounded-xl w-full max-w-md p-6 my-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Deposit Funds</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="bg-red-500/20 text-red-400 p-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Amount (₹)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount"
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 focus:outline-none focus:border-green-500"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Payment Method</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 focus:outline-none focus:border-green-500"
            >
              <option value="UPI">UPI</option>
              <option value="BANK">Bank Transfer (NEFT/IMPS)</option>
              <option value="CASH">Cash</option>
            </select>
          </div>

          {bankAccounts.length > 0 && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">Pay to Account</label>
              <select
                value={selectedBank}
                onChange={(e) => setSelectedBank(e.target.value)}
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 focus:outline-none focus:border-green-500"
              >
                <option value="">Select account</option>
                {bankAccounts.map(acc => (
                  <option key={acc._id} value={acc._id}>
                    {acc.type === 'UPI' ? `UPI: ${acc.upiId}` : `${acc.bankName} - ${acc.accountNumber}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Show selected bank details */}
          {selectedBankDetails && (
            <div className="bg-dark-700 rounded-lg p-3 border border-dark-600">
              <div className="text-xs text-gray-400 mb-2 font-medium">Bank Details - Transfer to:</div>
              {selectedBankDetails.type === 'UPI' ? (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 text-sm">UPI ID</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-green-400">{selectedBankDetails.upiId}</span>
                      <button 
                        type="button"
                        onClick={() => {navigator.clipboard.writeText(selectedBankDetails.upiId); alert('Copied!')}}
                        className="text-xs bg-dark-600 hover:bg-dark-500 px-2 py-1 rounded"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Bank Name</span>
                    <span className="font-medium text-white">{selectedBankDetails.bankName}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Account Number</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-green-400">{selectedBankDetails.accountNumber}</span>
                      <button 
                        type="button"
                        onClick={() => {navigator.clipboard.writeText(selectedBankDetails.accountNumber); alert('Copied!')}}
                        className="text-xs bg-dark-600 hover:bg-dark-500 px-2 py-1 rounded"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">IFSC Code</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-yellow-400">{selectedBankDetails.ifsc}</span>
                      <button 
                        type="button"
                        onClick={() => {navigator.clipboard.writeText(selectedBankDetails.ifsc); alert('Copied!')}}
                        className="text-xs bg-dark-600 hover:bg-dark-500 px-2 py-1 rounded"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Account Holder</span>
                    <span className="font-medium text-white">{selectedBankDetails.holderName}</span>
                  </div>
                  {selectedBankDetails.branch && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Branch</span>
                      <span className="text-gray-300">{selectedBankDetails.branch}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-400 mb-1">Reference/UTR Number</label>
            <input
              type="text"
              value={referenceId}
              onChange={(e) => setReferenceId(e.target.value)}
              placeholder="Enter transaction reference"
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 focus:outline-none focus:border-green-500"
            />
          </div>

          {/* Payment Proof Image Upload */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Payment Proof (Screenshot)</label>
            <input
              type="file"
              accept="image/*"
              onChange={handleImageChange}
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 focus:outline-none focus:border-green-500 text-sm file:mr-4 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:bg-green-600 file:text-white hover:file:bg-green-700"
            />
            {imagePreview && (
              <div className="mt-2 relative">
                <img src={imagePreview} alt="Payment proof" className="w-full max-h-40 object-contain rounded-lg border border-dark-600" />
                <button
                  type="button"
                  onClick={() => { setProofImage(null); setImagePreview(''); }}
                  className="absolute top-1 right-1 bg-red-600 hover:bg-red-700 rounded-full p-1"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Remarks (Optional)</label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Any additional notes"
              rows={2}
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 focus:outline-none focus:border-green-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 py-3 rounded-lg font-medium transition"
          >
            {loading ? 'Submitting...' : 'Submit Deposit Request'}
          </button>
        </form>
      </div>
    </div>
  );
};

// Withdraw Modal Component
const WithdrawModal = ({ user, balance, adminInfo, onClose, onSuccess }) => {
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('UPI');
  const [upiId, setUpiId] = useState('');
  const [bankDetails, setBankDetails] = useState({ bankName: '', accountNumber: '', ifscCode: '', accountHolderName: '' });
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const minWithdrawal = adminInfo?.charges?.minWithdrawal || 100;
  const maxWithdrawal = adminInfo?.charges?.maxWithdrawal || 100000;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    
    if (!amt || amt <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    if (amt > balance) {
      setError('Insufficient balance');
      return;
    }
    if (amt < minWithdrawal) {
      setError(`Minimum withdrawal is ₹${minWithdrawal}`);
      return;
    }
    if (amt > maxWithdrawal) {
      setError(`Maximum withdrawal is ₹${maxWithdrawal}`);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const withdrawalDetails = paymentMethod === 'UPI' ? { upiId } : bankDetails;

      await axios.post('/api/user/funds/fund-request/withdraw', {
        amount: amt,
        paymentMethod,
        withdrawalDetails,
        remarks
      }, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit withdrawal request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Withdraw Funds</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="bg-dark-700 rounded-lg p-3 mb-4">
          <div className="text-xs text-gray-400">Available Balance</div>
          <div className="text-xl font-bold text-green-400">₹{balance.toLocaleString()}</div>
          <div className="text-xs text-gray-500 mt-1">
            Min: ₹{minWithdrawal} | Max: ₹{maxWithdrawal}
          </div>
        </div>

        {error && (
          <div className="bg-red-500/20 text-red-400 p-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Amount (₹)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount"
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 focus:outline-none focus:border-red-500"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Receive via</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 focus:outline-none focus:border-red-500"
            >
              <option value="UPI">UPI</option>
              <option value="BANK">Bank Transfer</option>
            </select>
          </div>

          {paymentMethod === 'UPI' ? (
            <div>
              <label className="block text-sm text-gray-400 mb-1">Your UPI ID</label>
              <input
                type="text"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="yourname@upi"
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 focus:outline-none focus:border-red-500"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Bank Name</label>
                <input
                  type="text"
                  value={bankDetails.bankName}
                  onChange={(e) => setBankDetails({...bankDetails, bankName: e.target.value})}
                  placeholder="Bank name"
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 focus:outline-none focus:border-red-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Account Number</label>
                <input
                  type="text"
                  value={bankDetails.accountNumber}
                  onChange={(e) => setBankDetails({...bankDetails, accountNumber: e.target.value})}
                  placeholder="Account number"
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 focus:outline-none focus:border-red-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">IFSC Code</label>
                <input
                  type="text"
                  value={bankDetails.ifscCode}
                  onChange={(e) => setBankDetails({...bankDetails, ifscCode: e.target.value})}
                  placeholder="IFSC code"
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 focus:outline-none focus:border-red-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Account Holder Name</label>
                <input
                  type="text"
                  value={bankDetails.accountHolderName}
                  onChange={(e) => setBankDetails({...bankDetails, accountHolderName: e.target.value})}
                  placeholder="Name as per bank"
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 focus:outline-none focus:border-red-500"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm text-gray-400 mb-1">Remarks (Optional)</label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Any additional notes"
              rows={2}
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 focus:outline-none focus:border-red-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 py-3 rounded-lg font-medium transition"
          >
            {loading ? 'Submitting...' : 'Submit Withdrawal Request'}
          </button>
        </form>
      </div>
    </div>
  );
};

// Copy Trading Component (Placeholder)
const CopyTrading = () => (
  <div className="p-4 md:p-6 flex items-center justify-center h-full">
    <div className="text-center">
      <Copy size={48} className="mx-auto text-gray-600 mb-4" />
      <h2 className="text-xl font-bold mb-2">Copy Trading</h2>
      <p className="text-gray-400">Coming Soon - Follow expert traders and copy their trades automatically</p>
    </div>
  </div>
);

// IB Dashboard Component (Placeholder)
const IBDashboard = () => (
  <div className="p-4 md:p-6 flex items-center justify-center h-full">
    <div className="text-center">
      <Users size={48} className="mx-auto text-gray-600 mb-4" />
      <h2 className="text-xl font-bold mb-2">IB Dashboard</h2>
      <p className="text-gray-400">Introducing Broker dashboard - Manage your referrals and commissions</p>
    </div>
  </div>
);

// Profile Component
const UserProfile = () => {
  const { user, updateUser } = useAuth();
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showBrokerModal, setShowBrokerModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Edit profile form
  const [editForm, setEditForm] = useState({
    fullName: user?.fullName || '',
    phone: user?.phone || ''
  });
  
  // Password change form
  const [passwordForm, setPasswordForm] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  
  // Broker change states
  const [availableBrokers, setAvailableBrokers] = useState([]);
  const [brokerRequests, setBrokerRequests] = useState([]);
  const [selectedBroker, setSelectedBroker] = useState('');
  const [transferReason, setTransferReason] = useState('');
  
  const fetchAvailableBrokers = async () => {
    try {
      const { data } = await axios.get('/api/user/available-brokers', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setAvailableBrokers(data);
    } catch (err) {
      console.error('Error fetching brokers:', err);
    }
  };
  
  const fetchBrokerRequests = async () => {
    try {
      const { data } = await axios.get('/api/user/broker-change-requests', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setBrokerRequests(data);
    } catch (err) {
      console.error('Error fetching broker requests:', err);
    }
  };
  
  const handleSubmitBrokerRequest = async (e) => {
    e.preventDefault();
    if (!selectedBroker) {
      setError('Please select a broker');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await axios.post('/api/user/broker-change-request', {
        requestedAdminCode: selectedBroker,
        reason: transferReason
      }, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setSuccess('Transfer request submitted!');
      setSelectedBroker('');
      setTransferReason('');
      fetchBrokerRequests();
      setTimeout(() => {
        setShowBrokerModal(false);
        setSuccess('');
      }, 1500);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit request');
    } finally {
      setLoading(false);
    }
  };
  
  const handleCancelBrokerRequest = async (requestId) => {
    if (!confirm('Cancel this request?')) return;
    try {
      await axios.delete(`/api/user/broker-change-request/${requestId}`, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      fetchBrokerRequests();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed');
    }
  };

  const handleEditProfile = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');
    
    try {
      const { data } = await axios.put('/api/user/profile', editForm, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      
      // Update local user context
      if (updateUser) {
        updateUser({ ...user, fullName: data.user.fullName, phone: data.user.phone });
      }
      
      setSuccess('Profile updated successfully');
      setTimeout(() => {
        setShowEditModal(false);
        setSuccess('');
      }, 1500);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');
    
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError('New passwords do not match');
      setLoading(false);
      return;
    }
    
    if (passwordForm.newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      setLoading(false);
      return;
    }
    
    try {
      await axios.post('/api/user/change-password', {
        oldPassword: passwordForm.oldPassword,
        newPassword: passwordForm.newPassword
      }, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      
      setSuccess('Password changed successfully');
      setPasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
      setTimeout(() => {
        setShowPasswordModal(false);
        setSuccess('');
      }, 1500);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="p-4 md:p-6 overflow-y-auto h-full">
      <h1 className="text-2xl font-bold mb-6">
        Profile
        {user?.isDemo && <span className="ml-2 text-yellow-400 text-lg">(Demo Account)</span>}
      </h1>
      
      {/* Demo Account Banner */}
      {user?.isDemo && (
        <div className="bg-gradient-to-r from-yellow-600/20 to-orange-600/20 border border-yellow-500/30 rounded-xl p-4 mb-6 max-w-2xl">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-3xl">🎮</span>
              <div>
                <h3 className="text-yellow-400 font-bold">Demo Account</h3>
                <p className="text-gray-400 text-sm">Practice trading with virtual funds</p>
              </div>
            </div>
            <span className="bg-yellow-500/20 text-yellow-400 px-3 py-1 rounded-full text-xs font-medium">
              Demo Mode
            </span>
          </div>
        </div>
      )}
      
      <div className="max-w-2xl">
        <div className="bg-dark-800 rounded-lg p-6 mb-6">
          <div className="flex items-center gap-4 mb-6">
            <div className={`w-20 h-20 bg-gradient-to-br ${user?.isDemo ? 'from-yellow-500 to-orange-600' : 'from-green-500 to-emerald-600'} rounded-full flex items-center justify-center text-3xl font-bold`}>
              {user?.fullName?.[0] || user?.username?.[0] || 'U'}
            </div>
            <div>
              <h2 className="text-xl font-bold">{user?.fullName || user?.username}</h2>
              <p className="text-gray-400">@{user?.username}</p>
              <p className="text-sm text-gray-500">User ID: {user?.userId}</p>
              {user?.isDemo && (
                <span className="inline-block mt-1 bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded text-xs font-medium">
                  Demo User
                </span>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between py-2 border-b border-dark-600">
              <span className="text-gray-400">Email</span>
              <span>{user?.email || 'Not set'}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-dark-600">
              <span className="text-gray-400">Phone</span>
              <span>{user?.phone || 'Not set'}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-dark-600">
              <span className="text-gray-400">Member Since</span>
              <span>{user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-gray-400">Account Type</span>
              <span className={user?.isDemo ? 'text-yellow-400' : 'text-green-400'}>
                {user?.isDemo ? '🎮 Demo Account' : 'Real Account'}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {/* Convert to Real Account button for demo users */}
          {user?.isDemo && (
            <button 
              onClick={() => window.dispatchEvent(new CustomEvent('openConvertModal'))}
              className="w-full bg-gradient-to-r from-yellow-600 to-orange-600 hover:from-yellow-500 hover:to-orange-500 py-3 rounded-lg transition font-medium"
            >
              🚀 Convert to Real Account
            </button>
          )}
          <button 
            onClick={() => {
              setEditForm({ fullName: user?.fullName || '', phone: user?.phone || '' });
              setError('');
              setSuccess('');
              setShowEditModal(true);
            }}
            className="w-full bg-dark-700 hover:bg-dark-600 py-3 rounded-lg transition"
          >
            Edit Profile
          </button>
          <button 
            onClick={() => {
              setPasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
              setError('');
              setSuccess('');
              setShowPasswordModal(true);
            }}
            className="w-full bg-dark-700 hover:bg-dark-600 py-3 rounded-lg transition"
          >
            Change Password
          </button>
          <button 
            onClick={() => {
              setError('');
              setSuccess('');
              setSelectedBroker('');
              setTransferReason('');
              fetchAvailableBrokers();
              fetchBrokerRequests();
              setShowBrokerModal(true);
            }}
            className="w-full bg-dark-700 hover:bg-dark-600 py-3 rounded-lg transition"
          >
            Change Broker
          </button>
        </div>
      </div>

      {/* Edit Profile Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Edit Profile</h3>
              <button onClick={() => setShowEditModal(false)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            {error && (
              <div className="bg-red-500/20 text-red-400 p-3 rounded-lg mb-4 text-sm">
                {error}
              </div>
            )}
            {success && (
              <div className="bg-green-500/20 text-green-400 p-3 rounded-lg mb-4 text-sm">
                {success}
              </div>
            )}

            <form onSubmit={handleEditProfile} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Full Name</label>
                <input
                  type="text"
                  value={editForm.fullName}
                  onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                  placeholder="Enter your full name"
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 focus:outline-none focus:border-green-500"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Phone Number</label>
                <input
                  type="tel"
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  placeholder="Enter your phone number"
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 focus:outline-none focus:border-green-500"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Email</label>
                <input
                  type="email"
                  value={user?.email || ''}
                  disabled
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-gray-500 cursor-not-allowed"
                />
                <p className="text-xs text-gray-500 mt-1">Email cannot be changed</p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 py-3 rounded-lg font-medium transition"
              >
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Change Password</h3>
              <button onClick={() => setShowPasswordModal(false)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            {error && (
              <div className="bg-red-500/20 text-red-400 p-3 rounded-lg mb-4 text-sm">
                {error}
              </div>
            )}
            {success && (
              <div className="bg-green-500/20 text-green-400 p-3 rounded-lg mb-4 text-sm">
                {success}
              </div>
            )}

            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Current Password</label>
                <input
                  type="password"
                  value={passwordForm.oldPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, oldPassword: e.target.value })}
                  placeholder="Enter current password"
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 focus:outline-none focus:border-green-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">New Password</label>
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                  placeholder="Enter new password"
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 focus:outline-none focus:border-green-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Confirm New Password</label>
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                  placeholder="Confirm new password"
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 focus:outline-none focus:border-green-500"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 py-3 rounded-lg font-medium transition"
              >
                {loading ? 'Changing...' : 'Change Password'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Change Broker Modal */}
      {showBrokerModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 rounded-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Change Broker</h3>
              <button onClick={() => setShowBrokerModal(false)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            {error && (
              <div className="bg-red-500/20 text-red-400 p-3 rounded-lg mb-4 text-sm">
                {error}
              </div>
            )}
            {success && (
              <div className="bg-green-500/20 text-green-400 p-3 rounded-lg mb-4 text-sm">
                {success}
              </div>
            )}

            <div className="bg-dark-700 rounded-lg p-3 mb-4">
              <p className="text-sm text-gray-400">Current Broker</p>
              <p className="font-mono text-green-400">{user?.adminCode}</p>
            </div>

            <form onSubmit={handleSubmitBrokerRequest} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Select New Broker</label>
                <select
                  value={selectedBroker}
                  onChange={(e) => setSelectedBroker(e.target.value)}
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 focus:outline-none focus:border-green-500"
                >
                  <option value="">-- Select Broker --</option>
                  {availableBrokers.map(broker => (
                    <option key={broker._id} value={broker.adminCode}>
                      {broker.name || broker.username} ({broker.adminCode}) - {broker.role}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Reason (Optional)</label>
                <textarea
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                  placeholder="Why do you want to change broker?"
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 focus:outline-none focus:border-green-500 h-20 resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !selectedBroker}
                className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 py-3 rounded-lg font-medium transition"
              >
                {loading ? 'Submitting...' : 'Submit Request'}
              </button>
            </form>

            {brokerRequests.length > 0 && (
              <div className="mt-6">
                <h4 className="font-medium mb-3">Your Requests</h4>
                <div className="space-y-2">
                  {brokerRequests.map(req => (
                    <div key={req._id} className="bg-dark-700 rounded-lg p-3 text-sm">
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="text-gray-400">To: </span>
                          <span>{req.requestedAdmin?.name || req.requestedAdminCode}</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          req.status === 'PENDING' ? 'bg-yellow-500/20 text-yellow-400' :
                          req.status === 'APPROVED' ? 'bg-green-500/20 text-green-400' :
                          'bg-red-500/20 text-red-400'
                        }`}>
                          {req.status}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {new Date(req.createdAt).toLocaleDateString()}
                      </div>
                      {req.status === 'PENDING' && (
                        <button
                          onClick={() => handleCancelBrokerRequest(req._id)}
                          className="mt-2 text-xs text-red-400 hover:text-red-300"
                        >
                          Cancel Request
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Support Component
const UserSupport = () => (
  <div className="p-4 md:p-6 flex items-center justify-center h-full">
    <div className="text-center max-w-md">
      <HelpCircle size={48} className="mx-auto text-gray-600 mb-4" />
      <h2 className="text-xl font-bold mb-2">Support</h2>
      <p className="text-gray-400 mb-6">Need help? Contact our support team</p>
      <div className="space-y-3">
        <button className="w-full bg-green-600 hover:bg-green-700 py-3 rounded-lg transition">
          Chat with Support
        </button>
        <button className="w-full bg-dark-700 hover:bg-dark-600 py-3 rounded-lg transition">
          View FAQ
        </button>
      </div>
    </div>
  </div>
);

// Referral Component
const UserReferral = () => {
  const { user } = useAuth();
  const [referralStats, setReferralStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [localReferralCode, setLocalReferralCode] = useState('');

  useEffect(() => {
    fetchReferralStats();
    if (user?.referralCode) {
      setLocalReferralCode(user.referralCode);
    }
  }, [user?.token, user?.referralCode]);

  const fetchReferralStats = async () => {
    if (!user?.token) return;
    try {
      const headers = { Authorization: `Bearer ${user.token}` };
      const { data } = await axios.get('/api/referral/stats', { headers });
      setReferralStats(data);
    } catch (error) {
      console.error('Error fetching referral stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateReferralCode = async () => {
    setGenerating(true);
    try {
      const headers = { Authorization: `Bearer ${user.token}` };
      const { data } = await axios.post('/api/referral/generate', {}, { headers });
      setLocalReferralCode(data.referralCode);
      alert('Referral code generated successfully!');
    } catch (error) {
      console.error('Error generating referral code:', error);
      alert(error.response?.data?.message || 'Failed to generate referral code');
    } finally {
      setGenerating(false);
    }
  };

  const copyReferralLink = () => {
    const code = localReferralCode || user.referralCode;
    const link = `${window.location.origin}/signup?ref=${code}`;
    navigator.clipboard.writeText(link);
    alert('Referral link copied to clipboard!');
  };

  const copyReferralCode = () => {
    const code = localReferralCode || user.referralCode;
    navigator.clipboard.writeText(code);
    alert('Referral code copied to clipboard!');
  };

  if (loading) {
    return <div className="p-6 text-center text-gray-400">Loading...</div>;
  }

  return (
    <div className="p-4 md:p-6 overflow-y-auto h-full">
      <h1 className="text-2xl font-bold mb-6">Share and Earn</h1>

      <div className="max-w-2xl">
        {/* Rules Section - Always visible */}
        <div className="bg-dark-800 rounded-xl p-6 border border-dark-600 mb-6">
          <h3 className="text-lg font-bold mb-4 text-white">Rules</h3>
          <div className="space-y-3 text-sm text-gray-300">
            <div className="flex gap-3">
              <span className="text-purple-400 font-bold">1.</span>
              <p>Share this link to your friends.</p>
            </div>
            <div className="flex gap-3">
              <span className="text-purple-400 font-bold">2.</span>
              <p>When your friend opens this link, tell them to register here first.</p>
            </div>
            <div className="flex gap-3">
              <span className="text-purple-400 font-bold">3.</span>
              <p>After registering, they can play any game.</p>
            </div>
            <div className="flex gap-3">
              <span className="text-purple-400 font-bold">4.</span>
              <p>You will get 5% on Nifty Jackpot only if your friend wins for the first time.</p>
            </div>
            <div className="flex gap-3">
              <span className="text-purple-400 font-bold">5.</span>
              <p>The winning amount will be credited to your account only if your friend's account places trades and plays games continuously for 1 month. Your friend needs to be actively participating in all games for 1 month. After 1 month, you will be credited with your friend's first winning amount.</p>
            </div>
          </div>
        </div>

        {/* Referral Code Section */}
        {localReferralCode || user?.referralCode ? (
          <div className="bg-gradient-to-br from-purple-900/30 to-dark-800 rounded-xl p-6 mb-6 border border-purple-600/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-purple-600 rounded-lg flex items-center justify-center">
                <Share2 size={24} className="text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-purple-300">Your Referral Link</h2>
                <p className="text-sm text-gray-400">Share this link to earn rewards</p>
              </div>
            </div>

            {/* Referral Link - Prominent Display */}
            <div className="bg-dark-700 rounded-lg p-4 mb-4">
              <div className="text-xs text-gray-400 mb-2">Referral Link</div>
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-green-400 flex-1 bg-dark-800 px-3 py-2 rounded break-all">
                  {window.location.origin}/signup?ref={localReferralCode || user.referralCode}
                </code>
                <button
                  onClick={copyReferralLink}
                  className="bg-purple-600 hover:bg-purple-500 text-white px-3 py-2 rounded-lg font-medium transition text-sm whitespace-nowrap"
                >
                  Copy Link
                </button>
              </div>
            </div>

            {/* Referral Code - Secondary */}
            <div className="bg-dark-700 rounded-lg p-4 mb-4">
              <div className="text-xs text-gray-400 mb-2">Referral Code</div>
              <div className="flex items-center justify-between">
                <code className="text-xl font-mono text-gray-300">{localReferralCode || user.referralCode}</code>
                <button
                  onClick={copyReferralCode}
                  className="bg-green-600 hover:bg-green-500 text-white px-3 py-2 rounded-lg font-medium transition text-sm"
                >
                  Copy Code
                </button>
              </div>
            </div>

            <div className="text-sm text-gray-300 leading-relaxed">
              <span className="font-semibold text-purple-300">How it works:</span> Share your referral link with friends. When they sign up and start trading or playing games, you'll earn 5% of their first game wins (top 10 only) and brokerage from their first trading win!
            </div>
          </div>
        ) : (
          <div className="bg-gradient-to-br from-purple-900/30 to-dark-800 rounded-xl p-6 mb-6 border border-purple-600/30 text-center">
            <div className="w-16 h-16 bg-purple-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Share2 size={32} className="text-purple-400" />
            </div>
            <h2 className="text-xl font-bold text-purple-300 mb-2">Get Your Referral Code</h2>
            <p className="text-gray-400 mb-4">Generate your referral code and start inviting friends to earn rewards.</p>
            <button
              onClick={generateReferralCode}
              disabled={generating}
              className="bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white px-6 py-3 rounded-lg font-medium transition-all shadow-lg shadow-purple-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? 'Generating...' : 'Generate Referral Code'}
            </button>
          </div>
        )}

        {/* Referral Stats */}
        {referralStats && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-dark-800 rounded-xl p-4 border border-dark-600">
              <div className="text-sm text-gray-400 mb-1">Total Referrals</div>
              <div className="text-2xl font-bold text-green-400">{referralStats.totalReferrals || 0}</div>
            </div>
            <div className="bg-dark-800 rounded-xl p-4 border border-dark-600">
              <div className="text-sm text-gray-400 mb-1">Total Earnings</div>
              <div className="text-2xl font-bold text-green-400">₹{(referralStats.totalEarnings || 0).toLocaleString()}</div>
            </div>
            <div className="bg-dark-800 rounded-xl p-4 border border-dark-600">
              <div className="text-sm text-gray-400 mb-1">Active Referrals</div>
              <div className="text-2xl font-bold text-green-400">{referralStats.activeReferrals || 0}</div>
            </div>
          </div>
        )}

        {/* Reward Breakdown */}
        <div className="bg-dark-800 rounded-xl p-6 border border-dark-600">
          <h3 className="text-lg font-bold mb-4">Reward Structure</h3>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-green-600/20 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                <span className="text-green-400 font-bold">5%</span>
              </div>
              <div>
                <div className="font-medium text-white">Game Wins</div>
                <div className="text-sm text-gray-400">Earn 5% of your friends' first game wins (top 10 games only)</div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-purple-600/20 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                <span className="text-purple-400 font-bold">₹</span>
              </div>
              <div>
                <div className="font-medium text-white">Trading Brokerage</div>
                <div className="text-sm text-gray-400">Earn brokerage from your friends' first winning trades</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Main Dashboard Wrapper
const UserDashboardNew = () => {
  const { user, logoutUser, refreshUserData, updateUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);
  const [darkMode, setDarkMode] = useState(true);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  
  // Demo account states
  const [demoInfo, setDemoInfo] = useState(null);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [availableBrokers, setAvailableBrokers] = useState([]);
  const [selectedBroker, setSelectedBroker] = useState('');
  const [convertLoading, setConvertLoading] = useState(false);
  const [convertError, setConvertError] = useState('');

  const fetchDemoInfo = useCallback(async () => {
    if (!user?.token) return;
    try {
      const { data } = await axios.get('/api/user/demo/info', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setDemoInfo(data);
    } catch (error) {
      console.error('Error fetching demo info:', error);
    }
  }, [user]);
  
  const fetchAvailableBrokersForDemo = async () => {
    try {
      const { data } = await axios.get('/api/user/demo/available-brokers', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setAvailableBrokers(data);
    } catch (error) {
      console.error('Error fetching brokers:', error);
    }
  };
  
  const handleConvertToReal = async () => {
    setConvertLoading(true);
    setConvertError('');
    try {
      const response = await axios.post('/api/user/demo/convert-to-real', {
        selectedBrokerCode: selectedBroker || null
      }, {
        headers: { Authorization: `Bearer ${user.token}` }
      });

      // Update user data using AuthContext's updateUser function
      const updatedUser = response.data.user;
      updateUser(updatedUser);

      alert('Account converted successfully! Your account is now a real account.');
      setShowConvertModal(false);
      setDemoInfo(null);

      // Refresh the page to ensure all components pick up the new user data
      window.location.reload();
    } catch (error) {
      setConvertError(error.response?.data?.message || 'Failed to convert account');
    } finally {
      setConvertLoading(false);
    }
  };
  
  const openConvertModal = () => {
    fetchAvailableBrokersForDemo();
    setSelectedBroker('');
    setConvertError('');
    setShowConvertModal(true);
  };

  const fetchNotifications = useCallback(async () => {
    if (!user?.token) return;
    try {
      const { data } = await axios.get('/api/user/notifications', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    }
  }, [user]);

  const fetchWalletBalance = useCallback(async () => {
    if (!user?.token) return;
    try {
      const { data } = await axios.get('/api/user/wallet', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setWalletBalance(data?.wallet?.balance || 0);
    } catch (error) {
      console.error('Error:', error);
    }
  }, [user]);

  useEffect(() => {
    fetchWalletBalance();
    fetchNotifications();
    if (user?.isDemo) {
      fetchDemoInfo();
    }

    const handleOpenConvertModal = () => openConvertModal();
    window.addEventListener('openConvertModal', handleOpenConvertModal);
    return () => window.removeEventListener('openConvertModal', handleOpenConvertModal);
  }, [fetchWalletBalance, fetchNotifications, fetchDemoInfo, user?.isDemo]);

  useEffect(() => {
    const onSoftRefresh = () => {
      fetchWalletBalance();
      fetchNotifications();
    };
    window.addEventListener(AUTO_REFRESH_EVENT, onSoftRefresh);
    return () => window.removeEventListener(AUTO_REFRESH_EVENT, onSoftRefresh);
  }, [fetchWalletBalance, fetchNotifications]);

  const markAsRead = async (notificationId) => {
    try {
      await axios.put(`/api/user/notifications/${notificationId}/read`, {}, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      fetchNotifications();
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      await axios.put('/api/user/notifications/read-all', {}, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      fetchNotifications();
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const handleLogout = () => {
    logoutUser();
    navigate('/login');
  };

  const navItems = [
    { path: '/user/home', icon: Home, label: 'Dashboard' },
    { path: '/user/accounts', icon: Users, label: 'Market' },
    { path: '/user/wallet', icon: Wallet, label: 'Wallet' },
    { path: '/user/referral', icon: Share2, label: 'Share and Earn' },
    { path: '/user/profile', icon: User, label: 'Profile' },
    { path: '/user/support', icon: HelpCircle, label: 'Support' },
  ];

  // Mobile bottom nav items (Orders is in Trader Room, not here)
  const mobileNavItems = [
    { path: '/user/home', icon: Home, label: 'Home' },
    { path: '/user/accounts', icon: Users, label: 'Market' },
    { path: '/user/wallet', icon: Wallet, label: 'Wallet' },
  ];

  const isActive = (path) => location.pathname === path || location.pathname.startsWith(path + '/');

  return (
    <div className="h-screen bg-dark-900 flex overflow-hidden">
      {/* Sidebar - Desktop & Tablet */}
      <aside className={`hidden md:flex flex-col bg-dark-800 border-r border-dark-600 transition-all duration-300 ease-in-out ${sidebarOpen ? 'w-64' : 'w-[70px]'}`}>
        {/* Logo & Collapse Button */}
        <div className="p-4 border-b border-dark-600 flex items-center justify-between">
          <Link to="/user/home" className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg flex items-center justify-center font-bold text-lg flex-shrink-0">
              FX
            </div>
            <span className={`font-bold text-lg whitespace-nowrap overflow-hidden transition-all duration-300 ${sidebarOpen ? 'w-auto opacity-100' : 'w-0 opacity-0'}`}>
              stockex
            </span>
          </Link>
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={`p-1.5 rounded-lg hover:bg-dark-700 text-gray-400 hover:text-white transition-all ${sidebarOpen ? '' : 'absolute left-[70px] -translate-x-1/2 bg-dark-800 border border-dark-600 z-10'}`}
          >
            <ChevronDown size={18} className={`transform transition-transform duration-300 ${sidebarOpen ? 'rotate-90' : '-rotate-90'}`} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2 space-y-1 overflow-y-auto overflow-x-hidden">
          {navItems.map(item => (
            <Link
              key={item.path}
              to={item.path}
              title={!sidebarOpen ? item.label : ''}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                isActive(item.path) 
                  ? 'bg-green-600 text-white' 
                  : 'text-gray-400 hover:bg-dark-700 hover:text-white'
              } ${!sidebarOpen ? 'justify-center' : ''}`}
            >
              <item.icon size={20} className="flex-shrink-0" />
              <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${sidebarOpen ? 'w-auto opacity-100' : 'w-0 opacity-0'}`}>
                {item.label}
              </span>
            </Link>
          ))}
        </nav>

        {/* Theme Toggle */}
        <div className="p-2 border-t border-dark-600">
          <button 
            onClick={() => setDarkMode(!darkMode)}
            title={!sidebarOpen ? (darkMode ? 'Light Mode' : 'Dark Mode') : ''}
            className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-gray-400 hover:bg-dark-700 hover:text-white transition ${!sidebarOpen ? 'justify-center' : ''}`}
          >
            {darkMode ? <Sun size={20} className="flex-shrink-0" /> : <Moon size={20} className="flex-shrink-0" />}
            <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${sidebarOpen ? 'w-auto opacity-100' : 'w-0 opacity-0'}`}>
              {darkMode ? 'Light Mode' : 'Dark Mode'}
            </span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="bg-dark-800 border-b border-dark-600 px-4 py-3 flex items-center justify-between">
          {/* Left - Mobile menu */}
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden text-gray-400 hover:text-white"
            >
              <Menu size={24} />
            </button>
          </div>

          {/* Right - Settings, Notifications, Profile */}
          <div className="flex items-center gap-4">
            {/* Settings */}
            <button 
              onClick={() => setShowSettingsModal(true)}
              className="text-gray-400 hover:text-white"
              title="Settings"
            >
              <Settings size={20} />
            </button>

            {/* Notifications */}
            <button 
              onClick={() => setShowNotifications(true)}
              className="relative text-gray-400 hover:text-white"
              title="Notifications"
            >
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-xs flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {/* User Menu */}
            <div className="relative">
              <button 
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2"
              >
                <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full flex items-center justify-center text-sm font-bold">
                  {user?.fullName?.[0] || user?.username?.[0] || 'U'}
                </div>
                <ChevronDown size={16} className="text-gray-400" />
              </button>

              {/* Dropdown Menu */}
              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-dark-800 border border-dark-600 rounded-lg shadow-lg z-50">
                  <div className="py-1">
                    <Link
                      to="/user/trading"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-2 text-gray-300 hover:bg-dark-700 hover:text-white"
                    >
                      <TrendingUp size={18} />
                      <span>Pay Trading</span>
                    </Link>
                    <Link
                      to="/user/transactions"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-2 text-gray-300 hover:bg-dark-700 hover:text-white"
                    >
                      <Receipt size={18} />
                      <span>Transactions</span>
                    </Link>
                    <button
                      onClick={() => { setUserMenuOpen(false); handleLogout(); }}
                      className="flex items-center gap-3 px-4 py-2 text-red-400 hover:bg-dark-700 w-full text-left"
                    >
                      <LogOut size={18} />
                      <span>Logout</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Mobile Menu Overlay */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-50 bg-black/50" onClick={() => setMobileMenuOpen(false)}>
            <div className="w-64 h-full bg-dark-800 p-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg flex items-center justify-center font-bold">
                    FX
                  </div>
                  <span className="font-bold text-lg">stockex</span>
                </div>
                <button onClick={() => setMobileMenuOpen(false)}>
                  <X size={24} />
                </button>
              </div>

              <nav className="space-y-1">
                {navItems.map(item => (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition ${
                      isActive(item.path) 
                        ? 'bg-green-600 text-white' 
                        : 'text-gray-400 hover:bg-dark-700 hover:text-white'
                    }`}
                  >
                    <item.icon size={20} />
                    <span>{item.label}</span>
                  </Link>
                ))}
              </nav>

              <div className="mt-6 pt-6 border-t border-dark-600">
                <button 
                  onClick={handleLogout}
                  className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-red-400 hover:bg-dark-700 transition"
                >
                  <LogOut size={20} />
                  <span>Logout</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Page Content */}
        <main className="flex-1 overflow-hidden bg-dark-900 pb-16 md:pb-0">
          {/* Demo Account Banner */}
          {user?.isDemo && demoInfo && (
            <div className="bg-gradient-to-r from-yellow-600/20 to-orange-600/20 border-b border-yellow-500/30 px-4 py-3">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🎮</span>
                  <div>
                    <span className="text-yellow-400 font-medium">Demo Account</span>
                    <span className="text-gray-400 text-sm ml-2">
                      {demoInfo.daysRemaining} days remaining • ₹{(demoInfo.demoBalance || 0).toLocaleString()} virtual balance
                    </span>
                  </div>
                </div>
                <button
                  onClick={openConvertModal}
                  className="px-4 py-1.5 bg-green-600 hover:bg-green-700 rounded-lg text-sm font-medium transition whitespace-nowrap"
                >
                  Convert to Real Account
                </button>
              </div>
            </div>
          )}
          <Routes>
            <Route path="home" element={<UserHome />} />
            <Route path="accounts" element={<UserAccounts />} />
            <Route path="wallet" element={<UserWalletPage />} />
            <Route path="referral" element={<UserReferral />} />
            <Route path="profile" element={<UserProfile />} />
            <Route path="support" element={<UserSupport />} />
            <Route path="trading" element={<UserTradingTransactions />} />
            <Route path="*" element={<UserHome />} />
          </Routes>
        </main>

        {/* Mobile Bottom Navigation - Fixed */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-dark-800 border-t border-dark-600 z-40">
          <div className="flex items-center justify-around py-2">
            {mobileNavItems.map(item => (
              <Link
                key={item.path}
                to={item.path}
                className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition ${
                  isActive(item.path) 
                    ? 'text-green-400' 
                    : 'text-gray-400'
                }`}
              >
                <item.icon size={22} />
                <span className="text-xs">{item.label}</span>
              </Link>
            ))}
            <button
              onClick={() => setMoreMenuOpen(true)}
              className="flex flex-col items-center gap-1 px-4 py-2 rounded-lg text-gray-400"
            >
              <MoreHorizontal size={22} />
              <span className="text-xs">More</span>
            </button>
          </div>
        </nav>

        {/* More Menu - Slide Up */}
        {moreMenuOpen && (
          <div 
            className="md:hidden fixed inset-0 z-50 bg-black/60"
            onClick={() => setMoreMenuOpen(false)}
          >
            <div 
              className="absolute bottom-0 left-0 right-0 bg-dark-800 rounded-t-2xl animate-slide-up"
              onClick={e => e.stopPropagation()}
            >
              {/* Handle bar */}
              <div className="flex justify-center py-3">
                <div className="w-12 h-1 bg-dark-600 rounded-full"></div>
              </div>
              
              {/* Menu Items */}
              <div className="px-4 pb-8 space-y-1">
                <Link
                  to="/user/transactions"
                  onClick={() => setMoreMenuOpen(false)}
                  className="flex items-center gap-4 px-4 py-3 rounded-lg hover:bg-dark-700 transition"
                >
                  <Receipt size={22} className="text-blue-400" />
                  <span className="font-medium">Transactions</span>
                </Link>
                <Link
                  to="/user/profile"
                  onClick={() => setMoreMenuOpen(false)}
                  className="flex items-center gap-4 px-4 py-3 rounded-lg hover:bg-dark-700 transition"
                >
                  <User size={22} className="text-purple-400" />
                  <span className="font-medium">Profile</span>
                </Link>
                <button
                  onClick={() => { setMoreMenuOpen(false); /* Settings modal */ }}
                  className="flex items-center gap-4 px-4 py-3 rounded-lg hover:bg-dark-700 transition w-full text-left"
                >
                  <Settings size={22} className="text-gray-400" />
                  <span className="font-medium">Settings</span>
                </button>
                <Link
                  to="/user/support"
                  onClick={() => setMoreMenuOpen(false)}
                  className="flex items-center gap-4 px-4 py-3 rounded-lg hover:bg-dark-700 transition"
                >
                  <HelpCircle size={22} className="text-yellow-400" />
                  <span className="font-medium">Support</span>
                </Link>
                <div className="border-t border-dark-600 my-2"></div>
                <button
                  onClick={() => { setMoreMenuOpen(false); handleLogout(); }}
                  className="flex items-center gap-4 px-4 py-3 rounded-lg hover:bg-dark-700 transition w-full text-left text-red-400"
                >
                  <LogOut size={22} />
                  <span className="font-medium">Logout</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Settings Modal */}
        {showSettingsModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-dark-800 rounded-lg w-full max-w-md">
              <div className="flex justify-between items-center p-4 border-b border-dark-600">
                <h2 className="text-xl font-bold">Settings</h2>
                <button onClick={() => setShowSettingsModal(false)} className="text-gray-400 hover:text-white">
                  <X size={24} />
                </button>
              </div>
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between py-3 border-b border-dark-600">
                  <div>
                    <div className="font-medium">Dark Mode</div>
                    <div className="text-sm text-gray-400">Toggle dark/light theme</div>
                  </div>
                  <button 
                    onClick={() => setDarkMode(!darkMode)}
                    className={`w-12 h-6 rounded-full transition ${darkMode ? 'bg-green-600' : 'bg-dark-600'}`}
                  >
                    <span className={`block w-5 h-5 rounded-full bg-white transition-transform ${darkMode ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between py-3 border-b border-dark-600">
                  <div>
                    <div className="font-medium">Notifications</div>
                    <div className="text-sm text-gray-400">Enable push notifications</div>
                  </div>
                  <button className="w-12 h-6 rounded-full bg-green-600">
                    <span className="block w-5 h-5 rounded-full bg-white translate-x-6" />
                  </button>
                </div>
                <div className="flex items-center justify-between py-3">
                  <div>
                    <div className="font-medium">Sound Effects</div>
                    <div className="text-sm text-gray-400">Play sounds on trades</div>
                  </div>
                  <button className="w-12 h-6 rounded-full bg-dark-600">
                    <span className="block w-5 h-5 rounded-full bg-white translate-x-1" />
                  </button>
                </div>
              </div>
              <div className="p-4 border-t border-dark-600">
                <button 
                  onClick={() => setShowSettingsModal(false)}
                  className="w-full py-2 bg-green-600 hover:bg-green-700 rounded-lg"
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Notifications Modal */}
        {showNotifications && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-dark-800 rounded-lg w-full max-w-lg max-h-[80vh] flex flex-col">
              <div className="flex justify-between items-center p-4 border-b border-dark-600">
                <div>
                  <h2 className="text-xl font-bold">Notifications</h2>
                  {unreadCount > 0 && (
                    <p className="text-sm text-gray-400">{unreadCount} unread</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <button 
                      onClick={markAllAsRead}
                      className="text-sm text-green-400 hover:text-green-300"
                    >
                      Mark all read
                    </button>
                  )}
                  <button onClick={() => setShowNotifications(false)} className="text-gray-400 hover:text-white">
                    <X size={24} />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="p-8 text-center text-gray-400">
                    <Bell size={48} className="mx-auto mb-4 opacity-50" />
                    <p>No notifications yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-dark-600">
                    {notifications.map(notif => (
                      <div 
                        key={notif._id} 
                        className={`p-4 hover:bg-dark-700 cursor-pointer ${!notif.isRead ? 'bg-dark-700/50' : ''}`}
                        onClick={() => !notif.isRead && markAsRead(notif._id)}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${!notif.isRead ? 'bg-green-500' : 'bg-gray-600'}`} />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium">{notif.title}</div>
                            <div className="text-sm text-gray-400 mt-1">{notif.message}</div>
                            <div className="text-xs text-gray-500 mt-2">
                              {new Date(notif.createdAt).toLocaleString()}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Convert Demo to Real Account Modal */}
        {showConvertModal && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-dark-800 rounded-xl w-full max-w-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">Convert to Real Account</h3>
                <button onClick={() => setShowConvertModal(false)} className="text-gray-400 hover:text-white">
                  <X size={20} />
                </button>
              </div>

              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-4">
                <p className="text-yellow-400 text-sm font-medium mb-2">⚠️ Important Notice</p>
                <ul className="text-sm text-gray-400 space-y-1">
                  <li>• Your demo balance (₹{(demoInfo?.demoBalance || 0).toLocaleString()}) will be reset to ₹0</li>
                  <li>• All trading history and positions will be deleted</li>
                  <li>• You will need to deposit real funds to trade</li>
                  <li>• This action cannot be undone</li>
                </ul>
              </div>

              {convertError && (
                <div className="bg-red-500/20 text-red-400 p-3 rounded-lg mb-4 text-sm">
                  {convertError}
                </div>
              )}

              <div className="mb-4">
                <label className="block text-sm text-gray-400 mb-2">Select Broker (Optional)</label>
                <select
                  value={selectedBroker}
                  onChange={(e) => setSelectedBroker(e.target.value)}
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2.5 focus:outline-none focus:border-green-500"
                >
                  <option value="">No broker - Direct under Super Admin</option>
                  {availableBrokers.map(broker => {
                    const displayText = broker.role === 'SUB_BROKER' 
                      ? `${broker.adminCode}${broker.parentCode ? ` (${broker.parentCode})` : ''} - SUB_BROKER`
                      : `${broker.adminCode} - ${broker.role}`;
                    const ratingStars = '★'.repeat(broker.rating || 5) + '☆'.repeat(5 - (broker.rating || 5));
                    const extraInfo = [];
                    if (broker.cityCode) {
                      extraInfo.push(`${broker.cityCode}${broker.cityName ? ` - ${broker.cityName}` : ''}`);
                    }
                    if (broker.yearsOfExperience > 0) extraInfo.push(`${broker.yearsOfExperience} yrs`);
                    const extraInfoStr = extraInfo.length > 0 ? ` | ${extraInfo.join(' • ')}` : '';
                    return (
                      <option key={broker._id} value={broker._id}>
                        {displayText} {ratingStars}{extraInfoStr}
                      </option>
                    );
                  })}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  If you don't select a broker, your account will be under the Super Admin
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowConvertModal(false)}
                  className="flex-1 bg-dark-600 hover:bg-dark-500 py-2.5 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConvertToReal}
                  disabled={convertLoading}
                  className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 py-2.5 rounded-lg font-medium transition"
                >
                  {convertLoading ? 'Converting...' : 'Convert Now'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserDashboardNew;
