import mongoose from 'mongoose';
import { getTodayISTString, startOfISTDayFromKey, endOfISTDayFromKey } from '../utils/istDate.js';

const gameResultSchema = new mongoose.Schema({
  gameId: {
    type: String,
    enum: ['updown', 'btcupdown'],
    required: true,
    index: true
  },
  windowNumber: {
    type: Number,
    required: true,
    index: true
  },
  windowDate: {
    type: Date,
    required: true,
    index: true
  },
  openPrice: {
    type: Number,
    required: true
  },
  closePrice: {
    type: Number,
    required: true
  },
  result: {
    type: String,
    enum: ['UP', 'DOWN', 'TIE'],
    required: true
  },
  priceChange: {
    type: Number,
    default: 0
  },
  priceChangePercent: {
    type: Number,
    default: 0
  },
  totalBets: {
    type: Number,
    default: 0
  },
  totalUpBets: {
    type: Number,
    default: 0
  },
  totalDownBets: {
    type: Number,
    default: 0
  },
  totalVolume: {
    type: Number,
    default: 0
  },
  windowStartTime: {
    type: String,
    required: true
  },
  windowEndTime: {
    type: String,
    required: true
  },
  resultTime: {
    type: Date,
    default: Date.now
  },
  // Enhanced fields for complete data tracking
  priceSource: {
    type: String,
    enum: ['live_websocket', 'binance', 'cache', 'kite', 'forced'],
    default: 'live_websocket'
  },
  settlementCompleted: {
    type: Boolean,
    default: true
  },
  settlementProcessedAt: {
    type: Date,
    default: Date.now
  },
  // Additional metadata for debugging
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true });

// Compound index for efficient queries
gameResultSchema.index({ gameId: 1, windowDate: -1, windowNumber: -1 });

// Static method to get recent results
gameResultSchema.statics.getRecentResults = async function(gameId, limit = 20) {
  return this.find({ gameId })
    .sort({ windowDate: -1, windowNumber: -1 })
    .limit(limit)
    .lean();
};

// Static method to get today's results (IST calendar day)
gameResultSchema.statics.getTodayResults = async function(gameId) {
  const key = getTodayISTString();
  const start = startOfISTDayFromKey(key);
  const end = endOfISTDayFromKey(key);
  if (!start || !end) return [];
  
  console.log(`[GameResult] Fetching ${gameId} results for ${key} (${start} to ${end})`);
  
  const results = await this.find({
    gameId,
    windowDate: { $gte: start, $lt: end },
  })
    .sort({ windowNumber: -1 })
    .lean();
    
  console.log(`[GameResult] Found ${results.length} results for ${gameId} today`);
  
  return results;
};

// Static method to get recent results with fallback to previous days
gameResultSchema.statics.getRecentResultsWithFallback = async function(gameId, limit = 20) {
  const today = getTodayISTString();
  const todayStart = startOfISTDayFromKey(today);
  const todayEnd = endOfISTDayFromKey(today);
  
  console.log(`[GameResult] Fetching results for ${gameId} with limit ${limit}`);
  
  // Always try to get most recent results regardless of date
  const recentResults = await this.find({ gameId })
    .sort({ windowDate: -1, windowNumber: -1 })
    .limit(limit)
    .lean();
    
  console.log(`[GameResult] Found ${recentResults.length} total recent results for ${gameId}`);
  
  // If we have recent results, return them
  if (recentResults.length > 0) {
    // Log the latest result for debugging
    const latest = recentResults[0];
    console.log(`[GameResult] Latest result: Window #${latest.windowNumber}, Result: ${latest.result}, Price: ${latest.closePrice}, Date: ${latest.windowDate}`);
    return recentResults;
  }
  
  // If no results at all, return empty array
  console.log(`[GameResult] No results found for ${gameId} in database`);
  return [];
};

const GameResult = mongoose.model('GameResult', gameResultSchema);

export default GameResult;
