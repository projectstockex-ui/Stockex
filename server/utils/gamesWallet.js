/**
 * Ensure nested gamesWallet exists with numeric fields (legacy users / partial docs).
 * Call user.markModified('gamesWallet') after mutating nested fields so Mongoose persists changes.
 */
export function ensureGamesWallet(user) {
  if (!user.gamesWallet || typeof user.gamesWallet !== 'object') {
    user.gamesWallet = {
      balance: 0,
      usedMargin: 0,
      realizedPnL: 0,
      unrealizedPnL: 0,
      todayRealizedPnL: 0,
      todayUnrealizedPnL: 0,
    };
  }
  const g = user.gamesWallet;
  g.balance = Number(g.balance) || 0;
  g.usedMargin = Number(g.usedMargin) || 0;
  g.realizedPnL = Number(g.realizedPnL) || 0;
  g.unrealizedPnL = Number(g.unrealizedPnL) || 0;
  g.todayRealizedPnL = Number(g.todayRealizedPnL) || 0;
  g.todayUnrealizedPnL = Number(g.todayUnrealizedPnL) || 0;
}

export function touchGamesWallet(user) {
  ensureGamesWallet(user);
  user.markModified('gamesWallet');
}

/**
 * Atomically increment / decrement gamesWallet fields using MongoDB $inc.
 * This avoids the load-modify-save race condition that can overwrite concurrent credits.
 *
 * @param {Model}  User        – Mongoose User model
 * @param {ObjectId} userId    – _id of the user
 * @param {Object} increments  – e.g. { balance: 500, usedMargin: -500, realizedPnL: 200, todayRealizedPnL: 200 }
 * @returns {Object}           – the updated gamesWallet sub-document
 */
export async function atomicGamesWalletUpdate(User, userId, increments) {
  let effectiveIncrements = increments;
  const user = await User.findById(userId)
    .select('gamesWallet.profitBlocked wallet.tradingWalletBlocked')
    .lean();
  const { isWalletProfitBlocked, applyProfitBlockToIncrements } = await import('./walletBlock.js');
  if (isWalletProfitBlocked(user, 'games')) {
    const hasCredit = Object.values(increments || {}).some((v) => Number(v) > 0);
    if (hasCredit) {
      throw new Error('Games wallet is disabled. Contact admin.');
    }
    effectiveIncrements = applyProfitBlockToIncrements(user, 'games', increments);
  } else {
    const hasPositiveProfit = ['balance', 'realizedPnL', 'todayRealizedPnL', 'totalRealizedPnL'].some(
      (k) => Number(increments?.[k]) > 0
    );
    if (hasPositiveProfit) {
      effectiveIncrements = applyProfitBlockToIncrements(user, 'games', increments);
    }
  }

  const $inc = {};
  for (const [key, val] of Object.entries(effectiveIncrements)) {
    if (Number.isFinite(val) && val !== 0) {
      $inc[`gamesWallet.${key}`] = val;
    }
  }
  if (Object.keys($inc).length === 0) {
    const u = await User.findById(userId).select('gamesWallet').lean();
    return u?.gamesWallet || { balance: 0, usedMargin: 0 };
  }
  const updated = await User.findByIdAndUpdate(
    userId,
    { $inc },
    { new: true, select: 'gamesWallet' }
  );
  return updated?.gamesWallet || { balance: 0, usedMargin: 0 };
}

/**
 * Atomically debit the gamesWallet only if sufficient balance exists.
 * Uses a MongoDB filter condition so the update fails (returns null) when balance is too low.
 *
 * @param {Model}  User
 * @param {ObjectId} userId
 * @param {Number} amount       – positive amount to debit
 * @param {Object} extraInc     – optional extra $inc fields (e.g. { usedMargin: amount })
 * @returns {Object|null}       – updated gamesWallet, or null if insufficient balance
 */
export async function atomicGamesWalletDebit(User, userId, amount, extraInc = {}) {
  const user = await User.findById(userId)
    .select('gamesWallet.profitBlocked wallet.tradingWalletBlocked')
    .lean();
  const { isWalletProfitBlocked } = await import('./walletBlock.js');
  if (isWalletProfitBlocked(user, 'games')) {
    throw new Error('Games wallet is disabled. Contact admin.');
  }

  const $inc = { 'gamesWallet.balance': -amount };
  for (const [key, val] of Object.entries(extraInc)) {
    if (Number.isFinite(val) && val !== 0) {
      $inc[`gamesWallet.${key}`] = val;
    }
  }
  const updated = await User.findOneAndUpdate(
    { _id: userId, 'gamesWallet.balance': { $gte: amount } },
    { $inc },
    { new: true, select: 'gamesWallet' }
  );
  return updated?.gamesWallet || null;
}

/**
 * Wallet transfer out of games: allow full stamped balance; clamp usedMargin to the new balance.
 *
 * @returns {Object|null} updated gamesWallet or null if insufficient balance
 */
export async function atomicGamesWalletDebitForTransfer(User, userId, amount) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return null;

  const user = await User.findById(userId)
    .select('gamesWallet.profitBlocked wallet.tradingWalletBlocked')
    .lean();
  const { isWalletProfitBlocked } = await import('./walletBlock.js');
  if (isWalletProfitBlocked(user, 'games')) {
    throw new Error('Games wallet is disabled. Contact admin.');
  }

  const updated = await User.findOneAndUpdate(
    { _id: userId, 'gamesWallet.balance': { $gte: amt } },
    [
      {
        $set: {
          'gamesWallet.balance': {
            $subtract: [{ $toDouble: { $ifNull: ['$gamesWallet.balance', 0] } }, amt],
          },
          'gamesWallet.usedMargin': {
            $min: [
              { $toDouble: { $ifNull: ['$gamesWallet.usedMargin', 0] } },
              {
                $subtract: [{ $toDouble: { $ifNull: ['$gamesWallet.balance', 0] } }, amt],
              },
            ],
          },
        },
      },
    ],
    { new: true, select: 'gamesWallet' }
  );

  return updated?.gamesWallet || null;
}
