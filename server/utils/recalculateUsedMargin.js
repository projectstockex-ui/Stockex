import User from '../models/User.js';
import Trade from '../models/Trade.js';

/** OPEN + PENDING both reserve margin until fill or cancel. */
const MARGIN_BLOCKING_STATUSES = ['OPEN', 'PENDING'];

function sumTradeMargin(trades) {
  let total = 0;
  for (const trade of trades) {
    total += trade.marginUsed || trade.requiredMargin || 0;
    if (trade.brokerageReservedInMargin) {
      total += Number(trade.commission) || 0;
    }
  }
  return total;
}

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
      status: { $in: MARGIN_BLOCKING_STATUSES },
      isCrypto: { $ne: true },
      isForex: { $ne: true },
      exchange: { $nin: ['BINANCE', 'MCX', 'FOREX'] }
    });

    const calculatedUsedMargin = sumTradeMargin(openTrades);

    const openCryptoTrades = await Trade.find({
      user: userId,
      status: { $in: MARGIN_BLOCKING_STATUSES },
      $or: [{ isCrypto: true }, { exchange: 'BINANCE' }]
    });

    const cryptoUsedMargin = sumTradeMargin(openCryptoTrades);

    const openMcxTrades = await Trade.find({
      user: userId,
      status: { $in: MARGIN_BLOCKING_STATUSES },
      $or: [{ exchange: 'MCX' }, { segment: 'MCX' }, { segment: 'MCXFUT' }, { segment: 'MCXOPT' }]
    });

    const mcxUsedMargin = sumTradeMargin(openMcxTrades);

    const openForexTrades = await Trade.find({
      user: userId,
      status: { $in: MARGIN_BLOCKING_STATUSES },
      $or: [{ isForex: true }, { exchange: 'FOREX' }, { segment: 'FOREX' }, { segment: 'FOREXFUT' }, { segment: 'FOREXOPT' }]
    });

    const forexUsedMargin = sumTradeMargin(openForexTrades);

    const openGameBets = await Trade.find({
      user: userId,
      status: { $in: MARGIN_BLOCKING_STATUSES },
      $or: [
        { gameType: { $exists: true } },
        { isGame: true }
      ]
    });

    let gamesUsedMargin = 0;
    for (const bet of openGameBets) {
      gamesUsedMargin += bet.marginUsed || bet.requiredMargin || bet.amount || 0;
    }

    // Get current database values (legacy wallet.usedMargin only when nseBseWallet.usedMargin unset)
    const legacyWalletUm = Number(user.wallet?.usedMargin) || 0;
    const nseStoredUm = user.nseBseWallet?.usedMargin;
    const dbUsedMargin =
      nseStoredUm != null && nseStoredUm !== ''
        ? Number(nseStoredUm) || 0
        : legacyWalletUm;
    const dbCryptoUsedMargin = user.cryptoWallet?.usedMargin || 0;
    const dbMcxUsedMargin = user.mcxWallet?.usedMargin || 0;
    const dbForexUsedMargin = user.forexWallet?.usedMargin || 0;
    const dbGamesUsedMargin = user.gamesWallet?.usedMargin || 0;

    // Update database if calculated values differ from stored values
    const updateFields = {};
    if (Math.abs(calculatedUsedMargin - dbUsedMargin) > 0.01) {
      updateFields['nseBseWallet.usedMargin'] = Math.round(calculatedUsedMargin * 100) / 100;
    }
    // Clear legacy wallet.usedMargin when NSE margin is recalculated or was wrongly stored on wallet.
    if (legacyWalletUm > 0.01 && (updateFields['nseBseWallet.usedMargin'] != null || calculatedUsedMargin < 0.01)) {
      updateFields['wallet.usedMargin'] = 0;
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
      nseBseWallet: Math.round(calculatedUsedMargin * 100) / 100,
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
