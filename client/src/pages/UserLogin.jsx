import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Eye, EyeOff, BarChart2, Wallet, Zap, LineChart, Search, X, Users, Shield, Award, Lock, Building2, CheckCircle, MapPin } from 'lucide-react';
import axios from 'axios';
import { StockExLogo } from '../components/StockExLogo';
import {
  getSortedStates,
  getCitiesForState,
  formatBrokerLocation,
  brokerMatchesLocationFilters,
  brokerMatchesSearch,
} from '../utils/brokerLocation.js';

const UserLogin = () => {
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get('ref') || '';
  const [isRegister, setIsRegister] = useState(searchParams.get('register') === 'true' || !!refCode);
  const [formData, setFormData] = useState({ 
    username: '', 
    email: '', 
    password: '', 
    fullName: '', 
    phone: '',
    adminCode: '',
    referralCode: refCode
  });
  
  // Branding state
  const [branding, setBranding] = useState({ brandName: '', logoUrl: '', welcomeTitle: '' });
  
  // Broker info state (for referral code)
  const [brokerInfo, setBrokerInfo] = useState(null);
  
  // Parent admin info state (for login form)
  const [parentAdminInfo, setParentAdminInfo] = useState(null);
  const [hierarchyInfo, setHierarchyInfo] = useState([]);
  const [fetchingParent, setFetchingParent] = useState(false);
  
  // Broker selection state
  const [allBrokers, setAllBrokers] = useState([]);
  const [selectedBroker, setSelectedBroker] = useState(null);
  const [showBrokerModal, setShowBrokerModal] = useState(false);
  const [brokerSearch, setBrokerSearch] = useState('');
  const [brokerFilterState, setBrokerFilterState] = useState('');
  const [brokerFilterCity, setBrokerFilterCity] = useState('');

  // OTP verification state
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpValue, setOtpValue] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [otpError, setOtpError] = useState('');
  const [otpSuccess, setOtpSuccess] = useState('');
  const [resendDisabled, setResendDisabled] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // Phone verification settings
  const [phoneVerificationSettings, setPhoneVerificationSettings] = useState({
    enabled: true,
    requireForRegistration: true
  });

  // Fetch phone verification settings
  useEffect(() => {
    const fetchPhoneVerificationSettings = async () => {
      try {
        const { data } = await axios.get('/api/user/phone-verification-settings');
        setPhoneVerificationSettings({
          enabled: data?.enabled !== false,
          requireForRegistration: data?.requireForRegistration !== false
        });
      } catch (err) {
        console.error('Failed to fetch phone verification settings:', err);
        // Default to enabled if fetch fails
        setPhoneVerificationSettings({
          enabled: true,
          requireForRegistration: true
        });
      }
    };
    fetchPhoneVerificationSettings();
  }, []);

  // Fetch admin branding and broker info if referral code exists
  useEffect(() => {
    const fetchBrandingAndBrokerInfo = async () => {
      if (refCode) {
        try {
          // Fetch branding
          try {
            const { data: brandingData } = await axios.get(`/api/admin/branding/${refCode}`);
            setBranding(brandingData);
          } catch (err) {
            console.error('Failed to fetch branding:', err);
          }

          // Only fetch broker info if it's not a user referral code (user codes start with REF)
          if (!refCode.startsWith('REF')) {
            try {
              const { data: brokerData } = await axios.get(`/api/user/broker-info/${refCode}`);
              setBrokerInfo(brokerData);
            } catch (err) {
              console.error('Failed to fetch broker info:', err);
              // Don't crash if broker info fails - it's optional for user referrals
            }
          }
        } catch (err) {
          console.error('Failed to fetch branding/broker info:', err);
        }
      }
    };
    fetchBrandingAndBrokerInfo();
  }, [refCode]);
  
  // Fetch brokers list when modal opens
  const fetchBrokers = async () => {
    try {
      const { data } = await axios.get('/api/admin/brokers/public');
      setAllBrokers(data.brokers || []);
    } catch (err) {
      console.error('Failed to fetch brokers:', err);
    }
  };
  
  const brokerFilterCities = brokerFilterState ? getCitiesForState(brokerFilterState) : [];

  const filteredBrokers = allBrokers.filter((b) => {
    const searchLower = brokerSearch.trim().toLowerCase();
    return (
      brokerMatchesLocationFilters(b, {
        stateName: brokerFilterState,
        cityName: brokerFilterCity,
      }) && brokerMatchesSearch(b, searchLower)
    );
  });
  
  // Handle broker selection from modal
  const handleSelectBroker = (broker) => {
    setSelectedBroker(broker);
    setShowBrokerModal(false);
    setBrokerSearch('');
    setBrokerFilterState('');
    setBrokerFilterCity('');
  };

  const openBrokerModal = () => {
    fetchBrokers();
    setBrokerSearch('');
    setBrokerFilterState('');
    setBrokerFilterCity('');
    setShowBrokerModal(true);
  };
  
  // Allow direct registration - users without ref code will be assigned to Super Admin
  const canRegister = true;
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [logoutMessage, setLogoutMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const { loginUser, registerUser, registerDemoUser } = useAuth();
  const navigate = useNavigate();

  // Check for logout message (e.g., logged out from another device)
  useEffect(() => {
    const message = sessionStorage.getItem('logout_message');
    if (message) {
      setLogoutMessage(message);
      sessionStorage.removeItem('logout_message');
    }
  }, []);
  
  // Fetch parent admin info when email changes (for login form)
  const fetchParentAdminInfo = useCallback(async (email) => {
    if (!email || isRegister) {
      setParentAdminInfo(null);
      setHierarchyInfo([]);
      return;
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setParentAdminInfo(null);
      setHierarchyInfo([]);
      return;
    }
    
    setFetchingParent(true);
    try {
      const { data } = await axios.post('/api/user/parent-info', { email });
      setParentAdminInfo(data.parentAdmin);
      setHierarchyInfo(data.hierarchy || []);
    } catch (err) {
      setParentAdminInfo(null);
      setHierarchyInfo([]);
    } finally {
      setFetchingParent(false);
    }
  }, [isRegister]);
  
  // Debounce email input for parent info fetch
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isRegister && formData.email) {
        fetchParentAdminInfo(formData.email);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [formData.email, isRegister, fetchParentAdminInfo]);

  // Countdown timer for resend OTP
  useEffect(() => {
    let timer;
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    } else {
      setResendDisabled(false);
    }
    return () => clearTimeout(timer);
  }, [countdown]);

  // Handle sending OTP
  const handleSendOTP = async () => {
    setOtpError('');
    setOtpSuccess('');
    setSendingOtp(true);

    try {
      const { data } = await axios.post('/api/user/send-otp', {
        phone: formData.phone
      });

      if (data.success) {
        setOtpSent(true);
        setOtpSuccess(data.message);
        setResendDisabled(true);
        setCountdown(60); // 60 seconds countdown
      } else {
        setOtpError(data.message);
      }
    } catch (error) {
      setOtpError(error.response?.data?.message || 'Failed to send OTP');
    } finally {
      setSendingOtp(false);
    }
  };

  // Handle verifying OTP
  const handleVerifyOTP = async () => {
    setOtpError('');
    setOtpSuccess('');
    setVerifyingOtp(true);

    try {
      const { data } = await axios.post('/api/user/verify-otp', {
        phone: formData.phone,
        otp: otpValue
      });

      if (data.success) {
        setPhoneVerified(true);
        setOtpSuccess(data.message);
        setOtpSent(false);
      } else {
        setOtpError(data.message);
      }
    } catch (error) {
      setOtpError(error.response?.data?.message || 'Failed to verify OTP');
    } finally {
      setVerifyingOtp(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isRegister) {
        // Check if phone verification is required and not verified
        if (phoneVerificationSettings.enabled && phoneVerificationSettings.requireForRegistration && !phoneVerified) {
          setError('Please verify your phone number before registering');
          setLoading(false);
          return;
        }

        // Include selected broker's adminCode if selected
        const registrationData = {
          ...formData,
          phoneVerified
        };
        if (selectedBroker && !refCode) {
          registrationData.adminCode = selectedBroker.adminCode;
        }
        await registerUser(registrationData);
      } else {
        await loginUser(formData.email, formData.password);
      }
      navigate('/user/home');
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };
  
  // Handle demo account creation
  const handleDemoRegister = async () => {
    if (!formData.fullName || !formData.username || !formData.email || !formData.password) {
      setError('Please fill in all fields to create a demo account');
      return;
    }
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    
    setError('');
    setDemoLoading(true);
    
    try {
      await registerDemoUser({
        username: formData.username,
        email: formData.email,
        password: formData.password,
        fullName: formData.fullName,
        phone: formData.phone,
        // Same ref as full registration — server sets referredBy on demo user (carries to real after convert)
        referralCode: (formData.referralCode || refCode || '').trim() || undefined
      });
      
      // Navigate to dashboard
      navigate('/user/home');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create demo account');
    } finally {
      setDemoLoading(false);
    }
  };

  const toggleMode = () => {
    if (!isRegister && !canRegister) {
      setError('Registration requires a referral link from your admin.');
      return;
    }
    setIsRegister(!isRegister);
    setError('');
    setFormData({ username: '', email: '', password: '', fullName: '', phone: '', adminCode: '', referralCode: refCode });
  };

  return (
    <div className="min-h-screen bg-dark-900 flex">
      {/* Left Side - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 relative">
        <div className="absolute inset-0 bg-gradient-to-br from-green-900/20 to-dark-900" />
        
        <div className="w-full max-w-md relative z-10">
          <div className="text-center mb-8">
            {branding.logoUrl ? (
              <img src={branding.logoUrl} alt="Logo" className="h-20 mx-auto mb-4 object-contain" />
            ) : (
              <StockExLogo className="h-16 w-auto max-w-[200px] mx-auto mb-4 object-contain" alt="StockEx" />
            )}
            {branding.welcomeTitle ? (
              <h1 className="text-2xl font-bold text-white mb-2">{branding.welcomeTitle}</h1>
            ) : branding.brandName ? (
              <h1 className="text-2xl font-bold text-white mb-2">Welcome to {branding.brandName}</h1>
            ) : (
              <p className="text-gray-400">Welcome back, trader!</p>
            )}
          </div>

          <div className="bg-dark-800/90 backdrop-blur-xl p-8 rounded-2xl border border-green-500/20 shadow-2xl">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-white">
                {isRegister ? 'Create Account' : 'Sign In'}
              </h2>
              <p className="text-gray-400 mt-2">
                {isRegister ? 'Start your trading journey' : 'Access your trading dashboard'}
              </p>
            </div>

            {logoutMessage && (
              <div className="bg-yellow-500/20 border border-yellow-500 text-yellow-400 px-4 py-3 rounded-lg mb-4">
                ⚠️ {logoutMessage}
              </div>
            )}

            {error && (
              <div className="bg-red-500/20 border border-red-500 text-red-400 px-4 py-3 rounded-lg mb-6">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              {isRegister && (
                <>
                  <div className="mb-4">
                    <label className="block text-sm text-gray-400 mb-2">Full Name</label>
                    <input
                      type="text"
                      value={formData.fullName}
                      onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                      className="w-full bg-dark-700 border border-green-500/30 rounded-lg px-4 py-3 focus:outline-none focus:border-green-500 transition"
                      placeholder="John Doe"
                      required
                    />
                  </div>
                  <div className="mb-4">
                    <label className="block text-sm text-gray-400 mb-2">Username</label>
                    <input
                      type="text"
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      className="w-full bg-dark-700 border border-green-500/30 rounded-lg px-4 py-3 focus:outline-none focus:border-green-500 transition"
                      placeholder="johndoe"
                      required
                    />
                  </div>

                  {phoneVerificationSettings.enabled && (
                    <>
                      <div className="mb-4">
                        <label className="block text-sm text-gray-400 mb-2">Phone Number</label>
                        <div className="flex gap-2">
                          <input
                            type="tel"
                            value={formData.phone}
                            onChange={(e) => {
                              // Only allow numbers and max 10 digits
                              const value = e.target.value.replace(/\D/g, '').slice(0, 10);
                              setFormData({ ...formData, phone: value });
                              // Reset OTP state if phone changes
                              if (value !== formData.phone) {
                                setPhoneVerified(false);
                                setOtpSent(false);
                                setOtpValue('');
                                setOtpError('');
                                setOtpSuccess('');
                              }
                            }}
                            className="flex-1 bg-dark-700 border border-green-500/30 rounded-lg px-4 py-3 focus:outline-none focus:border-green-500 transition"
                            placeholder="9876543210"
                            maxLength={10}
                            disabled={phoneVerified}
                          />
                          {!phoneVerified && formData.phone.length === 10 && (
                            <button
                              type="button"
                              onClick={handleSendOTP}
                              disabled={sendingOtp || resendDisabled}
                              className="bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 text-white px-4 py-3 rounded-lg font-medium transition whitespace-nowrap"
                            >
                              {sendingOtp ? 'Sending...' : countdown > 0 ? `Resend (${countdown}s)` : 'Send OTP'}
                            </button>
                          )}
                          {phoneVerified && (
                            <div className="flex items-center gap-2 text-green-400 px-4 py-3">
                              <CheckCircle size={20} />
                              <span>Verified</span>
                            </div>
                          )}
                        </div>
                        {formData.phone && formData.phone.length !== 10 && (
                          <p className="text-xs text-red-400 mt-1">Phone number must be 10 digits</p>
                        )}
                      </div>

                      {otpSent && !phoneVerified && (
                        <div className="mb-4">
                          <label className="block text-sm text-gray-400 mb-2">Enter OTP</label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={otpValue}
                              onChange={(e) => {
                                const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                                setOtpValue(value);
                              }}
                              className="flex-1 bg-dark-700 border border-green-500/30 rounded-lg px-4 py-3 focus:outline-none focus:border-green-500 transition"
                              placeholder="Enter 6-digit OTP"
                              maxLength={6}
                            />
                            <button
                              type="button"
                              onClick={handleVerifyOTP}
                              disabled={verifyingOtp || otpValue.length !== 6}
                              className="bg-green-600 hover:bg-green-500 disabled:bg-gray-600 text-white px-4 py-3 rounded-lg font-medium transition whitespace-nowrap"
                            >
                              {verifyingOtp ? 'Verifying...' : 'Verify'}
                            </button>
                          </div>
                          {otpError && <p className="text-xs text-red-400 mt-1">{otpError}</p>}
                          {otpSuccess && <p className="text-xs text-green-400 mt-1">{otpSuccess}</p>}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              <div className="mb-4">
                <label className="block text-sm text-gray-400 mb-2">Email Address</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full bg-dark-700 border border-green-500/30 rounded-lg px-4 py-3 focus:outline-none focus:border-green-500 transition"
                  placeholder="trader@example.com"
                  required
                />
              </div>

              {/* Show parent admin info on login form */}
              {!isRegister && hierarchyInfo && hierarchyInfo.length > 0 && (
                <div className="mb-4 p-3 bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border border-blue-500/30 rounded-xl">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-blue-400" />
                    <div className="flex-1">
                      <div className="text-xs text-gray-400">Registered Under</div>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium">{hierarchyInfo[0].name}</span>
                        <span className="text-xs px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded">
                          {hierarchyInfo[0].role === 'ADMIN' ? 'Admin' : 
                           hierarchyInfo[0].role === 'BROKER' ? 'Broker' : 
                           hierarchyInfo[0].role === 'SUB_BROKER' ? 'Sub-Broker' : 
                           hierarchyInfo[0].role === 'SUPER_ADMIN' ? 'Super Admin' : hierarchyInfo[0].role}
                        </span>
                      </div>
                      <div className="text-sm text-blue-400 font-mono mt-1">{hierarchyInfo[0].adminCode}</div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Show loading indicator while fetching parent info */}
              {!isRegister && fetchingParent && formData.email && (
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
                    className="w-full bg-dark-700 border border-green-500/30 rounded-lg px-4 py-3 pr-12 focus:outline-none focus:border-green-500 transition"
                    placeholder={isRegister ? 'Create password' : 'Enter password'}
                    required
                    minLength={isRegister ? 6 : undefined}
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

              {/* Show broker info when registering with referral code */}
              {isRegister && refCode && brokerInfo && (
                <div className="mb-4 p-4 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-xl">
                  <div className="flex items-center gap-2 mb-3">
                    <Shield className="w-5 h-5 text-green-400" />
                    <span className="font-semibold text-green-400">Registering with Verified Broker</span>
                  </div>

                  <div className="space-y-3">
                    {/* Broker Name */}
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400 text-sm">Broker</span>
                      <span className="text-white font-medium">{brokerInfo.name || brokerInfo.username}</span>
                    </div>

                    {/* Certificate Code (Referral Code) - Read Only */}
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Certificate Code</label>
                      <div className="flex items-center gap-2 bg-dark-700 border border-dark-600 rounded-lg px-3 py-2">
                        <Award className="w-4 h-4 text-yellow-500" />
                        <Lock className="w-4 h-4 text-gray-500" />
                        <span className="text-yellow-400 font-mono font-medium flex-1">{refCode}</span>
                      </div>
                    </div>

                    {/* Specialization */}
                    {brokerInfo.specialization && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-400">Specialization</span>
                        <span className="text-white">{brokerInfo.specialization}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Show referral code when registering without broker info (user-to-user referral) */}
              {isRegister && refCode && !brokerInfo && (
                <div className="mb-4 p-4 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-xl">
                  <div className="flex items-center gap-2 mb-3">
                    <Award className="w-5 h-5 text-purple-400" />
                    <span className="font-semibold text-purple-400">Referral Code Applied</span>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Your Referral Code</label>
                    <div className="flex items-center gap-2 bg-dark-700 border border-dark-600 rounded-lg px-3 py-2">
                      <span className="text-purple-400 font-mono font-medium flex-1">{refCode}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Show selected broker if any (when no ref code) */}
              {isRegister && selectedBroker && !refCode && (
                <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg flex items-center justify-between">
                  <div>
                    <div className="text-xs text-gray-400">Registering under</div>
                    <div className="text-green-400 font-mono font-medium">{selectedBroker.adminCode}</div>
                    {formatBrokerLocation(selectedBroker) && (
                      <div className="text-xs text-gray-400 mt-0.5">
                        {formatBrokerLocation(selectedBroker)}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedBroker(null)}
                    className="text-gray-400 hover:text-red-400"
                  >
                    <X size={18} />
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || demoLoading || (isRegister && !phoneVerified)}
                className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 py-3 rounded-lg font-semibold transition disabled:opacity-50 shadow-lg shadow-green-500/25"
              >
                {loading ? 'Please wait...' : isRegister ? 'Create Account' : 'Start Trading'}
              </button>
              {isRegister && !phoneVerified && (
                <p className="text-center text-xs text-red-400 mt-2">
                  Please verify your phone number to create an account
                </p>
              )}
              
              {/* Try Demo button - only show on registration */}
              {isRegister && (
                <button
                  type="button"
                  onClick={handleDemoRegister}
                  disabled={loading || demoLoading}
                  className="w-full mt-3 bg-gradient-to-r from-yellow-600 to-orange-600 hover:from-yellow-700 hover:to-orange-700 py-3 rounded-lg font-semibold transition disabled:opacity-50 shadow-lg shadow-yellow-500/25 flex items-center justify-center gap-2"
                >
                  {demoLoading ? 'Creating Demo...' : '🎮 Try Demo Account'}
                </button>
              )}
              {isRegister && (
                <p className="text-center text-xs text-gray-500 mt-2">
                  Demo account: 7 days • 1,00,000 virtual balance • No broker required
                </p>
              )}

              {/* Choose Your Broker button - only show on registration without ref code */}
              {isRegister && !refCode && (
                <button
                  type="button"
                  onClick={openBrokerModal}
                  className="w-full mt-3 bg-dark-700 border border-blue-500/30 hover:border-blue-500 py-3 rounded-lg font-medium transition flex items-center justify-center gap-2 text-blue-400 hover:text-blue-300"
                >
                  <Users size={20} />
                  Choose Your Broker
                </button>
              )}

              <button
                type="button"
                onClick={toggleMode}
                className="w-full mt-4 text-sm text-green-400 hover:text-green-300 transition"
              >
                {isRegister ? 'Already have an account? Sign In' : "Don't have an account? Create one"}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Right Side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-center items-center p-12 relative overflow-hidden bg-gradient-to-br from-dark-800 to-dark-900">
        <div className="absolute top-10 right-10 w-96 h-96 bg-green-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-10 left-10 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl" />
        
        {/* Animated Chart Background */}
        <div className="absolute inset-0 opacity-10">
          <svg className="w-full h-full" viewBox="0 0 800 600">
            <path
              d="M0,300 Q100,250 200,280 T400,260 T600,300 T800,250"
              fill="none"
              stroke="#22c55e"
              strokeWidth="2"
            />
            <path
              d="M0,350 Q150,300 300,330 T500,310 T700,350 T800,300"
              fill="none"
              stroke="#10b981"
              strokeWidth="2"
            />
          </svg>
        </div>
        
        <div className="relative z-10 text-center">
                    <h1 className="text-4xl font-bold text-white mb-4">Trade Smarter</h1>
          <p className="text-xl text-gray-400 mb-12">NSE • BSE • MCX • F&O</p>
          
          <div className="grid grid-cols-2 gap-6 max-w-md">
            <div className="bg-dark-700/50 backdrop-blur-sm rounded-xl p-6 text-left border border-green-500/10">
              <LineChart className="w-8 h-8 text-green-400 mb-3" />
              <h3 className="font-semibold text-white mb-1">Live Charts</h3>
              <p className="text-sm text-gray-400">Real-time TradingView charts</p>
            </div>
            <div className="bg-dark-700/50 backdrop-blur-sm rounded-xl p-6 text-left border border-green-500/10">
              <Zap className="w-8 h-8 text-yellow-400 mb-3" />
              <h3 className="font-semibold text-white mb-1">Fast Execution</h3>
              <p className="text-sm text-gray-400">Lightning fast orders</p>
            </div>
            <div className="bg-dark-700/50 backdrop-blur-sm rounded-xl p-6 text-left border border-green-500/10">
              <BarChart2 className="w-8 h-8 text-blue-400 mb-3" />
              <h3 className="font-semibold text-white mb-1">All Segments</h3>
              <p className="text-sm text-gray-400">Equity, F&O, Commodities</p>
            </div>
            <div className="bg-dark-700/50 backdrop-blur-sm rounded-xl p-6 text-left border border-green-500/10">
              <Wallet className="w-8 h-8 text-purple-400 mb-3" />
              <h3 className="font-semibold text-white mb-1">Secure Wallet</h3>
              <p className="text-sm text-gray-400">Safe fund management</p>
            </div>
          </div>

          {/* Market Tickers */}
          <div className="mt-12 flex items-center justify-center gap-8 text-sm">
            <div className="text-center">
              <div className="text-gray-500">NIFTY 50</div>
              <div className="text-green-400 font-mono">--</div>
            </div>
            <div className="text-center">
              <div className="text-gray-500">BANKNIFTY</div>
              <div className="text-green-400 font-mono">--</div>
            </div>
            <div className="text-center">
              <div className="text-gray-500">SENSEX</div>
              <div className="text-red-400 font-mono">--</div>
            </div>
          </div>
        </div>
      </div>

      {/* Broker Selection Modal */}
      {showBrokerModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col border border-green-500/20">
            {/* Modal Header */}
            <div className="p-4 border-b border-dark-600 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">Choose Your Broker</h2>
              <button
                onClick={() => {
                  setShowBrokerModal(false);
                  setBrokerSearch('');
                  setBrokerFilterState('');
                  setBrokerFilterCity('');
                }}
                className="text-gray-400 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-4 border-b border-dark-600 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={brokerFilterState}
                  onChange={(e) => {
                    setBrokerFilterState(e.target.value);
                    setBrokerFilterCity('');
                  }}
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">All states</option>
                  {getSortedStates().map((s) => (
                    <option key={s.stateCode} value={s.state}>{s.state}</option>
                  ))}
                </select>
                <select
                  value={brokerFilterCity}
                  onChange={(e) => setBrokerFilterCity(e.target.value)}
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2 text-sm"
                  disabled={!brokerFilterState}
                >
                  <option value="">{brokerFilterState ? 'All cities' : 'Select state'}</option>
                  {brokerFilterCities.map((c) => (
                    <option key={c.cityCode} value={c.city}>{c.city}</option>
                  ))}
                </select>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                <input
                  type="text"
                  value={brokerSearch}
                  onChange={(e) => setBrokerSearch(e.target.value)}
                  placeholder="Search by code, state, city, area..."
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg pl-10 pr-4 py-3 focus:outline-none focus:border-green-500 transition"
                  autoFocus
                />
              </div>
            </div>

            {/* Broker List */}
            <div className="flex-1 overflow-y-auto p-2">
              {filteredBrokers.length === 0 ? (
                <div className="text-center text-gray-400 py-8">
                  {brokerSearch ? 'No brokers found matching your search' : 'No brokers available'}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredBrokers.map(broker => (
                    <button
                      key={broker._id}
                      onClick={() => handleSelectBroker(broker)}
                      className="w-full p-4 bg-dark-700 hover:bg-dark-600 rounded-lg text-left transition border border-transparent hover:border-green-500/30"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-mono font-semibold text-green-400 text-lg mb-1.5">
                            {broker.adminCode}
                          </div>
                          {formatBrokerLocation(broker) ? (
                            <div className="flex items-center gap-1.5 text-sm text-gray-300">
                              <MapPin size={14} className="text-blue-400 shrink-0" />
                              <span className="truncate">{formatBrokerLocation(broker)}</span>
                            </div>
                          ) : (
                            <div className="text-xs text-gray-500">Area not set</div>
                          )}
                        </div>
                        <div className="text-green-400 shrink-0">
                          <Users size={20} />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-dark-600">
              <button
                onClick={() => {
                  setShowBrokerModal(false);
                  setBrokerSearch('');
                  setBrokerFilterState('');
                  setBrokerFilterCity('');
                }}
                className="w-full bg-dark-600 hover:bg-dark-500 py-2 rounded-lg transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserLogin;
