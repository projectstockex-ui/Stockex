import { useState } from 'react';
import { useAuth } from '../../../context/AuthContext';
import axios from 'axios';

const AdminCreateUser = () => {
  const { admin } = useAuth();
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ type: '', text: '' });

    try {
      const {
        username, email, password, fullName, phone, initialBalance,
        ledgerBalanceClosePercent, profitTradeHoldSeconds, lossTradeHoldSeconds,
        isActivated, isReadOnly, isDemo, intradaySquare,
        blockLimitAboveBelowHighLow, blockLimitBetweenHighLow
      } = formData;

      const payload = {
        username,
        email,
        password,
        fullName,
        phone,
        initialBalance,
        ledgerBalanceClosePercent,
        profitTradeHoldSeconds,
        lossTradeHoldSeconds,
        isActivated,
        isReadOnly,
        isDemo,
        intradaySquare,
        blockLimitAboveBelowHighLow,
        blockLimitBetweenHighLow
      };

      const { data } = await axios.post('/api/admin/users', payload, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });

      setMessage({ type: 'success', text: `User created successfully! User ID: ${data._id}` });
      setFormData(prev => ({
        ...prev,
        username: '', email: '', password: '', fullName: '', phone: '', initialBalance: 0,
        isActivated: true, isReadOnly: false, isDemo: false, intradaySquare: false,
        blockLimitAboveBelowHighLow: false, blockLimitBetweenHighLow: false
      }));
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
        <p className="text-gray-400 text-sm mt-1">Create a new user for your admin account</p>
      </div>

      {message.text && (
        <div className={`mb-4 p-3 rounded-lg ${message.type === 'success' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column - Basic Info */}
        <div className="bg-dark-800 rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold text-purple-500 mb-4">Basic Information</h2>
          
          <div>
            <label className="block text-sm text-gray-400 mb-2">Assigned to Admin</label>
            <input
              type="text"
              value={`${admin.username} (${admin.adminCode})`}
              disabled
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-gray-400 cursor-not-allowed"
            />
            <p className="text-xs text-gray-500 mt-1">Users will be created under your admin account</p>
          </div>

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

          <div>
            <label className="block text-sm text-gray-400 mb-2">Full Name</label>
            <input
              type="text"
              value={formData.fullName}
              onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
            />
          </div>

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

          <div>
            <label className="block text-sm text-gray-400 mb-2">Phone</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
            />
          </div>

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
          <div className="bg-dark-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-purple-500 mb-4">Trading Settings</h2>
            
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

          <div className="bg-dark-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-purple-500 mb-4">Account Controls</h2>
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
          <div className="p-4 bg-blue-900/20 border border-blue-600/30 rounded-lg">
            <h3 className="text-sm font-semibold text-blue-400 mb-2">Segment Settings</h3>
            <p className="text-xs text-gray-400">
              Segment permissions are automatically inherited from your admin account settings. 
              To change these defaults, go to <strong className="text-blue-300">My Settings</strong> in the admin panel. 
              After creating a user, you can also customize their individual settings from the user management page.
            </p>
          </div>
        </div>

        {/* Submit Button - Full Width */}
        <div className="lg:col-span-2">
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold disabled:opacity-50"
          >
            {loading ? 'Creating User...' : 'Create User'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AdminCreateUser;
