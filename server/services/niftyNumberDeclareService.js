import User from '../models/User.js';
import GameSettings from '../models/GameSettings.js';
import NiftyNumberBet from '../models/NiftyNumberBet.js';
import GamesWalletLedger from '../models/GamesWalletLedger.js';
import { closingPriceToDecimalPart } from '../utils/niftyNumberResult.js';
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
 * Declare Nifty Number for a bet date (YYYY-MM-DD). Credits games wallet for winners.
 * @param {{ date: string, resultNumber?: number, closingPrice?: number|string|null }} params
 */
export async function declareNiftyNumberResultForDate({ date, resultNumber, closingPrice }) {
  if (!date) {
    throw new Error('Date is required');
  }

  let num;
  if (closingPrice != null && closingPrice !== '' && Number.isFinite(Number(closingPrice))) {
    const derived = closingPriceToDecimalPart(closingPrice);
    if (derived === null) {
      throw new Error('Could not derive .00–.99 from closingPrice');
    }
    num = derived;
  } else if (resultNumber != null && resultNumber !== '') {
    const parsed = parseInt(resultNumber, 10);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 99) {
      throw new Error('resultNumber must be 0–99 or send closingPrice');
    }
    num = parsed;
  } else {
    throw new Error('Send closingPrice (NIFTY LTP) or resultNumber 0–99');
  }

  const settings = await GameSettings.getSettings();
  const gameConfig = settings.games?.niftyNumber;
  if (!gameConfig?.enabled) {
    throw new Error('Nifty Number game is disabled');
  }

  const brokeragePctSetting = Number(gameConfig?.brokeragePercent);
  const brokeragePercent =
    Number.isFinite(brokeragePctSetting) && brokeragePctSetting > 0 ? brokeragePctSetting : 0;

  const grossHierarchyPctSum =
    (Number(gameConfig?.grossPrizeSubBrokerPercent) || 0) +
    (Number(gameConfig?.grossPrizeBrokerPercent) || 0) +
    (Number(gameConfig?.grossPrizeAdminPercent) || 0);
  const useGrossPrizeHierarchy = grossHierarchyPctSum > 0;

  const pendingBets = await NiftyNumberBet.find({ betDate: date, status: 'pending' });
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
    const claimed = await NiftyNumberBet.findOneAndUpdate(
      { _id: bet._id, status: 'pending' },
      { $set: { status: 'settling' } },
      { new: true }
    );
    if (!claimed) continue;
    const alreadyCredited = await GamesWalletLedger.exists({
      user: claimed.user,
      gameId: 'niftyNumber',
      entryType: 'credit',
      'meta.betId': claimed._id,
      'meta.resultNumber': num,
    });
    if (alreadyCredited) {
      claimed.status = claimed.selectedNumber === num ? 'won' : 'lost';
      claimed.resultNumber = num;
      claimed.closingPrice = closingNum;
      claimed.resultDeclaredAt = new Date();
      await claimed.save();
      continue;
    }
    const betDoc = claimed;
    const won = betDoc.selectedNumber === num;
    betDoc.resultNumber = num;
    betDoc.closingPrice = closingNum;
    betDoc.resultDeclaredAt = new Date();

    const user = await User.findById(betDoc.user).populate('admin');

    if (won) {
      const grossPrize = computeDecimalNumberWinGrossPrize(gameConfig, settings, betDoc.quantity);
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
      betDoc.status = 'won';
      betDoc.profit = parseFloat((grossPrize - betDoc.amount).toFixed(2));

      if (user) {
        const poolPay = await debitBtcUpDownSuperAdminPool(
          userCredit,
          `Nifty Number — pay winner gross prize (bet ${betDoc._id})`
        );
        if (!poolPay.ok) {
          console.error(`[Nifty Number] SA pool debit failed for user ${betDoc.user} gross ${userCredit}`);
        }

        const roundPnL = parseFloat((grossPrize - betDoc.amount).toFixed(2));
        const gw = await atomicGamesWalletUpdate(User, betDoc.user, {
          balance: userCredit,
          usedMargin: -betDoc.amount,
          realizedPnL: roundPnL,
          todayRealizedPnL: roundPnL,
        });
        await recordGamesWalletLedger(betDoc.user, {
          gameId: 'niftyNumber',
          entryType: 'credit',
          amount: userCredit,
          balanceAfter: gw.balance,
          description: 'Nifty Number — result: win (gross prize, stake not re-credited; hierarchy from pool)',
          orderPlacedAt: betDoc.createdAt,
          meta: {
            won: true,
            betId: betDoc._id,
            resultNumber: num,
            grossPrize,
            brokerageDeducted: totalWinnerBrokerage,
            grossPrizeHierarchy: useGrossPrizeHierarchy,
            hierarchyPaidFromPoolExtra: totalWinnerBrokerage > 0,
          },
        });

        if (useGrossPrizeHierarchy && totalWinnerBrokerage > 0 && grossBreakdown) {
          await creditNiftyJackpotGrossHierarchyFromPool(betDoc.user, user, grossBreakdown, {
            gameLabel: 'Nifty Number',
            gameKey: 'niftyNumber',
            logTag: 'NiftyNumberGrossHierarchy',
          });
        } else if (totalWinnerBrokerage > 0) {
          await distributeWinBrokerage(
            betDoc.user,
            user,
            totalWinnerBrokerage,
            'Nifty Number',
            'niftyNumber',
            {
              fundFromBtcPool: true,
              ledgerGameId: 'niftyNumber',
              skipUserRebate: true,
            }
          );
        }

        try {
          const userTotalStake = stakeByUser.get(betDoc.user.toString()) || 0;
          await creditReferralPercentOfTotalStake({
            referredUserId: betDoc.user,
            gameType: 'niftyNumber',
            totalStake: userTotalStake,
            settlementDay: date,
            sessionScope: 'declare',
            rank: null,
          });
        } catch (refErr) {
          console.warn('[Nifty Number] referral:', refErr?.message || refErr);
        }
      }
      totalPaidOut += userCredit;
      winnersCount++;
    } else {
      betDoc.status = 'lost';
      betDoc.profit = -betDoc.amount;

      if (user) {
        await atomicGamesWalletUpdate(User, betDoc.user, {
          usedMargin: -betDoc.amount,
          realizedPnL: -betDoc.amount,
          todayRealizedPnL: -betDoc.amount,
        });
        betDoc.distribution = {};
      }

      totalCollected += betDoc.amount;
      losersCount++;
    }

    await betDoc.save();
  }

  return {
    message: `Result declared: .${num.toString().padStart(2, '0')}`,
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
