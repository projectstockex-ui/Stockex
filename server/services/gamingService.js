/**
 * Gaming Service
 * 
 * Clean architecture implementation for gaming business logic.
 * Handles game betting, winnings calculation, game statistics, and game validation.
 * 
 * Service Responsibilities:
 * 1. Game bet processing and validation
 * 2. Game winnings calculation and distribution
 * 3. Game statistics and analytics
 * 4. Game access control and validation
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
import { fetchNifty50LastPriceFromKite } from '../utils/kiteNiftyQuote.js';

// ==================== GAME BET PROCESSING ====================

/**
 * Process game bet with validation and wallet operations
 * @param {string} userId - User ID
 * @param {Object} betData - Bet data
 * @returns {Promise<Object>} - Processed bet result
 */
export const processGameBet = async (userId, betData) => {
  const { gameId, betType, amount, prediction, side } = betData;

  // Validate game access
  await validateGameAccess(userId, gameId);

  // Get and validate game settings
  const gameConfig = await getGameConfig(gameId);
  await validateBetAmount(amount, gameConfig);

  // Process wallet debit
  const walletResult = await processBetWalletDebit(userId, amount);
  if (!walletResult.success) {
    throw new Error(walletResult.message);
  }

  // Create transaction slip
  const transactionId = `GAME_${gameId}_${Date.now()}_${userId}`;
  const slip = await createTransactionSlip(transactionId, userId, gameId);

  // Add debit entry to transaction slip
  await addDebitEntry(slip._id, amount, `Game bet - ${gameId}`);

  // Record games wallet ledger
  await recordGamesWalletLedger(userId, 'DEBIT', amount, `Game bet - ${gameId}`, slip._id);

  // Create game-specific bet record
  const betRecord = await createGameBetRecord(userId, gameId, betData, slip._id);

  return {
    success: true,
    bet: {
      id: betRecord._id,
      gameId,
      amount,
      prediction,
      side,
      transactionId: slip._id,
      createdAt: betRecord.createdAt
    },
    newBalance: walletResult.newBalance
  };
};

/**
 * Validate game access for user
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID
 * @returns {Promise<void>}
 */
export const validateGameAccess = async (userId, gameId) => {
  await assertHierarchyGameNotDeniedForUserId(userId, gameId);
  
  // Additional validation based on game type
  switch (gameId) {
    case 'niftyJackpot':
    case 'btcJackpot':
      await validateJackpotAccess(userId, gameId);
      break;
    case 'niftyBracket':
      await validateBracketAccess(userId);
      break;
    case 'updown':
    case 'btcupdown':
      await validateUpDownAccess(userId, gameId);
      break;
  }
};

/**
 * Get game configuration
 * @param {string} gameId - Game ID
 * @returns {Promise<Object>} - Game configuration
 */
export const getGameConfig = async (gameId) => {
  const settings = await GameSettings.getSettings();
  const gameConfig = settings?.games?.[gameId];
  
  if (!gameConfig || !gameConfig.enabled) {
    throw new Error('Game is not available');
  }
  
  return gameConfig;
};

/**
 * Validate bet amount against game configuration
 * @param {number} amount - Bet amount
 * @param {Object} gameConfig - Game configuration
 * @returns {Promise<void>}
 */
export const validateBetAmount = async (amount, gameConfig) => {
  if (amount < gameConfig.minBet) {
    throw new Error(`Minimum bet amount is ${gameConfig.minBet}`);
  }
  
  if (amount > gameConfig.maxBet) {
    throw new Error(`Maximum bet amount is ${gameConfig.maxBet}`);
  }
};

/**
 * Process wallet debit for bet
 * @param {string} userId - User ID
 * @param {number} amount - Bet amount
 * @returns {Promise<Object>} - Wallet operation result
 */
export const processBetWalletDebit = async (userId, amount) => {
  await ensureGamesWallet(userId);
  return await atomicGamesWalletDebit(userId, amount);
};

/**
 * Create game-specific bet record
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID
 * @param {Object} betData - Bet data
 * @param {string} transactionId - Transaction ID
 * @returns {Promise<Object>} - Created bet record
 */
export const createGameBetRecord = async (userId, gameId, betData, transactionId) => {
  const { amount, prediction, side } = betData;

  switch (gameId) {
    case 'updown':
    case 'btcupdown':
      return await createUpDownBet(userId, gameId, amount, side, transactionId);
    case 'niftyNumber':
    case 'btcNumber':
      return await createNumberBet(userId, gameId, amount, prediction, transactionId);
    case 'niftyBracket':
      return await createBracketBet(userId, amount, prediction, transactionId);
    case 'niftyJackpot':
    case 'btcJackpot':
      return await createJackpotBet(userId, gameId, amount, prediction, transactionId);
    default:
      throw new Error('Invalid game type');
  }
};

// ==================== GAME WINNINGS CALCULATION ====================

/**
 * Calculate and distribute game winnings
 * @param {string} gameId - Game ID
 * @param {Object} resultData - Game result data
 * @returns {Promise<Object>} - Winnings distribution result
 */
export const calculateGameWinnings = async (gameId, resultData) => {
  switch (gameId) {
    case 'updown':
    case 'btcupdown':
      return await calculateUpDownWinnings(gameId, resultData);
    case 'niftyNumber':
    case 'btcNumber':
      return await calculateNumberWinnings(gameId, resultData);
    case 'niftyBracket':
      return await calculateBracketWinnings(resultData);
    case 'niftyJackpot':
    case 'btcJackpot':
      return await calculateJackpotWinnings(gameId, resultData);
    default:
      throw new Error('Invalid game type for winnings calculation');
  }
};

/**
 * Calculate up/down game winnings
 * @param {string} gameId - Game ID
 * @param {Object} resultData - Result data
 * @returns {Promise<Object>} - Winnings result
 */
export const calculateUpDownWinnings = async (gameId, resultData) => {
  const { result, winningSide, resultTime } = resultData;
  const BetModel = gameId === 'btcupdown' ? BtcNumberBet : NiftyNumberBet;
  
  // Find winning bets
  const winningBets = await BetModel.find({
    status: 'PENDING',
    side: winningSide
  });
  
  // Calculate winnings and distribute
  const winnings = await Promise.all(winningBets.map(async (bet) => {
    const winAmount = bet.amount * 2; // 2x payout for up/down
    await creditWinnings(bet.user, winAmount, `Up/Down win - ${gameId}`, bet._id);
    return {
      userId: bet.user,
      amount: winAmount,
      betId: bet._id
    };
  }));
  
  // Update bet statuses
  await BetModel.updateMany(
    { status: 'PENDING' },
    { 
      status: 'SETTLED',
      result,
      resultTime,
      settledAt: new Date()
    }
  );
  
  return {
    totalWinners: winningBets.length,
    totalWinnings: winnings.reduce((sum, w) => sum + w.amount, 0),
    winnings
  };
};

/**
 * Calculate number game winnings
 * @param {string} gameId - Game ID
 * @param {Object} resultData - Result data
 * @returns {Promise<Object>} - Winnings result
 */
export const calculateNumberWinnings = async (gameId, resultData) => {
  const { result, resultTime } = resultData;
  const BetModel = gameId === 'btcNumber' ? BtcNumberBet : NiftyNumberBet;
  
  // Find winning bets (exact match)
  const winningBets = await BetModel.find({
    status: 'PENDING',
    prediction: result
  });
  
  // Calculate winnings based on prize pool
  const totalPool = await BetModel.aggregate([
    { $match: { status: 'PENDING' } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  
  const poolAmount = totalPool[0]?.total || 0;
  const platformFee = poolAmount * 0.1; // 10% platform fee
  const prizePool = poolAmount - platformFee;
  
  const winnings = await Promise.all(winningBets.map(async (bet) => {
    const winAmount = Math.floor(prizePool / winningBets.length);
    await creditWinnings(bet.user, winAmount, `Number win - ${gameId}`, bet._id);
    return {
      userId: bet.user,
      amount: winAmount,
      betId: bet._id
    };
  }));
  
  // Update bet statuses
  await BetModel.updateMany(
    { status: 'PENDING' },
    { 
      status: 'SETTLED',
      result,
      resultTime,
      settledAt: new Date()
    }
  );
  
  return {
    totalWinners: winningBets.length,
    totalPool: poolAmount,
    platformFee,
    prizePool,
    totalWinnings: winnings.reduce((sum, w) => sum + w.amount, 0),
    winnings
  };
};

// ==================== GAME STATISTICS ====================

/**
 * Get game statistics for user
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (optional)
 * @returns {Promise<Object>} - Game statistics
 */
export const getGameStatistics = async (userId, gameId = '') => {
  let query = { ownerType: 'USER', ownerId: userId };
  
  if (gameId) {
    query.description = { $regex: new RegExp(gameId, 'i') };
  }
  
  const ledger = await GamesWalletLedger.find(query);
  
  const stats = {
    totalBets: 0,
    totalWins: 0,
    totalLosses: 0,
    totalWagered: 0,
    totalWon: 0,
    netProfit: 0,
    winRate: 0,
    averageBet: 0
  };
  
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
  
  return {
    stats,
    gameId: gameId || 'all',
    totalEntries: ledger.length
  };
};

/**
 * Get live game activity
 * @returns {Promise<Object>} - Live game activity data
 */
export const getLiveGameActivity = async () => {
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
  
  return {
    activity,
    timestamp: new Date(),
    settings: settings?.games || {}
  };
};

/**
 * Get game history for user
 * @param {string} userId - User ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} - Game history
 */
export const getGameHistory = async (userId, options = {}) => {
  const { limit = 50, gameId = '', date = '' } = options;
  
  let query = { ownerType: 'USER', ownerId: userId };
  
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
  
  return {
    history,
    total: history.length,
    query: { gameId, date, limit }
  };
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Create up/down bet
 */
async function createUpDownBet(userId, gameId, amount, side, transactionId) {
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
 * Create number bet
 */
async function createNumberBet(userId, gameId, amount, prediction, transactionId) {
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
 * Create bracket bet
 */
async function createBracketBet(userId, amount, prediction, transactionId) {
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
 * Create jackpot bet
 */
async function createJackpotBet(userId, gameId, amount, prediction, transactionId) {
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
 * Credit winnings to user
 */
async function creditWinnings(userId, amount, description, referenceId) {
  await atomicGamesWalletUpdate(userId, amount);
  await recordGamesWalletLedger(userId, 'CREDIT', amount, description, referenceId);
}

/**
 * Validate jackpot access
 */
async function validateJackpotAccess(userId, gameId) {
  // Check if bidding hours are valid
  const isBypassed = gameId === 'niftyJackpot' 
    ? isNiftyJackpotBiddingHoursBypassedForTesting()
    : true; // BTC jackpot might have different rules
  
  if (!isBypassed) {
    // Add time validation logic here
    const now = new Date();
    const hour = now.getHours();
    
    // Example: Jackpot bidding only allowed during specific hours
    if (hour < 9 || hour > 17) {
      throw new Error('Jackpot bidding is only allowed between 9 AM and 5 PM');
    }
  }
}

/**
 * Validate bracket access
 */
async function validateBracketAccess(userId) {
  const isBypassed = isNiftyBracketBiddingHoursBypassedForTesting();
  
  if (!isBypassed && !isCurrentTimeWithinBracketBiddingIST()) {
    throw new Error('Bracket trading is only allowed during specific hours');
  }
}

/**
 * Validate up/down access
 */
async function validateUpDownAccess(userId, gameId) {
  // Add any specific validation for up/down games
  // For now, no additional validation needed
}
