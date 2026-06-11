import React, { useState, useEffect, useMemo, useRef } from 'react';
import { RefreshCw, X } from 'lucide-react';
import axios from '../../../../config/axios';
import { computeSegmentExplicitKeys } from '../../../../utils/segmentExplicitKeys.js';
import {
  canManageLimitPendingSegmentGate,
  canEditMcxSessionTiming,
  canEditNseBseSessionTiming,
  canEditCryptoSessionTiming,
  showLimitPendingHierarchyTarget,
  LIMIT_PENDING_HELP_TEXT,
} from '../../../../lib/adminSegmentRoleGates.js';
import {
  requiredUnitForCommissionType,
  commissionAmountLabel,
  commissionHelperText,
  unitOptionsForCommissionType,
} from '../../../../utils/commissionTypeUnit.js';
import OptionBuySellFields from '../../segment/OptionBuySellFields.jsx';
import SegmentBrokerageFields from '../../segment/SegmentBrokerageFields.jsx';
import FranchiseSegmentBrokerageNotice from '../../segment/FranchiseSegmentBrokerageNotice.jsx';
import { isAdminFranchiseBrokerageActive } from '../../../../utils/franchiseSegmentBrokerage.js';
import { normalizeSegmentCommissionFields } from '../../../../utils/segmentCommissionType.js';
import {
  numInputValue,
  parseNumInput,
  parseIntInput,
  parseNonNegativeNumInput,
  patchSegmentField,
} from '../../../../utils/segmentFormValues.js';
import SegmentNumberInput from '../../segment/SegmentNumberInput.jsx';
import CryptoSegmentAdminExtras from '../ui/CryptoSegmentAdminExtras.jsx';
import McxSegmentAdminExtras from '../ui/McxSegmentAdminExtras.jsx';
import NseBseSegmentAdminExtras from '../ui/NseBseSegmentAdminExtras.jsx';

function normalizeCryptoIstClock24(inputStr) {
  const s = String(inputStr ?? '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const H = Number(m[1]);
  const Mi = Number(m[2]);
  const Sec = m[3] != null ? Number(m[3]) : 0;
  if (![H, Mi, Sec].every(Number.isFinite)) return null;
  if (H < 0 || H > 23 || Mi < 0 || Mi > 59 || Sec < 0 || Sec > 59) return null;
  return `${String(H).padStart(2, '0')}:${String(Mi).padStart(2, '0')}:${String(Sec).padStart(2, '0')}`;
}

function formatStoredCryptoIstClock(raw) {
  const s = raw != null && raw !== '' ? String(raw).trim() : '';
  if (!s) return '';
  const n = normalizeCryptoIstClock24(s);
  return n ?? s;
}

function isCryptoQtyOnlySegment(seg) {
  return ['CRYPTOFUT', 'CRYPTOOPT'].includes(String(seg || '').toUpperCase());
}

const AdminChargesModal = ({ admin: targetAdmin, viewerRole, token, onClose, onSuccess }) => {
  const [activeTab, setActiveTab] = useState('segments');
  const segmentKeys = ['NSEFUT', 'NSEOPT', 'MCXFUT', 'MCXOPT', 'NSE-EQ', 'BSE-FUT', 'BSE-OPT', 'FOREXFUT', 'FOREXOPT', 'CRYPTOFUT', 'CRYPTOOPT'];
  const hideSegmentBrokerage = isAdminFranchiseBrokerageActive(targetAdmin);

  // General settings state
  const [adminSettings, setAdminSettings] = useState({
    brokerage: {
      perLot: targetAdmin.defaultSettings?.brokerage?.perLot ?? 0,
      perCrore: targetAdmin.defaultSettings?.brokerage?.perCrore ?? 0,
      perTrade: targetAdmin.defaultSettings?.brokerage?.perTrade ?? 0
    },
    leverage: {
      intraday: targetAdmin.defaultSettings?.leverage?.intraday ?? targetAdmin.leverageSettings?.intradayLeverage,
      carryForward: targetAdmin.defaultSettings?.leverage?.carryForward ?? targetAdmin.leverageSettings?.carryForwardLeverage
    },
    charges: {
      depositFee: targetAdmin.defaultSettings?.charges?.depositFee ?? 0,
      withdrawalFee: targetAdmin.defaultSettings?.charges?.withdrawalFee ?? 0,
      tradingFee: targetAdmin.defaultSettings?.charges?.tradingFee ?? 0
    },
    lotSettings: {
      maxLotSize: targetAdmin.defaultSettings?.lotSettings?.maxLotSize,
      minLotSize: targetAdmin.defaultSettings?.lotSettings?.minLotSize
    },
    quantitySettings: {
      maxQuantity: targetAdmin.defaultSettings?.quantitySettings?.maxQuantity,
      breakupQuantity: targetAdmin.defaultSettings?.quantitySettings?.breakupQuantity,
      maxLotQuantity: targetAdmin.defaultSettings?.quantitySettings?.maxLotQuantity ?? 0,
      maxBid: targetAdmin.defaultSettings?.quantitySettings?.maxBid ?? 0
    },
    autosquare: targetAdmin.defaultSettings?.autosquare ?? 0
  });

  const [permissions, setPermissions] = useState({
    canChangeBrokerage: targetAdmin.permissions?.canChangeBrokerage ?? false,
    canChangeCharges: targetAdmin.permissions?.canChangeCharges ?? false,
    canChangeLeverage: targetAdmin.permissions?.canChangeLeverage ?? false,
    canChangeLotSettings: targetAdmin.permissions?.canChangeLotSettings ?? false,
    canChangeTradingSettings: targetAdmin.permissions?.canChangeTradingSettings ?? false,
    canChangeQuantitySettings: targetAdmin.permissions?.canChangeQuantitySettings ?? false,
    canUseLotSettingsMode: targetAdmin.permissions?.canUseLotSettingsMode ?? true,
    canUseQuantitySettingsMode: targetAdmin.permissions?.canUseQuantitySettingsMode ?? true,
    canCreateUsers: targetAdmin.permissions?.canCreateUsers !== false,
    canManageFunds: targetAdmin.permissions?.canManageFunds !== false
  });

  // Segment permissions state
  const [segDefs, setSegDefs] = useState({});
  const [systemSegBaseline, setSystemSegBaseline] = useState({});
  const [expandedSeg, setExpandedSeg] = useState('NSEFUT');

  // Script settings state
  const [scriptDefs, setScriptDefs] = useState({});
  const [scriptSearch, setScriptSearch] = useState('');
  const [selectedScript, setSelectedScript] = useState('');
  const [modalScriptSymbolList, setModalScriptSymbolList] = useState([]);
  const [modalScriptSuggestOpen, setModalScriptSuggestOpen] = useState(false);
  const modalScriptComboboxRef = useRef(null);

  const modalFilteredScriptSuggestions = useMemo(() => {
    const q = scriptSearch.trim().toUpperCase();
    const list = modalScriptSymbolList;
    if (!q) return list.slice(0, 120);
    return list.filter((s) => s.includes(q)).slice(0, 120);
  }, [scriptSearch, modalScriptSymbolList]);

  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [message, setMessage] = useState({ type: '', text: '' });

  const loadSegScriptSettings = async () => {
    try {
      setFetching(true);
      const { data } = await axios.get(`/api/admin/manage/admins/${targetAdmin._id}/segment-settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (data.segmentPermissions) {
        const sp = data.segmentPermissions;
        const normalized = {};
        Object.keys(sp).forEach((k) => {
          const ob = sp[k]?.optionBuy || {};
          const os = sp[k]?.optionSell || {};
          const sysBase = data.adminSegmentDefaults?.[k] || {};
          normalized[k] = normalizeSegmentCommissionFields(
            { ...sp[k], optionBuy: ob, optionSell: os },
            sysBase
          );
        });
        setSegDefs(normalized);
      }
      if (data.adminSegmentDefaults && typeof data.adminSegmentDefaults === 'object') {
        setSystemSegBaseline({ ...data.adminSegmentDefaults });
      }
      if (data.scriptSettings) {
        const ss = data.scriptSettings;
        const normalized = {};
        Object.keys(ss).forEach((k) => {
          normalized[k] = { ...ss[k] };
        });
        setScriptDefs(normalized);
      }
    } catch (err) {
      console.error('Error fetching segment/script settings:', err);
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    loadSegScriptSettings();
  }, [targetAdmin._id, token]);

  useEffect(() => {
    if (activeTab !== 'scripts') return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get('/api/instruments/settings-data', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (cancelled) return;
        const seen = new Set();
        const list = [];
        for (const scripts of Object.values(data.scripts || {})) {
          for (const s of scripts || []) {
            const sym = (s.baseSymbol || s.name || '').toString().trim().toUpperCase();
            if (sym && !seen.has(sym)) {
              seen.add(sym);
              list.push(sym);
            }
          }
        }
        list.sort((a, b) => a.localeCompare(b));
        setModalScriptSymbolList(list);
      } catch (e) {
        console.error('Error fetching script symbols:', e);
        if (!cancelled) setModalScriptSymbolList([]);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, token]);

  useEffect(() => {
    if (!modalScriptSuggestOpen) return;
    const close = (e) => {
      if (modalScriptComboboxRef.current && !modalScriptComboboxRef.current.contains(e.target)) {
        setModalScriptSuggestOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [modalScriptSuggestOpen]);

  const updateField = (category, field, value) => {
    setAdminSettings(prev => ({
      ...prev,
      [category]: { ...prev[category], [field]: value }
    }));
  };

  const handleSegDefChange = (seg, field, value) => {
    setSegDefs((prev) => ({
      ...prev,
      [seg]: patchSegmentField(prev[seg] || {}, field, value),
    }));
  };

  const handleScriptDefChange = (scriptKey, category, field, value) => {
    setScriptDefs(prev => ({
      ...prev,
      [scriptKey]: {
        ...prev[scriptKey],
        [category]: { ...(prev[scriptKey]?.[category] || {}), [field]: value }
      }
    }));
  };

  const handleScriptDefTopLevel = (scriptKey, field, value) => {
    setScriptDefs(prev => ({
      ...prev,
      [scriptKey]: { ...prev[scriptKey], [field]: value }
    }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ type: '', text: '' });
    try {
      // Save based on active tab
      if (activeTab === 'general' && viewerRole !== 'SUPER_ADMIN') {
        await axios.put(`/api/admin/manage/admins/${targetAdmin._id}/default-settings`, {
          defaultSettings: adminSettings
        }, { headers: { Authorization: `Bearer ${token}` } });

        await axios.put(`/api/admin/manage/admins/${targetAdmin._id}/permissions`, { permissions }, {
          headers: { Authorization: `Bearer ${token}` }
        });

        await axios.put(`/api/admin/manage/admins/${targetAdmin._id}/leverage`, {
          maxLeverageFromParent: Math.max(adminSettings.leverage.intraday, adminSettings.leverage.carryForward),
          intradayLeverage: adminSettings.leverage.intraday,
          carryForwardLeverage: adminSettings.leverage.carryForward
        }, { headers: { Authorization: `Bearer ${token}` } });

        setMessage({
          type: 'success',
          text: 'General settings updated successfully',
        });
      } else if (activeTab === 'segments' || activeTab === 'scripts') {
        // Save segment permissions and script settings
        const segmentExplicitKeys = computeSegmentExplicitKeys(segDefs, systemSegBaseline, viewerRole);

        const response = await axios.put(`/api/admin/manage/admins/${targetAdmin._id}/segment-settings`, {
          segmentPermissions: segDefs,
          scriptSettings: scriptDefs,
          segmentExplicitKeys,
        }, { headers: { Authorization: `Bearer ${token}` } });

        setMessage({
          type: 'success',
          text: response.data.message || (activeTab === 'segments' ? 'Segment permissions updated successfully' : 'Script settings updated successfully'),
        });
        if (activeTab === 'segments' || activeTab === 'scripts') {
          await loadSegScriptSettings();
        }
      }

      onSuccess();
      // Don't auto-close - let user read the message
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || 'Error updating settings' });
    } finally {
      setLoading(false);
    }
  };

  const showLimitPendingGate =
    canManageLimitPendingSegmentGate(viewerRole) &&
    showLimitPendingHierarchyTarget(targetAdmin?.role);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-lg w-full max-w-3xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between mb-4">
          <h2 className="text-xl font-bold">Admin Settings</h2>
          <button onClick={onClose}><X size={24} /></button>
        </div>
        <div className="bg-dark-700 rounded p-3 mb-4">
          <div className="font-bold">{targetAdmin.name || targetAdmin.username}</div>
          <div className="text-xs text-purple-400 font-mono">{targetAdmin.adminCode}</div>
          <div className="text-xs text-gray-500 mt-1">
            {viewerRole === 'SUPER_ADMIN'
              ? 'Segment & script overrides for this admin (general defaults are edited elsewhere)'
              : 'Override default settings for this specific admin'}
          </div>
        </div>
        {message.text && (
          <div className={`sticky top-0 z-10 p-3 rounded mb-4 ${message.type === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
            {message.text}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-5 border-b border-dark-600 pb-3">
          <button type="button" onClick={() => setActiveTab('segments')} className={`px-4 py-2 rounded-t font-medium text-sm ${activeTab === 'segments' ? 'bg-cyan-600 text-white' : 'bg-dark-700 text-gray-400 hover:bg-dark-600'}`}>
            Segment Permissions
          </button>
          <button type="button" onClick={() => setActiveTab('scripts')} className={`px-4 py-2 rounded-t font-medium text-sm ${activeTab === 'scripts' ? 'bg-green-600 text-white' : 'bg-dark-700 text-gray-400 hover:bg-dark-600'}`}>
            Script Settings
          </button>
        </div>

        <form onSubmit={handleSave}>

          {/* ===== SEGMENT PERMISSIONS TAB ===== */}
          {activeTab === 'segments' && (
            <div>
              {fetching ? (
                <div className="text-center py-8"><RefreshCw className="animate-spin inline" size={24} /></div>
              ) : (
                <>
                  <p className="text-xs text-gray-400 mb-3">Click a segment to configure. Green = Enabled, Gray = Disabled.</p>
                  <div className="flex gap-2 mb-4 flex-wrap">
                    {segmentKeys.map(seg => {
                      const isEnabled = segDefs[seg]?.enabled;
                      return (
                        <button type="button" key={seg} onClick={() => setExpandedSeg(seg)}
                          className={`px-3 py-1.5 rounded font-medium text-xs transition ${
                            expandedSeg === seg
                              ? (isEnabled ? 'bg-green-600 text-white' : 'bg-gray-600 text-white')
                              : (isEnabled ? 'bg-green-600/30 text-green-300 hover:bg-green-600/50' : 'bg-dark-700 text-gray-400 hover:bg-dark-600')
                          }`}>
                          {seg}
                        </button>
                      );
                    })}
                  </div>

                  {expandedSeg && (() => {
                    const s = segDefs[expandedSeg] || {};
                    const isOpt = ['NSEOPT', 'MCXOPT', 'CRYPTOOPT', 'BSE-OPT', 'FOREXOPT'].includes(expandedSeg);
                    return (
                      <div className="bg-dark-700/50 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-sm font-bold text-cyan-400">{expandedSeg} Settings</h3>
                          <button type="button" onClick={() => handleSegDefChange(expandedSeg, 'enabled', !s.enabled)}
                            className={`px-3 py-1 rounded text-xs font-medium ${s.enabled ? 'bg-green-600' : 'bg-red-600'}`}>
                            {s.enabled ? 'Enabled' : 'Disabled'}
                          </button>
                        </div>

                        {/* Leverage */}
                        <h4 className="text-xs font-semibold text-yellow-400 mb-2">Leverage</h4>
                        <div className="mb-4 rounded-lg border border-dark-600 bg-dark-800/60 p-3">
                          <label className="flex cursor-pointer items-start gap-3">
                            <input
                              type="checkbox"
                              className="mt-1 shrink-0"
                              checked={s.defaultIntradayOnly === true}
                              onChange={(e) =>
                                handleSegDefChange(expandedSeg, 'defaultIntradayOnly', e.target.checked)}
                            />
                            <span>
                              <span className="text-sm font-medium text-gray-200">
                                Default intraday-only orders (EOD auto square)
                              </span>
                              <span className="mt-1 block text-xs text-gray-500">
                                Merged with Super Admin defaults for this hierarchy. Traders get no dashboard toggle.
                              </span>
                            </span>
                          </label>
                        </div>

                        <div className="grid grid-cols-2 gap-3 mb-4">
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">Intraday Leverage (x)</label>
                            <SegmentNumberInput
                              value={s.intradayLeverage}
                              onChange={(v) => handleSegDefChange(expandedSeg, 'intradayLeverage', v)}
                              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">Carryforward Leverage (x)</label>
                            <SegmentNumberInput
                              value={s.carryForwardLeverage}
                              onChange={(v) => handleSegDefChange(expandedSeg, 'carryForwardLeverage', v)}
                              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
                            />
                          </div>
                        </div>

                        <div className="mb-4 rounded-lg border border-dark-600 bg-dark-800/60 p-3">
                          <label className="flex cursor-pointer items-start gap-3">
                            <input
                              type="checkbox"
                              className="mt-1 shrink-0"
                              checked={s.allowLimitPendingOrders !== false}
                              onChange={(e) =>
                                handleSegDefChange(expandedSeg, 'allowLimitPendingOrders', e.target.checked)}
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

                        {/* Lot-based (non-crypto) vs quantity-only labels (CRYPTO / CRYPTOFUT / CRYPTOOPT) */}
                        {isCryptoQtyOnlySegment(expandedSeg) ? (
                          <>
                            <h4 className="text-xs font-semibold text-blue-400 mb-2">Quantity</h4>
                            <p className="text-[10px] text-gray-500 mb-3 max-w-2xl">
                              Limits apply per order in <span className="text-gray-400">exchange step multiples</span> (see instrument step on Binance). Same stored fields as before; labels are qty-only for crypto.
                            </p>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Max Exchange Qty</label>
                                <input type="number" value={s.maxExchangeLots || 0} onChange={e => handleSegDefChange(expandedSeg, 'maxExchangeLots', parseInt(e.target.value, 10) || 0)} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Max Qty</label>
                                <input type="number" value={s.maxLots || 0} onChange={e => handleSegDefChange(expandedSeg, 'maxLots', parseInt(e.target.value, 10) || 0)} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Min Qty</label>
                                <input type="number" value={s.minLots || 0} onChange={e => handleSegDefChange(expandedSeg, 'minLots', parseInt(e.target.value, 10) || 0)} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Order Qty</label>
                                <input type="number" value={s.orderLots || 0} onChange={e => handleSegDefChange(expandedSeg, 'orderLots', parseInt(e.target.value, 10) || 0)} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Max Quantity</label>
                                <input type="number" value={numInputValue(s.quantityModeSettings?.maxQuantity ?? s.quantitySettings?.maxQuantity)} onChange={e => handleSegDefChange(expandedSeg, 'quantityModeSettings.maxQuantity', parseIntInput(e.target.value))} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Breakup Quantity (Per Order)</label>
                                <input type="number" value={numInputValue(s.quantityModeSettings?.breakupQuantity ?? s.quantitySettings?.breakupQuantity)} onChange={e => handleSegDefChange(expandedSeg, 'quantityModeSettings.breakupQuantity', parseIntInput(e.target.value))} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Max Lot Quantity</label>
                                <input type="number" value={numInputValue(s.quantitySettings?.maxLotQuantity)} onChange={e => handleSegDefChange(expandedSeg, 'quantitySettings.maxLotQuantity', parseIntInput(e.target.value))} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Max Bid (Orders Limit)</label>
                                <input type="number" value={numInputValue(s.quantitySettings?.maxBid)} onChange={e => handleSegDefChange(expandedSeg, 'quantitySettings.maxBid', parseIntInput(e.target.value))} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            <h4 className="text-xs font-semibold text-blue-400 mb-2">Lot & Quantity</h4>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Max Exchange Lots</label>
                                <input type="number" value={s.maxExchangeLots || 0} onChange={e => handleSegDefChange(expandedSeg, 'maxExchangeLots', parseInt(e.target.value) || 0)} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Max Lots</label>
                                <input type="number" value={s.maxLots || 0} onChange={e => handleSegDefChange(expandedSeg, 'maxLots', parseInt(e.target.value) || 0)} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Min Lots</label>
                                <input type="number" value={s.minLots || 0} onChange={e => handleSegDefChange(expandedSeg, 'minLots', parseInt(e.target.value) || 0)} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Order Lots</label>
                                <input type="number" value={s.orderLots || 0} onChange={e => handleSegDefChange(expandedSeg, 'orderLots', parseInt(e.target.value) || 0)} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
                              </div>
                            </div>
                            <h4 className="text-xs font-semibold text-cyan-400 mb-2">Quantity Settings</h4>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Max Quantity</label>
                                <input type="number" value={numInputValue(s.quantityModeSettings?.maxQuantity ?? s.quantitySettings?.maxQuantity)} onChange={e => handleSegDefChange(expandedSeg, 'quantityModeSettings.maxQuantity', parseIntInput(e.target.value))} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Breakup Quantity (Per Order)</label>
                                <input type="number" value={numInputValue(s.quantityModeSettings?.breakupQuantity ?? s.quantitySettings?.breakupQuantity)} onChange={e => handleSegDefChange(expandedSeg, 'quantityModeSettings.breakupQuantity', parseIntInput(e.target.value))} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Max Lot Quantity</label>
                                <input type="number" value={numInputValue(s.quantitySettings?.maxLotQuantity)} onChange={e => handleSegDefChange(expandedSeg, 'quantitySettings.maxLotQuantity', parseIntInput(e.target.value))} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Max Bid (Orders Limit)</label>
                                <input type="number" value={numInputValue(s.quantitySettings?.maxBid)} onChange={e => handleSegDefChange(expandedSeg, 'quantitySettings.maxBid', parseIntInput(e.target.value))} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
                              </div>
                            </div>
                          </>
                        )}

                        {/* Dynamic Quantity Limits */}
                        <h4 className="text-xs font-semibold text-orange-400 mb-3">Dynamic Quantity Limits</h4>
                        <div className="grid grid-cols-2 gap-4 mb-6">
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">
                              Max Intraday Qty ({['MCXFUT', 'MCXOPT', 'MCX'].includes(expandedSeg) ? 'qty' : 'Shares'})
                            </label>
                            <input type="number" value={s.maxIntradayQty || 0}
                              onChange={e => handleSegDefChange(expandedSeg, 'maxIntradayQty', parseInt(e.target.value) || 0)}
                              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
                            <p className="text-[10px] text-gray-500 mt-1">User's max quantity for intraday trades</p>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">
                              Max Carry Forward Qty ({['MCXFUT', 'MCXOPT', 'MCX'].includes(expandedSeg) ? 'qty' : 'Shares'})
                            </label>
                            <input type="number" value={s.maxCarryQty || 0}
                              onChange={e => handleSegDefChange(expandedSeg, 'maxCarryQty', parseInt(e.target.value) || 0)}
                              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
                            <p className="text-[10px] text-gray-500 mt-1">User's max quantity for carry forward trades</p>
                          </div>
                        </div>

                        {['CRYPTOFUT', 'CRYPTOOPT'].includes(expandedSeg) && (
                          <CryptoSegmentAdminExtras
                            segmentKey={expandedSeg}
                            slice={s}
                            canEdit={canEditCryptoSessionTiming(viewerRole)}
                            onFieldChange={(field, value) => handleSegDefChange(expandedSeg, field, value)}
                          />
                        )}

                        {['MCXFUT', 'MCXOPT', 'MCX'].includes(expandedSeg) && (
                          <McxSegmentAdminExtras
                            segmentKey={expandedSeg}
                            slice={s}
                            canEdit={canEditMcxSessionTiming(viewerRole)}
                            onFieldChange={(field, value) => handleSegDefChange(expandedSeg, field, value)}
                          />
                        )}

                        {['NSEFUT', 'NSEOPT', 'NSE-EQ', 'BSE-FUT', 'BSE-OPT'].includes(expandedSeg) && (
                          <NseBseSegmentAdminExtras
                            segmentKey={expandedSeg}
                            slice={s}
                            canEdit={canEditNseBseSessionTiming(viewerRole)}
                            onFieldChange={(field, value) => handleSegDefChange(expandedSeg, field, value)}
                          />
                        )}

                        {hideSegmentBrokerage ? (
                          <FranchiseSegmentBrokerageNotice compact />
                        ) : (
                          <SegmentBrokerageFields
                            slice={s}
                            baseline={systemSegBaseline[expandedSeg]}
                            compact
                            onChange={(next) =>
                              setSegDefs((prev) => ({
                                ...prev,
                                [expandedSeg]: { ...prev[expandedSeg], ...next },
                              }))
                            }
                          />
                        )}

                        {/* Super Admin Brokerage & Incentive - Only for MCX segments */}
                        {['MCXFUT', 'MCXOPT', 'MCX'].includes(expandedSeg) && (
                          <>
                            <h4 className="text-xs font-semibold text-orange-400 mb-2">Super Admin Brokerage & Incentive (in Crores)</h4>
                            <div className="grid grid-cols-2 gap-3 mb-4">
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Incentive Given by Super Admin (in Crores)</label>
                                <input type="number" value={s.superAdminIncentiveInCrore || 0} onChange={e => handleSegDefChange(expandedSeg, 'superAdminIncentiveInCrore', parseFloat(e.target.value) || 0)} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
                                <p className="text-[10px] text-gray-600 mt-1">Incentive/rebate per crore turnover by Super Admin</p>
                              </div>
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Brokerage Charged by Super Admin (in Crores)</label>
                                <input type="number" value={s.superAdminBrokerageChargeInCrore || 0} onChange={e => handleSegDefChange(expandedSeg, 'superAdminBrokerageChargeInCrore', parseFloat(e.target.value) || 0)} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" />
                                <p className="text-[10px] text-gray-600 mt-1">Brokerage charge per crore turnover by Super Admin</p>
                              </div>
                            </div>
                          </>
                        )}

                        {['CRYPTOFUT', 'CRYPTOOPT'].includes(expandedSeg) && (
                          <div className="mb-4">
                            <h4 className="text-xs font-semibold text-orange-300 mb-2">Client spread (Binance crypto)</h4>
                            <p className="text-[11px] text-gray-500 mb-2">
                              Primary: USDT per side on client quotes (bid −, ask +). If $ spread is 0, legacy  total width per coin applies (half bid / half ask). 0 / 0 = exchange prices.
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Spread ($ per side)</label>
                                <input
                                  type="number"
                                  min={0}
                                  step={0.01}
                                  value={numInputValue(s.cryptoSpreadUsdPerSide)}
                                  onChange={(e) =>
                                    handleSegDefChange(
                                      expandedSeg,
                                      'cryptoSpreadUsdPerSide',
                                      parseNonNegativeNumInput(e.target.value)
                                    )
                                  }
                                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Spread ( total / coin, legacy)</label>
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={numInputValue(s.cryptoSpreadInr)}
                                  onChange={(e) =>
                                    handleSegDefChange(expandedSeg, 'cryptoSpreadInr', parseNonNegativeNumInput(e.target.value))
                                  }
                                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
                                />
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Option Buy/Sell - only for OPT segments */}
                        {isOpt && (
                          <>
                            <h4 className="text-xs font-semibold text-purple-400 mb-2">Option Buy / Sell</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {['optionBuy', 'optionSell'].map((optType) => (
                                <OptionBuySellFields
                                  key={optType}
                                  segmentKey={expandedSeg}
                                  optType={optType}
                                  opt={s[optType] || {}}
                                  compact
                                  hideBrokerage={hideSegmentBrokerage}
                                  onChange={(next) => handleSegDefChange(expandedSeg, optType, next)}
                                />
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          )}

          {/* ===== SCRIPT SETTINGS TAB ===== */}
          {activeTab === 'scripts' && (
            <div>
              {fetching ? (
                <div className="text-center py-8"><RefreshCw className="animate-spin inline" size={24} /></div>
              ) : (
                <>
                  <p className="text-xs text-gray-400 mb-3">Add a script name and configure its settings. Suggestions from synced instruments.</p>
                  <div className="flex gap-2 mb-4 flex-wrap items-start">
                    <div ref={modalScriptComboboxRef} className="flex-1 min-w-[180px] relative z-30">
                      <input
                        type="text"
                        autoComplete="off"
                        placeholder="Script name (e.g. NIFTY, BANKNIFTY)"
                        value={scriptSearch}
                        onChange={(e) => {
                          setScriptSearch(e.target.value.toUpperCase());
                          setModalScriptSuggestOpen(true);
                        }}
                        onFocus={() => setModalScriptSuggestOpen(true)}
                        className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
                      />
                      {modalScriptSuggestOpen && modalFilteredScriptSuggestions.length > 0 && (
                        <ul className="absolute left-0 right-0 top-full mt-1 max-h-60 overflow-y-auto rounded-lg border border-dark-600 bg-dark-800 shadow-2xl z-[200] py-1" role="listbox">
                          {modalFilteredScriptSuggestions.map((sym) => (
                            <li key={sym}>
                              <button
                                type="button"
                                role="option"
                                className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-dark-600 focus:bg-dark-600 focus:outline-none"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setScriptSearch(sym);
                                  setModalScriptSuggestOpen(false);
                                }}
                              >
                                {sym}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <button type="button" onClick={() => {
                      if (scriptSearch.trim()) {
                        setScriptDefs(prev => ({
                          ...prev,
                          [scriptSearch.trim()]: prev[scriptSearch.trim()] || {
                            lotSettings: { maxLots: 50, minLots: 1, perOrderLots: 10 },
                            quantitySettings: { maxQuantity: 1000, minQuantity: 1, perOrderQuantity: 100, maxBid: 0 },
                            fixedMargin: { intradayFuture: 0, carryFuture: 0, optionBuyIntraday: 0, optionBuyCarry: 0, optionSellIntraday: 0, optionSellCarry: 0 },
                            brokerage: { intradayFuture: 0, carryFuture: 0, optionBuyIntraday: 0, optionBuyCarry: 0, optionSellIntraday: 0, optionSellCarry: 0 },
                            spread: { buy: 0, sell: 0 },
                            blocked: false
                          }
                        }));
                        setSelectedScript(scriptSearch.trim());
                        setScriptSearch('');
                      }
                    }} className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded font-medium text-sm">Add</button>
                  </div>

                  <div className="flex gap-2 mb-4 flex-wrap">
                    {Object.keys(scriptDefs).map(sk => (
                      <button type="button" key={sk} onClick={() => setSelectedScript(sk)}
                        className={`px-3 py-1.5 rounded text-xs font-medium transition ${
                          selectedScript === sk
                            ? (scriptDefs[sk]?.blocked ? 'bg-red-600 text-white' : 'bg-cyan-600 text-white')
                            : (scriptDefs[sk]?.blocked ? 'bg-red-600/30 text-red-300' : 'bg-dark-700 text-gray-400 hover:bg-dark-600')
                        }`}>
                        {sk}
                      </button>
                    ))}
                  </div>

                  {selectedScript && scriptDefs[selectedScript] && (() => {
                    const sc = scriptDefs[selectedScript];
                    return (
                      <div className="bg-dark-700/50 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-sm font-bold text-cyan-400">{selectedScript}</h3>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => handleScriptDefTopLevel(selectedScript, 'blocked', !sc.blocked)}
                              className={`px-3 py-1 rounded text-xs font-medium ${sc.blocked ? 'bg-red-600' : 'bg-green-600'}`}>
                              {sc.blocked ? 'Blocked' : 'Active'}
                            </button>
                            <button type="button" onClick={() => {
                              const nd = { ...scriptDefs }; delete nd[selectedScript]; setScriptDefs(nd); setSelectedScript('');
                            }} className="px-3 py-1 rounded text-xs font-medium bg-red-800 hover:bg-red-700">Remove</button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                          {/* Lot Settings */}
                          <div>
                            <h4 className="text-xs font-semibold text-yellow-400 mb-2">Lot Settings</h4>
                            <div className="space-y-2">
                              {[['maxLots', 'Max Lots'], ['minLots', 'Min Lots'], ['perOrderLots', 'Per Order Lots']].map(([f, l]) => (
                                <div key={f}>
                                  <label className="block text-xs text-gray-400 mb-1">{l}</label>
                                  <input type="number" value={sc.lotSettings?.[f] || 0} onChange={e => handleScriptDefChange(selectedScript, 'lotSettings', f, parseInt(e.target.value) || 0)} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-1.5 text-sm" />
                                </div>
                              ))}
                            </div>
                          </div>
                          {/* Quantity Settings */}
                          <div>
                            <h4 className="text-xs font-semibold text-blue-400 mb-2">Quantity Settings</h4>
                            <div className="space-y-2">
                              {[['maxQuantity', 'Max Quantity'], ['minQuantity', 'Min Quantity'], ['perOrderQuantity', 'Per Order Qty'], ['maxBid', 'Max Bid (Orders Limit)']].map(([f, l]) => (
                                <div key={f}>
                                  <label className="block text-xs text-gray-400 mb-1">{l}</label>
                                  <input type="number" value={sc.quantitySettings?.[f] || 0} onChange={e => handleScriptDefChange(selectedScript, 'quantitySettings', f, parseInt(e.target.value) || 0)} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-1.5 text-sm" />
                                </div>
                              ))}
                            </div>
                          </div>
                          {/* Spread */}
                          <div>
                            <h4 className="text-xs font-semibold text-orange-400 mb-2">Spread</h4>
                            <div className="space-y-2">
                              {[['buy', 'Buy Spread'], ['sell', 'Sell Spread']].map(([f, l]) => (
                                <div key={f}>
                                  <label className="block text-xs text-gray-400 mb-1">{l}</label>
                                  <input type="number" step="0.01" value={sc.spread?.[f] || 0} onChange={e => handleScriptDefChange(selectedScript, 'spread', f, parseFloat(e.target.value) || 0)} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-1.5 text-sm" />
                                </div>
                              ))}
                            </div>
                          </div>
                          {/* Fixed Margin */}
                          <div className="col-span-full xl:col-span-1">
                            <h4 className="text-xs font-semibold text-purple-400 mb-2">Fixed Margin</h4>
                            <div className="grid grid-cols-2 gap-2">
                              {[['intradayFuture', 'Intra Future'], ['carryFuture', 'Carry Future'], ['optionBuyIntraday', 'Opt Buy Intra'], ['optionBuyCarry', 'Opt Buy Carry'], ['optionSellIntraday', 'Opt Sell Intra'], ['optionSellCarry', 'Opt Sell Carry']].map(([f, l]) => (
                                <div key={f}>
                                  <label className="block text-xs text-gray-400 mb-1">{l}</label>
                                  <input type="number" value={sc.fixedMargin?.[f] || 0} onChange={e => handleScriptDefChange(selectedScript, 'fixedMargin', f, parseFloat(e.target.value) || 0)} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-1.5 text-sm" />
                                </div>
                              ))}
                            </div>
                          </div>
                          {/* Brokerage */}
                          <div className="col-span-full xl:col-span-1">
                            <h4 className="text-xs font-semibold text-green-400 mb-2">Brokerage</h4>
                            <div className="grid grid-cols-2 gap-2">
                              {[['intradayFuture', 'Intra Future'], ['carryFuture', 'Carry Future'], ['optionBuyIntraday', 'Opt Buy Intra'], ['optionBuyCarry', 'Opt Buy Carry'], ['optionSellIntraday', 'Opt Sell Intra'], ['optionSellCarry', 'Opt Sell Carry']].map(([f, l]) => (
                                <div key={f}>
                                  <label className="block text-xs text-gray-400 mb-1">{l}</label>
                                  <input type="number" value={sc.brokerage?.[f] || 0} onChange={e => handleScriptDefChange(selectedScript, 'brokerage', f, parseFloat(e.target.value) || 0)} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-1.5 text-sm" />
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          )}

          {/* Save / Cancel */}
          <div className="flex gap-3 pt-5">
            <button type="button" onClick={onClose} className="flex-1 bg-dark-600 py-2 rounded">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 bg-purple-600 hover:bg-purple-700 py-2 rounded font-medium">
              {loading ? 'Saving...' : viewerRole === 'SUPER_ADMIN' ? 'Save segment & script settings' : 'Save All Settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AdminChargesModal;
