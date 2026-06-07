import express from 'express';
import TradingService from '../services/tradingService.js';
import Instrument from '../models/Instrument.js';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import Trade from '../models/Trade.js';
import { protectUser as protect, protectAdmin } from '../middleware/auth.js';
import { getTradeCloseBreakdown } from '../utils/tradeCloseBreakdown.js';
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
import { getLtpHistory } from '../services/ltpHistoryStore.js';
import { previewPartialClose, executePartialClose } from '../services/partialCloseService.js';

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

// Previous LTPs with time (in-memory history)
// Query: ?token=123 or ?pair=BTCUSDT or ?key=<anything>  &limit=120
router.get('/ltp-history', protect, async (req, res) => {
  try {
    const key = String(req.query.token || req.query.pair || req.query.key || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 120, 1), 500);
    if (!key) return res.status(400).json({ message: 'token (or pair) is required' });
    const points = getLtpHistory(key, limit);
    res.json({ key, points });
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
            'tradingDefaults exchange segment displaySegment symbol tradingSymbol category pair name lotSize qtyFilterMin qtyFilterMax instrumentType low high ltp'
          )
          .lean()
      : null;

    const fullUser = await User.findById(req.user._id).populate({
      path: 'admin',
      select: 'restrictions hierarchyPath role adminCode segmentPermissions',
    });

    const {
      resolveSegmentGroupLowHighForInstrument,
      resolveSegmentGroupClientTradingForInstrument,
    } = await import('../services/segmentGroupingService.js');
    const { isAllowedWithinLowHigh } = await import('../services/instrumentRestrictionService.js');
    const denyCtxPreview = buildInstrumentDenyContext(req.body, instrumentDoc);
    const { resolveDayLowHighRange } = await import('../utils/lowHighTradeGate.js');
    const segmentLowHigh = await resolveSegmentGroupLowHighForInstrument(instrumentDoc, req.body);
    const segmentClientTrading = await resolveSegmentGroupClientTradingForInstrument(
      instrumentDoc,
      req.body
    );
    const allowedFromDenylist = fullUser
      ? await isAllowedWithinLowHigh(fullUser, denyCtxPreview)
      : false;
    const lowHighRestrict = Boolean(segmentLowHigh.restrict || allowedFromDenylist);
    let segmentGroupTradingBlock = null;
    if (segmentClientTrading.allowed === false) {
      const onlyClosing = await TradingService.orderOnlyReducesOpenPosition(req.user._id, req.body);
      if (!onlyClosing) {
        const gl = segmentClientTrading.groupLabel || segmentClientTrading.groupKey || 'group';
        segmentGroupTradingBlock = `Trading disabled for "${gl}" (Segment Grouping → Client trading OFF).`;
      }
    }
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

    const hierarchySegKeyPreview = TradeService.resolveMarketWatchSegmentKey(effectiveSegment, instrumentType);
    const allowOptionBuyLeverage =
      isOptionBuy &&
      TradeService.segmentHasOptionSideLeverage(hierarchySegKeyPreview);
    leverage = TradeService.capLeverageFromInstrument(instrumentDoc, leverage, isIntraday, isOptionBuy, {
      allowOptionBuyLeverage,
    });
    
    const price = req.body.price || 0;
    const bnCryptoPreview = isBinanceCryptoOrder({ ...req.body, segment: effectiveSegment });
    let contractLotSize = TradeService.getContractLotSize(instrumentDoc, {
      ...req.body,
      segment: effectiveSegment,
      exchange: exchange || instrumentDoc?.exchange,
    });
    if (contractLotSize <= 1 && req.body.token) {
      const asyncLot = await TradingService.getLotSizeAsync(
        symbol,
        req.body.token,
        exchange || instrumentDoc?.exchange
      );
      if (asyncLot > 1) contractLotSize = asyncLot;
    }
    if (contractLotSize <= 1) {
      const fallbackLot = TradingService.getLotSize(symbol, category, req.body.exchange);
      if (fallbackLot > 1) contractLotSize = fallbackLot;
    }
    let lotSize = contractLotSize;
    const segPrev = String(effectiveSegment || '').toUpperCase();
    const isIndianQtySegment =
      !bnCryptoPreview &&
      (['NSEFUT', 'NSEOPT', 'NSE-EQ', 'NSE', 'BSE', 'BSE-FUT', 'BSE-OPT', 'NFO', 'BFO', 'FNO', 'EQUITY'].includes(
        segPrev
      ) ||
        ['NSE', 'NFO', 'BSE', 'BFO'].includes(String(exchange || '').toUpperCase()));
    if (segPrev === 'CRYPTOFUT' || segPrev === 'CRYPTOOPT') {
      contractLotSize = 1;
      lotSize = 1;
    }
    if (bnCryptoPreview && instrumentDoc?.lotSize > 0) {
      lotSize = instrumentDoc.lotSize;
    }
    const lotsInput =
      req.body.lots != null && req.body.lots !== '' && Number.isFinite(Number(req.body.lots))
        ? Number(req.body.lots)
        : null;
    let quantity;
    if (isOption && lotsInput != null && lotsInput > 0 && contractLotSize > 0) {
      // Options: always derive qty from exchange contract lot size (DB), not client qty alone.
      quantity = lotsInput * contractLotSize;
    } else if (
      req.body.quantity != null &&
      req.body.quantity !== '' &&
      Number.isFinite(Number(req.body.quantity))
    ) {
      quantity = Number(req.body.quantity);
    } else {
      quantity = (lotsInput ?? lots) * lotSize;
    }
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
        const lotDivisor =
          isIndianQtySegment && !isOption && contractLotSize > 0 ? contractLotSize : lotSize;
        marginRequired = (fixedMarginPerLot / lotDivisor) * quantity;
        usedFixedMargin = true;
        marginSource = 'script_fixed';
      }
    }
    
    // Priority 2: Use segment exposure if no fixed margin
    // BUY option => premium-based notional, SELL option => strike-based notional
    // margin = notional / exposure / leverage
    // Also consider intradayLeverage/carryForwardLeverage as exposure fallback
    const segmentSettingsForMargin = TradeService.applyInstrumentExposureOverrides(
      instrumentDoc,
      segmentSettings
    );
    
    // For all segments: dynamically resolve leverage from segment settings (no hardcoding)
    const ss = segmentSettingsForMargin || segmentSettings || {};
    if (!usedFixedMargin) {
      const strikeForMargin = Number(req.body.strikePrice ?? instrumentDoc?.strike ?? instrumentDoc?.strikePrice);
      const isStrikeBasedOptionSell =
        isOptionSell && Number.isFinite(strikeForMargin) && strikeForMargin > 0;
      const marginNotional = isStrikeBasedOptionSell ? strikeForMargin * quantity : tradeValue;
      const exposure = TradeService.resolveSegmentExposureMultiplier(segmentSettingsForMargin || ss, {
        isIntraday,
        isOptionBuy,
        effectiveSegment,
        instrumentType,
      });

      console.log('[MarginPreview] Margin calculation debug:', {
        tradeValue,
        marginNotional,
        strikeForMargin: Number.isFinite(strikeForMargin) ? strikeForMargin : null,
        isStrikeBasedOptionSell,
        exposure,
        leverage,
        lotSize,
        segmentKey: effectiveSegment,
      });

      const effectiveExposure = Number(exposure) > 0 ? Number(exposure) : 1;
      const effectiveLeverage = Number(leverage) > 0 ? Number(leverage) : 1;
      const applyLev = (base, levValue) => (levValue >= 1 ? base / levValue : base * levValue);
      marginRequired = applyLev(applyLev(marginNotional, effectiveExposure), effectiveLeverage);
      marginSource = isStrikeBasedOptionSell ? 'option_sell_strike_exposure' : 'segment_exposure';
      if (segmentSettingsForMargin) {
        if (isIntraday) segmentSettingsForMargin.exposureIntraday = effectiveExposure;
        else segmentSettingsForMargin.exposureCarryForward = effectiveExposure;
      }
      console.log('[MarginPreview] Margin after exposure:', marginRequired);
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
    let entryBrokerage = 0;
    let exitBrokerage = 0;
    let spread = 0;
    try {
      const adminCaps = await Admin.findOne({ adminCode: req.user.adminCode })
        .select('brokerageCaps')
        .lean();
      const brokerageCaps = adminCaps?.brokerageCaps || null;
      const brokerageLots = isIndianQtySegment ? effectivePreviewLots : lots;
      const brokeragePayload = { ...req.body, quantity, lotSize };
      const baseBrokerage = await TradeService.calculateUserBrokerage(
        segmentSettings,
        scriptSettings,
        brokeragePayload,
        brokerageLots,
        brokerageCaps
      );
      const extraBrokerage = TradeService.instrumentAdditionalCommission(instrumentDoc, effectiveLots, tradeValue);
      const oneWayBrokerage = baseBrokerage + extraBrokerage;
      entryBrokerage = Math.round(oneWayBrokerage * 100) / 100;
      exitBrokerage = Math.round(oneWayBrokerage * 100) / 100;
      brokerage = entryBrokerage;
      
      // Options: no synthetic spread adjustment over bid/ask.
      const isOptionPreview = String(instrumentType || '').toUpperCase() === 'OPTIONS';
      spread = isOptionPreview ? 0 : TradeService.calculateUserSpread(scriptSettings, side);
    } catch (brokerageErr) {
      console.error('[MarginPreview] Brokerage calculation error (defaulting to 0):', brokerageErr.message);
      brokerage = 0;
      entryBrokerage = 0;
      exitBrokerage = 0;
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
    
    const {
      resolveWalletFieldFromFlags,
      computeOrderAvailableBalance,
      cashFreeMargin,
      sumWalletOpenMtm,
    } = await import('../utils/orderAvailableMargin.js');

    const walletField = resolveWalletFieldFromFlags({ isCrypto, isForex, isMCX });
    let tradingBalance, usedMarginDisplay;
    if (isCrypto) {
      tradingBalance = req.user.cryptoWallet?.balance || 0;
      usedMarginDisplay = recalculatedMargin.cryptoWallet;
    } else if (isForex) {
      tradingBalance = req.user.forexWallet?.balance || 0;
      usedMarginDisplay = recalculatedMargin.forexWallet;
    } else if (isMCX) {
      tradingBalance = req.user.mcxWallet?.balance || 0;
      usedMarginDisplay = recalculatedMargin.mcxWallet;
    } else {
      const { getNseBseBalance } = await import('../utils/nseBseWallet.js');
      tradingBalance = getNseBseBalance(req.user);
      usedMarginDisplay = recalculatedMargin.nseBseWallet ?? recalculatedMargin.wallet ?? 0;
    }

    const cashFree = cashFreeMargin(req.user, walletField, usedMarginDisplay);
    const segmentUnrealizedPnL = await sumWalletOpenMtm(req.user._id, walletField);
    const availableBalance = await computeOrderAvailableBalance(req.user._id, req.user, walletField, {
      usedMarginOverride: usedMarginDisplay,
    });
    
    // FUT / EQ / MCXFUT → quantityModeSettings; OPTIONS → lotSettings
    const qtyModeSettings = segmentSettings?.quantityModeSettings;
    const segLotSettings = segmentSettings?.lotSettings || {};
    const scriptLotSettings = scriptSettings?.lotSettings || {};
    let maxLots;
    let minLots;
    let breakupQuantity;
    let breakupLots = 0;
    if (isOption) {
      maxLots =
        scriptLotSettings.maxLots > 0
          ? scriptLotSettings.maxLots
          : segLotSettings.maxLots > 0
            ? segLotSettings.maxLots
            : segmentSettings?.maxLots;
      minLots =
        scriptLotSettings.minLots > 0
          ? scriptLotSettings.minLots
          : segLotSettings.minLots > 0
            ? segLotSettings.minLots
            : segmentSettings?.minLots || 1;
      breakupLots =
        scriptLotSettings.breakupLots > 0
          ? scriptLotSettings.breakupLots
          : segLotSettings.breakupLots > 0
            ? segLotSettings.breakupLots
            : 0;
      breakupQuantity = breakupLots;
      if (!maxLots || maxLots <= 0) maxLots = segmentSettings?.maxLots || 50;
      if (!minLots || minLots <= 0) minLots = 1;
    } else {
      maxLots =
        qtyModeSettings?.maxQuantity > 0
          ? qtyModeSettings.maxQuantity
          : scriptSettings?.lotSettings?.maxLots || segmentSettings?.maxLots;
      minLots =
        qtyModeSettings?.minQuantity > 0
          ? qtyModeSettings.minQuantity
          : scriptSettings?.lotSettings?.minLots || segmentSettings?.minLots || 1;
      const instrumentBreakupQuantity =
        instrumentDoc?.tradingDefaults?.enabled &&
        instrumentDoc.tradingDefaults.quantitySettings?.breakupQuantity;
      const segmentBreakupQuantity =
        qtyModeSettings?.breakupQuantity > 0
          ? qtyModeSettings.breakupQuantity
          : segmentSettings?.quantitySettings?.breakupQuantity || 0;
      breakupQuantity = instrumentBreakupQuantity || segmentBreakupQuantity || 0;
    }

    const resolvedPerOrderLots = isOption
      ? scriptLotSettings.perOrderLots > 0
        ? scriptLotSettings.perOrderLots
        : scriptLotSettings.orderLots > 0
          ? scriptLotSettings.orderLots
          : segmentSettings?.orderLots > 0
            ? segmentSettings.orderLots
            : null
      : (() => {
          const scriptOrderLots =
            scriptSettings?.lotSettings?.orderLots ?? scriptSettings?.lotSettings?.perOrderLots;
          const segmentOrderLots =
            segmentSettings?.lotSettings?.orderLots ?? segmentSettings?.orderLots;
          const merged = scriptOrderLots || segmentOrderLots || maxLots;
          return merged > 0 ? merged : null;
        })();

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
    } else if (isMCX && isOption) {
      const orderLots =
        lotsInput != null && lotsInput > 0
          ? lotsInput
          : contractLotSize > 0 && quantity > 0
            ? quantity / contractLotSize
            : lots;
      const maxCap = maxLots > 0 ? maxLots : 50;
      const minCap = minLots > 0 ? minLots : 1;
      lotsValid = Number.isFinite(orderLots) && orderLots > 0 && orderLots >= minCap && orderLots <= maxCap;
      if (!lotsValid) {
        lotsError = `Quantity must be between ${minCap} and ${maxCap} lots`;
      }
      const perOrderCap =
        breakupLots > 0
          ? breakupLots
          : resolvedPerOrderLots > 0
            ? resolvedPerOrderLots
            : 0;
      if (lotsValid && perOrderCap > 0 && orderLots > perOrderCap) {
        lotsValid = false;
        lotsError = `Max ${perOrderCap} lots per order`;
      }
    } else if (orderIsUsdSpot({ ...req.body, segment, instrumentType }) || isMCX) {
      // For MCX and USD spot, validate quantity directly (not lots)
      lotsValid = Number.isFinite(quantity) && quantity > 0;
      if (!lotsValid) {
        lotsError = `Invalid quantity`;
      } else if (minQuantity > 0 && quantity < minQuantity) {
        lotsValid = false;
        lotsError = `Minimum quantity is ${minQuantity}`;
      } else if (maxQuantity > 0 && quantity > maxQuantity) {
        lotsValid = false;
        lotsError = `Maximum quantity is ${maxQuantity}`;
      } else if (breakupQuantity > 0 && quantity > breakupQuantity) {
        lotsValid = false;
        lotsError = `Max ${breakupQuantity} quantity per order`;
      }
    } else {
      const isIndianQtySegment =
        !isCrypto &&
        !isForex &&
        !isMCX &&
        (['NSEFUT', 'NSEOPT', 'NSE-EQ', 'NSE', 'BSE', 'BSE-FUT', 'BSE-OPT', 'NFO', 'BFO', 'FNO', 'EQUITY'].includes(
          segPrev
        ) ||
          ['NSE', 'NFO', 'BSE', 'BFO'].includes(String(exchange || '').toUpperCase()));

      if (isIndianQtySegment) {
        const minQty = minLots > 0 ? minLots : 1;
        const maxQty = maxLots > 0 ? maxLots : 0;
        lotsValid = Number.isFinite(quantity) && quantity > 0;
        if (lotsValid && quantity < minQty) {
          lotsValid = false;
          lotsError = `Minimum quantity is ${minQty}`;
        } else if (lotsValid && maxQty > 0 && quantity > maxQty) {
          lotsValid = false;
          lotsError = `Maximum quantity is ${maxQty}`;
        } else if (lotsValid && breakupQuantity > 0 && quantity > breakupQuantity) {
          lotsValid = false;
          lotsError = `Max ${breakupQuantity} quantity per order`;
        }
      } else {
        lotsValid = lots >= minLots && lots <= maxLots;
        if (!lotsValid) {
          lotsError = `Quantity must be between ${minLots} and ${maxLots} lots`;
        }
      }
    }
    
    // Get commission from segment settings
    const commission = segmentSettings?.commissionLot || segmentSettings?.commission || 0;
    const perOrderLots = resolvedPerOrderLots;
    const exposeLotLimits = !isMCX || isOption;
    
    const totalRequired = marginRequired + brokerage;
    const marginShortfall = Math.max(0, marginRequired - availableBalance);
    const brokerageShortfall = Math.max(0, brokerage - availableBalance);
    const canPlace =
      lotsValid && totalRequired <= availableBalance && !segmentGroupTradingBlock;
    const shortfall = brokerageShortfall;
    const displayAvailableBalance = Math.max(0, availableBalance - brokerage);

    res.json({
      marginRequired: Math.round(marginRequired * 100) / 100,
      totalRequired: Math.round(totalRequired * 100) / 100,
      tradeValue: Math.round(tradeValue * 100) / 100,
      effectiveMargin: marginCalc.effectiveMargin,
      leverage,
      canPlace,
      availableBalance,
      cashFreeMargin: Math.round(cashFree * 100) / 100,
      segmentUnrealizedPnL: Math.round(segmentUnrealizedPnL * 100) / 100,
      displayAvailableBalance: Math.round(displayAvailableBalance * 100) / 100,
      tradingBalance,
      brokerageShortfall: Math.round(brokerageShortfall * 100) / 100,
      marginShortfall: Math.round(marginShortfall * 100) / 100,
      usedFixedMargin,
      marginSource,
      brokerage: Math.round(brokerage * 100) / 100,
      entryBrokerage: Math.round(entryBrokerage * 100) / 100,
      exitBrokerage: Math.round(exitBrokerage * 100) / 100,
      totalBrokerage: Math.round((entryBrokerage + exitBrokerage) * 100) / 100,
      commission: Math.round(commission * 100) / 100,
      spread,
      minQuantity: (isCrypto || isForex || isMCX) ? minQuantity : undefined,
      maxQuantity: (isCrypto || isForex || isMCX) ? maxQuantity : undefined,
      quantityStep: (isCrypto || isForex || isMCX) ? (perOrderLots * lotSize || quantityStep) : undefined,
      lotSize: contractLotSize > 0 ? contractLotSize : isMCX ? undefined : lotSize,
      contractLots: isOption && lotsInput != null ? lotsInput : effectivePreviewLots,
      contractQuantity: quantity,
      effectiveLots: isMCX && !isOption ? undefined : Math.round(effectivePreviewLots * 1e8) / 1e8,
      maxLots: exposeLotLimits ? maxLots : undefined,
      minLots: exposeLotLimits ? minLots : undefined,
      perOrderLots: exposeLotLimits ? perOrderLots : undefined,
      breakupLots: exposeLotLimits && isOption && breakupLots > 0 ? breakupLots : undefined,
      lotsValid,
      lotsError: segmentGroupTradingBlock
        ? segmentGroupTradingBlock
        : !lotsValid
          ? lotsError || (isMCX ? 'Invalid quantity' : `Quantity must be between ${minLots} and ${maxLots}`)
          : null,
      segmentGroupTradingBlock: segmentGroupTradingBlock || null,
      shortfall,
      exposureIntraday: segmentSettingsForMargin?.exposureIntraday || null,
      exposureCarryForward: segmentSettingsForMargin?.exposureCarryForward || null,
      defaultIntradayOnly: segmentSettings?.defaultIntradayOnly === true,
      breakupQuantity: !isOption && breakupQuantity > 0 ? breakupQuantity : null,
      maxBid: maxBid > 0 ? maxBid : null,
      lowHighRestrict,
      lowHighGroupLabel: segmentLowHigh.groupLabel || null,
      lowHighRange:
        lowHighRestrict
          ? (() => {
              const r = resolveDayLowHighRange(instrumentDoc, req.body);
              return r ? { low: r.low, high: r.high } : null;
            })()
          : null,
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

// Closed trade — gross/net vs admin patti pool breakdown
router.get('/trades/:tradeId/close-breakdown', protect, async (req, res) => {
  try {
    const trade = await Trade.findById(req.params.tradeId).select('user status').lean();
    if (!trade) return res.status(404).json({ message: 'Trade not found' });
    if (String(trade.user) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Not allowed' });
    }
    const breakdown = await getTradeCloseBreakdown(req.params.tradeId);
    res.json(breakdown);
  } catch (error) {
    const code = error.statusCode || 500;
    res.status(code).json({ message: error.message });
  }
});

// Autosquare event log (every run at 12:00, 13:00, end time, etc.)
router.get('/autosquare-history', protect, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 300;
    const rows = await TradingService.getAutoSquareHistory(req.user._id, limit);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/positions/:id/partial-close/preview', protect, async (req, res) => {
  try {
    if (req.user.isReadOnly) {
      return res.status(403).json({ message: 'Your account is in read-only mode.' });
    }
    const quantity = Number(req.query.quantity);
    const bidPrice = Number(req.query.bidPrice);
    const askPrice = Number(req.query.askPrice);
    const data = await previewPartialClose(req.user._id, req.params.id, quantity, {
      bidPrice: Number.isFinite(bidPrice) ? bidPrice : undefined,
      askPrice: Number.isFinite(askPrice) ? askPrice : undefined,
    });
    res.json(data);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/positions/:id/partial-close', protect, async (req, res) => {
  try {
    if (req.user.isReadOnly) {
      return res.status(403).json({ message: 'Your account is in read-only mode.' });
    }
    const result = await executePartialClose(req.user._id, req.params.id, req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
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

// Get contract lot size for symbol (DB token lookup + MCX/NSE symbol fallback)
router.get('/lot-size/:symbol', protect, async (req, res) => {
  try {
    const TradeService = (await import('../services/tradeService.js')).default;
    const { category, exchange, token, tradingSymbol } = req.query;
    const symbol = req.params.symbol;
    let instrument = null;
    if (token) {
      instrument = await Instrument.findOne({ token: String(token) })
        .select('lotSize symbol tradingSymbol exchange category segment displaySegment')
        .lean();
    }
    const lotSize = TradeService.getContractLotSize(instrument, {
      symbol,
      tradingSymbol,
      exchange,
      category,
      segment: instrument?.displaySegment || instrument?.segment,
    });
    res.json({
      symbol,
      tradingSymbol: tradingSymbol || instrument?.tradingSymbol,
      lotSize,
      category,
      exchange: exchange || instrument?.exchange,
      source: instrument?.lotSize > 1 ? 'database' : lotSize > 1 ? 'symbol' : 'default',
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
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
