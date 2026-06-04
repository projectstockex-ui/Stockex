import GameSettings from '../models/GameSettings.js';
import BtcJackpotBid from '../models/BtcJackpotBid.js';
import BtcJackpotResult from '../models/BtcJackpotResult.js';
import BtcJackpotBank from '../models/BtcJackpotBank.js';
import BtcNumberBet from '../models/BtcNumberBet.js';
import { btcJackpotDayFilter } from '../utils/btcJackpotDay.js';
import { getLiveBtcSpotForJackpot } from '../utils/btcJackpotSpot.js';
import { fetchBtcFifteenMinuteIstWindowOhlc, fetchBtcUsdt1mCloseAtIstRef } from '../utils/binanceBtcKline.js';
import { declareBtcJackpotForDate } from '../services/btcJackpotDeclareService.js';
import { declareBtcNumberResultForDate } from '../services/btcNumberDeclareService.js';
import { getTodayISTString, istInstantMs } from '../utils/istDate.js';
import { biddingEndInclusiveSecondsFromConfig } from '../utils/btcJackpotBiddingWindow.js';

function istSecondsNow() {
  const t = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
  const [hh = '0', mm = '0', ss = '0'] = t.split(':');
  return (parseInt(hh, 10) || 0) * 3600 + (parseInt(mm, 10) || 0) * 60 + (parseInt(ss, 10) || 0);
}

function parseTimeToSecIST(str) {
  const parts = String(str || '23:30').split(':').map((x) => parseInt(x, 10));
  return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
}

let running = false;

/**
 * 23:30 IST tick: lock BTC spot when BTC Jackpot and/or BTC Number have pending play,
 * then declare BTC Number (independent of jackpot's resultDeclared), then BTC Jackpot.
 */
export async function btcJackpotAutoTick() {
  if (running) return;
  running = true;
  try {
    if (String(process.env.BTC_JACKPOT_AUTO_SETTLEMENT || 'true').toLowerCase() === 'false') return;

    const settings = await GameSettings.getSettings().catch(() => null);
    const gcJ = settings?.games?.btcJackpot;
    const gcN = settings?.games?.btcNumber;
    const jackpotOn = gcJ && gcJ.enabled !== false;
    const numberOn = gcN && gcN.enabled !== false;
    if (!jackpotOn && !numberOn) return;

    const nowSec = istSecondsNow();
    // Check each game's trigger time independently
    const jackpotEndInc = jackpotOn
      ? biddingEndInclusiveSecondsFromConfig(gcJ?.biddingEndTime || '23:29')
      : Infinity;
    const numberLockSec = numberOn
      ? parseTimeToSecIST(gcN.endTime || gcN.resultTime || '23:30')
      : Infinity;
    const jackpotShouldRun = jackpotOn && nowSec > jackpotEndInc;
    const numberShouldRun = numberOn && nowSec >= numberLockSec;
    const shouldRun = jackpotShouldRun || numberShouldRun;
    const scheduleLabel = [
      jackpotShouldRun ? `jackpot end (${gcJ?.biddingEndTime || '23:29'} IST)` : '',
      numberShouldRun ? `number lock (${gcN?.endTime || gcN?.resultTime || '23:30'} IST)` : '',
    ].filter(Boolean).join(' + ') || 'waiting';
    if (!shouldRun) return;

    const today = getTodayISTString();
    const targetLockMs = numberShouldRun ? istInstantMs(today, numberLockSec) : null;
    const lockAt = targetLockMs != null ? new Date(targetLockMs) : new Date();
    const pendingJ = jackpotOn
      ? await BtcJackpotBid.countDocuments({
          $and: [{ status: 'pending' }, btcJackpotDayFilter(today)],
        })
      : 0;
    const pendingN = numberOn
      ? await BtcNumberBet.countDocuments({ betDate: today, status: 'pending' })
      : 0;

    let row = await BtcJackpotResult.findOne({ resultDate: today });
    const currentLockMs =
      row?.lockedAt != null && Number.isFinite(new Date(row.lockedAt).getTime())
        ? new Date(row.lockedAt).getTime()
        : null;
    // Refresh only once for the configured lock second (or again only when admin changes the time).
    const mustRefreshNumberLock =
      numberShouldRun &&
      numberOn &&
      targetLockMs != null &&
      currentLockMs !== targetLockMs;
    const missingOrInvalidLock =
      !row ||
      row.lockedBtcPrice == null ||
      !Number.isFinite(Number(row.lockedBtcPrice)) ||
      Number(row.lockedBtcPrice) <= 0;

    if (mustRefreshNumberLock || missingOrInvalidLock) {
      // BTC Number must lock reference price at result time even when no bets exist.
      // Keep old behavior for jackpot-only idle days.
      if (pendingJ === 0 && pendingN === 0 && !numberShouldRun) return;

      let lockPrice = null;
      let lockSource = null;
      if (numberShouldRun && numberOn) {
        // BTC Number reference must match chart's 15m close at lock second.
        // Priority: 15m close -> 1m close -> live spot fallback.
        const openRefSec = Math.max(0, numberLockSec - 900);
        const ohlc15 = await fetchBtcFifteenMinuteIstWindowOhlc(today, openRefSec, numberLockSec);
        if (ohlc15 && Number.isFinite(Number(ohlc15.close)) && Number(ohlc15.close) > 0) {
          lockPrice = Number(ohlc15.close);
          lockSource = 'binance_1m_15m_window';
        }
        if (lockPrice == null) {
          lockPrice = await fetchBtcUsdt1mCloseAtIstRef(today, numberLockSec);
          if (lockPrice != null && Number.isFinite(Number(lockPrice)) && Number(lockPrice) > 0) {
            lockSource = 'binance_rest';
          }
        }
        if (lockPrice == null) {
          const live = await getLiveBtcSpotForJackpot();
          if (live.price != null && Number.isFinite(live.price) && live.price > 0) {
            lockPrice = Number(live.price);
            lockSource = live.source || 'binance_rest';
          }
        }
      }
      if (lockPrice == null) {
        const spot = await getLiveBtcSpotForJackpot();
        if (spot.price != null && Number.isFinite(spot.price) && spot.price > 0) {
          lockPrice = Number(spot.price);
          lockSource = spot.source || 'binance_rest';
        }
      }
      if (lockPrice == null || !Number.isFinite(lockPrice) || lockPrice <= 0) {
        console.warn('[btc22h] auto-lock: no BTC price available at result time/live — retrying next tick');
        return;
      }

      try {
        row = await BtcJackpotResult.findOneAndUpdate(
          { resultDate: today },
          {
            $setOnInsert: { resultDate: today },
            $set: {
              lockedBtcPrice: Number(lockPrice),
              lockedAt: lockAt,
              lockedSource: lockSource || 'binance_rest',
            },
          },
          { upsert: true, new: true }
        );

        await BtcJackpotBank.findOneAndUpdate(
          { betDate: today },
          {
            $setOnInsert: { betDate: today },
            $set: { lockedBtcPrice: Number(lockPrice), lockedAt: lockAt },
          },
          { upsert: true, new: true }
        );

        console.log(
          `[btc22h] auto-locked @ $${Number(lockPrice).toFixed(2)} for ${today} (${scheduleLabel}, source=${lockSource}, forceRefresh=${mustRefreshNumberLock})`
        );
      } catch (e) {
        if (e?.code !== 11000) console.warn('[btc22h] auto-lock:', e?.message || e);
      }
    }

    const fresh = await BtcJackpotResult.findOne({ resultDate: today }).lean();
    if (!fresh || !Number.isFinite(Number(fresh.lockedBtcPrice)) || Number(fresh.lockedBtcPrice) <= 0) {
      return;
    }

    // Declare BTC Number only if its own resultTime has passed
    if (numberShouldRun) {
      const pendingN2 = await BtcNumberBet.countDocuments({ betDate: today, status: 'pending' });
      if (pendingN2 > 0) {
        try {
          const out = await declareBtcNumberResultForDate({
            date: today,
            closingPrice: fresh.lockedBtcPrice,
          });
          console.log(
            `[btcNumber] auto-declared ${today} @ $${Number(fresh.lockedBtcPrice).toFixed(2)}: ${out.summary?.winners ?? 0}W / ${out.summary?.losers ?? 0}L`
          );
        } catch (e) {
          if (!String(e?.message || '').includes('No pending')) {
            console.warn('[btcNumber] declare:', e?.message || e);
          }
        }
      }
    }

    // Declare BTC Jackpot only if its own biddingEndTime has passed
    if (jackpotShouldRun && !fresh.resultDeclared) {
      try {
        const out = await declareBtcJackpotForDate(today);
        console.log(
          `[btcJackpot] declared ${today}: ${out.summary.winnersCount}W / ${out.summary.losersCount}L, paid ₹${out.summary.totalPaidOut.toFixed(2)}`
        );
      } catch (e) {
        if (!String(e?.message || '').includes('No pending') && !String(e?.message || '').includes('already declared')) {
          console.warn('[btcJackpot] declare:', e?.message || e);
        }
      }
    }
  } catch (e) {
    console.warn('[btcJackpot] tick error:', e?.message || e);
  } finally {
    running = false;
  }
}
