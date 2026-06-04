import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import UserAutoRefresh from './components/UserAutoRefresh';
import TradingSoundAlerts from './components/TradingSoundAlerts';
import { ThemeProvider } from './context/ThemeContext';
// Legacy Admin Login (redirects based on role)
import AdminLoginLegacy from './pages/AdminLogin';
// Separate Login Pages
import SuperAdminLogin from './pages/admin/SuperAdminLogin';
import AdminLogin from './pages/admin/AdminLogin';
import BrokerLogin from './pages/admin/BrokerLogin';
import SubBrokerLogin from './pages/admin/SubBrokerLogin';
// Dashboards
import AdminDashboard from './pages/AdminDashboard';
import UserLogin from './pages/UserLogin';
import UserDashboardNew from './pages/UserDashboardNew';
import UserDashboard from './pages/UserDashboard';
import UserOrders from './pages/UserOrders';
import UserTransactions from './pages/UserTransactions';
import UserGames from './pages/UserGames';
import LandingPage from './pages/LandingPage';
import LandingPageNew from './pages/LandingPageNew';
import LoginAs from './pages/LoginAs';
// Landing Pages from stockex_repo
import About from './pages/landing/about/About';
import PropFirm from './pages/landing/prop-firm/Prop-firm';
import Partnership from './pages/landing/partnership/Partnership';
import Contact from './pages/landing/contact/Contact';
import Blog from './pages/landing/blog/Blog';
import Careers from './pages/landing/careers/Careers';
import Markets from './pages/landing/markets/Markets';
import Accounts from './pages/landing/accounts/Accounts';
import UserAccount from './pages/landing/accounts/UserAccount';
import DemoAccount from './pages/landing/accounts/DemoAccount';
import DemoTrading from './pages/landing/demo-trading/DemoTrading';
import BrokerProgram from './pages/landing/broker-program/BrokerProgram';
import StocksMarket from './pages/landing/markets/stocks/Stocks';
import ForexMarket from './pages/landing/markets/forex/Forex';
import IndicesMarket from './pages/landing/markets/indices/Indices';
import CommoditiesMarket from './pages/landing/markets/commodities/Commodities';
import CurrencyMarket from './pages/landing/markets/currency/Currency';
import MetalsMarket from './pages/landing/markets/metals/Metals';
import CfdsMarket from './pages/landing/markets/cfds/Cfds';
import BrokerageCalculator from './pages/landing/tools/BrokerageCalculator';
import ProfitLossCalculator from './pages/landing/tools/ProfitLossCalculator';
import MarginCalculator from './pages/landing/tools/MarginCalculator';
import MarketHeatmap from './pages/landing/tools/MarketHeatmap';
import PrivacyPolicy from './pages/landing/legal/PrivacyPolicy';
import TermsConditions from './pages/landing/legal/TermsConditions';
import RiskDisclosure from './pages/landing/legal/RiskDisclosure';
import GamesPage from './pages/landing/features/Games';

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
            <Route path="/about" element={<About />} />
            <Route path="/careers" element={<Careers />} />
            <Route path="/blog" element={<Blog />} />
            <Route path="/markets" element={<Markets />} />
            <Route path="/markets/stocks" element={<StocksMarket />} />
            <Route path="/markets/forex" element={<ForexMarket />} />
            <Route path="/markets/indices" element={<IndicesMarket />} />
            <Route path="/markets/commodities" element={<CommoditiesMarket />} />
            <Route path="/markets/currency" element={<CurrencyMarket />} />
            <Route path="/markets/metals" element={<MetalsMarket />} />
            <Route path="/markets/cfds" element={<CfdsMarket />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/accounts/user" element={<UserAccount />} />
            <Route path="/accounts/demo" element={<DemoAccount />} />
            <Route path="/demo-trading" element={<DemoTrading />} />
            <Route path="/broker-program" element={<BrokerProgram />} />
            <Route path="/features/games" element={<GamesPage />} />
            <Route path="/partnership" element={<Partnership />} />
            <Route path="/prop-firm" element={<PropFirm />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/legal/privacy-policy" element={<PrivacyPolicy />} />
            <Route path="/legal/terms-and-conditions" element={<TermsConditions />} />
            <Route path="/legal/risk-disclosure" element={<RiskDisclosure />} />
            <Route path="/tools/brokerage-calculator" element={<BrokerageCalculator />} />
            <Route path="/tools/profit-loss-calculator" element={<ProfitLossCalculator />} />
            <Route path="/tools/margin-calculator" element={<MarginCalculator />} />
            <Route path="/tools/market-heatmap" element={<MarketHeatmap />} />
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
                <AdminDashboard />
              </ProtectedAdminRoute>
            } />
            <Route path="/admin/*" element={
              <ProtectedAdminRoute>
                <AdminDashboard />
              </ProtectedAdminRoute>
            } />
            <Route path="/broker/*" element={
              <ProtectedAdminRoute>
                <AdminDashboard />
              </ProtectedAdminRoute>
            } />
            <Route path="/subbroker/*" element={
              <ProtectedAdminRoute>
                <AdminDashboard />
              </ProtectedAdminRoute>
            } />
            {/* Trader Room - Separate page without sidebar */}
            <Route path="/user/trader-room" element={
              <ProtectedUserRoute>
                <UserDashboard />
              </ProtectedUserRoute>
            } />
            {/* Orders Page - Full page orders history */}
            <Route path="/user/orders" element={
              <ProtectedUserRoute>
                <UserOrders />
              </ProtectedUserRoute>
            } />
            {/* Transactions Page - All wallet and fund transactions */}
            <Route path="/user/transactions" element={
              <ProtectedUserRoute>
                <UserTransactions />
              </ProtectedUserRoute>
            } />
            {/* Games Page - Fantasy trading games */}
            <Route path="/user/games" element={
              <ProtectedUserRoute>
                <UserGames />
              </ProtectedUserRoute>
            } />
            {/* User CRM Dashboard with sidebar */}
            <Route path="/user/*" element={
              <ProtectedUserRoute>
                <UserDashboardNew />
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
