import GameSettings from '../models/GameSettings.js';
import NiftyJackpotBid from '../models/NiftyJackpotBid.js';
import { buildNiftyJackpotIstDayQuery } from '../utils/niftyJackpotDayScope.js';
import NiftyJackpotResult from '../models/NiftyJackpotResult.js';
import User from '../models/User.js';
import { sortJackpotBidsByDistanceToReference } from '../utils/niftyJackpotRank.js';
import { resolveJackpotPrizePercentForRank } from '../utils/niftyJackpotPrize.js';
import { debitBtcUpDownSuperAdminPool } from '../utils/btcUpDownSuperAdminPool.js';
import { atomicGamesWalletUpdate } from '../utils/gamesWallet.js';
import { recordGamesWalletLedger } from '../utils/gamesWalletLedger.js';
import {
  distributeWinBrokerage,
  computeNiftyJackpotGrossHierarchyBreakdown,
  creditNiftyJackpotGrossHierarchyFromPool,
} from './gameProfitDistribution.js';
import { creditReferralGameReward } from './referralService.js';

export class NiftyJackpotDeclareError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'NiftyJackpotDeclareError';
    this.statusCode = statusCode;
  }
}

/**
 * Declare Nifty Jackpot for a calendar date (IST YYYY-MM-DD). Requires locked price.
 * @returns {Promise<{ date: string, closingPrice: number, summary: object }>}
 */
export async function declareNiftyJackpotResult(date) {
  if (!date) {
    throw new NiftyJackpotDeclareError('Date is required');
  }

  const settings = await GameSettings.getSettings();
  const gc = settings.games?.niftyJackpot;
  const topWinners = gc?.topWinners || 20;

  const getPrizePercent = (rank) => resolveJackpotPrizePercentForRank(rank, gc);

  const jackpotResultDoc = await NiftyJackpotResult.findOne({ resultDate: date });
  if (!jackpotResultDoc || jackpotResultDoc.lockedPrice == null || !Number.isFinite(Number(jackpotResultDoc.lockedPrice))) {
    throw new NiftyJackpotDeclareError(
      'Lock the Nifty closing price for this date before declaring the result.'
    );
  }
  const closingPrice = Number(jackpotResultDoc.lockedPrice);

  const pendingRaw = await NiftyJackpotBid.find({
    $and: [{ status: 'pending' }, buildNiftyJackpotIstDayQuery(date)],
  });
  const pendingBids = sortJackpotBidsByDistanceToReference(pendingRaw, closingPrice);
  if (pendingBids.length === 0) {
    throw new NiftyJackpotDeclareError('No pending bids found for this date');
  }

  const totalPool = pendingBids.reduce((sum, b) => sum + b.amount, 0);
  const stakeByUser = new Map();
  for (const b of pendingBids) {
    const uid = b.user.toString();
    stakeByUser.set(uid, (stakeByUser.get(uid) || 0) + Number(b.amount || 0));
  }
  let totalBrokerageAccrued = 0;
  const netPool = totalPool;

  const brokeragePercentSetting = Number(gc?.brokeragePercent);
  const brokeragePercent =
    Number.isFinite(brokeragePercentSetting) && brokeragePercentSetting > 0 ? brokeragePercentSetting : 0;

  const grossHierarchyPctSum =
    (Number(gc?.grossPrizeSubBrokerPercent) || 0) +
    (Number(gc?.grossPrizeBrokerPercent) || 0) +
    (Number(gc?.grossPrizeAdminPercent) || 0);
  const useGrossPrizeHierarchy = grossHierarchyPctSum > 0;

  /**
   * Prize ladder by sorted list position (same as Super Admin "Proj. Prize"):
   * index 0 → rank 1 → full % for rank 1; equal distance → order by earlier `createdAt`
   * (sortJackpotBidsByDistanceToReference). No merged-rank % split across tied distances.
   * Prize distribution goes to top 20 based on prize ladder (ranks 1-20 get prizes).
   */
  const bidPrizeMap = new Map();
  for (let i = 0; i < pendingBids.length; i++) {
    const listRank = i + 1;
    const pct = getPrizePercent(listRank); // Get prize % for this rank (0 if rank > 20)
    const bid = pendingBids[i];
    bidPrizeMap.set(bid._id.toString(), {
      displayRank: listRank,
      actualRank: listRank,
      grossPrizePercent: pct,
      isTied: false,
      tiedWith: 0,
    });
  }

  let winnersCount = 0;
  let losersCount = 0;
  let totalPaidOut = 0;
  let totalCollected = 0;
  let totalBrokerageDistributed = 0;

  for (let i = 0; i < pendingBids.length; i++) {
    const bid = pendingBids[i];
    const prizeInfo = bidPrizeMap.get(bid._id.toString());
    bid.rank = prizeInfo.displayRank;
    bid.resultDeclaredAt = new Date();

    const user = await User.findById(bid.user).populate('admin');

    if (prizeInfo.grossPrizePercent > 0) {
      const grossPrize = Math.round(netPool * prizeInfo.grossPrizePercent / 100);
      let totalWinnerBrokerage = 0;
      let grossBreakdown = null;

      if (useGrossPrizeHierarchy && user) {
        grossBreakdown = await computeNiftyJackpotGrossHierarchyBreakdown(user, grossPrize, gc);
        totalWinnerBrokerage = grossBreakdown.totalHierarchy;
        if (totalWinnerBrokerage > grossPrize) totalWinnerBrokerage = grossPrize;
      } else if (brokeragePercent > 0) {
        totalWinnerBrokerage = parseFloat(((grossPrize * brokeragePercent) / 100).toFixed(2));
        if (totalWinnerBrokerage > grossPrize) totalWinnerBrokerage = grossPrize;
      }

      const prizeCredit = parseFloat(Number(grossPrize).toFixed(2));
      bid.status = 'won';
      bid.prize = prizeCredit;
      bid.grossPrize = grossPrize;
      bid.brokerageDeducted = totalWinnerBrokerage;

      if (user) {
        const winnerRoundPnL = parseFloat((grossPrize - bid.amount).toFixed(2));
        const { profitAllowedForWallet } = await import('../utils/walletBlock.js');
        const allowedPnL = profitAllowedForWallet(user, 'games', winnerRoundPnL);
        const balanceCredit = parseFloat((bid.amount + allowedPnL).toFixed(2));
        const poolPay = await debitBtcUpDownSuperAdminPool(
          prizeCredit,
          `Nifty Jackpot — pay winner gross prize (rank ${bid.rank})`
        );
        if (!poolPay.ok) {
          console.error(
            `[Nifty Jackpot] Super Admin pool debit failed for user ${bid.user} payout ₹${prizeCredit}`
          );
        }

        await User.updateOne(
          { _id: bid.user },
          {
            $inc: {
              'gamesWallet.balance': balanceCredit,
              'gamesWallet.usedMargin': -bid.amount,
              'gamesWallet.realizedPnL': allowedPnL,
              'gamesWallet.todayRealizedPnL': allowedPnL,
            },
          }
        );

        const uAfter = await User.findById(bid.user).select('gamesWallet.balance').lean();
        const balAfter = Number(uAfter?.gamesWallet?.balance) || 0;

        await recordGamesWalletLedger(bid.user, {
          gameId: 'niftyJackpot',
          entryType: 'credit',
          amount: balanceCredit,
          balanceAfter: balAfter,
          description: 'Nifty Jackpot — prize payout (gross; stake not returned; hierarchy from pool)',
          orderPlacedAt: bid.createdAt,
          meta: {
            bidId: bid._id,
            rank: bid.rank,
            grossPrize,
            brokerageDeducted: totalWinnerBrokerage,
            grossPrizeHierarchy: useGrossPrizeHierarchy,
            hierarchyPaidFromPoolExtra: totalWinnerBrokerage > 0,
            payoutIncludesStake: false,
            stakeAmount: bid.amount,
          },
        });

        if (useGrossPrizeHierarchy && totalWinnerBrokerage > 0 && grossBreakdown) {
          const cred = await creditNiftyJackpotGrossHierarchyFromPool(bid.user, user, grossBreakdown, {
            gameLabel: 'Nifty Jackpot',
            gameKey: 'niftyJackpot',
            logTag: 'JackpotGrossHierarchy',
          });
          if (cred.poolOk) {
            totalBrokerageDistributed += cred.totalDistributed;
            totalBrokerageAccrued += cred.totalDistributed;
          }
        } else if (totalWinnerBrokerage > 0) {
          await distributeWinBrokerage(
            bid.user,
            user,
            totalWinnerBrokerage,
            'Nifty Jackpot',
            'niftyJackpot',
            {
              fundFromBtcPool: true,
              ledgerGameId: 'niftyJackpot',
              skipUserRebate: true,
            }
          );
          totalBrokerageDistributed += totalWinnerBrokerage;
          totalBrokerageAccrued += totalWinnerBrokerage;
        }

        // Referral: winPercent × pool (bank); first credited win per referred user × niftyJackpot in referralGameStakeCredit
        if (bid.rank <= 10) {
          const userTotalStake = stakeByUser.get(bid.user.toString()) || 0;
          const referralResult = await creditReferralGameReward(
            bid.user,
            totalPool,
            'niftyJackpot',
            bid.rank,
            { settlementDay: date, referredUserStake: userTotalStake }
          );
          if (referralResult.credited) {
            console.log(
              `[Referral] Credited ₹${referralResult.amount} to referrer for ${bid.user} Nifty Jackpot (rank ${bid.rank}, pool ₹${totalPool}, referred stake ₹${userTotalStake})`
            );
          }
        }
      }

      totalPaidOut += prizeCredit;
      winnersCount++;
    } else {
      bid.status = 'lost';
      bid.prize = 0;

      if (user) {
        await atomicGamesWalletUpdate(User, bid.user, {
          usedMargin: -bid.amount,
          realizedPnL: -bid.amount,
          todayRealizedPnL: -bid.amount,
        });
      }

      totalCollected += bid.amount;
      losersCount++;
    }

    await bid.save();
  }

  if (jackpotResultDoc) {
    jackpotResultDoc.resultDeclared = true;
    jackpotResultDoc.resultDeclaredAt = new Date();
    jackpotResultDoc.totalPool = totalPool;
    jackpotResultDoc.totalBrokerage = totalBrokerageAccrued;
    jackpotResultDoc.netPool = netPool;
    await jackpotResultDoc.save();
  }

  const summary = {
    totalBids: pendingBids.length,
    totalPool,
    totalBrokerage: totalBrokerageAccrued,
    netPool,
    winners: winnersCount,
    losers: losersCount,
    totalPaidOut,
    totalCollected,
    totalBrokerageDistributed,
  };

  return { date, closingPrice, summary };
}
