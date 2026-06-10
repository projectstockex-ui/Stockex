import Trade from '../models/Trade.js';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import MarketState from '../models/MarketState.js';
import Charges from '../models/Charges.js';
import WalletLedger from '../models/WalletLedger.js';
import Instrument from '../models/Instrument.js';
import SystemSettings from '../models/SystemSettings.js';
import { orderIsUsdSpot, orderIsForex } from '../utils/tradingUsdSpot.js';
import {
  isBinanceCryptoOrder,
  assertBinanceCryptoQuantityValidated,
} from '../utils/binanceCryptoQty.js';
import {
  adminReceivesHierarchyBrokerage,
  resolveHierarchyBrokerageRecipient,
} from '../utils/adminBrokerageEligibility.js';
import {
  resolvePattiCascadeCredits,
  resolvePattiAdminSaBrokerageContext,
  splitByChildPercent,
  roundMoney,
} from './pattiTradeSettlement.js';
import {
  fundAdminShareFromSaWallets,
  resolveSaFundingKuberPct,
} from '../utils/kuberWallet.js';
import { 
  trackHierarchyEarnings 
} from './superAdminEarningsService.js';
import brokerageHierarchySharingService from './brokerageHierarchySharingService.js';
import { resolveSegmentCommissionType } from '../utils/segmentCommissionType.js';
import { explicitKeysTouchCommission } from '../utils/commissionTypeUnit.js';
import { resolveContractLotSize } from '../utils/lotSizeResolver.js';
import {
  resolveFranchiseTradingContext,
  computeFranchiseUserOneWayBrokerage,
  buildFranchiseAdminInrLevels,
  computeFranchiseCascadeShares,
  sumFranchiseCascadeCredits,
  resolveFranchiseLegMultiplier,
  computeFranchiseUserTotalBrokerage,
  getUserFranchiseRatePerCrore,
  findFranchiseRootInChain,
  perCroreRateToInr,
  refreshFranchiseHierarchyChain,
  splitFranchiseBookPnL,
  resolveUserDirectAdmin,
  resolveBrokerageCascadeStartAdmin,
  resolveSuperAdminAdmin,
  ensureSuperAdminInChain,
  buildAdminHierarchyChain,
} from '../utils/franchiseBrokerage.js';
import { isAdminInActivePattiSubtree } from '../utils/pattiSubtree.js';
import WalletService from './walletService.js';
import { chainHasDownlinePattiEdges } from '../utils/pattiHierarchy.js';
import {
  buildMlmAdminInrLevels,
  computeMlmLevelShareAmount,
  resolveMlmChainCommissionMeta,
} from '../utils/mlmBrokerage.js';
import { profitAllowedForWallet } from '../utils/walletBlock.js';

class TradeService {
  
  // Check if market is open for trading
  static async checkMarketOpen(segment = 'EQUITY') {
    const isOpen = await MarketState.isTradingAllowed(segment);
    if (!isOpen) {
      throw new Error('Market is closed. Trading disabled.');
    }
    return true;
  }

  static _segmentMapPlain(segmentMap) {
    if (!segmentMap) return {};
    if (segmentMap instanceof Map) return Object.fromEntries(segmentMap);
    return typeof segmentMap === 'object' ? segmentMap : {};
  }

  /**
   * USD spot: fill missing segment spread from Super Admin `adminSegmentDefaults` (INR width and/or USD per side).
   */
  static async mergeUsdSpotSpreadFromSuperAdmin(segmentSettings, tradeData) {
    if (!orderIsUsdSpot(tradeData)) return segmentSettings;
    let out = { ...segmentSettings };

    let key = 'CRYPTOFUT';
    if (orderIsForex(tradeData)) {
      const ds = String(tradeData.displaySegment || '').toUpperCase();
      const seg = String(tradeData.segment || '').toUpperCase();
      key = ds === 'FOREXOPT' || seg === 'FOREXOPT' ? 'FOREXOPT' : 'FOREXFUT';
    }

    try {
      const sys = await SystemSettings.getSettings();
      const raw = sys?.adminSegmentDefaults;
      const asd =
        raw instanceof Map ? Object.fromEntries(raw) : raw && typeof raw === 'object' ? { ...raw } : {};

      const w = Number(out.cryptoSpreadInr);
      if (!Number.isFinite(w) || w <= 0) {
        let defInr = NaN;
        if (orderIsForex(tradeData)) {
          defInr = Number(asd[key]?.cryptoSpreadInr);
        } else {
          for (const segKey of ['CRYPTOFUT', 'CRYPTOOPT']) {
            const v = Number(asd[segKey]?.cryptoSpreadInr);
            if (Number.isFinite(v) && v > 0) {
              defInr = v;
              break;
            }
          }
        }
        if (Number.isFinite(defInr) && defInr > 0) out.cryptoSpreadInr = defInr;
      }

      const us = Number(out.cryptoSpreadUsdPerSide);
      if (!Number.isFinite(us) || us <= 0) {
        let defUsd = NaN;
        if (orderIsForex(tradeData)) {
          defUsd = Number(asd[key]?.cryptoSpreadUsdPerSide);
        } else {
          for (const segKey of ['CRYPTOFUT', 'CRYPTOOPT']) {
            const v = Number(asd[segKey]?.cryptoSpreadUsdPerSide);
            if (Number.isFinite(v) && v > 0) {
              defUsd = v;
              break;
            }
          }
        }
        if (Number.isFinite(defUsd) && defUsd > 0) out.cryptoSpreadUsdPerSide = defUsd;
      }

      return out;
    } catch {
      return segmentSettings;
    }
  }

  /** Compare current Asia/Kolkata clock to HH:mm or HH:mm:ss (24h). Invalid / empty pattern → treat as allowed. */
  static _isNowAtOrAfterIstClock(hms) {
    const s = String(hms || '').trim();
    const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return true;
    const H = parseInt(m[1], 10);
    const Mi = parseInt(m[2], 10);
    const Sec = m[3] != null && m[3] !== '' ? parseInt(m[3], 10) : 0;
    if (
      !Number.isFinite(H) ||
      !Number.isFinite(Mi) ||
      !Number.isFinite(Sec) ||
      H > 23 ||
      Mi > 59 ||
      Sec > 59
    ) {
      return true;
    }
    const targetSecOfDay = H * 3600 + Mi * 60 + Sec;
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const nh = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
    const nm = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
    const ns = parseInt(parts.find((p) => p.type === 'second')?.value || '0', 10);
    const nowSecOfDay = nh * 3600 + nm * 60 + ns;
    const result = nowSecOfDay >= targetSecOfDay;
    console.log(`[CryptoTimeCheck] Time comparison - Target: ${hms} (${targetSecOfDay}s), Now: ${nh}:${nm}:${ns} (${nowSecOfDay}s), Result: ${result}`);
    return result;
  }

  /**
   * CRYPTOFUT / CRYPTOOPT: optional earliest IST start from segment permissions or system admin defaults
   * (for users created under Super Admin full-access slice).
   */
  static async assertCryptoSegmentTradingWindowOpen(user, segmentSettings, segmentRaw) {
    const segU = String(segmentRaw || '').toUpperCase();
    console.log(`[CryptoTimeCheck] ===== START ===== Called with segment: ${segU}, user: ${user?.username || user?._id}`);
    console.log(`[CryptoTimeCheck] segmentRaw: ${segmentRaw}, segU: ${segU}`);
    
    if (segU !== 'CRYPTOFUT' && segU !== 'CRYPTOOPT') {
      console.log(`[CryptoTimeCheck] Skipping - segment is ${segU}, not CRYPTOFUT/CRYPTOOPT`);
      return;
    }
    
    console.log(`[CryptoTimeCheck] Proceeding with timing check for ${segU}`);

    // For both CRYPTOFUT and CRYPTOOPT, always use CRYPTOFUT timing
    const segForTiming = 'CRYPTOFUT';
    console.log(`[CryptoTimeCheck] Using CRYPTOFUT timing for ${segU}`);

    // Resolve crypto timing from hierarchy: Admin's own timing takes precedence
    // Walk up: user's direct admin → hierarchy path → Super Admin segmentPermissions → system defaults
    let start = '';
    let close = '';

    // 1. Try to get from the user's direct admin (admin-specific timing)
    const directAdmin = await Admin.findById(user.adminId).select('cryptoStartTime cryptoEndTime parentId hierarchyPath');
    console.log(`[CryptoTimeCheck] Direct admin for user ${user?.username || user?._id}: ${directAdmin?.username || directAdmin?._id}`);
    
    if (directAdmin) {
      // Check if direct admin has crypto timing set
      if (directAdmin.cryptoStartTime && directAdmin.cryptoEndTime) {
        start = directAdmin.cryptoStartTime.toString().trim();
        close = directAdmin.cryptoEndTime.toString().trim();
        console.log(`[CryptoTimeCheck] From direct admin crypto timing: start=${start}, close=${close}, admin=${directAdmin.username}`);
      } else {
        console.log(`[CryptoTimeCheck] Direct admin has no crypto timing set, checking hierarchy`);
        
        // 2. Walk up hierarchy to find first admin with crypto timing
        let currentAdmin = directAdmin;
        while (currentAdmin && (!start || !close)) {
          if (currentAdmin.cryptoStartTime && currentAdmin.cryptoEndTime) {
            start = currentAdmin.cryptoStartTime.toString().trim();
            close = currentAdmin.cryptoEndTime.toString().trim();
            console.log(`[CryptoTimeCheck] Found crypto timing in hierarchy: start=${start}, close=${close}, admin=${currentAdmin.username}`);
            break;
          }
          if (currentAdmin.parentId) {
            currentAdmin = await Admin.findById(currentAdmin.parentId).select('cryptoStartTime cryptoEndTime parentId username');
          } else {
            break;
          }
        }
      }
    }

    // 3. If still not found, try Super Admin segmentPermissions
    if (!start || !close) {
      const superAdmin = await this._getSuperAdminForUser(user);
      console.log(`[CryptoTimeCheck] Super Admin for user ${user?.username || user?._id}: ${superAdmin?.username || superAdmin?._id}`);
      if (superAdmin) {
        const saSegPerms = superAdmin.segmentPermissions instanceof Map
          ? superAdmin.segmentPermissions.get(segForTiming)
          : superAdmin.segmentPermissions?.[segForTiming];
        const saSlice = saSegPerms && typeof saSegPerms.toObject === 'function' ? saSegPerms.toObject() : saSegPerms;
        if (saSlice) {
          start = (saSlice.cryptoStartTime || '').toString().trim();
          close = (saSlice.cryptoClosingTime || '').toString().trim();
          console.log(`[CryptoTimeCheck] From Super Admin segmentPermissions: start=${start}, close=${close}, segment=${segU}`);
        } else {
          console.log(`[CryptoTimeCheck] Super Admin segmentPermissions not found for ${segU}`);
        }
      }
    }

    // 2. Fallback to system defaults if Super Admin hasn't set them
    if (!start && !close) {
      console.log(`[CryptoTimeCheck] Falling back to system defaults`);
      const sys = await SystemSettings.getSettings();
      const m = this._segmentMapPlain(sys.adminSegmentDefaults);
      const def = m[segU];
      if (def) {
        start = (def.cryptoStartTime || '').toString().trim();
        close = (def.cryptoClosingTime || '').toString().trim();
        console.log(`[CryptoTimeCheck] From system defaults: start=${start}, close=${close}, segment=${segU}`);
      }
    }

    console.log(`[CryptoTimeCheck] Final values - Segment: ${segU}, StartTime: ${start}, CloseTime: ${close}, User: ${user?.username || user?._id}`);

    // Check start time gate
    if (start && !this._isNowAtOrAfterIstClock(start)) {
      throw new Error(`Crypto trading opens at ${start} IST. You cannot open trade before start time.`);
    }

    // Check end time gate
    if (close && this._isNowAtOrAfterIstClock(close)) {
      console.log(`[CryptoTimeCheck] BLOCKING - Current time is at or after ${close} IST`);
      throw new Error(`Crypto trading closed at ${close} IST. End time is ${close} so you cannot open trade.`);
    }

    console.log(`[CryptoTimeCheck] PASSED - Trading window is open`);
  }

  /** Walk up the hierarchy to find the Super Admin for a given user. */
  static async _getSuperAdminForUser(user) {
    const Admin = (await import('../models/Admin.js')).default;

    // If user has hierarchyPath, the first entry is typically the Super Admin
    if (user.hierarchyPath && user.hierarchyPath.length > 0) {
      const topId = user.hierarchyPath[0];
      const top = await Admin.findById(topId).lean();
      if (top && top.role === 'SUPER_ADMIN') return top;
    }

    // Walk up via adminCode → createdBy chain
    let currentAdminCode = user.adminCode;
    const visited = new Set();
    while (currentAdminCode && !visited.has(currentAdminCode)) {
      visited.add(currentAdminCode);
      const adm = await Admin.findOne({ adminCode: currentAdminCode }).lean();
      if (!adm) break;
      if (adm.role === 'SUPER_ADMIN') return adm;
      // Move up: find the admin who created this one
      if (adm.createdBy) {
        const parent = await Admin.findById(adm.createdBy).lean();
        if (!parent) break;
        if (parent.role === 'SUPER_ADMIN') return parent;
        currentAdminCode = parent.adminCode;
      } else {
        break;
      }
    }
    return null;
  }
  
  // Calculate required margin for a trade
  // NOTE: quantity here is the RAW quantity (e.g. number of shares/units, NOT multiplied by lotSize)
  // notionalValue = price × quantity × lotSize
  // If caller passes totalQuantity (already includes lotSize), pass lotSize=1
  // For MCX, NSE, NSE-EQ, NSEFUT, NSEOPT, BSE, BSE-FUT, BSE-OPT trades, lotSize is always 1 since we use quantity-based trading
  static calculateMargin(price, quantity, lotSize, leverage, productType, isMcx = false, segment = null) {
    // For MCX, NSE, NSE-EQ, NSEFUT, NSEOPT, BSE, BSE-FUT, BSE-OPT, lotSize is always 1 (quantity-based trading)
    const segU = String(segment || '').toUpperCase();
    const isQuantityBased = isMcx || segU === 'NSE' || segU === 'NSE-EQ' || segU === 'NSEFUT' || segU === 'NSEOPT' || segU === 'BSE' || segU === 'BSE-FUT' || segU === 'BSE-OPT';
    const effectiveLotSize = isQuantityBased ? 1 : lotSize;
    const notionalValue = price * quantity * effectiveLotSize;

    console.log(`[calculateMargin] price: ${price}, quantity: ${quantity}, lotSize: ${lotSize}, effectiveLotSize: ${effectiveLotSize}, isMcx: ${isMcx}, leverage: ${leverage}, productType: ${productType}`);
    console.log(`[calculateMargin] notionalValue: ${notionalValue}`);

    if (productType === 'CNC') {
      return notionalValue; // Full amount for delivery
    }

    const lev = Number(leverage);
    const levSafe = Number.isFinite(lev) && lev > 0 ? lev : 1;
    // Leverage semantics:
    // - lev >= 1  => classic X leverage (margin = notional / lev)
    // - 0 < lev < 1 => margin rate (e.g. 0.04 means 4% margin = notional * 0.04)
    const margin = levSafe >= 1 ? (notionalValue / levSafe) : (notionalValue * levSafe);
    console.log(`[calculateMargin] calculated margin: ${margin}`);
    return margin;
  }
  
  // Check if trade segment is MCX (uses separate MCX wallet)
  static isMcxTrade(segment, exchange) {
    const segmentUpper = segment?.toUpperCase() || '';
    const exchangeUpper = exchange?.toUpperCase() || '';
    return segmentUpper === 'MCX' || segmentUpper === 'MCXFUT' || segmentUpper === 'MCXOPT' || 
           segmentUpper === 'COMMODITY' || exchangeUpper === 'MCX';
  }
  
  // Validate if user has sufficient margin
  static async validateMargin(userId, requiredMargin, segment = null, exchange = null) {
    const user = await User.findById(userId).populate('admin');
    if (!user) throw new Error('User not found');

    // Use separate wallets for crypto and forex
    const isMcx = this.isMcxTrade(segment, exchange);
    const isCrypto = exchange === 'BINANCE' || ['CRYPTOFUT', 'CRYPTOOPT'].includes(String(segment || '').toUpperCase());
    const isForex = exchange === 'FOREX' || ['FOREX', 'FOREXFUT', 'FOREXOPT'].includes(String(segment || '').toUpperCase());
    const segU = String(segment || '').toUpperCase();
    const isNSE = segU === 'NSE' || segU === 'NSE-EQ' || segU === 'NSEFUT' || segU === 'NSEOPT';
    const isBSE = segU === 'BSE' || segU === 'BSE-FUT' || segU === 'BSE-OPT';

    let totalWalletBalance;
    let walletType;

    if (isMcx) {
      totalWalletBalance = user.mcxWallet?.balance || 0;
      walletType = 'MCX';
    } else if (isCrypto) {
      totalWalletBalance = user.cryptoWallet?.balance || 0;
      walletType = 'Crypto';
    } else if (isForex) {
      totalWalletBalance = user.forexWallet?.balance || 0;
      walletType = 'Forex';
    } else {
      const { getNseBseBalance } = await import('../utils/nseBseWallet.js');
      totalWalletBalance = getNseBseBalance(user);
      walletType = 'NSE & BSE';
    }

    // CRITICAL CHANGE: Compare required margin against total wallet balance instead of available balance
    // This allows trades as long as required margin <= total balance, regardless of used margin
    if (totalWalletBalance < requiredMargin) {
      throw new Error(`Insufficient margin in ${walletType} Account. Required: ${requiredMargin.toFixed(2)}, Available: ${totalWalletBalance.toFixed(2)}`);
    }
  }

  // Get user's leverage for a segment (helper function)
  static async getUserLeverageForSegment(user, segment) {
    try {
      const segUpper = segment?.toUpperCase() || 'NSEFUT';
      const userSegmentSettings = user.segmentPermissions?.[segUpper];
      
      // Priority: lotSettings.intradayLeverage > intradayLeverage > exposureIntraday > default
      let leverage = 1;
      
      if (userSegmentSettings?.lotSettings?.intradayLeverage) {
        leverage = userSegmentSettings.lotSettings.intradayLeverage;
      } else if (userSegmentSettings?.intradayLeverage) {
        leverage = userSegmentSettings.intradayLeverage;
      } else if (userSegmentSettings?.exposureIntraday) {
        leverage = userSegmentSettings.exposureIntraday;
      }
      
      return leverage > 0 ? leverage : 1;
    } catch (error) {
      console.error('Error getting user leverage:', error);
      return 1;
    }
  }
  
  /** Lowest scaffold when SystemSettings + overlays omit keys. */
  static _SEGMENT_MERGE_FALLBACK = {
    enabled: true,
    quantitySettings: { breakupQuantity: 0, maxBid: 0, minExchangeQty: 0, maxExchangeQty: 0 },
    maxExchangeLots: 1000,
    commissionType: 'PER_LOT',
    commissionLot: 0,
    maxLots: 50,
    minLots: 1,
    orderLots: 10,
    exposureIntraday: 10,
    exposureCarryForward: 5,
    allowClientIntradayOnly: true,
    defaultIntradayOnly: false,
    cryptoSpreadInr: 0,
    cryptoSpreadUsdPerSide: 0,
    cryptoStartTime: '',
    cryptoClosingTime: '',
    cryptoReferenceSymbol: '',
    cryptoPricePerLotInr: 0,
    cryptoLotSizeLots: 1,
    cryptoLotSizeQuantity: 0,
    optionBuy: { allowed: true, commissionType: 'PER_LOT', commission: 0, strikeSelection: 100, maxExchangeLots: 1000, intradayLeverage: 1, carryForwardLeverage: 1 },
    optionSell: { allowed: true, commissionType: 'PER_LOT', commission: 0, strikeSelection: 100, maxExchangeLots: 1000, intradayLeverage: 1, carryForwardLeverage: 1 },
  };

  /** Segments where option buy/sell blocks carry their own MIS / NRML leverage. */
  static OPTION_LEVERAGE_SEGMENT_KEYS = new Set(['NSEOPT', 'MCXOPT', 'CRYPTOOPT']);

  static segmentHasOptionSideLeverage(segmentKey) {
    return TradeService.OPTION_LEVERAGE_SEGMENT_KEYS.has(String(segmentKey || '').toUpperCase());
  }

  /** Per-side leverage from hierarchy optionBuy / optionSell (OPT segments only). */
  static resolveOptionSideLeverage(segmentKey, segmentSettings, { isOptionBuy, isIntraday }) {
    if (!TradeService.segmentHasOptionSideLeverage(segmentKey)) return null;
    const side = isOptionBuy ? segmentSettings?.optionBuy : segmentSettings?.optionSell;
    if (!side || typeof side !== 'object') return null;
    const raw = isIntraday ? side.intradayLeverage : side.carryForwardLeverage;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
    return null;
  }

  /** Same exposure priority for margin-preview and placeOrder (avoids UI vs server mismatch). */
  static resolveSegmentExposureMultiplier(segmentSettings, { isIntraday, isOptionBuy, effectiveSegment, instrumentType }) {
    const ss = segmentSettings || {};
    const segKey = TradeService.resolveMarketWatchSegmentKey(
      effectiveSegment,
      instrumentType || (isOptionBuy ? 'OPTIONS' : 'FUTURES')
    );
    const optLev = TradeService.resolveOptionSideLeverage(segKey, ss, { isOptionBuy, isIntraday });
    const candidates = isIntraday
      ? [
          optLev,
          ss.quantityModeSettings?.intradayLeverage,
          ss.lotSettings?.intradayLeverage,
          ss.exposureIntraday,
          ss.intradayLeverage,
        ]
      : [
          optLev,
          ss.quantityModeSettings?.carryForwardLeverage,
          ss.lotSettings?.carryForwardLeverage,
          ss.exposureCarryForward,
          ss.carryForwardLeverage,
        ];

    let exposure = 1;
    for (const v of candidates) {
      if (v == null) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) continue;
      if (optLev != null && n === Number(optLev)) {
        exposure = n;
        break;
      }
      exposure = n;
      break;
    }

    if (exposure === 1 && ss.quantityModeSettings) {
      const qtyLev = isIntraday
        ? ss.quantityModeSettings.intradayLeverage
        : ss.quantityModeSettings.carryForwardLeverage;
      if (Number(qtyLev) > 0) exposure = Number(qtyLev);
    }

    return exposure;
  }

  static isIndianQuantitySegmentKey(segment, exchange) {
    const segU = String(segment || '').toUpperCase();
    const ex = String(exchange || '').toUpperCase();
    return (
      ['NSEFUT', 'NSEOPT', 'NSE-EQ', 'NSE', 'BSE', 'BSE-FUT', 'BSE-OPT', 'NFO', 'BFO', 'FNO', 'EQUITY'].includes(
        segU
      ) || ['NSE', 'NFO', 'BSE', 'BFO'].includes(ex)
    );
  }

  /** Exchange contract lot (e.g. CRUDEOIL 100, NIFTY 25) — not a placeholder 1 from sync. */
  static getContractLotSize(instrument, orderData) {
    return resolveContractLotSize(instrument, orderData);
  }

  /** Map trade segment + instrument type → Hierarchy / Default-settings segment key. */
  static resolveMarketWatchSegmentKey(segment, instrumentType) {
    const segmentUpper = String(segment || '').toUpperCase();
    const isOptions = instrumentType === 'OPTIONS' || instrumentType === 'OPT';

    let segmentKey = segmentUpper;
    const marketWatchSegments = [
      'NSEFUT',
      'NSEOPT',
      'MCXFUT',
      'MCXOPT',
      'NSE-EQ',
      'BSE-FUT',
      'BSE-OPT',
      'FOREXFUT',
      'FOREXOPT',
      'CRYPTOFUT',
      'CRYPTOOPT',
    ];
    if (marketWatchSegments.includes(segmentUpper)) {
      segmentKey = segmentUpper;
    } else if (
      segmentUpper === 'NSEFUT' ||
      segmentUpper === 'NSEOPT'
    ) {
      segmentKey = segmentUpper;
    } else if (
      segmentUpper === 'EQUITY' ||
      segmentUpper === 'EQ' ||
      segmentUpper === 'NSE' ||
      segmentUpper === 'NSEEQ'
    ) {
      segmentKey = 'NSE-EQ';
    } else if (
      segmentUpper === 'FNO' ||
      segmentUpper === 'NFO' ||
      segmentUpper === 'NSEINDEX' ||
      segmentUpper === 'NSESTOCK'
    ) {
      segmentKey = isOptions ? 'NSEOPT' : 'NSEFUT';
    } else if (segmentUpper === 'MCX' || segmentUpper === 'COMMODITY') {
      segmentKey = isOptions ? 'MCXOPT' : 'MCXFUT';
    } else if (segmentUpper === 'BSE' || segmentUpper === 'BFO') {
      segmentKey = isOptions ? 'BSE-OPT' : 'BSE-FUT';
    } else if (segmentUpper === 'CURRENCY' || segmentUpper === 'CDS') {
      segmentKey = 'NSEFUT';
    } else if (segmentUpper === 'FOREX') {
      segmentKey = isOptions ? 'FOREXOPT' : 'FOREXFUT';
    } else if (segmentUpper === 'BINANCE' || segmentUpper === 'CRYPTO') {
      segmentKey = isOptions ? 'CRYPTOOPT' : 'CRYPTOFUT';
    }
    return String(segmentKey || segmentUpper || '');
  }

  static _normalizeSegmentSlice(permsMaybe) {
    if (permsMaybe == null) return null;
    let o = permsMaybe;
    if (typeof o.toObject === 'function') o = o.toObject();
    if (o instanceof Map) return Object.fromEntries(o);
    return typeof o === 'object' ? { ...o } : null;
  }

  static _sliceFromHierarchy(user, segmentKey, segmentOriginal) {
    let parentSegmentPerms = user.parentSegmentPermissions || user.admin?.segmentPermissions;
    parentSegmentPerms = TradeService._segmentMapPlain(parentSegmentPerms);
    if (parentSegmentPerms && typeof parentSegmentPerms.toObject === 'function') {
      parentSegmentPerms = parentSegmentPerms.toObject();
    }
    // Log the full parentSegmentPerms for CRYPTOFUT
    if (segmentKey === 'CRYPTOFUT' && parentSegmentPerms) {
      const cryptoFutPerms = parentSegmentPerms.CRYPTOFUT || parentSegmentPerms['CRYPTOFUT'] || parentSegmentPerms.cryptofut;
      console.log(`[_sliceFromHierarchy] CRYPTOFUT parentSegmentPerms:`, JSON.stringify(cryptoFutPerms || 'not found'));
    }
    let slice = null;
    const rawSeg = segmentOriginal !== undefined ? String(segmentOriginal) : '';
    if (parentSegmentPerms instanceof Map) {
      slice =
        parentSegmentPerms.get(segmentKey) ||
        parentSegmentPerms.get(String(rawSeg).toUpperCase()) ||
        null;
      if (!slice && (segmentKey === 'FOREXFUT' || segmentKey === 'FOREXOPT')) {
        slice = parentSegmentPerms.get('FOREX');
      }
      if (!slice && (segmentKey === 'MCXFUT' || segmentKey === 'MCXOPT')) {
        slice = parentSegmentPerms.get('MCX');
      }
    } else if (parentSegmentPerms && typeof parentSegmentPerms === 'object') {
      slice =
        parentSegmentPerms[segmentKey] ||
        parentSegmentPerms[String(rawSeg).toUpperCase()] ||
        null;
      if (!slice && (segmentKey === 'FOREXFUT' || segmentKey === 'FOREXOPT')) {
        slice = parentSegmentPerms.FOREX || parentSegmentPerms.forex || null;
      }
      if (!slice && (segmentKey === 'MCXFUT' || segmentKey === 'MCXOPT')) {
        slice = parentSegmentPerms.MCX || parentSegmentPerms.mcx || null;
      }
    }
    const normalized = TradeService._normalizeSegmentSlice(slice);
    // DEBUG: Log commission from hierarchy
    if (normalized) {
      console.log('[_sliceFromHierarchy] segmentKey:', segmentKey, 'commission:', normalized.commission, 'commissionType:', normalized.commissionType);
      console.log('[_sliceFromHierarchy] cryptoStartTime:', normalized.cryptoStartTime, 'cryptoClosingTime:', normalized.cryptoClosingTime);
    }
    return normalized;
  }

/** Lowest scaffold when SystemSettings + overlays omit keys. */
static _SEGMENT_MERGE_FALLBACK = {
  enabled: true,
  quantitySettings: { breakupQuantity: 0, maxBid: 0, minExchangeQty: 0, maxExchangeQty: 0 },
  maxExchangeLots: 1000,
  commissionType: 'PER_LOT',
  commission: 0,
  commissionLot: 0,
  maxLots: 50,
  minLots: 1,
  orderLots: 10,
  exposureIntraday: 10,
  exposureCarryForward: 5,
  allowClientIntradayOnly: true,
  defaultIntradayOnly: false,
  cryptoSpreadInr: 0,
  cryptoSpreadUsdPerSide: 0,
  cryptoStartTime: '',
  cryptoClosingTime: '',
  mcxStartTime: '',
  mcxClosingTime: '',
  nseStartTime: '',
  nseClosingTime: '',
  closingTime: '',
  cryptoReferenceSymbol: '',
  cryptoPricePerLotInr: 0,
  cryptoLotSizeLots: 1,
  cryptoLotSizeQuantity: 0,
  optionBuy: { allowed: true, commissionType: 'PER_LOT', commission: 0, strikeSelection: 100, maxExchangeLots: 1000, intradayLeverage: 1, carryForwardLeverage: 1 },
  optionSell: { allowed: true, commissionType: 'PER_LOT', commission: 0, strikeSelection: 100, maxExchangeLots: 1000, intradayLeverage: 1, carryForwardLeverage: 1 },
};
  static _sliceFromUserPermissions(user, segmentKey) {
    const sp = user.segmentPermissions;
    if (!sp) return null;

    const normalizeKey = (slice) => TradeService._normalizeSegmentSlice(slice);

    if (sp instanceof Map) {
      let slice = sp.get(segmentKey);
      if (!slice && (segmentKey === 'FOREXFUT' || segmentKey === 'FOREXOPT')) slice = sp.get('FOREX');
      if (!slice && (segmentKey === 'MCXFUT' || segmentKey === 'MCXOPT')) slice = sp.get('MCX');
      const normalized = normalizeKey(slice);
      // DEBUG: Log commission from user permissions
      if (normalized) {
        console.log('[_sliceFromUserPermissions] segmentKey:', segmentKey, 'commission:', normalized.commission, 'commissionType:', normalized.commissionType);
      }
      return normalized;
    }

    const plain = sp.toObject ? sp.toObject() : sp;
    if (!plain || typeof plain !== 'object') return null;
    let slice =
      plain[segmentKey] || plain[String(segmentKey).toUpperCase()] || null;
    if (!slice && (segmentKey === 'FOREXFUT' || segmentKey === 'FOREXOPT')) {
      slice = plain.FOREX || plain.forex || null;
    }
    if (!slice && (segmentKey === 'MCXFUT' || segmentKey === 'MCXOPT')) {
      slice = plain.MCX || plain.mcx || null;
    }
    const normalized = normalizeKey(slice);
    // DEBUG: Log commission from user permissions
    if (normalized) {
      console.log('[_sliceFromUserPermissions] segmentKey:', segmentKey, 'commission:', normalized.commission, 'commissionType:', normalized.commissionType);
    }
    return normalized;
  }

  /**
   * When `explicitMap` is missing/null → undefined (legacy: apply full hierarchy/user overlay).
   * When present → per-segment string[] of field names to apply from that layer; missing segment → [].
   */
  static _explicitKeysForSegment(explicitMapMaybe, segmentKey) {
    if (explicitMapMaybe === undefined || explicitMapMaybe === null) return undefined;
    let plain = explicitMapMaybe;
    if (plain instanceof Map) plain = Object.fromEntries(plain);
    if (!plain || typeof plain !== 'object') return undefined;
    const arr = plain[segmentKey];
    if (Array.isArray(arr)) return arr;
    return [];
  }

  /**
   * Super Admin defaults (adminSegmentDefaults) → Hierarchy (parent Admin) → User.segmentPermissions.
   * exposureIntraday / exposureCarryForward: explicit `> 0` in a layer overrides; `0` keeps lower layers.
   * Optional explicit key lists: only those keys are taken from hier/user slices (unsaved fields inherit below).
   */
  static _mergeSegmentStack(
    systemSlicePlain,
    hierPlain,
    hierExplicitKeysMaybe,
    userPlain,
    userExplicitKeysMaybe,
    segmentKey = ''
  ) {
    const fb = TradeService._SEGMENT_MERGE_FALLBACK;
    let m = { ...fb, ...(systemSlicePlain && typeof systemSlicePlain === 'object' ? systemSlicePlain : {}) };

    const applyOverlay = (overlay, explicitKeysMaybe) => {
      const o = TradeService._normalizeSegmentSlice(overlay);
      if (!o) return;
      const legacyFullOverlay = explicitKeysMaybe === undefined || explicitKeysMaybe === null;
      const keysToVisit = legacyFullOverlay ? Object.keys(o) : explicitKeysMaybe;

      console.log(`[_mergeSegmentStack] applyOverlay called with keys:`, keysToVisit);
      console.log(`[_mergeSegmentStack] overlay cryptoStartTime:`, o.cryptoStartTime, 'cryptoClosingTime:', o.cryptoClosingTime);

      for (const k of keysToVisit) {
        if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
        const vv = o[k];
        if (
          k === 'cryptoStartTime' ||
          k === 'cryptoClosingTime' ||
          k === 'mcxStartTime' ||
          k === 'mcxClosingTime' ||
          k === 'nseStartTime' ||
          k === 'nseClosingTime'
        ) {
          console.log(`[_mergeSegmentStack] Processing ${k}:`, vv, 'type:', typeof vv);
          // Don't overwrite with empty strings - keep existing value from hierarchy
          if (vv === '' || vv === undefined || vv === null) {
            console.log(`[_mergeSegmentStack] Skipping ${k} - value is empty, keeping existing:`, m[k]);
            continue;
          }
        }
        if (k === 'exposureIntraday' || k === 'exposureCarryForward') {
          const num = Number(vv);
          if (Number.isFinite(num) && num > 0) {
            m[k] = num;
          }
          continue;
        }
        if ((k === 'optionBuy' || k === 'optionSell') && vv && typeof vv === 'object') {
          m[k] = { ...(m[k] || {}), ...vv };
          continue;
        }
        if (k === 'quantitySettings' && vv && typeof vv === 'object') {
          m[k] = { ...(m[k] || {}), ...vv };
          continue;
        }
        if (k === 'quantityModeSettings' && vv && typeof vv === 'object') {
          const base = m[k] && typeof m[k] === 'object' ? { ...m[k] } : {};
          // Only overwrite leverage fields if explicitly > 1 (schema default is 1)
          for (const [qk, qv] of Object.entries(vv)) {
            if ((qk === 'intradayLeverage' || qk === 'carryForwardLeverage') && Number(qv) <= 1) continue;
            if (qv !== undefined) base[qk] = qv;
          }
          m[k] = base;
          continue;
        }
        if (k === 'lotSettings' && vv && typeof vv === 'object') {
          m[k] = { ...(m[k] || {}), ...vv };
          // Map lotSettings.breakupLots to orderLots for backward compatibility
          if (vv.breakupLots !== undefined) {
            m.orderLots = vv.breakupLots;
          }
          continue;
        }
        if (vv !== undefined) {
          m[k] = vv;
        }
      }
      console.log(`[_mergeSegmentStack] After applyOverlay - m.cryptoStartTime:`, m.cryptoStartTime, 'm.cryptoClosingTime:', m.cryptoClosingTime);
    };

    applyOverlay(hierPlain, hierExplicitKeysMaybe);
    applyOverlay(userPlain, userExplicitKeysMaybe);

    // After merging, inherit commission based on commissionType
    // PER_CRORE and PER_TRADE use 'commission' field, PER_LOT uses 'commissionLot' field
    const commType = resolveSegmentCommissionType(
      m.commissionType,
      hierPlain?.commissionType,
      systemSlicePlain?.commissionType
    );
    if (commType) m.commissionType = commType;

    const userCommissionExplicit = explicitKeysTouchCommission(userExplicitKeysMaybe);
    const hierCommissionExplicit = explicitKeysTouchCommission(hierExplicitKeysMaybe);
    const userSetCommission =
      userPlain && Object.prototype.hasOwnProperty.call(userPlain, 'commission');
    const hierSetCommission =
      hierPlain && Object.prototype.hasOwnProperty.call(hierPlain, 'commission');
    const userSetCommissionLot =
      userPlain && Object.prototype.hasOwnProperty.call(userPlain, 'commissionLot');
    const hierSetCommissionLot =
      hierPlain && Object.prototype.hasOwnProperty.call(hierPlain, 'commissionLot');

    if (commType === 'PER_CRORE' || commType === 'PER_TRADE') {
      if (
        !userCommissionExplicit &&
        !hierCommissionExplicit &&
        !userSetCommission &&
        !hierSetCommission &&
        (m.commission == null || m.commission === undefined) &&
        hierPlain?.commission > 0
      ) {
        m.commission = hierPlain.commission;
        console.log('[_mergeSegmentStack] Inherited admin commission:', m.commission, 'for type:', commType);
      }
    } else if (commType === 'PER_LOT' || commType === 'PER_QUANTITY') {
      if (
        !userCommissionExplicit &&
        !hierCommissionExplicit &&
        !userSetCommissionLot &&
        !hierSetCommissionLot &&
        (m.commissionLot == null || m.commissionLot === undefined) &&
        hierPlain?.commissionLot > 0
      ) {
        m.commissionLot = hierPlain.commissionLot;
        console.log('[_mergeSegmentStack] Inherited admin commissionLot:', m.commissionLot, 'for type:', commType);
      }
    }

    const ei = Number(m.exposureIntraday);
    const ec = Number(m.exposureCarryForward);
    if (!Number.isFinite(ei) || ei <= 0) m.exposureIntraday = fb.exposureIntraday;
    if (!Number.isFinite(ec) || ec <= 0) m.exposureCarryForward = fb.exposureCarryForward;

    return m;
  }

  /**
   * Precedence: scaffold → SystemSettings.adminSegmentDefaults[segment] → Hierarchy → User.segmentPermissions.
   * Instrument Rules still merged in margin/order paths via applyInstrumentExposureOverrides().
   */
  static async getUserSegmentSettings(user, segment, instrumentType) {
    const segmentKey = TradeService.resolveMarketWatchSegmentKey(segment, instrumentType);
    const sysRaw = await SystemSettings.getSettings();
    const adm = TradeService._segmentMapPlain(sysRaw?.adminSegmentDefaults);
    const systemSlicePlain = TradeService._normalizeSegmentSlice(adm[segmentKey]);

    const hierSlice = TradeService._sliceFromHierarchy(user, segmentKey, segment);
    const userSlice = TradeService._sliceFromUserPermissions(user, segmentKey);

    console.log('[getUserSegmentSettings] DEBUG - segmentKey:', segmentKey);
    console.log('[getUserSegmentSettings] DEBUG - systemSlicePlain commission:', systemSlicePlain?.commission, 'commissionType:', systemSlicePlain?.commissionType);
    console.log('[getUserSegmentSettings] DEBUG - hierSlice commission:', hierSlice?.commission, 'commissionType:', hierSlice?.commissionType);
    console.log('[getUserSegmentSettings] DEBUG - userSlice commission:', userSlice?.commission, 'commissionType:', userSlice?.commissionType);
    console.log('[getUserSegmentSettings] DEBUG - user.admin:', user.admin?.name, 'user.admin.segmentPermissions:', user.admin?.segmentPermissions ? Object.keys(user.admin.segmentPermissions) : 'none');

    const hierExplicitArr = TradeService._explicitKeysForSegment(user.admin?.segmentExplicitKeys, segmentKey);
    const userExplicitArr = TradeService._explicitKeysForSegment(user.segmentExplicitKeys, segmentKey);

    let result = TradeService._mergeSegmentStack(
      systemSlicePlain,
      hierSlice,
      hierExplicitArr,
      userSlice,
      userExplicitArr,
      segmentKey
    );

    // Fallback: if result is empty or disabled, ensure SystemSettings defaults are applied
    // This is the proper dynamic fallback (not hardcoded values)
    const hasBrokerage =
      (result?.commission != null && result.commission !== '') ||
      (result?.commissionLot != null && result.commissionLot !== '');
    if (!result || (!result.enabled && !hasBrokerage)) {
      if (systemSlicePlain) {
        result = { ...systemSlicePlain, ...result };
        console.log('[getUserSegmentSettings] Using SystemSettings defaults as fallback for segment:', segmentKey, 'systemSlicePlain:', systemSlicePlain);
      }
    }

    // For crypto segments: ALWAYS use CRYPTOFUT timing from SystemSettings
    // This ensures Super Admin's timing setting is the single source of truth
    const isCrypto = ['CRYPTOFUT', 'CRYPTOOPT'].includes(String(segmentKey || '').toUpperCase());
    if (isCrypto) {
      // Always read CRYPTOFUT timing from SystemSettings (not from hierarchy/user explicit keys)
      const cryptoFutSystem = TradeService._normalizeSegmentSlice(adm['CRYPTOFUT']);
      const sysStart = (cryptoFutSystem?.cryptoStartTime || '').toString().trim();
      const sysClose = (cryptoFutSystem?.cryptoClosingTime || '').toString().trim();
      if (sysStart) result.cryptoStartTime = sysStart;
      if (sysClose) result.cryptoClosingTime = sysClose;
      console.log(`[getUserSegmentSettings] Crypto timing override from SystemSettings CRYPTOFUT: start=${sysStart}, close=${sysClose}`);
    }

    // MCX: always inherit session timing from parent admin MCXFUT (Ram → users), not blocked by segmentExplicitKeys
    const segUpper = String(segmentKey || '').toUpperCase();
    if (segUpper === 'MCXFUT' || segUpper === 'MCXOPT' || segUpper === 'MCX') {
      const mcxFutSystem = TradeService._normalizeSegmentSlice(adm.MCXFUT || adm.MCX);
      const hierMcx =
        TradeService._sliceFromHierarchy(user, 'MCXFUT', segment) ||
        TradeService._sliceFromHierarchy(user, 'MCX', segment);
      let start = String(
        hierMcx?.mcxStartTime ||
          hierMcx?.startTime ||
          mcxFutSystem?.mcxStartTime ||
          mcxFutSystem?.startTime ||
          ''
      ).trim();
      let close = String(
        hierMcx?.mcxClosingTime ||
          hierMcx?.closingTime ||
          mcxFutSystem?.mcxClosingTime ||
          mcxFutSystem?.closingTime ||
          ''
      ).trim();

      if (!start || !close) {
        const { resolveMcxTimingFromAdminChain } = await import('../utils/mcxSessionTiming.js');
        const chainTiming = await resolveMcxTimingFromAdminChain(user);
        if (!start) start = chainTiming.mcxStartTime || '';
        if (!close) close = chainTiming.mcxClosingTime || '';
      }

      if (start) result.mcxStartTime = start;
      if (close) {
        result.mcxClosingTime = close;
        if (!String(result.closingTime || '').trim()) result.closingTime = close;
      }
      console.log(
        `[getUserSegmentSettings] MCX timing for ${segmentKey}: start=${start}, close=${close} (parent admin slice)`
      );
    }

    // NSE/BSE: inherit session timing from parent admin NSEFUT (same pattern as MCX)
    if (
      segUpper === 'NSEFUT' ||
      segUpper === 'NSEOPT' ||
      segUpper === 'NSE-EQ' ||
      segUpper === 'BSE-FUT' ||
      segUpper === 'BSE-OPT' ||
      segUpper === 'FNO' ||
      segUpper === 'EQUITY'
    ) {
      const nseFutSystem = TradeService._normalizeSegmentSlice(
        adm.NSEFUT || adm['NSE-EQ'] || adm.FNO
      );
      const hierNse =
        TradeService._sliceFromHierarchy(user, 'NSEFUT', segment) ||
        TradeService._sliceFromHierarchy(user, 'NSE-EQ', segment);
      let nseStart = String(
        hierNse?.nseStartTime ||
          hierNse?.startTime ||
          nseFutSystem?.nseStartTime ||
          nseFutSystem?.startTime ||
          ''
      ).trim();
      let nseClose = String(
        hierNse?.nseClosingTime ||
          hierNse?.closingTime ||
          nseFutSystem?.nseClosingTime ||
          nseFutSystem?.closingTime ||
          ''
      ).trim();

      if (!nseStart || !nseClose) {
        const { resolveNseBseTimingFromAdminChain } = await import('../utils/nseBseSessionTiming.js');
        const chainTiming = await resolveNseBseTimingFromAdminChain(user);
        if (!nseStart) nseStart = chainTiming.nseStartTime || '';
        if (!nseClose) nseClose = chainTiming.nseClosingTime || '';
      }

      if (nseStart) result.nseStartTime = nseStart;
      if (nseClose) {
        result.nseClosingTime = nseClose;
        if (!String(result.closingTime || '').trim()) result.closingTime = nseClose;
      }
      console.log(
        `[getUserSegmentSettings] NSE/BSE timing for ${segmentKey}: start=${nseStart}, close=${nseClose}`
      );
    }

    // Inherit commission from SystemSettings only when user/admin did not explicitly set brokerage
    if (result && systemSlicePlain) {
      const commType = resolveSegmentCommissionType(
        result.commissionType,
        systemSlicePlain.commissionType
      );
      if (commType && !result.commissionType) result.commissionType = commType;

      const userCommissionExplicit = explicitKeysTouchCommission(userExplicitArr);
      const hierCommissionExplicit = explicitKeysTouchCommission(hierExplicitArr);

      if (
        (commType === 'PER_CRORE' || commType === 'PER_TRADE') &&
        !userCommissionExplicit &&
        !hierCommissionExplicit &&
        (result.commission == null || result.commission === undefined) &&
        systemSlicePlain.commission > 0
      ) {
        result.commission = systemSlicePlain.commission;
      }
      if (
        (commType === 'PER_LOT' || commType === 'PER_QUANTITY' || !commType) &&
        !userCommissionExplicit &&
        !hierCommissionExplicit &&
        (result.commissionLot == null || result.commissionLot === undefined) &&
        systemSlicePlain.commissionLot > 0
      ) {
        result.commissionLot = systemSlicePlain.commissionLot;
      }
    }

    console.log('[getUserSegmentSettings] Final result for segment:', segmentKey, {
      enabled: result?.enabled,
      commission: result?.commission,
      commissionType: result?.commissionType,
      commissionLot: result?.commissionLot
    });
    return result || {};
  }
  
  // Get user's script-specific settings
  static getUserScriptSettings(user, symbol, category) {
    if (!user.scriptSettings) return null;
    
    // Handle Mongoose Map - convert to plain object first if needed
    let scriptPerms = user.scriptSettings;
    if (scriptPerms && typeof scriptPerms.toObject === 'function') {
      scriptPerms = scriptPerms.toObject();
    }
    
    // Try multiple lookup keys in order of priority
    const lookupKeys = [];
    
    // 1. Category (e.g., "COPPER", "GOLD") - most reliable for MCX
    if (category) {
      lookupKeys.push(category.toUpperCase());
      lookupKeys.push(category);
    }
    
    // 2. Symbol as-is (e.g., "COPPER", "NIFTY25JANFUT")
    if (symbol) {
      lookupKeys.push(symbol.toUpperCase());
      lookupKeys.push(symbol);
      
      // 3. Extract base symbol from F&O format
      const baseSymbol = symbol.replace(/\d+[A-Z]{3}\d*FUT$/i, '')
                               .replace(/\d+[A-Z]{3}\d+[CP]E$/i, '')
                               .replace(/\d+$/i, '');
      if (baseSymbol && baseSymbol !== symbol) {
        lookupKeys.push(baseSymbol.toUpperCase());
        lookupKeys.push(baseSymbol);
      }
    }
    
    // Try each key until we find settings
    const isMap = scriptPerms instanceof Map;
    for (const key of lookupKeys) {
      let settings = isMap ? scriptPerms.get(key) : scriptPerms[key];
      if (settings) {
        // Convert nested Map/Object if needed
        if (settings && typeof settings.toObject === 'function') {
          settings = settings.toObject();
        }
        return settings;
      }
    }

    return null;
  }

  static _numOrNull(v) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  /** Merge numeric maps: user values win when set (>= 0). */
  static _mergeNumericMap(instMap, userMap, keys) {
    const out = {};
    for (const k of keys) {
      const u = userMap ? this._numOrNull(userMap[k]) : null;
      const i = instMap ? this._numOrNull(instMap[k]) : null;
      if (u != null) out[k] = u;
      else if (i != null) out[k] = i;
    }
    return Object.keys(out).length ? out : null;
  }

  static _BROKERAGE_KEYS = [
    'intradayFuture',
    'carryFuture',
    'optionBuyIntraday',
    'optionBuyCarry',
    'optionSellIntraday',
    'optionSellCarry',
  ];

  static _FIXED_MARGIN_KEYS = [
    'intradayFuture',
    'carryFuture',
    'optionBuyIntraday',
    'optionBuyCarry',
    'optionSellIntraday',
    'optionSellCarry',
  ];

  static _LOT_KEYS = ['maxLots', 'minLots', 'perOrderLots'];

  /**
   * Instrument catalog defaults → same shape as user scriptSettings (partial).
   * Only used when tradingDefaults.enabled is true.
   */
  static instrumentTradingToScriptLayer(inst) {
    if (!inst?.tradingDefaults?.enabled) return null;
    const td = inst.tradingDefaults;
    const layer = {};
    const br = this._mergeNumericMap(td.brokerage, null, this._BROKERAGE_KEYS);
    if (br) layer.brokerage = br;
    const fm = this._mergeNumericMap(td.fixedMargin, null, this._FIXED_MARGIN_KEYS);
    if (fm) layer.fixedMargin = fm;
    const ls = this._mergeNumericMap(td.lotSettings, null, this._LOT_KEYS);
    if (ls) layer.lotSettings = ls;
    const buy = this._numOrNull(td.spread?.buy);
    const sell = this._numOrNull(td.spread?.sell);
    if (buy != null || sell != null) {
      layer.spread = { buy: buy ?? 0, sell: sell ?? 0 };
    }
    return Object.keys(layer).length ? layer : {};
  }

  /**
   * Merge instrument defaults (base) with user scriptSettings (override).
   */
  static mergeScriptSettingsWithInstrument(instrument, userScriptSettings) {
    const inst = instrument && typeof instrument.toObject === 'function' ? instrument.toObject() : instrument;
    const base = this.instrumentTradingToScriptLayer(inst);
    if (!base) return userScriptSettings || null;
    const user = userScriptSettings || {};
    const merged = {
      ...base,
      ...user,
      brokerage: this._mergeNumericMap(base.brokerage, user.brokerage, this._BROKERAGE_KEYS),
      fixedMargin: this._mergeNumericMap(base.fixedMargin, user.fixedMargin, this._FIXED_MARGIN_KEYS),
      lotSettings: this._mergeNumericMap(base.lotSettings, user.lotSettings, this._LOT_KEYS),
      spread:
        user.spread && (user.spread.buy != null || user.spread.sell != null)
          ? user.spread
          : base.spread,
    };
    if (user.blocked === true) merged.blocked = true;
    if (!merged.brokerage) delete merged.brokerage;
    if (!merged.fixedMargin) delete merged.fixedMargin;
    if (!merged.lotSettings) delete merged.lotSettings;
    if (!merged.spread) delete merged.spread;
    return merged;
  }

  /** Apply instrument tradingDefaults (segmentProfile + legacy exposure) onto segment settings. */
  static applyInstrumentExposureOverrides(instrument, segmentSettings) {
    const inst = instrument && typeof instrument.toObject === 'function' ? instrument.toObject() : instrument;
    if (!inst?.tradingDefaults?.enabled || !segmentSettings) return segmentSettings;
    const td = inst.tradingDefaults;
    const sp = td.segmentProfile;
    let out = { ...segmentSettings };
    if (sp && typeof sp === 'object') {
      out = { ...out, ...sp };
      if (sp.lotSettings && typeof sp.lotSettings === 'object') {
        out.lotSettings = { ...(out.lotSettings || {}), ...sp.lotSettings };
      }
      if (sp.quantityModeSettings && typeof sp.quantityModeSettings === 'object') {
        out.quantityModeSettings = { ...(out.quantityModeSettings || {}), ...sp.quantityModeSettings };
      }
      if (sp.optionBuy && typeof sp.optionBuy === 'object') {
        out.optionBuy = { ...(out.optionBuy || {}), ...sp.optionBuy };
      }
      if (sp.optionSell && typeof sp.optionSell === 'object') {
        out.optionSell = { ...(out.optionSell || {}), ...sp.optionSell };
      }
    }
    const ei = this._numOrNull(td.exposureIntraday);
    const ec = this._numOrNull(td.exposureCarryForward);
    if (ei != null && ei > 0) out.exposureIntraday = ei;
    if (ec != null && ec > 0) out.exposureCarryForward = ec;
    return out;
  }

  /** Cap requested leverage by per-instrument max (MIS vs carry). */
  static capLeverageFromInstrument(instrument, requestedLeverage, isIntraday, isOptionBuy, options = {}) {
    const { allowOptionBuyLeverage = false } = options;
    if (isOptionBuy && !allowOptionBuyLeverage) return 1;
    const inst = instrument && typeof instrument.toObject === 'function' ? instrument.toObject() : instrument;
    if (!inst?.tradingDefaults?.enabled) return Math.max(1, Number(requestedLeverage) || 1);
    const td = inst.tradingDefaults;
    const cap = isIntraday ? this._numOrNull(td.maxIntradayLeverage) : this._numOrNull(td.maxCarryLeverage);
    const req = Math.max(1, Number(requestedLeverage) || 1);
    if (cap != null && cap > 0) return Math.min(req, cap);
    return req;
  }

  /**
   * Extra commission from instrument.additionalCharges (per trade / per lot / per crore,  or %).
   * Applied after script/segment brokerage.
   * Legacy: if per*Enabled flags are absent, any positive numeric field applies (Stockex coins), same as before.
   */
  static instrumentAdditionalCommission(instrument, lots = 1, tradeValueInr = 0) {
    const inst = instrument && typeof instrument.toObject === 'function' ? instrument.toObject() : instrument;
    if (!inst?.tradingDefaults?.enabled) return 0;
    const ch = inst.tradingDefaults.additionalCharges;
    if (!ch) return 0;
    const nLots = Math.max(1, Number(lots) || 1);
    const T = Math.max(0, Number(tradeValueInr) || 0);
    const pt = Number(ch.perTradeInr);
    const pl = Number(ch.perLotInr);
    const pc = Number(ch.perCroreInr);

    const legacyMode =
      ch.perTradeEnabled == null && ch.perLotEnabled == null && ch.perCroreEnabled == null;

    if (legacyMode) {
      let add = 0;
      if (Number.isFinite(pt) && pt > 0) add += pt;
      if (Number.isFinite(pl) && pl > 0) add += pl * nLots;
      if (Number.isFinite(pc) && pc > 0 && T > 0) add += (T / 10_000_000) * pc;
      return Math.round(add * 100) / 100;
    }

    const explicitLineUnits = ['perTradeUnit', 'perLotUnit', 'perCroreUnit'].some(
      (k) => ch[k] === 'INR' || ch[k] === 'PERCENT'
    );
    const ptOn = !!ch.perTradeEnabled;
    const plOn = !!ch.perLotEnabled;
    const pcOn = !!ch.perCroreEnabled;
    const anyToggleOn = ptOn || plOn || pcOn;
    const hasPositiveConfiguredValue =
      (Number.isFinite(pt) && pt > 0) ||
      (Number.isFinite(pl) && pl > 0) ||
      (Number.isFinite(pc) && pc > 0);

    // Safety fallback:
    // Some instrument rows carry numeric charge values but toggles are false/absent due to old UI saves.
    // In that case, treat as legacy numeric config instead of silently returning 0.
    if (!legacyMode && !anyToggleOn && hasPositiveConfiguredValue) {
      let add = 0;
      if (Number.isFinite(pt) && pt > 0) add += pt;
      if (Number.isFinite(pl) && pl > 0) add += pl * nLots;
      if (Number.isFinite(pc) && pc > 0 && T > 0) add += (T / 10_000_000) * pc;
      return Math.round(add * 100) / 100;
    }

    if (explicitLineUnits) {
      const ptU = ch.perTradeUnit === 'PERCENT' ? 'PERCENT' : 'INR';
      const plU = ch.perLotUnit === 'PERCENT' ? 'PERCENT' : 'INR';
      const pcU = ch.perCroreUnit === 'PERCENT' ? 'PERCENT' : 'INR';
      let add = 0;
      if (ptOn && Number.isFinite(pt) && pt > 0) add += ptU === 'PERCENT' ? T * (pt / 100) : pt;
      if (plOn && Number.isFinite(pl) && pl > 0) add += plU === 'PERCENT' ? T * (pl / 100) * nLots : pl * nLots;
      if (pcOn && Number.isFinite(pc) && pc > 0 && T > 0) {
        add += pcU === 'PERCENT' ? T * (pc / 100) : (T / 10_000_000) * pc;
      }
      return Math.round(add * 100) / 100;
    }

    const usePercent = ch.extraCommissionUnit === 'PERCENT';
    let add = 0;
    if (usePercent) {
      if (ptOn && Number.isFinite(pt) && pt > 0) add += T * (pt / 100);
      if (plOn && Number.isFinite(pl) && pl > 0) add += T * (pl / 100) * nLots;
      if (pcOn && Number.isFinite(pc) && pc > 0 && T > 0) add += T * (pc / 100);
    } else {
      if (ptOn && Number.isFinite(pt) && pt > 0) add += pt;
      if (plOn && Number.isFinite(pl) && pl > 0) add += pl * nLots;
      if (pcOn && Number.isFinite(pc) && pc > 0 && T > 0) add += (T / 10_000_000) * pc;
    }
    return Math.round(add * 100) / 100;
  }
  
  /** Turnover for PER_CRORE brokerage (price × qty). */
  static tradeTurnoverForBrokerage(tradeData, lots) {
    const price = Number(tradeData.price || tradeData.entryPrice) || 0;
    const lotSize = Math.max(1, Number(tradeData.lotSize) || 1);
    const orderQty =
      tradeData.quantity != null && Number.isFinite(Number(tradeData.quantity)) && Number(tradeData.quantity) > 0
        ? Number(tradeData.quantity)
        : Math.max(0, Number(lots) || 0) * lotSize;
    return price * orderQty;
  }

  // Calculate brokerage based on user settings with caps enforcement
  static async calculateUserBrokerage(segmentSettings, scriptSettings, tradeData, lots, brokerageCaps = null) {
    const franchiseRatePerCrore = Number(tradeData.franchiseRatePerCrore);
    if (franchiseRatePerCrore > 0) {
      const turnover = TradeService.tradeTurnoverForBrokerage(tradeData, lots);
      const inr = perCroreRateToInr(franchiseRatePerCrore, turnover);
      console.log('[calculateUserBrokerage] Franchise override PER_CRORE:', {
        franchiseRatePerCrore,
        turnover,
        inr,
      });
      return inr;
    }

    console.log('[calculateUserBrokerage] Raw tradeData:', {
      segment: tradeData.segment,
      exchange: tradeData.exchange,
      isCrypto: tradeData.isCrypto,
      isForex: tradeData.isForex,
      instrumentType: tradeData.instrumentType
    });
    
    // Infer segment from exchange if not provided
    if (!tradeData.segment) {
      const isMcx = this.isMcxTrade(null, tradeData.exchange);
      if (isMcx) {
        tradeData.segment = tradeData.instrumentType === 'OPTIONS' ? 'MCXOPT' : 'MCXFUT';
        console.log('[calculateUserBrokerage] Inferred segment as MCXFUT/MCXOPT');
      } else if (tradeData.exchange === 'BINANCE' || tradeData.isCrypto) {
        tradeData.segment = tradeData.instrumentType === 'OPTIONS' ? 'CRYPTOOPT' : 'CRYPTOFUT';
        console.log('[calculateUserBrokerage] Inferred segment as CRYPTOFUT/CRYPTOOPT');
      } else if (tradeData.exchange === 'FOREX' || tradeData.isForex) {
        tradeData.segment = tradeData.instrumentType === 'OPTIONS' ? 'FOREXOPT' : 'FOREXFUT';
        console.log('[calculateUserBrokerage] Inferred segment as FOREXFUT/FOREXOPT');
      }
    } else {
        console.log('[calculateUserBrokerage] Could not infer segment - exchange:', tradeData.exchange, 'isCrypto:', tradeData.isCrypto);
      }
    
    console.log('[calculateUserBrokerage] Input:', {
      segment: tradeData.segment,
      symbol: tradeData.symbol,
      lots: lots,
      segmentSettingsEnabled: segmentSettings?.enabled,
      segmentSettingsBrokerage: segmentSettings?.commission,
      segmentSettingsCommissionType: segmentSettings?.commissionType,
      scriptSettingsBrokerage: scriptSettings?.brokerage,
      brokerageCaps: brokerageCaps
    });

    let hasBrokerageSetting =
      (segmentSettings?.commission != null && segmentSettings.commission !== '') ||
      (segmentSettings?.commissionLot != null && segmentSettings.commissionLot !== '');
    // Fallback: if segmentSettings is empty or has no commission, try SystemSettings
    if (!segmentSettings || (!segmentSettings.enabled && !hasBrokerageSetting)) {
      const sysRaw = await SystemSettings.getSettings();
      const admDefaults = TradeService._segmentMapPlain(sysRaw?.adminSegmentDefaults);
      const segmentKey = TradeService.resolveMarketWatchSegmentKey(tradeData.segment, tradeData.instrumentType);
      const sysSlice = admDefaults[segmentKey];
      if (sysSlice) {
        segmentSettings = { ...sysSlice, ...segmentSettings };
        console.log('[calculateUserBrokerage] Using SystemSettings defaults for segment:', segmentKey, 'sysSlice:', sysSlice);
        hasBrokerageSetting =
          (segmentSettings?.commission != null && segmentSettings.commission !== '') ||
          (segmentSettings?.commissionLot != null && segmentSettings.commissionLot !== '');
      }
    }

    let brokerage = 0;
    let commissionType = 'PER_LOT'; // Track commission type for cap enforcement
    const isIntraday = tradeData.productType === 'MIS' || tradeData.productType === 'INTRADAY';
    const isOption = tradeData.instrumentType === 'OPTIONS';
    const isOptionBuy = isOption && tradeData.side === 'BUY';
    const isOptionSell = isOption && tradeData.side === 'SELL';

    const price = tradeData.price || tradeData.entryPrice || 0;
    const lotSize = Math.max(1, Number(tradeData.lotSize) || 1);
    const isCryptoTurnover =
      tradeData.isCrypto || tradeData.exchange === 'BINANCE' ||
      ['FOREX', 'FOREXFUT', 'FOREXOPT'].includes(String(tradeData.segment || '').toUpperCase()) || tradeData.isForex || tradeData.exchange === 'FOREX';
    // NSE/BSE send qty in `quantity`; `lots` arg may be qty — never multiply qty × lotSize × price twice
    const orderQty =
      tradeData.quantity != null && Number.isFinite(Number(tradeData.quantity)) && Number(tradeData.quantity) > 0
        ? Number(tradeData.quantity)
        : Math.max(0, Number(lots) || 0) * lotSize;
    const exchangeLots = Math.max(Number(lots) || 0, orderQty / lotSize);
    const turnover = price * orderQty;
    const ONE_CRORE = 10_000_000;

    /**
     * @param {'PER_LOT'|'PER_QUANTITY'|'PER_TRADE'|'PER_CRORE'} commType
     * @param {number} commission — always in  (per lot/qty, per trade, or per crore turnover)
     */
    const calcBrokerage = (commType, commission) => {
      commissionType = commType; // Store for cap enforcement
      if (commType === 'PER_LOT') return commission * exchangeLots;
      if (commType === 'PER_QUANTITY') return commission * orderQty;
      if (commType === 'PER_TRADE') return commission;
      if (commType === 'PER_CRORE') return (turnover / ONE_CRORE) * commission;
      return commission * exchangeLots;
    };
    
    // First check script-specific settings (only when explicitly > 0), else fall back to segment settings.
    const scriptBr = scriptSettings?.brokerage;
    let scriptLegBrokerage = 0;
    if (scriptBr) {
      if (isOptionBuy) {
        scriptLegBrokerage = Number(isIntraday ? scriptBr.optionBuyIntraday : scriptBr.optionBuyCarry) || 0;
      } else if (isOptionSell) {
        scriptLegBrokerage = Number(isIntraday ? scriptBr.optionSellIntraday : scriptBr.optionSellCarry) || 0;
      } else {
        scriptLegBrokerage = Number(isIntraday ? scriptBr.intradayFuture : scriptBr.carryFuture) || 0;
      }
    }
    if (scriptLegBrokerage > 0) {
      commissionType = 'PER_LOT'; // Script settings are per lot
      brokerage = scriptLegBrokerage * exchangeLots;
    } else {
      // Fall back to segment settings
      if (isOptionBuy && segmentSettings?.optionBuy) {
        const ob = segmentSettings.optionBuy;
        const commType = ob.commissionType || 'PER_LOT';
        const commission =
          commType === 'PER_CRORE' || commType === 'PER_TRADE'
            ? Number(ob.commission ?? ob.commissionLot ?? 0)
            : Number(ob.commissionLot ?? ob.commission ?? 0);
        brokerage = calcBrokerage(commType, commission);
      } else if (isOptionSell && segmentSettings?.optionSell) {
        const os = segmentSettings.optionSell;
        const commType = os.commissionType || 'PER_LOT';
        const commission =
          commType === 'PER_CRORE' || commType === 'PER_TRADE'
            ? Number(os.commission ?? os.commissionLot ?? 0)
            : Number(os.commissionLot ?? os.commission ?? 0);
        brokerage = calcBrokerage(commType, commission);
      } else {
        const commType = segmentSettings?.commissionType || 'PER_LOT';
        // Use commission field for PER_CRORE, commissionLot for PER_LOT/PER_QUANTITY/PER_TRADE
        const commission =
          commType === 'PER_CRORE' || commType === 'PER_TRADE'
            ? Number(segmentSettings?.commission ?? segmentSettings?.commissionLot ?? 0)
            : Number(segmentSettings?.commissionLot ?? segmentSettings?.commission ?? 0);
        brokerage = calcBrokerage(commType, commission);
      }
    }
    
    // Apply brokerage caps from parent admin if set
    if (brokerageCaps) {
      let minCap = 0;
      let maxCap = Infinity;
      
      // Get caps based on commission type
      if (commissionType === 'PER_LOT' && brokerageCaps.perLot) {
        // For per-lot, caps are per lot - so multiply by lots
        minCap = (brokerageCaps.perLot.min || 0) * lots;
        maxCap = (brokerageCaps.perLot.max || Infinity) * lots;
      } else if (commissionType === 'PER_CRORE' && brokerageCaps.perCrore) {
      }
    }

    console.log('[calculateUserBrokerage] Output:', {
      finalBrokerage: brokerage,
      commissionType: commissionType,
      turnover: turnover,
      crores: turnover / 10000000
    });
    
    return brokerage;
  }
  
  /** Spread disabled platform-wide — entry/exit use raw bid/ask only. */
  static calculateUserSpread(_scriptSettings, _side) {
    return 0;
  }

  /** Spread disabled platform-wide — no crypto/forex quote widening. */
  static segmentCryptoSpreadHalfUsd(_segmentSettings) {
    return 0;
  }

  /**
   * CRYPTOFUT / CRYPTOOPT: broker defines "reference lots" and total base quantity for that many lots.
   * Returns quantity per 1 lot (lot size), or null if unset / invalid.
   */
  static segmentCryptoLotSizePerUnitLot(segmentSettings) {
    if (!segmentSettings || typeof segmentSettings !== 'object') return null;
    const refLots = Number(segmentSettings.cryptoLotSizeLots);
    const refQty = Number(segmentSettings.cryptoLotSizeQuantity);
    if (!Number.isFinite(refLots) || refLots <= 0) return null;
    if (!Number.isFinite(refQty) || refQty <= 0) return null;
    const per = refQty / refLots;
    return Number.isFinite(per) && per > 0 ? per : null;
  }
  
  // Open a new trade
  static async openTrade(tradeData, userId) {
    // Infer segment from exchange if not provided
    if (!tradeData.segment) {
      const isMcx = this.isMcxTrade(null, tradeData.exchange);
      if (isMcx) {
        tradeData.segment = tradeData.instrumentType === 'OPTIONS' ? 'MCXOPT' : 'MCXFUT';
      } else if (tradeData.exchange === 'BINANCE' || tradeData.isCrypto) {
        tradeData.segment = tradeData.instrumentType === 'OPTIONS' ? 'CRYPTOOPT' : 'CRYPTOFUT';
      } else if (tradeData.exchange === 'FOREX' || tradeData.isForex) {
        tradeData.segment = tradeData.instrumentType === 'OPTIONS' ? 'FOREXOPT' : 'FOREXFUT';
      }
    }
    
    console.log('[TradeService.openTrade] Segment inference:', {
      originalSegment: tradeData.segment,
      exchange: tradeData.exchange,
      isCrypto: tradeData.isCrypto,
      isForex: tradeData.isForex,
      instrumentType: tradeData.instrumentType,
      finalSegment: tradeData.segment
    });
    
    // 1. Check market status (CRYPTO is always open)
    await this.checkMarketOpen(tradeData.segment);
    
    // 2. Get user and admin
    const user = await User.findById(userId).populate('admin');
    if (!user) throw new Error('User not found');
    
    const admin = await Admin.findOne({ adminCode: user.adminCode });
    if (!admin) throw new Error('Admin not found');
    
    // Attach parent admin's segment permissions to user for permission checks
    if (user.admin?.segmentPermissions) {
      user.parentSegmentPermissions = user.admin.segmentPermissions;
    }
    
    // Ensure user.admin is populated for getUserSegmentSettings
    if (!user.admin) {
      user.admin = admin;
    }
    
    // 3. Get user's segment and script settings
    let segmentSettings = await this.getUserSegmentSettings(user, tradeData.segment, tradeData.instrumentType);
    segmentSettings = await this.mergeUsdSpotSpreadFromSuperAdmin(segmentSettings, tradeData);
    const orInst = [];
    if (tradeData.token) orInst.push({ token: tradeData.token.toString() });
    if (tradeData.symbol && tradeData.exchange) {
      orInst.push({ symbol: tradeData.symbol, exchange: tradeData.exchange });
    }
    const instrumentDoc = orInst.length
      ? await Instrument.findOne({ $or: orInst })
          .select('lotSize tradingDefaults symbol exchange token')
          .lean()
      : null;

    if (instrumentDoc?.tradingDefaults?.enabled && instrumentDoc.tradingDefaults.blockTrading) {
      throw new Error(
        `Trading in ${tradeData.symbol} is disabled for this contract (instrument settings).`
      );
    }

    segmentSettings = TradeService.applyInstrumentExposureOverrides(instrumentDoc, segmentSettings);

    const rawScriptSettings = this.getUserScriptSettings(user, tradeData.symbol, tradeData.category);
    const scriptSettings = this.mergeScriptSettingsWithInstrument(instrumentDoc, rawScriptSettings);

    const walletField = WalletService.getWalletFieldFromTrade({
      isCrypto: tradeData.isCrypto,
      isForex: tradeData.isForex,
      exchange: tradeData.exchange,
      segment: tradeData.segment,
    });
    const { assertLedgerAutosquareAllowsNewOrder } = await import('./ledgerAutosquareService.js');
    await assertLedgerAutosquareAllowsNewOrder(userId, walletField, {
      segment: tradeData.segment,
      segmentSettings,
      user,
    });

    // 4. Validate segment is enabled for user
    // For crypto/forex, skip enabled check if segmentSettings is null or not explicitly set
    const isCryptoOrForex = tradeData.isCrypto || tradeData.exchange === 'BINANCE' ||
      ['FOREX', 'FOREXFUT', 'FOREXOPT'].includes(String(tradeData.segment || '').toUpperCase()) ||
      tradeData.isForex || tradeData.exchange === 'FOREX';
    if (!isCryptoOrForex && !segmentSettings.enabled) {
      throw new Error(`Trading in ${tradeData.segment} segment is not enabled for your account`);
    }
    // For crypto/forex, if segmentSettings exists but is not enabled, still allow trading with default settings
    if (isCryptoOrForex && (!segmentSettings || !segmentSettings.enabled)) {
      console.log(`[placeOrder] Crypto/forex segment ${tradeData.segment} not explicitly enabled, using default settings`);
      // Don't throw error for crypto/forex
    }

    await this.assertCryptoSegmentTradingWindowOpen(user, segmentSettings, tradeData.segment);
    
    // 5. Check if script is blocked
    if (scriptSettings?.blocked) {
      throw new Error(`Trading in ${tradeData.symbol} is blocked for your account`);
    }
    
    // 6. Get leverage from admin charges / hierarchy option buy-sell blocks
    let leverage = 1;
    const isCrypto = tradeData.isCrypto;
    const isForex = ['FOREX', 'FOREXFUT', 'FOREXOPT'].includes(String(tradeData.segment || '').toUpperCase()) || tradeData.isForex || tradeData.exchange === 'FOREX';
    const isOptionBuy = tradeData.instrumentType === 'OPTIONS' && tradeData.side === 'BUY';
    const isIntradayProduct = tradeData.productType === 'MIS' || tradeData.productType === 'INTRADAY';
    const hierarchySegKey = TradeService.resolveMarketWatchSegmentKey(tradeData.segment, tradeData.instrumentType);
    const isOptionsOnOptSegment =
      tradeData.instrumentType === 'OPTIONS' && TradeService.segmentHasOptionSideLeverage(hierarchySegKey);
    const segmentSettingsForOptionLev = TradeService.applyInstrumentExposureOverrides(instrumentDoc, segmentSettings);
    const optionSideLeverage = isOptionsOnOptSegment
      ? TradeService.resolveOptionSideLeverage(hierarchySegKey, segmentSettingsForOptionLev, {
          isOptionBuy,
          isIntraday: isIntradayProduct,
        })
      : null;
    if (optionSideLeverage != null) {
      leverage = optionSideLeverage;
    }

    if (!isOptionBuy && isIntradayProduct && optionSideLeverage == null) {
      if (tradeData.segment === 'EQUITY') {
        leverage = admin.charges?.intradayLeverage || 5;
      } else if (tradeData.instrumentType === 'FUTURES') {
        leverage = admin.charges?.futuresLeverage || 1;
      } else if (tradeData.instrumentType === 'OPTIONS') {
        leverage = admin.charges?.optionSellLeverage || 1;
      } else if (isCrypto) {
        // For crypto, use segment settings leverage instead of admin.charges.cryptoLeverage
        // This matches margin preview logic and ensures correct 500x leverage
        const segU = String(tradeData.segment || '').toUpperCase();
        const segmentSettings = await this.getUserSegmentSettings(tradeData.userId, segU);
        console.log('[OrderPlacement Crypto] Segment settings:', {
          segU,
          segmentSettings: segmentSettings ? 'found' : 'not found',
          quantityModeSettings: segmentSettings?.quantityModeSettings,
          lotSettings: segmentSettings?.lotSettings
        });
        if (segmentSettings) {
          const candidates = [
            segmentSettings.quantityModeSettings?.intradayLeverage,
            segmentSettings.lotSettings?.intradayLeverage,
            segmentSettings.exposureIntraday,
            segmentSettings.intradayLeverage
          ];
          console.log('[OrderPlacement Crypto] Leverage candidates:', candidates);
          for (const v of candidates) {
            const n = Number(v);
            if (Number.isFinite(n) && n > 1) { leverage = n; break; }
          }
        }
        console.log('[OrderPlacement Crypto] Final leverage before fallback:', leverage);
        // Fallback to admin.charges.cryptoLeverage if segment settings not found
        if (leverage === 1) {
          leverage = admin.charges?.cryptoLeverage || 1;
          console.log('[OrderPlacement Crypto] Using fallback leverage from admin.charges.cryptoLeverage:', leverage);
        }
      }
    }

    leverage = this.capLeverageFromInstrument(instrumentDoc, leverage, isIntradayProduct, isOptionBuy, {
      allowOptionBuyLeverage: isOptionsOnOptSegment && isOptionBuy,
    });

    // Priority 2: Use segment exposure/leverage if no fixed margin
    const segmentSettingsForMargin = segmentSettingsForOptionLev || TradeService.applyInstrumentExposureOverrides(instrumentDoc, segmentSettings);
    if (segmentSettingsForMargin) {
      const isIntraday = tradeData.productType === 'MIS' || tradeData.productType === 'INTRADAY';
      const optLev =
        optionSideLeverage ??
        TradeService.resolveOptionSideLeverage(hierarchySegKey, segmentSettingsForMargin, {
          isOptionBuy,
          isIntraday,
        });
      const candidates = isIntraday
        ? [
            optLev,
            segmentSettingsForMargin?.quantityModeSettings?.intradayLeverage,
            segmentSettingsForMargin?.lotSettings?.intradayLeverage,
            segmentSettingsForMargin?.exposureIntraday,
            segmentSettingsForMargin?.intradayLeverage
          ]
        : [
            optLev,
            segmentSettingsForMargin?.quantityModeSettings?.carryForwardLeverage,
            segmentSettingsForMargin?.lotSettings?.carryForwardLeverage,
            segmentSettingsForMargin?.exposureCarryForward,
            segmentSettingsForMargin?.carryForwardLeverage
          ];
      let exposureNum = 1;
      for (const v of candidates) {
        if (v == null) continue;
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) {
          if (optLev != null && n === Number(optLev)) {
            exposureNum = n;
            break;
          }
          exposureNum = n;
          break;
        }
      }

      console.log('[OrderPlacement] Margin calculation debug:', {
        isCryptoWallet: tradeData.isCrypto,
        isForexWallet: tradeData.isForex,
        tradeValue: tradeData.entryPrice * tradeData.quantity,
        exposureNum,
        leverage,
        candidates,
        quantityModeSettings: segmentSettingsForMargin?.quantityModeSettings,
        lotSettings: segmentSettingsForMargin?.lotSettings,
        segmentKey: tradeData.segment,
        marginRequiredBefore: tradeData.entryPrice * tradeData.quantity / leverage
      });

      // Force apply quantityModeSettings leverage if set and > 0
      if (exposureNum === 1 && segmentSettingsForMargin?.quantityModeSettings) {
        const qtyLeverage = isIntraday 
          ? segmentSettingsForMargin.quantityModeSettings.intradayLeverage
          : segmentSettingsForMargin.quantityModeSettings.carryForwardLeverage;
        if (qtyLeverage && Number(qtyLeverage) > 0) {
          exposureNum = Number(qtyLeverage);
          console.log('[OrderPlacement] Forcing quantityModeSettings leverage:', exposureNum);
        }
      }

      if (exposureNum > 0) {
        leverage = exposureNum;
        console.log('[OrderPlacement] Leverage after segment_exposure:', leverage);
      }
    }

    // 7. Contract lot size (DB + symbol fallback for MCX/NSE F&O)
    let lotSize = TradeService.getContractLotSize(instrumentDoc, tradeData);
    if (!lotSize || lotSize <= 0) lotSize = 1;
    const segU = String(tradeData.segment || '').toUpperCase();
    const segCryptoLot = !isBinanceCryptoOrder(tradeData)
      ? this.segmentCryptoLotSizePerUnitLot(segmentSettings)
      : null;
    if (
      segCryptoLot != null &&
      (segU === 'CRYPTOFUT' || segU === 'CRYPTOOPT' || segU === 'NSE' || segU === 'NSE-EQ' || segU === 'NSEFUT' || segU === 'NSEOPT' || segU === 'BSE' || segU === 'BSE-FUT' || segU === 'BSE-OPT' || tradeData.isCrypto)
    ) {
      lotSize = segCryptoLot;
    }
    if (isBinanceCryptoOrder(tradeData) && instrumentDoc?.lotSize > 0) {
      lotSize = instrumentDoc.lotSize;
    }
    const isOptionInstrument = tradeData.instrumentType === 'OPTIONS';
    let lots =
      tradeData.lots != null && tradeData.lots !== '' && Number.isFinite(Number(tradeData.lots))
        ? Number(tradeData.lots)
        : null;
    if (isOptionInstrument && lots != null && lots > 0 && lotSize > 0) {
      tradeData.quantity = lots * lotSize;
    }
    const qty = Number(tradeData.quantity) || 0;
    if (lots == null) {
      lots =
        lotSize > 0
          ? orderIsUsdSpot(tradeData)
            ? qty / lotSize
            : Math.ceil(qty / lotSize)
          : 1;
    }
    
    // Prefer quantityModeSettings for all exchanges when set
    const qtyModeSettings = segmentSettings?.quantityModeSettings;
    const maxLots = (qtyModeSettings?.maxQuantity > 0)
      ? qtyModeSettings.maxQuantity
      : (scriptSettings?.lotSettings?.maxLots || segmentSettings.maxLots || 50);
    const minLots = (qtyModeSettings?.minQuantity > 0)
      ? qtyModeSettings.minQuantity
      : (scriptSettings?.lotSettings?.minLots || segmentSettings.minLots || 1);

    if (isBinanceCryptoOrder(tradeData)) {
      assertBinanceCryptoQuantityValidated({
        symbol: tradeData.symbol,
        qty,
        instrument: instrumentDoc,
        segmentSettings,
        scriptSettings,
      });
      lots = lotSize > 0 ? qty / lotSize : qty;
    } else if (!orderIsUsdSpot(tradeData)) {
      if (lots < minLots) {
        throw new Error(`Minimum ${minLots} quantity required for ${tradeData.symbol}`);
      }
      if (lots > maxLots) {
        throw new Error(`Maximum ${maxLots} quantity allowed for ${tradeData.symbol}`);
      }
    } else if (orderIsUsdSpot(tradeData) && (!tradeData.quantity || tradeData.quantity <= 0)) {
      throw new Error('Invalid order quantity');
    } else if (orderIsUsdSpot(tradeData) && lotSize > 0) {
      const el = qty / lotSize;
      if (el > maxLots) {
        throw new Error(`Maximum ${maxLots} quantity allowed for ${tradeData.symbol}`);
      }
    }
    
    // Validate breakup quantity and max bid limits
    const instrumentBreakupQuantity = instrumentDoc?.tradingDefaults?.enabled && instrumentDoc.tradingDefaults.quantitySettings?.breakupQuantity;
    const segmentBreakupQuantity = segmentSettings.quantitySettings?.breakupQuantity;
    const breakupQuantity = instrumentBreakupQuantity || segmentBreakupQuantity || 0;
    
    const instrumentMaxBid = instrumentDoc?.tradingDefaults?.enabled && instrumentDoc.tradingDefaults.quantitySettings?.maxBid;
    const segmentMaxBid = segmentSettings.quantitySettings?.maxBid;
    const maxBid = instrumentMaxBid || segmentMaxBid || 0;
    
    // Check breakup quantity limit (per single order)
    if (breakupQuantity > 0 && tradeData.quantity > breakupQuantity) {
      throw new Error(`Maximum ${breakupQuantity} quantity allowed per order for ${tradeData.symbol}`);
    }
    
    // Check max bid limit (total number of orders)
    if (maxBid > 0) {
      const Trade = (await import('../models/Trade.js')).default;
      const existingOrdersCount = await Trade.countDocuments({
        user: userId,
        symbol: tradeData.symbol,
        status: 'OPEN'
      });
      
      if (existingOrdersCount >= maxBid) {
        throw new Error(`Maximum ${maxBid} orders allowed for ${tradeData.symbol}. You have ${existingOrdersCount} open orders.`);
      }
    }
    
    // Spread disabled — use raw entry price (bid/ask from market).
    const spread = 0;
    const effectiveEntryPrice = tradeData.entryPrice;
    // 9. Calculate brokerage from user settings with caps from admin + instrument flat charges
    // BUY option => premium-based margin price, SELL option => strike-based margin price.
    const strikeForMargin = Number(tradeData.strikePrice ?? instrumentDoc?.strike ?? instrumentDoc?.strikePrice);
    const isStrikeBasedOptionSell =
      tradeData.instrumentType === 'OPTIONS' &&
      String(tradeData.side || '').toUpperCase() === 'SELL' &&
      Number.isFinite(strikeForMargin) &&
      strikeForMargin > 0;
    const marginPrice = isStrikeBasedOptionSell ? strikeForMargin : effectiveEntryPrice;
    const tradeValueInrOpen = marginPrice * (tradeData.quantity || 0);
    const baseBrokerage = await this.calculateUserBrokerage(
      segmentSettings,
      scriptSettings,
      tradeData,
      lots,
      admin.brokerageCaps
    );
    const brokerage = Math.round(
      (baseBrokerage + this.instrumentAdditionalCommission(instrumentDoc, lots, tradeValueInrOpen)) * 100
    ) / 100;
    
    // 10. Calculate required margin (USDT / FX quotes; economics in INR)
    
    // Check if trade is MCX (uses separate MCX wallet) - calculate before margin calculation
    const isMcx = this.isMcxTrade(tradeData.segment, tradeData.exchange);
    
    console.log(`[TradeService.createTrade] marginPrice: ${marginPrice}, tradeData.quantity: ${tradeData.quantity}, leverage: ${leverage}, isMcx: ${isMcx}, lots: ${lots}`);
    console.log(`[TradeService.createTrade] scriptSettings.fixedMargin:`, scriptSettings?.fixedMargin);
    
    // Check for fixed margin from script settings
    let requiredMargin;
    const isIntraday = tradeData.productType === 'MIS' || tradeData.productType === 'INTRADAY';
    
    if (scriptSettings?.fixedMargin) {
      const isOption = tradeData.instrumentType === 'OPTIONS';
      const isOptionBuy = isOption && tradeData.side === 'BUY';
      const isOptionSell = isOption && tradeData.side === 'SELL';
      
      let fixedMarginPerLot = 0;
      if (isOptionBuy) {
        fixedMarginPerLot = isIntraday ? scriptSettings.fixedMargin.optionBuyIntraday : scriptSettings.fixedMargin.optionBuyCarry;
      } else if (isOptionSell) {
        fixedMarginPerLot = isIntraday ? scriptSettings.fixedMargin.optionSellIntraday : scriptSettings.fixedMargin.optionSellCarry;
      } else {
        fixedMarginPerLot = isIntraday ? scriptSettings.fixedMargin.intradayFuture : scriptSettings.fixedMargin.carryFuture;
      }
      
      if (fixedMarginPerLot > 0) {
        requiredMargin = fixedMarginPerLot * lots;
      } else {
        // Pass lotSize=1 since tradeData.quantity is already totalQuantity (lots * lotSize)
        requiredMargin = this.calculateMargin(marginPrice, tradeData.quantity, 1, leverage, tradeData.productType, isMcx, tradeData.segment);
      }
    } else {
      // Pass lotSize=1 since tradeData.quantity is already totalQuantity (lots * lotSize)
      requiredMargin = this.calculateMargin(marginPrice, tradeData.quantity, 1, leverage, tradeData.productType, isMcx, tradeData.segment);
    }

    console.log(`[TradeService.createTrade] Final requiredMargin: ${requiredMargin}`);

    const turnoverForBrk = marginPrice * (tradeData.quantity || 0);
    const franchiseCtx = await resolveFranchiseTradingContext(user, admin);
    const userFranchiseRate = getUserFranchiseRatePerCrore(user);
    let pureBrokerage = 0;
    if (franchiseCtx.active && userFranchiseRate > 0) {
      pureBrokerage = computeFranchiseUserOneWayBrokerage(user, turnoverForBrk);
      console.log('[TradeService.createTrade] Franchise brokerage (one-way):', {
        userFranchiseRate,
        turnoverForBrk,
        pureBrokerage,
        franchiseRoot: franchiseCtx.franchiseRoot?.name,
      });
    } else {
      const userSegmentSettingsForBrk = await this.getUserSegmentSettings(user, tradeData.segment, tradeData.instrumentType);
      const ONE_CRORE_BRK = 10_000_000;
      if (userSegmentSettingsForBrk.commissionType === 'PER_CRORE') {
        const commValue = Number(
          userSegmentSettingsForBrk.commission ?? userSegmentSettingsForBrk.commissionLot ?? 0
        );
        pureBrokerage = (turnoverForBrk / ONE_CRORE_BRK) * commValue;
      } else if (userSegmentSettingsForBrk.commissionType === 'PER_LOT') {
        const commValue = Number(
          userSegmentSettingsForBrk.commissionLot ?? userSegmentSettingsForBrk.commission ?? 0
        );
        pureBrokerage = commValue * (tradeData.lots || lots);
      } else if (userSegmentSettingsForBrk.commissionType === 'PER_TRADE') {
        pureBrokerage = Number(userSegmentSettingsForBrk.commission ?? 0);
      }
      pureBrokerage = Math.round(pureBrokerage * 100) / 100;
    }
    const isOptionContract = tradeData.instrumentType === 'OPTIONS';
    const roundTripMultiplier = isOptionContract ? 1 : 2;
    const openLegBrokerage = Math.round(
      (pureBrokerage > 0 ? pureBrokerage : brokerage) * roundTripMultiplier * 100
    ) / 100;

    // 11. Validate margin + brokerage headroom (cash free + open MTM — matches dashboard)
    const { computeOrderAvailableBalance } = await import('../utils/orderAvailableMargin.js');
    const need = requiredMargin + openLegBrokerage;
    let marginWalletField = 'nseBseWallet';
    let walletLabel = 'NSE & BSE Wallet';
    if (isMcx) {
      marginWalletField = 'mcxWallet';
      walletLabel = 'MCX Account';
    } else if (isCrypto) {
      marginWalletField = 'cryptoWallet';
      walletLabel = 'Crypto Account';
    } else if (isForex) {
      marginWalletField = 'forexWallet';
      walletLabel = 'Forex Account';
    }
    const available = await computeOrderAvailableBalance(userId, user, marginWalletField);
    if (need > available) {
      throw new Error(
        `Insufficient margin in ${walletLabel}. Required: ${need.toFixed(2)} ` +
          `(margin ${requiredMargin.toFixed(2)} + brokerage ${openLegBrokerage.toFixed(2)}), Available: ${available.toFixed(2)}`
      );
    }

    // 12. Block margin only in usedMargin; brokerage debited from balance on open via ledger
    const marginInc = requiredMargin;
    if (isMcx) {
      await User.updateOne({ _id: userId }, { $inc: { 'mcxWallet.usedMargin': marginInc } });
    } else if (isCrypto) {
      await User.updateOne({ _id: userId }, { $inc: { 'cryptoWallet.usedMargin': marginInc } });
    } else if (isForex) {
      await User.updateOne({ _id: userId }, { $inc: { 'forexWallet.usedMargin': marginInc } });
    } else {
      await User.updateOne({ _id: userId }, { $inc: { 'nseBseWallet.usedMargin': marginInc } });
    }
    
    // 13. Create trade with user's settings applied
    const trade = await Trade.create({
      user: userId,
      userId: user.userId,
      adminCode: user.adminCode,
      segment: tradeData.segment,
      instrumentType: tradeData.instrumentType,
      symbol: tradeData.symbol,
      token: tradeData.token,
      pair: tradeData.pair,
      isCrypto: isCrypto,
      isForex: isForex,
      exchange: tradeData.exchange || (isCrypto ? 'BINANCE' : isForex ? 'FOREX' : 'NSE'),
      expiry: tradeData.expiry,
      strike: tradeData.strike,
      optionType: tradeData.optionType,
      side: tradeData.side,
      productType: tradeData.productType || 'MIS',
      quantity: tradeData.quantity,
      lotSize,
      lots,
      entryPrice: effectiveEntryPrice, // Entry price with spread applied
      currentPrice: tradeData.entryPrice, // Current market price without spread
      marketPrice: tradeData.entryPrice, // Original market price
      spread: spread, // Store spread applied
      marginUsed: requiredMargin,
      leverage,
      status: 'OPEN',
      bookType: admin.bookType || 'B_BOOK',
      // Store charges upfront
      charges: {
        brokerage: brokerage,
        exchange: 0,
        gst: brokerage * 0.18, // 18% GST on brokerage
        sebi: 0,
        stamp: 0,
        stt: 0,
        total: brokerage + (brokerage * 0.18)
      },
      commission: openLegBrokerage,
      totalCharges: openLegBrokerage,
      brokeragePrepaidRoundTrip: !isOptionContract,
      brokerageReservedInMargin: false,
      walletBrokerageDebited: false
    });

    if (openLegBrokerage > 0 && trade.status === 'OPEN') {
      try {
        await this.recordUserBrokerageLedgerOnOpen(trade, user);
      } catch (ledgerErr) {
        console.error('[createTrade] recordUserBrokerageLedgerOnOpen:', ledgerErr?.message || ledgerErr);
      }
    }

    console.log('[TradeService] Open-leg brokerage for distribution:', openLegBrokerage, {
      franchiseMode: franchiseCtx.active,
      userFranchiseRate: userFranchiseRate || null,
    });
    // Brokerage distribution is handled by TradingService.placeOrder — avoid duplicate credits here.

    void import('./marginMonitorService.js').then((m) => m.invalidateMarginOpenTradesCache?.());

    return trade;
  }
  
  // Close a trade — unified wallet/ledger via TradingService (all segments).
  static async closeTrade(tradeId, exitPrice, reason = 'MANUAL') {
    const tradePeek = await Trade.findById(tradeId).select('status').lean();
    if (!tradePeek) throw new Error('Trade not found');
    if (tradePeek.status !== 'OPEN') throw new Error('Trade is not open');

    const { default: TradingService } = await import('./tradingService.js');
    return TradingService.closeTrade(tradeId, exitPrice, reason);
  }
  
  /**
   * Patti trading P&L share — wallet + trading P&L + ledger (parent SA or subtree ADMIN e.g. Radha).
   * Brokerage patti uses creditBrokerageToAdmin instead.
   */
  static async recordPattiSaParentShare(adminRef, signedAmount, trade, user, options = {}) {
    if (!adminRef || !Number.isFinite(signedAmount) || Math.abs(signedAmount) < 0.01) return;

    const adminDoc = await Admin.findById(adminRef._id || adminRef);
    if (!adminDoc || adminDoc.status !== 'ACTIVE') return;

    const type = signedAmount >= 0 ? 'CREDIT' : 'DEBIT';
    const amount = Math.round(Math.abs(signedAmount) * 100) / 100;
    const pattiRoot = options.pattiRootAdmin || null;
    const segKey = options.pattiSegmentKey || '';
    const childPct = options.pattiChildPct != null ? Number(options.pattiChildPct) : null;
    const chargeKind = options.chargeKind || 'TRADING_PNL';
    const pattiSource = options.pattiSource || 'individual_patti_parent';
    const isSubtreeAdminShare = pattiSource === 'individual_patti_subtree';

    adminDoc.wallet.balance = Math.round(((adminDoc.wallet.balance || 0) + signedAmount) * 100) / 100;
    adminDoc.tradingPnL.realized = Math.round(((adminDoc.tradingPnL?.realized || 0) + signedAmount) * 100) / 100;
    adminDoc.tradingPnL.todayRealized = Math.round(
      ((adminDoc.tradingPnL?.todayRealized || 0) + signedAmount) * 100
    ) / 100;
    adminDoc.stats.totalPnL = Math.round(((adminDoc.stats?.totalPnL || 0) + signedAmount) * 100) / 100;
    await adminDoc.save();

    let tradingSegment = 'NSE/BSE';
    if (trade.isCrypto || trade.exchange === 'BINANCE') tradingSegment = 'CRYPTO';
    else if (trade.isForex || trade.exchange === 'FOREX') tradingSegment = 'FOREX';
    else if (
      trade.exchange === 'MCX' ||
      trade.segment === 'MCX' ||
      trade.segment === 'MCXFUT' ||
      trade.segment === 'MCXOPT'
    ) {
      tradingSegment = 'MCX';
    }

    const userLabel = user?.username || user?.fullName || user?.userId || 'client';
    const pctLabel = childPct != null ? `${childPct}%` : isSubtreeAdminShare ? 'admin' : 'parent';
    const roleWord = isSubtreeAdminShare ? 'admin' : 'parent';
    const kindLabel = chargeKind === 'BROKERAGE' ? 'brokerage pool' : 'trading P&L';

    await WalletLedger.create({
      ownerType: 'ADMIN',
      ownerId: adminDoc._id,
      adminCode: adminDoc.adminCode,
      type,
      reason: chargeKind === 'BROKERAGE' ? 'BROKERAGE' : 'TRADE_PNL',
      amount,
      balanceAfter: adminDoc.wallet.balance,
      reference: { type: 'Trade', id: trade._id },
      description: `Patti ${pctLabel} ${roleWord} (${amount.toFixed(2)}) on ${kindLabel} — ${trade.symbol} ${trade.side} [${segKey}] (${userLabel})`,
      meta: {
        relatedUserId: user?._id || trade.user,
        userName: user?.username || user?.fullName || '',
        segment: tradingSegment,
        tradeSymbol: trade.symbol,
        tradeSide: trade.side,
        tradeQuantity: trade.quantity,
        pattiSharing: true,
        pattiSource,
        pattiChildPct: childPct,
        pattiSegmentKey: segKey,
        chargeKind,
        pattiRootAdminId: pattiRoot?._id || adminDoc._id,
        pattiRootAdminName: pattiRoot?.name || pattiRoot?.username || adminDoc.name || adminDoc.username,
        pattiRootAdminCode: pattiRoot?.adminCode || adminDoc.adminCode,
      },
    });

    if (adminDoc.role !== 'SUPER_ADMIN' && pattiSource !== 'individual_patti_parent') {
      const kuberPct = resolveSaFundingKuberPct(adminDoc, {
        isPattiCredit: true,
        pattiChildPct: childPct,
      });
      if (kuberPct !== null) {
        await fundAdminShareFromSaWallets(signedAmount, kuberPct, null, {
          relatedUserId: user?._id || trade.user,
          targetAdminName: adminDoc.name || adminDoc.username,
          targetAdminCode: adminDoc.adminCode,
          recipientIsFranchise: adminDoc.isFranchiseRoot === true,
          fundingMode: adminDoc.isFranchiseRoot === true ? 'franchise' : 'patti',
          pattiChildPct: childPct,
          pattiRootAdminId: pattiRoot?._id || adminDoc._id,
          pattiRootAdminName: pattiRoot?.name || pattiRoot?.username,
          pattiRootAdminCode: pattiRoot?.adminCode,
          pattiSegmentKey: segKey,
          chargeKind,
          reference: { type: 'Trade', id: trade._id },
        });
      }
    }
  }

  /**
   * Credit/debit franchise book or platform charge on admin main wallet + TRADE_PNL / PROFIT_SHARE ledger.
   */
  static async recordFranchiseBookPnL(adminRef, signedAmount, trade, user, legKind = 'franchise', options = {}) {
    if (!adminRef || !Number.isFinite(signedAmount) || Math.abs(signedAmount) < 0.01) return;

    const adminDoc = await Admin.findById(adminRef._id || adminRef);
    if (!adminDoc || adminDoc.status !== 'ACTIVE') return;

    const type = signedAmount >= 0 ? 'CREDIT' : 'DEBIT';
    const amount = Math.round(Math.abs(signedAmount) * 100) / 100;

    adminDoc.wallet.balance = Math.round(((adminDoc.wallet.balance || 0) + signedAmount) * 100) / 100;
    adminDoc.tradingPnL.realized = Math.round(((adminDoc.tradingPnL?.realized || 0) + signedAmount) * 100) / 100;
    adminDoc.tradingPnL.todayRealized = Math.round(
      ((adminDoc.tradingPnL?.todayRealized || 0) + signedAmount) * 100
    ) / 100;
    adminDoc.stats.totalPnL = Math.round(((adminDoc.stats?.totalPnL || 0) + signedAmount) * 100) / 100;
    await adminDoc.save();

    const isMCXTrade =
      trade.exchange === 'MCX' ||
      trade.segment === 'MCX' ||
      trade.segment === 'MCXFUT' ||
      trade.segment === 'MCXOPT';
    let tradingSegment = 'NSE/BSE';
    if (trade.isCrypto || trade.exchange === 'BINANCE') tradingSegment = 'CRYPTO';
    else if (trade.isForex || trade.exchange === 'FOREX') tradingSegment = 'FOREX';
    else if (isMCXTrade) tradingSegment = 'MCX';

    const segTag = trade.isCrypto
      ? ' (Crypto)'
      : trade.isForex
        ? ' (Forex)'
        : isMCXTrade
          ? ' (MCX)'
          : ' (NSE/BSE)';
    const userLabel = user?.username || user?.userId || 'client';
    const isAutoSquare = trade.closeReason === 'AUTO_SQUARE' || trade.closeReason === 'TIME_BASED';
    const autoTag = isAutoSquare ? ' — Auto-square' : '';
    const isPlatform = legKind === 'platform';
    const pct =
      options.platformChargesPct != null
        ? Number(options.platformChargesPct) || 0
        : Number(adminDoc.platformChargesPercentage) || 0;

    const franchiseRoot = options.franchiseRoot || null;
    const chargeKind =
      options.chargeKind ||
      (isPlatform ? 'TRADING_PNL' : 'FRANCHISE_BOOK');
    const baseAmount =
      options.baseAmount != null && Number.isFinite(Number(options.baseAmount))
        ? Math.round(Number(options.baseAmount) * 100) / 100
        : undefined;

    await WalletLedger.create({
      ownerType: 'ADMIN',
      ownerId: adminDoc._id,
      adminCode: adminDoc.adminCode,
      type,
      reason: isPlatform ? 'PROFIT_SHARE' : 'TRADE_PNL',
      amount,
      balanceAfter: adminDoc.wallet.balance,
      reference: { type: 'Trade', id: trade._id },
      description: isPlatform
        ? `Franchise platform charge (${pct}%) — ${trade.symbol} ${trade.side} book${segTag} (${userLabel})${autoTag}`
        : `Franchise book — ${trade.symbol} ${trade.side} P&L${segTag} (${userLabel})${autoTag}`,
      isAutoSquare,
      meta: {
        relatedUserId: user?._id,
        segment: tradingSegment,
        tradeId: trade.tradeId || String(trade._id),
        profitKind: isPlatform ? 'FRANCHISE_PLATFORM_CHARGE' : 'FRANCHISE_BOOK',
        clientNetPnL: trade.netPnL,
        chargeKind,
        platformPct: isPlatform ? pct : undefined,
        baseAmount,
        franchiseRootId: franchiseRoot?._id || undefined,
        franchiseRootName: franchiseRoot?.name || franchiseRoot?.username || undefined,
        franchiseRootAdminCode: franchiseRoot?.adminCode || undefined,
      },
    });
  }

  /** Split B_BOOK counterparty P&L between book admin and parent using patti % (same as brokerage when patti applies). */
  static async applyBBookAdminPnLSplit(trade, directAdmin, user, totalAdminPnL) {
    const { computeAdminBookPoolForPatti } = await import('../utils/bookPnL.js');
    const pool =
      trade?.status === 'CLOSED' && trade.bookType === 'B_BOOK'
        ? computeAdminBookPoolForPatti(trade)
        : totalAdminPnL;
    if (!directAdmin || !Number.isFinite(pool) || pool === 0) return;

    // Build hierarchy chain to check for franchise root
    const hierarchyChain = [];
    let current = directAdmin;
    while (current) {
      hierarchyChain.push({ admin: current, role: current.role });
      if (current.role === 'SUPER_ADMIN' || !current.parentId) break;
      current = await Admin.findById(current.parentId);
    }

    // Check for franchise root in hierarchy
    const franchiseRoot = findFranchiseRootInChain(hierarchyChain);

    // Franchise trading: book P&L → franchise root wallet + ledger; SA gets platformCharges % only.
    if (franchiseRoot) {
      const franchiseCtx = await resolveFranchiseTradingContext(user, directAdmin);
      const root = franchiseCtx.franchiseRoot || franchiseRoot;
      const { franchiseAmount, platformAmount } = splitFranchiseBookPnL(
        pool,
        root.platformChargesPercentage
      );

      console.log('[applyBBookAdminPnLSplit] Franchise book settle:', {
        franchiseRoot: root.name || root.username,
        totalAdminPnL: pool,
        franchiseAmount,
        platformAmount,
        platformChargesPercentage: root.platformChargesPercentage,
      });

      if (Math.abs(franchiseAmount) >= 0.01) {
        await TradeService.recordFranchiseBookPnL(root, franchiseAmount, trade, user, 'franchise', {
          franchiseRoot: root,
          chargeKind: 'FRANCHISE_BOOK',
        });
      }
      if (Math.abs(platformAmount) >= 0.01) {
        const superAdmin = await Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' });
        if (superAdmin) {
          await TradeService.recordFranchiseBookPnL(superAdmin, platformAmount, trade, user, 'platform', {
            platformChargesPct: root.platformChargesPercentage,
            franchiseRoot: root,
            chargeKind: 'TRADING_PNL',
            baseAmount: Math.abs(pool),
          });
        }
      }
      return;
    }

    // No franchise root — multi-level patti cascade (3rd brokerage type)
    const { credits, usesPatti, segKey, pattiRootId } = await resolvePattiCascadeCredits(
      directAdmin,
      user,
      trade,
      pool
    );

    if (usesPatti && credits.length > 0) {
      let pattiRootDoc = null;
      if (pattiRootId) {
        pattiRootDoc = await Admin.findById(pattiRootId).select('name username adminCode role');
      }
      for (const c of credits) {
        if (Math.abs(c.amount) < 0.000001) continue;
        const adm = await Admin.findById(c.adminId).select(
          'tradingPnL stats status role wallet adminCode name username status'
        );
        if (!adm || adm.status !== 'ACTIVE') continue;

        await this.recordPattiSaParentShare(adm, c.amount, trade, user, {
          pattiRootAdmin: pattiRootDoc,
          pattiChildPct: c.childPct,
          pattiSegmentKey: c.segKey || segKey,
          chargeKind: 'TRADING_PNL',
          pattiSource: c.source || 'hierarchy_patti_child',
        });
      }
      return;
    }

    directAdmin.tradingPnL.realized += totalAdminPnL;
    directAdmin.tradingPnL.todayRealized += totalAdminPnL;
    directAdmin.stats.totalPnL += totalAdminPnL;
    await directAdmin.save();
  }

  /** Patti cascade brokerage credits (3rd type — % split up hierarchy). */
  static async creditPattiCascadeBrokerage(trade, totalBrokerage, directAdmin, user, leg = null) {
    const { credits, usesPatti, segKey } = await resolvePattiCascadeCredits(
      directAdmin,
      user,
      trade,
      totalBrokerage
    );

    if (!usesPatti || !credits.length) return false;

    console.log('[creditPattiCascadeBrokerage] Cascade:', {
      tradeId: trade._id,
      totalBrokerage,
      segKey,
      credits: credits.map((c) => ({
        admin: c.admin?.name || c.admin?.username,
        amount: c.amount,
        childPct: c.childPct,
        source: c.source,
      })),
    });

    for (const c of credits) {
      if (Math.abs(c.amount) < 0.000001) continue;
      const adm =
        c.admin?.wallet !== undefined
          ? c.admin
          : await Admin.findById(c.adminId).select(
              'name role wallet stats isFranchiseRoot adminCode status'
            );
      if (!adm || adm.status !== 'ACTIVE') continue;
      await this.creditBrokerageToAdmin(
        adm,
        c.amount,
        trade,
        `Patti ${c.childPct}% (${c.source})`,
        user,
        leg,
        adm.isFranchiseRoot,
        { pattiSharing: true, pattiChildPct: c.childPct, pattiSegmentKey: segKey, pattiSource: c.source }
      );
    }
    return true;
  }

  /** @deprecated Use creditPattiCascadeBrokerage via distributeBrokerage. */
  static async distributeBrokerageWithPatti(trade, totalBrokerage, directAdmin, user, leg = null) {
    return this.creditPattiCascadeBrokerage(trade, totalBrokerage, directAdmin, user, leg);
  }

  /** Wallet segment label for user ledger / transfer UI. */
  static resolveTradeWalletSegmentLabel(trade) {
    if (
      trade?.isCrypto ||
      trade?.exchange === 'BINANCE' ||
      ['CRYPTOFUT', 'CRYPTOOPT'].includes(String(trade?.segment || '').toUpperCase())
    ) {
      return 'CRYPTO';
    }
    if (
      trade?.isForex ||
      trade?.exchange === 'FOREX' ||
      ['FOREXFUT', 'FOREXOPT'].includes(String(trade?.segment || '').toUpperCase())
    ) {
      return 'FOREX';
    }
    const seg = String(trade?.segment || '').toUpperCase();
    if (
      trade?.exchange === 'MCX' ||
      ['MCX', 'MCXFUT', 'MCXOPT', 'COMMODITY'].includes(seg) ||
      String(trade?.instrumentType || '').toUpperCase() === 'COMMODITY'
    ) {
      return 'MCX';
    }
    return 'NSE/BSE';
  }

  /** Apply missed open-leg brokerage debits — NSE/BSE only (do not run on crypto/mcx/forex). */
  static async reconcileUndebitedBrokerage(userId, segmentFilter = 'nse') {
    if (segmentFilter !== 'nse') return { fixed: 0 };

    const UserModel = (await import('../models/User.js')).default;
    const user = await UserModel.findById(userId).lean();
    if (!user) return { fixed: 0 };

    const segmentOr = {
      $or: [
        { exchange: { $in: ['NSE', 'NFO', 'BSE', 'BFO'] } },
        { segment: { $in: ['NSEFUT', 'NSEOPT', 'NSE-EQ', 'BSE-FUT', 'BSE-OPT', 'FNO'] } },
      ],
    };

    const trades = await Trade.find({
      user: userId,
      commission: { $gt: 0 },
      walletBrokerageDebited: { $ne: true },
      ...segmentOr,
    })
      .sort({ openedAt: -1, createdAt: -1 })
      .limit(25)
      .lean();

    let fixed = 0;
    for (const t of trades) {
      try {
        await this.recordUserBrokerageLedgerOnOpen(t, user);
        fixed += 1;
      } catch (err) {
        console.error(
          '[reconcileUndebitedBrokerage]',
          user.userId || userId,
          t.symbol,
          err?.message || err
        );
      }
    }
    return { fixed };
  }

  /** User-visible ledger row when round-trip brokerage is charged at open. */
  static async recordUserBrokerageLedgerOnOpen(trade, user) {
    const amount = Math.round((Number(trade?.commission) || 0) * 100) / 100;
    if (amount <= 0 || !user?._id || !trade?._id) return;

    const TradeModel = (await import('../models/Trade.js')).default;
    const freshTrade = await TradeModel.findById(trade._id)
      .select('commission brokerageReservedInMargin walletBrokerageDebited brokeragePrepaidRoundTrip tradeId symbol side')
      .lean()
      .catch(() => null);

    const existing = await WalletLedger.findOne({
      ownerType: 'USER',
      ownerId: user._id,
      reason: 'BROKERAGE',
      'reference.type': 'Trade',
      'reference.id': trade._id,
    }).lean();

    const alreadyDebited = !!freshTrade?.walletBrokerageDebited;
    if (alreadyDebited && existing) return;

    const walletSeg = this.resolveTradeWalletSegmentLabel(trade);
    const suffix =
      walletSeg === 'MCX'
        ? ' (MCX)'
        : walletSeg === 'CRYPTO'
          ? ' (Crypto)'
          : walletSeg === 'FOREX'
            ? ' (Forex)'
            : ' (NSE/BSE)';

    const freshUser = await (await import('../models/User.js')).default.findById(user._id)
      .select('nseBseWallet wallet cryptoWallet mcxWallet forexWallet adminCode')
      .lean();

    if (!freshUser) return;

    const { getNseBseBalance, getNseBseUsedMargin } = await import('../utils/nseBseWallet.js');

    const getBalanceForSeg = (u) => {
      if (walletSeg === 'MCX') return Number(u.mcxWallet?.balance) || 0;
      if (walletSeg === 'CRYPTO') return Number(u.cryptoWallet?.balance) || 0;
      if (walletSeg === 'FOREX') return Number(u.forexWallet?.balance) || 0;
      return Number(getNseBseBalance(u)) || 0;
    };

    let safeBalanceAfter = getBalanceForSeg(freshUser);

    if (!alreadyDebited) {
      const releaseUsedMargin = 0;
      let balanceBefore = safeBalanceAfter;
      let usedMarginBefore = 0;
      if (walletSeg === 'MCX') {
        usedMarginBefore = Number(freshUser.mcxWallet?.usedMargin) || 0;
      } else if (walletSeg === 'CRYPTO') {
        usedMarginBefore = Number(freshUser.cryptoWallet?.usedMargin) || 0;
      } else if (walletSeg === 'FOREX') {
        usedMarginBefore = Number(freshUser.forexWallet?.usedMargin) || 0;
      } else {
        usedMarginBefore = Number(getNseBseUsedMargin(freshUser)) || 0;
      }

      const balanceAfter = balanceBefore - amount;
      const safeReleaseUsedMargin = Math.min(Math.max(0, usedMarginBefore), releaseUsedMargin);
      safeBalanceAfter = Math.max(0, balanceAfter);

      const setFields = {};
      const incFields = {};
      if (walletSeg === 'MCX') {
        setFields['mcxWallet.balance'] = safeBalanceAfter;
        if (safeReleaseUsedMargin > 0) incFields['mcxWallet.usedMargin'] = -safeReleaseUsedMargin;
      } else if (walletSeg === 'CRYPTO') {
        setFields['cryptoWallet.balance'] = safeBalanceAfter;
        if (safeReleaseUsedMargin > 0) incFields['cryptoWallet.usedMargin'] = -safeReleaseUsedMargin;
      } else if (walletSeg === 'FOREX') {
        setFields['forexWallet.balance'] = safeBalanceAfter;
        if (safeReleaseUsedMargin > 0) incFields['forexWallet.usedMargin'] = -safeReleaseUsedMargin;
      } else {
        setFields['nseBseWallet.balance'] = safeBalanceAfter;
        setFields['wallet.tradingBalance'] = safeBalanceAfter;
        setFields['wallet.balance'] = safeBalanceAfter;
        if (safeReleaseUsedMargin > 0) incFields['nseBseWallet.usedMargin'] = -safeReleaseUsedMargin;
      }

      const mongoUpdate = { $set: setFields };
      if (Object.keys(incFields).length > 0) mongoUpdate.$inc = incFields;

      const walletUpdate = await (await import('../models/User.js')).default.updateOne(
        { _id: user._id },
        mongoUpdate
      );
      if (walletUpdate.modifiedCount === 0 && walletUpdate.matchedCount === 0) {
        throw new Error(`Brokerage wallet update failed for user ${user._id}`);
      }

      await TradeModel.updateOne(
        { _id: trade._id },
        {
          $set: {
            walletBrokerageDebited: true,
            brokerageReservedInMargin: false,
          },
        }
      );
    }

    const prepaidRoundTrip = !!(
      freshTrade?.brokeragePrepaidRoundTrip ?? trade.brokeragePrepaidRoundTrip
    );
    const legLabel = prepaidRoundTrip ? 'OPEN+CLOSE' : 'OPEN';

    let franchiseLedgerMeta = {};
    let franchiseTag = '';
    try {
      const directAdmin =
        user.admin?._id
          ? user.admin
          : user.admin
            ? await Admin.findById(user.admin)
            : await Admin.findOne({ adminCode: user.adminCode });
      if (directAdmin) {
        const franchiseCtx = await resolveFranchiseTradingContext(user, directAdmin);
        const userFranchiseRate = getUserFranchiseRatePerCrore(user);
        if (franchiseCtx.active && userFranchiseRate > 0) {
          franchiseTag = ' [Franchise]';
          franchiseLedgerMeta = {
            franchiseBrokerage: true,
            franchiseRatePerCrore: userFranchiseRate,
          };
        }
      }
    } catch (frErr) {
      console.warn('[recordUserBrokerageLedgerOnOpen] franchise meta:', frErr?.message);
    }

    // Create ledger row immediately (idempotent: only create if it doesn't exist)
    if (!existing) {
      await WalletLedger.create({
        ownerType: 'USER',
        ownerId: user._id,
        adminCode: user.adminCode,
        type: 'DEBIT',
        reason: 'BROKERAGE',
        amount,
        balanceAfter: safeBalanceAfter,
        reference: { type: 'Trade', id: trade._id },
        description: `${trade.symbol || 'Trade'} ${trade.side || ''} Brokerage${suffix} for ${legLabel}${franchiseTag}`.trim(),
        meta: {
          tradeId: trade.tradeId || String(trade._id),
          segment: walletSeg === 'NSE/BSE' ? 'NSE/BSE' : walletSeg,
          leg: legLabel,
          prepaidRoundTrip,
          reservedConverted: false,
          debitedOnOpen: true,
          ...franchiseLedgerMeta,
        },
      });
    }
  }

  /**
   * Sum of franchise brokerage credits already posted for a trade leg (supports resume after partial run).
   */
  static async getFranchiseBrokerageProgress(tradeId, legLabel) {
    const rows = await WalletLedger.find({
      ownerType: 'ADMIN',
      type: 'CREDIT',
      'reference.id': tradeId,
      'meta.franchiseDistribution': true,
      'meta.franchiseBrokerageLeg': legLabel,
    })
      .select('ownerId amount')
      .lean();

    const byAdmin = new Map();
    let total = 0;
    for (const row of rows) {
      const id = String(row.ownerId);
      byAdmin.set(id, Math.round(((byAdmin.get(id) || 0) + (Number(row.amount) || 0)) * 100) / 100);
      total += Number(row.amount) || 0;
    }
    return {
      byAdmin,
      totalDistributed: Math.round(total * 100) / 100,
      entryCount: rows.length,
    };
  }

  /**
   * Franchise subtree: cascade /crore from user + admin franchise fields (no SA diversion).
   */
  static async distributeFranchiseBrokerage(trade, totalBrokerage, directAdmin, user, franchiseCtx, leg, turnover) {
    let { hierarchyChain, franchiseRoot } = franchiseCtx;
    hierarchyChain = await refreshFranchiseHierarchyChain(hierarchyChain);
    hierarchyChain = await ensureSuperAdminInChain(hierarchyChain);

    const segment = String(trade.segment || '').toUpperCase();
    const legMultiplier = resolveFranchiseLegMultiplier(trade, leg);
    const legLabel = String(leg || 'OPEN+CLOSE').toUpperCase();

    const progress = await this.getFranchiseBrokerageProgress(trade._id, legLabel);
    if (progress.totalDistributed >= totalBrokerage - 0.02) {
      console.log('[distributeFranchiseBrokerage] Already fully distributed:', {
        tradeId: trade._id,
        leg: legLabel,
        totalBrokerage,
        totalDistributed: progress.totalDistributed,
      });
      return;
    }

    let adminInrs = buildFranchiseAdminInrLevels(hierarchyChain, turnover, legMultiplier, segment, trade);
    const expectedUserTotal = computeFranchiseUserTotalBrokerage(user, turnover, legMultiplier);

    const credits = computeFranchiseCascadeShares(totalBrokerage, hierarchyChain, adminInrs);
    const creditsSum = sumFranchiseCascadeCredits(credits);

    console.log('[distributeFranchiseBrokerage] Cascade:', {
      totalBrokerage,
      expectedUserTotal,
      leg,
      legMultiplier,
      turnover,
      segment,
      directAdmin: directAdmin?.name,
      directAdminRole: directAdmin?.role,
      franchiseRoot: franchiseRoot?.name,
      chain: hierarchyChain.map((h) => ({ role: h.role, name: h.admin?.name })),
      adminInrs,
      creditsSum,
      priorDistributed: progress.totalDistributed,
      credits: credits.map((c) => ({ role: c.role, name: c.admin?.name, amount: c.amount, label: c.label })),
    });

    if (Math.abs(creditsSum - totalBrokerage) > 0.05) {
      console.warn('[distributeFranchiseBrokerage] Cascade sum mismatch — remainder will go to Super Admin:', {
        totalBrokerage,
        creditsSum,
        diff: Math.round((totalBrokerage - creditsSum) * 100) / 100,
      });
    }

    if ((adminInrs[0] || 0) <= 0 && hierarchyChain.length > 1) {
      console.error('[distributeFranchiseBrokerage] Direct admin has no franchise /crore rate — set restrictMode.brokerageChargePerCrore on:', {
        directAdmin: hierarchyChain[0]?.admin?.name,
        directAdminRole: hierarchyChain[0]?.role,
      });
    }

    const franchiseLedgerMeta = {
      franchiseDistribution: true,
      franchiseBrokerageLeg: legLabel,
      franchiseRootId: franchiseRoot?._id,
      franchiseRootName: franchiseRoot?.name || franchiseRoot?.username || '',
      franchiseRootAdminCode: franchiseRoot?.adminCode || '',
      clientUserId: user?.userId || user?._id,
      clientUserName: user?.username || user?.fullName || '',
    };

    let totalDistributed = progress.totalDistributed;

    const creditShare = async (admin, role, amount, description, isFranchiseRoot = false) => {
      if (amount <= 0.01 || !admin) return;
      const adminId = String(admin._id);
      const alreadyPaid = progress.byAdmin.get(adminId) || 0;
      const payAmount = Math.round((amount - alreadyPaid) * 100) / 100;
      if (payAmount <= 0.01) return;

      if (!adminReceivesHierarchyBrokerage(admin, 'trading') && role !== 'SUPER_ADMIN') {
        const saSink =
          hierarchyChain.find((h) => h.role === 'SUPER_ADMIN')?.admin || (await resolveSuperAdminAdmin());
        if (saSink) {
          await this.creditBrokerageToAdmin(
            saSink,
            payAmount,
            trade,
            `Franchise — diverted from ${role} (restricted)`,
            user,
            leg,
            false,
            { ...franchiseLedgerMeta, divertedFromRole: role }
          );
          totalDistributed = Math.round((totalDistributed + payAmount) * 100) / 100;
        }
        return;
      }

      await this.creditBrokerageToAdmin(
        admin,
        payAmount,
        trade,
        description,
        user,
        leg,
        isFranchiseRoot,
        franchiseLedgerMeta
      );
      totalDistributed = Math.round((totalDistributed + payAmount) * 100) / 100;
    };

    for (const { admin, role, amount, label } of credits) {
      await creditShare(
        admin,
        role,
        amount,
        label === 'direct'
          ? `Franchise direct share (${amount.toFixed(2)})`
          : `Franchise ${role} share (${amount.toFixed(2)})`,
        admin.isFranchiseRoot === true
      );
    }

    const finalRemainder = Math.round((totalBrokerage - totalDistributed) * 100) / 100;
    if (finalRemainder > 0.01) {
      const sa =
        hierarchyChain.find((h) => h.role === 'SUPER_ADMIN')?.admin || (await resolveSuperAdminAdmin());
      if (sa) {
        await this.creditBrokerageToAdmin(
          sa,
          finalRemainder,
          trade,
          `Franchise Super Admin remainder (${finalRemainder.toFixed(2)})`,
          user,
          leg,
          false,
          franchiseLedgerMeta
        );
        totalDistributed = Math.round((totalDistributed + finalRemainder) * 100) / 100;
      } else {
        console.error('[distributeFranchiseBrokerage] UNDISTRIBUTED BROKERAGE — no Super Admin found:', {
          tradeId: trade._id,
          finalRemainder,
          totalBrokerage,
          totalDistributed,
        });
      }
    }

    if (Math.abs(totalBrokerage - totalDistributed) > 0.05) {
      console.error('[distributeFranchiseBrokerage] INCOMPLETE DISTRIBUTION:', {
        totalBrokerage,
        totalDistributed,
        shortfall: Math.round((totalBrokerage - totalDistributed) * 100) / 100,
      });
    }

    console.log('[distributeFranchiseBrokerage] Done:', {
      totalBrokerage,
      totalDistributed,
      shortfall: Math.round((totalBrokerage - totalDistributed) * 100) / 100,
    });
  }

  // Distribute brokerage through MLM hierarchy using cascading  amounts.
  // Each admin keeps the difference between their calculated  brokerage and the next parent's.
  // The user's rate is the true "bottom" — the full totalBrokerage is based on it.
  static async distributeBrokerage(trade, totalBrokerage, directAdmin, user, leg = null) {
    if (user?.isDemo) {
      console.log('[distributeBrokerage] Skipped — demo user (no hierarchy brokerage):', user.userId || user._id);
      return;
    }
    try {
      const freshUser = user?._id
        ? await User.findById(user._id).select(
            'franchiseChargePerCrore admin createdBy adminCode isDemo userId username fullName hierarchyPath'
          )
        : user;
      if (freshUser) user = freshUser;

      const resolvedDirect = await resolveUserDirectAdmin(user);
      const cascadeStart = await resolveBrokerageCascadeStartAdmin(user, resolvedDirect || directAdmin);
      if (cascadeStart) {
        directAdmin = cascadeStart;
      } else if (resolvedDirect) {
        directAdmin = resolvedDirect;
      } else if (directAdmin?._id) {
        directAdmin =
          (await Admin.findById(directAdmin._id).select(
            'name role parentId restrictMode segmentPermissions defaultSettings isFranchiseRoot adminCode hierarchyPath wallet stats status receivesHierarchyBrokerage'
          )) || directAdmin;
      }

      console.log('[distributeBrokerage] Starting distribution:', {
        tradeId: trade._id,
        totalBrokerage,
        directAdmin: directAdmin?.name,
        directAdminRole: directAdmin?.role,
        userAdminField: user?.admin,
        userId: user.userId,
        userFranchiseRate: getUserFranchiseRatePerCrore(user),
        leg: leg,
      });

      if (!directAdmin) {
        console.error('[distributeBrokerage] No direct admin — cannot distribute brokerage');
        return;
      }

      // Trade parameters needed to convert any commission type →  amount
      const segment = String(trade.segment || '').toUpperCase();
      const segmentKey = TradeService.resolveMarketWatchSegmentKey(segment, trade.instrumentType);
      const lots = trade.lots || trade.quantity || 1;
      const lotSize = trade.lotSize || 1;
      const price = trade.entryPrice || trade.currentPrice || 0;
      const turnover = price * (trade.quantity || 0) || price * lots * lotSize;

      const franchiseCtx = await resolveFranchiseTradingContext(user, directAdmin);
      const pattiCtxEarly = await resolvePattiAdminSaBrokerageContext(directAdmin, user, trade);
      const inPattiSubtree =
        pattiCtxEarly.active === true || (await isAdminInActivePattiSubtree(directAdmin));

      if (
        franchiseCtx.active &&
        getUserFranchiseRatePerCrore(user) > 0 &&
        !inPattiSubtree
      ) {
        await this.distributeFranchiseBrokerage(
          trade,
          totalBrokerage,
          directAdmin,
          user,
          franchiseCtx,
          leg,
          turnover
        );
        return;
      }

      // MLM /crore cascade — full chain through Super Admin (required for patti ADMIN↔SA slice)
      let hierarchyChain = await buildAdminHierarchyChain(directAdmin);
      hierarchyChain = await ensureSuperAdminInChain(hierarchyChain);
      hierarchyChain = await refreshFranchiseHierarchyChain(hierarchyChain);

      const ONE_CRORE = 10_000_000;
      const legMultiplier = resolveFranchiseLegMultiplier(trade, leg);

      console.log('[distributeBrokerage] Trade parameters:', {
        segment,
        instrumentType: trade.instrumentType,
        lots,
        lotSize,
        price,
        turnover,
        leg,
        legMultiplier,
      });

      const commissionToInr = (commType, commissionValue) => {
        const comm = Number(commissionValue) || 0;
        if (comm <= 0) return 0;
        const mult = legMultiplier > 0 ? legMultiplier : 1;
        if (commType === 'PER_LOT' || commType === 'PER_QUANTITY') return comm * lots * mult;
        if (commType === 'PER_TRADE') return comm * mult;
        if (commType === 'PER_CRORE') return (turnover / ONE_CRORE) * comm * mult;
        return comm * lots * mult;
      };

      const sysRaw = await SystemSettings.getSettings();
      const admDefaults = TradeService._segmentMapPlain(sysRaw?.adminSegmentDefaults);
      const sysSlice =
        admDefaults[segmentKey] || admDefaults[segment] || admDefaults.CRYPTOFUT || {};

      console.log('[distributeBrokerage] User object before getUserSegmentSettings:', {
        userId: user.userId,
        adminCode: user.adminCode,
        hasAdmin: !!user.admin,
        adminName: user.admin?.name,
        adminHasSegmentPermissions: !!user.admin?.segmentPermissions
      });
      const userSegmentSettings = await this.getUserSegmentSettings(user, segment, trade.instrumentType);
      console.log('[distributeBrokerage] User segment settings:', {
        segment,
        instrumentType: trade.instrumentType,
        commission: userSegmentSettings?.commission,
        commissionType: userSegmentSettings?.commissionType,
        commissionLot: userSegmentSettings?.commissionLot
      });
      const userComm = {
        commType: userSegmentSettings?.commissionType || 'PER_LOT',
        commValue: userSegmentSettings?.commissionType === 'PER_CRORE' ||
          userSegmentSettings?.commissionType === 'PER_TRADE'
          ? Number(userSegmentSettings?.commission ?? userSegmentSettings?.commissionLot ?? 0)
          : Number(userSegmentSettings?.commissionLot ?? userSegmentSettings?.commission ?? 0)
      };
      const userBrokerageInr = commissionToInr(userComm.commType, userComm.commValue);
      console.log('[distributeBrokerage] User brokerage calculation:', {
        commType: userComm.commType,
        commValue: userComm.commValue,
        userBrokerageInr,
        totalBrokerage,
      });

      // Inject patti ADMIN into chain before MLM levels (levels must match final chain length)
      const pattiCtx = pattiCtxEarly.active ? pattiCtxEarly : await resolvePattiAdminSaBrokerageContext(directAdmin, user, trade);
      const pattiRootId = pattiCtx.active
        ? String(pattiCtx.pattiRoot?._id || pattiCtx.pattiRoot || '')
        : null;

      if (pattiCtx.active && pattiCtx.pattiRoot && pattiRootId) {
        if (!hierarchyChain.some((h) => String(h.admin._id) === pattiRootId)) {
          const freshRoot = await Admin.findById(pattiCtx.pattiRoot._id).select(
            'name role parentId restrictMode segmentPermissions defaultSettings isFranchiseRoot adminCode hierarchyPath wallet stats status receivesHierarchyBrokerage'
          );
          if (freshRoot) {
            const saIdxInsert = hierarchyChain.findIndex((h) => h.role === 'SUPER_ADMIN');
            const insertAt = saIdxInsert >= 0 ? saIdxInsert : hierarchyChain.length;
            hierarchyChain.splice(insertAt, 0, { admin: freshRoot, role: freshRoot.role });
            hierarchyChain = await refreshFranchiseHierarchyChain(hierarchyChain);
          }
        }
      }

      const mlmCommMeta = resolveMlmChainCommissionMeta(hierarchyChain, segmentKey, trade, sysSlice);
      const adminInrLevels = buildMlmAdminInrLevels(
        hierarchyChain,
        segmentKey,
        trade,
        sysSlice,
        commissionToInr
      );
      for (let i = 0; i < hierarchyChain.length; i++) {
        hierarchyChain[i].brokerageInr = adminInrLevels[i] || 0;
        hierarchyChain[i].commType = mlmCommMeta[i]?.commType;
        hierarchyChain[i].commValue = mlmCommMeta[i]?.commValue;
        hierarchyChain[i].mlmRateSource = mlmCommMeta[i]?.source;
      }

      console.log('[distributeBrokerage] Hierarchy chain built:', {
        chainLength: hierarchyChain.length,
        chain: hierarchyChain.map(h => ({
          name: h.admin.name,
          role: h.role,
          parentId: h.admin.parentId,
          hierarchyPath: h.admin.hierarchyPath
        }))
      });

      console.log('[distributeBrokerage] Hierarchy  amounts:', {
        userRate: { ...userComm, brokerageInr: userBrokerageInr },
        chain: hierarchyChain.map(h => ({
          name: h.admin.name,
          role: h.role,
          commType: h.commType,
          commValue: h.commValue,
          mlmRateSource: h.mlmRateSource,
          brokerageInr: h.brokerageInr,
        }))
      });

      // MLM cascade: i=0 clientCharge−cost[0]; i≥1 cost[i−1]−cost[i] (restrictMode + segment + inherit)
      const roundTripFactor = 1;

      if (roundTripFactor === 0 && totalBrokerage > 0) {
        console.log('[distributeBrokerage] User rate is 0, crediting full amount to direct admin');
        await this.creditBrokerageToAdmin(
          directAdmin, totalBrokerage, trade,
          `Full brokerage (${totalBrokerage.toFixed(2)}) — no user segment rate configured`,
          user,
          leg,
          directAdmin.isFranchiseRoot
        );
        return;
      }

      const levels = adminInrLevels.map((v) => Math.round((Number(v) || 0) * roundTripFactor * 100) / 100);
      levels.push(0);

      console.log('[distributeBrokerage] Distribution levels:', {
        totalBrokerage,
        levels: levels.map((l, i) => ({ index: i, amount: l })),
        chain: hierarchyChain.map(h => ({ name: h.admin.name, role: h.role, brokerageInr: h.brokerageInr }))
      });

      const franchiseRoot = findFranchiseRootInChain(hierarchyChain);

      const pattiRootIdx = pattiRootId
        ? hierarchyChain.findIndex((h) => String(h.admin._id) === pattiRootId)
        : -1;
      const saIdx = hierarchyChain.findIndex((h) => h.role === 'SUPER_ADMIN');
      const hierarchyChainForPatti = hierarchyChain.map((h) => h.admin);
      const downlinePattiEdges =
        pattiCtx.active &&
        chainHasDownlinePattiEdges(
          hierarchyChainForPatti,
          user,
          pattiCtx.segKey || segmentKey
        );
      const pattiPoolStartIdx =
        downlinePattiEdges && saIdx >= 0 ? 0 : pattiRootIdx >= 0 ? pattiRootIdx : 0;
      const usePattiAdminSa =
        pattiCtx.active && saIdx >= 0 && (pattiRootIdx >= 0 || downlinePattiEdges);

      if (pattiCtx.active && !usePattiAdminSa) {
        console.warn('[distributeBrokerage] Patti configured but chain missing root or SA:', {
          pattiRootId,
          pattiRootIdx,
          saIdx,
          chain: hierarchyChain.map((h) => ({ name: h.admin?.name, role: h.role })),
          segKey: pattiCtx.segKey,
          childPct: pattiCtx.childPct,
        });
      }

      let divertedToSuperAdmin = 0;
      let divertedToFranchiseRoot = 0;
      let totalDistributed = 0;
      let pattiPoolAccum = 0;

      const creditPattiAdminSaPool = async () => {
        if (pattiPoolAccum <= 0) return;
        const bookAdmin = hierarchyChain[0]?.admin || directAdmin;
        const { credits, usesPatti, segKey, pattiRootId: cascadeRootId } =
          await resolvePattiCascadeCredits(bookAdmin, user, trade, pattiPoolAccum);

        const pattiRootAdmin =
          (cascadeRootId &&
            hierarchyChain.find((h) => String(h.admin._id) === String(cascadeRootId))?.admin) ||
          hierarchyChain[pattiRootIdx]?.admin ||
          pattiCtx.pattiRoot;

        const pattiRootMeta = {
          pattiRootAdminId: pattiRootAdmin?._id,
          pattiRootAdminName: pattiRootAdmin?.name || pattiRootAdmin?.username || '',
          pattiRootAdminCode: pattiRootAdmin?.adminCode || '',
        };

        console.log('[distributeBrokerage] Patti hierarchy pool:', {
          pool: pattiPoolAccum,
          usesPatti,
          credits: credits?.map((c) => ({
            adminId: c.adminId,
            amount: c.amount,
            childPct: c.childPct,
            source: c.source,
          })),
          segKey: segKey || pattiCtx.segKey,
        });

        if (!usesPatti || !credits?.length) {
          const { child, parent } = splitByChildPercent(pattiPoolAccum, pattiCtx.childPct);
          const radhaAdmin = hierarchyChain[pattiRootIdx]?.admin;
          const saAdmin = hierarchyChain[saIdx]?.admin;
          const radhaEligible = adminReceivesHierarchyBrokerage(radhaAdmin, 'trading');
          let saPattiAmount = parent;
          if (!radhaEligible && child > 0) saPattiAmount = roundMoney(parent + child);
          if (child > 0 && radhaEligible && radhaAdmin) {
            await this.creditBrokerageToAdmin(
              radhaAdmin,
              child,
              trade,
              `Patti ${pattiCtx.childPct}% (${child.toFixed(2)})`,
              user,
              leg,
              false,
              { pattiSharing: true, pattiChildPct: pattiCtx.childPct, pattiSegmentKey: pattiCtx.segKey, ...pattiRootMeta }
            );
            totalDistributed += child;
          }
          if (saPattiAmount > 0 && saAdmin) {
            await this.creditBrokerageToAdmin(
              saAdmin,
              saPattiAmount,
              trade,
              `Patti parent (${saPattiAmount.toFixed(2)})`,
              user,
              leg,
              false,
              { pattiSharing: true, pattiSegmentKey: pattiCtx.segKey, pattiSource: 'individual_patti_parent', ...pattiRootMeta }
            );
            totalDistributed += saPattiAmount;
          }
          pattiPoolAccum = 0;
          return;
        }

        for (const c of credits) {
          if (Math.abs(c.amount) < 0.000001) continue;
          const adm =
            c.admin ||
            (await Admin.findById(c.adminId).select(
              'name role wallet stats status isFranchiseRoot adminCode receivesHierarchyBrokerage'
            ));
          if (!adm || adm.status !== 'ACTIVE') continue;
          if (!adminReceivesHierarchyBrokerage(adm, 'trading')) continue;

          await this.creditBrokerageToAdmin(
            adm,
            c.amount,
            trade,
            `Patti ${c.childPct}% (${Math.abs(c.amount).toFixed(2)}) [${segKey || pattiCtx.segKey}]`,
            user,
            leg,
            !!adm.isFranchiseRoot,
            {
              pattiSharing: true,
              pattiChildPct: c.childPct,
              pattiSegmentKey: segKey || pattiCtx.segKey,
              pattiSource: c.source,
              chargeKind: 'BROKERAGE',
              ...pattiRootMeta,
            }
          );
          totalDistributed += Math.abs(c.amount);
        }

        pattiPoolAccum = 0;
      };

      // Bottom keeps client charge − own cost; upper levels keep own cost − parent cost
      for (let i = 0; i < hierarchyChain.length; i++) {
        const { admin, role } = hierarchyChain[i];
        const myRateAmt = levels[i];
        const amount = computeMlmLevelShareAmount(i, totalBrokerage, levels);

        if (amount <= 0) {
          if (i === 0 && (role === 'SUB_BROKER' || role === 'BROKER')) {
            console.warn(
              '[distributeBrokerage] Direct admin share is 0 — client charge must exceed this level cost rate:',
              {
                name: admin.name,
                role,
                clientChargeInr: totalBrokerage,
                directCostInr: myRateAmt,
                commType: hierarchyChain[i].commType,
                commValue: hierarchyChain[i].commValue,
                mlmRateSource: hierarchyChain[i].mlmRateSource,
                segmentKey,
              }
            );
          } else if (role === 'BROKER' && i === 1 && hierarchyChain[0]?.role === 'SUB_BROKER') {
            console.warn(
              '[distributeBrokerage] BROKER share is 0 — sub-broker cost rate must exceed broker cost rate (check segment + restrictMode):',
              {
                name: admin.name,
                subBrokerCostInr: levels[0],
                brokerCostInr: myRateAmt,
                commType: hierarchyChain[i].commType,
                commValue: hierarchyChain[i].commValue,
                mlmRateSource: hierarchyChain[i].mlmRateSource,
                segmentKey,
              }
            );
          }
          continue;
        }

        const inPattiSlice = usePattiAdminSa && i >= pattiPoolStartIdx && i <= saIdx;

        if (inPattiSlice) {
          if (role === 'SUPER_ADMIN' && franchiseRoot) {
            divertedToFranchiseRoot += amount;
          } else {
            // ADMIN↔SA top slice — pool then split (restricted admin share rolls into SA parent %)
            pattiPoolAccum += amount;
          }
          if (i === saIdx) {
            await creditPattiAdminSaPool();
          }
          continue;
        }

        // If franchise root exists and this is SUPER_ADMIN, divert to franchise root
        if (role === 'SUPER_ADMIN' && franchiseRoot) {
          divertedToFranchiseRoot += amount;
          continue;
        }

        if (!adminReceivesHierarchyBrokerage(admin, 'trading')) {
          divertedToSuperAdmin += amount;
          continue;
        }

        console.log('[distributeBrokerage] Crediting:', {
          name: admin.name,
          role,
          amount,
          clientCharge: i === 0 ? totalBrokerage : undefined,
          belowRate: i > 0 ? levels[i - 1] : undefined,
          myRate: myRateAmt,
        });
        await this.creditBrokerageToAdmin(
          admin, amount, trade,
          `${role} share (${amount.toFixed(2)})`,
          user,
          leg,
          !!franchiseRoot,
          { hierarchyRole: role }
        );
        totalDistributed += amount;
      }

      if (usePattiAdminSa && pattiPoolAccum > 0) {
        await creditPattiAdminSaPool();
      }

      // Handle rounding remainder - give to SuperAdmin (or patti pool if SA in patti slice)
      const remainder = Math.round((totalBrokerage - totalDistributed - divertedToSuperAdmin - divertedToFranchiseRoot) * 100) / 100;
      if (remainder > 0.01) {
        const topAdmin = hierarchyChain[hierarchyChain.length - 1]?.admin;
        if (topAdmin) {
          if (topAdmin.role === 'SUPER_ADMIN' && franchiseRoot) {
            divertedToFranchiseRoot += remainder;
          } else if (!adminReceivesHierarchyBrokerage(topAdmin, 'trading')) {
            divertedToSuperAdmin += remainder;
          } else if (usePattiAdminSa && saIdx >= 0) {
            pattiPoolAccum += remainder;
            await creditPattiAdminSaPool();
          } else {
            await this.creditBrokerageToAdmin(topAdmin, remainder, trade, `Rounding remainder (${remainder.toFixed(2)})`, user, leg, !!franchiseRoot);
            totalDistributed += remainder;
          }
        }
      }

      // Handle franchise root diversion (SA share goes to franchise root instead)
      if (divertedToFranchiseRoot > 0 && franchiseRoot) {
        const platformChargesPct = franchiseRoot.platformChargesPercentage || 0;
        
        // Platform charges apply to brokerage (always positive amount)
        const platformCharges = Math.round((divertedToFranchiseRoot * platformChargesPct / 100) * 100) / 100;
        const franchiseAmount = divertedToFranchiseRoot - platformCharges;

        console.log('[distributeBrokerage] Franchise root brokerage diversion:', {
          totalDiverted: divertedToFranchiseRoot,
          platformChargesPct,
          platformCharges,
          franchiseAmount
        });

        // Credit platform charges to SuperAdmin
        if (platformCharges > 0) {
          const superAdmin = hierarchyChain.find(h => h.role === 'SUPER_ADMIN')?.admin ||
                            await Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' });
          if (superAdmin) {
            await this.creditBrokerageToAdmin(
              superAdmin, platformCharges, trade,
              `Platform charges (${platformChargesPct}% from franchise root)`,
              user, leg, false,
              {
                profitKind: 'FRANCHISE_PLATFORM_CHARGE',
                chargeKind: 'BROKERAGE',
                franchiseRootId: franchiseRoot._id,
                franchiseRootName: franchiseRoot.name || franchiseRoot.username || '',
                franchiseRootAdminCode: franchiseRoot.adminCode || '',
                platformPct: platformChargesPct,
                baseAmount: divertedToFranchiseRoot,
              }
            );
          }
        }

        // Credit remaining to franchise root
        if (franchiseAmount > 0) {
          franchiseRoot.temporaryWallet.balance = (franchiseRoot.temporaryWallet.balance || 0) + franchiseAmount;
          franchiseRoot.temporaryWallet.totalEarned = (franchiseRoot.temporaryWallet.totalEarned || 0) + franchiseAmount;
          await franchiseRoot.save();
          await WalletLedger.create({
            ownerType: 'ADMIN',
            ownerId: franchiseRoot._id,
            adminCode: franchiseRoot.adminCode,
            type: 'CREDIT',
            reason: 'BROKERAGE(INDEPENDENT)',
            amount: franchiseAmount,
            balanceAfter: franchiseRoot.temporaryWallet.balance,
            description: `Trading brokerage — franchise root (${franchiseAmount.toFixed(2)}) [Temporary Wallet]`,
            meta: { franchiseRootDiversion: true, tradeId: trade?._id, platformChargesDeducted: platformCharges },
          });
        }
      }

      if (divertedToSuperAdmin > 0) {
        const saSink =
          hierarchyChain.find((h) => h.role === 'SUPER_ADMIN')?.admin ||
          (await Admin.findOne({ role: 'SUPER_ADMIN', status: 'ACTIVE' }));
        if (saSink) {
          try {
            await trackHierarchyEarnings(directAdmin._id, divertedToSuperAdmin, 'trading');
          } catch (error) {
            console.error(`[distributeBrokerage] Error tracking Super Admin earnings:`, error);
          }
          await this.creditBrokerageToAdmin(
            saSink, divertedToSuperAdmin, trade,
            `Super Admin — diverted from restricted admins (${divertedToSuperAdmin.toFixed(2)})`,
            user
          );
        } else {
          console.error('[distributeBrokerage] No Super Admin to credit diverted brokerage');
        }
      }

      console.log('[distributeBrokerage] Done:', { totalDistributed, divertedToSuperAdmin, divertedToFranchiseRoot, totalBrokerage });

    } catch (error) {
      console.error('Error distributing brokerage:', error);
      // Fallback: credit full amount to highest eligible admin
      const chain = [];
      let cur = directAdmin;
      while (cur) {
        chain.push({ admin: cur, role: cur.role });
        if (cur.role === 'SUPER_ADMIN' || !cur.parentId) break;
        cur = await Admin.findById(cur.parentId);
      }
      const recipient = await resolveHierarchyBrokerageRecipient(directAdmin, Admin, chain);
      if (recipient) {
        await this.creditBrokerageToAdmin(
          recipient, totalBrokerage, trade,
          'Full brokerage (distribution error fallback)',
          user,
          leg,
          directAdmin.isFranchiseRoot
        );
      }
    }
  }
  
  // Helper to credit brokerage to a single admin
  static async creditBrokerageToAdmin(admin, amount, trade, description, user = null, leg = null, isFranchiseRoot = false, extraMeta = null) {
    if (!admin || amount <= 0) {
      console.log('[creditBrokerageToAdmin] Skipping - admin or amount invalid:', {
        admin: admin?.name,
        amount: amount
      });
      return;
    }

    console.log('[creditBrokerageToAdmin] Crediting brokerage:', {
      admin: admin.name,
      role: admin.role,
      amount: amount,
      tradeId: trade._id,
      description: description,
      leg: leg,
      isFranchiseRoot
    });

    admin.wallet.balance += amount;
    admin.stats.totalBrokerage += amount;
    await admin.save();

    // Determine trading segment for ledger
    let tradingSegment = 'NSE/BSE';
    if (trade.exchange === 'MCX' || trade.segment === 'MCX' || trade.segment === 'MCXFUT' || trade.segment === 'MCXOPT') {
      tradingSegment = 'MCX';
    } else if (trade.isCrypto || trade.exchange === 'BINANCE') {
      tradingSegment = 'CRYPTO';
    } else if (trade.isForex || trade.exchange === 'FOREX') {
      tradingSegment = 'FOREX';
    }

    // Build reason with leg indicator and franchise root tag
    let reason = 'BROKERAGE';
    if (isFranchiseRoot) {
      reason = 'BROKERAGE(INDEPENDENT)';
    } else if (leg === 'OPEN') {
      reason = 'BROKERAGE_OPEN_LEG';
    } else if (leg === 'CLOSE') {
      reason = 'BROKERAGE_CLOSE_LEG';
    } else if (leg === 'OPEN+CLOSE') {
      reason = 'BROKERAGE';
    }

    await WalletLedger.create({
      ownerType: 'ADMIN',
      ownerId: admin._id,
      adminCode: admin.adminCode,
      type: 'CREDIT',
      reason: reason,
      amount: amount,
      balanceAfter: admin.wallet.balance,
      reference: { type: 'Trade', id: trade._id },
      description: `Brokerage from ${trade.tradeId} - ${description}${leg ? ` (${leg} LEG)` : ''}`,
      meta: {
        relatedUserId: trade.user,
        userName: user?.username || user?.name || 'Unknown',
        segment: tradingSegment,
        tradeSymbol: trade.symbol,
        tradeSide: trade.side,
        tradeQuantity: trade.quantity,
        leg: leg,
        isFranchiseRoot,
        ...(extraMeta && typeof extraMeta === 'object' ? extraMeta : {}),
      }
    });

    const pattiMeta = extraMeta && typeof extraMeta === 'object' ? extraMeta : {};
    if (admin.role !== 'SUPER_ADMIN' && pattiMeta.pattiSource !== 'individual_patti_parent') {
      const isPattiCredit = !!pattiMeta.pattiSharing;
      const kuberPct = resolveSaFundingKuberPct(admin, {
        isPattiCredit,
        pattiChildPct: pattiMeta.pattiChildPct,
      });
      if (kuberPct !== null) {
        await fundAdminShareFromSaWallets(amount, kuberPct, null, {
          relatedUserId: trade.user,
          targetAdminName: admin.name || admin.username,
          targetAdminCode: admin.adminCode,
          recipientIsFranchise: admin.isFranchiseRoot === true,
          fundingMode: admin.isFranchiseRoot === true ? 'franchise' : isPattiCredit ? 'patti' : 'normal',
          pattiChildPct: pattiMeta.pattiChildPct,
          pattiRootAdminId: pattiMeta.pattiRootAdminId,
          pattiRootAdminName: pattiMeta.pattiRootAdminName,
          pattiRootAdminCode: pattiMeta.pattiRootAdminCode,
          pattiSegmentKey: pattiMeta.pattiSegmentKey,
          chargeKind: 'BROKERAGE',
          reference: { type: 'Trade', id: trade._id },
        });
      }
    }
    
    console.log('[creditBrokerageToAdmin] Brokerage credited successfully:', {
      admin: admin.name,
      amount: amount,
      newBalance: admin.wallet.balance
    });
  }
  
  // Update live P&L for all open trades
  static async updateLivePnL(priceUpdates) {
    // priceUpdates = { 'SYMBOL': price, ... }
    const openTrades = await Trade.find({ status: 'OPEN' });
    
    for (const trade of openTrades) {
      const currentPrice = priceUpdates[trade.symbol];
      if (currentPrice) {
        trade.calculateUnrealizedPnL(currentPrice);
        await trade.save();
      }
    }
    
    // Update user unrealized P&L
    const userPnL = {};
    for (const trade of openTrades) {
      if (!userPnL[trade.user]) userPnL[trade.user] = 0;
      userPnL[trade.user] += trade.unrealizedPnL;
    }
    
    for (const [userId, pnl] of Object.entries(userPnL)) {
      await User.findByIdAndUpdate(userId, {
        'wallet.unrealizedPnL': pnl,
        'wallet.todayUnrealizedPnL': pnl
      });
    }
    
    return openTrades;
  }
  
  // RMS Check - Auto square-off if wallet goes negative
  static async runRMSCheck() {
    const users = await User.find({ isActive: true });
    const squaredOffTrades = [];
    
    for (const user of users) {
      const effectiveBalance = user.wallet.cashBalance + user.wallet.unrealizedPnL;
      
      if (effectiveBalance <= 0) {
        // Get open trades sorted by P&L (most loss first)
        const openTrades = await Trade.find({ 
          user: user._id, 
          status: 'OPEN' 
        }).sort({ unrealizedPnL: 1 });
        
        // Close trades one by one until balance is positive
        for (const trade of openTrades) {
          const exitPrice = trade.currentPrice || trade.entryPrice;
          await this.closeTrade(trade._id, exitPrice, 'RMS');
          squaredOffTrades.push(trade);
          
          // Refresh user balance
          const updatedUser = await User.findById(user._id);
          if (updatedUser.wallet.cashBalance > 0) break;
        }
      }
    }
    
    return squaredOffTrades;
  }
  
  // Convert intraday (MIS) positions to carry forward (NRML) at market close
  // Instead of square-off, we convert to carry forward with leverage adjustment
  static async runIntradayToCarryForward(segment = 'EQUITY') {
    const openTrades = await Trade.find({ 
      status: 'OPEN',
      productType: 'MIS',
      segment
    });
    
    const convertedTrades = [];
    const partiallyConvertedTrades = [];
    const failedTrades = [];
    
    for (const trade of openTrades) {
      try {
        const result = await this.convertIntradayToCarryForward(trade);
        if (result.fullyConverted) {
          convertedTrades.push(result);
        } else {
          partiallyConvertedTrades.push(result);
        }
      } catch (error) {
        console.error(`Failed to convert trade ${trade._id}:`, error.message);
        failedTrades.push({ trade, error: error.message });
      }
    }
    
    return { convertedTrades, partiallyConvertedTrades, failedTrades };
  }
  
  // Convert a single intraday trade to carry forward
  static async convertIntradayToCarryForward(trade) {
    const user = await User.findById(trade.user).populate('admin');
    if (!user) throw new Error('User not found');
    
    // Get segment-specific leverage settings (no hardcoding)
    const segmentSettings = await this.getUserSegmentSettings(user, trade.segment, trade.instrumentType);
    const intradayLeverage = trade.leverage || segmentSettings?.lotSettings?.intradayLeverage || 5;
    const carryForwardLeverage = segmentSettings?.lotSettings?.carryForwardLeverage || 1;
    
    // Calculate current margin used (intraday)
    const currentMarginUsed = trade.marginUsed;
    
    // Calculate required margin for carry forward (higher margin needed)
    const notionalValue = trade.entryPrice * trade.quantity;
    const requiredCarryForwardMargin = notionalValue / carryForwardLeverage;
    
    // Calculate additional margin needed
    const additionalMarginNeeded = requiredCarryForwardMargin - currentMarginUsed;
    
    // Calculate current unrealized P&L
    const currentPrice = trade.currentPrice || trade.entryPrice;
    const priceDiff = trade.side === 'BUY' 
      ? (currentPrice - trade.entryPrice) 
      : (trade.entryPrice - currentPrice);
    const unrealizedPnL = priceDiff * trade.quantity;
    
    // Check if MCX trade - use MCX wallet
    const isMcx = this.isMcxTrade(trade.segment, trade.exchange);
    const isCrypto = trade.isCrypto || trade.exchange === 'BINANCE' ||
      ['CRYPTOFUT', 'CRYPTOOPT'].includes(String(trade.segment || '').toUpperCase());
    const isForex = trade.isForex || trade.exchange === 'FOREX' ||
      ['FOREX', 'FOREXFUT', 'FOREXOPT'].includes(String(trade.segment || '').toUpperCase());

    // Available balance = wallet balance - used margin + unrealized profit (if positive)
    let availableBalance;
    if (isMcx) {
      const mcxBalance = user.mcxWallet?.balance || 0;
      const mcxUsedMargin = user.mcxWallet?.usedMargin || 0;
      availableBalance = mcxBalance - mcxUsedMargin;
    } else if (isCrypto) {
      const cryptoBalance = user.cryptoWallet?.balance || 0;
      const cryptoUsedMargin = user.cryptoWallet?.usedMargin || 0;
      availableBalance = cryptoBalance - cryptoUsedMargin;
    } else if (isForex) {
      const forexBalance = user.forexWallet?.balance || 0;
      const forexUsedMargin = user.forexWallet?.usedMargin || 0;
      availableBalance = forexBalance - forexUsedMargin;
    } else {
      availableBalance = user.wallet.cashBalance - user.wallet.usedMargin;
    }
    const availableWithProfit = availableBalance + Math.max(0, unrealizedPnL);
    
    let result = {
      tradeId: trade._id,
      symbol: trade.symbol,
      originalQuantity: trade.quantity,
      originalLots: trade.lots,
      intradayLeverage,
      carryForwardLeverage,
      currentMarginUsed,
      requiredCarryForwardMargin,
      additionalMarginNeeded,
      unrealizedPnL,
      fullyConverted: false
    };
    
    if (additionalMarginNeeded <= 0) {
      // No additional margin needed (rare case where carry forward leverage >= intraday)
      await Trade.updateOne(
        { _id: trade._id },
        { 
          productType: 'NRML',
          leverage: carryForwardLeverage,
          convertedFromIntraday: true,
          conversionTime: new Date()
        }
      );
      result.fullyConverted = true;
      result.newProductType = 'NRML';
      result.message = 'Converted to carry forward - no additional margin needed';
      
    } else if (availableWithProfit >= additionalMarginNeeded) {
      // User has enough balance (including profit) to cover additional margin
      
      // First, deduct from profit if available
      let deductedFromProfit = 0;
      let deductedFromBalance = additionalMarginNeeded;
      
      if (unrealizedPnL > 0) {
        deductedFromProfit = Math.min(unrealizedPnL, additionalMarginNeeded);
        deductedFromBalance = additionalMarginNeeded - deductedFromProfit;
      }
      
      // Update user's margin - use MCX wallet for MCX trades
      if (isMcx) {
        await User.updateOne(
          { _id: user._id },
          { $inc: { 'mcxWallet.usedMargin': additionalMarginNeeded } }
        );
      } else if (isCrypto) {
        await User.updateOne(
          { _id: user._id },
          { $inc: { 'cryptoWallet.usedMargin': additionalMarginNeeded } }
        );
      } else if (isForex) {
        await User.updateOne(
          { _id: user._id },
          { $inc: { 'forexWallet.usedMargin': additionalMarginNeeded } }
        );
      } else {
        await User.updateOne(
          { _id: user._id },
          { $inc: { 'wallet.usedMargin': additionalMarginNeeded } }
        );
      }
      
      // Update trade to carry forward
      await Trade.updateOne(
        { _id: trade._id },
        { 
          productType: 'NRML',
          leverage: carryForwardLeverage,
          marginUsed: requiredCarryForwardMargin,
          convertedFromIntraday: true,
          conversionTime: new Date(),
          conversionDetails: {
            additionalMarginDeducted: additionalMarginNeeded,
            deductedFromProfit,
            deductedFromBalance
          }
        }
      );
      
      // Create ledger entry for margin adjustment - use correct wallet
      let balanceAfterConversion;
      let walletDesc = '';
      if (isMcx) {
        balanceAfterConversion = (user.mcxWallet?.balance || 0) - (user.mcxWallet?.usedMargin || 0) - additionalMarginNeeded;
        walletDesc = ' (MCX)';
      } else if (isCrypto) {
        balanceAfterConversion = (user.cryptoWallet?.balance || 0) - (user.cryptoWallet?.usedMargin || 0) - additionalMarginNeeded;
        walletDesc = ' (Crypto)';
      } else if (isForex) {
        balanceAfterConversion = (user.forexWallet?.balance || 0) - (user.forexWallet?.usedMargin || 0) - additionalMarginNeeded;
        walletDesc = ' (Forex)';
      } else {
        balanceAfterConversion = user.wallet.cashBalance - user.wallet.usedMargin - additionalMarginNeeded;
      }
      await WalletLedger.create({
        ownerType: 'USER',
        ownerId: user._id,
        userId: user.userId,
        adminCode: user.adminCode,
        type: 'DEBIT',
        reason: 'MARGIN_ADJUSTMENT',
        amount: additionalMarginNeeded,
        balanceAfter: balanceAfterConversion,
        reference: { type: 'Trade', id: trade._id },
        description: `Intraday to Carry Forward conversion - ${trade.symbol}${walletDesc}`
      });
      
      result.fullyConverted = true;
      result.newProductType = 'NRML';
      result.deductedFromProfit = deductedFromProfit;
      result.deductedFromBalance = deductedFromBalance;
      result.message = 'Converted to carry forward - additional margin deducted';
      
    } else {
      // Not enough balance - need to reduce position size
      // Calculate how many lots can be converted with available margin
      const marginPerLot = requiredCarryForwardMargin / trade.lots;
      const totalAvailableForConversion = currentMarginUsed + availableWithProfit;
      const lotsCanConvert = Math.floor(totalAvailableForConversion / marginPerLot);
      
      if (lotsCanConvert <= 0) {
        // Cannot convert any lots - close the entire position with AUTO_SQUARE reason
        const exitPrice = trade.currentPrice || trade.entryPrice;
        await this.closeTrade(trade._id, exitPrice, 'AUTO_SQUARE');
        
        result.fullyConverted = false;
        result.action = 'CLOSED';
        result.message = 'Position auto-squared - insufficient margin for carry forward';
        result.closedQuantity = trade.quantity;
        
      } else {
        // Partial conversion - convert some lots, close the rest
        const lotsToClose = trade.lots - lotsCanConvert;
        const quantityToClose = lotsToClose * (trade.lotSize || 1);
        const quantityToKeep = lotsCanConvert * (trade.lotSize || 1);
        
        // Calculate margin for kept position
        const newMarginRequired = marginPerLot * lotsCanConvert;
        const marginToRelease = currentMarginUsed - newMarginRequired;
        
        // Close partial position
        const exitPrice = trade.currentPrice || trade.entryPrice;
        const pnlPerUnit = trade.side === 'BUY' 
          ? (exitPrice - trade.entryPrice) 
          : (trade.entryPrice - exitPrice);
        const closedPnL = pnlPerUnit * quantityToClose;
        const balancePnL = profitAllowedForWallet(user, 'nseBse', closedPnL);
        
        // Update user wallet - release margin for closed portion, add P&L
        // Use separate wallets for crypto and forex
        if (isMcx) {
          // MCX: Release usedMargin and add P&L to balance
          const currentMcxBalance = user.mcxWallet?.balance || 0;
          const newMcxBalance = currentMcxBalance + closedPnL;
          await User.updateOne(
            { _id: user._id },
            {
              $inc: {
                'mcxWallet.usedMargin': -marginToRelease,
                'mcxWallet.realizedPnL': closedPnL,
                'mcxWallet.todayRealizedPnL': closedPnL
              },
              $set: {
                'mcxWallet.balance': newMcxBalance
              }
            }
          );
        } else if (isCrypto) {
          await User.updateOne(
            { _id: user._id },
            {
              $inc: {
                'cryptoWallet.usedMargin': -marginToRelease,
                'cryptoWallet.balance': closedPnL,
                'cryptoWallet.realizedPnL': closedPnL,
                'cryptoWallet.todayRealizedPnL': closedPnL
              }
            }
          );
        } else if (isForex) {
          await User.updateOne(
            { _id: user._id },
            {
              $inc: {
                'forexWallet.usedMargin': -marginToRelease,
                'forexWallet.balance': closedPnL,
                'forexWallet.realizedPnL': closedPnL,
                'forexWallet.todayRealizedPnL': closedPnL
              }
            }
          );
        } else {
          await User.updateOne(
            { _id: user._id },
            {
              $inc: {
                'wallet.usedMargin': -marginToRelease,
                'wallet.cashBalance': balancePnL
              }
            }
          );
        }
        
        // Update trade with reduced quantity and carry forward
        await Trade.updateOne(
          { _id: trade._id },
          { 
            productType: 'NRML',
            leverage: carryForwardLeverage,
            quantity: quantityToKeep,
            lots: lotsCanConvert,
            marginUsed: newMarginRequired,
            convertedFromIntraday: true,
            conversionTime: new Date(),
            partialClose: {
              closedQuantity: quantityToClose,
              closedLots: lotsToClose,
              closedPnL,
              closeReason: 'AUTO_SQUARE'
            }
          }
        );
        
        // Create ledger entry - use correct wallet
        let partialCloseBalance;
        let walletDesc = '';
        if (isMcx) {
          partialCloseBalance = (user.mcxWallet?.balance || 0) + closedPnL;
          walletDesc = ' (MCX)';
        } else if (isCrypto) {
          partialCloseBalance = (user.cryptoWallet?.balance || 0) + closedPnL;
          walletDesc = ' (Crypto)';
        } else if (isForex) {
          partialCloseBalance = (user.forexWallet?.balance || 0) + closedPnL;
          walletDesc = ' (Forex)';
        } else {
          partialCloseBalance = user.wallet.cashBalance + balancePnL;
        }
        const ledgerPnL = isMcx || isCrypto || isForex ? closedPnL : balancePnL;
        await WalletLedger.create({
          ownerType: 'USER',
          ownerId: user._id,
          userId: user.userId,
          adminCode: user.adminCode,
          type: ledgerPnL >= 0 ? 'CREDIT' : 'DEBIT',
          reason: 'PARTIAL_CLOSE',
          amount: Math.abs(ledgerPnL),
          balanceAfter: partialCloseBalance,
          reference: { type: 'Trade', id: trade._id },
          description: `Partial close for carry forward conversion - ${trade.symbol} (${lotsToClose} lots)${walletDesc}`
        });
        
        result.fullyConverted = false;
        result.action = 'PARTIAL_CONVERSION';
        result.newProductType = 'NRML';
        result.keptLots = lotsCanConvert;
        result.closedLots = lotsToClose;
        result.closedPnL = closedPnL;
        result.message = `Partially converted - ${lotsCanConvert} lots kept, ${lotsToClose} lots closed`;
      }
    }
    
    return result;
  }
  
  // Legacy square-off method (kept for manual square-off)
  static async runIntradaySquareOff(segment = 'EQUITY') {
    const openTrades = await Trade.find({ 
      status: 'OPEN',
      productType: 'MIS',
      segment
    });
    
    const squaredOffTrades = [];
    
    for (const trade of openTrades) {
      const exitPrice = trade.currentPrice || trade.entryPrice;
      await this.closeTrade(trade._id, exitPrice, 'TIME_BASED');
      squaredOffTrades.push(trade);
    }
    
    return squaredOffTrades;
  }
  
  // Get user's open positions
  static async getOpenPositions(userId) {
    return Trade.find({ user: userId, status: 'OPEN' }).sort({ openedAt: -1 });
  }
  
  // Get user's closed positions
  static async getClosedPositions(userId, limit = 50) {
    return Trade.find({ user: userId, status: 'CLOSED' })
      .sort({ closedAt: -1 })
      .limit(limit);
  }
  
  // Get admin's all trades
  static async getAdminTrades(adminCode, status = null) {
    const query = { adminCode };
    if (status) query.status = status;
    return Trade.find(query).sort({ openedAt: -1 });
  }
  
  // Get trade summary for user
  static async getUserTradeSummary(userId) {
    const openTrades = await Trade.find({ user: userId, status: 'OPEN' });
    const todayTrades = await Trade.find({
      user: userId,
      status: 'CLOSED',
      closedAt: { $gte: new Date().setHours(0, 0, 0, 0) }
    });
    
    const totalUnrealizedPnL = openTrades.reduce((sum, t) => sum + t.unrealizedPnL, 0);
    const todayRealizedPnL = todayTrades.reduce((sum, t) => sum + t.netPnL, 0);
    const totalMarginUsed = openTrades.reduce((sum, t) => sum + t.marginUsed, 0);
    
    return {
      openPositions: openTrades.length,
      todayTrades: todayTrades.length,
      totalUnrealizedPnL,
      todayRealizedPnL,
      totalMarginUsed
    };
  }
}

export default TradeService;
