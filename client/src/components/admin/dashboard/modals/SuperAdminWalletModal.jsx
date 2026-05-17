import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import axios from '../../../../config/axios';

const SuperAdminWalletModal = ({ user, onClose, onSuccess, token }) => {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [action, setAction] = useState('add');
  const [walletType, setWalletType] = useState('main'); // 'main' or 'trading'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [walletPermissions, setWalletPermissions] = useState(null);
  const [loadingPermissions, setLoadingPermissions] = useState(true);

  // Fetch wallet permissions on mount
  useEffect(() => {
    const fetchPermissions = async () => {
      try {
        const { data } = await axios.get(`/api/admin/users/${user._id}/wallet/permissions`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setWalletPermissions(data);
      } catch (err) {
        console.error('Error fetching wallet permissions:', err);
        setWalletPermissions({ canView: false, canDeposit: false, canWithdraw: false });
      } finally {
        setLoadingPermissions(false);
      }
    };

    fetchPermissions();
  }, [user._id, token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) {
      alert('Please enter a valid amount');
      return;
    }
    // Check permissions before proceeding
    const actionType = action === 'add' ? 'deposit' : 'withdraw';
    if (actionType === 'deposit' && !walletPermissions?.canDeposit) {
      alert('Permission denied: You do not have deposit permission for this user');
      return;
    }
    if (actionType === 'withdraw' && !walletPermissions?.canWithdraw) {
      alert('Permission denied: You do not have withdraw permission for this user');
      return;
    }

    setLoading(true);
    try {
      // Use the new permission-validated API endpoints
      const endpoint = action === 'add' 
        ? `/api/admin/users/${user._id}/wallet/deposit`
        : `/api/admin/users/${user._id}/wallet/withdraw`;

      await axios.post(endpoint, 
        { amount: parseFloat(amount), description },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const walletName = walletType === 'trading' ? 'Trading Wallet' : 'Main Wallet';
      alert(`${walletName}: Funds ${action === 'add' ? 'added' : 'deducted'} successfully`);
      onSuccess();
      onClose();
    } catch (error) {
      alert(error.response?.data?.message || 'Error processing request');
    } finally {
      setLoading(false);
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
      setSuccess(`Margin reset: ₹${data.oldUsedMargin} → ₹0`);
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
      setSuccess(`Margin reconciled: ₹${data.oldUsedMargin} → ₹${data.newUsedMargin} (${data.openPositionsCount} open positions)`);
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.message || 'Error reconciling margin');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-dark-800 rounded-lg p-6 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Manage Wallet</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24} /></button>
        </div>
        <div className="mb-4 p-3 bg-dark-700 rounded-lg">
          <div className="text-sm text-gray-400">User</div>
          <div className="font-medium">{user.fullName || user.username}</div>
          <div className="text-lg font-bold text-green-400 mt-1">₹{user.wallet?.cashBalance?.toLocaleString() || '0'}</div>
          <div className="flex justify-between text-sm text-gray-400 mt-1">
            <span>Trading: ₹{(user.wallet?.tradingBalance || 0).toLocaleString()}</span>
            <span className="text-yellow-400">Margin Used: ₹{(user.wallet?.usedMargin || 0).toLocaleString()}</span>
          </div>
        </div>

        {/* Margin Management */}
        {(user.wallet?.usedMargin > 0) && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-4">
            <p className="text-sm text-yellow-400 font-medium mb-2">Margin Management</p>
            <p className="text-xs text-gray-400 mb-3">If user has stuck margin with no open positions:</p>
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
          <div className="bg-red-500/20 border border-red-500 text-red-400 px-4 py-2 rounded mb-4 text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-500/20 border border-green-500 text-green-400 px-4 py-2 rounded mb-4 text-sm">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
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

          {/* Action Selection */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAction('add')}
              disabled={!walletPermissions?.canDeposit || loadingPermissions}
              className={`flex-1 py-2 rounded-lg ${action === 'add' ? 'bg-green-600' : 'bg-dark-600'} ${!walletPermissions?.canDeposit ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              Add Funds
            </button>
            <button
              type="button"
              onClick={() => setAction('deduct')}
              disabled={!walletPermissions?.canWithdraw || loadingPermissions}
              className={`flex-1 py-2 rounded-lg ${action === 'deduct' ? 'bg-red-600' : 'bg-dark-600'} ${!walletPermissions?.canWithdraw ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {walletType === 'trading' ? 'Withdraw' : 'Deduct Funds'}
            </button>
          </div>
          {/* Permission Status */}
          {loadingPermissions && (
            <div className="text-xs text-gray-400">Loading permissions...</div>
          )}
          {!loadingPermissions && walletPermissions && (
            <div className="text-xs text-gray-400">
              Permission Level: <span className="text-purple-400">{walletPermissions.permissionLevel || 'NONE'}</span>
              {!walletPermissions.canDeposit && !walletPermissions.canWithdraw && (
                <span className="text-red-400 ml-2"> (View only)</span>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-400 mb-1">Amount (₹)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2"
              placeholder="Enter amount"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Description (Optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2"
              placeholder="Enter description"
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 bg-dark-600 hover:bg-dark-500 py-2 rounded-lg">Cancel</button>
            <button 
              type="submit" 
              disabled={loading} 
              className={`flex-1 ${action === 'add' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'} disabled:opacity-50 py-2 rounded-lg`}
            >
              {loading ? 'Processing...' : action === 'add' ? 'Add Funds' : (walletType === 'trading' ? 'Withdraw' : 'Deduct Funds')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SuperAdminWalletModal;
