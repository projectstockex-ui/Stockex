import React, { useState, useEffect } from 'react';
import { useAuth } from '../../../context/AuthContext';
import axios from '../../../config/axios';
import { Settings, Search, Loader2 } from 'lucide-react';
import UserSegmentSettingsModal from './UserSegmentSettingsModal';

const ClientManagement = () => {
  const { admin } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const { data } = await axios.get('/api/admin/manage/users', {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setUsers(data);
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSettingsClick = (user) => {
    setSelectedUser(user);
    setShowSettingsModal(true);
  };

  const filteredUsers = users.filter(user =>
    user.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.fullName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="animate-spin text-purple-500" size={32} />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Client Management</h1>
          <p className="text-gray-400 text-sm mt-1">Manage your clients and their individual segment settings</p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search clients by name, username, or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-dark-700 border border-dark-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-purple-500"
          />
        </div>
      </div>

      {/* Users List */}
      <div className="bg-dark-800 rounded-lg border border-dark-700 overflow-hidden">
        {filteredUsers.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            {searchTerm ? 'No clients found matching your search' : 'No clients found'}
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-dark-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Username</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Email</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Balance</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Settings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {filteredUsers.map((user) => (
                <tr key={user._id} className="hover:bg-dark-700/50 transition">
                  <td className="px-6 py-4 whitespace-nowrap text-white">{user.fullName || '-'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-300">{user.username}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-300">{user.email}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-300">
                    {(user.wallet?.balance || 0).toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                      user.isActive ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'
                    }`}>
                      {user.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <button
                      onClick={() => handleSettingsClick(user)}
                      className="p-2 text-purple-400 hover:text-purple-300 hover:bg-purple-900/20 rounded-lg transition"
                      title="Segment Settings"
                    >
                      <Settings size={20} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* User Segment Settings Modal */}
      {showSettingsModal && selectedUser && (
        <UserSegmentSettingsModal
          user={selectedUser}
          onClose={() => {
            setShowSettingsModal(false);
            setSelectedUser(null);
          }}
          onSave={() => {
            setShowSettingsModal(false);
            setSelectedUser(null);
          }}
        />
      )}
    </div>
  );
};

export default ClientManagement;
