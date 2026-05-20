import React, { useState, useEffect } from 'react';
import axios from '../../../../config/axios';
import { useAuth } from '../../../../context/AuthContext';

const SuperAdminCreateUser = () => {
  const { admin } = useAuth();

  const [admins, setAdmins] = useState([]);
  const [selectedAdmin, setSelectedAdmin] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const [formData, setFormData] = useState({
    username: '', email: '', password: '', fullName: '', phone: '', initialBalance: 0,
    marginType: 'exposure',
    ledgerBalanceClosePercent: 90,
    profitTradeHoldSeconds: 0,
    lossTradeHoldSeconds: 0,
    isActivated: true,
    isReadOnly: false,
    isDemo: false,
    intradaySquare: false,
    blockLimitAboveBelowHighLow: false,
    blockLimitBetweenHighLow: false
  });

  useEffect(() => {
    fetchAdmins();
  }, []);

  const fetchAdmins = async () => {
    try {
      const { data } = await axios.get('/api/admin/manage/admins', {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      const allAdmins = [
        { _id: 'SUPER', username: 'Super Admin (Direct)', adminCode: 'SUPER' },
        ...data
      ];
      setAdmins(allAdmins);
      setSelectedAdmin('SUPER');
    } catch (error) {
      console.error('Error fetching admins:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ type: '', text: '' });

    try {
      const targetAdmin = admins.find(a => a._id === selectedAdmin);
      const adminCode = targetAdmin?.adminCode || 'SUPER';

      const {
        username, email, password, fullName, phone, initialBalance,
        marginType, ledgerBalanceClosePercent, profitTradeHoldSeconds, lossTradeHoldSeconds,
        isActivated, isReadOnly, isDemo, intradaySquare,
        blockLimitAboveBelowHighLow, blockLimitBetweenHighLow
      } = formData;

      const payload = {
        username, email, password, fullName, phone, initialBalance,
        marginType, ledgerBalanceClosePercent, profitTradeHoldSeconds, lossTradeHoldSeconds,
        isActivated, isReadOnly, isDemo, intradaySquare,
        blockLimitAboveBelowHighLow, blockLimitBetweenHighLow,
        adminCode
      };

      const { data } = await axios.post('/api/admin/manage/create-user', payload, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });

      setMessage({ type: 'success', text: `User created successfully! User ID: ${data.user?.userId || data.userId}` });
      setFormData({
        username: '', email: '', password: '', fullName: '', phone: '', initialBalance: 0,
        marginType: 'exposure', ledgerBalanceClosePercent: 90, profitTradeHoldSeconds: 0, lossTradeHoldSeconds: 0,
        isActivated: true, isReadOnly: false, isDemo: false, intradaySquare: false,
        blockLimitAboveBelowHighLow: false, blockLimitBetweenHighLow: false
      });
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || 'Failed to create user' });
    } finally {
      setLoading(false);
    }
  };

  const ToggleSwitch = ({ label, checked, onChange }) => (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-gray-300">{label}</span>
      <button
        type="button"
        onClick={onChange}
        className={`relative w-12 h-6 rounded-full transition-colors ${checked ? 'bg-green-600' : 'bg-dark-600'}`}
      >
        <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'left-7' : 'left-1'}`} />
      </button>
    </div>
  );

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Create User</h1>
        <p className="text-gray-400 text-sm mt-1">Create a new user with comprehensive settings</p>
      </div>

      {message.text && (
        <div className={`mb-4 p-3 rounded-lg ${message.type === 'success' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column - Basic Info */}
        <div className="bg-dark-800 rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold text-yellow-500 mb-4">Basic Information</h2>

          {/* Assign to Admin */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Assign to Admin</label>
            <select
              value={selectedAdmin}
              onChange={(e) => setSelectedAdmin(e.target.value)}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
            >
              {admins.map(a => (
                <option key={a._id} value={a._id}>{a.username} ({a.adminCode})</option>
              ))}
            </select>
          </div>

          {/* Username */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Username *</label>
            <input
              type="text"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
              required
            />
          </div>

          {/* Full Name */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Full Name</label>
            <input
              type="text"
              value={formData.fullName}
              onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Email *</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
              required
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Phone</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Password *</label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
              required
              minLength={6}
            />
          </div>
        </div>

        {/* Right Column - Settings */}
        <div className="space-y-6">
          {/* Trading Settings */}
          <div className="bg-dark-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-yellow-500 mb-4">Trading Settings</h2>

            {/* Ledger Balance Close % */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">Ledger Balance Close (%)</label>
              <input
                type="number"
                value={formData.ledgerBalanceClosePercent}
                onChange={(e) => setFormData({ ...formData, ledgerBalanceClosePercent: parseInt(e.target.value) || 90 })}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
                min="0"
                max="100"
              />
              <p className="text-xs text-gray-500 mt-1">Close positions when loss reaches this % of ledger balance</p>
            </div>

            {/* Profit Trade Hold Seconds */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">Profit Trade Hold (seconds)</label>
              <input
                type="number"
                value={formData.profitTradeHoldSeconds}
                onChange={(e) => setFormData({ ...formData, profitTradeHoldSeconds: parseInt(e.target.value) || 0 })}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
                min="0"
              />
            </div>

            {/* Loss Trade Hold Seconds */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">Loss Trade Hold (seconds)</label>
              <input
                type="number"
                value={formData.lossTradeHoldSeconds}
                onChange={(e) => setFormData({ ...formData, lossTradeHoldSeconds: parseInt(e.target.value) || 0 })}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
                min="0"
              />
            </div>
          </div>

          {/* Toggle Settings */}
          <div className="bg-dark-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-yellow-500 mb-4">Account Controls</h2>
            <ToggleSwitch
              label="Activation"
              checked={formData.isActivated}
              onChange={() => setFormData({ ...formData, isActivated: !formData.isActivated })}
            />
            <ToggleSwitch
              label="Read Only"
              checked={formData.isReadOnly}
              onChange={() => setFormData({ ...formData, isReadOnly: !formData.isReadOnly })}
            />
            <ToggleSwitch
              label="Demo Account"
              checked={formData.isDemo}
              onChange={() => setFormData({ ...formData, isDemo: !formData.isDemo })}
            />
            <ToggleSwitch
              label="Intraday Square (3:29 PM)"
              checked={formData.intradaySquare}
              onChange={() => setFormData({ ...formData, intradaySquare: !formData.intradaySquare })}
            />
            <ToggleSwitch
              label="Block Limit Above/Below High Low"
              checked={formData.blockLimitAboveBelowHighLow}
              onChange={() => setFormData({ ...formData, blockLimitAboveBelowHighLow: !formData.blockLimitAboveBelowHighLow })}
            />
            <ToggleSwitch
              label="Block Limit Between High Low"
              checked={formData.blockLimitBetweenHighLow}
              onChange={() => setFormData({ ...formData, blockLimitBetweenHighLow: !formData.blockLimitBetweenHighLow })}
            />
          </div>
        </div>

        {/* Settings Inheritance Info - Full Width */}
        <div className="lg:col-span-2 bg-dark-800 rounded-lg p-6">
          <div className="p-4 bg-yellow-900/20 border border-yellow-600/30 rounded-lg">
            <h3 className="text-sm font-semibold text-yellow-400 mb-2">Segment Settings</h3>
            <p className="text-xs text-gray-400">
              Segment permissions are automatically inherited from the selected admin's settings.
              To change defaults for an admin, go to the admin's settings page and configure segment settings there.
              After creating a user, you can also customize their individual settings from the user management page.
            </p>
          </div>
        </div>

        {/* Submit Button - Full Width */}
        <div className="lg:col-span-2">
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-yellow-600 hover:bg-yellow-700 rounded-lg font-semibold disabled:opacity-50"
          >
            {loading ? 'Creating User...' : 'Create User'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default SuperAdminCreateUser;
