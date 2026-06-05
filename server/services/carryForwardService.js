/**
 * Carry-forward: cap = (cash + open MTM [+ usedMargin if admin flag]) × carryForwardLeverage;
 * trim excess via partial close → wallet + ledger; remaining qty stays OPEN (NRML).
 * Same logic for CRYPTO, FOREX, MCX, NSE/BSE.
 */

import User from '../models/User.js';
import Trade from '../models/Trade.js';
import { alignCryptoExitToEntryUnit, computeMarkToMarketPnL, roundMoney } from '../utils/bookPnL.js';
import {
  computeCryptoForexCarryNextDayQty,
  capCarryForwardNextDayQty,
  resolveSafeNseBseMarkPrice,
} from '../utils/walletBalanceSanity.js';
import { recalculateUsedMargin } from '../utils/recalculateUsedMargin.js';
import {
  SEGMENT_QUERIES_BY_WALLET,
  getMarkPricesForTrades,
  walletCashBalance,
} from './ledgerAutosquareService.js';
import {
  normalizeCloseTimeKey,
  parseIstSessionCloseAt,
} from '../utils/autosquareSessionTime.js';
import {
  allocateProportionalNextDay,
  buildNetCarryGroupKey,
  groupTradesForNetCarry,
  tradeQtyAtCarryEvent,
} from '../utils/netCarryForward.js';

/** Read admin segment block for a trade (first matching key). */
export function readSegmentSettingsForCarry(admin, trade, segmentGroup) {
  const segPerms =
    admin?.segmentPermissions instanceof Map
      ? Object.fromEntries(admin.segmentPermissions)
      : admin?.segmentPermissions || {};

  const keys = segmentPermissionKeysForTrade(trade, segmentGroup);
  let segSettings = null;
  let matchedKey = null;
  for (const key of keys) {
    if (segPerms[key]) {
      segSettings = segPerms[key];
      matchedKey = key;
      break;
    }
  }

  const lot = segSettings?.lotSettings || {};
  const qtyMode = segSettings?.quantityModeSettings || {};

  let carryForwardLeverage = null;
  if (Number(lot.carryForwardLeverage) > 0) carryForwardLeverage = Number(lot.carryForwardLeverage);
  else if (Number(qtyMode.carryForwardLeverage) > 0) {
    carryForwardLeverage = Number(qtyMode.carryForwardLeverage);
  } else if (Number(segSettings?.exposureCarryForward) > 0) {
    carryForwardLeverage = Number(segSettings.exposureCarryForward);
  } else if (Number(segSettings?.carryForwardLeverage) > 0) {
    carryForwardLeverage = Number(segSettings.carryForwardLeverage);
  }

  let autosquarePercent = null;
  if (lot.autosquarePercent != null) autosquarePercent = Number(lot.autosquarePercent);
  else if (qtyMode.autosquarePercent != null) autosquarePercent = Number(qtyMode.autosquarePercent);

  const carryForwardUseTotalEquity =
    lot.carryForwardUseTotalEquity === true || qtyMode.carryForwardUseTotalEquity === true;

  return {
    matchedKey,
    segSettings,
    carryForwardLeverage:
      Number.isFinite(carryForwardLeverage) && carryForwardLeverage > 0 ? carryForwardLeverage : null,
    autosquarePercent:
      Number.isFinite(autosquarePercent) && autosquarePercent >= 0 ? autosquarePercent : null,
    carryForwardUseTotalEquity,
  };
}

export function segmentPermissionKeysForTrade(trade, segmentGroup) {
  if (segmentGroup === 'CRYPTO' || trade?.isCrypto || trade?.exchange === 'BINANCE') {
    return ['CRYPTOFUT', 'CRYPTOOPT', 'CRYPTO'];
  }
  if (segmentGroup === 'FOREX' || trade?.isForex || trade?.exchange === 'FOREX') {
    return ['FOREXFUT', 'FOREXOPT', 'FOREX'];
  }
  if (segmentGroup === 'MCX' || trade?.exchange === 'MCX') {
    return ['MCXFUT', 'MCXOPT', 'MCX'];
  }
  const seg = String(trade?.segment || '').toUpperCase();
  if (seg) return [seg];
  return [];
}

export function walletFieldForSegmentGroup(segmentGroup) {
  if (segmentGroup === 'FOREX') return 'forexWallet';
  if (segmentGroup === 'MCX') return 'mcxWallet';
  if (segmentGroup === 'CRYPTO') return 'cryptoWallet';
  return 'nseBseWallet';
}

function isUsdStyleSegment(segmentGroup) {
  return segmentGroup === 'CRYPTO' || segmentGroup === 'FOREX';
}

export function resolveCarryMarkPrice(trade, alignedLtp, segmentGroup) {
  const px = Number(alignedLtp) || Number(trade?.entryPrice) || 0;
  if (isUsdStyleSegment(segmentGroup)) {
    return Number(alignCryptoExitToEntryUnit(trade, px)) || px;
  }
  return resolveSafeNseBseMarkPrice(trade, px);
}

/**
 * Wallet basis for carry-forward cap = cash + open MTM (autosquare card P&L basis).
 * Optional admin flag adds blocked usedMargin on top.
 */
export function resolveCarryForwardWalletEquity(
  cashBalance,
  usedMargin,
  { carryForwardUseTotalEquity, openMtm = 0 } = {}
) {
  const cash = Math.max(0, Number(cashBalance) || 0);
  const um = Math.max(0, Number(usedMargin) || 0);
  const mtm = Number(openMtm) || 0;
  let equity = roundMoney(cash + mtm);
  if (carryForwardUseTotalEquity) {
    equity = roundMoney(equity + um);
  }
  return Math.max(0, equity);
}

/** Sum open-position MTM at mark for all trades in this wallet (same basis as autosquare card P&L). */
async function sumOpenWalletMtmAtMark(userObjectId, walletField, primaryTrade, primaryMarkPx) {
  const segQ = SEGMENT_QUERIES_BY_WALLET[walletField];
  if (!segQ) return 0;

  const trades = await Trade.find({ user: userObjectId, status: 'OPEN', ...segQ }).lean();
  if (!trades.length) return 0;

  const priceMap = await getMarkPricesForTrades(trades, { preferBidAsk: true });
  let total = 0;

  for (const t of trades) {
    const qty =
      t.originalQty != null && Number(t.originalQty) > 0
        ? Number(t.originalQty)
        : Number(t.quantity) || Number(t.lots) || 0;
    const pr = priceMap.get(String(t._id));
    let px =
      primaryTrade && String(t._id) === String(primaryTrade._id)
        ? primaryMarkPx
        : pr?.markPrice ?? (Number(t.currentPrice) || Number(t.entryPrice) || 0);
    const segGroup = walletField === 'forexWallet' ? 'FOREX' : walletField === 'mcxWallet' ? 'MCX' : walletField === 'cryptoWallet' ? 'CRYPTO' : 'NSE';
    px = resolveCarryMarkPrice(t, px, segGroup);
    if (px > 0 && qty > 0) {
      total += computeMarkToMarketPnL(t, px, qty);
    }
  }
  return roundMoney(total);
}

export function capCarryForwardQtyToOriginal(qtyAtEvent, rawNextDayQty) {
  const raw = Math.max(0, Math.floor(Number(rawNextDayQty) || 0));
  const orig = Math.max(0, Math.floor(Number(qtyAtEvent) || 0));
  if (orig > 0) return Math.min(raw, orig);
  return raw;
}

/**
 * End-time carry-forward (CRYPTO / FOREX / MCX / NSE) with optional partial close for trimmed leg.
 */
/**
 * Same user + symbol + side at one session close — one carry cap, split qty across trade legs.
 */
export async function applyNetCarryForwardGroup(trades, options) {
  const list = (trades || []).filter(Boolean);
  if (!list.length) return [];
  if (list.length === 1) {
    return [await applySegmentCarryForward(list[0], options)];
  }

  const { ltp, closeTime, segmentGroup, admin } = options;
  const sorted = [...list].sort((a, b) => tradeQtyAtCarryEvent(b) - tradeQtyAtCarryEvent(a));
  const primary = sorted[0];
  const totalQty = sorted.reduce((s, t) => s + tradeQtyAtCarryEvent(t), 0);

  const primaryResult = await applySegmentCarryForward(primary, {
    ...options,
    qtyAtEventOverride: totalQty,
    skipApply: true,
  });

  let netNext = primaryResult.plannedNextDayQty ?? 0;
  netNext = capCarryForwardQtyToOriginal(totalQty, netNext);
  netNext = capCarryForwardNextDayQty(segmentGroup, totalQty, netNext);

  const qtyList = sorted.map((t) => ({
    tradeId: t._id,
    qty: tradeQtyAtCarryEvent(t),
  }));
  const allocs = allocateProportionalNextDay(netNext, qtyList);
  const allocById = new Map(allocs.map((a) => [String(a.tradeId), a.alloc]));

  const results = [];
  for (const t of sorted) {
    const alloc = allocById.get(String(t._id)) ?? 0;
    const r = await applySegmentCarryForward(t, {
      ltp,
      closeTime,
      segmentGroup,
      admin,
      allocatedNextDayQty: alloc,
      groupCarrySnapshot: {
        carryForwardLimit: primaryResult.carryForwardLimitAtSquare ?? 0,
        positionValue: primaryResult.positionValueAtSquare ?? 0,
        totalQtyAtEvent: totalQty,
      },
    });
    results.push(r);
  }
  return results;
}

export { buildNetCarryGroupKey, groupTradesForNetCarry };

export async function applySegmentCarryForward(trade, {
  ltp,
  closeTime,
  segmentGroup,
  admin,
  carryForwardLeverage: levOverride = null,
  allocatedNextDayQty = null,
  qtyAtEventOverride = null,
  skipApply = false,
  groupCarrySnapshot = null,
}) {
  const seg = readSegmentSettingsForCarry(admin, trade, segmentGroup);
  const carryForwardLeverage =
    Number.isFinite(Number(levOverride)) && Number(levOverride) > 0
      ? Number(levOverride)
      : seg.carryForwardLeverage;
  if (!(carryForwardLeverage > 0)) {
    throw new Error(
      `Carry-forward leverage not configured for ${trade.symbol || trade.tradeId} (admin segment ${seg.matchedKey || '—'})`
    );
  }

  const closeKey = normalizeCloseTimeKey(closeTime);
  if (closeKey) {
    const early = await Trade.findById(trade._id).select('autoSquareHistory status quantity carryForwardQty').lean();
    if (early?.status !== 'OPEN') {
      return {
        skippedDuplicate: true,
        fullyClosed: early?.status === 'CLOSED',
        nextDayQty: 0,
        carryForwardQty: Number(early?.carryForwardQty) || 0,
      };
    }
    const dup = (early?.autoSquareHistory || []).some(
      (e) =>
        normalizeCloseTimeKey(e.closeTime) === closeKey &&
        sameISTDay(e.autoSquaredAt || new Date(), new Date())
    );
    if (dup) {
      return {
        skippedDuplicate: true,
        fullyClosed: false,
        nextDayQty: Number(early?.carryForwardQty) || Number(early?.quantity) || 0,
        carryForwardQty: Number(early?.carryForwardQty) || Number(early?.quantity) || 0,
      };
    }
  }

  const walletRoot = walletFieldForSegmentGroup(segmentGroup);
  const user = await User.findOne({ userId: trade.userId }).select(`${walletRoot} _id adminCode`).lean();
  if (!user) throw new Error(`User ${trade.userId} not found`);

  const cashBalance = walletCashBalance(user, walletRoot);
  const usedMargin = Math.max(0, Number(user[walletRoot]?.usedMargin) || 0);

  const qtyAtEvent =
    qtyAtEventOverride != null && Number(qtyAtEventOverride) > 0
      ? Number(qtyAtEventOverride)
      : trade.originalQty != null && Number(trade.originalQty) > 0
        ? Number(trade.originalQty)
        : Number(trade.quantity) || Number(trade.lots) || 1;
  const legQtyAtEvent =
    trade.originalQty != null && Number(trade.originalQty) > 0
      ? Number(trade.originalQty)
      : Number(trade.quantity) || Number(trade.lots) || 1;
  const firstOrigQty = trade.originalQty != null ? Number(trade.originalQty) : legQtyAtEvent;
  const entryLtp = Number(trade.entryPrice) || 0;
  const alignedLtp = Number(ltp) > 0 ? Number(ltp) : entryLtp;
  const markPx = resolveCarryMarkPrice(trade, alignedLtp, segmentGroup);

  const openMtmAtSquare = await sumOpenWalletMtmAtMark(user._id, walletRoot, trade, markPx);
  const walletEquity = resolveCarryForwardWalletEquity(cashBalance, usedMargin, {
    ...seg,
    openMtm: openMtmAtSquare,
  });

  let carry;
  let nextDayQty;
  if (allocatedNextDayQty != null) {
    carry = groupCarrySnapshot || {
      carryForwardLimit: 0,
      positionValue: legQtyAtEvent * markPx,
    };
    nextDayQty = capCarryForwardQtyToOriginal(
      legQtyAtEvent,
      Math.min(legQtyAtEvent, Math.floor(Number(allocatedNextDayQty) || 0))
    );
    nextDayQty = capCarryForwardNextDayQty(segmentGroup, legQtyAtEvent, nextDayQty);
  } else {
    carry = computeCryptoForexCarryNextDayQty(trade, {
      qtyAtEvent,
      ltp: markPx,
      walletEquity,
      carryForwardLeverage,
    });
    nextDayQty = capCarryForwardQtyToOriginal(qtyAtEvent, carry.nextDayQty);
    nextDayQty = capCarryForwardNextDayQty(segmentGroup, qtyAtEvent, nextDayQty);
  }

  if (skipApply) {
    return {
      plannedNextDayQty: nextDayQty,
      carryForwardLimitAtSquare: carry.carryForwardLimit,
      positionValueAtSquare: carry.positionValue,
      walletEquityAtSquare: walletEquity,
    };
  }

  const closedQty = Math.max(0, legQtyAtEvent - nextDayQty);
  let realizedPnL = 0;
  let walletBalanceAfter = cashBalance;

  const cannotHoldOneUnit =
    carry.carryForwardLimit > 0 && markPx > 0 && carry.carryForwardLimit < markPx;
  const noEquity = walletEquity < 0.01;

  if (nextDayQty <= 0 && legQtyAtEvent > 0 && (cannotHoldOneUnit || noEquity)) {
    const TradingService = (await import('./tradingService.js')).default;
    const priceMap = await getMarkPricesForTrades([trade], { preferBidAsk: true });
    const pr = priceMap.get(String(trade._id));
    const px = markPx;
    await TradingService.squareOffPosition(
      String(trade._id),
      'AUTO_SQUARE',
      px,
      trade.side === 'BUY' ? pr?.bid ?? px : undefined,
      trade.side === 'SELL' ? pr?.ask ?? px : undefined
    );
    return {
      originalQty: legQtyAtEvent,
      firstOrigQty,
      nextDayQty: 0,
      carryForwardQty: 0,
      pnl: 0,
      realizedPnL: 0,
      netBalance: walletEquity,
      carryForwardLeverage,
      carryForwardLimitAtSquare: carry.carryForwardLimit,
      positionValueAtSquare: carry.positionValue,
      walletEquityAtSquare: walletEquity,
      cashAtSquare: roundMoney(cashBalance),
      openMtmAtSquare,
      fullyClosed: true,
    };
  }

  if (closedQty > 0.0001) {
    const { executePartialClose } = await import('./partialCloseService.js');
    const priceMap = await getMarkPricesForTrades([trade], { preferBidAsk: true });
    const pr = priceMap.get(String(trade._id));
    const partialRes = await executePartialClose(user._id, String(trade._id), {
      quantity: closedQty,
      exitPrice: markPx,
      bidPrice: trade.side === 'BUY' ? pr?.bid ?? markPx : undefined,
      askPrice: trade.side === 'SELL' ? pr?.ask ?? markPx : undefined,
      closeReason: 'AUTO_SQUARE',
    });
    realizedPnL = roundMoney(partialRes?.netPnL ?? partialRes?.grossPnL ?? 0);
    const freshBalDoc = await User.findById(user._id).select(`${walletRoot}.balance`).lean();
    const freshCash = Number(freshBalDoc?.[walletRoot]?.balance);
    walletBalanceAfter =
      partialRes?.margin?.balance ??
      (Number.isFinite(freshCash) ? freshCash : cashBalance);

    await Trade.updateOne(
      { _id: trade._id },
      { $set: { 'partialClose.closeReason': 'AUTO_SQUARE' } }
    );
  }

  const displayPnL =
    closedQty > 0
      ? realizedPnL
      : computeMarkToMarketPnL(trade, markPx, legQtyAtEvent);

  const squaredAt = closeKey ? parseIstSessionCloseAt(closeKey, new Date()) : new Date();
  const historyEntry = {
    autoSquaredAt: squaredAt,
    closeTime: closeKey,
    autoSquareLtp: markPx,
    originalQty: legQtyAtEvent,
    nextDayQty,
    closedQtyAtCarry: closedQty,
    pnlAtAutoSquare: displayPnL,
    realizedPnLAtCarry: realizedPnL,
    netBalanceAtAutoSquare: walletEquity,
    walletEquityAtSquare: walletEquity,
    cashAtSquare: roundMoney(cashBalance),
    openMtmAtSquare,
    carryForwardLeverage,
    carryForwardLimitAtSquare: carry.carryForwardLimit,
    positionValueAtSquare: carry.positionValue,
    netQtyAtEvent: groupCarrySnapshot?.totalQtyAtEvent ?? null,
  };

  const fresh = await Trade.findById(trade._id).select('quantity marginUsed requiredMargin').lean();
  const prevMargin = Number(fresh?.marginUsed) || Number(trade.marginUsed) || 0;
  const liveQty = Number(fresh?.quantity) || nextDayQty;
  const finalQty = Math.min(liveQty, nextDayQty);
  const nextMargin =
    legQtyAtEvent > 0 && prevMargin > 0
      ? roundMoney((prevMargin * finalQty) / legQtyAtEvent)
      : roundMoney((finalQty * markPx) / carryForwardLeverage);

  const latestFields = {
    status: finalQty > 1e-9 ? 'OPEN' : 'CLOSED',
    isAutoSquared: true,
    autoSquaredAt: squaredAt,
    autoSquareLtp: markPx,
    closeReason: 'AUTO_SQUARE',
    originalQty: firstOrigQty,
    pnlAtAutoSquare: displayPnL,
    carryForwardQty: finalQty,
    netBalanceAtAutoSquare: walletEquity,
    quantity: finalQty,
    productType: 'NRML',
    leverage: carryForwardLeverage,
    marginUsed: finalQty > 1e-9 ? nextMargin : 0,
    requiredMargin: finalQty > 1e-9 ? nextMargin : 0,
    currentPrice: markPx,
    unrealizedPnL:
      finalQty > 1e-9
        ? roundMoney(computeMarkToMarketPnL(trade, markPx, finalQty))
        : 0,
  };
  if (finalQty <= 1e-9) {
    latestFields.closedAt = squaredAt;
    latestFields.exitPrice = markPx;
    latestFields.realizedPnL = displayPnL;
    latestFields.netPnL = displayPnL;
  }

  const freshEarly = await Trade.findById(trade._id).select('autoSquareHistory').lean();
  const alreadyLogged = (freshEarly?.autoSquareHistory || []).some((e) => {
    if (closeKey) {
      return (
        normalizeCloseTimeKey(e.closeTime) === closeKey &&
        sameISTDay(e.autoSquaredAt || squaredAt, squaredAt)
      );
    }
    return sameISTDay(e.autoSquaredAt, squaredAt);
  });

  if (!alreadyLogged) {
    await Trade.findByIdAndUpdate(trade._id, {
      $push: { autoSquareHistory: historyEntry },
      $set: latestFields,
    });
  }

  if (user._id) {
    try {
      await recalculateUsedMargin(user._id);
    } catch (err) {
      console.warn(`[CarryForward] usedMargin recalc failed:`, err?.message || err);
    }
  }

  return {
    originalQty: legQtyAtEvent,
    firstOrigQty,
    nextDayQty: finalQty,
    carryForwardQty: finalQty,
    pnl: displayPnL,
    realizedPnL,
    netBalance: walletEquity,
    carryForwardLeverage,
    carryForwardLimitAtSquare: carry.carryForwardLimit,
    positionValueAtSquare: carry.positionValue,
    walletEquityAtSquare: walletEquity,
    cashAtSquare: roundMoney(cashBalance),
    openMtmAtSquare,
    walletBalanceAfter,
    closedQty,
    historyEntry,
    fullyClosed: false,
  };
}

/** @deprecated Alias — use applySegmentCarryForward */
export async function applyCryptoForexCarryForward(trade, options) {
  return applySegmentCarryForward(trade, options);
}

function sameISTDay(a, b) {
  if (!a || !b) return false;
  const fmt = (d) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(d));
  return fmt(a) === fmt(b);
}

