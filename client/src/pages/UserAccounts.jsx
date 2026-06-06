import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AUTO_REFRESH_EVENT } from '../lib/autoRefresh';
import {
  Wallet, Plus, Minus, RefreshCw, IndianRupee, MoreHorizontal, X, ArrowRight,   ArrowLeftRight, Gem, Gamepad2,
  Send,
  History,
  Bitcoin,
  ClipboardList,
  Landmark,
  ChevronDown,
  ChevronUp,
  Lock,
} from 'lucide-react';
import {
  walletCardBlockedClass,
  walletActionsDisabledClass,
  WALLET_DISABLED_ALERT,
} from '../lib/walletProfitBlock.js';
import { GAMES_LEDGER_FILTER_OPTIONS } from '../components/games/GamesWalletGameLedgerPanel.jsx';
import { formatGamesLedgerWhen } from '../lib/gamesLedgerWhen.js';
import { fmtTransferInr, validateTransferAmount } from '../lib/walletTransferLimits.js';
import { getTradeQtyLotsDisplay } from '../utils/tradeQtyLotsDisplay.js';
import { resolveMainWalletBalance } from '../utils/resolveMainWalletBalance.js';
import {
  sanitizeWalletDisplayInr,
  MAX_SANE_WALLET_DISPLAY_INR,
} from '../utils/walletDisplaySanity.js';
import PeerTransferModal from '../components/PeerTransferModal.jsx';

function WalletBlockedBanner() {
  return (
    <div className="absolute top-3 right-12 z-10 flex items-center gap-1 px-2 py-0.5 rounded bg-red-950/90 border border-red-800/70 text-[10px] font-semibold text-red-300 uppercase tracking-wide">
      <Lock size={10} />
      Blocked
    </div>
  );
}

/** MCX-only wallet row (commodity), excluding crypto/forex. */
function isMcxWalletTrade(row) {
  if (!row || row.isCrypto || row.isForex) return false;
  if (row.exchange === 'MCX') return true;
  const s = row.segment;
  return s === 'MCX' || s === 'MCXFUT' || s === 'MCXOPT' || s === 'COMMODITY';
}

const UserAccounts = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [walletData, setWalletData] = useState(null);
  /** Authoritative NSE/BSE balance (direct DB read — not overwritten by /api/user/wallet). */
  const [nseBseWalletSnapshot, setNseBseWalletSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferDirection, setTransferDirection] = useState('toAccount'); // 'toAccount' or 'toWallet'
  const [showMcxTransferModal, setShowMcxTransferModal] = useState(false);
  const [mcxTransferDirection, setMcxTransferDirection] = useState('toMcx'); // 'toMcx' or 'fromMcx'
  const [showGamesTransferModal, setShowGamesTransferModal] = useState(false);
  const [gamesTransferDirection, setGamesTransferDirection] = useState('toGames'); // 'toGames' or 'fromGames'
  const [showCryptoTransferModal, setShowCryptoTransferModal] = useState(false);
  const [cryptoTransferDirection, setCryptoTransferDirection] = useState('toCrypto'); // 'toCrypto' | 'fromCrypto'
  const [showForexTransferModal, setShowForexTransferModal] = useState(false);
  const [forexTransferDirection, setForexTransferDirection] = useState('toForex'); // 'toForex' | 'fromForex'
  const [showGamesLedger, setShowGamesLedger] = useState(false);
  const [gamesLedger, setGamesLedger] = useState([]);
  const [gamesLedgerLoading, setGamesLedgerLoading] = useState(false);
  const [gamesLedgerGameFilter, setGamesLedgerGameFilter] = useState('');
  const [showMcxOrders, setShowMcxOrders] = useState(false);
  const [mcxOrders, setMcxOrders] = useState([]);
  const [mcxOrdersLoading, setMcxOrdersLoading] = useState(false);

  const [showCryptoTransferLedger, setShowCryptoTransferLedger] = useState(false);
  const [cryptoTransferLedger, setCryptoTransferLedger] = useState([]);
  const [cryptoTransferLedgerLoading, setCryptoTransferLedgerLoading] = useState(false);
  const [showForexTransferLedger, setShowForexTransferLedger] = useState(false);
  const [forexTransferLedger, setForexTransferLedger] = useState([]);
  const [forexTransferLedgerLoading, setForexTransferLedgerLoading] = useState(false);
  const [showTradingTransferLedger, setShowTradingTransferLedger] = useState(false);
  const [tradingTransferLedger, setTradingTransferLedger] = useState([]);
  const [tradingTransferLedgerLoading, setTradingTransferLedgerLoading] = useState(false);
  const [showTradingWalletLedger, setShowTradingWalletLedger] = useState(false);
  const [tradingWalletLedger, setTradingWalletLedger] = useState([]);
  const [tradingWalletLedgerLoading, setTradingWalletLedgerLoading] = useState(false);
  const [showMcxTransferLedger, setShowMcxTransferLedger] = useState(false);
  const [mcxTransferLedger, setMcxTransferLedger] = useState([]);
  const [mcxTransferLedgerLoading, setMcxTransferLedgerLoading] = useState(false);
  const [showGamesTransferLedger, setShowGamesTransferLedger] = useState(false);
  const [gamesTransferLedger, setGamesTransferLedger] = useState([]);
  const [gamesTransferLedgerLoading, setGamesTransferLedgerLoading] = useState(false);

  // Wallet transfer dropdown state
  const [showWalletTransferDropdown, setShowWalletTransferDropdown] = useState(null); // null, 'trading', 'mcx', 'games', 'crypto', 'forex'
  const [showWalletTransferModal, setShowWalletTransferModal] = useState(false);
  const [walletTransferSource, setWalletTransferSource] = useState('');
  const [walletTransferTarget, setWalletTransferTarget] = useState('');
  const [showPeerTransferModal, setShowPeerTransferModal] = useState(false);
  const [showPeerTransferHistory, setShowPeerTransferHistory] = useState(false);
  const [peerTransferHistory, setPeerTransferHistory] = useState([]);
  const [peerTransferHistoryLoading, setPeerTransferHistoryLoading] = useState(false);

  const fetchNseBseWallet = useCallback(async () => {
    if (!user?.token) return;
    try {
      const { data } = await axios.get('/api/user/funds/nse-bse-wallet', {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      setNseBseWalletSnapshot(data);
    } catch (error) {
      console.error('Error fetching NSE/BSE wallet:', error);
    }
  }, [user?.token]);

  const patchWalletFromTransfer = useCallback((data) => {
    if (!data) return;
    const nseBal = data.nseBseBalance ?? data.nseBseWallet?.balance;
    const mainBal = data.mainWalletBalance ?? data.cashBalance;
    if (nseBal != null) {
      const um = data.nseBseWallet?.usedMargin ?? 0;
      setNseBseWalletSnapshot((prev) => ({
        ...(prev || {}),
        balance: nseBal,
        usedMargin: um,
        availableBalance: Math.max(0, nseBal - um),
        transferableBalance: Math.max(0, nseBal - um),
        mainBalance: mainBal ?? prev?.mainBalance,
      }));
    }
    if (mainBal == null) return;
    setWalletData((prev) => ({
      ...prev,
      cashBalance: mainBal,
      wallet: {
        ...(prev?.wallet || {}),
        cashBalance: mainBal,
        balance: mainBal,
      },
    }));
  }, []);

  const fetchWallet = useCallback(async () => {
    if (!user?.token) return;
    try {
      const { data } = await axios.get('/api/user/wallet', {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      setWalletData(data);
    } catch (error) {
      console.error('Error fetching wallet:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchWallet();
    fetchNseBseWallet();
  }, [fetchWallet, fetchNseBseWallet]);

  useEffect(() => {
    const onSoftRefresh = () => {
      fetchWallet();
      fetchNseBseWallet();
    };
    window.addEventListener(AUTO_REFRESH_EVENT, onSoftRefresh);
    return () => window.removeEventListener(AUTO_REFRESH_EVENT, onSoftRefresh);
  }, [fetchWallet, fetchNseBseWallet]);

  const nseBseProfitBlocked =
    !!walletData?.walletBlocks?.nseBse ||
    !!walletData?.nseBseWallet?.profitBlocked ||
    !!nseBseWalletSnapshot?.profitBlocked;
  const mcxProfitBlocked =
    !!walletData?.walletBlocks?.mcx || !!walletData?.mcxWallet?.profitBlocked;
  const gamesProfitBlocked =
    !!walletData?.walletBlocks?.games || !!walletData?.gamesWallet?.profitBlocked;
  const cryptoProfitBlocked =
    !!walletData?.walletBlocks?.crypto || !!walletData?.cryptoWallet?.profitBlocked;
  const forexProfitBlocked =
    !!walletData?.walletBlocks?.forex || !!walletData?.forexWallet?.profitBlocked;

  const opestockexRoom = () => {
    if (nseBseProfitBlocked) {
      alert(WALLET_DISABLED_ALERT);
      return;
    }
    navigate('/user/trader-room');
  };

  const openTransfer = (direction) => {
    if (nseBseProfitBlocked) {
      alert(WALLET_DISABLED_ALERT);
      return;
    }
    setTransferDirection(direction);
    setShowTransferModal(true);
  };

  const fetchPeerTransferHistory = useCallback(async () => {
    if (!user?.token) return;
    setPeerTransferHistoryLoading(true);
    try {
      const { data } = await axios.get('/api/user/peer-transfer/history', {
        params: { limit: 50 },
        headers: { Authorization: `Bearer ${user.token}` },
      });
      setPeerTransferHistory(Array.isArray(data.history) ? data.history : []);
    } catch (e) {
      console.error('Peer transfer history:', e);
      setPeerTransferHistory([]);
    } finally {
      setPeerTransferHistoryLoading(false);
    }
  }, [user?.token]);

  // Main wallet balance (for deposit/withdraw with admin)
  // API returns data at top level and also in wallet object
  const mainWalletBalance = resolveMainWalletBalance(walletData, nseBseWalletSnapshot);
  const nseBseBalance = sanitizeWalletDisplayInr(nseBseWalletSnapshot?.balance ?? 0);
  const nseBseBalanceCorrupted =
    Number(nseBseWalletSnapshot?.balance) > MAX_SANE_WALLET_DISPLAY_INR ||
    !!nseBseWalletSnapshot?.balanceRepaired;
  const usedMargin = nseBseWalletSnapshot?.usedMargin ?? 0;
  const availableNseBseBalance = nseBseBalance - usedMargin;
  

  // MCX wallet balance (INR for MCX trading)
  const mcxBalance = walletData?.mcxWallet?.balance || 0;
  const mcxUsedMargin = walletData?.mcxWallet?.usedMargin || 0;
  const mcxAvailableBalance = mcxBalance - mcxUsedMargin;
  const mcxRealizedPnL = walletData?.mcxWallet?.realizedPnL || 0;

  // Games wallet balance (INR for games/fantasy trading)
  const gamesBalance = walletData?.gamesWallet?.balance || 0;
  const gamesUsedMargin = walletData?.gamesWallet?.usedMargin || 0;
  const gamesAvailableBalance = gamesBalance - gamesUsedMargin;
  const gamesRealizedPnL = walletData?.gamesWallet?.realizedPnL || 0;
  const gamesTicketValue = walletData?.gamesTicketValue || 300;

  // Crypto wallet: INR notional for spot (quotes from Binance are USDT; server converts at trade time)
  const cryptoBalance = walletData?.cryptoWallet?.balance || 0;
  const cryptoRealizedPnL = walletData?.cryptoWallet?.realizedPnL || 0;

  const forexBalance = walletData?.forexWallet?.balance || 0;
  const forexRealizedPnL = walletData?.forexWallet?.realizedPnL || 0;

  const formatGamesLedgerTickets = (row) => {
    const gid = row.gameId || '';
    if (gid === 'transfer_in' || gid === 'transfer_out') return '—';
    const tv =
      row.meta && Number(row.meta.tokenValue) > 0 ? Number(row.meta.tokenValue) : gamesTicketValue;
    if (row.meta != null && row.meta.tickets != null && Number.isFinite(Number(row.meta.tickets))) {
      return `${Number(row.meta.tickets).toLocaleString('en-IN', { maximumFractionDigits: 2 })} T`;
    }
    if (row.entryType === 'debit' && row.amount != null && tv > 0) {
      const t = parseFloat((Number(row.amount) / tv).toFixed(2));
      return `${t.toLocaleString('en-IN', { maximumFractionDigits: 2 })} T`;
    }
    if (row.entryType === 'credit' && row.meta?.stake != null && tv > 0) {
      const t = parseFloat((Number(row.meta.stake) / tv).toFixed(2));
      return `${t.toLocaleString('en-IN', { maximumFractionDigits: 2 })} T`;
    }
    return '—';
  };

  const openMcxTransfer = (direction) => {
    if (mcxProfitBlocked) {
      alert(WALLET_DISABLED_ALERT);
      return;
    }
    setMcxTransferDirection(direction);
    setShowMcxTransferModal(true);
  };

  const openMcxTrading = () => {
    if (mcxProfitBlocked) {
      alert(WALLET_DISABLED_ALERT);
      return;
    }
    navigate('/user/trader-room?mode=mcx');
  };

  const openMcxOrdersPage = () => {
    navigate('/user/orders?mode=mcx');
  };

  const openTradingOrdersPage = () => {
    navigate('/user/orders');
  };

  const fetchMcxOrders = useCallback(async () => {
    if (!user?.token) return;
    setMcxOrdersLoading(true);
    try {
      const { data } = await axios.get('/api/trading/orders', {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      const list = Array.isArray(data) ? data : [];
      const mcx = list.filter(isMcxWalletTrade);
      mcx.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      setMcxOrders(mcx);
    } catch (error) {
      console.error('Error fetching MCX orders:', error);
      setMcxOrders([]);
    } finally {
      setMcxOrdersLoading(false);
    }
  }, [user?.token]);

  const toggleMcxOrders = () => {
    if (mcxProfitBlocked) {
      alert(WALLET_DISABLED_ALERT);
      return;
    }
    setShowMcxOrders((prev) => !prev);
  };

  const formatIstLedgerTime = (iso) => {
    if (!iso) return '—';
    try {
      const d = typeof iso === 'string' ? new Date(iso) : new Date(iso);
      if (Number.isNaN(d.getTime())) return '—';
      return d.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata',
      });
    } catch {
      return '—';
    }
  };

  const isSubwalletTradeLedgerRow = (row) =>
    row?.kind === 'trade_pnl' || row?.kind === 'trade_brokerage' || row?.kind === 'trade_autosquare';

  const subwalletTradeLedgerTextClass = (row) => {
    if (row?.kind === 'trade_brokerage') return 'text-red-300';
    if (row?.kind === 'trade_autosquare') return 'text-purple-300';
    if (row?.isAutoSquare) return 'text-orange-400';
    return 'text-cyan-300';
  };

  const sumBrokerageFromLedger = (entries) =>
    (entries || [])
      .filter((r) => r.kind === 'trade_brokerage' && Number(r.amount) > 0)
      .reduce((sum, r) => sum + Number(r.amount || 0), 0);

  const fetchCryptoTransferLedger = useCallback(async () => {
    if (!user?.token) return;
    setCryptoTransferLedgerLoading(true);
    try {
      if ((Number(cryptoBalance) || 0) < 1 && (Number(walletData?.cryptoWallet?.usedMargin) || 0) < 1) {
        try {
          await axios.post('/api/user/funds/repair-crypto-wallet', null, {
            headers: { Authorization: `Bearer ${user.token}` },
          });
          await fetchWallet();
        } catch {
          /* repair is best-effort */
        }
      }
      const { data } = await axios.get('/api/user/funds/subwallet-transfer-ledger', {
        params: { wallet: 'crypto', limit: 50 },
        headers: { Authorization: `Bearer ${user.token}` },
      });
      setCryptoTransferLedger(Array.isArray(data?.entries) ? data.entries : []);
    } catch (e) {
      console.error('Crypto transfer ledger:', e);
      setCryptoTransferLedger([]);
    } finally {
      setCryptoTransferLedgerLoading(false);
    }
  }, [user?.token, cryptoBalance, walletData?.cryptoWallet?.usedMargin, fetchWallet]);

  const fetchForexTransferLedger = useCallback(async () => {
    if (!user?.token) return;
    setForexTransferLedgerLoading(true);
    try {
      const { data } = await axios.get('/api/user/funds/subwallet-transfer-ledger', {
        params: { wallet: 'forex', limit: 50 },
        headers: { Authorization: `Bearer ${user.token}` },
      });
      setForexTransferLedger(Array.isArray(data?.entries) ? data.entries : []);
    } catch (e) {
      console.error('Forex transfer ledger:', e);
      setForexTransferLedger([]);
    } finally {
      setForexTransferLedgerLoading(false);
    }
  }, [user?.token]);

  const fetchTradingTransferLedger = useCallback(async () => {
    if (!user?.token) return;
    setTradingTransferLedgerLoading(true);
    try {
      const { data } = await axios.get('/api/user/funds/subwallet-transfer-ledger', {
        params: { wallet: 'trading', limit: 50 },
        headers: { Authorization: `Bearer ${user.token}` },
      });
      setTradingTransferLedger(Array.isArray(data?.entries) ? data.entries : []);
    } catch (e) {
      console.error('Trading transfer ledger:', e);
      setTradingTransferLedger([]);
    } finally {
      setTradingTransferLedgerLoading(false);
    }
  }, [user?.token]);

  const mapTradingSubwalletEntry = (row) => {
    if (row.kind === 'trade_brokerage') {
      const leg = row.leg || 'OPEN+CLOSE';
      return {
        _id: row.id,
        createdAt: row.at,
        reason: 'BROKERAGE',
        meta: { leg },
        description: row.description,
        type: 'DEBIT',
        amount: row.amount,
      };
    }
    if (row.kind === 'trade_pnl' || row.kind === 'trade_autosquare') {
      return {
        _id: row.id,
        createdAt: row.at,
        reason: 'TRADE_PNL',
        description: row.description,
        type: row.type || 'CREDIT',
        amount: row.amount,
        isAutoSquare: row.isAutoSquare || row.kind === 'trade_autosquare',
      };
    }
    if (row.kind === 'wallet_transfer') {
      return {
        _id: row.id,
        createdAt: row.at,
        reason: row.reason || 'WALLET_TRANSFER',
        description: row.description,
        type: row.type,
        amount: row.amount,
      };
    }
    if (row.kind === 'between_wallets') {
      return {
        _id: row.id,
        createdAt: row.at,
        reason: 'WALLET_TRANSFER',
        description: row.description || `${row.sourceLabel} → ${row.targetLabel}`,
        type: 'DEBIT',
        amount: row.amount,
      };
    }
    return null;
  };

  const fetchTradingWalletLedger = useCallback(async () => {
    if (!user?.token) return;
    setTradingWalletLedgerLoading(true);
    try {
      const { data } = await axios.get('/api/user/funds/subwallet-transfer-ledger', {
        params: { wallet: 'trading', limit: 50 },
        headers: { Authorization: `Bearer ${user.token}` },
      });
      const entries = Array.isArray(data?.entries) ? data.entries : [];
      setTradingWalletLedger(entries.map(mapTradingSubwalletEntry).filter(Boolean));
      await fetchNseBseWallet();
    } catch (e) {
      console.error('Trading wallet ledger:', e);
      setTradingWalletLedger([]);
    } finally {
      setTradingWalletLedgerLoading(false);
    }
  }, [user?.token, fetchNseBseWallet]);

  const fetchMcxTransferLedger = useCallback(async () => {
    if (!user?.token) return;
    setMcxTransferLedgerLoading(true);
    try {
      const { data } = await axios.get('/api/user/funds/subwallet-transfer-ledger', {
        params: { wallet: 'mcx', limit: 50 },
        headers: { Authorization: `Bearer ${user.token}` },
      });
      const entries = Array.isArray(data?.entries) ? data.entries : [];
      setMcxTransferLedger(
        entries.filter((row) => {
          const d = String(row.description || '');
          if (/\(NSE\/BSE\)/i.test(d)) return false;
          if (/\(Crypto\)/i.test(d) || /\(Forex\)/i.test(d) || /\(Games\)/i.test(d)) return false;
          if (row.kind === 'between_wallets') return true;
          return /\(MCX\)/i.test(d);
        })
      );
    } catch (e) {
      console.error('MCX transfer ledger:', e);
      setMcxTransferLedger([]);
    } finally {
      setMcxTransferLedgerLoading(false);
    }
  }, [user?.token]);

  const fetchGamesTransferLedger = useCallback(async () => {
    if (!user?.token) return;
    setGamesTransferLedgerLoading(true);
    try {
      const { data } = await axios.get('/api/user/funds/subwallet-transfer-ledger', {
        params: { wallet: 'games', limit: 50 },
        headers: { Authorization: `Bearer ${user.token}` },
      });
      setGamesTransferLedger(Array.isArray(data?.entries) ? data.entries : []);
    } catch (e) {
      console.error('Games transfer ledger:', e);
      setGamesTransferLedger([]);
    } finally {
      setGamesTransferLedgerLoading(false);
    }
  }, [user?.token]);

  const openGamesTransfer = (direction) => {
    if (gamesProfitBlocked) {
      alert(WALLET_DISABLED_ALERT);
      return;
    }
    setGamesTransferDirection(direction);
    setShowGamesTransferModal(true);
  };

  const openGamesTrading = () => {
    if (gamesProfitBlocked) {
      alert(WALLET_DISABLED_ALERT);
      return;
    }
    navigate('/user/games');
  };

  const openCryptoTrading = () => {
    if (cryptoProfitBlocked) {
      alert(WALLET_DISABLED_ALERT);
      return;
    }
    navigate('/user/trader-room?mode=crypto');
  };

  const openCryptoOrders = () => {
    if (cryptoProfitBlocked) {
      alert(WALLET_DISABLED_ALERT);
      return;
    }
    navigate('/user/orders?mode=crypto');
  };

  const openCryptoTransfer = (direction) => {
    if (cryptoProfitBlocked) {
      alert(WALLET_DISABLED_ALERT);
      return;
    }
    setCryptoTransferDirection(direction);
    setShowCryptoTransferModal(true);
  };

  const openForexTrading = () => {
    if (forexProfitBlocked) {
      alert(WALLET_DISABLED_ALERT);
      return;
    }
    navigate('/user/trader-room?mode=forex');
  };

  const openForexOrders = () => {
    if (forexProfitBlocked) {
      alert(WALLET_DISABLED_ALERT);
      return;
    }
    navigate('/user/orders?mode=forex');
  };

  const openForexTransfer = (direction) => {
    if (forexProfitBlocked) {
      alert(WALLET_DISABLED_ALERT);
      return;
    }
    setForexTransferDirection(direction);
    setShowForexTransferModal(true);
  };

  const fetchGamesLedger = useCallback(async () => {
    if (!user?.token) return;
    setGamesLedgerLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (gamesLedgerGameFilter) params.set('gameId', gamesLedgerGameFilter);
      const { data } = await axios.get(`/api/user/games-wallet/ledger?${params.toString()}`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      setGamesLedger(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching games ledger:', error);
      setGamesLedger([]);
    } finally {
      setGamesLedgerLoading(false);
    }
  }, [user?.token, gamesLedgerGameFilter]);

  const toggleGamesLedger = () => {
    if (gamesProfitBlocked) {
      alert(WALLET_DISABLED_ALERT);
      return;
    }
    setShowGamesLedger((prev) => !prev);
  };

  useEffect(() => {
    if (nseBseProfitBlocked) {
      setShowTradingWalletLedger(false);
      setShowTradingTransferLedger(false);
    }
  }, [nseBseProfitBlocked]);

  useEffect(() => {
    if (mcxProfitBlocked) {
      setShowMcxOrders(false);
      setShowMcxTransferLedger(false);
    }
  }, [mcxProfitBlocked]);

  useEffect(() => {
    if (gamesProfitBlocked) {
      setShowGamesLedger(false);
      setShowGamesTransferLedger(false);
    }
  }, [gamesProfitBlocked]);

  useEffect(() => {
    if (cryptoProfitBlocked) {
      setShowCryptoTransferLedger(false);
    }
  }, [cryptoProfitBlocked]);

  useEffect(() => {
    if (forexProfitBlocked) {
      setShowForexTransferLedger(false);
    }
  }, [forexProfitBlocked]);

  useEffect(() => {
    if (showGamesLedger) fetchGamesLedger();
  }, [gamesLedgerGameFilter, showGamesLedger, fetchGamesLedger]);

  useEffect(() => {
    if (showMcxOrders) {
      fetchMcxOrders();
      if (showMcxTransferLedger) fetchMcxTransferLedger();
    }
  }, [showMcxOrders, fetchMcxOrders, showMcxTransferLedger, fetchMcxTransferLedger]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="animate-spin text-green-400" size={32} />
      </div>
    );
  }

  
  return (
    <div className="p-4 md:p-6 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">My Accounts</h1>
          <button
            onClick={() => {
              fetchWallet();
              fetchNseBseWallet();
            }}
            className="text-gray-400 hover:text-white"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {/* Account Cards: row 1 = Standard / MCX / Games; row 2 = Crypto + Forex */}
      <div className="flex flex-col gap-4 sm:gap-6">
        <div className="grid grid-cols-1 min-[520px]:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* NSE & BSE Wallet */}
        <div className={`bg-dark-800 rounded-xl overflow-hidden relative ${walletCardBlockedClass(nseBseProfitBlocked)}`}>
          {nseBseProfitBlocked && <WalletBlockedBanner />}
          {/* Account Header */}
          <div className="p-4 border-b border-dark-600">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-dark-700 rounded-lg flex items-center justify-center">
                  <Wallet size={20} className="text-gray-400" />
                </div>
                <div>
                  <div className="font-semibold">IND-{user?.userId?.slice(-5) || '00000'}</div>
                  <div className="text-xs text-gray-500">STANDARD</div>
                </div>
              </div>
              <button className="text-gray-400 hover:text-white">
                <MoreHorizontal size={20} />
              </button>
            </div>
          </div>

          {/* Account Body */}
          <div className="p-6 bg-gradient-to-br from-dark-900 to-dark-800">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2 h-2 bg-green-400 rounded-full"></span>
              <span className="text-sm text-green-400">For NSE, BSE</span>
            </div>
            
            <div className="text-4xl font-bold mb-1">
              ₹{nseBseBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            {nseBseBalanceCorrupted && (
              <p className="text-xs text-amber-400 mt-1">
                Balance was corrupted by a bad autosquare — refreshed from ledger. Tap refresh if it still looks wrong.
              </p>
            )}
            <div className="text-sm text-gray-500">NSE & BSE only</div>
            {usedMargin > 0 && (
              <div className="text-xs text-yellow-400 mt-1">
                Margin Used: ₹{usedMargin.toLocaleString()} | Available: ₹{availableNseBseBalance.toLocaleString()}
              </div>
            )}

            <div className={walletActionsDisabledClass(nseBseProfitBlocked)}>
            <button
              type="button"
              disabled={nseBseProfitBlocked}
              onClick={() => {
                if (nseBseProfitBlocked) return;
                setShowTradingWalletLedger((prev) => {
                  const next = !prev;
                  if (next) {
                    fetchTradingWalletLedger();
                    fetchNseBseWallet();
                  }
                  return next;
                });
              }}
              className="mt-4 w-full py-2.5 text-sm font-medium text-green-200 border border-green-500/35 rounded-lg hover:bg-green-500/10 flex items-center justify-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <History size={16} />
              {showTradingWalletLedger ? 'Hide' : 'View'} transaction history
            </button>

            {showTradingWalletLedger && !nseBseProfitBlocked && (
              <div className="mt-3 rounded-lg border border-dark-600 bg-dark-900/50 overflow-hidden max-h-72 overflow-y-auto">
                <div className="flex flex-col gap-2 px-3 py-2 border-b border-dark-600 bg-dark-800/80 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                    NSE & BSE wallet transactions
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={openTradingOrdersPage}
                      className="text-[11px] text-green-400 hover:text-green-300 flex items-center gap-1"
                    >
                      <ClipboardList size={12} />
                      Full orders page
                    </button>
                  </div>
                </div>
                {tradingWalletLedgerLoading ? (
                  <div className="p-6 text-center text-gray-500 text-sm">Loading transaction history…</div>
                ) : tradingWalletLedger.length === 0 ? (
                  <div className="p-6 text-center text-gray-500 text-sm">
                    No transactions yet.
                  </div>
                ) : (
                  <>
                  {tradingWalletLedger.some((r) => r.reason === 'BROKERAGE') && (
                    <p className="px-3 py-2 text-[10px] text-gray-500 border-b border-dark-600">
                      Brokerage rows show open-leg charges (OPEN+CLOSE for FUT). P&L is separate.
                    </p>
                  )}
                  <table className="w-full text-left text-[11px]">
                    <thead className="sticky top-0 bg-dark-800 text-gray-500">
                      <tr>
                        <th className="px-2 py-2 font-medium whitespace-nowrap">When (IST)</th>
                        <th className="px-2 py-2 font-medium">Reason</th>
                        <th className="px-2 py-2 font-medium text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-dark-700">
                      {tradingWalletLedger.map((row) => {
                        // Transform reason for brokerage legs
                        let displayReason = row.reason;
                        if (row.reason === 'BROKERAGE_OPEN_LEG') {
                          displayReason = 'BROKERAGE(OPEN)';
                        } else if (row.reason === 'BROKERAGE_CLOSE_LEG') {
                          displayReason = 'BROKERAGE(CLOSE)';
                        } else if (row.reason === 'BROKERAGE' && row.meta?.leg) {
                          // New entries with leg in meta
                          if (row.meta.leg === 'OPEN') displayReason = 'BROKERAGE(OPEN)';
                          else if (row.meta.leg === 'CLOSE') displayReason = 'BROKERAGE(CLOSE)';
                          else displayReason = 'BROKERAGE(OPEN+CLOSE)';
                        } else if (row.reason === 'BROKERAGE') {
                          // Old entries without leg info - show as plain BROKERAGE
                          displayReason = 'BROKERAGE';
                        }

                        return (
                          <tr key={row._id} className="hover:bg-dark-800/60">
                            <td className="px-2 py-2 text-gray-400 whitespace-nowrap align-top">{formatIstLedgerTime(row.createdAt)}</td>
                            <td className="px-2 py-2 align-top">
                              <div className={`text-gray-200 font-medium ${row.type === 'CREDIT' ? 'text-green-400' : 'text-red-400'}`}>
                                {displayReason}
                              </div>
                              {row.description && (
                                <div className="text-[10px] text-gray-500 mt-1">{row.description}</div>
                              )}
                              {row.isAutoSquare && (
                                <div className="text-[10px] px-1.5 py-0.5 rounded bg-orange-900/30 text-orange-400 mt-1 inline-block">
                                  Autosquare
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-2 text-right align-top tabular-nums">
                              <span className={row.type === 'CREDIT' ? 'text-green-400' : 'text-red-400'}>
                                {row.type === 'CREDIT' ? '+' : '-'}₹
                                {Number(row.amount || 0).toLocaleString('en-IN', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </>
                )}
              </div>
            )}

            <button
              type="button"
              disabled={nseBseProfitBlocked}
              onClick={() => {
                if (nseBseProfitBlocked) return;
                setShowTradingTransferLedger((prev) => {
                  const next = !prev;
                  if (next) fetchTradingTransferLedger();
                  return next;
                });
              }}
              className="mt-4 w-full py-2 text-sm font-medium text-green-300/90 border border-green-500/25 rounded-lg hover:bg-green-500/10 flex items-center justify-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <History size={16} />
              Transfer ledger
              {showTradingTransferLedger ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {showTradingTransferLedger && !nseBseProfitBlocked && (
              <div className="mt-2 rounded-lg border border-green-500/20 bg-dark-900/50 max-h-56 overflow-y-auto">
                {tradingTransferLedgerLoading ? (
                  <p className="text-center text-xs text-gray-500 py-4">Loading…</p>
                ) : tradingTransferLedger.length === 0 ? (
                  <p className="text-center text-xs text-gray-500 py-4 px-2 leading-snug">
                    No transfers yet. Moves between Main Wallet and NSE & BSE wallet (Deposit/Withdraw above) appear here.
                  </p>
                ) : (
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-dark-800/95 text-gray-400 border-b border-dark-600">
                      <tr>
                        <th className="text-left p-2 font-medium">When (IST)</th>
                        <th className="text-right p-2 font-medium">Amount</th>
                        <th className="text-left p-2 font-medium">From → To</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tradingTransferLedger.map((row) => (
                        <tr key={row.id} className="border-t border-dark-700/80">
                          <td className="p-2 align-top text-gray-400 whitespace-nowrap">{formatIstLedgerTime(row.at)}</td>
                          <td className="p-2 align-top text-right font-mono tabular-nums text-cyan-300/95">
                            ₹
                            {Number(row.amount || 0).toLocaleString('en-IN', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                          <td className="p-2 align-top text-gray-300 leading-snug">
                            <span className="text-green-300/90">{row.sourceLabel}</span>
                            <span className="text-gray-600 mx-1">→</span>
                            <span className="text-emerald-300/90">{row.targetLabel}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
            </div>
          </div>

          {/* Account Actions */}
          <div className={`p-4 flex gap-2 relative ${walletActionsDisabledClass(nseBseProfitBlocked)}`}>
            <button 
              onClick={opestockexRoom}
              className="flex-1 flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-700 py-3 rounded-lg font-medium transition"
            >
              <IndianRupee size={18} />
              Trade
            </button>
            <button 
              onClick={() => openTransfer('toAccount')}
              className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 px-4 py-3 rounded-lg transition"
              title="Transfer from Main Wallet to NSE & BSE Wallet"
            >
              <Plus size={18} />
              Add funds
            </button>
            <button 
              onClick={() => openTransfer('toWallet')}
              className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 px-4 py-3 rounded-lg transition"
              title="Move free balance from NSE & BSE Wallet back to Main Wallet"
            >
              <Minus size={18} />
              Move to Main
            </button>
            <button 
              onClick={() => setShowWalletTransferDropdown(showWalletTransferDropdown === 'trading' ? null : 'trading')}
              className="flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 px-4 py-3 rounded-lg transition"
              title="Transfer to other wallets"
            >
              <ArrowLeftRight size={18} />
              Transfer
            </button>
            
            {/* Dropdown menu */}
            {showWalletTransferDropdown === 'trading' && (
              <div className="absolute bottom-full right-0 mb-2 bg-dark-700 border border-dark-600 rounded-lg shadow-xl z-50 min-w-[200px]">
                <div className="p-2">
                  <div className="text-xs text-gray-400 px-2 py-1 mb-1">Transfer to:</div>
                  <button
                    onClick={() => { setWalletTransferSource('nseBseWallet'); setWalletTransferTarget('wallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                  >
                    Main Wallet (cash)
                  </button>
                  <button
                    onClick={() => { setWalletTransferSource('nseBseWallet'); setWalletTransferTarget('mcxWallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                  >
                    MCX Wallet
                  </button>
                  <button
                    onClick={() => { setWalletTransferSource('nseBseWallet'); setWalletTransferTarget('gamesWallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                  >
                    Games Wallet
                  </button>
                  <button
                    onClick={() => { setWalletTransferSource('nseBseWallet'); setWalletTransferTarget('cryptoWallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                  >
                    Crypto Wallet
                  </button>
                  <button
                    onClick={() => { setWalletTransferSource('nseBseWallet'); setWalletTransferTarget('forexWallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                  >
                    Forex Wallet
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* MCX Account */}
        <div className={`bg-dark-800 rounded-xl overflow-hidden relative ${walletCardBlockedClass(mcxProfitBlocked)}`}>
          {mcxProfitBlocked && <WalletBlockedBanner />}
          {/* Account Header */}
          <div className="p-4 border-b border-dark-600">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-yellow-500 to-amber-600 rounded-lg flex items-center justify-center">
                  <Gem size={20} className="text-white" />
                </div>
                <div>
                  <div className="font-semibold">MCX-{user?.userId?.slice(-5) || '00000'}</div>
                  <div className="text-xs text-gray-500">COMMODITY TRADING</div>
                </div>
              </div>
              <button className="text-gray-400 hover:text-white">
                <MoreHorizontal size={20} />
              </button>
            </div>
          </div>

          {/* Account Body */}
          <div className="p-6 bg-gradient-to-br from-yellow-900/20 to-dark-800">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2 h-2 bg-yellow-400 rounded-full"></span>
              <span className="text-sm text-yellow-400">MCX Account</span>
            </div>
            
            <div className="text-4xl font-bold mb-1">
              ₹{mcxBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div className="text-sm text-gray-500">MCX Trading Balance</div>
            {mcxUsedMargin > 0 && (
              <div className="text-xs text-yellow-400 mt-1">
                Margin Used: ₹{mcxUsedMargin.toLocaleString()} | Available: ₹{mcxAvailableBalance.toLocaleString()}
              </div>
            )}
            {mcxRealizedPnL !== 0 && (
              <div className={`text-xs mt-1 ${mcxRealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                P&L: {mcxRealizedPnL >= 0 ? '+' : ''}₹{mcxRealizedPnL.toLocaleString()}
              </div>
            )}

            <div className={walletActionsDisabledClass(mcxProfitBlocked)}>
            <button
              type="button"
              disabled={mcxProfitBlocked}
              onClick={toggleMcxOrders}
              className="mt-4 w-full py-2.5 text-sm font-medium text-yellow-200 border border-yellow-500/35 rounded-lg hover:bg-yellow-500/10 flex items-center justify-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <History size={16} />
              {showMcxOrders ? 'Hide' : 'View'} transaction history
            </button>

            {showMcxOrders && !mcxProfitBlocked && (
              <div className="mt-3 rounded-lg border border-dark-600 bg-dark-900/50 overflow-hidden">
                <div className="flex flex-col gap-2 px-3 py-2 border-b border-dark-600 bg-dark-800/80 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                    MCX orders and positions
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={openMcxOrdersPage}
                      className="text-[11px] text-yellow-400 hover:text-yellow-300 flex items-center gap-1"
                    >
                      <ClipboardList size={12} />
                      Full orders page
                    </button>
                    <button
                      type="button"
                      onClick={fetchMcxOrders}
                      disabled={mcxOrdersLoading}
                      className="text-[11px] text-yellow-400 hover:text-yellow-300 flex items-center gap-1 disabled:opacity-50"
                    >
                      <RefreshCw size={12} className={mcxOrdersLoading ? 'animate-spin' : ''} />
                      Refresh
                    </button>
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto overflow-x-auto">
                  {mcxOrdersLoading ? (
                    <div className="p-6 text-center text-gray-500 text-sm">Loading orders…</div>
                  ) : mcxOrders.length === 0 ? (
                    <div className="p-6 text-center text-gray-500 text-sm">
                      No MCX orders yet. Trades placed from commodity trading appear here.
                    </div>
                  ) : (
                    <table className="w-full text-left text-[11px] min-w-[520px]">
                      <thead className="sticky top-0 bg-dark-800 text-gray-500">
                        <tr>
                          <th className="px-2 py-2 font-medium whitespace-nowrap">Time</th>
                          <th className="px-2 py-2 font-medium">Symbol</th>
                          <th className="px-2 py-2 font-medium">Side</th>
                          <th className="px-2 py-2 font-medium text-right">Qty</th>
                          <th className="px-2 py-2 font-medium text-right">Lots</th>
                          <th className="px-2 py-2 font-medium">Status</th>
                          <th className="px-2 py-2 font-medium text-right">Entry</th>
                          <th className="px-2 py-2 font-medium text-right">Exit</th>
                          <th className="px-2 py-2 font-medium text-right">P/L</th>
                          <th className="px-2 py-2 font-medium text-right">Brokerage</th>
                          <th className="px-2 py-2 font-medium">Autosquare</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-dark-700">
                        {mcxOrders.map((row) => {
                          const t = row.openedAt || row.createdAt ? new Date(row.openedAt || row.createdAt) : null;
                          const timeStr = t
                            ? t.toLocaleString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                                hour12: true,
                                timeZone: 'Asia/Kolkata',
                              })
                            : '—';
                          const pnl =
                            row.status === 'CLOSED'
                              ? row.netPnL ?? row.realizedPnL
                              : null;
                          const { qtyText, lotsText } = getTradeQtyLotsDisplay(row);
                          return (
                            <tr key={row._id} className="hover:bg-dark-800/60">
                              <td className="px-2 py-2 text-yellow-400 whitespace-nowrap align-top tabular-nums">{timeStr}</td>
                              <td className="px-2 py-2 align-top">
                                <div className="text-gray-200 font-medium">{row.symbol || '—'}</div>
                                <div className="text-[10px] text-gray-600">
                                  {[row.productType, row.orderType].filter(Boolean).join(' · ')}
                                </div>
                              </td>
                              <td className="px-2 py-2 align-top">
                                <span
                                  className={
                                    row.side === 'BUY' ? 'text-green-400 font-medium' : 'text-red-400 font-medium'
                                  }
                                >
                                  {row.side || '—'}
                                </span>
                              </td>
                              <td className="px-2 py-2 text-right text-gray-300 align-top whitespace-nowrap tabular-nums">
                                {qtyText}
                              </td>
                              <td className="px-2 py-2 text-right text-gray-300 align-top whitespace-nowrap tabular-nums">
                                {lotsText}
                              </td>
                              <td className="px-2 py-2 align-top text-gray-300">{row.status || '—'}</td>
                              <td className="px-2 py-2 text-right text-gray-300 align-top tabular-nums">
                                {row.entryPrice != null
                                  ? `₹${Number(row.entryPrice).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
                                  : '—'}
                              </td>
                              <td className="px-2 py-2 text-right text-gray-300 align-top tabular-nums">
                                {row.exitPrice != null && row.status === 'CLOSED'
                                  ? `₹${Number(row.exitPrice).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
                                  : '—'}
                              </td>
                              <td className="px-2 py-2 text-right align-top tabular-nums">
                                {pnl != null && Number.isFinite(Number(pnl)) ? (
                                  <span className={Number(pnl) >= 0 ? 'text-green-400' : 'text-red-400'}>
                                    {Number(pnl) >= 0 ? '+' : ''}₹
                                    {Number(pnl).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                                  </span>
                                ) : (
                                  <span className="text-gray-600">—</span>
                                )}
                              </td>
                              <td className="px-2 py-2 text-right align-top tabular-nums">
                                {(Number(row.commission) || 0) > 0 ? (
                                  <span className="text-amber-300" title="Round-trip brokerage (charged at open)">
                                    ₹{Number(row.commission).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                                  </span>
                                ) : (
                                  <span className="text-gray-600">—</span>
                                )}
                              </td>
                              <td className="px-2 py-2 align-top">
                                {['AUTO_SQUARE', 'TIME_BASED', 'AUTO_SQUARE_330', 'EOD_SQUAREOFF'].includes(
                                  String(row.closeReason || '').toUpperCase()
                                ) ? (
                                  <span className="text-orange-400 text-xs font-medium">Yes</span>
                                ) : (
                                  <span className="text-gray-600 text-xs">No</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={mcxProfitBlocked}
              onClick={() => {
                if (mcxProfitBlocked) return;
                setShowMcxTransferLedger((prev) => {
                  const next = !prev;
                  if (next) fetchMcxTransferLedger();
                  return next;
                });
              }}
              className="mt-2 w-full py-2 text-sm font-medium text-yellow-300/90 border border-yellow-500/25 rounded-lg hover:bg-yellow-500/10 flex items-center justify-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <History size={16} />
              Transfer ledger
              {showMcxTransferLedger ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {showMcxTransferLedger && !mcxProfitBlocked && (
              <div className="mt-2 rounded-lg border border-yellow-500/20 bg-dark-900/50 max-h-56 overflow-y-auto">
                {mcxTransferLedgerLoading ? (
                  <p className="text-center text-xs text-gray-500 py-4">Loading…</p>
                ) : mcxTransferLedger.length === 0 ? (
                  <p className="text-center text-xs text-gray-500 py-4 px-2 leading-snug">
                    No entries yet. Main ↔ MCX moves, trade P&L, and brokerage (red) appear here when you open a trade.
                  </p>
                ) : (
                  <>
                    {sumBrokerageFromLedger(mcxTransferLedger) > 0 && (
                      <p className="text-[10px] text-amber-300/90 px-2 pt-2 border-b border-dark-700/80">
                        Total brokerage (shown below): ₹
                        {sumBrokerageFromLedger(mcxTransferLedger).toLocaleString('en-IN', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    )}
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-dark-800/95 text-gray-400 border-b border-dark-600">
                      <tr>
                        <th className="text-left p-2 font-medium">When (IST)</th>
                        <th className="text-right p-2 font-medium">Amount</th>
                        <th className="text-left p-2 font-medium">From → To</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mcxTransferLedger.map((row) => (
                        <tr key={row.id} className="border-t border-dark-700/80">
                          <td className="p-2 align-top text-gray-400 whitespace-nowrap">{formatIstLedgerTime(row.at)}</td>
                          <td className={`p-2 align-top text-right font-mono tabular-nums ${row.type === 'CREDIT' ? 'text-green-400' : 'text-red-400'}`}>
                            ₹
                            {Number(row.amount || 0).toLocaleString('en-IN', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                          <td className="p-2 align-top text-gray-300 leading-snug">
                            {isSubwalletTradeLedgerRow(row) ? (
                              <div>
                                <span className={subwalletTradeLedgerTextClass(row)}>{row.description}</span>
                              </div>
                            ) : (
                              <>
                                <span className="text-yellow-300/90">{row.sourceLabel}</span>
                                <span className="text-gray-600 mx-1">→</span>
                                <span className="text-amber-300/90">{row.targetLabel}</span>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </>
                )}
              </div>
            )}
            </div>
          </div>

          {/* Account Actions */}
          <div className={`p-4 flex gap-2 relative ${walletActionsDisabledClass(mcxProfitBlocked)}`}>
            <button 
              onClick={openMcxTrading}
              className="flex-1 flex items-center justify-center gap-2 bg-yellow-600 hover:bg-yellow-700 py-3 rounded-lg font-medium transition"
            >
              <Gem size={18} />
              Trade
            </button>
            <button 
              onClick={() => openMcxTransfer('toMcx')}
              className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 px-4 py-3 rounded-lg transition"
              title="Transfer from Main Wallet to MCX Account"
            >
              <Plus size={18} />
              Deposit
            </button>
            <button 
              onClick={() => openMcxTransfer('fromMcx')}
              className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 px-4 py-3 rounded-lg transition"
              title="Transfer from MCX Account to Main Wallet"
            >
              <Minus size={18} />
              Withdraw
            </button>
            <button 
              onClick={() => setShowWalletTransferDropdown(showWalletTransferDropdown === 'mcx' ? null : 'mcx')}
              className="flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 px-4 py-3 rounded-lg transition"
              title="Transfer to other wallets"
            >
              <ArrowLeftRight size={18} />
              Transfer
            </button>
            
            {/* Dropdown menu */}
            {showWalletTransferDropdown === 'mcx' && (
              <div className="absolute bottom-full right-0 mb-2 bg-dark-700 border border-dark-600 rounded-lg shadow-xl z-50 min-w-[200px]">
                <div className="p-2">
                  <div className="text-xs text-gray-400 px-2 py-1 mb-1">Transfer to:</div>
                  <button
                    onClick={() => {                     setWalletTransferSource('mcxWallet'); setWalletTransferTarget('wallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                  >
                    Main Wallet (cash)
                  </button>
                  <button
                    onClick={() => { setWalletTransferSource('mcxWallet'); setWalletTransferTarget('nseBseWallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                  >
                    NSE & BSE Wallet
                  </button>
                  <button
                    onClick={() => { setWalletTransferSource('mcxWallet'); setWalletTransferTarget('gamesWallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                  >
                    Games Wallet
                  </button>
                  <button
                    onClick={() => { setWalletTransferSource('mcxWallet'); setWalletTransferTarget('cryptoWallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                  >
                    Crypto Wallet
                  </button>
                  <button
                    onClick={() => { setWalletTransferSource('mcxWallet'); setWalletTransferTarget('forexWallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                  >
                    Forex Wallet
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Games Account */}
        <div className={`bg-dark-800 rounded-xl overflow-hidden relative ${walletCardBlockedClass(gamesProfitBlocked)}`}>
          {gamesProfitBlocked && <WalletBlockedBanner />}
          {/* Account Header */}
          <div className="p-4 border-b border-dark-600">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center">
                  <Gamepad2 size={20} className="text-white" />
                </div>
                <div>
                  <div className="font-semibold">GAMES-{user?.userId?.slice(-5) || '00000'}</div>
                  <div className="text-xs text-gray-500">FANTASY TRADING</div>
                </div>
              </div>
              <button className="text-gray-400 hover:text-white">
                <MoreHorizontal size={20} />
              </button>
            </div>
          </div>

          {/* Account Body */}
          <div className="p-6 bg-gradient-to-br from-purple-900/20 to-dark-800">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2 h-2 bg-purple-400 rounded-full"></span>
              <span className="text-sm text-purple-400">Games Account</span>
            </div>
            
            <div className="text-4xl font-bold mb-1">
              ₹{gamesBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div className="text-sm text-gray-500">Games Balance</div>
            {gamesUsedMargin > 0 && (
              <div className="text-xs text-purple-400 mt-1">
                In Play: ₹{gamesUsedMargin.toLocaleString()} | Available: ₹{gamesAvailableBalance.toLocaleString()}
              </div>
            )}
            {gamesRealizedPnL !== 0 && (
              <div className={`text-xs mt-1 ${gamesRealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                P&L: {gamesRealizedPnL >= 0 ? '+' : ''}₹{gamesRealizedPnL.toLocaleString()}
              </div>
            )}

            <div className={walletActionsDisabledClass(gamesProfitBlocked)}>
            <button
              type="button"
              disabled={gamesProfitBlocked}
              onClick={toggleGamesLedger}
              className="mt-4 w-full py-2.5 text-sm font-medium text-purple-200 border border-purple-500/35 rounded-lg hover:bg-purple-500/10 flex items-center justify-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <History size={16} />
              {showGamesLedger ? 'Hide' : 'View'} transaction history
            </button>

            {showGamesLedger && !gamesProfitBlocked && (
              <div className="mt-3 rounded-lg border border-dark-600 bg-dark-900/50 overflow-hidden">
                <div className="flex flex-col gap-2 px-3 py-2 border-b border-dark-600 bg-dark-800/80 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col gap-1 min-w-0 flex-1">
                    <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Games wallet</span>
                    <select
                      value={gamesLedgerGameFilter}
                      onChange={(e) => setGamesLedgerGameFilter(e.target.value)}
                      className="text-[11px] bg-dark-700 border border-dark-600 rounded px-2 py-1.5 text-gray-200 max-w-full"
                    >
                      {GAMES_LEDGER_FILTER_OPTIONS.map((opt) => (
                        <option key={opt.value || 'all'} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={fetchGamesLedger}
                    disabled={gamesLedgerLoading}
                    className="text-[11px] text-purple-400 hover:text-purple-300 flex items-center gap-1 disabled:opacity-50 shrink-0 self-start sm:self-center"
                  >
                    <RefreshCw size={12} className={gamesLedgerLoading ? 'animate-spin' : ''} />
                    Refresh
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {gamesLedgerLoading ? (
                    <div className="p-6 text-center text-gray-500 text-sm">Loading history…</div>
                  ) : gamesLedger.length === 0 ? (
                    <div className="p-6 text-center text-gray-500 text-sm">
                      No entries yet. Bets, wins, and transfers to/from this account appear here.
                    </div>
                  ) : (
                    <table className="w-full text-left text-[11px]">
                      <thead className="sticky top-0 bg-dark-800 text-gray-500">
                        <tr>
                          <th className="px-2 py-2 font-medium" title="When the bet or trade was placed (IST)">
                            Order time
                          </th>
                          <th className="px-2 py-2 font-medium">Game / source</th>
                          <th className="px-2 py-2 font-medium text-right whitespace-nowrap">Tickets</th>
                          <th className="px-2 py-2 font-medium text-right">Amount</th>
                          <th className="px-2 py-2 font-medium text-right">Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-dark-700">
                        {gamesLedger.map((row) => (
                          <tr key={row._id} className="hover:bg-dark-800/60">
                            <td className="px-2 py-2 text-gray-400 whitespace-nowrap align-top">
                              <span>{formatGamesLedgerWhen(row)}</span>
                              {row.meta?.orderPlacedAt &&
                                row.createdAt &&
                                Math.abs(
                                  new Date(row.meta.orderPlacedAt).getTime() -
                                    new Date(row.createdAt).getTime()
                                ) > 60_000 && (
                                  <div className="text-[9px] text-gray-600 mt-0.5 leading-tight">
                                    Settled{' '}
                                    {new Date(row.createdAt).toLocaleString('en-IN', {
                                      day: '2-digit',
                                      month: 'short',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </div>
                                )}
                            </td>
                            <td className="px-2 py-2 align-top">
                              <div className="text-gray-200 font-medium">{row.gameLabel || row.gameId || '—'}</div>
                              {row.description && (
                                <div className="text-gray-500 mt-0.5 leading-snug">{row.description}</div>
                              )}
                            </td>
                            <td className="px-2 py-2 text-right align-top whitespace-nowrap text-gray-300 tabular-nums">
                              {formatGamesLedgerTickets(row)}
                            </td>
                            <td className="px-2 py-2 text-right align-top whitespace-nowrap">
                              <span
                                className={
                                  row.entryType === 'credit' ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'
                                }
                              >
                                {row.entryType === 'credit' ? '+' : '−'}₹
                                {(row.amount ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                              </span>
                              <div className="text-[10px] text-gray-600 uppercase mt-0.5">{row.entryType}</div>
                            </td>
                            <td className="px-2 py-2 text-right text-gray-300 align-top whitespace-nowrap">
                              ₹
                              {(row.balanceAfter ?? 0).toLocaleString('en-IN', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={gamesProfitBlocked}
              onClick={() => {
                if (gamesProfitBlocked) return;
                setShowGamesTransferLedger((prev) => {
                  const next = !prev;
                  if (next) fetchGamesTransferLedger();
                  return next;
                });
              }}
              className="mt-2 w-full py-2 text-sm font-medium text-purple-300/90 border border-purple-500/25 rounded-lg hover:bg-purple-500/10 flex items-center justify-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <History size={16} />
              Transfer ledger
              {showGamesTransferLedger ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {showGamesTransferLedger && !gamesProfitBlocked && (
              <div className="mt-2 rounded-lg border border-purple-500/20 bg-dark-900/50 max-h-56 overflow-y-auto">
                {gamesTransferLedgerLoading ? (
                  <p className="text-center text-xs text-gray-500 py-4">Loading…</p>
                ) : gamesTransferLedger.length === 0 ? (
                  <p className="text-center text-xs text-gray-500 py-4 px-2 leading-snug">
                    No transfers yet. Main ↔ Games moves and transfers involving Games wallet appear here.
                  </p>
                ) : (
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-dark-800/95 text-gray-400 border-b border-dark-600">
                      <tr>
                        <th className="text-left p-2 font-medium">When (IST)</th>
                        <th className="text-right p-2 font-medium">Amount</th>
                        <th className="text-left p-2 font-medium">From → To</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gamesTransferLedger.map((row) => (
                        <tr key={row.id} className="border-t border-dark-700/80">
                          <td className="p-2 align-top text-gray-400 whitespace-nowrap">{formatIstLedgerTime(row.at)}</td>
                          <td className={`p-2 align-top text-right font-mono tabular-nums ${row.type === 'CREDIT' ? 'text-green-400' : 'text-red-400'}`}>
                            ₹
                            {Number(row.amount || 0).toLocaleString('en-IN', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                          <td className="p-2 align-top text-gray-300 leading-snug">
                            {row.kind === 'trade_pnl' ? (
                              <div>
                                <span className="text-cyan-300">{row.description}</span>
                              </div>
                            ) : (
                              <>
                                <span className="text-purple-300/90">{row.sourceLabel}</span>
                                <span className="text-gray-600 mx-1">→</span>
                                <span className="text-fuchsia-300/90">{row.targetLabel}</span>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
            </div>
          </div>

          {/* Account Actions */}
          <div className={`p-4 flex gap-2 relative ${walletActionsDisabledClass(gamesProfitBlocked)}`}>
            <button 
              onClick={openGamesTrading}
              className="flex-1 flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 py-3 rounded-lg font-medium transition"
            >
              <Gamepad2 size={18} />
              Play
            </button>
            <button 
              onClick={() => openGamesTransfer('toGames')}
              className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 px-4 py-3 rounded-lg transition"
              title="Transfer from Main Wallet to Games Account"
            >
              <Plus size={18} />
              Deposit
            </button>
            <button 
              onClick={() => openGamesTransfer('fromGames')}
              className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 px-4 py-3 rounded-lg transition"
              title="Transfer from Games Account to Main Wallet"
            >
              <Minus size={18} />
              Withdraw
            </button>
            <button 
              onClick={() => setShowWalletTransferDropdown(showWalletTransferDropdown === 'games' ? null : 'games')}
              className="flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 px-4 py-3 rounded-lg transition"
              title="Transfer to other wallets"
            >
              <ArrowLeftRight size={18} />
              Transfer
            </button>
            
            {/* Dropdown menu */}
            {showWalletTransferDropdown === 'games' && (
              <div className="absolute bottom-full right-0 mb-2 bg-dark-700 border border-dark-600 rounded-lg shadow-xl z-50 min-w-[200px]">
                <div className="p-2">
                  <div className="text-xs text-gray-400 px-2 py-1 mb-1">Transfer to:</div>
                  <button
                    onClick={() => { setWalletTransferSource('gamesWallet'); setWalletTransferTarget('nseBseWallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                  >
                    NSE & BSE Wallet
                  </button>
                  <button
                    onClick={() => { setWalletTransferSource('gamesWallet'); setWalletTransferTarget('wallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                  >
                    Main Wallet (cash)
                  </button>
                  <button
                    onClick={() => { setWalletTransferSource('gamesWallet'); setWalletTransferTarget('mcxWallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                  >
                    MCX Wallet
                  </button>
                  <button
                    onClick={() => { setWalletTransferSource('gamesWallet'); setWalletTransferTarget('cryptoWallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                  >
                    Crypto Wallet
                  </button>
                  <button
                    onClick={() => { setWalletTransferSource('gamesWallet'); setWalletTransferTarget('forexWallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                  >
                    Forex Wallet
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <div className={`bg-dark-800 rounded-xl overflow-hidden w-full min-w-0 relative ${walletCardBlockedClass(cryptoProfitBlocked)}`}>
          {cryptoProfitBlocked && <WalletBlockedBanner />}
          <div className="p-4 border-b border-dark-600">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-amber-600 rounded-lg flex items-center justify-center">
                  <Bitcoin size={20} className="text-white" />
                </div>
                <div>
                  <div className="font-semibold">CRYPTO-{user?.userId?.slice(-5) || '00000'}</div>
                  <div className="text-xs text-gray-500">CRYPTO TRADING</div>
                </div>
              </div>
              <button type="button" className="text-gray-400 hover:text-white">
                <MoreHorizontal size={20} />
              </button>
            </div>
          </div>

          <div className="p-6 bg-gradient-to-br from-orange-900/25 to-dark-800">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2 h-2 bg-orange-400 rounded-full" />
              <span className="text-sm text-orange-400">Crypto Account</span>
            </div>

            <div className="text-4xl font-bold mb-1">
              ₹{cryptoBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-sm text-gray-500">Crypto balance (INR)</div>
            {cryptoRealizedPnL !== 0 && (
              <div className={`text-xs mt-1 ${cryptoRealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                Realized P/L: {cryptoRealizedPnL >= 0 ? '+' : ''}₹{cryptoRealizedPnL.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            )}

            <div className={walletActionsDisabledClass(cryptoProfitBlocked)}>
            <button
              type="button"
              disabled={cryptoProfitBlocked}
              onClick={openCryptoOrders}
              className="mt-4 w-full py-2.5 text-sm font-medium text-orange-200 border border-orange-500/35 rounded-lg hover:bg-orange-500/10 flex items-center justify-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ClipboardList size={16} />
              View crypto orders
            </button>

            <button
              type="button"
              disabled={cryptoProfitBlocked}
              onClick={() => {
                if (cryptoProfitBlocked) return;
                setShowCryptoTransferLedger((prev) => {
                  const next = !prev;
                  if (next) fetchCryptoTransferLedger();
                  return next;
                });
              }}
              className="mt-2 w-full py-2 text-sm font-medium text-orange-300/90 border border-orange-500/25 rounded-lg hover:bg-orange-500/10 flex items-center justify-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <History size={16} />
              Transfer ledger
              {showCryptoTransferLedger ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {showCryptoTransferLedger && !cryptoProfitBlocked && (
              <div className="mt-2 rounded-lg border border-orange-500/20 bg-dark-900/50 max-h-56 overflow-y-auto">
                {cryptoTransferLedgerLoading ? (
                  <p className="text-center text-xs text-gray-500 py-4">Loading…</p>
                ) : cryptoTransferLedger.length === 0 ? (
                  <p className="text-center text-xs text-gray-500 py-4 px-2 leading-snug">
                    No entries yet. Main ↔ Crypto transfers, trade P&L (cyan), and brokerage (red) appear here.
                  </p>
                ) : (
                  <>
                    {sumBrokerageFromLedger(cryptoTransferLedger) > 0 && (
                      <p className="text-[10px] text-amber-300/90 px-2 pt-2 border-b border-dark-700/80">
                        Brokerage in this list (latest {cryptoTransferLedger.length} rows): ₹
                        {sumBrokerageFromLedger(cryptoTransferLedger).toLocaleString('en-IN', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    )}
                    <table className="w-full text-[11px]">
                      <thead className="sticky top-0 bg-dark-800/95 text-gray-400 border-b border-dark-600">
                        <tr>
                          <th className="text-left p-2 font-medium">When (IST)</th>
                          <th className="text-right p-2 font-medium">Amount</th>
                          <th className="text-left p-2 font-medium">From → To</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cryptoTransferLedger.map((row) => (
                          <tr key={row.id} className="border-t border-dark-700/80">
                            <td className="p-2 align-top text-gray-400 whitespace-nowrap">{formatIstLedgerTime(row.at)}</td>
                            <td
                              className={`p-2 align-top text-right font-mono tabular-nums ${
                                row.type === 'CREDIT' ? 'text-green-400' : 'text-red-400'
                              }`}
                            >
                              ₹
                              {Number(row.amount || 0).toLocaleString('en-IN', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>
                            <td className="p-2 align-top text-gray-300 leading-snug">
                              {isSubwalletTradeLedgerRow(row) ? (
                                <div>
                                  <span className={subwalletTradeLedgerTextClass(row)}>{row.description}</span>
                                </div>
                              ) : (
                                <>
                                  <span className="text-orange-300/90">{row.sourceLabel}</span>
                                  <span className="text-gray-600 mx-1">→</span>
                                  <span className="text-emerald-300/90">{row.targetLabel}</span>
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            )}
            </div>

            <div className="mt-3 text-[11px] text-gray-500 leading-snug">
              Deposit moves Indian Rupees (₹) from your Main Wallet into this crypto trading wallet (also ₹). Use Trade for Binance spot pairs in the terminal.
            </div>
          </div>

          <div className={`p-4 flex gap-2 relative ${walletActionsDisabledClass(cryptoProfitBlocked)}`}>
            <button
              type="button"
              onClick={openCryptoTrading}
              className="flex-1 flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-700 py-3 rounded-lg font-medium transition"
            >
              <Bitcoin size={18} />
              Trade
            </button>
            <button
              type="button"
              onClick={() => openCryptoTransfer('toCrypto')}
              className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 px-4 py-3 rounded-lg transition"
              title="Transfer from Main Wallet (₹) to Crypto Account (₹)"
            >
              <Plus size={18} />
              Deposit
            </button>
            <button
              type="button"
              onClick={() => openCryptoTransfer('fromCrypto')}
              className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 px-4 py-3 rounded-lg transition"
              title="Transfer from Crypto Account (₹) to Main Wallet (₹)"
            >
              <Minus size={18} />
              Withdraw
            </button>
            <button 
              onClick={() => setShowWalletTransferDropdown(showWalletTransferDropdown === 'crypto' ? null : 'crypto')}
              className="flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 px-4 py-3 rounded-lg transition"
              title="Transfer to other wallets"
            >
              <ArrowLeftRight size={18} />
              Transfer
            </button>
            
            {/* Dropdown menu */}
            {showWalletTransferDropdown === 'crypto' && (
              <div className="absolute bottom-full right-0 mb-2 bg-dark-700 border border-dark-600 rounded-lg shadow-xl z-50 min-w-[200px]">
                <div className="p-2">
                  <div className="text-xs text-gray-400 px-2 py-1 mb-1">Transfer to:</div>
                  <button
                    onClick={() => { setWalletTransferSource('cryptoWallet'); setWalletTransferTarget('wallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                  >
                    Main Wallet (cash)
                  </button>
                  <button
                    onClick={() => { setWalletTransferSource('cryptoWallet'); setWalletTransferTarget('nseBseWallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                  >
                    NSE & BSE Wallet
                  </button>
                  <button
                    onClick={() => { setWalletTransferSource('cryptoWallet'); setWalletTransferTarget('mcxWallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                  >
                    MCX Wallet
                  </button>
                  <button
                    onClick={() => { setWalletTransferSource('cryptoWallet'); setWalletTransferTarget('gamesWallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                  >
                    Games Wallet
                  </button>
                  <button
                    onClick={() => { setWalletTransferSource('cryptoWallet'); setWalletTransferTarget('forexWallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                  >
                    Forex Wallet
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

          <div className={`bg-dark-800 rounded-xl overflow-hidden w-full min-w-0 relative ${walletCardBlockedClass(forexProfitBlocked)}`}>
            {forexProfitBlocked && <WalletBlockedBanner />}
            <div className="p-4 border-b border-dark-600">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-cyan-600 to-teal-700 rounded-lg flex items-center justify-center">
                    <Landmark size={20} className="text-white" />
                  </div>
                  <div>
                    <div className="font-semibold">FOREX-{user?.userId?.slice(-5) || '00000'}</div>
                    <div className="text-xs text-gray-500">FOREX TRADING</div>
                  </div>
                </div>
                <button type="button" className="text-gray-400 hover:text-white">
                  <MoreHorizontal size={20} />
                </button>
              </div>
            </div>

            <div className="p-6 bg-gradient-to-br from-cyan-900/25 to-dark-800">
              <div className="flex items-center gap-2 mb-4">
                <span className="w-2 h-2 bg-cyan-400 rounded-full" />
                <span className="text-sm text-cyan-400">Forex Account</span>
              </div>

              <div className="text-4xl font-bold mb-1">
                ₹{forexBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-sm text-gray-500">Forex balance (INR)</div>
              {forexRealizedPnL !== 0 && (
                <div className={`text-xs mt-1 ${forexRealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  Realized P/L: {forexRealizedPnL >= 0 ? '+' : ''}₹{forexRealizedPnL.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              )}

              <div className={walletActionsDisabledClass(forexProfitBlocked)}>
              <button
                type="button"
                disabled={forexProfitBlocked}
                onClick={openForexOrders}
                className="mt-4 w-full py-2.5 text-sm font-medium text-cyan-200 border border-cyan-500/35 rounded-lg hover:bg-cyan-500/10 flex items-center justify-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ClipboardList size={16} />
                View forex orders
              </button>

              <button
                type="button"
                disabled={forexProfitBlocked}
                onClick={() => {
                  if (forexProfitBlocked) return;
                  setShowForexTransferLedger((prev) => {
                    const next = !prev;
                    if (next) fetchForexTransferLedger();
                    return next;
                  });
                }}
                className="mt-2 w-full py-2 text-sm font-medium text-cyan-300/90 border border-cyan-500/25 rounded-lg hover:bg-cyan-500/10 flex items-center justify-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <History size={16} />
                Transfer ledger
                {showForexTransferLedger ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>

              {showForexTransferLedger && !forexProfitBlocked && (
                <div className="mt-2 rounded-lg border border-cyan-500/20 bg-dark-900/50 max-h-56 overflow-y-auto">
                  {forexTransferLedgerLoading ? (
                    <p className="text-center text-xs text-gray-500 py-4">Loading…</p>
                  ) : forexTransferLedger.length === 0 ? (
                    <p className="text-center text-xs text-gray-500 py-4 px-2 leading-snug">
                      No entries yet. Main ↔ Forex transfers, trade P&L (cyan), and brokerage (red) appear here.
                    </p>
                  ) : (
                    <>
                      {sumBrokerageFromLedger(forexTransferLedger) > 0 && (
                        <p className="text-[10px] text-amber-300/90 px-2 pt-2 border-b border-dark-700/80">
                          Total brokerage (shown below): ₹
                          {sumBrokerageFromLedger(forexTransferLedger).toLocaleString('en-IN', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </p>
                      )}
                      <table className="w-full text-[11px]">
                        <thead className="sticky top-0 bg-dark-800/95 text-gray-400 border-b border-dark-600">
                          <tr>
                            <th className="text-left p-2 font-medium">When (IST)</th>
                            <th className="text-right p-2 font-medium">Amount</th>
                            <th className="text-left p-2 font-medium">From → To</th>
                          </tr>
                        </thead>
                        <tbody>
                          {forexTransferLedger.map((row) => (
                            <tr key={row.id} className="border-t border-dark-700/80">
                              <td className="p-2 align-top text-gray-400 whitespace-nowrap">{formatIstLedgerTime(row.at)}</td>
                              <td
                                className={`p-2 align-top text-right font-mono tabular-nums ${
                                  row.type === 'CREDIT' ? 'text-green-400' : 'text-red-400'
                                }`}
                              >
                                ₹
                                {Number(row.amount || 0).toLocaleString('en-IN', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </td>
                              <td className="p-2 align-top text-gray-300 leading-snug">
                                {isSubwalletTradeLedgerRow(row) ? (
                                  <div>
                                    <span className={subwalletTradeLedgerTextClass(row)}>{row.description}</span>
                                  </div>
                                ) : (
                                  <>
                                    <span className="text-cyan-300/90">{row.sourceLabel}</span>
                                    <span className="text-gray-600 mx-1">→</span>
                                    <span className="text-teal-300/90">{row.targetLabel}</span>
                                  </>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              )}
              </div>

              <div className="mt-3 text-[11px] text-gray-500 leading-snug">
                Move Indian Rupees (₹) from your Main Wallet into this forex wallet. Trade major FX pairs in the terminal (USD quotes, INR wallet).
              </div>
            </div>

            <div className={`p-4 flex gap-2 relative ${walletActionsDisabledClass(forexProfitBlocked)}`}>
              <button
                type="button"
                onClick={openForexTrading}
                className="flex-1 flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-700 py-3 rounded-lg font-medium transition"
              >
                <Landmark size={18} />
                Trade
              </button>
              <button
                type="button"
                onClick={() => openForexTransfer('toForex')}
                className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 px-4 py-3 rounded-lg transition"
                title="Transfer from Main Wallet (₹) to Forex Account (₹)"
              >
                <Plus size={18} />
                Deposit
              </button>
              <button
                type="button"
                onClick={() => openForexTransfer('fromForex')}
                className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 px-4 py-3 rounded-lg transition"
                title="Transfer from Forex Account (₹) to Main Wallet (₹)"
              >
                <Minus size={18} />
                Withdraw
              </button>
              <button 
                onClick={() => setShowWalletTransferDropdown(showWalletTransferDropdown === 'forex' ? null : 'forex')}
                className="flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 px-4 py-3 rounded-lg transition"
                title="Transfer to other wallets"
              >
                <ArrowLeftRight size={18} />
                Transfer
              </button>
              
              {/* Dropdown menu */}
              {showWalletTransferDropdown === 'forex' && (
                <div className="absolute bottom-full right-0 mb-2 bg-dark-700 border border-dark-600 rounded-lg shadow-xl z-50 min-w-[200px]">
                  <div className="p-2">
                    <div className="text-xs text-gray-400 px-2 py-1 mb-1">Transfer to:</div>
                    <button
                      onClick={() => { setWalletTransferSource('forexWallet'); setWalletTransferTarget('wallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                    >
                      Main Wallet (cash)
                    </button>
                    <button
                      onClick={() => { setWalletTransferSource('forexWallet'); setWalletTransferTarget('nseBseWallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                    >
                      NSE & BSE Wallet
                    </button>
                    <button
                      onClick={() => { setWalletTransferSource('forexWallet'); setWalletTransferTarget('mcxWallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                    >
                      MCX Wallet
                    </button>
                    <button
                      onClick={() => { setWalletTransferSource('forexWallet'); setWalletTransferTarget('gamesWallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                    >
                      Games Wallet
                    </button>
                    <button
                      onClick={() => { setWalletTransferSource('forexWallet'); setWalletTransferTarget('cryptoWallet'); setShowWalletTransferDropdown(null); setShowWalletTransferModal(true); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-dark-600 rounded transition"
                    >
                      Crypto Wallet
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* Wallet section — Main balance + send to client */}
      <div className="mt-8 bg-dark-800 rounded-xl border border-blue-500/20 overflow-hidden">
        <div className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Wallet className="text-blue-400" size={22} />
              Wallet
            </h2>
            <p className="text-sm text-gray-400 mt-1">Main Wallet (cash)</p>
            <p className="text-2xl font-bold text-blue-400 tabular-nums mt-1">
              ₹{mainWalletBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Deposit / withdraw with admin · send to clients in your hierarchy
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowPeerTransferModal(true)}
            className="px-5 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 shrink-0"
          >
            <Send size={18} />
            Send to Client
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowPeerTransferHistory((prev) => {
              const next = !prev;
              if (next) fetchPeerTransferHistory();
              return next;
            });
          }}
          className="w-full py-2.5 text-sm text-blue-300/90 border-t border-dark-600 hover:bg-blue-500/5 flex items-center justify-center gap-2"
        >
          <History size={16} />
          Client transfer history
          {showPeerTransferHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {showPeerTransferHistory && (
          <div className="border-t border-dark-600 max-h-56 overflow-y-auto">
            {peerTransferHistoryLoading ? (
              <p className="text-center text-xs text-gray-500 py-4">Loading…</p>
            ) : peerTransferHistory.length === 0 ? (
              <p className="text-center text-xs text-gray-500 py-4 px-3">
                No client transfers yet.
              </p>
            ) : (
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-dark-800 text-gray-400 border-b border-dark-600">
                  <tr>
                    <th className="text-left p-2 font-medium">When</th>
                    <th className="text-left p-2 font-medium">Type</th>
                    <th className="text-left p-2 font-medium">Name · User ID</th>
                    <th className="text-right p-2 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-700">
                  {peerTransferHistory.map((row) => (
                    <tr key={row.id} className="hover:bg-dark-700/40">
                      <td className="p-2 text-gray-400 whitespace-nowrap">
                        {row.createdAt
                          ? new Date(row.createdAt).toLocaleString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '—'}
                      </td>
                      <td className="p-2">
                        <span
                          className={
                            row.direction === 'sent' ? 'text-orange-300' : 'text-green-400'
                          }
                        >
                          {row.direction === 'sent' ? 'Sent' : 'Received'}
                        </span>
                      </td>
                      <td className="p-2 text-gray-300">
                        {row.counterpartyName && (
                          <div className="text-white text-xs">{row.counterpartyName}</div>
                        )}
                        <div className="font-mono text-[10px] text-amber-300/90">
                          {row.counterpartyUserId || '—'}
                        </div>
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        <span className={row.direction === 'sent' ? 'text-red-400' : 'text-green-400'}>
                          {row.direction === 'sent' ? '−' : '+'}₹
                          {Number(row.amount || 0).toLocaleString('en-IN', {
                            minimumFractionDigits: 2,
                          })}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Account Summary */}
      <div className="mt-6 bg-dark-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4">Account Summary</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-4 sm:gap-6">
          <div>
            <div className="text-sm text-gray-400 mb-1">Main Wallet</div>
            <div className="text-2xl font-bold text-blue-400">
              ₹{mainWalletBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-400 mb-1">NSE & BSE Wallet</div>
            <div className="text-2xl font-bold text-green-400">
              ₹{nseBseBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-400 mb-1">MCX Account</div>
            <div className="text-2xl font-bold text-yellow-400">
              ₹{mcxBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-400 mb-1">Games Account</div>
            <div className="text-2xl font-bold text-purple-400">
              ₹{gamesBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-400 mb-1">Crypto</div>
            <div className="text-2xl font-bold text-orange-400">
              ₹{cryptoBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-400 mb-1">Forex</div>
            <div className="text-2xl font-bold text-cyan-400">
              ₹{forexBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-400 mb-1">Total Deposited</div>
            <div className="text-2xl font-bold">
              ₹{(walletData?.wallet?.totalDeposited || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-400 mb-1">Total Withdrawn</div>
            <div className="text-2xl font-bold">
              ₹{(walletData?.wallet?.totalWithdrawn || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      </div>

      {/* Internal Transfer Modal */}
      {showTransferModal && (
        <InternalTransferModal
          user={user}
          walletBalance={mainWalletBalance}
          tradingBalance={availableNseBseBalance}
          direction={transferDirection}
          onClose={() => setShowTransferModal(false)}
          onSuccess={(transferData) => {
            patchWalletFromTransfer(transferData);
            setShowTransferModal(false);
            fetchTradingTransferLedger();
            fetchNseBseWallet();
          }}
        />
      )}

      {/* MCX Transfer Modal */}
      {showMcxTransferModal && (
        <McxTransferModal
          user={user}
          walletBalance={mainWalletBalance}
          mcxBalance={mcxAvailableBalance}
          direction={mcxTransferDirection}
          onClose={() => setShowMcxTransferModal(false)}
          onSuccess={() => {
            fetchWallet();
            setShowMcxTransferModal(false);
            fetchMcxTransferLedger();
          }}
        />
      )}

      {/* Games Transfer Modal */}
      {showGamesTransferModal && (
        <GamesTransferModal
          user={user}
          walletBalance={mainWalletBalance}
          gamesBalance={gamesAvailableBalance}
          direction={gamesTransferDirection}
          onClose={() => setShowGamesTransferModal(false)}
          onSuccess={() => {
            fetchWallet();
            setShowGamesTransferModal(false);
            fetchGamesTransferLedger();
          }}
        />
      )}

      {showCryptoTransferModal && (
        <CryptoTransferModal
          user={user}
          walletBalance={mainWalletBalance}
          cryptoBalance={cryptoBalance}
          direction={cryptoTransferDirection}
          onClose={() => setShowCryptoTransferModal(false)}
          onSuccess={() => {
            fetchWallet();
            setShowCryptoTransferModal(false);
            fetchCryptoTransferLedger();
          }}
        />
      )}

      {showForexTransferModal && (
        <ForexTransferModal
          user={user}
          walletBalance={mainWalletBalance}
          forexBalance={forexBalance}
          direction={forexTransferDirection}
          onClose={() => setShowForexTransferModal(false)}
          onSuccess={() => {
            fetchWallet();
            setShowForexTransferModal(false);
            fetchForexTransferLedger();
          }}
        />
      )}

      {showPeerTransferModal && (
        <PeerTransferModal
          token={user?.token}
          walletData={walletData}
          nseBseSnapshot={nseBseWalletSnapshot}
          onClose={() => setShowPeerTransferModal(false)}
          onSuccess={() => {
            fetchWallet();
            fetchPeerTransferHistory();
            setShowPeerTransferHistory(true);
          }}
        />
      )}

      {/* Wallet Transfer Modal */}
      {showWalletTransferModal && (
        <WalletTransferModal
          token={user?.token}
          sourceWallet={walletTransferSource}
          targetWallet={walletTransferTarget}
          onClose={() => setShowWalletTransferModal(false)}
          onSuccess={() => {
            fetchWallet();
            setShowWalletTransferModal(false);
            if (walletTransferSource === 'cryptoWallet' || walletTransferTarget === 'cryptoWallet') {
              fetchCryptoTransferLedger();
            }
            if (walletTransferSource === 'forexWallet' || walletTransferTarget === 'forexWallet') {
              fetchForexTransferLedger();
            }
            if (walletTransferSource === 'mcxWallet' || walletTransferTarget === 'mcxWallet') {
              fetchMcxTransferLedger();
            }
            if (walletTransferSource === 'gamesWallet' || walletTransferTarget === 'gamesWallet') {
              fetchGamesTransferLedger();
            }
            if (
              walletTransferSource === 'nseBseWallet' ||
              walletTransferTarget === 'nseBseWallet' ||
              walletTransferSource === 'tradingAccount' ||
              walletTransferTarget === 'tradingAccount'
            ) {
              fetchNseBseWallet();
              fetchTradingTransferLedger();
            }
          }}
        />
      )}
    </div>
  );
};

// Internal Transfer Modal - Main Wallet ↔ NSE & BSE Wallet
const InternalTransferModal = ({ user, walletBalance, tradingBalance, direction, onClose, onSuccess }) => {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isToAccount = direction === 'toAccount';
  const sourceBalance = isToAccount ? walletBalance : tradingBalance;
  const sourceLabel = isToAccount ? 'Main Wallet' : 'NSE & BSE Wallet';
  const destLabel = isToAccount ? 'NSE & BSE Wallet' : 'Main Wallet';

  const handleSubmit = async (e) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    
    if (!amt || amt <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    if (amt > sourceBalance) {
      setError(`Insufficient balance in ${sourceLabel}`);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { data } = await axios.post('/api/user/funds/internal-transfer', {
        amount: amt,
        direction: direction // 'toAccount' or 'toWallet'
      }, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      onSuccess(data);
    } catch (err) {
      setError(err.response?.data?.message || 'Transfer failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <ArrowLeftRight size={20} className="text-blue-400" />
            Internal Transfer
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-4 -mt-2">
          Move money between Main Wallet (deposit/withdraw) and NSE &amp; BSE wallet (NSE/BSE trades only).
        </p>

        {/* Transfer Direction Display */}
        <div className="bg-dark-700 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between">
            <div className="text-center flex-1">
              <div className="text-xs text-gray-400 mb-1">{sourceLabel}</div>
              <div className="text-lg font-bold text-green-400">₹{sourceBalance.toLocaleString()}</div>
            </div>
            <div className="px-4">
              <ArrowRight size={24} className="text-blue-400" />
            </div>
            <div className="text-center flex-1">
              <div className="text-xs text-gray-400 mb-1">{destLabel}</div>
              <div className="text-lg font-bold text-blue-400">
                ₹{(isToAccount ? tradingBalance : walletBalance).toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/20 text-red-400 p-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Amount (₹)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount to transfer"
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500 text-lg"
            />
          </div>

          {/* Quick Amount Buttons */}
          <div className="flex gap-2 flex-wrap">
            {[1000, 5000, 10000, 50000].map(amt => (
              <button
                key={amt}
                type="button"
                onClick={() => setAmount(String(sourceBalance > 0 ? Math.min(amt, sourceBalance) : amt))}
                className="flex-1 min-w-[60px] bg-dark-700 hover:bg-dark-600 py-2 rounded text-sm transition"
              >
                ₹{amt.toLocaleString()}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAmount(String(Math.max(sourceBalance, 0)))}
              className="flex-1 min-w-[60px] bg-green-600 hover:bg-green-700 py-2 rounded text-sm font-medium transition"
            >
              Max
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 py-3 rounded-lg font-medium transition"
          >
            {loading ? 'Transferring...' : `Transfer to ${destLabel}`}
          </button>
        </form>
      </div>
    </div>
  );
};

// MCX Transfer Modal - Transfer between Main Wallet and MCX Account
const McxTransferModal = ({ user, walletBalance, mcxBalance, direction, onClose, onSuccess }) => {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isToMcx = direction === 'toMcx';
  const sourceBalance = isToMcx ? walletBalance : mcxBalance;
  const sourceLabel = isToMcx ? 'Main Wallet' : 'MCX Account';
  const destLabel = isToMcx ? 'MCX Account' : 'Main Wallet';

  const handleSubmit = async (e) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    
    if (!amt || amt <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    if (amt > sourceBalance) {
      setError(`Insufficient balance in ${sourceLabel}`);
      return;
    }

    setLoading(true);
    setError('');

    try {
      await axios.post('/api/user/funds/mcx-transfer', {
        amount: amt,
        direction: direction // 'toMcx' or 'fromMcx'
      }, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.message || 'Transfer failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Gem size={20} className="text-yellow-400" />
            MCX Transfer
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {/* Transfer Direction Display */}
        <div className="bg-dark-700 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between">
            <div className="text-center flex-1">
              <div className="text-xs text-gray-400 mb-1">{sourceLabel}</div>
              <div className={`text-lg font-bold ${isToMcx ? 'text-blue-400' : 'text-yellow-400'}`}>
                ₹{sourceBalance.toLocaleString()}
              </div>
            </div>
            <div className="px-4">
              <ArrowRight size={24} className="text-yellow-400" />
            </div>
            <div className="text-center flex-1">
              <div className="text-xs text-gray-400 mb-1">{destLabel}</div>
              <div className={`text-lg font-bold ${isToMcx ? 'text-yellow-400' : 'text-blue-400'}`}>
                ₹{(isToMcx ? mcxBalance : walletBalance).toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {/* MCX Info */}
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-4 text-sm">
          <div className="flex items-center gap-2 text-yellow-400">
            <Gem size={16} />
            <span>MCX Commodity Trading Account</span>
          </div>
          <div className="mt-1 text-gray-300 text-xs">
            Trade Gold, Silver, Crude Oil, Natural Gas & more
          </div>
        </div>

        {error && (
          <div className="bg-red-500/20 text-red-400 p-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Amount (₹)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount to transfer"
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-3 focus:outline-none focus:border-yellow-500 text-lg"
            />
          </div>

          {/* Quick Amount Buttons */}
          <div className="flex gap-2 flex-wrap">
            {[1000, 5000, 10000, 50000].map(amt => (
              <button
                key={amt}
                type="button"
                onClick={() => setAmount(String(sourceBalance > 0 ? Math.min(amt, sourceBalance) : amt))}
                className="flex-1 min-w-[60px] bg-dark-700 hover:bg-dark-600 py-2 rounded text-sm transition"
              >
                ₹{amt.toLocaleString()}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAmount(String(Math.max(sourceBalance, 0)))}
              className="flex-1 min-w-[60px] bg-yellow-600 hover:bg-yellow-700 py-2 rounded text-sm font-medium transition"
            >
              Max
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 py-3 rounded-lg font-medium transition"
          >
            {loading ? 'Transferring...' : `Transfer to ${destLabel}`}
          </button>
        </form>
      </div>
    </div>
  );
};

// Games Transfer Modal - Transfer between Main Wallet and Games Account
const GamesTransferModal = ({ user, walletBalance, gamesBalance, direction, onClose, onSuccess }) => {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isToGames = direction === 'toGames';
  const sourceBalance = isToGames ? walletBalance : gamesBalance;
  const sourceLabel = isToGames ? 'Main Wallet' : 'Games Account';
  const destLabel = isToGames ? 'Games Account' : 'Main Wallet';

  const handleSubmit = async (e) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    
    if (!amt || amt <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    if (amt > sourceBalance) {
      setError(`Insufficient balance in ${sourceLabel}`);
      return;
    }

    setLoading(true);
    setError('');

    try {
      await axios.post('/api/user/funds/games-transfer', {
        amount: amt,
        direction: direction // 'toGames' or 'fromGames'
      }, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.message || 'Transfer failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Gamepad2 size={20} className="text-purple-400" />
            Games Transfer
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {/* Transfer Direction Display */}
        <div className="bg-dark-700 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between">
            <div className="text-center flex-1">
              <div className="text-xs text-gray-400 mb-1">{sourceLabel}</div>
              <div className={`text-lg font-bold ${isToGames ? 'text-blue-400' : 'text-purple-400'}`}>
                ₹{sourceBalance.toLocaleString()}
              </div>
            </div>
            <div className="px-4">
              <ArrowRight size={24} className="text-purple-400" />
            </div>
            <div className="text-center flex-1">
              <div className="text-xs text-gray-400 mb-1">{destLabel}</div>
              <div className={`text-lg font-bold ${isToGames ? 'text-purple-400' : 'text-blue-400'}`}>
                ₹{(isToGames ? gamesBalance : walletBalance).toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {/* Games Info */}
        <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 mb-4 text-sm">
          <div className="flex items-center gap-2 text-purple-400">
            <Gamepad2 size={16} />
            <span>Fantasy Trading Account</span>
          </div>
          <div className="mt-1 text-gray-300 text-xs">
            Play fantasy games and win real rewards
          </div>
        </div>

        {error && (
          <div className="bg-red-500/20 text-red-400 p-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Amount (₹)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount to transfer"
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-3 focus:outline-none focus:border-purple-500 text-lg"
            />
          </div>

          {/* Quick Amount Buttons */}
          <div className="flex gap-2 flex-wrap">
            {[500, 1000, 5000, 10000].map(amt => (
              <button
                key={amt}
                type="button"
                onClick={() => setAmount(String(sourceBalance > 0 ? Math.min(amt, sourceBalance) : amt))}
                className="flex-1 min-w-[60px] bg-dark-700 hover:bg-dark-600 py-2 rounded text-sm transition"
              >
                ₹{amt.toLocaleString()}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAmount(String(Math.max(sourceBalance, 0)))}
              className="flex-1 min-w-[60px] bg-purple-600 hover:bg-purple-700 py-2 rounded text-sm font-medium transition"
            >
              Max
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 py-3 rounded-lg font-medium transition"
          >
            {loading ? 'Transferring...' : `Transfer to ${destLabel}`}
          </button>
        </form>
      </div>
    </div>
  );
};

// Crypto transfer — Main Wallet (INR) ↔ Crypto wallet (INR notional for spot)
const CryptoTransferModal = ({ user, walletBalance, cryptoBalance, direction, onClose, onSuccess }) => {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isToCrypto = direction === 'toCrypto';
  const sourceBalance = isToCrypto ? walletBalance : cryptoBalance;
  const sourceLabel = isToCrypto ? 'Main Wallet' : 'Crypto Account';
  const destLabel = isToCrypto ? 'Crypto Account' : 'Main Wallet';

  const handleSubmit = async (e) => {
    e.preventDefault();
    const amt = parseFloat(amount);

    if (!amt || amt <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    if (amt > sourceBalance) {
      setError(`Insufficient balance in ${sourceLabel}`);
      return;
    }

    setLoading(true);
    setError('');

    try {
      await axios.post(
        '/api/user/funds/crypto-transfer',
        { amount: amt, direction },
        { headers: { Authorization: `Bearer ${user.token}` } }
      );
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.message || 'Transfer failed');
    } finally {
      setLoading(false);
    }
  };

  const amtNum = parseFloat(amount);
  const estimateLine =
    amtNum > 0 && Number.isFinite(amtNum)
      ? `₹${amtNum.toLocaleString('en-IN', { maximumFractionDigits: 2 })} will be moved to ${destLabel}`
      : null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Bitcoin size={20} className="text-orange-400" />
            Crypto Transfer
          </h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="bg-dark-700 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between">
            <div className="text-center flex-1 min-w-0">
              <div className="text-xs text-gray-400 mb-1">{sourceLabel}</div>
              <div className={`text-lg font-bold truncate ${isToCrypto ? 'text-blue-400' : 'text-orange-400'}`}>
                ₹{sourceBalance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </div>
            </div>
            <div className="px-2 shrink-0">
              <ArrowRight size={24} className="text-orange-400" />
            </div>
            <div className="text-center flex-1 min-w-0">
              <div className="text-xs text-gray-400 mb-1">{destLabel}</div>
              <div className={`text-lg font-bold truncate ${isToCrypto ? 'text-orange-400' : 'text-blue-400'}`}>
                ₹{(isToCrypto ? cryptoBalance : walletBalance).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3 mb-4 text-sm">
          <div className="flex items-center gap-2 text-orange-400">
            <Bitcoin size={16} />
            <span>Spot crypto (Binance pairs)</span>
          </div>
          <div className="mt-1 text-gray-300 text-xs">
            {isToCrypto
              ? 'Move Indian Rupees (₹) from your Main Wallet into your crypto trading wallet.'
              : 'Move Indian Rupees (₹) from your crypto trading wallet back to your Main Wallet.'}
          </div>
        </div>

        {error && <div className="bg-red-500/20 text-red-400 p-3 rounded-lg mb-4 text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Amount (₹)</label>
            <input
              type="number"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount in INR"
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-3 focus:outline-none focus:border-orange-500 text-lg"
            />
            {estimateLine && <p className="text-xs text-gray-500 mt-2">{estimateLine}</p>}
          </div>

          <div className="flex gap-2 flex-wrap">
            {[1000, 5000, 10000, 50000].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setAmount(String(sourceBalance > 0 ? Math.min(q, sourceBalance) : q))}
                className="flex-1 min-w-[60px] bg-dark-700 hover:bg-dark-600 py-2 rounded text-sm transition"
              >
                ₹{q.toLocaleString()}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAmount(String(Math.max(sourceBalance, 0)))}
              className="flex-1 min-w-[60px] bg-orange-600 hover:bg-orange-700 py-2 rounded text-sm font-medium transition"
            >
              Max
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-orange-600 hover:bg-orange-700 disabled:opacity-50 py-3 rounded-lg font-medium transition"
          >
            {loading ? 'Transferring...' : `Transfer to ${destLabel}`}
          </button>
        </form>
      </div>
    </div>
  );
};

// Forex transfer — Main Wallet (INR) ↔ Forex wallet (INR)
const ForexTransferModal = ({ user, walletBalance, forexBalance, direction, onClose, onSuccess }) => {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isToForex = direction === 'toForex';
  const sourceBalance = isToForex ? walletBalance : forexBalance;
  const sourceLabel = isToForex ? 'Main Wallet' : 'Forex Account';
  const destLabel = isToForex ? 'Forex Account' : 'Main Wallet';

  const handleSubmit = async (e) => {
    e.preventDefault();
    const amt = parseFloat(amount);

    if (!amt || amt <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    if (amt > sourceBalance) {
      setError(`Insufficient balance in ${sourceLabel}`);
      return;
    }

    setLoading(true);
    setError('');

    try {
      await axios.post(
        '/api/user/funds/forex-transfer',
        { amount: amt, direction },
        { headers: { Authorization: `Bearer ${user.token}` } }
      );
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.message || 'Transfer failed');
    } finally {
      setLoading(false);
    }
  };

  const amtNum = parseFloat(amount);
  const estimateLine =
    amtNum > 0 && Number.isFinite(amtNum)
      ? `₹${amtNum.toLocaleString('en-IN', { maximumFractionDigits: 2 })} will be moved to ${destLabel}`
      : null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Landmark size={20} className="text-cyan-400" />
            Forex Transfer
          </h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="bg-dark-700 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between">
            <div className="text-center flex-1 min-w-0">
              <div className="text-xs text-gray-400 mb-1">{sourceLabel}</div>
              <div className={`text-lg font-bold truncate ${isToForex ? 'text-blue-400' : 'text-cyan-400'}`}>
                ₹{sourceBalance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </div>
            </div>
            <div className="px-2 shrink-0">
              <ArrowRight size={24} className="text-cyan-400" />
            </div>
            <div className="text-center flex-1 min-w-0">
              <div className="text-xs text-gray-400 mb-1">{destLabel}</div>
              <div className={`text-lg font-bold truncate ${isToForex ? 'text-cyan-400' : 'text-blue-400'}`}>
                ₹{(isToForex ? forexBalance : walletBalance).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3 mb-4 text-sm">
          <div className="flex items-center gap-2 text-cyan-400">
            <Landmark size={16} />
            <span>Forex spot (major pairs)</span>
          </div>
          <div className="mt-1 text-gray-300 text-xs">
            {isToForex
              ? 'Move Indian Rupees (₹) from your Main Wallet into your forex trading wallet.'
              : 'Move Indian Rupees (₹) from your forex trading wallet back to your Main Wallet.'}
          </div>
        </div>

        {error && <div className="bg-red-500/20 text-red-400 p-3 rounded-lg mb-4 text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Amount (₹)</label>
            <input
              type="number"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount in INR"
              className="w-full bg-dark-700 border border-dark-600 rounded-lg px-4 py-3 focus:outline-none focus:border-cyan-500 text-lg"
            />
            {estimateLine && <p className="text-xs text-gray-500 mt-2">{estimateLine}</p>}
          </div>

          <div className="flex gap-2 flex-wrap">
            {[1000, 5000, 10000, 50000].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setAmount(String(sourceBalance > 0 ? Math.min(q, sourceBalance) : q))}
                className="flex-1 min-w-[60px] bg-dark-700 hover:bg-dark-600 py-2 rounded text-sm transition"
              >
                ₹{q.toLocaleString()}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAmount(String(Math.max(sourceBalance, 0)))}
              className="flex-1 min-w-[60px] bg-cyan-600 hover:bg-cyan-700 py-2 rounded text-sm font-medium transition"
            >
              Max
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 py-3 rounded-lg font-medium transition"
          >
            {loading ? 'Transferring...' : `Transfer to ${destLabel}`}
          </button>
        </form>
      </div>
    </div>
  );
};

// Wallet Transfer Modal - Transfer between different wallets
const WalletTransferModal = ({ token, sourceWallet, targetWallet, onClose, onSuccess }) => {
  const [source, setSource] = useState(sourceWallet || 'wallet');
  const [target, setTarget] = useState(targetWallet || '');
  const [amount, setAmount] = useState('');
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [transferLimits, setTransferLimits] = useState(null);
  const [limitsLoading, setLimitsLoading] = useState(true);

  const fetchTransferLimits = useCallback(async () => {
    if (!token) return;
    setLimitsLoading(true);
    try {
      const { data } = await axios.get('/api/user/wallet-transfer-limits', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setTransferLimits(data?.limits || null);
    } catch {
      setTransferLimits(null);
    } finally {
      setLimitsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchTransferLimits();
  }, [fetchTransferLimits]);

  useEffect(() => {
    if (sourceWallet) {
      setSource(sourceWallet);
    }
  }, [sourceWallet]);

  useEffect(() => {
    if (targetWallet) {
      setTarget(targetWallet);
    }
  }, [targetWallet]);

  const sourceDetails = transferLimits?.[source];

  const handleTransfer = async (e) => {
    e.preventDefault();
    if (!target || !amount || Number(amount) <= 0) {
      setError('Please select target wallet and enter valid amount');
      return;
    }
    if (source === target) {
      setError('Source and target wallets cannot be the same');
      return;
    }

    const clientCheck = validateTransferAmount(transferLimits, source, amount);
    if (!clientCheck.valid) {
      setError(clientCheck.error);
      return;
    }
    
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await axios.post('/api/user/wallet-transfer', {
        sourceWallet: source,
        targetWallet: target,
        amount: Number(amount),
        remarks
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      setSuccess(`Successfully transferred ₹${Number(amount).toLocaleString()}`);
      setAmount('');
      setRemarks('');
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (err) {
      console.error('Wallet transfer error:', err.response?.data);
      setError(err.response?.data?.message || err.message || 'Transfer failed');
    } finally {
      setLoading(false);
    }
  };

  const getWalletDisplayName = (walletType) => {
    switch(walletType) {
      case 'wallet': return 'Main Wallet (cash)';
      case 'tradingAccount':
      case 'nseBseWallet': return 'NSE & BSE Wallet';
      case 'cryptoWallet': return 'Crypto Wallet';
      case 'forexWallet': return 'Forex Wallet';
      case 'mcxWallet': return 'MCX Wallet';
      case 'gamesWallet': return 'Games Wallet';
      default: return walletType;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-dark-800 rounded-lg w-full max-w-lg p-6">
        <div className="flex justify-between mb-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <ArrowLeftRight size={24} /> Wallet Transfer
          </h2>
          <button onClick={onClose}><X size={24} /></button>
        </div>

        {error && <div className="bg-red-500/20 text-red-400 p-3 rounded mb-4">{error}</div>}
        {success && <div className="bg-green-500/20 text-green-400 p-3 rounded mb-4">{success}</div>}

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Source Wallet</label>
            <select 
              value={source} 
              onChange={e => setSource(e.target.value)}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
            >
              <option value="wallet">Main Wallet (cash)</option>
              <option value="nseBseWallet">NSE & BSE Wallet</option>
              <option value="cryptoWallet">Crypto Wallet</option>
              <option value="forexWallet">Forex Wallet</option>
              <option value="mcxWallet">MCX Wallet</option>
              <option value="gamesWallet">Games Wallet</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Target Wallet</label>
            <select 
              value={target} 
              onChange={e => setTarget(e.target.value)}
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
            >
              <option value="">-- Select Target --</option>
              <option value="wallet" disabled={source === 'wallet'}>Main Wallet (cash)</option>
              <option value="nseBseWallet" disabled={source === 'nseBseWallet'}>NSE & BSE Wallet</option>
              <option value="cryptoWallet" disabled={source === 'cryptoWallet'}>Crypto Wallet</option>
              <option value="forexWallet" disabled={source === 'forexWallet'}>Forex Wallet</option>
              <option value="mcxWallet" disabled={source === 'mcxWallet'}>MCX Wallet</option>
              <option value="gamesWallet" disabled={source === 'gamesWallet'}>Games Wallet</option>
            </select>
          </div>

          {sourceDetails && (
            <div className="bg-dark-700/80 border border-dark-600 rounded-lg p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-400">Wallet balance</span>
                <span className="text-white">{fmtTransferInr(sourceDetails.totalBalance)}</span>
              </div>
              {sourceDetails.usedMargin > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Used margin (locked)</span>
                  <span className="text-yellow-400">{fmtTransferInr(sourceDetails.usedMargin)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-dark-600 pt-1">
                <span className="text-gray-400">You can transfer up to</span>
                <span className="text-green-400 font-medium">{fmtTransferInr(sourceDetails.transferable)}</span>
              </div>
            </div>
          )}
          {limitsLoading && (
            <p className="text-xs text-gray-500">Loading transfer limits…</p>
          )}

          <div>
            <label className="block text-xs text-gray-400 mb-1">Amount (₹)</label>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder={
                sourceDetails
                  ? `Max ${sourceDetails.transferable.toLocaleString('en-IN')}`
                  : 'Enter amount'
              }
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
              min="1"
              max={sourceDetails?.transferable > 0 ? sourceDetails.transferable : undefined}
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Remarks (Optional)</label>
            <input
              type="text"
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              placeholder="e.g., Fund transfer"
              className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2"
            />
          </div>

          <button
            onClick={handleTransfer}
            disabled={loading}
            className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 py-3 rounded font-medium"
          >
            {loading ? 'Transferring...' : 'Transfer'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserAccounts;
