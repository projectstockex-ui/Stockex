import React, { useState, useEffect } from 'react';
import axios from '../../../../config/axios';
import { useAuth } from '../../../../context/AuthContext';
import { usePagination } from '../utils/hooks';
import { 
  Plus, Search, Eye, Layers, Users, Settings, Wallet, History, 
  Shield, ArrowRightLeft, Key, Lock, Building2, Share2, LogOut, 
  Trash2, RefreshCw, X, Gamepad2, TrendingUp, Bitcoin, DollarSign, Info, ChevronRight, UserPlus
} from 'lucide-react';
import Pagination from '../ui/Pagination';
import CreateAdminModal from '../modals/CreateAdminModal';
import AdminFundModal from '../modals/AdminFundModal';
import WalletTransferModal from '../modals/WalletTransferModal';
import AdminDetailModal from '../modals/AdminDetailModal';
import AdminPasswordResetModal from '../modals/AdminPasswordResetModal';
import AdminChargesModal from '../modals/AdminChargesModal';
import AdminPermissionsModal from '../modals/AdminPermissionsModal';
import RestrictModeModal from '../modals/RestrictModeModal';
import IndividualPattiSharingModal from '../modals/IndividualPattiSharingModal';
import ExtraChargesModal from '../modals/ExtraChargesModal';

const AdminManagement = () => {
  const { admin } = useAuth();

  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showFundModal, setShowFundModal] = useState(false);
  const [showWalletTransferModal, setShowWalletTransferModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showChargesModal, setShowChargesModal] = useState(false);
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [showRestrictModal, setShowRestrictModal] = useState(false);
  const [showUsersModal, setShowUsersModal] = useState(false);
  const [showAllAccountsModal, setShowAllAccountsModal] = useState(false);
  const [allAccountsData, setAllAccountsData] = useState(null);
  const [loadingAllAccounts, setLoadingAllAccounts] = useState(false);
  const [showFundHistoryModal, setShowFundHistoryModal] = useState(false);
  const [fundHistory, setFundHistory] = useState([]);
  const [loadingFundHistory, setLoadingFundHistory] = useState(false);
  const [showHierarchyModal, setShowHierarchyModal] = useState(false);
  const [hierarchyData, setHierarchyData] = useState(null);
  const [showIndividualPattiModal, setShowIndividualPattiModal] = useState(false);
  const [showExtraChargesModal, setShowExtraChargesModal] = useState(false);
  const [loadingHierarchy, setLoadingHierarchy] = useState(false);
  const [expandedBrokers, setExpandedBrokers] = useState({});
  const [expandedSubBrokers, setExpandedSubBrokers] = useState({});
  const [adminUsers, setAdminUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedAdmin, setSelectedAdmin] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [superAdminBrokerageSettings, setSuperAdminBrokerageSettings] = useState({});
  const [showReferralSettingsModal, setShowReferralSettingsModal] = useState(null);

  const isSuperAdmin = admin?.role === 'SUPER_ADMIN';
  const isAdmin = admin?.role === 'ADMIN';
  const isBroker = admin?.role === 'BROKER';

  const getAllowedRoles = () => {
    if (isSuperAdmin) return ['ADMIN', 'BROKER', 'SUB_BROKER'];
    if (isAdmin) return ['BROKER', 'SUB_BROKER'];
    if (isBroker) return ['SUB_BROKER'];
    return [];
  };

  const allowedRoles = getAllowedRoles();

  const filteredByRole = roleFilter === 'ALL' 
    ? admins 
    : admins.filter(a => a.role === roleFilter);

  const { currentPage, setCurrentPage, totalPages, paginatedData: paginatedAdmins, totalItems } = usePagination(
    filteredByRole, 20, searchTerm, ['name', 'username', 'email', 'adminCode', 'phone']
  );

  const getRoleBadgeColor = (role) => {
    switch(role) {
      case 'ADMIN': return 'bg-purple-500/20 text-purple-400';
      case 'BROKER': return 'bg-cyan-500/20 text-cyan-400';
      case 'SUB_BROKER': return 'bg-green-500/20 text-green-400';
      default: return 'bg-gray-500/20 text-gray-400';
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

  const getTitle = () => {
    if (isSuperAdmin) return 'Hierarchy Management';
    if (isAdmin) return 'Broker / Sub Broker Management';
    if (isBroker) return admin?.isDemo ? 'Demo Sub Broker Management' : 'Sub Broker Management';
    return 'Management';
  };

  const getCreateLabel = () => {
    if (isSuperAdmin) return 'Create Admin/Broker/SubBroker';
    if (isAdmin) return 'Create Broker/SubBroker';
    if (isBroker) return admin?.isDemo ? 'Create Demo Sub Broker' : 'Create Sub Broker';
    return 'Create';
  };

  useEffect(() => {
    fetchAdmins();
  }, []);

  const fetchAdmins = async () => {
    try {
      const { data } = await axios.get('/api/admin/manage/admins', {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setAdmins(data);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (adminId, newStatus) => {
    try {
      await axios.put(`/api/admin/manage/admins/${adminId}/status`, { status: newStatus }, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      fetchAdmins();
    } catch (error) {
      alert(error.response?.data?.message || 'Error updating status');
    }
  };

  const handleRoleChange = async (adminId, newRole) => {
    try {
      await axios.put(`/api/admin/manage/admins/${adminId}/role`, { role: newRole }, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      fetchAdmins();
      setShowRoleModal(false);
      setSelectedAdmin(null);
      alert(`Role changed to ${newRole} successfully`);
    } catch (error) {
      alert(error.response?.data?.message || 'Error changing role');
    }
  };

  const handlePermanentDelete = async (adminId, adminName) => {
    if (!confirm(`⚠️ PERMANENT DELETE\n\nAre you sure you want to permanently delete "${adminName}" and ALL their subordinates and users?\n\nThis action CANNOT be undone!`)) return;
    if (!confirm(`FINAL CONFIRMATION: This will delete all data associated with "${adminName}". Type OK to proceed.`)) return;

    try {
      const { data } = await axios.delete(`/api/admin/manage/admins/${adminId}/permanent`, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      alert(`✓ ${data.message}\n\nDeleted: ${data.deletedSubordinates} subordinates, ${data.deletedUsers} users`);
      fetchAdmins();
    } catch (error) {
      alert(error.response?.data?.message || 'Error deleting admin');
    }
  };

  const handleToggleFranchiseRoot = async (targetAdmin) => {
    const newValue = !targetAdmin.isFranchiseRoot;
    const action = newValue ? 'enable' : 'disable';
    if (!confirm(`Franchise Root: ${action} for "${targetAdmin.name || targetAdmin.username}"?\n\nWhen ENABLED:\n• This admin's subtree forms an isolated unit\n• Trading profit/loss settles within subtree only\n• Super Admin gets only platform charges from these users\n\nContinue?`)) return;

    try {
      await axios.put(`/api/admin/manage/admins/${targetAdmin._id}/franchise-root`, {
        isFranchiseRoot: newValue,
      }, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      alert(`Franchise root ${action}d successfully for ${targetAdmin.name || targetAdmin.username}`);
      fetchAdmins();
    } catch (error) {
      alert(error.response?.data?.message || 'Error toggling franchise root');
    }
  };

  const handleLoginAsAdmin = async (targetAdminId) => {
    try {
      const { data } = await axios.post(`/api/admin/login-as-admin/${targetAdminId}`, {}, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });

      const getTargetBasePath = (role) => {
        switch(role) {
          case 'ADMIN': return '/admin/dashboard';
          case 'BROKER': return '/broker/dashboard';
          case 'SUB_BROKER': return '/subbroker/dashboard';
          default: return '/admin/dashboard';
        }
      };

      const targetPath = getTargetBasePath(data.role);
      const encodedData = encodeURIComponent(JSON.stringify(data));
      const loginAsUrl = `/login-as?type=admin&token=${data.token}&data=${encodedData}&redirect=${targetPath}`;

      window.open(loginAsUrl, '_blank');
    } catch (error) {
      alert(error.response?.data?.message || 'Error logging in as admin');
    }
  };

  const fetchAdminUsers = async (targetAdmin) => {
    setLoadingUsers(true);
    setAdminUsers([]);
    try {
      const { data } = await axios.get(`/api/admin/manage/admins/${targetAdmin._id}/users`, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setAdminUsers(data.users || []);
    } catch (error) {
      console.error('Error fetching users:', error);
      setAdminUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleViewUsers = (adm) => {
    setSelectedAdmin(adm);
    setShowUsersModal(true);
    fetchAdminUsers(adm);
  };

  const fetchAllAccountsUnder = async (targetAdmin) => {
    setLoadingAllAccounts(true);
    setAllAccountsData(null);
    try {
      const subordinates = admins.filter(a => 
        a.parentId?._id === targetAdmin._id || 
        a.parentId === targetAdmin._id ||
        a.hierarchyPath?.includes(targetAdmin._id)
      );

      const { data: users } = await axios.get(`/api/admin/manage/admins/${targetAdmin._id}/users`, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });

      const subSubordinates = [];
      for (const sub of subordinates) {
        const subSubs = admins.filter(a => 
          a.parentId?._id === sub._id || a.parentId === sub._id
        );
        subSubordinates.push(...subSubs);
      }

      const subordinateUsers = [];
      for (const sub of [...subordinates, ...subSubordinates]) {
        try {
          const { data: subUsers } = await axios.get(`/api/admin/manage/admins/${sub._id}/users`, {
            headers: { Authorization: `Bearer ${admin.token}` }
          });
          subordinateUsers.push(...(subUsers.users || []));
        } catch (e) {
          console.error('Error fetching users for', sub.adminCode);
        }
      }

      setAllAccountsData({
        admin: targetAdmin,
        subordinates: [...subordinates, ...subSubordinates],
        directUsers: users.users || [],
        allUsers: [...(users.users || []), ...subordinateUsers],
        stats: {
          totalSubordinates: subordinates.length + subSubordinates.length,
          brokers: subordinates.filter(s => s.role === 'BROKER').length,
          subBrokers: [...subordinates, ...subSubordinates].filter(s => s.role === 'SUB_BROKER').length,
          directUsers: (users.users || []).length,
          totalUsers: (users.users || []).length + subordinateUsers.length
        }
      });
    } catch (error) {
      console.error('Error fetching all accounts:', error);
      setAllAccountsData({ error: 'Failed to fetch accounts' });
    } finally {
      setLoadingAllAccounts(false);
    }
  };

  const handleViewAllAccounts = (adm) => {
    setSelectedAdmin(adm);
    setShowAllAccountsModal(true);
    fetchAllAccountsUnder(adm);
  };

  const fetchFundHistory = async (targetAdmin) => {
    setLoadingFundHistory(true);
    setFundHistory([]);
    try {
      const { data } = await axios.get(`/api/admin/manage/admins/${targetAdmin._id}/fund-history`, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setFundHistory(data.history || []);
    } catch (error) {
      console.error('Error fetching fund history:', error.response?.data || error.message);
      setFundHistory([]);
    } finally {
      setLoadingFundHistory(false);
    }
  };

  const handleViewFundHistory = (adm) => {
    setSelectedAdmin(adm);
    setShowFundHistoryModal(true);
    fetchFundHistory(adm);
  };

  const fetchHierarchy = async (targetAdmin) => {
    setLoadingHierarchy(true);
    setHierarchyData(null);
    setExpandedBrokers({});
    setExpandedSubBrokers({});
    try {
      const { data } = await axios.get(`/api/admin/manage/admins/${targetAdmin._id}/hierarchy`, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setHierarchyData(data);
    } catch (error) {
      console.error('Error fetching hierarchy:', error);
      setHierarchyData(null);
    } finally {
      setLoadingHierarchy(false);
    }
  };

  const handleViewHierarchy = (adm) => {
    setSelectedAdmin(adm);
    setShowHierarchyModal(true);
    fetchHierarchy(adm);
  };

  const toggleBrokerExpand = (brokerId) => {
    setExpandedBrokers(prev => ({ ...prev, [brokerId]: !prev[brokerId] }));
  };

  const toggleSubBrokerExpand = (subBrokerId) => {
    setExpandedSubBrokers(prev => ({ ...prev, [subBrokerId]: !prev[subBrokerId] }));
  };

  const handleSuperAdminBrokerageChange = async (adminId, type, value) => {
    setSuperAdminBrokerageSettings(prev => ({
      ...prev,
      [adminId]: {
        ...prev[adminId],
        [type === 'flat' ? 'superAdminFlatBrokerage' : 'superAdminFixedBrokerage']: value
      }
    }));

    setAdmins(prev => prev.map(adm => {
      if (adm._id === adminId) {
        return {
          ...adm,
          [type === 'flat' ? 'superAdminFlatBrokerage' : 'superAdminFixedBrokerage']: value
        };
      }
      return adm;
    }));

    try {
      const field = type === 'flat' ? 'superAdminFlatBrokerage' : 'superAdminFixedBrokerage';
      await axios.put(`/api/admin/manage/admins/${adminId}`, {
        [field]: value
      }, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
    } catch (error) {
      console.error('Error updating super admin brokerage:', error);
      setAdmins(prev => prev.map(adm => {
        if (adm._id === adminId) {
          return {
            ...adm,
            [type === 'flat' ? 'superAdminFlatBrokerage' : 'superAdminFixedBrokerage']: 
              (type === 'flat' ? adm.superAdminFlatBrokerage : adm.superAdminFixedBrokerage) || 0
          };
        }
        return adm;
      }));
    }
  };

  const handleToggleReferralDistribution = async (adminId, segment = null) => {
    try {
      const { data } = await axios.put(`/api/admin/manage/toggle-referral-distribution/${adminId}`, segment ? { segment } : {}, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });

      setAdmins(prev => prev.map(adm => {
        if (adm._id === adminId) {
          return {
            ...adm,
            referralDistributionEnabled: data.referralDistributionEnabled
          };
        }
        return adm;
      }));

      const segmentName = segment ? segment.toUpperCase() : 'all segments';
      const isEnabled = segment ? data.referralDistributionEnabled[segment] : data.referralDistributionEnabled.games;
      alert(`Referral distribution for ${segmentName} ${isEnabled ? 'enabled' : 'disabled'} successfully`);
    } catch (error) {
      console.error('Error toggling referral distribution:', error);
      alert(error.response?.data?.message || 'Error toggling referral distribution');
    }
  };

  const isReferralDisabled = (adm) => {
    const settings = adm.referralDistributionEnabled;
    if (!settings) return false;
    if (typeof settings === 'boolean') return !settings;
    return !settings.games || !settings.mcx || !settings.crypto || !settings.forex;
  };

  return (
    <div className="p-4 md:p-6">
      {/* Sticky Header with Create Button */}
      <div className="sticky top-0 bg-dark-900 z-20 pb-4 mb-4 -mx-4 md:-mx-6 px-4 md:px-6 border-b border-dark-700">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-4">
          <h1 className="text-2xl font-bold">{getTitle()}</h1>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 bg-yellow-600 hover:bg-yellow-700 px-4 py-2 rounded-lg whitespace-nowrap"
          >
            <Plus size={20} />
            {getCreateLabel()}
          </button>
        </div>

        {/* Role Filter & Search */}
        <div className="flex flex-col sm:flex-row gap-4 mt-4">
        {/* Role Filter Tabs */}
        {allowedRoles.length > 1 && (
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setRoleFilter('ALL')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                roleFilter === 'ALL' ? 'bg-yellow-600 text-white' : 'bg-dark-700 text-gray-400 hover:bg-dark-600'
              }`}
            >
              All ({admins.length})
            </button>
            {allowedRoles.map(role => (
              <button
                key={role}
                onClick={() => setRoleFilter(role)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  roleFilter === role ? getRoleBadgeColor(role).replace('/20', '') : 'bg-dark-700 text-gray-400 hover:bg-dark-600'
                }`}
              >
                {getRoleLabel(role)} ({admins.filter(a => a.role === role).length})
              </button>
            ))}
          </div>
        )}
        
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search by name, email, or code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-dark-700 border border-dark-600 rounded-lg pl-10 pr-4 py-2 focus:outline-none focus:border-yellow-500"
          />
        </div>
      </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Total</div>
          <div className="text-2xl font-bold text-yellow-400">{admins.length}</div>
        </div>
        {isSuperAdmin && (
          <div className="bg-dark-800 rounded-lg p-4">
            <div className="text-sm text-gray-400">Admins</div>
            <div className="text-2xl font-bold text-purple-400">{admins.filter(a => a.role === 'ADMIN').length}</div>
          </div>
        )}
        {(isSuperAdmin || isAdmin) && (
          <div className="bg-dark-800 rounded-lg p-4">
            <div className="text-sm text-gray-400">Brokers</div>
            <div className="text-2xl font-bold text-blue-400">{admins.filter(a => a.role === 'BROKER').length}</div>
          </div>
        )}
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Sub Brokers</div>
          <div className="text-2xl font-bold text-green-400">{admins.filter(a => a.role === 'SUB_BROKER').length}</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Total Users</div>
          <div className="text-2xl font-bold text-purple-400">{admins.reduce((sum, a) => sum + (a.stats?.totalUsers || 0), 0)}</div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8"><RefreshCw className="animate-spin inline" /></div>
      ) : totalItems === 0 ? (
        <div className="text-center py-8 text-gray-400">No admins found</div>
      ) : (
        <div className="space-y-4">
          {paginatedAdmins.map(adm => (
            <div key={adm._id} className="bg-dark-800 rounded-lg p-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                {/* Admin Info */}
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-lg">{adm.name || adm.username}</span>
                    <span className={`px-2 py-0.5 rounded text-xs ${getRoleBadgeColor(adm.role)}`}>
                      {getRoleLabel(adm.role)}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-xs ${adm.status === 'ACTIVE' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                      {adm.status}
                    </span>
                  </div>
                  <div className="text-sm text-gray-400 mt-1">{adm.email} • {adm.phone || 'No phone'}</div>
                  <div className="flex items-center gap-4 mt-2 flex-wrap">
                    <span className="text-sm font-mono bg-purple-500/20 text-purple-400 px-2 py-1 rounded">{adm.adminCode}</span>
                    {adm.parentId && (
                      <span className="text-xs text-gray-500">Parent: {adm.parentId?.name || adm.parentId?.adminCode || 'N/A'}</span>
                    )}
                    <span className="text-xs text-gray-500">Created: {new Date(adm.createdAt).toLocaleDateString()}</span>
                    {adm.referralCode && (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}/login?ref=${adm.referralCode}`);
                          alert('Registration link copied!');
                        }}
                        className="text-xs bg-green-600/20 text-green-400 px-2 py-1 rounded hover:bg-green-600/30"
                      >
                        Copy User Link
                      </button>
                    )}
                  </div>
                </div>

                {/* Stats */}
                <div className="flex gap-4 flex-wrap">
                  <div className="text-center">
                    <div className="text-xs text-gray-400">Wallet</div>
                    <div className="text-lg font-bold text-green-400">₹{(adm.wallet?.balance || 0).toLocaleString()}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-400">Total Added</div>
                    <div className="text-lg font-bold text-yellow-400">₹{(adm.wallet?.totalDeposited || 0).toLocaleString()}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-400">Users</div>
                    <div className={`text-lg font-bold ${adm.restrictMode?.enabled ? (adm.stats?.totalUsers >= adm.restrictMode?.maxUsers ? 'text-red-400' : 'text-yellow-400') : ''}`}>
                      {adm.stats?.totalUsers || adm.userCount || 0}
                      {adm.restrictMode?.enabled && <span className="text-xs text-gray-500">/{adm.restrictMode.maxUsers}</span>}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-400">Auto Square</div>
                    <div className="text-lg font-bold text-orange-400">{adm.defaultSettings?.autosquare || 0}%</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-400">Max Lot</div>
                    <div className="text-lg font-bold text-cyan-400">{adm.defaultSettings?.quantitySettings?.maxLotQuantity || adm.defaultSettings?.lotSettings?.maxLotSize || 0}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-400">Min Lot</div>
                    <div className="text-lg font-bold text-cyan-400">{adm.defaultSettings?.lotSettings?.minLotSize || 1}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-400">Breakup Qty</div>
                    <div className="text-lg font-bold text-cyan-400">{adm.defaultSettings?.quantitySettings?.breakupQuantity || 0}</div>
                  </div>
                  {adm.restrictMode?.enabled && (
                    <div className="text-center">
                      <div className="text-xs text-gray-400">Limit</div>
                      <div className="text-lg font-bold text-red-400 flex items-center gap-1">
                        <Lock size={14} /> ON
                      </div>
                    </div>
                  )}
                </div>

                {/* Super Admin Brokerage Settings - Only for Super Admin */}
                {isSuperAdmin && (
                  <div className="flex gap-4 flex-wrap items-end">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">SA Flat %</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={adm.superAdminFlatBrokerage || 0}
                        onChange={(e) => handleSuperAdminBrokerageChange(adm._id, 'flat', parseFloat(e.target.value) || 0)}
                        className="w-20 bg-dark-700 border border-dark-600 rounded px-2 py-1 text-sm"
                        placeholder="%"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">SA Fixed ₹</label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={adm.superAdminFixedBrokerage || 0}
                        onChange={(e) => handleSuperAdminBrokerageChange(adm._id, 'fixed', parseFloat(e.target.value) || 0)}
                        className="w-24 bg-dark-700 border border-dark-600 rounded px-2 py-1 text-sm"
                        placeholder="₹"
                      />
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => { setSelectedAdmin(adm); setShowDetailModal(true); }}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm flex items-center gap-1"
                  >
                    <Eye size={16} /> View
                  </button>
                  {isSuperAdmin && (
                    <button
                      onClick={() => handleViewAllAccounts(adm)}
                      className="px-3 py-2 bg-amber-600 hover:bg-amber-700 rounded text-sm flex items-center gap-1"
                      title="View all subordinates and users under this account"
                    >
                      <Layers size={16} /> All Accounts
                    </button>
                  )}
                  <button
                    onClick={() => handleViewUsers(adm)}
                    className="px-3 py-2 bg-cyan-600 hover:bg-cyan-700 rounded text-sm flex items-center gap-1"
                  >
                    <Users size={16} /> Users ({adm.stats?.totalUsers || adm.userCount || 0})
                  </button>
                  <button
                    onClick={() => { setSelectedAdmin(adm); setShowChargesModal(true); }}
                    className="px-3 py-2 bg-purple-600 hover:bg-purple-700 rounded text-sm flex items-center gap-1"
                  >
                    <Settings size={16} /> Settings
                  </button>
                  <button
                    onClick={() => { setSelectedAdmin(adm); setShowFundModal(true); }}
                    className="px-3 py-2 bg-green-600 hover:bg-green-700 rounded text-sm flex items-center gap-1"
                  >
                    <Wallet size={16} /> Fund
                  </button>
                  <button
                    onClick={() => handleViewFundHistory(adm)}
                    className="px-3 py-2 bg-teal-600 hover:bg-teal-700 rounded text-sm flex items-center gap-1"
                    title="View fund transaction history"
                  >
                    <History size={16} /> History
                  </button>
                  <button
                    onClick={() => handleViewHierarchy(adm)}
                    className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 rounded text-sm flex items-center gap-1"
                    title="View complete hierarchy"
                  >
                    <Layers size={16} /> Hierarchy
                  </button>
                  {isSuperAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAdmin(adm);
                        setShowPermissionsModal(true);
                      }}
                      className="px-3 py-2 bg-yellow-600 hover:bg-yellow-700 rounded text-sm flex items-center gap-1"
                      title="Capability toggles (brokerage, charges, leverage, …)"
                    >
                      <Shield size={16} /> Permissions
                    </button>
                  )}
                  <button
                    onClick={() => { setSelectedAdmin(adm); setShowIndividualPattiModal(true); }}
                    className="px-3 py-2 bg-pink-600 hover:bg-pink-700 rounded text-sm flex items-center gap-1"
                    title="Individual Patti Sharing"
                  >
                    <ArrowRightLeft size={16} /> Patti
                  </button>
                  <button
                    onClick={() => { setSelectedAdmin(adm); setShowPasswordModal(true); }}
                    className="px-3 py-2 bg-yellow-600 hover:bg-yellow-700 rounded text-sm flex items-center gap-1"
                  >
                    <Key size={16} /> Password
                  </button>
                  {isSuperAdmin && (
                    <button
                      onClick={() => { setSelectedAdmin(adm); setShowRoleModal(true); }}
                      className="px-3 py-2 bg-orange-600 hover:bg-orange-700 rounded text-sm flex items-center gap-1"
                    >
                      <Shield size={16} /> Role
                    </button>
                  )}
                  {isSuperAdmin && (
                    <button
                      onClick={() => { setSelectedAdmin(adm); setShowRestrictModal(true); }}
                      className={`px-3 py-2 rounded text-sm flex items-center gap-1 ${
                        adm.restrictMode?.enabled 
                          ? 'bg-red-600 hover:bg-red-700' 
                          : 'bg-gray-600 hover:bg-gray-700'
                      }`}
                      title="Set user/broker limits"
                    >
                      <Lock size={16} /> Limits
                    </button>
                  )}
                  {isSuperAdmin && adm.role === 'ADMIN' && (
                    <button
                      onClick={() => handleToggleFranchiseRoot(adm)}
                      className={`px-3 py-2 rounded text-sm flex items-center gap-1 ${
                        adm.isFranchiseRoot
                          ? 'bg-purple-600 hover:bg-purple-700'
                          : 'bg-slate-600 hover:bg-slate-700'
                      }`}
                      title={adm.isFranchiseRoot ? 'Franchise root (isolated) - click to disable' : 'Make franchise root (isolated subtree)'}
                    >
                      <Building2 size={16} /> {adm.isFranchiseRoot ? 'Franchise ON' : 'Franchise'}
                    </button>
                  )}
                  <button
                    onClick={() => setShowReferralSettingsModal(adm)}
                    className={`px-3 py-2 rounded text-sm flex items-center gap-1 ${
                      isReferralDisabled(adm) 
                        ? 'bg-gray-600 hover:bg-gray-700' 
                        : 'bg-emerald-600 hover:bg-emerald-700'
                    }`}
                    title={isReferralDisabled(adm) ? 'Referral disabled for some segments' : 'Referral enabled'}
                  >
                    <Share2 size={16} /> Referral
                  </button>
                  {isSuperAdmin && (
                    <button
                      onClick={() => handleLoginAsAdmin(adm._id)}
                      className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 rounded text-sm flex items-center gap-1"
                      title="Login as this admin without password"
                    >
                      <LogOut size={16} /> Login As
                    </button>
                  )}
                  {adm.status === 'ACTIVE' ? (
                    <button
                      onClick={() => handleStatusChange(adm._id, 'SUSPENDED')}
                      className="px-3 py-2 bg-red-600 hover:bg-red-700 rounded text-sm"
                    >
                      Suspend
                    </button>
                  ) : (
                    <button
                      onClick={() => handleStatusChange(adm._id, 'ACTIVE')}
                      className="px-3 py-2 bg-green-600 hover:bg-green-700 rounded text-sm"
                    >
                      Activate
                    </button>
                  )}
                  {isSuperAdmin && (
                    <button
                      onClick={() => handlePermanentDelete(adm._id, adm.name || adm.username)}
                      className="px-3 py-2 bg-red-800 hover:bg-red-900 rounded text-sm flex items-center gap-1"
                      title="Permanently delete this admin and all subordinates"
                    >
                      <Trash2 size={16} /> Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            totalItems={totalItems}
            itemsPerPage={20}
          />
        </div>
      )}

      {/* Modals */}
      {showCreateModal && (
        <CreateAdminModal
          token={admin.token}
          creatorRole={admin.role}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => { setShowCreateModal(false); fetchAdmins(); }}
        />
      )}

      {showFundModal && selectedAdmin && (
        <AdminFundModal
          admin={selectedAdmin}
          token={admin.token}
          onClose={() => { setShowFundModal(false); setSelectedAdmin(null); }}
          onSuccess={() => { fetchAdmins(); }}
        />
      )}

      {showDetailModal && selectedAdmin && (
        <AdminDetailModal
          admin={selectedAdmin}
          token={admin.token}
          onClose={() => { setShowDetailModal(false); setSelectedAdmin(null); }}
        />
      )}

      {showPasswordModal && selectedAdmin && (
        <AdminPasswordResetModal
          admin={selectedAdmin}
          token={admin.token}
          onClose={() => { setShowPasswordModal(false); setSelectedAdmin(null); }}
        />
      )}

      {showChargesModal && selectedAdmin && (
        <AdminChargesModal
          admin={selectedAdmin}
          viewerRole={admin?.role}
          token={admin.token}
          onClose={() => { setShowChargesModal(false); setSelectedAdmin(null); }}
          onSuccess={() => { fetchAdmins(); }}
        />
      )}

      {showPermissionsModal && selectedAdmin && isSuperAdmin && (
        <AdminPermissionsModal
          admin={selectedAdmin}
          token={admin.token}
          onClose={() => { setShowPermissionsModal(false); setSelectedAdmin(null); }}
          onSuccess={() => { fetchAdmins(); }}
        />
      )}

      {showWalletTransferModal && selectedAdmin && (
        <WalletTransferModal
          admin={selectedAdmin}
          token={admin.token}
          onClose={() => { setShowWalletTransferModal(false); setSelectedAdmin(null); }}
          onSuccess={() => { fetchAdmins(); }}
        />
      )}

      {/* Role Change Modal - Super Admin Only */}
      {showRoleModal && selectedAdmin && isSuperAdmin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 rounded-lg p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Change Role</h2>
              <button onClick={() => { setShowRoleModal(false); setSelectedAdmin(null); }} className="text-gray-400 hover:text-white">
                <X size={24} />
              </button>
            </div>

            <div className="mb-4">
              <p className="text-gray-400 mb-2">
                Change role for <span className="text-white font-medium">{selectedAdmin.name || selectedAdmin.username}</span>
              </p>
              <p className="text-sm text-gray-500">
                Current Role: <span className={`font-medium ${
                  selectedAdmin.role === 'ADMIN' ? 'text-purple-400' : 
                  selectedAdmin.role === 'BROKER' ? 'text-blue-400' : 'text-green-400'
                }`}>{getRoleLabel(selectedAdmin.role)}</span>
              </p>
            </div>

            <div className="space-y-3">
              <p className="text-sm text-gray-400">Select new role:</p>
              <div className="grid grid-cols-3 gap-2">
                {['ADMIN', 'BROKER', 'SUB_BROKER'].map(role => (
                  <button
                    key={role}
                    onClick={() => handleRoleChange(selectedAdmin._id, role)}
                    disabled={selectedAdmin.role === role}
                    className={`px-4 py-3 rounded-lg text-sm font-medium transition ${
                      selectedAdmin.role === role
                        ? 'bg-dark-600 text-gray-500 cursor-not-allowed'
                        : role === 'ADMIN' ? 'bg-purple-600 hover:bg-purple-700 text-white'
                        : role === 'BROKER' ? 'bg-blue-600 hover:bg-blue-700 text-white'
                        : 'bg-green-600 hover:bg-green-700 text-white'
                    }`}
                  >
                    {getRoleLabel(role)}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <p className="text-xs text-yellow-400">
                ⚠️ Changing role will affect this admin's permissions and hierarchy access.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Users Modal - View users under selected admin */}
      {showUsersModal && selectedAdmin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 rounded-lg w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex justify-between items-center p-4 border-b border-dark-600">
              <div>
                <h2 className="text-xl font-bold">Users under {selectedAdmin.name || selectedAdmin.username}</h2>
                <p className="text-sm text-gray-400">
                  <span className={`px-2 py-0.5 rounded text-xs ${getRoleBadgeColor(selectedAdmin.role)}`}>
                    {getRoleLabel(selectedAdmin.role)}
                  </span>
                  <span className="ml-2">{selectedAdmin.adminCode}</span>
                </p>
              </div>
              <button onClick={() => { setShowUsersModal(false); setSelectedAdmin(null); setAdminUsers([]); }} className="text-gray-400 hover:text-white">
                <X size={24} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1">
              {loadingUsers ? (
                <div className="text-center py-8"><RefreshCw className="animate-spin inline" size={24} /></div>
              ) : adminUsers.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <Users size={48} className="mx-auto mb-4 opacity-50" />
                  <p>No users found under this {getRoleLabel(selectedAdmin.role).toLowerCase()}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-sm text-gray-400 mb-4">
                    Total Users: <span className="text-white font-bold">{adminUsers.length}</span>
                  </div>
                  <div className="grid gap-3">
                    {adminUsers.map(user => (
                      <div key={user._id} className="bg-dark-700 rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold">{user.fullName || user.username}</span>
                            <span className={`px-2 py-0.5 rounded text-xs ${user.isActive ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                              {user.isActive ? 'Active' : 'Inactive'}
                            </span>
                            {user.isDemo && <span className="px-2 py-0.5 rounded text-xs bg-yellow-500/20 text-yellow-400">Demo</span>}
                          </div>
                          <div className="text-sm text-gray-400 mt-1">{user.email}</div>
                          <div className="text-xs text-gray-500 mt-1">
                            <span className="font-mono">{user.userId}</span>
                            {user.phone && <span className="ml-2">• {user.phone}</span>}
                          </div>
                        </div>
                        <div className="flex gap-4 text-center">
                          <div>
                            <div className="text-xs text-gray-400">Cash Balance</div>
                            <div className="text-green-400 font-bold">₹{(user.wallet?.cashBalance || 0).toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-400">P&L</div>
                            <div className={`font-bold ${(user.wallet?.totalPnL || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              ₹{(user.wallet?.totalPnL || 0).toLocaleString()}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-400">Created</div>
                            <div className="text-gray-300 text-sm">{new Date(user.createdAt).toLocaleDateString()}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-dark-600">
              <button
                onClick={() => { setShowUsersModal(false); setSelectedAdmin(null); setAdminUsers([]); }}
                className="w-full py-2 bg-dark-600 hover:bg-dark-500 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Referral Settings Modal */}
      {showReferralSettingsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 rounded-lg w-full max-w-md overflow-hidden flex flex-col">
            <div className="flex justify-between items-center p-4 border-b border-dark-600">
              <div>
                <h2 className="text-xl font-bold">Referral Distribution Settings</h2>
                <p className="text-sm text-gray-400">
                  {showReferralSettingsModal.name || showReferralSettingsModal.username} ({showReferralSettingsModal.adminCode})
                </p>
              </div>
              <button onClick={() => setShowReferralSettingsModal(null)} className="text-gray-400 hover:text-white">
                <X size={24} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-dark-700 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Gamepad2 size={20} className="text-purple-400" />
                    <div>
                      <div className="font-semibold">Games</div>
                      <div className="text-xs text-gray-400">Nifty Up/Down, BTC Up/Down, etc.</div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleToggleReferralDistribution(showReferralSettingsModal._id, 'games')}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold ${
                      showReferralSettingsModal.referralDistributionEnabled?.games !== false
                        ? 'bg-emerald-600 hover:bg-emerald-700'
                        : 'bg-gray-600 hover:bg-gray-700'
                    }`}
                  >
                    {showReferralSettingsModal.referralDistributionEnabled?.games !== false ? 'ON' : 'OFF'}
                  </button>
                </div>

                <div className="flex items-center justify-between p-3 bg-dark-700 rounded-lg">
                  <div className="flex items-center gap-3">
                    <TrendingUp size={20} className="text-blue-400" />
                    <div>
                      <div className="font-semibold">MCX</div>
                      <div className="text-xs text-gray-400">Commodities trading</div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleToggleReferralDistribution(showReferralSettingsModal._id, 'mcx')}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold ${
                      showReferralSettingsModal.referralDistributionEnabled?.mcx !== false
                        ? 'bg-emerald-600 hover:bg-emerald-700'
                        : 'bg-gray-600 hover:bg-gray-700'
                    }`}
                  >
                    {showReferralSettingsModal.referralDistributionEnabled?.mcx !== false ? 'ON' : 'OFF'}
                  </button>
                </div>

                <div className="flex items-center justify-between p-3 bg-dark-700 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Bitcoin size={20} className="text-orange-400" />
                    <div>
                      <div className="font-semibold">Crypto</div>
                      <div className="text-xs text-gray-400">Cryptocurrency trading</div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleToggleReferralDistribution(showReferralSettingsModal._id, 'crypto')}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold ${
                      showReferralSettingsModal.referralDistributionEnabled?.crypto !== false
                        ? 'bg-emerald-600 hover:bg-emerald-700'
                        : 'bg-gray-600 hover:bg-gray-700'
                    }`}
                  >
                    {showReferralSettingsModal.referralDistributionEnabled?.crypto !== false ? 'ON' : 'OFF'}
                  </button>
                </div>

                <div className="flex items-center justify-between p-3 bg-dark-700 rounded-lg">
                  <div className="flex items-center gap-3">
                    <DollarSign size={20} className="text-green-400" />
                    <div>
                      <div className="font-semibold">Forex</div>
                      <div className="text-xs text-gray-400">Currency trading</div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleToggleReferralDistribution(showReferralSettingsModal._id, 'forex')}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold ${
                      showReferralSettingsModal.referralDistributionEnabled?.forex !== false
                        ? 'bg-emerald-600 hover:bg-emerald-700'
                        : 'bg-gray-600 hover:bg-gray-700'
                    }`}
                  >
                    {showReferralSettingsModal.referralDistributionEnabled?.forex !== false ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-dark-600">
                <div className="text-xs text-gray-400">
                  <Info size={14} className="inline mr-1" />
                  Toggle referral distribution on/off for each segment. When disabled, referral commissions will not be transferred to the referral client for that segment.
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-dark-600">
              <button
                onClick={() => setShowReferralSettingsModal(null)}
                className="w-full py-2 bg-dark-600 hover:bg-dark-500 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restrict Mode Modal - Super Admin Only */}
      {showRestrictModal && selectedAdmin && isSuperAdmin && (
        <RestrictModeModal
          admin={selectedAdmin}
          token={admin.token}
          onClose={() => { setShowRestrictModal(false); setSelectedAdmin(null); }}
          onSuccess={() => { fetchAdmins(); }}
        />
      )}

      {/* Individual Patti Sharing Modal */}
      {showIndividualPattiModal && selectedAdmin && (
        <IndividualPattiSharingModal
          admin={admin}
          targetAdmin={selectedAdmin}
          onClose={() => { setShowIndividualPattiModal(false); setSelectedAdmin(null); }}
        />
      )}

      {/* Extra Charges Modal */}
      {showExtraChargesModal && selectedAdmin && (
        <ExtraChargesModal
          admin={admin}
          targetAdmin={selectedAdmin}
          onClose={() => { setShowExtraChargesModal(false); setSelectedAdmin(null); }}
          onHierarchyTransferred={() => fetchAdmins()}
        />
      )}

      {/* All Accounts Modal - View all subordinates and users under an admin */}
      {showAllAccountsModal && selectedAdmin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 rounded-lg w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex justify-between items-center p-4 border-b border-dark-600">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Layers className="text-amber-400" size={24} />
                  All Accounts under {selectedAdmin.name || selectedAdmin.username}
                </h2>
                <p className="text-sm text-gray-400 mt-1">
                  <span className={`px-2 py-0.5 rounded text-xs ${getRoleBadgeColor(selectedAdmin.role)}`}>
                    {getRoleLabel(selectedAdmin.role)}
                  </span>
                  <span className="ml-2 font-mono">{selectedAdmin.adminCode}</span>
                </p>
              </div>
              <button onClick={() => { setShowAllAccountsModal(false); setSelectedAdmin(null); setAllAccountsData(null); }} className="text-gray-400 hover:text-white">
                <X size={24} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1">
              {loadingAllAccounts ? (
                <div className="text-center py-8"><RefreshCw className="animate-spin inline" size={32} /></div>
              ) : allAccountsData?.error ? (
                <div className="text-center py-8 text-red-400">{allAccountsData.error}</div>
              ) : allAccountsData ? (
                <div className="space-y-6">
                  {/* Stats Summary */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
                      <div className="text-sm text-purple-400">Brokers</div>
                      <div className="text-2xl font-bold text-purple-300">{allAccountsData.stats?.brokers || 0}</div>
                    </div>
                    <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                      <div className="text-sm text-green-400">Sub Brokers</div>
                      <div className="text-2xl font-bold text-green-300">{allAccountsData.stats?.subBrokers || 0}</div>
                    </div>
                    <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4">
                      <div className="text-sm text-cyan-400">Direct Users</div>
                      <div className="text-2xl font-bold text-cyan-300">{allAccountsData.stats?.directUsers || 0}</div>
                    </div>
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                      <div className="text-sm text-blue-400">Total Users</div>
                      <div className="text-2xl font-bold text-blue-300">{allAccountsData.stats?.totalUsers || 0}</div>
                    </div>
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                      <div className="text-sm text-yellow-400">Total Subordinates</div>
                      <div className="text-2xl font-bold text-yellow-300">{allAccountsData.stats?.totalSubordinates || 0}</div>
                    </div>
                  </div>

                  {/* Subordinates Section */}
                  {allAccountsData.subordinates?.length > 0 && (
                    <div>
                      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                        <Shield size={20} className="text-purple-400" />
                        Brokers ({allAccountsData.subordinates.length})
                      </h3>
                      <div className="bg-dark-700 rounded-lg overflow-hidden">
                        <table className="w-full">
                          <thead className="bg-dark-600">
                            <tr>
                              <th className="text-left p-3 text-sm">Name</th>
                              <th className="text-left p-3 text-sm">Code</th>
                              <th className="text-left p-3 text-sm">Role</th>
                              <th className="text-left p-3 text-sm">Email</th>
                              <th className="text-left p-3 text-sm">Users</th>
                              <th className="text-left p-3 text-sm">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {allAccountsData.subordinates.map(sub => (
                              <tr key={sub._id} className="border-t border-dark-600 hover:bg-dark-600">
                                <td className="p-3">{sub.name}</td>
                                <td className="p-3 font-mono text-sm">{sub.adminCode}</td>
                                <td className="p-3">
                                  <span className={`px-2 py-1 rounded text-xs ${getRoleBadgeColor(sub.role)}`}>
                                    {getRoleLabel(sub.role)}
                                  </span>
                                </td>
                                <td className="p-3 text-gray-400 text-sm">{sub.email}</td>
                                <td className="p-3">{sub.stats?.totalUsers || sub.userCount || 0}</td>
                                <td className="p-3">
                                  <span className={`px-2 py-1 rounded text-xs ${sub.status === 'ACTIVE' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                                    {sub.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* All Users Section */}
                  {allAccountsData.allUsers?.length > 0 && (
                    <div>
                      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                        <Users size={20} className="text-blue-400" />
                        All Users ({allAccountsData.allUsers.length})
                      </h3>
                      <div className="bg-dark-700 rounded-lg overflow-hidden max-h-96 overflow-y-auto">
                        <table className="w-full">
                          <thead className="bg-dark-600 sticky top-0">
                            <tr>
                              <th className="text-left p-3 text-sm">Name</th>
                              <th className="text-left p-3 text-sm">Username</th>
                              <th className="text-left p-3 text-sm">Email</th>
                              <th className="text-left p-3 text-sm">Balance</th>
                              <th className="text-left p-3 text-sm">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {allAccountsData.allUsers.slice(0, 100).map(user => (
                              <tr key={user._id} className="border-t border-dark-600 hover:bg-dark-600">
                                <td className="p-3">{user.fullName || user.name || '-'}</td>
                                <td className="p-3 font-mono text-sm text-blue-400">{user.username}</td>
                                <td className="p-3 text-gray-400 text-sm">{user.email}</td>
                                <td className="p-3 text-yellow-400">₹{(user.wallet?.balance || 0).toLocaleString()}</td>
                                <td className="p-3">
                                  <span className={`px-2 py-1 rounded text-xs ${user.isActive ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                                    {user.isActive ? 'Active' : 'Inactive'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {allAccountsData.allUsers.length > 100 && (
                          <div className="p-3 text-center text-gray-400 text-sm">
                            Showing first 100 of {allAccountsData.allUsers.length} users
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* No Data */}
                  {(!allAccountsData.subordinates?.length && !allAccountsData.allUsers?.length) && (
                    <div className="text-center py-8 text-gray-400">
                      <Users size={48} className="mx-auto mb-4 opacity-50" />
                      <p>No subordinates or users found under this account</p>
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="p-4 border-t border-dark-600">
              <button
                onClick={() => { setShowAllAccountsModal(false); setSelectedAdmin(null); setAllAccountsData(null); }}
                className="w-full py-2 bg-dark-600 hover:bg-dark-500 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fund History Modal */}
      {showFundHistoryModal && selectedAdmin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 rounded-lg w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="p-4 border-b border-dark-600 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <History size={24} className="text-teal-400" />
                  Fund History - {selectedAdmin.name || selectedAdmin.username}
                </h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    selectedAdmin.role === 'ADMIN' ? 'bg-purple-500/20 text-purple-400' :
                    selectedAdmin.role === 'BROKER' ? 'bg-blue-500/20 text-blue-400' :
                    'bg-green-500/20 text-green-400'
                  }`}>{selectedAdmin.role}</span>
                  <span className="text-sm text-gray-400">{selectedAdmin.adminCode}</span>
                </div>
              </div>
              <button onClick={() => { setShowFundHistoryModal(false); setSelectedAdmin(null); setFundHistory([]); }} className="text-gray-400 hover:text-white">
                <X size={24} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                  <div className="text-sm text-green-400">Total Deposited</div>
                  <div className="text-2xl font-bold text-green-300">₹{(selectedAdmin.wallet?.totalDeposited || 0).toLocaleString()}</div>
                </div>
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                  <div className="text-sm text-red-400">Total Withdrawn</div>
                  <div className="text-2xl font-bold text-red-300">₹{(selectedAdmin.wallet?.totalWithdrawn || 0).toLocaleString()}</div>
                </div>
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                  <div className="text-sm text-blue-400">Current Balance</div>
                  <div className="text-2xl font-bold text-blue-300">₹{(selectedAdmin.wallet?.balance || 0).toLocaleString()}</div>
                </div>
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                  <div className="text-sm text-yellow-400">Transactions</div>
                  <div className="text-2xl font-bold text-yellow-300">{fundHistory.length}</div>
                </div>
              </div>

              {loadingFundHistory ? (
                <div className="text-center py-8"><RefreshCw className="animate-spin inline" size={32} /></div>
              ) : fundHistory.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <History size={48} className="mx-auto mb-4 opacity-50" />
                  <p>No fund transactions found</p>
                </div>
              ) : (
                <div className="bg-dark-700 rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-dark-600">
                      <tr>
                        <th className="text-left p-3 text-sm">Date</th>
                        <th className="text-left p-3 text-sm">Type</th>
                        <th className="text-left p-3 text-sm">Amount</th>
                        <th className="text-left p-3 text-sm">Balance After</th>
                        <th className="text-left p-3 text-sm">Description</th>
                        <th className="text-left p-3 text-sm">By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fundHistory.map((txn, idx) => (
                        <tr key={txn._id || idx} className="border-t border-dark-600 hover:bg-dark-600">
                          <td className="p-3 text-sm text-gray-400">
                            {new Date(txn.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                            <br />
                            <span className="text-xs">{new Date(txn.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              txn.type === 'CREDIT' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                            }`}>
                              {txn.type === 'CREDIT' ? '+ Deposit' : '- Withdraw'}
                            </span>
                          </td>
                          <td className={`p-3 font-bold ${txn.type === 'CREDIT' ? 'text-green-400' : 'text-red-400'}`}>
                            {txn.type === 'CREDIT' ? '+' : '-'}₹{(txn.amount || 0).toLocaleString()}
                          </td>
                          <td className="p-3 text-blue-400">₹{(txn.balanceAfter || 0).toLocaleString()}</td>
                          <td className="p-3 text-sm text-gray-300">{txn.description || txn.reason || '-'}</td>
                          <td className="p-3 text-sm text-purple-400">{txn.performedBy?.name || txn.performedBy?.username || 'System'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-dark-600">
              <button
                onClick={() => { setShowFundHistoryModal(false); setSelectedAdmin(null); setFundHistory([]); }}
                className="w-full py-2 bg-dark-600 hover:bg-dark-500 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hierarchy View Modal */}
      {showHierarchyModal && selectedAdmin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 rounded-lg w-full max-w-5xl max-h-[90vh] flex flex-col">
            <div className="p-4 border-b border-dark-600 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Layers size={24} className="text-indigo-400" />
                  Hierarchy View - {selectedAdmin.name || selectedAdmin.username}
                </h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    selectedAdmin.role === 'ADMIN' ? 'bg-purple-500/20 text-purple-400' :
                    selectedAdmin.role === 'BROKER' ? 'bg-blue-500/20 text-blue-400' :
                    'bg-green-500/20 text-green-400'
                  }`}>{selectedAdmin.role}</span>
                  <span className="text-sm text-gray-400">{selectedAdmin.adminCode}</span>
                </div>
              </div>
              <button onClick={() => { setShowHierarchyModal(false); setSelectedAdmin(null); setHierarchyData(null); }} className="text-gray-400 hover:text-white">
                <X size={24} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1">
              {loadingHierarchy ? (
                <div className="text-center py-8"><RefreshCw className="animate-spin inline" size={32} /></div>
              ) : hierarchyData ? (
                <>
                  {/* Summary Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-center">
                      <div className="text-xs text-blue-400">Brokers</div>
                      <div className="text-xl font-bold text-blue-300">{hierarchyData.stats?.totalBrokers || 0}</div>
                      <div className="text-xs text-gray-400">₹{(hierarchyData.stats?.totalBrokerBalance || 0).toLocaleString()}</div>
                    </div>
                    <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-center">
                      <div className="text-xs text-green-400">Sub-Brokers</div>
                      <div className="text-xl font-bold text-green-300">{hierarchyData.stats?.totalSubBrokers || 0}</div>
                      <div className="text-xs text-gray-400">₹{(hierarchyData.stats?.totalSubBrokerBalance || 0).toLocaleString()}</div>
                    </div>
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-center">
                      <div className="text-xs text-yellow-400">Total Clients</div>
                      <div className="text-xl font-bold text-yellow-300">{hierarchyData.stats?.totalUsers || 0}</div>
                      <div className="text-xs text-gray-400">₹{(hierarchyData.stats?.totalUserBalance || 0).toLocaleString()}</div>
                    </div>
                    <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 text-center">
                      <div className="text-xs text-purple-400">Admin Balance</div>
                      <div className="text-xl font-bold text-purple-300">₹{(hierarchyData.admin?.wallet?.balance || 0).toLocaleString()}</div>
                    </div>
                    <div className="bg-teal-500/10 border border-teal-500/30 rounded-lg p-3 text-center">
                      <div className="text-xs text-teal-400">Total Deposited</div>
                      <div className="text-xl font-bold text-teal-300">₹{(hierarchyData.admin?.wallet?.totalDeposited || 0).toLocaleString()}</div>
                    </div>
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-center">
                      <div className="text-xs text-red-400">Total Withdrawn</div>
                      <div className="text-xl font-bold text-red-300">₹{(hierarchyData.admin?.wallet?.totalWithdrawn || 0).toLocaleString()}</div>
                    </div>
                  </div>

                  {/* Brokers Section */}
                  {hierarchyData.brokers?.length > 0 && (
                    <div className="mb-6">
                      <h3 className="text-lg font-semibold text-blue-400 mb-3 flex items-center gap-2">
                        <Users size={20} /> Brokers ({hierarchyData.brokers.length})
                      </h3>
                      <div className="space-y-2">
                        {hierarchyData.brokers.map(broker => (
                          <div key={broker._id} className="bg-dark-700 rounded-lg overflow-hidden">
                            <div 
                              className="p-3 flex items-center justify-between cursor-pointer hover:bg-dark-600"
                              onClick={() => toggleBrokerExpand(broker._id)}
                            >
                              <div className="flex items-center gap-3">
                                <ChevronRight size={18} className={`transition-transform ${expandedBrokers[broker._id] ? 'rotate-90' : ''}`} />
                                <div>
                                  <div className="font-medium">{broker.name || broker.username}</div>
                                  <div className="text-xs text-gray-400">{broker.adminCode}</div>
                                </div>
                              </div>
                              <div className="flex gap-4 text-sm">
                                <span className="text-gray-400">{broker.stats?.totalUsers || 0} users</span>
                                <span className="text-green-400">₹{(broker.wallet?.balance || 0).toLocaleString()}</span>
                              </div>
                            </div>
                            {expandedBrokers[broker._id] && broker.subBrokers && (
                              <div className="p-3 pt-0 border-t border-dark-600">
                                <div className="space-y-2 mt-3">
                                  {broker.subBrokers.map(subBroker => (
                                    <div key={subBroker._id} className="bg-dark-800 rounded p-3">
                                      <div className="flex items-center justify-between">
                                        <div>
                                          <div className="text-sm font-medium text-green-400">{subBroker.name || subBroker.username}</div>
                                          <div className="text-xs text-gray-500">{subBroker.adminCode}</div>
                                        </div>
                                        <div className="text-sm text-gray-400">
                                          {subBroker.stats?.totalUsers || 0} users • ₹{(subBroker.wallet?.balance || 0).toLocaleString()}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* No Data */}
                  {(!hierarchyData.brokers?.length && !hierarchyData.stats?.totalUsers) && (
                    <div className="text-center py-8 text-gray-400">
                      <Layers size={48} className="mx-auto mb-4 opacity-50" />
                      <p>No hierarchy found under this account</p>
                    </div>
                  )}
                </>
              ) : null}
            </div>

            <div className="p-4 border-t border-dark-600">
              <button
                onClick={() => { setShowHierarchyModal(false); setSelectedAdmin(null); setHierarchyData(null); }}
                className="w-full py-2 bg-dark-600 hover:bg-dark-500 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminManagement;
