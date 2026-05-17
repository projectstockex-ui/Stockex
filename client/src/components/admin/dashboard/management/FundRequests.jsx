import React, { useState, useEffect } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import axios from '../../../../config/axios';
import { useAuth } from '../../../../context/AuthContext';
import { usePagination } from '../utils/hooks';
import Pagination from '../ui/Pagination';

const FundRequests = () => {
  const { admin } = useAuth();

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('PENDING');
  const [searchTerm, setSearchTerm] = useState('');

  const { currentPage, setCurrentPage, totalPages, paginatedData: paginatedRequests, totalItems } = usePagination(
    requests, 20, searchTerm, ['user.username', 'user.fullName', 'userId', 'referenceId', 'amount']
  );

  useEffect(() => {
    fetchRequests();
  }, [filter]);

  const fetchRequests = async () => {
    try {
      const { data } = await axios.get(`/api/admin/manage/fund-requests?status=${filter}`, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setRequests(data);
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
      <h1 className="text-2xl font-bold mb-6">Fund Requests</h1>

      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex gap-2">
          {['PENDING', 'APPROVED', 'REJECTED'].map(status => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-4 py-2 rounded ${filter === status ? 'bg-purple-600' : 'bg-dark-700'}`}
            >
              {status}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Search by user, reference..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-dark-700 border border-dark-600 rounded-lg pl-10 pr-4 py-2"
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8"><RefreshCw className="animate-spin inline" /></div>
      ) : totalItems === 0 ? (
        <div className="text-center py-8 text-gray-400">No {filter.toLowerCase()} requests</div>
      ) : (
        <div className="space-y-4">
          {paginatedRequests.map(req => (
            <div key={req._id} className="bg-dark-800 rounded-lg p-4">
              <div className="flex flex-col md:flex-row justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${req.type === 'DEPOSIT' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                      {req.type}
                    </span>
                    <span className="font-bold">₹{req.amount.toLocaleString()}</span>
                  </div>
                  <div className="text-sm text-gray-400 mt-1">
                    User: {req.user?.fullName || req.user?.username} ({req.userId})
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {new Date(req.createdAt).toLocaleString()}
                  </div>
                  {req.referenceId && <div className="text-xs text-gray-500">Ref: {req.referenceId}</div>}
                  {req.paymentMethod && <div className="text-xs text-gray-500">Method: {req.paymentMethod}</div>}
                  {req.userRemarks && <div className="text-xs text-gray-400 mt-1">Remarks: {req.userRemarks}</div>}

                  {/* Withdrawal Details */}
                  {req.type === 'WITHDRAWAL' && req.withdrawalDetails && (
                    <div className="bg-dark-700 rounded p-2 mt-2 text-xs">
                      <div className="text-gray-400 font-medium mb-1">Withdrawal To:</div>
                      {req.withdrawalDetails.upiId && (
                        <div className="text-green-400">UPI: {req.withdrawalDetails.upiId}</div>
                      )}
                      {req.withdrawalDetails.bankName && (
                        <>
                          <div>Bank: {req.withdrawalDetails.bankName}</div>
                          <div>A/C: {req.withdrawalDetails.accountNumber}</div>
                          <div>IFSC: {req.withdrawalDetails.ifscCode}</div>
                          <div>Name: {req.withdrawalDetails.accountHolderName}</div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Payment Proof Image */}
                {req.proofUrl && (
                  <div className="flex-shrink-0">
                    <div className="text-xs text-gray-400 mb-1">Payment Proof:</div>
                    <img
                      src={`${import.meta.env.VITE_SOCKET_URL || ''}${req.proofUrl}`}
                      alt="Payment proof"
                      className="w-24 h-24 object-cover rounded-lg border border-dark-600 hover:border-purple-500 transition cursor-pointer"
                      onClick={() => window.open(`${import.meta.env.VITE_SOCKET_URL || ''}${req.proofUrl}`, '_blank')}
                    />
                  </div>
                )}

                {req.status === 'PENDING' && (
                  <div className="flex gap-2 items-start">
                    <button onClick={() => handleAction(req._id, 'approve')} className="px-4 py-2 bg-green-600 rounded text-sm">Approve</button>
                    <button onClick={() => handleAction(req._id, 'reject')} className="px-4 py-2 bg-red-600 rounded text-sm">Reject</button>
                  </div>
                )}
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
    </div>
  );
};

export default FundRequests;
