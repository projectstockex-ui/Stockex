import React, { useState, useEffect, useRef } from 'react';
import { Save } from 'lucide-react';
import axios from '../../../../config/axios';
import { useAuth } from '../../../../context/AuthContext';
import { normalizeMongoMapOfObjects, isCryptoQtyOnlySegment } from '../utils';
import { computeSegmentExplicitKeys } from '../../../../utils/segmentExplicitKeys';
import { canManageLimitPendingSegmentGate, LIMIT_PENDING_HELP_TEXT } from '../../../../lib/adminSegmentRoleGates';
import CryptoSegmentAdminExtras from '../ui/CryptoSegmentAdminExtras';

const MySegmentSettings = () => {
  const { admin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [expandedSegment, setExpandedSegment] = useState(null);
  const [segmentPermissions, setSegmentPermissions] = useState({});
  const [scriptSettings, setScriptSettings] = useState({});
  const [activeTab, setActiveTab] = useState('segments');
  const [segmentSymbols, setSegmentSymbols] = useState({});
  const [selectedScriptSegment, setSelectedScriptSegment] = useState(null);
  const [selectedScript, setSelectedScript] = useState(null);
  const [scriptSearchTerm, setScriptSearchTerm] = useState('');
  const [systemSegBaseline, setSystemSegBaseline] = useState({});
  const mySettingsFetchGenRef = useRef(0);

  const segments = ['NSEFUT', 'NSEOPT', 'MCXFUT', 'MCXOPT', 'NSE-EQ', 'BSE-FUT', 'BSE-OPT', 'FOREXFUT', 'FOREXOPT', 'CRYPTOFUT', 'CRYPTOOPT'];

  const defaultSegmentSettings = {
    enabled: false, maxExchangeLots: 100, commissionType: 'PER_LOT', commissionLot: 0,
    maxLots: 50, minLots: 1, orderLots: 10, cryptoSpreadInr: 0, cryptoSpreadUsdPerSide: 0,
    cryptoStartTime: '', cryptoClosingTime: '', cryptoReferenceSymbol: '', cryptoPricePerLotInr: 0,
    cryptoLotSizeLots: 1,
    cryptoLotSizeQuantity: 0,
    allowLimitPendingOrders: true,
    intradayLeverage: 1,
    carryForwardLeverage: 1,
    optionBuy: { allowed: true, commissionType: 'PER_LOT', commission: 0, strikeSelection: 50, maxExchangeLots: 100 },
    optionSell: { allowed: true, commissionType: 'PER_LOT', commission: 0, strikeSelection: 50, maxExchangeLots: 100 }
  };

  const showLimitPendingGate = canManageLimitPendingSegmentGate(admin?.role);

  useEffect(() => {
    fetchSettings();
    fetchSegmentSymbols();
  }, []);

  const fetchSettings = async () => {
    const myId = ++mySettingsFetchGenRef.current;
    try {
      const { data } = await axios.get('/api/admin/my-settings', {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      if (myId !== mySettingsFetchGenRef.current) return;

      const sp = normalizeMongoMapOfObjects(data.segmentPermissions || {});
      const normalized = {};
      segments.forEach(seg => {
        normalized[seg] = { ...defaultSegmentSettings, ...(sp[seg] || {}) };
      });
      setSegmentPermissions(normalized);
      setScriptSettings(normalizeMongoMapOfObjects(data.scriptSettings || {}));
      if (data.adminSegmentDefaults && typeof data.adminSegmentDefaults === 'object') {
        setSystemSegBaseline({ ...data.adminSegmentDefaults });
      }
    } catch (error) {
      if (myId === mySettingsFetchGenRef.current) {
        setMessage({ type: 'error', text: 'Failed to load settings' });
      }
    } finally {
      if (myId === mySettingsFetchGenRef.current) {
        setLoading(false);
      }
    }
  };

  const fetchSegmentSymbols = async () => {
    try {
      const { data } = await axios.get('/api/instruments/settings-data', {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      const symbols = {};
      for (const [segKey, scripts] of Object.entries(data.scripts || {})) {
        symbols[segKey] = scripts.map(s => s.baseSymbol);
      }
      setSegmentSymbols(symbols);
    } catch (error) {
      console.error('Error fetching segment symbols:', error);
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
    try {
      setSaving(true);
      const explicit = computeSegmentExplicitKeys(segmentPermissions, systemSegBaseline);
      await axios.put('/api/admin/my-settings', {
        segmentPermissions: explicit,
        scriptSettings
      }, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setMessage({ type: 'success', text: 'Settings saved successfully' });
      setTimeout(() => setMessage({ type: '', text: '' }), 3000);
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  const toggleSegment = (segment) => {
    setExpandedSegment(expandedSegment === segment ? null : segment);
  };

  if (loading) {
    return <div className="p-6 text-gray-400">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-white">My Segment Settings</h2>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded transition disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {message.text && (
        <div className={`p-4 rounded ${message.type === 'success' ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'}`}>
          {message.text}
        </div>
      )}

      <div className="space-y-4">
        {segments.map(segment => (
          <div key={segment} className="bg-dark-800 rounded-lg border border-dark-600 overflow-hidden">
            <button
              onClick={() => toggleSegment(segment)}
              className="w-full px-4 py-3 flex justify-between items-center hover:bg-dark-700 transition"
            >
              <span className="font-medium text-white">{segment}</span>
              <div className="flex items-center gap-4">
                <span className={`text-sm px-3 py-1 rounded ${segmentPermissions[segment]?.enabled ? 'bg-green-600' : 'bg-red-600'}`}>
                  {segmentPermissions[segment]?.enabled ? 'Enabled' : 'Disabled'}
                </span>
                <span className="text-gray-400">{expandedSegment === segment ? '▼' : '▶'}</span>
              </div>
            </button>

            {expandedSegment === segment && (
              <div className="p-4 border-t border-dark-600">
                <div className="mb-4">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={segmentPermissions[segment]?.enabled === true}
                      onChange={(e) => handleSegmentChange(segment, 'enabled', e.target.checked)}
                      className="w-5 h-5 rounded border-dark-500 text-purple-600 focus:ring-purple-500 bg-dark-800"
                    />
                    <span className="text-sm text-gray-300">Enable {segment}</span>
                  </label>
                </div>

                {segmentPermissions[segment]?.enabled && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div className="col-span-2 md:col-span-4 mb-2 rounded-lg border border-dark-600 bg-dark-700/60 p-3">
                      <label className="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 shrink-0"
                          checked={segmentPermissions[segment].defaultIntradayOnly === true}
                          onChange={(e) =>
                            handleSegmentChange(segment, 'defaultIntradayOnly', e.target.checked)}
                        />
                        <span>
                          <span className="text-sm font-medium text-gray-200">
                            Default intraday-only orders (EOD auto square)
                          </span>
                          <span className="mt-1 block text-xs text-gray-500">
                            Merged with Super Admin defaults → hierarchy → user. Traders have no dashboard toggle for this flag.
                          </span>
                        </span>
                      </label>
                    </div>

                    {showLimitPendingGate && (
                    <div className="col-span-2 md:col-span-4 mb-2 rounded-lg border border-dark-600 bg-dark-700/60 p-3">
                      <label className="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 shrink-0"
                          checked={segmentPermissions[segment].allowLimitPendingOrders !== false}
                          onChange={(e) =>
                            handleSegmentChange(segment, 'allowLimitPendingOrders', e.target.checked)}
                        />
                        <span>
                          <span className="text-sm font-medium text-gray-200">
                            Allow limit & pending (LIMIT / SL-M) orders
                          </span>
                          <span className="mt-1 block text-xs text-gray-500">
                            {LIMIT_PENDING_HELP_TEXT}
                          </span>
                        </span>
                      </label>
                    </div>
                    )}

                    <div className="col-span-2 md:col-span-4 mt-2">
                      <h4 className="text-sm font-semibold text-purple-400 mb-2">Leverage Settings</h4>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Intraday Leverage (x)</label>
                      <input
                        type="number"
                        min="1"
                        step="0.1"
                        value={segmentPermissions[segment].intradayLeverage || 1}
                        onChange={(e) => handleSegmentChange(segment, 'intradayLeverage', Number(e.target.value))}
                        className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Carryforward Leverage (x)</label>
                      <input
                        type="number"
                        min="1"
                        step="0.1"
                        value={segmentPermissions[segment].carryForwardLeverage || 1}
                        onChange={(e) => handleSegmentChange(segment, 'carryForwardLeverage', Number(e.target.value))}
                        className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
                      />
                    </div>
                    {[
                      { label: isCryptoQtyOnlySegment(segment) ? 'Max Exchange Qty' : 'Max Exchange Lots', field: 'maxExchangeLots' },
                      { label: isCryptoQtyOnlySegment(segment) ? 'Max Qty' : 'Max Lots', field: 'maxLots' },
                      { label: isCryptoQtyOnlySegment(segment) ? 'Min Qty' : 'Min Lots', field: 'minLots' },
                      { label: isCryptoQtyOnlySegment(segment) ? 'Order Qty' : 'Order Lots (Breakup)', field: 'orderLots' }
                    ].map(({ label, field }) => (
                      <div key={field}>
                        <label className="block text-xs text-gray-400 mb-1">{label}</label>
                        <input
                          type="number"
                          value={segmentPermissions[segment][field] || 0}
                          onChange={(e) => handleSegmentChange(segment, field, Number(e.target.value))}
                          className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
                        />
                      </div>
                    ))}

                    {['CRYPTOFUT', 'CRYPTOOPT'].includes(segment) && (
                      <div className="col-span-2 md:col-span-4">
                        <CryptoSegmentAdminExtras
                          segmentKey={segment}
                          slice={segmentPermissions[segment]}
                          onFieldChange={(field, value) => handleSegmentChange(segment, field, value)}
                        />
                      </div>
                    )}

                    <div className="col-span-2 md:col-span-4 mt-2">
                      <h4 className="text-sm font-semibold text-purple-400 mb-2">Leverage Settings</h4>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Intraday Leverage (x)</label>
                      <input
                        type="number"
                        min="1"
                        step="0.1"
                        value={segmentPermissions[segment].intradayLeverage || 1}
                        onChange={(e) => handleSegmentChange(segment, 'intradayLeverage', Number(e.target.value))}
                        className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Carryforward Leverage (x)</label>
                      <input
                        type="number"
                        min="1"
                        step="0.1"
                        value={segmentPermissions[segment].carryForwardLeverage || 1}
                        onChange={(e) => handleSegmentChange(segment, 'carryForwardLeverage', Number(e.target.value))}
                        className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
                      />
                    </div>

                    <div className="col-span-2 md:col-span-4 mt-2">
                      <h4 className="text-sm font-semibold text-green-400 mb-2">Brokerage Settings</h4>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Commission (₹)</label>
                      <input
                        type="number"
                        value={segmentPermissions[segment].commissionLot || 0}
                        onChange={(e) => handleSegmentChange(segment, 'commissionLot', Number(e.target.value))}
                        className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Commission Type</label>
                      <select
                        value={segmentPermissions[segment].commissionType || 'PER_LOT'}
                        onChange={(e) => handleSegmentChange(segment, 'commissionType', e.target.value)}
                        className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
                      >
                        <option value="PER_LOT">Per Lot</option>
                        <option value="PER_TRADE">Per Trade</option>
                        <option value="PER_CRORE">Per Crore</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default MySegmentSettings;
