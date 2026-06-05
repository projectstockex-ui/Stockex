import Trade from '../models/Trade.js';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import Charges from '../models/Charges.js';
import WalletLedger from '../models/WalletLedger.js';
import Instrument from '../models/Instrument.js';
import TradingService from './tradingService.js';
import TradeService from './tradeService.js';
import WalletService from './walletService.js';
import CircuitBreakerService from './circuitBreakerService.js';
import {
  alignCryptoExitToEntryUnit,
  roundMoney,
} from '../utils/bookPnL.js';
import {
  subwalletCloseBalancePnL,
  subwalletMarginReleaseOnClose,
} from '../utils/subwalletCashWallet.js';
import {
  getNseBseBalance,
  getNseBseUsedMargin,
} from '../utils/nseBseWallet.js';
import { tradeIsIndianMarket } from '../utils/tradingUsdSpot.js';
import { profitAllowedForWallet, walletTypeFromTrade } from '../utils/walletBlock.js';

function scaleCharges(charges, ratio) {
  if (!charges || ratio <= 0) return { total: 0, exchange: 0, gst: 0, stt: 0, sebi: 0, stamp: 0, brokerage: 0 };
  const r = Math.min(1, Math.max(0, ratio));
  const scaled = {};
  for (const [k, v] of Object.entries(charges)) {
    scaled[k] = typeof v === 'number' ? roundMoney(v * r) : v;
  }
  if (typeof scaled.total !== 'number' || !Number.isFinite(scaled.total)) {
    scaled.total = roundMoney(
      (scaled.exchange || 0) +
        (scaled.gst || 0) +
        (scaled.stt || 0) +
        (scaled.sebi || 0) +
        (scaled.stamp || 0)
    );
  }
  return scaled;
}

async function resolveCloseSideBlock(trade, { bidPrice, askPrice } = {}) {
  // Circuit-side blocking is only for Indian exchanges (NSE/BSE/MCX), not crypto/forex.
  if (!tradeIsIndianMarket(trade)) {
    return { canClose: true, reason: null };
  }

  const closeSide = trade.side === 'BUY' ? 'SELL' : 'BUY';
  const bid = Number(bidPrice);
  const ask = Number(askPrice);

  if (closeSide === 'BUY' && !(ask > 0)) {
    return {
      canClose: false,
      reason: 'Upper circuit is active. BUY side (ask) is unavailable, so you cannot close this SELL right now.',
    };
  }
  if (closeSide === 'SELL' && !(bid > 0)) {
    return {
      canClose: false,
      reason: 'Lower circuit is active. SELL side (bid) is unavailable, so you cannot close this BUY right now.',
    };
  }

  try {
    const token = trade?.token != null ? String(trade.token) : null;
    const symbol = String(trade?.symbol || '').trim();
    const exchange = String(trade?.exchange || '').trim();
    const or = [];
    if (token) or.push({ token });
    if (symbol) {
      if (exchange) or.push({ symbol, exchange });
      or.push({ symbol });
    }
    if (or.length > 0) {
      const instrument = await Instrument.findOne({ $or: or })
        .select('symbol allowBuy allowSell upperCircuit lowerCircuit')
        .lean();
      if (instrument) {
        const gate = CircuitBreakerService.checkOrderAllowed(instrument, closeSide);
        if (!gate.allowed) {
          return { canClose: false, reason: gate.reason || 'Close side blocked by circuit.' };
        }
      }
    }
  } catch {
    // Ignore lookup issues here; quote-side checks above remain authoritative.
  }

  return { canClose: true, reason: null };
}

async function resolveExitPrice(trade, { exitPrice, bidPrice, askPrice }) {
  let price = exitPrice || trade.currentPrice || trade.entryPrice;
  if (trade.side === 'BUY') {
    price = bidPrice || exitPrice || trade.currentPrice || trade.entryPrice;
  } else {
    price = askPrice || exitPrice || trade.currentPrice || trade.entryPrice;
  }

  const isCrypto = trade.isCrypto || trade.exchange === 'BINANCE';
  const isForex =
    trade.isForex ||
    trade.exchange === 'FOREX' ||
    ['FOREX', 'FOREXFUT', 'FOREXOPT'].includes(String(trade.segment || '').toUpperCase());

  if ((isCrypto || isForex) && (bidPrice > 0 || askPrice > 0)) {
    try {
      const u = await User.findById(trade.user).populate('admin', 'segmentPermissions').lean();
      if (u?.admin?.segmentPermissions) {
        u.parentSegmentPermissions = u.admin.segmentPermissions;
      }
      const seg = await TradeService.getUserSegmentSettings(u, trade.segment, trade.instrumentType);
      const halfUsd = TradeService.segmentCryptoSpreadHalfUsd(seg);
      if (halfUsd > 0) {
        if (trade.side === 'BUY' && bidPrice > 0) price = bidPrice - halfUsd;
        else if (trade.side === 'SELL' && askPrice > 0) price = askPrice + halfUsd;
      }
    } catch {
      /* ignore */
    }
  }

  if (!price || price <= 0) price = trade.entryPrice || 0;
  if (!price || price <= 0) throw new Error('Invalid exit price. Please try again with valid market data.');
  return alignCryptoExitToEntryUnit(trade, price);
}

function walletKeyForTrade(trade) {
  if (trade.isCrypto) return 'crypto';
  if (trade.isForex) return 'forex';
  if (
    trade.exchange === 'MCX' ||
    ['MCX', 'MCXFUT', 'MCXOPT'].includes(String(trade.segment || '').toUpperCase())
  ) {
    return 'mcx';
  }
  return 'nseBse';
}

function readWalletSnapshot(user, trade) {
  const key = walletKeyForTrade(trade);
  if (key === 'crypto') {
    return {
      balance: user.cryptoWallet?.balance || 0,
      usedMargin: user.cryptoWallet?.usedMargin || 0,
      available: Math.max(0, (user.cryptoWallet?.balance || 0) - (user.cryptoWallet?.usedMargin || 0)),
    };
  }
  if (key === 'forex') {
    return {
      balance: user.forexWallet?.balance || 0,
      usedMargin: user.forexWallet?.usedMargin || 0,
      available: Math.max(0, (user.forexWallet?.balance || 0) - (user.forexWallet?.usedMargin || 0)),
    };
  }
  if (key === 'mcx') {
    return {
      balance: user.mcxWallet?.balance || 0,
      usedMargin: user.mcxWallet?.usedMargin || 0,
      available: Math.max(0, (user.mcxWallet?.balance || 0) - (user.mcxWallet?.usedMargin || 0)),
    };
  }
  const bal = getNseBseBalance(user);
  const um = getNseBseUsedMargin(user);
  return { balance: bal, usedMargin: um, available: Math.max(0, bal - um) };
}

export async function previewPartialClose(userId, tradeId, quantityToClose, quote = {}) {
  const trade = await Trade.findOne({ _id: tradeId, user: userId, status: 'OPEN' });
  if (!trade) throw new Error('Open position not found');

  const totalQty = Number(trade.quantity) || 0;
  if (totalQty <= 0) throw new Error('Position has no quantity');

  let qty = Number(quantityToClose);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Enter a valid quantity');
  qty = Math.min(qty, totalQty);
  qty = roundMoney(qty);
  if (qty <= 0) throw new Error('Quantity too small');

  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  const closeGate = await resolveCloseSideBlock(trade, quote);

  let exitEst = Number(trade.currentPrice) || Number(trade.entryPrice) || 0;
  try {
    exitEst = await resolveExitPrice(trade, quote);
  } catch {
    /* keep estimate from current/entry */
  }
  const mult = trade.side === 'BUY' ? 1 : -1;
  const grossPnL = roundMoney((exitEst - trade.entryPrice) * mult * qty);
  const ratio = qty / totalQty;
  let fullCharges = { total: 0, exchange: 0, gst: 0, stt: 0, sebi: 0, stamp: 0, brokerage: 0 };
  try {
    fullCharges = await Charges.calculateCharges(trade, trade.adminCode, trade.user);
  } catch (e) {
    console.warn('[previewPartialClose] charges skipped:', e?.message || e);
  }
  const charges = scaleCharges(fullCharges, ratio);
  const closingCharges =
    (charges.exchange || 0) +
    (charges.gst || 0) +
    (charges.stt || 0) +
    (charges.sebi || 0) +
    (charges.stamp || 0);
  const netPnL = roundMoney(grossPnL - closingCharges);
  const walletPnL = subwalletCloseBalancePnL(trade, grossPnL, netPnL);

  const marginUsed = Number(trade.marginUsed) || Number(trade.requiredMargin) || 0;
  const marginRelease = roundMoney(marginUsed * ratio);
  const remainingQty = roundMoney(totalQty - qty);
  const remainingMargin = roundMoney(Math.max(0, marginUsed - marginRelease));

  const before = readWalletSnapshot(user, trade);
  const after = {
    balance: roundMoney(before.balance + walletPnL),
    usedMargin: roundMoney(Math.max(0, before.usedMargin - marginRelease)),
  };
  after.available = roundMoney(Math.max(0, after.balance - after.usedMargin));

  return {
    tradeId: trade._id,
    symbol: trade.symbol,
    side: trade.side,
    openQuantity: totalQty,
    closeQuantity: qty,
    remainingQuantity: remainingQty,
    entryPrice: trade.entryPrice,
    estimatedExitPrice: exitEst,
    grossPnL,
    netPnL,
    walletPnL,
    marginRelease,
    remainingMargin,
    margin: {
      before,
      after,
    },
    willFullyClose: remainingQty <= 0,
    canClose: closeGate.canClose,
    blockReason: closeGate.reason,
  };
}

export async function executePartialClose(userId, tradeId, body = {}) {
  const { exitPrice, bidPrice, askPrice } = body;
  let qty = Number(body.quantity);
  const trade = await Trade.findOne({ _id: tradeId, user: userId, status: 'OPEN' });
  if (!trade) throw new Error('Open position not found');

  const totalQty = Number(trade.quantity) || 0;
  if (totalQty <= 0) throw new Error('Position has no quantity');
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Enter a valid quantity');
  qty = Math.min(qty, totalQty);
  const closeGate = await resolveCloseSideBlock(trade, { bidPrice, askPrice });
  if (!closeGate.canClose) throw new Error(closeGate.reason);

  if (qty >= totalQty - 1e-9) {
    const effectiveExit = await resolveExitPrice(trade, { exitPrice, bidPrice, askPrice });
    return TradingService.squareOffPosition(tradeId, 'MANUAL', effectiveExit, bidPrice, askPrice);
  }

  const user = await User.findById(trade.user);
  if (!user) throw new Error('User not found');
  if (user.isReadOnly) throw new Error('Account is read-only');

  const effectiveExit = await resolveExitPrice(trade, { exitPrice, bidPrice, askPrice });
  const mult = trade.side === 'BUY' ? 1 : -1;
  const grossPnL = roundMoney((effectiveExit - trade.entryPrice) * mult * qty);
  const ratio = qty / totalQty;

  const fullCharges = await Charges.calculateCharges(trade, trade.adminCode, trade.user);
  const chargesPartial = scaleCharges(fullCharges, ratio);
  const closingCharges =
    (chargesPartial.exchange || 0) +
    (chargesPartial.gst || 0) +
    (chargesPartial.stt || 0) +
    (chargesPartial.sebi || 0) +
    (chargesPartial.stamp || 0);
  const netPnL = roundMoney(grossPnL - closingCharges);
  const walletPnL = subwalletCloseBalancePnL(trade, grossPnL, netPnL);

  const marginUsed = Number(trade.marginUsed) || Number(trade.requiredMargin) || 0;
  const marginRelease = roundMoney(marginUsed * ratio);
  const pledgeRelease = roundMoney((Number(trade.pledgeMarginUsed) || 0) * ratio);

  const isMCXTrade =
    trade.exchange === 'MCX' ||
    trade.segment === 'MCX' ||
    trade.segment === 'MCXFUT' ||
    trade.segment === 'MCXOPT';
  const balancePnL = profitAllowedForWallet(user, walletTypeFromTrade(trade), walletPnL);

  const updateFields = {};
  let newCryptoBalance,
    newCryptoUsedMargin,
    newForexBalance,
    newForexUsedMargin,
    newMcxBalance,
    newMcxUsedMargin,
    newTradingBalance,
    newUsedMargin,
    newBlocked;

  if (trade.isCrypto) {
    newCryptoUsedMargin = Math.max(0, (user.cryptoWallet?.usedMargin || 0) - marginRelease);
    newCryptoBalance = roundMoney((user.cryptoWallet?.balance || 0) + balancePnL);
    updateFields['cryptoWallet.usedMargin'] = newCryptoUsedMargin;
    updateFields['cryptoWallet.balance'] = Math.max(0, newCryptoBalance);
    updateFields['cryptoWallet.realizedPnL'] = roundMoney(
      (user.cryptoWallet?.realizedPnL || 0) + balancePnL
    );
  } else if (trade.isForex) {
    newForexUsedMargin = Math.max(0, (user.forexWallet?.usedMargin || 0) - marginRelease);
    newForexBalance = roundMoney((user.forexWallet?.balance || 0) + balancePnL);
    updateFields['forexWallet.usedMargin'] = newForexUsedMargin;
    updateFields['forexWallet.balance'] = Math.max(0, newForexBalance);
    updateFields['forexWallet.realizedPnL'] = roundMoney(
      (user.forexWallet?.realizedPnL || 0) + balancePnL
    );
  } else if (isMCXTrade) {
    newMcxUsedMargin = Math.max(0, (user.mcxWallet?.usedMargin || 0) - marginRelease);
    newMcxBalance = roundMoney((user.mcxWallet?.balance || 0) + balancePnL);
    updateFields['mcxWallet.usedMargin'] = newMcxUsedMargin;
    updateFields['mcxWallet.balance'] = Math.max(0, newMcxBalance);
    updateFields['mcxWallet.realizedPnL'] = roundMoney((user.mcxWallet?.realizedPnL || 0) + balancePnL);
  } else {
    newUsedMargin = Math.max(0, getNseBseUsedMargin(user) - marginRelease);
    newBlocked = Math.max(0, (user.wallet?.blocked || 0) - marginRelease);
    newTradingBalance = roundMoney(getNseBseBalance(user) + balancePnL);
    updateFields['nseBseWallet.usedMargin'] = newUsedMargin;
    updateFields['wallet.blocked'] = newBlocked;
    updateFields['nseBseWallet.balance'] = Math.max(0, newTradingBalance);
    updateFields['wallet.realizedPnL'] = roundMoney((user.wallet?.realizedPnL || 0) + balancePnL);
  }

  if (pledgeRelease > 0) {
    updateFields['deliveryPledge.usedMargin'] = Math.max(
      0,
      (user.deliveryPledge?.usedMargin || 0) - pledgeRelease
    );
    updateFields['deliveryPledge.lastUpdated'] = new Date();
  }

  const remainingQty = roundMoney(totalQty - qty);
  if (remainingQty <= 1e-9) {
    const effectiveExit = await resolveExitPrice(trade, { exitPrice, bidPrice, askPrice });
    return TradingService.squareOffPosition(tradeId, 'MANUAL', effectiveExit, bidPrice, askPrice);
  }
  const lotSize = Number(trade.lotSize) || 1;
  const remainingLots = lotSize > 0 ? roundMoney(remainingQty / lotSize) : trade.lots;

  const leg = {
    closedAt: new Date(),
    quantity: qty,
    exitPrice: effectiveExit,
    grossPnL,
    netPnL,
    marginReleased: marginRelease,
  };

  const partialAgg = trade.partialClose || {};
  const newClosedQty = roundMoney((Number(partialAgg.closedQuantity) || 0) + qty);
  const newClosedPnL = roundMoney((Number(partialAgg.closedPnL) || 0) + grossPnL);

  await User.updateOne({ _id: user._id }, { $set: updateFields });

  const ledgerPnL = balancePnL;
  if (Math.abs(ledgerPnL) >= 0.01) {
    const pnlSegment = trade.isCrypto
      ? 'CRYPTO'
      : trade.isForex
        ? 'FOREX'
        : isMCXTrade
          ? 'MCX'
          : 'NSE/BSE';
    const balAfter =
      trade.isCrypto
        ? updateFields['cryptoWallet.balance']
        : trade.isForex
          ? updateFields['forexWallet.balance']
          : isMCXTrade
            ? updateFields['mcxWallet.balance']
            : updateFields['nseBseWallet.balance'];

    await WalletLedger.create({
      ownerType: 'USER',
      ownerId: user._id,
      adminCode: user.adminCode,
      type: ledgerPnL >= 0 ? 'CREDIT' : 'DEBIT',
      reason: 'TRADE_PNL',
      amount: Math.abs(ledgerPnL),
      balanceAfter: balAfter,
      reference: { type: 'Trade', id: trade._id },
      description:
        body.closeReason === 'AUTO_SQUARE'
          ? `${trade.symbol} ${trade.side} carry-forward trim (${qty} qty) P&L (Crypto)`
          : `${trade.symbol} ${trade.side} partial close (${qty} qty) P&L`,
      meta: { segment: pnlSegment, tradeId: trade.tradeId || String(trade._id), partialClose: true },
    });
  }

  const setFields = {
    quantity: remainingQty,
    lots: remainingLots,
    marginUsed: roundMoney(Math.max(0, marginUsed - marginRelease)),
    requiredMargin: roundMoney(Math.max(0, (Number(trade.requiredMargin) || marginUsed) - marginRelease)),
    unrealizedPnL: 0,
    'partialClose.closedQuantity': newClosedQty,
    'partialClose.closedPnL': newClosedPnL,
    'partialClose.closeReason': body.closeReason === 'AUTO_SQUARE' ? 'AUTO_SQUARE' : 'PARTIAL_MANUAL',
  };
  if (pledgeRelease > 0) {
    setFields.pledgeMarginUsed = roundMoney(Math.max(0, (Number(trade.pledgeMarginUsed) || 0) - pledgeRelease));
  }
  if (!trade.originalQty) {
    setFields.originalQty = totalQty;
  }

  await Trade.updateOne(
    { _id: trade._id },
    {
      $set: setFields,
      $push: { partialCloseLegs: leg },
    }
  );

  await WalletService.recalculateWallet(userId, trade.segment);

  const updated = await Trade.findById(trade._id).lean();
  const freshUser = await User.findById(userId);

  return {
    partial: true,
    closedQuantity: qty,
    remainingQuantity: remainingQty,
    grossPnL,
    netPnL,
    marginReleased: marginRelease,
    exitPrice: effectiveExit,
    trade: updated,
    margin: readWalletSnapshot(freshUser, trade),
  };
}
