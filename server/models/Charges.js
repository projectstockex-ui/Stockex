import mongoose from 'mongoose';

const chargesSchema = new mongoose.Schema({
  // Scope determines priority: GLOBAL < ADMIN < SEGMENT < INSTRUMENT < USER
  scope: {
    type: String,
    enum: ['GLOBAL', 'ADMIN', 'SEGMENT', 'INSTRUMENT', 'USER'],
    required: true
  },
  
  // For ADMIN, SEGMENT, INSTRUMENT, USER scopes
  adminCode: {
    type: String,
    default: null
  },
  
  // For USER scope
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  
  // For SEGMENT and INSTRUMENT scopes
  segment: {
    type: String,
    enum: ['EQUITY', 'FNO', 'MCX', 'CURRENCY', null],
    default: null
  },
  instrumentType: {
    type: String,
    enum: ['STOCK', 'FUTURES', 'OPTIONS', 'CURRENCY', 'INDEX', null],
    default: null
  },
  
  // Specific symbol/instrument (for fine-grained control)
  symbol: {
    type: String,
    default: null
  },
  
  // Charge configuration
  brokerage: {
    type: {
      type: String,
      enum: ['PER_LOT', 'PERCENTAGE', 'FLAT'],
      default: 'PER_LOT'
    },
    value: {
      type: Number,
      default: 20
    }
  },
  
  // Exchange transaction charges (percentage) - varies by segment
  // NSE Equity: 0.00297%, NSE F&O Futures: 0.0019%, NSE F&O Options: 0.05%, MCX: 0.0026%
  exchangeCharges: {
    type: Number,
    default: 0.00297 // NSE Equity default
  },
  
  // GST on brokerage (percentage)
  gst: {
    type: Number,
    default: 18 // 18%
  },
  
  // SEBI charges (per crore)
  sebiCharges: {
    type: Number,
    default: 10 // ₹10 per crore
  },
  
  // Stamp duty (percentage)
  stampDuty: {
    type: Number,
    default: 0.015 // 0.015%
  },
  
  // STT (Securities Transaction Tax)
  stt: {
    equity: {
      delivery: { type: Number, default: 0.1 }, // 0.1% on both buy and sell
      intraday: { type: Number, default: 0.025 } // 0.025% on sell
    },
    futures: { type: Number, default: 0.0125 }, // 0.0125% on sell
    options: { type: Number, default: 0.0625 } // 0.0625% on premium (sell)
  },
  
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

// Static method: Get charges for a trade (hierarchical resolution)
// Priority: USER > SYMBOL > INSTRUMENT > SEGMENT > ADMIN > GLOBAL
chargesSchema.statics.getChargesForTrade = async function(trade, adminCode, userId) {
  // 1. Check user-specific charges (highest priority)
  let charges = await this.findOne({ 
    scope: 'USER', 
    userId: userId,
    isActive: true 
  }).lean();
  if (charges) return charges;
  
  // 2. Check symbol-specific charges (for specific instruments like NIFTY, BTC, etc.)
  if (trade.symbol) {
    charges = await this.findOne({ 
      scope: 'INSTRUMENT',
      adminCode: adminCode,
      symbol: trade.symbol,
      isActive: true 
    }).lean();
    if (charges) return charges;
  }
  
  // 3. Check instrument type charges (FUTURES, OPTIONS, CRYPTO, etc.)
  charges = await this.findOne({ 
    scope: 'INSTRUMENT',
    adminCode: adminCode,
    segment: trade.segment,
    instrumentType: trade.instrumentType,
    symbol: null,
    isActive: true 
  }).lean();
  if (charges) return charges;
  
  // 4. Check segment-specific charges (EQUITY, FNO, MCX, CURRENCY)
  charges = await this.findOne({ 
    scope: 'SEGMENT',
    adminCode: adminCode,
    segment: trade.segment,
    isActive: true 
  }).lean();
  if (charges) return charges;
  
  // 5. Check admin default charges
  charges = await this.findOne({ 
    scope: 'ADMIN',
    adminCode: adminCode,
    isActive: true 
  }).lean();
  if (charges) return charges;
  
  // 6. Fall back to global charges
  charges = await this.findOne({ 
    scope: 'GLOBAL',
    isActive: true 
  }).lean();
  
  // If no charges found, return defaults based on segment
  if (!charges) {
    const isCrypto = trade.isCrypto ||
      ['FOREX', 'FOREXFUT', 'FOREXOPT'].includes(String(trade.segment || '').toUpperCase()) || trade.isForex;
    const isMCX = trade.segment === 'MCX';
    
    charges = {
      brokerage: { type: 'PER_LOT', value: isCrypto ? 0 : (isMCX ? 20 : 20) },
      exchangeCharges: isCrypto ? 0.1 : 0.00325, // Crypto: 0.1%, Others: 0.00325%
      gst: isCrypto ? 0 : 18, // No GST on crypto
      sebiCharges: isCrypto ? 0 : 10,
      stampDuty: isCrypto ? 0 : 0.015,
      stt: {
        equity: { delivery: 0.1, intraday: 0.025 },
        futures: 0.0125,
        options: 0.0625,
        crypto: 0 // No STT on crypto
      }
    };
  }
  
  return charges;
};

// Static method: Calculate charges for a trade
chargesSchema.statics.calculateCharges = async function(trade, adminCode, userId) {
  const chargesConfig = await this.getChargesForTrade(trade, adminCode, userId);
  
  // Check if crypto trade - crypto has different charge structure
  const isCrypto = trade.isCrypto ||
    ['FOREX', 'FOREXFUT', 'FOREXOPT'].includes(String(trade.segment || '').toUpperCase()) || trade.isForex;
  const isMCX = trade.segment === 'MCX';

  // Crypto entry/exit are stored in INR (USDT × rate at execution)
  const turnover = trade.entryPrice * trade.quantity;
  const exitTurnover = (trade.exitPrice || trade.entryPrice) * trade.quantity;
  const totalTurnover = turnover + exitTurnover;
  
  // Calculate brokerage (entry + exit legs in config). Prepaid-at-open trades: 0 brokerage on close — already withheld in trade.commission.
  let brokerage = 0;
  if (!trade.brokeragePrepaidRoundTrip) {
    if (chargesConfig.brokerage?.type === 'PER_LOT') {
      brokerage = (chargesConfig.brokerage.value || 0) * (trade.lots || 1) * 2; // Entry + Exit
    } else if (chargesConfig.brokerage?.type === 'PERCENTAGE') {
      brokerage = (totalTurnover * (chargesConfig.brokerage.value || 0)) / 100;
    } else if (chargesConfig.brokerage?.type === 'FLAT') {
      brokerage = (chargesConfig.brokerage.value || 0) * 2; // Flat per trade
    }
  }
  
  // For crypto - simplified charges (only exchange fee, no Indian taxes)
  if (isCrypto) {
    const exchangeFee = (totalTurnover * (chargesConfig.exchangeCharges || 0.1)) / 100;
    const total = brokerage + exchangeFee;
    
    return {
      brokerage: Math.round(brokerage * 100) / 100,
      exchange: Math.round(exchangeFee * 100) / 100,
      gst: 0,
      sebi: 0,
      stamp: 0,
      stt: 0,
      total: Math.round(total * 100) / 100
    };
  }
  
  // Exchange charges - use segment-appropriate rates if not configured
  let exchangeRate = chargesConfig.exchangeCharges;
  if (exchangeRate === undefined || exchangeRate === null) {
    // Default rates per segment (as per NSE/BSE/MCX)
    if (trade.instrumentType === 'OPTIONS') {
      exchangeRate = 0.05; // NSE F&O Options: 0.05% on premium
    } else if (trade.instrumentType === 'FUTURES') {
      exchangeRate = isMCX ? 0.0026 : 0.0019; // MCX: 0.0026%, NSE F&O Futures: 0.0019%
    } else {
      exchangeRate = 0.00297; // NSE Equity: 0.00297%
    }
  }
  const exchangeCharges = (totalTurnover * exchangeRate) / 100;
  
  // GST on brokerage + exchange charges
  const gst = ((brokerage + exchangeCharges) * (chargesConfig.gst || 18)) / 100;
  
  // SEBI charges
  const sebiCharges = (totalTurnover / 10000000) * (chargesConfig.sebiCharges || 10);
  
  // Stamp duty (on buy side only)
  const stampDuty = (turnover * (chargesConfig.stampDuty || 0.015)) / 100;
  
  // STT calculation based on instrument type
  let stt = 0;
  const sttConfig = chargesConfig.stt || { equity: { delivery: 0.1, intraday: 0.025 }, futures: 0.0125, options: 0.0625 };
  
  if (trade.segment === 'EQUITY') {
    if (trade.productType === 'CNC') {
      stt = (totalTurnover * (sttConfig.equity?.delivery || 0.1)) / 100;
    } else {
      stt = (exitTurnover * (sttConfig.equity?.intraday || 0.025)) / 100;
    }
  } else if (trade.instrumentType === 'FUTURES') {
    stt = (exitTurnover * (sttConfig.futures || 0.0125)) / 100;
  } else if (trade.instrumentType === 'OPTIONS') {
    // STT on options: 0.0625% on sell side premium only (as per SEBI/Zerodha)
    const exitPremium = (trade.exitPrice || trade.entryPrice) * trade.quantity;
    stt = (exitPremium * (sttConfig.options || 0.0625)) / 100;
  }
  // MCX has no STT
  
  const total = brokerage + exchangeCharges + gst + sebiCharges + stampDuty + stt;
  
  return {
    brokerage: Math.round(brokerage * 100) / 100,
    exchange: Math.round(exchangeCharges * 100) / 100,
    gst: Math.round(gst * 100) / 100,
    sebi: Math.round(sebiCharges * 100) / 100,
    stamp: Math.round(stampDuty * 100) / 100,
    stt: Math.round(stt * 100) / 100,
    total: Math.round(total * 100) / 100
  };
};

// Indexes for faster lookups
chargesSchema.index({ scope: 1, adminCode: 1, segment: 1, instrumentType: 1, symbol: 1 });
chargesSchema.index({ scope: 1, userId: 1 });
chargesSchema.index({ scope: 1, adminCode: 1, isActive: 1 });
chargesSchema.index({ symbol: 1, adminCode: 1 });

export default mongoose.model('Charges', chargesSchema);
