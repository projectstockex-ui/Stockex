import User from '../models/User.js';
import GameSettings from '../models/GameSettings.js';
import BtcNumberBet from '../models/BtcNumberBet.js';
import { closingPriceToLeftTwoDigits } from '../utils/niftyNumberResult.js';
import { debitBtcUpDownSuperAdminPool } from '../utils/btcUpDownSuperAdminPool.js';
import { atomicGamesWalletUpdate } from '../utils/gamesWallet.js';
import { recordGamesWalletLedger } from '../utils/gamesWalletLedger.js';
import {
  distributeWinBrokerage,
  computeNiftyJackpotGrossHierarchyBreakdown,
  creditNiftyJackpotGrossHierarchyFromPool,
} from './gameProfitDistribution.js';
import { creditReferralPercentOfTotalStake } from './referralGameStakeCredit.js';
import { computeDecimalNumberWinGrossPrize } from '../utils/decimalNumberWinGrossPrize.js';

/**
 * Declare BTC Number for a bet date (YYYY-MM-DD). Same settlement rules as Nifty Number.
 * @param {{ date: string, resultNumber?: number, closingPrice?: number|string|null }} params
 */
export async function declareBtcNumberResultForDate({ date, resultNumber, closingPrice }) {
  if (!date) {
    throw new Error('Date is required');
  }

  let num;
  if (closingPrice != null && closingPrice !== '' && Number.isFinite(Number(closingPrice))) {
    const derived = closingPriceToLeftTwoDigits(closingPrice);
    if (derived === null) {
      throw new Error('Could not derive left-side 2 digits (00–99) from closingPrice');
    }
    num = derived;
  } else if (resultNumber != null && resultNumber !== '') {
    const parsed = parseInt(resultNumber, 10);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 99) {
      throw new Error('resultNumber must be 0–99 or send closingPrice');
    }
    num = parsed;
  } else {
    throw new Error('Send closingPrice (BTC spot) or resultNumber 0–99');
  }

  const settings = await GameSettings.getSettings();
  const gameConfig = settings.games?.btcNumber;
  if (!gameConfig?.enabled) {
    throw new Error('BTC Number game is disabled');
  }

  const brokeragePctSetting = Number(gameConfig?.brokeragePercent);
  const brokeragePercent =
    Number.isFinite(brokeragePctSetting) && brokeragePctSetting > 0 ? brokeragePctSetting : 0;

  const grossHierarchyPctSum =
    (Number(gameConfig?.grossPrizeSubBrokerPercent) || 0) +
    (Number(gameConfig?.grossPrizeBrokerPercent) || 0) +
    (Number(gameConfig?.grossPrizeAdminPercent) || 0);
  const useGrossPrizeHierarchy = grossHierarchyPctSum > 0;

  const pendingBets = await BtcNumberBet.find({ betDate: date, status: 'pending' });
  if (pendingBets.length === 0) {
    throw new Error('No pending bets found for this date');
  }

  const stakeByUser = new Map();
  for (const b of pendingBets) {
    const uid = b.user.toString();
    stakeByUser.set(uid, (stakeByUser.get(uid) || 0) + Number(b.amount || 0));
  }

  let winnersCount = 0;
  let losersCount = 0;
  let totalPaidOut = 0;
  let totalCollected = 0;

  const closingNum =
    closingPrice != null && closingPrice !== '' && Number.isFinite(Number(closingPrice))
      ? Number(closingPrice)
      : null;

  for (const bet of pendingBets) {
    const won = bet.selectedNumber === num;
    bet.resultNumber = num;
    bet.closingPrice = closingNum;
    bet.resultDeclaredAt = new Date();

    const user = await User.findById(bet.user).populate('admin');

    if (won) {
      const grossPrize = computeDecimalNumberWinGrossPrize(gameConfig, settings, bet.quantity);
      let totalWinnerBrokerage = 0;
      let grossBreakdown = null;

      if (useGrossPrizeHierarchy && user) {
        grossBreakdown = await computeNiftyJackpotGrossHierarchyBreakdown(user, grossPrize, gameConfig);
        totalWinnerBrokerage = grossBreakdown.totalHierarchy;
        if (totalWinnerBrokerage > grossPrize) totalWinnerBrokerage = grossPrize;
      } else if (brokeragePercent > 0) {
        totalWinnerBrokerage = parseFloat(
          Math.min(grossPrize, (grossPrize * brokeragePercent) / 100).toFixed(2)
        );
      }

      const userCredit = grossPrize;
      bet.status = 'won';
      bet.profit = parseFloat((grossPrize - bet.amount).toFixed(2));

      if (user) {
        const poolPay = await debitBtcUpDownSuperAdminPool(
          userCredit,
          `BTC Number — pay winner gross prize (bet ${bet._id})`
        );
        if (!poolPay.ok) {
          console.error(`[BTC Number] SA pool debit failed for user ${bet.user} gross ${userCredit}`);
        }

        const roundPnL = parseFloat((grossPrize - bet.amount).toFixed(2));
        const gw = await atomicGamesWalletUpdate(User, bet.user, {
          balance: userCredit,
          usedMargin: -bet.amount,
          realizedPnL: roundPnL,
          todayRealizedPnL: roundPnL,
        });
        await recordGamesWalletLedger(bet.user, {
          gameId: 'btcNumber',
          entryType: 'credit',
          amount: userCredit,
          balanceAfter: gw.balance,
          description: 'BTC Number — result: win (gross prize, stake not re-credited; hierarchy from pool)',
          orderPlacedAt: bet.createdAt,
          meta: {
            won: true,
            betId: bet._id,
            resultNumber: num,
            grossPrize,
            brokerageDeducted: totalWinnerBrokerage,
            grossPrizeHierarchy: useGrossPrizeHierarchy,
            hierarchyPaidFromPoolExtra: totalWinnerBrokerage > 0,
          },
        });

        if (useGrossPrizeHierarchy && totalWinnerBrokerage > 0 && grossBreakdown) {
          await creditNiftyJackpotGrossHierarchyFromPool(bet.user, user, grossBreakdown, {
            gameLabel: 'BTC Number',
            gameKey: 'btcNumber',
            logTag: 'BtcNumberGrossHierarchy',
          });
        } else if (totalWinnerBrokerage > 0) {
          await distributeWinBrokerage(
            bet.user,
            user,
            totalWinnerBrokerage,
            'BTC Number',
            'btcNumber',
            {
              fundFromBtcPool: true,
              ledgerGameId: 'btcNumber',
              skipUserRebate: true,
            }
          );
        }

        try {
          const userTotalStake = stakeByUser.get(bet.user.toString()) || 0;
          await creditReferralPercentOfTotalStake({
            referredUserId: bet.user,
            gameType: 'btcNumber',
            totalStake: userTotalStake,
            settlementDay: date,
            sessionScope: 'declare',
            rank: null,
          });
        } catch (refErr) {
          console.warn('[BTC Number] referral:', refErr?.message || refErr);
        }
      }
      totalPaidOut += userCredit;
      winnersCount++;
    } else {
      bet.status = 'lost';
      bet.profit = -bet.amount;

      if (user) {
        await atomicGamesWalletUpdate(User, bet.user, {
          usedMargin: -bet.amount,
          realizedPnL: -bet.amount,
          todayRealizedPnL: -bet.amount,
        });
        bet.distribution = { adminShare: 0, superAdminShare: 0, platformShare: 0 };
      }

      totalCollected += bet.amount;
      losersCount++;
    }

    await bet.save();
  }

  return {
    message: `Result declared: ${num.toString().padStart(2, '0')} (2 digits left of decimal)`,
    resultNumber: num,
    date,
    closingPrice: closingNum,
    summary: {
      totalBets: pendingBets.length,
      winners: winnersCount,
      losers: losersCount,
      totalPaidOut,
      totalCollected,
    },
  };
}
