import React, { useState, useEffect } from 'react';
import axios from '../../../../config/axios';
import { ArrowRightLeft, RefreshCw, X } from 'lucide-react';
import {
  defaultIndividualPattiSegments,
  labelForPattiSegment,
} from '../../../../constants/pattiSharingSegments.js';
import ReferralGamesTradingToggles from './ReferralGamesTradingToggles.jsx';

const IndividualPattiSharingModal = ({ admin, targetAdmin, onClose, onSaved }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [maxPctBySegment, setMaxPctBySegment] = useState({});
  const [parentAdmin, setParentAdmin] = useState(null);
  const [pattiConfig, setPattiConfig] = useState({
    enabled: targetAdmin.pattiSharing?.enabled || false,
    appliedTo: targetAdmin.pattiSharing?.appliedTo || 'ALL_TRADES',
    segments: targetAdmin.pattiSharing?.segments || defaultIndividualPattiSegments(50),
    notes: targetAdmin.pattiSharing?.notes || '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [referralDist, setReferralDist] = useState({ games: true, trading: true });

  useEffect(() => {
    fetchPattiConfig();
  }, [targetAdmin._id]);

  const fetchPattiConfig = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`/api/admin/manage/admins/${targetAdmin._id}/patti-sharing`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      if (data) {
        setPattiConfig({
          enabled: data.enabled || false,
          appliedTo: data.appliedTo || 'ALL_TRADES',
          segments: data.segments || defaultIndividualPattiSegments(50),
          notes: data.notes || '',
        });
        setMaxPctBySegment(data.maxPctBySegment || {});
        setParentAdmin(data.parentAdmin || null);
        if (data.referralDistributionEnabled) {
          setReferralDist({
            games: data.referralDistributionEnabled.games !== false,
            trading: data.referralDistributionEnabled.trading !== false,
          });
        }
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load patti configuration');
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
        notes: pattiConfig.notes,
      };
      if (targetAdmin.role === 'ADMIN') {
        payload.referralDistributionEnabled = {
          games: referralDist.games !== false,
          trading: referralDist.trading !== false,
        };
      }
      const { data } = await axios.put(`/api/admin/manage/admins/${targetAdmin._id}/patti-sharing`, payload, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      onSaved?.();
      setSuccess(data?.message || 'Patti sharing configuration saved successfully');
      setTimeout(() => onClose(), 1500);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save patti configuration');
    } finally {
      setSaving(false);
    }
  };

  const updateSegmentConfig = (segment, field, value) => {
    setPattiConfig((prev) => ({
      ...prev,
      segments: {
        ...prev.segments,
        [segment]: {
          ...prev.segments[segment],
          [field]: value,
        },
      },
    }));
  };

  const parentShareLabel =
    targetAdmin.role === 'ADMIN'
      ? 'Super Admin'
      : targetAdmin.role === 'BROKER'
        ? parentAdmin?.name || 'Parent admin'
        : parentAdmin?.name || 'Parent broker';

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-lg w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-dark-600">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <ArrowRightLeft size={24} className="text-pink-400" />
              Patti Sharing
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <span
                className={`px-2 py-0.5 rounded text-xs ${
                  targetAdmin.role === 'ADMIN'
                    ? 'bg-purple-500/20 text-purple-400'
                    : targetAdmin.role === 'BROKER'
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-green-500/20 text-green-400'
                }`}
              >
                {targetAdmin.role}
              </span>
              <span className="text-sm text-gray-400">{targetAdmin.name || targetAdmin.username}</span>
              <span className="text-sm text-gray-400">{targetAdmin.adminCode}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="text-center py-8">
              <RefreshCw className="animate-spin inline" size={32} />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-dark-700 rounded-lg">
                <input
                  type="checkbox"
                  id="enablePatti"
                  checked={pattiConfig.enabled}
                  onChange={(e) => setPattiConfig((prev) => ({ ...prev, enabled: e.target.checked }))}
                  className="w-5 h-5"
                />
                <label htmlFor="enablePatti" className="text-sm font-medium">
                  Enable patti vs {parentShareLabel} (this {targetAdmin.role.toLowerCase()}&apos;s %)
                </label>
              </div>
              {pattiConfig.enabled && targetAdmin.role === 'SUB_BROKER' && (
                <p className="text-xs text-emerald-400/90 px-1">
                  Patti stops here. Clients under this sub-broker are not configured — their trades split using this
                  sub-broker&apos;s % only (no client-level patti).
                </p>
              )}
              {pattiConfig.enabled && targetAdmin.role === 'BROKER' && (
                <p className="text-xs text-amber-400/90 px-1">
                  Cannot exceed your own patti % from your parent (per segment). Sub-brokers are the last level;
                  clients are not configured separately.
                </p>
              )}

              {pattiConfig.enabled && (
                <>
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Apply To</label>
                    <select
                      value={pattiConfig.appliedTo}
                      onChange={(e) => setPattiConfig((prev) => ({ ...prev, appliedTo: e.target.value }))}
                      className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
                    >
                      <option value="ALL_TRADES">All Trades</option>
                      <option value="SPECIFIC_CLIENTS">Specific Clients Only</option>
                    </select>
                  </div>

                  <div className="bg-dark-700 rounded-lg p-4">
                    <h3 className="text-sm font-semibold mb-1">Segment-wise configuration</h3>
                    <p className="text-xs text-gray-500 mb-3">
                      Each % is of the full trade pool (same as Super Admin→Admin). Parent line = your cap minus
                      this % (e.g. you keep 75%, set broker 25% → you net 50% of pool).
                    </p>
                    <div className="space-y-3">
                      {Object.entries(pattiConfig.segments).map(([segment, config]) => {
                        const maxPct =
                          maxPctBySegment[segment] != null ? Number(maxPctBySegment[segment]) : 100;
                        const adminPct = Number.isFinite(Number(config.adminPercentage))
                          ? Math.min(maxPct, Math.max(0, Number(config.adminPercentage)))
                          : Math.min(50, maxPct);
                        const parentPct = Math.max(0, maxPct - adminPct);
                        return (
                          <div key={segment} className="flex flex-wrap items-center gap-3 p-3 bg-dark-600 rounded">
                            <input
                              type="checkbox"
                              checked={config.enabled}
                              onChange={(e) => updateSegmentConfig(segment, 'enabled', e.target.checked)}
                              className="w-4 h-4"
                            />
                            <span className="flex-1 text-sm min-w-[80px]">{labelForPattiSegment(segment)}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-400 whitespace-nowrap">This %</span>
                              <input
                                type="number"
                                min="0"
                                max={maxPct}
                                value={adminPct}
                                onChange={(e) =>
                                  updateSegmentConfig(
                                    segment,
                                    'adminPercentage',
                                    Math.min(maxPct, Number(e.target.value))
                                  )
                                }
                                disabled={!config.enabled}
                                className="w-20 bg-dark-700 border border-dark-600 rounded px-2 py-1 text-sm"
                              />
                              <span className="text-xs text-gray-400">% (max {maxPct})</span>
                            </div>
                            <span className="text-xs text-yellow-400 whitespace-nowrap">
                              {parentShareLabel}: {parentPct}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Notes (Optional)</label>
                    <textarea
                      value={pattiConfig.notes}
                      onChange={(e) => setPattiConfig((prev) => ({ ...prev, notes: e.target.value }))}
                      className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 h-20"
                      placeholder="Add any notes about this configuration..."
                    />
                  </div>
                </>
              )}

              {targetAdmin.role === 'ADMIN' && (
                <ReferralGamesTradingToggles value={referralDist} onChange={setReferralDist} />
              )}

              {error && <div className="text-red-400 text-sm">{error}</div>}
              {success && <div className="text-green-400 text-sm">{success}</div>}
            </div>
          )}
        </div>

        <div className="flex gap-3 p-4 border-t border-dark-600">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 bg-dark-700 hover:bg-dark-600 rounded">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="flex-1 px-4 py-2 bg-pink-600 hover:bg-pink-700 rounded font-medium disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default IndividualPattiSharingModal;
