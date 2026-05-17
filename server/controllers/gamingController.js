/**
 * Gaming Controller
 * 
 * Clean architecture implementation for user gaming operations.
 * Handles game betting, jackpot games, bracket trading, and gaming analytics.
 * 
 * Controller Responsibilities:
 * 1. Gaming request validation and response formatting
 * 2. Gaming business logic orchestration
 * 3. Game wallet operations
 * 4. Error handling and status codes
 */

import User from '../models/User.js';
import NiftyNumberBet from '../models/NiftyNumberBet.js';
import BtcNumberBet from '../models/BtcNumberBet.js';
import NiftyBracketTrade from '../models/NiftyBracketTrade.js';
import NiftyJackpotBid from '../models/NiftyJackpotBid.js';
import NiftyJackpotResult from '../models/NiftyJackpotResult.js';
import GamesWalletLedger from '../models/GamesWalletLedger.js';
import { 
  ensureGamesWallet, 
  atomicGamesWalletUpdate, 
  atomicGamesWalletDebit 
} from '../utils/gamesWallet.js';
import { recordGamesWalletLedger } from '../utils/gamesWalletLedger.js';
import { getTodayISTString, startOfISTDayFromKey, endOfISTDayFromKey } from '../utils/istDate.js';
import { 
  sumUpDownSideTicketsInWindow,
  sumBracketSideTicketsInDay,
} from '../utils/gameStakeSideLimits.js';
import GameSettings from '../models/GameSettings.js';
import { 
  assertHierarchyGameNotDeniedForUserId,
  getMergedGameDenylistForPrincipal,
} from '../services/gameRestrictionService.js';
import { 
  createTransactionSlip, 
  addDebitEntry,
  addCreditEntry,
  addBrokerageDistributionEntries
} from '../services/gameTransactionSlipService.js';
import { getDummyNiftyWhenMarketClosedForTesting } from '../utils/dummyNiftyLtp.js';
import {
  isNiftyJackpotBiddingHoursBypassedForTesting,
  isNiftyBracketBiddingHoursBypassedForTesting,
} from '../utils/niftyJackpotTestMode.js';
import { isCurrentTimeWithinBracketBiddingIST } from '../utils/niftyBracketBiddingWindow.js';
import { getMarketData } from '../services/zerodhaWebSocket.js';
import { 
  fetchNifty50LastPriceFromKite,
  fetchNifty50HistoricalFromKite,
  istCalendarDateString,
  fetchNifty50SessionClearing15mCached
} from '../utils/kiteNiftyQuote.js';
import { 
  buildNiftyJackpotIstDayQuery 
} from '../utils/niftyJackpotDayScope.js';
import { 
  resolveNiftyJackpotSpotPrice,
  sortJackpotBidsByDistanceToReference
} from '../utils/niftyJackpotRank.js';
import { 
  resolveJackpotPrizePercentForRank
} from '../utils/niftyJackpotPrize.js';

// ==================== GAME BETTING OPERATIONS ====================

/**
 * Place game bet (up/down, number games, etc.)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const placeGameBet = async (req, res) => {
  try {
    const { gameId, betType, amount, prediction, side } = req.body;
    const userId = req.user._id;

    // Validate game access
    await assertHierarchyGameNotDeniedForUserId(userId, gameId);

    // Get game settings
    const settings = await GameSettings.getSettings();
    const gameConfig = settings?.games?.[gameId];
    
    if (!gameConfig || !gameConfig.enabled) {
      return res.status(400).json({ message: 'Game is not available' });
    }

    // Check minimum bet amount
    if (amount < gameConfig.minBet || amount > gameConfig.maxBet) {
      return res.status(400).json({ 
        message: `Bet amount must be between ${gameConfig.minBet} and ${gameConfig.maxBet}` 
      });
    }

    // Ensure user has sufficient games wallet balance
    await ensureGamesWallet(userId);
    const walletDebit = await atomicGamesWalletDebit(userId, amount);
    
    if (!walletDebit.success) {
      return res.status(400).json({ message: 'Insufficient games wallet balance' });
    }

    // Create transaction slip
    const transactionId = `GAME_${gameId}_${Date.now()}_${userId}`;
    const slip = await createTransactionSlip(transactionId, userId, gameId);

    // Add debit entry to transaction slip
    await addDebitEntry(slip._id, amount, `Game bet - ${gameId}`);

    // Record games wallet ledger
    await recordGamesWalletLedger(userId, 'DEBIT', amount, `Game bet - ${gameId}`, slip._id);

    // Create game-specific bet record based on game type
    let betRecord;
    switch (gameId) {
      case 'updown':
      case 'btcupdown':
        betRecord = await placeUpDownBet(userId, gameId, amount, side, slip._id);
        break;
      case 'niftyNumber':
      case 'btcNumber':
        betRecord = await placeNumberBet(userId, gameId, amount, prediction, slip._id);
        break;
      case 'niftyBracket':
        betRecord = await placeBracketBet(userId, amount, prediction, slip._id);
        break;
      case 'niftyJackpot':
      case 'btcJackpot':
        betRecord = await placeJackpotBet(userId, gameId, amount, prediction, slip._id);
        break;
      default:
        return res.status(400).json({ message: 'Invalid game type' });
    }

    res.status(201).json({
      message: 'Bet placed successfully',
      bet: {
        id: betRecord._id,
        gameId,
        amount,
        prediction,
        side,
        transactionId: slip._id,
        createdAt: betRecord.createdAt
      }
    });
  } catch (error) {
    console.error('[GamingController] Error placing game bet:', error);
    res.status(500).json({ message: 'Failed to place bet', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

// ==================== GAME WALLET OPERATIONS ====================

/**
 * Get games wallet ledger
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const getGameWalletLedger = async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const gameId = req.query.gameId || '';
    const date = req.query.date || '';
    
    let query = { ownerType: 'USER', ownerId: req.user._id };
    
    if (gameId) {
      query.description = { $regex: new RegExp(gameId, 'i') };
    }
    
    if (date) {
      const dayStart = startOfISTDayFromKey(date);
      const dayEnd = endOfISTDayFromKey(date);
      query.createdAt = { $gte: dayStart, $lte: dayEnd };
    }
    
    const ledger = await GamesWalletLedger.find(query)
      .sort({ createdAt: -1 })
      .limit(limit);
    
    res.json({
      ledger,
      total: ledger.length,
      query: { gameId, date, limit }
    });
  } catch (error) {
    console.error('[GamingController] Error getting game wallet ledger:', error);
    res.status(500).json({ message: 'Failed to get wallet ledger' });
  }
};

/**
 * Get games wallet today's net change
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const getGameTodayNet = async (req, res) => {
  try {
    const today = getTodayISTString();
    const dayStart = startOfISTDayFromKey(today);
    const dayEnd = endOfISTDayFromKey(today);
    
    const ledger = await GamesWalletLedger.find({
      ownerType: 'USER',
      ownerId: req.user._id,
      createdAt: { $gte: dayStart, $lte: dayEnd }
    });
    
    // Calculate net change per game
    const netByGame = {};
    ledger.forEach(entry => {
      const gameId = extractGameIdFromDescription(entry.description);
      if (!netByGame[gameId]) {
        netByGame[gameId] = { credits: 0, debits: 0, net: 0 };
      }
      if (entry.type === 'CREDIT') {
        netByGame[gameId].credits += entry.amount;
      } else {
        netByGame[gameId].debits += entry.amount;
      }
      netByGame[gameId].net = netByGame[gameId].credits - netByGame[gameId].debits;
    });
    
    res.json({
      date: today,
      netByGame,
      totalNet: Object.values(netByGame).reduce((sum, game) => sum + game.net, 0)
    });
  } catch (error) {
    console.error('[GamingController] Error getting today\'s net change:', error);
    res.status(500).json({ message: 'Failed to get today\'s net change' });
  }
};

// ==================== GAME ANALYTICS ====================

/**
 * Get live game activity
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const getGameLiveActivity = async (req, res) => {
  try {
    const settings = await GameSettings.getSettings().catch(() => null);
    const dayKey = getTodayISTString();
    const dayStart = startOfISTDayFromKey(dayKey);
    
    const activity = {};
    
    // Get activity for each game
    const games = ['btcupdown', 'updown', 'niftyNumber', 'niftyBracket', 'niftyJackpot'];
    
    for (const gameId of games) {
      const upDownTickets = await sumUpDownSideTicketsInWindow(gameId, dayStart, new Date());
      const bracketTickets = await sumBracketSideTicketsInDay(gameId, dayKey);
      
      activity[gameId] = {
        totalTickets: (upDownTickets.up + upDownTickets.down) || bracketTickets.total || 0,
        upTickets: upDownTickets.up || 0,
        downTickets: upDownTickets.down || 0,
        bracketTotal: bracketTickets.total || 0,
        lastUpdated: new Date()
      };
    }
    
    res.json({
      activity,
      timestamp: new Date(),
      settings: settings?.games || {}
    });
  } catch (error) {
    console.error('[GamingController] Error getting live activity:', error);
    res.status(500).json({ message: 'Failed to get live activity' });
  }
};

/**
 * Get recent winners
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const getGameRecentWinners = async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 15, 1), 40);
    
    const winners = await GamesWalletLedger.find({
      ownerType: 'USER',
      ownerId: req.user._id,
      type: 'CREDIT',
      description: { $regex: /win|prize|jackpot/i }
    })
    .sort({ createdAt: -1 })
    .limit(limit);
    
    res.json({
      winners: winners.map(entry => ({
        id: entry._id,
        amount: entry.amount,
        description: entry.description,
        balance: entry.balance,
        createdAt: entry.createdAt
      }))
    });
  } catch (error) {
    console.error('[GamingController] Error getting recent winners:', error);
    res.status(500).json({ message: 'Failed to get recent winners' });
  }
};

/**
 * Get game statistics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const getGameStats = async (req, res) => {
  try {
    const userId = req.user._id;
    const gameId = req.query.gameId || '';
    
    // Get user's game statistics
    let stats = {
      totalBets: 0,
      totalWins: 0,
      totalLosses: 0,
      totalWagered: 0,
      totalWon: 0,
      netProfit: 0,
      winRate: 0,
      averageBet: 0
    };
    
    // Get ledger entries for calculations
    let query = { ownerType: 'USER', ownerId: userId };
    if (gameId) {
      query.description = { $regex: new RegExp(gameId, 'i') };
    }
    
    const ledger = await GamesWalletLedger.find(query);
    
    ledger.forEach(entry => {
      if (entry.type === 'DEBIT') {
        stats.totalBets++;
        stats.totalWagered += entry.amount;
      } else if (entry.type === 'CREDIT') {
        if (entry.description.includes('win') || entry.description.includes('prize')) {
          stats.totalWins++;
          stats.totalWon += entry.amount;
        }
      }
    });
    
    stats.totalLosses = stats.totalBets - stats.totalWins;
    stats.netProfit = stats.totalWon - stats.totalWagered;
    stats.winRate = stats.totalBets > 0 ? (stats.totalWins / stats.totalBets) * 100 : 0;
    stats.averageBet = stats.totalBets > 0 ? stats.totalWagered / stats.totalBets : 0;
    
    res.json({
      stats,
      gameId: gameId || 'all',
      totalEntries: ledger.length
    });
  } catch (error) {
    console.error('[GamingController] Error getting game stats:', error);
    res.status(500).json({ message: 'Failed to get game statistics' });
  }
};

/**
 * Get game history
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const getGameHistory = async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const gameId = req.query.gameId || '';
    const date = req.query.date || '';
    
    let query = { ownerType: 'USER', ownerId: req.user._id };
    
    if (gameId) {
      query.description = { $regex: new RegExp(gameId, 'i') };
    }
    
    if (date) {
      const dayStart = startOfISTDayFromKey(date);
      const dayEnd = endOfISTDayFromKey(date);
      query.createdAt = { $gte: dayStart, $lte: dayEnd };
    }
    
    const history = await GamesWalletLedger.find(query)
      .sort({ createdAt: -1 })
      .limit(limit);
    
    res.json({
      history,
      total: history.length,
      query: { gameId, date, limit }
    });
  } catch (error) {
    console.error('[GamingController] Error getting game history:', error);
    res.status(500).json({ message: 'Failed to get game history' });
  }
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Place up/down bet
 */
async function placeUpDownBet(userId, gameId, amount, side, transactionId) {
  const BetModel = gameId === 'btcupdown' ? BtcNumberBet : NiftyNumberBet;
  
  return await BetModel.create({
    user: userId,
    amount,
    side,
    transactionId,
    status: 'PENDING',
    createdAt: new Date()
  });
}

/**
 * Place number bet
 */
async function placeNumberBet(userId, gameId, amount, prediction, transactionId) {
  const BetModel = gameId === 'btcNumber' ? BtcNumberBet : NiftyNumberBet;
  
  return await BetModel.create({
    user: userId,
    amount,
    prediction,
    transactionId,
    status: 'PENDING',
    createdAt: new Date()
  });
}

/**
 * Place bracket bet
 */
async function placeBracketBet(userId, amount, prediction, transactionId) {
  return await NiftyBracketTrade.create({
    user: userId,
    amount,
    prediction,
    transactionId,
    status: 'PENDING',
    createdAt: new Date()
  });
}

/**
 * Place jackpot bet
 */
async function placeJackpotBet(userId, gameId, amount, prediction, transactionId) {
  return await NiftyJackpotBid.create({
    user: userId,
    gameId,
    amount,
    prediction,
    transactionId,
    status: 'PENDING',
    createdAt: new Date()
  });
}

/**
 * Extract game ID from description
 */
function extractGameIdFromDescription(description) {
  const gameIds = ['updown', 'btcupdown', 'niftyNumber', 'btcNumber', 'niftyBracket', 'niftyJackpot', 'btcJackpot'];
  
  for (const gameId of gameIds) {
    if (description.toLowerCase().includes(gameId.toLowerCase())) {
      return gameId;
    }
  }
  
  return 'unknown';
}

// ==================== NIFTY JACKPOT CLEARING ====================

/**
 * Get last 5 days clearing for Nifty Number/Jackpot
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const getNiftyJackpotLast5DaysClearing = async (req, res) => {
  try {
    const today = istCalendarDateString();
    const now = new Date();
    const ltp = await fetchNifty50LastPriceFromKite();

    const candles = await fetchNifty50HistoricalFromKite({
      interval: 'day',
      daysBack: 45,
      maxCandles: 40,
    });

    const results = [];
    if (ltp != null && Number.isFinite(Number(ltp))) {
      results.push({
        date: today,
        closedAt: now.toISOString(),
        closingPrice: Number(ltp),
        source: 'Kite LTP (now)',
        isLive: true,
        note: 'Live NIFTY 50 LTP — reopen this list to refresh',
      });
    }

    if (!candles || candles.length === 0) {
      return res.json(results);
    }

    // Index one candle per calendar day (use latest time if duplicates)
    const byDay = new Map();
    for (const c of candles) {
      const dayKey = istCalendarDateString(new Date(c.time * 1000));
      const prev = byDay.get(dayKey);
      if (!prev || c.time > prev.time) {
        byDay.set(dayKey, { time: c.time, close: c.close });
      }
    }

    const weekdayCompleted = (dateStr) => {
      const d = new Date(`${dateStr}T12:00:00+05:30`);
      const w = d.getDay();
      return w !== 0 && w !== 6;
    };

    const historical = [...byDay.entries()]
      .filter(([d]) => d !== today && weekdayCompleted(d))
      .sort((a, b) => b[1].time - a[1].time)
      .map(([d, { time, close }]) => ({
        date: d,
        closedAt: new Date(time * 1000).toISOString(),
        closingPrice: close,
        source: 'Kite EOD close',
        isLive: false,
      }));

    const need = Math.max(0, 5 - results.length);
    results.push(...historical.slice(0, need));

    res.json(results);
  } catch (error) {
    console.error('[GamingController] Error fetching last 5 days clearing for Nifty Number/Jackpot:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Get last 5 days closing LTP for Nifty Bracket
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const getNiftyBracketLast5Days = async (req, res) => {
  try {
    const today = istCalendarDateString();
    const out = [];

    // Preferred source: Kite daily candles (true previous session closes).
    const candles = await fetchNifty50HistoricalFromKite({
      interval: 'day',
      daysBack: 45,
      maxCandles: 60,
    });

    const weekdayCompleted = (dateStr) => {
      const d = new Date(`${dateStr}T12:00:00+05:30`);
      const w = d.getDay();
      return w !== 0 && w !== 6;
    };

    if (Array.isArray(candles) && candles.length > 0) {
      const byDay = new Map();
      for (const c of candles) {
        const dayKey = istCalendarDateString(new Date(c.time * 1000));
        const prev = byDay.get(dayKey);
        if (!prev || c.time > prev.time) {
          byDay.set(dayKey, { time: c.time, close: c.close });
        }
      }

      const historical = [...byDay.entries()]
        .filter(([d]) => d !== today && weekdayCompleted(d))
        .sort((a, b) => b[1].time - a[1].time)
        .slice(0, 5)
        .map(([d, { time, close }]) => ({
          date: d,
          closingLTP: Number(close),
          closedAt: new Date(time * 1000).toISOString(),
          source: 'Kite day close',
        }));

      out.push(...historical);
    }

    return res.json(out.slice(0, 5));
  } catch (error) {
    console.error('[GamingController] Error fetching last 5 days LTP for Nifty Bracket:', error);
    return res.json([]);
  }
};

// ==================== NIFTY JACKPOT LEADERBOARD ====================

/**
 * Get Nifty Jackpot leaderboard
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
export const getNiftyJackpotLeaderboard = async (req, res) => {
  try {
    const date = req.query.date || istCalendarDateString();
    const nowIstParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const part = (t) => nowIstParts.find((p) => p.type === t)?.value;
    const weekday = String(part('weekday') || '');
    const secNow =
      Number(part('hour') || 0) * 3600 +
      Number(part('minute') || 0) * 60 +
      Number(part('second') || 0);
    const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday);
    const isNseOpen = isWeekday && secNow >= 33300 && secNow < 55800;

    const rawBids = await NiftyJackpotBid.find(buildNiftyJackpotIstDayQuery(date))
      .populate('user', 'name username')
      .limit(800);

    const jackpotResultDoc = await NiftyJackpotResult.findOne({ resultDate: date })
      .select('resultDeclared lockedPrice')
      .lean();
    const lockedPriceNum =
      jackpotResultDoc?.lockedPrice != null && Number.isFinite(Number(jackpotResultDoc.lockedPrice))
        ? Number(jackpotResultDoc.lockedPrice)
        : null;
    const resultDeclared = !!jackpotResultDoc?.resultDeclared;

    let referenceSpot = null;
    if (isNseOpen) {
      referenceSpot =
        req.query.spot != null && req.query.spot !== '' && Number.isFinite(Number(req.query.spot))
          ? Number(req.query.spot)
          : await resolveNiftyJackpotSpotPrice();
    } else {
      const clearing = await fetchNifty50SessionClearing15mCached();
      referenceSpot =
        clearing?.close != null && Number.isFinite(Number(clearing.close)) && Number(clearing.close) > 0
          ? Number(clearing.close)
          : await resolveNiftyJackpotSpotPrice();
    }

    // Fallback: if referenceSpot is still null, use a default value to ensure ranking works
    if (referenceSpot == null || !Number.isFinite(Number(referenceSpot)) || Number(referenceSpot) <= 0) {
      console.warn('[GamingController] No valid spot price resolved, using fallback');
    }

    const bidTimeMs = (b) => {
      if (b?.createdAt) return new Date(b.createdAt).getTime();
      if (b?._id?.getTimestamp?.()) return b._id.getTimestamp().getTime();
      return 0;
    };
    const validBidPrice = rawBids.find(
      (b) => b?.niftyPriceAtBid != null && Number.isFinite(Number(b.niftyPriceAtBid)) && Number(b.niftyPriceAtBid) > 0
    );
    const fallbackBidRef =
      validBidPrice?.niftyPriceAtBid != null ? Number(validBidPrice.niftyPriceAtBid) : null;

    const useLockedForRanking =
      resultDeclared && lockedPriceNum != null && lockedPriceNum > 0;
    const rankingRef = useLockedForRanking
      ? lockedPriceNum
      : (Number.isFinite(Number(referenceSpot)) && Number(referenceSpot) > 0
          ? Number(referenceSpot)
          : fallbackBidRef);

    const bids = sortJackpotBidsByDistanceToReference(rawBids, rankingRef);
    const uniquePlayerIds = new Set(
      bids.map((b) => (b.user && b.user._id ? String(b.user._id) : b.user ? String(b.user) : '')).filter(Boolean)
    );

    const settings = await GameSettings.getSettings();
    const gameConfig = settings.games?.niftyJackpot;
    const topWinners = gameConfig?.topWinners || 20;

    // Optional ?limit=N — return top N projected rows only (pool / myRank still use full sorted list)
    let leaderboardLimit = null;
    if (req.query.limit != null && String(req.query.limit).trim() !== '') {
      const ln = parseInt(String(req.query.limit), 10);
      if (Number.isFinite(ln) && ln > 0) {
        leaderboardLimit = Math.min(500, ln);
      }
    }
    const bidsForLeaderboard =
      leaderboardLimit != null ? bids.slice(0, leaderboardLimit) : bids;

    // Calculate total pool and prize percentages
    const totalPool = bids.reduce((sum, b) => sum + b.amount, 0);
    const brokeragePercent = gameConfig?.brokeragePercent ?? 0;
    const netPool = totalPool;

    const leaderboard = bidsForLeaderboard.map((bid, idx) => {
      const rank = idx + 1;
      const prizePercent = resolveJackpotPrizePercentForRank(rank, gameConfig);
      const prize = rank <= topWinners ? Math.round(netPool * prizePercent / 100) : 0;
      const bidTime = bid.createdAt || bid._id?.getTimestamp?.() || new Date();
      const refR = Number(rankingRef);
      const distRef =
        Number.isFinite(refR) && refR > 0 && bid.niftyPriceAtBid != null && Number.isFinite(Number(bid.niftyPriceAtBid))
          ? Math.abs(Number(bid.niftyPriceAtBid) - refR)
          : null;
      const refLive = Number(referenceSpot);
      const distLive =
        useLockedForRanking &&
        Number.isFinite(refLive) &&
        refLive > 0 &&
        bid.niftyPriceAtBid != null &&
        Number.isFinite(Number(bid.niftyPriceAtBid))
          ? Math.abs(Number(bid.niftyPriceAtBid) - refLive)
          : null;
      return {
        bidId: bid._id,
        rank,
        userId: bid.user?._id,
        name: bid.user?.name || bid.user?.username || 'Anonymous',
        amount: bid.amount,
        bidTime: bidTime,
        prizePercent,
        prize,
        isWinner: rank <= topWinners,
        status: bid.status,
        niftyPriceAtBid: bid.niftyPriceAtBid ?? null,
        distanceToReference: distRef,
        distanceToSpot: distRef,
        distanceToLiveSpot: distLive,
      };
    });

    const myId = String(req.user._id);
    let myRank = null;
    bids.forEach((b, i) => {
      const uid = b.user && b.user._id ? String(b.user._id) : b.user ? String(b.user) : '';
      if (uid === myId) {
        const r = i + 1;
        if (myRank === null || r < myRank) myRank = r;
      }
    });

    const myBids = await NiftyJackpotBid.find({
      $and: [{ user: req.user._id }, buildNiftyJackpotIstDayQuery(date)],
    }).sort({ createdAt: -1 });
    const myLatest = myBids[0];
    const oneTicketRs = Number(gameConfig?.ticketPrice || settings.tokenValue || 300);
    
    // Helper function for ticket units (inline since it's used only here)
    const niftyJackpotTicketUnitsForBid = (bid, oneTicketRs) => {
      if (!bid || !bid.amount) return 0;
      return Math.floor(bid.amount / oneTicketRs);
    };
    
    const myTicketsToday = myBids.reduce(
      (s, b) => s + niftyJackpotTicketUnitsForBid(b, oneTicketRs),
      0
    );

    const podiumIsOfficial = resultDeclared;
    const lockedForPodium = lockedPriceNum;

    let anonymousPodium = [];
    if (podiumIsOfficial) {
      const won = rawBids.filter((b) => b.status === 'won');
      let ordered;
      if (lockedForPodium != null && lockedForPodium > 0) {
        ordered = sortJackpotBidsByDistanceToReference(won, lockedForPodium);
      } else {
        ordered = [...won].sort((a, b) => {
          const ra = Number(a.rank);
          const rb = Number(b.rank);
          if (Number.isFinite(ra) && Number.isFinite(rb) && ra !== rb) return ra - rb;
          return bidTimeMs(a) - bidTimeMs(b);
        });
      }
      anonymousPodium = ordered.slice(0, 3).map((b) => ({
        niftyPriceAtBid: b.niftyPriceAtBid ?? null,
        bidTime: b.createdAt || b._id?.getTimestamp?.() || new Date(),
      }));
    } else {
      anonymousPodium = bids.slice(0, 3).map((b) => ({
        niftyPriceAtBid: b.niftyPriceAtBid ?? null,
        bidTime: b.createdAt || b._id?.getTimestamp?.() || new Date(),
      }));
    }

    res.json({
      date,
      referenceSpot: Number.isFinite(Number(referenceSpot)) ? Number(referenceSpot) : null,
      rankingReference:
        Number.isFinite(Number(rankingRef)) && Number(rankingRef) > 0 ? Number(rankingRef) : null,
      rankingMode: useLockedForRanking ? 'nearest_locked_close' : 'nearest_spot',
      podiumIsOfficial,
      anonymousPodium,
      totalBids: bids.length,
      ...(leaderboardLimit != null && { leaderboardLimit }),
      uniquePlayerCount: uniquePlayerIds.size,
      totalPool,
      netPool,
      brokeragePercent,
      topWinners,
      prizePercentages: gameConfig?.prizePercentages || null,
      leaderboard,
      myRank,
      myBid: myLatest
        ? {
            amount: myLatest.amount,
            bidTime: myLatest.createdAt,
            status: myLatest.status,
            rank: myLatest.rank,
            prize: myLatest.prize,
            niftyPriceAtBid: myLatest.niftyPriceAtBid ?? null,
          }
        : null,
      ticketsToday: myTicketsToday,
    });
  } catch (error) {
    console.error('[GamingController] Error fetching Nifty Jackpot leaderboard:', error);
    // Keep client stable (no 500 spam loop) with a safe empty payload.
    return res.json({
      date: req.query.date || istCalendarDateString(),
      referenceSpot: null,
      rankingReference: null,
      rankingMode: 'nearest_spot',
      podiumIsOfficial: false,
      anonymousPodium: [],
      totalBids: 0,
      uniquePlayerCount: 0,
      totalPool: 0,
      netPool: 0,
      brokeragePercent: 0,
      topWinners: 20,
      prizePercentages: null,
      leaderboard: [],
      myRank: null,
      myBid: null,
      ticketsToday: 0,
      degraded: true,
      message: error.message,
    });
  }
};
