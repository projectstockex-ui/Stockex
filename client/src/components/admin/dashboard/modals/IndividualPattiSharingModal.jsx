import React, { useState, useEffect } from 'react';
import axios from '../../../../config/axios';
import { ArrowRightLeft, RefreshCw, X } from 'lucide-react';

const IndividualPattiSharingModal = ({ admin, targetAdmin, onClose }) => {
  const defaultIndividualSegments = () => ({
    EQUITY: { enabled: true, adminPercentage: 50 },
    FNO: { enabled: true, adminPercentage: 50 },
    MCX: { enabled: true, adminPercentage: 50 },
    CURRENCY: { enabled: true, adminPercentage: 50 },
    FOREX: { enabled: true, adminPercentage: 50 }
  });

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pattiConfig, setPattiConfig] = useState({
    enabled: targetAdmin.pattiSharing?.enabled || false,
    appliedTo: targetAdmin.pattiSharing?.appliedTo || 'ALL_TRADES',
    segments: targetAdmin.pattiSharing?.segments || defaultIndividualSegments(),
    notes: targetAdmin.pattiSharing?.notes || ''
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    fetchPattiConfig();
  }, [targetAdmin._id]);

  const fetchPattiConfig = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`/api/admin/manage/admins/${targetAdmin._id}/patti-sharing`, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      if (data) {
        setPattiConfig({
          enabled: data.enabled || false,
          appliedTo: data.appliedTo || 'ALL_TRADES',
          segments: data.segments || defaultIndividualSegments(),
          notes: data.notes || ''
        });
      }
    } catch (err) {
      console.error('Error fetching patti config:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const payload = {
        enabled: pattiConfig.enabled,
        appliedTo: pattiConfig.appliedTo,
        segments: pattiConfig.segments,
        notes: pattiConfig.notes
      };
      await axios.put(`/api/admin/manage/admins/${targetAdmin._id}/patti-sharing`, payload, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setSuccess('Patti sharing configuration saved successfully');
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save patti configuration');
    } finally {
      setSaving(false);
    }
  };

  const updateSegmentConfig = (segment, field, value) => {
    setPattiConfig(prev => ({
      ...prev,
      segments: {
        ...prev.segments,
        [segment]: {
          ...prev.segments[segment],
          [field]: value
        }
      }
    }));
  };

  const parentShareLabel =
    targetAdmin.role === 'ADMIN' ? 'Super Admin' :
    targetAdmin.role === 'BROKER' ? 'Admin' :
    'Broker';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="p-4 border-b border-dark-600 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <ArrowRightLeft size={24} className="text-pink-400" />
              Individual Patti Sharing
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <span className={`px-2 py-0.5 rounded text-xs ${
                targetAdmin.role === 'ADMIN' ? 'bg-purple-500/20 text-purple-400' :
                targetAdmin.role === 'BROKER' ? 'bg-blue-500/20 text-blue-400' :
                'bg-green-500/20 text-green-400'
              }`}>{targetAdmin.role}</span>
              <span className="text-sm text-gray-400">{targetAdmin.name || targetAdmin.username}</span>
              <span className="text-sm text-gray-400">{targetAdmin.adminCode}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="text-center py-8"><RefreshCw className="animate-spin inline" size={32} /></div>
          ) : (
            <div className="space-y-4">
              {/* Enable/Disable */}
              <div className="flex items-center gap-3 p-4 bg-dark-700 rounded-lg">
                <input
                  type="checkbox"
                  id="enablePatti"
                  checked={pattiConfig.enabled}
                  onChange={(e) => setPattiConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                  className="w-5 h-5"
                />
                <label htmlFor="enablePatti" className="text-sm font-medium">
                  Enable Patti Sharing for this {targetAdmin.role.toLowerCase()}
                </label>
              </div>

              {pattiConfig.enabled && (
                <>
                  {/* Applied To */}
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Apply To</label>
                    <select
                      value={pattiConfig.appliedTo}
                      onChange={(e) => setPattiConfig(prev => ({ ...prev, appliedTo: e.target.value }))}
                      className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
                    >
                      <option value="ALL_TRADES">All Trades</option>
                      <option value="SPECIFIC_CLIENTS">Specific Clients Only</option>
                    </select>
                  </div>

                  {/* Segment-wise Configuration */}
                  <div className="bg-dark-700 rounded-lg p-4">
                    <h3 className="text-sm font-semibold mb-1">Segment-wise configuration</h3>
                    <p className="text-xs text-gray-500 mb-3">
                      Set this {targetAdmin.role.toLowerCase()}'s share per segment. {parentShareLabel} gets the remainder (100% − this share).
                    </p>
                    <div className="space-y-3">
                      {Object.entries(pattiConfig.segments).map(([segment, config]) => {
                        const adminPct = Number.isFinite(Number(config.adminPercentage))
                          ? Math.min(100, Math.max(0, Number(config.adminPercentage)))
                          : 50;
                        const parentPct = 100 - adminPct;
                        return (
                          <div key={segment} className="flex flex-wrap items-center gap-3 p-3 bg-dark-600 rounded">
                            <input
                              type="checkbox"
                              checked={config.enabled}
                              onChange={(e) => updateSegmentConfig(segment, 'enabled', e.target.checked)}
                              className="w-4 h-4"
                            />
                            <span className="flex-1 text-sm min-w-[80px]">{segment}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-400 whitespace-nowrap">This admin %</span>
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={adminPct}
                                onChange={(e) => updateSegmentConfig(segment, 'adminPercentage', Number(e.target.value))}
                                disabled={!config.enabled}
                                className="w-20 bg-dark-700 border border-dark-600 rounded px-2 py-1 text-sm"
                              />
                              <span className="text-xs text-gray-400">%</span>
                            </div>
                            <span className="text-xs text-yellow-400 whitespace-nowrap">
                              {parentShareLabel}: {parentPct}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Notes (Optional)</label>
                    <textarea
                      value={pattiConfig.notes}
                      onChange={(e) => setPattiConfig(prev => ({ ...prev, notes: e.target.value }))}
                      className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 h-20 resize-none"
                      placeholder="Add any notes about this patti sharing configuration..."
                    />
                  </div>
                </>
              )}

              {/* Error/Success Messages */}
              {error && (
                <div className="bg-red-500/20 border border-red-500 text-red-400 px-3 py-2 rounded text-sm">
                  {error}
                </div>
              )}
              {success && (
                <div className="bg-green-500/20 border border-green-500 text-green-400 px-3 py-2 rounded text-sm">
                  {success}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-dark-600 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-dark-600 hover:bg-dark-500 rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-pink-600 hover:bg-pink-700 rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default IndividualPattiSharingModal;
