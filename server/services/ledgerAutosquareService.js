/**
 * Generic ledger autosquare (all segments):
 * - Intraday: close when equity loss >= segment autosquarePercent (70 / 90 etc.)
 *   All segments: basis = ledgerReferenceBalance (or cash); real = cash + open MTM
 * - End-time carry-forward is separate (eodSettlement.js + carryForwardLeverage)
 * - MTM mark price can prefer bid/ask: bid for BUY, ask for SELL
 */

import User from '../models/User.js';
import Trade from '../models/Trade.js';
import Instrument from '../models/Instrument.js';
import Notification from '../models/Notification.js';
import WalletService from './walletService.js';
import TradingService from './tradingService.js';
import WalletLedger from '../models/WalletLedger.js';
import { getLTP } from './ltpResolutionService.js';
import { recalculateUsedMargin } from '../utils/recalculateUsedMargin.js';
import { getNseBseBalance } from '../utils/nseBseWallet.js';
import {
  evaluateIntradayAutosquareTrigger,
  resolveAutosquarePercentFromSettings,
  resolveCashLedgerAutosquareMetrics,
  shouldTriggerLedgerAutosquare,
} from '../utils/autosquareThreshold.js';

let io = null;

export function initLedgerAutosquare(socketIO) {
  io = socketIO;
}

export const SEGMENT_QUERIES_BY_WALLET = {
  nseBseWallet: {
    isCrypto: { $ne: true },
    isForex: { $ne: true },
    exchange: { $nin: ['BINANCE', 'MCX', 'FOREX'] },
    segment: { $nin: ['FOREX', 'FOREXFUT', 'FOREXOPT', 'MCX', 'MCXFUT', 'MCXOPT'] },
  },
  mcxWallet: {
    $or: [{ exchange: 'MCX' }, { segment: 'MCX' }, { segment: 'MCXFUT' }, { segment: 'MCXOPT' }],
  },
  cryptoWallet: {
    $or: [{ isCrypto: true }, { exchange: 'BINANCE' }, { segment: 'CRYPTO' }, { segment: 'CRYPTOFUT' }, { segment: 'CRYPTOOPT' }],
  },
  forexWallet: {
    $or: [{ isForex: true }, { exchange: 'FOREX' }, { segment: 'FOREX' }, { segment: 'FOREXFUT' }, { segment: 'FOREXOPT' }],
  },
};

export function ledgerClosePercent(user) {
  const p = Number(user?.settings?.ledgerBalanceClosePercent);
  if (Number.isFinite(p) && p >= 0 && p <= 100) return p;
  return 90;
}

/** Wallet cash (free balance field). */
export function walletCashBalance(user, walletField) {
  const wf = String(walletField || '').trim();
  if (!user || !wf) return 0;
  if (wf === 'nseBseWallet') return getNseBseBalance(user);
  return Math.max(0, Number(user[wf]?.balance) || 0);
}

/**
 * Account equity before open-position MTM (cash + margin blocked in usedMargin).
 */
export function walletEquityBasis(user, walletField) {
  const wf = String(walletField || '').trim();
  const cash = walletCashBalance(user, wf);
  const usedMargin = Math.max(0, Number(user?.[wf]?.usedMargin) || 0);
  return Math.round((cash + usedMargin) * 100) / 100;
}

/** Avoid Mongo "Path collision" — do not mix `nseBseWallet` parent with `nseBseWallet.*` subpaths. */
function userSelectForWalletField(walletField, extraFields = '') {
  const wf = String(walletField || '').trim();
  const extra = String(extraFields || '').trim();
  if (wf === 'nseBseWallet') {
    return [extra, 'nseBseWallet', 'wallet'].filter(Boolean).join(' ');
  }
  return [extra, wf, 'wallet'].filter(Boolean).join(' ');
}

function userSelectForWalletReference(walletField) {
  const wf = String(walletField || '').trim();
  if (wf === 'nseBseWallet') {
    return 'nseBseWallet wallet';
  }
  return `${wf}.ledgerReferenceBalance ${wf}.balance wallet`;
}

/** Reference balance for % loss — seeds from cash when unset (all sub-wallets). */
export async function getWalletLedgerReferenceBalance(userId, walletField, cashBalance = null) {
  const wf = String(walletField || '').trim();
  if (!wf) return 0;

  const user = await User.findById(userId)
    .select(userSelectForWalletReference(wf))
    .lean();
  if (!user) return 0;

  const cash =
    cashBalance != null && Number.isFinite(Number(cashBalance))
      ? Math.max(0, Number(cashBalance))
      : walletCashBalance(user, wf);

  let ref = Number(user[wf]?.ledgerReferenceBalance);
  if (!Number.isFinite(ref) || ref <= 0) {
    ref = cash > 0 ? cash : 0;
    if (ref > 0) {
      await User.updateOne({ _id: userId }, { $set: { [`${wf}.ledgerReferenceBalance`]: ref } });
    }
  }
  return Math.round(Math.max(ref, cash) * 100) / 100;
}

export async function bumpWalletLedgerReferenceOnCredit(userId, walletField, newCashBalance) {
  const wf = String(walletField || '').trim();
  if (!wf) return 0;
  const bal = Math.max(0, Number(newCashBalance) || 0);
  const ref = await getWalletLedgerReferenceBalance(userId, wf, bal);
  const next = Math.max(ref, bal);
  if (next > ref) {
    await User.updateOne({ _id: userId }, { $set: { [`${wf}.ledgerReferenceBalance`]: next } });
  }
  return next;
}

export { shouldTriggerLedgerAutosquare };

/** Skip autosquare briefly after a new position opens (avoids 0s instant cut on stale reference). */
const AUTOSQUARE_OPEN_GRACE_MS = 2500;

/**
 * When wallet has no open positions, reset reference to current cash so 70/90% starts fresh.
 */
export async function reseedLedgerReferenceWhenFlat(userId, walletField) {
  const wf = String(walletField || '').trim();
  const segQ = SEGMENT_QUERIES_BY_WALLET[wf];
  if (!segQ) return { reseeded: false };

  const openCount = await Trade.countDocuments({ user: userId, status: 'OPEN', ...segQ });
  if (openCount > 0) return { reseeded: false, openCount };

  const user = await User.findById(userId).select(userSelectForWalletField(wf)).lean();
  if (!user) return { reseeded: false };

  const cash = walletCashBalance(user, wf);
  const ref = Math.round(Math.max(0, cash) * 100) / 100;
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        [`${wf}.ledgerReferenceBalance`]: ref,
        [`${wf}.ledgerAutosquareActive`]: false,
      },
      $unset: { [`${wf}.ledgerAutosquaredAt`]: 1 },
    }
  );
  return { reseeded: true, referenceBalance: ref };
}

/** Before new order: reseed if flat; block only when existing open book already breached limit. */
export async function assertLedgerAutosquareAllowsNewOrder(
  userId,
  walletField,
  { segment = null, segmentSettings = null, user = null } = {}
) {
  const wf = String(walletField || '').trim();
  await reseedLedgerReferenceWhenFlat(userId, wf);

  const segQ = SEGMENT_QUERIES_BY_WALLET[wf];
  if (!segQ) return;

  const openCount = await Trade.countDocuments({ user: userId, status: 'OPEN', ...segQ });
  if (openCount === 0) return;

  let u = user;
  if (!u) {
    u = await User.findById(userId).select(`settings ${wf}`).lean();
  }
  const autosquarePercent = resolveAutosquarePercentFromSettings(segmentSettings, u);
  const snapshot = await computeLedgerRealBalance(userId, wf, {
    preferBidAsk: false,
    segment,
    autosquarePercent,
  });
  if (snapshot?.shouldTrigger) {
    throw new Error(
      `Auto-square risk: equity loss already ${snapshot.lossPercent}% (limit ${snapshot.autosquarePercent}%). ` +
        `Close existing positions or add funds before opening more.`
    );
  }
}

async function resolveAutosquarePercentForWallet(user, segment, positions) {
  const segHint = segment || positions?.[0]?.segment || null;
  if (!segHint) return resolveAutosquarePercentFromSettings(null, user);
  try {
    const TradeService = (await import('./tradeService.js')).default;
    let u = user;
    if (!u?.admin?.segmentPermissions && u?._id) {
      u = await User.findById(u._id).populate('admin', 'segmentPermissions').lean();
      if (u?.admin?.segmentPermissions) {
        u.parentSegmentPermissions = u.admin.segmentPermissions;
      }
    }
    const segmentSettings = await TradeService.getUserSegmentSettings(u, segHint);
    return resolveAutosquarePercentFromSettings(segmentSettings, u);
  } catch {
    return resolveAutosquarePercentFromSettings(null, user);
  }
}

export async function computeAvailableMarginForWallet(
  user,
  walletField,
  totalMtm,
  { leverage = null, segment = null } = {}
) {
  const wf = String(walletField || '').trim();
  const cash = walletCashBalance(user, wf);
  const usedMargin = Math.max(0, Number(user?.[wf]?.usedMargin) || 0);

  const { sanitizeInrWalletAmount } = await import('../utils/walletBalanceSanity.js');
  const mtm = Number(totalMtm) || 0;

  if (wf === 'cryptoWallet' || wf === 'forexWallet') {
    return sanitizeInrWalletAmount(Math.round((cash - usedMargin + mtm) * 100) / 100, {
      field: `${wf}.availableMargin`,
    });
  }

  let lev = leverage;
  if (lev == null) {
    lev = await WalletService.getUserLeverage(user, segment);
  }
  const leveragedBalance = cash * (Number(lev) > 0 ? Number(lev) : 1);
  const unrealizedLoss = mtm < 0 ? Math.abs(mtm) : 0;
  return sanitizeInrWalletAmount(
    Math.round((leveragedBalance - usedMargin - unrealizedLoss) * 100) / 100,
    { field: `${wf}.availableMargin` }
  );
}

function walletLabel(walletField) {
  if (walletField === 'nseBseWallet') return 'NSE/BSE';
  if (walletField === 'mcxWallet') return 'MCX';
  if (walletField === 'cryptoWallet') return 'CRYPTO';
  if (walletField === 'forexWallet') return 'FOREX';
  return walletField;
}

export async function getMarkPricesForTrades(trades, { preferBidAsk = false } = {}) {
  const out = new Map();
  const list = trades || [];
  if (!list.length) return out;

  const tokens = [...new Set(list.map((t) => String(t.token || '')).filter(Boolean))];
  const insts = tokens.length
    ? await Instrument.find({ token: { $in: tokens } }).select('token lastBid lastAsk ltp').lean()
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
    const markPrice = preferBidAsk ? (tr.side === 'BUY' ? bid || ltp : ask || ltp) : ltp;
    out.set(String(tr._id), {
      ltp,
      bid,
      ask,
      markPrice: Number(markPrice) > 0 ? Number(markPrice) : Number(tr.entryPrice) || 0,
    });
  }
  return out;
}

export async function computeLedgerRealBalance(
  userId,
  walletField,
  { preferBidAsk = false, segment = null, autosquarePercent: autosquarePercentOverride = null } = {}
) {
  const wf = String(walletField || '').trim();
  const user = await User.findById(userId)
    .select(userSelectForWalletField(wf, 'settings segmentPermissions'))
    .populate('admin', 'segmentPermissions')
    .lean();
  if (!user) return null;
  if (user.admin?.segmentPermissions) {
    user.parentSegmentPermissions = user.admin.segmentPermissions;
  }

  const segQ = SEGMENT_QUERIES_BY_WALLET[wf] || null;
  if (!segQ) return null;

  const positions = await Trade.find({
    user: userId,
    status: 'OPEN',
    ...segQ,
  }).lean();

  const priceMap = await getMarkPricesForTrades(positions, { preferBidAsk });
  let totalMtm = 0;
  for (const p of positions) {
    const mp = priceMap.get(String(p._id))?.markPrice ?? p.currentPrice ?? p.entryPrice;
    totalMtm += WalletService.calculatePositionPnL(p, mp);
  }

  const cashBalance = walletCashBalance(user, wf);
  const usedMargin = Math.max(0, Number(user?.[wf]?.usedMargin) || 0);
  let equityBasis;
  let realBalance;
  let referenceBalance = null;

  referenceBalance = await getWalletLedgerReferenceBalance(userId, wf, cashBalance);
  const cashMetrics = resolveCashLedgerAutosquareMetrics({
    cashBalance,
    referenceBalance,
    totalMtm,
  });
  equityBasis = cashMetrics.equityBasis;
  realBalance = cashMetrics.realBalance;
  referenceBalance = cashMetrics.referenceBalance;

  const segHint = segment || positions[0]?.segment || null;
  const availableMargin = await computeAvailableMarginForWallet(user, wf, totalMtm, {
    segment: segHint,
  });
  const marginCushion = Math.round((cashBalance - usedMargin) * 100) / 100;

  const autosquarePercent =
    autosquarePercentOverride != null && Number.isFinite(Number(autosquarePercentOverride))
      ? Number(autosquarePercentOverride)
      : await resolveAutosquarePercentForWallet(user, segHint, positions);

  const triggerEval = evaluateIntradayAutosquareTrigger({
    equityBasis,
    realBalance,
    autosquarePercent,
  });

  return {
    walletField: wf,
    cashBalance,
    usedMargin,
    marginCushion,
    totalMtm: Math.round(totalMtm * 100) / 100,
    realBalance,
    availableMargin,
    equityBasis,
    referenceBalance,
    autosquarePercent: triggerEval.autosquarePercent,
    lossPercent: triggerEval.lossPercent,
    shouldTrigger: triggerEval.trigger,
    triggerReason: triggerEval.reason,
    openPositions: positions.length,
    priceMap,
    positions,
  };
}

function autosquareNotificationText(walletField, reason, closed, snapshot) {
  const label = walletLabel(walletField);
  const loss = snapshot?.lossPercent;
  const threshold = snapshot?.autosquarePercent;

  if (reason?.startsWith('INTRADAY_AUTOSQUARE_') || reason === 'EQUITY_DEPLETED') {
    return {
      subject: `${label} auto-square — ${threshold}% loss threshold reached`,
      description:
        `Equity loss reached ${loss}% (autosquare limit ${threshold}%). ` +
        `${closed} position(s) were squared off at market.`,
      ledgerDesc: `${label} intraday autosquare at ${threshold}% (loss ${loss}%) — ${closed} position(s) closed`,
    };
  }

  return {
    subject: `All ${label} positions closed (auto-square)`,
    description: `${closed} position(s) were squared off at market.`,
    ledgerDesc: `${label} autosquare — ${closed} position(s) closed`,
  };
}

export async function executeLedgerAutosquareNil(userId, walletField, { reason = 'INTRADAY_AUTOSQUARE', force = false, snapshot: snapshotHint = null } = {}) {
  const wf = String(walletField || '').trim();
  const user = await User.findById(userId)
    .select(userSelectForWalletField(wf, 'userId adminCode settings'))
    .lean();
  if (!user) return { success: false, message: 'User not found' };

  const wallet = user?.[wf] || {};
  if (!force && wallet?.ledgerAutosquareActive) return { success: true, skipped: true, closed: 0 };

  const segQ = SEGMENT_QUERIES_BY_WALLET[wf] || null;
  if (!segQ) return { success: false, message: `Unsupported walletField ${wf}` };

  const positions = await Trade.find({ user: userId, status: 'OPEN', ...segQ });
  if (!positions.length) return { success: true, closed: 0 };

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
      if (result?.success || result?.trade?.status === 'CLOSED') closed++;
      else errors.push({ tradeId: pos.tradeId, message: result?.message });
    } catch (e) {
      errors.push({ tradeId: pos.tradeId, message: e.message });
    }
  }

  const snapshot = snapshotHint || (await computeLedgerRealBalance(userId, wf, { preferBidAsk: true }));
  await WalletService.recalculateWallet(userId);
  const freshAfterClose = await User.findById(userId).select(`${wf}.balance`).lean();
  const rawBal = Number(freshAfterClose?.[wf]?.balance);
  const finalBal = Math.max(
    0,
    Number.isFinite(rawBal) ? rawBal : Number(snapshot?.realBalance) || 0
  );
  const notifyText = autosquareNotificationText(wf, reason, closed, snapshot);

  const set = {
    [`${wf}.balance`]: finalBal,
    [`${wf}.ledgerAutosquareActive`]: true,
    [`${wf}.ledgerAutosquaredAt`]: new Date(),
  };
  if (wf === 'nseBseWallet') set['wallet.tradingBalance'] = 0;

  await User.updateOne({ _id: userId }, { $set: set });
  await recalculateUsedMargin(userId);

  try {
    await WalletLedger.create({
      ownerType: 'USER',
      ownerId: userId,
      adminCode: user.adminCode,
      type: 'DEBIT',
      reason: 'TRADE_PNL',
      amount: 0,
      balanceAfter: finalBal,
      description: notifyText.ledgerDesc,
      isAutoSquare: true,
      meta: {
        segment: walletLabel(wf),
        reason,
        positionsClosed: closed,
        walletField: wf,
        lossPercent: snapshot?.lossPercent,
        autosquarePercent: snapshot?.autosquarePercent,
      },
    });
  } catch {
    /* optional */
  }

  await Notification.create({
    title: 'Auto-Square',
    subject: notifyText.subject,
    description: notifyText.description,
    senderType: 'SYSTEM',
    targetType: 'SINGLE_USER',
    targetUserId: userId,
    priority: 'CRITICAL',
  });

  if (io) {
    const payload = {
      targetUserId: String(userId),
      walletField: wf,
      segment: walletLabel(wf),
      reason,
      positionsClosed: closed,
      realBalance: finalBal,
      availableMargin: snapshot?.availableMargin,
      lossPercent: snapshot?.lossPercent,
      autosquarePercent: snapshot?.autosquarePercent,
      timestamp: new Date(),
    };
    io.to(String(userId)).emit('ledger_autosquare', payload);
  }

  console.log(
    `[LedgerAutosquare] ${walletLabel(wf)} user ${user.userId}: closed ${closed}/${positions.length}, ` +
      `balance=₹${finalBal}, reason=${reason}, loss=${snapshot?.lossPercent}%, threshold=${snapshot?.autosquarePercent}%`
  );
  return { success: true, closed, finalBalance: finalBal, errors };
}

export async function checkAndRunLedgerAutosquare(
  userId,
  walletField,
  { preferBidAsk = false, segment = null, autosquarePercent = null } = {}
) {
  const wf = String(walletField || '').trim();
  const user = await User.findById(userId).select(`settings rmsSettings ${wf}`).lean();
  if (!user) return null;
  if (user?.rmsSettings?.tradingBlocked) return null;

  const segQ = SEGMENT_QUERIES_BY_WALLET[wf];
  if (user?.[wf]?.ledgerAutosquareActive && segQ) {
    const stillOpen = await Trade.exists({ user: userId, status: 'OPEN', ...segQ });
    if (!stillOpen) return null;
    await User.updateOne({ _id: userId }, { $set: { [`${wf}.ledgerAutosquareActive`]: false } });
  } else if (user?.[wf]?.ledgerAutosquareActive) {
    return null;
  }

  const snapshot = await computeLedgerRealBalance(userId, wf, {
    preferBidAsk,
    segment,
    autosquarePercent,
  });
  if (!snapshot?.openPositions) return null;

  const graceSince = new Date(Date.now() - AUTOSQUARE_OPEN_GRACE_MS);
  const justOpened = await Trade.exists({
    user: userId,
    status: 'OPEN',
    ...segQ,
    $or: [{ openedAt: { $gte: graceSince } }, { createdAt: { $gte: graceSince } }],
  });
  if (justOpened) return { triggered: false, snapshot, graceSkipped: true };

  if (!snapshot.shouldTrigger) return { triggered: false, snapshot };

  const reason = snapshot.triggerReason || `INTRADAY_AUTOSQUARE_${snapshot.autosquarePercent}%`;

  console.log(
    `[LedgerAutosquare] TRIGGER user=${userId} ${walletLabel(wf)}: ` +
      `loss=${snapshot.lossPercent}% threshold=${snapshot.autosquarePercent}% ` +
      `basis=₹${snapshot.equityBasis} equity=₹${snapshot.realBalance} mtm=₹${snapshot.totalMtm} reason=${reason}`
  );

  const result = await executeLedgerAutosquareNil(userId, wf, {
    reason,
    snapshot,
  });
  return { triggered: true, snapshot, result };
}

/** Wallet ledger autosquare status for user API (NSE/BSE, MCX, crypto — same engine). */
export async function getLedgerStatusForApi(userId, walletField = 'nseBseWallet') {
  const wf = String(walletField || 'nseBseWallet').trim();
  const user = await User.findById(userId).select(`settings ${wf}`).lean();
  const snapshot = await computeLedgerRealBalance(userId, wf, { preferBidAsk: false });
  const fallbackPct = wf === 'cryptoWallet' ? 70 : 90;
  if (!snapshot) {
    return {
      cashBalance: 0,
      usedMargin: 0,
      marginCushion: 0,
      equityBasis: 0,
      totalMtm: 0,
      realBalance: 0,
      availableMargin: 0,
      autosquarePercent: fallbackPct,
      lossPercent: 0,
      shouldTrigger: false,
      openPositions: 0,
      ledgerAutosquareActive: !!user?.[wf]?.ledgerAutosquareActive,
      ledgerAutosquaredAt: user?.[wf]?.ledgerAutosquaredAt || null,
    };
  }
  const { priceMap: _priceMap, positions: _positions, ...safe } = snapshot;
  return {
    ...safe,
    ledgerAutosquareActive: !!user?.[wf]?.ledgerAutosquareActive,
    ledgerAutosquaredAt: user?.[wf]?.ledgerAutosquaredAt || null,
  };
}

/** Reset autosquare flags; refresh ledger reference to current cash per wallet. */
export async function resetDailyLedgerReference(walletField = null, userId = null) {
  const wf = walletField ? String(walletField) : null;
  const q = userId ? { _id: userId } : {};
  const fields = wf ? [wf] : ['nseBseWallet', 'mcxWallet', 'cryptoWallet', 'forexWallet'];
  const users = await User.find(q).select('_id nseBseWallet cryptoWallet forexWallet mcxWallet wallet').lean();
  for (const u of users) {
    const unset = {};
    const set = {};
    for (const f of fields) {
      set[`${f}.ledgerAutosquareActive`] = false;
      unset[`${f}.ledgerAutosquaredAt`] = 1;
      const cash = walletCashBalance(u, f);
      if (cash > 0) {
        set[`${f}.ledgerReferenceBalance`] = cash;
      }
    }
    await User.updateOne({ _id: u._id }, { $set: set, $unset: unset });
  }
}

export default {
  initLedgerAutosquare,
  computeLedgerRealBalance,
  computeAvailableMarginForWallet,
  checkAndRunLedgerAutosquare,
  executeLedgerAutosquareNil,
  walletEquityBasis,
  getLedgerStatusForApi,
  reseedLedgerReferenceWhenFlat,
  assertLedgerAutosquareAllowsNewOrder,
  resetDailyLedgerReference,
};
