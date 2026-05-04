import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from '../config/axios';
import { AUTO_REFRESH_EVENT } from '../lib/autoRefresh';
import { io as socketIO } from 'socket.io-client';
import LiveChart from '../components/games/LiveChart';
import GamesWalletGameLedgerPanel from '../components/games/GamesWalletGameLedgerPanel.jsx';
import {
  getBtcUpDownWindowState,
  getEffectiveBtcSessionBounds,
  getBtcTradingWindowCount,
  BTC_STANDARD_WINDOWS_PER_IST_DAY,
  currentTotalSecondsIST as currentTotalSecondsISTLib,
  btcResultRefSecForUiWindow,
} from '../../../lib/btcUpDownWindows.js';
import { resolveNiftyUpDownWindow15mOhlcFromCandles } from '../../../lib/niftyUpDownKitePrice.js';
import {
  ArrowLeft, TrendingUp, TrendingDown, Hash, Trophy, Target,
  Timer, Users, Coins, Gamepad2, Zap, Star, Gift, ChevronRight,
  ArrowUpCircle, ArrowDownCircle, RefreshCw, X, Check, AlertCircle, Bitcoin,
  Info, Lock, BookOpen, Award, Crown, HelpCircle, ChevronDown, BarChart3, History, Calendar
} from 'lucide-react';

// Map frontend game IDs to backend GameSettings keys
const GAME_SETTINGS_KEY = {
  'updown': 'niftyUpDown',
  'btcupdown': 'btcUpDown',
  'niftynumber': 'niftyNumber',
  'niftybracket': 'niftyBracket',
  'niftyjackpot': 'niftyJackpot',
  'btcjackpot': 'btcJackpot',
  'btcnumber': 'btcNumber',
};

/** False when global games off, maintenance, game disabled in GameSettings, or hierarchy deny-list */
function isFantasyGamePlayable(gameSettings, uiGameId) {
  if (!gameSettings) return true;
  if (gameSettings.gamesEnabled === false) return false;
  if (gameSettings.maintenanceMode === true) return false;
  const key = GAME_SETTINGS_KEY[uiGameId];
  if (!key) return true;
  const denied = gameSettings.hierarchyDeniedGameKeys;
  if (Array.isArray(denied) && denied.includes(key)) return false;
  const cfg = gameSettings.games?.[key];
  if (cfg && cfg.enabled === false) return false;
  return true;
}

/** Maps games list `game.id` → `GamesWalletLedger.gameId` on the server */
function ledgerGameIdFromUi(uiId) {
  const m = {
    updown: 'updown',
    btcupdown: 'btcupdown',
    niftynumber: 'niftyNumber',
    niftybracket: 'niftyBracket',
    niftyjackpot: 'niftyJackpot',
    btcjackpot: 'btcJackpot',
    btcnumber: 'btcNumber',
  };
  return m[uiId] || uiId;
}

/** INR only — integer in `className` colour, paise (.xx) in red */
function renderInrRedPaise(amount, className) {
  if (amount == null || !Number.isFinite(Number(amount))) {
    return <span className="text-gray-500">—</span>;
  }
  const s = Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dot = s.lastIndexOf('.');
  if (dot === -1) {
    return (
      <span className={`font-bold tabular-nums tracking-tight ${className}`}>₹{s}</span>
    );
  }
  return (
    <span className={`font-bold tabular-nums tracking-tight ${className}`}>
      ₹{s.slice(0, dot)}
      <span className="text-red-500">{s.slice(dot)}</span>
    </span>
  );
}

function formatCompactCount(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return '0';
  if (x >= 1000) return `${(x / 1000).toFixed(1)}K`;
  if (x >= 100) return String(Math.round(x));
  return (Math.round(x * 10) / 10).toLocaleString('en-IN', { maximumFractionDigits: 1 });
}

function formatGamesRelativeTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 15) return 'Just now';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} hr ago`;
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Bet placement instant for Up/Down result cards (Asia/Kolkata). */
function formatBetPlacedAtIST(isoOrDate) {
  if (isoOrDate == null) return '';
  const t = new Date(isoOrDate).getTime();
  if (!Number.isFinite(t)) return '';
  return `${new Date(isoOrDate).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })} IST`;
}


/** Per-game ticketPrice from API, else global tokenValue, else 300 */
function resolveGameTicketPrice(gameSettings, backendGameKey) {
  const tp = gameSettings?.games?.[backendGameKey]?.ticketPrice;
  if (tp != null && tp !== '' && Number.isFinite(Number(tp))) return Number(tp);
  const tv = gameSettings?.tokenValue;
  if (tv != null && tv !== '' && Number.isFinite(Number(tv))) return Number(tv);
  return 300;
}

/** Max rows kept for "Recent Results" (wins only) — only the latest is shown; area scrolls if content overflows. */
const RECENT_UP_DOWN_WINS = 1;

/** Earlier of two placement timestamps (ISO strings or dates). */
function earlierBetPlacedAt(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (!Number.isFinite(ta)) return b;
  if (!Number.isFinite(tb)) return a;
  return ta <= tb ? a : b;
}

/** Up/Down results API returns one ledger row per ticket; merge to one row per window for UI and deduping. */
function aggregateUpdownResultsByWindow(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const wn = r.windowNumber;
    const pnl = Number(r.pnl) || 0;
    if (!map.has(wn)) {
      map.set(wn, { ...r, pnl });
      continue;
    }
    const agg = map.get(wn);
    agg.pnl = (Number(agg.pnl) || 0) + pnl;
    agg.won = agg.won || r.won;
    agg.betPlacedAt = earlierBetPlacedAt(agg.betPlacedAt, r.betPlacedAt);
    const tNew = r.createdAt ? new Date(r.createdAt).getTime() : 0;
    const tOld = agg.createdAt ? new Date(agg.createdAt).getTime() : 0;
    if (tNew > tOld) {
      agg.createdAt = r.createdAt;
      agg.prediction = r.prediction;
      agg.resultPrice = r.resultPrice;
    }
  }
  return Array.from(map.values());
}

const UserGames = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [gamesBalance, setGamesBalance] = useState(0);
  const [activeGame, setActiveGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [gameSettings, setGameSettings] = useState(null);
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [howToPlayGame, setHowToPlayGame] = useState(null);
  const [ledgerHubGameId, setLedgerHubGameId] = useState(null);
  const [showLast5DaysModal, setShowLast5DaysModal] = useState(false);
  const [last5DaysGame, setLast5DaysGame] = useState(null);
  const [last5DaysData, setLast5DaysData] = useState([]);
  const [last5DaysLoading, setLast5DaysLoading] = useState(false);
  const [todayNetByGame, setTodayNetByGame] = useState({});
  const [todayGrossWinsByGame, setTodayGrossWinsByGame] = useState({});
  /** { istDate, games: { [ledgerGameId]: { totalTickets, players, ... } } } */
  const [liveActivity, setLiveActivity] = useState(null);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    } else {
      navigate('/user/login');
    }
  }, [navigate]);

  const fetchGamesBalance = useCallback(async () => {
    if (!user?.token) return;
    try {
      const { data } = await axios.get('/api/user/wallet', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setGamesBalance(data?.gamesWallet?.balance || 0);
    } catch (error) {
      console.error('Error fetching games balance:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const fetchGameSettings = useCallback(async () => {
    if (!user?.token) return;
    try {
      const { data } = await axios.get('/api/user/game-settings', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setGameSettings(data);
    } catch (error) {
      console.error('Error fetching game settings:', error);
    }
  }, [user]);

  /** Per-game net on games wallet for current IST day (credits − debits); new IST day ⇒ new totals from API */
  const fetchTodayNetByGame = useCallback(async () => {
    if (!user?.token) return;
    try {
      const { data } = await axios.get('/api/user/games-wallet/today-net', {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      setTodayNetByGame(data?.byGame && typeof data.byGame === 'object' ? data.byGame : {});
      setTodayGrossWinsByGame(
        data?.byGameGrossWins && typeof data.byGameGrossWins === 'object' ? data.byGameGrossWins : {}
      );
    } catch (e) {
      console.error('Today net by game fetch failed:', e);
      setTodayNetByGame({});
      setTodayGrossWinsByGame({});
    }
  }, [user?.token]);

  const fetchLiveActivity = useCallback(async () => {
    if (!user?.token) return;
    try {
      const { data } = await axios.get('/api/user/games/live-activity', {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (data?.games && typeof data.games === 'object') {
        setLiveActivity(data);
      } else {
        setLiveActivity(null);
      }
    } catch (e) {
      console.warn('Games live activity fetch failed:', e?.message || e);
      setLiveActivity(null);
    }
  }, [user?.token]);

  const fetchLast5DaysData = async (gameId) => {
    setLast5DaysLoading(true);
    try {
      let endpoint;
      if (gameId === 'niftybracket') {
        endpoint = '/api/user/nifty-bracket/last-5-days';
      } else if (gameId === 'niftynumber' || gameId === 'niftyjackpot') {
        endpoint = '/api/user/nifty-jackpot/last-5-days-clearing';
      } else {
        throw new Error('Invalid game for last 5 days data');
      }

      const { data } = await axios.get(endpoint, {
        headers: { Authorization: `Bearer ${user?.token}` }
      });
      setLast5DaysData(data || []);
    } catch (error) {
      console.error('Error fetching last 5 days data:', error);
      setLast5DaysData([]);
    } finally {
      setLast5DaysLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchGamesBalance();
      fetchGameSettings();
      fetchTodayNetByGame();
      fetchLiveActivity();
    }
  }, [user, fetchGamesBalance, fetchGameSettings, fetchTodayNetByGame, fetchLiveActivity]);

  useEffect(() => {
    if (!user) return;
    const onSoftRefresh = () => {
      fetchGamesBalance();
      fetchGameSettings();
      fetchTodayNetByGame();
      fetchLiveActivity();
    };
    window.addEventListener(AUTO_REFRESH_EVENT, onSoftRefresh);
    return () => window.removeEventListener(AUTO_REFRESH_EVENT, onSoftRefresh);
  }, [user, fetchGamesBalance, fetchGameSettings, fetchTodayNetByGame, fetchLiveActivity]);

  useEffect(() => {
    if (!user?.token) return undefined;
    const t = setInterval(() => {
      fetchTodayNetByGame();
    }, 60000);
    return () => clearInterval(t);
  }, [user?.token, fetchTodayNetByGame]);

  useEffect(() => {
    if (!user?.token) return undefined;
    fetchLiveActivity();
    const t = setInterval(fetchLiveActivity, 10000);
    return () => clearInterval(t);
  }, [user?.token, fetchLiveActivity]);

  const [liveWinners, setLiveWinners] = useState([]);
  const [liveWinnersLoading, setLiveWinnersLoading] = useState(false);

  const fetchLiveWinners = useCallback(async () => {
    if (!user?.token) return;
    try {
      const { data } = await axios.get('/api/user/games/recent-winners?limit=15', {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      setLiveWinners(Array.isArray(data?.winners) ? data.winners : []);
    } catch (e) {
      console.error('Live winners fetch failed:', e);
    }
  }, [user?.token]);

  useEffect(() => {
    if (!user?.token) return undefined;
    setLiveWinnersLoading(true);
    fetchLiveWinners().finally(() => setLiveWinnersLoading(false));
    const interval = setInterval(fetchLiveWinners, 20000);
    const onSoft = () => {
      fetchLiveWinners();
    };
    window.addEventListener(AUTO_REFRESH_EVENT, onSoft);
    return () => {
      clearInterval(interval);
      window.removeEventListener(AUTO_REFRESH_EVENT, onSoft);
    };
  }, [user?.token, fetchLiveWinners]);

  useEffect(() => {
    if (!activeGame || !gameSettings) return;
    if (!isFantasyGamePlayable(gameSettings, activeGame)) {
      setActiveGame(null);
    }
  }, [activeGame, gameSettings]);

  useEffect(() => {
    if (activeGame != null || !user?.token) return;
    fetchTodayNetByGame();
  }, [activeGame, user?.token, fetchTodayNetByGame]);

  const games = [
    {
      id: 'updown',
      name: 'Nifty Up/Down',
      description: 'Predict if Nifty will go UP or DOWN over each 15-minute IST window.',
      icon: TrendingUp,
      color: 'from-green-600 to-emerald-600',
      bgColor: 'bg-green-900/20',
      borderColor: 'border-green-500/30',
      prize: '2x Returns',
      players: '1.2K',
      timeframe: '15 Min'
    },
    {
      id: 'btcupdown',
      name: 'BTC Up/Down',
      description: 'Predict if Bitcoin goes UP or DOWN; official result is fixed 15 minutes after each IST trading window.',
      icon: Bitcoin,
      color: 'from-orange-500 to-amber-500',
      bgColor: 'bg-orange-900/20',
      borderColor: 'border-orange-500/30',
      prize: '2x Returns',
      players: '3.1K',
      timeframe: '15 Min'
    },
    {
      id: 'niftynumber',
      name: 'Nifty Number',
      description: 'Pick the decimal (.00-.99) of Nifty closing price & win tickets',
      icon: Hash,
      color: 'from-purple-600 to-indigo-600',
      bgColor: 'bg-purple-900/20',
      borderColor: 'border-purple-500/30',
      prize: 'Ticket Profit',
      players: '850',
      timeframe: '1 Day'
    },
    {
      id: 'niftybracket',
      name: 'Nifty Bracket',
      description: 'Buy or Sell on bracket levels around Nifty price',
      icon: Target,
      color: 'from-cyan-500 to-teal-500',
      bgColor: 'bg-cyan-900/20',
      borderColor: 'border-cyan-500/30',
      prize: '2x Returns',
      players: '1.2K',
      timeframe: '5 Min'
    },
    {
      id: 'niftyjackpot',
      name: 'Nifty Jackpot',
      description: 'Bid high & rank in top 20 to win big prizes!',
      icon: Trophy,
      color: 'from-yellow-500 to-orange-500',
      bgColor: 'bg-yellow-900/20',
      borderColor: 'border-yellow-500/30',
      prize: 'Top Prizes',
      players: '2.5K',
      timeframe: '1 Day'
    },
    {
      id: 'btcjackpot',
      name: 'BTC Jackpot',
      description: 'Predict the BTC USD close — nearest bidders share the Bank at 23:30 IST.',
      icon: Bitcoin,
      color: 'from-yellow-500 to-amber-500',
      bgColor: 'bg-yellow-900/20',
      borderColor: 'border-yellow-500/30',
      prize: 'Top 20 Prizes',
      players: '—',
      timeframe: '1 Day'
    },
    {
      id: 'btcnumber',
      name: 'BTC Number',
      description: 'Pick the decimal (.00–.99) of BTC spot at 23:30 IST & win tickets',
      icon: Hash,
      color: 'from-amber-600 to-orange-600',
      bgColor: 'bg-amber-900/20',
      borderColor: 'border-amber-500/30',
      prize: 'Ticket Profit',
      players: '—',
      timeframe: '1 Day'
    }
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-900 flex items-center justify-center">
        <RefreshCw className="animate-spin text-purple-500" size={32} />
      </div>
    );
  }

  // Show game screen if a game is selected
  if (activeGame) {
    if (activeGame === 'niftynumber') {
      return (
        <NiftyNumberScreen
          game={games.find(g => g.id === activeGame)}
          balance={gamesBalance}
          onBack={() => setActiveGame(null)}
          user={user}
          refreshBalance={fetchGamesBalance}
          settings={gameSettings?.games?.[GAME_SETTINGS_KEY[activeGame]] || null}
          tokenValue={resolveGameTicketPrice(gameSettings, GAME_SETTINGS_KEY[activeGame])}
        />
      );
    }
    if (activeGame === 'btcnumber') {
      return (
        <NiftyNumberScreen
          game={games.find((g) => g.id === activeGame)}
          balance={gamesBalance}
          onBack={() => setActiveGame(null)}
          user={user}
          refreshBalance={fetchGamesBalance}
          settings={gameSettings?.games?.[GAME_SETTINGS_KEY[activeGame]] || null}
          tokenValue={resolveGameTicketPrice(gameSettings, GAME_SETTINGS_KEY[activeGame])}
          apiBase="/api/user/btc-number"
          livePriceGameId="btcupdown"
          resultTimeFallback="23:30"
          clearingLabel="BTC / USDT — reference spot (15m, IST)"
          allDecimals
        />
      );
    }
    if (activeGame === 'niftybracket') {
      return (
        <NiftyBracketScreen
          game={games.find(g => g.id === activeGame)}
          balance={gamesBalance}
          onBack={() => setActiveGame(null)}
          user={user}
          refreshBalance={fetchGamesBalance}
          settings={gameSettings?.games?.[GAME_SETTINGS_KEY[activeGame]] || null}
          tokenValue={resolveGameTicketPrice(gameSettings, GAME_SETTINGS_KEY[activeGame])}
        />
      );
    }
    if (activeGame === 'niftyjackpot') {
      return (
        <NiftyJackpotScreen
          game={games.find(g => g.id === activeGame)}
          balance={gamesBalance}
          onBack={() => setActiveGame(null)}
          user={user}
          refreshBalance={fetchGamesBalance}
          settings={gameSettings?.games?.[GAME_SETTINGS_KEY[activeGame]] || null}
          tokenValue={resolveGameTicketPrice(gameSettings, GAME_SETTINGS_KEY[activeGame])}
        />
      );
    }
    if (activeGame === 'btcjackpot') {
      return (
        <BtcJackpotScreen
          game={games.find(g => g.id === activeGame)}
          balance={gamesBalance}
          onBack={() => setActiveGame(null)}
          user={user}
          refreshBalance={fetchGamesBalance}
          settings={gameSettings?.games?.[GAME_SETTINGS_KEY[activeGame]] || null}
          tokenValue={resolveGameTicketPrice(gameSettings, GAME_SETTINGS_KEY[activeGame])}
        />
      );
    }
    return (
      <GameScreen 
        game={games.find(g => g.id === activeGame)} 
        balance={gamesBalance}
        onBack={() => setActiveGame(null)}
        user={user}
        refreshBalance={fetchGamesBalance}
        settings={gameSettings?.games?.[GAME_SETTINGS_KEY[activeGame]] || null}
        tokenValue={resolveGameTicketPrice(gameSettings, GAME_SETTINGS_KEY[activeGame])}
      />
    );
  }

  return (
    <div className="min-h-screen bg-dark-900 text-white">
      {/* Header */}
      <div className="bg-dark-800 border-b border-dark-600 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button 
                onClick={() => navigate('/user/accounts')}
                className="p-2 hover:bg-dark-700 rounded-lg transition"
              >
                <ArrowLeft size={20} />
              </button>
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-pink-600 rounded-xl flex items-center justify-center">
                  <Gamepad2 size={20} />
                </div>
                <div>
                  <h1 className="font-bold text-lg">Fantasy Games</h1>
                  <p className="text-xs text-gray-400">Predict & Win</p>
                </div>
              </div>
            </div>
            <div className="bg-dark-700 rounded-lg px-4 py-2">
              <div className="text-xs text-gray-400">Balance</div>
              <div className="font-bold text-purple-400">{(gamesBalance / (activeGame ? resolveGameTicketPrice(gameSettings, GAME_SETTINGS_KEY[activeGame]) : (gameSettings?.tokenValue || 300))).toFixed(2)} Tickets</div>
              <div className="text-[10px] text-gray-500">₹{gamesBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Live Nifty Banner */}
      <div className="bg-gradient-to-r from-purple-900/50 to-pink-900/50 border-b border-purple-500/20">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-sm text-gray-300">NIFTY 50</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xl font-bold">24,850.75</span>
              <span className="text-green-400 text-sm flex items-center gap-1">
                <TrendingUp size={14} />
                +125.50 (0.51%)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Games Grid */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h2 className="text-xl font-bold mb-2">Choose Your Game</h2>
          <p className="text-gray-400 text-sm">Play prediction games and win exciting prizes</p>
          {gameSettings?.maintenanceMode === true && (
            <p className="mt-2 text-sm text-amber-400/95">
              {gameSettings.maintenanceMessage || 'Games are temporarily unavailable.'}
            </p>
          )}
          {gameSettings?.gamesEnabled === false && gameSettings?.maintenanceMode !== true && (
            <p className="mt-2 text-sm text-amber-400/95">Fantasy games are currently turned off.</p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {games.map(game => {
            const playable = isFantasyGamePlayable(gameSettings, game.id);
            return (
            <div
              key={game.id}
              className={`${game.bgColor} ${game.borderColor} border rounded-2xl overflow-hidden transition-all duration-200 group relative ${
                playable ? '' : 'opacity-50 grayscale-[0.85]'
              }`}
            >
              <div
                role="button"
                tabIndex={playable ? 0 : -1}
                onClick={() => playable && setActiveGame(game.id)}
                onKeyDown={(e) => {
                  if (!playable) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveGame(game.id);
                  }
                }}
                className={`p-5 ${playable ? 'cursor-pointer hover:scale-[1.01] active:scale-[0.99]' : 'cursor-not-allowed'}`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${game.color} flex items-center justify-center shadow-lg ${playable ? '' : 'opacity-70'}`}>
                    <game.icon size={28} className="text-white" />
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-1 bg-dark-800/50 px-2 py-1 rounded-full">
                      <Zap size={12} className="text-yellow-400" />
                      <span className="text-xs font-medium">{game.prize}</span>
                    </div>
                    {!playable && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 bg-dark-900/80 px-2 py-0.5 rounded">
                        Closed
                      </span>
                    )}
                  </div>
                </div>

                <h3 className={`text-lg font-bold mb-1 ${playable ? '' : 'text-gray-500'}`}>{game.name}</h3>
                <p className={`text-sm mb-3 ${playable ? 'text-gray-400' : 'text-gray-600'}`}>{game.description}</p>

                {(() => {
                  const lid = ledgerGameIdFromUi(game.id);
                  const rawNet = todayNetByGame[lid];
                  const rawGross = todayGrossWinsByGame[lid];
                  const net = Number.isFinite(Number(rawNet)) ? Number(rawNet) : 0;
                  const gross = Number.isFinite(Number(rawGross)) ? Number(rawGross) : 0;
                  const absNet = Math.abs(net);
                  const netFormatted = absNet.toLocaleString('en-IN', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  });
                  const grossFormatted = Math.abs(gross).toLocaleString('en-IN', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  });
                  const netTone =
                    net > 0 ? 'text-emerald-400' : net < 0 ? 'text-rose-400/95' : 'text-gray-500';
                  const grossTone = gross > 0 ? 'text-emerald-400' : 'text-gray-500';
                  return (
                    <div
                      className={`mb-3 rounded-lg px-2.5 py-2 bg-dark-900/50 border border-white/5 ${playable ? '' : 'opacity-80'}`}
                      title="Gross wins = sum of win credits posted today (IST). Net = all credits minus debits for this game today (IST), including stakes."
                    >
                      <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">
                        Total won today (IST)
                      </div>
                      <div className={`text-sm font-bold tabular-nums ${grossTone}`}>
                        {gross > 0 ? '+' : ''}₹{grossFormatted}
                      </div>
                      <div className={`text-[10px] font-medium tabular-nums mt-1 ${netTone}`}>
                        Net today: {net > 0 ? '+' : net < 0 ? '−' : ''}₹{netFormatted}
                      </div>
                      <div className="text-[9px] text-gray-600 mt-0.5 leading-tight">
                        Resets daily at midnight India time
                      </div>
                    </div>
                  );
                })()}

                <div className="flex items-center justify-between">
                  <div className={`flex items-center gap-4 text-xs ${playable ? 'text-gray-500' : 'text-gray-600'}`}>
                    <span
                      className="flex items-center gap-1"
                      title={(() => {
                        const lid = ledgerGameIdFromUi(game.id);
                        const la = liveActivity?.games?.[lid];
                        if (!la) return undefined;
                        if ((lid === 'btcupdown' || lid === 'updown') && la.windowNumber > 0) {
                          return `Window #${la.windowNumber} · UP ${formatCompactCount(la.upTickets || 0)} / DOWN ${formatCompactCount(la.downTickets || 0)} tickets (live)`;
                        }
                        return liveActivity?.istDate
                          ? `Tickets in pool · IST day ${liveActivity.istDate} (all players)`
                          : undefined;
                      })()}
                    >
                      <Users size={12} />
                      {(() => {
                        const lid = ledgerGameIdFromUi(game.id);
                        const la = liveActivity?.games?.[lid];
                        if (!la) return <>{game.players} playing</>;
                        if (la.enabled === false) return <>—</>;
                        if (lid === 'btcupdown' || lid === 'updown') {
                          if (la.status === 'open' && la.windowNumber > 0) {
                            return (
                              <>
                                {formatCompactCount(la.totalTickets)} tickets · {la.players} players
                              </>
                            );
                          }
                          return <>{formatCompactCount(la.totalTickets || 0)} tickets</>;
                        }
                        return (
                          <>
                            {formatCompactCount(la.totalTickets || 0)} tickets · {la.players} players
                          </>
                        );
                      })()}
                    </span>
                    <span className="flex items-center gap-1">
                      <Timer size={12} />
                      {game.timeframe}
                    </span>
                  </div>
                  <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${game.color} flex items-center justify-center transition ${playable ? 'group-hover:scale-110' : 'opacity-40'}`}>
                    <ChevronRight size={16} />
                  </div>
                </div>
              </div>

              <div className="flex border-t border-dark-700">
                {/* Order history button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLedgerHubGameId(game.id);
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-cyan-400 bg-dark-900/40 hover:bg-cyan-500/10 transition"
                >
                  <History size={14} />
                  Order history
                </button>
                
                {/* Last 5 days button - only for Nifty games */}
                {(game.id === 'niftynumber' || game.id === 'niftyjackpot' || game.id === 'niftybracket') && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLast5DaysGame(game.id);
                      setShowLast5DaysModal(true);
                      fetchLast5DaysData(game.id);
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-purple-400 bg-dark-900/40 hover:bg-purple-500/10 transition border-l border-dark-700"
                  >
                    <Calendar size={14} />
                    {game.id === 'niftybracket' ? 'Last 5 LTPs' : 'Last 5 Clearing'}
                  </button>
                )}
              </div>
            </div>
            );
          })}
        </div>

        {/* Per-game wallet ledger (from hub) */}
        {ledgerHubGameId && (() => {
          const g = games.find((x) => x.id === ledgerHubGameId);
          const tv = resolveGameTicketPrice(gameSettings, GAME_SETTINGS_KEY[ledgerHubGameId]);
          return (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
              onClick={() => setLedgerHubGameId(null)}
            >
              <div
                className="bg-dark-800 border border-purple-500/30 rounded-2xl w-full max-w-lg max-h-[88vh] overflow-hidden flex flex-col shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-dark-600 shrink-0">
                  <h2 className="font-bold text-sm flex items-center gap-2 text-purple-300">
                    <History size={16} className="text-purple-400" />
                    Order history — {g?.name || 'Game'}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setLedgerHubGameId(null)}
                    className="p-1.5 hover:bg-dark-700 rounded-lg transition"
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="overflow-y-auto flex-1 min-h-0 p-3">
                  <p className="text-[10px] text-gray-500 mb-2">
                    Full history for this game: pick an IST date to list every wallet line posted that day (bets, wins, refunds).
                  </p>
                  <GamesWalletGameLedgerPanel
                    key={ledgerHubGameId}
                    gameId={ledgerGameIdFromUi(ledgerHubGameId)}
                    userToken={user?.token}
                    tokenValue={tv}
                    title="Orders & ledger"
                    limit={500}
                    defaultOpen
                    enableDateFilter
                    bodyClassName="max-h-[min(24rem,52vh)]"
                  />
                </div>
              </div>
            </div>
          );
        })()}

        {/* Last 5 Days Modal */}
        {showLast5DaysModal && (() => {
          const game = games.find((g) => g.id === last5DaysGame);
          const isLTP = last5DaysGame === 'niftybracket';
          return (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
              onClick={() => setShowLast5DaysModal(false)}
            >
              <div
                className="bg-dark-800 border border-purple-500/30 rounded-2xl w-full max-w-lg max-h-[88vh] overflow-hidden flex flex-col shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-dark-600 shrink-0">
                  <h2 className="font-bold text-sm flex items-center gap-2 text-purple-300">
                    <Calendar size={16} className="text-purple-400" />
                    {isLTP ? 'Last 5 Days LTP' : 'Last 5 Days Clearing'} — {game?.name || 'Game'}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShowLast5DaysModal(false)}
                    className="p-1.5 hover:bg-dark-700 rounded-lg transition"
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="overflow-y-auto flex-1 min-h-0 p-3">
                  {last5DaysLoading ? (
                    <div className="flex items-center justify-center py-8 text-gray-400">
                      <RefreshCw size={20} className="animate-spin mr-2" />
                      Loading data...
                    </div>
                  ) : last5DaysData.length === 0 ? (
                    <div className="text-center py-8 text-gray-400">
                      <Calendar size={48} className="mx-auto mb-4 opacity-30" />
                      <p>No data available for the last 5 days</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[10px] text-gray-500 mb-3">
                        {isLTP
                          ? 'Showing the last traded price (LTP) at market close for the last 5 completed trading days.'
                          : 'Top row (when shown) is the current NIFTY 50 LTP from Kite; rows below are prior session day closes (EOD). Reopen the list to refresh the live row.'}
                      </p>
                      {last5DaysData.map((item, index) => (
                        <div key={index} className="bg-dark-700 rounded-lg p-3 flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium text-gray-300">
                              {new Date(item.date || item.closedAt).toLocaleDateString('en-IN', {
                                weekday: 'short',
                                day: 'numeric',
                                month: 'short'
                              })}
                            </div>
                            <div className="text-xs text-gray-500">
                              {isLTP ? 'LTP at close' : 'Clearing price'}
                            </div>
                            {item.note && (
                              <div className="text-xs text-purple-400 mt-1">
                                {item.note}
                              </div>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-bold text-green-400">
                              ₹{(isLTP ? item.closingLTP : item.closingPrice || item.clearingPrice || item.lockedPrice)?.toLocaleString('en-IN', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            }) || '—'}
                            </div>
                            <div className="text-xs text-gray-500">
                              {new Date(item.date || item.closedAt).toLocaleDateString('en-IN', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric'
                              })}
                            </div>
                            <div className="text-xs text-gray-600 mt-1">
                              {item.source ||
                                (isLTP ? 'LTP API' : item.isLive ? 'Kite LTP' : 'Kite EOD')}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* How to Play - 5 Game Cards */}
        <div className="mt-8 bg-dark-800 rounded-2xl p-5">
          <h3 className="font-bold mb-2 flex items-center gap-2">
            <HelpCircle className="text-cyan-400" size={20} />
            How to Play
          </h3>
          <p className="text-gray-400 text-sm mb-4">Click any game to learn the rules, logic & tips</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {games.map(game => {
              const playable = isFantasyGamePlayable(gameSettings, game.id);
              return (
              <button
                key={game.id}
                type="button"
                onClick={() => setHowToPlayGame(game.id)}
                className={`${game.bgColor} ${game.borderColor} border rounded-xl p-3 text-center transition-all duration-200 group ${
                  playable ? 'hover:scale-105' : 'opacity-45 grayscale'
                }`}
              >
                <div className={`w-10 h-10 mx-auto rounded-lg bg-gradient-to-br ${game.color} flex items-center justify-center shadow-lg mb-2 ${playable ? '' : 'opacity-70'}`}>
                  <game.icon size={20} className="text-white" />
                </div>
                <div className={`text-xs font-bold mb-0.5 ${playable ? '' : 'text-gray-500'}`}>{game.name}</div>
                <div className={`text-[10px] font-medium flex items-center justify-center gap-0.5 ${playable ? 'text-cyan-400' : 'text-gray-600'}`}>
                  <HelpCircle size={10} /> Rules
                </div>
              </button>
              );
            })}
          </div>
        </div>

        {/* How to Play Modal */}
        {howToPlayGame && (() => {
          const tv = gameSettings?.tokenValue || 300;
          const gs = gameSettings?.games?.[GAME_SETTINGS_KEY[howToPlayGame]] || {};
          const tkt = Number(gs.ticketPrice) > 0 ? Number(gs.ticketPrice) : tv;
          /** Align with server: gross = tkt × winMultiplier (else fixedProfit fallback) */
          const niftyBtcDecimalWinGrossDisplay = Number(gs.winMultiplier) > 0
            ? parseFloat((tkt * Number(gs.winMultiplier)).toFixed(2))
            : gs.fixedProfit > 0 ? Number(gs.fixedProfit) : 4000;
          const selectedGame = games.find(g => g.id === howToPlayGame);
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setHowToPlayGame(null)}>
              <div className="bg-dark-800 border border-cyan-500/30 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
                {/* Modal Header */}
                <div className="sticky top-0 bg-dark-800 border-b border-dark-600 rounded-t-2xl px-4 py-3 flex items-center justify-between z-10">
                  <h2 className="font-bold text-sm flex items-center gap-2 text-cyan-400">
                    <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${selectedGame.color} flex items-center justify-center`}>
                      <selectedGame.icon size={14} className="text-white" />
                    </div>
                    How to Play {selectedGame.name}
                  </h2>
                  <button onClick={() => setHowToPlayGame(null)} className="p-1 hover:bg-dark-700 rounded-lg transition">
                    <X size={18} />
                  </button>
                </div>

                <div className="px-4 py-3 space-y-4 text-xs">

                  {/* ===== NIFTY UP/DOWN ===== */}
                  {howToPlayGame === 'updown' && (<>
                    <div>
                      <h3 className="font-bold text-yellow-400 mb-1.5 flex items-center gap-1.5"><Star size={12} /> Game Overview</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Predict whether <span className="text-green-400 font-bold">NIFTY 50</span> will go <span className="text-green-400 font-bold">UP</span> or <span className="text-red-400 font-bold">DOWN</span> after the trading window closes.</li>
                        <li>2. Each trading window lasts <span className="text-cyan-400 font-bold">15 minutes</span>.</li>
                        <li>3. <span className="text-purple-400 font-bold">Result</span> is published <span className="text-cyan-400 font-bold">15 minutes after</span> the window closes.</li>
                        <li>4. If your prediction is correct, you win <span className="text-yellow-400 font-bold">{gs.winMultiplier || 1.95}x</span> your bet amount.</li>
                        <li>5. Once placed, bets <span className="text-red-400 font-bold">cannot be changed, modified or cancelled</span>.</li>
                      </ul>
                    </div>
                    <div>
                      <h3 className="font-bold text-cyan-400 mb-1.5 flex items-center gap-1.5"><Timer size={12} /> Trading Window</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Market hours: <span className="text-cyan-400 font-bold">{gs.startTime || '09:15'} - {gs.endTime || '15:30'} IST</span> (Mon-Fri).</li>
                        <li>2. Window 1: <span className="text-cyan-400 font-bold">11:00:00 – 11:15:00</span> → Result <span className="text-purple-400 font-bold">11:30:00</span></li>
                        <li>3. Window 2: <span className="text-cyan-400 font-bold">11:15:00 – 11:30:00</span> → Result <span className="text-purple-400 font-bold">11:45:00</span></li>
                        <li>4. No gap between windows — next window starts immediately.</li>
                      </ul>
                    </div>
                    <div>
                      <h3 className="font-bold text-purple-400 mb-1.5 flex items-center gap-1.5"><Coins size={12} /> Bet Limits</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Minimum: <span className="text-purple-400 font-bold">{gs.minTickets || 1} Ticket(s)</span></li>
                        <li>2. Maximum: <span className="text-purple-400 font-bold">{gs.maxTickets || 500} Tickets</span></li>
                        <li>3. 1 Ticket = ₹{tv}</li>
                      </ul>
                    </div>
                    <div className="bg-yellow-900/20 border border-yellow-500/20 rounded-xl p-3">
                      <h3 className="font-bold text-yellow-400 mb-1.5 flex items-center gap-1.5"><Crown size={12} /> How You Win</h3>
                      <ul className="text-gray-300 space-y-1.5 pl-1">
                        <li>1. When your betting window ends, the <span className="text-cyan-400 font-bold">reference price</span> is fixed.</li>
                        <li>2. After 15 minutes, the <span className="text-purple-400 font-bold">result price</span> is published and compared to the reference price.</li>
                        <li>3. If result price {'>'} reference price → <span className="text-green-400 font-bold">UP</span> wins!</li>
                        <li>4. If result price {'<'} reference price → <span className="text-red-400 font-bold">DOWN</span> wins!</li>
                        <li>5. If result price = reference price → <span className="text-yellow-400 font-bold">Tie (bet refunded)</span>.</li>
                      </ul>
                      <div className="mt-2 bg-dark-700/60 rounded-lg p-2">
                        <div className="text-[10px] text-yellow-400 font-bold mb-1">Example</div>
                        <div className="text-gray-400">Window 11:00–11:14:59. Reference price = <span className="text-cyan-400 font-bold">22,800</span>. Result 11:30:00 = <span className="text-green-400 font-bold">22,803</span>.</div>
                        <div className="text-green-400 font-bold mt-1">22,803 {'>'} 22,800 → UP wins! You get 10 × {gs.winMultiplier || 1.95} = {(10 * (gs.winMultiplier || 1.95)).toFixed(1)} Tkt (full payout, no fee on profit)</div>
                      </div>
                    </div>
                    <div className="bg-cyan-900/20 border border-cyan-500/20 rounded-xl p-3">
                      <h3 className="font-bold text-cyan-400 mb-1.5 flex items-center gap-1.5"><Info size={12} /> Pro Tips</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Watch the live chart to spot momentum before placing bets.</li>
                        <li>2. Start with small bets to understand the timing.</li>
                        <li>3. Avoid betting during low-volatility sideways markets.</li>
                      </ul>
                    </div>
                  </>)}

                  {/* ===== BTC UP/DOWN ===== */}
                  {howToPlayGame === 'btcupdown' && (<>
                    <div>
                      <h3 className="font-bold text-yellow-400 mb-1.5 flex items-center gap-1.5"><Star size={12} /> Game Overview</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Predict whether <span className="text-orange-400 font-bold">Bitcoin (BTC)</span> will go <span className="text-green-400 font-bold">UP</span> or <span className="text-red-400 font-bold">DOWN</span>.</li>
                        <li>2. Trading runs in an <span className="text-cyan-400 font-bold">IST daily window</span> set by admin (default full day: 00:00–24:00).</li>
                        <li>3. Continuous <span className="text-cyan-400 font-bold">15-minute trading windows</span> with no gaps.</li>
                        <li>4. Win <span className="text-yellow-400 font-bold">{gs.winMultiplier || 1.95}x</span> your bet on a correct prediction.</li>
                      </ul>
                    </div>
                    <div>
                      <h3 className="font-bold text-cyan-400 mb-1.5 flex items-center gap-1.5"><Timer size={12} /> Trading Windows</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Each window is <span className="text-cyan-400 font-bold">15 minutes</span> long (e.g. 00:00–00:14:59, 00:15–00:29:59, ...).</li>
                        <li>2. The official <span className="text-purple-400 font-bold">result</span> is published <span className="text-purple-400 font-bold">15 minutes after</span> the trading window ends.</li>
                        <li>3. The game shows <span className="text-green-400 font-bold">UP</span> or <span className="text-red-400 font-bold">DOWN</span> from that result — pick the right side to win.</li>
                      </ul>
                    </div>
                    <div>
                      <h3 className="font-bold text-purple-400 mb-1.5 flex items-center gap-1.5"><Coins size={12} /> Bet Limits</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Minimum: <span className="text-purple-400 font-bold">{gs.minTickets || 1} Ticket(s)</span></li>
                        <li>2. Maximum: <span className="text-purple-400 font-bold">{gs.maxTickets || 500} Tickets</span></li>
                        <li>3. 1 Ticket = ₹{tv}</li>
                      </ul>
                    </div>
                    <div className="bg-yellow-900/20 border border-yellow-500/20 rounded-xl p-3">
                      <h3 className="font-bold text-yellow-400 mb-1.5 flex items-center gap-1.5"><Crown size={12} /> How You Win</h3>
                      <ul className="text-gray-300 space-y-1.5 pl-1">
                        <li>1. Place your bet (UP or DOWN) during the <span className="text-green-400 font-bold">15-minute window</span>.</li>
                        <li>2. After the window closes, wait for the <span className="text-purple-400 font-bold">scheduled result time</span> — the official outcome is shown then.</li>
                        <li>3. <span className="text-green-400 font-bold">UP</span> or <span className="text-red-400 font-bold">DOWN</span> on the card matches the result; bet on the correct side to win.</li>
                      </ul>
                      <div className="mt-2 bg-dark-700/60 rounded-lg p-2">
                        <div className="text-[10px] text-yellow-400 font-bold mb-1">Example</div>
                        <div className="text-gray-400">Window: 14:00–14:15. You bet <span className="text-purple-400 font-bold">5 Tkt</span> DOWN. Result at 14:30 shows <span className="text-red-400 font-bold">DOWN</span>.</div>
                        <div className="text-green-400 font-bold mt-1">You picked DOWN and the result is DOWN → you win! 5 × {gs.winMultiplier || 1.95} = {(5 * (gs.winMultiplier || 1.95)).toFixed(2)} Tkt (full payout, no fee on profit)</div>
                      </div>
                    </div>
                    <div className="bg-cyan-900/20 border border-cyan-500/20 rounded-xl p-3">
                      <h3 className="font-bold text-cyan-400 mb-1.5 flex items-center gap-1.5"><Info size={12} /> Pro Tips</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. BTC is highly volatile — great for profits but be cautious.</li>
                        <li>2. Once bet is placed, it <span className="text-red-400 font-bold">cannot be cancelled or modified</span>.</li>
                        <li>3. Major news events can cause sudden big moves — trade wisely.</li>
                      </ul>
                    </div>
                  </>)}

                  {/* ===== NIFTY NUMBER ===== */}
                  {howToPlayGame === 'niftynumber' && (<>
                    <div>
                      <h3 className="font-bold text-yellow-400 mb-1.5 flex items-center gap-1.5"><Star size={12} /> Game Overview</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Pick the <span className="text-purple-400 font-bold">last 2 decimal digits</span> (.00 to .99) of the Nifty 50 closing price.</li>
                        <li>2. If the Nifty closes at 24,850<span className="text-yellow-400 font-bold">.75</span>, the winning number is <span className="text-yellow-400 font-bold">75</span>.</li>
                        <li>3. Correct guess wins <span className="text-green-400 font-bold">₹{niftyBtcDecimalWinGrossDisplay.toLocaleString()} gross</span> per winning ticket (<span className="text-cyan-400 font-bold">{gs.winMultiplier != null ? `${tkt}×${gs.winMultiplier}` : `fixed ₹${gs.fixedProfit || 4000}`}</span>), before hierarchy.</li>
                        <li>4. You can place up to <span className="text-cyan-400 font-bold">{gs.betsPerDay || 10} bets per day</span> on different numbers.</li>
                      </ul>
                    </div>
                    <div>
                      <h3 className="font-bold text-cyan-400 mb-1.5 flex items-center gap-1.5"><Timer size={12} /> Timing</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Betting opens: <span className="text-cyan-400 font-bold">{gs.startTime || '09:15'} IST</span>.</li>
                        <li>2. Last bet time: <span className="text-cyan-400 font-bold">{gs.maxBidTime || '15:40'} IST</span>.</li>
                        <li>3. Result declared at: <span className="text-green-400 font-bold">{gs.resultTime || '15:30'} IST</span> (based on Nifty closing price).</li>
                      </ul>
                    </div>
                    <div>
                      <h3 className="font-bold text-purple-400 mb-1.5 flex items-center gap-1.5"><Coins size={12} /> Bet Limits</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Min per bet: <span className="text-purple-400 font-bold">{gs.minTickets || 1} Ticket(s)</span></li>
                        <li>2. Max per bet: <span className="text-purple-400 font-bold">{gs.maxTickets || 100} Tickets</span></li>
                        <li>3. Max bets per day: <span className="text-purple-400 font-bold">{gs.betsPerDay || 10}</span></li>
                        <li>4. 1 Ticket = ₹{tv}</li>
                      </ul>
                    </div>
                    <div className="bg-yellow-900/20 border border-yellow-500/20 rounded-xl p-3">
                      <h3 className="font-bold text-yellow-400 mb-1.5 flex items-center gap-1.5"><Crown size={12} /> How You Win</h3>
                      <ul className="text-gray-300 space-y-1.5 pl-1">
                        <li>1. Pick any number from <span className="text-yellow-400 font-bold">00 to 99</span> from the grid.</li>
                        <li>2. At market close, the last 2 decimals of Nifty closing price are checked.</li>
                        <li>3. If your number matches → <span className="text-green-400 font-bold">You WIN ₹{niftyBtcDecimalWinGrossDisplay.toLocaleString()} gross!</span></li>
                        <li>4. If not → <span className="text-red-400 font-bold">You lose your bet amount.</span></li>
                      </ul>
                      <div className="mt-2 bg-dark-700/60 rounded-lg p-2">
                        <div className="text-[10px] text-yellow-400 font-bold mb-1">Example</div>
                        <div className="text-gray-400">You bet <span className="text-purple-400 font-bold">2 Tkt</span> on number <span className="text-yellow-400 font-bold">75</span>. Nifty closes at 24,850.75.</div>
                        <div className="text-green-400 font-bold mt-1">Result: WIN! You get ₹{niftyBtcDecimalWinGrossDisplay.toLocaleString()} gross credited</div>
                      </div>
                    </div>
                    <div className="bg-cyan-900/20 border border-cyan-500/20 rounded-xl p-3">
                      <h3 className="font-bold text-cyan-400 mb-1.5 flex items-center gap-1.5"><Info size={12} /> Pro Tips</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. There are 100 possible numbers (00-99), so each has a ~1% chance.</li>
                        <li>2. Spread bets across multiple numbers to improve your odds.</li>
                        <li>3. Use smaller bet amounts per number to manage risk.</li>
                      </ul>
                    </div>
                  </>)}

                  {howToPlayGame === 'btcnumber' && (<>
                    <div>
                      <h3 className="font-bold text-yellow-400 mb-1.5 flex items-center gap-1.5"><Star size={12} /> Game Overview</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Pick the <span className="text-amber-400 font-bold">last 2 decimal digits</span> (.00 to .99) of the <span className="text-amber-400 font-bold">BTC / USDT</span> spot at result time (IST).</li>
                        <li>2. If BTC is <span className="text-yellow-400 font-bold">76,123.65</span>, the winning number is <span className="text-yellow-400 font-bold">65</span> (.65).</li>
                        <li>3. Correct guess wins <span className="text-green-400 font-bold">₹{niftyBtcDecimalWinGrossDisplay.toLocaleString()} gross</span> per ticket (same payout rules as Nifty Number).</li>
                        <li>4. You can place up to <span className="text-cyan-400 font-bold">{gs.betsPerDay || 10} bets per day</span> on different numbers.</li>
                      </ul>
                    </div>
                    <div>
                      <h3 className="font-bold text-cyan-400 mb-1.5 flex items-center gap-1.5"><Timer size={12} /> Timing</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Result declared at: <span className="text-green-400 font-bold">{gs.resultTime || '23:30'} IST</span> (from BTC spot locked at that time, same lock as BTC Jackpot when enabled).</li>
                        <li>2. Bidding window follows game settings (start / end / max bid time).</li>
                      </ul>
                    </div>
                    <div>
                      <h3 className="font-bold text-purple-400 mb-1.5 flex items-center gap-1.5"><Coins size={12} /> Bet Limits</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Min per bet: <span className="text-purple-400 font-bold">{gs.minTickets || 1} Ticket(s)</span></li>
                        <li>2. Max per bet: <span className="text-purple-400 font-bold">{gs.maxTickets || 100} Tickets</span></li>
                        <li>3. Max bets per day: <span className="text-purple-400 font-bold">{gs.betsPerDay || 10}</span></li>
                        <li>4. 1 Ticket = ₹{tv}</li>
                      </ul>
                    </div>
                    <div className="bg-amber-900/20 border border-amber-500/20 rounded-xl p-3">
                      <h3 className="font-bold text-amber-400 mb-1.5 flex items-center gap-1.5"><Crown size={12} /> How You Win</h3>
                      <ul className="text-gray-300 space-y-1.5 pl-1">
                        <li>1. Pick a number from the grid; stake routes to the house pool; wins credit your games wallet.</li>
                        <li>2. The winning decimal is taken from the official BTC spot at result time.</li>
                        <li>3. If your number matches → you win the fixed gross prize for that row (see admin settings for hierarchy on G).</li>
                      </ul>
                    </div>
                  </>)}

                  {/* ===== NIFTY BRACKET ===== */}
                  {howToPlayGame === 'niftybracket' && (<>
                    <div>
                      <h3 className="font-bold text-yellow-400 mb-1.5 flex items-center gap-1.5"><Star size={12} /> Game Overview</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Nifty 50 (spot) is used as the <span className="text-gray-300 font-bold">centre</span> to build two levels: <span className="text-green-400 font-bold">upper = spot + spread</span> and <span className="text-red-400 font-bold">lower = spot − spread</span> ({gs.bracketGapType === 'percentage' ? `±${gs.bracketGapPercent || 0.1}%` : `±${gs.bracketGap || 20} pt`}).</li>
                        <li>2. You are not betting on the raw LTP. <span className="text-green-400 font-bold">BUY</span> = bet on the <span className="text-green-400 font-bold">upper</span> line; <span className="text-red-400 font-bold">SELL</span> = bet on the <span className="text-red-400 font-bold">lower</span> line. The order history shows that <span className="text-cyan-300 font-bold">line</span> (and the spot at order, when available).</li>
                        <li>3. If you win, payout is <span className="text-green-400 font-bold">stake × {gs.winMultiplier || 2}</span> (gross; see hierarchy in rules).</li>
                        <li>4. If you do not win by the settlement rule, the stake is <span className="text-red-400 font-bold">lost</span> (no mid-band refund).</li>
                      </ul>
                    </div>
                    <div>
                      <h3 className="font-bold text-cyan-400 mb-1.5 flex items-center gap-1.5"><Timer size={12} /> Timing</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Market hours: <span className="text-cyan-400 font-bold">{gs.startTime || '09:15'} - {gs.endTime || '15:45'} IST</span>.</li>
                        <li>2. Default: one settlement at the result time (e.g. {gs.resultTime || '15:31'} IST) using the latest LTP—live ticks do not close the trade early.</li>
                        <li>3. If intraday (timer) mode is on in settings, a trade can resolve when a band is touched or when the timer ends.</li>
                      </ul>
                    </div>
                    <div>
                      <h3 className="font-bold text-purple-400 mb-1.5 flex items-center gap-1.5"><Coins size={12} /> Bet Limits</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Minimum: <span className="text-purple-400 font-bold">{gs.minTickets || 1} Ticket(s)</span></li>
                        <li>2. Maximum: <span className="text-purple-400 font-bold">{gs.maxTickets || 250} Tickets</span></li>
                        <li>3. 1 Ticket = ₹{tv}</li>
                      </ul>
                    </div>
                    <div className="bg-yellow-900/20 border border-yellow-500/20 rounded-xl p-3">
                      <h3 className="font-bold text-yellow-400 mb-1.5 flex items-center gap-1.5"><Crown size={12} /> How You Win (result time)</h3>
                      <ul className="text-gray-300 space-y-1.5 pl-1">
                        <li>1. If spot is 24,000, upper ≈ 24,020 and lower ≈ 23,980. Your <span className="text-cyan-300 font-bold">line</span> in history is 24,020 for <span className="text-green-400 font-bold">BUY</span> or 23,980 for <span className="text-red-400 font-bold">SELL</span> — not 24,000.</li>
                        <li>2. At result time: <span className="text-green-400 font-bold">BUY</span> wins if LTP is <span className="text-green-400 font-bold">above the upper</span> line; <span className="text-red-400 font-bold">SELL</span> wins if LTP is <span className="text-red-400 font-bold">below the lower</span> line (strict LTP rules follow admin &quot;Strict LTP&quot; toggle).</li>
                        <li>3. Payout: stake × {gs.winMultiplier || 2} on a win; hierarchy may be taken from the Super Admin pool per settings.</li>
                        <li>4. If LTP is on the wrong side of your ref for your side — <span className="text-red-400 font-bold">trade lost</span> (stake not returned).</li>
                      </ul>
                      <div className="mt-2 bg-dark-700/60 rounded-lg p-2">
                        <div className="text-[10px] text-yellow-400 font-bold mb-1">Example</div>
                        <div className="text-gray-400">Spot 24,000 → upper 24,020. LTP at settlement 24,025 &gt; 24,020 — <span className="text-green-400 font-bold">BUY</span> (upper) wins. LTP 23,999 — <span className="text-red-400 font-bold">SELL</span> (lower) wins if LTP &lt; 23,980.</div>
                        <div className="text-green-400 font-bold mt-1">WIN pays stake × {gs.winMultiplier || 2} (gross; per game rules)</div>
                      </div>
                    </div>
                    <div className="bg-cyan-900/20 border border-cyan-500/20 rounded-xl p-3">
                      <h3 className="font-bold text-cyan-400 mb-1.5 flex items-center gap-1.5"><Info size={12} /> Pro Tips</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Trade during <span className="font-bold">high-volatility</span> periods (market open, news events) for better chances.</li>
                        <li>2. The bracket gap is {gs.bracketGapType === 'percentage' ? `${gs.bracketGapPercent || 0.1}%` : `${gs.bracketGap || 20} points`} — trade when Nifty is moving fast!</li>
                        <li>3. Multiple active trades are allowed simultaneously.</li>
                      </ul>
                    </div>
                  </>)}

                  {/* ===== NIFTY JACKPOT ===== */}
                  {howToPlayGame === 'niftyjackpot' && (<>
                    <div>
                      <h3 className="font-bold text-yellow-400 mb-1.5 flex items-center gap-1.5"><Star size={12} /> Game Overview</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. When you play Nifty Jackpot, you can buy any number of tickets, <span className="text-yellow-400 font-bold">one at a time</span>. Enter your <span className="text-yellow-400 font-bold">predicted NIFTY price</span> — your bid is placed at that price.</li>
                        <li>2. Add <span className="text-purple-400 font-bold">1 ticket</span> per tap (repeat for more). All stakes go into the <span className="text-purple-400 font-bold">Kitty</span>.</li>
                        <li>3. Top <span className="text-yellow-400 font-bold">{gs.topWinners || 10}</span> ranked tickets win prizes from the Kitty.</li>
                        <li>4. Daily ticket cap is set by admin (e.g. 100). You can change the predicted price on pending tickets during the bidding window (no cancel).</li>
                      </ul>
                    </div>
                    <div>
                      <h3 className="font-bold text-cyan-400 mb-1.5 flex items-center gap-1.5"><Timer size={12} /> Bidding Window</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Bidding opens at <span className="text-cyan-400 font-bold">{gs.biddingStartTime || gs.startTime || '09:15'} IST</span>.</li>
                        <li>2. Bidding closes at <span className="text-cyan-400 font-bold">{gs.biddingEndTime || '14:59'} IST</span>.</li>
                        <li>3. Results declared at <span className="text-green-400 font-bold">{gs.resultTime || '15:45'} IST</span> (top {gs.topWinners || 10} winners by rank).</li>
                      </ul>
                    </div>
                    <div>
                      <h3 className="font-bold text-purple-400 mb-1.5 flex items-center gap-1.5"><Coins size={12} /> Bid Limits</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Minimum: <span className="text-purple-400 font-bold">{gs.minTickets || 1} Ticket(s)</span> (₹{(gs.minTickets || 1) * tv})</li>
                        <li>2. Maximum: <span className="text-purple-400 font-bold">{gs.maxTickets || 500} Tickets</span> (₹{(gs.maxTickets || 500) * tv})</li>
                        <li>3. 1 Ticket = ₹{tv}</li>
                      </ul>
                    </div>
                    <div className="bg-yellow-900/20 border border-yellow-500/20 rounded-xl p-3">
                      <h3 className="font-bold text-yellow-400 mb-1.5 flex items-center gap-1.5"><Crown size={12} /> Ranking</h3>
                      <ul className="text-gray-300 space-y-1.5 pl-1">
                        <li>1. Live board: each ticket ranks by <span className="text-yellow-400 font-bold">nearest to live NIFTY spot</span>; tie → earlier ticket.</li>
                        <li>2. After close: admin locks the official price; winners rank by <span className="text-yellow-400 font-bold">nearest to that close</span>. Equal distance shares merged rank prizes.</li>
                      </ul>
                      <div className="mt-3 space-y-2">
                        <div className="bg-dark-700/60 rounded-lg p-2">
                          <div className="text-[10px] text-yellow-400 font-bold mb-1">Example: Nearest to spot</div>
                          <div className="text-gray-400 space-y-0.5">
                            <div>Spot <span className="text-cyan-400 font-bold">23,090</span></div>
                            <div>Ticket A: NIFTY <span className="text-cyan-400 font-bold">23,088</span> at 10:20</div>
                            <div>Ticket B: NIFTY <span className="text-cyan-400 font-bold">23,100</span> at 10:19</div>
                          </div>
                          <div className="mt-1 text-green-400 font-bold">Result: Ticket A is higher (smaller distance to spot)</div>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h3 className="font-bold text-green-400 mb-1.5 flex items-center gap-1.5"><Zap size={12} /> Kitty Amount & Prize Pool</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Every bid is added to the <span className="text-purple-400 font-bold">Kitty Amount</span> (grows in real-time).</li>
                        <li>2. The full prize pool is distributed to winners (no platform cut from the kitty).</li>
                        <li>3. Remaining amount is distributed as prizes to top {gs.topWinners || 10} winners.</li>
                      </ul>
                    </div>
                    <div>
                      <h3 className="font-bold text-green-400 mb-1.5 flex items-center gap-1.5"><Award size={12} /> After Result</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. <span className="text-green-400 font-bold">Winners (Top {gs.topWinners || 10}):</span> Bid refunded + prize money.</li>
                        <li>2. <span className="text-red-400 font-bold">Losers:</span> Bid amount is lost.</li>
                      </ul>
                    </div>
                    <div className="bg-cyan-900/20 border border-cyan-500/20 rounded-xl p-3">
                      <h3 className="font-bold text-cyan-400 mb-1.5 flex items-center gap-1.5"><Info size={12} /> Pro Tips</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Aim for tickets <span className="font-bold">closest to the live index</span> for a better live rank.</li>
                        <li>2. <span className="font-bold">Earlier time breaks ties</span> when distance to spot is equal.</li>
                        <li>3. Use <span className="text-purple-400 font-bold">Update NIFTY</span> during the window if you want to refresh your level (stake unchanged).</li>
                        <li>4. Watch <span className="text-purple-400 font-bold">Live Top 5</span> — final prizes use the locked close, not the live board.</li>
                      </ul>
                    </div>
                  </>)}

                  {/* ===== BTC JACKPOT ===== */}
                  {howToPlayGame === 'btcjackpot' && (<>
                    <div>
                      <h3 className="font-bold text-yellow-400 mb-1.5 flex items-center gap-1.5"><Star size={12} /> Game Overview</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. When you play <span className="text-amber-400 font-bold">BTC Jackpot</span>, you can buy any number of tickets, <span className="text-yellow-400 font-bold">one at a time</span>. Enter your <span className="text-yellow-400 font-bold">predicted BTC (USD) price</span> — your bid is placed at that price.</li>
                        <li>2. Add <span className="text-purple-400 font-bold">1 ticket</span> per tap (repeat for more). All stakes go into the <span className="text-purple-400 font-bold">Bank / prize pool</span>.</li>
                        <li>3. Top <span className="text-yellow-400 font-bold">{gs.topWinners || 20}</span> ranked tickets win prizes from the pool.</li>
                        <li>4. Daily ticket cap is set by admin (e.g. {gs.bidsPerDay || 200}). You can change the predicted price on pending tickets during the bidding window (no cancel).</li>
                      </ul>
                    </div>
                    <div>
                      <h3 className="font-bold text-cyan-400 mb-1.5 flex items-center gap-1.5"><Timer size={12} /> Bidding Window</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Bidding opens at <span className="text-cyan-400 font-bold">{gs.biddingStartTime || '00:00'} IST</span>.</li>
                        <li>2. Bidding closes at <span className="text-cyan-400 font-bold">{gs.biddingEndTime || '23:29'} IST</span>.</li>
                        <li>3. After bidding closes, BTC is locked and results settle for the top {gs.topWinners || 20} ranks (auto or admin declare).</li>
                      </ul>
                    </div>
                    <div>
                      <h3 className="font-bold text-purple-400 mb-1.5 flex items-center gap-1.5"><Coins size={12} /> Bid Limits</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Minimum: <span className="text-purple-400 font-bold">{gs.minTickets || 1} Ticket(s)</span> (₹{((gs.minTickets || 1) * tkt).toLocaleString('en-IN')})</li>
                        <li>2. Maximum: <span className="text-purple-400 font-bold">{gs.maxTickets != null && gs.maxTickets > 0 ? gs.maxTickets : 5000} Tickets</span> (₹{((gs.maxTickets != null && gs.maxTickets > 0 ? gs.maxTickets : 5000) * tkt).toLocaleString('en-IN')})</li>
                        <li>3. 1 Ticket = ₹{tkt.toLocaleString('en-IN')}</li>
                      </ul>
                    </div>
                    <div className="bg-amber-900/20 border border-amber-500/25 rounded-xl p-3">
                      <h3 className="font-bold text-amber-400 mb-1.5 flex items-center gap-1.5"><Crown size={12} /> Ranking</h3>
                      <ul className="text-gray-300 space-y-1.5 pl-1">
                        <li>1. Live board: each ticket ranks by <span className="text-amber-300 font-bold">nearest to live BTC / USDT spot</span>; tie → earlier ticket.</li>
                        <li>2. After close: the <span className="text-amber-300 font-bold">official price is locked</span> for the day; winners rank by nearest to that close. Equal distance shares merged rank prizes.</li>
                      </ul>
                      <div className="mt-3 space-y-2">
                        <div className="bg-dark-700/60 rounded-lg p-2">
                          <div className="text-[10px] text-amber-400 font-bold mb-1">Example: Nearest to spot</div>
                          <div className="text-gray-400 space-y-0.5">
                            <div>Spot <span className="text-amber-300 font-bold">$77,584</span></div>
                            <div>Ticket A: BTC <span className="text-amber-300 font-bold">$77,580</span> at 10:20</div>
                            <div>Ticket B: BTC <span className="text-amber-300 font-bold">$77,600</span> at 10:19</div>
                          </div>
                          <div className="mt-1 text-green-400 font-bold">Result: Ticket A is higher rank (smaller distance to spot)</div>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h3 className="font-bold text-green-400 mb-1.5 flex items-center gap-1.5"><Zap size={12} /> Bank & prize pool</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Every bid is added to the <span className="text-amber-300 font-bold">day&apos;s bank</span> (pool grows in real time).</li>
                        <li>2. Prizes are paid from the bank by rank; configuration is set by admin (per-rank % of the pool).</li>
                        <li>3. Top {gs.topWinners || 20} ranks share the distributed prizes (ties split as per game rules).</li>
                      </ul>
                    </div>
                    <div>
                      <h3 className="font-bold text-green-400 mb-1.5 flex items-center gap-1.5"><Award size={12} /> After result</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. <span className="text-green-400 font-bold">Winners (Top {gs.topWinners || 20}):</span> games wallet is credited the rank prize; hierarchy is settled per admin settings.</li>
                        <li>2. <span className="text-red-400 font-bold">Losers:</span> stake was pooled at bid time and does not return.</li>
                      </ul>
                    </div>
                    <div className="bg-cyan-900/20 border border-cyan-500/20 rounded-xl p-3">
                      <h3 className="font-bold text-cyan-400 mb-1.5 flex items-center gap-1.5"><Info size={12} /> Pro Tips</h3>
                      <ul className="text-gray-300 space-y-1 pl-1">
                        <li>1. Aim for tickets <span className="font-bold">closest to the live BTC spot</span> for a better live rank.</li>
                        <li>2. <span className="font-bold">Earlier time breaks ties</span> when distance to spot is equal.</li>
                        <li>3. Use <span className="text-amber-400 font-bold">update</span> on a pending ticket during the window if you want to change your predicted price (stake unchanged).</li>
                        <li>4. Watch the <span className="text-amber-400 font-bold">live leaderboard</span> — <span className="font-bold">final prizes</span> use the <span className="font-bold">locked close at result time</span>, not the live board.</li>
                      </ul>
                    </div>
                  </>)}

                </div>

                {/* Close Button */}
                <div className="sticky bottom-0 bg-dark-800 border-t border-dark-600 rounded-b-2xl px-4 py-3">
                  <button
                    onClick={() => setHowToPlayGame(null)}
                    className="w-full py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-black font-bold rounded-xl text-sm transition-all"
                  >
                    Got it!
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Live winners — real ledger payouts (all games) */}
        <div className="mt-6 bg-dark-800 rounded-2xl p-5">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className="font-bold flex items-center gap-2">
              <Star className="text-yellow-400" size={20} />
              Live winners
            </h3>
            <button
              type="button"
              onClick={() => {
                setLiveWinnersLoading(true);
                fetchLiveWinners().finally(() => setLiveWinnersLoading(false));
              }}
              disabled={liveWinnersLoading}
              className="p-1.5 rounded-lg text-purple-400 hover:bg-dark-700 disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw size={14} className={liveWinnersLoading ? 'animate-spin' : ''} />
            </button>
          </div>
          <p className="text-[11px] text-gray-500 mb-3">
            Real names and win amounts from games wallet credits · refreshes automatically
          </p>
          <div className="space-y-3">
            {liveWinnersLoading && liveWinners.length === 0 ? (
              <div className="text-center text-gray-500 text-sm py-6">Loading winners…</div>
            ) : liveWinners.length === 0 ? (
              <div className="text-center text-gray-500 text-sm py-6">
                No recent wins yet. Play any game to see payouts here.
              </div>
            ) : (
              liveWinners.map((w) => (
                <div
                  key={w.id}
                  className="flex items-center justify-between p-3 bg-dark-700 rounded-lg"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-500 to-orange-500 flex items-center justify-center shrink-0">
                      <Trophy size={14} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{w.displayName}</div>
                      <div className="text-xs text-gray-400 truncate">{w.game}</div>
                    </div>
                  </div>
                  <div className="text-right shrink-0 pl-2">
                    <div className="text-green-400 font-bold tabular-nums">
                      +₹{Number(w.amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </div>
                    <div className="text-xs text-gray-500 whitespace-nowrap">
                      {formatGamesRelativeTime(w.createdAt)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ==================== TRADING WINDOW LOGIC ====================
// Trading windows: 9:15:00-9:29:59, 9:30:00-9:44:59, … (session start snapped to a full minute).
// Nifty: **LTP** = last second of the betting leg (…:59:59); **Result** = next quarter-hour **:00** (D+1s after that LTP second).
// Market hours: 9:15 AM to 3:30 PM IST

const DEFAULT_MARKET_OPEN = '09:15:00';
const DEFAULT_MARKET_CLOSE = '15:30:00';
const DEFAULT_BTC_MARKET_OPEN = '00:00:01';
/** Last result tick 23:45:00 IST; 24:00:00 in admin settings is treated as this cap in window math */
const DEFAULT_BTC_MARKET_CLOSE = '23:45:00';
/** Default Nifty round leg when settings not loaded (seconds); must match server default (900 = 15m). */
const DEFAULT_NIFTY_ROUND_DURATION_SEC = 900;
/** Nifty Up/Down: always 15-minute legs in UI (same as server getNiftyRoundDurationSec). */
const NIFTY_UP_DOWN_MIN_ROUND_SEC = 900;
const WINDOW_OFFSET_SEC = 0;    // No gap between windows

/** Persisted chart TF to match Zerodha Kite (NIFTY 50 index, token 256265). */
const LS_NIFTY_KITE_CHART_INTERVAL = 'stockex_nifty_kite_chart_interval';
const NIFTY_KITE_CHART_OPTIONS = [
  { kite: '5minute', label: '5m' },
  { kite: '15minute', label: '15m' },
  { kite: '30minute', label: '30m' },
  { kite: '60minute', label: '1h' },
];

/** Persisted chart TF for BTC up/down */
const LS_BTC_CHART_INTERVAL = 'stockex_btc_chart_interval';
const BTC_CHART_OPTIONS = [
  { interval: '5m', label: '5m' },
  { interval: '15m', label: '15m' },
  { interval: '30m', label: '30m' },
  { interval: '1h', label: '1h' },
];

// Parse "HH:MM" or "HH:MM:SS" into total seconds since midnight
const parseTimeToSec = (timeStr) => {
  const parts = (timeStr || '').split(':').map(Number);
  return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
};

/** Seconds since midnight in Asia/Kolkata (correct for any client TZ). */
const getTotalSecondsIST = () => {
  const t = new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
  });
  const parts = t.split(':').map((x) => parseInt(x, 10));
  const h = parts[0] || 0;
  const m = parts[1] || 0;
  const s = parts[2] || 0;
  return h * 3600 + m * 60 + s;
};

const isWeekendIST = () => {
  const wd = new Date().toLocaleDateString('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
  });
  return wd === 'Sat' || wd === 'Sun';
};

/** NSE cash Mon–Fri 9:15–15:30 IST — live index stream expected */
const isNseCashMarketOpen = () => {
  if (isWeekendIST()) return false;
  const sec = getTotalSecondsIST();
  const open = parseTimeToSec('09:15:00');
  const close = parseTimeToSec('15:30:00');
  return sec >= open && sec < close;
};

const formatTime = (hours, minutes, seconds) => {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const formatIstClockFromSec = (totalSec) => {
  if (!Number.isFinite(totalSec)) return '';
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  return formatTime(hh, mm, ss);
};

/** Snapped session open (seconds since midnight IST); matches server `getEffectiveNiftySessionBounds`. */
const niftyMarketOpenSnappedSecForGame = (openTime) => {
  let s = parseTimeToSec(openTime || DEFAULT_MARKET_OPEN);
  return Math.floor(s / 60) * 60;
};

/**
 * Kite 15m candle **close** for the bar when window `prevWinNum` completes (same as server settlement).
 */
async function fetchKite15mCloseForCompletedWindow(prevWinNum, gameStartTime, roundDurationSec) {
  const m = niftyMarketOpenSnappedSecForGame(gameStartTime);
  const D = Math.max(
    NIFTY_UP_DOWN_MIN_ROUND_SEC,
    Number(roundDurationSec) || DEFAULT_NIFTY_ROUND_DURATION_SEC
  );
  const ymd = getIstCalendarYmd();
  try {
    const { data } = await axios.get('/api/market/nifty-history', { params: { interval: '15minute' } });
    const rows = Array.isArray(data) ? data : data?.data;
    if (!rows || rows.length === 0) return null;
    const bar = resolveNiftyUpDownWindow15mOhlcFromCandles(
      { ymd, marketOpenSec: m, roundDurationSec: D, windowNumber: prevWinNum },
      rows
    );
    const cl = bar?.close;
    if (cl != null && Number.isFinite(cl) && cl > 0) return cl;
  } catch (e) {
    console.warn('[NiftyUpDown] Kite 15m close lookup failed', e);
  }
  return null;
}

/**
 * Matches LiveChart `candleSeries.update`: merge live LTP into the last OHLC row (same forming bar as chart strip C).
 * Used so "Last 1 Hour LTPs" resolves the same `.close` as the visible chart — not a stale REST-only snapshot.
 */
function mergeNiftyLiveIntoLastCandle(rows, livePx) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const p = Number(livePx);
  if (!Number.isFinite(p) || p <= 0) return rows;
  const out = rows.map((r) => ({ ...r }));
  const last = out[out.length - 1];
  const o = Number(last.open);
  const hi = Number(last.high);
  const lo = Number(last.low);
  const open = Number.isFinite(o) ? o : p;
  const high = Math.max(Number.isFinite(hi) ? hi : open, p);
  const low = Math.min(Number.isFinite(lo) ? lo : open, p);
  out[out.length - 1] = {
    ...last,
    open,
    high,
    low,
    close: p,
  };
  return out;
}

/** Last second of betting window `winNum` (1-based) — LTP clock. */
const niftyLtpEndSecForWindowNum = (winNum, openTime, roundDurationSec) => {
  const m = niftyMarketOpenSnappedSecForGame(openTime);
  const D = Math.max(
    NIFTY_UP_DOWN_MIN_ROUND_SEC,
    Number(roundDurationSec) || DEFAULT_NIFTY_ROUND_DURATION_SEC,
  );
  return m + winNum * D;
};

/** Scheduled LTP instant for window `winNum` (1-based), at start of next window. */
const niftyOpenFixSecForWindowNum = (winNum, openTime, roundDurationSec) => {
  const m = niftyMarketOpenSnappedSecForGame(openTime);
  const D = Math.max(
    NIFTY_UP_DOWN_MIN_ROUND_SEC,
    Number(roundDurationSec) || DEFAULT_NIFTY_ROUND_DURATION_SEC,
  );
  return m + winNum * D;
};

/** Scheduled result instant for window `winNum` (1-based), at start of window winNum+1. */
const niftyResultSecForWindowNum = (winNum, openTime, roundDurationSec) => {
  const m = niftyMarketOpenSnappedSecForGame(openTime);
  const D = Math.max(
    NIFTY_UP_DOWN_MIN_ROUND_SEC,
    Number(roundDurationSec) || DEFAULT_NIFTY_ROUND_DURATION_SEC,
  );
  return m + (winNum + 1) * D;
};

const formatCountdown = (totalSec) => {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const getTradingWindowInfo = (openTime, closeTime, roundDurationSec = DEFAULT_NIFTY_ROUND_DURATION_SEC) => {
  const currentSec = getTotalSecondsIST();

  let marketOpenSec = parseTimeToSec(openTime || DEFAULT_MARKET_OPEN);
  marketOpenSec = Math.floor(marketOpenSec / 60) * 60;
  const marketCloseSec = parseTimeToSec(closeTime || DEFAULT_MARKET_CLOSE);
  const D = Math.max(NIFTY_UP_DOWN_MIN_ROUND_SEC, Number(roundDurationSec) || DEFAULT_NIFTY_ROUND_DURATION_SEC);

  const openH = Math.floor(marketOpenSec / 3600);
  const openM = Math.floor((marketOpenSec % 3600) / 60);
  const openS = marketOpenSec % 60;

  if (currentSec < marketOpenSec) {
    return {
      status: 'pre_market',
      message: 'Market not yet open',
      nextWindowStart: formatTime(openH, openM, openS),
      countdown: marketOpenSec - currentSec,
      windowNumber: 0,
      canTrade: false,
      roundDurationSec: D,
    };
  }

  if (currentSec >= marketCloseSec) {
    return {
      status: 'post_market',
      message: 'Market closed for today',
      nextWindowStart: `Tomorrow ${formatTime(openH, openM, openS)}`,
      countdown: 0,
      windowNumber: 0,
      canTrade: false,
      roundDurationSec: D,
    };
  }

  const secSinceMarketOpen = currentSec - marketOpenSec;
  const windowIndex = Math.floor(secSinceMarketOpen / D);
  const windowStartSec = marketOpenSec + windowIndex * D;
  const windowEndSec = marketOpenSec + (windowIndex + 1) * D;
  const ltpTimeSec = marketOpenSec + (windowIndex + 1) * D;
  const resultTimeSec = marketOpenSec + (windowIndex + 2) * D;

  if (windowEndSec >= marketCloseSec) {
    return {
      status: 'post_market',
      message: 'Market closed for today',
      nextWindowStart: `Tomorrow ${formatTime(openH, openM, openS)}`,
      countdown: 0,
      windowNumber: 0,
      canTrade: false,
      roundDurationSec: D,
    };
  }

  const fmtSec = (s) => formatTime(Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60);

  return {
    status: 'open',
    message: 'Trading Window Open',
    windowStart: fmtSec(windowStartSec),
    windowEnd: fmtSec(windowEndSec),
    ltpTime: fmtSec(ltpTimeSec),
    resultTime: fmtSec(resultTimeSec),
    windowStartSec,
    ltpTimeSec,
    resultTimeSec,
    windowEndSec,
    countdown: windowEndSec - currentSec,
    windowNumber: windowIndex + 1,
    canTrade: true,
    roundDurationSec: D,
  };
};

// ==================== BTC TRADING WINDOW (IST) ====================
// 15-minute IST trading windows; official result time 15 min after window ends.
const getBTCWindowInfo = (openTime, closeTime) => {
  const gameCfg = {
    startTime: openTime || DEFAULT_BTC_MARKET_OPEN,
    endTime: closeTime || DEFAULT_BTC_MARKET_CLOSE,
  };
  const nowSec = currentTotalSecondsISTLib();
  const st = getBtcUpDownWindowState(nowSec, gameCfg);

  const fmtSec = (totalSec) => {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const sec = totalSec % 60;
    return formatTime(h, m, sec);
  };

  const { startSec } = getEffectiveBtcSessionBounds(gameCfg);

  if (st.status === 'pre_market') {
    const openH = Math.floor(startSec / 3600);
    const openM = Math.floor((startSec % 3600) / 60);
    const openS = startSec % 60;
    return {
      ...st,
      message: 'Trading not open yet',
      nextWindowStart: formatTime(openH, openM, openS),
      countdown: st.countdown ?? startSec - nowSec,
      canTrade: false,
    };
  }
  if (st.status === 'post_market') {
    const openH = Math.floor(startSec / 3600);
    const openM = Math.floor((startSec % 3600) / 60);
    const openS = startSec % 60;
    return {
      ...st,
      message: 'Trading closed for today',
      nextWindowStart: `Tomorrow ${formatTime(openH, openM, openS)}`,
      canTrade: false,
    };
  }
  if (st.status === 'cooldown') {
    // On the exact result second (e.g. :15/:30), state is "cooldown" with windowNumber:0; advance +1s so UI shows the open next round.
    const stNext = getBtcUpDownWindowState(Math.min(nowSec + 1, 86400), gameCfg);
    if (stNext.status === 'open') {
      const canTrade = nowSec >= stNext.windowStartSec;
      const re = stNext.resultEpoch;
      return {
        ...stNext,
        canTrade,
        message: canTrade ? 'Trading Window Open' : 'Result fixed (DB) — next round opens in 1s',
        windowStart: fmtSec(stNext.windowStartSec),
        windowEnd: fmtSec(stNext.windowEndSec),
        windowOpenSec: stNext.windowStartSec,
        resultTime: fmtSec(stNext.resultTimeSec),
        resultEpoch: re,
        settleTimeSec: stNext.settleTimeSec,
        settleEpoch: re + 1000,
      };
    }
    return {
      ...st,
      canTrade: false,
      message: st.resultSecondForWindow
        ? 'Result at quarter-hour — no betting this second'
        : 'Between windows (IST)',
    };
  }

  const resultEpoch = st.resultEpoch;
  const settleEpoch = resultEpoch + 1000;

  return {
    ...st,
    message: 'Trading Window Open',
    windowStart: fmtSec(st.windowStartSec),
    windowEnd: fmtSec(st.windowEndSec),
    windowOpenSec: st.windowStartSec,
    resultTime: fmtSec(st.resultTimeSec),
    resultEpoch,
    settleTimeSec: st.settleTimeSec,
    settleEpoch,
  };
};

// Instructions Modal Component
const InstructionsModal = ({ onClose, gameId }) => {
  const isNifty = gameId === 'updown';
  const isBTCModal = gameId === 'btcupdown';
  const btcWindowCount = isBTCModal
    ? getBtcTradingWindowCount({ startTime: '00:00:01', endTime: '23:45:00' })
    : 0;
  const windowExamples = isBTCModal
    ? [
        { window: '1st', open: '00:00:01', close: '00:14:59', result: '00:15:00' },
        { window: '2nd', open: '00:15:01', close: '00:29:59', result: '00:30:00' },
        { window: '3rd', open: '00:30:01', close: '00:44:59', result: '00:45:00' },
        { window: '4th', open: '00:45:01', close: '00:59:59', result: '01:00:00' },
      ]
    : [
        { window: '1st', open: '11:00:00', close: '11:15:00', result: '11:30:00' },
        { window: '2nd', open: '11:15:00', close: '11:30:00', result: '11:45:00' },
        { window: '3rd', open: '11:30:00', close: '11:45:00', result: '12:00:00' },
        { window: '4th', open: '11:45:00', close: '12:00:00', result: '12:15:00' },
      ];
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-dark-800 rounded-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-dark-800 p-5 pb-3 border-b border-dark-600 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <BookOpen size={20} className="text-purple-400" />
            How to Play
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-dark-700 rounded-lg transition">
            <X size={18} />
          </button>
        </div>
        
        <div className="p-5 space-y-5">
          {/* Trading Window Schedule */}
          <div>
            <h3 className="font-bold text-green-400 mb-2 flex items-center gap-2">
              <Timer size={16} />
              Trading Window Schedule
            </h3>
            <div className="bg-dark-700 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Market Hours</span>
                <span className="font-medium">{isBTCModal ? 'IST 00:00:01 – session ends 23:45:00 (15-minute rounds)' : '9:15 AM - 3:30 PM IST'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Window Duration</span>
                <span className="font-medium">15 Minutes</span>
              </div>
              {isBTCModal && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Windows per IST day</span>
                  <span className="font-medium text-orange-300">
                    {btcWindowCount === BTC_STANDARD_WINDOWS_PER_IST_DAY
                      ? `${BTC_STANDARD_WINDOWS_PER_IST_DAY} (#1–#${BTC_STANDARD_WINDOWS_PER_IST_DAY})`
                      : `${btcWindowCount} (admin end time changes total)`}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-400">Result time</span>
                <span className="font-medium">
                  {isBTCModal
                    ? '15 minutes after each trading window ends'
                    : '15 minutes after window closes'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Gap Between Windows</span>
                <span className="font-medium text-green-400">None (continuous)</span>
              </div>
            </div>
          </div>

          {/* Window Examples */}
          <div>
            <h3 className="font-bold text-blue-400 mb-2 flex items-center gap-2">
              <Timer size={16} />
              Window Examples
            </h3>
            <div className="space-y-2 text-sm">
              {windowExamples.map((w, i) => (
                <div key={i} className="bg-dark-700 rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <span className="text-purple-400 font-medium">{w.window} Window</span>
                    <div className="text-gray-400 text-xs mt-0.5">{w.open} → {w.close}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-yellow-400 font-medium text-xs">Result @ {w.result}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Rules */}
          <div>
            <h3 className="font-bold text-yellow-400 mb-2 flex items-center gap-2">
              <AlertCircle size={16} />
              Rules
            </h3>
            <ul className="space-y-2 text-sm text-gray-300">
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">1.</span>
                <span>You can only place trades during an <strong className="text-white">open trading window</strong>.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">2.</span>
                <span>Predict whether {isNifty ? 'NIFTY 50' : 'BTC/USDT'} will go <strong className="text-green-400">UP</strong> or <strong className="text-red-400">DOWN</strong>.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">3.</span>
                {isBTCModal ? (
                  <span>
                    The <strong className="text-cyan-400">reference price</strong> is fixed at the end of your betting window. The <strong className="text-purple-400">official result price</strong> is published 15 minutes later. If result is <strong>strictly higher</strong> → UP wins; <strong>strictly lower</strong> → DOWN wins (exact tie → both sides lose).
                  </span>
                ) : (
                  <span>
                    <strong className="text-cyan-400">LTP</strong> is Nifty&apos;s last traded price when your window ends. <strong className="text-purple-400">Result</strong> is Nifty <strong className="text-purple-400">LTP (spot)</strong> 15 minutes later — the <strong className="text-purple-400">same price and time as the next window&apos;s LTP</strong>. If Result is <strong>strictly higher</strong> than your window LTP → UP wins; <strong>strictly lower</strong> → DOWN wins (exact tie → both sides lose).
                  </span>
                )}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">4.</span>
                <span>
                  If your prediction is correct, your games wallet is credited the <strong className="text-purple-400">full gross win</strong> (stake × multiplier, e.g. ₹300 at 1.95× → <strong className="text-white">₹585</strong>).
                  {isBTCModal && (
                    <> Brokerage for your hierarchy is paid from the <strong className="text-orange-300">house pool</strong>, not subtracted from that amount.</>
                  )}
                  {!isBTCModal && (
                    <> Hierarchy/brokerage is handled from the platform side and does not reduce your credited win.</>
                  )}
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">5.</span>
                <span>Once a trade is placed, it <strong className="text-white">cannot be cancelled or modified</strong>.</span>
              </li>
            </ul>
          </div>

          {/* Tip */}
          <div className="bg-purple-900/20 border border-purple-500/30 rounded-xl p-4 text-sm">
            <div className="font-bold text-purple-400 mb-1">Pro Tip</div>
            <p className="text-gray-300">Watch the live price movement during the trading window before placing your prediction. The countdown timer shows how much time is left in the current window.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

/** When Zerodha/socket has no ticks, use last historical close or this LTP (override via VITE_DUMMY_NIFTY_PRICE). */
const DUMMY_NIFTY_LTP = Number(import.meta.env.VITE_DUMMY_NIFTY_PRICE) || 24050.07;

/** IST calendar date YYYY-MM-DD (for LTP tape daily bucket). */
function getIstCalendarYmd() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  if (year && month && day) return `${year}-${month}-${day}`;
  // Safe fallback (should rarely hit)
  return new Date().toISOString().slice(0, 10);
}

const NIFTY_BRACKET_LTP_TAPE_LS = 'stockex_niftyBracket_ltpTape_v1';
const NIFTY_BRACKET_LTP_TAPE_MAX = 10000;
const NIFTY_UPDOWN_WINDOW_LTP_LS = 'stockex_niftyUpdown_windowLtp_v1';

function ltpTapeStorageKeyForIstDate(ymd) {
  return `${NIFTY_BRACKET_LTP_TAPE_LS}_${ymd}`;
}

function loadLtpTapeFromStorageForToday() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const ymd = getIstCalendarYmd();
    const raw = localStorage.getItem(ltpTapeStorageKeyForIstDate(ymd));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const rows = parsed?.rows;
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((r) => r && r.id && Number.isFinite(Number(r.price)))
      .slice(0, NIFTY_BRACKET_LTP_TAPE_MAX);
  } catch {
    return [];
  }
}

function saveLtpTapeToStorage(rowsNewestFirst) {
  if (typeof localStorage === 'undefined') return;
  try {
    const ymd = getIstCalendarYmd();
    const capped = rowsNewestFirst.slice(0, NIFTY_BRACKET_LTP_TAPE_MAX);
    localStorage.setItem(
      ltpTapeStorageKeyForIstDate(ymd),
      JSON.stringify({ v: 1, savedAt: Date.now(), rows: capped })
    );
  } catch {
    /* quota or private mode */
  }
}

function windowLtpStorageKeyForIstDate(ymd) {
  return `${NIFTY_UPDOWN_WINDOW_LTP_LS}_${ymd}`;
}

function loadLockedWindowLtpsForToday() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const ymd = getIstCalendarYmd();
    const raw = localStorage.getItem(windowLtpStorageKeyForIstDate(ymd));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const rows = parsed?.rows;
    if (!rows || typeof rows !== 'object') return {};
    const out = {};
    for (const [k, v] of Object.entries(rows)) {
      const wn = Number(k);
      const px = Number(v);
      if (Number.isFinite(wn) && wn > 0 && Number.isFinite(px) && px > 0) {
        out[wn] = Number(Number(px).toFixed(2));
      }
    }
    return out;
  } catch {
    return {};
  }
}

function saveLockedWindowLtpsForToday(map) {
  if (typeof localStorage === 'undefined') return;
  try {
    const ymd = getIstCalendarYmd();
    const safe = {};
    for (const [k, v] of Object.entries(map || {})) {
      const wn = Number(k);
      const px = Number(v);
      if (Number.isFinite(wn) && wn > 0 && Number.isFinite(px) && px > 0) {
        safe[wn] = Number(Number(px).toFixed(2));
      }
    }
    localStorage.setItem(
      windowLtpStorageKeyForIstDate(ymd),
      JSON.stringify({ v: 1, savedAt: Date.now(), rows: safe })
    );
  } catch {
    /* ignore quota/private mode */
  }
}

// ==================== LIVE CHART WITH ZERODHA CONNECTION CHECK ====================
const GameLivePricePanel = ({
  gameId,
  fullHeight = false,
  onPriceUpdate,
  priceLines = [],
  onFallbackPrice,
  onDemoPriceActive,
  onSessionClearingUpdate,
  onPriceDataUpdate,
  /** Nifty Up/Down: emits chart-identical OHLC rows (last bar merged from live ticks) for LTP list resolution. */
  onSyncedNiftyCandlesForLtp,
  /** Nifty only: show scrollable LTP + IST time log under the chart (e.g. Nifty Bracket). */
  niftyLtpTape = false,
  /** Callback for bid/ask price updates (for Nifty Bracket) */
  onBidAskUpdate,
  /** Nifty when market closed: 'clearing' for clearing stick, 'ltp' for last live LTP stick */
  closedNiftyStickMode = 'clearing',
}) => {
  const socketRef = useRef(null);
  const isLiveRef = useRef(false);
  const onPriceUpdateRef = useRef(onPriceUpdate);
  onPriceUpdateRef.current = onPriceUpdate;
  const onFallbackPriceRef = useRef(onFallbackPrice);
  onFallbackPriceRef.current = onFallbackPrice;
  const onDemoPriceActiveRef = useRef(onDemoPriceActive);
  const onSessionClearingUpdateRef = useRef(onSessionClearingUpdate);
  onSessionClearingUpdateRef.current = onSessionClearingUpdate;
  const onPriceDataUpdateRef = useRef(onPriceDataUpdate);
  onPriceDataUpdateRef.current = onPriceDataUpdate;
  const onBidAskUpdateRef = useRef(onBidAskUpdate);
  onBidAskUpdateRef.current = onBidAskUpdate;
  const onSyncedNiftyCandlesForLtpRef = useRef(onSyncedNiftyCandlesForLtp);
  onSyncedNiftyCandlesForLtpRef.current = onSyncedNiftyCandlesForLtp;
  onDemoPriceActiveRef.current = onDemoPriceActive;
  const livePriceRef = useRef(null);
  const historicalDataRef = useRef([]);
  const niftyLtpTapeRef = useRef(false);
  niftyLtpTapeRef.current = niftyLtpTape;
  /** IST YYYY-MM-DD for the rows currently in state — detects midnight rollover. */
  const ltpTapeIstYmdRef = useRef('');

  const [livePrice, setLivePrice] = useState(null);
  const [priceChange, setPriceChange] = useState(null);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [sessionClock, setSessionClock] = useState(0);
  const [lastKnownPrice, setLastKnownPrice] = useState(null);
  const [candleData, setCandleData] = useState([]);
  const [zerodhaConnected, setZerodhaConnected] = useState(false);
  const [historicalData, setHistoricalData] = useState([]);
  /** Only when chart interval ≠ 15m but Nifty Up/Down needs game 15m bars for LTP list. */
  const [parallel15mRowsForLtp, setParallel15mRowsForLtp] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [usingDummyPrice, setUsingDummyPrice] = useState(false);
  /** Kite: last 15m bar close today (IST) — same family as Kite 15m chart final C */
  const [sessionClearing, setSessionClearing] = useState(null);
  /** Historical candles interval — same strings as Kite chart dropdown (default 15m). */
  const [niftyChartInterval, setNiftyChartInterval] = useState(() => {
    if (typeof window === 'undefined') return '15minute';
    try {
      const v = localStorage.getItem(LS_NIFTY_KITE_CHART_INTERVAL);
      if (v && NIFTY_KITE_CHART_OPTIONS.some((o) => o.kite === v)) return v;
    } catch {
      /* ignore */
    }
    return '15minute';
  });
  /** BTC chart — default 15m to match each 15m game window; completed bars stay fixed, last bar updates with live LTP. */
  const [btcChartInterval, setBtcChartInterval] = useState(() => {
    if (typeof window === 'undefined') return '15m';
    try {
      const v = localStorage.getItem(LS_BTC_CHART_INTERVAL);
      if (v && BTC_CHART_OPTIONS.some((o) => o.interval === v)) return v;
    } catch {
      /* ignore */
    }
    return '15m';
  });
  const [ltpTapeRows, setLtpTapeRows] = useState([]);

  const isBTC = gameId === 'btcupdown';
  const symbol = isBTC ? 'BTC/USDT' : 'NIFTY 50';

  const pushLive = useCallback((price, changePayload, tickData) => {
    if (!price || price <= 0 || !Number.isFinite(price)) return;
    console.log('[GameLivePricePanel] pushLive called with price:', price);
    setUsingDummyPrice(false);
    onDemoPriceActiveRef.current?.(false);
    setLivePrice(price);
    setLastKnownPrice(price);
    console.log('[GameLivePricePanel] Calling onPriceUpdate callback with:', price);
    onPriceUpdateRef.current?.(price);
    if (!isBTC && niftyLtpTapeRef.current) {
      // For Nifty Bracket (gameId="updown"), we need to use the real LTP (sessionClearing)
      // But we don't have access to sessionClearing here, so we'll use the price that comes from the callback
      // The real LTP will be set by the onSessionClearingUpdate callback in Nifty Bracket
      let priceToUse = price;
      
      // Special handling for Nifty Bracket - use the price from onSessionClearingUpdate
      // This will be handled in the component itself by updating the LTP tape separately
      
      const rounded = Number(Number(priceToUse).toFixed(2));
      const istYmd = getIstCalendarYmd();
      const istTime = new Date().toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour12: true,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      setLtpTapeRows((prev) => {
        let base = prev;
        if (ltpTapeIstYmdRef.current && ltpTapeIstYmdRef.current !== istYmd) {
          base = loadLtpTapeFromStorageForToday();
        }
        ltpTapeIstYmdRef.current = istYmd;
        const row = { id, price: rounded, istTime, ts: Date.now() };
        const next = [row, ...base].slice(0, NIFTY_BRACKET_LTP_TAPE_MAX);
        saveLtpTapeToStorage(next);
        return next;
      });
    }
    if (changePayload) setPriceChange(changePayload);

    if (tickData) {
      const candle = {
        time: Date.now(),
        open: tickData.open || price,
        high: tickData.high || price,
        low: tickData.low || price,
        close: price,
        volume: tickData.volume || 0,
      };
      setCandleData((prev) => [...prev, candle].slice(-100));
    }
  }, [isBTC]);

  useEffect(() => {
    if (!niftyLtpTape || isBTC) {
      setLtpTapeRows([]);
      ltpTapeIstYmdRef.current = '';
      return;
    }
    const ymd = getIstCalendarYmd();
    ltpTapeIstYmdRef.current = ymd;
    setLtpTapeRows(loadLtpTapeFromStorageForToday());
  }, [niftyLtpTape, isBTC]);

  useEffect(() => {
    livePriceRef.current = livePrice;
  }, [livePrice]);
  useEffect(() => {
    historicalDataRef.current = historicalData;
  }, [historicalData]);

  // Nifty: if Zerodha/socket never delivers a tick, feed a demo LTP so bracket / up-down UI can be tested.
  useEffect(() => {
    if (isBTC) return;
    // When Zerodha is connected, do not rush into demo fallback.
    // Give live socket/API quote enough time before marking as dummy.
    const delayMs = zerodhaConnected ? 12000 : loadingHistory ? 4000 : 800;
    const t = setTimeout(() => {
      if (!isNseCashMarketOpen()) return;
      if (livePriceRef.current != null && livePriceRef.current > 0) return;
      if (zerodhaConnected) return;
      const hist = historicalDataRef.current;
      const lastClose = hist?.length ? Number(hist[hist.length - 1]?.close) : NaN;
      const p =
        Number.isFinite(lastClose) && lastClose > 0 ? lastClose : DUMMY_NIFTY_LTP;
      if (!Number.isFinite(p) || p <= 0) return;
      console.warn('[GameLivePricePanel] Demo NIFTY price (Zerodha offline / no ticks):', p);
      setLivePrice(p);
      setLastKnownPrice(p);
      setUsingDummyPrice(true);
      onPriceUpdateRef.current?.(p);
      onFallbackPriceRef.current?.(p);
      onDemoPriceActiveRef.current?.(true);
    }, delayMs);
    return () => clearTimeout(t);
  }, [isBTC, loadingHistory, historicalData.length, zerodhaConnected]);

  // Fetch historical candles — NIFTY uses ?interval= to match Kite (15m default).
  useEffect(() => {
    const fetchHistoricalData = async () => {
      try {
        setLoadingHistory(true);
        const endpoint = isBTC
          ? `/api/market/btc-history?interval=${encodeURIComponent(btcChartInterval)}`
          : `/api/market/nifty-history?interval=${encodeURIComponent(niftyChartInterval)}`;
        console.log('Fetching historical data from:', endpoint);
        const response = await axios.get(endpoint);

        console.log('Historical data response:', response.data?.source, response.data?.interval, response.data?.data?.length);

        const rawRows = Array.isArray(response.data)
          ? response.data
          : response.data?.data;
        if (rawRows && rawRows.length > 0) {
          const formatted = rawRows.map((candle) => {
            let t;
            if (candle.time != null && typeof candle.time === 'number' && Number.isFinite(candle.time)) {
              t = candle.time > 1e12 ? Math.floor(candle.time / 1000) : Math.floor(candle.time);
            } else {
              t = Math.floor(new Date(candle.time || candle.timestamp).getTime() / 1000);
            }
            return {
              time: t,
              timestamp: candle.timestamp || candle.time,
              open: Number(candle.open),
              high: Number(candle.high),
              low: Number(candle.low),
              close: Number(candle.close),
            };
          });
          setHistoricalData(formatted);
        }
      } catch (error) {
        console.error('Error fetching historical data:', error);
      } finally {
        setLoadingHistory(false);
      }
    };

    fetchHistoricalData();
  }, [isBTC, niftyChartInterval, btcChartInterval]);

  // Nifty Up/Down: when chart interval ≠ 15m, fetch 15m in parallel so window↔bar resolution still uses 15m OHLC.
  useEffect(() => {
    if (isBTC || gameId !== 'updown' || niftyChartInterval === '15minute') {
      setParallel15mRowsForLtp([]);
      return undefined;
    }
    let cancelled = false;
    const fetch15parallel = async () => {
      try {
        const response = await axios.get('/api/market/nifty-history', {
          params: { interval: '15minute' },
        });
        const rawRows = Array.isArray(response.data)
          ? response.data
          : response.data?.data;
        if (!rawRows?.length || cancelled) return;
        const formatted = rawRows.map((candle) => {
          let t;
          if (candle.time != null && typeof candle.time === 'number' && Number.isFinite(candle.time)) {
            t = candle.time > 1e12 ? Math.floor(candle.time / 1000) : Math.floor(candle.time);
          } else {
            t = Math.floor(new Date(candle.time || candle.timestamp).getTime() / 1000);
          }
          return {
            time: t,
            timestamp: candle.timestamp || candle.time,
            open: Number(candle.open),
            high: Number(candle.high),
            low: Number(candle.low),
            close: Number(candle.close),
          };
        });
        setParallel15mRowsForLtp(formatted);
      } catch {
        /* ignore */
      }
    };
    void fetch15parallel();
    const pid = setInterval(fetch15parallel, 45_000);
    return () => {
      cancelled = true;
      clearInterval(pid);
    };
  }, [isBTC, gameId, niftyChartInterval]);

  useEffect(() => {
    const id = setInterval(() => setSessionClock((c) => c + 1), 20000);
    return () => clearInterval(id);
  }, []);

  // Temporarily disabled - this was clearing the price
  // useEffect(() => {
  //   if (isBTC) return;
  //   if (!isNseCashMarketOpen()) {
  //     isLiveRef.current = false;
  //     setIsLiveConnected(false);
  //     setLivePrice(null);
  //     setPriceChange(null);
  //   }
  // }, [sessionClock, isBTC]);

  const nseCashOpen = !isBTC && isNseCashMarketOpen();
  void sessionClock;

  useEffect(() => {
    const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5001';
    console.log('Connecting to socket at:', socketUrl);
    const socket = socketIO(socketUrl);
    socketRef.current = socket;
    
    socket.on('connect', () => {
      console.log('Socket connected successfully');
    });
    
    socket.on('disconnect', () => {
      console.log('Socket disconnected');
    });

    // Listen for Zerodha connection status
    socket.on('zerodha_status', (status) => {
      console.log('Zerodha status received:', status);
      setZerodhaConnected(status.connected);
      if (!status.connected) {
        setIsLiveConnected(false);
        isLiveRef.current = false;
      }
    });

    // Request initial Zerodha status
    socket.emit('get_zerodha_status');

    if (!isBTC) {
      socket.on('market_tick', (ticks) => {
        const niftyTick = ticks['256265'] ?? ticks[256265];
        if (!niftyTick) return;
        
        // Calculate latency if server timestamp is available
        if (niftyTick.serverTimestamp) {
          const clientReceiveTime = Date.now();
          const latency = clientReceiveTime - niftyTick.serverTimestamp;
          if (latency > 1000) {
            console.warn(`[Price Delay] NIFTY 50 tick latency: ${latency}ms`);
          }
        }
        
        // Update LTP in real-time from socket ticks (even after market hours for Nifty Bracket)
        if (!isLiveRef.current) {
          isLiveRef.current = true;
          setIsLiveConnected(true);
        }
        const ch = niftyTick.change !== undefined
          ? { change: parseFloat(niftyTick.change).toFixed(2), percent: niftyTick.changePercent }
          : null;
        pushLive(niftyTick.ltp, ch, niftyTick);
        // Extract bid/ask for Nifty Bracket
        if (niftyTick.bid !== undefined || niftyTick.ask !== undefined) {
          onBidAskUpdateRef.current?.({
            bid: niftyTick.bid || niftyTick.ltp,
            ask: niftyTick.ask || niftyTick.ltp,
          });
        }
      });
    }

    if (isBTC) {
      const handleBtc = (ticks) => {
        const btcTick = ticks['BTCUSDT'] || ticks['BTC'];
        if (btcTick && btcTick.ltp) {
          if (!isLiveRef.current) {
            isLiveRef.current = true;
            setIsLiveConnected(true);
          }
          const ch = btcTick.change !== undefined
            ? { change: parseFloat(btcTick.change).toFixed(2), percent: btcTick.changePercent }
            : null;
          pushLive(btcTick.ltp, ch, btcTick);
        }
      };
      socket.on('crypto_tick', handleBtc);
      socket.on('market_tick', handleBtc);
    }

    socket.on('disconnect', () => {
      isLiveRef.current = false;
      setIsLiveConnected(false);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      isLiveRef.current = false;
    };
  }, [gameId, isBTC, pushLive]);

  // Kite Connect quote last_price — same as Kite app; runs during and after cash session (no mock LTP override)
  useEffect(() => {
    if (isBTC) return undefined;
    let cancelled = false;
    const syncAuthoritative = async () => {
      try {
        const closedMode = closedNiftyStickMode === 'ltp' ? 'ltp' : 'clearing';
        const { data } = await axios.get('/api/zerodha/game-price/NIFTY', {
          params: { authoritative: 1, closedMode },
        });
        if (cancelled || data?.price == null) return;
        const ltpPrice = Number(data.price);
        const spotRefRaw = Number(data?.clearingPrice ?? data?.prevDayClose ?? data?.sessionClearing ?? data?.close);
        const spotRef =
          Number.isFinite(spotRefRaw) && spotRefRaw > 0 ? Number(spotRefRaw) : null;
        const nseOpenNow = isNseCashMarketOpen();
        const price =
          !nseOpenNow && closedNiftyStickMode !== 'ltp' && spotRef != null
            ? spotRef
            : ltpPrice;
        console.log('[GameLivePricePanel] API returned - LTP:', ltpPrice, 'Spot:', spotRef, 'Using:', price);
        if (!Number.isFinite(price) || price <= 0) return;
        if (!isLiveRef.current) {
          isLiveRef.current = true;
          setIsLiveConnected(true);
        }
        setZerodhaConnected(true);
        setUsingDummyPrice(false);
        onDemoPriceActiveRef.current?.(false);
        const refForChange =
          data.prevDayClose != null && Number.isFinite(Number(data.prevDayClose))
            ? Number(data.prevDayClose)
            : data.close != null
              ? Number(data.close)
              : NaN;
        let ch = null;
        if (Number.isFinite(refForChange) && refForChange > 0) {
          const change = price - refForChange;
          ch = { change: change.toFixed(2), percent: ((change / refForChange) * 100).toFixed(2) };
        }
        if (data.sessionClearing != null && Number.isFinite(Number(data.sessionClearing))) {
          console.log('[GameLivePricePanel] Setting sessionClearing to:', Number(data.sessionClearing));
          setSessionClearing(Number(data.sessionClearing));
          onSessionClearingUpdateRef.current?.(Number(data.sessionClearing));
        } else {
          setSessionClearing(null);
          onSessionClearingUpdateRef.current?.(null);
        }
        console.log('[GameLivePricePanel] Calling pushLive with LTP:', price);
        pushLive(price, ch, {
          open: data.open,
          high: data.high,
          low: data.low,
          close: price,
          volume: 0,
        });
      } catch {
        /* keep cached price */
      }
    };
    syncAuthoritative();
    const id = setInterval(syncAuthoritative, 1200);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isBTC, pushLive, closedNiftyStickMode]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (isBTC && !isLiveRef.current) {
        console.warn(`[LivePrice] No BTC stream for ${symbol}. Check Socket.IO / VITE_SOCKET_URL.`);
      }
      if (!isBTC && isNseCashMarketOpen() && !isLiveRef.current) {
        console.warn('[LivePrice] NSE open but no Kite authoritative quote yet. Check Zerodha API + /api/zerodha/game-price.');
      }
    }, 12000);
    return () => clearTimeout(t);
  }, [gameId, isBTC, symbol]);

  const displayPrice = isBTC ? livePrice : nseCashOpen ? livePrice : lastKnownPrice;
  const isUp = priceChange ? parseFloat(priceChange.change) >= 0 : true;

  const chartTfLabel = isBTC
    ? BTC_CHART_OPTIONS.find((o) => o.interval === btcChartInterval)?.label || btcChartInterval
    : NIFTY_KITE_CHART_OPTIONS.find((o) => o.kite === niftyChartInterval)?.label || niftyChartInterval;

  const formatGameOhlcPx = (v) =>
    v != null && Number.isFinite(Number(v))
      ? Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '—';

  const { formingOhlc, closedOhlc } = useMemo(() => {
    const rows = historicalData;
    if (!rows?.length) {
      return { formingOhlc: null, closedOhlc: null };
    }
    const live =
      displayPrice != null && Number.isFinite(Number(displayPrice)) ? Number(displayPrice) : null;
    const lastBarClose = Number(rows[rows.length - 1]?.close);
    const ltp =
      live != null && live > 0
        ? live
        : Number.isFinite(lastBarClose) && lastBarClose > 0
          ? lastBarClose
          : null;
    if (ltp == null) {
      return { formingOhlc: null, closedOhlc: null };
    }
    const last = rows[rows.length - 1];
    const o = Number(last.open);
    const hi = Number(last.high);
    const lo = Number(last.low);
    const lc = Number(last.close);
    let baseOpen = Number.isFinite(o) ? o : Number.isFinite(lc) ? lc : ltp;
    let baseHi = Number.isFinite(hi) ? hi : baseOpen;
    let baseLo = Number.isFinite(lo) ? lo : baseOpen;
    if (!Number.isFinite(baseOpen)) {
      baseOpen = ltp;
      baseHi = ltp;
      baseLo = ltp;
    }
    const high = Math.max(baseHi, ltp);
    const low = Math.min(baseLo, ltp);
    const forming = { open: baseOpen, high, low, close: ltp };
    let closed = null;
    if (rows.length >= 2) {
      const p = rows[rows.length - 2];
      const co = Number(p.open);
      const ch = Number(p.high);
      const cl = Number(p.low);
      const cc = Number(p.close);
      if ([co, ch, cl, cc].every((x) => Number.isFinite(x))) {
        closed = { open: co, high: ch, low: cl, close: cc };
      }
    }
    return { formingOhlc: forming, closedOhlc: closed };
  }, [historicalData, displayPrice]);

  /** Same last-bar merge as LiveChart tick path — parent LTP list resolves identical chart `C`. */
  const niftyRowsSyncedForGameLtp = useMemo(() => {
    if (isBTC || gameId !== 'updown') return null;
    const baseRows =
      niftyChartInterval === '15minute' ? historicalData : parallel15mRowsForLtp;
    if (!baseRows?.length) return null;
    return mergeNiftyLiveIntoLastCandle(baseRows, displayPrice);
  }, [isBTC, gameId, niftyChartInterval, historicalData, parallel15mRowsForLtp, displayPrice]);

  useEffect(() => {
    if (isBTC || gameId !== 'updown') return;
    const cb = onSyncedNiftyCandlesForLtpRef.current;
    if (!cb) return;
    cb(niftyRowsSyncedForGameLtp ?? []);
  }, [isBTC, gameId, niftyRowsSyncedForGameLtp]);

  // Notify parent of price data updates
  useEffect(() => {
    onPriceDataUpdateRef.current?.({ displayPrice, priceChange });
  }, [displayPrice, priceChange]);

  let statusDot = 'bg-slate-500';
  let statusLabel = '';
  let statusTextClass = 'text-slate-400';
  if (isBTC) {
    if (isLiveConnected) {
      statusDot = 'bg-green-500 animate-pulse';
      statusLabel = 'LIVE';
      statusTextClass = 'text-green-400';
    } else {
      statusDot = 'bg-amber-500';
      statusLabel = 'AWAITING LIVE';
      statusTextClass = 'text-amber-400';
    }
  } else if (!nseCashOpen) {
    if (usingDummyPrice) {
      statusDot = zerodhaConnected ? 'bg-violet-500' : 'bg-slate-500';
      statusLabel = zerodhaConnected ? 'TEST NIFTY' : 'DEMO NIFTY';
      statusTextClass = zerodhaConnected ? 'text-violet-300' : 'text-slate-300';
    } else {
      statusDot = lastKnownPrice ? 'bg-blue-500' : 'bg-slate-500';
      statusLabel = lastKnownPrice ? 'LAST PRICE' : 'MARKET CLOSED';
      statusTextClass = lastKnownPrice ? 'text-blue-400' : 'text-slate-400';
    }
  } else if (isLiveConnected) {
    statusDot = 'bg-green-500 animate-pulse';
    statusLabel = 'LIVE';
    statusTextClass = 'text-green-400';
  } else {
    statusDot = 'bg-amber-500';
    statusLabel = 'AWAITING LIVE';
    statusTextClass = 'text-amber-400';
  }

  const priceLine =
    displayPrice != null
      ? `${isBTC ? '$' : '₹'}${displayPrice.toLocaleString(isBTC ? 'en-US' : 'en-IN', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : '—';

  /** INR only — integer in `className` colour, paise (.xx) in red */
  const renderInrRedPaise = (amount, className) => {
    if (amount == null || !Number.isFinite(Number(amount))) {
      return <span className="text-gray-500">—</span>;
    }
    const s = Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const dot = s.lastIndexOf('.');
    if (dot === -1) {
      return (
        <span className={`font-bold tabular-nums tracking-tight ${className}`}>₹{s}</span>
      );
    }
    return (
      <span className={`font-bold tabular-nums tracking-tight ${className}`}>
        ₹{s.slice(0, dot)}
        <span className="text-red-500">{s.slice(dot)}</span>
      </span>
    );
  };

  const changeLine = priceChange
    ? `${isUp ? '+' : ''}${isBTC ? '$' : '₹'}${priceChange.change} (${priceChange.percent}%)`
    : '—';

  return (
    <div className={`bg-dark-800 rounded-xl p-3 sm:p-4 flex flex-col min-h-0 ${fullHeight ? 'h-full max-lg:max-h-full' : ''}`}>
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap mb-2 sm:mb-4 flex-shrink-0">
        <span className="text-gray-400 text-sm font-medium">{symbol}</span>
        <div className="flex items-center gap-1">
          <div className={`w-2 h-2 rounded-full ${statusDot}`} />
          <span className={`text-xs font-medium ${statusTextClass}`}>{statusLabel}</span>
        </div>
      </div>
      
      {!isBTC && !nseCashOpen && zerodhaConnected && usingDummyPrice && (
        <div className="mb-2 bg-violet-900/25 border border-violet-500/40 rounded-lg px-3 py-2 text-center">
          <div className="text-xs font-semibold text-violet-200 flex items-center justify-center gap-1.5">
            <AlertCircle size={14} className="shrink-0" />
            Zerodha connected — using demo NIFTY (Kite quote unavailable). Check session / API.
          </div>
          <p className="text-[10px] text-violet-300/80 mt-1">
            Override with <span className="font-mono text-violet-200">VITE_DUMMY_NIFTY_PRICE</span> in client env.
          </p>
        </div>
      )}
      {!isBTC && !nseCashOpen && !zerodhaConnected && (
        <div className="mb-2 bg-slate-800/60 border border-slate-600/50 rounded-lg px-3 py-2 text-center">
          <div className="text-xs font-semibold text-slate-300 flex items-center justify-center gap-1.5">
            <AlertCircle size={14} className="shrink-0" />
            Market closed — demo NIFTY from chart history / env (Zerodha not connected).
          </div>
          <p className="text-[10px] text-slate-500 mt-1">
            Set <span className="font-mono text-slate-400">VITE_DUMMY_NIFTY_PRICE</span> in client env to override.
          </p>
        </div>
      )}
      {!isBTC && nseCashOpen && (!zerodhaConnected || usingDummyPrice) && (
        <div className="mb-2 bg-amber-900/25 border border-amber-500/40 rounded-lg px-3 py-2 text-center">
          <div className="text-xs font-semibold text-amber-300 flex items-center justify-center gap-1.5">
            <AlertCircle size={14} className="shrink-0" />
            {usingDummyPrice
              ? 'Demo NIFTY price — Zerodha offline or no ticks (for UI / bracket testing).'
              : 'Zerodha not connected — waiting for feed or demo price…'}
          </div>
          <p className="text-[10px] text-gray-500 mt-1">
            Set <span className="font-mono text-gray-400">VITE_DUMMY_NIFTY_PRICE</span> in client env to override the default LTP.
          </p>
        </div>
      )}
      {!isBTC && (
        <div className="mb-2 flex flex-wrap items-center justify-center gap-1.5">
          <span className="text-[10px] text-gray-500 mr-0.5">IST · chart = Kite</span>
          {NIFTY_KITE_CHART_OPTIONS.map(({ kite, label }) => (
            <button
              key={kite}
              type="button"
              onClick={() => {
                setNiftyChartInterval(kite);
                try {
                  localStorage.setItem(LS_NIFTY_KITE_CHART_INTERVAL, kite);
                } catch {
                  /* ignore */
                }
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                niftyChartInterval === kite
                  ? 'bg-emerald-600/30 border-emerald-500/50 text-emerald-200'
                  : 'bg-dark-700/50 border-slate-600/40 text-gray-400 hover:border-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {isBTC && (
        <div className="mb-2 flex flex-col items-stretch gap-1">
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <span className="text-[10px] text-gray-500 mr-0.5">BTC · chart = Binance</span>
          {BTC_CHART_OPTIONS.map(({ interval, label }) => (
            <button
              key={interval}
              type="button"
              onClick={() => {
                setBtcChartInterval(interval);
                try {
                  localStorage.setItem(LS_BTC_CHART_INTERVAL, interval);
                } catch {
                  /* ignore */
                }
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                btcChartInterval === interval
                  ? 'bg-orange-600/30 border-orange-500/50 text-orange-200'
                  : 'bg-dark-700/50 border-slate-600/40 text-gray-400 hover:border-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[9px] text-center text-gray-500 px-1 leading-snug">
          Use <span className="text-orange-300/90">15m</span> to align each candle with a game window; past candles stay frozen—only the latest bar follows live price.
        </p>
        </div>
      )}
      <div className="mb-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-lg border border-emerald-600/30 bg-dark-900/70 px-2.5 py-2">
          <div className="text-[10px] font-semibold text-emerald-400/95 mb-1.5">
            {isBTC ? 'BTC' : 'NIFTY 50'} · current {chartTfLabel} candle (forming)
          </div>
          {formingOhlc ? (
            <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 tabular-nums text-gray-200">
              <span className="text-gray-500">Open</span>
              <span className="text-right">
                {isBTC ? '$' : '₹'}
                {formatGameOhlcPx(formingOhlc.open)}
              </span>
              <span className="text-gray-500">High</span>
              <span className="text-right">
                {isBTC ? '$' : '₹'}
                {formatGameOhlcPx(formingOhlc.high)}
              </span>
              <span className="text-gray-500">Low</span>
              <span className="text-right">
                {isBTC ? '$' : '₹'}
                {formatGameOhlcPx(formingOhlc.low)}
              </span>
              <span className="text-gray-500">Close</span>
              <span className="text-right font-medium text-white">
                {isBTC ? '$' : '₹'}
                {formatGameOhlcPx(formingOhlc.close)}
              </span>
            </div>
          ) : (
            <p className="text-gray-500 text-[10px] leading-snug">
              Select a timeframe above; O/H/L/C update from the same Kite / Binance bars as the chart.
            </p>
          )}
        </div>
        <div className="rounded-lg border border-slate-600/45 bg-dark-900/70 px-2.5 py-2">
          <div className="text-[10px] font-semibold text-slate-400 mb-1.5">Last closed {chartTfLabel} candle</div>
          {closedOhlc ? (
            <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 tabular-nums text-gray-200">
              <span className="text-gray-500">Open</span>
              <span className="text-right">
                {isBTC ? '$' : '₹'}
                {formatGameOhlcPx(closedOhlc.open)}
              </span>
              <span className="text-gray-500">High</span>
              <span className="text-right">
                {isBTC ? '$' : '₹'}
                {formatGameOhlcPx(closedOhlc.high)}
              </span>
              <span className="text-gray-500">Low</span>
              <span className="text-right">
                {isBTC ? '$' : '₹'}
                {formatGameOhlcPx(closedOhlc.low)}
              </span>
              <span className="text-gray-500">Close</span>
              <span className="text-right font-medium text-slate-100">
                {isBTC ? '$' : '₹'}
                {formatGameOhlcPx(closedOhlc.close)}
              </span>
            </div>
          ) : (
            <p className="text-gray-500 text-[10px]">Need at least two bars for a prior close.</p>
          )}
        </div>
      </div>
      <div className="mt-2 sm:mt-4 flex flex-col min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-hidden max-lg:max-h-[min(32vh,320px)]">
          <LiveChart
            key={isBTC ? `btc-${btcChartInterval}` : `nifty-${niftyChartInterval}`}
            symbol={symbol}
            isBTC={isBTC}
            livePrice={displayPrice}
            isLiveConnected={isLiveConnected}
            priceLines={priceLines}
            historicalData={historicalData}
            visibleBarCount={isBTC ? null : 3}
          />
        </div>
        {niftyLtpTape && !isBTC && (
          <div className="mt-2 shrink-0 rounded-lg border border-cyan-600/25 bg-dark-900/60 overflow-hidden flex flex-col max-h-[min(280px,38vh)]">
            <div className="px-2 py-1 text-[10px] font-semibold text-cyan-300/90 border-b border-dark-600 bg-dark-800/90 flex flex-col gap-0.5">
              <div className="flex items-center justify-between gap-2">
                <span>LTP trail (IST)</span>
                <span className="text-gray-500 font-normal">newest ↑ · scroll for older</span>
              </div>
              <p className="text-[9px] text-gray-500 font-normal leading-snug">
                Today on this device — every Kite quote (~2.5s) while this page is open; scroll back for e.g. 12:00 pm. New IST day starts a fresh list.
              </p>
            </div>
            <div className="overflow-y-auto min-h-0 overscroll-y-contain divide-y divide-dark-700/80 text-[11px]">
              {ltpTapeRows.length === 0 ? (
                <p className="px-2 py-3 text-gray-500 text-center text-[10px] leading-snug">
                  Waiting for Kite quotes… entries appear on each live update and stay for the whole IST day.
                </p>
              ) : (
                ltpTapeRows.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-2 px-2 py-1.5 tabular-nums"
                  >
                    <span className="text-white font-medium">
                      ₹{row.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span className="text-gray-500 shrink-0 text-[10px]">{row.istTime}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/** Latest `GameResult` for a window # (by calendar time); used for tracker + pending UI vs server. */
function pickLatestGameResultForWindow(results, winNum) {
  const n = Number(winNum);
  if (!Number.isFinite(n)) return null;
  const hits = (results || []).filter((r) => Number(r.windowNumber) === n);
  if (hits.length === 0) return null;
  return hits.reduce((best, r) => {
    const t = new Date(r.windowDate || r.resultTime || r.createdAt || 0).getTime();
    const bt = new Date(best.windowDate || best.resultTime || best.createdAt || 0).getTime();
    return t > bt ? r : best;
  }, hits[0]);
}

/**
 * Nifty chain: window W reference open = prior window's official close (same Nifty @ result instant).
 * For W≥2 returns that price when published; else current row's openPrice; else null.
 */
function niftyChainedOpenPriceForWindow(winNum, results) {
  const n = Number(winNum);
  if (!Number.isFinite(n) || n < 2) return null;
  const prevGr = pickLatestGameResultForWindow(results, n - 1);
  const prevClose = Number(prevGr?.closePrice);
  if (Number.isFinite(prevClose) && prevClose > 0) return prevClose;
  const curGr = pickLatestGameResultForWindow(results, n);
  const curOpen = Number(curGr?.openPrice);
  if (Number.isFinite(curOpen) && curOpen > 0) return curOpen;
  return null;
}

// Individual Game Screen Component
const GameScreen = ({ game, balance, onBack, user, refreshBalance, settings, tokenValue = 300 }) => {
  // Use the actual tokenValue from settings, fallback to global tokenValue
  const actualTokenValue = tokenValue || settings?.tokenValue || 300;
  const isBTC = game.id === 'btcupdown';
  const isUpDownGame = game.id === 'updown' || game.id === 'btcupdown';
  const [betAmount, setBetAmount] = useState('');
  const [prediction, setPrediction] = useState(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const gameStartTime = settings?.startTime;
  const gameEndTime = settings?.endTime;
  const niftyRoundSec = Math.max(
    NIFTY_UP_DOWN_MIN_ROUND_SEC,
    Number(settings?.roundDuration) || DEFAULT_NIFTY_ROUND_DURATION_SEC
  );
  const [windowInfo, setWindowInfo] = useState(() =>
    isBTC
      ? getBTCWindowInfo(gameStartTime, gameEndTime)
      : getTradingWindowInfo(gameStartTime, gameEndTime, niftyRoundSec)
  );
  const [activeTrades, setActiveTrades] = useState([]); // pending trades waiting for result
  const [tradeHistory, setTradeHistory] = useState([]);
  const [tradeResults, setTradeResults] = useState([]); // Recent trade results with messages
  const [gameResults, setGameResults] = useState([]); // Previous window results
  const [loadingResults, setLoadingResults] = useState(true);
  const [currentPrice, setCurrentPrice] = useState(null); // Current live price for display
  const currentPriceRef = useRef(null);
  const lastNonZeroPriceRef = useRef(null);
  const sidePanelPrice =
    Number.isFinite(Number(currentPrice)) && Number(currentPrice) > 0
      ? Number(currentPrice)
      : Number.isFinite(Number(lastNonZeroPriceRef.current)) && Number(lastNonZeroPriceRef.current) > 0
        ? Number(lastNonZeroPriceRef.current)
        : null;
  const capturedWindowEndPriceRef = useRef(null); // Store price captured at exact window end
  const capturedWindowEndTimeRef = useRef(null); // Store exact window-end clock for diagnostics
  const activeTradesRef = useRef([]);
  activeTradesRef.current = activeTrades;
  const prevWindowNumberRef = useRef(windowInfo.windowNumber);
  const pendingWindowsRef = useRef([]);
  const gameResultsRef = useRef([]);
  const settlingWindowNumbersRef = useRef(new Set());
  const checkTradeResultsInFlightRef = useRef(false);
  // Tracks windows waiting for result (Nifty: boundary tick; BTC: until GameResult after result time)
  const [pendingWindows, setPendingWindows] = useState([]);
  const [lockedWindowLtps, setLockedWindowLtps] = useState(() =>
    isBTC ? {} : loadLockedWindowLtpsForToday()
  );
  const lockedWindowLtpsRef = useRef(lockedWindowLtps);
  // Always keep the last completed window for display
  const [lastCompletedWindow, setLastCompletedWindow] = useState(null);
  // { windowNumber, windowEndLTP, ltpTime, resultTime, resultPrice, marketDirection, resolved? }
  /** Live-merged 15m OHLC from GameLivePricePanel (same last bar as chart `C` when market open). */
  const [nifty15CandlesForLtp, setNifty15CandlesForLtp] = useState([]);
  const handleSyncedNiftyCandlesForLtp = useCallback((rows) => {
    setNifty15CandlesForLtp(Array.isArray(rows) ? rows : []);
  }, []);

  // Admin-configured settings with fallbacks
  const winMultiplier = settings?.winMultiplier || 1.95;
  const brokeragePercent =
    settings?.brokeragePercent != null && Number.isFinite(Number(settings.brokeragePercent))
      ? Number(settings.brokeragePercent)
      : 5;
  const gameEnabled = settings?.enabled !== false && settings?.enabled !== undefined && settings?.enabled !== null;
  const hasWindowResultPublished = useCallback((winNum) => {
    if (!Number.isFinite(Number(winNum))) return false;
    if (isBTC) return true;
    // Align with niftyLtpEndSecForWindowNum / "Result @ HH:MM:SS" cards — NOT niftyResultSecForWindowNum
    // (which is one round later). Otherwise window N shows Pending from LTP-close until next slot (e.g. 12:00–12:15)
    // while GameResult + LTP tape already have the official 15m close.
    const publishSec = niftyLtpEndSecForWindowNum(winNum, gameStartTime, niftyRoundSec);
    return getTotalSecondsIST() >= publishSec + 1;
  }, [isBTC, gameStartTime, niftyRoundSec]);

  const computeUpDownSettlement = useCallback(
    (amountRs, won) => {
      const amt = Number(amountRs);
      if (!won) return { brokerage: 0, pnl: -amt, grossWin: 0 };
      const grossWin = amt * winMultiplier;
      const profitBeforeFee = grossWin - amt;
      const brokerage =
        brokeragePercent > 0
          ? parseFloat(((profitBeforeFee * brokeragePercent) / 100).toFixed(2))
          : 0;
      // Matches server: wallet credits full grossWin; brokerage is funded from pool, not deducted from user credit.
      const pnl = parseFloat((grossWin - amt).toFixed(2));
      return { brokerage, pnl, grossWin };
    },
    [winMultiplier, brokeragePercent]
  );

  // Ticket conversion helpers
  const toTokens = (rs) => parseFloat((rs / tokenValue).toFixed(2));
  const toRupees = (tokens) => parseFloat((tokens * tokenValue).toFixed(2));
  const balanceTokens = toTokens(balance);
  const minBetTokens = settings?.minTickets || 1;
  const maxBetTokens = settings?.maxTickets || 500;

  useEffect(() => {
    pendingWindowsRef.current = pendingWindows;
  }, [pendingWindows]);

  useEffect(() => {
    lockedWindowLtpsRef.current = lockedWindowLtps;
  }, [lockedWindowLtps]);

  useEffect(() => {
    if (isBTC) return;
    saveLockedWindowLtpsForToday(lockedWindowLtps);
  }, [isBTC, lockedWindowLtps]);

  useEffect(() => {
    gameResultsRef.current = gameResults;
  }, [gameResults]);

  useEffect(() => {
    if (game.id !== 'updown') setNifty15CandlesForLtp([]);
  }, [game.id]);

  /** Up/Down "Previous Results" strip (BTC: server DB only) */
  const previousResultsStrip = useMemo(() => {
    return [...(gameResults || [])].sort(
      (a, b) => Number(b.windowNumber) - Number(a.windowNumber)
    );
  }, [gameResults]);

  /** Last 3 completed rounds: stuck LTP = GameResult.closePrice at each result time (e.g. 00:15 / 00:30 / 00:45). */
  const btcLastThreeResultLtps = useMemo(() => {
    if (!isBTC) return [];
    const rows = (gameResults || [])
      .filter(
        (r) =>
          r != null &&
          Number(r.windowNumber) > 0 &&
          Number.isFinite(Number(r.closePrice)) &&
          Number(r.closePrice) > 0
      )
      .map((r) => ({ w: Number(r.windowNumber), ltp: Number(r.closePrice) }))
      .sort((a, b) => a.w - b.w);
    return rows.slice(-3);
  }, [isBTC, gameResults]);

  const formatBtcResultIst = useCallback((w) => {
    const sec = btcResultRefSecForUiWindow(w);
    const h = Math.floor(sec / 3600) % 24;
    const m = Math.floor((sec % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
  }, []);

  // Track live price from GameLivePricePanel (Socket.IO ticks)
  const handlePriceUpdate = useCallback((price) => {
    currentPriceRef.current = price;
    if (price != null && Number.isFinite(price) && price > 0) {
      setCurrentPrice(price);
      lastNonZeroPriceRef.current = price;
    }
  }, []);

  // Update trading window info every second (unified for both Nifty and BTC).
  // If the user opens after a window boundary, we never see windowNumber "tick" — still create a pending row
  // for the previous window once clock >= current window start and we have a live price (Nifty); BTC uses server results.
  useEffect(() => {
    const interval = setInterval(() => {
      const info = isBTC
        ? getBTCWindowInfo(gameStartTime, gameEndTime)
        : getTradingWindowInfo(gameStartTime, gameEndTime, niftyRoundSec);
      setWindowInfo(info);
      // BTC: results come only from DB (game-results); no client pending rows or local LTP capture.
      if (isBTC) return;

      if (info.status !== 'open' || info.windowNumber < 2 || info.windowStartSec == null) return;

      const prevNum = info.windowNumber - 1;
      const nowSec = isBTC ? currentTotalSecondsISTLib() : getTotalSecondsIST();
      if (nowSec < info.windowStartSec) return;

      // For Nifty: capture price at window end time if we're at the exact moment
      const prevWindowEndSec = info.windowStartSec - (info.roundDurationSec || NIFTY_UP_DOWN_MIN_ROUND_SEC);
      const isAtWindowEnd = Math.abs(nowSec - prevWindowEndSec) < 1;
      
      if (isAtWindowEnd && !isBTC) {
        const priceAtEnd = currentPriceRef.current || lastNonZeroPriceRef.current;
        if (priceAtEnd != null && Number.isFinite(priceAtEnd) && priceAtEnd > 0) {
          capturedWindowEndPriceRef.current = priceAtEnd;
          console.log('[LTP] Captured at window end in setInterval:', priceAtEnd, 'for window', prevNum);
        }
      }

      // For Nifty: use only locked/captured boundary price; never fall back to moving current price.
      const raw = isBTC
        ? (currentPriceRef.current || lastNonZeroPriceRef.current)
        : (capturedWindowEndPriceRef.current ?? lockedWindowLtpsRef.current[prevNum] ?? null);
      if (raw == null || !Number.isFinite(raw) || raw <= 0) {
        // For Nifty, if boundary LTP is not captured/locked yet, skip (avoid wrong moving value).
        if (!isBTC) {
          console.log('[LTP] No captured price available for window', prevNum, 'skipping pending window creation');
          return;
        }
        return;
      }

      setPendingWindows((prev) => {
        if (prev.some((pw) => pw.windowNumber === prevNum)) return prev;
        let resultTimeSecVal;
        let settleEpochVal;
        if (isBTC) {
          // Result fix for UI window #prevNum matches getBtcUpDownWindowState(activeK = prevNum - 1)
          resultTimeSecVal = btcResultRefSecForUiWindow(prevNum);
          const settleSec = resultTimeSecVal + 1;
          settleEpochVal = Date.now() + Math.max(0, settleSec - nowSec) * 1000;
        } else {
          const Dn = info.roundDurationSec || NIFTY_UP_DOWN_MIN_ROUND_SEC;
          resultTimeSecVal = info.resultTimeSec - Dn;
          const settleSec = resultTimeSecVal + 1;
          settleEpochVal = Date.now() + Math.max(0, settleSec - nowSec) * 1000;
        }
        const resultEpoch =
          isBTC
            ? Date.now() + Math.max(0, resultTimeSecVal - nowSec) * 1000
            : Date.now() + Math.max(0, resultTimeSecVal - nowSec) * 1000;
        const prevPendingRow = prev.find((pw) => pw.windowNumber === prevNum - 1);
        const windowOpenLTP = prevPendingRow?.windowEndLTP ?? null;
        const lockedLtp = !isBTC ? (lockedWindowLtpsRef.current[prevNum] ?? parseFloat(parseFloat(raw).toFixed(2))) : parseFloat(parseFloat(raw).toFixed(2));
        return [
          ...prev,
          {
            windowNumber: prevNum,
            windowEndLTP: lockedLtp,
            windowOpenLTP,
            ltpTime: isBTC ? info.windowStart : formatIstClockFromSec(info.windowStartSec ?? 0),
            resultTimeSec: resultTimeSecVal,
            resultEpoch,
            settleEpoch: settleEpochVal,
            resultTime: isBTC ? info.resultTime : formatIstClockFromSec(resultTimeSecVal),
            trades: [],
          },
        ];
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isBTC, gameStartTime, gameEndTime, niftyRoundSec]);

  // Fetch trade history on mount
  const fetchTradeHistory = useCallback(async () => {
    try {
      const { data } = await axios.get(`/api/user/game-bets/${game.id}?limit=20`, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setTradeHistory(data);
    } catch (error) {
      console.error('Error fetching trade history:', error);
    }
  }, [game.id, user.token]);

  // Fetch game results on mount and when window changes
  const fetchGameResults = useCallback(async () => {
    try {
      const todayIst = getIstCalendarYmd();
      const { data } = await axios.get(`/api/user/game-results/${game.id}`, {
        params: { limit: game.id === 'btcupdown' ? 150 : 20, day: todayIst, _ts: Date.now() },
        headers: { Authorization: `Bearer ${user.token}` },
      });
      setGameResults(data);
    } catch (error) {
      console.error('Error fetching game results:', error);
    } finally {
      setLoadingResults(false);
    }
  }, [game.id, user.token]);

  useEffect(() => {
    fetchGameResults();
    fetchTradeHistory();
  }, [fetchGameResults, fetchTradeHistory]);

  // Refresh published window results when the trading window advances (so tracker stays current without a full reload)
  useEffect(() => {
    fetchGameResults();
  }, [windowInfo.windowNumber, fetchGameResults]);

  // BTC: poll DB so stuck results always appear (no "gone after refresh")
  useEffect(() => {
    if (game.id !== 'btcupdown') return;
    const t = setInterval(() => {
      fetchGameResults();
    }, 4000);
    return () => clearInterval(t);
  }, [game.id, fetchGameResults]);

  // Helper function to resolve a single trade
  const resolveTrade = useCallback(async (trade) => {
    const exitPrice = currentPriceRef.current || 0;
    const priceDiff = exitPrice - trade.entryPrice;
    const marketWentUp = priceDiff > 0;
    const marketWentDown = priceDiff < 0;
    const won =
      (trade.prediction === 'UP' && marketWentUp) || (trade.prediction === 'DOWN' && marketWentDown);
    const { brokerage, pnl, grossWin } = computeUpDownSettlement(trade.amount, won);

    const resolvedTrade = {
      ...trade,
      status: 'resolved',
      exitPrice: parseFloat(exitPrice.toFixed(2)),
      priceDiff: parseFloat(priceDiff.toFixed(2)),
      pnl,
      won,
      brokerage,
      grossWin: won ? grossWin : 0,
      resultTime: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    };

    // Send to backend first — only update UI if wallet credit succeeds
    try {
      console.log('[NIFTY BRACKET DEBUG] Sending settlement request:', {
        gameId: game.id,
        tradeId: trade.id,
        amount: resolvedTrade.amount,
        won: resolvedTrade.won,
        pnl: resolvedTrade.pnl,
        grossWin: resolvedTrade.grossWin,
        prediction: resolvedTrade.prediction,
        windowNumber: resolvedTrade.windowNumber,
        entryPrice: resolvedTrade.entryPrice,
        exitPrice: resolvedTrade.exitPrice,
        brokerage: resolvedTrade.brokerage
      });

      const response = await axios.post('/api/user/game-bet/resolve', {
        gameId: game.id,
        settlementDay:
          typeof trade.settlementDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(trade.settlementDay)
            ? trade.settlementDay
            : undefined,
        trades: [{
          amount: resolvedTrade.amount,
          won: resolvedTrade.won,
          pnl: resolvedTrade.pnl,
          brokerage: resolvedTrade.brokerage,
          prediction: resolvedTrade.prediction,
          windowNumber: resolvedTrade.windowNumber,
          entryPrice: resolvedTrade.entryPrice,
          exitPrice: resolvedTrade.exitPrice,
          ...(trade.transactionId ? { transactionId: trade.transactionId } : {}),
          settlementDay:
            typeof trade.settlementDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(trade.settlementDay)
              ? trade.settlementDay
              : undefined,
        }]
      }, {
        headers: { Authorization: `Bearer ${user.token}` }
      });

      console.log('[NIFTY BRACKET DEBUG] Settlement response:', response.data);

      refreshBalance();
      fetchGameResults();
      setActiveTrades(prev => prev.filter(t => t.id !== trade.id));
      setTradeHistory(prev => [resolvedTrade, ...prev]);
    } catch (err) {
      console.error('Error resolving trade on server:', err);
    }
  }, [game.id, user.token, computeUpDownSettlement, refreshBalance, fetchGameResults]);

  // When window number changes, capture LTP and queue for result (Nifty). BTC: results 100% from DB; no client LTP.
  // Nifty Up/Down: window-end price = Kite 15m candle **close** (Zerodha 15m C), not socket last_price at the tick.
  useEffect(() => {
    const prevWinNum = prevWindowNumberRef.current;
    prevWindowNumberRef.current = windowInfo.windowNumber;
    if (isBTC) return;

    if (prevWinNum <= 0 || prevWinNum === windowInfo.windowNumber) return;

    const livePriceNow = currentPriceRef.current;
    const lastPrice = lastNonZeroPriceRef.current;
    const fallbackLtp = livePriceNow || lastPrice || 0;

    const exactEndTime = formatIstClockFromSec(windowInfo.windowEndSec ?? 0);
    capturedWindowEndTimeRef.current = exactEndTime;

    const nowSecTick = getTotalSecondsIST();
    const Dw = windowInfo.roundDurationSec ?? NIFTY_UP_DOWN_MIN_ROUND_SEC;
    const resultTimeSecVal = (windowInfo.resultTimeSec ?? 0) - Dw;
    const resultEpochVal = Date.now() + Math.max(0, resultTimeSecVal - nowSecTick) * 1000;
    const settleEpochVal = Date.now() + Math.max(0, resultTimeSecVal + 1 - nowSecTick) * 1000;
    const tradesSnapshot = activeTradesRef.current;

    const applyWindowEndLtp = (windowEndLTP) => {
      const n = Number(windowEndLTP);
      if (!Number.isFinite(n) || n <= 0) return;
      capturedWindowEndPriceRef.current = n;
      const lockedLtp = parseFloat(n.toFixed(2));
      setLockedWindowLtps((prev) => ({ ...prev, [prevWinNum]: lockedLtp }));
      setPendingWindows((prev) => {
        const existingIdx = prev.findIndex((pw) => pw.windowNumber === prevWinNum);
        const prevPendingRow = prev.find((pw) => pw.windowNumber === prevWinNum - 1);
        const windowOpenLTP = prevPendingRow?.windowEndLTP ?? null;
        const row = {
          windowNumber: prevWinNum,
          windowEndLTP: lockedLtp,
          windowOpenLTP,
          ltpTime: capturedWindowEndTimeRef.current || formatIstClockFromSec(windowInfo.windowEndSec ?? 0),
          resultTimeSec: resultTimeSecVal,
          resultEpoch: resultEpochVal,
          settleEpoch: settleEpochVal,
          resultTime: formatIstClockFromSec(resultTimeSecVal),
          trades: [...tradesSnapshot],
        };
        if (existingIdx >= 0) {
          const ex = prev[existingIdx];
          const mergedTrades =
            tradesSnapshot.length > 0 ? [...tradesSnapshot] : [...(ex.trades || [])];
          const existingOpenLTP = ex.windowOpenLTP ?? windowOpenLTP;
          const next = [...prev];
          next[existingIdx] = {
            ...ex,
            windowOpenLTP: existingOpenLTP,
            trades: mergedTrades,
            windowEndLTP: lockedLtp,
            resultTimeSec: resultTimeSecVal,
            resultEpoch: resultEpochVal,
            settleEpoch: settleEpochVal,
            resultTime: formatIstClockFromSec(resultTimeSecVal),
          };
          return next;
        }
        return [...prev, row];
      });
      setActiveTrades([]);
    };

    if (game.id === 'updown') {
      void (async () => {
        const kite = await fetchKite15mCloseForCompletedWindow(prevWinNum, gameStartTime, niftyRoundSec);
        const w =
          kite != null && Number.isFinite(kite) && kite > 0
            ? kite
            : fallbackLtp;
        if (w != null && Number.isFinite(Number(w)) && Number(w) > 0) applyWindowEndLtp(w);
      })();
      return;
    }

    if (fallbackLtp != null && Number.isFinite(fallbackLtp) && fallbackLtp > 0) applyWindowEndLtp(fallbackLtp);
  }, [
    windowInfo.windowNumber,
    windowInfo.windowStart,
    windowInfo.windowStartSec,
    windowInfo.resultTime,
    windowInfo.resultTimeSec,
    windowInfo.roundDurationSec,
    windowInfo.windowEndSec,
    isBTC,
    game.id,
    gameStartTime,
    niftyRoundSec,
  ]);

  // Bets in the current window only (for Active Trades section; API may return older unsettled rows)
  const openUpDownTrades = useMemo(() => {
    const cur = Number(windowInfo.windowNumber);
    return (activeTrades || [])
      .filter((t) => Number(t.windowNumber) === cur)
      .map((t) => ({ ...t, _awaitingResult: false }));
  }, [activeTrades, windowInfo.windowNumber]);

  // All trades from pending windows — both resolved and awaiting result
  const allTradesForHistory = useMemo(() => {
    const fromPending = (pendingWindows || [])
      .flatMap((pw) => {
        const serverResult = pickLatestGameResultForWindow(gameResults, pw.windowNumber);
        const published = hasWindowResultPublished(pw.windowNumber);
        const serverClosePx =
          serverResult?.closePrice != null ? Number(serverResult.closePrice) : NaN;
        const serverRow =
          !!serverResult && Number.isFinite(serverClosePx) && serverClosePx > 0;
        const lockedClose =
          !isBTC &&
          lockedWindowLtps[pw.windowNumber] != null &&
          Number.isFinite(Number(lockedWindowLtps[pw.windowNumber])) &&
          Number(lockedWindowLtps[pw.windowNumber]) > 0
            ? Number(lockedWindowLtps[pw.windowNumber])
            : null;
        const isResolved =
          !!pw.resolved ||
          serverRow ||
          (!isBTC && lockedClose != null && published);

        // BTC: prices from GameResult; Nifty: DB close, else Kite socket lock — same ₹ as tracker / tape.
        const resultPrice = isBTC
          ? serverRow
            ? serverClosePx
            : null
          : serverRow && serverClosePx > 0
            ? serverClosePx
            : lockedClose != null && published
              ? lockedClose
              : pw.resultPrice != null && Number(pw.resultPrice) > 0
                ? Number(pw.resultPrice)
                : null;
        const openPrice =
          serverResult?.openPrice ??
          (isBTC
            ? null
            : niftyChainedOpenPriceForWindow(pw.windowNumber, gameResults) ??
              pw.windowOpenLTP ??
              pw.windowEndLTP) ??
          null;

        return (pw.trades || []).map((t) => {
          if (!isResolved || resultPrice == null || openPrice == null) {
            return {
              ...t,
              _awaitingResult: true,
              _settledWindow: pw.windowNumber,
            };
          }
          // Compute win/loss for resolved window (tie → loss; matches server settleUpDownFromPrices)
          const priceWentUp = resultPrice > openPrice;
          const priceWentDown = resultPrice < openPrice;
          const won =
            (t.prediction === 'UP' && priceWentUp) || (t.prediction === 'DOWN' && priceWentDown);
          const amt = Number(t.amount) || 0;
          const grossWin = won ? amt * winMultiplier : 0;
          const pnl = won ? parseFloat((grossWin - amt).toFixed(2)) : -amt;
          return {
            ...t,
            _awaitingResult: false,
            _settledWindow: pw.windowNumber,
            won,
            pnl,
            grossWin,
            entryPrice: openPrice,
            exitPrice: resultPrice,
          };
        });
      });

    return fromPending;
  }, [pendingWindows, gameResults, winMultiplier, isBTC, hasWindowResultPublished, lockedWindowLtps]);

  // Pending rows + API ledger wins/losses (server); dedupe by id
  const upDownMergedHistory = useMemo(() => {
    const pending = allTradesForHistory || [];
    const api = (tradeHistory || []).map((t) => ({
      ...t,
      _awaitingResult: false,
      id: t.id || `api-${t.windowNumber}-${t.time}-${t.amount}`,
    }));
    const seen = new Set(pending.map((t) => String(t.id)));
    const out = [...pending];
    for (const t of api) {
      const k = String(t.id);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    return out;
  }, [allTradesForHistory, tradeHistory]);

  const settlePendingWindowOnServer = useCallback(
    async (pw, resultPrice) => {
      const gr = pickLatestGameResultForWindow(gameResultsRef.current, pw.windowNumber);
      const openPx = isBTC
        ? (Number(gr?.openPrice) > 0 ? Number(gr.openPrice) : pw.windowOpenLTP ?? null)
        : Number(gr?.openPrice) > 0
          ? Number(gr.openPrice)
          : niftyChainedOpenPriceForWindow(pw.windowNumber, gameResultsRef.current) ??
            pw.windowOpenLTP ??
            pw.windowEndLTP;
      const closePx =
        Number(gr?.closePrice) > 0 ? Number(gr.closePrice) : resultPrice;
      const priceDiff = openPx != null ? closePx - openPx : closePx - pw.windowEndLTP;
      const marketWentUp = priceDiff > 0;
      const marketWentDown = priceDiff < 0;

      // Settlement logging for production monitoring
      console.log('[SETTLEMENT] Window', pw.windowNumber, 'openPx:', openPx, 'closePx:', closePx, 'diff:', priceDiff.toFixed(2), 'result:', marketWentUp ? 'UP' : marketWentDown ? 'DOWN' : 'TIE');

      const resolvedTrades = (pw.trades || []).map((trade) => {
        const amt = Number(trade.amount);
        const won =
          (trade.prediction === 'UP' && marketWentUp) || (trade.prediction === 'DOWN' && marketWentDown);
        const { brokerage, pnl, grossWin } = computeUpDownSettlement(amt, won);
        
        // Debug logging for Rena's trade
        console.log('[SETTLEMENT DEBUG] Trade:', {
          tradeId: trade.id,
          prediction: trade.prediction,
          amount: amt,
          marketWentUp,
          marketWentDown,
          won,
          pnl,
          grossWin,
          brokerage,
          openPx,
          closePx,
          priceDiff
        });
        
        return {
          ...trade,
          amount: amt,
          status: 'resolved',
          entryPrice: openPx ?? pw.windowEndLTP,
          exitPrice: parseFloat(closePx.toFixed(2)),
          priceDiff: parseFloat(priceDiff.toFixed(2)),
          pnl,
          won,
          brokerage,
          grossWin: won ? grossWin : 0,
          resultTime: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        };
      });

      if (resolvedTrades.length > 0) {
        console.log(`[SETTLEMENT] Sending ${resolvedTrades.length} trades to server API for game ${game.id}`);
        const firstDay = resolvedTrades.find(
          (t) => typeof t.settlementDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.settlementDay)
        )?.settlementDay;
        const response = await axios.post(
          '/api/user/game-bet/resolve',
          {
            gameId: game.id,
            ...(firstDay ? { settlementDay: firstDay } : {}),
            trades: resolvedTrades.map((t) => ({
              amount: t.amount,
              won: t.won,
              pnl: t.pnl,
              brokerage: t.brokerage,
              prediction: t.prediction,
              windowNumber: t.windowNumber,
              entryPrice: t.entryPrice,
              exitPrice: t.exitPrice,
              ...(t.transactionId ? { transactionId: t.transactionId } : {}),
              ...(typeof t.settlementDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.settlementDay)
                ? { settlementDay: t.settlementDay }
                : {}),
            })),
          },
          { headers: { Authorization: `Bearer ${user.token}` } }
        );
        console.log(`[SETTLEMENT] Server API response:`, response.data);
      } else {
        console.log(`[SETTLEMENT] No trades to resolve for window ${pw.windowNumber}`);
      }

      return resolvedTrades;
    },
    [game.id, user.token, computeUpDownSettlement, isBTC]
  );

  // Resolve pending windows when result time is reached — only after wallet API succeeds (retries if price/API fails)
  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      const list = pendingWindowsRef.current;
      const nowEpoch = Date.now();
      const nowSecForDue = isBTC ? currentTotalSecondsISTLib() : getTotalSecondsIST();

      const isDue = (pw) =>
        pw.settleEpoch != null
          ? nowEpoch >= pw.settleEpoch
          : pw.resultEpoch
            ? nowEpoch >= pw.resultEpoch
            : nowSecForDue >= pw.resultTimeSec;

      if (
        user?.token &&
        game?.id &&
        list.some((pw) => !pw.resolved && isDue(pw)) &&
        (isBTC || game.id === 'updown')
      ) {
        try {
          const todayIst = getIstCalendarYmd();
          const { data } = await axios.get(`/api/user/game-results/${game.id}`, {
            params: { limit: 40, day: todayIst, _ts: Date.now() },
            headers: { Authorization: `Bearer ${user.token}` },
          });
          if (!cancelled) {
            gameResultsRef.current = data;
            setGameResults(data);
          }
        } catch {
          /* ignore */
        }
      }

      for (const pw of list) {
        if (pw.resolved) continue;
        const due = isDue(pw);
        if (!due) continue;
        if (settlingWindowNumbersRef.current.has(pw.windowNumber)) continue;

        // BTC & Nifty: wait for published GameResult (official open/close); server resolves from the same row.
        let resultPrice;
        if (isBTC || game.id === 'updown') {
          const gr = pickLatestGameResultForWindow(gameResultsRef.current, pw.windowNumber);
          const c = Number(gr?.closePrice);
          const o = Number(gr?.openPrice);
          resultPrice = Number.isFinite(c) && c > 0 && Number.isFinite(o) && o > 0 ? c : null;
        } else {
          const nextPw = list.find((p) => p.windowNumber === pw.windowNumber + 1);
          const nextLtp =
            nextPw?.windowEndLTP != null &&
            Number.isFinite(nextPw.windowEndLTP) &&
            nextPw.windowEndLTP > 0
              ? nextPw.windowEndLTP
              : null;
          const raw = nextLtp ?? currentPriceRef.current ?? lastNonZeroPriceRef.current;
          resultPrice = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null;
        }
        if (resultPrice == null) {
          if (isBTC) {
            console.warn('[BTC] Settlement waiting for price (window %s)', pw.windowNumber);
          } else if (game.id === 'updown') {
            console.warn(
              '[UpDown] Nifty settlement waiting for official GameResult (window %s) — skipping client fallback',
              pw.windowNumber
            );
            continue;
          } else {
            console.warn('[UpDown] Settlement waiting for valid price (window %s)', pw.windowNumber);
            continue;
          }
        }

        settlingWindowNumbersRef.current.add(pw.windowNumber);
        try {
          const nowSec = getTotalSecondsIST();
          console.log(`[SETTLEMENT] Window ${pw.windowNumber}: current time=${formatIstClockFromSec(nowSec)}, resultTime=${formatIstClockFromSec(pw.resultTimeSec)}, isDue=${nowSec >= pw.resultTimeSec}`);
          console.log(`[SETTLEMENT] Calling server for window ${pw.windowNumber} with ${pw.trades?.length || 0} trades, resultPrice: ${resultPrice}`);
          const resolvedTrades = await settlePendingWindowOnServer(pw, resultPrice);
          console.log(`[SETTLEMENT] Server returned ${resolvedTrades?.length || 0} resolved trades for window ${pw.windowNumber}`);
          if (cancelled) return;

          const resultPx = parseFloat(resultPrice.toFixed(2));
          const grDir = pickLatestGameResultForWindow(gameResultsRef.current, pw.windowNumber);
          const prevWindowGrDir = pickLatestGameResultForWindow(gameResultsRef.current, pw.windowNumber - 1);
          // For BTC, compare with previous window's close price instead of current window's open price
          const diffForDirection =
            isBTC || game.id === 'updown'
              ? (Number(grDir?.closePrice) || 0) - (Number(prevWindowGrDir?.closePrice) || Number(grDir?.openPrice) || 0)
              : resultPrice - pw.windowEndLTP;
          let direction =
            diffForDirection > 0 ? 'UP' : diffForDirection < 0 ? 'DOWN' : 'TIE';
          if (
            game.id === 'updown' &&
            grDir?.result &&
            (grDir.result === 'UP' || grDir.result === 'DOWN' || grDir.result === 'TIE')
          ) {
            direction = grDir.result;
          }

          // Mark as resolved and NEVER remove it - SAVE TO LOCALSTORAGE
          setPendingWindows((prev) => {
            const updated = prev.map((p) =>
              p.windowNumber === pw.windowNumber
                ? { ...p, resolved: true, resultPrice: resultPx, marketDirection: direction, permanent: true }
                : p
            );
            console.log(`[UpDown] Window ${pw.windowNumber} resolved: ${resultPx} (${direction})`);
            return updated;
          });

          const officialClose = Number(grDir?.closePrice);
          setLastCompletedWindow({
            windowNumber: pw.windowNumber,
            windowEndLTP:
              Number.isFinite(officialClose) && officialClose > 0 ? officialClose : pw.windowEndLTP,
            ltpTime: pw.ltpTime,
            resultTime: pw.resultTime,
            resultPrice: resultPx,
            marketDirection: direction,
            resolved: true,
          });

          if (resolvedTrades.length > 0) {
            refreshBalance();
            try {
              window.dispatchEvent(new CustomEvent(AUTO_REFRESH_EVENT));
            } catch {
              /* ignore */
            }
            setTradeHistory((prev) => [...resolvedTrades.slice().reverse(), ...prev]);
          }
          fetchGameResults();
        } catch (err) {
          console.error(
            '[UpDown] Settlement failed — will retry:',
            err?.response?.data || err?.message || err
          );
        } finally {
          settlingWindowNumbersRef.current.delete(pw.windowNumber);
        }
      }
    };

    const interval = setInterval(() => {
      tick();
    }, isBTC ? 500 : 1000); // Faster for BTC
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [settlePendingWindowOnServer, refreshBalance, fetchGameResults, isBTC, game.id, user?.token]);

  // Clean up old resolved pending windows (Nifty only — BTC uses merged API/local snapshots for the tracker)
  useEffect(() => {
    if (isBTC) return;
    setPendingWindows((prev) => {
      if (prev.length <= 1) return prev;
      const latestResolved = prev.filter((pw) => pw.resolved);
      if (latestResolved.length > 1) {
        const pending = prev.filter((pw) => !pw.resolved);
        const newest = latestResolved[latestResolved.length - 1];
        return [...pending, newest];
      }
      return prev;
    });
  }, [pendingWindows, isBTC]);

  const quickAmounts = [1, 2, 5, 10];

  const handlePlaceBet = async () => {
    if (!betAmount || parseFloat(betAmount) <= 0 || !prediction) return;
    const tokenAmt = parseFloat(betAmount);
    const amt = toRupees(tokenAmt);
    if (tokenAmt < minBetTokens) {
      alert(`Minimum bet is ${minBetTokens} tickets`);
      return;
    }
    if (tokenAmt > maxBetTokens) {
      alert(`Maximum bet is ${maxBetTokens} tickets`);
      return;
    }
    if (amt > balance) {
      alert('Insufficient balance');
      return;
    }
    if (!windowInfo.canTrade) {
      alert('Trading window is closed. Please wait for the next window.');
      return;
    }
    if (!gameEnabled) {
      alert('This game is currently disabled by admin.');
      return;
    }

    try {
      const { data } = await axios.post('/api/user/game-bet/place', {
        gameId: game.id,
        prediction,
        amount: amt,
        entryPrice: parseFloat((currentPriceRef.current || 0).toFixed(2)),
        windowNumber: windowInfo.windowNumber
      }, {
        headers: { Authorization: `Bearer ${user.token}` }
      });

      const newTrade = {
        id: data.betId || Date.now() + Math.random(),
        windowNumber: windowInfo.windowNumber,
        prediction,
        amount: amt,
        entryPrice: parseFloat((currentPriceRef.current || 0).toFixed(2)),
        status: 'pending',
        time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        placedAt: Date.now(),
        windowStart: windowInfo.windowStart,
        windowEnd: windowInfo.windowEnd,
        windowResultTime: windowInfo.resultTime,
        settlementDay: data.settlementDay,
        transactionId: data.transactionId,
      };

      setActiveTrades(prev => [...prev, newTrade]);
      refreshBalance();
      try {
        window.dispatchEvent(new CustomEvent(AUTO_REFRESH_EVENT));
      } catch {
        /* ignore */
      }
      setBetAmount('');
      setPrediction(null);
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to place bet');
    }
  };

  // Window status badge
  const WindowStatusBadge = () => {
    if (windowInfo.status === 'open') {
      return (
        <div className="bg-green-900/30 border border-green-500/40 rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-green-400 font-bold text-sm">WINDOW #{windowInfo.windowNumber}</span>
            </div>
            <span className="text-xs text-gray-400">{windowInfo.windowStart} → {windowInfo.windowEnd}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-400 text-sm">Window Closes In</span>
            <span className="text-2xl font-bold text-green-400 font-mono">{formatCountdown(windowInfo.countdown)}</span>
          </div>
          <div className="mt-2 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-500">Result @</span>
              <span className="text-purple-400">{windowInfo.resultTime}</span>
            </div>
          </div>
        </div>
      );
    }
    
    if (windowInfo.status === 'pre_market') {
      return (
        <div className="bg-blue-900/20 border border-blue-500/30 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Timer size={16} className="text-blue-400" />
            <span className="text-blue-400 font-bold text-sm">PRE-MARKET</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-400 text-sm">First window opens at</span>
            <span className="text-blue-400 font-medium">{windowInfo.nextWindowStart}</span>
          </div>
          <div className="text-xs text-gray-500 mt-1">Countdown: {formatCountdown(windowInfo.countdown)}</div>
        </div>
      );
    }
    
    if (windowInfo.status === 'post_market') {
      return (
        <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Lock size={16} className="text-red-400" />
            <span className="text-red-400 font-bold text-sm">MARKET CLOSED</span>
          </div>
          <p className="text-gray-400 text-sm">Trading resumes {windowInfo.nextWindowStart}</p>
        </div>
      );
    }

    if (windowInfo.status === 'cooldown') {
      return (
        <div className="bg-amber-900/20 border border-amber-500/30 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Timer size={16} className="text-amber-400" />
            <span className="text-amber-400 font-bold text-sm">BETTING PAUSED</span>
          </div>
          <p className="text-gray-400 text-sm">{windowInfo.message}</p>
        </div>
      );
    }
    
    return null;
  };

  const currSymbol = isBTC ? '$' : '₹';
  const prevWindowNumber =
    windowInfo.windowNumber > 1 ? windowInfo.windowNumber - 1 : null;
  const prevPrevWindowNumber =
    windowInfo.windowNumber > 2 ? windowInfo.windowNumber - 2 : null;
  const prevPrevPrevWindowNumber =
    windowInfo.windowNumber > 3 ? windowInfo.windowNumber - 3 : null;
  const prevPrevPrevPrevWindowNumber =
    windowInfo.windowNumber > 4 ? windowInfo.windowNumber - 4 : null;
  /** BTC: 4 rows = 3 completed LTP + 1 running (current). Nifty: 5 rows as before. */
  const trackerWindowNumbers = isBTC
    ? [
        windowInfo.windowNumber,
        windowInfo.windowNumber > 1 ? windowInfo.windowNumber - 1 : null,
        windowInfo.windowNumber > 2 ? windowInfo.windowNumber - 2 : null,
        windowInfo.windowNumber > 3 ? windowInfo.windowNumber - 3 : null,
      ].filter((n) => n != null && n >= 1)
    : [windowInfo.windowNumber, prevPrevPrevPrevWindowNumber, prevPrevPrevWindowNumber, prevPrevWindowNumber, prevWindowNumber].filter(
        (n) => n != null
      );

  const buildWindowView = (winNum) => {
    if (winNum == null || !Number.isFinite(winNum)) return null;
    const resultsForPick = gameResults;
    const pw = pendingWindows.find((p) => p.windowNumber === winNum);
    const completed =
      lastCompletedWindow?.windowNumber === winNum ? lastCompletedWindow : null;
    const server = pickLatestGameResultForWindow(resultsForPick, winNum);

    const btcRefClock = (sec) => {
      const h = Math.floor(sec / 3600) % 24;
      const m = Math.floor((sec % 3600) / 60);
      return formatTime(h, m, 0);
    };

    const niftyLtpClock = () =>
      formatIstClockFromSec(niftyLtpEndSecForWindowNum(winNum, gameStartTime, niftyRoundSec));

    /** Official 15m close — same GameResult row as server settlement / Zerodha 15m C. */
    const serverClose =
      server?.closePrice != null &&
      Number.isFinite(Number(server.closePrice)) &&
      Number(server.closePrice) > 0
        ? Number(server.closePrice)
        : null;

    /** Match server settleUpDown: direction from stored result, else priceChange, else close vs prev close / open */
    const niftyDirectionFromGameResult = (sr) => {
      if (!sr) return null;
      const raw = String(sr.result ?? '')
        .trim()
        .toUpperCase();
      if (raw === 'UP' || raw === 'DOWN' || raw === 'TIE') return raw;
      const pc = Number(sr.priceChange);
      if (Number.isFinite(pc)) return pc > 0 ? 'UP' : pc < 0 ? 'DOWN' : 'TIE';
      const prevGr = Number(winNum) > 1 ? pickLatestGameResultForWindow(resultsForPick, winNum - 1) : null;
      const prevClose =
        prevGr != null && Number.isFinite(Number(prevGr.closePrice)) && Number(prevGr.closePrice) > 0
          ? Number(prevGr.closePrice)
          : null;
      const openPx = Number(sr.openPrice);
      const closePx = Number(sr.closePrice);
      const cmp = prevClose != null ? prevClose : openPx;
      if (Number.isFinite(closePx) && Number.isFinite(cmp)) {
        const d = closePx - cmp;
        return d > 0 ? 'UP' : d < 0 ? 'DOWN' : 'TIE';
      }
      return null;
    };

    // Nifty: DB GameResult beats client snapshots so tracker matches chart OHLC & API.
    if (!isBTC) {
      const resultPublished = hasWindowResultPublished(winNum);
      const lockedPx =
        lockedWindowLtps[winNum] != null &&
        Number.isFinite(Number(lockedWindowLtps[winNum])) &&
        Number(lockedWindowLtps[winNum]) > 0
          ? Number(lockedWindowLtps[winNum])
          : null;

      if (serverClose != null) {
        const marketDirection = niftyDirectionFromGameResult(server) ?? 'TIE';
        // Same IST clock as "Last 1h LTPs" for this window (15m candle close / Zerodha C), not declare time.
        return {
          ltp: serverClose,
          ltpWhen: niftyLtpClock(),
          // Official row with closePrice → show UP/DOWN + price immediately (don't wait on mismatched timers).
          resolved: true,
          resultPrice: serverClose,
          marketDirection,
          resultWhen: niftyLtpClock(),
          resultAt: niftyLtpClock(),
        };
      }

      // Kite/socket boundary lock + chart — show before Mongo `GameResult` row appears (same ₹ as LTP tape).
      if (lockedPx != null && resultPublished) {
        const prevGr = Number(winNum) > 1 ? pickLatestGameResultForWindow(resultsForPick, winNum - 1) : null;
        const prevCloseOfficial =
          prevGr != null &&
          Number.isFinite(Number(prevGr?.closePrice)) &&
          Number(prevGr.closePrice) > 0
            ? Number(prevGr.closePrice)
            : null;
        const prevCloseLock =
          winNum > 1 &&
          lockedWindowLtps[winNum - 1] != null &&
          Number.isFinite(Number(lockedWindowLtps[winNum - 1])) &&
          Number(lockedWindowLtps[winNum - 1]) > 0
            ? Number(lockedWindowLtps[winNum - 1])
            : null;
        const chainOpen = niftyChainedOpenPriceForWindow(winNum, resultsForPick);
        const ref = prevCloseOfficial ?? prevCloseLock ?? chainOpen;

        let marketDirection = 'TIE';
        if (ref != null && Number.isFinite(ref)) {
          marketDirection = lockedPx > ref ? 'UP' : lockedPx < ref ? 'DOWN' : 'TIE';
        }

        return {
          ltp: lockedPx,
          ltpWhen: niftyLtpClock(),
          resolved: true,
          resultPrice: lockedPx,
          marketDirection,
          resultWhen: niftyLtpClock(),
          resultAt: niftyLtpClock(),
        };
      }

      if (pw) {
        const ltpPx = lockedPx ?? pw.windowEndLTP;
        const hasPrice = ltpPx != null && Number.isFinite(Number(ltpPx)) && Number(ltpPx) > 0;
        const resolvedNow = resultPublished && hasPrice;

        let marketDirection = resolvedNow ? pw.marketDirection : null;
        let resultPrice = resolvedNow ? Number(ltpPx) : null;
        if (resolvedNow) {
          if (
            !marketDirection ||
            (marketDirection !== 'UP' && marketDirection !== 'DOWN' && marketDirection !== 'TIE')
          ) {
            const openRef = niftyChainedOpenPriceForWindow(winNum, resultsForPick);
            if (openRef != null && Number.isFinite(openRef)) {
              marketDirection =
                Number(ltpPx) > openRef ? 'UP' : Number(ltpPx) < openRef ? 'DOWN' : 'TIE';
            } else {
              marketDirection = 'TIE';
            }
          }
        }

        return {
          ltp: ltpPx,
          ltpWhen: pw.ltpTime || niftyLtpClock(),
          resolved: resolvedNow,
          resultPrice,
          marketDirection,
          resultWhen: niftyLtpClock(),
          resultAt: niftyLtpClock(),
        };
      }
      if (completed) {
        const ltpPx = lockedPx ?? completed.windowEndLTP;
        const hasPrice = ltpPx != null && Number.isFinite(Number(ltpPx)) && Number(ltpPx) > 0;
        const resolvedNow = resultPublished && hasPrice;

        let marketDirection = resolvedNow ? completed.marketDirection : null;
        let resultPrice = resolvedNow ? Number(ltpPx) : null;
        if (resolvedNow) {
          if (
            !marketDirection ||
            (marketDirection !== 'UP' && marketDirection !== 'DOWN' && marketDirection !== 'TIE')
          ) {
            const openRef = niftyChainedOpenPriceForWindow(winNum, resultsForPick);
            if (openRef != null && Number.isFinite(openRef)) {
              marketDirection =
                Number(ltpPx) > openRef ? 'UP' : Number(ltpPx) < openRef ? 'DOWN' : 'TIE';
            } else {
              marketDirection = 'TIE';
            }
          }
        }

        return {
          ltp: ltpPx,
          ltpWhen: completed.ltpTime || niftyLtpClock(),
          resolved: resolvedNow,
          resultPrice,
          marketDirection,
          resultWhen: niftyLtpClock(),
          resultAt: niftyLtpClock(),
        };
      }
      return null;
    }

    // BTC: stuck result price = GameResult.closePrice only (never live). Green/red/yellow = vs previous window, same day.
    if (
      server &&
      server.closePrice != null &&
      Number.isFinite(Number(server.closePrice)) &&
      Number(server.closePrice) > 0
    ) {
      const resultWhen = btcRefClock(btcResultRefSecForUiWindow(winNum));
      const cur = Number(server.closePrice);
      const prevGr = winNum > 1 ? pickLatestGameResultForWindow(resultsForPick, winNum - 1) : null;
      const prevC =
        prevGr && prevGr.closePrice != null && Number.isFinite(Number(prevGr.closePrice))
          ? Number(prevGr.closePrice)
          : null;
      let compareDir = 'tie';
      if (prevC != null) {
        if (cur > prevC) compareDir = 'up';
        else if (cur < prevC) compareDir = 'down';
        else compareDir = 'tie';
      } else {
        compareDir =
          server.result === 'UP' ? 'up' : server.result === 'DOWN' ? 'down' : 'tie';
      }
      return {
        ltp: cur,
        ltpWhen: resultWhen,
        resolved: true,
        resultPrice: cur,
        marketDirection: server.result === 'UP' ? 'UP' : server.result === 'DOWN' ? 'DOWN' : 'TIE',
        compareDir,
        resultWhen,
        resultAt: resultWhen,
      };
    }
    const curW = Number(windowInfo.windowNumber) || 0;
    if (curW > 0 && winNum === curW) {
      return {
        running: true,
        resolved: false,
        resultWhen: btcRefClock(btcResultRefSecForUiWindow(winNum)),
        compareDir: 'tie',
      };
    }
    return {
      resolved: false,
      waitingServer: true,
      resultWhen: btcRefClock(btcResultRefSecForUiWindow(winNum)),
      compareDir: 'tie',
    };
  };

  const fmtPx = (n) =>
    n != null && Number.isFinite(n)
      ? `${currSymbol}${n.toLocaleString(isBTC ? 'en-US' : 'en-IN', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : '—';

  // LTP History component to show last 1 hour (4 windows) of LTP values
  // Note: BTC doesn't use LTP concept - winners are decided by result prices only
  const LTPHistoryPanel = () => {
    // Don't show LTP panel for BTC
    if (isBTC) return null;
    
    const ltpHistory = useMemo(() => {
      const history = [];
      const currentWin = windowInfo.windowNumber;
      const niftyWindowEndClock = (winNum) =>
        formatIstClockFromSec(niftyLtpEndSecForWindowNum(winNum, gameStartTime, niftyRoundSec));
      
      // Get last 4 windows (1 hour = 4 x 15min windows), newest first
      for (let i = 0; i < 4; i++) {
        const winNum = currentWin - i - 1;
        if (winNum <= 0) continue;
        
        // Try to get data from game results first (official source)
        const gameResult = pickLatestGameResultForWindow(gameResults, winNum);
        // Try to get data from pending windows as fallback
        const pendingWindow = pendingWindows.find(pw => pw.windowNumber === winNum);
        
        let ltp = null;
        let time = null;
        let source = 'unknown';

        const ymd = getIstCalendarYmd();
        const bar15 = resolveNiftyUpDownWindow15mOhlcFromCandles(
          {
            ymd,
            marketOpenSec: niftyMarketOpenSnappedSecForGame(gameStartTime),
            roundDurationSec: niftyRoundSec,
            windowNumber: winNum,
          },
          nifty15CandlesForLtp
        );
        const kiteClose =
          bar15?.close != null && Number.isFinite(Number(bar15.close)) && Number(bar15.close) > 0
            ? Number(bar15.close)
            : null;

        // Kite 15m bar close first — same series as LiveChart OHLC `C` (panel is Nifty-only; BTC hidden above).
        if (kiteClose != null) {
          ltp = kiteClose;
          time = niftyWindowEndClock(winNum);
          source = 'kite15m_close';
        } else if (gameResult && gameResult.closePrice) {
          ltp = Number(gameResult.closePrice);
          time = niftyWindowEndClock(winNum);
          source = 'result';
        } else if (pendingWindow && pendingWindow.windowEndLTP) {
          ltp = lockedWindowLtps[winNum] ?? pendingWindow.windowEndLTP;
          time = niftyWindowEndClock(winNum);
          source = 'pending';
        } else if (
          lockedWindowLtps[winNum] != null &&
          Number.isFinite(Number(lockedWindowLtps[winNum])) &&
          Number(lockedWindowLtps[winNum]) > 0
        ) {
          /* Boundary LTP saved when pending row is gone / GameResult not fetched yet — e.g. 13:00 row was missing. */
          ltp = Number(lockedWindowLtps[winNum]);
          time = niftyWindowEndClock(winNum);
          source = 'locked';
        }
        
        // If no time available, use a default format
        if (!time && gameResult) {
          time = niftyWindowEndClock(winNum);
        }

        const clock = niftyWindowEndClock(winNum);
        const displayTime = time || clock;

        /** Always show last 4 legs (e.g. W18 @ 13:45 close) — if Kite/DB has not written GameResult yet, show row + "pending" instead of hiding the window. */
        if (ltp && ltp > 0) {
          history.push({
            windowNumber: winNum,
            ltp,
            time: displayTime,
            source,
            missing: false,
          });
        } else {
          history.push({
            windowNumber: winNum,
            ltp: null,
            time: displayTime,
            source,
            missing: true,
          });
        }
      }
      
      // For BTC games, validate and correct LTP consistency
      if (isBTC && history.length > 1) {
        for (let i = 0; i < history.length - 1; i++) {
          const currentWindow = history[i];
          const nextWindow = history[i + 1];
          
          // Check if these windows should have matching prices (consecutive windows)
          if (nextWindow.windowNumber === currentWindow.windowNumber + 1) {
            // Extract time components for comparison
            const getCurrentTimeStr = (timeData) => {
              if (!timeData) return null;
              
              if (typeof timeData === 'string') {
                if (timeData.includes('PM') || timeData.includes('AM')) {
                  // Extract just the time part (e.g., "8:15:00 PM" from "8:15:00 PM IST")
                  return timeData.split(' IST')[0].trim();
                } else if (timeData.includes('T')) {
                  const date = new Date(timeData);
                  return date.toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true,
                    timeZone: 'Asia/Kolkata'
                  });
                }
              } else {
                const date = new Date(timeData);
                return date.toLocaleTimeString('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  hour12: true,
                  timeZone: 'Asia/Kolkata'
                });
              }
              return null;
            };
            
            const currentTimeStr = getCurrentTimeStr(currentWindow.time);
            const nextTimeStr = getCurrentTimeStr(nextWindow.time);
            
            // If times match exactly (same hour:minute:second), prices should match
            if (currentTimeStr && nextTimeStr && currentTimeStr === nextTimeStr) {
              // Current window result should equal next window LTP
              if (Math.abs(currentWindow.ltp - nextWindow.ltp) > 0.01) {
                // Prioritize official game result over pending data
                if (currentWindow.source === 'official' || currentWindow.source === 'result') {
                  nextWindow.ltp = currentWindow.ltp;
                  nextWindow.source = 'corrected';
                } else if (nextWindow.source === 'official' || nextWindow.source === 'result') {
                  currentWindow.ltp = nextWindow.ltp;
                  currentWindow.source = 'corrected';
                }
              }
            }
          }
        }
      }
      
      return history;
    }, [
      windowInfo.windowNumber,
      pendingWindows,
      gameResults,
      gameStartTime,
      niftyRoundSec,
      lockedWindowLtps,
      nifty15CandlesForLtp,
    ]);

    if (ltpHistory.length === 0) {
      return (
        <div className="bg-dark-800 rounded-xl p-4 border border-dark-600 mb-3">
          <h3 className="text-xs font-bold text-gray-400 mb-2 flex items-center gap-1.5">
            <Timer size={12} className="text-blue-400" />
            Last 1 Hour LTPs
          </h3>
          <p className="text-gray-500 text-sm text-center py-3">
            No LTP data available yet
          </p>
        </div>
      );
    }

    return (
      <div className="bg-dark-800 rounded-xl p-4 border border-dark-600 mb-3">
        <h3 className="text-xs font-bold text-gray-400 mb-3 flex items-center gap-1.5">
          <Timer size={12} className="text-blue-400" />
          Last 1 Hour LTPs ({ltpHistory.length} windows)
        </h3>
        <div className="space-y-2">
          {ltpHistory.map((item, index) => (
            <div 
              key={item.windowNumber}
              className="flex items-center justify-between p-2 bg-dark-700/50 rounded-lg border border-dark-600"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">W#{item.windowNumber}</span>
                {index === 0 && (
                  <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">
                    Latest
                  </span>
                )}
              </div>
              <div className="text-right min-w-0">
                <div
                  className={`text-sm font-bold font-mono ${
                    item.missing ? 'text-gray-400' : 'text-cyan-400'
                  }`}
                >
                  {item.ltp != null && Number(item.ltp) > 0 ? (
                    <>
                      {isBTC ? '$' : '₹'}
                      {Number(item.ltp).toLocaleString('en-IN', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </>
                  ) : (
                    <span title="Official 15m close not loaded — Zerodha bar may still be syncing">
                      —
                    </span>
                  )}
                </div>
                {item.missing && (
                  <div className="text-[9px] text-amber-400/90 mt-0.5 leading-tight max-w-[200px] ml-auto">
                    Awaiting 15m candle close — price appears when GameResult saves (Kite).
                  </div>
                )}
                {item.time && (
                  <div className="text-[10px] text-gray-500">
                    {(() => {
                      // Simple time formatting - avoid Invalid Date
                      if (!item.time) return 'Time not available';
                      
                      if (typeof item.time === 'string') {
                        // If already formatted, return as is
                        if (item.time.includes('PM') || item.time.includes('AM')) {
                          return item.time;
                        }
                        // Try to parse and format
                        try {
                          const date = new Date(item.time);
                          if (isNaN(date.getTime())) {
                            return item.time; // Return original if invalid
                          }
                          return date.toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            hour12: true,
                            timeZone: 'Asia/Kolkata'
                          }) + ' IST';
                        } catch (e) {
                          return item.time; // Return original if error
                        }
                      }
                      
                      // Handle Date objects
                      try {
                        const date = new Date(item.time);
                        if (isNaN(date.getTime())) {
                          return 'Time not available';
                        }
                        return date.toLocaleTimeString('en-IN', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: true,
                          timeZone: 'Asia/Kolkata'
                        }) + ' IST';
                      } catch (e) {
                        return 'Time not available';
                      }
                    })()}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const WindowResultTracker = () => {
    if (isBTC) {
      if (!windowInfo.windowNumber || windowInfo.windowNumber < 1) {
        return (
          <div className="bg-dark-800 rounded-xl p-4 border border-dark-600 mb-3">
            <h3 className="text-xs font-bold text-gray-400 mb-2 flex items-center gap-1.5">
              <BarChart3 size={12} className="text-purple-400" />
              Windows
            </h3>
            <p className="text-gray-500 text-sm text-center py-3">Loading…</p>
          </div>
        );
      }
    } else if (prevWindowNumber == null) {
      return (
        <div className="bg-dark-800 rounded-xl p-4 border border-dark-600 mb-3">
          <h3 className="text-xs font-bold text-gray-400 mb-2 flex items-center gap-1.5">
            <BarChart3 size={12} className="text-purple-400" />
            Recent windows
          </h3>
          <p className="text-gray-500 text-sm text-center py-3">
            {windowInfo.windowNumber <= 1
              ? 'No previous window yet.'
              : 'Unavailable right now.'}
          </p>
        </div>
      );
    }

    const sortedNums = [...trackerWindowNumbers].sort((a, b) => a - b);
    const rows = sortedNums.map((n) => ({ n, view: buildWindowView(n) }));
    const allMissing = rows.every((r) => !r.view);

    if (allMissing && loadingResults) {
      return (
        <div className="bg-dark-800 rounded-xl p-4 border border-dark-600 mb-3">
          <h3 className="text-xs font-bold text-gray-400 mb-2 flex items-center gap-1.5">
            <BarChart3 size={12} className="text-purple-400" />
            Recent windows
          </h3>
          <div className="text-center py-4">
            <RefreshCw className="animate-spin mx-auto text-purple-400 mb-2" size={20} />
            <div className="text-gray-500 text-sm">Loading…</div>
          </div>
        </div>
      );
    }

    const renderCard = (winNum, view) => {
      const isLatestClosed = winNum === prevWindowNumber;
      const isCurrentWindow = Number(winNum) === Number(windowInfo.windowNumber);
      const pwForWin = pendingWindows.find((p) => Number(p.windowNumber) === Number(winNum));
      if (!view) {
        return (
          <div
            key={winNum}
            className="bg-dark-800 rounded-xl p-4 border border-dark-600 mb-2 last:mb-0"
          >
            <h3 className="text-xs font-bold text-gray-400 mb-2 flex items-center gap-1.5">
              <BarChart3 size={12} className="text-purple-400" />
              Window #{winNum}
            </h3>
            {isCurrentWindow ? (
              <div className="text-center py-2 space-y-1">
                <p className="text-green-400/95 text-sm font-medium">
                  Currently this window is running
                </p>
                <p className="text-gray-500 text-xs">
                  {windowInfo.windowStart} → {windowInfo.windowEnd} · Result @ {windowInfo.resultTime} IST
                </p>
              </div>
            ) : isLatestClosed ? (
              <div className="text-gray-500 text-sm text-center py-2 space-y-2">
                <p>
                  {isBTC ? (
                    <>
                      <span className="text-gray-400">Result</span> is published after{' '}
                      <span className="text-purple-400 font-medium">{windowInfo.resultTime}</span> IST when
                      the official window prices are ready.
                    </>
                  ) : (
                    <>
                      <span className="text-gray-400">LTP</span> when this window ends;{' '}
                      <span className="text-gray-400">Result</span> (same Nifty spot as the next window&apos;s LTP)
                      {pwForWin?.resultTime ? (
                        <>
                          {' '}
                          @ <span className="text-purple-400 font-medium">{pwForWin.resultTime}</span> IST.
                        </>
                      ) : (
                        '.'
                      )}
                    </>
                  )}
                </p>
                <p className="text-gray-600 text-xs">
                  {isBTC
                    ? 'Loading official BTC result from the server…'
                    : 'Waiting for a live price tick. If you reloaded after LTP time, the next quote may differ slightly.'}
                </p>
              </div>
            ) : (
              <p className="text-gray-500 text-sm text-center py-2">
                {isBTC
                  ? 'Result data for this window is syncing. It will show here once the server publishes LTP/close for the round.'
                  : `No data for window #${winNum} yet. Older rounds appear here from `}
                {!isBTC && (
                  <>
                    <span className="text-gray-400">Previous Results</span> after they settle.
                  </>
                )}
              </p>
            )}
          </div>
        );
      }

      if (isBTC && view.running) {
        return (
          <div
            key={winNum}
            className="bg-dark-800 rounded-xl p-4 border border-dark-600 mb-2 last:mb-0 border-emerald-500/30"
          >
            <h3 className="text-xs font-bold text-gray-400 mb-2 flex items-center gap-1.5">
              <BarChart3 size={12} className="text-emerald-400" />
              Running · #{winNum}
            </h3>
            <div className="text-center py-2 space-y-1">
              <p className="text-emerald-400/95 text-sm font-medium">This round is open</p>
              <p className="text-gray-500 text-xs">
                {windowInfo.windowStart} → {windowInfo.windowEnd} · Result prints @ {view.resultWhen} IST (fixed from server)
              </p>
            </div>
          </div>
        );
      }

      const dir = view.marketDirection;
      const comp = view.compareDir;
      const useBtcComp = isBTC && comp;
      const dirClass = useBtcComp
        ? comp === 'up'
          ? 'text-green-400'
          : comp === 'down'
            ? 'text-red-400'
            : 'text-yellow-400'
        : dir === 'UP'
          ? 'text-green-400'
          : dir === 'DOWN'
            ? 'text-red-400'
            : 'text-yellow-400';
      const dirLabel = useBtcComp
        ? comp === 'up'
          ? 'UP ▲'
          : comp === 'down'
            ? 'DOWN ▼'
            : 'TIE'
        : dir === 'UP'
          ? 'UP ▲'
          : dir === 'DOWN'
            ? 'DOWN ▼'
            : 'TIE';
      const title = isBTC
        ? isCurrentWindow
          ? `Running · #${winNum}`
          : `Window #${winNum}`
        : isLatestClosed
          ? `Last window (#${winNum})`
          : `Window #${winNum}`;

      return (
        <div
          key={winNum}
          className="bg-dark-800 rounded-xl p-4 border border-dark-600 mb-2 last:mb-0"
        >
          <h3 className="text-xs font-bold text-gray-400 mb-3 flex items-center gap-1.5">
            <BarChart3 size={12} className="text-purple-400" />
            {title}
          </h3>
          <div className="bg-dark-700/50 rounded-lg p-3 border border-dark-600 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <span className="text-gray-400 text-sm shrink-0 pt-0.5">Result</span>
              {view.resolved ? (
                <div className="text-right min-w-0">
                  <div>
                    <span className={`font-bold font-mono tabular-nums ${dirClass}`}>
                      {fmtPx(view.resultPrice)}
                    </span>
                    <span className={`ml-2 text-xs font-bold ${dirClass}`}>{dirLabel}</span>
                  </div>
                  {isBTC && (
                    <div className="text-[9px] text-gray-500 mt-0.5">vs previous window (same day)</div>
                  )}
                  {view.resultWhen ? (
                    <div className="text-[10px] text-gray-500 mt-1 leading-snug">
                      Result @ {view.resultWhen}
                      <span className="text-gray-600"> IST</span>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="text-right min-w-0">
                  <div className="text-amber-400/95 text-sm font-medium">
                    {isBTC && view.waitingServer ? 'Loading result from server…' : 'Pending'}
                  </div>
                  {view.resultWhen ? (
                    <div className="text-[10px] text-gray-500 mt-1 leading-snug">
                      Result @ {view.resultWhen}
                      <span className="text-gray-600"> IST</span>
                    </div>
                  ) : view.resultAt ? (
                    <div className="text-[10px] text-gray-500 mt-1 leading-snug">
                      Result @ {view.resultAt}
                      <span className="text-gray-600"> IST</span>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    };

    return (
      <div className="mb-3 space-y-0">
        {isBTC && (
          <h3 className="text-xs font-bold text-gray-400 mb-2 flex items-center gap-1.5 px-0.5">
            <BarChart3 size={12} className="text-purple-400" />
            Last 3 result prices + current round
          </h3>
        )}
        {rows.map(({ n, view }) => renderCard(n, view))}
      </div>
    );
  };

  const fetchHistory = async () => {
    try {
      const { data } = await axios.get(`/api/user/game-bets/${game.id === 'btcupdown' ? 'btcupdown' : 'updown'}`, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setTradeHistory(data);
    } catch (error) {
      console.error('Error fetching history:', error);
    }
  };

  const checkTradeResults = async () => {
    if (checkTradeResultsInFlightRef.current) return;
    checkTradeResultsInFlightRef.current = true;
    try {
      const { data } = await axios.get(`/api/user/updown/results?gameId=${game.id === 'btcupdown' ? 'btcupdown' : 'updown'}`, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      if (!data.results?.length) return;

      const aggregated = aggregateUpdownResultsByWindow(data.results)
        .filter((r) => r.won)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      let addedAny = false;
      setTradeResults((prev) => {
        const nextTop = aggregated.slice(0, RECENT_UP_DOWN_WINS);
        const prevWn = new Set(prev.map((p) => p.windowNumber));
        addedAny = nextTop.some((n) => !prevWn.has(n.windowNumber));
        return nextTop;
      });

      if (addedAny) {
        fetchActiveTrades();
        fetchHistory();
      }
    } catch (error) {
      console.error('Error checking trade results:', error);
    } finally {
      checkTradeResultsInFlightRef.current = false;
    }
  };

  const fetchActiveTrades = async () => {
    try {
      const endpoint = isBTC
        ? '/api/user/updown/active?gameId=btcupdown'
        : '/api/user/updown/active?gameId=updown';
      const { data } = await axios.get(endpoint, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      const rows = Array.isArray(data) ? data : [];
      setActiveTrades(
        rows.map((t) => ({
          ...t,
          id: t.id != null ? t.id : t._id,
          windowNumber: t.windowNumber != null ? Number(t.windowNumber) : t.windowNumber,
        }))
      );
    } catch (error) {
      console.error('Error fetching active trades:', error);
    }
  };

  // Fetch active trades and history on mount and when the trading window advances (ledger must stay in sync)
  useEffect(() => {
    console.log('[DEBUG] GameScreen useEffect triggered for game:', game.id);
    fetchActiveTrades();
    fetchHistory();
    checkTradeResults();
  }, [game.id, user.token, windowInfo.windowNumber]);

  // Check for results + server window results periodically (keeps tracker/history in sync after auto-settle)
  useEffect(() => {
    // Faster polling for BTC UP/DOWN to get immediate results
    const pollingInterval = isBTC ? 500 : 1000; // 0.5s for BTC, 1s for others
    
    // Initial fetch for BTC to ensure we have latest data
    if (isBTC) {
      console.log('[BTC] Initial fetch for game results...');
      fetchGameResults();
    }
    
    const interval = setInterval(() => {
      console.log('[BTC] Polling for game results...');
      fetchGameResults();
      checkTradeResults();
    }, pollingInterval);

    return () => clearInterval(interval);
  }, [game.id, user.token, isBTC, fetchGameResults, checkTradeResults]);

  return (
    <div className="h-screen bg-dark-900 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className={`bg-gradient-to-r ${game.color} h-1 flex-shrink-0`}></div>
      <div className="bg-dark-800 border-b border-dark-600 flex-shrink-0">
        <div className="px-4 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={onBack} className="p-2 hover:bg-dark-700 rounded-lg transition">
                <ArrowLeft size={20} />
              </button>
              <div className="flex items-center gap-2">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${game.color} flex items-center justify-center`}>
                  <game.icon size={20} />
                </div>
                <div>
                  <h1 className="font-bold">{game.name}</h1>
                  <p className="text-xs text-gray-400">{winMultiplier}x Returns</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowInstructions(true)}
                className="p-2 bg-dark-700 hover:bg-dark-600 rounded-lg transition"
                title="Instructions"
              >
                <Info size={18} className="text-purple-400" />
              </button>
              <div className="flex items-center gap-2.5 rounded-xl bg-dark-700/95 border border-purple-500/35 px-3 py-2 sm:px-4 sm:py-2.5 min-w-0 max-w-[min(100%,220px)] sm:max-w-none">
                <Coins size={22} className="text-purple-400 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] sm:text-xs font-medium text-sky-200/90 tracking-wide">Games wallet</div>
                  <div className="text-lg sm:text-xl font-bold text-white tabular-nums leading-snug">
                    {balanceTokens} Tkt
                  </div>
                  <div className="text-sm sm:text-base text-gray-400 tabular-nums leading-tight">
                    ₹{Number(balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3-Column Desktop Layout / Stacked Mobile - Full Height */}
      <div className="px-3 py-2 flex-1 min-h-0 overflow-y-auto overscroll-y-contain lg:overflow-hidden touch-pan-y">
        <div className="flex flex-col lg:flex-row gap-3 min-h-min lg:h-full lg:min-h-0">

          {/* LEFT COLUMN - Trading Window Status */}
          <div className="lg:w-[240px] flex-shrink-0 order-1 lg:order-1 overflow-y-auto">
            <WindowStatusBadge />
            <LTPHistoryPanel />
            {isBTC && (
              <div className="bg-dark-800 rounded-xl p-3 border border-cyan-500/35 mb-3">
                <h3 className="text-xs font-bold text-cyan-200/95 mb-2 flex items-center gap-1.5">
                  <BarChart3 size={12} className="text-cyan-400" />
                  Last 3 result LTPs
                </h3>
                {btcLastThreeResultLtps.length === 0 ? (
                  <p className="text-gray-500 text-xs text-center py-2 leading-snug">
                    No results loaded yet — each :15 / :30 / :45 close will appear here from the server.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {btcLastThreeResultLtps.map((row, idx) => {
                      const prevInList = idx > 0 ? btcLastThreeResultLtps[idx - 1] : null;
                      let rel = 'tie';
                      if (prevInList) {
                        if (row.ltp > prevInList.ltp) rel = 'up';
                        else if (row.ltp < prevInList.ltp) rel = 'down';
                        else rel = 'tie';
                      }
                      const relCls =
                        rel === 'up' ? 'text-green-400' : rel === 'down' ? 'text-red-400' : 'text-amber-300/90';
                      const t = formatBtcResultIst(row.w);
                      return (
                        <li
                          key={row.w}
                          className="rounded-lg border border-dark-600 bg-dark-700/50 px-2.5 py-2"
                        >
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <span className="text-[11px] text-gray-400 font-medium">
                              Result @ {t} <span className="text-gray-500">IST</span>
                            </span>
                            {prevInList ? (
                              <span className={`text-[10px] font-semibold ${relCls}`}>
                                {rel === 'up' ? '↑ vs line above' : rel === 'down' ? '↓ vs line above' : '= same'}
                              </span>
                            ) : null}
                          </div>
                          <div
                            className={`text-sm font-mono font-bold tabular-nums ${
                              prevInList ? relCls : 'text-cyan-300'
                            }`}
                          >
                            ${row.ltp.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="text-[10px] text-gray-500 mt-2 leading-snug">
                  Stuck LTP from the server for each time — compare lines to see if the next price is lower or
                  higher than the one before (e.g. 00:30 vs 00:15).
                </p>
              </div>
            )}
            <WindowResultTracker />

            {/* Game Info Card */}
            <div className="bg-dark-800 rounded-xl p-4 border border-dark-600">
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${game.color} flex items-center justify-center`}>
                  <game.icon size={24} />
                </div>
                <div>
                  <h3 className="font-bold">{game.name}</h3>
                  <p className="text-xs text-gray-400">{game.description}</p>
                </div>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between py-1 border-b border-dark-600">
                  <span className="text-gray-400">Win Multiplier</span>
                  <span className="text-green-400 font-bold">{winMultiplier}x</span>
                </div>
                <div className="flex justify-between py-1 border-b border-dark-600">
                  <span className="text-gray-400">Fee on win profit</span>
                  <span className="text-green-400 font-medium">None</span>
                </div>
                <div className="flex justify-between py-1 border-b border-dark-600">
                  <span className="text-gray-400">Min Bet</span>
                  <span className="font-medium">{minBetTokens} Tickets</span>
                </div>
                <div className="flex justify-between py-1 border-b border-dark-600">
                  <span className="text-gray-400">Max Bet</span>
                  <span className="font-medium">{maxBetTokens} Tickets</span>
                </div>
                <div className="flex justify-between py-1 border-b border-dark-600">
                  <span className="text-gray-400">1 Ticket</span>
                  <span className="font-medium">₹{tokenValue}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-gray-400">Players</span>
                  <span className="font-medium">{game.players}</span>
                </div>
              </div>
              <div className="mt-2 bg-dark-700/50 rounded-lg p-2 text-[10px] text-gray-500">
                Win 1 Ticket bet → <span className="text-green-400 font-medium">{(winMultiplier - 1).toFixed(2)} T profit</span> (stake returned + full multiplier payout, no fee on profit)
              </div>
              <button
                onClick={() => setShowInstructions(true)}
                className="w-full mt-3 py-2 bg-dark-700 hover:bg-dark-600 rounded-lg text-sm text-purple-400 font-medium transition flex items-center justify-center gap-2"
              >
                <BookOpen size={14} />
                How to Play
              </button>
            </div>
          </div>

          {/* CENTER COLUMN - Live price (Socket.IO only) */}
          <div className="flex-1 min-w-0 order-2 max-lg:order-3 flex flex-col min-h-0 max-lg:flex-none max-lg:max-h-[min(42vh,400px)] lg:flex-1">
            <GameLivePricePanel 
              gameId={game.id} 
              fullHeight 
              closedNiftyStickMode={!isBTC && game.id === 'updown' ? 'clearing' : undefined}
              onPriceUpdate={handlePriceUpdate}
              onSyncedNiftyCandlesForLtp={game.id === 'updown' ? handleSyncedNiftyCandlesForLtp : undefined}
              priceLines={openUpDownTrades
                .filter((trade, index, self) => 
                  index === self.findIndex(t => t.entryPrice === trade.entryPrice) && 
                  (trade.prediction === 'UP' || trade.prediction === 'DOWN')
                )
                .map(t => ({ id: t.id, price: t.entryPrice, prediction: t.prediction }))}
            />
          </div>

          {/* RIGHT COLUMN - Betting Controls + Active Trades + History */}
          <div className="w-full max-w-full lg:w-[300px] flex-shrink-0 order-3 max-lg:order-2 flex flex-col lg:h-full lg:min-h-0 lg:overflow-y-auto max-lg:overflow-visible pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {/* Betting Controls - Always visible when window is open */}
            <div className="space-y-3 flex-shrink-0">
              {/* Current Price Display */}
              <div className="bg-dark-800 rounded-xl p-4 border border-dark-600">
                <div className="text-xs text-gray-400 mb-1 text-center">
                  {isBTC ? 'BTC/USDT' : 'NIFTY 50'} Current Price
                </div>
                {sidePanelPrice && sidePanelPrice > 0 ? (
                  <div className="text-2xl font-bold text-center text-cyan-300 tabular-nums">
                    {isBTC ? '$' : '₹'}{sidePanelPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                ) : (
                  <div className="text-center py-2">
                    <RefreshCw className="animate-spin text-cyan-400 mx-auto mb-1" size={16} />
                    <p className="text-xs text-gray-500">Loading price...</p>
                  </div>
                )}
              </div>
              {/* Trade Results Display */}
              {tradeResults.length > 0 && (
                <div className="rounded-xl border-2 border-dark-500 bg-dark-900/80 shadow-lg shadow-black/30 flex flex-col min-h-0 overflow-hidden">
                  <div className="px-3 py-2 border-b border-dark-600 bg-dark-800/90 shrink-0">
                    <h3 className="text-xs font-bold text-gray-300 tracking-wide uppercase flex items-center gap-1.5">
                      <Trophy size={14} className="text-amber-400 shrink-0" aria-hidden />
                      Recent Results
                    </h3>
                  </div>
                  <div className="p-3 max-h-36 overflow-y-auto overscroll-y-contain touch-pan-y scrollbar-thin [scrollbar-width:thin] [scrollbar-color:rgba(100,116,139,0.5)_transparent]">
                    <div className="space-y-2">
                      {tradeResults.slice(0, RECENT_UP_DOWN_WINS).map((result) => (
                        <div
                          key={`updown-result-${result.windowNumber}`}
                          role="status"
                          className={`rounded-xl border-2 p-3 text-xs font-medium shadow-md ${
                            result.won
                              ? 'bg-green-950/40 text-green-300 border-green-500/50 shadow-green-900/20'
                              : 'bg-red-950/40 text-red-300 border-red-500/50 shadow-red-900/20'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2 mb-2">
                            <span className="truncate font-semibold text-white/90">
                              Window #{result.windowNumber}
                            </span>
                            <span className="font-bold shrink-0 px-2 py-0.5 rounded-md bg-black/25 border border-white/10">
                              {result.won ? 'YOU WON!' : 'YOU LOST'}
                            </span>
                          </div>
                          <div className="rounded-lg bg-black/20 border border-white/5 px-2.5 py-2 text-[11px] leading-snug break-words">
                            <div className="text-gray-400 text-[10px] uppercase tracking-wide mb-1">Outcome</div>
                            <div>
                              {result.prediction} → {result.resultPrice?.toLocaleString()}
                              {result.pnl ? (
                                <span className="ml-2 font-mono tabular-nums">
                                  {result.pnl >= 0 ? '+' : ''}
                                  {result.pnl.toLocaleString()} T
                                </span>
                              ) : null}
                            </div>
                          </div>
                          {result.betPlacedAt ? (
                            <div className="mt-2 rounded-lg bg-black/20 border border-white/5 px-2.5 py-2 text-[10px] text-gray-400 flex items-center gap-1.5">
                              <Timer size={12} className="shrink-0 text-gray-500" aria-hidden />
                              <span>
                                <span className="text-gray-500 uppercase tracking-wide mr-1">Placed</span>
                                {formatBetPlacedAtIST(result.betPlacedAt)}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {/* Bet Amount */}
              <div className="bg-dark-800 rounded-xl p-4 border border-dark-600">
                <label className="block text-sm text-gray-400 mb-2">Enter Tickets</label>
                <input
                  type="number"
                  value={betAmount}
                  onChange={e => setBetAmount(e.target.value)}
                  min={minBetTokens}
                  max={maxBetTokens}
                  step="0.01"
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2.5 text-xl font-bold text-center focus:border-purple-500 focus:outline-none"
                />
                <div className="text-[10px] text-gray-500 mt-1 text-center">Min {minBetTokens} • Max {maxBetTokens} Tickets (1Tkt = ₹{actualTokenValue})</div>
                <div className="grid grid-cols-4 gap-1.5 mt-2">
                  {quickAmounts.map(amt => (
                    <button
                      key={amt}
                      onClick={() => setBetAmount(amt.toString())}
                      className="py-1.5 bg-dark-700 hover:bg-dark-600 rounded-lg text-xs font-medium transition"
                    >
                      {amt} T
                    </button>
                  ))}
                </div>
              </div>

              {/* Prediction Selection */}
              <div className="bg-dark-800 rounded-xl p-4 border border-dark-600">
                <label className="block text-sm text-gray-400 mb-2">Make Your Prediction</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setPrediction('UP')}
                    disabled={!windowInfo.canTrade}
                    className={`p-3 rounded-xl border-2 transition-all ${
                      !windowInfo.canTrade ? 'opacity-50 cursor-not-allowed border-dark-600' :
                      prediction === 'UP' 
                        ? 'border-green-500 bg-green-500/20' 
                        : 'border-dark-600 hover:border-green-500/50'
                    }`}
                  >
                    <ArrowUpCircle size={24} className={`mx-auto mb-1 ${prediction === 'UP' ? 'text-green-400' : 'text-gray-400'}`} />
                    <div className="font-bold text-sm">UP</div>
                    <div className="text-[10px] text-gray-400">{winMultiplier}x Returns</div>
                  </button>
                  <button
                    onClick={() => setPrediction('DOWN')}
                    disabled={!windowInfo.canTrade}
                    className={`p-3 rounded-xl border-2 transition-all ${
                      !windowInfo.canTrade ? 'opacity-50 cursor-not-allowed border-dark-600' :
                      prediction === 'DOWN' 
                        ? 'border-red-500 bg-red-500/20' 
                        : 'border-dark-600 hover:border-red-500/50'
                    }`}
                  >
                    <ArrowDownCircle size={24} className={`mx-auto mb-1 ${prediction === 'DOWN' ? 'text-red-400' : 'text-gray-400'}`} />
                    <div className="font-bold text-sm">DOWN</div>
                    <div className="text-[10px] text-gray-400">{winMultiplier}x Returns</div>
                  </button>
                </div>
              </div>

              {/* Place Bet Button */}
              <button
                onClick={handlePlaceBet}
                disabled={!betAmount || !prediction || parseFloat(betAmount) <= 0 || !windowInfo.canTrade}
                className={`w-full py-3 rounded-xl font-bold text-sm transition-all ${
                  betAmount && prediction && parseFloat(betAmount) > 0 && windowInfo.canTrade
                    ? `bg-gradient-to-r ${game.color} hover:opacity-90`
                    : 'bg-dark-700 text-gray-500 cursor-not-allowed'
                }`}
              >
                {!windowInfo.canTrade
                  ? 'Trading Window Closed'
                  : betAmount && prediction 
                    ? `Place Trade - ${parseFloat(betAmount)} Tickets` 
                    : 'Select Amount & Prediction'}
              </button>
            </div>

            {/* Active Trades: current window only */}
            <div className="mt-3 flex-shrink-0">
              <div className="flex items-center justify-between mb-1.5">
                <h3 className="text-xs font-bold text-yellow-400">
                  Active Trades - Window #{windowInfo.windowNumber} ({openUpDownTrades.length})
                </h3>
                <div className="flex items-center gap-2">
                  {openUpDownTrades.length > 0 && (
                    <div className="flex items-center gap-1">
                      <RefreshCw className="animate-spin text-green-400" size={10} />
                      <span className="text-[10px] text-green-400">Open</span>
                    </div>
                  )}
                </div>
              </div>
              {openUpDownTrades.length === 0 ? (
                <div className="bg-dark-800 rounded-xl p-2.5 border border-dark-600 text-center">
                  <p className="text-[10px] text-gray-500">No active trades. Place a trade in this window to see it here.</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {openUpDownTrades.map(trade => {
                    const isUp = trade.prediction === 'UP';
                    const key = trade._awaitingResult ? `${trade.id}-pending-${trade._settledWindow}` : `${trade.id}-live`;
                    return (
                      <div key={key} className={`rounded-lg p-2.5 border-l-4 ${
                        isUp ? 'bg-green-900/20 border-green-500' : 'bg-red-900/20 border-red-500'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs font-bold ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                              {trade.prediction}
                            </span>
                            <span className="text-xs text-gray-400">{toTokens(trade.amount)} T</span>
                            {trade._awaitingResult && (
                              <span className="text-[9px] text-amber-400/90 bg-amber-500/10 px-1.5 py-0.5 rounded">
                                Awaiting result
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-gray-400 shrink-0">W#{trade.windowNumber}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Circuit Breaker Info Section - Compact */}
            {!isBTC && (
              <div className="mt-3 flex-shrink-0">
                <div className="bg-gradient-to-r from-yellow-900/20 to-orange-900/20 rounded-xl p-2.5 border border-yellow-500/30">
                  <h3 className="text-[10px] font-bold text-yellow-400 flex items-center gap-1 mb-1.5">
                    <AlertCircle size={10} />
                    Circuit Breaker Rules
                  </h3>
                  <div className="flex gap-2 text-[9px]">
                    <div className="flex-1 bg-green-900/30 rounded-lg p-1.5 border border-green-500/20">
                      <span className="font-bold text-green-400">🟢 UPPER CIRCUIT</span>
                      <p className="text-gray-400 mt-0.5">Ask=0 → BUY blocked</p>
                    </div>
                    <div className="flex-1 bg-red-900/30 rounded-lg p-1.5 border border-red-500/20">
                      <span className="font-bold text-red-400">🔴 LOWER CIRCUIT</span>
                      <p className="text-gray-400 mt-0.5">Bid=0 → SELL blocked</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Results Section - Previous Window Results */}
            <div className="mt-3 flex-shrink-0">
              <div className="flex items-center justify-between mb-1.5">
                <h3 className="text-xs font-bold text-purple-400 flex items-center gap-1">
                  <Trophy size={12} />
                  Previous Results
                </h3>
                <button 
                  onClick={fetchGameResults}
                  className="text-[10px] text-gray-500 hover:text-gray-300 flex items-center gap-1"
                >
                  <RefreshCw size={10} />
                  Refresh
                </button>
              </div>
              
              {loadingResults ? (
                <div className="bg-dark-800 rounded-xl p-2 border border-dark-600 text-center">
                  <RefreshCw className="animate-spin mx-auto text-purple-400" size={14} />
                </div>
              ) : previousResultsStrip.length === 0 ? (
                <div className="bg-dark-800 rounded-xl p-2 border border-dark-600 text-center">
                  <p className="text-[10px] text-gray-500">No results yet</p>
                </div>
              ) : (
                <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-thin">
                  {previousResultsStrip.slice(0, 14).map((result, idx) => (
                    <div 
                      key={result._id || `w${result.windowNumber}-${idx}`} 
                      className={`flex-shrink-0 bg-dark-800 rounded-lg px-2 py-1.5 border ${
                        result.result === 'UP'
                          ? 'border-green-500/30'
                          : result.result === 'DOWN'
                            ? 'border-red-500/30'
                            : 'border-amber-500/30'
                      }`}
                    >
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-gray-500">#{result.windowNumber}</span>
                        <span
                          className={`text-[10px] font-bold ${
                            result.result === 'UP'
                              ? 'text-green-400'
                              : result.result === 'DOWN'
                                ? 'text-red-400'
                                : 'text-amber-300'
                          }`}
                        >
                          {result.result === 'UP' ? '▲' : result.result === 'DOWN' ? '▼' : '—'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Trade History */}
            <div className="mt-3 flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between mb-1.5 flex-shrink-0">
                <h3 className="text-xs font-bold text-gray-300">Trade History (Previous Windows)</h3>
                <div className="flex items-center gap-2">
                  {upDownMergedHistory.length > 0 && (
                    <span className="text-[10px] text-gray-500">{upDownMergedHistory.length} trade{upDownMergedHistory.length !== 1 ? 's' : ''}</span>
                  )}
                </div>
              </div>

              {upDownMergedHistory.length === 0 && openUpDownTrades.length === 0 ? (
                <div className="bg-dark-800 rounded-xl p-3 border border-dark-600 text-center">
                  <Timer size={16} className="mx-auto mb-1.5 text-gray-600" />
                  <p className="text-[10px] text-gray-500">No trades yet. Place your first trade!</p>
                </div>
              ) : upDownMergedHistory.length === 0 ? null : (
                <div className="flex-1 overflow-y-auto space-y-1 pr-1 scrollbar-thin">
                  {/* Summary Row */}
                  <div className="bg-dark-800 rounded-lg p-2 border border-dark-600 flex items-center justify-between">
                    <div className="text-[11px]">
                      <span className="text-gray-400">P&L: </span>
                      <span className={`font-bold ${
                        (upDownMergedHistory || []).reduce((sum, t) => sum + (Number(t.pnl) || 0), 0) >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {(upDownMergedHistory || []).reduce((sum, t) => sum + (Number(t.pnl) || 0), 0) >= 0 ? '+' : ''}{toTokens((upDownMergedHistory || []).reduce((sum, t) => sum + (Number(t.pnl) || 0), 0))} T
                      </span>
                    </div>
                    <div className="text-[11px]">
                      <span className="text-green-400">{(upDownMergedHistory || []).filter((t) => t.won === true).length}W</span>
                      <span className="text-gray-600 mx-0.5">/</span>
                      <span className="text-red-400">{(upDownMergedHistory || []).filter((t) => t.won === false).length}L</span>
                    </div>
                  </div>

                  {/* Individual Trades */}
                  {(upDownMergedHistory || []).map((trade, idx) => (
                    <div
                      key={`${trade.id}-${idx}`}
                      className={`bg-dark-800 rounded-lg p-2 border ${
                        trade.won === true
                          ? 'border-green-500/20'
                          : trade.won === false
                            ? 'border-red-500/20'
                            : 'border-amber-500/15'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              trade.won === true
                                ? 'bg-green-500/20 text-green-400'
                                : trade.won === false
                                  ? 'bg-red-500/20 text-red-400'
                                  : 'bg-amber-500/15 text-amber-300'
                            }`}
                          >
                            {trade.prediction || 'UP'}
                          </span>
                          <span className="text-[10px] text-gray-500">#{trade.windowNumber || '--'}</span>
                          {trade._awaitingResult && (
                            <span className="text-[10px] text-yellow-400">
                              Pending
                            </span>
                          )}
                        </div>
                        <span
                          className={`text-xs font-bold ${
                            trade.won === true
                              ? 'text-green-400'
                              : trade.won === false
                                ? 'text-red-400'
                                : 'text-gray-400'
                          }`}
                        >
                          {trade._awaitingResult
                            ? '—'
                            : `${(Number(trade.pnl) || 0) >= 0 ? '+' : ''}${toTokens(Number(trade.pnl) || 0)} T`}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-gray-500">
                        <span>{toTokens(trade.amount || 0)} T • {trade.time || '--'}</span>
                        <span>
                          {game.id === 'btcupdown' ? '$' : ''}{(trade.entryPrice || 0).toLocaleString()} → {game.id === 'btcupdown' ? '$' : ''}{(trade.exitPrice || 0).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <GamesWalletGameLedgerPanel
              gameId={ledgerGameIdFromUi(game.id)}
              userToken={user?.token}
              tokenValue={actualTokenValue}
              title="Order history"
              limit={500}
              enableDateFilter
            />

          </div>

        </div>
      </div>
      
      {/* Instructions Modal */}
      {showInstructions && (
        <InstructionsModal onClose={() => setShowInstructions(false)} gameId={game.id} />
      )}
    </div>
  );
};

// ==================== NIFTY NUMBER SCREEN ====================
const NiftyNumberScreen = ({
  game,
  balance,
  onBack,
  user,
  refreshBalance,
  settings,
  tokenValue,
  apiBase = '/api/user/nifty-number',
  livePriceGameId = 'updown',
  resultTimeFallback = '15:45',
  clearingLabel = 'Clearing (last 15m bar close, IST)',
  /** true = full .00–.99 grid (e.g. BTC Number); false = .00–.95 in steps of 5 (Nifty Number) */
  allDecimals = false,
}) => {
  // Use the actual tokenValue from settings, fallback to global tokenValue
  const actualTokenValue = tokenValue || settings?.tokenValue || 300;
  const [selectedNumbers, setSelectedNumbers] = useState([]);
  const [betAmount, setBetAmount] = useState('');
  const [todayBets, setTodayBets] = useState([]);
  const [remaining, setRemaining] = useState(0);
  const [maxBetsPerDay, setMaxBetsPerDay] = useState(10);
  const [betHistory, setBetHistory] = useState([]);
  const [placing, setPlacing] = useState(false);
  const [loadingBet, setLoadingBet] = useState(true);
  const [message, setMessage] = useState(null);
  const [editingBetId, setEditingBetId] = useState(null);
  const [editAmount, setEditAmount] = useState('');
  const [modifying, setModifying] = useState(false);
  // 2-step betting process states
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedNumber, setSelectedNumber] = useState(null);
  const [numberOfBets, setNumberOfBets] = useState(1);
  /** BTC Number (.00–.99): digits typed after the fixed "." */
  const [centInput, setCentInput] = useState('');

  // Admin-configured: gross win uses ticket×multiplier when multiplier set (matches server declare).
  const ticketPxWin =
    settings?.ticketPrice != null && Number(settings.ticketPrice) > 0
      ? Number(settings.ticketPrice)
      : actualTokenValue;
  const winMultCfg = Number(settings?.winMultiplier);
  const grossWinPerTicketDisplay =
    Number.isFinite(winMultCfg) && winMultCfg > 0
      ? parseFloat((ticketPxWin * winMultCfg).toFixed(2))
      : settings?.fixedProfit != null && Number(settings.fixedProfit) > 0
        ? Number(settings.fixedProfit)
        : 4000;
  const minTickets = settings?.minTickets || 1;
  const maxTickets = settings?.maxTickets || 100;
  const minBet = minTickets * actualTokenValue;
  const maxBet = maxTickets * actualTokenValue;
  const gameEnabled = settings?.enabled !== false && settings?.enabled !== undefined && settings?.enabled !== null;
  const resultTimeDisplay = settings?.resultTime || resultTimeFallback;

  const [dailyResult, setDailyResult] = useState(null);
  const [sessionClearing, setSessionClearing] = useState(null);
  const [displayPrice, setDisplayPrice] = useState(null);
  const [priceChange, setPriceChange] = useState(null);

  const formatNiftyBetPlacedIST = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  };

  // Numbers already bet on today (to disable in grid)
  const todayNumbers = todayBets.map(b => b.selectedNumber);

  // Ticket conversion helpers using correct token value
  const toTokens = (rs) => parseFloat((rs / actualTokenValue).toFixed(2));
  const toRupees = (tokens) => parseFloat((tokens * actualTokenValue).toFixed(2));
  const balanceTokens = toTokens(balance);

  useEffect(() => {
    fetchTodayBets();
    fetchHistory();
    (async () => {
      try {
        const { data } = await axios.get(`${apiBase}/daily-result`, {
          headers: { Authorization: `Bearer ${user.token}` },
        });
        setDailyResult(data);
      } catch (e) {
        console.error('Error fetching daily result:', e);
      }
    })();
  }, [user.token, apiBase]);

  useEffect(() => {
    const tick = async () => {
      try {
        const { data: dr } = await axios.get(`${apiBase}/daily-result`, {
          headers: { Authorization: `Bearer ${user.token}` },
        });
        setDailyResult(dr);
      } catch {
        /* ignore */
      }
      try {
        const { data } = await axios.get(`${apiBase}/today`, {
          headers: { Authorization: `Bearer ${user.token}` },
        });
        setTodayBets(data.bets || []);
        setRemaining(data.remaining ?? 0);
        setMaxBetsPerDay(data.maxBetsPerDay ?? 10);
      } catch {
        /* ignore */
      }
    };
    const id = setInterval(tick, 45000);
    return () => clearInterval(id);
  }, [user.token, apiBase]);

  const fetchTodayBets = async () => {
    try {
      const { data } = await axios.get(`${apiBase}/today`, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setTodayBets(data.bets || []);
      setRemaining(data.remaining ?? 0);
      setMaxBetsPerDay(data.maxBetsPerDay ?? 10);
      try {
        const { data: dr } = await axios.get(`${apiBase}/daily-result`, {
          headers: { Authorization: `Bearer ${user.token}` },
        });
        setDailyResult(dr);
      } catch {
        /* ignore */
      }
    } catch (error) {
      console.error('Error fetching today bets:', error);
    } finally {
      setLoadingBet(false);
    }
  };

  const fetchHistory = async () => {
    try {
      const { data } = await axios.get(`${apiBase}/history`, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setBetHistory(data);
    } catch (error) {
      console.error('Error fetching history:', error);
    }
  };

  const toggleNumber = (num) => {
    if (todayNumbers.includes(num)) return;
    setSelectedNumbers(prev => {
      if (prev.includes(num)) return prev.filter(n => n !== num);
      if (prev.length >= remaining) {
        setMessage({ type: 'error', text: `You can only pick ${remaining} more number(s) today` });
        return prev;
      }
      return [...prev, num];
    });
  };

  const handlePlaceBet = async (betCount) => {
    const count = betCount || numberOfBets;
    console.log('Placing bet:', { selectedNumber, count, minBet, balance });
    if (selectedNumber == null || count <= 0) return;
    const amt = minBet; // Use minimum bet amount
    const totalCost = amt * count;
    if (totalCost > balance) { setMessage({ type: 'error', text: `Insufficient balance. Need ₹${totalCost.toLocaleString()} for ${count} ticket(s)` }); return; }
    if (!gameEnabled) { setMessage({ type: 'error', text: 'Game is currently disabled' }); return; }

    setPlacing(true);
    setMessage(null);
    try {
      // Place single bet record with quantity
      await axios.post(`${apiBase}/bet`, {
        selectedNumbers: [selectedNumber],
        amount: amt,
        quantity: count
      }, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      
      setMessage({ type: 'success', text: `${count} ticket(s) placed for .${selectedNumber.toString().padStart(2, '0')}!` });
      resetSteps();
      refreshBalance();
      fetchTodayBets();
      fetchHistory();
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || 'Failed to place tickets' });
    } finally {
      setPlacing(false);
    }
  };

  const handleModifyBet = async (betId) => {
    const newAmt = parseFloat(editAmount);
    if (isNaN(newAmt) || newAmt <= 0) { setMessage({ type: 'error', text: 'Enter a valid amount' }); return; }
    if (newAmt < minBet) { setMessage({ type: 'error', text: `Minimum bet is ₹${minBet}` }); return; }
    if (newAmt > maxBet) { setMessage({ type: 'error', text: `Maximum bet is ₹${maxBet}` }); return; }

    setModifying(true);
    setMessage(null);
    try {
      await axios.put(`${apiBase}/bet/${betId}`, {
        newAmount: newAmt
      }, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setMessage({ type: 'success', text: `Bet updated to ₹${newAmt.toLocaleString()}` });
      setEditingBetId(null);
      setEditAmount('');
      refreshBalance();
      fetchTodayBets();
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || 'Failed to modify bet' });
    } finally {
      setModifying(false);
    }
  };

  const quickAmounts = [100, 200, 500, 1000, 2000, 5000];

  // Step navigation functions
  const handleNumberSelect = (number) => {
    setSelectedNumber(number);
    setCurrentStep(2);
  };

  const applyDecimalPick = () => {
    if (!allDecimals) return;
    if (centInput.length < 1) {
      setMessage({ type: 'error', text: 'Dot ke baad 00 se 99 tak type karein' });
      return;
    }
    const n =
      centInput.length === 1
        ? parseInt(centInput.padStart(2, '0'), 10)
        : parseInt(centInput, 10);
    if (!Number.isFinite(n) || n < 0 || n > 99) {
      setMessage({ type: 'error', text: '00 se 99 ke beech number daalen' });
      return;
    }
    if (todayNumbers.includes(n)) {
      setMessage({ type: 'error', text: 'Aaj is value par pehle se bet hai' });
      return;
    }
    setMessage(null);
    setCentInput('');
    handleNumberSelect(n);
  };

  const handleBetCountSelect = async (count) => {
    console.log('Bet count selected:', count, 'remaining:', remaining, 'placing:', placing);
    if (count > remaining || placing) return;
    
    setNumberOfBets(count);
    // Auto place bet when count is selected - pass count directly to avoid stale state
    await handlePlaceBet(count);
  };

  const handleBackToStep1 = () => {
    if (allDecimals && selectedNumber != null) {
      setCentInput(String(selectedNumber).padStart(2, '0'));
    } else {
      setCentInput('');
    }
    setCurrentStep(1);
    setSelectedNumber(null);
    setNumberOfBets(1);
  };

  const resetSteps = () => {
    setCurrentStep(1);
    setSelectedNumber(null);
    setNumberOfBets(1);
    setCentInput('');
  };

  return (
    <div className="h-screen bg-dark-900 text-white flex flex-col overflow-hidden">
      {/* Header Color Bar */}
      <div className={`bg-gradient-to-r ${game.color} h-1 flex-shrink-0`}></div>
      {/* Header */}
      <div className="bg-dark-800 border-b border-dark-600 flex-shrink-0">
        <div className="px-4 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={onBack} className="p-2 hover:bg-dark-700 rounded-lg transition">
                <ArrowLeft size={20} />
              </button>
              <div className="flex items-center gap-2">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${game.color} flex items-center justify-center`}>
                  <game.icon size={20} />
                </div>
                <div>
                  <h1 className="font-bold">{game.name}</h1>
                  <p className="text-xs text-gray-400">Win ₹{grossWinPerTicketDisplay.toLocaleString()} gross</p>
                </div>
              </div>
            </div>
            <div className="bg-dark-700 rounded-lg px-3 py-1.5 text-right">
              <div className="text-[10px] text-gray-400">Balance</div>
              <div className="font-bold text-purple-400">₹{balance.toLocaleString()}</div>
            </div>
          </div>
        </div>
      </div>

      {/* 3-Column Desktop Layout / Stacked Mobile - Full Height */}
      <div className="px-3 py-2 flex-1 min-h-0 overflow-y-auto overscroll-y-contain lg:overflow-hidden touch-pan-y">
        <div className="flex flex-col lg:flex-row gap-3 min-h-min lg:h-full lg:min-h-0">

          {/* LEFT COLUMN - Game Info + Today's Bet Status */}
          <div className="lg:w-[260px] flex-shrink-0 order-1 lg:order-1 overflow-y-auto">
            {/* Today's Bets Status */}
            {loadingBet ? (
              <div className="flex items-center justify-center py-6">
                <RefreshCw className="animate-spin text-purple-500" size={20} />
              </div>
            ) : todayBets.length > 0 ? (
              <div className="bg-dark-800 rounded-xl p-3 border border-purple-500/30 mb-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-purple-400 font-bold text-xs flex items-center gap-1.5">
                    <Target size={12} />
                    TODAY'S BETS ({todayBets.reduce((s, b) => s + (b.quantity || 1), 0)}/{maxBetsPerDay})
                  </span>
                  {remaining > 0 && <span className="text-[10px] text-gray-500">{remaining} left</span>}
                </div>
                <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
                  {todayBets.map((bet, idx) => (
                    <div key={bet._id || idx} className={`p-2 rounded-lg text-xs ${
                      bet.status === 'won' ? 'bg-green-900/20' :
                      bet.status === 'lost' ? 'bg-red-900/20' :
                      bet.status === 'expired' ? 'bg-gray-800/50 border border-gray-600/40' :
                      'bg-yellow-900/10'
                    }`}>
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-purple-400 font-bold text-sm">.{bet.selectedNumber.toString().padStart(2, '0')}</span>
                            <span className="text-gray-400">₹{bet.amount.toLocaleString()}</span>
                            {(bet.quantity || 1) > 1 && (
                              <span className="text-[10px] text-purple-300 bg-purple-500/20 px-1.5 py-0.5 rounded">×{bet.quantity}</span>
                            )}
                          </div>
                          <div className="text-[9px] text-gray-500 tabular-nums leading-tight">
                            <span className="text-gray-400">Date</span> {bet.betDate || '—'}
                            {bet.createdAt && formatNiftyBetPlacedIST(bet.createdAt) && (
                              <>
                                {' · '}
                                <span className="text-gray-400">Placed</span> {formatNiftyBetPlacedIST(bet.createdAt)} IST
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {bet.status === 'pending' && (
                            <>
                              <button
                                onClick={() => { setEditingBetId(editingBetId === bet._id ? null : bet._id); setEditAmount(bet.amount.toString()); }}
                                className="text-[10px] text-blue-400 hover:text-blue-300 px-1.5 py-0.5 rounded bg-blue-500/10 hover:bg-blue-500/20 transition"
                              >
                                {editingBetId === bet._id ? 'Cancel' : 'Edit'}
                              </button>
                            </>
                          )}
                          {bet.status === 'pending' && <span className="text-yellow-400 font-medium">Pending</span>}
                          {bet.status === 'expired' && <span className="text-gray-400 font-medium">Removed (refunded)</span>}
                          {bet.status === 'won' && <span className="text-green-400 font-bold">WIN +₹{bet.profit?.toLocaleString()}</span>}
                          {bet.status === 'lost' && <span className="text-red-400 font-bold">LOSS -₹{bet.amount.toLocaleString()}</span>}
                        </div>
                      </div>
                                      {bet.status !== 'pending' && bet.resultNumber != null && (
                        <div className="text-[10px] mt-1.5 text-gray-500">
                          Result .{String(bet.resultNumber).padStart(2, '0')} · aapka .{String(bet.selectedNumber).padStart(2, '0')}{' '}
                          {bet.status === 'won' ? (
                            <span className="text-green-400 font-bold">→ JEET</span>
                          ) : (
                            <span className="text-red-400 font-bold">→ HAAR</span>
                          )}
                        </div>
                      )}
                      {/* Inline Edit */}
                      {editingBetId === bet._id && bet.status === 'pending' && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <input
                            type="number"
                            value={editAmount}
                            onChange={e => setEditAmount(e.target.value)}
                            className="flex-1 bg-dark-700 border border-dark-500 rounded px-2 py-1 text-xs font-bold focus:border-blue-500 focus:outline-none"
                            min={minBet}
                            max={maxBet}
                          />
                          <button
                            onClick={() => handleModifyBet(bet._id)}
                            disabled={modifying}
                            className="px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-[10px] font-bold transition disabled:opacity-50"
                          >
                            {modifying ? '...' : 'Save'}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-purple-900/20 border border-purple-500/30 rounded-xl p-3 mb-3">
                <div className="flex items-center gap-2 mb-1">
                  <Target size={14} className="text-purple-400" />
                  <span className="text-purple-400 font-bold text-xs">NO BETS TODAY</span>
                </div>
                <p className="text-gray-400 text-xs">Pick numbers and place your bets →</p>
              </div>
            )}

            {/* Game Info Card */}
            <div className="bg-dark-800 rounded-xl p-4 border border-dark-600">
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${game.color} flex items-center justify-center`}>
                  <game.icon size={24} />
                </div>
                <div>
                  <h3 className="font-bold">{game.name}</h3>
                  <p className="text-xs text-gray-400">
                    {allDecimals ? 'Type .00 to .99 (2 digits after the dot)' : 'Pick .00 to .95 (multiples of 5)'}
                  </p>
                </div>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between py-1 border-b border-dark-600">
                  <span className="text-gray-400">Win Profit</span>
                  <span className="text-green-400 font-bold">₹{grossWinPerTicketDisplay.toLocaleString()}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-dark-600">
                  <span className="text-gray-400">Min Bet</span>
                  <span className="font-medium">{minTickets} Ticket{minTickets > 1 ? 's' : ''} (₹{minBet.toLocaleString()})</span>
                </div>
                <div className="flex justify-between py-1 border-b border-dark-600">
                  <span className="text-gray-400">Max Bet</span>
                  <span className="font-medium">{maxTickets} Tickets (₹{maxBet.toLocaleString()})</span>
                </div>
                <div className="flex justify-between py-1 border-b border-dark-600">
                  <span className="text-gray-400">Bets/Day</span>
                  <span className="text-yellow-400 font-bold">{maxBetsPerDay}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-dark-600">
                  <span className="text-gray-400">Result At</span>
                  <span className="font-medium">{resultTimeDisplay} IST</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-gray-400">Betting</span>
                  <span className="text-cyan-400 font-medium">
                    {settings?.biddingStartTime || (allDecimals ? '00:00' : '09:15')} - {settings?.biddingEndTime || (allDecimals ? '23:24' : '15:24')}
                  </span>
                </div>
              </div>
              <div className="mt-2 bg-dark-700/50 rounded-lg p-2 text-[10px] text-gray-500">
                Bet {minTickets} Ticket (₹{minBet}) → If you win: <span className="text-green-400 font-medium">+₹{grossWinPerTicketDisplay.toLocaleString()} gross</span>
              </div>
              <p className="text-[10px] text-gray-500 mt-2 text-center leading-snug">
                Jeet/haar upar wale &quot;Aaj ka result&quot; box aur har line par tab dikhega jab admin aaj ka result declare karein ({resultTimeDisplay} IST policy).
              </p>
            </div>

            {/* Bet History */}
            <div className="bg-dark-800 rounded-xl p-3 border border-dark-600 mt-3">
              <h3 className="font-bold text-xs mb-2 flex items-center gap-1.5">
                <Timer size={12} className="text-gray-400" />
                History
              </h3>
              {betHistory.length === 0 ? (
                <p className="text-gray-500 text-[10px] text-center py-2">No bets yet</p>
              ) : (
                <div className="space-y-1 max-h-[200px] overflow-y-auto">
                  {betHistory.map((bet, idx) => (
                    <div key={bet._id || idx} className={`flex items-center justify-between p-2 rounded-lg text-xs ${
                      bet.status === 'won' ? 'bg-green-900/20' :
                      bet.status === 'lost' ? 'bg-red-900/20' :
                      bet.status === 'expired' ? 'bg-gray-800/50' :
                      'bg-dark-700'
                    }`}>
                      <div>
                        <div className="text-[10px] text-gray-500">
                          <span className="text-gray-400">Date</span> {bet.betDate}
                          {bet.createdAt && formatNiftyBetPlacedIST(bet.createdAt) && (
                            <>
                              {' · '}
                              <span className="text-gray-400">Placed</span> {formatNiftyBetPlacedIST(bet.createdAt)} IST
                            </>
                          )}
                        </div>
                        <div className="font-bold">.{bet.selectedNumber.toString().padStart(2, '0')} <span className="text-gray-400 font-normal">₹{bet.amount.toLocaleString()}</span>{(bet.quantity || 1) > 1 && <span className="text-purple-300 text-[10px] ml-1">×{bet.quantity}</span>}</div>
                        {bet.status !== 'pending' && bet.resultNumber != null && (
                          <div className="text-[9px] text-gray-500 mt-0.5">
                            Result .{String(bet.resultNumber).padStart(2, '0')}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        {bet.status === 'pending' && <span className="text-yellow-400 font-medium">Pending</span>}
                        {bet.status === 'expired' && <span className="text-gray-400 font-medium">Removed</span>}
                        {bet.status === 'won' && <span className="text-green-400 font-bold">WIN +₹{bet.profit?.toLocaleString()}</span>}
                        {bet.status === 'lost' && <span className="text-red-400 font-bold">LOSS -₹{bet.amount.toLocaleString()}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <GamesWalletGameLedgerPanel
              gameId={ledgerGameIdFromUi(game.id)}
              userToken={user?.token}
              tokenValue={actualTokenValue}
              title={`Order history — ${game.name}`}
              limit={500}
              enableDateFilter
            />
          </div>

          {/* CENTER COLUMN - live price (Nifty or BTC) */}
          <div className="flex-1 min-w-0 order-2 max-lg:order-3 flex flex-col min-h-0 max-lg:flex-none max-lg:max-h-[min(42vh,400px)] lg:flex-1">
            <GameLivePricePanel
              gameId={livePriceGameId}
              fullHeight
              closedNiftyStickMode={livePriceGameId === 'updown' ? 'clearing' : undefined}
              onSessionClearingUpdate={setSessionClearing}
              onPriceDataUpdate={({ displayPrice, priceChange }) => {
                setDisplayPrice(displayPrice);
                setPriceChange(priceChange);
              }}
            />
          </div>

          {/* RIGHT COLUMN - Number Picker + Bet Controls */}
          <div
            className={`w-full max-w-full flex-shrink-0 order-3 max-lg:order-2 flex flex-col lg:h-full lg:min-h-0 lg:overflow-hidden max-lg:overflow-visible pb-[max(0.75rem,env(safe-area-inset-bottom))] ${allDecimals ? 'lg:w-[min(100%,24rem)]' : 'lg:w-[300px]'}`}
          >
            {/* Message */}
            {message && (
              <div className={`p-2 rounded-lg text-xs font-medium mb-2 ${message.type === 'success' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
                {message.text}
              </div>
            )}

            {remaining === 0 && todayBets.length > 0 ? (
              /* All bets used today - show summary */
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center p-6">
                  <div className="w-16 h-16 rounded-full mx-auto mb-3 flex items-center justify-center bg-purple-500/20">
                    <Check size={28} className="text-purple-400" />
                  </div>
                  <div className="text-lg font-bold text-purple-400 mb-1">All {maxBetsPerDay} bets placed!</div>
                  <div className="flex flex-wrap gap-1.5 justify-center mb-2">
                    {todayBets.map((b, i) => (
                      <span key={i} className={`px-2 py-1 rounded-lg text-xs font-bold ${
                        b.status === 'won' ? 'bg-green-500/20 text-green-400' :
                        b.status === 'lost' ? 'bg-red-500/20 text-red-400' :
                        'bg-purple-500/20 text-purple-400'
                      }`}>.{b.selectedNumber.toString().padStart(2, '0')}</span>
                    ))}
                  </div>
                  <div className="text-gray-400 text-sm mb-1">
                    Total: ₹{todayBets.reduce((s, b) => s + b.amount, 0).toLocaleString()}
                  </div>
                  <div className="text-yellow-400 text-xs font-medium">Result policy {resultTimeDisplay} IST — declare ke baad yahi screen par WIN/LOSS</div>
                  <div className="text-[10px] text-gray-500 mt-2">You can still edit pending bet amounts from the left panel</div>
                </div>
              </div>
            ) : (
              /* Betting UI - 2-Step Process */
              <div className="space-y-2 overflow-y-auto flex-1">
                {/* Step Indicator */}
                <div className="bg-dark-800 rounded-xl p-3 border border-dark-600">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {[1, 2].map(step => (
                        <div key={step} className="flex items-center">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                            step < currentStep ? 'bg-green-600 text-white' :
                            step === currentStep ? 'bg-purple-600 text-white' :
                            'bg-dark-700 text-gray-500'
                          }`}>
                            {step < currentStep ? '✓' : step}
                          </div>
                          {step < 2 && (
                            <div className={`w-8 h-0.5 mx-1 transition-all ${
                              step < currentStep ? 'bg-green-600' : 'bg-dark-700'
                            }`} />
                          )}
                        </div>
                      ))}
                    </div>
                    <span className="text-[10px] text-gray-500">Step {currentStep} of 2</span>
                  </div>
                  
                  {/* Step 1: Select Number */}
                  {currentStep === 1 && (
                    <div>
                      {allDecimals ? (
                        <div>
                          <div className="text-sm font-medium text-purple-400 mb-1">Step 1: Price ka decimal (00–99)</div>
                          <p className="text-[11px] text-gray-500 mb-3 leading-snug">
                            Neeche <span className="text-gray-300">.</span> ke baad 2 digit type karein — jaise 45 = <span className="text-purple-300">.45</span> (last 2 digits of price).
                          </p>
                          <div className="flex items-center justify-center gap-1 flex-wrap">
                            <span
                              className="text-3xl sm:text-4xl font-bold text-white select-none leading-none"
                              aria-hidden
                            >
                              .
                            </span>
                            <input
                              type="text"
                              name="btc-cent"
                              inputMode="numeric"
                              autoComplete="off"
                              maxLength={2}
                              value={centInput}
                              onChange={(e) => {
                                setCentInput(e.target.value.replace(/\D/g, '').slice(0, 2));
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') applyDecimalPick();
                              }}
                              placeholder="00"
                              className="w-[4.5rem] sm:w-[5.5rem] text-center text-2xl sm:text-3xl font-bold font-mono tabular-nums bg-dark-700 border-2 border-purple-500/40 rounded-xl py-2.5 text-white placeholder:text-gray-600 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                            />
                          </div>
                          <p className="text-[10px] text-center text-gray-500 mt-2">
                            1 digit bhi chalega (5 → .05)
                          </p>
                          <button
                            type="button"
                            onClick={applyDecimalPick}
                            className="w-full mt-3 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-sm font-bold transition"
                          >
                            Next — tickets
                          </button>
                        </div>
                      ) : (
                        <div>
                          <div className="text-sm font-medium text-purple-400 mb-2">Step 1: Select a Number</div>
                          <div className="grid gap-1 grid-cols-5">
                            {Array.from({ length: 20 }, (_, idx) => {
                              const i = idx * 5;
                              const isAlreadyBet = todayNumbers.includes(i);
                              return (
                                <button
                                  key={i}
                                  onClick={() => handleNumberSelect(i)}
                                  disabled={isAlreadyBet}
                                  className={`rounded font-bold transition-all py-2 text-xs ${
                                    isAlreadyBet
                                      ? 'bg-yellow-900/30 text-yellow-600 cursor-not-allowed ring-1 ring-yellow-500/30'
                                      : 'bg-dark-700 hover:bg-purple-600 hover:text-white text-gray-300'
                                  }`}
                                >
                                  .{i.toString().padStart(2, '0')}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Clearing and LTP Display */}
                  <div className="mt-3 space-y-2">
                    <div className="text-[10px] text-gray-500 uppercase tracking-wide">
                      {clearingLabel}
                    </div>
                    <div className="text-2xl sm:text-3xl text-center">
                      {displayPrice != null ? (
                        <span className="font-bold tracking-tight text-white">
                          {(() => {
                            const priceStr = displayPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                            const dotIndex = priceStr.lastIndexOf('.');
                            if (dotIndex === -1) {
                              return `₹${priceStr}`;
                            }
                            return (
                              <>
                                ₹{priceStr.slice(0, dotIndex)}
                                <span className="text-red-500 text-3xl sm:text-4xl font-bold ml-1">
                                  {priceStr.slice(dotIndex)}
                                </span>
                              </>
                            );
                          })()}
                        </span>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </div>
                  </div>

                  {/* Step 2: Select number of tickets */}
                  {currentStep === 2 && (
                    <div>
                      <div className="text-sm font-medium text-purple-400 mb-2">
                        Step 2: Select number of tickets for .{selectedNumber?.toString().padStart(2, '0')}
                      </div>
                                            <div className="grid grid-cols-3 gap-2">
                        {[1, 2, 3, 5, 10, 20].map(count => (
                          <button
                            key={count}
                            onClick={() => handleBetCountSelect(count)}
                            disabled={count > remaining || placing}
                            className={`py-2 rounded text-xs font-bold transition-all ${
                              count > remaining
                                ? 'bg-gray-700 text-gray-600 cursor-not-allowed'
                                : placing
                                ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                                : 'bg-dark-700 hover:bg-purple-600 hover:text-white text-gray-300'
                            }`}
                          >
                            {placing ? '...' : `${count} ticket${count > 1 ? 's' : ''}`}
                          </button>
                        ))}
                      </div>
                      <div className="mt-2 text-[10px] text-gray-500 text-center">
                        {remaining} tickets remaining today
                      </div>
                    </div>
                  )}

                  {/* Navigation Buttons */}
                  <div className="flex gap-2 mt-3">
                    {currentStep > 1 && (
                      <button
                        onClick={handleBackToStep1}
                        className="flex-1 py-2 bg-dark-700 hover:bg-dark-600 rounded text-xs font-medium transition-all"
                      >
                        ← Back
                      </button>
                    )}
                  </div>
                </div>

                              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};

/** Nifty Bracket `resultTime` from settings (HH:mm) → e.g. "3:30 PM IST" */
function formatBracketResultTimeIST(hhmm) {
  const raw = (hhmm && String(hhmm).trim()) || '15:30';
  const [hStr, mStr = '0'] = raw.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(String(mStr).slice(0, 2), 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '3:30 PM IST';
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period} IST`;
}

// ==================== NIFTY BRACKET SCREEN ====================
const NiftyBracketScreen = ({ game, balance, onBack, user, refreshBalance, settings, tokenValue = 300 }) => {
  const [betAmount, setBetAmount] = useState('');
  const [activeTrades, setActiveTrades] = useState([]);
  const [tradeHistory, setTradeHistory] = useState([]);
  const [placing, setPlacing] = useState(false);
  const [message, setMessage] = useState(null);
  const [currentPrice, setCurrentPrice] = useState(null);
  const [demoPriceActive, setDemoPriceActive] = useState(false);
  const [lockedDisplayPrice, setLockedDisplayPrice] = useState(null);
  const [timerTick, setTimerTick] = useState(0); // For live countdown
  const [sessionClearing, setSessionClearing] = useState(null);
  const [bidAsk, setBidAsk] = useState({ bid: null, ask: null });
  const [priceUpdateTick, setPriceUpdateTick] = useState(0);
  const [last5DaysLTP, setLast5DaysLTP] = useState([]);
  const [showLast5DaysLTP, setShowLast5DaysLTP] = useState(false);
  const resolveCheckRef = useRef(null);

  // LTP Tape state for Nifty Bracket
  const [ltpTapeRows, setLtpTapeRows] = useState([]);
  
  // Function to update LTP tape with real LTP
  const updateLtpTape = useCallback((realLTP) => {
    if (!realLTP || !Number.isFinite(realLTP)) return;
    
    const istYmd = getIstCalendarYmd();
    const istTime = new Date().toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: true,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const rounded = Math.round(Number(realLTP) * 100) / 100;
    
    setLtpTapeRows((prev) => {
      const row = { id, price: rounded, istTime, ts: Date.now() };
      const next = [row, ...prev].slice(0, 10000); // Same max as global LTP tape
      return next;
    });
  }, []);

  const fetchActiveTrades = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/user/nifty-bracket/active', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setActiveTrades(data);
    } catch (error) {
      console.error('Error fetching active trades:', error);
    }
  }, [user?.token]);

  const fetchHistory = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/user/nifty-bracket/history', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setTradeHistory(data);
    } catch (error) {
      console.error('Error fetching history:', error);
    }
  }, [user?.token]);

  const fetchLast5DaysLTP = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/user/nifty-bracket/last-5-days', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setLast5DaysLTP(data || []);
    } catch (error) {
      console.error('Error fetching last 5 days LTP:', error);
    }
  }, [user?.token]);

  // Debug: Monitor currentPrice changes
  // This should show the LIVE LTP from Zerodha, NOT the clearing price
  useEffect(() => {
    console.log('[NiftyBracket] ✓ currentPrice (should be LTP) changed to:', currentPrice);
  }, [currentPrice]);

  // Debug: Monitor sessionClearing changes  
  // This should show the last 15m bar close (clearing price)
  useEffect(() => {
    console.log('[NiftyBracket] ✓ sessionClearing (last 15m bar) changed to:', sessionClearing);
    if (currentPrice && sessionClearing && Math.abs(currentPrice - sessionClearing) < 0.01) {
      console.warn('[NiftyBracket] ⚠️ WARNING: currentPrice and sessionClearing are the same! This is the bug!');
    }
  }, [sessionClearing, currentPrice]);

  // Fetch active trades and history on mount / token change
  useEffect(() => {
    console.log('[DEBUG] GameScreen useEffect triggered for game:', game.id);
    fetchActiveTrades();
    fetchHistory();
    fetchLast5DaysLTP();
  }, [game.id, user?.token, fetchActiveTrades, fetchHistory]);

  // Instructions Modal */interval to check currentPrice periodically
  useEffect(() => {
    const interval = setInterval(() => {
      console.log('Periodic check - NiftyBracket currentPrice:', currentPrice);
    }, 3000);
    return () => clearInterval(interval);
  }, [currentPrice]);

  // Reset locked price when no active trades
  useEffect(() => {
    if (activeTrades.length === 0 && lockedDisplayPrice) {
      setLockedDisplayPrice(null);
    }
  }, [activeTrades.length, lockedDisplayPrice]);

  const bracketGap = settings?.bracketGap || 20;
  const bracketGapType = settings?.bracketGapType || 'point';
  const bracketGapPercent = settings?.bracketGapPercent || 0.1;
  const expiryMinutes = settings?.expiryMinutes || 5;
  const winMultiplier = settings?.winMultiplier || 2;
  const gameEnabled = settings?.enabled !== false && settings?.enabled !== undefined && settings?.enabled !== null;

  // Calculate gap value based on type
  const gapValue = bracketGapType === 'percentage' && currentPrice 
    ? currentPrice * (bracketGapPercent / 100) 
    : bracketGap;

  // Calculate BUY/SELL prices with spread
  const buyPrice = currentPrice ? currentPrice + gapValue : null; // BUY price = current + gap
  const sellPrice = currentPrice ? currentPrice - gapValue : null; // SELL price = current - gap

  // Ticket conversion helpers
  const toTokens = (rs) => parseFloat((rs / tokenValue).toFixed(2));
  const toRupees = (tokens) => parseFloat((tokens * tokenValue).toFixed(2));
  const balanceTokens = toTokens(balance);
  const minBetTokens = settings?.minTickets || 1;
  const maxBetTokens = settings?.maxTickets || 250;
  const resultTimeDisplay = formatBracketResultTimeIST(settings?.resultTime);
  const settleAtResultTime = settings?.settleAtResultTime !== false;

  const upperTarget = currentPrice ? parseFloat((currentPrice + gapValue).toFixed(2)) : null;
  const lowerTarget = currentPrice ? parseFloat((currentPrice - gapValue).toFixed(2)) : null;

  const resolvingRef = useRef(false);
  const activeTradesRef = useRef([]);
  const currentPriceRef = useRef(null);

  useEffect(() => {
    activeTradesRef.current = activeTrades;
  }, [activeTrades]);
  useEffect(() => {
    currentPriceRef.current = currentPrice;
  }, [currentPrice]);

  // Every second: after result time / expiry, settle with latest LTP (session-close or intraday timer)
  useEffect(() => {
    if (activeTrades.length === 0) return;

    const interval = setInterval(async () => {
      setTimerTick((t) => t + 1);
      const trades = activeTradesRef.current;
      const price = currentPriceRef.current;
      const now = new Date();
      if (!price || resolvingRef.current) return;

      const due = trades.filter(
        (t) => t.status === 'active' && new Date(t.expiresAt).getTime() <= now.getTime()
      );
      if (due.length === 0) return;

      resolvingRef.current = true;
      try {
        for (const trade of due) {
          try {
            const { data } = await axios.post(
              '/api/user/nifty-bracket/resolve',
              { tradeId: trade._id, currentPrice: price },
              { headers: { Authorization: `Bearer ${user.token}` } }
            );
            setMessage({
              type: data.trade.status === 'won' ? 'success' : 'error',
              text: data.message,
            });
          } catch {
            /* already resolved or not yet allowed */
          }
        }
      } finally {
        resolvingRef.current = false;
        fetchActiveTrades();
        fetchHistory();
        refreshBalance();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [activeTrades.length, fetchActiveTrades, fetchHistory, refreshBalance, user?.token]);

  // Intraday mode only: settle when live price touches band before result time
  useEffect(() => {
    if (settleAtResultTime) return;
    if (!currentPrice || activeTrades.length === 0 || resolvingRef.current) return;

    const checkAndResolve = async () => {
      resolvingRef.current = true;
      for (const trade of activeTrades) {
        if (trade.status !== 'active') continue;
        try {
          const { data } = await axios.post(
            '/api/user/nifty-bracket/resolve',
            { tradeId: trade._id, currentPrice },
            { headers: { Authorization: `Bearer ${user.token}` } }
          );
          setMessage({
            type: data.trade.status === 'won' ? 'success' : 'error',
            text: data.message,
          });
          fetchActiveTrades();
          fetchHistory();
          refreshBalance();
        } catch {
          /* not ready */
        }
      }
      resolvingRef.current = false;
    };

    checkAndResolve();
  }, [
    currentPrice,
    settleAtResultTime,
    activeTrades,
    user?.token,
    fetchActiveTrades,
    fetchHistory,
    refreshBalance,
  ]);

  const handlePlaceTrade = async (prediction) => {
    if (!betAmount || !currentPrice) return;
    const tokenAmt = parseFloat(betAmount);
    const amt = toRupees(tokenAmt);
    if (tokenAmt < minBetTokens) { setMessage({ type: 'error', text: `Minimum bet is ${minBetTokens} tickets` }); return; }
    if (tokenAmt > maxBetTokens) { setMessage({ type: 'error', text: `Maximum bet is ${maxBetTokens} tickets` }); return; }
    if (amt > balance) { setMessage({ type: 'error', text: 'Insufficient balance' }); return; }
    if (!gameEnabled) { setMessage({ type: 'error', text: 'Game is currently disabled' }); return; }

    setPlacing(true);
    setMessage(null);
    try {
      const { data } = await axios.post('/api/user/nifty-bracket/trade', {
        prediction,
        amount: amt,
        entryPrice: currentPrice
      }, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      const lockedPrice = prediction === 'BUY' ? upperTarget : lowerTarget;
      setMessage({ type: 'success', text: `${prediction} trade placed! Target: ₹${lockedPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` });
      setLockedDisplayPrice(lockedPrice); // Lock the target price
      fetchActiveTrades();
      refreshBalance();
    } catch (error) {
      console.error('Bracket trade error:', error.response?.data || error.message);
      setMessage({ type: 'error', text: error.response?.data?.message || error.message || 'Failed to place trade' });
    } finally {
      setPlacing(false);
    }
  };

  const quickAmounts = [1, 2, 3, 5, 10, 20];

  const formatTimeLeft = (expiresAt) => {
    const diff = new Date(expiresAt) - new Date();
    if (diff <= 0) return 'Expired';
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-screen bg-dark-900 text-white flex flex-col overflow-hidden">
      {/* Header Color Bar */}
      <div className={`bg-gradient-to-r ${game.color} h-1 flex-shrink-0`}></div>
      {/* Header */}
      <div className="bg-dark-800 border-b border-dark-600 flex-shrink-0">
        <div className="px-4 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={onBack} className="p-2 hover:bg-dark-700 rounded-lg transition">
                <ArrowLeft size={20} />
              </button>
              <div className="flex items-center gap-2">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${game.color} flex items-center justify-center`}>
                  <game.icon size={20} />
                </div>
                <div>
                  <h1 className="font-bold">{game.name}</h1>
                  <p className="text-xs text-gray-400">{winMultiplier}x Returns • {bracketGapType === 'percentage' ? `±${bracketGapPercent}%` : `±${bracketGap} pts`}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {currentPrice && (
                <div className="bg-dark-700 rounded-lg px-3 py-1.5 text-right">
                  <div className="text-[10px] text-gray-400 flex items-center justify-end gap-1">
                    Nifty
                    {demoPriceActive && (
                      <span className="text-[9px] text-amber-400 font-semibold">DEMO</span>
                    )}
                  </div>
                  <div className="font-bold text-cyan-400">{currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                </div>
              )}
              <div className="bg-dark-700 rounded-lg px-3 py-1.5 text-right">
                <div className="text-[10px] text-gray-400">Balance</div>
                <div className="font-bold text-purple-400">{balanceTokens} Tkt</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3-Column Desktop Layout */}
      <div className="px-3 py-2 flex-1 min-h-0 overflow-y-auto overscroll-y-contain lg:overflow-hidden touch-pan-y">
        <div className="flex flex-col lg:flex-row gap-3 min-h-min lg:h-full lg:min-h-0">

          {/* LEFT COLUMN - Game Info + Active Trades */}
          <div className="lg:w-[260px] flex-shrink-0 order-1 lg:order-1 overflow-y-auto">

            {/* Watch Previous LTPs Button */}
            {last5DaysLTP.length > 0 && !showLast5DaysLTP && (
              <button
                onClick={() => setShowLast5DaysLTP(true)}
                className="w-full bg-dark-800 rounded-xl p-3 border border-dark-600 hover:border-cyan-500/50 transition-colors mb-3"
              >
                <div className="flex items-center justify-center gap-2">
                  <TrendingUp size={14} className="text-cyan-400" />
                  <span className="text-xs font-medium text-cyan-400">Watch Previous LTPs</span>
                </div>
              </button>
            )}

            {/* Last 5 Days Closing LTP Card (shown when button clicked) */}
            {showLast5DaysLTP && last5DaysLTP.length > 0 && (
              <div className="bg-dark-800 rounded-xl p-3 border border-dark-600 mb-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-xs flex items-center gap-1.5">
                    <TrendingUp size={12} className="text-cyan-400" />
                    Last 5 Days Closing LTP
                  </h3>
                  <button
                    onClick={() => setShowLast5DaysLTP(false)}
                    className="text-gray-400 hover:text-white transition"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="space-y-1.5">
                  {last5DaysLTP.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center py-1.5 border-b border-dark-600 last:border-0">
                      <span className="text-xs text-gray-400">{item.date}</span>
                      <span className="text-sm font-bold text-cyan-400">
                        ₹{Number(item.closingLTP).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Bracket Info */}
            {currentPrice && (
              <div className="bg-dark-800 rounded-xl p-3 border border-cyan-500/30 mb-3">
                <div className="text-xs text-gray-400 mb-2 font-medium">Current Bracket Levels</div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between bg-green-900/20 rounded-lg p-2 border border-green-500/20">
                    <div className="flex items-center gap-1.5">
                      <ArrowUpCircle size={14} className="text-green-400" />
                      <span className="text-xs text-green-400 font-bold">BUY Target</span>
                    </div>
                    <span className="font-bold text-green-400">{upperTarget?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="text-center text-xs text-gray-500">
                    Entry: <span className="text-white font-bold">{currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex items-center justify-between bg-red-900/20 rounded-lg p-2 border border-red-500/20">
                    <div className="flex items-center gap-1.5">
                      <ArrowDownCircle size={14} className="text-red-400" />
                      <span className="text-xs text-red-400 font-bold">SELL Target</span>
                    </div>
                    <span className="font-bold text-red-400">{lowerTarget?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
                <div className="mt-2 text-[10px] text-gray-500 text-center">Gap: {bracketGapType === 'percentage' ? `±${bracketGapPercent}%` : `±${bracketGap} pts`}</div>
              </div>
            )}

            {/* Game Info Card */}
            <div className="bg-dark-800 rounded-xl p-4 border border-dark-600">
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${game.color} flex items-center justify-center`}>
                  <game.icon size={24} />
                </div>
                <div>
                  <h3 className="font-bold">{game.name}</h3>
                  <p className="text-xs text-gray-400">{game.description}</p>
                </div>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between py-1 border-b border-dark-600">
                  <span className="text-gray-400">Win Multiplier</span>
                  <span className="text-green-400 font-bold">{winMultiplier}x</span>
                </div>
                <div className="flex justify-between py-1 border-b border-dark-600">
                  <span className="text-gray-400">Fee on win profit</span>
                  <span className="text-green-400 font-medium">None</span>
                </div>
                <div className="flex justify-between py-1 border-b border-dark-600">
                  <span className="text-gray-400">Bracket Gap</span>
                  <span className="text-cyan-400 font-bold">{bracketGapType === 'percentage' ? `±${bracketGapPercent}%` : `±${bracketGap} pts`}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-dark-600">
                  <span className="text-gray-400">Min Bet</span>
                  <span className="font-medium">{minBetTokens} Tickets</span>
                </div>
                <div className="flex justify-between py-1 border-b border-dark-600">
                  <span className="text-gray-400">Max Bet</span>
                  <span className="font-medium">{maxBetTokens} Tickets</span>
                </div>
                <div className="flex justify-between py-1 border-b border-dark-600">
                  <span className="text-gray-400">1 Ticket</span>
                  <span className="font-medium">₹{tokenValue}</span>
                </div>
                {settleAtResultTime && (
                  <div className="flex justify-between py-1">
                    <span className="text-gray-400">Settlement</span>
                    <span className="text-cyan-300 text-xs font-medium text-right">At {resultTimeDisplay}</span>
                  </div>
                )}
              </div>
              <div className="mt-2 bg-dark-700/50 rounded-lg p-2 text-[10px] text-gray-500">
                Win 1T bet → <span className="text-green-400 font-medium">{(winMultiplier - 1).toFixed(2)} T profit</span> (full payout, no fee on profit)
              </div>
            </div>

            {/* Active Trades - Live Updates */}
            {activeTrades.length > 0 && (
              <div className="mt-3 bg-dark-800 rounded-xl p-3 border border-yellow-500/30">
                <h3 className="font-bold text-xs text-yellow-400 mb-2 flex items-center gap-1.5">
                  <RefreshCw size={12} className="animate-spin" />
                  Active Trades ({activeTrades.length})
                  <span className="text-[9px] text-gray-500 ml-auto">{settleAtResultTime ? 'Result time' : 'Live'}</span>
                </h3>
                <div className="space-y-2">
                  {activeTrades.map(trade => {
                    const timeLeft = new Date(trade.expiresAt) - new Date();
                    const isExpiringSoon = timeLeft > 0 && timeLeft < 60000; // Less than 1 min
                    const isExpired = timeLeft <= 0;
                    const sessionCloseUi = trade.settlesAtSessionClose === true || settleAtResultTime;
                    const statusLabel = sessionCloseUi
                      ? (isExpired ? 'Settling…' : formatTimeLeft(trade.expiresAt))
                      : (isExpired ? 'Expired' : isExpiringSoon ? 'Expiring Soon' : 'Active');

                    return (
                      <div key={trade._id} className={`bg-dark-700 rounded-lg p-2.5 text-xs border ${
                        isExpired ? 'border-gray-500/30' : isExpiringSoon && !sessionCloseUi ? 'border-red-500/50 animate-pulse' : 'border-dark-600'
                      }`}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className={`font-bold px-2 py-0.5 rounded text-[10px] ${
                            trade.prediction === 'BUY' ? 'bg-green-500/30 text-green-400' : 'bg-red-500/30 text-red-400'
                          }`}>{trade.prediction}</span>
                          <span className="text-gray-300 font-medium">{toTokens(trade.amount)} T</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-gray-500">{trade.lowerTarget?.toLocaleString('en-IN')} ↔ {trade.upperTarget?.toLocaleString('en-IN')}</span>
                          <span className={`font-bold px-1.5 py-0.5 rounded ${
                            isExpired ? 'bg-gray-500/20 text-gray-400' :
                            isExpiringSoon && !sessionCloseUi ? 'bg-red-500/30 text-red-400' :
                            'bg-yellow-500/20 text-yellow-400'
                          }`}>
                            {statusLabel}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Trade History */}
            <div className="bg-dark-800 rounded-xl p-3 border border-dark-600 mt-3">
              <h3 className="font-bold text-xs mb-2 flex items-center gap-1.5">
                <Timer size={12} className="text-gray-400" />
                History
                {activeTrades.length > 0 && (
                  <span className="text-yellow-400 text-[9px] ml-auto">({activeTrades.length} active)</span>
                )}
              </h3>
              <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-cyan-950/40 border border-cyan-500/30 px-2.5 py-1.5">
                <span className="text-[10px] text-gray-400 shrink-0">Result at</span>
                <span className="text-[10px] font-semibold text-cyan-200 text-right tabular-nums">{resultTimeDisplay}</span>
              </div>
              {settleAtResultTime && (
                <p className="text-[9px] text-gray-500 mb-2 leading-snug">
                  Win/loss uses Nifty LTP at result time — the live chart touching your band earlier does not settle the trade.
                </p>
              )}
              {/* Show active trades in history section too */}
              {activeTrades.length > 0 && (
                <div className="mb-2 pb-2 border-b border-dark-600">
                  <div className="text-[9px] text-yellow-400 mb-1 font-medium">Running Trades:</div>
                  {activeTrades.map(t => {
                    const timeLeft = new Date(t.expiresAt) - new Date();
                    const isEx = timeLeft <= 0;
                    const sc = t.settlesAtSessionClose === true || settleAtResultTime;
                    const runLabel = sc ? (isEx ? 'Settling…' : formatTimeLeft(t.expiresAt)) : 'Active';
                    return (
                      <div key={t._id} className="flex items-center justify-between p-2 rounded-lg text-xs bg-yellow-900/20 mb-1">
                        <div>
                          <span className={`font-bold text-[10px] ${t.prediction === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{t.prediction}</span>
                          <span className="text-gray-400 ml-1">{toTokens(t.amount)} T</span>
                        </div>
                        <span className="text-yellow-400 text-[10px] font-medium">{runLabel}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {tradeHistory.length === 0 && activeTrades.length === 0 ? (
                <p className="text-gray-500 text-[10px] text-center py-2">No trades yet</p>
              ) : (
                <div className="space-y-1 max-h-[200px] overflow-y-auto">
                  {tradeHistory.map((t, idx) => (
                    <div key={t._id || idx} className={`flex items-center justify-between p-2 rounded-lg text-xs ${
                      t.status === 'won' ? 'bg-green-900/20' :
                      t.status === 'lost' ? 'bg-red-900/20' :
                      t.status === 'expired' ? 'bg-gray-800' :
                      'bg-dark-700'
                    }`}>
                      <div>
                        <span className={`font-bold text-[10px] ${t.prediction === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{t.prediction}</span>
                        <span className="text-gray-400 ml-1">{toTokens(t.amount)} T</span>
                      </div>
                      <div className="text-right">
                        {t.status === 'won' && <span className="text-green-400 font-bold">+{toTokens(t.profit)} T</span>}
                        {t.status === 'lost' && <span className="text-red-400 font-bold">-{toTokens(t.amount)} T</span>}
                        {t.status === 'expired' && (
                          <span className="text-gray-400 font-medium" title="Legacy: was refunded before no-refund rule">Refunded</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <GamesWalletGameLedgerPanel
              gameId={ledgerGameIdFromUi(game.id)}
              userToken={user?.token}
              tokenValue={tokenValue}
              title="Order history — Nifty Bracket"
              limit={500}
              enableDateFilter
            />
          </div>

          {/* CENTER COLUMN - Nifty live price */}
          <div className="flex-1 min-w-0 order-2 max-lg:order-3 flex flex-col min-h-0 max-lg:flex-none max-lg:max-h-[min(42vh,400px)] lg:flex-1">
            <GameLivePricePanel
              gameId="updown"
              fullHeight
              niftyLtpTape={false}
              closedNiftyStickMode="ltp"
              onPriceUpdate={(p) => {
                if (p != null && Number.isFinite(Number(p)) && Number(p) > 0) {
                  const v = Number(p);
                  setCurrentPrice(v);
                  updateLtpTape(v);
                }
              }}
              onFallbackPrice={(p) => {
                if (p != null && Number.isFinite(p) && p > 0) {
                  console.log('[NiftyBracket] onFallbackPrice received:', p);
                  setCurrentPrice(p);
                }
              }}
              onDemoPriceActive={setDemoPriceActive}
              onSessionClearingUpdate={(clearing) => {
                if (clearing != null && Number.isFinite(Number(clearing))) {
                  setSessionClearing(Number(clearing));
                  setPriceUpdateTick(t => t + 1);
                } else {
                  setSessionClearing(null);
                }
              }}
              onBidAskUpdate={(bidAskData) => {
                setBidAsk(bidAskData);
              }}
            />
            
            {/* Custom LTP Tape for Nifty Bracket - shows real LTP instead of clearing */}
            {ltpTapeRows.length > 0 && (
              <div className="mt-2 shrink-0 rounded-lg border border-cyan-600/25 bg-dark-900/60 overflow-hidden flex flex-col max-h-[min(280px,38vh)]">
                <div className="px-2 py-1 text-[10px] font-semibold text-cyan-300/90 border-b border-dark-600 bg-dark-800/90 flex flex-col gap-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span>LTP trail (IST) - REAL LTP</span>
                    <span className="text-gray-500 font-normal">newest ↑ · scroll for older</span>
                  </div>
                  <p className="text-[9px] text-gray-500 font-normal leading-snug">
                    Shows actual LTP (24,156.05) not clearing price (24,173.05)
                  </p>
                </div>
                <div className="overflow-y-auto min-h-0 overscroll-y-contain divide-y divide-dark-700/80 text-[11px]">
                  {ltpTapeRows.map((row) => (
                    <div
                      key={row.id}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 tabular-nums"
                    >
                      <span className="text-cyan-300 font-mono">₹{row.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      <span className="text-gray-500 text-[10px]">{row.istTime}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN - Betting Controls */}
          <div className="w-full max-w-full lg:w-[300px] flex-shrink-0 order-3 max-lg:order-2 flex flex-col lg:h-full lg:min-h-0 lg:overflow-hidden max-lg:overflow-visible pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {/* Message */}
            {message && (
              <div className={`p-2 rounded-lg text-xs font-medium mb-2 ${
                message.type === 'success' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                message.type === 'info' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                'bg-red-500/20 text-red-400 border border-red-500/30'
              }`}>
                {message.text}
              </div>
            )}

            <div className="space-y-3 flex-shrink-0">
              {/* Bet Amount */}
              <div className="bg-dark-800 rounded-xl p-4 border border-dark-600">
                <label className="block text-sm text-gray-400 mb-2">Enter Tickets</label>
                <input
                  type="number"
                  value={betAmount}
                  onChange={e => setBetAmount(e.target.value)}
                  min={minBetTokens}
                  max={maxBetTokens}
                  step="0.01"
                  className="w-full bg-dark-700 border border-dark-600 rounded-lg px-3 py-2.5 text-xl font-bold text-center focus:border-cyan-500 focus:outline-none"
                />
                <div className="text-[10px] text-gray-500 mt-1 text-center">Min {minBetTokens} • Max {maxBetTokens} Tickets (1Tkt = ₹{tokenValue})</div>
                <div className="grid grid-cols-3 gap-1.5 mt-2">
                  {quickAmounts.map(amt => (
                    <button
                      key={amt}
                      onClick={() => setBetAmount(amt.toString())}
                      className="py-1.5 bg-dark-700 hover:bg-dark-600 rounded-lg text-xs font-medium transition"
                    >
                      {amt} T
                    </button>
                  ))}
                </div>
              </div>

              {/* Bracket Display + BUY/SELL */}
              <div className="bg-dark-800 rounded-xl p-4 border border-dark-600">
                {/* Large Real-time LTP Display */}
                {!currentPrice || currentPrice <= 0 ? (
                  <div className="text-center py-4 mb-3">
                    <RefreshCw className="animate-spin text-cyan-400 mx-auto mb-2" size={20} />
                    <p className="text-xs text-gray-500">Waiting for price (live or demo)…</p>
                  </div>
                ) : (
                  <div key={`ltp-${priceUpdateTick}`} className="text-center mb-3 pb-3 border-b border-dark-600">
                    <div className="text-xs text-cyan-400 mb-1">NIFTY 50 LTP</div>
                    <div className="text-3xl font-bold text-cyan-300" key={currentPrice}>
                      ₹{currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-1">Bracket: {bracketGapType === 'percentage' ? `±${bracketGapPercent}%` : `±${bracketGap} points`}</div>
                  </div>
                )}
                
                <label className="block text-sm text-gray-400 mb-3 text-center">Pick Your Side</label>
                {currentPrice && currentPrice > 0 && (
                  <>

                    {/* BUY Button - Green - Price Goes UP */}
                    <button
                      onClick={() => handlePlaceTrade('BUY')}
                      disabled={!betAmount || parseFloat(betAmount) <= 0 || placing || !currentPrice}
                      className={`w-full p-4 rounded-xl border-2 transition-all mb-3 ${
                        betAmount && parseFloat(betAmount) > 0 && currentPrice
                          ? 'border-green-500 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 shadow-lg shadow-green-500/20'
                          : 'border-dark-600 bg-dark-700 opacity-50 cursor-not-allowed'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                            <ArrowUpCircle size={24} className="text-white" />
                          </div>
                          <div className="text-left">
                            <div className="font-bold text-white text-lg">BUY (UP)</div>
                            <div className="text-xs text-white/80">Win if price hits ↑</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-white font-bold text-xl">₹{upperTarget?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                          <div className="text-xs text-white/80">{bracketGapType === 'percentage' ? `+${bracketGapPercent}%` : `+${bracketGap} pts`} • Bid: ₹{bidAsk.bid?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '—'}</div>
                        </div>
                      </div>
                    </button>

                    {/* SELL Button - Red - Price Goes DOWN */}
                    <button
                      onClick={() => handlePlaceTrade('SELL')}
                      disabled={!betAmount || parseFloat(betAmount) <= 0 || placing || !currentPrice}
                      className={`w-full p-4 rounded-xl border-2 transition-all ${
                        betAmount && parseFloat(betAmount) > 0 && currentPrice
                          ? 'border-red-500 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 shadow-lg shadow-red-500/20'
                          : 'border-dark-600 bg-dark-700 opacity-50 cursor-not-allowed'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                            <ArrowDownCircle size={24} className="text-white" />
                          </div>
                          <div className="text-left">
                            <div className="font-bold text-white text-lg">SELL (DOWN)</div>
                            <div className="text-xs text-white/80">Win if price hits ↓</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-white font-bold text-xl">₹{lowerTarget?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                          <div className="text-xs text-white/80">{bracketGapType === 'percentage' ? `-${bracketGapPercent}%` : `-${bracketGap} pts`} • Ask: ₹{bidAsk.ask?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '—'}</div>
                        </div>
                      </div>
                    </button>

                    {/* Win Info */}
                    <div className="mt-3 p-2 bg-yellow-900/20 border border-yellow-500/30 rounded-lg text-center">
                      <span className="text-yellow-400 text-xs font-medium">Win {winMultiplier}x = ₹{betAmount ? (parseFloat(betAmount) * tokenValue * winMultiplier).toLocaleString() : '0'}</span>
                      <span className="text-gray-500 text-[10px] ml-1">(no fee on profit)</span>
                    </div>
                  </>
                )}
              </div>

                          </div>
          </div>

        </div>
      </div>
    </div>
  );
};

/** Default ladder — must match server `nifty-jackpot/leaderboard` / declare-result */
const DEFAULT_NIFTY_JACKPOT_PRIZE_PERCENTAGES = [
  { rank: '1st', percent: 45 },
  { rank: '2nd', percent: 10 },
  { rank: '3rd', percent: 3 },
  { rank: '4th', percent: 2 },
  { rank: '5th', percent: 1.5 },
  { rank: '6th', percent: 1 },
  { rank: '7th', percent: 1 },
  { rank: '8th-10th', percent: 0.75, count: 3 },
  { rank: '11th-20th', percent: 0.5, count: 10 },
];

/** Ladder shape — must match `server/utils/niftyJackpotPrize.js` */
function ladderPercentFromLadder(rank, prizePercentages) {
  const p = prizePercentages;
  if (rank === 1) return p[0]?.percent ?? 45;
  if (rank === 2) return p[1]?.percent ?? 10;
  if (rank === 3) return p[2]?.percent ?? 3;
  if (rank === 4) return p[3]?.percent ?? 2;
  if (rank === 5) return p[4]?.percent ?? 1.5;
  if (rank === 6) return p[5]?.percent ?? 1;
  if (rank === 7) return p[6]?.percent ?? 1;
  if (rank >= 8 && rank <= 10) return p[7]?.percent ?? 0.75;
  if (rank >= 11 && rank <= 20) return p[8]?.percent ?? 0.5;
  return 0;
}

/** Matches server `resolveJackpotPrizePercentForRank` (prizePercentages ladder, else 0–100 prizeDistribution per rank) */
function resolveJackpotPrizePercentForRankClient(rank, gameSettings) {
  const gc = gameSettings || {};
  const ladder = gc.prizePercentages;
  if (Array.isArray(ladder) && ladder.length > 0) {
    return ladderPercentFromLadder(rank, ladder);
  }
  const pd = gc.prizeDistribution;
  if (
    Array.isArray(pd) &&
    pd.length > 0 &&
    pd.every((x) => typeof x === 'number' && x >= 0 && x <= 100)
  ) {
    if (rank >= 1 && rank <= pd.length) return pd[rank - 1];
    return 0;
  }
  return ladderPercentFromLadder(rank, DEFAULT_NIFTY_JACKPOT_PRIZE_PERCENTAGES);
}

function formatJackpotPoolPercent(percent) {
  const n = Number(percent);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const s = Number.isInteger(n) ? String(n) : n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return `${s}%`;
}

/**
 * Gross ₹ for leaderboard row at `index` (same as Super Admin / `declareNiftyJackpotResult`):
 * rank = index + 1 → full ladder % for that rank × pool.
 */
function estimatedJackpotGrossPrizeForEntryAtIndex(fullLeaderboard, index, totalPool, topWinners, gameSettings) {
  const list = fullLeaderboard || [];
  const pool = Number(totalPool);
  if (!list.length || index < 0 || index >= list.length || !Number.isFinite(pool) || pool <= 0) {
    return null;
  }
  const rank = index + 1;
  if (rank > topWinners) return 0;
  const pct = resolveJackpotPrizePercentForRankClient(rank, gameSettings);
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.round((pool * pct) / 100);
}

// ==================== NIFTY JACKPOT SCREEN ====================
const NiftyJackpotScreen = ({ game, balance, onBack, user, refreshBalance, settings, tokenValue = 300 }) => {
  const [todayBid, setTodayBid] = useState(null);
  const [todayBids, setTodayBids] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardSpot, setLeaderboardSpot] = useState(null);
  const [myRank, setMyRank] = useState(null);
  const [totalBids, setTotalBids] = useState(0);
  const [totalPool, setTotalPool] = useState(0);
  const [uniquePlayerCount, setUniquePlayerCount] = useState(0);
  const [anonymousPodium, setAnonymousPodium] = useState([]);
  const [podiumIsOfficial, setPodiumIsOfficial] = useState(false);
  const [jackpotRankingMode, setJackpotRankingMode] = useState('nearest_spot');
  const [jackpotRankingReference, setJackpotRankingReference] = useState(null);
  const [ticketsToday, setTicketsToday] = useState(0);
  const [totalStakedToday, setTotalStakedToday] = useState(0);
  const [bidHistory, setBidHistory] = useState([]);
  const [placing, setPlacing] = useState(false);
  const [modifyingBidId, setModifyingBidId] = useState(null);
  const [message, setMessage] = useState(null);
  const [lockedPrice, setLockedPrice] = useState(null);
  const [priceLocked, setPriceLocked] = useState(false);
  const [lockedAt, setLockedAt] = useState(null);
  const [predictedPriceInput, setPredictedPriceInput] = useState('');
  const [predictionDrafts, setPredictionDrafts] = useState({});
  const [last5DaysData, setLast5DaysData] = useState([]);
  const [showLast5Days, setShowLast5Days] = useState(false);
  const [jackpotChartSpot, setJackpotChartSpot] = useState(null);
  const spotPrefillDoneRef = useRef(false);
  /** Same LTP as center chart — sent as `?spot=` so LIVE TOP 5 ranks move with ticks (no full page refresh). */
  const jackpotChartSpotRef = useRef(null);
  const jackpotLbThrottleTimerRef = useRef(null);

  // Admin-configured settings with fallbacks
  const topWinners = settings?.topWinners || 10;
  const gameEnabled = settings?.enabled !== false && settings?.enabled !== undefined && settings?.enabled !== null;
  /** Matches server: NODE_ENV !== 'production' bypasses jackpot bidding hours */
  const showJackpotOffHoursTestHint =
    import.meta.env.DEV ||
    import.meta.env.VITE_NIFTY_JACKPOT_TEST_BIDDING === 'true' ||
    import.meta.env.VITE_NIFTY_JACKPOT_TEST_BIDDING === '1';

  // Ticket conversion helpers
  const toTokens = (rs) => parseFloat((rs / tokenValue).toFixed(2));
  const balanceTokens = toTokens(balance);
  const oneTicketRs = Number(tokenValue) || 300;

  const prizeStructureRows = useMemo(() => {
    const n = Math.max(1, Math.min(100, Number(topWinners) || 20));
    return Array.from({ length: n }, (_, i) => {
      const rank = i + 1;
      return {
        rank,
        percent: resolveJackpotPrizePercentForRankClient(rank, settings),
      };
    });
  }, [topWinners, settings]);

  useEffect(() => {
    if (spotPrefillDoneRef.current) return;
    if (leaderboardSpot != null && Number.isFinite(Number(leaderboardSpot))) {
      setPredictedPriceInput(Number(leaderboardSpot).toFixed(2));
      spotPrefillDoneRef.current = true;
    }
  }, [leaderboardSpot]);

  useEffect(() => {
    setPredictionDrafts((prev) => {
      const pendingIds = new Set(
        todayBids.filter((b) => b.status === 'pending' && b._id).map((b) => String(b._id))
      );
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (!pendingIds.has(k)) delete next[k];
      }
      for (const b of todayBids) {
        if (b.status !== 'pending' || !b._id) continue;
        const id = String(b._id);
        if (next[id] !== undefined) continue;
        if (b.niftyPriceAtBid != null && Number.isFinite(Number(b.niftyPriceAtBid))) {
          next[id] = Number(b.niftyPriceAtBid).toFixed(2);
        } else {
          next[id] = '';
        }
      }
      return next;
    });
  }, [todayBids]);

  const fetchLast5Days = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/user/nifty-jackpot/last-5-days', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setLast5DaysData(data || []);
    } catch (error) {
      console.error('Error fetching last 5 days data:', error);
    }
  }, [user?.token]);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const spot = jackpotChartSpotRef.current;
      const params = { limit: 200, _ts: Date.now() };
      if (spot != null && Number.isFinite(Number(spot)) && Number(spot) > 0) {
        params.spot = Number(spot);
      }
      const { data } = await axios.get('/api/user/nifty-jackpot/leaderboard', {
        headers: { Authorization: `Bearer ${user.token}` },
        params,
      });
      setLeaderboard(data.leaderboard || []);
      setLeaderboardSpot(
        data.referenceSpot != null && Number.isFinite(Number(data.referenceSpot))
          ? Number(data.referenceSpot)
          : null
      );
      setJackpotRankingMode(
        data.rankingMode === 'nearest_locked_close' ? 'nearest_locked_close' : 'nearest_spot'
      );
      setJackpotRankingReference(
        data.rankingReference != null && Number.isFinite(Number(data.rankingReference))
          ? Number(data.rankingReference)
          : null
      );
      setMyRank(data.myRank);
      setTotalBids(data.totalBids || 0);
      setTotalPool(data.totalPool || 0);
      setUniquePlayerCount(data.uniquePlayerCount ?? 0);
      setAnonymousPodium(Array.isArray(data.anonymousPodium) ? data.anonymousPodium : []);
      setPodiumIsOfficial(!!data.podiumIsOfficial);
      if (data.ticketsToday != null) setTicketsToday(data.ticketsToday);
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
    }
  }, [user?.token]);

  const handleJackpotChartPrice = useCallback((price) => {
    if (price == null || !Number.isFinite(Number(price)) || Number(price) <= 0) return;
    const spot = Number(price);
    jackpotChartSpotRef.current = spot;
    setJackpotChartSpot(spot);
    if (jackpotLbThrottleTimerRef.current) return;
    jackpotLbThrottleTimerRef.current = setTimeout(() => {
      jackpotLbThrottleTimerRef.current = null;
      void fetchLeaderboard();
    }, 400);
  }, [fetchLeaderboard]);

  useEffect(() => {
    fetchTodayBid();
    fetchLeaderboard();
    fetchHistory();
    fetchLockedPrice();
    fetchLast5Days();
    const interval = setInterval(fetchLeaderboard, 8000);
    const priceInterval = setInterval(fetchLockedPrice, 30000);
    return () => {
      clearInterval(interval);
      clearInterval(priceInterval);
      if (jackpotLbThrottleTimerRef.current) {
        clearTimeout(jackpotLbThrottleTimerRef.current);
        jackpotLbThrottleTimerRef.current = null;
      }
    };
  }, [fetchLeaderboard]);

  const fetchLockedPrice = async () => {
    try {
      const { data } = await axios.get('/api/user/nifty-jackpot/locked-price', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setPriceLocked(data.locked);
      setLockedPrice(data.lockedPrice);
      setLockedAt(data.lockedAt);
    } catch (error) {
      console.error('Error fetching locked price:', error);
    }
  };

  const fetchTodayBid = async () => {
    try {
      const { data } = await axios.get('/api/user/nifty-jackpot/today', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setTodayBid(data.bid);
      setTodayBids(Array.isArray(data.bids) ? data.bids : []);
      setTicketsToday(data.ticketsToday ?? 0);
      setTotalStakedToday(data.totalStakedToday ?? 0);
    } catch (error) {
      console.error('Error fetching today bid:', error);
    }
  };

  const fetchHistory = async () => {
    try {
      const { data } = await axios.get('/api/user/nifty-jackpot/history', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setBidHistory(data);
    } catch (error) {
      console.error('Error fetching history:', error);
    }
  };

  const parseJackpotPredictedPriceClient = (raw) => {
    const n = parseFloat(String(raw ?? '').replace(/,/g, '').trim());
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false, error: 'Enter your predicted NIFTY price' };
    }
    if (n < 1000 || n > 200000) {
      return { ok: false, error: 'Predicted price must be between 1,000 and 200,000' };
    }
    return { ok: true, value: Math.round(n * 100) / 100 };
  };

  const handlePlaceBid = async () => {
    const amt = oneTicketRs;
    if (!Number.isFinite(amt) || amt <= 0) {
      setMessage({ type: 'error', text: 'Invalid ticket price' });
      return;
    }
    if (amt > balance) {
      setMessage({ type: 'error', text: 'Insufficient balance' });
      return;
    }
    if (!gameEnabled) {
      setMessage({ type: 'error', text: 'Game is currently disabled' });
      return;
    }
    const priceParse = parseJackpotPredictedPriceClient(predictedPriceInput);
    if (!priceParse.ok) {
      setMessage({ type: 'error', text: priceParse.error });
      return;
    }

    setPlacing(true);
    setMessage(null);
    try {
      const { data } = await axios.post(
        '/api/user/nifty-jackpot/bid',
        { amount: amt, predictedPrice: priceParse.value },
        { headers: { Authorization: `Bearer ${user.token}` } }
      );
      setTodayBid(data.bid);
      const px = data.bid?.niftyPriceAtBid;
      const pxText =
        px != null && Number.isFinite(Number(px))
          ? ` at predicted NIFTY ₹${Number(px).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`
          : '.';
      setMessage({ type: 'success', text: `1 ticket placed${pxText}` });
      refreshBalance();
      fetchLeaderboard();
      fetchHistory();
      fetchTodayBid();
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || 'Failed to place bid' });
    } finally {
      setPlacing(false);
    }
  };

  const handleUpdatePredictionBid = async (bidId) => {
    if (!bidId) return;
    const id = String(bidId);
    const priceParse = parseJackpotPredictedPriceClient(predictionDrafts[id]);
    if (!priceParse.ok) {
      setMessage({ type: 'error', text: priceParse.error });
      return;
    }
    setModifyingBidId(bidId);
    setMessage(null);
    try {
      const { data } = await axios.put(
        `/api/user/nifty-jackpot/bid/${bidId}`,
        { predictedPrice: priceParse.value },
        { headers: { Authorization: `Bearer ${user.token}` } }
      );
      const px = data.bid?.niftyPriceAtBid;
      if (px != null && Number.isFinite(Number(px))) {
        setPredictionDrafts((p) => ({ ...p, [id]: Number(px).toFixed(2) }));
      }
      const pxText =
        px != null && Number.isFinite(Number(px))
          ? ` Predicted NIFTY ₹${Number(px).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`
          : '';
      setMessage({ type: 'success', text: `Prediction saved.${pxText}` });
      fetchTodayBid();
      fetchLeaderboard();
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || 'Could not update order' });
    } finally {
      setModifyingBidId(null);
    }
  };

  const formatNiftyBidPx = (px) =>
    px != null && Number.isFinite(Number(px))
      ? `₹${Number(px).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : null;

  /** User's predicted NIFTY level stored per ticket — not ticket ₹ */
  const niftyAtBidDisplay = (niftyPriceAtBid) => formatNiftyBidPx(niftyPriceAtBid) || '—';

  return (
    <div className="h-screen bg-dark-900 text-white flex flex-col overflow-hidden">
      {/* Header Color Bar */}
      <div className={`bg-gradient-to-r ${game.color} h-1 flex-shrink-0`}></div>
      {/* Header */}
      <div className="bg-dark-800 border-b border-dark-600 flex-shrink-0">
        <div className="px-4 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={onBack} className="p-2 hover:bg-dark-700 rounded-lg transition">
                <ArrowLeft size={20} />
              </button>
              <div className="flex items-center gap-2">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${game.color} flex items-center justify-center`}>
                  <game.icon size={20} />
                </div>
                <div>
                  <h1 className="font-bold">{game.name}</h1>
                  <p className="text-xs text-gray-400">Top {topWinners} win prizes!</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {priceLocked && lockedPrice && (
                <div className="bg-green-900/30 border border-green-500/30 rounded-lg px-3 py-1.5 text-right">
                  <div className="text-[10px] text-green-400 flex items-center gap-1">
                    <Lock size={9} /> Locked Price
                  </div>
                  <div className="font-bold text-green-400">₹{lockedPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                </div>
              )}
              {myRank && (
                <div className="bg-yellow-900/30 border border-yellow-500/30 rounded-lg px-3 py-1.5 text-right">
                  <div className="text-[10px] text-yellow-400">Your Rank</div>
                  <div className="font-bold text-yellow-400">#{myRank}</div>
                </div>
              )}
              <div className="bg-dark-700 rounded-lg px-3 py-1.5 text-right">
                <div className="text-[10px] text-gray-400">Balance</div>
                <div className="font-bold text-purple-400">{balanceTokens} Tkt</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3-Column Layout */}
      <div className="px-3 py-2 flex-1 min-h-0 overflow-y-auto overscroll-y-contain lg:overflow-hidden touch-pan-y">
        <div className="flex flex-col lg:flex-row gap-3 min-h-min lg:h-full lg:min-h-0">

          {/* LEFT COLUMN - Game Info + Achievements + History */}
          <div className="lg:w-[280px] flex-shrink-0 order-1 lg:order-1 overflow-y-auto space-y-3">

            {/* Watch Previous LTPs Button */}
            {last5DaysData.length > 0 && !showLast5Days && (
              <button
                onClick={() => setShowLast5Days(true)}
                className="w-full bg-dark-800 rounded-xl p-3 border border-dark-600 hover:border-cyan-500/50 transition-colors"
              >
                <div className="flex items-center justify-center gap-2">
                  <TrendingUp size={14} className="text-cyan-400" />
                  <span className="text-xs font-medium text-cyan-400">Watch Previous LTPs</span>
                </div>
              </button>
            )}

            {/* Last 5 Days Closing Prices Card (shown when button clicked) */}
            {showLast5Days && last5DaysData.length > 0 && (
              <div className="bg-dark-800 rounded-xl p-3 border border-dark-600">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-xs flex items-center gap-1.5">
                    <TrendingUp size={12} className="text-cyan-400" />
                    Last 5 Days Closing Prices
                  </h3>
                  <button
                    onClick={() => setShowLast5Days(false)}
                    className="text-gray-400 hover:text-white transition"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="space-y-1.5">
                  {last5DaysData.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center py-1.5 border-b border-dark-600 last:border-0">
                      <span className="text-xs text-gray-400">{item.resultDate}</span>
                      <span className="text-sm font-bold text-cyan-400">
                        ₹{Number(item.lockedPrice).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Prize Structure */}
            <div className="bg-dark-800 rounded-xl p-3 border border-dark-600">
              <h3 className="font-bold text-xs mb-2 flex items-center gap-1.5">
                <Award size={12} className="text-yellow-400" />
                Prize Structure (full pool share)
              </h3>
              <p className="text-[9px] text-gray-500 mb-1.5">
                Each rank wins the shown <span className="text-cyan-400/90">% of the total kitty</span> (not tickets). ₹ shown is a projection from the current pool.
              </p>
              <p className="text-[9px] text-amber-200/90 mb-1.5 leading-snug rounded-md bg-amber-950/25 border border-amber-700/30 px-2 py-1.5">
                <span className="font-semibold text-amber-300">Ties (same distance to result / spot):</span> earlier
                ticket is ranked higher. Each list position gets that rank&apos;s full pool % (same as Super Admin) — e.g.
                two tickets at the same distance are still #1 and #2 with 1st and 2nd prize %, not a merged split.
              </p>
              <div className="space-y-1 text-xs max-h-[200px] overflow-y-auto">
                {prizeStructureRows.map(({ rank, percent }) => (
                  <div key={rank} className="flex justify-between py-1 border-b border-dark-600 gap-2">
                    <span className="text-gray-400 shrink-0">#{rank}</span>
                    <div className="text-right min-w-0">
                      <span className="text-green-400 font-bold tabular-nums">{formatJackpotPoolPercent(percent)}</span>
                      <span className="text-gray-500 text-[10px] ml-1">of pool</span>
                      {totalPool > 0 && percent > 0 && (
                        <div className="text-[10px] text-gray-500 tabular-nums">
                          ≈ ₹{Math.round((totalPool * percent) / 100).toLocaleString('en-IN')}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-1 text-xs mt-1">
                <div className="flex justify-between py-1 border-b border-dark-600">
                  <span className="text-gray-400">Top Winners</span>
                  <span className="text-yellow-400 font-bold">{topWinners}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-dark-600">
                  <span className="text-gray-400">1 Ticket</span>
                  <span className="font-medium">₹{tokenValue}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-dark-600">
                  <span className="text-gray-400">Result At</span>
                  <span className="font-medium">{settings?.resultTime || '15:45'} IST</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-gray-400">Nifty Price</span>
                  {priceLocked && lockedPrice ? (
                    <span className="text-green-400 font-bold flex items-center gap-1"><Lock size={10} /> ₹{lockedPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  ) : (
                    <span className="text-yellow-400 text-[10px]">Not locked yet</span>
                  )}
                </div>
              </div>
              <p className="text-[10px] text-gray-500 mt-2 text-center">
                Clearing and top {topWinners} winners are decided at {settings?.resultTime || '15:45'} IST.
              </p>
            </div>

            {/* Bid History */}
            <div className="bg-dark-800 rounded-xl p-3 border border-dark-600">
              <h3 className="font-bold text-xs mb-2 flex items-center gap-1.5">
                <Timer size={12} className="text-gray-400" />
                Your History
              </h3>
              {bidHistory.length === 0 ? (
                <p className="text-gray-500 text-[10px] text-center py-2">No bids yet</p>
              ) : (
                <div className="space-y-1 max-h-[160px] overflow-y-auto">
                  {bidHistory.map((bid, idx) => {
                    const niftyAtBid = formatNiftyBidPx(bid.niftyPriceAtBid);
                    const dist =
                      bid.distanceToReference != null && Number.isFinite(Number(bid.distanceToReference))
                        ? Number(bid.distanceToReference).toFixed(2)
                        : jackpotRankingReference != null && bid.niftyPriceAtBid != null
                          ? Math.abs(Number(bid.niftyPriceAtBid) - Number(jackpotRankingReference)).toFixed(2)
                          : '—';
                    return (
                    <div key={bid._id || idx} className={`flex items-center justify-between p-2 rounded-lg text-xs ${
                      bid.status === 'won' ? 'bg-green-900/20' :
                      bid.status === 'lost' ? 'bg-red-900/20' :
                      'bg-dark-700'
                    }`}>
                      <div>
                        <div className="text-[10px] text-gray-500">{bid.betDate}</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">Predicted NIFTY</div>
                        <div className="text-[12px] text-cyan-300 font-bold tabular-nums">
                          {niftyAtBid || (
                            <span className="text-gray-500 font-medium text-[11px]">Not recorded</span>
                          )}
                        </div>
                        {bid.rank != null && (
                          <div className="text-[10px] text-gray-500 mt-1">Rank #{bid.rank}</div>
                        )}
                        <div className="text-[10px] text-gray-500 mt-0.5">Distance: <span className="text-cyan-400 font-medium">{dist}</span></div>
                      </div>
                      <div className="text-right">
                        {bid.status === 'pending' && <span className="text-yellow-400 font-medium">Pending</span>}
                        {bid.status === 'won' && <span className="text-green-400 font-bold">+{toTokens(bid.prize)} T</span>}
                        {bid.status === 'lost' && <span className="text-red-400 font-bold">-{toTokens(bid.amount)} T</span>}
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>

            <GamesWalletGameLedgerPanel
              gameId={ledgerGameIdFromUi(game.id)}
              userToken={user?.token}
              tokenValue={tokenValue}
              title="Order history — Nifty Jackpot"
              limit={500}
              enableDateFilter
              footerNote="Newest entries appear first. The Balance column is your games wallet after that line — read from the bottom upward to follow time order."
            />
          </div>

          {/* CENTER COLUMN - Nifty live price */}
          <div className="flex-1 min-w-0 order-2 max-lg:order-3 flex flex-col min-h-0 max-lg:flex-none max-lg:max-h-[min(42vh,400px)] lg:flex-1">
            <GameLivePricePanel
              gameId="updown"
              fullHeight
              closedNiftyStickMode="clearing"
              onPriceUpdate={handleJackpotChartPrice}
            />
          </div>

          {/* RIGHT COLUMN - Kitty + Top 5 + Bid Controls */}
          <div className="w-full max-w-full lg:w-[300px] flex-shrink-0 order-3 max-lg:order-2 flex flex-col lg:h-full lg:min-h-0 lg:overflow-hidden max-lg:overflow-visible pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {/* Scrollable content area */}
            <div className="overflow-y-auto flex-1 space-y-2">
              {/* Kitty Amount Box */}
              <div className="bg-gradient-to-r from-purple-900/40 to-pink-900/40 border border-purple-500/30 rounded-xl p-3 text-center">
                <div className="text-[10px] text-purple-300 font-medium mb-1 flex items-center justify-center gap-1">
                  <Zap size={10} /> BANK 
                </div>
                <div className="text-2xl font-bold text-purple-300 tabular-nums">
                  ₹{Number(totalPool || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-[10px] text-gray-400 mt-1">
                  {uniquePlayerCount} contributor{uniquePlayerCount !== 1 ? 's' : ''} in the kitty
                </div>
              </div>

              {/* Live Nifty Spot Price Box */}
              <div className="bg-gradient-to-r from-cyan-900/40 to-blue-900/40 border border-cyan-500/30 rounded-xl p-3 text-center">
                <div className="text-[10px] text-cyan-300 font-medium mb-1 flex items-center justify-center gap-1">
                  <TrendingUp size={10} /> NIFTY SPOT
                </div>
                <div className="text-2xl font-bold text-cyan-300 tabular-nums">
                  {(() => {
                    const displaySpot =
                      jackpotRankingReference != null && Number.isFinite(Number(jackpotRankingReference))
                        ? Number(jackpotRankingReference)
                        : leaderboardSpot != null && Number.isFinite(Number(leaderboardSpot))
                          ? Number(leaderboardSpot)
                          : jackpotChartSpot != null && Number.isFinite(Number(jackpotChartSpot))
                            ? Number(jackpotChartSpot)
                            : lockedPrice != null && Number.isFinite(Number(lockedPrice))
                              ? Number(lockedPrice)
                              : null;
                    return displaySpot != null
                      ? displaySpot.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                      : 'Loading...';
                  })()}
                </div>
                <div className="text-[10px] text-gray-400 mt-1">
                  {jackpotRankingMode === 'nearest_locked_close' || priceLocked ? 'Clearing price' : 'Live price'}
                </div>
              </div>

              {showJackpotOffHoursTestHint && (
                <div className="bg-emerald-900/20 border border-emerald-500/35 rounded-lg px-2.5 py-2 text-[10px] text-emerald-200/95 leading-snug">
                  <span className="font-semibold text-emerald-300">Test mode</span>
                  — bidding hours are not enforced on the API in local dev, so you can place tickets anytime and use dummy NIFTY. Production still uses{' '}
                  {settings?.biddingStartTime || '09:15'}–{settings?.biddingEndTime || '14:59'} IST unless{' '}
                  <span className="font-mono text-emerald-400/90">NIFTY_JACKPOT_ALLOW_TEST_BIDDING</span> is set on the server.
                </div>
              )}

              {/* Live Top 5 Users Box */}
              <div className="bg-dark-800 rounded-xl p-3 border border-yellow-500/30">
                <h3 className="font-bold text-xs mb-2 flex items-center gap-1.5 text-yellow-400">
                  <Crown size={14} />
                  LIVE TOP 5
                </h3>
                <p className="text-[9px] text-gray-500 mb-2">
                  {jackpotRankingMode === 'nearest_locked_close'
                    ? 'Nearest to declared result · tie → earlier time'
                    : 'Nearest to live spot first · tie → earlier time'}
                  {(jackpotRankingReference != null && Number.isFinite(Number(jackpotRankingReference))) ||
                  (leaderboardSpot != null && Number.isFinite(Number(leaderboardSpot))) ? (
                    <span className="text-cyan-500/90">
                      {' '}
                      ·{' '}
                      {jackpotRankingMode === 'nearest_locked_close' ? 'result' : 'spot'} ₹
                      {(jackpotRankingReference != null && Number.isFinite(Number(jackpotRankingReference))
                        ? jackpotRankingReference
                        : leaderboardSpot
                      ).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </span>
                  ) : null}
                </p>
                <p className="text-[9px] text-gray-500 mb-2 leading-snug">
                  Right column: <span className="text-gray-400">Stake</span> = ticket cost (usually 1 ticket).{' '}
                  <span className="text-emerald-300/90">Est. gross</span> = that row&apos;s rank % × pool (same as Super Admin
                  and settlement).
                </p>
                {!podiumIsOfficial && (
                  <p className="text-[9px] text-cyan-500/80 mb-2 leading-snug">
                    Order updates with the chart LTP (nearest spot) — no refresh needed.
                  </p>
                )}
                {leaderboard.slice(0, 5).length === 0 ? (
                  <p className="text-gray-500 text-[10px] text-center py-3">No bids yet today</p>
                ) : (
                  <div className="space-y-1">
                    {leaderboard.slice(0, 5).map((entry, idx) => {
                      const isMe = entry.userId?.toString() === user._id?.toString() || entry.userId === user._id;
                      const bidTime = entry.bidTime ? new Date(entry.bidTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--';
                      const estGross = estimatedJackpotGrossPrizeForEntryAtIndex(
                        leaderboard,
                        idx,
                        totalPool,
                        topWinners,
                        settings
                      );
                      return (
                        <div
                          key={String(entry.bidId ?? idx)}
                          className={`flex items-center justify-between p-2 rounded-lg text-xs transition-all duration-300 ease-out ${
                          isMe ? 'bg-yellow-900/30 border border-yellow-500/20' :
                          idx < 3 ? 'bg-dark-700/80' : 'bg-dark-700/40'
                        }`}
                        >
                          <div className="flex items-center gap-2">
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                              idx === 0 ? 'bg-yellow-500 text-black' :
                              idx === 1 ? 'bg-gray-300 text-black' :
                              idx === 2 ? 'bg-orange-600 text-white' :
                              'bg-dark-600 text-gray-400'
                            }`}>
                              {idx + 1}
                            </div>
                            <div>
                              <div className={`font-medium ${isMe ? 'text-yellow-400' : 'text-white'}`}>
                                {isMe ? 'You' : entry.name}
                              </div>
                              <div className="text-[10px] text-gray-500 flex items-center gap-1.5 flex-wrap">
                                <span className="text-cyan-300 font-semibold tabular-nums">{niftyAtBidDisplay(entry.niftyPriceAtBid)}</span>
                                <span className="text-gray-600">|</span>
                                <span className="text-cyan-400/90">{bidTime}</span>
                              </div>
                              <div className="text-[9px] text-gray-600 mt-0.5">Predicted NIFTY</div>
                            </div>
                          </div>
                          <div className="text-right shrink-0 pl-1">
                            <div
                              className="text-yellow-300 font-bold text-[11px] tabular-nums"
                              title="Amount staked on this ticket (not the prize)"
                            >
                              ₹{Number(entry.amount ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                            <div className="text-[9px] text-gray-500">Stake</div>
                            {estGross != null && estGross > 0 && (
                              <>
                                <div className="text-emerald-300/95 font-bold text-[11px] tabular-nums mt-1">
                                  ≈ ₹{estGross.toLocaleString('en-IN')}
                                </div>
                                <div className="text-[9px] text-emerald-500/80">Est. gross</div>
                              </>
                            )}
                            {estGross === 0 && (
                              <div className="text-[9px] text-gray-600 mt-1">Outside top {topWinners}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Message */}
              {message && (
                <div className={`p-2 rounded-lg text-xs font-medium ${message.type === 'success' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
                  {message.text}
                </div>
              )}

              <div className="space-y-3">
                {ticketsToday > 0 && todayBid && (
                  <div className="rounded-xl p-3 border border-yellow-500/30 bg-yellow-900/15 text-center text-xs">
                    <div className="text-gray-400 mb-1">Your tickets today</div>
                    <div className="text-lg font-bold text-yellow-400">{ticketsToday}</div>
                    <div className="text-[10px] text-gray-500 mt-1">
                      Staked ₹{Number(totalStakedToday || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      {myRank != null && (
                        <span className="text-cyan-400/90"> · Best rank #{myRank}</span>
                      )}
                    </div>
                  </div>
                )}

                {ticketsToday > 0 && todayBid && (
                  <div className={`rounded-xl p-4 border ${
                    todayBid.status === 'won' ? 'bg-green-900/20 border-green-500/30' :
                    todayBid.status === 'lost' ? 'bg-red-900/20 border-red-500/30' :
                    todayBid.status === 'expired' ? 'bg-gray-800/50 border-gray-500/30' :
                    'bg-yellow-900/20 border-yellow-500/30'
                  }`}>
                    <div className="text-center">
                      <div className="text-gray-400 text-xs mb-1">Latest entry</div>
                      {formatNiftyBidPx(todayBid.niftyPriceAtBid) && (
                        <div className="text-cyan-400 text-sm font-semibold mb-1">
                          Predicted {formatNiftyBidPx(todayBid.niftyPriceAtBid)}
                        </div>
                      )}
                      {myRank != null && (
                        <div className={`text-sm font-bold ${myRank <= topWinners ? 'text-green-400' : 'text-red-400'}`}>
                          Best rank #{myRank}{myRank <= topWinners ? ' 🏆' : ''}
                        </div>
                      )}
                      {todayBid.status === 'pending' && (
                        <div className="text-yellow-400 text-[10px] font-medium mt-2">Result at {settings?.resultTime || '15:45'} IST</div>
                      )}
                      {todayBid.status === 'pending' && todayBids.filter((b) => b.status === 'pending').length > 0 && (
                        <div className="mt-3 space-y-2 text-left border-t border-yellow-500/20 pt-3">
                          <div className="text-[10px] text-gray-500 text-center">Edit predicted NIFTY per ticket (no cancel)</div>
                          {todayBids
                            .filter((b) => b.status === 'pending')
                            .map((b) => {
                              const bidKey = String(b._id);
                              return (
                                <div key={b._id} className="space-y-1">
                                  <div className="text-[9px] text-gray-500">
                                    {b.createdAt
                                      ? new Date(b.createdAt).toLocaleTimeString('en-IN', {
                                          hour: '2-digit',
                                          minute: '2-digit',
                                          second: '2-digit',
                                        })
                                      : 'Ticket'}
                                  </div>
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    step="0.05"
                                    min="1000"
                                    max="200000"
                                    placeholder="Predicted NIFTY"
                                    value={predictionDrafts[bidKey] ?? ''}
                                    onChange={(e) =>
                                      setPredictionDrafts((p) => ({ ...p, [bidKey]: e.target.value }))
                                    }
                                    className="w-full px-2 py-1.5 rounded-lg bg-dark-700 border border-dark-600 text-cyan-200 text-xs tabular-nums placeholder:text-gray-600 focus:border-cyan-500/50 focus:outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleUpdatePredictionBid(b._id)}
                                    disabled={modifyingBidId === b._id}
                                    className="w-full py-1.5 px-2 rounded-lg bg-dark-700 hover:bg-dark-600 border border-cyan-500/30 text-[10px] text-cyan-300 font-medium disabled:opacity-50"
                                  >
                                    {modifyingBidId === b._id ? 'Saving…' : 'Save prediction'}
                                  </button>
                                </div>
                              );
                            })}
                        </div>
                      )}
                      {todayBid.status === 'won' && todayBid.prize > 0 && (
                        <div className="text-green-400 text-sm font-bold mt-1">Won {toTokens(todayBid.prize)} T</div>
                      )}
                      {todayBid.status === 'lost' && (
                        <div className="text-red-400 text-xs mt-1">This entry did not place in the prize ranks.</div>
                      )}
                    </div>
                  </div>
                )}

                {priceLocked && lockedPrice && (
                  <div className="bg-green-900/20 border border-green-500/30 rounded-xl p-3 text-center">
                    <div className="text-[10px] text-green-400 flex items-center justify-center gap-1 mb-1">
                      <Lock size={10} /> Nifty Price Locked
                    </div>
                    <div className="text-xl font-bold text-green-400">₹{lockedPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                    {lockedAt && (
                      <div className="text-[10px] text-gray-500 mt-1">
                        Locked at {new Date(lockedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} IST
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Fixed bet placement box at bottom */}
            <div className="mt-2 space-y-2 flex-shrink-0">
              <div className="bg-dark-800 rounded-xl p-3 border border-dark-600 text-center space-y-2">
                <div className="text-[10px] text-gray-400 font-medium">Each purchase · 1 ticket · ₹{oneTicketRs.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
                <div className="text-left">
                  <label htmlFor="nifty-jackpot-predicted" className="block text-[10px] text-gray-500 mb-1 font-medium">
                    Predicted NIFTY price
                  </label>
                  <input
                    id="nifty-jackpot-predicted"
                    type="number"
                    inputMode="decimal"
                    step="0.05"
                    min="1000"
                    max="200000"
                    placeholder="e.g. 23950.50"
                    value={predictedPriceInput}
                    onChange={(e) => setPredictedPriceInput(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-dark-700 border border-dark-600 text-cyan-200 text-sm tabular-nums placeholder:text-gray-600 focus:border-yellow-500/40 focus:outline-none"
                  />
                </div>
              </div>

              <button
                onClick={handlePlaceBid}
                disabled={placing || oneTicketRs > balance || !gameEnabled}
                className={`w-full py-3 rounded-xl font-bold text-sm transition-all ${
                  !placing && oneTicketRs <= balance && gameEnabled
                    ? 'bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-black'
                    : 'bg-dark-700 text-gray-500 cursor-not-allowed'
                }`}
              >
                {placing ? (
                  <span className="flex items-center justify-center gap-2">
                    <RefreshCw size={16} className="animate-spin" /> Placing...
                  </span>
                ) : oneTicketRs > balance ? (
                  'Insufficient balance'
                ) : !gameEnabled ? (
                  'Game disabled'
                ) : (
                  `Add 1 ticket (₹${oneTicketRs.toLocaleString('en-IN')})`
                )}
              </button>

              <div className="bg-dark-800/50 rounded-lg p-2 text-[10px] text-gray-500 text-center">
                <Zap size={10} className="inline mr-1 text-yellow-400" />
                Ranking uses your predicted level vs live spot (then vs locked close). Tap again for another ticket (up to daily limit).
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

// ==================== BTC JACKPOT SCREEN ====================
// Standalone BTC-Jackpot user screen. Intentionally mirrors the NiftyJackpotScreen
// layout 1:1 (3-column grid, prize ladder, live top-5, bank card, ticket form)
// so the game feels identical — only the symbol, endpoints and USD currency change.

function clientIstSecondsFromMidnight() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const pick = (t) => parseInt(parts.find((p) => p.type === t)?.value || '0', 10);
  return pick('hour') * 3600 + pick('minute') * 60 + pick('second');
}

function clientParseClockToSeconds(str) {
  const s = String(str ?? '00:00').trim();
  const parts = s.split(':').map((x) => parseInt(x, 10));
  const h = parts[0] || 0;
  const m = Number.isFinite(parts[1]) ? parts[1] : 0;
  const sec = Number.isFinite(parts[2]) ? parts[2] : 0;
  return h * 3600 + m * 60 + sec;
}

function clientBiddingEndInclusiveSeconds(endTimeStr) {
  const s = String(endTimeStr || '23:29').trim();
  const segments = s.split(':').filter((x) => x !== '');
  const base = clientParseClockToSeconds(s);
  if (segments.length >= 3) return base;
  const minuteStart = Math.floor(base / 60) * 60;
  return minuteStart + 59;
}

/** Mirrors server/utils/btcJackpotBiddingWindow.js for UX (place/edit disabled + banner). */
function evaluateBtcJackpotBiddingWindowClient(settings) {
  if (
    import.meta.env.VITE_BTC_JACKPOT_TEST_BIDDING === 'true' ||
    import.meta.env.VITE_BTC_JACKPOT_TEST_BIDDING === '1'
  ) {
    return { ok: true };
  }
  const startSec = clientParseClockToSeconds(settings?.biddingStartTime || '00:00');
  const endInclusive = clientBiddingEndInclusiveSeconds(settings?.biddingEndTime || '23:29');
  const nowSec = clientIstSecondsFromMidnight();
  if (nowSec < startSec) return { ok: false, reason: 'before_start' };
  if (nowSec > endInclusive) return { ok: false, reason: 'after_end' };
  return { ok: true };
}

function btcJackpotBiddingMessageClient(settings, reason) {
  if (reason === 'before_start') {
    return `Bidding opens at ${settings?.biddingStartTime || '00:00'} IST.`;
  }
  return "Today's bidding time is over now.";
}

const BtcJackpotScreen = ({ game, balance, onBack, user, refreshBalance, settings, tokenValue = 500 }) => {
  const [todayBid, setTodayBid] = useState(null);
  const [todayBids, setTodayBids] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardSpot, setLeaderboardSpot] = useState(null);
  const [myRank, setMyRank] = useState(null);
  const [totalBids, setTotalBids] = useState(0);
  const [totalPool, setTotalPool] = useState(0);
  const [ticketsToday, setTicketsToday] = useState(0);
  const [totalStakedToday, setTotalStakedToday] = useState(0);
  const [bidHistory, setBidHistory] = useState([]);
  const [placing, setPlacing] = useState(false);
  const [modifyingBidId, setModifyingBidId] = useState(null);
  const [message, setMessage] = useState(null);
  const [lockedPrice, setLockedPrice] = useState(null);
  const [priceLocked, setPriceLocked] = useState(false);
  const [lockedAt, setLockedAt] = useState(null);
  const [predictedPriceInput, setPredictedPriceInput] = useState('');
  const [predictionDrafts, setPredictionDrafts] = useState({});
  const spotPrefillDoneRef = useRef(false);

  const topWinners = settings?.topWinners || 20;
  const gameEnabled = settings?.enabled !== false && settings?.enabled !== undefined && settings?.enabled !== null;

  const showBtcJackpotClientTestBiddingHint =
    import.meta.env.VITE_BTC_JACKPOT_TEST_BIDDING === 'true' ||
    import.meta.env.VITE_BTC_JACKPOT_TEST_BIDDING === '1';

  const [biddingClockTick, setBiddingClockTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setBiddingClockTick((n) => n + 1), 10000);
    return () => clearInterval(t);
  }, []);

  const biddingWindow = useMemo(
    () => evaluateBtcJackpotBiddingWindowClient(settings),
    [settings, biddingClockTick]
  );

  const oneTicketRs = Number(tokenValue) || Number(settings?.ticketPrice) || 500;
  const toTokens = (rs) => (oneTicketRs > 0 ? parseFloat((rs / oneTicketRs).toFixed(2)) : 0);
  const balanceTokens = toTokens(balance);

  const prizeStructureRows = useMemo(() => {
    const n = Math.max(1, Math.min(100, Number(topWinners) || 20));
    const ladder = Array.isArray(settings?.prizePercentages) ? settings.prizePercentages : [];
    const pctByRank = new Map(
      ladder.map((row) => [Number(row.rank) || 0, Number(row.percent) || 0])
    );
    return Array.from({ length: n }, (_, i) => {
      const rank = i + 1;
      return { rank, percent: pctByRank.get(rank) || 0 };
    });
  }, [topWinners, settings]);

  const formatBtcBidPx = useCallback(
    (px) =>
      px != null && Number.isFinite(Number(px))
        ? `$${Number(px).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : null,
    []
  );
  const btcAtBidDisplay = useCallback((v) => formatBtcBidPx(v) || '—', [formatBtcBidPx]);

  const parseBtcPredictedPriceClient = (raw) => {
    const n = parseFloat(String(raw ?? '').replace(/,/g, '').trim());
    if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'Enter your predicted BTC price' };
    if (n < 1 || n > 10000000) return { ok: false, error: 'Predicted BTC must be between 1 and 10,000,000 USD' };
    return { ok: true, value: Math.round(n * 100) / 100 };
  };

  const fetchTodayBid = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/user/btc-jackpot/today', {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      const bids = Array.isArray(data?.bids) ? data.bids : [];
      setTodayBids(bids);
      setTodayBid(bids[0] || null);
      setTicketsToday(Number(data?.ticketsUsed) || bids.length);
      setTotalStakedToday(Number(data?.totalStaked) || bids.reduce((s, b) => s + (Number(b.amount) || 0), 0));
    } catch (error) {
      console.error('Error fetching BTC Jackpot today:', error);
    }
  }, [user?.token]);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/user/btc-jackpot/leaderboard', {
        headers: { Authorization: `Bearer ${user.token}` },
        params: { limit: 200, _ts: Date.now() },
      });
      const winners = Array.isArray(data?.winners) ? data.winners : [];
      // Map server winners to the shape used by the Nifty-style Live Top 5 UI.
      const mapped = winners.map((w) => ({
        bidId: w.bidId,
        userId: null,
        name: w.isOwnBid ? 'You' : (w.maskedUsername || 'Player'),
        amount: Number(w.ticketCount || 1) * (Number(settings?.ticketPrice) || oneTicketRs),
        niftyPriceAtBid: w.predictedBtc,
        bidTime: w.createdAt,
        isOwnBid: !!w.isOwnBid,
        poolPercent: Number(w.poolPercent) || 0,
        projectedPrize: Number(w.projectedPrize) || 0,
        tied: !!w.tied,
        tiedGroupSize: Number(w.tiedGroupSize) || 1,
        distance: Number(w.distance) || null,
        rank: Number(w.rank) || null,
      }));
      setLeaderboard(mapped);
      setLeaderboardSpot(
        data?.spot != null && Number.isFinite(Number(data.spot)) ? Number(data.spot) : null
      );
      setTotalPool(Number(data?.totalPool) || 0);
      setTotalBids(mapped.length);
      const me = mapped.find((m) => m.isOwnBid);
      setMyRank(me?.rank ?? null);
    } catch (error) {
      console.error('Error fetching BTC Jackpot leaderboard:', error);
    }
  }, [user?.token, settings?.ticketPrice, oneTicketRs]);

  const fetchBank = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/user/btc-jackpot/bank', {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (data?.lockedBtcPrice != null) {
        setLockedPrice(Number(data.lockedBtcPrice));
        setPriceLocked(!!data.resultDeclared || Number(data.lockedBtcPrice) > 0);
        setLockedAt(data.resultDeclaredAt || data.lockedAt || null);
      } else {
        setLockedPrice(null);
        setPriceLocked(false);
        setLockedAt(null);
      }
      // Keep totalPool authoritative from bank if leaderboard hasn't loaded yet.
      setTotalPool((cur) => cur || Number(data?.totalStake) || 0);
    } catch (error) {
      console.error('Error fetching BTC Jackpot bank:', error);
    }
  }, [user?.token]);

  const fetchHistory = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/user/btc-jackpot/history?days=14', {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      // Flatten per-date groups into a flat bid list for the Your History panel.
      const groups = Array.isArray(data?.history) ? data.history : [];
      const flat = [];
      for (const g of groups) {
        for (const b of g.bids || []) {
          flat.push({
            ...b,
            lockedClose: g.lockedBtcPrice ?? null,
            resultDeclared: !!g.resultDeclared,
            niftyPriceAtBid: b.predictedBtc,
            distanceToReference:
              b.predictedBtc != null && g.lockedBtcPrice != null
                ? Math.abs(Number(b.predictedBtc) - Number(g.lockedBtcPrice))
                : null,
          });
        }
      }
      flat.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      setBidHistory(flat);
    } catch (error) {
      console.error('Error fetching BTC Jackpot history:', error);
    }
  }, [user?.token]);

  useEffect(() => {
    fetchTodayBid();
    fetchLeaderboard();
    fetchHistory();
    fetchBank();
    const interval = setInterval(fetchLeaderboard, 5000);
    const bankInterval = setInterval(fetchBank, 15000);
    return () => {
      clearInterval(interval);
      clearInterval(bankInterval);
    };
  }, [fetchTodayBid, fetchLeaderboard, fetchHistory, fetchBank]);

  useEffect(() => {
    if (spotPrefillDoneRef.current) return;
    if (leaderboardSpot != null && Number.isFinite(Number(leaderboardSpot))) {
      setPredictedPriceInput(Number(leaderboardSpot).toFixed(2));
      spotPrefillDoneRef.current = true;
    }
  }, [leaderboardSpot]);

  useEffect(() => {
    setPredictionDrafts((prev) => {
      const pendingIds = new Set(
        todayBids.filter((b) => b.status === 'pending' && b._id).map((b) => String(b._id))
      );
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (!pendingIds.has(k)) delete next[k];
      }
      for (const b of todayBids) {
        if (b.status !== 'pending' || !b._id) continue;
        const id = String(b._id);
        if (next[id] !== undefined) continue;
        if (b.predictedBtc != null && Number.isFinite(Number(b.predictedBtc))) {
          next[id] = Number(b.predictedBtc).toFixed(2);
        } else {
          next[id] = '';
        }
      }
      return next;
    });
  }, [todayBids]);

  const handlePlaceBid = async () => {
    const amt = oneTicketRs;
    if (!Number.isFinite(amt) || amt <= 0) {
      setMessage({ type: 'error', text: 'Invalid ticket price' });
      return;
    }
    if (amt > balance) {
      setMessage({ type: 'error', text: 'Insufficient balance' });
      return;
    }
    if (!gameEnabled) {
      setMessage({ type: 'error', text: 'Game is currently disabled' });
      return;
    }
    if (!biddingWindow.ok) {
      setMessage({
        type: 'error',
        text: btcJackpotBiddingMessageClient(settings, biddingWindow.reason),
      });
      return;
    }
    const priceParse = parseBtcPredictedPriceClient(predictedPriceInput);
    if (!priceParse.ok) {
      setMessage({ type: 'error', text: priceParse.error });
      return;
    }

    setPlacing(true);
    setMessage(null);
    try {
      const { data } = await axios.post(
        '/api/user/btc-jackpot/bid',
        { predictedBtc: priceParse.value },
        { headers: { Authorization: `Bearer ${user.token}` } }
      );
      const px = data?.bid?.predictedBtc;
      const pxText =
        px != null && Number.isFinite(Number(px))
          ? ` at predicted BTC $${Number(px).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`
          : '.';
      setMessage({ type: 'success', text: `1 ticket placed${pxText}` });
      if (typeof refreshBalance === 'function') refreshBalance();
      fetchTodayBid();
      fetchLeaderboard();
      fetchBank();
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || 'Failed to place bid' });
    } finally {
      setPlacing(false);
    }
  };

  const handleUpdatePredictionBid = async (bidId) => {
    if (!bidId) return;
    if (!biddingWindow.ok) {
      setMessage({
        type: 'error',
        text: btcJackpotBiddingMessageClient(settings, biddingWindow.reason),
      });
      return;
    }
    const id = String(bidId);
    const priceParse = parseBtcPredictedPriceClient(predictionDrafts[id]);
    if (!priceParse.ok) {
      setMessage({ type: 'error', text: priceParse.error });
      return;
    }
    setModifyingBidId(bidId);
    setMessage(null);
    try {
      const { data } = await axios.put(
        `/api/user/btc-jackpot/bid/${bidId}`,
        { predictedBtc: priceParse.value },
        { headers: { Authorization: `Bearer ${user.token}` } }
      );
      const px = data?.bid?.predictedBtc;
      if (px != null && Number.isFinite(Number(px))) {
        setPredictionDrafts((p) => ({ ...p, [id]: Number(px).toFixed(2) }));
      }
      const pxText =
        px != null && Number.isFinite(Number(px))
          ? ` Predicted BTC $${Number(px).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`
          : '';
      setMessage({ type: 'success', text: `Prediction saved.${pxText}` });
      fetchTodayBid();
      fetchLeaderboard();
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || 'Could not update order' });
    } finally {
      setModifyingBidId(null);
    }
  };

  return (
    <div className="h-screen bg-dark-900 text-white flex flex-col overflow-hidden">
      <div className={`bg-gradient-to-r ${game.color} h-1 flex-shrink-0`}></div>
      <div className="bg-dark-800 border-b border-dark-600 flex-shrink-0">
        <div className="px-4 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={onBack} className="p-2 hover:bg-dark-700 rounded-lg transition">
                <ArrowLeft size={20} />
              </button>
              <div className="flex items-center gap-2">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${game.color} flex items-center justify-center`}>
                  <game.icon size={20} />
                </div>
                <div>
                  <h1 className="font-bold">{game.name}</h1>
                  <p className="text-xs text-gray-400">Top {topWinners} win prizes!</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {priceLocked && lockedPrice && (
                <div className="bg-green-900/30 border border-green-500/30 rounded-lg px-3 py-1.5 text-right">
                  <div className="text-[10px] text-green-400 flex items-center gap-1">
                    <Lock size={9} /> Locked Price
                  </div>
                  <div className="font-bold text-green-400">${Number(lockedPrice).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                </div>
              )}
              {myRank && (
                <div className="bg-yellow-900/30 border border-yellow-500/30 rounded-lg px-3 py-1.5 text-right">
                  <div className="text-[10px] text-yellow-400">Your Rank</div>
                  <div className="font-bold text-yellow-400">#{myRank}</div>
                </div>
              )}
              <div className="bg-dark-700 rounded-lg px-3 py-1.5 text-right">
                <div className="text-[10px] text-gray-400">Balance</div>
                <div className="font-bold text-purple-400">{balanceTokens} Tkt</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-3 py-2 flex-1 min-h-0 overflow-y-auto overscroll-y-contain lg:overflow-hidden touch-pan-y">
        <div className="flex flex-col lg:flex-row gap-3 min-h-min lg:h-full lg:min-h-0">

          {/* LEFT COLUMN */}
          <div className="lg:w-[280px] flex-shrink-0 order-1 lg:order-1 overflow-y-auto space-y-3">
            <div className="bg-dark-800 rounded-xl p-3 border border-dark-600">
              <h3 className="font-bold text-xs mb-2 flex items-center gap-1.5">
                <Award size={12} className="text-yellow-400" />
                Prize Structure (full pool share)
              </h3>
              <p className="text-[9px] text-gray-500 mb-1.5">
                Each rank wins the shown <span className="text-cyan-400/90">% of the Bank</span>. ₹ shown is a projection from the current pool.
              </p>
              <p className="text-[9px] text-amber-200/90 mb-1.5 leading-snug rounded-md bg-amber-950/25 border border-amber-700/30 px-2 py-1.5">
                <span className="font-semibold text-amber-300">Ties (same distance to BTC close):</span> winning
                amount is <span className="text-amber-200">pooled and split equally</span> among tied tickets.
              </p>
              <div className="space-y-1 text-xs max-h-[200px] overflow-y-auto">
                {prizeStructureRows.map(({ rank, percent }) => (
                  <div key={rank} className="flex justify-between py-1 border-b border-dark-600 gap-2">
                    <span className="text-gray-400 shrink-0">#{rank}</span>
                    <div className="text-right min-w-0">
                      <span className="text-green-400 font-bold tabular-nums">{formatJackpotPoolPercent(percent)}</span>
                      <span className="text-gray-500 text-[10px] ml-1">of pool</span>
                      {totalPool > 0 && percent > 0 && (
                        <div className="text-[10px] text-gray-500 tabular-nums">
                          ≈ ₹{Math.round((totalPool * percent) / 100).toLocaleString('en-IN')}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-1 text-xs mt-1">
                <div className="flex justify-between py-1 border-b border-dark-600">
                  <span className="text-gray-400">Top Winners</span>
                  <span className="text-yellow-400 font-bold">{topWinners}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-dark-600">
                  <span className="text-gray-400">1 Ticket</span>
                  <span className="font-medium">₹{oneTicketRs}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-dark-600">
                  <span className="text-gray-400">Bidding until</span>
                  <span className="font-medium">{settings?.biddingEndTime || '23:29'} IST</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-gray-400">BTC Price</span>
                  {priceLocked && lockedPrice ? (
                    <span className="text-green-400 font-bold flex items-center gap-1"><Lock size={10} /> ${Number(lockedPrice).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  ) : (
                    <span className="text-yellow-400 text-[10px]">Not locked yet</span>
                  )}
                </div>
              </div>
              <p className="text-[10px] text-gray-500 mt-2 text-center">
                After bidding closes, BTC is locked and the top {topWinners} tickets are settled for prizes.
              </p>
            </div>

            <div className="bg-dark-800 rounded-xl p-3 border border-dark-600">
              <h3 className="font-bold text-xs mb-2 flex items-center gap-1.5">
                <Timer size={12} className="text-gray-400" />
                Your History
              </h3>
              {bidHistory.length === 0 ? (
                <p className="text-gray-500 text-[10px] text-center py-2">No bids yet</p>
              ) : (
                <div className="space-y-1 max-h-[160px] overflow-y-auto">
                  {bidHistory.map((bid, idx) => {
                    const btcAtBid = formatBtcBidPx(bid.predictedBtc);
                    const dist =
                      bid.distanceToReference != null && Number.isFinite(Number(bid.distanceToReference))
                        ? Number(bid.distanceToReference).toFixed(2)
                        : '—';
                    return (
                      <div key={bid._id || idx} className={`flex items-center justify-between p-2 rounded-lg text-xs ${
                        bid.status === 'won' ? 'bg-green-900/20' :
                        bid.status === 'lost' ? 'bg-red-900/20' :
                        'bg-dark-700'
                      }`}>
                        <div>
                          <div className="text-[10px] text-gray-500">{bid.betDate}</div>
                          <div className="text-[10px] text-gray-500 mt-0.5">Predicted BTC</div>
                          <div className="text-[12px] text-cyan-300 font-bold tabular-nums">
                            {btcAtBid || (
                              <span className="text-gray-500 font-medium text-[11px]">Not recorded</span>
                            )}
                          </div>
                          {bid.rank != null && (
                            <div className="text-[10px] text-gray-500 mt-1">Rank #{bid.rank}</div>
                          )}
                          <div className="text-[10px] text-gray-500 mt-0.5">Distance: <span className="text-cyan-400 font-medium">{dist}</span></div>
                        </div>
                        <div className="text-right">
                          {bid.status === 'pending' && <span className="text-yellow-400 font-medium">Pending</span>}
                          {bid.status === 'won' && <span className="text-green-400 font-bold">+{toTokens(bid.prize)} T</span>}
                          {bid.status === 'lost' && <span className="text-red-400 font-bold">-{toTokens(bid.amount)} T</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <GamesWalletGameLedgerPanel
              gameId={ledgerGameIdFromUi(game.id)}
              userToken={user?.token}
              tokenValue={oneTicketRs}
              title="Order history — BTC Jackpot"
              limit={500}
              enableDateFilter
              footerNote="Newest entries appear first. The Balance column is your games wallet after that line — read from the bottom upward to follow time order."
            />
          </div>

          {/* CENTER COLUMN - BTC live price */}
          <div className="flex-1 min-w-0 order-2 max-lg:order-3 flex flex-col min-h-0 max-lg:flex-none max-lg:max-h-[min(42vh,400px)] lg:flex-1">
            <GameLivePricePanel gameId="btcupdown" fullHeight />
          </div>

          {/* RIGHT COLUMN */}
          <div className="w-full max-w-full lg:w-[300px] flex-shrink-0 order-3 max-lg:order-2 flex flex-col lg:h-full lg:min-h-0 lg:overflow-hidden max-lg:overflow-visible pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="overflow-y-auto flex-1 space-y-2">
              <div className="bg-gradient-to-r from-purple-900/40 to-pink-900/40 border border-purple-500/30 rounded-xl p-3 text-center">
                <div className="text-[10px] text-purple-300 font-medium mb-1 flex items-center justify-center gap-1">
                  <Zap size={10} /> BANK
                </div>
                <div className="text-2xl font-bold text-purple-300 tabular-nums">
                  ₹{Number(totalPool || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-[10px] text-gray-400 mt-1">
                  {totalBids} bid{totalBids !== 1 ? 's' : ''} in the kitty
                </div>
              </div>

              <div className="bg-gradient-to-r from-cyan-900/40 to-blue-900/40 border border-cyan-500/30 rounded-xl p-3 text-center">
                <div className="text-[10px] text-cyan-300 font-medium mb-1 flex items-center justify-center gap-1">
                  <TrendingUp size={10} /> BTC SPOT
                </div>
                <div className="text-2xl font-bold text-cyan-300 tabular-nums">
                  {(leaderboardSpot != null && Number.isFinite(Number(leaderboardSpot)))
                    ? `$${leaderboardSpot.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : 'Loading...'}
                </div>
                <div className="text-[10px] text-gray-400 mt-1">
                  {priceLocked ? 'Locked result' : 'Live price'}
                </div>
              </div>

              {showBtcJackpotClientTestBiddingHint && (
                <div className="bg-emerald-900/20 border border-emerald-500/35 rounded-lg px-2.5 py-2 text-[10px] text-emerald-200/95 leading-snug">
                  <span className="font-semibold text-emerald-300">Test mode</span>
                  — <span className="font-mono text-emerald-400/90">VITE_BTC_JACKPOT_TEST_BIDDING</span> is on; bidding hours are
                  skipped in this UI. Server uses{' '}
                  <span className="font-mono text-emerald-400/90">BTC_JACKPOT_ALLOW_TEST_BIDDING</span> the same way.
                </div>
              )}

              {!biddingWindow.ok && (
                <div className="bg-red-900/25 border border-red-500/40 rounded-lg px-2.5 py-2 text-[10px] text-red-200 leading-snug">
                  {btcJackpotBiddingMessageClient(settings, biddingWindow.reason)}
                </div>
              )}

              <div className="bg-dark-800 rounded-xl p-3 border border-yellow-500/30">
                <h3 className="font-bold text-xs mb-2 flex items-center gap-1.5 text-yellow-400">
                  <Crown size={14} />
                  LIVE TOP 5
                </h3>
                <p className="text-[9px] text-gray-500 mb-2">
                  Nearest to BTC spot first · tie → earlier time
                  {leaderboardSpot != null && Number.isFinite(Number(leaderboardSpot)) ? (
                    <span className="text-cyan-500/90">
                      {' '}· spot ${Number(leaderboardSpot).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    </span>
                  ) : null}
                </p>
                <p className="text-[9px] text-gray-500 mb-2 leading-snug">
                  Right column: <span className="text-gray-400">Stake</span> = ticket cost (usually 1 ticket).{' '}
                  <span className="text-emerald-300/90">Est. gross</span> = that row&apos;s rank % × pool (same as settlement).
                </p>
                <p className="text-[9px] text-cyan-500/80 mb-2 leading-snug">
                  Order updates with the chart LTP (nearest spot) — no refresh needed.
                </p>
                {leaderboard.slice(0, 5).length === 0 ? (
                  <p className="text-gray-500 text-[10px] text-center py-3">No bids yet today</p>
                ) : (
                  <div className="space-y-1">
                    {leaderboard.slice(0, 5).map((entry, idx) => {
                      const isMe = !!entry.isOwnBid;
                      const bidTime = entry.bidTime ? new Date(entry.bidTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--';
                      const estGross = Number(entry.projectedPrize) || 0;
                      return (
                        <div
                          key={String(entry.bidId ?? idx)}
                          className={`flex items-center justify-between p-2 rounded-lg text-xs transition-all duration-300 ease-out ${
                            isMe ? 'bg-yellow-900/30 border border-yellow-500/20' :
                            idx < 3 ? 'bg-dark-700/80' : 'bg-dark-700/40'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                              idx === 0 ? 'bg-yellow-500 text-black' :
                              idx === 1 ? 'bg-gray-300 text-black' :
                              idx === 2 ? 'bg-orange-600 text-white' :
                              'bg-dark-600 text-gray-400'
                            }`}>
                              {idx + 1}
                            </div>
                            <div>
                              <div className={`font-medium ${isMe ? 'text-yellow-400' : 'text-white'}`}>
                                {isMe ? 'You' : entry.name}
                              </div>
                              <div className="text-[10px] text-gray-500 flex items-center gap-1.5 flex-wrap">
                                <span className="text-cyan-300 font-semibold tabular-nums">{btcAtBidDisplay(entry.niftyPriceAtBid)}</span>
                                <span className="text-gray-600">|</span>
                                <span className="text-cyan-400/90">{bidTime}</span>
                              </div>
                              <div className="text-[9px] text-gray-600 mt-0.5">Predicted BTC</div>
                            </div>
                          </div>
                          <div className="text-right shrink-0 pl-1">
                            <div
                              className="text-yellow-300 font-bold text-[11px] tabular-nums"
                              title="Amount staked on this ticket (not the prize)"
                            >
                              ₹{Number(entry.amount ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                            <div className="text-[9px] text-gray-500">Stake</div>
                            {estGross > 0 && (
                              <>
                                <div className="text-emerald-300/95 font-bold text-[11px] tabular-nums mt-1">
                                  ≈ ₹{estGross.toLocaleString('en-IN')}
                                </div>
                                <div className="text-[9px] text-emerald-500/80">Est. gross</div>
                              </>
                            )}
                            {estGross === 0 && (
                              <div className="text-[9px] text-gray-600 mt-1">Outside top {topWinners}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {message && (
                <div className={`p-2 rounded-lg text-xs font-medium ${message.type === 'success' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
                  {message.text}
                </div>
              )}

              <div className="space-y-3">
                {ticketsToday > 0 && todayBid && (
                  <div className="rounded-xl p-3 border border-yellow-500/30 bg-yellow-900/15 text-center text-xs">
                    <div className="text-gray-400 mb-1">Your tickets today</div>
                    <div className="text-lg font-bold text-yellow-400">{ticketsToday}</div>
                    <div className="text-[10px] text-gray-500 mt-1">
                      Staked ₹{Number(totalStakedToday || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      {myRank != null && (
                        <span className="text-cyan-400/90"> · Best rank #{myRank}</span>
                      )}
                    </div>
                  </div>
                )}

                {ticketsToday > 0 && todayBid && (
                  <div className={`rounded-xl p-4 border ${
                    todayBid.status === 'won' ? 'bg-green-900/20 border-green-500/30' :
                    todayBid.status === 'lost' ? 'bg-red-900/20 border-red-500/30' :
                    'bg-yellow-900/20 border-yellow-500/30'
                  }`}>
                    <div className="text-center">
                      <div className="text-gray-400 text-xs mb-1">Latest entry</div>
                      {formatBtcBidPx(todayBid.predictedBtc) && (
                        <div className="text-cyan-400 text-sm font-semibold mb-1">
                          Predicted {formatBtcBidPx(todayBid.predictedBtc)}
                        </div>
                      )}
                      {myRank != null && (
                        <div className={`text-sm font-bold ${myRank <= topWinners ? 'text-green-400' : 'text-red-400'}`}>
                          Best rank #{myRank}{myRank <= topWinners ? ' 🏆' : ''}
                        </div>
                      )}
                      {todayBid.status === 'pending' && (
                        <div className="text-yellow-400 text-[10px] font-medium mt-2">
                          Settlement after bidding closes ({settings?.biddingEndTime || '23:29'} IST)
                        </div>
                      )}
                      {todayBid.status === 'pending' && todayBids.filter((b) => b.status === 'pending').length > 0 && (
                        <div className="mt-3 space-y-2 text-left border-t border-yellow-500/20 pt-3">
                          <div className="text-[10px] text-gray-500 text-center">Edit predicted BTC per ticket (no cancel)</div>
                          {todayBids
                            .filter((b) => b.status === 'pending')
                            .map((b) => {
                              const bidKey = String(b._id);
                              return (
                                <div key={b._id} className="space-y-1">
                                  <div className="text-[9px] text-gray-500">
                                    {b.placedAtIst ||
                                      (b.createdAt
                                        ? new Date(b.createdAt).toLocaleTimeString('en-IN', {
                                            hour: '2-digit',
                                            minute: '2-digit',
                                            second: '2-digit',
                                          })
                                        : 'Ticket')}
                                  </div>
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    step="0.01"
                                    min="1"
                                    max="10000000"
                                    placeholder="Predicted BTC (USD)"
                                    value={predictionDrafts[bidKey] ?? ''}
                                    onChange={(e) =>
                                      setPredictionDrafts((p) => ({ ...p, [bidKey]: e.target.value }))
                                    }
                                    disabled={!biddingWindow.ok}
                                    className="w-full px-2 py-1.5 rounded-lg bg-dark-700 border border-dark-600 text-cyan-200 text-xs tabular-nums placeholder:text-gray-600 focus:border-cyan-500/50 focus:outline-none disabled:opacity-50"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleUpdatePredictionBid(b._id)}
                                    disabled={modifyingBidId === b._id || !biddingWindow.ok}
                                    className="w-full py-1.5 px-2 rounded-lg bg-dark-700 hover:bg-dark-600 border border-cyan-500/30 text-[10px] text-cyan-300 font-medium disabled:opacity-50"
                                  >
                                    {modifyingBidId === b._id ? 'Saving…' : 'Save prediction'}
                                  </button>
                                </div>
                              );
                            })}
                        </div>
                      )}
                      {todayBid.status === 'won' && todayBid.prize > 0 && (
                        <div className="text-green-400 text-sm font-bold mt-1">Won {toTokens(todayBid.prize)} T</div>
                      )}
                      {todayBid.status === 'lost' && (
                        <div className="text-red-400 text-xs mt-1">This entry did not place in the prize ranks.</div>
                      )}
                    </div>
                  </div>
                )}

                {priceLocked && lockedPrice && (
                  <div className="bg-green-900/20 border border-green-500/30 rounded-xl p-3 text-center">
                    <div className="text-[10px] text-green-400 flex items-center justify-center gap-1 mb-1">
                      <Lock size={10} /> BTC Price Locked
                    </div>
                    <div className="text-xl font-bold text-green-400">${Number(lockedPrice).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                    {lockedAt && (
                      <div className="text-[10px] text-gray-500 mt-1">
                        Locked at {new Date(lockedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} IST
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-2 space-y-2 flex-shrink-0">
              <div className="bg-dark-800 rounded-xl p-3 border border-dark-600 text-center space-y-2">
                <div className="text-[10px] text-gray-400 font-medium">Each purchase · 1 ticket · ₹{oneTicketRs.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
                <div className="text-left">
                  <label htmlFor="btc-jackpot-predicted" className="block text-[10px] text-gray-500 mb-1 font-medium">
                    Predicted BTC price (USD)
                  </label>
                  <input
                    id="btc-jackpot-predicted"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="1"
                    max="10000000"
                    placeholder="e.g. 92850.50"
                    value={predictedPriceInput}
                    onChange={(e) => setPredictedPriceInput(e.target.value)}
                    disabled={!biddingWindow.ok}
                    className="w-full px-3 py-2 rounded-xl bg-dark-700 border border-dark-600 text-cyan-200 text-sm tabular-nums placeholder:text-gray-600 focus:border-yellow-500/40 focus:outline-none disabled:opacity-50"
                  />
                </div>
              </div>

              <button
                onClick={handlePlaceBid}
                disabled={placing || oneTicketRs > balance || !gameEnabled || !biddingWindow.ok}
                className={`w-full py-3 rounded-xl font-bold text-sm transition-all ${
                  !placing && oneTicketRs <= balance && gameEnabled && biddingWindow.ok
                    ? 'bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-black'
                    : 'bg-dark-700 text-gray-500 cursor-not-allowed'
                }`}
              >
                {placing ? (
                  <span className="flex items-center justify-center gap-2">
                    <RefreshCw size={16} className="animate-spin" /> Placing...
                  </span>
                ) : oneTicketRs > balance ? (
                  'Insufficient balance'
                ) : !gameEnabled ? (
                  'Game disabled'
                ) : !biddingWindow.ok ? (
                  'Bidding closed'
                ) : (
                  `Add 1 ticket (₹${oneTicketRs.toLocaleString('en-IN')})`
                )}
              </button>

              <div className="bg-dark-800/50 rounded-lg p-2 text-[10px] text-gray-500 text-center">
                <Zap size={10} className="inline mr-1 text-yellow-400" />
                Ranking uses your predicted BTC level vs live spot (then vs locked close). Tap again for another ticket (up to daily limit).
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default UserGames;
