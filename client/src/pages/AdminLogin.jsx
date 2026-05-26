import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Eye, EyeOff, Users, Settings, BarChart3, Lock, Building2 } from 'lucide-react';
import axios from 'axios';
import { StockExLogo } from '../components/StockExLogo';

const AdminLogin = () => {
  const [isSetup, setIsSetup] = useState(false);
  const [formData, setFormData] = useState({ username: '', email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [parentAdminInfo, setParentAdminInfo] = useState(null);
  const [hierarchyInfo, setHierarchyInfo] = useState([]);
  const [currentRole, setCurrentRole] = useState(null);
  const [fetchingParent, setFetchingParent] = useState(false);
  const { loginAdmin, setupAdmin } = useAuth();
  const navigate = useNavigate();
  
  // Fetch parent admin info when email changes
  const fetchParentAdminInfo = useCallback(async (email) => {
    if (!email || isSetup) {
      setParentAdminInfo(null);
      setHierarchyInfo([]);
      setCurrentRole(null);
      return;
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setParentAdminInfo(null);
      setHierarchyInfo([]);
      setCurrentRole(null);
      return;
    }
    
    setFetchingParent(true);
    try {
      const { data } = await axios.post('/api/admin/parent-info', { email });
      setParentAdminInfo(data.parentAdmin);
      setHierarchyInfo(data.hierarchy || []);
      setCurrentRole(data.currentRole);
    } catch (err) {
      setParentAdminInfo(null);
      setHierarchyInfo([]);
      setCurrentRole(null);
    } finally {
      setFetchingParent(false);
    }
  }, [isSetup]);
  
  // Debounce email input
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isSetup && formData.email) {
        fetchParentAdminInfo(formData.email);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [formData.email, isSetup, fetchParentAdminInfo]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isSetup) {
        await setupAdmin(formData.username, formData.email, formData.password);
      } else {
        await loginAdmin(formData.email, formData.password);
      }
      navigate('/admin/users');
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex">
      {/* Left Side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-center items-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-600/20 to-blue-600/20" />
        <div className="absolute top-20 left-20 w-72 h-72 bg-purple-500/30 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-20 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl" />
        
        <div className="relative z-10 text-center">
          <div className="flex items-center justify-center mb-8">
            <StockExLogo className="h-16 w-auto max-w-[200px] object-contain" alt="StockEx" />
          </div>
          <h1 className="text-4xl font-bold text-white mb-4">Admin Control Center</h1>
          <p className="text-xl text-gray-300 mb-12">Manage your trading platform with ease</p>
          
          <div className="grid grid-cols-2 gap-6 max-w-md">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 text-left">
              <Users className="w-8 h-8 text-purple-400 mb-3" />
              <h3 className="font-semibold text-white mb-1">User Management</h3>
              <p className="text-sm text-gray-400">Create, modify & manage all users</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 text-left">
              <BarChart3 className="w-8 h-8 text-blue-400 mb-3" />
              <h3 className="font-semibold text-white mb-1">Wallet Control</h3>
              <p className="text-sm text-gray-400">Deposit & withdraw user funds</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 text-left">
              <Settings className="w-8 h-8 text-green-400 mb-3" />
              <h3 className="font-semibold text-white mb-1">Full Control</h3>
              <p className="text-sm text-gray-400">Complete platform settings</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 text-left">
              <Lock className="w-8 h-8 text-yellow-400 mb-3" />
              <h3 className="font-semibold text-white mb-1">Secure Access</h3>
              <p className="text-sm text-gray-400">Protected admin dashboard</p>
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
              <span className="text-2xl font-bold text-white">Admin Panel</span>
            </div>
          </div>

          <div className="bg-dark-800/80 backdrop-blur-xl p-8 rounded-2xl border border-purple-500/20 shadow-2xl">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-white">
                {isSetup ? 'Create Admin Account' : 'Admin Login'}
              </h2>
              <p className="text-gray-400 mt-2">
                {isSetup ? 'Set up your admin credentials' : 'Access the control panel'}
              </p>
            </div>

            {error && (
              <div className="bg-red-500/20 border border-red-500 text-red-400 px-4 py-3 rounded-lg mb-6">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              {isSetup && (
                <div className="mb-4">
                  <label className="block text-sm text-gray-400 mb-2">Username</label>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    className="w-full bg-dark-700 border border-purple-500/30 rounded-lg px-4 py-3 focus:outline-none focus:border-purple-500 transition"
                    placeholder="Enter username"
                    required
                  />
                </div>
              )}

              <div className="mb-4">
                <label className="block text-sm text-gray-400 mb-2">Email Address</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full bg-dark-700 border border-purple-500/30 rounded-lg px-4 py-3 focus:outline-none focus:border-purple-500 transition"
                  placeholder="admin@example.com"
                  required
                />
              </div>

              {/* Show parent admin info on login form */}
              {!isSetup && hierarchyInfo && hierarchyInfo.length > 0 && (
                <div className="mb-4 p-3 bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/30 rounded-xl">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-purple-400" />
                    <div className="flex-1">
                      <div className="text-xs text-gray-400">
                        {currentRole === 'ADMIN' ? 'Admin Under' : 
                         currentRole === 'BROKER' ? 'Broker Under' : 
                         currentRole === 'SUB_BROKER' ? 'Sub-Broker Under' : 'Under'}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium">{hierarchyInfo[0].name}</span>
                        <span className="text-xs px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded">
                          {hierarchyInfo[0].role === 'ADMIN' ? 'Admin' : 
                           hierarchyInfo[0].role === 'BROKER' ? 'Broker' : 
                           hierarchyInfo[0].role === 'SUB_BROKER' ? 'Sub-Broker' : 
                           hierarchyInfo[0].role === 'SUPER_ADMIN' ? 'Super Admin' : hierarchyInfo[0].role}
                        </span>
                      </div>
                      <div className="text-sm text-purple-400 font-mono mt-1">{hierarchyInfo[0].adminCode}</div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Show current role if Super Admin (no parent) */}
              {!isSetup && currentRole === 'SUPER_ADMIN' && !parentAdminInfo && (
                <div className="mb-4 p-3 bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/30 rounded-xl">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-yellow-400" />
                    <span className="text-yellow-400 font-medium">Super Admin Account</span>
                  </div>
                </div>
              )}
              
              {/* Show loading indicator */}
              {!isSetup && fetchingParent && formData.email && (
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
                    className="w-full bg-dark-700 border border-purple-500/30 rounded-lg px-4 py-3 pr-12 focus:outline-none focus:border-purple-500 transition"
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
                className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 py-3 rounded-lg font-semibold transition disabled:opacity-50 shadow-lg shadow-purple-500/25"
              >
                {loading ? 'Please wait...' : isSetup ? 'Create Admin Account' : 'Sign In'}
              </button>

              <button
                type="button"
                onClick={() => setIsSetup(!isSetup)}
                className="w-full mt-4 text-sm text-purple-400 hover:text-purple-300 transition"
              >
                {isSetup ? 'Already have an account? Sign In' : 'First time? Create Admin Account'}
              </button>
            </form>

            <div className="mt-6 pt-6 border-t border-gray-700 text-center">
              <Link to="/login" className="text-sm text-gray-400 hover:text-white transition">
                User Login →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;
