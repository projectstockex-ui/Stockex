import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import axios from 'axios';
import { Eye, EyeOff, Users, TrendingUp, Wallet, Lock, Play, Timer, X, Building2 } from 'lucide-react';
import { StockExLogo } from '../../components/StockExLogo';

const BrokerLogin = () => {
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [showDemoForm, setShowDemoForm] = useState(false);
  const [showDemoCredentials, setShowDemoCredentials] = useState(false);
  const [demoCredentials, setDemoCredentials] = useState(null);
  const [parentAdminInfo, setParentAdminInfo] = useState(null);
  const [currentRole, setCurrentRole] = useState(null);
  const [fetchingParent, setFetchingParent] = useState(false);
  const [demoFormData, setDemoFormData] = useState({
    name: '',
    email: '',
    phone: '',
    password: 'demo1234',
    pin: '1234'
  });
  const [demoError, setDemoError] = useState('');
  const { loginAdmin, setAdmin } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Open broker signup form when linked from Join Stockex brokerage card
  useEffect(() => {
    if (searchParams.get('register') === 'true') {
      setShowDemoForm(true);
    }
  }, [searchParams]);
  
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

  // Open Demo Form
  const handleOpenDemoForm = () => {
    setShowDemoForm(true);
    setDemoError('');
  };

  // Create Demo Broker Account with form data
  const handleCreateDemo = async (e) => {
    e.preventDefault();
    if (!demoFormData.name || !demoFormData.email || !demoFormData.phone) {
      setDemoError('Please fill all required fields');
      return;
    }
    
    setDemoLoading(true);
    setDemoError('');
    try {
      const { data } = await axios.post('/api/admin/demo-broker', {
        name: demoFormData.name,
        email: demoFormData.email,
        phone: demoFormData.phone,
        password: demoFormData.password,
        pin: demoFormData.pin
      });
      setDemoCredentials(data);
      setShowDemoForm(false);
      setShowDemoCredentials(true);
    } catch (err) {
      setDemoError(err.response?.data?.message || 'Failed to create demo account');
    } finally {
      setDemoLoading(false);
    }
  };

  // Login with Demo Credentials
  const handleDemoLogin = () => {
    if (demoCredentials) {
      // Store admin data and redirect
      localStorage.setItem('admin', JSON.stringify(demoCredentials));
      setAdmin(demoCredentials);
      navigate('/broker/dashboard');
    }
  };

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
        navigate('/broker/dashboard');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-orange-900 to-slate-900 flex">
      {/* Left Side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-center items-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-orange-600/20 to-amber-600/20" />
        <div className="absolute top-20 left-20 w-72 h-72 bg-orange-500/30 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-20 w-96 h-96 bg-amber-500/20 rounded-full blur-3xl" />
        
        <div className="relative z-10 text-center">
          <div className="flex items-center justify-center mb-8">
            <StockExLogo className="h-16 w-auto max-w-[200px] object-contain" alt="StockEx" />
          </div>
          <h1 className="text-4xl font-bold text-white mb-4">Broker Portal</h1>
          <p className="text-xl text-gray-300 mb-12">Manage sub-brokers & client accounts</p>
          
          <div className="grid grid-cols-2 gap-6 max-w-md">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 text-left">
              <Users className="w-8 h-8 text-orange-400 mb-3" />
              <h3 className="font-semibold text-white mb-1">Sub-Broker Management</h3>
              <p className="text-sm text-gray-400">Create & manage sub-brokers</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 text-left">
              <TrendingUp className="w-8 h-8 text-amber-400 mb-3" />
              <h3 className="font-semibold text-white mb-1">Client Trading</h3>
              <p className="text-sm text-gray-400">Monitor client positions</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 text-left">
              <Wallet className="w-8 h-8 text-green-400 mb-3" />
              <h3 className="font-semibold text-white mb-1">Fund Management</h3>
              <p className="text-sm text-gray-400">Handle client funds</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 text-left">
              <Lock className="w-8 h-8 text-yellow-400 mb-3" />
              <h3 className="font-semibold text-white mb-1">Secure Access</h3>
              <p className="text-sm text-gray-400">Protected broker panel</p>
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
              <span className="text-2xl font-bold text-white">Broker Panel</span>
            </div>
          </div>

          <div className="bg-dark-800/80 backdrop-blur-xl p-8 rounded-2xl border border-orange-500/20 shadow-2xl">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-white">Broker Login</h2>
              <p className="text-gray-400 mt-2">Access your broker dashboard</p>
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
                  className="w-full bg-dark-700 border border-orange-500/30 rounded-lg px-4 py-3 focus:outline-none focus:border-orange-500 transition"
                  placeholder="broker@example.com"
                  required
                />
              </div>

              {/* Show parent admin info on login form */}
              {parentAdminInfo && (
                <div className="mb-4 p-3 bg-gradient-to-r from-orange-500/10 to-amber-500/10 border border-orange-500/30 rounded-xl">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-orange-400" />
                    <div className="flex-1">
                      <div className="text-xs text-gray-400">
                        {currentRole === 'BROKER' ? 'Broker Under' : 
                         currentRole === 'SUB_BROKER' ? 'Sub-Broker Under' : 'Under'}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium">{parentAdminInfo.name}</span>
                        <span className="text-xs px-2 py-0.5 bg-orange-500/20 text-orange-400 rounded">
                          {parentAdminInfo.role === 'ADMIN' ? 'Admin' : 
                           parentAdminInfo.role === 'BROKER' ? 'Broker' : 
                           parentAdminInfo.role === 'SUPER_ADMIN' ? 'Super Admin' : parentAdminInfo.role}
                        </span>
                      </div>
                      <div className="text-sm text-orange-400 font-mono mt-1">{parentAdminInfo.adminCode}</div>
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
                    className="w-full bg-dark-700 border border-orange-500/30 rounded-lg px-4 py-3 pr-12 focus:outline-none focus:border-orange-500 transition"
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
                className="w-full bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-700 hover:to-amber-600 py-3 rounded-lg font-semibold transition disabled:opacity-50 shadow-lg shadow-orange-500/25"
              >
                {loading ? 'Please wait...' : 'Sign In'}
              </button>
            </form>

            {/* Try Demo Account Button */}
            <div className="mt-6 pt-6 border-t border-gray-700">
              <button
                type="button"
                onClick={handleOpenDemoForm}
                className="w-full bg-gradient-to-r from-green-600 to-emerald-500 hover:from-green-700 hover:to-emerald-600 py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2"
              >
                <Play size={20} />
                Try Demo Account
              </button>
              <p className="text-xs text-gray-500 text-center mt-2">
                7 days trial • Full broker features
              </p>
            </div>

            <div className="mt-4 text-center space-y-2">
              <Link to="/subbroker/login" className="block text-sm text-gray-400 hover:text-white transition">
                Sub-Broker Login →
              </Link>
              <Link to="/login" className="block text-sm text-gray-400 hover:text-white transition">
                User Login →
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Demo Registration Form Modal */}
      {showDemoForm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 rounded-2xl w-full max-w-md p-6 border border-green-500/30">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-green-400 flex items-center gap-2">
                <Play size={24} />
                Create Demo Account
              </h3>
              <button onClick={() => setShowDemoForm(false)} className="text-gray-400 hover:text-white">
                <X size={24} />
              </button>
            </div>

            {demoError && (
              <div className="bg-red-500/20 border border-red-500 text-red-400 px-4 py-2 rounded-lg mb-4 text-sm">
                {demoError}
              </div>
            )}

            <form onSubmit={handleCreateDemo} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Full Name *</label>
                <input
                  type="text"
                  value={demoFormData.name}
                  onChange={(e) => setDemoFormData({ ...demoFormData, name: e.target.value })}
                  className="w-full bg-dark-700 border border-green-500/30 rounded-lg px-4 py-2 focus:outline-none focus:border-green-500"
                  placeholder="Enter your name"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Email *</label>
                <input
                  type="email"
                  value={demoFormData.email}
                  onChange={(e) => setDemoFormData({ ...demoFormData, email: e.target.value })}
                  className="w-full bg-dark-700 border border-green-500/30 rounded-lg px-4 py-2 focus:outline-none focus:border-green-500"
                  placeholder="Enter your email"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Phone Number *</label>
                <input
                  type="tel"
                  value={demoFormData.phone}
                  onChange={(e) => setDemoFormData({ ...demoFormData, phone: e.target.value })}
                  className="w-full bg-dark-700 border border-green-500/30 rounded-lg px-4 py-2 focus:outline-none focus:border-green-500"
                  placeholder="Enter phone number"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Password</label>
                <input
                  type="text"
                  value={demoFormData.password}
                  onChange={(e) => setDemoFormData({ ...demoFormData, password: e.target.value })}
                  className="w-full bg-dark-700 border border-green-500/30 rounded-lg px-4 py-2 focus:outline-none focus:border-green-500"
                  placeholder="Password"
                />
                <p className="text-xs text-gray-500 mt-1">Default: demo1234</p>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">PIN (4-6 digits)</label>
                <input
                  type="text"
                  value={demoFormData.pin}
                  onChange={(e) => setDemoFormData({ ...demoFormData, pin: e.target.value })}
                  className="w-full bg-dark-700 border border-green-500/30 rounded-lg px-4 py-2 focus:outline-none focus:border-green-500"
                  placeholder="PIN"
                  maxLength={6}
                />
                <p className="text-xs text-gray-500 mt-1">Default: 1234</p>
              </div>

              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
                <p className="text-xs text-green-400">
                  ✓ Demo Balance: 1,00,000<br/>
                  ✓ Valid for 7 days<br/>
                  ✓ Full broker features access
                </p>
              </div>

              <button
                type="submit"
                disabled={demoLoading}
                className="w-full bg-gradient-to-r from-green-600 to-emerald-500 hover:from-green-700 hover:to-emerald-600 py-3 rounded-lg font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {demoLoading ? (
                  <>
                    <Timer className="animate-spin" size={20} />
                    Creating Account...
                  </>
                ) : (
                  <>
                    <Play size={20} />
                    Create Demo Account
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Demo Credentials Modal - After successful creation */}
      {showDemoCredentials && demoCredentials && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 rounded-2xl w-full max-w-md p-6 border border-green-500/30">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-green-400 flex items-center gap-2">
                <Play size={24} />
                Demo Account Created!
              </h3>
              <button onClick={() => setShowDemoCredentials(false)} className="text-gray-400 hover:text-white">
                <X size={24} />
              </button>
            </div>

            <div className="bg-dark-700 rounded-lg p-4 mb-4 space-y-3">
              <div>
                <div className="text-xs text-gray-400">Name</div>
                <div className="font-medium text-white">{demoCredentials.name}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400">Admin Code</div>
                <div className="font-mono text-orange-400 text-lg">{demoCredentials.adminCode}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400">Password</div>
                <div className="font-mono text-green-400">{demoCredentials.demoPassword}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400">PIN</div>
                <div className="font-mono text-green-400">{demoCredentials.demoPin}</div>
              </div>
              <div className="flex gap-4">
                <div>
                  <div className="text-xs text-gray-400">Demo Balance</div>
                  <div className="font-bold text-green-400">{demoCredentials.wallet?.balance?.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400">Expires In</div>
                  <div className="text-yellow-400">7 Days</div>
                </div>
              </div>
            </div>

            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-4">
              <p className="text-xs text-yellow-400">
                ⚠️ This is a demo account. All users you create will also be demo users. 
                When converted to a real broker, all demo users will be deleted.
              </p>
            </div>

            <button
              onClick={handleDemoLogin}
              className="w-full bg-gradient-to-r from-green-600 to-emerald-500 hover:from-green-700 hover:to-emerald-600 py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2"
            >
              <Play size={20} />
              Start Demo Now
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BrokerLogin;
