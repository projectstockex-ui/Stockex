import User from '../models/User.js';
import Referral from '../models/Referral.js';
import { creditReferralPercentOfTotalStake } from './referralGameStakeCredit.js';
import { 
  processConditionalReferralPayout 
} from './referralPayoutService.js';
import { 
  trackHierarchyEarnings 
} from './superAdminEarningsService.js';
import { isReferralEnabledForUser } from '../utils/referralDistributionHelper.js';

/**
 * Jackpot referral: winPercent × total prize pool (bank) that session — matches admin "% of bank".
 * `meta.referredUserStake`: optional audit field (referred user's summed stakes that day).
 * @param {string} referredUserId
 * @param {number} jackpotPoolBank - Total pool stakes for declare day (bank basis)
 * @param {'niftyJackpot'|'btcJackpot'} gameType
 * @param {number|null} rank - For top-rank referral settings
 * @param {{ settlementDay: string, sessionScope?: string, referredUserStake?: number }} meta
 */
export async function creditReferralGameReward(
  referredUserId,
  jackpotPoolBank,
  gameType,
  rank = null,
  meta = {}
) {
  const settlementDay = meta.settlementDay;
  const sessionScope = meta.sessionScope ?? 'declare';
  if (!settlementDay || !/^\d{4}-\d{2}-\d{2}$/.test(String(settlementDay).trim())) {
    return { credited: false, reason: 'settlementDay (YYYY-MM-DD) required for jackpot referral' };
  }
  return creditReferralPercentOfTotalStake({
    referredUserId,
    gameType,
    totalStake: jackpotPoolBank,
    settlementDay: String(settlementDay).trim(),
    sessionScope,
    rank,
    referredUserStake: meta.referredUserStake,
  });
}

/**
 * Credit referral reward for first trading win (brokerage amount)
 * @param {string} referredUserId - The user who won
 * @param {number} brokerageAmount - The brokerage amount
 * @param {string} tradeId - The trade ID
 */
export async function creditReferralTradingReward(referredUserId, brokerageAmount, tradeId) {
  try {
    const referredUser = await User.findById(referredUserId);
    if (!referredUser || !referredUser.referredBy) {
      return { credited: false, reason: 'No referrer' };
    }

    if (referredUser.isDemo) {
      return { credited: false, reason: 'Demo users do not generate referral bonuses' };
    }

    const referralAllowed = await isReferralEnabledForUser(referredUserId, 'trading');
    if (!referralAllowed) {
      return { credited: false, reason: 'Referral in trading disabled for this hierarchy' };
    }

    if (referredUser.referralStats?.firstTradingWin) {
      return { credited: false, reason: 'Already credited first trading win' };
    }

    if (referredUser.convertedToRealAt) {
      const oneMonthAfterConversion = new Date(referredUser.convertedToRealAt);
      oneMonthAfterConversion.setMonth(oneMonthAfterConversion.getMonth() + 1);
      const now = new Date();
      if (now > oneMonthAfterConversion) {
        return { credited: false, reason: 'First win window (1 month after conversion) has expired' };
      }
    }

    // Track Super Admin earnings from this hierarchy
    try {
      await trackHierarchyEarnings(referredUser.admin, brokerageAmount, 'trading');
    } catch (error) {
      console.error(`[ReferralTrading] Error tracking Super Admin earnings:`, error);
    }

    // Process referral commission with eligibility check
    const payoutResult = await processConditionalReferralPayout(
      referredUserId,
      brokerageAmount,
      'trading',
      {
        tradeId,
        referredUsername: referredUser.username,
        type: 'first_trading_win'
      }
    );

    if (payoutResult.success) {
      // Update referral record for first trading win
      await Referral.findOneAndUpdate(
        { referredUser: referredUserId },
        {
          $set: {
            'firstTradingWin.credited': true,
            'firstTradingWin.amount': brokerageAmount,
            'firstTradingWin.creditedAt': new Date(),
          },
          $inc: { earnings: brokerageAmount },
        }
      );

      referredUser.referralStats.firstTradingWin = true;
      referredUser.referralStats.totalReferralEarnings = (referredUser.referralStats.totalReferralEarnings || 0) + brokerageAmount;
      await referredUser.save();

      return { credited: true, amount: brokerageAmount };
    } else if (payoutResult.held) {
      console.log(`[ReferralTrading] Referral commission held: ${payoutResult.reason}`);
      return { credited: false, held: true, reason: payoutResult.reason };
    } else {
      console.log(`[ReferralTrading] Referral commission failed: ${payoutResult.reason}`);
      return { credited: false, reason: payoutResult.reason };
    }
  } catch (error) {
    console.error('Error crediting referral trading reward:', error);
    return { credited: false, reason: 'Error', error: error.message };
  }
}
