import mongoose from 'mongoose';
import User from '../models/User.js';
import GamesWalletLedger from '../models/GamesWalletLedger.js';
import GameSettings from '../models/GameSettings.js';
import UpDownWindowSettlement from '../models/UpDownWindowSettlement.js';
import { atomicGamesWalletUpdate } from '../utils/gamesWallet.js';
import { recordGamesWalletLedger } from '../utils/gamesWalletLedger.js';
import { debitBtcUpDownSuperAdminPool } from '../utils/btcUpDownSuperAdminPool.js';
import {
  distributeWinBrokerage,
  computeNiftyJackpotGrossHierarchyBreakdown,
  creditNiftyJackpotGrossHierarchyFromPool,
} from './gameProfitDistribution.js';
import { settleUpDownFromPrices, computeUpDownWinPayout } from '../utils/upDownSettlementMath.js';
import { startOfISTDayFromKey, endOfISTDayFromKey, getTodayISTString } from '../utils/istDate.js';
import { niftyResultSecForWindow } from '../../lib/niftyUpDownWindows.js';
import { currentTotalSecondsIST } from '../../lib/btcUpDownWindows.js';

/**
 * Server-side Up/Down settlement for one user + window (same economics as POST /updown/manual-settle).
 * Creates UpDownWindowSettlement row; credits games wallet for wins.
 *
 * @param {string} settlementDay YYYY-MM-DD (IST) — session day for this window (avoids repeating window # across days).
 * @returns {Promise<{ ok: true, settledCount: number, ledgerWins: number, totalWinningStakeForReferral: number, totalWindowStakeForReferral: number } | { ok: false, error: string }>}
 */
export async function settleUpDownUserWindowFromLedger(
  userId,
  gameId,
  windowNumber,
  openPrice,
  closePrice,
  settlementDay
) {
  const uid =
    typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)
      ? new mongoose.Types.ObjectId(userId)
      : userId;
  const wn = Number(windowNumber);
  const closePx = Number(closePrice);
  const openPx = Number(openPrice);

  if (!['updown', 'btcupdown'].includes(gameId)) {
    return { ok: false, error: 'Invalid gameId' };
  }
  if (!Number.isFinite(wn)) {
    return { ok: false, error: 'Invalid windowNumber' };
  }
  if (!Number.isFinite(closePx) || closePx <= 0) {
    return { ok: false, error: 'Invalid closePrice' };
  }
  const dayKey = String(settlementDay || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    return { ok: false, error: 'Invalid settlementDay' };
  }
  const dayStart = startOfISTDayFromKey(dayKey);
  const dayEnd = endOfISTDayFromKey(dayKey);
  if (!dayStart || !dayEnd) {
    return { ok: false, error: 'Invalid settlementDay' };
  }

  if (gameId === 'updown') {
    const todayIst = getTodayISTString();
    if (dayKey === todayIst) {
      let stEarly = null;
      try {
        stEarly = await GameSettings.getSettings();
      } catch {
        /* defaults */
      }
      const niftyResultSec = niftyResultSecForWindow(wn, stEarly?.games?.niftyUpDown || {});
      if (Number.isFinite(niftyResultSec) && currentTotalSecondsIST() < niftyResultSec) {
        return { ok: false, error: 'before_nifty_result_time' };
      }
    }
  }

  try {
    await UpDownWindowSettlement.create({
      user: uid,
      gameId,
      windowNumber: wn,
      settlementDay: dayKey,
    });
  } catch (e) {
    if (e.code === 11000) {
      return { ok: false, error: 'already_settled' };
    }
    throw e;
  }

  const debitBets = await GamesWalletLedger.find({
    user: uid,
    gameId,
    entryType: 'debit',
    $or: [{ 'meta.windowNumber': wn }, { 'meta.windowNumber': String(wn) }],
    description: { $regex: 'Up/Down.*bet.*\\(UP\\)|Up/Down.*bet.*\\(DOWN\\)', $options: 'i' },
    createdAt: { $gte: dayStart, $lt: dayEnd },
  });

  let openPxUse = openPx;
  if (!Number.isFinite(openPxUse) || openPxUse <= 0) {
    const entries = debitBets.map((b) => Number(b.meta?.entryPrice)).filter((x) => Number.isFinite(x) && x > 0);
    openPxUse = entries.length ? Math.min(...entries) : NaN;
  }

  if (!Number.isFinite(openPxUse) || openPxUse <= 0) {
    await UpDownWindowSettlement.deleteOne({ user: uid, gameId, windowNumber: wn, settlementDay: dayKey });
    return { ok: false, error: 'openPrice required' };
  }

  if (debitBets.length === 0) {
    await UpDownWindowSettlement.deleteOne({ user: uid, gameId, windowNumber: wn, settlementDay: dayKey });
    return { ok: false, error: 'no_debits' };
  }

  let settingsResolve = null;
  try {
    settingsResolve = await GameSettings.getSettings();
  } catch {
    /* defaults */
  }
  const gameKeyCfg = gameId === 'btcupdown' ? 'btcUpDown' : 'niftyUpDown';
  const gcfg = settingsResolve?.games?.[gameKeyCfg] || {};
  const winMult = Number(gcfg.winMultiplier) > 0 ? Number(gcfg.winMultiplier) : 1.95;
  const brokPctManual =
    gcfg.brokeragePercent != null && Number.isFinite(Number(gcfg.brokeragePercent))
      ? Number(gcfg.brokeragePercent)
      : 0;
  const grossHierarchyPctSum =
    (Number(gcfg?.grossPrizeSubBrokerPercent) || 0) +
    (Number(gcfg?.grossPrizeBrokerPercent) || 0) +
    (Number(gcfg?.grossPrizeAdminPercent) || 0);
  const useGrossPrizeHierarchy = grossHierarchyPctSum > 0;
  const perTicket =
    gcfg?.ticketPrice != null && Number.isFinite(Number(gcfg.ticketPrice))
      ? Number(gcfg.ticketPrice)
      : settingsResolve?.tokenValue || 300;

  let totalBalanceInc = 0;
  let totalMarginDec = 0;
  let totalPnl = 0;
  let totalLoss = 0;
  let totalBrokerage = 0;
  let settledCount = 0;
  /** Sum of stake on winning legs — gate for referral (must have a win). */
  let totalWinningStakeForReferral = 0;
  const ledgerEntries = [];
  const hierarchyJobs = [];

  const userDoc = await User.findById(uid).populate('admin');

  let sumWinningGrossForHierarchy = 0;
  const settledRows = [];

  for (const bet of debitBets) {
    const amount = Number(bet.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const prediction = bet.meta?.prediction === 'DOWN' ? 'DOWN' : 'UP';
    const authoritative = settleUpDownFromPrices(prediction, openPxUse, closePx);
    const won = authoritative === true;

    let pnl;
    let grossWin = 0;
    let creditTotal = 0;
    if (won) {
      grossWin = amount * winMult;
      creditTotal = parseFloat(Number(grossWin).toFixed(2));
      pnl = parseFloat((grossWin - amount).toFixed(2));
      totalWinningStakeForReferral += amount;
      if (useGrossPrizeHierarchy && userDoc) {
        sumWinningGrossForHierarchy += grossWin;
      }
    } else {
      pnl = -amount;
    }
    if (!Number.isFinite(pnl)) continue;

    settledCount += 1;
    totalPnl += pnl;
    settledRows.push({
      bet,
      amount,
      prediction,
      won,
      pnl,
      creditTotal,
      grossWin,
    });
  }

  const sumGrossRounded =
    sumWinningGrossForHierarchy > 0
      ? parseFloat(Number(sumWinningGrossForHierarchy).toFixed(2))
      : 0;

  let consolidatedHierarchyBreakdown = null;
  if (useGrossPrizeHierarchy && userDoc && sumGrossRounded > 0) {
    consolidatedHierarchyBreakdown = await computeNiftyJackpotGrossHierarchyBreakdown(
      userDoc,
      sumGrossRounded,
      gcfg
    );
  }

  if (consolidatedHierarchyBreakdown && consolidatedHierarchyBreakdown.totalHierarchy > 0) {
    hierarchyJobs.push({ breakdown: consolidatedHierarchyBreakdown });
  }

  for (const row of settledRows) {
    totalMarginDec += row.amount;
    if (row.won) {
      let brokerage = 0;
      if (useGrossPrizeHierarchy && consolidatedHierarchyBreakdown && sumWinningGrossForHierarchy > 0) {
        brokerage = parseFloat(
          (
            (consolidatedHierarchyBreakdown.totalHierarchy * row.grossWin) /
            sumWinningGrossForHierarchy
          ).toFixed(2)
        );
        if (brokerage > row.creditTotal) brokerage = row.creditTotal;
      } else {
        const parts = computeUpDownWinPayout(row.amount, winMult, brokPctManual);
        brokerage = parts.brokerage;
        totalBrokerage += brokerage;
      }
      totalBalanceInc += row.creditTotal;
      ledgerEntries.push({
        gameId,
        entryType: 'credit',
        amount: row.creditTotal,
        description: `${gameId === 'btcupdown' ? 'BTC' : 'Nifty'} Up/Down — win (gross payout; hierarchy from pool) [auto]`,
        meta: {
          won: true,
          stake: row.amount,
          pnl: row.pnl,
          brokerage,
          grossPrizeHierarchy: useGrossPrizeHierarchy,
          hierarchyPaidFromPoolExtra: brokerage > 0,
          tickets: parseFloat((row.amount / perTicket).toFixed(2)),
          tokenValue: perTicket,
          prediction: row.prediction,
          windowNumber: wn,
          entryPrice: openPxUse,
          exitPrice: closePx,
          autoSettle: true,
          orderPlacedAt: row.bet.createdAt,
        },
      });
    }
  }

  if (settledCount === 0) {
    await UpDownWindowSettlement.deleteOne({ user: uid, gameId, windowNumber: wn, settlementDay: dayKey });
    return { ok: false, error: 'no_valid_trades' };
  }

  const totalWindowStakeForReferral = settledRows.reduce((s, row) => s + row.amount, 0);

  const isBtcManual = gameId === 'btcupdown';
  // BTC: SA pool pays gross wins first, then distributeWinBrokerage debits T again for hierarchy (see plan).
  if (isBtcManual && totalBalanceInc > 0) {
    const poolDebit = await debitBtcUpDownSuperAdminPool(
      totalBalanceInc,
      `BTC Up/Down — win payout from pool [auto] (−${totalBalanceInc.toFixed(2)})`
    );
    if (!poolDebit.ok) {
      await UpDownWindowSettlement.deleteOne({ user: uid, gameId, windowNumber: wn, settlementDay: dayKey });
      return { ok: false, error: 'btc_pool_debit_failed' };
    }
  }

  const gw = await atomicGamesWalletUpdate(User, uid, {
    balance: totalBalanceInc,
    usedMargin: -totalMarginDec,
    realizedPnL: totalPnl,
    todayRealizedPnL: totalPnl,
  });

  for (const entry of ledgerEntries) {
    await recordGamesWalletLedger(uid, {
      ...entry,
      balanceAfter: gw.balance,
    });
  }

  if (isBtcManual) {
    if (useGrossPrizeHierarchy && userDoc) {
      for (const job of hierarchyJobs) {
        await creditNiftyJackpotGrossHierarchyFromPool(uid, userDoc, job.breakdown, {
          gameLabel: gameId === 'btcupdown' ? 'BTC Up/Down' : 'Nifty Up/Down',
          gameKey: gameKeyCfg,
          logTag: 'UpDownGrossHierarchy',
        });
      }
    } else if (totalBrokerage > 0 && userDoc) {
      await distributeWinBrokerage(uid, userDoc, totalBrokerage, 'BTC UpDown', gameKeyCfg, {
        fundFromBtcPool: true,
        ledgerGameId: 'btcupdown',
        skipUserRebate: true,
      });
    }
  } else {
    if (useGrossPrizeHierarchy && userDoc) {
      for (const job of hierarchyJobs) {
        await creditNiftyJackpotGrossHierarchyFromPool(uid, userDoc, job.breakdown, {
          gameLabel: 'Nifty Up/Down',
          gameKey: gameKeyCfg,
          logTag: 'UpDownGrossHierarchy',
        });
      }
    } else if (totalBrokerage > 0 && userDoc) {
      await distributeWinBrokerage(uid, userDoc, totalBrokerage, 'Nifty UpDown', gameKeyCfg, {
        fundFromBtcPool: true,
        ledgerGameId: 'updown',
        skipUserRebate: true,
      });
    }
  }

  return {
    ok: true,
    settledCount,
    ledgerWins: ledgerEntries.length,
    totalWinningStakeForReferral: parseFloat(Number(totalWinningStakeForReferral).toFixed(2)),
    totalWindowStakeForReferral: parseFloat(Number(totalWindowStakeForReferral).toFixed(2)),
  };
}
