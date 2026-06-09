import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import axios from '../../../../config/axios';
import { useAuth } from '../../../../context/AuthContext';
import { formatCoins } from '../../../../utils/stockexCoins.js';

const SuperAdminFundRequests = () => {
  const { admin } = useAuth();

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('PENDING');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [stats, setStats] = useState({ pending: 0, approved: 0, rejected: 0, totalDeposits: 0, totalWithdrawals: 0 });

  useEffect(() => {
    fetchRequests();
  }, [filter, typeFilter]);

  const fetchRequests = async () => {
    try {
      setLoading(true);
      const { data } = await axios.get('/api/admin/manage/all-fund-requests', {
        params: { status: filter, type: typeFilter !== 'ALL' ? typeFilter : undefined },
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setRequests(data.requests || []);
      setStats(data.stats || stats);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (id, action) => {
    try {
      await axios.post(`/api/admin/manage/fund-requests/${id}/${action}`, {}, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      fetchRequests();
    } catch (error) {
      alert(error.response?.data?.message || 'Error');
    }
  };

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Fund Requests</h1>
          <p className="text-gray-400 text-sm mt-1">Manage deposit and withdrawal requests from all users</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Pending</div>
          <div className="text-2xl font-bold text-yellow-400">{stats.pending}</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Approved</div>
          <div className="text-2xl font-bold text-green-400">{stats.approved}</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Rejected</div>
          <div className="text-2xl font-bold text-red-400">{stats.rejected}</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Total Deposits</div>
          <div className="text-xl font-bold text-green-400">{formatCoins(stats.totalDeposits || 0)}</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Total Withdrawals</div>
          <div className="text-xl font-bold text-red-400">{formatCoins(stats.totalWithdrawals || 0)}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex gap-2">
          {['PENDING', 'APPROVED', 'REJECTED', 'ALL'].map(status => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-4 py-2 rounded text-sm ${filter === status ? 'bg-purple-600' : 'bg-dark-700 hover:bg-dark-600'}`}
            >
              {status}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {['ALL', 'DEPOSIT', 'WITHDRAWAL'].map(type => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={`px-4 py-2 rounded text-sm ${typeFilter === type ? 'bg-blue-600' : 'bg-dark-700 hover:bg-dark-600'}`}
            >
              {type === 'ALL' ? 'All Types' : type}
            </button>
          ))}
        </div>
      </div>

      {/* Requests List */}
      {loading ? (
        <div className="text-center py-8"><RefreshCw className="animate-spin inline" /></div>
      ) : requests.length === 0 ? (
        <div className="text-center py-8 text-gray-400">No {filter.toLowerCase()} requests found</div>
      ) : (
        <div className="bg-dark-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-dark-700">
              <tr>
                <th className="text-left px-4 py-3 text-gray-400">User</th>
                <th className="text-left px-4 py-3 text-gray-400">Admin</th>
                <th className="text-left px-4 py-3 text-gray-400">Type</th>
                <th className="text-right px-4 py-3 text-gray-400">Amount</th>
                <th className="text-left px-4 py-3 text-gray-400">Reference</th>
                <th className="text-left px-4 py-3 text-gray-400">Date</th>
                <th className="text-center px-4 py-3 text-gray-400">Status</th>
                <th className="text-center px-4 py-3 text-gray-400">Action</th>
              </tr>
            </thead>
            <tbody>
              {requests.map(req => (
                <tr key={req._id} className="border-t border-dark-600 hover:bg-dark-700/50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{req.user?.fullName || req.user?.username}</div>
                    <div className="text-xs text-gray-500">{req.user?.userId}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm">{req.admin?.username || 'Super Admin'}</div>
                    <div className="text-xs text-gray-500">{req.admin?.adminCode || '-'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${req.type === 'DEPOSIT' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                      {req.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold">
                    {formatCoins(req.amount || 0)}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {req.referenceId || '-'}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {new Date(req.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      req.status === 'PENDING' ? 'bg-yellow-500/20 text-yellow-400' :
                      req.status === 'APPROVED' ? 'bg-green-500/20 text-green-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>
                      {req.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {req.status === 'PENDING' && (
                      <div className="flex gap-1 justify-center">
                        <button
                          onClick={() => handleAction(req._id, 'approve')}
                          className="px-2 py-1 bg-green-600 hover:bg-green-700 rounded text-xs"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleAction(req._id, 'reject')}
                          className="px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-xs"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default SuperAdminFundRequests;
