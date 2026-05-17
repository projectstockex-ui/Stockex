/**
 * AddBankModal component for AdminDashboard
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import axios from '../../../../config/axios';

const AddBankModal = ({ token, onClose, onSuccess }) => {
  const [type, setType] = useState('BANK');
  const [formData, setFormData] = useState({ holderName: '', bankName: '', accountNumber: '', ifsc: '', upiId: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await axios.post('/api/admin/manage/bank-accounts', { type, ...formData }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      onSuccess();
    } catch (error) {
      alert(error.response?.data?.message || 'Error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-lg w-full max-w-md p-6">
        <div className="flex justify-between mb-4">
          <h2 className="text-xl font-bold">Add Payment Method</h2>
          <button onClick={onClose}><X size={24} /></button>
        </div>
        <div className="flex gap-2 mb-4">
          <button onClick={() => setType('BANK')} className={`flex-1 py-2 rounded ${type === 'BANK' ? 'bg-blue-600' : 'bg-dark-700'}`}>Bank</button>
          <button onClick={() => setType('UPI')} className={`flex-1 py-2 rounded ${type === 'UPI' ? 'bg-purple-600' : 'bg-dark-700'}`}>UPI</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="text" placeholder="Account Holder Name *" value={formData.holderName} onChange={e => setFormData({...formData, holderName: e.target.value})} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2" required />
          {type === 'BANK' ? (
            <>
              <input type="text" placeholder="Bank Name *" value={formData.bankName} onChange={e => setFormData({...formData, bankName: e.target.value})} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2" required />
              <input type="text" placeholder="Account Number *" value={formData.accountNumber} onChange={e => setFormData({...formData, accountNumber: e.target.value})} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2" required />
              <input type="text" placeholder="IFSC Code *" value={formData.ifsc} onChange={e => setFormData({...formData, ifsc: e.target.value})} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2" required />
            </>
          ) : (
            <input type="text" placeholder="UPI ID *" value={formData.upiId} onChange={e => setFormData({...formData, upiId: e.target.value})} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2" required />
          )}
          <button type="submit" disabled={loading} className="w-full bg-green-600 py-2 rounded">{loading ? 'Adding...' : 'Add Account'}</button>
        </form>
      </div>
    </div>
  );
};

export default AddBankModal;
