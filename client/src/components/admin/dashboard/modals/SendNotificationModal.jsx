import React, { useState } from 'react';
import { X } from 'lucide-react';
import axios from '../../../../config/axios';

const SendNotificationModal = ({ onClose, token, users, admins, isSuperAdmin }) => {
  const [formData, setFormData] = useState({
    title: '',
    subject: '',
    description: '',
    targetType: 'ALL_USERS',
    targetUserIds: [],
    targetAdminCode: ''
  });

  const [image, setImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImage(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  const toggleUserSelection = (userId) => {
    setFormData(prev => ({
      ...prev,
      targetUserIds: prev.targetUserIds.includes(userId)
        ? prev.targetUserIds.filter(id => id !== userId)
        : [...prev.targetUserIds, userId]
    }));
  };

  const selectAllFilteredUsers = () => {
    const filteredIds = filteredUsers.map(u => u._id);
    setFormData(prev => ({
      ...prev,
      targetUserIds: [...new Set([...prev.targetUserIds, ...filteredIds])]
    }));
  };

  const clearAllSelections = () => {
    setFormData(prev => ({ ...prev, targetUserIds: [] }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.title || !formData.subject || !formData.description) {
      alert('Please fill in all required fields');
      return;
    }

    if (formData.targetType === 'SELECTED_USERS' && formData.targetUserIds.length === 0) {
      alert('Please select at least one user');
      return;
    }

    setLoading(true);
    try {
      const submitData = new FormData();
      submitData.append('title', formData.title);
      submitData.append('subject', formData.subject);
      submitData.append('description', formData.description);
      submitData.append('targetType', formData.targetType);
      if (formData.targetType === 'SELECTED_USERS') {
        submitData.append('targetUserIds', JSON.stringify(formData.targetUserIds));
      }
      if (formData.targetType === 'ADMIN_USERS') {
        submitData.append('targetAdminCode', formData.targetAdminCode);
      }
      if (image) {
        submitData.append('image', image);
      }

      await axios.post('/api/notifications', submitData, {
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data'
        }
      });
      alert('Notification sent successfully!');
      onClose();
    } catch (error) {
      alert(error.response?.data?.message || 'Error sending notification');
    } finally {
      setLoading(false);
    }
  };

  // Filter users based on search
  const filteredUsers = users.filter(u => 
    (u.fullName || u.username || '').toLowerCase().includes(userSearch.toLowerCase()) ||
    (u.email || '').toLowerCase().includes(userSearch.toLowerCase())
  );

  // Get unique admin codes for dropdown
  const uniqueAdminCodes = [...new Set(users.map(u => u.adminCode))].filter(Boolean);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto">
      <div className="bg-dark-800 rounded-lg p-6 w-full max-w-lg mx-4 my-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Send Notification</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Title *</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2"
              placeholder="Notification title"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Subject *</label>
            <input
              type="text"
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2"
              placeholder="Notification subject"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Description *</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 min-h-[100px]"
              placeholder="Notification description"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Image (Optional)</label>
            <input
              type="file"
              accept="image/*"
              onChange={handleImageChange}
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 text-sm"
            />
            {imagePreview && (
              <div className="mt-2 relative">
                <img src={imagePreview} alt="Preview" className="w-full max-h-40 object-cover rounded-lg" />
                <button
                  type="button"
                  onClick={() => { setImage(null); setImagePreview(null); }}
                  className="absolute top-2 right-2 bg-red-600 rounded-full p-1"
                >
                  <X size={16} />
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Send To *</label>
            <select
              value={formData.targetType}
              onChange={(e) => setFormData({ ...formData, targetType: e.target.value, targetUserIds: [], targetAdminCode: '' })}
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2"
            >
              {isSuperAdmin && <option value="ALL_ADMINS_USERS">All Users (All Admins)</option>}
              <option value="ALL_USERS">All My Users</option>
              <option value="SELECTED_USERS">Selected Users</option>
              {isSuperAdmin && <option value="ADMIN_USERS">Specific Admin's Users</option>}
            </select>
          </div>

          {formData.targetType === 'SELECTED_USERS' && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Select Users * ({formData.targetUserIds.length} selected)
              </label>
              <input
                type="text"
                placeholder="Search users..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2 mb-2"
              />
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={selectAllFilteredUsers}
                  className="text-xs bg-green-600 hover:bg-green-700 px-2 py-1 rounded"
                >
                  Select All Filtered
                </button>
                <button
                  type="button"
                  onClick={clearAllSelections}
                  className="text-xs bg-red-600 hover:bg-red-700 px-2 py-1 rounded"
                >
                  Clear All
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto bg-dark-700 border border-dark-600 rounded-lg">
                {filteredUsers.map(u => (
                  <label
                    key={u._id}
                    className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-dark-600 ${
                      formData.targetUserIds.includes(u._id) ? 'bg-green-900/30' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={formData.targetUserIds.includes(u._id)}
                      onChange={() => toggleUserSelection(u._id)}
                      className="rounded"
                    />
                    <span className="text-sm">
                      {u.fullName || u.username} <span className="text-gray-500">({u.email})</span>
                    </span>
                  </label>
                ))}
                {filteredUsers.length === 0 && (
                  <div className="px-3 py-4 text-center text-gray-500 text-sm">No users found</div>
                )}
              </div>
            </div>
          )}

          {formData.targetType === 'ADMIN_USERS' && isSuperAdmin && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">Select Admin *</label>
              <select
                value={formData.targetAdminCode}
                onChange={(e) => setFormData({ ...formData, targetAdminCode: e.target.value })}
                className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-2"
              >
                <option value="">Select Admin</option>
                {admins && admins.map(a => (
                  <option key={a._id} value={a.adminCode}>
                    {a.fullName || a.username} ({a.adminCode})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 bg-dark-600 hover:bg-dark-500 py-2 rounded-lg">
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={loading}
              className="flex-1 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 py-2 rounded-lg"
            >
              {loading ? 'Sending...' : 'Send Notification'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SendNotificationModal;
