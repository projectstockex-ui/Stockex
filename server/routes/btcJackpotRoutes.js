import express from 'express';
import mongoose from 'mongoose';

import { protectUser } from '../middleware/auth.js';
import User from '../models/User.js';
import GameSettings from '../models/GameSettings.js';
import BtcJackpotBid from '../models/BtcJackpotBid.js';
import BtcJackpotBank from '../models/BtcJackpotBank.js';
import BtcJackpotResult from '../models/BtcJackpotResult.js';

import { btcJackpotDayFilter } from '../utils/btcJackpotDay.js';
import { atomicGamesWalletDebit, atomicGamesWalletUpdate } from '../utils/gamesWallet.js';
import { recordGamesWalletLedger } from '../utils/gamesWalletLedger.js';
import { getTodayISTString } from '../utils/istDate.js';
import { getLiveBtcSpotForJackpot } from '../utils/btcJackpotSpot.js';
import {
  rankBtcJackpotBids,
  buildTieGroupedRanks,
  percentOfRankFromConfig,
  absDist,
} from '../utils/btcJackpotRanking.js';
import {
  evaluateBtcJackpotBiddingWindow,
  btcJackpotBiddingWindowUserMessage,
} from '../utils/btcJackpotBiddingWindow.js';
import {
  creditSuperAdminForBtcJackpotStake,
  rollbackBtcJackpotStakeCredit,
} from '../utils/btcJackpotPool.js';
import { assertHierarchyGameNotDeniedForUserId } from '../services/gameRestrictionService.js';

const router = express.Router();

/* ----------------------------- helpers ----------------------------- */

function istNowHhmmss() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const pick = (t) => parts.find((p) => p.type === t)?.value || '00';
  return `${pick('hour')}:${pick('minute')}:${pick('second')}`;
}

function parsePredictedBtc(raw) {
  if (raw == null || raw === '') return { ok: false, error: 'Predicted BTC price is required' };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { ok: false, error: 'Predicted BTC price must be a number' };
  if (n < 1 || n > 10_000_000) return { ok: false, error: 'Predicted BTC price out of sane range (1 – 10,000,000)' };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

function maskUsername(u) {
  const s = String(u || '').trim();
  if (!s) return 'Player';
  if (s.length <= 3) return s[0] + '*'.repeat(Math.max(s.length - 1, 1));
  return s.slice(0, 2) + '*'.repeat(Math.max(s.length - 4, 1)) + s.slice(-2);
}

/* ----------------------------- routes ----------------------------- */

/**
 * GET /api/user/btc-jackpot/config
 * Public-safe slice of game settings (prize ladder, times, ticket price, enabled flag).
 */
router.get('/config', protectUser, async (req, res) => {
  try {
    const settings = await GameSettings.getSettings();
    const gc = settings?.games?.btcJackpot || null;
    if (!gc) return res.json({ enabled: false });

    res.json({
      enabled: gc.enabled !== false,
      name: gc.name || 'BTC Jackpot',
      description: gc.description,
      ticketPrice: Number(gc.ticketPrice) || 500,
      minTickets: Number(gc.minTickets) || 1,
      maxTicketsPerRequest: Number(gc.maxTicketsPerRequest) || 1,
      bidsPerDay: Number(gc.bidsPerDay) || 200,
      topWinners: Number(gc.topWinners) || 20,
      biddingStartTime: gc.biddingStartTime || '00:00',
      biddingEndTime: gc.biddingEndTime || '23:29',
      prizePercentages: Array.isArray(gc.prizePercentages) ? gc.prizePercentages : [],
      hierarchy: gc.hierarchy || null,
      referralDistribution: gc.referralDistribution || null,
    });
  } catch (err) {
    console.error('[btc-jackpot/config]', err);
    res.status(500).json({ message: err.message });
  }
});

/**
 * GET /api/user/btc-jackpot/bank?date=YYYY-MM-DD
 * Bank stats for an IST date (defaults to today).
 */
router.get('/bank', protectUser, async (req, res) => {
  try {
    const date = String(req.query.date || '').match(/^\d{4}-\d{2}-\d{2}$/)
      ? String(req.query.date)
      : getTodayISTString();

    const [bank, bidsAgg] = await Promise.all([
      BtcJackpotBank.findOne({ betDate: date }).lean(),
      BtcJackpotBid.aggregate([
        { $match: { $and: [btcJackpotDayFilter(date)] } },
        {
          $group: {
            _id: null,
            totalStake: { $sum: '$amount' },
            bidsCount: { $sum: 1 },
            pendingCount: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const agg = bidsAgg[0] || {};
    res.json({
      date,
      totalStake: Number(bank?.totalStake) || Number(agg.totalStake) || 0,
      bidsCount: Number(bank?.bidsCount) || Number(agg.bidsCount) || 0,
      pendingCount: Number(agg.pendingCount) || 0,
      lockedBtcPrice: bank?.lockedBtcPrice ?? null,
      lockedAt: bank?.lockedAt ?? null,
      resultDeclared: !!bank?.resultDeclared,
      resultDeclaredAt: bank?.resultDeclaredAt ?? null,
      winners: bank?.winners || [],
      totalPaidOut: Number(bank?.totalPaidOut) || 0,
    });
  } catch (err) {
    console.error('[btc-jackpot/bank]', err);
    res.status(500).json({ message: err.message });
  }
});

/**
 * POST /api/user/btc-jackpot/bid
 * Body: { predictedBtc, tickets? }
 * Validates, debits games wallet, credits Super Admin Bank, creates BtcJackpotBid.
 */
router.post('/bid', protectUser, async (req, res) => {
  try {
    const userId = req.user._id;
    const settings = await GameSettings.getSettings();
    const gc = settings?.games?.btcJackpot;
    if (!gc || gc.enabled === false) {
      return res.status(400).json({ message: 'BTC Jackpot is currently disabled' });
    }
    if (settings?.gamesEnabled === false || settings?.maintenanceMode === true) {
      return res.status(400).json({ message: 'Games are currently unavailable' });
    }

    try {
      await assertHierarchyGameNotDeniedForUserId(userId, 'btcJackpot');
    } catch (e) {
      return res.status(403).json({ message: e.message });
    }

    const win = evaluateBtcJackpotBiddingWindow(gc);
    if (!win.ok) {
      return res.status(400).json({
        message: btcJackpotBiddingWindowUserMessage(gc, win.reason),
      });
    }

    const priceParse = parsePredictedBtc(req.body?.predictedBtc);
    if (!priceParse.ok) return res.status(400).json({ message: priceParse.error });
    const predictedBtc = priceParse.value;

    const ticketPrice = Number(gc.ticketPrice) || 500;
    if (!Number.isFinite(ticketPrice) || ticketPrice <= 0) {
      return res.status(500).json({ message: 'Invalid ticket price configuration' });
    }

    const tickets = Math.max(1, Math.min(Number(gc.maxTicketsPerRequest) || 1, parseInt(req.body?.tickets, 10) || 1));
    const amount = ticketPrice * tickets;

    // Daily bid-count cap
    const today = getTodayISTString();
    const bidsToday = await BtcJackpotBid.countDocuments({
      $and: [{ user: userId }, btcJackpotDayFilter(today)],
    });
    const maxBidsPerDay = Math.max(1, Math.min(5000, Number(gc.bidsPerDay) || 200));
    if (bidsToday + 1 > maxBidsPerDay) {
      return res.status(400).json({
        message: `Maximum ${maxBidsPerDay} BTC Jackpot bid(s) per day (${bidsToday} already placed). Try again tomorrow.`,
      });
    }

    // 1. Atomic debit of games wallet (fails on insufficient balance — point 2)
    const gw = await atomicGamesWalletDebit(User, userId, amount, { usedMargin: amount });
    if (!gw) {
      return res.status(400).json({ message: 'Insufficient balance in games wallet' });
    }

    // 2. Credit Super Admin Bank
    let bankCredited = false;
    try {
      await creditSuperAdminForBtcJackpotStake(
        amount,
        `BTC Jackpot — stake to Bank (ticket @ $${predictedBtc})`,
        { relatedUserId: userId, betDate: today }
      );
      bankCredited = true;
    } catch (poolErr) {
      console.error('[BTC Jackpot] Super Admin pool credit failed:', poolErr);
      await atomicGamesWalletUpdate(User, userId, { balance: amount, usedMargin: -amount });
      return res.status(503).json({
        message: 'Could not route stake to house pool. Your games wallet was not charged.',
      });
    }

    const userDoc = await User.findById(userId).select('admin').lean();
    const placedAtIst = istNowHhmmss();

    try {
      const bid = await BtcJackpotBid.create({
        user: userId,
        admin: userDoc?.admin || null,
        amount,
        ticketCount: tickets,
        ticketPrice,
        predictedBtc,
        betDate: today,
        placedAtIst,
        status: 'pending',
      });

      // 3. Increment Bank stats
      await BtcJackpotBank.findOneAndUpdate(
        { betDate: today },
        {
          $setOnInsert: { betDate: today },
          $inc: { totalStake: amount, bidsCount: 1 },
        },
        { upsert: true, new: true }
      );

      // 4. Games wallet ledger row
      await recordGamesWalletLedger(userId, {
        gameId: 'btcJackpot',
        entryType: 'debit',
        amount,
        balanceAfter: gw.balance,
        description: `BTC Jackpot — ${tickets === 1 ? '1 ticket' : `${tickets} tickets`} @ $${predictedBtc.toLocaleString('en-US')}`,
        orderPlacedAt: bid.createdAt,
        meta: {
          betDate: today,
          tickets,
          ticketPrice,
          predictedBtc,
          bidId: bid._id,
        },
      });

      return res.json({
        message: 'Bid placed successfully',
        bid: {
          _id: bid._id,
          amount: bid.amount,
          ticketCount: bid.ticketCount,
          predictedBtc: bid.predictedBtc,
          betDate: bid.betDate,
          placedAtIst: bid.placedAtIst,
          status: bid.status,
          createdAt: bid.createdAt,
        },
        newBalance: gw.balance,
      });
    } catch (innerErr) {
      if (bankCredited) {
        await rollbackBtcJackpotStakeCredit(
          amount,
          'BTC Jackpot — rollback Bank credit (bid persist failed)',
          { relatedUserId: userId, betDate: today }
        );
      }
      await atomicGamesWalletUpdate(User, userId, { balance: amount, usedMargin: -amount });
      console.error('[BTC Jackpot] bid create failed:', innerErr);
      throw innerErr;
    }
  } catch (err) {
    console.error('[btc-jackpot/bid]', err);
    res.status(500).json({ message: err.message });
  }
});

/**
 * PUT /api/user/btc-jackpot/bid/:id
 * Body: { predictedBtc }
 * Only the predicted price can be modified, only while the bid is pending and within bidding window.
 * Amount / ticket count are immutable. NO cancel endpoint exists (point 3).
 */
router.put('/bid/:id', protectUser, async (req, res) => {
  try {
    const bidId = req.params.id;
    if (!bidId || !/^[a-fA-F0-9]{24}$/.test(bidId)) {
      return res.status(400).json({ message: 'Invalid bid id' });
    }

    const settings = await GameSettings.getSettings();
    const gc = settings?.games?.btcJackpot;
    if (!gc || gc.enabled === false) {
      return res.status(400).json({ message: 'BTC Jackpot is currently disabled' });
    }
    const winPut = evaluateBtcJackpotBiddingWindow(gc);
    if (!winPut.ok) {
      return res.status(400).json({
        message: btcJackpotBiddingWindowUserMessage(gc, winPut.reason),
      });
    }

    const priceParse = parsePredictedBtc(req.body?.predictedBtc);
    if (!priceParse.ok) return res.status(400).json({ message: priceParse.error });

    const today = getTodayISTString();
    const bid = await BtcJackpotBid.findOne({
      $and: [{ _id: bidId }, { user: req.user._id }, btcJackpotDayFilter(today)],
    });
    if (!bid) return res.status(404).json({ message: 'Bid not found' });
    if (bid.status !== 'pending') return res.status(400).json({ message: 'Only pending bids can be modified' });

    bid.predictedBtc = priceParse.value;
    await bid.save();

    res.json({
      message: 'Predicted BTC updated',
      bid: {
        _id: bid._id,
        amount: bid.amount,
        ticketCount: bid.ticketCount,
        predictedBtc: bid.predictedBtc,
        betDate: bid.betDate,
        status: bid.status,
      },
    });
  } catch (err) {
    console.error('[btc-jackpot/bid/:id PUT]', err);
    res.status(500).json({ message: err.message });
  }
});

/**
 * GET /api/user/btc-jackpot/today
 * Current user's BTC Jackpot bids for today (IST).
 */
router.get('/today', protectUser, async (req, res) => {
  try {
    const today = getTodayISTString();
    const bids = await BtcJackpotBid.find({
      $and: [{ user: req.user._id }, btcJackpotDayFilter(today)],
    })
      .sort({ createdAt: -1 })
      .lean();

    const bank = await BtcJackpotBank.findOne({ betDate: today }).lean();

    res.json({
      date: today,
      bids,
      totalStaked: bids.reduce((s, b) => s + (Number(b.amount) || 0), 0),
      ticketsUsed: bids.reduce((s, b) => s + (Number(b.ticketCount) || 0), 0),
      bank: bank ? { lockedBtcPrice: bank.lockedBtcPrice, resultDeclared: !!bank.resultDeclared } : null,
    });
  } catch (err) {
    console.error('[btc-jackpot/today]', err);
    res.status(500).json({ message: err.message });
  }
});

/**
 * GET /api/user/btc-jackpot/leaderboard?limit=5
 * Top-N projected winners based on live BTC spot (point 5). Visible to all users.
 * Returns masked usernames + distance from spot + projected prize .
 */
router.get('/leaderboard', protectUser, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(20, parseInt(req.query.limit, 10) || 5));
    const today = getTodayISTString();

    const settings = await GameSettings.getSettings();
    const gc = settings?.games?.btcJackpot;
    if (!gc) return res.json({ spot: null, winners: [], totalPool: 0, limit, date: today });

    const { price: spotPrice, source: spotSource } = await getLiveBtcSpotForJackpot();

    const [pending, bank] = await Promise.all([
      BtcJackpotBid.find({
        $and: [{ status: 'pending' }, btcJackpotDayFilter(today)],
      })
        .populate('user', 'username')
        .lean(),
      BtcJackpotBank.findOne({ betDate: today }).lean(),
    ]);

    const totalPool =
      Number(bank?.totalStake) ||
      pending.reduce((s, b) => s + (Number(b.amount) || 0), 0);

    if (!spotPrice || pending.length === 0) {
      return res.json({
        spot: spotPrice ?? null,
        spotSource: spotSource ?? null,
        winners: [],
        totalPool,
        limit,
        date: today,
      });
    }

    const sorted = rankBtcJackpotBids(pending, spotPrice);
    const groups = buildTieGroupedRanks(sorted, spotPrice, (r) =>
      percentOfRankFromConfig(r, gc.prizePercentages)
    );

    const flat = [];
    for (const g of groups) {
      for (let k = 0; k < g.bids.length; k++) {
        flat.push({
          rank: g.startRank + k,
          bidId: g.bids[k]._id,
          predictedBtc: g.bids[k].predictedBtc,
          ticketCount: g.bids[k].ticketCount,
          createdAt: g.bids[k].createdAt,
          distance: Math.round(absDist(g.bids[k].predictedBtc, spotPrice) * 100) / 100,
          maskedUsername: maskUsername(g.bids[k].user?.username),
          isOwnBid: String(g.bids[k].user?._id || g.bids[k].user) === String(req.user._id),
          tied: g.tied,
          tiedGroupSize: g.bids.length,
          poolPercent: g.perBidPct,
          projectedPrize: Math.round((totalPool * g.perBidPct) / 100 * 100) / 100,
        });
      }
    }

    res.json({
      spot: spotPrice,
      spotSource,
      winners: flat.slice(0, limit),
      totalPool,
      limit,
      date: today,
    });
  } catch (err) {
    console.error('[btc-jackpot/leaderboard]', err);
    res.status(500).json({ message: err.message });
  }
});

/**
 * GET /api/user/btc-jackpot/history?days=7
 * Past results + user's own bids for up to `days` recent IST days.
 */
router.get('/history', protectUser, async (req, res) => {
  try {
    const days = Math.max(1, Math.min(30, parseInt(req.query.days, 10) || 7));
    const userId = new mongoose.Types.ObjectId(String(req.user._id));

    const bids = await BtcJackpotBid.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(days * 20)
      .lean();

    const dates = Array.from(new Set(bids.map((b) => b.betDate).filter(Boolean))).slice(0, days);
    const results = dates.length
      ? await BtcJackpotResult.find({ resultDate: { $in: dates } }).lean()
      : [];

    const byDate = new Map(results.map((r) => [r.resultDate, r]));
    const grouped = dates.map((d) => ({
      date: d,
      lockedBtcPrice: byDate.get(d)?.lockedBtcPrice ?? null,
      resultDeclared: !!byDate.get(d)?.resultDeclared,
      prizeDistribution: byDate.get(d)?.prizeDistribution || [],
      bids: bids.filter((b) => b.betDate === d),
    }));

    res.json({ days, history: grouped });
  } catch (err) {
    console.error('[btc-jackpot/history]', err);
    res.status(500).json({ message: err.message });
  }
});

export default router;
