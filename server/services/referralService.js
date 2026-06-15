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
 * Credit referral reward for every closed trade (% of brokerage paid by referred user).
 * @param {string} referredUserId - The user who traded
 * @param {number} brokerageAmount - Total brokerage the referred user paid on this trade
 * @param {string} tradeId - The trade ID
 * @param {string} segment - Trade segment ('mcx' | 'crypto' | 'forex' | 'trading')
 * @param {number} [referralPercent] - Override referral % of brokerage (default 10)
 */
export async function creditReferralTradingReward(referredUserId, brokerageAmount, tradeId, segment = 'trading', referralPercent = 10) {
  try {
    const referredUser = await User.findById(referredUserId);
    if (!referredUser || !referredUser.referredBy) {
      return { credited: false, reason: 'No referrer' };
    }

    if (referredUser.isDemo) {
      return { credited: false, reason: 'Demo users do not generate referral bonuses' };
    }

    const referralAllowed = await isReferralEnabledForUser(referredUserId, segment);
    if (!referralAllowed) {
      return { credited: false, reason: `Referral in ${segment} disabled for this hierarchy` };
    }

    const pct = Math.max(0, Math.min(100, Number(referralPercent) || 10));
    const commission = Math.round((brokerageAmount * pct / 100) * 100) / 100;
    if (commission <= 0) {
      return { credited: false, reason: 'Zero referral commission after percentage calc' };
    }

    // Track Super Admin earnings from this hierarchy
    try {
      await trackHierarchyEarnings(referredUser.admin, commission, segment);
    } catch (error) {
      console.error(`[ReferralTrading] Error tracking Super Admin earnings:`, error);
    }

    // Process referral commission with eligibility check
    const payoutResult = await processConditionalReferralPayout(
      referredUserId,
      commission,
      segment,
      {
        tradeId,
        referredUsername: referredUser.username,
        type: 'trade_referral',
        brokerageAmount,
        referralPercent: pct,
      }
    );

    if (payoutResult.success) {
      // Update referral record (accumulate, not just first win)
      await Referral.findOneAndUpdate(
        { referredUser: referredUserId },
        {
          $inc: { earnings: commission, 'tradingReferralCount': 1 },
          $push: {
            tradingReferrals: {
              tradeId,
              amount: commission,
              brokerageAmount,
              segment,
              creditedAt: new Date(),
            },
          },
        }
      );

      referredUser.referralStats.totalReferralEarnings = (referredUser.referralStats.totalReferralEarnings || 0) + commission;
      await referredUser.save();

      return { credited: true, amount: commission };
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
