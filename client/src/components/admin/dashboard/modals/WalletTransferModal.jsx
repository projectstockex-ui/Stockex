/**
 * WalletTransferModal component for AdminDashboard
 */
import { useState } from 'react';
import { X, ArrowRightLeft, ArrowDown } from 'lucide-react';
import axios from '../../../../config/axios';

const WalletTransferModal = ({ admin: targetAdmin, token, onClose, onSuccess }) => {
  const [sourceWallet, setSourceWallet] = useState('wallet');
  const [targetWallet, setTargetWallet] = useState('cryptoWallet');
  const [amount, setAmount] = useState('');
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleTransfer = async () => {
    if (!amount || Number(amount) <= 0) return setError('Enter valid amount');
    if (sourceWallet === targetWallet) return setError('Source and target wallets cannot be the same');
    
    setLoading(true);
    setError('');
    setSuccess('');
    
    try {
      await axios.post(`/api/admin/manage/admins/${targetAdmin._id}/wallet-transfer`, { 
        sourceWallet,
        targetWallet,
        amount: Number(amount),
        remarks
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSuccess(`Successfully transferred ₹${Number(amount).toLocaleString()} from ${getWalletDisplayName(sourceWallet)} to ${getWalletDisplayName(targetWallet)}`);
      setAmount('');
      setRemarks('');
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (err) {
      setError(err.response?.data?.message || 'Transfer failed');
    } finally {
      setLoading(false);
    }
  };

  const getWalletDisplayName = (walletType) => {
    switch(walletType) {
      case 'wallet': return 'Trading Wallet';
      case 'cryptoWallet': return 'Crypto Wallet';
      case 'forexWallet': return 'Forex Wallet';
      case 'mcxWallet': return 'MCX Wallet';
      case 'gamesWallet': return 'Games Wallet';
      default: return walletType;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-lg w-full max-w-lg p-6">
        <div className="flex justify-between mb-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <ArrowRightLeft size={24} /> Wallet Transfer
          </h2>
          <button onClick={onClose}><X size={24} /></button>
        </div>
        
        <div className="bg-dark-700 rounded p-4 mb-4">
          <div className="text-sm text-gray-400">{targetAdmin.name || targetAdmin.username}</div>
          <div className="text-xs text-purple-400 font-mono">{targetAdmin.adminCode}</div>
        </div>

        {error && <div className="bg-red-500/20 text-red-400 p-3 rounded mb-4">{error}</div>}
        {success && <div className="bg-green-500/20 text-green-400 p-3 rounded mb-4">{success}</div>}

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Source Wallet</label>
            <select 
              value={sourceWallet} 
              onChange={e => setSourceWallet(e.target.value)}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
            >
              <option value="wallet">Trading Wallet</option>
              <option value="cryptoWallet">Crypto Wallet</option>
              <option value="forexWallet">Forex Wallet</option>
              <option value="mcxWallet">MCX Wallet</option>
              <option value="gamesWallet">Games Wallet</option>
            </select>
          </div>

          <div className="flex justify-center">
            <ArrowDown size={24} className="text-gray-500" />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Target Wallet</label>
            <select 
              value={targetWallet} 
              onChange={e => setTargetWallet(e.target.value)}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
            >
              <option value="wallet">Trading Wallet</option>
              <option value="cryptoWallet">Crypto Wallet</option>
              <option value="forexWallet">Forex Wallet</option>
              <option value="mcxWallet">MCX Wallet</option>
              <option value="gamesWallet">Games Wallet</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Amount (₹)</label>
            <input 
              type="number" 
              placeholder="Enter amount" 
              value={amount} 
              onChange={e => setAmount(e.target.value)} 
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2" 
              min="0"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Remarks (optional)</label>
            <input 
              type="text" 
              placeholder="Transfer remarks" 
              value={remarks} 
              onChange={e => setRemarks(e.target.value)} 
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2" 
            />
          </div>

          <button 
            onClick={handleTransfer} 
            disabled={loading}
            className="w-full bg-purple-600 hover:bg-purple-700 py-2 rounded flex items-center justify-center gap-2"
          >
            {loading ? 'Transferring...' : <><ArrowRightLeft size={18} /> Transfer Funds</>}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WalletTransferModal;
