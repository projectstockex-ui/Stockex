import { useState, useEffect } from 'react';
import { useAuth } from '../../../context/AuthContext';
import axios from 'axios';
import { RefreshCw, Plus, X, FileText, ArrowRightLeft } from 'lucide-react';

const AdminWallet = () => {
  const { admin, updateAdmin } = useAuth();
  const [walletData, setWalletData] = useState(null);
  const [fundRequests, setFundRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestAmount, setRequestAmount] = useState('');
  const [requestReason, setRequestReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferTargets, setTransferTargets] = useState([]);
  const [transferData, setTransferData] = useState({ targetAdminId: '', amount: '', remarks: '' });

  useEffect(() => {
    fetchWalletData();
    fetchFundRequests();
  }, []);

  const fetchWalletData = async () => {
    try {
      const { data } = await axios.get('/api/admin/manage/my-wallet', {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setWalletData(data);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchFundRequests = async () => {
    try {
      const { data } = await axios.get('/api/admin/manage/my-fund-requests', {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setFundRequests(data);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const handleRequestFund = async (e) => {
    e.preventDefault();
    if (!requestAmount || Number(requestAmount) <= 0) {
      setMessage({ type: 'error', text: 'Enter valid amount' });
      return;
    }
    setSubmitting(true);
    setMessage({ type: '', text: '' });
    try {
      await axios.post('/api/admin/manage/fund-request', {
        amount: Number(requestAmount),
        reason: requestReason
      }, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setMessage({ type: 'success', text: 'Fund request submitted successfully' });
      setRequestAmount('');
      setRequestReason('');
      setShowRequestModal(false);
      fetchFundRequests();
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || 'Error submitting request' });
    } finally {
      setSubmitting(false);
    }
  };

  const downloadLedger = async () => {
    try {
      const response = await axios.get('/api/admin/manage/my-ledger/download', {
        headers: { Authorization: `Bearer ${admin.token}` },
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `admin-ledger-${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      alert('Error downloading ledger');
    }
  };

  const downloadUserTransactions = async () => {
    try {
      const response = await axios.get('/api/admin/manage/user-transactions/download', {
        headers: { Authorization: `Bearer ${admin.token}` },
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `user-transactions-${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      alert('Error downloading transactions');
    }
  };

  const fetchTransferTargets = async () => {
    try {
      const { data } = await axios.get('/api/admin/manage/transfer-targets', {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setTransferTargets(data);
    } catch (error) {
      console.error('Error fetching transfer targets:', error);
    }
  };

  const handleTransfer = async (e) => {
    e.preventDefault();
    if (!transferData.targetAdminId || !transferData.amount || Number(transferData.amount) <= 0) {
      setMessage({ type: 'error', text: 'Select admin and enter valid amount' });
      return;
    }
    if (Number(transferData.amount) > (walletData?.wallet?.balance || 0)) {
      setMessage({ type: 'error', text: 'Insufficient balance' });
      return;
    }
    setSubmitting(true);
    setMessage({ type: '', text: '' });
    try {
      const { data } = await axios.post('/api/admin/manage/admin-transfer', {
        targetAdminId: transferData.targetAdminId,
        amount: Number(transferData.amount),
        remarks: transferData.remarks
      }, {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setMessage({ type: 'success', text: data.message });
      setTransferData({ targetAdminId: '', amount: '', remarks: '' });
      setShowTransferModal(false);
      fetchWalletData();
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || 'Transfer failed' });
    } finally {
      setSubmitting(false);
    }
  };

  const openTransferModal = () => {
    fetchTransferTargets();
    setShowTransferModal(true);
  };

  if (loading) {
    return <div className="p-6 text-center"><RefreshCw className="animate-spin inline" size={24} /></div>;
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold">My Wallet</h1>
        <div className="flex gap-2">
          {admin?.role === 'ADMIN' && (
            <button
              onClick={openTransferModal}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg"
            >
              <ArrowRightLeft size={20} />
              Transfer to Admin
            </button>
          )}
          <button
            onClick={() => setShowRequestModal(true)}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg"
          >
            <Plus size={20} />
            Request Funds
          </button>
        </div>
      </div>

      {message.text && (
        <div className={`mb-4 p-3 rounded ${message.type === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
          {message.text}
        </div>
      )}

      {/* Wallet Balance Card */}
      <div className="bg-gradient-to-r from-green-600 to-emerald-600 rounded-xl p-6 mb-6">
        <div className="text-white/80 text-sm mb-1">Available Balance</div>
        <div className="text-4xl font-bold text-white mb-4">₹{(walletData?.wallet?.balance || 0).toLocaleString()}</div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-white/60">Total Deposited</div>
            <div className="text-white font-semibold">₹{(walletData?.wallet?.totalDeposited || 0).toLocaleString()}</div>
          </div>
          <div>
            <div className="text-white/60">Total Withdrawn</div>
            <div className="text-white font-semibold">₹{(walletData?.wallet?.totalWithdrawn || 0).toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* User Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Total Users</div>
          <div className="text-2xl font-bold text-purple-400">{walletData?.summary?.totalUsers || 0}</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">User Deposits</div>
          <div className="text-2xl font-bold text-green-400">₹{(walletData?.summary?.totalUserDeposits || 0).toLocaleString()}</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">User Withdrawals</div>
          <div className="text-2xl font-bold text-red-400">₹{(walletData?.summary?.totalUserWithdrawals || 0).toLocaleString()}</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Distributed to Users</div>
          <div className="text-2xl font-bold text-blue-400">₹{(walletData?.summary?.distributedToUsers || 0).toLocaleString()}</div>
        </div>
      </div>

      {/* P&L Summary */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Total User Profits</div>
          <div className="text-2xl font-bold text-green-400">₹{(walletData?.summary?.totalUserProfits || 0).toLocaleString()}</div>
        </div>
        <div className="bg-dark-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Total User Losses</div>
          <div className="text-2xl font-bold text-red-400">₹{(walletData?.summary?.totalUserLosses || 0).toLocaleString()}</div>
        </div>
      </div>

      {/* Download Buttons */}
      <div className="flex flex-wrap gap-3 mb-6">
        <button onClick={downloadLedger} className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg">
          <FileText size={18} /> Download My Ledger
        </button>
        <button onClick={downloadUserTransactions} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg">
          <FileText size={18} /> Download User Transactions
        </button>
      </div>

      {/* Fund Requests History */}
      <div className="bg-dark-800 rounded-lg p-4 mb-6">
        <h2 className="text-lg font-semibold mb-4">My Fund Requests</h2>
        {fundRequests.length === 0 ? (
          <div className="text-center py-4 text-gray-400">No fund requests yet</div>
        ) : (
          <div className="space-y-2">
            {fundRequests.map(req => (
              <div key={req._id} className="flex items-center justify-between bg-dark-700 rounded p-3">
                <div>
                  <div className="font-medium">₹{req.amount.toLocaleString()}</div>
                  <div className="text-xs text-gray-400">{req.reason || 'No reason'}</div>
                  <div className="text-xs text-gray-500">{new Date(req.createdAt).toLocaleString()}</div>
                </div>
                <span className={`px-3 py-1 rounded text-sm ${
                  req.status === 'APPROVED' ? 'bg-green-500/20 text-green-400' :
                  req.status === 'REJECTED' ? 'bg-red-500/20 text-red-400' :
                  'bg-yellow-500/20 text-yellow-400'
                }`}>
                  {req.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Ledger */}
      <div className="bg-dark-800 rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-4">Recent Transactions</h2>
        {!walletData?.ledger?.length ? (
          <div className="text-center py-4 text-gray-400">No transactions yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-dark-700">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">Date</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">Type</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">Description</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">Segment</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-300">User</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-300">Amount</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-300">Balance</th>
                </tr>
              </thead>
              <tbody>
                {walletData.ledger.slice(0, 10).map(entry => (
                  <tr key={entry._id} className="border-t border-dark-600 hover:bg-dark-700/50">
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded ${
                        entry.type === 'CREDIT' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                      }`}>
                        {entry.type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium">{entry.reason}</div>
                      <div className="text-xs text-gray-400">{entry.description}</div>
                    </td>
                    <td className="px-4 py-3">
                      {entry.meta?.segment ? (
                        <span className={`text-xs px-2 py-1 rounded ${
                          entry.meta.segment === 'MCX' ? 'bg-orange-500/20 text-orange-400' :
                          entry.meta.segment === 'CRYPTO' ? 'bg-purple-500/20 text-purple-400' :
                          entry.meta.segment === 'FOREX' ? 'bg-cyan-500/20 text-cyan-400' :
                          entry.meta.segment === 'NSE' ? 'bg-blue-500/20 text-blue-400' :
                          entry.meta.segment === 'BSE' ? 'bg-green-500/20 text-green-400' :
                          'bg-gray-500/20 text-gray-400'
                        }`}>
                          {entry.meta.segment}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {entry.reason === 'BROKERAGE' && entry.userName ? (
                        <span className="text-xs text-blue-400">{entry.userName}</span>
                      ) : (
                        <span className="text-xs text-gray-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className={entry.type === 'CREDIT' ? 'text-green-400' : 'text-red-400'}>
                        {entry.type === 'CREDIT' ? '+' : '-'}₹{entry.amount.toLocaleString()}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-gray-400">
                      ₹{entry.balanceAfter.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Request Fund Modal */}
      {showRequestModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 rounded-lg w-full max-w-md p-6">
            <div className="flex justify-between mb-4">
              <h2 className="text-xl font-bold">Request Funds</h2>
              <button onClick={() => setShowRequestModal(false)}><X size={24} /></button>
            </div>
            <p className="text-gray-400 text-sm mb-4">
              Request funds from your {admin?.role === 'ADMIN' ? 'Super Admin' : admin?.role === 'BROKER' ? 'Admin' : admin?.role === 'SUB_BROKER' ? 'Broker' : 'Superior'}. 
              Your current balance is ₹{(walletData?.wallet?.balance || 0).toLocaleString()}
            </p>
            <form onSubmit={handleRequestFund} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Amount (₹)</label>
                <input
                  type="number"
                  value={requestAmount}
                  onChange={e => setRequestAmount(e.target.value)}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
                  placeholder="Enter amount"
                  required
                  min="1"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Reason (optional)</label>
                <textarea
                  value={requestReason}
                  onChange={e => setRequestReason(e.target.value)}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
                  placeholder="Why do you need these funds?"
                  rows={3}
                />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowRequestModal(false)} className="flex-1 bg-dark-600 py-2 rounded">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="flex-1 bg-green-600 hover:bg-green-700 py-2 rounded">
                  {submitting ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Transfer Modal */}
      {showTransferModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 rounded-lg w-full max-w-md p-6">
            <div className="flex justify-between mb-4">
              <h2 className="text-xl font-bold">Transfer to Admin</h2>
              <button onClick={() => setShowTransferModal(false)}><X size={24} /></button>
            </div>
            <p className="text-gray-400 text-sm mb-4">
              Transfer funds from your wallet to another admin. Your balance: ₹{(walletData?.wallet?.balance || 0).toLocaleString()}
            </p>
            <form onSubmit={handleTransfer} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Select Admin</label>
                <select
                  value={transferData.targetAdminId}
                  onChange={e => setTransferData({...transferData, targetAdminId: e.target.value})}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
                  required
                >
                  <option value="">-- Select Admin --</option>
                  {transferTargets.map(t => (
                    <option key={t._id} value={t._id}>
                      {t.name || t.username} ({t.role}) - ₹{(t.wallet?.balance || 0).toLocaleString()}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Amount (₹)</label>
                <input
                  type="number"
                  value={transferData.amount}
                  onChange={e => setTransferData({...transferData, amount: e.target.value})}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
                  placeholder="Enter amount"
                  required
                  min="1"
                  max={walletData?.wallet?.balance || 0}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Remarks (optional)</label>
                <input
                  type="text"
                  value={transferData.remarks}
                  onChange={e => setTransferData({...transferData, remarks: e.target.value})}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
                  placeholder="e.g., Fund sharing"
                />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowTransferModal(false)} className="flex-1 bg-dark-600 py-2 rounded">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="flex-1 bg-blue-600 hover:bg-blue-700 py-2 rounded">
                  {submitting ? 'Transferring...' : 'Transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminWallet;
