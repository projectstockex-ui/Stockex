import React, { useState, useEffect } from 'react';
import axios from '../../../../config/axios';
import { Lock, Users, Shield, UserPlus, DollarSign, Settings, RefreshCw, X } from 'lucide-react';

const RestrictModeModal = ({ admin: targetAdmin, token, onClose, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restrictData, setRestrictData] = useState({
    enabled: targetAdmin.restrictMode?.enabled || false,
    maxUsers: targetAdmin.restrictMode?.maxUsers || 100,
    maxBrokers: targetAdmin.restrictMode?.maxBrokers || 10,
    maxSubBrokers: targetAdmin.restrictMode?.maxSubBrokers || 20,
    currentUsers: 0,
    currentBrokers: 0,
    currentSubBrokers: 0,
    officePartnerType: targetAdmin.officePartnerType === 'INTERNAL' ? 'INTERNAL' : 'EXTERNAL',
    monthlyIncentiveAmount: targetAdmin.restrictMode?.monthlyIncentiveAmount || 0,
    monthlyIncentiveScope: targetAdmin.restrictMode?.monthlyIncentiveScope || 'games_and_trading',
    restrictBrokerage: {
      games: targetAdmin.restrictMode?.restrictBrokerage?.games || false,
      trading: targetAdmin.restrictMode?.restrictBrokerage?.trading || false,
    },
  });

  useEffect(() => {
    fetchRestrictMode();
  }, []);

  const fetchRestrictMode = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`/api/admin/manage/admins/${targetAdmin._id}/restrict-mode`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRestrictData((prev) => ({
        enabled: data.restrictMode.enabled,
        maxUsers: data.restrictMode.maxUsers,
        maxBrokers: data.restrictMode.maxBrokers,
        maxSubBrokers: data.restrictMode.maxSubBrokers,
        currentUsers: data.restrictMode.currentUsers,
        currentBrokers: data.restrictMode.currentBrokers,
        currentSubBrokers: data.restrictMode.currentSubBrokers,
        officePartnerType: prev.officePartnerType,
        monthlyIncentiveAmount: data.restrictMode?.monthlyIncentiveAmount || 0,
        monthlyIncentiveScope: data.restrictMode?.monthlyIncentiveScope || 'games_and_trading',
        restrictBrokerage: {
          games: data.restrictMode?.restrictBrokerage?.games || false,
          trading: data.restrictMode?.restrictBrokerage?.trading || false,
        },
      }));
    } catch (error) {
      console.error('Error fetching restrict mode:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.put(`/api/admin/manage/admins/${targetAdmin._id}/restrict-mode`, {
        enabled: restrictData.enabled,
        maxUsers: restrictData.maxUsers,
        maxBrokers: restrictData.maxBrokers,
        maxSubBrokers: restrictData.maxSubBrokers,
        monthlyIncentiveAmount: restrictData.monthlyIncentiveAmount,
        monthlyIncentiveScope: restrictData.monthlyIncentiveScope,
        restrictBrokerage: restrictData.restrictBrokerage,
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (targetAdmin.role === 'ADMIN') {
        await axios.put(`/api/admin/manage/admins/${targetAdmin._id}`, {
          officePartnerType: restrictData.officePartnerType,
        }, {
          headers: { Authorization: `Bearer ${token}` }
        });
      }

      alert(`Restrict mode ${restrictData.enabled ? 'enabled' : 'disabled'} successfully!`);
      onSuccess();
      onClose();
    } catch (error) {
      alert(error.response?.data?.message || 'Error updating restrict mode');
    } finally {
      setSaving(false);
    }
  };

  const getRoleLabel = (role) => {
    switch(role) {
      case 'ADMIN': return 'Admin';
      case 'BROKER': return 'Broker';
      case 'SUB_BROKER': return 'Sub Broker';
      default: return role;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-lg w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex justify-between items-center p-6 pb-4 border-b border-dark-600">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Lock size={20} className="text-red-400" />
              Restrict Mode
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              Set limits for {targetAdmin.name || targetAdmin.username} ({getRoleLabel(targetAdmin.role)})
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8"><RefreshCw className="animate-spin inline" size={24} /></div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 pt-4 space-y-6">
            {/* Enable/Disable Toggle */}
            <div className="flex items-center justify-between p-4 bg-dark-700 rounded-lg">
              <div>
                <div className="font-medium">Enable Restrict Mode</div>
                <div className="text-sm text-gray-400">Limit users and subordinates under this {getRoleLabel(targetAdmin.role).toLowerCase()}</div>
              </div>
              <button
                onClick={() => setRestrictData(prev => ({ ...prev, enabled: !prev.enabled }))}
                className={`w-14 h-7 rounded-full transition-colors ${restrictData.enabled ? 'bg-red-600' : 'bg-dark-500'}`}
              >
                <div className={`w-5 h-5 bg-white rounded-full transition-transform mx-1 ${restrictData.enabled ? 'translate-x-7' : ''}`} />
              </button>
            </div>

            {restrictData.enabled && (
              <>
                {/* Max Users */}
                <div className="p-4 bg-dark-700 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <label className="font-medium flex items-center gap-2">
                      <Users size={18} className="text-blue-400" />
                      Max Users
                    </label>
                    <span className={`text-sm px-2 py-1 rounded ${
                      restrictData.currentUsers >= restrictData.maxUsers 
                        ? 'bg-red-500/20 text-red-400' 
                        : 'bg-green-500/20 text-green-400'
                    }`}>
                      {restrictData.currentUsers} / {restrictData.maxUsers}
                    </span>
                  </div>
                  <input
                    type="number"
                    value={restrictData.maxUsers}
                    onChange={(e) => setRestrictData(prev => ({ ...prev, maxUsers: parseInt(e.target.value) || 0 }))}
                    className="w-full bg-dark-600 border border-dark-500 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                    min="0"
                  />
                  <p className="text-xs text-gray-500 mt-1">Maximum users allowed under this {getRoleLabel(targetAdmin.role).toLowerCase()}</p>
                </div>

                {/* Max Brokers (only for ADMIN) */}
                {targetAdmin.role === 'ADMIN' && (
                  <div className="p-4 bg-dark-700 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <label className="font-medium flex items-center gap-2">
                        <Shield size={18} className="text-cyan-400" />
                        Max Brokers
                      </label>
                      <span className={`text-sm px-2 py-1 rounded ${
                        restrictData.currentBrokers >= restrictData.maxBrokers 
                          ? 'bg-red-500/20 text-red-400' 
                          : 'bg-green-500/20 text-green-400'
                      }`}>
                        {restrictData.currentBrokers} / {restrictData.maxBrokers}
                      </span>
                    </div>
                    <input
                      type="number"
                      value={restrictData.maxBrokers}
                      onChange={(e) => setRestrictData(prev => ({ ...prev, maxBrokers: parseInt(e.target.value) || 0 }))}
                      className="w-full bg-dark-600 border border-dark-500 rounded-lg px-4 py-2 focus:outline-none focus:border-cyan-500"
                      min="0"
                    />
                    <p className="text-xs text-gray-500 mt-1">Maximum brokers this admin can create</p>
                  </div>
                )}

                {/* Max Sub-Brokers (for ADMIN and BROKER) */}
                {(targetAdmin.role === 'ADMIN' || targetAdmin.role === 'BROKER') && (
                  <div className="p-4 bg-dark-700 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <label className="font-medium flex items-center gap-2">
                        <UserPlus size={18} className="text-green-400" />
                        Max Sub-Brokers
                      </label>
                      <span className={`text-sm px-2 py-1 rounded ${
                        restrictData.currentSubBrokers >= restrictData.maxSubBrokers 
                          ? 'bg-red-500/20 text-red-400' 
                          : 'bg-green-500/20 text-green-400'
                      }`}>
                        {restrictData.currentSubBrokers} / {restrictData.maxSubBrokers}
                      </span>
                    </div>
                    <input
                      type="number"
                      value={restrictData.maxSubBrokers}
                      onChange={(e) => setRestrictData(prev => ({ ...prev, maxSubBrokers: parseInt(e.target.value) || 0 }))}
                      className="w-full bg-dark-600 border border-dark-500 rounded-lg px-4 py-2 focus:outline-none focus:border-green-500"
                      min="0"
                    />
                    <p className="text-xs text-gray-500 mt-1">Maximum sub-brokers allowed</p>
                  </div>
                )}
              </>
            )}

            <>
              <div className="p-4 bg-dark-700 rounded-lg border border-dark-600">
                <label className="font-medium flex items-center gap-2 mb-2 text-gray-300">
                  Office partner type (Extra Charges rules)
                </label>
                <select
                  value={restrictData.officePartnerType}
                  onChange={(e) =>
                    setRestrictData((prev) => ({ ...prev, officePartnerType: e.target.value }))
                  }
                  className="w-full bg-dark-600 border border-dark-500 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-purple-500"
                >
                  <option value="INTERNAL">INTERNAL — Office (Give Incentive, Transfer target)</option>
                  <option value="EXTERNAL">EXTERNAL — Outside partner (Take Brokerage / Transfer tree out)</option>
                </select>
                <p className="text-xs text-gray-500 mt-2">
                  INTERNAL admins cannot be charged via Take Brokerage; EXTERNAL admins can transfer their full broker tree to an INTERNAL admin before you run incentives there.
                </p>
              </div>

              {/* Monthly Incentive Amount — INTERNAL only */}
              {restrictData.officePartnerType === 'INTERNAL' && (
                <div className="p-4 bg-dark-700 rounded-lg border border-green-600/40 space-y-3">
                  <label className="font-medium flex items-center gap-2 text-green-400">
                    <DollarSign size={16} /> Monthly Incentive Amount
                  </label>
                  <input
                    type="number"
                    value={restrictData.monthlyIncentiveAmount}
                    onChange={(e) =>
                      setRestrictData((prev) => ({ ...prev, monthlyIncentiveAmount: parseFloat(e.target.value) || 0 }))
                    }
                    className="w-full bg-dark-600 border border-dark-500 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-green-500"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                  />
                  <p className="text-xs text-gray-500">
                    Pre-set monthly incentive for this INTERNAL office admin.
                  </p>

                  {/* Where to credit incentive */}
                  <div className="pt-2 border-t border-dark-600">
                    <label className="block text-sm text-green-400 mb-2">Where to credit incentive</label>
                    <div className="flex flex-col gap-2">
                      {[
                        { id: 'games_and_trading', label: 'Games & trading (split to both wallets)' },
                        { id: 'trading', label: 'Trading only (main wallet)' },
                        { id: 'games', label: 'Games only (temporary wallet)' },
                      ].map(({ id, label }) => (
                        <label key={id} className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
                          <input
                            type="radio"
                            name="monthlyIncentiveScope"
                            checked={restrictData.monthlyIncentiveScope === id}
                            onChange={() => setRestrictData((prev) => ({ ...prev, monthlyIncentiveScope: id }))}
                            className="accent-green-600"
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Brokerage Restriction Toggles */}
              <div className="p-4 bg-dark-700 rounded-lg border border-orange-600/40">
                <label className="font-medium flex items-center gap-2 mb-3 text-orange-400">
                  <Settings size={16} /> Brokerage Restriction
                </label>
                <p className="text-xs text-gray-500 mb-3">
                  When enabled, brokerage will be redirected to Super Admin instead of this admin's hierarchy
                </p>

                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={restrictData.restrictBrokerage?.games || false}
                      onChange={(e) =>
                        setRestrictData((prev) => ({ 
                          ...prev, 
                          restrictBrokerage: { 
                            ...prev.restrictBrokerage, 
                            games: e.target.checked 
                          }
                        }))
                      }
                      className="accent-orange-600"
                    />
                    <span>Restrict brokerage in games</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={restrictData.restrictBrokerage?.trading || false}
                      onChange={(e) =>
                        setRestrictData((prev) => ({ 
                          ...prev, 
                          restrictBrokerage: { 
                            ...prev.restrictBrokerage, 
                            trading: e.target.checked 
                          }
                        }))
                      }
                      className="accent-orange-600"
                    />
                    <span>Restrict brokerage in trading</span>
                  </label>
                </div>
              </div>

            </>

            {/* Warning */}
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <p className="text-xs text-yellow-400">
                ⚠️ When restrict mode is enabled, this {getRoleLabel(targetAdmin.role).toLowerCase()} cannot create more users/subordinates beyond the set limits.
              </p>
            </div>
          </div>
        )}

        {/* Actions - Fixed footer */}
        {!loading && (
          <div className="p-6 pt-4 border-t border-dark-600 flex gap-3 bg-dark-800">
            <button
              onClick={onClose}
              className="flex-1 py-2 bg-dark-600 hover:bg-dark-500 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg font-medium"
            >
              {saving ? 'Saving...' : 'Save Limits'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default RestrictModeModal;
