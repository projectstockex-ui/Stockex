/**
 * AdminPasswordResetModal component for AdminDashboard
 */
import { useState } from 'react';
import { X, Eye, EyeOff } from 'lucide-react';
import axios from '../../../../config/axios';

const AdminPasswordResetModal = ({ admin: targetAdmin, token, onClose }) => {
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const handleReset = async (e) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      setMessage({ type: 'error', text: 'Password must be at least 6 characters' });
      return;
    }
    setLoading(true);
    setMessage({ type: '', text: '' });
    try {
      await axios.put(`/api/admin/manage/admins/${targetAdmin._id}/reset-password`, { newPassword }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMessage({ type: 'success', text: 'Password reset successfully' });
      setTimeout(onClose, 1500);
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || 'Error resetting password' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-lg w-full max-w-md p-6">
        <div className="flex justify-between mb-4">
          <h2 className="text-xl font-bold">Reset Admin Password</h2>
          <button onClick={onClose}><X size={24} /></button>
        </div>
        <div className="bg-dark-700 rounded p-4 mb-4">
          <div className="text-sm text-gray-400">Resetting password for:</div>
          <div className="font-bold">{targetAdmin.name || targetAdmin.username}</div>
          <div className="text-xs text-purple-400 font-mono">{targetAdmin.adminCode}</div>
        </div>
        {message.text && (
          <div className={`p-3 rounded mb-4 ${message.type === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
            {message.text}
          </div>
        )}
        <form onSubmit={handleReset}>
          <div className="relative mb-4">
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="New Password (min 6 characters)"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 pr-10"
              required
              minLength={6}
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 bg-dark-600 py-2 rounded">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 bg-yellow-600 hover:bg-yellow-700 py-2 rounded">
              {loading ? 'Resetting...' : 'Reset Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AdminPasswordResetModal;
