import React, { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import UserAutoRefresh from './components/UserAutoRefresh';
import TradingSoundAlerts from './components/TradingSoundAlerts';
import { ThemeProvider } from './context/ThemeContext';
// Legacy Admin Login (redirects based on role)
import AdminLoginLegacy from './pages/AdminLogin';
// Separate Login Pages — keep eager so login stays instant
import SuperAdminLogin from './pages/admin/SuperAdminLogin';
import AdminLogin from './pages/admin/AdminLogin';
import BrokerLogin from './pages/admin/BrokerLogin';
import SubBrokerLogin from './pages/admin/SubBrokerLogin';
import UserLogin from './pages/UserLogin';
import LoginAs from './pages/LoginAs';
import LandingPageNew from './pages/LandingPageNew';

// Heavy dashboards — lazy-loaded so admin login page does not download the full admin bundle
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const UserDashboardNew = lazy(() => import('./pages/UserDashboardNew'));
const UserDashboard = lazy(() => import('./pages/UserDashboard'));
const UserOrders = lazy(() => import('./pages/UserOrders'));
const UserTransactions = lazy(() => import('./pages/UserTransactions'));
const UserGames = lazy(() => import('./pages/UserGames'));

// Landing pages — lazy-loaded (marketing site, not needed on admin login)
const About = lazy(() => import('./pages/landing/about/About'));
const PropFirm = lazy(() => import('./pages/landing/prop-firm/Prop-firm'));
const Partnership = lazy(() => import('./pages/landing/partnership/Partnership'));
const Contact = lazy(() => import('./pages/landing/contact/Contact'));
const Blog = lazy(() => import('./pages/landing/blog/Blog'));
const Careers = lazy(() => import('./pages/landing/careers/Careers'));
const Markets = lazy(() => import('./pages/landing/markets/Markets'));
const Accounts = lazy(() => import('./pages/landing/accounts/Accounts'));
const UserAccount = lazy(() => import('./pages/landing/accounts/UserAccount'));
const DemoAccount = lazy(() => import('./pages/landing/accounts/DemoAccount'));
const AccountVlogPage = lazy(() => import('./pages/landing/accounts/AccountVlogPage'));
const DemoTrading = lazy(() => import('./pages/landing/demo-trading/DemoTrading'));
const BrokerProgram = lazy(() => import('./pages/landing/broker-program/BrokerProgram'));
const StocksMarket = lazy(() => import('./pages/landing/markets/stocks/Stocks'));
const ForexMarket = lazy(() => import('./pages/landing/markets/forex/Forex'));
const IndicesMarket = lazy(() => import('./pages/landing/markets/indices/Indices'));
const CommoditiesMarket = lazy(() => import('./pages/landing/markets/commodities/Commodities'));
const CurrencyMarket = lazy(() => import('./pages/landing/markets/currency/Currency'));
const MetalsMarket = lazy(() => import('./pages/landing/markets/metals/Metals'));
const CfdsMarket = lazy(() => import('./pages/landing/markets/cfds/Cfds'));
const BrokerageCalculator = lazy(() => import('./pages/landing/tools/BrokerageCalculator'));
const ProfitLossCalculator = lazy(() => import('./pages/landing/tools/ProfitLossCalculator'));
const MarginCalculator = lazy(() => import('./pages/landing/tools/MarginCalculator'));
const MarketHeatmap = lazy(() => import('./pages/landing/tools/MarketHeatmap'));
const PrivacyPolicy = lazy(() => import('./pages/landing/legal/PrivacyPolicy'));
const TermsConditions = lazy(() => import('./pages/landing/legal/TermsConditions'));
const RiskDisclosure = lazy(() => import('./pages/landing/legal/RiskDisclosure'));
const GamesPage = lazy(() => import('./pages/landing/features/Games'));

function PageLoader({ label = 'Loading…' }) {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-dark-900 gap-3">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-yellow-500 border-t-transparent" />
      <span className="text-sm text-gray-400">{label}</span>
    </div>
  );
}

function LazyPage({ children, label }) {
  return <Suspense fallback={<PageLoader label={label} />}>{children}</Suspense>;
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('React Error:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', color: 'white', background: '#1a1a1a', minHeight: '100vh' }}>
          <h1>Something went wrong</h1>
          <pre style={{ color: 'red' }}>{this.state.error?.toString()}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const ProtectedAdminRoute = ({ children }) => {
  const { admin, loading, setAdmin } = useAuth();
  
  // Allow access to dashboard after Zerodha OAuth callback even if admin state is not loaded yet
  const urlParams = new URLSearchParams(window.location.search);
  const zerodhaConnected = urlParams.get('zerodha') === 'connected';
  
  // Load admin from localStorage if zerodha connected and admin state is null
  useEffect(() => {
    if (zerodhaConnected && !admin && !loading) {
      const storedAdmin = localStorage.getItem('admin');
      if (storedAdmin) {
        try {
          setAdmin(JSON.parse(storedAdmin));
        } catch (e) {
          console.error('Failed to parse admin from localStorage:', e);
        }
      }
    }
  }, [zerodhaConnected, admin, loading, setAdmin]);
  
  if (loading) return <div className="flex items-center justify-center h-screen bg-dark-900">Loading...</div>;
  
  if (!admin && !zerodhaConnected) {
    // Redirect to appropriate login based on current path
    const path = window.location.pathname;
    if (path.startsWith('/superadmin')) return <Navigate to="/superadmin/login" />;
    if (path.startsWith('/broker')) return <Navigate to="/broker/login" />;
    if (path.startsWith('/subbroker')) return <Navigate to="/subbroker/login" />;
    return <Navigate to="/admin/login" />;
  }
  return children;
};

const ProtectedUserRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen bg-dark-900">Loading...</div>;
  return user ? children : <Navigate to="/login" />;
};

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <Router>
          <UserAutoRefresh />
          <TradingSoundAlerts />
          <Routes>
            <Route path="/" element={<LandingPageNew />} />
            <Route path="/about" element={<LazyPage label="Loading…"><About /></LazyPage>} />
            <Route path="/careers" element={<LazyPage><Careers /></LazyPage>} />
            <Route path="/blog" element={<LazyPage><Blog /></LazyPage>} />
            <Route path="/markets" element={<LazyPage><Markets /></LazyPage>} />
            <Route path="/markets/stocks" element={<LazyPage><StocksMarket /></LazyPage>} />
            <Route path="/markets/forex" element={<LazyPage><ForexMarket /></LazyPage>} />
            <Route path="/markets/indices" element={<LazyPage><IndicesMarket /></LazyPage>} />
            <Route path="/markets/commodities" element={<LazyPage><CommoditiesMarket /></LazyPage>} />
            <Route path="/markets/currency" element={<LazyPage><CurrencyMarket /></LazyPage>} />
            <Route path="/markets/metals" element={<LazyPage><MetalsMarket /></LazyPage>} />
            <Route path="/markets/cfds" element={<LazyPage><CfdsMarket /></LazyPage>} />
            <Route path="/accounts" element={<LazyPage><Accounts /></LazyPage>} />
            <Route path="/accounts/user" element={<LazyPage><UserAccount /></LazyPage>} />
            <Route path="/accounts/demo" element={<LazyPage><DemoAccount /></LazyPage>} />
            <Route path="/accounts/:slug" element={<LazyPage><AccountVlogPage /></LazyPage>} />
            <Route path="/demo-trading" element={<LazyPage><DemoTrading /></LazyPage>} />
            <Route path="/broker-program" element={<LazyPage><BrokerProgram /></LazyPage>} />
            <Route path="/features/games" element={<LazyPage><GamesPage /></LazyPage>} />
            <Route path="/partnership" element={<LazyPage><Partnership /></LazyPage>} />
            <Route path="/prop-firm" element={<LazyPage><PropFirm /></LazyPage>} />
            <Route path="/contact" element={<LazyPage><Contact /></LazyPage>} />
            <Route path="/legal/privacy-policy" element={<LazyPage><PrivacyPolicy /></LazyPage>} />
            <Route path="/legal/terms-and-conditions" element={<LazyPage><TermsConditions /></LazyPage>} />
            <Route path="/legal/risk-disclosure" element={<LazyPage><RiskDisclosure /></LazyPage>} />
            <Route path="/tools/brokerage-calculator" element={<LazyPage><BrokerageCalculator /></LazyPage>} />
            <Route path="/tools/profit-loss-calculator" element={<LazyPage><ProfitLossCalculator /></LazyPage>} />
            <Route path="/tools/margin-calculator" element={<LazyPage><MarginCalculator /></LazyPage>} />
            <Route path="/tools/market-heatmap" element={<LazyPage><MarketHeatmap /></LazyPage>} />
            <Route path="/login" element={<UserLogin />} />
            <Route path="/signup" element={<UserLogin />} />
            <Route path="/login-as" element={<LoginAs />} />
            
            {/* Separate Login Pages for each role */}
            <Route path="/superadmin/login" element={<SuperAdminLogin />} />
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/broker/login" element={<BrokerLogin />} />
            <Route path="/subbroker/login" element={<SubBrokerLogin />} />
            
            {/* Legacy admin login - redirects based on role */}
            <Route path="/panel/login" element={<AdminLoginLegacy />} />
            
            {/* All admin dashboards use the same component for now (role-based rendering) */}
            <Route path="/superadmin/*" element={
              <ProtectedAdminRoute>
                <LazyPage label="Loading admin panel…">
                  <AdminDashboard />
                </LazyPage>
              </ProtectedAdminRoute>
            } />
            <Route path="/admin/*" element={
              <ProtectedAdminRoute>
                <LazyPage label="Loading admin panel…">
                  <AdminDashboard />
                </LazyPage>
              </ProtectedAdminRoute>
            } />
            <Route path="/broker/*" element={
              <ProtectedAdminRoute>
                <LazyPage label="Loading admin panel…">
                  <AdminDashboard />
                </LazyPage>
              </ProtectedAdminRoute>
            } />
            <Route path="/subbroker/*" element={
              <ProtectedAdminRoute>
                <LazyPage label="Loading admin panel…">
                  <AdminDashboard />
                </LazyPage>
              </ProtectedAdminRoute>
            } />
            {/* Trader Room - Separate page without sidebar */}
            <Route path="/user/trader-room" element={
              <ProtectedUserRoute>
                <LazyPage label="Loading trader room…">
                  <UserDashboard />
                </LazyPage>
              </ProtectedUserRoute>
            } />
            {/* Orders Page - Full page orders history */}
            <Route path="/user/orders" element={
              <ProtectedUserRoute>
                <LazyPage><UserOrders /></LazyPage>
              </ProtectedUserRoute>
            } />
            {/* Transactions Page - All wallet and fund transactions */}
            <Route path="/user/transactions" element={
              <ProtectedUserRoute>
                <LazyPage><UserTransactions /></LazyPage>
              </ProtectedUserRoute>
            } />
            {/* Games Page - Fantasy trading games */}
            <Route path="/user/games" element={
              <ProtectedUserRoute>
                <LazyPage><UserGames /></LazyPage>
              </ProtectedUserRoute>
            } />
            {/* User CRM Dashboard with sidebar */}
            <Route path="/user/*" element={
              <ProtectedUserRoute>
                <LazyPage label="Loading dashboard…">
                  <UserDashboardNew />
                </LazyPage>
              </ProtectedUserRoute>
            } />
            <Route path="/dashboard" element={<Navigate to="/user/home" replace />} />
            <Route path="/dashboard/*" element={<Navigate to="/user/home" replace />} />
          </Routes>
          </Router>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
