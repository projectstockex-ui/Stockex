import React, { useState } from 'react';
import { X, Eye, EyeOff } from 'lucide-react';
import axios from '../../../../config/axios';

const SuperAdminPasswordModal = ({ user, onClose, token }) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 6) {
      alert('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      await axios.put(`/api/admin/manage/users/${user._id}/password`, { password }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert('Password updated successfully');
      onClose();
    } catch (error) {
      alert(error.response?.data?.message || 'Error updating password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-dark-800 rounded-lg p-6 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Change Password</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24} /></button>
        </div>
        <div className="mb-4 p-3 bg-dark-700 rounded-lg">
          <div className="text-sm text-gray-400">User</div>
          <div className="font-medium">{user.fullName || user.username}</div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <label className="block text-sm text-gray-400 mb-1">New Password</label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 pr-10"
              placeholder="Enter new password"
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-8 text-gray-400">
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 bg-dark-600 hover:bg-dark-500 py-2 rounded-lg">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 py-2 rounded-lg">
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SuperAdminPasswordModal;
