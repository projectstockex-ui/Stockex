/**
 * AdminDetailModal component for AdminDashboard
 */
import { useState, useEffect } from 'react';
import { X, RefreshCw } from 'lucide-react';
import axios from '../../../../config/axios';

const AdminDetailModal = ({ admin: targetAdmin, token, onClose }) => {
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [usersRes, ledgerRes] = await Promise.all([
        axios.get(`/api/admin/manage/admins/${targetAdmin._id}/users`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`/api/admin/manage/admins/${targetAdmin._id}/ledger`, { headers: { Authorization: `Bearer ${token}` } })
      ]);
      setUsers(usersRes.data.users || []);
      setLedger(ledgerRes.data || []);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-start p-6 border-b border-dark-600">
          <div>
            <h2 className="text-xl font-bold">{targetAdmin.name || targetAdmin.username}</h2>
            <div className="text-sm text-gray-400">{targetAdmin.email}</div>
            <div className="flex items-center gap-3 mt-2">
              <span className="font-mono bg-purple-500/20 text-purple-400 px-2 py-1 rounded text-sm">{targetAdmin.adminCode}</span>
              <span className={`px-2 py-1 rounded text-xs ${targetAdmin.status === 'ACTIVE' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                {targetAdmin.status}
              </span>
            </div>
          </div>
          <button onClick={onClose}><X size={24} /></button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 p-4 border-b border-dark-600">
          <div className="text-center">
            <div className="text-xs text-gray-400">Wallet Balance</div>
            <div className="text-lg font-bold text-green-400">{(targetAdmin.wallet?.balance || 0).toLocaleString()}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-400">Total Users</div>
            <div className="text-lg font-bold">{users.length}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-400">Brokerage</div>
            <div className="text-lg font-bold">{targetAdmin.charges?.brokerage || 20}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-400">Leverage</div>
            <div className="text-lg font-bold">{targetAdmin.charges?.intradayLeverage || 5}x</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-dark-600">
          <button onClick={() => setActiveTab('users')} className={`flex-1 py-3 ${activeTab === 'users' ? 'bg-purple-600' : 'bg-dark-700'}`}>
            Users ({users.length})
          </button>
          <button onClick={() => setActiveTab('ledger')} className={`flex-1 py-3 ${activeTab === 'ledger' ? 'bg-purple-600' : 'bg-dark-700'}`}>
            Ledger ({ledger.length})
          </button>
          <button onClick={() => setActiveTab('charges')} className={`flex-1 py-3 ${activeTab === 'charges' ? 'bg-purple-600' : 'bg-dark-700'}`}>
            Charges
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center py-8"><RefreshCw className="animate-spin inline" /></div>
          ) : activeTab === 'users' ? (
            users.length === 0 ? (
              <div className="text-center py-8 text-gray-400">No users under this admin</div>
            ) : (
              <div className="space-y-2">
                {users.map(user => (
                  <div key={user._id} className="flex items-center justify-between bg-dark-700 rounded p-3">
                    <div>
                      <div className="font-medium">{user.fullName || user.username}</div>
                      <div className="text-xs text-gray-400">{user.email} • {user.userId}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-green-400 font-bold">{(user.wallet?.cashBalance || 0).toLocaleString()}</div>
                      <div className="text-xs text-blue-400">Trading: {(user.wallet?.tradingBalance || 0).toLocaleString()}</div>
                      <div className={`text-xs ${user.isActive ? 'text-green-400' : 'text-red-400'}`}>
                        {user.isActive ? 'Active' : 'Inactive'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : activeTab === 'ledger' ? (
            ledger.length === 0 ? (
              <div className="text-center py-8 text-gray-400">No transactions</div>
            ) : (
              <div className="space-y-2">
                {ledger.map(entry => (
                  <div key={entry._id} className="flex items-center justify-between bg-dark-700 rounded p-3">
                    <div>
                      <div className="text-sm">{entry.reason}</div>
                      <div className="text-xs text-gray-400">{new Date(entry.createdAt).toLocaleString()}</div>
                    </div>
                    <div className="text-right">
                      <div className={entry.type === 'CREDIT' ? 'text-green-400' : 'text-red-400'}>
                        {entry.type === 'CREDIT' ? '+' : '-'}{entry.amount?.toLocaleString()}
                      </div>
                      <div className="text-xs text-gray-400">Bal: {entry.balanceAfter?.toLocaleString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-dark-700 rounded p-3">
                <div className="text-xs text-gray-400">Brokerage</div>
                <div className="text-lg font-bold">{targetAdmin.charges?.brokerage || 20}</div>
              </div>
              <div className="bg-dark-700 rounded p-3">
                <div className="text-xs text-gray-400">Intraday Leverage</div>
                <div className="text-lg font-bold">{targetAdmin.charges?.intradayLeverage || 5}x</div>
              </div>
              <div className="bg-dark-700 rounded p-3">
                <div className="text-xs text-gray-400">Delivery Leverage</div>
                <div className="text-lg font-bold">{targetAdmin.charges?.deliveryLeverage || 1}x</div>
              </div>
              <div className="bg-dark-700 rounded p-3">
                <div className="text-xs text-gray-400">Option Buy Leverage</div>
                <div className="text-lg font-bold">{targetAdmin.charges?.optionBuyLeverage || 1}x</div>
              </div>
              <div className="bg-dark-700 rounded p-3">
                <div className="text-xs text-gray-400">Withdrawal Fee</div>
                <div className="text-lg font-bold">{targetAdmin.charges?.withdrawalFee || 0}</div>
              </div>
              <div className="bg-dark-700 rounded p-3">
                <div className="text-xs text-gray-400">Profit Share</div>
                <div className="text-lg font-bold">{targetAdmin.charges?.profitShare || 0}%</div>
              </div>
              <div className="bg-dark-700 rounded p-3">
                <div className="text-xs text-gray-400">Min Withdrawal</div>
                <div className="text-lg font-bold">{targetAdmin.charges?.minWithdrawal || 100}</div>
              </div>
              <div className="bg-dark-700 rounded p-3">
                <div className="text-xs text-gray-400">Max Withdrawal</div>
                <div className="text-lg font-bold">{targetAdmin.charges?.maxWithdrawal || 100000}</div>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-dark-600">
          <button onClick={onClose} className="w-full bg-dark-600 hover:bg-dark-500 py-2 rounded">Close</button>
        </div>
      </div>
    </div>
  );
};

export default AdminDetailModal;
