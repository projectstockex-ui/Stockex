import GameSettings from '../models/GameSettings.js';
import BtcJackpotBid from '../models/BtcJackpotBid.js';
import BtcJackpotResult from '../models/BtcJackpotResult.js';
import BtcJackpotBank from '../models/BtcJackpotBank.js';
import BtcNumberBet from '../models/BtcNumberBet.js';
import { btcJackpotDayFilter } from '../utils/btcJackpotDay.js';
import { getLiveBtcSpotForJackpot } from '../utils/btcJackpotSpot.js';
import { declareBtcJackpotForDate } from '../services/btcJackpotDeclareService.js';
import { declareBtcNumberResultForDate } from '../services/btcNumberDeclareService.js';
import { getTodayISTString } from '../utils/istDate.js';
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
    const numberResultSec = numberOn
      ? parseTimeToSecIST(gcN.resultTime || '23:30')
      : Infinity;
    const jackpotShouldRun = jackpotOn && nowSec > jackpotEndInc;
    const numberShouldRun = numberOn && nowSec >= numberResultSec;
    const shouldRun = jackpotShouldRun || numberShouldRun;
    const scheduleLabel = [
      jackpotShouldRun ? `jackpot end (${gcJ?.biddingEndTime || '23:29'} IST)` : '',
      numberShouldRun ? `number result (${gcN?.resultTime || '23:30'} IST)` : '',
    ].filter(Boolean).join(' + ') || 'waiting';
    if (!shouldRun) return;

    const today = getTodayISTString();
    const pendingJ = jackpotOn
      ? await BtcJackpotBid.countDocuments({
          $and: [{ status: 'pending' }, btcJackpotDayFilter(today)],
        })
      : 0;
    const pendingN = numberOn
      ? await BtcNumberBet.countDocuments({ betDate: today, status: 'pending' })
      : 0;

    let row = await BtcJackpotResult.findOne({ resultDate: today });

    if (!row || row.lockedBtcPrice == null || !Number.isFinite(Number(row.lockedBtcPrice)) || Number(row.lockedBtcPrice) <= 0) {
      if (pendingJ === 0 && pendingN === 0) return;

      const spot = await getLiveBtcSpotForJackpot();
      if (spot.price == null || !Number.isFinite(spot.price) || spot.price <= 0) {
        console.warn('[btc22h] auto-lock: no BTC price available — retrying next tick');
        return;
      }

      try {
        row = await BtcJackpotResult.findOneAndUpdate(
          { resultDate: today },
          {
            $setOnInsert: {
              resultDate: today,
              lockedBtcPrice: Number(spot.price),
              lockedAt: new Date(),
              lockedSource: spot.source || 'binance_rest',
            },
          },
          { upsert: true, new: true }
        );

        await BtcJackpotBank.findOneAndUpdate(
          { betDate: today },
          {
            $setOnInsert: { betDate: today },
            $set: { lockedBtcPrice: Number(spot.price), lockedAt: new Date() },
          },
          { upsert: true, new: true }
        );

        console.log(
          `[btc22h] auto-locked @ $${Number(spot.price).toFixed(2)} for ${today} (${scheduleLabel}, source=${spot.source})`
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
