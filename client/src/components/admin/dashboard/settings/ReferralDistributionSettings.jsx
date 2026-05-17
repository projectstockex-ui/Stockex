import React, { useState, useEffect } from 'react';
import { Users } from 'lucide-react';
import axios from '../../../../config/axios';
import { useAuth } from '../../../../context/AuthContext';

const ReferralDistributionSettings = () => {
  const { admin } = useAuth();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [settings, setSettings] = useState({
    enabled: false,
    percentage: 0
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const { data } = await axios.get('/api/admin/referral-settings', {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setSettings(data);
    } catch (error) {
      console.error('Error fetching referral settings:', error);
    }
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      await axios.put('/api/admin/referral-settings', settings, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setMessage({ type: 'success', text: 'Settings saved successfully' });
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || 'Failed to save settings' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-dark-800 rounded-lg p-6 border border-dark-600">
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <Users className="w-5 h-5" />
        Referral Distribution Settings
      </h3>
      
      {message.text && (
        <div className={`mb-4 p-3 rounded ${message.type === 'success' ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'}`}>
          {message.text}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
              className="w-5 h-5 rounded border-dark-500 text-purple-600 focus:ring-purple-500 bg-dark-800"
            />
            <span className="text-sm text-gray-300">Enable Referral Distribution</span>
          </label>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-2">Distribution Percentage (%)</label>
          <input
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={settings.percentage}
            onChange={(e) => setSettings({ ...settings, percentage: parseFloat(e.target.value) || 0 })}
            className="w-full bg-dark-700 border border-dark-600 rounded px-4 py-2 text-white"
          />
        </div>

        <button
          onClick={handleSave}
          disabled={loading}
          className="w-full bg-purple-600 hover:bg-purple-700 text-white font-medium py-2 px-4 rounded transition disabled:opacity-50"
        >
          {loading ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
};

export default ReferralDistributionSettings;
