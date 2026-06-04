/**
 * NSE/BSE ledger autosquare:
 * - When available margin <= 0 → square ALL positions to nil
 * - Market closed: MTM uses bid (BUY) / ask (SELL)
 */

import User from '../models/User.js';
import Trade from '../models/Trade.js';
import Instrument from '../models/Instrument.js';
import Notification from '../models/Notification.js';
import WalletService from './walletService.js';
import TradingService from './tradingService.js';
import WalletLedger from '../models/WalletLedger.js';
import { getLTP } from './ltpResolutionService.js';
import { getNseBseBalance, readNseBseWalletFromDb } from '../utils/nseBseWallet.js';
import { recalculateUsedMargin } from '../utils/recalculateUsedMargin.js';
import {
  computeAvailableMarginForWallet,
  getWalletLedgerReferenceBalance,
  shouldTriggerLedgerAutosquare,
} from './ledgerAutosquareService.js';
import {
  evaluateIntradayAutosquareTrigger,
  resolveAutosquarePercentFromSettings,
  resolveCashLedgerAutosquareMetrics,
} from '../utils/autosquareThreshold.js';
import {
  isPlausibleNseBseMarkPrice,
  resolveSafeNseBseMarkPrice,
  sanitizeInrWalletAmount,
  isAbsurdOpenQuantity,
  resolveSafeOpenQuantity,
} from '../utils/walletBalanceSanity.js';

let io = null;

export function initNseBseLedgerAutosquare(socketIO) {
  io = socketIO;
}

export const NSE_BSE_SEGMENT_QUERY = {
  isCrypto: { $ne: true },
  isForex: { $ne: true },
  exchange: { $nin: ['BINANCE', 'MCX', 'FOREX'] },
  segment: { $nin: ['FOREX', 'FOREXFUT', 'FOREXOPT', 'MCX', 'MCXFUT', 'MCXOPT'] },
};

export function isNseBseTrade(trade) {
  if (!trade) return false;
  if (trade.isCrypto || trade.isForex) return false;
  const ex = String(trade.exchange || '').toUpperCase();
  const seg = String(trade.segment || '').toUpperCase();
  if (['MCX', 'BINANCE', 'FOREX'].includes(ex)) return false;
  if (seg.startsWith('MCX') || seg.startsWith('FOREX')) return false;
  if (['NSE', 'BSE', 'NFO', 'BFO'].includes(ex)) return true;
  if (seg.startsWith('NSE') || seg.startsWith('BSE') || seg === 'FNO' || seg === 'EQUITY') return true;
  return !['MCX', 'BINANCE', 'FOREX'].includes(ex);
}

export function ledgerClosePercent(user) {
  const p = Number(user?.settings?.ledgerBalanceClosePercent);
  if (Number.isFinite(p) && p >= 0 && p <= 100) return p;
  return 90;
}

export function minEquityFloor(referenceBalance, closePercent) {
  const ref = Math.max(0, Number(referenceBalance) || 0);
  const pct = Math.min(100, Math.max(0, Number(closePercent) || 90));
  return Math.round(ref * ((100 - pct) / 100) * 100) / 100;
}

export async function getLedgerReferenceBalance(userId) {
  const user = await User.findById(userId).select('nseBseWallet wallet').lean();
  if (!user) return 0;
  let ref = Number(user.nseBseWallet?.ledgerReferenceBalance);
  const bal = getNseBseBalance(user);
  if (!Number.isFinite(ref) || ref <= 0) {
    ref = bal > 0 ? bal : 0;
    if (ref > 0) {
      await User.updateOne({ _id: userId }, { $set: { 'nseBseWallet.ledgerReferenceBalance': ref } });
    }
  }
  return ref;
}

export async function bumpLedgerReferenceOnCredit(userId, newCashBalance) {
  const bal = Math.max(0, Number(newCashBalance) || 0);
  const ref = await getLedgerReferenceBalance(userId);
  const next = Math.max(ref, bal);
  if (next > ref) {
    await User.updateOne({ _id: userId }, { $set: { 'nseBseWallet.ledgerReferenceBalance': next } });
  }
  return next;
}

export async function resetDailyLedgerReference(userId = null) {
  const query = userId ? { _id: userId } : {};
  const users = await User.find(query).select('_id nseBseWallet wallet').lean();
  for (const u of users) {
    const bal = getNseBseBalance(u);
    await User.updateOne(
      { _id: u._id },
      {
        $set: {
          'nseBseWallet.ledgerReferenceBalance': bal,
          'nseBseWallet.ledgerAutosquareActive': false,
        },
        $unset: { 'nseBseWallet.ledgerAutosquaredAt': 1 },
      }
    );
  }
}

/**
 * Mark price for MTM: live → LTP; closed market → bid (long) / ask (short).
 */
export async function getMarkPricesForTrades(trades, { preferBidAsk = false } = {}) {
  const out = new Map();
  const list = trades || [];
  if (list.length === 0) return out;

  const tokens = [...new Set(list.map((t) => String(t.token || '')).filter(Boolean))];
  const insts = tokens.length
    ? await Instrument.find({ token: { $in: tokens } })
        .select('token lastBid lastAsk ltp')
        .lean()
    : [];
  const instByToken = new Map(insts.map((i) => [String(i.token), i]));

  for (const tr of list) {
    const inst = instByToken.get(String(tr.token || ''));
    const ltp =
      (await getLTP({ token: tr.token, symbol: tr.symbol, exchange: tr.exchange })) ||
      Number(tr.currentPrice) ||
      Number(tr.entryPrice) ||
      0;
    const bid = Number(inst?.lastBid) > 0 ? Number(inst.lastBid) : ltp;
    const ask = Number(inst?.lastAsk) > 0 ? Number(inst.lastAsk) : ltp;
    let markPrice = ltp;
    if (preferBidAsk) {
      markPrice = tr.side === 'BUY' ? bid || ltp : ask || ltp;
    }
    if (markPrice > 0) {
      markPrice = resolveSafeNseBseMarkPrice(tr, markPrice);
    }
    out.set(String(tr._id), {
      ltp,
      bid,
      ask,
      markPrice: markPrice > 0 ? markPrice : tr.entryPrice,
      markRejected: markPrice > 0 && !isPlausibleNseBseMarkPrice(tr, ltp),
    });
  }
  return out;
}

export async function computeNseBseRealBalance(userId, { preferBidAsk = false, segment = null, autosquarePercent: autosquarePercentOverride = null } = {}) {
  const live = await readNseBseWalletFromDb(userId);
  const user = await User.findById(userId)
    .select('settings nseBseWallet segmentPermissions')
    .populate('admin', 'segmentPermissions')
    .lean();
  if (user?.admin?.segmentPermissions) {
    user.parentSegmentPermissions = user.admin.segmentPermissions;
  }

  const positions = await Trade.find({
    user: userId,
    status: 'OPEN',
    ...NSE_BSE_SEGMENT_QUERY,
  }).lean();

  const priceMap = await getMarkPricesForTrades(positions, { preferBidAsk });
  let totalMtm = 0;
  for (const p of positions) {
    const mp = priceMap.get(String(p._id))?.markPrice ?? p.currentPrice ?? p.entryPrice;
    let pnl = WalletService.calculatePositionPnL(p, mp);
    if (isAbsurdOpenQuantity(p)) {
      const safeQ = resolveSafeOpenQuantity(p);
      pnl = WalletService.calculatePositionPnL({ ...p, quantity: safeQ }, mp);
    }
    totalMtm += pnl;
  }
  totalMtm = sanitizeInrWalletAmount(totalMtm, {
    field: 'nseBseTotalMtm',
    userId: String(userId),
  });

  const cashBalance = live.balance;
  const usedMargin = Math.max(0, Number(live.usedMargin) || 0);
  const walletUser = { ...user, nseBseWallet: { ...user?.nseBseWallet, balance: cashBalance, usedMargin } };
  const referenceBalance = await getWalletLedgerReferenceBalance(userId, 'nseBseWallet', cashBalance);
  const { equityBasis, realBalance: realBal } = resolveCashLedgerAutosquareMetrics({
    cashBalance,
    referenceBalance,
    totalMtm,
  });
  const realBalance = sanitizeInrWalletAmount(realBal, {
    field: 'nseBseRealBalance',
    userId: String(userId),
  });
  const segHint = segment || positions[0]?.segment || null;
  const availableMargin = await computeAvailableMarginForWallet(walletUser, 'nseBseWallet', totalMtm, {
    segment: segHint,
  });
  const marginCushion = Math.round((cashBalance - usedMargin) * 100) / 100;

  let autosquarePercent = autosquarePercentOverride;
  if (autosquarePercent == null || !Number.isFinite(Number(autosquarePercent))) {
    if (segHint) {
      try {
        const TradeService = (await import('./tradeService.js')).default;
        const segmentSettings = await TradeService.getUserSegmentSettings(user, segHint);
        autosquarePercent = resolveAutosquarePercentFromSettings(segmentSettings, user);
      } catch {
        autosquarePercent = resolveAutosquarePercentFromSettings(null, user);
      }
    } else {
      autosquarePercent = resolveAutosquarePercentFromSettings(null, user);
    }
  }

  const triggerEval = evaluateIntradayAutosquareTrigger({
    equityBasis,
    realBalance,
    autosquarePercent,
  });

  return {
    cashBalance,
    usedMargin,
    marginCushion,
    equityBasis,
    totalMtm: Math.round(totalMtm * 100) / 100,
    realBalance,
    availableMargin,
    autosquarePercent: triggerEval.autosquarePercent,
    lossPercent: triggerEval.lossPercent,
    shouldTrigger: triggerEval.trigger,
    triggerReason: triggerEval.reason,
    openPositions: positions.length,
    priceMap,
  };
}

/**
 * Square ALL NSE/BSE open positions (nil). Uses bid/ask for exit prices.
 */
export async function executeLedgerAutosquareNil(userId, { reason = 'INTRADAY_AUTOSQUARE', force = false, snapshot: snapshotHint = null } = {}) {
  const user = await User.findById(userId).select('userId adminCode nseBseWallet settings').lean();
  if (!user) return { success: false, message: 'User not found' };

  if (!force && user.nseBseWallet?.ledgerAutosquareActive) {
    return { success: true, skipped: true, closed: 0 };
  }

  const positions = await Trade.find({
    user: userId,
    status: 'OPEN',
    ...NSE_BSE_SEGMENT_QUERY,
  });

  if (positions.length === 0) {
    return { success: true, closed: 0 };
  }

  const priceMap = await getMarkPricesForTrades(positions, { preferBidAsk: true });
  let closed = 0;
  const errors = [];

  for (const pos of positions) {
    try {
      const pr = priceMap.get(String(pos._id));
      const result = await TradingService.squareOffPosition(
        pos._id.toString(),
        'AUTO_SQUARE',
        pr?.markPrice,
        pr?.bid,
        pr?.ask
      );
      if (result?.success || result?.trade?.status === 'CLOSED') {
        closed++;
      } else {
        errors.push({ tradeId: pos.tradeId, message: result?.message });
      }
    } catch (e) {
      errors.push({ tradeId: pos.tradeId, message: e.message });
    }
  }

  const snapshot = snapshotHint || (await computeNseBseRealBalance(userId, { preferBidAsk: true }));
  const finalBal = Math.max(0, snapshot.realBalance);
  const threshold = snapshot?.autosquarePercent;
  const loss = snapshot?.lossPercent;
  const notifySubject =
    reason?.startsWith('INTRADAY_AUTOSQUARE_') || reason === 'EQUITY_DEPLETED'
      ? `NSE/BSE auto-square — ${threshold}% loss threshold reached`
      : 'All NSE/BSE positions closed (auto-square)';
  const notifyDesc =
    reason?.startsWith('INTRADAY_AUTOSQUARE_') || reason === 'EQUITY_DEPLETED'
      ? `Equity loss reached ${loss}% (autosquare limit ${threshold}%). ${closed} position(s) were squared off at market.`
      : `${closed} position(s) were squared off at market.`;

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        'nseBseWallet.balance': finalBal,
        'nseBseWallet.ledgerAutosquareActive': true,
        'nseBseWallet.ledgerAutosquaredAt': new Date(),
        'wallet.tradingBalance': 0,
      },
    }
  );

  await recalculateUsedMargin(userId);
  await WalletService.recalculateWallet(userId);

  try {
    await WalletLedger.create({
      ownerType: 'USER',
      ownerId: userId,
      adminCode: user.adminCode,
      type: 'DEBIT',
      reason: 'TRADE_PNL',
      amount: 0,
      balanceAfter: finalBal,
      description: `NSE/BSE intraday autosquare (${threshold}% threshold, loss ${loss}%) — ${closed} position(s) closed`,
      isAutoSquare: true,
      meta: { segment: 'NSE/BSE', reason, positionsClosed: closed, lossPercent: loss, autosquarePercent: threshold },
    });
  } catch {
    /* ledger note optional */
  }

  await Notification.create({
    title: 'Auto-Square',
    subject: notifySubject,
    description: notifyDesc,
    senderType: 'SYSTEM',
    targetType: 'SINGLE_USER',
    targetUserId: userId,
    priority: 'CRITICAL',
  });

  if (io) {
    io.to(String(userId)).emit('ledger_autosquare', {
      reason,
      positionsClosed: closed,
      realBalance: finalBal,
      availableMargin: snapshot.availableMargin,
      timestamp: new Date(),
    });
  }

  console.log(
    `[LedgerAutosquare] User ${user.userId}: closed ${closed}/${positions.length}, balance=₹${finalBal}`
  );

  return { success: true, closed, finalBalance: finalBal, errors };
}

export async function checkAndRunLedgerAutosquare(userId, { preferBidAsk = false, segment = null, autosquarePercent = null } = {}) {
  const user = await User.findById(userId).select('settings nseBseWallet rmsSettings').lean();
  if (!user) return null;
  if (user.rmsSettings?.tradingBlocked) return null;

  if (user.nseBseWallet?.ledgerAutosquareActive) {
    const stillOpen = await Trade.exists({ user: userId, status: 'OPEN', ...NSE_BSE_SEGMENT_QUERY });
    if (!stillOpen) return null;
    await User.updateOne({ _id: userId }, { $set: { 'nseBseWallet.ledgerAutosquareActive': false } });
  }

  const snapshot = await computeNseBseRealBalance(userId, { preferBidAsk, segment, autosquarePercent });
  if (!snapshot.openPositions) return null;

  if (!snapshot.shouldTrigger) return { triggered: false, snapshot };

  const reason = snapshot.triggerReason || `INTRADAY_AUTOSQUARE_${snapshot.autosquarePercent}%`;
  console.log(
    `[LedgerAutosquare NSE/BSE] TRIGGER user=${userId}: loss=${snapshot.lossPercent}% ` +
      `threshold=${snapshot.autosquarePercent}% reason=${reason}`
  );

  const result = await executeLedgerAutosquareNil(userId, { reason, snapshot });
  return { triggered: true, snapshot, result };
}

export async function getLedgerStatusForApi(userId) {
  const user = await User.findById(userId).select('settings nseBseWallet').lean();
  const snapshot = await computeNseBseRealBalance(userId, { preferBidAsk: false });
  if (!snapshot) {
    return {
      cashBalance: 0,
      usedMargin: 0,
      marginCushion: 0,
      equityBasis: 0,
      totalMtm: 0,
      realBalance: 0,
      availableMargin: 0,
      autosquarePercent: 90,
      lossPercent: 0,
      shouldTrigger: false,
      openPositions: 0,
      ledgerAutosquareActive: !!user?.nseBseWallet?.ledgerAutosquareActive,
      ledgerAutosquaredAt: user?.nseBseWallet?.ledgerAutosquaredAt || null,
    };
  }
  const { priceMap: _priceMap, ...safe } = snapshot;
  return {
    ...safe,
    ledgerAutosquareActive: !!user?.nseBseWallet?.ledgerAutosquareActive,
    ledgerAutosquaredAt: user?.nseBseWallet?.ledgerAutosquaredAt || null,
  };
}

export default {
  initNseBseLedgerAutosquare,
  computeNseBseRealBalance,
  checkAndRunLedgerAutosquare,
  executeLedgerAutosquareNil,
  getLedgerStatusForApi,
  shouldTriggerLedgerAutosquare,
  resetDailyLedgerReference,
  bumpLedgerReferenceOnCredit,
};
