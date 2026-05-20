import User from '../models/User.js';
import Trade from '../models/Trade.js';
import Admin from '../models/Admin.js';
import TradeService from './tradeService.js';
import Instrument from '../models/Instrument.js';
import MarketState from '../models/MarketState.js';
import Notification from '../models/Notification.js';
import Charges from '../models/Charges.js';
import WalletLedger from '../models/WalletLedger.js';
import SystemSettings from '../models/SystemSettings.js';
import RiskConfig from '../models/RiskConfig.js';
import WalletService from './walletService.js';
import CircuitBreakerService from './circuitBreakerService.js';
import leverageValidationService from './leverageValidationService.js';
import {
  orderIsCrypto,
  orderIsForex,
  orderIsUsdSpot,
  tradeIsUsdSpot,
  tradeIsForex,
  tradeIsCryptoOnly,
} from '../utils/tradingUsdSpot.js';
import { creditReferralTradingReward } from './referralService.js';
import {
  buildInstrumentDenyContext,
  assertHierarchyInstrumentNotDenied,
} from './instrumentRestrictionService.js';
import {
  isBinanceCryptoOrder,
  assertBinanceCryptoQuantityValidated,
} from '../utils/binanceCryptoQty.js';

/** Read one segment entry from User.segmentPermissions (Map or plain object after lean). */
function getUserSegmentPerm(user, segmentKey) {
  const seg = String(segmentKey || '').trim().toUpperCase();
  if (!seg) return null;
  const sp = user.segmentPermissions;
  if (sp && typeof sp.get === 'function') {
    return sp.get(seg) ?? null;
  }
  if (sp && typeof sp === 'object' && sp.get == null) {
    return sp[seg] ?? null;
  }
  return null;
}

function assertSegmentAllowLimitPendingOrders(user, orderData) {
  const ot = String(orderData.orderType || '').toUpperCase();
  if (ot === 'MARKET') return;
  if (ot !== 'LIMIT' && ot !== 'SL' && ot !== 'SL-M') return;

  const seg = String(orderData.segment || orderData.displaySegment || '').trim().toUpperCase();
  if (!seg) return;

  const perm = getUserSegmentPerm(user, seg);
  if (perm && perm.allowLimitPendingOrders === false) {
    throw new Error(
      `${seg}: Limit & pending (SL) orders are disabled for this segment. Your admin can enable "Allow limit/pending orders" in Segment Permissions (hierarchy).`
    );
  }
}

// Lot sizes for different instruments
const LOT_SIZES = {
  // NSE F&O
  'NIFTY': 25,
  'BANKNIFTY': 15,
  'FINNIFTY': 25,
  'MIDCPNIFTY': 50,
  'SENSEX': 10,
  'BANKEX': 15,
  // MCX Commodities - Mini variants (must be checked first)
  'GOLDM': 10,
  'GOLDGUINEA': 1,
  'GOLDPETAL': 1,
  'SILVERM': 5,
  'SILVERMIC': 1,
  'CRUDEOILM': 10,
  // MCX Commodities - Standard
  'GOLD': 100,
  'SILVER': 30,
  'CRUDEOIL': 100,
  'NATURALGAS': 1250,
  'COPPER': 2500,
  'ZINC': 5000,
  'ALUMINIUM': 5000,
  'LEAD': 5000,
  'NICKEL': 1500,
};

// Market hours (IST)
const MARKET_HOURS = {
  NSE: { open: { hour: 9, minute: 15 }, close: { hour: 15, minute: 30 } },
  BSE: { open: { hour: 9, minute: 15 }, close: { hour: 15, minute: 30 } },
  NFO: { open: { hour: 9, minute: 15 }, close: { hour: 15, minute: 30 } },
  MCX: { open: { hour: 9, minute: 0 }, close: { hour: 23, minute: 30 } },
  BINANCE: { open: { hour: 0, minute: 0 }, close: { hour: 23, minute: 59 } }, // 24/7
};

// Helper function to check margin usage and send warning notification
const checkMarginWarning = async (user, newUsedMargin, tradingBalance) => {
  try {
    // Calculate margin usage percentage
    const totalMarginAvailable = tradingBalance + newUsedMargin; // Total funds allocated for trading
    if (totalMarginAvailable <= 0) return;
    
    const marginUsagePercent = (newUsedMargin / totalMarginAvailable) * 100;
    
    // Send warning notification if margin usage exceeds 70%
    if (marginUsagePercent >= 70) {
      // Check if we already sent a warning today to avoid spam
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const existingWarning = await Notification.findOne({
        senderType: 'SYSTEM',
        targetType: 'SINGLE_USER',
        targetUserId: user._id,
        title: 'Margin Warning',
        createdAt: { $gte: today }
      });
      
      if (!existingWarning) {
        await Notification.create({
          title: 'Margin Warning',
          subject: `⚠️ High Margin Usage Alert - ${marginUsagePercent.toFixed(1)}%`,
          description: `Your margin usage is at ${marginUsagePercent.toFixed(1)}% (₹${newUsedMargin.toLocaleString()} used out of ₹${totalMarginAvailable.toLocaleString()}). Consider closing some positions to reduce risk. If margin usage reaches 100%, you may not be able to place new trades.`,
          senderType: 'SYSTEM',
          targetType: 'SINGLE_USER',
          targetUserId: user._id
        });
        console.log(`Margin warning sent to user ${user.userId}: ${marginUsagePercent.toFixed(1)}% usage`);
      }
    }
  } catch (error) {
    console.error('Error checking margin warning:', error);
    // Don't throw - this is a non-critical operation
  }
};

class TradingService {
  
  // Get lot size for instrument (sync fallback - prefer getLotSizeAsync)
  static getLotSize(symbol, category, exchange) {
    const sym = symbol?.toUpperCase() || '';
    const cat = category?.toUpperCase() || '';
    const exch = exchange?.toUpperCase() || '';
    
    // MCX commodities - check mini variants FIRST (more specific matches)
    if (exch === 'MCX' || cat === 'MCX') {
      // Mini/Micro variants first
      if (sym.includes('GOLDM') || sym.startsWith('GOLDM')) return 10;
      if (sym.includes('GOLDGUINEA')) return 1;
      if (sym.includes('GOLDPETAL')) return 1;
      if (sym.includes('SILVERM') || sym.startsWith('SILVERM')) return 5;
      if (sym.includes('SILVERMIC')) return 1;
      if (sym.includes('CRUDEOILM') || sym.startsWith('CRUDEOILM')) return 10;
      // Standard variants
      if (sym.includes('GOLD')) return 100;
      if (sym.includes('SILVER')) return 30;
      if (sym.includes('CRUDEOIL')) return 100;
      if (sym.includes('NATURALGAS')) return 1250;
      if (sym.includes('COPPER')) return 2500;
      if (sym.includes('ZINC')) return 5000;
      if (sym.includes('ALUMINIUM')) return 5000;
      if (sym.includes('LEAD')) return 5000;
      if (sym.includes('NICKEL')) return 1500;
    }
    
    // NSE F&O by category
    if (cat) {
      if (cat.includes('NIFTY') && !cat.includes('BANK') && !cat.includes('FIN') && !cat.includes('MID')) return 25;
      if (cat.includes('BANKNIFTY')) return 15;
      if (cat.includes('FINNIFTY')) return 25;
      if (cat.includes('MIDCPNIFTY')) return 50;
    }
    
    // Check by symbol - mini variants first
    const sortedKeys = Object.keys(LOT_SIZES).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
      if (sym.includes(key)) return LOT_SIZES[key];
    }
    return 1;
  }
  
  // Get lot size from database (preferred method)
  static async getLotSizeAsync(symbol, token, exchange) {
    try {
      // Try to find instrument by token first (most accurate)
      let instrument = null;
      if (token) {
        instrument = await Instrument.findOne({ token: token.toString() }).select('lotSize symbol').lean();
      }
      // Fallback to symbol + exchange
      if (!instrument && symbol && exchange) {
        instrument = await Instrument.findOne({ 
          symbol: { $regex: new RegExp(`^${symbol}`, 'i') },
          exchange: exchange 
        }).select('lotSize symbol').lean();
      }
      if (instrument?.lotSize && instrument.lotSize > 0) {
        return instrument.lotSize;
      }
    } catch (error) {
      console.error('Error fetching lot size from DB:', error.message);
    }
    // Fallback to hardcoded
    return this.getLotSize(symbol, null, exchange);
  }

  // Check if market is open - simplified: only check user's segment permissions
  // If user has segment enabled, allow trading (subject to market hours)
  static async isMarketOpen(exchange = 'NSE', userSegment = null, user = null) {
    // Crypto/Binance is always open 24/7
    if (exchange === 'BINANCE') {
      return { open: true, reason: 'Crypto markets are open 24/7' };
    }
    if (exchange === 'FOREX') {
      return { open: true, reason: 'Forex (synthetic) quotes available 24/7' };
    }

    // Check if user has the specific segment enabled in their segment permissions
    if (user && userSegment) {
      let userSegUpper = String(userSegment || '').toUpperCase();

      // Map FNO (Futures & Options product) to NSEFUT/NSEOPT (NSE segments)
      // FNO is the product category, NSEFUT/NSEOPT are the actual exchange segments under NSE
      if (userSegUpper === 'FNO' || userSegUpper === 'NFO') {
        const userSegPerms = user.segmentPermissions;
        let userHasFNO = false;
        
        if (userSegPerms) {
          const nseFutPerm = userSegPerms instanceof Map ? userSegPerms.get('NSEFUT') : userSegPerms['NSEFUT'];
          const nseOptPerm = userSegPerms instanceof Map ? userSegPerms.get('NSEOPT') : userSegPerms['NSEOPT'];
          userHasFNO = (nseFutPerm && nseFutPerm.enabled) || (nseOptPerm && nseOptPerm.enabled);
        }

        if (userHasFNO) {
          console.log(`[isMarketOpen] User has NSEFUT or NSEOPT enabled, allowing FNO trading`);
          return { open: true, reason: 'User has NSEFUT/NSEOPT enabled' };
        }

        // Check parent admin's segment permissions (hierarchy inheritance)
        const parentSegPerms = user.parentSegmentPermissions || user.admin?.segmentPermissions;
        if (parentSegPerms) {
          const parentNseFutPerm = parentSegPerms instanceof Map ? parentSegPerms.get('NSEFUT') : parentSegPerms['NSEFUT'];
          const parentNseOptPerm = parentSegPerms instanceof Map ? parentSegPerms.get('NSEOPT') : parentSegPerms['NSEOPT'];
          if ((parentNseFutPerm && parentNseFutPerm.enabled) || (parentNseOptPerm && parentNseOptPerm.enabled)) {
            console.log(`[isMarketOpen] Parent admin has NSEFUT or NSEOPT enabled (hierarchy inheritance), allowing FNO trading`);
            return { open: true, reason: 'Parent admin has NSEFUT/NSEOPT enabled' };
          }
        }

        console.log(`[isMarketOpen] User and parent admin do NOT have NSEFUT/NSEOPT enabled, blocking FNO trading`);
        return { open: false, reason: 'NSEFUT/NSEOPT segment is not enabled for this user' };
      }

      const userSegPerms = user.segmentPermissions;
      if (userSegPerms) {
        const segPerm = userSegPerms instanceof Map ? userSegPerms.get(userSegUpper) : userSegPerms[userSegUpper];
        if (segPerm && segPerm.enabled) {
          console.log(`[isMarketOpen] User has ${userSegUpper} enabled in segment permissions, allowing trading`);
          return { open: true, reason: `User has ${userSegUpper} enabled` };
        }
      }

      // Check parent admin's segment permissions (hierarchy inheritance)
      const parentSegPerms = user.parentSegmentPermissions || user.admin?.segmentPermissions;
      if (parentSegPerms) {
        const parentSegPerm = parentSegPerms instanceof Map ? parentSegPerms.get(userSegUpper) : parentSegPerms[userSegUpper];
        if (parentSegPerm && parentSegPerm.enabled) {
          console.log(`[isMarketOpen] Parent admin has ${userSegUpper} enabled (hierarchy inheritance), allowing trading`);
          return { open: true, reason: `Parent admin has ${userSegUpper} enabled` };
        }

        // For MCX, also check MCXFUT and MCXOPT if parent has them enabled
        if (userSegUpper === 'MCX') {
          const mcxFutPerm = parentSegPerms instanceof Map ? parentSegPerms.get('MCXFUT') : parentSegPerms['MCXFUT'];
          const mcxOptPerm = parentSegPerms instanceof Map ? parentSegPerms.get('MCXOPT') : parentSegPerms['MCXOPT'];
          if ((mcxFutPerm && mcxFutPerm.enabled) || (mcxOptPerm && mcxOptPerm.enabled)) {
            console.log(`[isMarketOpen] Parent admin has MCXFUT or MCXOPT enabled (hierarchy inheritance), allowing MCX trading`);
            return { open: true, reason: `Parent admin has MCXFUT/MCXOPT enabled` };
          }
        }
      }

      // If neither user nor parent has the segment enabled, block trading
      console.log(`[isMarketOpen] User and parent admin do NOT have ${userSegUpper} enabled, blocking trading`);
      return { open: false, reason: `${userSegUpper} segment is not enabled for this user` };
    }

    // Fallback: check market hours only if no user segment check
    try {
      // Map exchange to segment for MarketState lookup (time-based check only)
      let segment = 'EQUITY';
      if (exchange === 'NFO' || exchange === 'NSE') {
        const fnoResult = await MarketState.isTradingAllowed('FNO');
        const equityResult = await MarketState.isTradingAllowed('EQUITY');
        if (fnoResult.allowed || equityResult.allowed) {
          return { open: true, reason: 'Market open' };
        }
        return { open: false, reason: fnoResult.reason || equityResult.reason || 'Market closed' };
      } else if (exchange === 'MCX') {
        segment = 'MCX';
      } else if (exchange === 'BSE') {
        segment = 'EQUITY';
      }

      const result = await MarketState.isTradingAllowed(segment);
      if (exchange === 'MCX' && !result.allowed) {
        const fallback = this.isMarketOpenFallback('MCX');
        return fallback.open
          ? { open: true, reason: 'MCX session open (time-window fallback)' }
          : { open: false, reason: fallback.reason || result.reason };
      }
      return { open: result.allowed, reason: result.reason };
    } catch (error) {
      console.error('Error checking market state:', error);
      return this.isMarketOpenFallback(exchange);
    }
  }
  
  // Fallback market check using hardcoded hours
  static isMarketOpenFallback(exchange = 'NSE') {
    const now = new Date();
    const istOptions = { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short' };
    const istTimeStr = now.toLocaleString('en-US', istOptions);
    
    const [weekday, time] = istTimeStr.split(' ');
    const [hours, minutes] = time.split(':').map(Number);
    
    // MCX has Sunday trading (9:00 AM - 11:30 PM), so skip weekend check for MCX
    if (exchange !== 'MCX' && (weekday === 'Sat' || weekday === 'Sun')) {
      return { open: false, reason: 'Market closed on weekends' };
    }
    
    const marketHours = MARKET_HOURS[exchange] || MARKET_HOURS.NSE;
    const currentMinutes = hours * 60 + minutes;
    const openMinutes = marketHours.open.hour * 60 + marketHours.open.minute;
    const closeMinutes = marketHours.close.hour * 60 + marketHours.close.minute;
    
    if (currentMinutes < openMinutes) {
      return { open: false, reason: `Market opens at ${marketHours.open.hour}:${String(marketHours.open.minute).padStart(2, '0')} IST` };
    }
    if (currentMinutes > closeMinutes) {
      return { open: false, reason: `Market closed at ${marketHours.close.hour}:${String(marketHours.close.minute).padStart(2, '0')} IST` };
    }
    
    return { open: true };
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

  // Get admin settings for user
  // First try createdBy (direct parent), then fall back to adminCode
  static async getAdminSettings(user) {
    console.log('[getAdminSettings] Getting admin for user:', user.userId, 'adminCode:', user.adminCode, 'createdBy:', user.createdBy);
    // First try to get the direct creator (broker/admin who created this user)
    if (user.createdBy) {
      const creator = await Admin.findById(user.createdBy);
      if (creator) {
        console.log('[getAdminSettings] Found creator:', creator.username, creator.role, 'adminCode:', creator.adminCode);
        return creator;
      }
    }
    // Fall back to adminCode lookup
    if (user.adminCode) {
      // If adminCode is 'SYSTEM', find the Super Admin instead
      if (user.adminCode === 'SYSTEM') {
        console.log('[getAdminSettings] adminCode is SYSTEM, looking for Super Admin');
        const superAdmin = await Admin.findOne({ role: 'SUPER_ADMIN' });
        if (superAdmin) {
          console.log('[getAdminSettings] Found Super Admin for SYSTEM:', superAdmin.username, superAdmin.adminCode);
          return superAdmin;
        }
      } else {
        const admin = await Admin.findOne({ adminCode: user.adminCode });
        if (admin) {
          console.log('[getAdminSettings] Found admin by adminCode:', admin.username, admin.role);
          return admin;
        }
      }
    }
    console.log('[getAdminSettings] No admin found for user:', user.username);
    return null;
  }

  // Get available leverages for user (hierarchical system)
  // Returns separate intraday and carryforward leverages
  // Priority: User's custom leverageSettings > Parent Admin's leverageSettings > Defaults
  static async getAvailableLeverages(user, productType = null) {
    const defaultIntraday = [1, 2, 5, 10];
    const defaultCarryForward = [1, 2, 5];
    
    // Helper to check if array is just the default (not custom set by parent)
    const isDefaultIntraday = (arr) => arr?.length === 4 && arr.includes(1) && arr.includes(2) && arr.includes(5) && arr.includes(10) && !arr.some(l => l > 10);
    const isDefaultCarryForward = (arr) => arr?.length === 3 && arr.includes(1) && arr.includes(2) && arr.includes(5) && !arr.some(l => l > 5);
    
    let intradayLeverages = defaultIntraday;
    let carryForwardLeverages = defaultCarryForward;
    let userHasCustomIntraday = false;
    let userHasCustomCarryForward = false;
    
    // Check if user has CUSTOM leverage settings (not just defaults from schema)
    if (user.leverageSettings) {
      if (user.leverageSettings.intradayLeverages?.length > 0 && !isDefaultIntraday(user.leverageSettings.intradayLeverages)) {
        intradayLeverages = user.leverageSettings.intradayLeverages;
        userHasCustomIntraday = true;
      }
      if (user.leverageSettings.carryForwardLeverages?.length > 0 && !isDefaultCarryForward(user.leverageSettings.carryForwardLeverages)) {
        carryForwardLeverages = user.leverageSettings.carryForwardLeverages;
        userHasCustomCarryForward = true;
      }
    }
    
    // Always get parent admin's settings - use them if user doesn't have custom settings
    const admin = await this.getAdminSettings(user);
    console.log('[Leverage] User adminCode:', user.adminCode, 'Found admin:', admin?.username, 'userHasCustomIntraday:', userHasCustomIntraday, 'userHasCustomCarryForward:', userHasCustomCarryForward);
    
    if (admin?.leverageSettings) {
      // Get admin's leverage arrays (with fallback to enabledLeverages for backward compatibility)
      const adminIntradayLeverages = admin.leverageSettings.intradayLeverages?.length > 0 
        ? admin.leverageSettings.intradayLeverages 
        : (admin.leverageSettings.enabledLeverages?.length > 0 ? admin.leverageSettings.enabledLeverages : null);
      
      const adminCarryForwardLeverages = admin.leverageSettings.carryForwardLeverages?.length > 0 
        ? admin.leverageSettings.carryForwardLeverages 
        : (admin.leverageSettings.enabledLeverages?.length > 0 
            ? admin.leverageSettings.enabledLeverages.filter(l => l <= 20)
            : null);
      
      console.log('[Leverage] Admin intradayLeverages:', adminIntradayLeverages, 'carryForwardLeverages:', adminCarryForwardLeverages);
      
      // Use admin's leverages if user doesn't have custom settings
      if (!userHasCustomIntraday && adminIntradayLeverages?.length > 0) {
        intradayLeverages = adminIntradayLeverages;
      }
      if (!userHasCustomCarryForward && adminCarryForwardLeverages?.length > 0) {
        carryForwardLeverages = adminCarryForwardLeverages;
      }
    }
    
    // Sort both arrays
    intradayLeverages = [...intradayLeverages].sort((a, b) => a - b);
    carryForwardLeverages = [...carryForwardLeverages].sort((a, b) => a - b);
    
    console.log('[Leverage] Final intraday:', intradayLeverages, 'carryForward:', carryForwardLeverages);
    
    // If productType is specified, return only that type's leverages
    if (productType === 'MIS') {
      return intradayLeverages;
    } else if (productType === 'NRML' || productType === 'CNC') {
      return carryForwardLeverages;
    }
    
    // Return both for the API response
    return {
      intraday: intradayLeverages,
      carryForward: carryForwardLeverages,
      // Legacy support - combine both
      leverages: [...new Set([...intradayLeverages, ...carryForwardLeverages])].sort((a, b) => a - b)
    };
  }

  // Calculate margin required with leverage
  static calculateMargin(order, user, leverage = 1) {
    const { segment, productType, side, quantity, price, lotSize = 1, lots = 1 } = order;
    
    // Crypto / synthetic forex: live quote in USD; margin uses USD notional (no INR conversion)
    const isUsdSpot = orderIsUsdSpot({ ...order, segment });
    const effectivePrice = price;
    
    // Trade value: quantity already includes lotSize from frontend (quantity = lots × lotSize)
    const tradeValue = quantity * effectivePrice;
    
    let baseMargin = 0;

    if (isUsdSpot) {
      // Spot USD book (crypto / forex) — use USD notional directly (no INR conversion)
      baseMargin = tradeValue;
      if (productType === 'MIS') baseMargin *= 0.1; // 10% margin for intraday
    } else if (segment === 'EQUITY' || segment === 'equity') {
      if (productType === 'CNC') {
        baseMargin = side === 'BUY' ? tradeValue : 0;
      } else if (productType === 'MIS') {
        baseMargin = tradeValue * 0.2;
      }
    } else if (segment === 'FNO' && order.instrumentType === 'FUTURES') {
      baseMargin = tradeValue * 0.15;
      if (productType === 'MIS') baseMargin *= 0.5;
    } else if (segment === 'FNO' && order.instrumentType === 'OPTIONS') {
      if (side === 'BUY') {
        baseMargin = tradeValue;
      } else {
        // For option sell, use strike price for notional value
        const notionalValue = quantity * (order.strikePrice || effectivePrice * 10);
        baseMargin = notionalValue * 0.20;
        if (productType === 'MIS') baseMargin *= 0.5;
      }
    } else if (segment === 'MCX' || segment === 'COMMODITY') {
      // MCX commodities - lower margin for B-book
      baseMargin = tradeValue * 0.05; // 5% margin for MCX
      if (productType === 'MIS') baseMargin *= 0.5; // 2.5% for intraday
    } else {
      baseMargin = tradeValue * 0.15;
    }

    const marginRequired = baseMargin / leverage;
    
    return {
      marginRequired: Math.round(marginRequired * 100) / 100,
      tradeValue: Math.round(tradeValue * 100) / 100,
      effectiveMargin: Math.round(baseMargin * 100) / 100,
      leverage,
      isCrypto: orderIsCrypto({ ...order, segment })
    };
  }

  // Place order - Uses user's segment and script settings for all calculations
  // TradePro Trading Engine - 16-step validation pipeline
  static async placeOrder(userId, orderData) {
    // ==================== STEP 0: LIVE PRICE VALIDATION ====================
    // Ensure orders use live tick-to-tick prices, not historical data
    if (orderData.orderType === 'MARKET' && orderData.price) {
      const now = new Date();
      const priceAgeMinutes = (now - new Date(orderData.priceTimestamp || now)) / (1000 * 60);
      
      if (priceAgeMinutes > 5) {
        console.log(`🚨 LIVE PRICE VALIDATION FAILED: ${orderData.symbol}`);
        console.log(`🚨 Price age: ${priceAgeMinutes.toFixed(2)} minutes (max allowed: 5 minutes)`);
        console.log(`🚨 Price timestamp: ${orderData.priceTimestamp}`);
        console.log(`🚨 Server time: ${now.toISOString()}`);
        console.log(`🚨 REJECTING ORDER - Historical price detected`);
        
        throw new Error(`Order rejected: Price data is ${priceAgeMinutes.toFixed(2)} minutes old. Live tick-to-tick prices required for market orders.`);
      } else {
        console.log(`✅ LIVE PRICE VALIDATION PASSED: ${orderData.symbol}`);
        console.log(`✅ Price age: ${priceAgeMinutes.toFixed(2)} minutes - Using live data`);
      }
    }

    // ==================== STEP 1: USER ACTIVE CHECK ====================
    const user = await User.findById(userId).populate({
      path: 'admin',
      select:
        'segmentPermissions segmentExplicitKeys restrictions hierarchyPath role adminCode parentId createdBy',
    });
    if (!user) throw new Error('User not found');
    
    if (!user.isActive) {
      throw new Error('Account is suspended/inactive. Contact admin.');
    }
    
    // Check if trading is blocked until a specific time (daily loss limit)
    if (user.tradingBlockedUntil && new Date() < new Date(user.tradingBlockedUntil)) {
      throw new Error('Trading is blocked until tomorrow due to daily loss limit.');
    }

    // Attach parent admin's segment permissions to user for permission checks
    if (user.admin?.segmentPermissions) {
      user.parentSegmentPermissions = user.admin.segmentPermissions;
    }

    const admin = await this.getAdminSettings(user);

    // Validate leverage against admin's maxLeverageFromParent
    if (admin && admin.leverageSettings) {
      const leverageType = orderData.product === 'MIS' ? 'intraday' : 'carryforward';
      const requestedLeverage = orderData.leverage || admin.leverageSettings.intradayLeverage || 1;
      const validation = leverageValidationService.validateLeverageAtTradeExecution(admin, leverageType, requestedLeverage);
      if (!validation.valid) {
        throw new Error(validation.error);
      }
    }

    // Get risk config for this user
    const riskConfig = await RiskConfig.getConfig(user.adminCode);

    if (user.rmsSettings?.tradingBlocked) {
      throw new Error('Trading blocked. Contact admin.');
    }

    assertSegmentAllowLimitPendingOrders(user, orderData);

    // ==================== STEP 2: MARKET HOURS CHECK ====================
    const exchange = orderData.exchange || 'NSE';
    const marketStatus = await this.isMarketOpen(exchange, orderData.segment, user);
    const allowOutsideHours = admin?.tradingSettings?.allowTradingOutsideMarketHours || false;

    if (orderData.orderType === 'MARKET' && !marketStatus.open && !allowOutsideHours) {
      throw new Error(marketStatus.reason);
    }
    
    // ==================== STEP 5: CIRCUIT LIMIT CHECK (TradePro) ====================
    // Check instrument circuit status before proceeding
    const instrument = await Instrument.findOne({ 
      $or: [
        { token: orderData.token?.toString() },
        { symbol: orderData.symbol, exchange: orderData.exchange }
      ]
    });
    
    if (instrument) {
      if (!instrument.isEnabled) {
        throw new Error('This instrument is not available for trading.');
      }

      // Check if order side is allowed based on circuit status
      const circuitCheck = CircuitBreakerService.checkOrderAllowed(instrument, orderData.side);
      if (!circuitCheck.allowed) {
        throw new Error(circuitCheck.reason);
      }
      
      // Check if price is within circuit limits
      const priceCheck = CircuitBreakerService.checkPriceWithinLimits(instrument, orderData.price);
      if (!priceCheck.valid) {
        throw new Error(priceCheck.reason);
      }

      if (instrument.tradingDefaults?.enabled && instrument.tradingDefaults.blockTrading) {
        throw new Error(
          `Trading in ${orderData.symbol} is disabled for this contract (instrument settings).`
        );
      }
    }

    const denyCtx = buildInstrumentDenyContext(orderData, instrument || null);
    await assertHierarchyInstrumentNotDenied(user, denyCtx);

    // POSITION NETTING DISABLED - Allow hedging (both BUY and SELL positions can coexist)
    // Previously, opposite positions would be netted automatically. Now disabled for all segments
    // to allow users to hedge their positions across NSE, BSE, MCX, Crypto, Forex, etc.

    // Get user's segment and script settings (crypto/forex spread inherits Super Admin default when unset)
    let segmentSettings = await TradeService.getUserSegmentSettings(user, orderData.segment, orderData.instrumentType);
    segmentSettings = await TradeService.mergeUsdSpotSpreadFromSuperAdmin(segmentSettings, orderData);
    const rawScriptSettings = TradeService.getUserScriptSettings(user, orderData.symbol, orderData.category);
    const scriptSettings = TradeService.mergeScriptSettingsWithInstrument(instrument, rawScriptSettings);
    
    // Validate segment is enabled
    // For crypto/forex, skip enabled check if segmentSettings is null or not explicitly set
    const isCryptoOrForex = orderData.isCrypto || orderData.exchange === 'BINANCE' ||
      ['FOREX', 'FOREXFUT', 'FOREXOPT', 'CRYPTOFUT', 'CRYPTOOPT'].includes(String(orderData.segment || '').toUpperCase()) ||
      orderData.isForex || orderData.exchange === 'FOREX';
    if (!isCryptoOrForex && !segmentSettings.enabled) {
      throw new Error(`Trading in ${orderData.segment} segment is not enabled for your account`);
    }
    // For crypto/forex, if segmentSettings exists but is not enabled, still allow trading with default settings
    if (isCryptoOrForex && (!segmentSettings || !segmentSettings.enabled)) {
      console.log(`[placeOrder] Crypto/forex segment ${orderData.segment} not explicitly enabled, using default settings`);
      // Don't throw error for crypto/forex
    }

    if (segmentSettings.defaultIntradayOnly === true) {
      orderData.productType = 'MIS';
    }

    await TradeService.assertCryptoSegmentTradingWindowOpen(user, segmentSettings, orderData.segment);
    console.log(`[CryptoTimeCheck] TradingService: After assertCryptoSegmentTradingWindowOpen for ${orderData.segment}`);
    
    // Check if script is blocked
    if (scriptSettings?.blocked) {
      throw new Error(`Trading in ${orderData.symbol} is blocked for your account`);
    }

    // ==================== CIRCUIT LIMIT CHECK ====================
    // Upper Circuit: When bid=0 and ask=0, stock hit upper circuit - only SELL allowed (no buyers)
    // Lower Circuit: When bid=0 and ask=0, stock hit lower circuit - only BUY allowed (no sellers)
    // Circuit detection is based on which price is 0:
    // - Upper Circuit: askPrice = 0 (no sellers at this price) → Block BUY
    // - Lower Circuit: bidPrice = 0 (no buyers at this price) → Block SELL
    const bidPrice = orderData.bidPrice || 0;
    const askPrice = orderData.askPrice || 0;
    
    // Upper Circuit: No ask price means no one is selling → BUY not possible
    if (orderData.side === 'BUY' && askPrice === 0 && bidPrice > 0) {
      throw new Error(`${orderData.symbol} is at UPPER CIRCUIT. Buy orders are not allowed. Only sell orders can be placed.`);
    }
    
    // Lower Circuit: No bid price means no one is buying → SELL not possible
    if (orderData.side === 'SELL' && bidPrice === 0 && askPrice > 0) {
      throw new Error(`${orderData.symbol} is at LOWER CIRCUIT. Sell orders are not allowed. Only buy orders can be placed.`);
    }
    
    // Both bid and ask are 0 - market is frozen/halted
    if (bidPrice === 0 && askPrice === 0 && orderData.price > 0) {
      // Allow trading if we have LTP (last traded price) - this handles pre-market or illiquid stocks
      console.log(`[Circuit] ${orderData.symbol}: Both bid/ask are 0, using LTP: ${orderData.price}`);
    }
    // ==================== END CIRCUIT CHECK ====================

    // Crypto / synthetic forex: USD quote, INR wallet economics
    const isUsdSpot = orderIsUsdSpot(orderData);
    const isCryptoWallet = orderIsCrypto(orderData);
    const isForexWallet = orderIsForex(orderData);
    const usdInr = 1;
    const isBinanceCrypto = isBinanceCryptoOrder(orderData);

    // Get lot size: Binance crypto uses instrument.exchange step only (qty-only); legacy segment lot mapping skipped.
    let lotSize = isUsdSpot
      ? (orderData.lotSize > 0 ? Number(orderData.lotSize) : 1)
      : (orderData.lotSize || 1);
    if (!isUsdSpot && (!lotSize || lotSize <= 0)) {
      lotSize = await this.getLotSizeAsync(orderData.symbol, orderData.token, orderData.exchange);
    }
    const segU = String(orderData.segment || '').toUpperCase();
    // CRYPTOFUT, CRYPTOOPT, NSE, NSE-EQ, NSEFUT, NSEOPT, BSE, BSE-FUT, BSE-OPT: No lot system - use quantity directly
    if (segU === 'CRYPTOFUT' || segU === 'CRYPTOOPT' || segU === 'NSE' || segU === 'NSE-EQ' || segU === 'NSEFUT' || segU === 'NSEOPT' || segU === 'BSE' || segU === 'BSE-FUT' || segU === 'BSE-OPT') {
      lotSize = 1; // Force lotSize to 1 for quantity-based segments
    }

    if (isBinanceCrypto && instrument?.lotSize > 0) {
      lotSize = Number(instrument.lotSize);
    }

    // For USD spot: use fractional quantity directly
    // For others: use quantity from frontend if provided (quantity mode), otherwise lots * lotSize
    let lots =
      orderData.lots != null && orderData.lots !== '' && Number.isFinite(Number(orderData.lots))
        ? Number(orderData.lots)
        : 1;
    // Check if frontend sent quantity directly (quantity mode) - quantity won't equal lots * lotSize
    const isQuantityMode = orderData.quantity && orderData.quantity !== (lots * lotSize);
    const inrNotional = orderData.cryptoAmount || orderData.forexAmount;
    let totalQuantity = orderData.quantity ||
          (orderData.price > 0 && inrNotional
            ? inrNotional / orderData.price
            : 0) ||
          (lots * lotSize);
    
    if (isUsdSpot && lotSize > 0 && !isBinanceCrypto) {
      lots = totalQuantity / lotSize;
    }
    if (isBinanceCrypto) {
      let tq = Number(orderData.quantity);
      if (!(Number.isFinite(tq) && tq > 0)) {
        tq = totalQuantity;
      }
      if (!(Number.isFinite(tq) && tq > 0) && orderData.price > 0 && inrNotional) {
        tq = inrNotional / orderData.price;
      }
      totalQuantity = tq;
      assertBinanceCryptoQuantityValidated({
        symbol: orderData.symbol,
        qty: totalQuantity,
        instrument,
        segmentSettings,
        scriptSettings,
      });
      if (lotSize > 0) {
        lots = totalQuantity / lotSize;
      } else {
        lots = totalQuantity;
      }
    }

    // Skip lot validation for USD spot (uses INR notional, not lots)
    // Also skip for MCX - uses quantity-based validation
    const isMCX = orderData.exchange === 'MCX' || ['MCXFUT', 'MCXOPT'].includes(String(orderData.segment || '').toUpperCase());
    if (!isUsdSpot && !isBinanceCrypto && !isMCX) {
      // Validate lot limits from user settings
      // Prefer quantityModeSettings for all exchanges when set
      const qtyModeSettings = segmentSettings?.quantityModeSettings;
      const maxLots = (qtyModeSettings?.maxQuantity > 0)
        ? qtyModeSettings.maxQuantity
        : (scriptSettings?.lotSettings?.maxLots || segmentSettings?.maxLots);
      const minLots = (qtyModeSettings?.minQuantity > 0)
        ? qtyModeSettings.minQuantity
        : (scriptSettings?.lotSettings?.minLots || segmentSettings?.minLots || 1);
      
      // Only validate if maxLots is set (no hardcoded fallback)
      if (maxLots != null && maxLots > 0) {
        // For quantity mode, calculate effective lots from quantity for validation
        const effectiveLots = isQuantityMode ? Math.ceil(totalQuantity / lotSize) : lots;
        
        console.log('Order Validation:', {
          isQuantityMode,
          requestedLots: lots,
          effectiveLots,
          totalQuantity,
          lotSize,
          maxLots, minLots,
          fromScript: !!scriptSettings?.lotSettings?.maxLots,
          fromSegment: segmentSettings?.maxLots,
          segment: orderData.segment
        });
        
        // In quantity mode, validate quantity is at least 1 and within reasonable bounds
        if (isQuantityMode) {
          if (totalQuantity < 1) {
            throw new Error(`Minimum quantity is 1 for ${orderData.symbol}`);
          }
          // Optional: validate max quantity based on maxLots * lotSize
          const maxQuantity = maxLots * lotSize;
          if (totalQuantity > maxQuantity) {
            throw new Error(`Maximum quantity is ${maxQuantity} for ${orderData.symbol}`);
          }
        } else {
          // Lots mode validation
          if (lots < minLots) {
            throw new Error(`Minimum ${minLots} quantity required for ${orderData.symbol}`);
          }
          if (lots > maxLots) {
            throw new Error(`Maximum ${maxLots} quantity allowed for ${orderData.symbol}. Your limit is ${maxLots} quantity.`);
          }
        }
      }
    } else if (isUsdSpot && !isBinanceCrypto) {
      console.log('USD spot trade:', { quantity: totalQuantity, price: orderData.price, inrNotional });
    }

    // Dynamic Quantity Limit Check - validate user has enough available quantity
    // Skip for MCX (uses quantity-based validation, not dynamic limits)
    if (!isUsdSpot && !isMCX && segmentSettings) {
      const isIntraday = orderData.productType === 'MIS' || orderData.productType === 'INTRADAY';
      const maxQty = isIntraday 
        ? segmentSettings.maxIntradayQty
        : segmentSettings.maxCarryQty;
      const availableQty = isIntraday 
        ? (segmentSettings.availableIntradayQty ?? maxQty)
        : (segmentSettings.availableCarryQty ?? maxQty);
      
      // Only validate if maxQty is set (no hardcoded fallbacks)
      if (maxQty != null && maxQty > 0 && totalQuantity > availableQty) {
        const qtyType = isIntraday ? 'Intraday' : 'Carry Forward';
        throw new Error(`Insufficient ${qtyType} quantity limit. Available: ${availableQty}, Requested: ${totalQuantity}. Max allowed: ${maxQty}`);
      }
      
      if (maxQty != null && maxQty > 0) {
        console.log(`Dynamic Qty Check: ${orderData.segment} ${orderData.productType} - Requested: ${totalQuantity}, Available: ${availableQty}, Max: ${maxQty}`);
      }
    }

    const spreadPoints = TradeService.calculateUserSpread(scriptSettings, orderData.side);
    const segmentHalfUsd =
      (isCryptoWallet || isForexWallet) && orderData.orderType === 'MARKET'
        ? TradeService.segmentCryptoSpreadHalfUsd(segmentSettings)
        : 0;
    const totalSpreadUsd = spreadPoints + segmentHalfUsd;
    
    // Calculate margin - check for fixed margin first
    const isIntraday = orderData.productType === 'MIS' || orderData.productType === 'INTRADAY';
    const isOption = orderData.instrumentType === 'OPTIONS';
    const isOptionBuy = isOption && orderData.side === 'BUY';
    const isOptionSell = isOption && orderData.side === 'SELL';
    
    let marginRequired = 0;
    let usedFixedMargin = false;
    let marginSource = 'calculated';
    // User multiplier fixed at 1; margin scales with merged segment exposure + instrument rules only
    let leverage = 1;
    leverage = TradeService.capLeverageFromInstrument(instrument, leverage, isIntraday, isOptionBuy);
    const marginCalc = this.calculateMargin({ ...orderData, quantity: totalQuantity }, user, leverage);

    console.log('[OrderPlacement] Margin calculation debug:', {
      isCryptoWallet,
      isForexWallet,
      totalQuantity,
      leverage,
      marginCalcMargin: marginCalc.marginRequired,
      marginCalcTradeValue: marginCalc.tradeValue
    });

    const price = orderData.price || 0;
    const spreadUsdSide = Number(segmentSettings?.cryptoSpreadUsdPerSide);
    // For crypto/forex, use USD spread only (no INR conversion)
    const segmentSpreadMarkupUsd =
      (isCryptoWallet || isForexWallet) &&
      orderData.orderType === 'MARKET' &&
      orderData.side === 'BUY' &&
      spreadUsdSide > 0
        ? spreadUsdSide * totalQuantity
        : 0;
    const tradeValue = price * totalQuantity + segmentSpreadMarkupUsd;

    const oneWayBrokerage =
      await TradeService.calculateUserBrokerage(segmentSettings, scriptSettings, orderData, lots) +
      TradeService.instrumentAdditionalCommission(instrument, lots, tradeValue);
    let totalCommission = Math.round(oneWayBrokerage * 2 * 100) / 100;
    
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
        // Calculate margin based on quantity (margin per unit * quantity)
        marginRequired = (fixedMarginPerLot / lotSize) * totalQuantity;
        usedFixedMargin = true;
        marginSource = 'script_fixed';
      }
    }
    
    // Priority 2: Use segment exposure/leverage if no fixed margin
    // Dynamically resolve from all possible sources (admin sets these via UI)
    const segmentSettingsForMargin = TradeService.applyInstrumentExposureOverrides(instrument, segmentSettings);
    if (!usedFixedMargin && segmentSettingsForMargin) {
      const candidates = isIntraday
        ? [
            segmentSettingsForMargin?.quantityModeSettings?.intradayLeverage,
            segmentSettingsForMargin?.lotSettings?.intradayLeverage,
            segmentSettingsForMargin?.exposureIntraday,
            segmentSettingsForMargin?.intradayLeverage
          ]
        : [
            segmentSettingsForMargin?.quantityModeSettings?.carryForwardLeverage,
            segmentSettingsForMargin?.lotSettings?.carryForwardLeverage,
            segmentSettingsForMargin?.exposureCarryForward,
            segmentSettingsForMargin?.carryForwardLeverage
          ];
      let exposureNum = 1;
      for (const v of candidates) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 1) { exposureNum = n; break; }
      }

      console.log('[OrderPlacement] Margin calculation debug:', {
        isCryptoWallet,
        isForexWallet,
        tradeValue,
        exposureNum,
        leverage,
        candidates,
        marginRequiredBefore: marginRequired
      });

      if (exposureNum > 1) {
        marginRequired = tradeValue / exposureNum / leverage;
        marginSource = 'segment_exposure';
        console.log('[OrderPlacement] Margin after segment_exposure:', marginRequired);
      }
    }
    
    // Priority 3: Fall back to default calculated margin
    if (marginRequired === 0) {
      marginRequired = marginCalc.marginRequired;
      marginSource = 'default_calculated';
    }
    
    // Determine if MCX trade - check before applying minimum margin
    const isMCXTrade = orderData.exchange === 'MCX' || orderData.segment === 'MCX' ||
                       orderData.segment === 'MCXFUT' || orderData.segment === 'MCXOPT';
    const isCryptoTrade = isCryptoWallet || isForexWallet;

    // CRITICAL: Ensure minimum margin is required (prevent 0 margin trades)
    // Minimum margin should be at least 1% of trade value or ₹100, whichever is higher
    // EXCLUDE MCX trades AND crypto/forex trades from minimum margin enforcement - they use leverage-based calculation
    if (!isMCXTrade && !isCryptoTrade) {
      const minMargin = Math.max(tradeValue * 0.01, 100);
      if (marginRequired < minMargin && tradeValue > 0) {
        console.log(`[Trade] Margin too low (${marginRequired}), setting minimum margin: ${minMargin}`);
        marginRequired = minMargin;
        marginSource = 'minimum_enforced';
      }
    }

    // Determine if MCX trade - check before balance validation
    const isMCXTradeEarly = orderData.exchange === 'MCX' || orderData.segment === 'MCX' ||
                           orderData.segment === 'MCXFUT' || orderData.segment === 'MCXOPT';

    // For crypto/forex, use USD cost (no INR conversion)
    const spotTradeCostUsd =
      isCryptoWallet || isForexWallet ? price * totalQuantity + segmentSpreadMarkupUsd : 0;

    // Use appropriate wallet based on trade type
    let availableBalance;
    if (isCryptoWallet) {
      availableBalance = user.cryptoWallet?.balance || 0;
      // Only check marginRequired, don't include commission in balance check
      if (marginRequired > availableBalance) {
        throw new Error(`Insufficient crypto wallet balance. Required: ${marginRequired.toFixed(2)}, Available: ${availableBalance.toFixed(2)}`);
      }
    } else if (isForexWallet) {
      availableBalance = user.forexWallet?.balance || 0;
      // Only check marginRequired, don't include commission in balance check
      if (marginRequired > availableBalance) {
        throw new Error(`Insufficient forex wallet balance. Required: ${marginRequired.toFixed(2)}, Available: ${availableBalance.toFixed(2)}`);
      }
    } else if (isMCXTradeEarly) {
      // MCX trades use MCX wallet balance
      // Re-fetch user to get latest MCX wallet balance
      const freshUser = await User.findById(user._id).select('mcxWallet');
      const mcxBalance = freshUser?.mcxWallet?.balance || 0;
      console.log('[MCX Trade] FRESH mcxWallet:', JSON.stringify(freshUser?.mcxWallet), 'mcxBalance:', mcxBalance);

      // SIMPLE CHECK: If MCX wallet balance > 0, allow trade (margin check done separately)
      if (mcxBalance <= 0) {
        throw new Error(`Cannot place trade. Your MCX wallet balance is ₹${mcxBalance}. Please add funds to your MCX wallet.`);
      }
      // Update user object with fresh MCX wallet data
      user.mcxWallet = freshUser.mcxWallet;
    } else {
      // Regular trades (NSE/BSE) use trading balance with margin system
      const walletBalance = user.wallet?.tradingBalance || user.wallet?.cashBalance || user.wallet?.balance || 0;
      const blockedMargin = user.wallet?.usedMargin || user.wallet?.blocked || 0;

      // CRITICAL: Check if wallet balance is 0 or negative - reject trade immediately
      if (walletBalance <= 0) {
        throw new Error(`Cannot place trade. Your trading balance is ₹0. Please add funds to your trading account.`);
      }
      
      // NEW DELIVERY PLEDGE LOGIC:
      // Pledge margin can ONLY be used for NFO/Futures margin requirement, NOT for losses
      // Check if this is an NFO/Futures trade (not Cash/Delivery)
      const isNFOTrade = orderData.segment === 'NFO' || orderData.segment === 'NSEFUT' || 
                         orderData.segment === 'NSEOPT' || orderData.segment === 'FNO' ||
                         orderData.exchange === 'NFO' || orderData.instrumentType === 'FUTURES' ||
                         orderData.instrumentType === 'OPTIONS';
      const isCashTrade = orderData.productType === 'CNC' || orderData.productType === 'DELIVERY' ||
                          orderData.segment === 'NSE-EQ' || orderData.segment === 'BSE-EQ' ||
                          orderData.segment === 'EQUITY';
      
      // Pledge margin only available for NFO/Futures trades (for margin only, not losses)
      const pledgeBalance = user.deliveryPledge?.balance || 0;
      const pledgeUsedMargin = user.deliveryPledge?.usedMargin || 0;
      const pledgeSettings = admin?.deliveryPledgeSettings || { haircutPercent: 10, pledgeMarginPercent: 50 };
      const haircutPercent = pledgeSettings.haircutPercent || 10;
      
      // Usable pledge = (balance - usedMargin) * (1 - haircut%)
      // Only available for NFO/Futures trades
      const usablePledge = isNFOTrade ? (pledgeBalance - pledgeUsedMargin) * (1 - haircutPercent / 100) : 0;
      
      // Get user's leverage for this segment
      const leverage = await this.getUserLeverageForSegment(user, orderData.segment);

      // For Cash/Delivery trades: 1:1 leverage, no pledge benefit
      // For NFO/Futures trades: wallet + pledge margin available for margin requirement
      // UPDATED: Use leverage-based calculation: (balance * leverage) - usedMargin + pledge
      availableBalance = (walletBalance * leverage) - blockedMargin + Math.max(0, usablePledge);

      // CRITICAL CHANGE: Compare required margin against total wallet balance instead of available balance
      // This allows trades as long as required margin <= total balance, regardless of used margin
      const totalWalletBalance = walletBalance;
      const totalRequired = marginRequired + totalCommission;

      // Check if user has enough for margin + commission
      if (totalRequired > totalWalletBalance) {
        const pledgeMsg = isNFOTrade && usablePledge > 0 ? ` (Pledge: ${Math.max(0, usablePledge).toLocaleString()} available)` : '';
        throw new Error(`Insufficient funds. Required: ${totalRequired.toLocaleString()}, Available: ${totalWalletBalance.toLocaleString()}${pledgeMsg}`);
      }
    }

    // Indian Net Trading: BUY uses Ask price, SELL uses Bid price
    let baseEntryPrice = orderData.price || 0;
    if (orderData.orderType === 'MARKET') {
      if (orderData.side === 'BUY') {
        baseEntryPrice = orderData.askPrice || orderData.price || 0;
      } else {
        baseEntryPrice = orderData.bidPrice || orderData.price || 0;
      }
    }
    
    let effectiveEntryPrice = baseEntryPrice;
    if (orderData.orderType === 'MARKET' && totalSpreadUsd > 0) {
      if (orderData.side === 'BUY') {
        effectiveEntryPrice = baseEntryPrice + totalSpreadUsd;
      } else {
        effectiveEntryPrice = baseEntryPrice - totalSpreadUsd;
      }
    }
    
    const finalTradeValue = totalQuantity * effectiveEntryPrice;
    const totalCharges = totalCommission;

    // Get adminCode from user or fetch from admin if not set
    let adminCode = user.adminCode;
    console.log('[placeOrder] Initial adminCode:', adminCode, 'user.admin:', user.admin);
    if (!adminCode && user.admin) {
      const userAdmin = await Admin.findById(user.admin);
      adminCode = userAdmin?.adminCode || 'SYSTEM';
      console.log('[placeOrder] Fetched adminCode from user.admin:', adminCode);
      // Update user with adminCode for future trades using updateOne to avoid validation issues
      await User.updateOne({ _id: user._id }, { $set: { adminCode: adminCode } });
      user.adminCode = adminCode;
    }
    // If still no adminCode, use SYSTEM as default for crypto trades
    if (!adminCode) {
      if (isCryptoWallet || isForexWallet) {
        adminCode = 'SYSTEM';
        console.log('[placeOrder] Using SYSTEM adminCode for USD spot trade');
      } else {
        throw new Error('User not linked to any admin. Please contact support.');
      }
    }

    const trade = new Trade({
      user: userId,
      userId: user.userId,
      adminCode: adminCode,
      segment: orderData.segment || 'FNO',
      instrumentType: orderData.instrumentType || 'OPTIONS',
      symbol: orderData.symbol,
      token: orderData.token, // Store token for price lookup
      pair: orderData.pair, // For crypto / forex pairs
      isCrypto: isCryptoWallet,
      isForex: isForexWallet,
      exchange: orderData.exchange || (isCryptoWallet ? 'BINANCE' : isForexWallet ? 'FOREX' : 'NFO'),
      expiry: orderData.expiry,
      strike: orderData.strike,
      optionType: orderData.optionType,
      side: orderData.side,
      productType: orderData.productType || 'MIS',
      intradayOnly: segmentSettings.defaultIntradayOnly === true,
      orderType: orderData.orderType || 'MARKET',
      quantity: totalQuantity,
      lotSize: lotSize,
      lots: lots,
      entryPrice: orderData.orderType === 'MARKET' ? effectiveEntryPrice : 0,
      limitPrice: orderData.orderType === 'LIMIT' ? orderData.limitPrice : null,
      triggerPrice: orderData.triggerPrice || null,
      stopLoss: orderData.stopLoss || null,
      target: orderData.target || null,
      marginUsed: marginRequired,
      leverage: leverage,
      effectiveMargin: marginCalc.effectiveMargin,
      spread: totalSpreadUsd,
      commission: totalCommission,
      totalCharges: totalCharges,
      status: orderData.orderType === 'MARKET' ? 'OPEN' : 'PENDING',
      bookType: 'B_BOOK',
      brokeragePrepaidRoundTrip: true
    });

    if (orderData.orderType === 'MARKET') {
      trade.entryPrice = effectiveEntryPrice;
      trade.currentPrice = orderData.price;
      trade.marketPrice = orderData.price;
    } else if (isCryptoWallet || isForexWallet) {
      if (trade.limitPrice != null && Number(trade.limitPrice) > 0) {
        trade.limitPrice = Number(trade.limitPrice);
      }
      if (trade.triggerPrice != null && Number(trade.triggerPrice) > 0) {
        trade.triggerPrice = Number(trade.triggerPrice);
      }
      if (trade.stopLoss != null && Number(trade.stopLoss) > 0) {
        trade.stopLoss = Number(trade.stopLoss);
      }
      if (trade.target != null && Number(trade.target) > 0) {
        trade.target = Number(trade.target);
      }
    }

    // Block margin from appropriate wallet
    let newTradingBalance, newUsedMargin, newBlocked, newCryptoBalance;
    let newForexBalance = user.forexWallet?.balance || 0;
    let newMcxBalance, newMcxUsedMargin;
    
    if (isCryptoWallet) {
      const cryptoBalance = user.cryptoWallet?.balance || 0;
      // Only deduct marginRequired, don't include commission in balance check
      const totalDeduction = marginRequired;
      newCryptoBalance = cryptoBalance - totalDeduction;

      if (newCryptoBalance < 0) {
        throw new Error(`Insufficient crypto wallet balance. Required: ${totalDeduction.toFixed(2)}, Available: ${cryptoBalance.toFixed(2)}`);
      }

      newTradingBalance = user.wallet.tradingBalance || 0;
      newUsedMargin = user.wallet.usedMargin || 0;
      newBlocked = user.wallet.blocked || 0;
      newMcxBalance = user.mcxWallet?.balance || 0;
      newMcxUsedMargin = user.mcxWallet?.usedMargin || 0;
      console.log(`Crypto trade: Deducting ${totalDeduction.toFixed(2)} from crypto wallet`);

      trade.marginUsed = marginRequired;
    } else if (isForexWallet) {
      const forexBalance = user.forexWallet?.balance || 0;
      // Only deduct marginRequired, don't include commission in balance check
      const totalDeduction = marginRequired;
      newForexBalance = forexBalance - totalDeduction;

      if (newForexBalance < 0) {
        throw new Error(`Insufficient forex wallet balance. Required: ${totalDeduction.toFixed(2)}, Available: ${forexBalance.toFixed(2)}`);
      }
      
      newCryptoBalance = user.cryptoWallet?.balance || 0;
      newTradingBalance = user.wallet.tradingBalance || 0;
      newUsedMargin = user.wallet.usedMargin || 0;
      newBlocked = user.wallet.blocked || 0;
      newMcxBalance = user.mcxWallet?.balance || 0;
      newMcxUsedMargin = user.mcxWallet?.usedMargin || 0;
      console.log(`Forex trade: Deducting ${totalDeduction.toFixed(2)} from forex wallet`);
      
      trade.marginUsed = marginRequired;
    } else if (isMCXTrade) {
      // MCX trades: Block margin in usedMargin, deduct only commission from balance
      const mcxBalance = user.mcxWallet?.balance || 0;
      
      // SIMPLE CHECK: If MCX wallet balance > required margin, allow trade
      if (marginRequired > mcxBalance) {
        throw new Error(`Insufficient MCX wallet balance. Required: ${marginRequired.toLocaleString()}, Available: ${mcxBalance.toLocaleString()}`);
      }
      
      // Update MCX wallet - do NOT deduct anything from balance, only track margin in usedMargin
      newMcxBalance = mcxBalance; // Balance unchanged
      newMcxUsedMargin = (user.mcxWallet?.usedMargin || 0) + marginRequired; // Block margin

      // Regular wallet unchanged for MCX trades
      newTradingBalance = user.wallet.tradingBalance || 0;
      newUsedMargin = user.wallet.usedMargin || 0;
      newBlocked = user.wallet.blocked || 0;
      newCryptoBalance = user.cryptoWallet?.balance || 0;
      newForexBalance = user.forexWallet?.balance || 0;
      console.log(`MCX trade: Blocking ₹${marginRequired.toLocaleString()} margin. Balance: ₹${newMcxBalance.toLocaleString()}, UsedMargin: ₹${newMcxUsedMargin.toLocaleString()}`);
    } else {
      // Regular trades: Block margin in usedMargin, deduct only commission from balance
      // Available = tradingBalance - usedMargin, so margin is only tracked in usedMargin
      
      // NEW DELIVERY PLEDGE LOGIC for NFO/Futures:
      // Check if this is an NFO/Futures trade that can use pledge margin
      const isNFOTrade = orderData.segment === 'NFO' || orderData.segment === 'NSEFUT' || 
                         orderData.segment === 'NSEOPT' || orderData.segment === 'FNO' ||
                         orderData.exchange === 'NFO' || orderData.instrumentType === 'FUTURES' ||
                         orderData.instrumentType === 'OPTIONS';
      
      const walletBalance = user.wallet.tradingBalance || 0;
      const walletUsedMargin = user.wallet.usedMargin || 0;
      const walletAvailable = walletBalance - walletUsedMargin;
      
      // Calculate how much margin comes from pledge vs wallet
      // NEW LOGIC: Pledge FIRST, then Wallet
      let marginFromWallet = 0;
      let marginFromPledge = 0;
      
      if (isNFOTrade) {
        // For NFO trades, use pledge margin FIRST, then wallet
        const pledgeBalance = user.deliveryPledge?.balance || 0;
        const pledgeUsedMargin = user.deliveryPledge?.usedMargin || 0;
        const pledgeSettings = admin?.deliveryPledgeSettings || { haircutPercent: 10 };
        const haircutPercent = pledgeSettings.haircutPercent || 10;
        const usablePledge = (pledgeBalance - pledgeUsedMargin) * (1 - haircutPercent / 100);
        
        // PRIORITY: Use pledge margin FIRST, then wallet for remaining
        if (usablePledge > 0) {
          marginFromPledge = Math.min(marginRequired, usablePledge);
          marginFromWallet = Math.max(0, marginRequired - marginFromPledge);
          console.log(`NFO Trade: Using ₹${marginFromPledge.toLocaleString()} from pledge (FIRST) + ₹${marginFromWallet.toLocaleString()} from wallet`);
        } else {
          // No pledge available, use wallet only
          marginFromWallet = marginRequired;
        }
      } else {
        // Non-NFO trades use wallet only
        marginFromWallet = marginRequired;
      }
      
      newTradingBalance = walletBalance - totalCommission; // Only commission deducted
      newUsedMargin = walletUsedMargin + marginFromWallet; // Block wallet margin
      newBlocked = (user.wallet.blocked || 0) + marginFromWallet;
      newCryptoBalance = user.cryptoWallet?.balance || 0;
      newForexBalance = user.forexWallet?.balance || 0;
      newMcxBalance = user.mcxWallet?.balance || 0;
      newMcxUsedMargin = user.mcxWallet?.usedMargin || 0;
      
      // Track pledge margin usage for NFO trades
      if (marginFromPledge > 0) {
        // Store pledge margin used in trade for release on close
        trade.pledgeMarginUsed = marginFromPledge;
      }
    }
    
    // Prevent negative balances
    newTradingBalance = Math.max(0, newTradingBalance);
    newCryptoBalance = Math.max(0, newCryptoBalance ?? 0);
    newForexBalance = Math.max(0, newForexBalance ?? 0);
    newMcxBalance = Math.max(0, newMcxBalance);
    
    // Use updateOne to avoid validation issues with segmentPermissions
    // Update only the relevant wallet based on trade type
    const updateFields = {};

    if (isCryptoWallet) {
      updateFields['cryptoWallet.balance'] = newCryptoBalance;
    } else if (isForexWallet) {
      updateFields['forexWallet.balance'] = newForexBalance;
    } else if (isMCXTrade) {
      updateFields['mcxWallet.balance'] = newMcxBalance;
      updateFields['mcxWallet.usedMargin'] = newMcxUsedMargin;
    } else {
      // Regular trading wallet (NSE/BSE)
      updateFields['wallet.tradingBalance'] = newTradingBalance;
      updateFields['wallet.usedMargin'] = newUsedMargin;
      updateFields['wallet.blocked'] = newBlocked;
    }
    
    // Update pledge margin usage for NFO trades
    const marginFromPledge = trade.pledgeMarginUsed || 0;
    if (marginFromPledge > 0) {
      updateFields['deliveryPledge.usedMargin'] = (user.deliveryPledge?.usedMargin || 0) + marginFromPledge;
      updateFields['deliveryPledge.lastUpdated'] = new Date();
    }
    
    // Deduct available quantity when opening a position (non–USD-spot only)
    if (!isUsdSpot && segmentSettings) {
      const segment = orderData.segment || 'NSEFUT';
      const isIntradayOrder = orderData.productType === 'MIS' || orderData.productType === 'INTRADAY';
      const maxQty = isIntradayOrder 
        ? (segmentSettings.maxIntradayQty || 2000) 
        : (segmentSettings.maxCarryQty || 1000);
      const currentAvailableQty = isIntradayOrder 
        ? (segmentSettings.availableIntradayQty ?? maxQty) 
        : (segmentSettings.availableCarryQty ?? maxQty);
      
      // Deduct the traded quantity from available
      const newAvailableQty = Math.max(0, currentAvailableQty - totalQuantity);
      const qtyField = isIntradayOrder ? 'availableIntradayQty' : 'availableCarryQty';
      updateFields[`segmentPermissions.${segment}.${qtyField}`] = newAvailableQty;
      
      console.log(`Dynamic Qty Deduct: ${segment} ${orderData.productType} - Qty: ${totalQuantity}, Available: ${currentAvailableQty} -> ${newAvailableQty}`);
    }
    
    await User.updateOne(
      { _id: user._id },
      { $set: updateFields }
    );
    
    // Update local user object
    user.wallet.tradingBalance = newTradingBalance;
    user.wallet.usedMargin = newUsedMargin;
    user.wallet.blocked = newBlocked;
    if (isCryptoWallet) {
      if (!user.cryptoWallet) user.cryptoWallet = {};
      user.cryptoWallet.balance = newCryptoBalance;
    }
    if (isForexWallet) {
      if (!user.forexWallet) user.forexWallet = {};
      user.forexWallet.balance = newForexBalance;
    }
    if (isMCXTrade) {
      if (!user.mcxWallet) user.mcxWallet = {};
      user.mcxWallet.balance = newMcxBalance;
      user.mcxWallet.usedMargin = newMcxUsedMargin;
    }
    
    await trade.save();

    console.log('[placeOrder] Before brokerage distribution check:', {
      status: trade.status,
      bookType: trade.bookType,
      admin: admin ? admin.adminCode : null,
      adminRole: admin ? admin.role : null,
      isDemo: user.isDemo,
      commission: trade.commission || 0,
      userId: user.userId,
      tradeId: trade._id,
      isCryptoWallet,
      isForexWallet
    });

    if (trade.status === 'OPEN' && trade.bookType === 'B_BOOK' && admin && !user.isDemo) {
      const brk = trade.commission || 0;
      console.log('[placeOrder] Brokerage distribution check PASSED:', {
        status: trade.status,
        bookType: trade.bookType,
        admin: admin ? admin.adminCode : null,
        adminRole: admin ? admin.role : null,
        isDemo: user.isDemo,
        commission: brk,
        userId: user.userId,
        tradeId: trade._id
      });
      if (brk > 0) {
        try {
          await TradeService.distributeBrokerageWithPatti(trade, brk, admin, user);
          console.log('[placeOrder] Brokerage distributed successfully');
        } catch (distErr) {
          console.error('[placeOrder] distributeBrokerageWithPatti at open:', distErr?.message || distErr);
        }
      } else {
        console.log('[placeOrder] Commission is 0, skipping brokerage distribution');
      }
    } else {
      console.log('[placeOrder] Brokerage distribution skipped:', {
        status: trade.status,
        bookType: trade.bookType,
        admin: admin ? admin.adminCode : null,
        isDemo: user.isDemo,
        commission: trade.commission
      });
    }

    // USD spot pending LIMIT/SL: fill when book satisfies (ticks also fill via processPendingOrdersForUsdSpotTick)
    if ((isCryptoWallet || isForexWallet) && trade.status === 'PENDING') {
      const refPrice =
        trade.side === 'BUY'
          ? Number(orderData.askPrice || orderData.price || 0)
          : Number(orderData.bidPrice || orderData.price || 0);
      if (refPrice > 0) {
        const executed = await this.executePendingOrder(trade._id, refPrice);
        if (executed) {
          trade.status = executed.status;
          trade.entryPrice = executed.entryPrice;
          trade.currentPrice = executed.currentPrice;
          trade.openedAt = executed.openedAt;
          const { invalidateMarginOpenTradesCache } = await import('./marginMonitorService.js');
          invalidateMarginOpenTradesCache?.();
        }
      }
    }

    // ==================== STEP 16: RECALCULATE WALLET STATE (TradePro) ====================
    // Recalculate entire wallet state after trade placement
    const walletField = WalletService.getWalletFieldFromTrade(trade);
    await WalletService.recalculateWallet(userId, orderData.segment);

    if (!isUsdSpot) {
      await checkMarginWarning(user, newUsedMargin, newTradingBalance);
    }

    // Delivery Pledge Logic - Add pledge when user BUYS in delivery (CNC)
    // Get pledge settings from admin or system defaults
    const isDeliveryTrade = orderData.productType === 'CNC' || orderData.productType === 'DELIVERY';
    if (isDeliveryTrade && orderData.side === 'BUY' && !isUsdSpot) {
      try {
        // Get pledge settings from admin or use defaults
        const pledgeSettings = admin?.deliveryPledgeSettings || { enabled: true, buyPledgePercent: 50, maxPledgeAmount: 0 };
        
        if (pledgeSettings.enabled) {
          const tradeValue = totalQuantity * effectiveEntryPrice;
          const pledgeAmount = (tradeValue * (pledgeSettings.buyPledgePercent || 50)) / 100;
          
          // Check max pledge limit
          const currentPledge = user.deliveryPledge?.balance || 0;
          const maxPledge = pledgeSettings.maxPledgeAmount || 0;
          let finalPledgeAmount = pledgeAmount;
          
          if (maxPledge > 0 && (currentPledge + pledgeAmount) > maxPledge) {
            finalPledgeAmount = Math.max(0, maxPledge - currentPledge);
          }
          
          if (finalPledgeAmount > 0) {
            await User.updateOne(
              { _id: user._id },
              { 
                $inc: { 'deliveryPledge.balance': finalPledgeAmount, 'deliveryPledge.holdingsValue': tradeValue },
                $set: { 'deliveryPledge.lastUpdated': new Date() }
              }
            );
            console.log(`Delivery Pledge: Added ₹${finalPledgeAmount.toLocaleString()} to user ${user.userId} (${pledgeSettings.buyPledgePercent}% of ₹${tradeValue.toLocaleString()})`);
          }
        }
      } catch (pledgeErr) {
        console.error('Delivery Pledge error:', pledgeErr);
        // Don't fail the trade if pledge update fails
      }
    }

    return {
      success: true,
      trade,
      marginBlocked: marginRequired,
      tradeValue: marginCalc.tradeValue,
      leverage,
      spread: totalSpreadUsd,
      commission: totalCommission,
      totalCharges: totalCharges,
      availableBalance: availableBalance - marginRequired - totalCommission
    };
  }

  // Execute pending order when price matches
  static async executePendingOrder(tradeId, currentPrice) {
    const trade = await Trade.findById(tradeId);
    if (!trade || trade.status !== 'PENDING') return null;

    const ref = currentPrice;
    let shouldExecute = false;

    if (trade.orderType === 'LIMIT') {
      if (trade.side === 'BUY' && ref <= trade.limitPrice) shouldExecute = true;
      else if (trade.side === 'SELL' && ref >= trade.limitPrice) shouldExecute = true;
    } else if (trade.orderType === 'SL' || trade.orderType === 'SL-M') {
      if (trade.side === 'BUY' && ref >= trade.triggerPrice) shouldExecute = true;
      else if (trade.side === 'SELL' && ref <= trade.triggerPrice) shouldExecute = true;
    }

    if (shouldExecute) {
      trade.status = 'OPEN';
      trade.entryPrice = tradeIsUsdSpot(trade) ? ref : currentPrice;
      trade.currentPrice = tradeIsUsdSpot(trade) ? ref : currentPrice;
      trade.marketPrice = tradeIsUsdSpot(trade) ? ref : currentPrice;
      trade.openedAt = new Date();
      await trade.save();
      const uid = trade.user;
      const usr = uid ? await User.findById(uid) : null;
      const adm = trade.adminCode ? await Admin.findOne({ adminCode: trade.adminCode }) : null;
      if (
        usr &&
        adm &&
        trade.bookType === 'B_BOOK' &&
        !usr.isDemo &&
        trade.brokeragePrepaidRoundTrip &&
        (trade.commission || 0) > 0
      ) {
        try {
          await TradeService.distributeBrokerageWithPatti(trade, trade.commission, adm, usr);
        } catch (e) {
          console.error('[executePendingOrder] distributeBrokerageWithPatti at open:', e?.message || e);
        }
      }
      return trade;
    }

    return null;
  }

  // Check stop loss and target
  static async checkStopLossTarget(tradeId, currentPrice) {
    const trade = await Trade.findById(tradeId);
    if (!trade || trade.status !== 'OPEN') return null;

    const ref = currentPrice;
    let shouldClose = false;
    let closeReason = null;

    if (trade.stopLoss) {
      if (trade.side === 'BUY' && ref <= trade.stopLoss) {
        shouldClose = true;
        closeReason = 'STOP_LOSS';
      } else if (trade.side === 'SELL' && ref >= trade.stopLoss) {
        shouldClose = true;
        closeReason = 'STOP_LOSS';
      }
    }

    if (trade.target && !shouldClose) {
      if (trade.side === 'BUY' && ref >= trade.target) {
        shouldClose = true;
        closeReason = 'TARGET';
      } else if (trade.side === 'SELL' && ref <= trade.target) {
        shouldClose = true;
        closeReason = 'TARGET';
      }
    }

    if (shouldClose) {
      return await this.closeTrade(tradeId, currentPrice, closeReason);
    }

    return null;
  }

  // Close trade
  static async closeTrade(tradeId, exitPrice, reason = 'MANUAL') {
    const trade = await Trade.findById(tradeId);
    if (!trade || trade.status !== 'OPEN') {
      throw new Error('Trade not found or already closed');
    }

    const user = await User.findById(trade.user);
    if (!user) throw new Error('User not found');
    
    const admin = await Admin.findOne({ adminCode: trade.adminCode });

    // Apply spread to exit price (opposite of entry).
    const spreadPoints = trade.spread || 0;
    let effectiveExitPrice = exitPrice;

    if (spreadPoints > 0) {
      if (trade.side === 'BUY') {
        effectiveExitPrice = exitPrice - spreadPoints;
      } else {
        effectiveExitPrice = exitPrice + spreadPoints;
      }
    }

    trade.exitPrice = effectiveExitPrice;
    const charges = await Charges.calculateCharges(trade, trade.adminCode, trade.user);
    trade.charges = charges;

    const multiplier = trade.side === 'BUY' ? 1 : -1;
    const priceDiff = (effectiveExitPrice - trade.entryPrice) * multiplier;
    const grossPnL = priceDiff * trade.quantity;

    const closingCharges = (charges.exchange || 0) + (charges.gst || 0) + (charges.stt || 0) + (charges.sebi || 0) + (charges.stamp || 0);
    const netPnL = grossPnL - closingCharges;

    trade.exitPrice = effectiveExitPrice;
    trade.effectiveExitPrice = effectiveExitPrice;
    trade.status = 'CLOSED';
    trade.closeReason = reason;
    trade.closedAt = new Date();
    trade.realizedPnL = grossPnL;
    trade.pnl = grossPnL;
    trade.unrealizedPnL = 0;
    trade.netPnL = netPnL;
    
    // Admin P&L (opposite in B_BOOK)
    if (trade.bookType === 'B_BOOK') {
      trade.adminPnL = -netPnL;
    } else {
      trade.adminPnL = 0;
    }

    await trade.save();
    
    // Create ledger entry for user P&L
    const isMCXTrade = trade.exchange === 'MCX' || trade.segment === 'MCX' || 
                       trade.segment === 'MCXFUT' || trade.segment === 'MCXOPT';
    
    const walletField = trade.isCrypto ? 'cryptoWallet' : trade.isForex ? 'forexWallet' : (isMCXTrade ? 'mcxWallet' : 'wallet');
    const balanceAfter = trade.isCrypto
      ? (user.cryptoWallet?.balance || 0)
      : trade.isForex
        ? (user.forexWallet?.balance || 0)
        : (isMCXTrade ? (user.mcxWallet?.balance || 0) : (user.wallet?.tradingBalance || user.wallet?.cashBalance || 0));
    
    await WalletLedger.create({
      ownerType: 'USER',
      ownerId: user._id,
      adminCode: user.adminCode,
      type: netPnL >= 0 ? 'CREDIT' : 'DEBIT',
      reason: 'TRADE_PNL',
      amount: Math.abs(netPnL),
      balanceAfter: balanceAfter + netPnL,
      reference: { type: 'Trade', id: trade._id },
      description: `${trade.symbol} ${trade.side} P&L${trade.isCrypto ? ' (Crypto)' : trade.isForex ? ' (Forex)' : (isMCXTrade ? ' (MCX)' : '')}`,
      isAutoSquare: trade.closeReason === 'AUTO_SQUARE'
    });

    // Release blocked margin and add/subtract P&L to appropriate wallet
    let newUsedMargin, newBlocked, newTradingBalance, newCryptoBalance, newCryptoRealizedPnL;
    let newForexBalance, newForexRealizedPnL;
    let newMcxBalance, newMcxUsedMargin, newMcxRealizedPnL;
    
    if (trade.isCrypto) {
      const tradeCostReturned = trade.marginUsed || 0;
      newUsedMargin = user.wallet.usedMargin || 0;
      newBlocked = user.wallet.blocked || 0;
      newTradingBalance = user.wallet.tradingBalance || 0;
      newCryptoBalance = (user.cryptoWallet?.balance || 0) + tradeCostReturned + netPnL;
      newCryptoRealizedPnL = (user.cryptoWallet?.realizedPnL || 0) + netPnL;
      newForexBalance = user.forexWallet?.balance || 0;
      newForexRealizedPnL = user.forexWallet?.realizedPnL || 0;
      newMcxBalance = user.mcxWallet?.balance || 0;
      newMcxUsedMargin = user.mcxWallet?.usedMargin || 0;
      newMcxRealizedPnL = user.mcxWallet?.realizedPnL || 0;
    } else if (trade.isForex) {
      const tradeCostReturned = trade.marginUsed || 0;
      newUsedMargin = user.wallet.usedMargin || 0;
      newBlocked = user.wallet.blocked || 0;
      newTradingBalance = user.wallet.tradingBalance || 0;
      newCryptoBalance = user.cryptoWallet?.balance || 0;
      newCryptoRealizedPnL = user.cryptoWallet?.realizedPnL || 0;
      newForexBalance = (user.forexWallet?.balance || 0) + tradeCostReturned + netPnL;
      newForexRealizedPnL = (user.forexWallet?.realizedPnL || 0) + netPnL;
      newMcxBalance = user.mcxWallet?.balance || 0;
      newMcxUsedMargin = user.mcxWallet?.usedMargin || 0;
      newMcxRealizedPnL = user.mcxWallet?.realizedPnL || 0;
    } else if (isMCXTrade) {
      newUsedMargin = user.wallet.usedMargin || 0;
      newBlocked = user.wallet.blocked || 0;
      newTradingBalance = user.wallet.tradingBalance || 0;
      newCryptoBalance = user.cryptoWallet?.balance || 0;
      newCryptoRealizedPnL = user.cryptoWallet?.realizedPnL || 0;
      newForexBalance = user.forexWallet?.balance || 0;
      newForexRealizedPnL = user.forexWallet?.realizedPnL || 0;
      newMcxUsedMargin = Math.max(0, (user.mcxWallet?.usedMargin || 0) - trade.marginUsed);
      newMcxBalance = (user.mcxWallet?.balance || 0) + netPnL;
      newMcxRealizedPnL = (user.mcxWallet?.realizedPnL || 0) + netPnL;
    } else {
      // NEW DELIVERY PLEDGE LOGIC:
      // Release wallet margin (marginUsed) - pledge margin is tracked separately
      // Losses MUST come from actual wallet, NOT from pledge margin
      newUsedMargin = Math.max(0, (user.wallet.usedMargin || 0) - trade.marginUsed);
      newBlocked = Math.max(0, (user.wallet.blocked || 0) - trade.marginUsed);
      
      // P&L is applied to wallet balance (losses come from wallet, not pledge)
      // Pledge margin is only for margin requirement, not for covering losses
      newTradingBalance = (user.wallet.tradingBalance || 0) + netPnL;
      
      newCryptoBalance = user.cryptoWallet?.balance || 0;
      newCryptoRealizedPnL = user.cryptoWallet?.realizedPnL || 0;
      newForexBalance = user.forexWallet?.balance || 0;
      newForexRealizedPnL = user.forexWallet?.realizedPnL || 0;
      newMcxBalance = user.mcxWallet?.balance || 0;
      newMcxUsedMargin = user.mcxWallet?.usedMargin || 0;
      newMcxRealizedPnL = user.mcxWallet?.realizedPnL || 0;
    }
    
    newTradingBalance = Math.max(0, newTradingBalance);
    newCryptoBalance = Math.max(0, newCryptoBalance);
    newForexBalance = Math.max(0, newForexBalance ?? 0);
    newMcxBalance = Math.max(0, newMcxBalance);
    
    const newRealizedPnL = (trade.isCrypto || trade.isForex || isMCXTrade)
      ? (user.wallet.realizedPnL || 0)
      : (user.wallet.realizedPnL || 0) + netPnL;
    
    const updateFields = {};

    if (trade.isCrypto) {
      updateFields['cryptoWallet.balance'] = newCryptoBalance;
      updateFields['cryptoWallet.realizedPnL'] = newCryptoRealizedPnL;
    } else if (trade.isForex) {
      updateFields['forexWallet.balance'] = newForexBalance;
      updateFields['forexWallet.realizedPnL'] = newForexRealizedPnL;
    } else if (isMCXTrade) {
      updateFields['mcxWallet.balance'] = newMcxBalance;
      updateFields['mcxWallet.usedMargin'] = newMcxUsedMargin;
      updateFields['mcxWallet.realizedPnL'] = newMcxRealizedPnL;
    } else {
      // Regular trading wallet (NSE/BSE)
      updateFields['wallet.blocked'] = newBlocked;
      updateFields['wallet.tradingBalance'] = newTradingBalance;
      updateFields['wallet.realizedPnL'] = newRealizedPnL;
    }

    // Release pledge margin if it was used for this trade (NFO/Futures)
    const pledgeMarginUsed = trade.pledgeMarginUsed || 0;
    if (pledgeMarginUsed > 0) {
      const currentPledgeUsedMargin = user.deliveryPledge?.usedMargin || 0;
      updateFields['deliveryPledge.usedMargin'] = Math.max(0, currentPledgeUsedMargin - pledgeMarginUsed);
      updateFields['deliveryPledge.lastUpdated'] = new Date();
      console.log(`NFO Trade Close: Released ₹${pledgeMarginUsed.toLocaleString()} pledge margin. P&L: ₹${netPnL.toLocaleString()} (from wallet)`);
    }
    
    // Dynamic Quantity Adjustment based on P&L
    // When user profits: add profit to available quantity (capped at max)
    // When user has loss: reduce available quantity
    const segment = trade.segment || 'NSEFUT';
    const productType = trade.productType || 'MIS';
    const isIntraday = productType === 'MIS';
    
    // Get user's segment permissions
    const segmentPerms = user.segmentPermissions?.get(segment);
    if (segmentPerms) {
      const maxQty = isIntraday ? (segmentPerms.maxIntradayQty || 2000) : (segmentPerms.maxCarryQty || 1000);
      const currentAvailableQty = isIntraday 
        ? (segmentPerms.availableIntradayQty || maxQty) 
        : (segmentPerms.availableCarryQty || maxQty);
      
      // Adjust available quantity based on P&L
      // Profit: add back the traded quantity (user can trade more)
      // Loss: deduct the P&L amount (absolute value) from available qty
      // Example: Max 2000, traded 1000, loss -800 => Available = 2000 - 800 = 1200
      let newAvailableQty;
      if (netPnL >= 0) {
        // Profit: add back the traded quantity (user can trade more)
        newAvailableQty = Math.min(maxQty, currentAvailableQty + trade.quantity);
      } else {
        // Loss: deduct the P&L amount (absolute value) from available qty
        // netPnL is negative, so Math.abs(netPnL) gives the loss amount
        const lossAmount = Math.abs(netPnL);
        newAvailableQty = Math.max(0, currentAvailableQty - lossAmount);
      }
      
      // Update the segment permission with new available quantity
      const qtyField = isIntraday ? 'availableIntradayQty' : 'availableCarryQty';
      updateFields[`segmentPermissions.${segment}.${qtyField}`] = newAvailableQty;
      
      console.log(`Dynamic Qty Adjustment: ${segment} ${productType} - P&L: ${netPnL}, Qty: ${trade.quantity}, Available: ${currentAvailableQty} -> ${newAvailableQty} (Max: ${maxQty})`);
    }

    await User.updateOne(
      { _id: user._id },
      { $set: updateFields }
    );
    
    // Delivery Pledge Logic - Add pledge when user SELLS delivery holdings
    const isDeliveryTrade = trade.productType === 'CNC' || trade.productType === 'DELIVERY';
    if (isDeliveryTrade && !trade.isCrypto && !trade.isForex) {
      try {
        // Get pledge settings from admin or use defaults
        const pledgeSettings = admin?.deliveryPledgeSettings || { enabled: true, sellPledgePercent: 50, maxPledgeAmount: 0 };
        
        if (pledgeSettings.enabled) {
          const tradeValue = trade.quantity * exitPrice;
          const pledgeAmount = (tradeValue * (pledgeSettings.sellPledgePercent || 50)) / 100;
          
          // Check max pledge limit
          const currentPledge = user.deliveryPledge?.balance || 0;
          const maxPledge = pledgeSettings.maxPledgeAmount || 0;
          let finalPledgeAmount = pledgeAmount;
          
          if (maxPledge > 0 && (currentPledge + pledgeAmount) > maxPledge) {
            finalPledgeAmount = Math.max(0, maxPledge - currentPledge);
          }
          
          if (finalPledgeAmount > 0) {
            // Reduce holdings value and add to pledge
            const holdingsReduction = trade.quantity * trade.entryPrice;
            await User.updateOne(
              { _id: user._id },
              { 
                $inc: { 'deliveryPledge.balance': finalPledgeAmount },
                $set: { 
                  'deliveryPledge.holdingsValue': Math.max(0, (user.deliveryPledge?.holdingsValue || 0) - holdingsReduction),
                  'deliveryPledge.lastUpdated': new Date() 
                }
              }
            );
            console.log(`Delivery Pledge (Sell): Added ₹${finalPledgeAmount.toLocaleString()} to user ${user.userId} (${pledgeSettings.sellPledgePercent}% of ₹${tradeValue.toLocaleString()})`);
          }
        }
      } catch (pledgeErr) {
        console.error('Delivery Pledge (Sell) error:', pledgeErr);
      }
    }

    // Distribute brokerage through MLM hierarchy (B_BOOK only)
    if (trade.bookType === 'B_BOOK' && admin) {
      await TradeService.applyBBookAdminPnLSplit(trade, admin, user, trade.adminPnL);

      if (!user.isDemo && (charges.brokerage || 0) > 0) {
        await TradeService.distributeBrokerageWithPatti(trade, charges.brokerage, admin, user);
      }
    }

    // Credit referral reward for first-time trading win (brokerage amount)
    if (netPnL > 0) {
      const brokerageAmount =
        (charges.brokerage || 0) > 0
          ? charges.brokerage
          : trade.brokeragePrepaidRoundTrip
            ? trade.commission || 0
            : 0;
      if (brokerageAmount > 0) {
        const referralResult = await creditReferralTradingReward(
          user._id,
          brokerageAmount,
          trade._id
        );
        if (referralResult.credited) {
          console.log(
            `[Referral] Credited ₹${referralResult.amount} to referrer for ${user.userId}'s first winning trade (${trade.symbol})`
          );
        }
      }
    }

    return {
      trade,
      pnl: netPnL,
      grossPnL,
      exitPrice: effectiveExitPrice,
      effectiveExitPrice: effectiveExitPrice,
      spread: spreadPoints,
      charges
    };
  }

  // Update P&L for all open trades
  static async updateTradesPnL(priceUpdates) {
    const openTrades = await Trade.find({ status: 'OPEN' });
    const results = [];

    for (const trade of openTrades) {
      if (trade.isCrypto || trade.isForex) continue;
      const currentPrice = priceUpdates[trade.symbol];
      if (!currentPrice) continue;

      const multiplier = trade.side === 'BUY' ? 1 : -1;
      const priceDiff = (currentPrice - trade.entryPrice) * multiplier;
      trade.unrealizedPnL = priceDiff * trade.quantity;
      trade.currentPrice = currentPrice;
      await trade.save();

      const closeResult = await this.checkStopLossTarget(trade._id, currentPrice);
      if (closeResult) {
        results.push({ trade: closeResult.trade, action: 'CLOSED', reason: closeResult.trade.closeReason });
        continue;
      }

      // Margin call check
      const user = await User.findById(trade.user);
      if (user && trade.unrealizedPnL < 0) {
        const walletBalance = user.wallet?.tradingBalance || user.wallet?.cashBalance || user.wallet?.balance || 0;
        const blockedMargin = user.wallet?.usedMargin || user.wallet?.blocked || 0;
        const availableBalance = walletBalance - blockedMargin;
        if (Math.abs(trade.unrealizedPnL) >= availableBalance) {
          const closeResult = await this.closeTrade(trade._id, currentPrice, 'RMS');
          results.push({ trade: closeResult.trade, action: 'MARGIN_CALL', pnl: closeResult.pnl });
        }
      }
    }

    return results;
  }

  // Get positions - optimized with lean() for faster response
  static async getPositions(userId, status = 'OPEN') {
    return Trade.find({ user: userId, status })
      .select('userId symbol token pair isCrypto isForex exchange segment instrumentType optionType strike expiry side productType quantity lotSize lots entryPrice currentPrice marketPrice unrealizedPnL marginUsed leverage spread commission status openedAt stopLoss target')
      .sort({ openedAt: -1 })
      .lean();
  }

  // Get pending orders - optimized
  static async getPendingOrders(userId) {
    return Trade.find({ user: userId, status: 'PENDING' })
      .select('userId symbol token pair exchange segment side productType quantity lots entryPrice limitPrice triggerPrice marginUsed status createdAt orderType isCrypto isForex commission')
      .sort({ createdAt: -1 })
      .lean();
  }

  // Get trade history - optimized
  static async getTradeHistory(userId, limit = 50) {
    return Trade.find({ user: userId, status: 'CLOSED' })
      .select('userId symbol exchange segment side productType quantity lots entryPrice exitPrice realizedPnL netPnL marginUsed commission closedAt createdAt openedAt closeReason isCrypto isForex status')
      .sort({ closedAt: -1 })
      .limit(limit)
      .lean();
  }

  // Get wallet summary - optimized with aggregation for faster P&L
  static async getWalletSummary(userId) {
    const user = await User.findById(userId).select('wallet').lean();
    if (!user) throw new Error('User not found');

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Use aggregation for faster P&L calculation
    const [openStats, closedStats] = await Promise.all([
      Trade.aggregate([
        { $match: { user: userId, status: 'OPEN' } },
        { $group: {
          _id: null,
          unrealizedPnL: { $sum: { $ifNull: ['$unrealizedPnL', 0] } },
          marginUsed: { $sum: { $ifNull: ['$marginUsed', 0] } },
          count: { $sum: 1 }
        }}
      ]),
      Trade.aggregate([
        { $match: { user: userId, status: 'CLOSED', closedAt: { $gte: todayStart } } },
        { $group: {
          _id: null,
          realizedPnL: { $sum: { $ifNull: ['$realizedPnL', 0] } }
        }}
      ])
    ]);

    const unrealizedPnL = openStats[0]?.unrealizedPnL || 0;
    const marginUsed = openStats[0]?.marginUsed || 0;
    const openPositions = openStats[0]?.count || 0;
    const realizedPnL = closedStats[0]?.realizedPnL || 0;

    // Use tradingBalance for trading (dual wallet system)
    const walletBalance = user.wallet?.tradingBalance || user.wallet?.cashBalance || user.wallet?.balance || 0;
    const blockedMargin = user.wallet?.usedMargin || user.wallet?.blocked || 0;
    
    return {
      balance: walletBalance,
      tradingBalance: walletBalance,
      blocked: blockedMargin,
      usedMargin: blockedMargin,
      available: walletBalance - blockedMargin,
      availableMargin: walletBalance - blockedMargin,
      unrealizedPnL,
      realizedPnL,
      totalPnL: unrealizedPnL + realizedPnL,
      marginUsed,
      openPositions
    };
  }

  // Cancel order
  static async cancelOrder(tradeId, userId) {
    const trade = await Trade.findOne({ _id: tradeId, user: userId, status: 'PENDING' });
    if (!trade) throw new Error('Pending order not found');

    const user = await User.findById(userId);
    // Release blocked margin - update both primary and legacy fields
    // For crypto trades, no margin was blocked
    let newUsedMargin, newBlocked, newTradingBalance;
    
    if (trade.isCrypto || trade.isForex) {
      newUsedMargin = user.wallet.usedMargin || 0;
      newBlocked = user.wallet.blocked || 0;
      newTradingBalance = user.wallet.tradingBalance || 0;
      const refund = (trade.marginUsed || 0) + (trade.commission || 0);
      console.log(`USD spot order cancelled: Refunding ₹${refund.toFixed(2)} to ${trade.isForex ? 'forex' : 'crypto'} wallet`);
    } else {
      // Regular trades: Release margin
      newUsedMargin = Math.max(0, (user.wallet.usedMargin || 0) - trade.marginUsed);
      newBlocked = Math.max(0, (user.wallet.blocked || 0) - trade.marginUsed);
      newTradingBalance = (user.wallet.tradingBalance || 0) + trade.marginUsed;
    }
    
    const walletUpdate = {
      'wallet.usedMargin': newUsedMargin,
      'wallet.blocked': newBlocked,
      'wallet.tradingBalance': newTradingBalance
    };
    if (trade.isCrypto) {
      const refund = (trade.marginUsed || 0) + (trade.commission || 0);
      walletUpdate['cryptoWallet.balance'] = (user.cryptoWallet?.balance || 0) + refund;
    }
    if (trade.isForex) {
      const refund = (trade.marginUsed || 0) + (trade.commission || 0);
      walletUpdate['forexWallet.balance'] = (user.forexWallet?.balance || 0) + refund;
    }
    await User.updateOne({ _id: userId }, { $set: walletUpdate });

    trade.status = 'CANCELLED';
    await trade.save();

    return { success: true, trade };
  }

  // Legacy methods
  static async getOrders(userId, status = null) {
    const query = { user: userId };
    if (status) query.status = status;
    return Trade.find(query).sort({ createdAt: -1 });
  }

  static async squareOffPosition(positionId, reason = 'MANUAL', exitPrice = null, bidPrice = null, askPrice = null) {
    const trade = await Trade.findById(positionId);
    if (!trade) throw new Error('Position not found');
    
    // Check if this is a crypto trade
    const isCrypto = trade.isCrypto || trade.exchange === 'BINANCE';
    const isForex = trade.isForex || trade.exchange === 'FOREX' ||
      ['FOREX', 'FOREXFUT', 'FOREXOPT'].includes(String(trade.segment || '').toUpperCase());
    const isUsdSpotExit = isCrypto || isForex;
    
    // Indian Net Trading: Use correct price based on position side
    // BUY position closes at Bid price (you sell at bid)
    // SELL position closes at Ask price (you buy at ask)
    let price = exitPrice || trade.currentPrice || trade.entryPrice;
    
    // Priority for exit price:
    // 1. Specific bid/ask based on position side
    // 2. Explicit exitPrice parameter
    // 3. Trade's current market price
    // 4. Trade's entry price as last resort
    if (trade.side === 'BUY') {
      // Closing a BUY = selling, use bid price
      price = bidPrice || exitPrice || trade.currentPrice || trade.entryPrice;
    } else {
      // Closing a SELL = buying, use ask price
      price = askPrice || exitPrice || trade.currentPrice || trade.entryPrice;
    }

    if (isUsdSpotExit && (bidPrice > 0 || askPrice > 0)) {
      try {
        const u = await User.findById(trade.user).populate('admin', 'segmentPermissions segmentExplicitKeys').lean();
        if (u?.admin?.segmentPermissions) {
          u.parentSegmentPermissions = u.admin.segmentPermissions;
        }
        const seg = await TradeService.getUserSegmentSettings(u, trade.segment, trade.instrumentType);
        const halfUsd = TradeService.segmentCryptoSpreadHalfUsd(seg);
        if (halfUsd > 0) {
          if (trade.side === 'BUY' && bidPrice > 0) {
            price = bidPrice - halfUsd;
          } else if (trade.side === 'SELL' && askPrice > 0) {
            price = askPrice + halfUsd;
          }
        }
      } catch (e) {
        console.warn('[squareOff] client spread merge skipped:', e?.message || e);
      }
    }
    
    if (!price || price <= 0) {
      const e = trade.entryPrice || 0;
      price = e > 0 ? e : e;
      console.log(`Using entry-based price ${price} as exit price`);
    }
    
    // Validate price is reasonable (not zero or negative)
    if (!price || price <= 0) {
      throw new Error('Invalid exit price. Please try again with valid market data.');
    }
    
    console.log(`Closing ${trade.side} position ${positionId}: exitPrice=${price}, bid=${bidPrice}, ask=${askPrice}, current=${trade.currentPrice}, usdSpot=${isUsdSpotExit}`);
    
    return this.closeTrade(positionId, price, reason);
  }

  static async processPendingOrders(priceUpdates) {
    const pendingTrades = await Trade.find({ status: 'PENDING' });
    const results = [];

    for (const trade of pendingTrades) {
      const currentPrice = priceUpdates[trade.symbol];
      if (!currentPrice) continue;

      const executed = await this.executePendingOrder(trade._id, currentPrice);
      if (executed) {
        results.push({ trade: executed, action: 'EXECUTED' });
      }
    }

    return results;
  }

  /**
   * Fill pending LIMIT/SL when bid/ask crosses (Binance crypto + synthetic forex ticks).
   */
  static async processPendingOrdersForUsdSpotTick({ pair, symbol, bid, ask, ltp }) {
    const pairU = String(pair || '').toUpperCase();
    const symU = String(symbol || '').toUpperCase();
    if (!pairU && !symU) return [];

    const or = [];
    if (pairU) {
      or.push({ pair: pairU }, { token: pairU });
    }
    if (symU) {
      or.push({ symbol: symU });
    }
    if (or.length === 0) return [];

    const pending = await Trade.find({
      status: 'PENDING',
      $or: [{ isCrypto: true }, { isForex: true }],
      $and: [{ $or: or }],
    });

    const filled = [];
    for (const t of pending) {
      const ref =
        t.side === 'BUY'
          ? Number(ask || ltp || 0)
          : Number(bid || ltp || 0);
      if (!(ref > 0)) continue;
      const executed = await this.executePendingOrder(t._id, ref);
      if (executed) filled.push(executed);
    }

    if (filled.length) {
      const { invalidateMarginOpenTradesCache } = await import('./marginMonitorService.js');
      invalidateMarginOpenTradesCache?.();
    }
    return filled;
  }

  static async getMarketStatus(exchange = 'NSE', segment = null, user = null) {
    return await this.isMarketOpen(exchange, segment, user);
  }

  // Recalculate and sync margin based on actual open positions
  // This fixes stale margin issues when positions are closed but margin wasn't properly released
  static async recalculateMargin(userId) {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    // Get all open positions for this user
    const openTrades = await Trade.find({ user: userId, status: 'OPEN' });
    
    // Calculate total margin that should be blocked
    // Only count non-crypto trades (crypto doesn't use margin)
    let totalMarginUsed = 0;
    for (const trade of openTrades) {
      if (!trade.isCrypto && !trade.isForex) {
        totalMarginUsed += trade.marginUsed || 0;
      }
    }
    
    const currentUsedMargin = user.wallet.usedMargin || 0;
    const currentBlocked = user.wallet.blocked || 0;
    
    // If there's a discrepancy, fix it
    if (currentUsedMargin !== totalMarginUsed || currentBlocked !== totalMarginUsed) {
      const difference = currentUsedMargin - totalMarginUsed;
      
      // Update user wallet with correct margin values
      await User.updateOne(
        { _id: userId },
        { $set: { 
          'wallet.usedMargin': totalMarginUsed,
          'wallet.blocked': totalMarginUsed,
          // If margin was incorrectly blocked, add it back to trading balance
          'wallet.tradingBalance': (user.wallet.tradingBalance || 0) + difference
        }}
      );
      
      console.log(`Margin recalculated for user ${userId}: was ${currentUsedMargin}, now ${totalMarginUsed}, difference ${difference} added back to trading balance`);
      
      return {
        success: true,
        previousMargin: currentUsedMargin,
        correctedMargin: totalMarginUsed,
        difference,
        openPositions: openTrades.length,
        cryptoPositions: openTrades.filter(t => t.isCrypto).length
      };
    }
    
    return {
      success: true,
      message: 'Margin is already correct',
      usedMargin: totalMarginUsed,
      openPositions: openTrades.length
    };
  }
}

export default TradingService;

