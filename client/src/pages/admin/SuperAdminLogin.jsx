import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Eye, EyeOff, Users, Settings, BarChart3, Lock } from 'lucide-react';
import { StockExLogo } from '../../components/StockExLogo';

const SuperAdminLogin = () => {
  const [isSetup, setIsSetup] = useState(false);
  const [formData, setFormData] = useState({ username: '', email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const { loginAdmin, setupAdmin } = useAuth();
  const navigate = useNavigate();

  // Show session expired message if redirected from expired session
  useEffect(() => {
    const msg = sessionStorage.getItem('logout_message');
    if (msg) {
      setInfo(msg);
      sessionStorage.removeItem('logout_message');
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isSetup) {
        await setupAdmin(formData.username, formData.email, formData.password);
      } else {
        const result = await loginAdmin(formData.email, formData.password);
        if (result.role !== 'SUPER_ADMIN') {
          setError('Access denied. This login is for Super Admin only.');
          setLoading(false);
          return;
        }
      }
      navigate('/superadmin/dashboard');
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
        <div className="absolute inset-0 bg-gradient-to-br from-purple-600/20 to-yellow-600/20" />
        <div className="absolute top-20 left-20 w-72 h-72 bg-purple-500/30 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-20 w-96 h-96 bg-yellow-500/20 rounded-full blur-3xl" />
        
        <div className="relative z-10 text-center">
          <div className="flex items-center justify-center mb-8">
            <StockExLogo className="h-16 w-auto max-w-[200px] object-contain" alt="StockEx" />
          </div>
          <h1 className="text-4xl font-bold text-white mb-4">Super Admin Portal</h1>
          <p className="text-xl text-gray-300 mb-12">Complete platform control & management</p>
          
          <div className="grid grid-cols-2 gap-6 max-w-md">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 text-left">
              <Users className="w-8 h-8 text-purple-400 mb-3" />
              <h3 className="font-semibold text-white mb-1">Admin Management</h3>
              <p className="text-sm text-gray-400">Create & manage all admins</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 text-left">
              <BarChart3 className="w-8 h-8 text-yellow-400 mb-3" />
              <h3 className="font-semibold text-white mb-1">Market Control</h3>
              <p className="text-sm text-gray-400">Open/close markets globally</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 text-left">
              <Settings className="w-8 h-8 text-green-400 mb-3" />
              <h3 className="font-semibold text-white mb-1">System Settings</h3>
              <p className="text-sm text-gray-400">Configure platform settings</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 text-left">
              <Lock className="w-8 h-8 text-blue-400 mb-3" />
              <h3 className="font-semibold text-white mb-1">Full Access</h3>
              <p className="text-sm text-gray-400">Unrestricted platform control</p>
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
              <span className="text-2xl font-bold text-white">Super Admin</span>
            </div>
          </div>

          <div className="bg-dark-800/80 backdrop-blur-xl p-8 rounded-2xl border border-yellow-500/20 shadow-2xl">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-white">
                {isSetup ? 'Create Super Admin' : 'Super Admin Login'}
              </h2>
              <p className="text-gray-400 mt-2">
                {isSetup ? 'Set up master admin credentials' : 'Access the master control panel'}
              </p>
            </div>

            {info && (
              <div className="bg-yellow-500/20 border border-yellow-500 text-yellow-400 px-4 py-3 rounded-lg mb-6">
                {info}
              </div>
            )}

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
                    className="w-full bg-dark-700 border border-yellow-500/30 rounded-lg px-4 py-3 focus:outline-none focus:border-yellow-500 transition"
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
                  className="w-full bg-dark-700 border border-yellow-500/30 rounded-lg px-4 py-3 focus:outline-none focus:border-yellow-500 transition"
                  placeholder="superadmin@example.com"
                  required
                />
              </div>

              <div className="mb-6">
                <label className="block text-sm text-gray-400 mb-2">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full bg-dark-700 border border-yellow-500/30 rounded-lg px-4 py-3 pr-12 focus:outline-none focus:border-yellow-500 transition"
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
                className="w-full bg-gradient-to-r from-purple-600 to-yellow-500 hover:from-purple-700 hover:to-yellow-600 py-3 rounded-lg font-semibold transition disabled:opacity-50 shadow-lg shadow-yellow-500/25"
              >
                {loading ? 'Please wait...' : isSetup ? 'Create Super Admin' : 'Sign In'}
              </button>

              <button
                type="button"
                onClick={() => setIsSetup(!isSetup)}
                className="w-full mt-4 text-sm text-yellow-400 hover:text-yellow-300 transition"
              >
                {isSetup ? 'Already have an account? Sign In' : 'First time? Create Super Admin'}
              </button>
            </form>

            <div className="mt-6 pt-6 border-t border-gray-700 text-center space-y-2">
              <Link to="/admin/login" className="block text-sm text-gray-400 hover:text-white transition">
                Admin Login →
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

export default SuperAdminLogin;
