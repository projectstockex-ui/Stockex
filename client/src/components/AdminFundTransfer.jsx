import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import axios from '../config/axios';
import { ArrowRightLeft, Search, Wallet, CheckCircle, XCircle } from 'lucide-react';

const AdminFundTransfer = () => {
  const { admin } = useAuth();
  const [admins, setAdmins] = useState([]);
  const [selectedAdmin, setSelectedAdmin] = useState(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [transferring, setTransferring] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [currentWallet, setCurrentWallet] = useState(null);

  useEffect(() => {
    fetchAdmins();
    fetchCurrentWallet();
  }, []);

  const fetchAdmins = async () => {
    try {
      const { data } = await axios.get('/api/admin/admins-list', {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setAdmins(data.admins || []);
    } catch (error) {
      console.error('Error fetching admins:', error);
      setError('Failed to fetch admins list');
    } finally {
      setLoading(false);
    }
  };

  const fetchCurrentWallet = async () => {
    try {
      const { data } = await axios.get('/api/admin/me', {
        headers: { Authorization: `Bearer ${admin.token}` }
      });
      setCurrentWallet(data.wallet);
    } catch (error) {
      console.error('Error fetching wallet:', error);
    }
  };

  const filteredAdmins = admins.filter(adminItem =>
    adminItem.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    adminItem.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    adminItem.adminCode?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleTransfer = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!selectedAdmin) {
      setError('Please select an admin to transfer funds to');
      return;
    }

    if (!amount || Number(amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (Number(amount) > currentWallet?.balance) {
      setError('Insufficient balance');
      return;
    }

    setTransferring(true);

    try {
      const { data } = await axios.post('/api/admin/transfer-to-admin', 
        {
          targetAdminId: selectedAdmin._id,
          amount: Number(amount),
          description: description || 'Fund transfer'
        },
        { headers: { Authorization: `Bearer ${admin.token}` } }
      );

      setSuccess('Transfer successful!');
      setAmount('');
      setDescription('');
      setSelectedAdmin(null);
      fetchCurrentWallet();
      fetchAdmins(); // Refresh to show updated balances
    } catch (error) {
      console.error('Error transferring funds:', error);
      setError(error.response?.data?.message || 'Transfer failed');
    } finally {
      setTransferring(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-2">Fund Transfer to Other Admin</h1>
        <p className="text-gray-400">Transfer funds to other admins in your hierarchy</p>
      </div>

      {/* Current Wallet Balance */}
      {currentWallet && (
        <div className="bg-gradient-to-r from-purple-900/30 to-dark-800 rounded-xl p-6 mb-6 border border-purple-600/30">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-purple-600 rounded-lg flex items-center justify-center">
              <Wallet size={24} className="text-white" />
            </div>
            <div>
              <div className="text-sm text-gray-400">Your Wallet Balance</div>
              <div className="text-2xl font-bold text-green-400">{currentWallet.balance.toLocaleString()}</div>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Form */}
      <div className="bg-dark-800 rounded-xl p-6 border border-dark-600 mb-6">
        <form onSubmit={handleTransfer}>
          {/* Search Admin */}
          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-2">Search Admin</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Search by name, username, or admin code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-dark-700 border border-dark-600 rounded-lg pl-10 pr-4 py-3 text-white focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>

          {/* Admin List */}
          <div className="mb-4 max-h-48 overflow-y-auto">
            <label className="block text-sm text-gray-400 mb-2">Select Admin</label>
            <div className="space-y-2">
              {filteredAdmins.length === 0 ? (
                <div className="text-gray-500 text-sm">No admins found</div>
              ) : (
                filteredAdmins.map((adminItem) => (
                  <div
                    key={adminItem._id}
                    onClick={() => setSelectedAdmin(adminItem)}
                    className={`p-3 rounded-lg cursor-pointer border transition ${
                      selectedAdmin?._id === adminItem._id
                        ? 'bg-purple-600/20 border-purple-500'
                        : 'bg-dark-700 border-dark-600 hover:border-purple-500/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-white font-medium">{adminItem.name || adminItem.username}</div>
                        <div className="text-xs text-gray-400">
                          {adminItem.adminCode} • {adminItem.role}
                        </div>
                      </div>
                      <div className="text-green-400 font-medium">
                        {adminItem.wallet?.balance?.toLocaleString() || 0}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Amount */}
          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-2">Amount</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount"
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-purple-500"
              min="0"
              step="0.01"
            />
          </div>

          {/* Description */}
          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-2">Description (Optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter description for this transfer"
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-purple-500 resize-none"
              rows="3"
            />
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400">
              <XCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg flex items-center gap-2 text-green-400">
              <CheckCircle size={18} />
              <span>{success}</span>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={transferring || !selectedAdmin || !amount}
            className="w-full bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white py-3 rounded-lg font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {transferring ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Transferring...
              </>
            ) : (
              <>
                <ArrowRightLeft size={20} />
                Transfer Funds
              </>
            )}
          </button>
        </form>
      </div>

      {/* Info */}
      <div className="bg-dark-800/50 rounded-xl p-4 border border-dark-600/50">
        <h3 className="text-md font-bold mb-2 text-white">Important Notes</h3>
        <ul className="text-sm text-gray-400 space-y-1 list-disc list-inside">
          <li>You can transfer funds to other admins in your hierarchy</li>
          <li>Both sender and receiver will have a record of the transaction</li>
          <li>Transfer is irreversible once completed</li>
          <li>Make sure to verify the recipient before transferring</li>
        </ul>
      </div>
    </div>
  );
};

export default AdminFundTransfer;
