import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { parseStoredUserJson } from '../lib/parseStoredUser.js';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);

  // Handle session expired from another device (for users)
  const handleUserSessionExpired = useCallback((message) => {
    setUser(null);
    localStorage.removeItem('user');
    sessionStorage.setItem('logout_message', message);
    window.location.href = '/login';
  }, []);

  // Handle session expired from another device (for admins)
  const handleAdminSessionExpired = useCallback((message) => {
    setAdmin(null);
    localStorage.removeItem('admin');
    sessionStorage.setItem('logout_message', message);
    // Redirect to the correct login page based on current path
    const path = window.location.pathname;
    if (path.startsWith('/superadmin')) {
      window.location.href = '/superadmin/login';
    } else if (path.startsWith('/broker')) {
      window.location.href = '/broker/login';
    } else if (path.startsWith('/subbroker')) {
      window.location.href = '/subbroker/login';
    } else {
      window.location.href = '/admin/login';
    }
  }, []);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    const storedAdmin = localStorage.getItem('admin');
    
    if (storedUser) {
      const parsed = parseStoredUserJson(storedUser);
      if (parsed) setUser(parsed);
      else localStorage.removeItem('user');
    }
    if (storedAdmin) {
      setAdmin(JSON.parse(storedAdmin));
    }
    setLoading(false);
  }, []);

  const getAdminToken = useCallback(() => {
    if (admin?.token) return admin.token;
    try {
      const stored = localStorage.getItem('admin');
      if (!stored) return null;
      return JSON.parse(stored)?.token || null;
    } catch {
      return null;
    }
  }, [admin]);

  const getUserToken = useCallback(() => {
    if (user?.token) return user.token;
    const stored = localStorage.getItem('user');
    return parseStoredUserJson(stored)?.token || null;
  }, [user]);

  // Attach Bearer token on admin/user API calls (many screens use plain axios without headers)
  useEffect(() => {
    const requestInterceptor = axios.interceptors.request.use((config) => {
      const url = String(config.url || '');
      if (url.includes('/api/admin/')) {
        const token = getAdminToken();
        if (token) {
          config.headers = config.headers || {};
          if (!config.headers.Authorization) {
            config.headers.Authorization = `Bearer ${token}`;
          }
        }
      } else if (url.includes('/api/user/') && !url.includes('/login') && !url.includes('/register')) {
        const token = getUserToken();
        if (token) {
          config.headers = config.headers || {};
          if (!config.headers.Authorization) {
            config.headers.Authorization = `Bearer ${token}`;
          }
        }
      }
      return config;
    });

    return () => {
      axios.interceptors.request.eject(requestInterceptor);
    };
  }, [getAdminToken, getUserToken]);

  // Setup axios interceptor for auth errors (expired/invalid token)
  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          const requestUrl = error.config?.url || '';
          // Skip login/setup endpoints - those 401s are just wrong credentials
          const isAuthEndpoint = requestUrl.includes('/login') || requestUrl.includes('/setup') || requestUrl.includes('/register');
          if (!isAuthEndpoint) {
            const message = error.response?.data?.message || 'Session expired. Please login again.';
            if (requestUrl.includes('/api/admin/')) {
              handleAdminSessionExpired(message);
            } else if (requestUrl.includes('/api/user/')) {
              handleUserSessionExpired(message);
            }
          }
        }
        return Promise.reject(error);
      }
    );

    return () => {
      axios.interceptors.response.eject(interceptor);
    };
  }, [handleUserSessionExpired, handleAdminSessionExpired]);

  const loginUser = async (email, password) => {
    const { data } = await axios.post('/api/user/login', { email, password }, { timeout: 30000 });
    setUser(data);
    localStorage.setItem('user', JSON.stringify(data));
    return data;
  };

  const registerUser = async (userData) => {
    const { data } = await axios.post('/api/user/register', userData);
    setUser(data);
    localStorage.setItem('user', JSON.stringify(data));
    return data;
  };

  const registerDemoUser = async (userData) => {
    const { data } = await axios.post('/api/user/demo-register', userData);
    setUser(data);
    localStorage.setItem('user', JSON.stringify(data));
    return data;
  };

  const loginAdmin = async (email, password) => {
    const { data } = await axios.post('/api/admin/login', { email, password }, { timeout: 30000 });
    setAdmin(data);
    localStorage.setItem('admin', JSON.stringify(data));
    return data;
  };

  const setupAdmin = async (username, email, password) => {
    const { data } = await axios.post('/api/admin/setup', { username, email, password });
    setAdmin(data);
    localStorage.setItem('admin', JSON.stringify(data));
    return data;
  };

  const logoutUser = async (message = null) => {
    // Call logout API to clear session token on server
    try {
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        const userData = JSON.parse(storedUser);
        if (userData.token) {
          await axios.post('/api/user/logout', {}, {
            headers: { Authorization: `Bearer ${userData.token}` }
          });
        }
      }
    } catch (error) {
      console.error('Logout API error:', error);
    }
    
    setUser(null);
    localStorage.removeItem('user');
    if (message) {
      sessionStorage.setItem('logout_message', message);
    }
  };

  const logoutAdmin = async () => {
    // Call logout API to clear session token on server
    try {
      const storedAdmin = localStorage.getItem('admin');
      if (storedAdmin) {
        const adminData = JSON.parse(storedAdmin);
        if (adminData.token) {
          await axios.post('/api/admin/logout', {}, {
            headers: { Authorization: `Bearer ${adminData.token}` }
          });
        }
      }
    } catch (error) {
      console.error('Admin logout API error:', error);
    }
    
    setAdmin(null);
    localStorage.removeItem('admin');
  };

  // Function to update admin data (e.g., after wallet transactions)
  const updateAdmin = (updates) => {
    const updatedAdmin = { ...admin, ...updates };
    setAdmin(updatedAdmin);
    localStorage.setItem('admin', JSON.stringify(updatedAdmin));
  };

  // Function to update user data (e.g., after profile updates)
  const updateUser = (updates) => {
    const updatedUser = { ...user, ...updates };
    setUser(updatedUser);
    localStorage.setItem('user', JSON.stringify(updatedUser));
  };

  // Function to refresh user data from server (e.g., after demo conversion)
  const refreshUserData = async () => {
    if (!user?.token) return null;
    try {
      const { data } = await axios.get('/api/user/me', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setUser(data);
      localStorage.setItem('user', JSON.stringify(data));
      return data;
    } catch (error) {
      console.error('Failed to refresh user data:', error);
      return null;
    }
  };

  const value = {
    user,
    admin,
    setAdmin,
    loading,
    loginUser,
    registerUser,
    registerDemoUser,
    loginAdmin,
    setupAdmin,
    logoutUser,
    logoutAdmin,
    updateAdmin,
    updateUser,
    refreshUserData
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
