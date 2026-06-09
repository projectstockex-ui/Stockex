/**
 * Shared games referral: winPercent from GameSettings.
 * - BTC/Nifty Up/Down: % × one ticket price (game ticketPrice or global tokenValue).
 * - Nifty Number: same — % × one ticket only (does not scale with bets placed that day).
 * - Other games: % × total stake for the session (bracket / declare day).
 * - Nifty/BTC Jackpot: % × total pool (bank) for that declare session.
 * First win only per (referred user, gameKey). Session idempotency: (referred user, gameKey, day, sessionScope).
 */
import mongoose from 'mongoose';
import User from '../models/User.js';
import Referral from '../models/Referral.js';
import GameSettings from '../models/GameSettings.js';
import WalletLedger from '../models/WalletLedger.js';
import { isReferralEnabledForUser } from '../utils/referralDistributionHelper.js';

const GAME_LABELS = {
  btcUpDown: 'BTC Up/Down',
  niftyUpDown: 'Nifty Up/Down',
  niftyNumber: 'Nifty Number',
  btcNumber: 'BTC Number',
  niftyBracket: 'Nifty Bracket',
  niftyJackpot: 'Nifty Jackpot',
  btcJackpot: 'BTC Jackpot',
};

function labelFor(gameType) {
  return GAME_LABELS[gameType] || String(gameType);
}

/** meta.relatedUserId is sometimes stored as ObjectId, sometimes as string — match both. */
function metaRelatedUserIdMatch(referredOid, referredUserIdRaw) {
  const strings = new Set();
  if (referredOid != null) strings.add(String(referredOid));
  if (referredUserIdRaw != null) strings.add(String(referredUserIdRaw));
  const $in = [];
  for (const s of strings) {
    if (mongoose.Types.ObjectId.isValid(s)) {
      $in.push(new mongoose.Types.ObjectId(s));
    }
    $in.push(s);
  }
  if ($in.length === 0) return undefined;
  return $in.length === 1 ? $in[0] : { $in };
}

/**
 * @param {object} params
 * @param {import('mongoose').Types.ObjectId|string} params.referredUserId
 * @param {string} params.gameType - GameSettings games.* key
 * @param {number} params.totalStake - Session total stake OR jackpot pool bank (jackpot referral "% of bank")
 * @param {string} params.settlementDay - YYYY-MM-DD (IST calendar anchor)
 * @param {string} params.sessionScope - Unique within day+game: e.g. `w42`, `declare`, or trade id
 * @param {number|null} [params.rank] - Optional rank for jackpot top-N settings
 * @param {number|undefined} [params.referredUserStake] - Referred user stake sum (audit; jackpot basis is totalStake pool)
 * @returns {Promise<{ credited: boolean, amount?: number, reason?: string, error?: string }>}
 */
export async function creditReferralPercentOfTotalStake({
  referredUserId,
  gameType,
  totalStake,
  settlementDay,
  sessionScope,
  rank = null,
  referredUserStake = undefined,
}) {
  try {
    const stake = Number(totalStake);
    if (!Number.isFinite(stake) || stake <= 0) {
      return { credited: false, reason: 'Invalid total stake' };
    }
    const day = String(settlementDay || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return { credited: false, reason: 'Invalid settlementDay' };
    }
    const scope = String(sessionScope || '').trim();
    if (!scope) {
      return { credited: false, reason: 'sessionScope required' };
    }

    const referredUser = await User.findById(referredUserId);
    if (!referredUser || !referredUser.referredBy) {
      return { credited: false, reason: 'No referrer' };
    }
    if (referredUser.isDemo) {
      return { credited: false, reason: 'Demo users do not generate referral bonuses' };
    }

    const referralAllowed = await isReferralEnabledForUser(referredUserId, 'games');
    if (!referralAllowed) {
      return { credited: false, reason: 'Referral in games disabled for this hierarchy' };
    }

    if (referredUser.convertedToRealAt) {
      const oneMonthAfter = new Date(referredUser.convertedToRealAt);
      oneMonthAfter.setMonth(oneMonthAfter.getMonth() + 1);
      if (new Date() > oneMonthAfter) {
        return { credited: false, reason: 'Referral window (1 month after conversion) has expired' };
      }
    }

    const settings = await GameSettings.getSettings();
    const gameConfig = settings?.games?.[gameType];
    if (!gameConfig) {
      return { credited: false, reason: 'Unknown game in settings' };
    }
    const referralConfig = gameConfig?.referralDistribution || {};

    if (referralConfig.topRanksOnly && rank != null) {
      const topN = Number(referralConfig.topRanksCount);
      if (Number.isFinite(topN) && topN > 0 && rank > topN) {
        return { credited: false, reason: `Not in top ${topN}` };
      }
    }

    if (rank != null && !referralConfig.topRanksOnly && rank > 10) {
      return { credited: false, reason: 'Not in top 10' };
    }

    const rewardPercent = Number(referralConfig.winPercent);
    if (!Number.isFinite(rewardPercent) || rewardPercent <= 0) {
      return { credited: false, reason: 'Referral win percent is zero or unset' };
    }

    const referredOid =
      typeof referredUserId === 'string' && mongoose.Types.ObjectId.isValid(referredUserId)
        ? new mongoose.Types.ObjectId(referredUserId)
        : referredUserId;

    const relatedIdCond = metaRelatedUserIdMatch(referredOid, referredUserId);
    if (relatedIdCond == null) {
      return { credited: false, reason: 'Invalid referred user id' };
    }

    // First win per (referred user, gameKey). `meta.kind` was omitted from WalletLedger schema until fix,
    // so also match legacy rows by description (stake/ticket referrals only use "Referral bonus:" here).
    const priorStakeReferralThisGame = await WalletLedger.findOne({
      ownerType: 'USER',
      reason: 'REFERRAL_COMMISSION',
      type: 'CREDIT',
      'meta.relatedUserId': relatedIdCond,
      'meta.gameKey': gameType,
      $or: [{ 'meta.kind': 'game_stake_referral' }, { description: { $regex: /^Referral bonus:/i } }],
    }).lean();
    if (priorStakeReferralThisGame) {
      return {
        credited: false,
        reason: 'Stake referral already paid once for this referred user in this game (first win only)',
      };
    }

    const existing = await WalletLedger.findOne({
      ownerType: 'USER',
      reason: 'REFERRAL_COMMISSION',
      type: 'CREDIT',
      'meta.kind': 'game_stake_referral',
      'meta.relatedUserId': relatedIdCond,
      'meta.gameKey': gameType,
      'meta.settlementDay': day,
      'meta.sessionScope': scope,
    }).lean();
    if (existing) {
      return { credited: false, reason: 'Already credited for this session' };
    }

    const referrer = await User.findById(referredUser.referredBy);
    if (!referrer) {
      return { credited: false, reason: 'Referrer not found' };
    }

    const isUpDown = gameType === 'btcUpDown' || gameType === 'niftyUpDown';
    /** Admin UI "% of ticket price"; match Up/Down (single ticket base, not total session stake). */
    const isNiftyNumberTicketBase = gameType === 'niftyNumber';
    const isJackpotPool = gameType === 'niftyJackpot' || gameType === 'btcJackpot';
    let referralBaseAmount;
    let referralBaseKind;
    if (isUpDown || isNiftyNumberTicketBase) {
      const ticket =
        gameConfig?.ticketPrice != null && Number.isFinite(Number(gameConfig.ticketPrice))
          ? Number(gameConfig.ticketPrice)
          : Number(settings?.tokenValue) > 0
            ? Number(settings.tokenValue)
            : 300;
      referralBaseAmount = ticket;
      referralBaseKind = 'single_ticket';
    } else if (isJackpotPool) {
      referralBaseAmount = stake;
      referralBaseKind = 'jackpot_pool_bank';
    } else {
      referralBaseAmount = stake;
      referralBaseKind = 'total_session_stake';
    }

    const rewardAmount = parseFloat(((referralBaseAmount * rewardPercent) / 100).toFixed(2));
    if (rewardAmount <= 0) {
      return { credited: false, reason: 'Zero reward' };
    }

    const gl = labelFor(gameType);
    const rankBit = rank != null ? ` (rank ${rank})` : '';
    const baseDesc =
      isUpDown || isNiftyNumberTicketBase
        ? `${rewardPercent}% of one ticket (${referralBaseAmount.toFixed(2)})`
        : isJackpotPool
          ? `${rewardPercent}% of prize pool/bank (${referralBaseAmount.toFixed(2)})`
          : `${rewardPercent}% of total stake (${stake.toFixed(2)})`;
    const description = `Referral bonus: ${baseDesc} — ${referredUser.username} in ${gl}${rankBit} · ${day} · ${scope}`;

    referrer.wallet = referrer.wallet || {};
    referrer.wallet.cashBalance = (referrer.wallet.cashBalance || 0) + rewardAmount;
    referrer.wallet.tradingBalance = (referrer.wallet.tradingBalance || 0) + rewardAmount;
    referrer.wallet.realizedPnL = (referrer.wallet.realizedPnL || 0) + rewardAmount;
    referrer.wallet.todayRealizedPnL = (referrer.wallet.todayRealizedPnL || 0) + rewardAmount;
    referrer.wallet.balance = (referrer.wallet.balance || 0) + rewardAmount;
    referrer.referralStats = referrer.referralStats || {};
    referrer.referralStats.totalReferralEarnings =
      (referrer.referralStats.totalReferralEarnings || 0) + rewardAmount;
    await referrer.save();

    await WalletLedger.create({
      ownerType: 'USER',
      ownerId: referrer._id,
      userId: referrer._id,
      username: referrer.username,
      type: 'CREDIT',
      reason: 'REFERRAL_COMMISSION',
      amount: rewardAmount,
      balanceAfter: referrer.wallet.balance,
      description,
      meta: {
        profitKind: 'REFERRAL_COMMISSION',
        gameKey: gameType,
        relatedUserId: referredOid,
        segment: 'games',
        rewardPercent,
        kind: 'game_stake_referral',
        settlementDay: day,
        sessionScope: scope,
        referralBase: referralBaseKind,
        totalStakeInSession:
          referredUserStake != null && Number.isFinite(Number(referredUserStake))
            ? Number(referredUserStake)
            : isJackpotPool
              ? undefined
              : stake,
        ...(isJackpotPool ? { jackpotPoolBank: referralBaseAmount } : {}),
        ...(isUpDown || isNiftyNumberTicketBase ? { ticketPrice: referralBaseAmount } : {}),
        referredUsername: referredUser.username,
        ...(rank != null ? { rank } : {}),
      },
    });

    await Referral.findOneAndUpdate({ referredUser: referredOid }, { $inc: { earnings: rewardAmount } });

    return { credited: true, amount: rewardAmount };
  } catch (error) {
    console.error('[creditReferralPercentOfTotalStake]', error);
    return { credited: false, reason: 'Error', error: error.message };
  }
}
