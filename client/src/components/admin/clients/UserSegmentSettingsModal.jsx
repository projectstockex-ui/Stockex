import React, { useState, useEffect } from 'react';
import { useAuth } from '../../../context/AuthContext';
import axios from '../../../config/axios';
import { X, Save, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

const UserSegmentSettingsModal = ({ user, onClose, onSave }) => {
  const { admin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [expandedSegment, setExpandedSegment] = useState(null);
  const [segmentPermissions, setSegmentPermissions] = useState({});

  const segments = ['NSEFUT', 'NSEOPT', 'MCXFUT', 'MCXOPT', 'NSE-EQ', 'BSE-FUT', 'BSE-OPT', 'FOREXFUT', 'FOREXOPT', 'CRYPTOFUT', 'CRYPTOOPT'];

  const defaultSegmentSettings = {
    enabled: false,
    maxExchangeLots: 100,
    commissionType: 'PER_LOT',
    commissionLot: 0,
    maxLots: 50,
    minLots: 1,
    orderLots: 10,
    intradayLeverage: 1,
    carryForwardLeverage: 1,
    exposureIntraday: 1,
    exposureCarryForward: 1,
    cryptoSpreadInr: 0,
    cryptoSpreadUsdPerSide: 0,
    cryptoStartTime: '',
    cryptoClosingTime: '',
    cryptoReferenceSymbol: '',
    cryptoPricePerLotInr: 0,
    cryptoLotSizeLots: 1,
    cryptoLotSizeQuantity: 0,
    allowLimitPendingOrders: true,
    optionBuy: { allowed: true, commissionType: 'PER_LOT', commission: 0, strikeSelection: 50, maxExchangeLots: 100 },
    optionSell: { allowed: true, commissionType: 'PER_LOT', commission: 0, strikeSelection: 50, maxExchangeLots: 100 }
  };

  useEffect(() => {
    fetchUserSettings();
  }, [user]);

  const fetchUserSettings = async () => {
    try {
      setLoading(true);
      const { data } = await axios.get(`/api/admin/manage/users/${user._id}/segment-settings`, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });

      const normalized = {};
      segments.forEach(seg => {
        normalized[seg] = { ...defaultSegmentSettings, ...(data.segmentPermissions?.[seg] || {}) };
      });
      setSegmentPermissions(normalized);
    } catch (error) {
      console.error('Error fetching user settings:', error);
      // If endpoint doesn't exist, initialize with defaults
      const normalized = {};
      segments.forEach(seg => {
        normalized[seg] = { ...defaultSegmentSettings };
      });
      setSegmentPermissions(normalized);
    } finally {
      setLoading(false);
    }
  };

  const handleSegmentChange = (segment, field, value) => {
    setSegmentPermissions(prev => ({
      ...prev,
      [segment]: { ...prev[segment], [field]: value }
    }));
  };

  const handleOptionChange = (segment, optionType, field, value) => {
    setSegmentPermissions(prev => ({
      ...prev,
      [segment]: {
        ...prev[segment],
        [optionType]: { ...prev[segment][optionType], [field]: value }
      }
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage({ type: '', text: '' });
    try {
      console.log('[UserSegmentSettingsModal] Saving data:', segmentPermissions);
      const response = await axios.put(`/api/admin/manage/users/${user._id}/segment-settings`,
        { segmentPermissions },
        { headers: { Authorization: `Bearer ${admin.token}` } }
      );
      console.log('[UserSegmentSettingsModal] Save response:', response.data);
      setMessage({ type: 'success', text: 'Settings saved successfully!' });
      setTimeout(() => onSave(), 1000);
    } catch (error) {
      console.error('[UserSegmentSettingsModal] Save error:', error);
      setMessage({ type: 'error', text: error.response?.data?.message || 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  const toggleSegment = (segment) => {
    setExpandedSegment(expandedSegment === segment ? null : segment);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
        <Loader2 className="animate-spin text-purple-500" size={48} />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-xl border border-dark-700 w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-dark-700 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">Segment Settings</h2>
            <p className="text-gray-400 text-sm mt-1">
              Configure segment settings for <span className="text-purple-400">{user.username}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white hover:bg-dark-700 rounded-lg transition"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 relative">
          {message.text && (
            <div className={`fixed bottom-24 left-1/2 transform -translate-x-1/2 z-50 px-6 py-3 rounded-lg shadow-lg ${
              message.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
            }`}>
              {message.text}
            </div>
          )}

          <div className="space-y-3">
            {segments.map((segment) => (
              <div key={segment} className="bg-dark-700 rounded-lg border border-dark-600 overflow-hidden">
                {/* Segment Header */}
                <div
                  className="p-4 flex items-center justify-between cursor-pointer hover:bg-dark-600 transition"
                  onClick={() => toggleSegment(segment)}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={segmentPermissions[segment]?.enabled || false}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleSegmentChange(segment, 'enabled', e.target.checked);
                      }}
                      className="w-5 h-5 rounded border-dark-500 text-purple-600 focus:ring-purple-500 bg-dark-800"
                    />
                    <span className="font-semibold text-white">{segment}</span>
                  </div>
                  {expandedSegment === segment ? (
                    <ChevronUp className="text-gray-400" size={20} />
                  ) : (
                    <ChevronDown className="text-gray-400" size={20} />
                  )}
                </div>

                {/* Segment Details */}
                {expandedSegment === segment && (
                  <div className="p-4 border-t border-dark-600 space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Max Lots</label>
                        <input
                          type="number"
                          value={segmentPermissions[segment]?.maxLots || 0}
                          onChange={(e) => handleSegmentChange(segment, 'maxLots', parseInt(e.target.value) || 0)}
                          className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Min Lots</label>
                        <input
                          type="number"
                          value={segmentPermissions[segment]?.minLots || 0}
                          onChange={(e) => handleSegmentChange(segment, 'minLots', parseInt(e.target.value) || 0)}
                          className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Order Lots</label>
                        <input
                          type="number"
                          value={segmentPermissions[segment]?.orderLots || 0}
                          onChange={(e) => handleSegmentChange(segment, 'orderLots', parseInt(e.target.value) || 0)}
                          className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Intraday Leverage (x)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={segmentPermissions[segment]?.intradayLeverage ?? 1}
                          onChange={(e) => handleSegmentChange(segment, 'intradayLeverage', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                          className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Carry Forward Leverage (x)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={segmentPermissions[segment]?.carryForwardLeverage ?? 1}
                          onChange={(e) => handleSegmentChange(segment, 'carryForwardLeverage', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                          className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Exposure Intraday</label>
                        <input
                          type="number"
                          step="0.1"
                          value={segmentPermissions[segment]?.exposureIntraday ?? 1}
                          onChange={(e) => handleSegmentChange(segment, 'exposureIntraday', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                          className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Exposure Carry Forward</label>
                        <input
                          type="number"
                          step="0.1"
                          value={segmentPermissions[segment]?.exposureCarryForward ?? 1}
                          onChange={(e) => handleSegmentChange(segment, 'exposureCarryForward', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                          className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Max Exchange Lots</label>
                        <input
                          type="number"
                          value={segmentPermissions[segment]?.maxExchangeLots || 0}
                          onChange={(e) => handleSegmentChange(segment, 'maxExchangeLots', parseInt(e.target.value) || 0)}
                          className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
                        />
                      </div>
                    </div>

                    {/* Commission Settings */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Commission Type</label>
                        <select
                          value={segmentPermissions[segment]?.commissionType || 'PER_LOT'}
                          onChange={(e) => handleSegmentChange(segment, 'commissionType', e.target.value)}
                          className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
                        >
                          <option value="PER_LOT">Per Lot</option>
                          <option value="PERCENTAGE">Percentage</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Commission Lot</label>
                        <input
                          type="number"
                          step="0.01"
                          value={segmentPermissions[segment]?.commissionLot || 0}
                          onChange={(e) => handleSegmentChange(segment, 'commissionLot', parseFloat(e.target.value) || 0)}
                          className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
                        />
                      </div>
                    </div>

                    {/* Option Settings */}
                    {(segment.includes('OPT') || segment === 'CRYPTOOPT') && (
                      <div className="border-t border-dark-600 pt-4 mt-4">
                        <h4 className="text-sm font-semibold text-white mb-3">Option Settings</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-dark-800 p-3 rounded-lg">
                            <h5 className="text-xs text-gray-400 mb-2">Option Buy</h5>
                            <div className="space-y-2">
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={segmentPermissions[segment]?.optionBuy?.allowed || false}
                                  onChange={(e) => handleOptionChange(segment, 'optionBuy', 'allowed', e.target.checked)}
                                  className="w-4 h-4 rounded border-dark-500 text-purple-600 focus:ring-purple-500 bg-dark-900"
                                />
                                <span className="text-xs text-white">Allowed</span>
                              </label>
                              <div>
                                <label className="block text-xs text-gray-500 mb-1">Commission</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={segmentPermissions[segment]?.optionBuy?.commission || 0}
                                  onChange={(e) => handleOptionChange(segment, 'optionBuy', 'commission', parseFloat(e.target.value) || 0)}
                                  className="w-full px-2 py-1 bg-dark-900 border border-dark-700 rounded text-white text-xs focus:outline-none focus:border-purple-500"
                                />
                              </div>
                            </div>
                          </div>
                          <div className="bg-dark-800 p-3 rounded-lg">
                            <h5 className="text-xs text-gray-400 mb-2">Option Sell</h5>
                            <div className="space-y-2">
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={segmentPermissions[segment]?.optionSell?.allowed || false}
                                  onChange={(e) => handleOptionChange(segment, 'optionSell', 'allowed', e.target.checked)}
                                  className="w-4 h-4 rounded border-dark-500 text-purple-600 focus:ring-purple-500 bg-dark-900"
                                />
                                <span className="text-xs text-white">Allowed</span>
                              </label>
                              <div>
                                <label className="block text-xs text-gray-500 mb-1">Commission</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={segmentPermissions[segment]?.optionSell?.commission || 0}
                                  onChange={(e) => handleOptionChange(segment, 'optionSell', 'commission', parseFloat(e.target.value) || 0)}
                                  className="w-full px-2 py-1 bg-dark-900 border border-dark-700 rounded text-white text-xs focus:outline-none focus:border-purple-500"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Crypto Settings */}
                    {segment.includes('CRYPTO') && (
                      <div className="border-t border-dark-600 pt-4 mt-4">
                        <h4 className="text-sm font-semibold text-white mb-3">Crypto Settings</h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">Spread (INR)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={segmentPermissions[segment]?.cryptoSpreadInr || 0}
                              onChange={(e) => handleSegmentChange(segment, 'cryptoSpreadInr', parseFloat(e.target.value) || 0)}
                              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">Spread (USD/Side)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={segmentPermissions[segment]?.cryptoSpreadUsdPerSide || 0}
                              onChange={(e) => handleSegmentChange(segment, 'cryptoSpreadUsdPerSide', parseFloat(e.target.value) || 0)}
                              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">Price Per Lot (INR)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={segmentPermissions[segment]?.cryptoPricePerLotInr || 0}
                              onChange={(e) => handleSegmentChange(segment, 'cryptoPricePerLotInr', parseFloat(e.target.value) || 0)}
                              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-dark-700 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-dark-700 hover:bg-dark-600 text-white rounded-lg transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold disabled:opacity-50 flex items-center gap-2 transition"
          >
            <Save size={18} />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserSegmentSettingsModal;
