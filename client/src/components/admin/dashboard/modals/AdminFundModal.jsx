/**
 * AdminFundModal component for AdminDashboard
 */
import { useState } from 'react';
import { X, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import axios from '../../../../config/axios';

const AdminFundModal = ({ admin: targetAdmin, token, onClose, onSuccess }) => {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleFund = async (action) => {
    if (!amount || Number(amount) <= 0) return setError('Enter valid amount');
    setLoading(true);
    setError('');
    try {
      await axios.post(`/api/admin/manage/admins/${targetAdmin._id}/${action}-funds`, { 
        amount: Number(amount),
        description 
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAmount('');
      setDescription('');
      onSuccess();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-lg w-full max-w-md p-6">
        <div className="flex justify-between mb-4">
          <h2 className="text-xl font-bold">Manage Admin Wallet</h2>
          <button onClick={onClose}><X size={24} /></button>
        </div>
        <div className="bg-dark-700 rounded p-4 mb-4">
          <div className="text-sm text-gray-400">{targetAdmin.name || targetAdmin.username}</div>
          <div className="text-xs text-purple-400 font-mono">{targetAdmin.adminCode}</div>
          <div className="text-2xl font-bold text-green-400 mt-2">{targetAdmin.wallet?.balance?.toLocaleString() || '0'}</div>
        </div>
        {error && <div className="bg-red-500/20 text-red-400 p-2 rounded mb-4">{error}</div>}
        <input type="number" placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 mb-3" />
        <input type="text" placeholder="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 mb-4" />
        <div className="flex gap-3">
          <button onClick={() => handleFund('add')} disabled={loading} className="flex-1 bg-green-600 hover:bg-green-700 py-2 rounded flex items-center justify-center gap-2">
            <ArrowUpCircle size={18} /> Deposit
          </button>
          <button onClick={() => handleFund('deduct')} disabled={loading} className="flex-1 bg-red-600 hover:bg-red-700 py-2 rounded flex items-center justify-center gap-2">
            <ArrowDownCircle size={18} /> Withdraw
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminFundModal;
