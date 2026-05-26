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
import { resolvePattiSplitForTrade, splitByChildPercent } from './pattiTradeSettlement.js';
import { 
  trackHierarchyEarnings 
} from './superAdminEarningsService.js';
import brokerageHierarchySharingService from './brokerageHierarchySharingService.js';
import { resolveSegmentCommissionType } from '../utils/segmentCommissionType.js';

/**
 * Checks if any admin in the hierarchy chain is marked as a franchise root.
 * Returns the franchise root admin if found, null otherwise.
 */
function findFranchiseRootInChain(hierarchyChain) {
  for (const { admin } of hierarchyChain) {
    if (admin.isFranchiseRoot === true) {
      return admin;
    }
  }
  return null;
}

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

    const margin = notionalValue / leverage;
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
      if (!Number.isFinite(n) || n <= 1) continue;
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
      if (Number(qtyLev) > 1) exposure = Number(qtyLev);
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

  /** Exchange contract lot (e.g. NIFTY 25) — not the qty-mode trading unit of 1. */
  static getContractLotSize(instrument, orderData) {
    const segU = String(orderData?.segment || '').toUpperCase();
    if (segU === 'CRYPTOFUT' || segU === 'CRYPTOOPT') return 1;
    if (instrument?.lotSize > 0) return Number(instrument.lotSize);
    if (orderData?.lotSize > 0) return Number(orderData.lotSize);
    return 1;
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
    console.log(`[_sliceFromHierarchy] segmentKey: ${segmentKey}, parentSegmentPerms:`, parentSegmentPerms ? 'exists' : 'null');
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
        if (k === 'cryptoStartTime' || k === 'cryptoClosingTime') {
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
    if (commType === 'PER_CRORE' || commType === 'PER_TRADE') {
      if (m.commission === 0 && hierPlain?.commission > 0) {
        m.commission = hierPlain.commission;
        console.log('[_mergeSegmentStack] Inherited admin commission:', m.commission, 'for type:', commType);
      }
    } else if (commType === 'PER_LOT') {
      if (m.commissionLot === 0 && hierPlain?.commissionLot > 0) {
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
    if (!result || (!result.enabled && !result.commission && !result.commissionLot)) {
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

    // Inherit commission fields from SystemSettings when hierarchy/user left them empty
    if (result && systemSlicePlain) {
      const commType = resolveSegmentCommissionType(
        result.commissionType,
        systemSlicePlain.commissionType
      );
      if (commType && !result.commissionType) result.commissionType = commType;
      if (
        (commType === 'PER_CRORE' || commType === 'PER_TRADE') &&
        !result.commission &&
        systemSlicePlain.commission > 0
      ) {
        result.commission = systemSlicePlain.commission;
      }
      if (
        (commType === 'PER_LOT' || commType === 'PER_QUANTITY' || !commType) &&
        !result.commissionLot &&
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
   * Extra commission from instrument.additionalCharges (per trade / per lot / per crore, ₹ or %).
   * Applied after script/segment brokerage.
   * Legacy: if per*Enabled flags are absent, any positive numeric field applies (INR), same as before.
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
  
  // Calculate brokerage based on user settings with caps enforcement
  static async calculateUserBrokerage(segmentSettings, scriptSettings, tradeData, lots, brokerageCaps = null) {
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

    // Fallback: if segmentSettings is empty or has no commission, try SystemSettings
    if (!segmentSettings || (!segmentSettings.enabled && !segmentSettings.commission && !segmentSettings.commissionLot)) {
      const sysRaw = await SystemSettings.getSettings();
      const admDefaults = TradeService._segmentMapPlain(sysRaw?.adminSegmentDefaults);
      const segmentKey = TradeService.resolveMarketWatchSegmentKey(tradeData.segment, tradeData.instrumentType);
      const sysSlice = admDefaults[segmentKey];
      if (sysSlice) {
        segmentSettings = { ...sysSlice, ...segmentSettings };
        console.log('[calculateUserBrokerage] Using SystemSettings defaults for segment:', segmentKey, 'sysSlice:', sysSlice);
      }
    }

    // Final fallback: if still no commission, use sensible defaults for crypto segments
    const isCrypto = tradeData.isCrypto || tradeData.exchange === 'BINANCE' ||
      ['CRYPTOFUT', 'CRYPTOOPT'].includes(String(tradeData.segment || '').toUpperCase());
    if (isCrypto && (!segmentSettings?.commission && !segmentSettings?.commissionLot)) {
      console.log('[calculateUserBrokerage] Using final fallback defaults for crypto segment');
      segmentSettings = segmentSettings || {};
      segmentSettings.enabled = true;
      segmentSettings.commission = 2000;
      segmentSettings.commissionType = 'PER_CRORE';
      segmentSettings.commissionUnit = null;
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
     * @param {number} commission — always in ₹ (per lot/qty, per trade, or per crore turnover)
     */
    const calcBrokerage = (commType, commission) => {
      commissionType = commType; // Store for cap enforcement
      if (commType === 'PER_LOT') return commission * exchangeLots;
      if (commType === 'PER_QUANTITY') return commission * orderQty;
      if (commType === 'PER_TRADE') return commission;
      if (commType === 'PER_CRORE') return (turnover / ONE_CRORE) * commission;
      return commission * exchangeLots;
    };
    
    // First check script-specific settings
    if (scriptSettings?.brokerage) {
      commissionType = 'PER_LOT'; // Script settings are per lot
      if (isOptionBuy) {
        brokerage = isIntraday ? scriptSettings.brokerage.optionBuyIntraday : scriptSettings.brokerage.optionBuyCarry;
      } else if (isOptionSell) {
        brokerage = isIntraday ? scriptSettings.brokerage.optionSellIntraday : scriptSettings.brokerage.optionSellCarry;
      } else {
        brokerage = isIntraday ? scriptSettings.brokerage.intradayFuture : scriptSettings.brokerage.carryFuture;
      }
      brokerage = brokerage * exchangeLots;
    } else {
      // Fall back to segment settings
      if (isOptionBuy && segmentSettings?.optionBuy) {
        const ob = segmentSettings.optionBuy;
        const commType = ob.commissionType || 'PER_LOT';
        const commission = ob.commission || 0;
        brokerage = calcBrokerage(commType, commission);
      } else if (isOptionSell && segmentSettings?.optionSell) {
        const os = segmentSettings.optionSell;
        const commType = os.commissionType || 'PER_LOT';
        const commission = os.commission || 0;
        brokerage = calcBrokerage(commType, commission);
      } else {
        const commType = segmentSettings?.commissionType || 'PER_LOT';
        // Use commission field for PER_CRORE, commissionLot for PER_LOT/PER_QUANTITY/PER_TRADE
        const commission = commType === 'PER_CRORE' 
          ? (segmentSettings?.commission || 0)
          : (segmentSettings?.commissionLot || 0);
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

    // Defensive: ensure crypto segments always have brokerage (regardless of enabled flag)
    if (isCrypto && brokerage === 0) {
      console.log('[calculateUserBrokerage] Crypto brokerage is 0, forcing calculation with defaults');
      const fallbackCommType = segmentSettings?.commissionType || 'PER_CRORE';
      const fallbackComm = segmentSettings?.commission || 2000;
      if (fallbackCommType === 'PER_CRORE') {
        brokerage = (turnover / ONE_CRORE) * fallbackComm;
        commissionType = 'PER_CRORE';
      } else {
        brokerage = fallbackComm * exchangeLots;
        commissionType = 'PER_LOT';
      }
      console.log('[calculateUserBrokerage] Forced brokerage:', brokerage, 'commissionType:', commissionType);
    }

    console.log('[calculateUserBrokerage] Output:', {
      finalBrokerage: brokerage,
      commissionType: commissionType,
      turnover: turnover,
      crores: turnover / 10000000
    });
    
    return brokerage;
  }
  
  // Calculate spread based on user settings
  static calculateUserSpread(scriptSettings, side) {
    if (!scriptSettings?.spread) return 0;
    return side === 'BUY' ? (scriptSettings.spread.buy || 0) : (scriptSettings.spread.sell || 0);
  }

  /** USDT adjustment per side on client USD spot quotes: USD field wins, else half of INR total width converted to USD. */
  static segmentCryptoSpreadHalfUsd(segmentSettings) {
    const usdSide = Number(segmentSettings?.cryptoSpreadUsdPerSide);
    if (Number.isFinite(usdSide) && usdSide > 0) return usdSide;
    const w = Number(segmentSettings?.cryptoSpreadInr);
    if (!Number.isFinite(w) || w <= 0) return 0;
    return (w / 2);
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
          if (n > 1) {
            exposureNum = n;
            break;
          }
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

      // Force apply quantityModeSettings leverage if set and > 1
      if (exposureNum === 1 && segmentSettingsForMargin?.quantityModeSettings) {
        const qtyLeverage = isIntraday 
          ? segmentSettingsForMargin.quantityModeSettings.intradayLeverage
          : segmentSettingsForMargin.quantityModeSettings.carryForwardLeverage;
        if (qtyLeverage && Number(qtyLeverage) > 1) {
          exposureNum = Number(qtyLeverage);
          console.log('[OrderPlacement] Forcing quantityModeSettings leverage:', exposureNum);
        }
      }

      if (exposureNum > 1) {
        leverage = exposureNum;
        console.log('[OrderPlacement] Leverage after segment_exposure:', leverage);
      }
    }

    // 7. Calculate lot size - fetch from database if not provided
    let lotSize = tradeData.lotSize;
    if (!lotSize || lotSize <= 0) {
      try {
        lotSize =
          instrumentDoc?.lotSize > 0
            ? instrumentDoc.lotSize
            : 1;
        if (lotSize <= 0) lotSize = 1;
      } catch (error) {
        console.error('Error fetching lot size:', error.message);
        lotSize = 1;
      }
    }
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
    const qty = Number(tradeData.quantity) || 0;
    let lots =
      tradeData.lots != null && tradeData.lots !== '' && Number.isFinite(Number(tradeData.lots))
        ? Number(tradeData.lots)
        : lotSize > 0
          ? (orderIsUsdSpot(tradeData) ? qty / lotSize : Math.ceil(qty / lotSize))
          : 1;
    
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
    
    // 8. Calculate spread from user settings (script + optional crypto USD spot segment markup)
    const spreadScript = this.calculateUserSpread(scriptSettings, tradeData.side);
    const spreadSegUsd =
      (isCrypto || isForex) && Number.isFinite(tradeData.entryPrice)
        ? this.segmentCryptoSpreadHalfUsd(segmentSettings)
        : 0;
    const spread = spreadScript + spreadSegUsd;

    let effectiveEntryPrice = tradeData.entryPrice;
    if (spread > 0) {
      if (tradeData.side === 'BUY') {
        effectiveEntryPrice = tradeData.entryPrice + spread;
      } else {
        effectiveEntryPrice = tradeData.entryPrice - spread;
      }
    }
    
    // 9. Calculate brokerage from user settings with caps from admin + instrument flat charges
    const marginPrice = effectiveEntryPrice;
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

    const userSegmentSettingsForBrk = await this.getUserSegmentSettings(user, tradeData.segment, tradeData.instrumentType);
    const turnoverForBrk = marginPrice * (tradeData.quantity || 0);
    const ONE_CRORE_BRK = 10_000_000;
    let pureBrokerage = 0;
    if (userSegmentSettingsForBrk.commissionType === 'PER_CRORE') {
      const commValue = userSegmentSettingsForBrk.commission || userSegmentSettingsForBrk.commissionLot || 0;
      pureBrokerage = (turnoverForBrk / ONE_CRORE_BRK) * commValue * 2;
    } else if (userSegmentSettingsForBrk.commissionType === 'PER_LOT') {
      const commValue = userSegmentSettingsForBrk.commissionLot || userSegmentSettingsForBrk.commission || 0;
      pureBrokerage = commValue * (tradeData.lots || lots) * 2;
    } else if (userSegmentSettingsForBrk.commissionType === 'PER_TRADE') {
      pureBrokerage = (userSegmentSettingsForBrk.commission || 0) * 2;
    }
    pureBrokerage = Math.round(pureBrokerage * 100) / 100;
    const roundTripBrokerage =
      pureBrokerage > 0 ? pureBrokerage : Math.round(brokerage * 2 * 100) / 100;

    // 11. Validate margin + brokerage headroom on segment wallets
    if (isMcx) {
      const bal = user.mcxWallet?.balance || 0;
      const um = user.mcxWallet?.usedMargin || 0;
      const free = bal - um;
      const need = requiredMargin + roundTripBrokerage;
      if (need > free) {
        throw new Error(
          `Insufficient margin in MCX Account. Required: ${need.toFixed(2)} ` +
            `(margin ${requiredMargin.toFixed(2)} + brokerage ${roundTripBrokerage.toFixed(2)}), Available: ${free.toFixed(2)}`
        );
      }
    } else if (isCrypto) {
      const bal = user.cryptoWallet?.balance || 0;
      const um = user.cryptoWallet?.usedMargin || 0;
      const free = bal - um;
      const need = requiredMargin + roundTripBrokerage;
      if (need > free) {
        throw new Error(
          `Insufficient margin in Crypto Account. Required: ${need.toFixed(2)} ` +
            `(margin ${requiredMargin.toFixed(2)} + brokerage ${roundTripBrokerage.toFixed(2)}), Available: ${free.toFixed(2)}`
        );
      }
    } else if (isForex) {
      const bal = user.forexWallet?.balance || 0;
      const um = user.forexWallet?.usedMargin || 0;
      const free = bal - um;
      const need = requiredMargin + roundTripBrokerage;
      if (need > free) {
        throw new Error(
          `Insufficient margin in Forex Account. Required: ${need.toFixed(2)} ` +
            `(margin ${requiredMargin.toFixed(2)} + brokerage ${roundTripBrokerage.toFixed(2)}), Available: ${free.toFixed(2)}`
        );
      }
    } else {
      const { getNseBseBalance, getNseBseUsedMargin } = await import('../utils/nseBseWallet.js');
      const tb = getNseBseBalance(user);
      const um = getNseBseUsedMargin(user);
      const free = tb - um;
      const need = requiredMargin + roundTripBrokerage;
      if (need > free) {
        throw new Error(
          `Insufficient margin in NSE & BSE Wallet. Required: ${need.toFixed(2)} ` +
            `(margin ${requiredMargin.toFixed(2)} + brokerage ${roundTripBrokerage.toFixed(2)}), Available: ${free.toFixed(2)}`
        );
      }
    }

    // 12. Block margin + round-trip brokerage in usedMargin (wallet balance unchanged)
    const marginInc = requiredMargin + roundTripBrokerage;
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
      commission: roundTripBrokerage,
      totalCharges: roundTripBrokerage,
      brokeragePrepaidRoundTrip: true,
      brokerageReservedInMargin: roundTripBrokerage > 0,
      walletBrokerageDebited: false
    });

    console.log('[TradeService] Pure brokerage for distribution:', roundTripBrokerage, 'user commission rate:', userSegmentSettingsForBrk.commission, userSegmentSettingsForBrk.commissionType);
    console.log('[TradeService] Distribution check:', { admin: admin.name, adminRole: admin.role, userIsDemo: user.isDemo, userAdmin: user.admin });

    // Process FULL brokerage distribution (open+close) on position OPEN
    // Full round-trip brokerage is credited to hierarchy when position opens
    console.log('[TradeService] Brokerage distribution check:', {
      tradeId: trade._id,
      brokerage: roundTripBrokerage,
      admin: admin.name,
      user: user.userId,
      adminRole: admin.role
    });
    if (roundTripBrokerage > 0 && !user.isDemo) {
      setTimeout(async () => {
        try {
          console.log('[TradeService] Calling distributeBrokerage for full round-trip:', trade._id, 'amount:', roundTripBrokerage);
          await this.distributeBrokerage(trade, roundTripBrokerage, admin, user, 'OPEN+CLOSE');
          console.log('[TradeService] Full brokerage distributed on trade open:', trade._id, roundTripBrokerage);
        } catch (error) {
          console.error('[TradeService] Error processing brokerage distribution on trade open:', error);
        }
      }, 1000); // 1 second delay to ensure trade is fully processed
    } else {
      console.log('[TradeService] Brokerage is 0, skipping distribution on trade open:', trade._id);
    }

    void import('./marginMonitorService.js').then((m) => m.invalidateMarginOpenTradesCache?.());

    return trade;
  }
  
  // Close a trade
  static async closeTrade(tradeId, exitPrice, reason = 'MANUAL') {
    const trade = await Trade.findById(tradeId);
    if (!trade) throw new Error('Trade not found');
    if (trade.status !== 'OPEN') throw new Error('Trade is not open');
    
    // Get user and admin
    const user = await User.findById(trade.user).populate('admin');
    const admin = await Admin.findOne({ adminCode: trade.adminCode });
    
    // Calculate charges
    trade.exitPrice = exitPrice;
    const charges = await Charges.calculateCharges(trade, trade.adminCode, trade.user);
    trade.charges = charges;
    
    // Close trade and calculate P&L
    trade.closeTrade(exitPrice, reason);
    
    // Check if MCX trade - use MCX wallet
    const isMcx = this.isMcxTrade(trade.segment, trade.exchange);
    
    // Release margin and book P&L - use updateOne to avoid validation issues
    const isCrypto = trade.isCrypto || trade.exchange === 'BINANCE' ||
      ['CRYPTOFUT', 'CRYPTOOPT'].includes(String(trade.segment || '').toUpperCase());
    const isForex = trade.isForex || trade.exchange === 'FOREX' ||
      ['FOREX', 'FOREXFUT', 'FOREXOPT'].includes(String(trade.segment || '').toUpperCase());

    const marginRelease = (trade.marginUsed || 0) +
      (trade.brokerageReservedInMargin ? (Number(trade.commission) || 0) : 0);

    if (isMcx) {
      const walletPnl = trade.realizedPnL ?? trade.netPnL ?? 0;
      const currentMcxBalance = user.mcxWallet?.balance || 0;
      const newMcxBalance = currentMcxBalance + walletPnl;
      await User.updateOne(
        { _id: user._id },
        { $inc: {
          'mcxWallet.usedMargin': -marginRelease,
          'mcxWallet.realizedPnL': walletPnl,
          'mcxWallet.todayRealizedPnL': walletPnl
        }, $set: {
          'mcxWallet.balance': newMcxBalance
        }}
      );
    } else if (isCrypto) {
      const walletPnl = trade.realizedPnL ?? trade.netPnL ?? 0;
      await User.updateOne(
        { _id: user._id },
        { $inc: {
          'cryptoWallet.usedMargin': -marginRelease,
          'cryptoWallet.balance': walletPnl,
          'cryptoWallet.realizedPnL': walletPnl,
          'cryptoWallet.todayRealizedPnL': walletPnl
        }}
      );
    } else if (isForex) {
      const walletPnl = trade.realizedPnL ?? trade.netPnL ?? 0;
      await User.updateOne(
        { _id: user._id },
        { $inc: {
          'forexWallet.usedMargin': -marginRelease,
          'forexWallet.balance': walletPnl,
          'forexWallet.realizedPnL': walletPnl,
          'forexWallet.todayRealizedPnL': walletPnl
        }}
      );
    } else {
      const walletPnl = trade.brokeragePrepaidRoundTrip
        ? (trade.realizedPnL ?? trade.netPnL ?? 0)
        : (trade.netPnL ?? 0);
      await User.updateOne(
        { _id: user._id },
        { $inc: {
          'nseBseWallet.usedMargin': -marginRelease,
          'wallet.blocked': -(trade.marginUsed || 0),
          'nseBseWallet.balance': walletPnl,
          'wallet.realizedPnL': walletPnl,
          'wallet.todayRealizedPnL': walletPnl
        }}
      );
    }
    
    await trade.save();
    
    // Create ledger entry for user - use correct wallet balance
    let balanceAfter;
    if (isMcx) {
      balanceAfter = user.mcxWallet?.balance || 0;
    } else if (isCrypto) {
      balanceAfter = user.cryptoWallet?.balance || 0;
    } else if (isForex) {
      balanceAfter = user.forexWallet?.balance || 0;
    } else {
      const { getNseBseBalance: gnb } = await import('../utils/nseBseWallet.js');
      balanceAfter = gnb(user);
    }

    let walletDesc = '';
    let ledgerSegment = 'NSE/BSE';
    if (isMcx) {
      walletDesc = ' (MCX)';
      ledgerSegment = 'MCX';
    } else if (isCrypto) {
      walletDesc = ' (Crypto)';
      ledgerSegment = 'CRYPTO';
    } else if (isForex) {
      walletDesc = ' (Forex)';
      ledgerSegment = 'FOREX';
    } else {
      walletDesc = ' (NSE/BSE)';
    }

    await WalletLedger.create({
      ownerType: 'USER',
      ownerId: user._id,
      adminCode: user.adminCode,
      type: trade.netPnL >= 0 ? 'CREDIT' : 'DEBIT',
      reason: 'TRADE_PNL',
      amount: Math.abs(trade.netPnL),
      balanceAfter: balanceAfter,
      reference: { type: 'Trade', id: trade._id },
      description: `${trade.symbol} ${trade.side} P&L${walletDesc}`,
      meta: { segment: ledgerSegment, tradeId: trade.tradeId || String(trade._id) },
    });
    
    // Calculate pure brokerage from user's commission rate (not charges.brokerage which uses fixed rate)
    const userSegmentSettings = await this.getUserSegmentSettings(user, trade.segment, trade.instrumentType);
    const turnover = trade.entryPrice * trade.quantity;
    const ONE_CRORE = 10_000_000;
    let pureBrokerage = 0;
    
    if (userSegmentSettings.commissionType === 'PER_CRORE') {
      const commValue = userSegmentSettings.commission || userSegmentSettings.commissionLot || 0;
      pureBrokerage = (turnover / ONE_CRORE) * commValue * 2; // round-trip
    } else if (userSegmentSettings.commissionType === 'PER_LOT') {
      const commValue = userSegmentSettings.commissionLot || userSegmentSettings.commission || 0;
      pureBrokerage = commValue * (trade.lots || 1) * 2; // round-trip
    } else if (userSegmentSettings.commissionType === 'PER_TRADE') {
      pureBrokerage = (userSegmentSettings.commission || 0) * 2; // round-trip
    }
    pureBrokerage = Math.round(pureBrokerage * 100) / 100;
    
    console.log('[TradeService] Pure brokerage from user commission rate:', pureBrokerage, 'charges.brokerage:', charges.brokerage);
    
    // Brokerage already fully distributed on trade OPEN (open+close combined)
    // No brokerage distribution needed on close
    console.log('[TradeService] Trade close - no brokerage distribution (already done on open):', trade._id);

    void import('./marginMonitorService.js').then((m) => m.invalidateMarginOpenTradesCache?.());

    return trade;
  }
  
  /** Split B_BOOK counterparty P&L between book admin and parent using patti % (same as brokerage when patti applies). */
  static async applyBBookAdminPnLSplit(trade, directAdmin, user, totalAdminPnL) {
    if (!directAdmin || !Number.isFinite(totalAdminPnL) || totalAdminPnL === 0) return;

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

    // If franchise root exists, P&L stays within franchise subtree only
    // Platform charges are handled in brokerage distribution, not here
    if (franchiseRoot) {
      console.log('[applyBBookAdminPnLSplit] Franchise root detected - P&L stays within subtree:', {
        franchiseRoot: franchiseRoot.name,
        totalAdminPnL
      });

      // Distribute P&L within franchise subtree using patti logic
      const split = await resolvePattiSplitForTrade(directAdmin, user, trade);
      
      // Check if parent is within franchise subtree (not above franchise root)
      let parentInSubtree = true;
      if (split.parentAdmin) {
        // Build franchise subtree admin IDs
        const subtreeIds = new Set();
        let current = franchiseRoot;
        while (current) {
          subtreeIds.add(current._id.toString());
          if (current.role === 'SUPER_ADMIN' || !current.parentId) break;
          current = await Admin.findById(current.parentId);
        }
        // Check if parent is in subtree
        parentInSubtree = subtreeIds.has(split.parentAdmin._id.toString());
        
        if (!parentInSubtree) {
          console.log('[applyBBookAdminPnLSplit] Parent is outside franchise subtree, ignoring patti split');
          split.parentAdmin = null;
          split.childPct = 100;
        }
      }
      
      if (!split.parentAdmin || split.childPct >= 100) {
        directAdmin.tradingPnL.realized += totalAdminPnL;
        directAdmin.tradingPnL.todayRealized += totalAdminPnL;
        directAdmin.stats.totalPnL += totalAdminPnL;
        await directAdmin.save();
        console.log('[applyBBookAdminPnLSplit] P&L credited to directAdmin:', totalAdminPnL);
        return;
      }

      const { child, parent } = splitByChildPercent(totalAdminPnL, split.childPct);
      directAdmin.tradingPnL.realized += child;
      directAdmin.tradingPnL.todayRealized += child;
      directAdmin.stats.totalPnL += child;
      await directAdmin.save();

      const pa = await Admin.findById(split.parentAdmin._id);
      if (pa && pa.status === 'ACTIVE') {
        pa.tradingPnL.realized += parent;
        pa.tradingPnL.todayRealized += parent;
        pa.stats.totalPnL += parent;
        await pa.save();
        console.log('[applyBBookAdminPnLSplit] P&L split within subtree - child:', child, 'parent:', parent);
      }
      return;
    }

    // No franchise root - use normal patti distribution
    const split = await resolvePattiSplitForTrade(directAdmin, user, trade);
    if (!split.parentAdmin || split.childPct >= 100) {
      directAdmin.tradingPnL.realized += totalAdminPnL;
      directAdmin.tradingPnL.todayRealized += totalAdminPnL;
      directAdmin.stats.totalPnL += totalAdminPnL;
      await directAdmin.save();
      return;
    }

    const { child, parent } = splitByChildPercent(totalAdminPnL, split.childPct);
    directAdmin.tradingPnL.realized += child;
    directAdmin.tradingPnL.todayRealized += child;
    directAdmin.stats.totalPnL += child;
    await directAdmin.save();

    const pa = await Admin.findById(split.parentAdmin._id);
    if (pa && pa.status === 'ACTIVE') {
      pa.tradingPnL.realized += parent;
      pa.tradingPnL.todayRealized += parent;
      pa.stats.totalPnL += parent;
      await pa.save();
    }
  }

  /** Book admin + parent split when patti resolves; else legacy hierarchy distribution. */
  static async distributeBrokerageWithPatti(trade, totalBrokerage, directAdmin, user, leg = null) {
    if (!totalBrokerage || totalBrokerage <= 0 || user?.isDemo || !directAdmin) return;

    const split = await resolvePattiSplitForTrade(directAdmin, user, trade);
    if (!split.parentAdmin || split.childPct >= 100) {
      await this.distributeBrokerage(trade, totalBrokerage, directAdmin, user, leg);
      return;
    }

    const { child, parent } = splitByChildPercent(totalBrokerage, split.childPct);
    if (child > 0) {
      await this.creditBrokerageToAdmin(
        directAdmin,
        child,
        trade,
        `Book admin ${split.childPct}% (${split.source})`,
        user,
        leg,
        directAdmin.isFranchiseRoot
      );
    }
    if (parent > 0) {
      const pa = await Admin.findById(split.parentAdmin._id);
      if (pa && pa.status === 'ACTIVE') {
        await this.creditBrokerageToAdmin(
          pa,
          parent,
          trade,
          `Parent ${100 - split.childPct}% (${split.source})`,
          user,
          leg,
          pa.isFranchiseRoot
        );
      } else {
        await this.creditBrokerageToAdmin(
          directAdmin,
          parent,
          trade,
          `Parent share (${100 - split.childPct}%) — parent inactive, credited to book admin`,
          user,
          leg,
          directAdmin.isFranchiseRoot
        );
      }
    }
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

  /** User-visible ledger row when round-trip brokerage is charged at open. */
  static async recordUserBrokerageLedgerOnOpen(trade, user) {
    const amount = Math.round((Number(trade?.commission) || 0) * 100) / 100;
    if (amount <= 0 || !user?._id || !trade?._id) return;

    const existing = await WalletLedger.findOne({
      ownerType: 'USER',
      ownerId: user._id,
      reason: 'BROKERAGE',
      'reference.type': 'Trade',
      'reference.id': trade._id,
    }).lean();
    if (existing) return;

    const walletSeg = this.resolveTradeWalletSegmentLabel(trade);
    const suffix =
      walletSeg === 'MCX'
        ? ' (MCX)'
        : walletSeg === 'CRYPTO'
          ? ' (Crypto)'
          : walletSeg === 'FOREX'
            ? ' (Forex)'
            : ' (NSE/BSE)';

    let balanceAfter = 0;
    if (walletSeg === 'MCX') {
      balanceAfter = user.mcxWallet?.balance || 0;
    } else if (walletSeg === 'CRYPTO') {
      balanceAfter = user.cryptoWallet?.balance || 0;
    } else if (walletSeg === 'FOREX') {
      balanceAfter = user.forexWallet?.balance || 0;
    } else {
      const { getNseBseBalance } = await import('../utils/nseBseWallet.js');
      balanceAfter = getNseBseBalance(user);
    }

    await WalletLedger.create({
      ownerType: 'USER',
      ownerId: user._id,
      adminCode: user.adminCode,
      type: 'DEBIT',
      reason: 'BROKERAGE',
      amount,
      balanceAfter,
      reference: { type: 'Trade', id: trade._id },
      description: `${trade.symbol || 'Trade'} ${trade.side || ''} Brokerage${suffix}`.trim(),
      meta: {
        tradeId: trade.tradeId || String(trade._id),
        segment: walletSeg === 'NSE/BSE' ? 'NSE/BSE' : walletSeg,
        prepaidRoundTrip: !!trade.brokeragePrepaidRoundTrip,
        reservedInMargin: !!trade.brokerageReservedInMargin,
      },
    });
  }

  // Distribute brokerage through MLM hierarchy using cascading ₹ amounts.
  // Each admin keeps the difference between their calculated ₹ brokerage and the next parent's.
  // The user's rate is the true "bottom" — the full totalBrokerage is based on it.
  static async distributeBrokerage(trade, totalBrokerage, directAdmin, user, leg = null) {
    if (user?.isDemo) {
      console.log('[distributeBrokerage] Skipped — demo user (no hierarchy brokerage):', user.userId || user._id);
      return;
    }
    try {
      console.log('[distributeBrokerage] Starting distribution:', {
        tradeId: trade._id,
        totalBrokerage,
        directAdmin: directAdmin.name,
        directAdminRole: directAdmin.role,
        userId: user.userId,
        leg: leg
      });

      // Build hierarchy chain from directAdmin up to SuperAdmin
      const hierarchyChain = [];
      let currentAdmin = directAdmin;
      while (currentAdmin) {
        hierarchyChain.push({ admin: currentAdmin, role: currentAdmin.role });
        if (currentAdmin.role === 'SUPER_ADMIN' || !currentAdmin.parentId) break;
        currentAdmin = await Admin.findById(currentAdmin.parentId);
      }

      // Trade parameters needed to convert any commission type → ₹ amount
      const segment = String(trade.segment || '').toUpperCase();
      const lots = trade.lots || trade.quantity || 1;
      const lotSize = trade.lotSize || 1;
      const price = trade.entryPrice || trade.currentPrice || 0;
      const turnover = price * lots * lotSize;
      const ONE_CRORE = 10_000_000;

      console.log('[distributeBrokerage] Trade parameters:', {
        segment,
        instrumentType: trade.instrumentType,
        lots,
        lotSize,
        price,
        turnover
      });

      // Helper: convert a commission setting to ₹ amount for this trade (round-trip: ×2)
      const commissionToInr = (commType, commissionValue) => {
        const comm = Number(commissionValue) || 0;
        if (comm <= 0) return 0;
        if (commType === 'PER_LOT' || commType === 'PER_QUANTITY') return comm * lots * 2;
        if (commType === 'PER_TRADE') return comm * 2;
        if (commType === 'PER_CRORE') return (turnover / ONE_CRORE) * comm * 2;
        return comm * lots * 2; // fallback
      };

      // Read user's segment commission rate (this is the true "bottom" rate)
      const sysRaw = await SystemSettings.getSettings();
      const admDefaults = TradeService._segmentMapPlain(sysRaw?.adminSegmentDefaults);
      const sysSlice = admDefaults[segment];

      // Helper: read commission settings from a segmentPermissions slice
      const readSliceCommission = (rawSlice) => {
        let finalSlice = rawSlice || sysSlice || {};
        const commType = finalSlice?.commissionType || 'PER_LOT';
        const commValue = commType === 'PER_CRORE'
          ? (finalSlice?.commission || 0)
          : (finalSlice?.commissionLot || finalSlice?.commission || 0);
        return { commType, commValue: Number(commValue) || 0 };
      };

      // Get admin segment permission slice
      const getAdminSlice = (adm) => {
        let segPerms = adm.segmentPermissions;
        if (segPerms && typeof segPerms.toObject === 'function') segPerms = segPerms.toObject();
        const slice = segPerms instanceof Map ? segPerms.get(segment) : segPerms?.[segment];
        return slice && typeof slice.toObject === 'function' ? slice.toObject() : slice;
      };

      // Get user's segment permission slice using getUserSegmentSettings (includes inheritance)
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
        commValue: userSegmentSettings?.commissionType === 'PER_CRORE'
          ? (userSegmentSettings?.commission || 0)
          : (userSegmentSettings?.commissionLot || userSegmentSettings?.commission || 0)
      };
      const userBrokerageInr = commissionToInr(userComm.commType, userComm.commValue);
      console.log('[distributeBrokerage] User brokerage calculation:', {
        commType: userComm.commType,
        commValue: userComm.commValue,
        userBrokerageInr
      });

      // Calculate each admin's ₹ brokerage at their own rate (one-way)
      for (const entry of hierarchyChain) {
        const admSlice = getAdminSlice(entry.admin);
        const { commType, commValue } = readSliceCommission(admSlice);
        entry.brokerageInr = commissionToInr(commType, commValue);
        entry.commType = commType;
        entry.commValue = commValue;
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

      console.log('[distributeBrokerage] Hierarchy ₹ amounts:', {
        userRate: { ...userComm, brokerageInr: userBrokerageInr },
        chain: hierarchyChain.map(h => ({
          name: h.admin.name, role: h.role,
          commType: h.commType, commValue: h.commValue, brokerageInr: h.brokerageInr
        }))
      });

      // Cascading distribution: convert to ₹ amounts and each level keeps the diff.
      // User pays totalBrokerage (based on user's rate × 2 for round-trip).
      // Each admin's "cost" is their own rate. They keep: (level below ₹) − (their ₹).
      // Bottom admin (directAdmin) keeps: totalBrokerage (user's full) − their own ₹ amount (scaled to round-trip).
      // Top admin (SuperAdmin) keeps: their own ₹ amount (scaled to round-trip) − 0.

      // Scale factor: For half-leg distribution, totalBrokerage is already half of round-trip.
      // Don't apply round-trip scaling - the amounts are already for the current leg.
      const roundTripFactor = 1;

      if (roundTripFactor === 0 && totalBrokerage > 0) {
        // User has no rate configured but brokerage was charged — credit all to direct admin
        console.log('[distributeBrokerage] User rate is 0, crediting full amount to direct admin');
        await this.creditBrokerageToAdmin(
          directAdmin, totalBrokerage, trade,
          `Full brokerage (₹${totalBrokerage.toFixed(2)}) — no user segment rate configured`,
          user,
          leg,
          directAdmin.isFranchiseRoot
        );
        return;
      }

      // Distribution: each admin keeps the difference between their rate and their parent's rate
      // hierarchyChain = [Ashish(2000), Manish(1500), Ram(1000), SuperAdmin(500)]
      // Ashish keeps: 2000-1500 = 500/crore worth
      // Manish keeps: 1500-1000 = 500/crore worth
      // Ram keeps: 1000-500 = 500/crore worth
      // SuperAdmin keeps: 500-0 = 500/crore worth (remainder)

      // Build levels array: each admin's ₹ amount based on their rate
      const levels = [];
      for (const entry of hierarchyChain) {
        levels.push(Math.round(entry.brokerageInr * roundTripFactor * 100) / 100);
      }
      levels.push(0); // 0 at the end for SuperAdmin's parent (no parent)

      console.log('[distributeBrokerage] Distribution levels:', {
        totalBrokerage,
        levels: levels.map((l, i) => ({ index: i, amount: l })),
        chain: hierarchyChain.map(h => ({ name: h.admin.name, role: h.role, brokerageInr: h.brokerageInr }))
      });

      // Check for franchise root in hierarchy
      const franchiseRoot = findFranchiseRootInChain(hierarchyChain);

      let divertedToSuperAdmin = 0;
      let divertedToFranchiseRoot = 0;
      let totalDistributed = 0;

      // Each admin gets: their rate - parent's rate (next in chain)
      for (let i = 0; i < hierarchyChain.length; i++) {
        const { admin, role } = hierarchyChain[i];
        const myRateAmt = levels[i];              // my own ₹ amount
        const parentRateAmt = levels[i + 1];      // parent's ₹ amount (next in chain going up)
        const amount = Math.round((myRateAmt - parentRateAmt) * 100) / 100;

        if (amount <= 0) continue;

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
          name: admin.name, role, amount,
          myRate: myRateAmt, parentRate: parentRateAmt
        });
        await this.creditBrokerageToAdmin(
          admin, amount, trade,
          `${role} share (₹${amount.toFixed(2)})`,
          user,
          leg,
          !!franchiseRoot
        );
        totalDistributed += amount;
      }

      // Handle rounding remainder - give to SuperAdmin
      const remainder = Math.round((totalBrokerage - totalDistributed - divertedToSuperAdmin - divertedToFranchiseRoot) * 100) / 100;
      if (remainder > 0.01) {
        const topAdmin = hierarchyChain[hierarchyChain.length - 1]?.admin;
        if (topAdmin) {
          if (topAdmin.role === 'SUPER_ADMIN' && franchiseRoot) {
            divertedToFranchiseRoot += remainder;
          } else if (!adminReceivesHierarchyBrokerage(topAdmin, 'trading')) {
            divertedToSuperAdmin += remainder;
          } else {
            await this.creditBrokerageToAdmin(topAdmin, remainder, trade, `Rounding remainder (₹${remainder.toFixed(2)})`, user, leg, !!franchiseRoot);
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
              user, leg, false
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
            description: `Trading brokerage — franchise root (₹${franchiseAmount.toFixed(2)}) [Temporary Wallet]`,
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
            `Super Admin — diverted from restricted admins (₹${divertedToSuperAdmin.toFixed(2)})`,
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
  static async creditBrokerageToAdmin(admin, amount, trade, description, user = null, leg = null, isFranchiseRoot = false) {
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
        isFranchiseRoot
      }
    });
    
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
                'wallet.cashBalance': closedPnL
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
          partialCloseBalance = user.wallet.cashBalance + closedPnL;
        }
        await WalletLedger.create({
          ownerType: 'USER',
          ownerId: user._id,
          userId: user.userId,
          adminCode: user.adminCode,
          type: closedPnL >= 0 ? 'CREDIT' : 'DEBIT',
          reason: 'PARTIAL_CLOSE',
          amount: Math.abs(closedPnL),
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
