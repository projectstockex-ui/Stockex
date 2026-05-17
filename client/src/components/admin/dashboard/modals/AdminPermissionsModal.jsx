/**
 * AdminPermissionsModal component for AdminDashboard
 */
import { useState } from 'react';
import { X, Shield } from 'lucide-react';
import axios from '../../../../config/axios';

const ADMIN_HIERARCHY_PERMISSION_TOGGLES = [
  { key: 'canChangeBrokerage', label: 'Can Change Brokerage', desc: 'Allow modifying brokerage rates' },
  { key: 'canChangeCharges', label: 'Can Change Charges', desc: 'Allow modifying fees and charges' },
  { key: 'canChangeLeverage', label: 'Can Change Leverage', desc: 'Allow modifying leverage settings' },
  { key: 'canChangeLotSettings', label: 'Can Change Lot Settings', desc: 'Allow modifying lot limits' },
  { key: 'canChangeTradingSettings', label: 'Can Change Trading Settings', desc: 'Allow modifying trading rules' },
  { key: 'canChangeQuantitySettings', label: 'Can Change Quantity Settings', desc: 'Allow modifying quantity limits' },
  { key: 'canCreateUsers', label: 'Can Create Users', desc: 'Allow creating new users' },
  { key: 'canManageFunds', label: 'Can Manage Funds', desc: 'Allow adding/withdrawing funds' },
];

const AdminPermissionsModal = ({ admin: targetAdmin, token, onClose, onSuccess }) => {
  const [permissions, setPermissions] = useState({
    canChangeBrokerage: targetAdmin.permissions?.canChangeBrokerage ?? false,
    canChangeCharges: targetAdmin.permissions?.canChangeCharges ?? false,
    canChangeLeverage: targetAdmin.permissions?.canChangeLeverage ?? false,
    canChangeLotSettings: targetAdmin.permissions?.canChangeLotSettings ?? false,
    canChangeTradingSettings: targetAdmin.permissions?.canChangeTradingSettings ?? false,
    canChangeQuantitySettings: targetAdmin.permissions?.canChangeQuantitySettings ?? false,
    canCreateUsers: targetAdmin.permissions?.canCreateUsers !== false,
    canManageFunds: targetAdmin.permissions?.canManageFunds !== false,
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ type: '', text: '' });
    try {
      await axios.put(
        `/api/admin/manage/admins/${targetAdmin._id}/permissions`,
        { permissions },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setMessage({ type: 'success', text: 'Permissions updated successfully' });
      onSuccess();
      setTimeout(onClose, 1200);
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || 'Error updating permissions' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-lg w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto border border-dark-600">
        <div className="flex justify-between mb-4">
          <h2 className="text-xl font-bold flex items-center gap-2 text-yellow-400">
            <Shield size={22} /> Permissions
          </h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={24} />
          </button>
        </div>
        <div className="bg-dark-700 rounded p-3 mb-4">
          <div className="font-bold">{targetAdmin.name || targetAdmin.username}</div>
          <div className="text-xs text-purple-400 font-mono">{targetAdmin.adminCode}</div>
          <div className="text-xs text-gray-500 mt-1">Control what this admin can change for their team</div>
        </div>
        {message.text && (
          <div className={`p-3 rounded mb-4 ${message.type === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
            {message.text}
          </div>
        )}
        <form onSubmit={handleSave} className="space-y-4">
          <div className="bg-dark-700/50 rounded-lg p-4">
            <div className="grid grid-cols-1 gap-2">
              {ADMIN_HIERARCHY_PERMISSION_TOGGLES.map((perm) => (
                <div key={perm.key} className="flex items-center justify-between p-2 bg-dark-800 rounded">
                  <div>
                    <div className="text-sm font-medium">{perm.label}</div>
                    <div className="text-xs text-gray-500">{perm.desc}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPermissions({ ...permissions, [perm.key]: !permissions[perm.key] })}
                    className={`w-12 h-6 rounded-full transition shrink-0 ${permissions[perm.key] ? 'bg-green-600' : 'bg-dark-500'}`}
                  >
                    <div
                      className={`w-5 h-5 bg-white rounded-full transition transform ${permissions[perm.key] ? 'translate-x-6' : 'translate-x-0.5'}`}
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 bg-dark-600 hover:bg-dark-500 py-2 rounded-lg">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 py-2 rounded-lg font-medium"
            >
              {loading ? 'Saving…' : 'Save Permissions'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AdminPermissionsModal;
