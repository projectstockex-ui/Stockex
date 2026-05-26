import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Eye, EyeOff, Users, TrendingUp, Wallet, Lock, Building2 } from 'lucide-react';
import { StockExLogo } from '../../components/StockExLogo';
import axios from 'axios';

const SubBrokerLogin = () => {
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [parentAdminInfo, setParentAdminInfo] = useState(null);
  const [currentRole, setCurrentRole] = useState(null);
  const [fetchingParent, setFetchingParent] = useState(false);
  const { loginAdmin } = useAuth();
  const navigate = useNavigate();
  
  // Fetch parent admin info when email changes
  const fetchParentAdminInfo = useCallback(async (email) => {
    if (!email) {
      setParentAdminInfo(null);
      setCurrentRole(null);
      return;
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setParentAdminInfo(null);
      setCurrentRole(null);
      return;
    }
    
    setFetchingParent(true);
    try {
      const { data } = await axios.post('/api/admin/parent-info', { email });
      setParentAdminInfo(data.parentAdmin);
      setCurrentRole(data.currentRole);
    } catch (err) {
      setParentAdminInfo(null);
      setCurrentRole(null);
    } finally {
      setFetchingParent(false);
    }
  }, []);
  
  // Debounce email input
  useEffect(() => {
    const timer = setTimeout(() => {
      if (formData.email) {
        fetchParentAdminInfo(formData.email);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [formData.email, fetchParentAdminInfo]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await loginAdmin(formData.email, formData.password);
      // Redirect based on role
      if (result.role === 'SUPER_ADMIN') {
        navigate('/superadmin/dashboard');
      } else if (result.role === 'ADMIN') {
        navigate('/admin/dashboard');
      } else if (result.role === 'BROKER') {
        navigate('/broker/dashboard');
      } else if (result.role === 'SUB_BROKER') {
        navigate('/subbroker/dashboard');
      } else {
        navigate('/subbroker/dashboard');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-pink-900 to-slate-900 flex">
      {/* Left Side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-center items-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-pink-600/20 to-rose-600/20" />
        <div className="absolute top-20 left-20 w-72 h-72 bg-pink-500/30 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-20 w-96 h-96 bg-rose-500/20 rounded-full blur-3xl" />
        
        <div className="relative z-10 text-center">
          <div className="flex items-center justify-center mb-8">
            <StockExLogo className="h-16 w-auto max-w-[200px] object-contain" alt="StockEx" />
          </div>
          <h1 className="text-4xl font-bold text-white mb-4">Sub-Broker Portal</h1>
          <p className="text-xl text-gray-300 mb-12">Manage your client accounts</p>
          
          <div className="grid grid-cols-2 gap-6 max-w-md">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 text-left">
              <Users className="w-8 h-8 text-pink-400 mb-3" />
              <h3 className="font-semibold text-white mb-1">Client Management</h3>
              <p className="text-sm text-gray-400">Manage your clients</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 text-left">
              <TrendingUp className="w-8 h-8 text-rose-400 mb-3" />
              <h3 className="font-semibold text-white mb-1">Trading Monitor</h3>
              <p className="text-sm text-gray-400">Track client trades</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 text-left">
              <Wallet className="w-8 h-8 text-green-400 mb-3" />
              <h3 className="font-semibold text-white mb-1">Fund Requests</h3>
              <p className="text-sm text-gray-400">Process fund requests</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 text-left">
              <Lock className="w-8 h-8 text-yellow-400 mb-3" />
              <h3 className="font-semibold text-white mb-1">Secure Access</h3>
              <p className="text-sm text-gray-400">Protected panel</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="text-center mb-8 lg:hidden">
            <div className="flex flex-col items-center gap-3 mb-4">
              <StockExLogo className="h-12 w-auto max-w-[160px] object-contain" alt="StockEx" />
              <span className="text-2xl font-bold text-white">Sub-Broker Panel</span>
            </div>
          </div>

          <div className="bg-dark-800/80 backdrop-blur-xl p-8 rounded-2xl border border-pink-500/20 shadow-2xl">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-white">Sub-Broker Login</h2>
              <p className="text-gray-400 mt-2">Access your sub-broker dashboard</p>
            </div>

            {error && (
              <div className="bg-red-500/20 border border-red-500 text-red-400 px-4 py-3 rounded-lg mb-6">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label className="block text-sm text-gray-400 mb-2">Email Address</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full bg-dark-700 border border-pink-500/30 rounded-lg px-4 py-3 focus:outline-none focus:border-pink-500 transition"
                  placeholder="subbroker@example.com"
                  required
                />
              </div>

              {/* Show parent admin info on login form */}
              {parentAdminInfo && (
                <div className="mb-4 p-3 bg-gradient-to-r from-pink-500/10 to-rose-500/10 border border-pink-500/30 rounded-xl">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-pink-400" />
                    <div className="flex-1">
                      <div className="text-xs text-gray-400">
                        {currentRole === 'SUB_BROKER' ? 'Sub-Broker Under' : 
                         currentRole === 'BROKER' ? 'Broker Under' : 'Under'}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium">{parentAdminInfo.name}</span>
                        <span className="text-xs px-2 py-0.5 bg-pink-500/20 text-pink-400 rounded">
                          {parentAdminInfo.role === 'ADMIN' ? 'Admin' : 
                           parentAdminInfo.role === 'BROKER' ? 'Broker' : 
                           parentAdminInfo.role === 'SUPER_ADMIN' ? 'Super Admin' : parentAdminInfo.role}
                        </span>
                      </div>
                      <div className="text-sm text-pink-400 font-mono mt-1">{parentAdminInfo.adminCode}</div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Show loading indicator */}
              {fetchingParent && formData.email && (
                <div className="mb-4 p-3 bg-dark-700 border border-dark-600 rounded-xl animate-pulse">
                  <div className="flex items-center gap-2 text-gray-400 text-sm">
                    <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                    <span>Fetching account info...</span>
                  </div>
                </div>
              )}

              <div className="mb-6">
                <label className="block text-sm text-gray-400 mb-2">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full bg-dark-700 border border-pink-500/30 rounded-lg px-4 py-3 pr-12 focus:outline-none focus:border-pink-500 transition"
                    placeholder="Enter password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-700 hover:to-rose-600 py-3 rounded-lg font-semibold transition disabled:opacity-50 shadow-lg shadow-pink-500/25"
              >
                {loading ? 'Please wait...' : 'Sign In'}
              </button>
            </form>

            <div className="mt-6 pt-6 border-t border-gray-700 text-center space-y-2">
              <Link to="/broker/login" className="block text-sm text-gray-400 hover:text-white transition">
                Broker Login →
              </Link>
              <Link to="/login" className="block text-sm text-gray-400 hover:text-white transition">
                User Login →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubBrokerLogin;
