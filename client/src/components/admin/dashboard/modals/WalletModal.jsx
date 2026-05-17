import React, { useState, useEffect } from 'react';
import { X, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import axios from '../../../../config/axios';
import { useAuth } from '../../../../context/AuthContext';

const WalletModal = ({ user, onClose, onSuccess, token, isDirectClient = true }) => {
  const { admin, updateAdmin } = useAuth();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [walletData, setWalletData] = useState(null);
  const [adminBalance, setAdminBalance] = useState(admin?.wallet?.balance || 0);
  const [walletType, setWalletType] = useState('main'); // 'main' or 'trading'

  useEffect(() => {
    fetchWallet();
  }, []);

  const fetchWallet = async () => {
    try {
      const { data } = await axios.get(`/api/admin/manage/users/${user._id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setWalletData(data);
    } catch (err) {
      console.error('Error fetching wallet:', err);
    }
  };

  const handleResetMargin = async () => {
    if (!confirm('Are you sure you want to reset this user\'s margin to 0? This should only be done if there are no open positions.')) {
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const { data } = await axios.post(`/api/admin/manage/users/${user._id}/reset-margin`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSuccess(`Margin reset: ${data.oldUsedMargin} → 0`);
      fetchWallet();
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.message || 'Error resetting margin');
    } finally {
      setLoading(false);
    }
  };

  const handleReconcileMargin = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const { data } = await axios.post(`/api/admin/manage/users/${user._id}/reconcile-margin`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSuccess(`Margin reconciled: ${data.oldUsedMargin} → ${data.newUsedMargin} (${data.openPositionsCount} open positions)`);
      fetchWallet();
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.message || 'Error reconciling margin');
    } finally {
      setLoading(false);
    }
  };

  const handleTransaction = async (type) => {
    if (!amount || Number(amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    setLoading(true);
    setError('');
    try {
      // Use the correct API that handles admin wallet deduction/credit
      let endpoint;
      if (walletType === 'trading') {
        endpoint = type === 'deposit' 
          ? `/api/admin/manage/users/${user._id}/add-trading-funds`
          : `/api/admin/manage/users/${user._id}/deduct-trading-funds`;
      } else {
        endpoint = type === 'deposit' 
          ? `/api/admin/manage/users/${user._id}/add-funds`
          : `/api/admin/manage/users/${user._id}/deduct-funds`;
      }
      
      const { data } = await axios.post(endpoint, 
        { amount: Number(amount), description },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setAmount('');
      setDescription('');
      fetchWallet();
      onSuccess();
      
      // Update admin balance display and context if available
      if (data.adminWallet) {
        setAdminBalance(data.adminWallet.balance);
        // Update admin context so balance is reflected across the app
        updateAdmin({ wallet: data.adminWallet });
      }
    } catch (err) {
      setError(err.response?.data?.message || `Error ${type}ing funds`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-dark-800 rounded-lg w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Manage Wallet</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        {/* Admin Wallet Info */}
        {admin?.role === 'ADMIN' && (
          <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 mb-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-purple-400">Your Wallet Balance</span>
              <span className="text-lg font-bold text-purple-400">₹{adminBalance.toLocaleString()}</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">Funds will be deducted from your wallet when depositing to user</p>
          </div>
        )}

        {/* User Wallet Info */}
        <div className="bg-dark-700 rounded-lg p-4 mb-4">
          <p className="text-gray-400 text-sm">User: {user.fullName || user.username}</p>
          <p className="text-2xl font-bold text-green-400 mt-1">
            ₹{(walletData?.wallet?.cashBalance || walletData?.wallet?.balance || 0).toLocaleString()}
          </p>
          <div className="flex justify-between text-sm text-gray-400 mt-1">
            <span>Cash Balance: ₹{(walletData?.wallet?.cashBalance || 0).toLocaleString()}</span>
            <span>Trading: ₹{(walletData?.wallet?.tradingBalance || 0).toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-yellow-400">Margin Used: ₹{(walletData?.wallet?.usedMargin || 0).toLocaleString()}</span>
            <span className="text-gray-400">Available: ₹{((walletData?.wallet?.tradingBalance || 0) - (walletData?.wallet?.usedMargin || 0)).toLocaleString()}</span>
          </div>
        </div>

        {/* Margin Management */}
        {(walletData?.wallet?.usedMargin > 0) && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-4">
            <p className="text-sm text-yellow-400 font-medium mb-2">Margin Management</p>
            <p className="text-xs text-gray-400 mb-3">If user has stuck margin with no open positions, use these options:</p>
            <div className="flex gap-2">
              <button
                onClick={handleReconcileMargin}
                disabled={loading}
                className="flex-1 text-xs bg-blue-600 hover:bg-blue-700 py-2 px-3 rounded disabled:opacity-50"
              >
                Reconcile Margin
              </button>
              <button
                onClick={handleResetMargin}
                disabled={loading}
                className="flex-1 text-xs bg-red-600 hover:bg-red-700 py-2 px-3 rounded disabled:opacity-50"
              >
                Reset to Zero
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-500/20 border border-red-500 text-red-400 px-4 py-2 rounded mb-4">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-500/20 border border-green-500 text-green-400 px-4 py-2 rounded mb-4">
            {success}
          </div>
        )}

        <div className="space-y-4">
          {/* Wallet Type Selection */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Select Wallet</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setWalletType('main')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${walletType === 'main' ? 'bg-blue-600 text-white' : 'bg-dark-600 text-gray-400'}`}
              >
                Main Wallet
              </button>
              <button
                type="button"
                onClick={() => setWalletType('trading')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${walletType === 'trading' ? 'bg-purple-600 text-white' : 'bg-dark-600 text-gray-400'}`}
              >
                Trading Wallet
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Amount (₹)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 focus:outline-none focus:border-green-500"
              placeholder="Enter amount"
              min="0"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Description (Optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 focus:outline-none focus:border-green-500"
              placeholder="Transaction note"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={() => handleTransaction('deposit')}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 py-2 rounded transition disabled:opacity-50"
          >
            <ArrowUpCircle size={18} />
            {walletType === 'trading' ? 'Add to Trading' : 'Deposit'}
          </button>
          <button
            onClick={() => handleTransaction('withdraw')}
            disabled={loading || !isDirectClient}
            className={`flex-1 flex items-center justify-center gap-2 ${isDirectClient ? 'bg-red-600 hover:bg-red-700' : 'bg-dark-600 cursor-not-allowed opacity-50'} py-2 rounded transition disabled:opacity-50`}
          >
            <ArrowDownCircle size={18} />
            {walletType === 'trading' ? 'Withdraw from Trading' : 'Withdraw'}
          </button>
        </div>

        {/* Transaction History */}
        {walletData?.wallet?.transactions?.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-medium text-gray-400 mb-2">Recent Transactions</h3>
            <div className="max-h-40 overflow-y-auto space-y-2">
              {walletData.wallet.transactions.slice(-5).reverse().map((tx, idx) => (
                <div key={idx} className="flex items-center justify-between bg-dark-700 rounded px-3 py-2 text-sm">
                  <div>
                    <span className={tx.type === 'deposit' || tx.type === 'credit' ? 'text-green-400' : 'text-red-400'}>
                      {tx.type.toUpperCase()}
                    </span>
                    <span className="text-gray-400 ml-2">{tx.description}</span>
                  </div>
                  <span className={tx.type === 'deposit' || tx.type === 'credit' ? 'text-green-400' : 'text-red-400'}>
                    {tx.type === 'deposit' || tx.type === 'credit' ? '+' : '-'}₹{tx.amount}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full mt-4 bg-dark-600 hover:bg-dark-500 py-2 rounded transition"
        >
          Close
        </button>
      </div>
    </div>
  );
};

export default WalletModal;
