import express from 'express';
import TradingService from '../services/tradingService.js';
import Instrument from '../models/Instrument.js';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import { protectUser as protect, protectAdmin } from '../middleware/auth.js';
import { orderIsUsdSpot } from '../utils/tradingUsdSpot.js';
import {
  isBinanceCryptoOrder,
  assertBinanceCryptoQuantityValidated,
} from '../utils/binanceCryptoQty.js';
import {
  buildInstrumentDenyContext,
  assertHierarchyInstrumentNotDenied,
} from '../services/instrumentRestrictionService.js';
import { recalculateUsedMargin } from '../utils/recalculateUsedMargin.js';

const router = express.Router();

// Place order
router.post('/order', protect, async (req, res) => {
  try {
    // Check if user is in read-only mode
    if (req.user.isReadOnly) {
      return res.status(403).json({ message: 'Your account is in read-only mode. You can only view and close existing trades.' });
    }
    
    // Map segment for crypto/forex exchanges (same logic as margin-preview)
    const { segment, instrumentType } = req.body;
    const exchange = req.body.exchange || '';
    let effectiveSegment = segment;
    if (exchange === 'BINANCE' && (!segment || segment === 'CRYPTO')) {
      effectiveSegment = instrumentType === 'OPTIONS' ? 'CRYPTOOPT' : 'CRYPTOFUT';
    } else if (exchange === 'FOREX' && (!segment || segment === 'FOREX')) {
      effectiveSegment = instrumentType === 'OPTIONS' ? 'FOREXOPT' : 'FOREXFUT';
    }
    
    // Update req.body with effective segment
    req.body.segment = effectiveSegment;
    
    console.log('Order request:', req.body);
    const result = await TradingService.placeOrder(req.user._id, req.body);
    console.log('Order result:', result.success ? 'Success' : 'Failed');
    res.status(201).json(result);
  } catch (error) {
    console.error('Order error:', error.message);
    console.error('Order error stack:', error.stack);
    res.status(400).json({ message: error.message });
  }
});

// Get orders
router.get('/orders', protect, async (req, res) => {
  try {
    const { status } = req.query;
    const orders = await TradingService.getOrders(req.user._id, status);
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get positions
router.get('/positions', protect, async (req, res) => {
  try {
    const { status } = req.query;
    const positions = await TradingService.getPositions(req.user._id, status || 'OPEN');
    res.json(positions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Square off position
router.post('/positions/:id/squareoff', protect, async (req, res) => {
  try {
    const { exitPrice } = req.body;
    const result = await TradingService.squareOffPosition(
      req.params.id, 
      'MANUAL', 
      exitPrice
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Square off all positions
router.post('/positions/squareoff-all', protect, async (req, res) => {
  try {
    const positions = await TradingService.getPositions(req.user._id, 'OPEN');
    const results = [];
    
    for (const position of positions) {
      try {
        const result = await TradingService.squareOffPosition(position._id, 'MANUAL');
        results.push(result);
      } catch (error) {
        results.push({ error: error.message, positionId: position._id });
      }
    }
    
    // After closing all positions, recalculate margin to ensure it's synced
    const marginResult = await TradingService.recalculateMargin(req.user._id);
    
    res.json({ squaredOff: results.length, results, marginSync: marginResult });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get wallet summary
router.get('/wallet', protect, async (req, res) => {
  try {
    const summary = await TradingService.getWalletSummary(req.user._id);
    res.json(summary);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Calculate margin for order (preview) - Uses user's segment and script settings
router.post('/margin-preview', protect, async (req, res) => {
  try {
    // Populate user with admin's segment permissions for hierarchy inheritance
    const User = (await import('../models/User.js')).default;
    const user = await User.findById(req.user._id)
      .select('userId segmentPermissions segmentExplicitKeys scriptSettings')
      .populate({ path: 'admin', select: 'segmentPermissions segmentExplicitKeys' })
      .lean();

    if (!user) throw new Error('User not found');

    // Attach parent admin's segment permissions to user for permission checks
    if (user.admin?.segmentPermissions) {
      user.parentSegmentPermissions = user.admin.segmentPermissions;
    }

    // User-selectable leverage removed: margin = tradeValue / segment exposure / 1 (instrument caps still apply).
    let leverage = 1;
    const { symbol, productType, side, instrumentType, category, segment } = req.body;
    const lotsRaw = req.body.lots;
    const lots = lotsRaw != null && lotsRaw !== '' && Number.isFinite(Number(lotsRaw)) ? Number(lotsRaw) : 1;

    // Map segment for crypto/forex exchanges
    let effectiveSegment = segment;
    const exchange = req.body.exchange || '';
    if (exchange === 'BINANCE' && (!segment || segment === 'CRYPTO')) {
      effectiveSegment = instrumentType === 'OPTIONS' ? 'CRYPTOOPT' : 'CRYPTOFUT';
    } else if (exchange === 'FOREX' && (!segment || segment === 'FOREX')) {
      effectiveSegment = instrumentType === 'OPTIONS' ? 'FOREXOPT' : 'FOREXFUT';
    }
    
    // Set req.body.segment to effectiveSegment so calculateUserBrokerage receives correct segment
    req.body.segment = effectiveSegment;
    
    // Import TradeService for user settings helpers
    const TradeService = (await import('../services/tradeService.js')).default;
    
    // Get user's segment and script settings (System defaults + hierarchy + user; merged with instrument Rules in margin calculator)
    let segmentSettings = await TradeService.getUserSegmentSettings(user, effectiveSegment, instrumentType);
    const orInst = [];
    if (req.body.token) orInst.push({ token: String(req.body.token) });
    if (symbol && req.body.exchange) {
      orInst.push({ symbol, exchange: req.body.exchange });
      const ts = req.body.tradingSymbol;
      if (ts && String(ts) !== String(symbol)) {
        orInst.push({ tradingSymbol: ts, exchange: req.body.exchange });
      }
    }
    const instrumentDoc = orInst.length
      ? await Instrument.findOne({ $or: orInst })
          .select(
            'tradingDefaults exchange segment displaySegment symbol category pair name lotSize qtyFilterMin qtyFilterMax instrumentType'
          )
          .lean()
      : null;

    const fullUser = await User.findById(req.user._id).populate({
      path: 'admin',
      select: 'restrictions hierarchyPath role adminCode segmentPermissions',
    });
    try {
      await assertHierarchyInstrumentNotDenied(fullUser, buildInstrumentDenyContext(req.body, instrumentDoc));
    } catch (restrictionErr) {
      // If it's a genuine trading block, re-throw so the user sees the message
      if (restrictionErr.message && restrictionErr.message.includes('blocked')) {
        throw restrictionErr;
      }
      console.error('[MarginPreview] Instrument restriction check error (non-blocking):', restrictionErr.message);
    }

    const rawScript = TradeService.getUserScriptSettings(req.user, symbol, category);
    const scriptSettings = TradeService.mergeScriptSettingsWithInstrument(instrumentDoc, rawScript);

    let marginRequired = 0;
    let usedFixedMargin = false;
    let marginSource = 'calculated';
    
    // Check for fixed margin in script settings
    const isIntraday = productType === 'MIS' || productType === 'INTRADAY';
    const isOption = instrumentType === 'OPTIONS';
    const isOptionBuy = isOption && side === 'BUY';
    const isOptionSell = isOption && side === 'SELL';

    leverage = TradeService.capLeverageFromInstrument(instrumentDoc, leverage, isIntraday, isOptionBuy);
    
    const price = req.body.price || 0;
    const bnCryptoPreview = isBinanceCryptoOrder({ ...req.body, segment: effectiveSegment });
    let lotSize = req.body.lotSize || TradingService.getLotSize(symbol, category, req.body.exchange);
    const segPrev = String(effectiveSegment || '').toUpperCase();
    // CRYPTOFUT and CRYPTOOPT: No lot system - use quantity directly
    if (segPrev === 'CRYPTOFUT' || segPrev === 'CRYPTOOPT') {
      lotSize = 1; // Force lotSize to 1 for crypto futures/options
    }
    if (bnCryptoPreview && instrumentDoc?.lotSize > 0) {
      lotSize = instrumentDoc.lotSize;
    }
    const quantity =
      req.body.quantity != null && req.body.quantity !== '' && Number.isFinite(Number(req.body.quantity))
        ? Number(req.body.quantity)
        : lots * lotSize;
    const isCryptoPreview = effectiveSegment === 'CRYPTOFUT' || effectiveSegment === 'CRYPTOOPT' || effectiveSegment === 'CRYPTO' ||
      req.body.exchange === 'BINANCE' || req.body.isCrypto ||
      effectiveSegment === 'FOREX' || effectiveSegment === 'FOREXFUT' || effectiveSegment === 'FOREXOPT' ||
      req.body.exchange === 'FOREX' || req.body.isForex;
    const tradeValue = price * quantity;
    
    // Effective lots: exact fraction for USDT/forex; ceil for F&O-style sizing
    const effectivePreviewLots = lotSize > 0 && quantity > 0 ? quantity / lotSize : lots;
    const effectiveLots = isCryptoPreview
      ? effectivePreviewLots
      : lotSize > 0
        ? Math.ceil(quantity / lotSize)
        : lots;
    
    // Priority 1: Check for fixed margin in script settings
    if (scriptSettings?.fixedMargin) {
      let fixedMarginPerLot = 0;
      if (isOptionBuy) {
        fixedMarginPerLot = isIntraday ? scriptSettings.fixedMargin.optionBuyIntraday : scriptSettings.fixedMargin.optionBuyCarry;
      } else if (isOptionSell) {
        fixedMarginPerLot = isIntraday ? scriptSettings.fixedMargin.optionSellIntraday : scriptSettings.fixedMargin.optionSellCarry;
      } else {
        fixedMarginPerLot = isIntraday ? scriptSettings.fixedMargin.intradayFuture : scriptSettings.fixedMargin.carryFuture;
      }
      
      if (fixedMarginPerLot > 0) {
        // Use quantity-based calculation: margin per unit * quantity
        // For fixed margin per lot, calculate proportionally based on quantity
        marginRequired = (fixedMarginPerLot / lotSize) * quantity;
        usedFixedMargin = true;
        marginSource = 'script_fixed';
      }
    }
    
    // Priority 2: Use segment exposure if no fixed margin
    // Exposure formula: margin = tradeValue / exposure / 1
    // Also consider intradayLeverage/carryForwardLeverage as exposure fallback
    const segmentSettingsForMargin = TradeService.applyInstrumentExposureOverrides(
      instrumentDoc,
      segmentSettings
    );
    
    // For all segments: dynamically resolve leverage from segment settings (no hardcoding)
    const ss = segmentSettingsForMargin || segmentSettings || {};
    if (!usedFixedMargin) {
      const candidates = isIntraday
        ? [
            ss.quantityModeSettings?.intradayLeverage,
            ss.lotSettings?.intradayLeverage,
            ss.exposureIntraday,
            ss.intradayLeverage
          ]
        : [
            ss.quantityModeSettings?.carryForwardLeverage,
            ss.lotSettings?.carryForwardLeverage,
            ss.exposureCarryForward,
            ss.carryForwardLeverage
          ];
      let exposure = 1;
      for (const v of candidates) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 1) { exposure = n; break; }
      }

      if (exposure > 1) {
        marginRequired = tradeValue / exposure / leverage;
        marginSource = 'segment_exposure';
        // Sync back to segmentSettingsForMargin for response
        if (segmentSettingsForMargin) {
          if (isIntraday) segmentSettingsForMargin.exposureIntraday = exposure;
          else segmentSettingsForMargin.exposureCarryForward = exposure;
        }
      }
    }
    
    // Priority 3: Fall back to default calculated margin
    console.log('[MarginPreview] Before fallback check. marginRequired:', marginRequired, 'marginSource:', marginSource);
    const marginCalc = TradingService.calculateMargin({ ...req.body, leverage }, req.user, leverage);
    if (marginRequired === 0) {
      marginRequired = marginCalc.marginRequired;
      marginSource = 'default_calculated';
      console.log('[MarginPreview] Fallback to default calculated margin. marginRequired:', marginRequired);
    }
    console.log('[MarginPreview] Final marginRequired:', marginRequired, 'marginSource:', marginSource);
    
    // Note: divisor in responses is fixed at 1; segment exposure carries effective leverage from hierarchy/rules.

    let brokerage = 0;
    let spread = 0;
    try {
      const baseBrokerage = await TradeService.calculateUserBrokerage(segmentSettings, scriptSettings, req.body, lots);
      const extraBrokerage = TradeService.instrumentAdditionalCommission(instrumentDoc, effectiveLots, tradeValue);
      const oneWayBrokerage = baseBrokerage + extraBrokerage;
      brokerage = Math.round(oneWayBrokerage * 2 * 100) / 100;
      
      // Calculate spread from user settings
      spread = TradeService.calculateUserSpread(scriptSettings, side);
    } catch (brokerageErr) {
      console.error('[MarginPreview] Brokerage calculation error (defaulting to 0):', brokerageErr.message);
      brokerage = 0;
      spread = 0;
    }
    
    // Use correct wallet based on trade type (triple wallet system)
    const isCrypto = effectiveSegment === 'CRYPTOFUT' || effectiveSegment === 'CRYPTOOPT' ||
      req.body.exchange === 'BINANCE';
    const isForex = effectiveSegment === 'FOREX' || effectiveSegment === 'FOREXFUT' || effectiveSegment === 'FOREXOPT' ||
      req.body.exchange === 'FOREX' || req.body.isForex;
    const isMCX = segment === 'MCX' || segment === 'MCXFUT' || segment === 'MCXOPT' || 
                  segment === 'COMMODITY' || req.body.exchange === 'MCX';
    
    console.log('[MarginPreview] Wallet selection:', {
      segment: effectiveSegment,
      effectiveSegment,
      exchange: req.body.exchange,
      isCrypto,
      isForex,
      isMCX
    });
    
    // CRITICAL FIX: Recalculate usedMargin from actual open positions
    // This ensures usedMargin is always accurate, not stale from database
    const recalculatedMargin = await recalculateUsedMargin(req.user._id);
    
    let availableBalance, tradingBalance, usedMarginDisplay;
    if (isCrypto) {
      tradingBalance = req.user.cryptoWallet?.balance || 0;
      usedMarginDisplay = recalculatedMargin.cryptoWallet;
      availableBalance = tradingBalance - usedMarginDisplay;
    } else if (isForex) {
      tradingBalance = req.user.forexWallet?.balance || 0;
      usedMarginDisplay = recalculatedMargin.forexWallet;
      availableBalance = tradingBalance - usedMarginDisplay;
    } else if (isMCX) {
      tradingBalance = req.user.mcxWallet?.balance || 0;
      usedMarginDisplay = recalculatedMargin.mcxWallet;
      availableBalance = tradingBalance - usedMarginDisplay;
    } else {
      // For NSE/BSE, use DB usedMargin instead of recalculated to avoid issues with quantity mode
      tradingBalance = req.user.wallet?.tradingBalance || req.user.wallet?.cashBalance || 0;
      usedMarginDisplay = req.user.wallet?.usedMargin || 0;
      availableBalance = tradingBalance - usedMarginDisplay;
    }
    
    // Get lot/qty limits from settings - prefer quantityModeSettings for all exchanges
    const qtyModeSettings = segmentSettings?.quantityModeSettings;
    const maxLots = (qtyModeSettings?.maxQuantity > 0)
      ? qtyModeSettings.maxQuantity
      : (scriptSettings?.lotSettings?.maxLots || segmentSettings?.maxLots);
    const minLots = (qtyModeSettings?.minQuantity > 0)
      ? qtyModeSettings.minQuantity
      : (scriptSettings?.lotSettings?.minLots || segmentSettings?.minLots || 1);
    
    // Get breakup quantity and max bid limits - prefer quantityModeSettings.breakupQuantity for all exchanges
    const instrumentBreakupQuantity = instrumentDoc?.tradingDefaults?.enabled && instrumentDoc.tradingDefaults.quantitySettings?.breakupQuantity;
    const segmentBreakupQuantity = (qtyModeSettings?.breakupQuantity > 0)
      ? qtyModeSettings.breakupQuantity
      : (segmentSettings?.quantitySettings?.breakupQuantity || 0);
    const breakupQuantity = instrumentBreakupQuantity || segmentBreakupQuantity || 0;

    const instrumentMaxBid = instrumentDoc?.tradingDefaults?.enabled && instrumentDoc.tradingDefaults.quantitySettings?.maxBid;
    const segmentMaxBid = segmentSettings?.quantitySettings?.maxBid;
    const maxBid = instrumentMaxBid || segmentMaxBid || 0;

    // Get min/max exchange quantity limits for crypto/forex
    const instrumentMinExchangeQty = instrumentDoc?.tradingDefaults?.enabled && instrumentDoc.tradingDefaults.quantitySettings?.minExchangeQty;
    const segmentMinExchangeQty = segmentSettings?.quantitySettings?.minExchangeQty;
    const minExchangeQty = instrumentMinExchangeQty || segmentMinExchangeQty || 0;

    const instrumentMaxExchangeQty = instrumentDoc?.tradingDefaults?.enabled && instrumentDoc.tradingDefaults.quantitySettings?.maxExchangeQty;
    const segmentMaxExchangeQty = segmentSettings?.quantitySettings?.maxExchangeQty;
    const maxExchangeQty = instrumentMaxExchangeQty || segmentMaxExchangeQty || 0;

    // Get quantity step from instrument (for crypto/forex)
    const quantityStep = instrumentDoc?.qtyFilterMin || (isCrypto || isForex ? 0.001 : 1);

    // For crypto/forex/MCX, use exchange quantity limits if set
    const minQuantity = minExchangeQty > 0 ? minExchangeQty : ((isCrypto || isMCX) && qtyModeSettings?.minQuantity > 0 ? qtyModeSettings.minQuantity : (instrumentDoc?.qtyFilterMin || 0.001));
    const maxQuantity = maxExchangeQty > 0 ? maxExchangeQty : ((isCrypto || isMCX) && qtyModeSettings?.maxQuantity > 0 ? qtyModeSettings.maxQuantity : (instrumentDoc?.qtyFilterMax || 0));
    
    let lotsValid;
    let lotsError = null;
    // For MCX, use quantity validation like crypto/forex (not lots)
    if (bnCryptoPreview) {
      try {
        assertBinanceCryptoQuantityValidated({
          symbol,
          qty: quantity,
          instrument: instrumentDoc,
          segmentSettings,
          scriptSettings,
        });
        lotsValid = Number.isFinite(quantity) && quantity > 0;
      } catch (e) {
        lotsValid = false;
        lotsError = e?.message || 'Invalid quantity';
      }
    } else if (orderIsUsdSpot({ ...req.body, segment, instrumentType }) || isMCX) {
      // For MCX and USD spot, validate quantity directly (not lots)
      lotsValid = quantity > 0;
      if (quantity > 0 && !lotsValid) {
        lotsError = `Invalid quantity`;
      }
    } else {
      lotsValid = lots >= minLots && lots <= maxLots;
    }
    
    // Get commission from segment settings
    const commission = segmentSettings?.commissionLot || segmentSettings?.commission || 0;
    // Map lotSettings.breakupLots to orderLots for backward compatibility
    const scriptOrderLots = scriptSettings?.lotSettings?.breakupLots ?? scriptSettings?.lotSettings?.orderLots;
    const segmentOrderLots = segmentSettings?.lotSettings?.breakupLots ?? segmentSettings?.orderLots;
    const perOrderLots = scriptOrderLots || segmentOrderLots || maxLots;
    
    // For crypto/forex/MCX, only check marginRequired, don't include brokerage in required check
    const totalRequired = (isCrypto || isForex || isMCX) ? marginRequired : marginRequired + brokerage;

    // SIMPLE RULE for ALL segments: If wallet balance > required margin, allow trade
    const canPlace = lotsValid && totalRequired <= tradingBalance;
    const shortfall = totalRequired > tradingBalance ? totalRequired - tradingBalance : 0;

    res.json({
      marginRequired: Math.round(marginRequired * 100) / 100,
      tradeValue: Math.round(tradeValue * 100) / 100,
      effectiveMargin: marginCalc.effectiveMargin,
      leverage,
      canPlace,
      availableBalance,
      tradingBalance,
      usedFixedMargin,
      marginSource,
      brokerage: Math.round(brokerage * 100) / 100,
      commission: Math.round(commission * 100) / 100,
      spread,
      minQuantity: (isCrypto || isForex || isMCX) ? minQuantity : undefined,
      maxQuantity: (isCrypto || isForex || isMCX) ? maxQuantity : undefined,
      quantityStep: (isCrypto || isForex || isMCX) ? (perOrderLots * lotSize || quantityStep) : undefined,
      lotSize: isMCX ? undefined : lotSize,
      effectiveLots: isMCX ? undefined : Math.round(effectivePreviewLots * 1e8) / 1e8,
      maxLots: isMCX ? undefined : maxLots,
      minLots: isMCX ? undefined : minLots,
      perOrderLots: isMCX ? undefined : perOrderLots,
      lotsValid,
      lotsError: !lotsValid ? (lotsError || (isMCX ? 'Invalid quantity' : `Quantity must be between ${minLots} and ${maxLots}`)) : null,
      shortfall,
      exposureIntraday: segmentSettingsForMargin?.exposureIntraday || null,
      exposureCarryForward: segmentSettingsForMargin?.exposureCarryForward || null,
      defaultIntradayOnly: segmentSettings?.defaultIntradayOnly === true,
      breakupQuantity: breakupQuantity > 0 ? breakupQuantity : null,
      maxBid: maxBid > 0 ? maxBid : null
    });
  } catch (error) {
    console.error('[MarginPreview] Error:', error.message, error.stack);
    res.status(400).json({ message: error.message });
  }
});

// Get market status
router.get('/market-status', protect, async (req, res) => {
  try {
    const exchange = req.query.exchange || 'NSE';
    const segment = req.query.segment || null;
    
    // Populate user with admin's segment permissions for hierarchy inheritance
    const user = await User.findById(req.user._id).populate('admin', 'segmentPermissions segmentExplicitKeys');
    if (!user) throw new Error('User not found');

    console.log('[market-status] User:', user.userId, 'Admin:', user.admin?.name, 'Admin exists:', !!user.admin);

    // Attach parent admin's segment permissions to user for permission checks
    if (user.admin?.segmentPermissions) {
      user.parentSegmentPermissions = user.admin.segmentPermissions;
      console.log('[market-status] Attached parentSegmentPermissions for segment:', segment);
    } else {
      console.log('[market-status] No admin or no segmentPermissions found');
    }
    
    const status = await TradingService.getMarketStatus(exchange, segment, user);
    console.log('[market-status] Status result:', status);
    res.json(status);
  } catch (error) {
    console.error('Error getting market status:', error);
    res.json({ open: true, reason: 'Unable to check market status' });
  }
});

// Get available leverages for user (separate intraday and carryforward)
router.get('/leverages', protect, async (req, res) => {
  try {
    const result = await TradingService.getAvailableLeverages(req.user);
    // result contains: { intraday: [...], carryForward: [...], leverages: [...] }
    res.json({
      intraday: result.intraday || [1, 2, 5, 10],
      carryForward: result.carryForward || [1, 2, 5],
      leverages: result.leverages || result // backward compatibility
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get pending orders
router.get('/pending-orders', protect, async (req, res) => {
  try {
    const orders = await TradingService.getPendingOrders(req.user._id);
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Cancel pending order (DELETE alias for mobile/client compatibility)
router.delete('/pending-orders/:id', protect, async (req, res) => {
  try {
    const result = await TradingService.cancelOrder(req.params.id, req.user._id);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get trade history
router.get('/history', protect, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const trades = await TradingService.getTradeHistory(req.user._id, limit);
    res.json(trades);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Close position (alias for squareoff)
router.post('/close/:id', protect, async (req, res) => {
  try {
    const { exitPrice, bidPrice, askPrice } = req.body;
    // Indian Net Trading: Use bid price for closing BUY, ask price for closing SELL
    const result = await TradingService.squareOffPosition(
      req.params.id, 
      'MANUAL', 
      exitPrice,
      bidPrice,
      askPrice
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Cancel pending order (alias)
router.post('/cancel/:id', protect, async (req, res) => {
  try {
    const result = await TradingService.cancelOrder(req.params.id, req.user._id);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Cancel pending order
router.post('/orders/:id/cancel', protect, async (req, res) => {
  try {
    const result = await TradingService.cancelOrder(req.params.id, req.user._id);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update P&L for all trades (called by price tick)
router.post('/update-pnl', protect, async (req, res) => {
  try {
    const { priceUpdates } = req.body;
    const result = await TradingService.updateTradesPnL(priceUpdates);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Process pending orders (check if any should execute)
router.post('/process-pending', protect, async (req, res) => {
  try {
    const { priceUpdates } = req.body;
    const result = await TradingService.processPendingOrders(priceUpdates);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Recalculate and sync margin - fixes stale margin when positions are closed
router.post('/recalculate-margin', protect, async (req, res) => {
  try {
    const result = await TradingService.recalculateMargin(req.user._id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get lot size for symbol
router.get('/lot-size/:symbol', (req, res) => {
  const { category, exchange } = req.query;
  const lotSize = TradingService.getLotSize(req.params.symbol, category, exchange);
  res.json({ symbol: req.params.symbol, lotSize, category, exchange });
});

// ==================== ADMIN CHARGE SETTINGS ====================

// Get charge settings
router.get('/admin/charge-settings', protectAdmin, async (req, res) => {
  try {
    const admin = req.admin;
    const chargeSettings = admin.chargeSettings || { 
      spread: 0, 
      commission: 0,
      commissionType: 'PER_LOT',
      perLotCharge: 0,
      perTradeCharge: 0,
      perCroreCharge: 0
    };
    res.json(chargeSettings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Save charge settings
router.post('/admin/charge-settings', protectAdmin, async (req, res) => {
  try {
    const { spread, commissionType, perLotCharge, perTradeCharge, perCroreCharge } = req.body;
    const admin = req.admin;
    
    admin.chargeSettings = {
      spread: spread || 0,
      commission: perLotCharge || 0, // Keep backward compatibility
      commissionType: commissionType || 'PER_LOT',
      perLotCharge: perLotCharge || 0,
      perTradeCharge: perTradeCharge || 0,
      perCroreCharge: perCroreCharge || 0
    };
    await admin.save();
    
    res.json({ message: 'Charge settings saved', chargeSettings: admin.chargeSettings });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
