import { useState, useEffect } from 'react';
import { useAuth } from '../../../context/AuthContext';
import axios from 'axios';
import { RefreshCw, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import { formatCoins } from '../../../utils/stockexCoins.js';

const SubordinateFundRequests = () => {
  const { admin } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('PENDING');
  const [processing, setProcessing] = useState(null);
  
  const isAdmin = admin?.role === 'ADMIN';
  const isBroker = admin?.role === 'BROKER';
  
  const getTitle = () => {
    if (isAdmin) return 'Broker/SubBroker Fund Requests';
    if (isBroker) return 'SubBroker Fund Requests';
    return 'Subordinate Fund Requests';
  };
  
  const getRoleBadgeColor = (role) => {
    switch(role) {
      case 'ADMIN': return 'bg-purple-500/20 text-purple-400';
      case 'BROKER': return 'bg-blue-500/20 text-blue-400';
      case 'SUB_BROKER': return 'bg-green-500/20 text-green-400';
      default: return 'bg-gray-500/20 text-gray-400';
    }
  };
  
  const getRoleLabel = (role) => {
    switch(role) {
      case 'ADMIN': return 'Admin';
      case 'BROKER': return 'Broker';
      case 'SUB_BROKER': return 'SubBroker';
      default: return role;
    }
  };

  useEffect(() => {
    fetchRequests();
  }, [filter]);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`/api/admin/manage/admin-fund-requests?status=${filter}`, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setRequests(data);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (requestId, status, remarks = '') => {
    setProcessing(requestId);
    try {
      await axios.put(`/api/admin/manage/admin-fund-requests/${requestId}`, {
        status,
        remarks
      }, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      fetchRequests();
      window.location.reload();
    } catch (error) {
      alert(error.response?.data?.message || 'Error processing request');
    } finally {
      setProcessing(null);
    }
  };

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{getTitle()}</h1>
        <div className="text-sm text-gray-400">
          Your Wallet: <span className="text-green-400 font-bold">{formatCoins(admin?.wallet?.balance || 0)}</span>
        </div>
      </div>
      
      <div className="bg-blue-500/20 text-blue-300 p-3 rounded-lg mb-6 text-sm">
        💡 When you approve a request, funds will be deducted from your wallet and credited to the requestor's wallet.
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-6">
        {['PENDING', 'APPROVED', 'REJECTED'].map(status => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 rounded-lg ${filter === status ? 
              status === 'PENDING' ? 'bg-yellow-600' :
              status === 'APPROVED' ? 'bg-green-600' : 'bg-red-600'
              : 'bg-dark-700'}`}
          >
            {status}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-8"><RefreshCw className="animate-spin inline" /></div>
      ) : requests.length === 0 ? (
        <div className="text-center py-8 text-gray-400">No {filter.toLowerCase()} requests from your subordinates</div>
      ) : (
        <div className="space-y-4">
          {requests.map(req => (
            <div key={req._id} className="bg-dark-800 rounded-lg p-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-lg">{req.admin?.name || req.admin?.username}</span>
                    <span className={`px-2 py-0.5 rounded text-xs ${getRoleBadgeColor(req.requestorRole)}`}>
                      {getRoleLabel(req.requestorRole)}
                    </span>
                    <span className="font-mono bg-gray-500/20 text-gray-400 px-2 py-0.5 rounded text-sm">{req.adminCode}</span>
                  </div>
                  <div className="text-sm text-gray-400 mt-1">{req.admin?.email}</div>
                  <div className="text-sm text-gray-500 mt-1">
                    Their Current Balance: {formatCoins(req.admin?.wallet?.balance || 0)}
                  </div>
                  {req.reason && <div className="text-sm mt-2 text-gray-300">Reason: {req.reason}</div>}
                  <div className="text-xs text-gray-500 mt-1">{new Date(req.createdAt).toLocaleString()}</div>
                </div>
                <div className="text-center">
                  <div className="text-sm text-gray-400">Requested Amount</div>
                  <div className="text-2xl font-bold text-green-400">{formatCoins(req.amount)}</div>
                  {filter === 'PENDING' && admin?.wallet?.balance < req.amount && (
                    <div className="text-xs text-red-400 mt-1">Insufficient balance</div>
                  )}
                </div>
                {filter === 'PENDING' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAction(req._id, 'APPROVED')}
                      disabled={processing === req._id || admin?.wallet?.balance < req.amount}
                      className={`px-4 py-2 rounded flex items-center gap-1 ${
                        admin?.wallet?.balance < req.amount 
                          ? 'bg-gray-600 cursor-not-allowed' 
                          : 'bg-green-600 hover:bg-green-700'
                      }`}
                    >
                      <ArrowUpCircle size={18} /> Approve
                    </button>
                    <button
                      onClick={() => handleAction(req._id, 'REJECTED')}
                      disabled={processing === req._id}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded flex items-center gap-1"
                    >
                      <ArrowDownCircle size={18} /> Reject
                    </button>
                  </div>
                )}
                {filter !== 'PENDING' && (
                  <span className={`px-4 py-2 rounded ${
                    req.status === 'APPROVED' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                  }`}>
                    {req.status}
                  </span>
                )}
              </div>
              {req.adminRemarks && (
                <div className="mt-3 pt-3 border-t border-dark-600 text-sm text-gray-400">
                  Remarks: {req.adminRemarks}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SubordinateFundRequests;
