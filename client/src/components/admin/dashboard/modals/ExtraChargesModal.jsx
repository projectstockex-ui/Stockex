import React, { useState, useEffect } from 'react';
import axios from '../../../../config/axios';
import { X } from 'lucide-react';

const ExtraChargesModal = ({ admin, targetAdmin, onClose, onHierarchyTransferred }) => {
  const partnerMode =
    targetAdmin.role === 'ADMIN'
      ? (targetAdmin.officePartnerType === 'INTERNAL' ? 'INTERNAL' : 'EXTERNAL')
      : 'PARTNER_LEGACY';

  const [saving, setSaving] = useState(false);
  const [transferSaving, setTransferSaving] = useState(false);
  const [internalTargets, setInternalTargets] = useState([]);
  const [transferToId, setTransferToId] = useState('');
  const [formData, setFormData] = useState({
    amount: '',
    description: '',
    incentiveScope: 'games_and_trading',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  /** Pre-fill amount and scope from restrictMode presets when modal opens */
  useEffect(() => {
    if (partnerMode === 'INTERNAL') {
      const presetAmt = targetAdmin.restrictMode?.monthlyIncentiveAmount;
      const presetScope = targetAdmin.restrictMode?.monthlyIncentiveScope || 'games_and_trading';
      setFormData((prev) => ({
        ...prev,
        amount: presetAmt > 0 ? String(presetAmt) : '',
        description: `Monthly incentive (${new Date().toLocaleDateString()})`,
        incentiveScope: presetScope,
      }));
    } else if (partnerMode === 'EXTERNAL') {
      const preset = targetAdmin.restrictMode?.brokerageChargePerCrore;
      setFormData((prev) => ({
        ...prev,
        amount: preset > 0 ? String(preset) : '',
        description: `Monthly brokerage charge (${new Date().toLocaleDateString()})`,
      }));
    }
  }, [partnerMode, targetAdmin._id, targetAdmin.restrictMode?.monthlyIncentiveAmount, targetAdmin.restrictMode?.brokerageChargePerCrore, targetAdmin.restrictMode?.monthlyIncentiveScope]);

  useEffect(() => {
    if (partnerMode !== 'EXTERNAL') return;
    let cancelled = false;

    (async () => {
      try {
        const { data } = await axios.get('/api/admin/manage/admins/internal-office-partners', {
          params: { excludeId: targetAdmin._id },
          headers: { Authorization: `Bearer ${admin.token}` },
        });
        if (!cancelled) {
          setInternalTargets(Array.isArray(data) ? data : []);
          setTransferToId('');
        }
      } catch (e) {
        if (!cancelled) console.error(e);
      }
    })();

    return () => { cancelled = true; };
  }, [partnerMode, targetAdmin._id, admin.token]);

  const handleTakeBrokerage = async () => {
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await axios.post(`/api/admin/manage/admins/${targetAdmin._id}/take-brokerage`, {
        amount: parseFloat(formData.amount),
        description: formData.description
      }, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setSuccess(
        `Successfully took ₹${formData.amount} from ${targetAdmin.name || targetAdmin.username}'s main wallet`
      );
      setFormData((prev) => ({ ...prev, amount: '', description: '' }));
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (error) {
      setError(error.response?.data?.message || 'Error taking brokerage');
    } finally {
      setSaving(false);
    }
  };

  const handleGiveIncentive = async () => {
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const { data } = await axios.post(`/api/admin/manage/admins/${targetAdmin._id}/give-incentive`, {
        amount: parseFloat(formData.amount),
        description: formData.description,
        incentiveScope: formData.incentiveScope,
      }, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      let msg = `Successfully gave ₹${formData.amount} incentive to ${targetAdmin.name || targetAdmin.username}`;
      const c = data?.creditsTo;
      if (c && (c.trading > 0 || c.games > 0)) {
        const parts = [];
        if (Number(c.trading) > 0) parts.push(`main/trading wallet ₹${Number(c.trading).toFixed(2)}`);
        if (Number(c.games) > 0) parts.push(`games (temp) wallet ₹${Number(c.games).toFixed(2)}`);
        if (parts.length) msg += ` — ${parts.join(', ')}`;
      }
      setSuccess(msg);
      setFormData((prev) => ({ ...prev, amount: '', description: '' }));
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (error) {
      setError(error.response?.data?.message || 'Error giving incentive');
    } finally {
      setSaving(false);
    }
  };

  const handleTransferAllHierarchy = async () => {
    if (!transferToId) {
      setError('Select an INTERNAL office admin to receive this hierarchy.');
      return;
    }
    if (
      !window.confirm(
        'Move ALL brokers, sub-brokers, and users under this EXTERNAL admin onto the selected INTERNAL admin? This cannot be undone from the UI.'
      )
    ) {
      return;
    }
    setTransferSaving(true);
    setError('');
    setSuccess('');
    try {
      const { data } = await axios.post(
        `/api/admin/manage/admins/${targetAdmin._id}/transfer-all-hierarchy`,
        { toAdminId: transferToId },
        { headers: { Authorization: `Bearer ${admin.token}` } }
      );
      setSuccess(data?.message || 'Hierarchy transferred successfully.');
      onHierarchyTransferred?.();
      setTimeout(() => onClose(), 2000);
    } catch (e) {
      setError(e.response?.data?.message || 'Transfer failed');
    } finally {
      setTransferSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className={`bg-dark-800 rounded-lg p-6 w-full ${partnerMode === 'EXTERNAL' ? 'max-w-lg' : 'max-w-md'} max-h-[90vh] overflow-y-auto`}>
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-xl font-bold">Extra Charges</h2>
            <p className="text-sm text-gray-400">{targetAdmin.name || targetAdmin.username} ({targetAdmin.role})</p>
            {partnerMode === 'INTERNAL' && (
              <p className="text-xs text-green-400 mt-1">Office (INTERNAL) — Give Incentive</p>
            )}
            {partnerMode === 'EXTERNAL' && (
              <p className="text-xs text-amber-400 mt-1">
                Outside partner (EXTERNAL) — Take brokerage (main wallet) or Transfer all hierarchy
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24} /></button>
        </div>

        {partnerMode === 'PARTNER_LEGACY' && (
          <p className="text-xs text-gray-500 mb-2">Broker / Sub-broker — Take brokerage only.</p>
        )}

        <div className="space-y-4">
          {/* Take brokerage — EXTERNAL ADMIN or broker/subbroker */}
          {(partnerMode === 'EXTERNAL' || partnerMode === 'PARTNER_LEGACY') && (
            <>
              <div className={`${partnerMode === 'EXTERNAL' ? 'p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg' : ''}`}>
                {partnerMode === 'EXTERNAL' && (
                  <p className="text-xs text-gray-400 mb-2">
                    Admin main wallet:{' '}
                    <span className="text-white font-semibold tabular-nums">
                      ₹{Number(targetAdmin.wallet?.balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                    <span className="text-gray-500"> (temporary wallet use nahi hota)</span>
                  </p>
                )}
                <label className="block text-sm text-gray-400 mb-1">
                  {partnerMode === 'EXTERNAL' ? 'Brokerage Charge Per Crore (₹) — from Franchise' : 'Amount to Take (₹)'}
                </label>
                <input
                  type="number"
                  value={formData.amount}
                  onChange={(e) => setFormData(prev => ({ ...prev, amount: e.target.value }))}
                  className={`w-full bg-dark-700 border rounded-lg px-4 py-2 ${partnerMode === 'EXTERNAL' ? 'border-rose-600/50' : 'border-dark-600'}`}
                  placeholder="Enter amount"
                  min="0"
                  step="0.01"
                />
                {partnerMode === 'EXTERNAL' && targetAdmin.restrictMode?.brokerageChargePerCrore > 0 && (
                  <p className="text-xs text-rose-400 mt-1">
                    Preset from Franchise: ₹{Number(targetAdmin.restrictMode.brokerageChargePerCrore).toLocaleString()}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Description (Optional)</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 h-20 resize-none"
                  placeholder="Enter description..."
                />
              </div>
            </>
          )}

          {/* Transfer full hierarchy — EXTERNAL ADMIN only */}
          {partnerMode === 'EXTERNAL' && (
            <div className="rounded-lg border border-dark-600 bg-dark-800/80 p-3 space-y-2">
              <div className="text-sm font-medium text-gray-300">Transfer all hierarchy</div>
              <p className="text-[11px] text-gray-500">
                Re-parent every broker, sub-broker, and user under this external admin onto an INTERNAL office admin (then you can run Give Incentive on that internal admin).
              </p>
              <select
                value={transferToId}
                onChange={(e) => setTransferToId(e.target.value)}
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select INTERNAL office admin…</option>
                {internalTargets.map((a) => (
                  <option key={a._id} value={a._id}>
                    {a.name || a.username} ({a.adminCode})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleTransferAllHierarchy}
                disabled={transferSaving || internalTargets.length === 0 || !transferToId}
                className="w-full py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-sm font-medium"
              >
                {transferSaving ? 'Transferring…' : 'Transfer all'}
              </button>
            </div>
          )}

          {/* Give incentive — INTERNAL ADMIN only */}
          {partnerMode === 'INTERNAL' && (
            <>
              <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                <label className="block text-sm text-green-400 mb-1">
                  Monthly Incentive Amount (₹) — from Limits
                </label>
                <input
                  type="number"
                  value={formData.amount}
                  onChange={(e) => setFormData(prev => ({ ...prev, amount: e.target.value }))}
                  className="w-full bg-dark-700 border border-green-600/50 rounded-lg px-4 py-2"
                  placeholder="Enter amount"
                  min="0"
                  step="0.01"
                />
                {targetAdmin.restrictMode?.monthlyIncentiveAmount > 0 && (
                  <p className="text-xs text-green-500 mt-1">
                    Preset from Limits: ₹{Number(targetAdmin.restrictMode.monthlyIncentiveAmount).toLocaleString()}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label className="block text-sm text-gray-400">Where to credit incentive</label>
                <p className="text-[11px] text-gray-500 -mt-0.5">
                  Trading goes to admin main wallet. Games goes to temporary (games) wallet. Games & trading splits the amount between both (server-rounded).
                </p>
                <div className="flex flex-col gap-2 mt-2">
                  {[
                    { id: 'games_and_trading', label: 'Games & trading (split)' },
                    { id: 'trading', label: 'Trading only (main wallet)' },
                    { id: 'games', label: 'Games only (temporary wallet)' },
                  ].map(({ id, label }) => (
                    <label key={id} className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="radio"
                        name="incentiveScope"
                        checked={formData.incentiveScope === id}
                        onChange={() => setFormData((prev) => ({ ...prev, incentiveScope: id }))}
                        className="accent-green-600"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Description (Optional)</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 h-20 resize-none"
                  placeholder="Enter description..."
                />
              </div>
            </>
          )}

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

        <div className="p-4 border-t border-dark-600 flex flex-col gap-2 mt-4">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-dark-600 hover:bg-dark-500 rounded"
            >
              Cancel
            </button>
            {(partnerMode === 'EXTERNAL' || partnerMode === 'PARTNER_LEGACY') && (
              <button
                type="button"
                onClick={handleTakeBrokerage}
                disabled={saving || !formData.amount}
                className="flex-1 px-4 py-2 rounded font-medium bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Processing...' : 'Take Brokerage'}
              </button>
            )}
            {partnerMode === 'INTERNAL' && (
              <button
                type="button"
                onClick={handleGiveIncentive}
                disabled={saving || !formData.amount}
                className="flex-1 px-4 py-2 rounded font-medium bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Processing...' : 'Give Incentive'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExtraChargesModal;
