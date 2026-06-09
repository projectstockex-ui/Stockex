import mongoose from 'mongoose';

import BtcJackpotBid from '../models/BtcJackpotBid.js';
import BtcJackpotResult from '../models/BtcJackpotResult.js';
import BtcJackpotBank from '../models/BtcJackpotBank.js';
import GameSettings from '../models/GameSettings.js';
import User from '../models/User.js';

import { btcJackpotDayFilter } from '../utils/btcJackpotDay.js';
import {
  rankBtcJackpotBids,
  buildTieGroupedRanks,
  percentOfRankFromConfig,
} from '../utils/btcJackpotRanking.js';
import {
  debitSuperAdminForBtcJackpotPayout,
} from '../utils/btcJackpotPool.js';
import { atomicGamesWalletUpdate } from '../utils/gamesWallet.js';
import { recordGamesWalletLedger } from '../utils/gamesWalletLedger.js';
import { creditReferralGameReward } from './referralService.js';
import { buildGameProfitLedgerMeta } from './gameProfitDistribution.js';

export class BtcJackpotDeclareError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'BtcJackpotDeclareError';
    this.statusCode = statusCode;
  }
}

function round2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

/**
 * Build the hierarchy plan for a single winner from the populated User document.
 * Returns which sub-broker / broker / admin receives what  (percent-of-grossPrize).
 * Admins above are looked up by walking `user.admin` (who may themselves have a parent).
 */
async function resolveHierarchyForUser(userDoc, grossPrize, gc) {
  const sbPct = Number(gc?.hierarchy?.subBrokerPercent) || 0;
  const brPct = Number(gc?.hierarchy?.brokerPercent) || 0;
  const adPct = Number(gc?.hierarchy?.adminPercent) || 0;

  const emptyMember = () => ({ id: null, name: null, amount: 0 });
  const plan = {
    subBroker: emptyMember(),
    broker: emptyMember(),
    admin: emptyMember(),
    superAdmin: emptyMember(),
    total: 0,
  };

  if (!userDoc || !Number.isFinite(grossPrize) || grossPrize <= 0) return plan;
  if (sbPct + brPct + adPct <= 0) return plan;

  // user.admin is usually the immediate managing admin — could be a sub-broker, broker, or admin tier.
  const immediate = userDoc.admin;
  if (!immediate && !userDoc.adminCode) return plan;

  // Walk up the chain through Admin.parentId to at most 4 tiers (stops at SUPER_ADMIN).
  const Admin = (await import('../models/Admin.js')).default;
  const selectFields = '+role +parentId +status +adminCode +username +wallet +receivesHierarchyBrokerage';
  let node =
    immediate && typeof immediate === 'object' && immediate._id
      ? immediate
      : immediate
      ? await Admin.findById(immediate).select(selectFields).lean()
      : userDoc.adminCode
      ? await Admin.findOne({ adminCode: userDoc.adminCode, status: 'ACTIVE' }).select(selectFields).lean()
      : null;

  const chain = [];
  let safety = 5;
  while (node && safety-- > 0) {
    chain.push(node);
    if (String(node.role || '').toUpperCase() === 'SUPER_ADMIN' || !node.parentId) break;
    // eslint-disable-next-line no-await-in-loop
    node = await Admin.findById(node.parentId).select(selectFields).lean();
  }

  const byRole = (role) => chain.find((a) => String(a.role || '').toUpperCase() === role) || null;

  const sb = byRole('SUB_BROKER');
  const br = byRole('BROKER');
  const ad = byRole('ADMIN');
  const saInChain = byRole('SUPER_ADMIN');

  const hasSubBroker = !!sb;
  const hasBroker = !!br;
  const hasAdmin = !!ad;

  const subBrokerShareToBroker = gc?.subBrokerShareToBroker ?? true;

  let sbAmt = round2((grossPrize * sbPct) / 100);
  let brAmt = round2((grossPrize * brPct) / 100);
  let adAmt = round2((grossPrize * adPct) / 100);
  let saAmt = 0;

  if (!hasSubBroker) {
    if (subBrokerShareToBroker && hasBroker) brAmt = round2(brAmt + sbAmt);
    else if (hasAdmin) adAmt = round2(adAmt + sbAmt);
    else saAmt = round2(saAmt + sbAmt);
    sbAmt = 0;
  }
  if (!hasBroker) {
    if (hasAdmin) adAmt = round2(adAmt + brAmt);
    else saAmt = round2(saAmt + brAmt);
    brAmt = 0;
  }
  if (!hasAdmin) {
    saAmt = round2(saAmt + adAmt);
    adAmt = 0;
  }

  let totalHierarchy = round2(sbAmt + brAmt + adAmt + saAmt);
  if (totalHierarchy > grossPrize) {
    const scale = grossPrize / totalHierarchy;
    sbAmt = round2(sbAmt * scale);
    brAmt = round2(brAmt * scale);
    adAmt = round2(adAmt * scale);
    saAmt = round2(saAmt * scale);
    totalHierarchy = round2(sbAmt + brAmt + adAmt + saAmt);
  }

  if (hasSubBroker && sbAmt > 0) {
    plan.subBroker = {
      id: sb._id,
      name: sb.username || sb.name || null,
      amount: sbAmt,
    };
  }
  if (hasBroker && brAmt > 0) {
    plan.broker = {
      id: br._id,
      name: br.username || br.name || null,
      amount: brAmt,
    };
  }
  if (hasAdmin && adAmt > 0) {
    plan.admin = {
      id: ad._id,
      name: ad.username || ad.name || null,
      amount: adAmt,
    };
  }
  if (saAmt > 0) {
    const saDoc =
      saInChain ||
      (await Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' }).select(selectFields).lean());
    if (saDoc) {
      plan.superAdmin = {
        id: saDoc._id,
        name: saDoc.username || saDoc.name || null,
        amount: saAmt,
      };
    }
  }

  plan.total = round2(
    plan.subBroker.amount + plan.broker.amount + plan.admin.amount + plan.superAdmin.amount
  );
  return plan;
}

/**
 * Credit a hierarchy member's main wallet amount (funded from Super Admin pool).
 * Recorded as a WalletLedger CREDIT row on that admin + a matching DEBIT on Super Admin.
 * @param {{ grossPrize: number, role: string }} [ledger] — for Share % in admin wallet ledger (base = user gross prize for this win)
 */
async function creditHierarchyMember(adminMember, amount, gameLabel, winnerUserId, ledger = null) {
  const amt = round2(amount);
  if (!adminMember?.id || !Number.isFinite(amt) || amt <= 0) return { credited: 0 };

  const Admin = (await import('../models/Admin.js')).default;
  const WalletLedger = (await import('../models/WalletLedger.js')).default;

  const updated = await Admin.findByIdAndUpdate(
    adminMember.id,
    { $inc: { 'wallet.balance': amt } },
    { new: true, select: 'wallet adminCode username role' }
  );

  if (!updated) return { credited: 0 };

  const G = round2(ledger?.grossPrize ?? 0);
  const roleLabel = ledger?.role || 'HIERARCHY';
  const pctOfGross =
    G > 0 && Number.isFinite(amt) ? parseFloat(((amt / G) * 100).toFixed(2)) : 0;
  const description =
    G > 0
      ? `${gameLabel} win brokerage — ${roleLabel} (${pctOfGross.toFixed(2)}% of ${G.toFixed(2)})`
      : `${gameLabel} — hierarchy brokerage`;

  const baseMeta = buildGameProfitLedgerMeta(amt, G, 'BTC_JACKPOT_HIERARCHY', 'btcJackpot', null, winnerUserId);
  const meta = { ...baseMeta, hierarchyRole: roleLabel, gameKey: 'btcJackpot' };

  await WalletLedger.create({
    ownerType: 'ADMIN',
    ownerId: updated._id,
    adminCode: updated.adminCode,
    type: 'CREDIT',
    reason: 'GAME_PROFIT',
    amount: amt,
    balanceAfter: updated.wallet?.balance ?? 0,
    description,
    meta,
  });

  // Mirror DEBIT on Super Admin pool (player + recipient role = visible in SA wallet ledger)
  await debitSuperAdminForBtcJackpotPayout(amt, `${gameLabel} — hierarchy brokerage to ${updated.username || updated.role}`, {
    relatedUserId: winnerUserId,
    profitKind: 'BTC_JACKPOT_HIERARCHY',
    hierarchyPayoutToRole: roleLabel,
  });

  return { credited: amt };
}

/**
 * Declare BTC Jackpot result for an IST date.
 *
 * Flow:
 *  1. Load GameSettings, BtcJackpotResult, and all pending bids for the day.
 *  2. Rank by |predictedBtc - lockedBtcPrice| ASC; tie groups share combined %.
 *  3. For each winner: credit full grossPrize from SA pool to games wallet; credit hierarchy
 *     from SA pool; referral winPercent × that user's total stake for the day (once per user per declare).
 *  4. Losers remain 'lost' (stake already went to Bank at bid time — no further movement).
 *  5. Update BtcJackpotResult + BtcJackpotBank.
 */
export async function declareBtcJackpotForDate(date) {
  if (!date) throw new BtcJackpotDeclareError('Date is required');

  const settings = await GameSettings.getSettings();
  const gc = settings?.games?.btcJackpot;
  if (!gc) throw new BtcJackpotDeclareError('BTC Jackpot settings not configured', 500);

  const resultDoc = await BtcJackpotResult.findOne({ resultDate: date });
  if (!resultDoc || !Number.isFinite(Number(resultDoc.lockedBtcPrice)) || resultDoc.lockedBtcPrice <= 0) {
    throw new BtcJackpotDeclareError('Lock the BTC closing price for this date before declaring the result.');
  }
  if (resultDoc.resultDeclared) {
    throw new BtcJackpotDeclareError('Result already declared for this date', 409);
  }

  const lockedPrice = Number(resultDoc.lockedBtcPrice);

  const pendingRaw = await BtcJackpotBid.find({
    $and: [{ status: 'pending' }, btcJackpotDayFilter(date)],
  });
  if (pendingRaw.length === 0) {
    throw new BtcJackpotDeclareError('No pending bids found for this date');
  }

  const totalPool = pendingRaw.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const stakeByUser = new Map();
  for (const b of pendingRaw) {
    const uid = b.user.toString();
    stakeByUser.set(uid, (stakeByUser.get(uid) || 0) + (Number(b.amount) || 0));
  }
  const sorted = rankBtcJackpotBids(pendingRaw, lockedPrice);
  const groups = buildTieGroupedRanks(sorted, lockedPrice, (r) =>
    percentOfRankFromConfig(r, gc.prizePercentages)
  );

  let winnersCount = 0;
  let losersCount = 0;
  let totalPaidOut = 0;
  let totalHierarchyPaid = 0;
  const prizeDistribution = [];
  const winnersForBank = [];

  // Assign prizes group-by-group
  for (const g of groups) {
    const perBidPct = Number(g.perBidPct) || 0;
    const perBidGross = perBidPct > 0 ? round2((totalPool * perBidPct) / 100) : 0;

    for (let k = 0; k < g.bids.length; k++) {
      const bid = g.bids[k];
      const rankDisplay = g.startRank + k;
      bid.rank = rankDisplay;
      bid.resultDeclaredAt = new Date();
      bid.isTied = g.tied;
      bid.tiedGroupSize = g.bids.length;

      if (perBidGross > 0) {
        const userDoc = await User.findById(bid.user).populate('admin').lean();

        // 1. Pay gross prize from SA pool to user's games wallet
        const payout = await debitSuperAdminForBtcJackpotPayout(
          perBidGross,
          `BTC Jackpot — rank ${rankDisplay} prize to user`,
          { relatedUserId: bid.user, profitKind: 'BTC_JACKPOT_PRIZE', rank: rankDisplay }
        );
        if (!payout?.ok) {
          console.error(`[BTC Jackpot] SA pool debit failed for user ${bid.user} payout ${perBidGross}`);
        }

        const gwAfter = await atomicGamesWalletUpdate(User, bid.user, {
          balance: perBidGross,
          realizedPnL: perBidGross - (Number(bid.amount) || 0),
          todayRealizedPnL: perBidGross - (Number(bid.amount) || 0),
        });

        // 2. Hierarchy brokerage (from SA pool — not deducted from user; point 11, 13)
        const plan = await resolveHierarchyForUser(userDoc, perBidGross, gc);
        let hierarchyPaidForBid = 0;
        if (plan.subBroker.amount > 0) {
          const r = await creditHierarchyMember(plan.subBroker, plan.subBroker.amount, 'BTC Jackpot', bid.user, {
            grossPrize: perBidGross,
            role: 'SUB_BROKER',
          });
          hierarchyPaidForBid += r.credited || 0;
        }
        if (plan.broker.amount > 0) {
          const r = await creditHierarchyMember(plan.broker, plan.broker.amount, 'BTC Jackpot', bid.user, {
            grossPrize: perBidGross,
            role: 'BROKER',
          });
          hierarchyPaidForBid += r.credited || 0;
        }
        if (plan.admin.amount > 0) {
          const r = await creditHierarchyMember(plan.admin, plan.admin.amount, 'BTC Jackpot', bid.user, {
            grossPrize: perBidGross,
            role: 'ADMIN',
          });
          hierarchyPaidForBid += r.credited || 0;
        }
        if (plan.superAdmin.amount > 0) {
          const r = await creditHierarchyMember(
            plan.superAdmin,
            plan.superAdmin.amount,
            'BTC Jackpot',
            bid.user,
            { grossPrize: perBidGross, role: 'SUPER_ADMIN' }
          );
          hierarchyPaidForBid += r.credited || 0;
        }

        bid.status = 'won';
        bid.grossPrize = perBidGross;
        bid.prize = perBidGross;
        bid.brokerageDeducted = round2(hierarchyPaidForBid);
        bid.winnerBrokerageDistribution = {
          subBroker: plan.subBroker,
          broker: plan.broker,
          admin: plan.admin,
        };

        /** Games-wallet ledger recorded after brokerage so SA admin UI can show total hierarchy brokerage (same sum as tier splits). */
        await recordGamesWalletLedger(bid.user, {
          gameId: 'btcJackpot',
          entryType: 'credit',
          amount: perBidGross,
          balanceAfter: Number(gwAfter?.balance) || 0,
          description: `BTC Jackpot — rank ${rankDisplay} prize${g.tied ? ` (tied ×${g.bids.length})` : ''}`,
          meta: {
            won: true,
            bidId: bid._id,
            betDate: date,
            rank: rankDisplay,
            predictedBtc: bid.predictedBtc,
            lockedBtcPrice: lockedPrice,
            grossPrize: perBidGross,
            poolPercent: perBidPct,
            tied: g.tied,
            tiedGroupSize: g.bids.length,
            brokeragePaidFromPool: round2(hierarchyPaidForBid),
            brokerageBreakdown: {
              subBroker: round2(plan.subBroker.amount || 0),
              broker: round2(plan.broker.amount || 0),
              admin: round2(plan.admin.amount || 0),
              superAdmin: round2(plan.superAdmin.amount || 0),
            },
          },
        });

        totalPaidOut += perBidGross;
        totalHierarchyPaid += hierarchyPaidForBid;
        winnersCount += 1;

        prizeDistribution.push({
          rank: rankDisplay,
          bidId: bid._id,
          userId: bid.user,
          prize: perBidGross,
          predictedBtc: bid.predictedBtc,
          tiedWith: g.bids.length - 1,
        });
        winnersForBank.push({
          bidId: bid._id,
          userId: bid.user,
          rank: rankDisplay,
          prize: perBidGross,
          predictedBtc: bid.predictedBtc,
        });

        // 3. Referral: winPercent × pool (bank); first credited win per referred user × btcJackpot in referralGameStakeCredit
        try {
          const userTotalStake = stakeByUser.get(bid.user.toString()) || 0;
          await creditReferralGameReward(bid.user, totalPool, 'btcJackpot', rankDisplay, {
            settlementDay: date,
            referredUserStake: userTotalStake,
          });
        } catch (e) {
          console.warn('[BTC Jackpot] referral credit error:', e?.message || e);
        }
      } else {
        bid.status = 'lost';
        bid.prize = 0;
        bid.grossPrize = 0;
        losersCount += 1;
      }

      await bid.save();
    }
  }

  resultDoc.resultDeclared = true;
  resultDoc.resultDeclaredAt = new Date();
  resultDoc.totalBids = pendingRaw.length;
  resultDoc.totalPool = round2(totalPool);
  resultDoc.totalWinners = winnersCount;
  resultDoc.totalPaidOut = round2(totalPaidOut);
  resultDoc.totalHierarchyPaid = round2(totalHierarchyPaid);
  resultDoc.prizeDistribution = prizeDistribution;
  await resultDoc.save();

  await BtcJackpotBank.findOneAndUpdate(
    { betDate: date },
    {
      $set: {
        resultDeclared: true,
        resultDeclaredAt: new Date(),
        lockedBtcPrice: lockedPrice,
        totalPaidOut: round2(totalPaidOut),
        totalHierarchyPaid: round2(totalHierarchyPaid),
        winners: winnersForBank,
      },
    },
    { upsert: true, new: true }
  );

  return {
    date,
    lockedBtcPrice: lockedPrice,
    summary: {
      totalBids: pendingRaw.length,
      totalPool: round2(totalPool),
      winnersCount,
      losersCount,
      totalPaidOut: round2(totalPaidOut),
      totalHierarchyPaid: round2(totalHierarchyPaid),
    },
  };
}

// Guard against mongoose-unused-import lints in ESM build
export const __mongooseRef = mongoose;
