import React, { useState } from 'react';
import { X } from 'lucide-react';
import axios from '../../../../config/axios';

const CryptoWalletModal = ({ user, onClose, onSuccess, token }) => {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [action, setAction] = useState('add');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) {
      alert('Please enter a valid amount');
      return;
    }
    setLoading(true);
    try {
      const endpoint = action === 'add' ? 'add-crypto-funds' : 'deduct-crypto-funds';
      await axios.post(`/api/admin/manage/users/${user._id}/${endpoint}`, 
        { amount: parseFloat(amount), description },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      alert(`Crypto funds ${action === 'add' ? 'added' : 'deducted'} successfully`);
      onSuccess();
      onClose();
    } catch (error) {
      alert(error.response?.data?.message || 'Error processing request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-dark-800 rounded-lg p-6 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <span className="text-orange-400">₿</span> Manage Crypto Wallet
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24} /></button>
        </div>
        <div className="mb-4 p-3 bg-gradient-to-r from-orange-900/30 to-dark-700 rounded-lg border border-orange-500/30">
          <div className="text-sm text-gray-400">User</div>
          <div className="font-medium">{user.fullName || user.username}</div>
          <div className="text-lg font-bold text-orange-400 mt-1">
            ${(user.cryptoWallet?.balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} USDT
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAction('add')}
              className={`flex-1 py-2 rounded-lg ${action === 'add' ? 'bg-green-600' : 'bg-dark-600'}`}
            >
              Add USDT
            </button>
            <button
              type="button"
              onClick={() => setAction('deduct')}
              className={`flex-1 py-2 rounded-lg ${action === 'deduct' ? 'bg-red-600' : 'bg-dark-600'}`}
            >
              Deduct USDT
            </button>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Amount ($)</label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2"
              placeholder="Enter USDT amount"
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
              className={`flex-1 ${action === 'add' ? 'bg-orange-600 hover:bg-orange-700' : 'bg-red-600 hover:bg-red-700'} disabled:opacity-50 py-2 rounded-lg`}
            >
              {loading ? 'Processing...' : action === 'add' ? 'Add USDT' : 'Deduct USDT'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CryptoWalletModal;
