import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import { AUTO_REFRESH_EVENT } from '../lib/autoRefresh';
import { resolveMainWalletBalance, formatInrMainWallet } from '../utils/resolveMainWalletBalance';
import {
  Wallet, TrendingUp, TrendingDown, Calendar, ChevronLeft, ChevronRight,
  RefreshCw, ExternalLink, Timer, DollarSign, BarChart3, PieChart,
  ArrowUpRight, ArrowDownRight, Newspaper, Globe
} from 'lucide-react';

// P&L Calendar Component
const PnLCalendar = ({ trades = [] }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [dailyPnL, setDailyPnL] = useState({});

  useEffect(() => {
    // Calculate daily P&L from trades
    const pnlByDate = {};
    trades.forEach(trade => {
      if (trade.status === 'CLOSED' && trade.exitTime) {
        const date = new Date(trade.exitTime).toDateString();
        pnlByDate[date] = (pnlByDate[date] || 0) + (trade.pnl || 0);
      }
    });
    setDailyPnL(pnlByDate);
  }, [trades]);

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDay = firstDay.getDay();
    return { daysInMonth, startingDay };
  };

  const { daysInMonth, startingDay } = getDaysInMonth(currentDate);
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                      'July', 'August', 'September', 'October', 'November', 'December'];
  const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const getDayPnL = (day) => {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day).toDateString();
    return dailyPnL[date] || 0;
  };

  const isToday = (day) => {
    const today = new Date();
    return day === today.getDate() && 
           currentDate.getMonth() === today.getMonth() && 
           currentDate.getFullYear() === today.getFullYear();
  };

  // Calculate selected day stats
  const today = new Date();
  const todayStr = today.toDateString();
  const todayPnL = dailyPnL[todayStr] || 0;
  const todayTrades = trades.filter(t => 
    t.status === 'CLOSED' && t.exitTime && new Date(t.exitTime).toDateString() === todayStr
  ).length;
  const todayWinRate = todayTrades > 0 
    ? Math.round((trades.filter(t => 
        t.status === 'CLOSED' && t.exitTime && 
        new Date(t.exitTime).toDateString() === todayStr && 
        (t.pnl || 0) > 0
      ).length / todayTrades) * 100)
    : 0;

  return (
    <div className="bg-dark-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">PnL Calendar</h3>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-1 hover:bg-dark-700 rounded">
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-medium min-w-[120px] text-center">
            {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
          </span>
          <button onClick={nextMonth} className="p-1 hover:bg-dark-700 rounded">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {dayNames.map(day => (
          <div key={day} className="text-center text-xs text-gray-500 py-1">{day}</div>
        ))}
      </div>

      {/* Calendar days */}
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: startingDay }).map((_, i) => (
          <div key={`empty-${i}`} className="aspect-square" />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const pnl = getDayPnL(day);
          const hasData = pnl !== 0;
          return (
            <div
              key={day}
              className={`aspect-square flex items-center justify-center text-sm rounded-lg cursor-pointer transition
                ${isToday(day) ? 'bg-purple-600 text-white' : 
                  hasData ? (pnl > 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400') : 
                  'hover:bg-dark-700'}`}
              title={hasData ? `${pnl.toLocaleString()}` : ''}
            >
              {day}
            </div>
          );
        })}
      </div>

      {/* Today's Stats */}
      <div className="mt-4 pt-4 border-t border-dark-600">
        <div className="text-sm text-gray-400 mb-2">
          {today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-gray-500">Day's P&L</div>
            <div className={`text-lg font-bold ${todayPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {todayPnL >= 0 ? '+' : ''}{todayPnL.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Trades</div>
            <div className="text-lg font-bold">{todayTrades}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Win Rate</div>
            <div className={`text-lg font-bold ${todayWinRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
              {todayWinRate}%
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Quick Stats Component
const QuickStats = ({ trades = [], walletData }) => {
  const closedTrades = trades.filter(t => t.status === 'CLOSED');
  const totalTrades = closedTrades.length;
  const winningTrades = closedTrades.filter(t => (t.pnl || 0) > 0).length;
  const winRate = totalTrades > 0 ? Math.round((winningTrades / totalTrades) * 100) : 0;
  
  const totalProfit = closedTrades.reduce((sum, t) => sum + Math.max(0, t.pnl || 0), 0);
  const totalLoss = closedTrades.reduce((sum, t) => sum + Math.abs(Math.min(0, t.pnl || 0)), 0);
  const avgProfit = winningTrades > 0 ? totalProfit / winningTrades : 0;
  const avgLoss = (totalTrades - winningTrades) > 0 ? totalLoss / (totalTrades - winningTrades) : 0;

  return (
    <div className="bg-dark-800 rounded-xl p-4">
      <h3 className="font-semibold mb-4">Quick Stats</h3>
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-gray-400 text-sm">Total Trades</span>
          <span className="font-medium">{totalTrades}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-gray-400 text-sm">Win Rate</span>
          <span className={`font-medium ${winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>{winRate}%</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-gray-400 text-sm">Avg. Profit</span>
          <span className="font-medium text-green-400">+{avgProfit.toLocaleString()}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-gray-400 text-sm">Avg. Loss</span>
          <span className="font-medium text-red-400">{avgLoss.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
};

// Market News Component with Forex Factory integration
const MarketNews = () => {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulated news - in production, integrate with actual news API
    const mockNews = [
      { id: 1, title: 'Fed Officials Signal Cautious Approach to Rate Cuts in 2026', source: 'Reuters', time: '2h ago', impact: 'high' },
      { id: 2, title: 'Asian Markets Mixed Ahead of US Jobs Data', source: 'Bloomberg', time: '3h ago', impact: 'medium' },
      { id: 3, title: 'Gold Prices Steady as Dollar Weakens', source: 'CNBC', time: '4h ago', impact: 'low' },
      { id: 4, title: 'Oil Rises on Supply Concerns', source: 'Reuters', time: '5h ago', impact: 'medium' },
      { id: 5, title: 'Tech Stocks Lead Wall Street Higher', source: 'MarketWatch', time: '6h ago', impact: 'high' },
    ];
    setNews(mockNews);
    setLoading(false);
  }, []);

  const getImpactColor = (impact) => {
    switch (impact) {
      case 'high': return 'bg-red-500';
      case 'medium': return 'bg-yellow-500';
      default: return 'bg-green-500';
    }
  };

  return (
    <div className="bg-dark-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Newspaper size={18} className="text-blue-400" />
          <h3 className="font-semibold">Market News</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{news.length} articles today</span>
          <span className="flex items-center gap-1 text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
            Live
          </span>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="animate-spin text-gray-400" size={24} />
        </div>
      ) : (
        <div className="space-y-3 max-h-[300px] overflow-y-auto">
          {news.map(item => (
            <div key={item.id} className="flex items-start gap-3 p-2 hover:bg-dark-700 rounded-lg cursor-pointer transition">
              <div className={`w-1 h-full min-h-[40px] rounded ${getImpactColor(item.impact)}`}></div>
              <div className="flex-1">
                <p className="text-sm font-medium line-clamp-2">{item.title}</p>
                <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                  <span>{item.source}</span>
                  <span>•</span>
                  <span>{item.time}</span>
                </div>
              </div>
              <ExternalLink size={14} className="text-gray-500 flex-shrink-0 mt-1" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Economic Calendar Component
const EconomicCalendar = () => {
  const [events, setEvents] = useState([]);
  const today = new Date();

  useEffect(() => {
    // Simulated economic events - integrate with Forex Factory API in production
    const mockEvents = [
      { id: 1, time: '09:00', currency: 'USD', event: 'Non-Farm Payrolls', impact: 'high', forecast: '180K', previous: '175K' },
      { id: 2, time: '14:30', currency: 'EUR', event: 'ECB Interest Rate Decision', impact: 'high', forecast: '4.25%', previous: '4.25%' },
      { id: 3, time: '16:00', currency: 'GBP', event: 'Manufacturing PMI', impact: 'medium', forecast: '52.1', previous: '51.8' },
      { id: 4, time: '18:30', currency: 'USD', event: 'ISM Services PMI', impact: 'medium', forecast: '54.0', previous: '53.8' },
    ];
    setEvents(mockEvents);
  }, []);

  const getImpactBadge = (impact) => {
    const colors = {
      high: 'bg-red-500/20 text-red-400',
      medium: 'bg-yellow-500/20 text-yellow-400',
      low: 'bg-green-500/20 text-green-400'
    };
    return colors[impact] || colors.low;
  };

  return (
    <div className="bg-dark-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Globe size={18} className="text-purple-400" />
          <h3 className="font-semibold">Economic Calendar</h3>
        </div>
        <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-1 rounded">
          {today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
      </div>

      <div className="text-xs text-gray-500 mb-3">{events.length} events today</div>

      <div className="space-y-2 max-h-[250px] overflow-y-auto">
        <div className="grid grid-cols-5 gap-2 text-xs text-gray-500 pb-2 border-b border-dark-600">
          <span>Time</span>
          <span>Cur</span>
          <span className="col-span-2">Event</span>
          <span>Forecast</span>
        </div>
        {events.map(event => (
          <div key={event.id} className="grid grid-cols-5 gap-2 text-sm items-center py-2 hover:bg-dark-700 rounded px-1">
            <span className="text-gray-400">{event.time}</span>
            <span className="font-medium">{event.currency}</span>
            <span className="col-span-2 truncate">{event.event}</span>
            <span className="text-gray-300">{event.forecast}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// TradingView ticker — iframe embed avoids embed-widget-ticker-tape.js racing the iframe
// ("contentWindow is not available"), which is common with React Strict Mode / fast remounts.
const TradingViewWidget = () => {
  const iframeSrc = useMemo(() => {
    const config = {
      symbols: [
        { proName: 'FOREXCOM:SPXUSD', title: 'S&P 500' },
        { proName: 'FOREXCOM:NSXUSD', title: 'US 100' },
        { proName: 'FX_IDC:EURUSD', title: 'EUR/USD' },
        { proName: 'BITSTAMP:BTCUSD', title: 'Bitcoin' },
        { proName: 'BITSTAMP:ETHUSD', title: 'Ethereum' },
        { proName: 'NSE:NIFTY', title: 'NIFTY 50' },
        { proName: 'NSE:BANKNIFTY', title: 'BANK NIFTY' },
      ],
      showSymbolLogo: true,
      colorTheme: 'dark',
      isTransparent: true,
      displayMode: 'adaptive',
      locale: 'en',
    };
    return `https://www.tradingview-widget.com/embed-widget/ticker-tape/?locale=en#${encodeURIComponent(JSON.stringify(config))}`;
  }, []);

  return (
    <div className="h-[50px] overflow-hidden rounded-lg bg-dark-800">
      <iframe
        title="Market ticker"
        src={iframeSrc}
        className="h-full w-full border-0 bg-transparent"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
};

const API_TIMEOUT_MS = 25000;

// Main UserHome Component
const UserHome = () => {
  const { user, loading: authLoading } = useAuth();
  const [walletData, setWalletData] = useState(null);
  const [nseBseSnapshot, setNseBseSnapshot] = useState(null);
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadDashboard = useCallback(async () => {
    if (!user?.token) {
      setLoading(false);
      setFetchError('Not signed in');
      return;
    }

    setLoading(true);
    setFetchError(null);

    const headers = { Authorization: `Bearer ${user.token}` };
    const req = (url) =>
      axios.get(url, { headers, timeout: API_TIMEOUT_MS }).then((r) => r.data).catch((err) => {
        console.error(`[UserHome] ${url}`, err.message);
        throw err;
      });

    try {
      const [walletOutcome, tradesOutcome, nseOutcome] = await Promise.allSettled([
        req('/api/user/wallet'),
        req('/api/trade/history'),
        req('/api/user/funds/nse-bse-wallet').catch(() => null),
      ]);

      if (walletOutcome.status === 'fulfilled') {
        setWalletData(walletOutcome.value);
      } else {
        setWalletData(null);
      }

      if (nseOutcome.status === 'fulfilled' && nseOutcome.value) {
        setNseBseSnapshot(nseOutcome.value);
      } else {
        setNseBseSnapshot(null);
      }

      if (tradesOutcome.status === 'fulfilled') {
        setTrades(Array.isArray(tradesOutcome.value) ? tradesOutcome.value : []);
      } else {
        setTrades([]);
      }

      const walletFailed = walletOutcome.status === 'rejected';
      const tradesFailed = tradesOutcome.status === 'rejected';
      if (walletFailed || tradesFailed) {
        setFetchError(
          walletFailed
            ? 'Could not load wallet. Check that the API server is running (e.g. localhost:5001).'
            : 'Could not load trade history.'
        );
      } else {
        setFetchError(null);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setFetchError(error.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [user?.token]);

  useEffect(() => {
    if (authLoading) return;
    loadDashboard();
  }, [authLoading, loadDashboard]);

  useEffect(() => {
    const onSoftRefresh = () => {
      if (authLoading || !user?.token) return;
      loadDashboard();
    };
    window.addEventListener(AUTO_REFRESH_EVENT, onSoftRefresh);
    return () => window.removeEventListener(AUTO_REFRESH_EVENT, onSoftRefresh);
  }, [loadDashboard, authLoading, user?.token]);

  // Calculate P&L stats
  const closedTrades = trades.filter(t => t.status === 'CLOSED');
  const todayTrades = closedTrades.filter(t => {
    const exitDate = new Date(t.exitTime);
    const today = new Date();
    return exitDate.toDateString() === today.toDateString();
  });
  const todayPnL = todayTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

  // Weekly P&L
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  const weeklyTrades = closedTrades.filter(t => new Date(t.exitTime) >= weekStart);
  const weeklyPnL = weeklyTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

  // Monthly P&L
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthlyTrades = closedTrades.filter(t => new Date(t.exitTime) >= monthStart);
  const monthlyPnL = monthlyTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

  const mainWalletBalance = resolveMainWalletBalance(walletData, nseBseSnapshot);

  const getGreeting = () => {
    const hour = currentTime.getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="animate-spin text-green-400" size={32} />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 overflow-y-auto h-full">
      {fetchError && (
        <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {fetchError}
        </div>
      )}
      {/* Demo Account Banner */}
      {user?.isDemo && (
        <div className="bg-gradient-to-r from-yellow-600/20 to-orange-600/20 border border-yellow-500/30 rounded-xl p-4 mb-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-3xl">🎮</span>
              <div>
                <h3 className="text-yellow-400 font-bold">Demo Account</h3>
                <p className="text-gray-400 text-sm">
                  Virtual balance: {formatInrMainWallet(mainWalletBalance)} • Practice trading without risk
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="bg-yellow-500/20 text-yellow-400 px-3 py-1 rounded-full text-xs font-medium">
                Demo Mode
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">
            {getGreeting()}, {user?.fullName || user?.username}! 👋
            {user?.isDemo && <span className="ml-2 text-yellow-400 text-lg">(Demo)</span>}
          </h1>
          <p className="text-gray-400">Here's your trading overview</p>
        </div>
        <div className="flex items-center gap-4 mt-4 md:mt-0">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Calendar size={16} />
            <span>{currentTime.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Timer size={16} className="text-gray-400" />
            <span className="font-mono">
              {currentTime.toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
                timeZone: 'Asia/Kolkata',
              })}
            </span>
          </div>
        </div>
      </div>

      {/* TradingView Ticker */}
      <div className="mb-6">
        <TradingViewWidget />
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {/* Main Wallet (same as Accounts page) */}
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl p-4 relative overflow-hidden">
          <div className="absolute top-2 right-2">
            <button className="text-xs bg-white/20 hover:bg-white/30 px-2 py-1 rounded transition">
              Deposit
            </button>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
              <Wallet size={20} />
            </div>
          </div>
          <div className="text-sm text-white/70">Main Wallet</div>
          <div className="text-2xl font-bold">{formatInrMainWallet(mainWalletBalance)}</div>
        </div>

        {/* Today's P&L */}
        <div className="bg-gradient-to-br from-green-600 to-emerald-600 rounded-xl p-4 relative overflow-hidden">
          <div className="absolute top-2 right-2">
            <span className="text-xs bg-white/20 px-2 py-1 rounded flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>
              Today
            </span>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
              {todayPnL >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
            </div>
          </div>
          <div className="text-sm text-white/70">Today's P&L</div>
          <div className="text-2xl font-bold">{todayPnL >= 0 ? '+' : ''}{todayPnL.toLocaleString()}</div>
        </div>

        {/* Weekly P&L */}
        <div className="bg-gradient-to-br from-purple-600 to-violet-600 rounded-xl p-4 relative overflow-hidden">
          <div className="absolute top-2 right-2">
            <span className="text-xs bg-white/20 px-2 py-1 rounded flex items-center gap-1">
              <BarChart3 size={12} />
              7 Days
            </span>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
              {weeklyPnL >= 0 ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
            </div>
          </div>
          <div className="text-sm text-white/70">Weekly P&L</div>
          <div className="text-2xl font-bold">{weeklyPnL >= 0 ? '+' : ''}{weeklyPnL.toLocaleString()}</div>
        </div>

        {/* Monthly P&L */}
        <div className="bg-gradient-to-br from-yellow-600 to-orange-600 rounded-xl p-4 relative overflow-hidden">
          <div className="absolute top-2 right-2">
            <span className="text-xs bg-white/20 px-2 py-1 rounded flex items-center gap-1">
              <PieChart size={12} />
              30 Days
            </span>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
              <DollarSign size={20} />
            </div>
          </div>
          <div className="text-sm text-white/70">Monthly P&L</div>
          <div className="text-2xl font-bold">{monthlyPnL >= 0 ? '+' : ''}{monthlyPnL.toLocaleString()}</div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Left Column - News */}
        <div className="md:col-span-1 space-y-6">
          <MarketNews />
        </div>

        {/* Right Column - Stats & Economic Calendar */}
        <div className="md:col-span-1 space-y-6">
          <QuickStats trades={trades} walletData={walletData} />
          <EconomicCalendar />
        </div>
      </div>
    </div>
  );
};

export default UserHome;
