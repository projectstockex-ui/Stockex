import User from '../models/User.js';
import Trade from '../models/Trade.js';

/**
 * Recalculate usedMargin from actual open positions
 * This ensures usedMargin is always accurate, not stale from database
 * 
 * @param {String} userId - User ID
 * @returns {Object} - Recalculated usedMargin values for all wallets
 */
export async function recalculateUsedMargin(userId) {
  try {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    // Calculate usedMargin from actual OPEN positions for regular wallet
    const openTrades = await Trade.find({
      user: userId,
      status: 'OPEN',
      isCrypto: { $ne: true },
      isForex: { $ne: true },
      exchange: { $nin: ['BINANCE', 'MCX', 'FOREX'] }
    });

    let calculatedUsedMargin = 0;
    for (const trade of openTrades) {
      calculatedUsedMargin += trade.marginUsed || trade.requiredMargin || 0;
    }

    // Calculate usedMargin for crypto wallet
    const openCryptoTrades = await Trade.find({
      user: userId,
      status: 'OPEN',
      $or: [{ isCrypto: true }, { exchange: 'BINANCE' }]
    });

    let cryptoUsedMargin = 0;
    for (const trade of openCryptoTrades) {
      cryptoUsedMargin += trade.marginUsed || trade.requiredMargin || 0;
    }

    // Calculate usedMargin for MCX wallet
    const openMcxTrades = await Trade.find({
      user: userId,
      status: 'OPEN',
      $or: [{ exchange: 'MCX' }, { segment: 'MCX' }, { segment: 'MCXFUT' }, { segment: 'MCXOPT' }]
    });

    let mcxUsedMargin = 0;
    for (const trade of openMcxTrades) {
      mcxUsedMargin += trade.marginUsed || trade.requiredMargin || 0;
    }

    // Calculate usedMargin for forex wallet
    const openForexTrades = await Trade.find({
      user: userId,
      status: 'OPEN',
      $or: [{ isForex: true }, { exchange: 'FOREX' }, { segment: 'FOREX' }, { segment: 'FOREXFUT' }, { segment: 'FOREXOPT' }]
    });

    let forexUsedMargin = 0;
    for (const trade of openForexTrades) {
      forexUsedMargin += trade.marginUsed || trade.requiredMargin || 0;
    }

    // Calculate usedMargin for games wallet
    const openGameBets = await Trade.find({
      user: userId,
      status: 'OPEN',
      $or: [
        { gameType: { $exists: true } },
        { isGame: true }
      ]
    });

    let gamesUsedMargin = 0;
    for (const bet of openGameBets) {
      gamesUsedMargin += bet.marginUsed || bet.requiredMargin || bet.amount || 0;
    }

    // Get current database values
    const dbUsedMargin = user.wallet.usedMargin || 0;
    const dbCryptoUsedMargin = user.cryptoWallet?.usedMargin || 0;
    const dbMcxUsedMargin = user.mcxWallet?.usedMargin || 0;
    const dbForexUsedMargin = user.forexWallet?.usedMargin || 0;
    const dbGamesUsedMargin = user.gamesWallet?.usedMargin || 0;

    // Update database if calculated values differ from stored values
    const updateFields = {};
    if (Math.abs(calculatedUsedMargin - dbUsedMargin) > 0.01) {
      updateFields['wallet.usedMargin'] = Math.round(calculatedUsedMargin * 100) / 100;
    }
    if (Math.abs(cryptoUsedMargin - dbCryptoUsedMargin) > 0.01) {
      updateFields['cryptoWallet.usedMargin'] = Math.round(cryptoUsedMargin * 100) / 100;
    }
    if (Math.abs(mcxUsedMargin - dbMcxUsedMargin) > 0.01) {
      updateFields['mcxWallet.usedMargin'] = Math.round(mcxUsedMargin * 100) / 100;
    }
    if (Math.abs(forexUsedMargin - dbForexUsedMargin) > 0.01) {
      updateFields['forexWallet.usedMargin'] = Math.round(forexUsedMargin * 100) / 100;
    }
    if (Math.abs(gamesUsedMargin - dbGamesUsedMargin) > 0.01) {
      updateFields['gamesWallet.usedMargin'] = Math.round(gamesUsedMargin * 100) / 100;
    }

    if (Object.keys(updateFields).length > 0) {
      await User.updateOne({ _id: userId }, { $set: updateFields });
      console.log(`[RecalculateUsedMargin] Updated usedMargin for user ${user.userId}:`, updateFields);
    }

    return {
      wallet: Math.round(calculatedUsedMargin * 100) / 100,
      cryptoWallet: Math.round(cryptoUsedMargin * 100) / 100,
      mcxWallet: Math.round(mcxUsedMargin * 100) / 100,
      forexWallet: Math.round(forexUsedMargin * 100) / 100,
      gamesWallet: Math.round(gamesUsedMargin * 100) / 100
    };
  } catch (error) {
    console.error('[RecalculateUsedMargin] Error:', error);
    throw error;
  }
}
