/**
 * Order placement available balance — matches dashboard:
 * max(0, cash − usedMargin) + open-position MTM for the segment wallet.
 */

import Trade from '../models/Trade.js';
import {
  SEGMENT_QUERIES_BY_WALLET,
  getMarkPricesForTrades,
  walletCashBalance,
} from '../services/ledgerAutosquareService.js';
import { resolveCarryMarkPrice } from '../services/carryForwardService.js';
import { computeMarkToMarketPnL, roundMoney } from './bookPnL.js';
import { recalculateUsedMargin } from './recalculateUsedMargin.js';

function segmentGroupFromWalletField(walletField) {
  if (walletField === 'forexWallet') return 'FOREX';
  if (walletField === 'mcxWallet') return 'MCX';
  if (walletField === 'cryptoWallet') return 'CRYPTO';
  return 'NSE';
}

export function resolveWalletFieldFromFlags({ isCrypto, isForex, isMCX } = {}) {
  if (isCrypto) return 'cryptoWallet';
  if (isForex) return 'forexWallet';
  if (isMCX) return 'mcxWallet';
  return 'nseBseWallet';
}

/** Sum live MTM for all OPEN trades in this wallet (bid/ask marks when available). */
export async function sumWalletOpenMtm(userId, walletField) {
  const segQ = SEGMENT_QUERIES_BY_WALLET[walletField];
  if (!segQ) return 0;

  const trades = await Trade.find({ user: userId, status: 'OPEN', ...segQ }).lean();
  if (!trades.length) return 0;

  const priceMap = await getMarkPricesForTrades(trades, { preferBidAsk: true });
  const segGroup = segmentGroupFromWalletField(walletField);
  let total = 0;

  for (const t of trades) {
    const qty =
      t.originalQty != null && Number(t.originalQty) > 0
        ? Number(t.originalQty)
        : Number(t.quantity) || Number(t.lots) || 0;
    const pr = priceMap.get(String(t._id));
    let px = pr?.markPrice ?? (Number(t.currentPrice) || Number(t.entryPrice) || 0);
    px = resolveCarryMarkPrice(t, px, segGroup);
    if (px > 0 && qty > 0) {
      total += computeMarkToMarketPnL(t, px, qty);
    }
  }
  return roundMoney(total);
}

export function cashFreeMargin(user, walletField, usedMarginOverride = null) {
  const cash = walletCashBalance(user, walletField);
  let um;
  if (usedMarginOverride != null) {
    um = Math.max(0, Number(usedMarginOverride) || 0);
  } else if (walletField === 'nseBseWallet') {
    um = Math.max(0, Number(user?.nseBseWallet?.usedMargin) || Number(user?.wallet?.usedMargin) || 0);
  } else {
    um = Math.max(0, Number(user?.[walletField]?.usedMargin) || 0);
  }
  return Math.max(0, roundMoney(cash - um));
}

/**
 * Available headroom for a new order (cash free + segment unrealized P&L).
 */
export async function computeOrderAvailableBalance(
  userId,
  user,
  walletField,
  { usedMarginOverride = null, includeMtm = true } = {}
) {
  let um = usedMarginOverride;
  if (um == null) {
    const rec = await recalculateUsedMargin(userId);
    if (walletField === 'nseBseWallet') {
      um = rec.nseBseWallet ?? rec.wallet ?? 0;
    } else {
      um = rec[walletField] ?? 0;
    }
  }

  const cashFree = cashFreeMargin(user, walletField, um);
  if (!includeMtm) return cashFree;

  const mtm = await sumWalletOpenMtm(userId, walletField);
  return roundMoney(cashFree + mtm);
}
