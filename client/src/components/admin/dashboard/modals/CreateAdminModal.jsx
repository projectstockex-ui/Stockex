/**
 * CreateAdminModal component for AdminDashboard
 */
import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import axios from '../../../../config/axios';

const CreateAdminModal = ({ token, onClose, onSuccess, creatorRole }) => {
  // Get allowed roles based on creator's role
  const getAllowedRoles = () => {
    switch(creatorRole) {
      case 'SUPER_ADMIN': return ['ADMIN', 'BROKER', 'SUB_BROKER']; // Can create all with parent selection
      case 'ADMIN': return ['BROKER', 'SUB_BROKER']; // Can create broker and sub-broker under their brokers
      case 'BROKER': return ['SUB_BROKER']; // Only Broker can create Sub-Broker directly
      default: return [];
    }
  };

  const allowedRoles = getAllowedRoles();
  const [formData, setFormData] = useState({ 
    username: '', 
    name: '', 
    email: '', 
    phone: '', 
    password: '', 
    pin: '',
    role: allowedRoles[0] || 'ADMIN',
    parentAdminId: '', // For assigning broker/sub-broker under specific parent
    cityCode: '', // Pincode area — shown in Choose Your Broker
    cityName: '', // Area name — shown in Choose Your Broker
    refundableSecurityAmount: '',
    autosquare: 0, // Auto square position at percentage loss
    breakupQuantity: 0, // Breakup quantity per order
    maxLotQuantity: 0 // Max lot quantity per order
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [adminsList, setAdminsList] = useState([]); // List of ADMINs
  const [brokersList, setBrokersList] = useState([]); // List of BROKERs (filtered by selected admin)
  const [allBrokers, setAllBrokers] = useState([]); // All brokers for filtering
  const [selectedAdminFilter, setSelectedAdminFilter] = useState(''); // Admin filter for SUB_BROKER creation

  // Fetch admins and brokers list based on role selection
  useEffect(() => {
    if (['SUPER_ADMIN', 'ADMIN'].includes(creatorRole) && ['BROKER', 'SUB_BROKER'].includes(formData.role)) {
      fetchHierarchyList();
    }
  }, [formData.role, creatorRole]);

  // Filter brokers when admin filter changes
  useEffect(() => {
    if (formData.role === 'SUB_BROKER' && selectedAdminFilter) {
      const filtered = allBrokers.filter(b => b.parentId?._id === selectedAdminFilter || b.parentId === selectedAdminFilter);
      setBrokersList(filtered);
      // Reset broker selection if current selection is not in filtered list
      if (formData.parentAdminId && !filtered.find(b => b._id === formData.parentAdminId)) {
        setFormData(prev => ({ ...prev, parentAdminId: '' }));
      }
    } else if (formData.role === 'SUB_BROKER' && !selectedAdminFilter) {
      setBrokersList(allBrokers);
    }
  }, [selectedAdminFilter, allBrokers, formData.role]);

  const fetchHierarchyList = async () => {
    try {
      const res = await axios.get('/api/admin/manage/admins', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const admins = res.data.filter(a => a.role === 'ADMIN');
      const brokers = res.data.filter(a => a.role === 'BROKER');
      setAdminsList(admins);
      setAllBrokers(brokers);
      setBrokersList(brokers);
    } catch (err) {
      console.error('Error fetching hierarchy:', err);
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

  const getRoleBadgeColor = (role) => {
    switch(role) {
      case 'ADMIN': return 'bg-purple-600';
      case 'BROKER': return 'bg-cyan-600';
      case 'SUB_BROKER': return 'bg-green-600';
      default: return 'bg-gray-600';
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      // Prepare payload - include parentAdminId only if selected
      const payload = { ...formData };
      if (!payload.parentAdminId) {
        delete payload.parentAdminId;
      }
      await axios.post('/api/admin/manage/admins', payload, {
        headers: { Authorization: `Bearer ${token}` }
      });
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.message || 'Error creating');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-dark-800 rounded-lg w-full max-w-md my-8">
        <div className="sticky top-0 bg-dark-800 p-6 pb-4 border-b border-dark-700 rounded-t-lg z-10">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold">Create New {getRoleLabel(formData.role)}</h2>
            <button onClick={onClose} className="hover:bg-dark-700 p-1 rounded"><X size={24} /></button>
          </div>
        </div>
        <div className="p-6 pt-4 max-h-[calc(100vh-200px)] overflow-y-auto">
          {error && <div className="bg-red-500/20 text-red-400 p-2 rounded mb-4">{error}</div>}
          <form onSubmit={handleSubmit} className="space-y-4">
          {/* Role Selection */}
          {allowedRoles.length > 1 && (
            <div>
              <label className="block text-sm text-gray-400 mb-2">Select Role</label>
              <div className="flex gap-2 flex-wrap">
                {allowedRoles.map(role => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => { setFormData({...formData, role, parentAdminId: ''}); setSelectedAdminFilter(''); }}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                      formData.role === role ? getRoleBadgeColor(role) + ' text-white' : 'bg-dark-700 text-gray-400 hover:bg-dark-600'
                    }`}
                  >
                    {getRoleLabel(role)}
                  </button>
                ))}
              </div>
            </div>
          )}
          
          {/* Parent Selection - For SUPER_ADMIN/ADMIN creating BROKER */}
          {['SUPER_ADMIN', 'ADMIN'].includes(creatorRole) && formData.role === 'BROKER' && (
            <div>
              <label className="block text-sm text-gray-400 mb-2">Assign Under Admin (Optional)</label>
              <select
                value={formData.parentAdminId}
                onChange={e => setFormData({...formData, parentAdminId: e.target.value})}
                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
              >
                <option value="">-- Direct under {creatorRole === 'SUPER_ADMIN' ? 'Super Admin' : 'You'} --</option>
                {adminsList.map(adm => (
                  <option key={adm._id} value={adm._id}>
                    {adm.name || adm.username} ({adm.adminCode})
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Leave empty to create broker directly under you, or select an admin.
              </p>
            </div>
          )}
          
          {/* Two-step Selection for SUB_BROKER: First Admin filter, then Broker */}
          {['SUPER_ADMIN', 'ADMIN'].includes(creatorRole) && formData.role === 'SUB_BROKER' && (
            <>
              {/* Step 1: Filter by Admin (Optional) */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">Filter by Admin (Optional)</label>
                <select
                  value={selectedAdminFilter}
                  onChange={e => setSelectedAdminFilter(e.target.value)}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
                >
                  <option value="">-- All Admins --</option>
                  {adminsList.map(adm => (
                    <option key={adm._id} value={adm._id}>
                      {adm.name || adm.username} ({adm.adminCode})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Select an admin to show only brokers under that admin.
                </p>
              </div>
              
              {/* Step 2: Select Parent Broker */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">Select Parent Broker *</label>
                <select
                  value={formData.parentAdminId}
                  onChange={e => setFormData({...formData, parentAdminId: e.target.value})}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
                  required
                >
                  <option value="">-- Select a Broker --</option>
                  {brokersList.map(broker => (
                    <option key={broker._id} value={broker._id}>
                      {broker.name || broker.username} ({broker.adminCode}) {broker.parentId?.name ? `- Under ${broker.parentId.name}` : ''}
                    </option>
                  ))}
                </select>
                {brokersList.length === 0 && selectedAdminFilter && (
                  <p className="text-xs text-yellow-500 mt-1">
                    No brokers found under this admin.
                  </p>
                )}
                {!selectedAdminFilter && (
                  <p className="text-xs text-gray-500 mt-1">
                    Sub-broker must be created under a broker.
                  </p>
                )}
              </div>
            </>
          )}
          
          <input type="text" placeholder="Username *" value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2" required />
          <input type="text" placeholder="Full Name" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2" />
          <input type="email" placeholder="Email *" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2" required />
          <input type="text" placeholder="Phone" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2" />

          {['BROKER', 'SUB_BROKER'].includes(formData.role) && (
            <div className="bg-dark-700/50 rounded-lg p-4 border border-cyan-500/20 space-y-3">
              <h4 className="text-sm font-semibold text-cyan-400">Broker area (shown in Choose Your Broker)</h4>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Pincode Area *</label>
                <input
                  type="text"
                  placeholder="e.g. 110001, DEL, MUM"
                  value={formData.cityCode}
                  onChange={e => setFormData({ ...formData, cityCode: e.target.value.toUpperCase() })}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Area Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Delhi, Mumbai, Bangalore"
                  value={formData.cityName}
                  onChange={e => setFormData({ ...formData, cityName: e.target.value })}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Refundable Security Amount *</label>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  placeholder="Initial security deposit"
                  value={formData.refundableSecurityAmount}
                  onChange={e => setFormData({ ...formData, refundableSecurityAmount: e.target.value })}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
                  required
                />
                <p className="text-[10px] text-gray-500 mt-1">Shown in Super Admin → All Transactions → Refundable Security</p>
              </div>
            </div>
          )}

          <input type="password" placeholder="Password *" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2" required />
          <input
            type="text"
            inputMode="numeric"
            placeholder="4-6 digit PIN *"
            value={formData.pin}
            onChange={e => setFormData({ ...formData, pin: e.target.value.replace(/\D/g, '') })}
            className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
            required
            pattern="[0-9]{4,6}"
          />
          
          {/* Trading Limits */}
          <div className="bg-dark-700/50 rounded-lg p-4 border border-dark-600">
            <h4 className="text-sm font-semibold text-cyan-400 mb-3">Trading Limits</h4>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Auto Square (%)</label>
                <input 
                  type="number" 
                  step="0.1" 
                  min="0" 
                  max="100" 
                  placeholder="0 = disabled"
                  value={formData.autosquare || 0} 
                  onChange={e => setFormData({...formData, autosquare: parseFloat(e.target.value) || 0})} 
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" 
                />
                <p className="text-xs text-gray-500 mt-1">Auto square position at percentage loss</p>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Breakup Quantity (Per Order)</label>
                <input 
                  type="number" 
                  min="0" 
                  placeholder="0 = no limit"
                  value={formData.breakupQuantity || 0} 
                  onChange={e => setFormData({...formData, breakupQuantity: parseInt(e.target.value) || 0})} 
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" 
                />
                <p className="text-xs text-gray-500 mt-1">Maximum quantity per single order</p>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Max Lot Quantity (Per Order)</label>
                <input 
                  type="number" 
                  min="0" 
                  placeholder="0 = no limit"
                  value={formData.maxLotQuantity || 0} 
                  onChange={e => setFormData({...formData, maxLotQuantity: parseInt(e.target.value) || 0})} 
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm" 
                />
                <p className="text-xs text-gray-500 mt-1">Maximum lots per single order</p>
              </div>
            </div>
          </div>
          
          <div className="flex gap-3 mt-4">
            <button type="button" onClick={onClose} className="flex-1 bg-dark-600 py-2 rounded">Cancel</button>
            <button type="submit" disabled={loading} className={`flex-1 ${getRoleBadgeColor(formData.role)} py-2 rounded`}>
              {loading ? 'Creating...' : `Create ${getRoleLabel(formData.role)}`}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
};

export default CreateAdminModal;
