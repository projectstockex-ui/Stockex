import mongoose from 'mongoose';

const instrumentSchema = new mongoose.Schema({
  // Angel One token for WebSocket subscription
  token: {
    type: String,
    required: true,
    unique: true
  },
  
  // Trading symbol
  symbol: {
    type: String,
    required: true,
    index: true
  },
  
  // Display name
  name: {
    type: String,
    required: true
  },
  
  // Exchange
  exchange: {
    type: String,
    enum: ['NSE', 'BSE', 'NFO', 'MCX', 'CDS', 'BFO', 'BINANCE', 'FOREX'],
    required: true
  },
  
  // Segment (internal)
  segment: {
    type: String,
    enum: ['EQUITY', 'FNO', 'COMMODITY', 'CURRENCY', 'MCX'],
    required: true
  },
  
  // Display Segment (for UI tabs) - matches user allowedSegments
  displaySegment: {
    type: String,
    enum: ['NSEFUT', 'NSEOPT', 'MCXFUT', 'MCXOPT', 'NSE-EQ', 'BSE-FUT', 'BSE-OPT', 'CRYPTOFUT', 'CRYPTOOPT', 'FOREX', 'FOREXFUT', 'FOREXOPT'],
    default: 'NSE-EQ',
    index: true
  },
  
  // Instrument type
  instrumentType: {
    type: String,
    enum: ['STOCK', 'INDEX', 'FUTURES', 'OPTIONS', 'COMMODITY', 'CURRENCY'],
    required: true
  },
  
  // For Crypto - trading pair (e.g., BTCUSDT)
  pair: {
    type: String,
    default: null
  },
  
  // Is this a crypto instrument
  isCrypto: {
    type: Boolean,
    default: false
  },
  
  // For F&O
  expiry: {
    type: Date,
    default: null
  },
  strike: {
    type: Number,
    default: null
  },
  optionType: {
    type: String,
    enum: ['CE', 'PE', null],
    default: null
  },
  
  // Lot size
  lotSize: {
    type: Number,
    default: 1
  },
  
  // Tick size
  tickSize: {
    type: Number,
    default: 0.05
  },

  /** Binance LOT_SIZE minQty (base quantity). Set from futures exchangeInfo when synced. */
  qtyFilterMin: {
    type: Number,
    default: null
  },
  /** Binance LOT_SIZE maxQty (base quantity). */
  qtyFilterMax: {
    type: Number,
    default: null
  },
  
  // Live price data (updated via WebSocket)
  ltp: {
    type: Number,
    default: 0
  },
  open: {
    type: Number,
    default: 0
  },
  high: {
    type: Number,
    default: 0
  },
  low: {
    type: Number,
    default: 0
  },
  close: {
    type: Number,
    default: 0
  },
  change: {
    type: Number,
    default: 0
  },
  changePercent: {
    type: Number,
    default: 0
  },
  volume: {
    type: Number,
    default: 0
  },
  
  // Last updated timestamp
  lastUpdated: {
    type: Date,
    default: null
  },

  // Last known bid and ask prices (for showing when market is closed)
  lastBid: {
    type: Number,
    default: 0
  },
  lastAsk: {
    type: Number,
    default: 0
  },
  
  // Admin controls
  isEnabled: {
    type: Boolean,
    default: true,
    index: true
  },
  /** When true, only Super Admin can turn the script back on; client "request open" is rejected. */
  adminLockedClosed: {
    type: Boolean,
    default: false
  },
  /** If set and in the future, script stays enabled until this time (then auto-disabled unless SA opened it). */
  clientTemporaryOpenUntil: {
    type: Date,
    default: null
  },
  /** When script is off: Super Admin can set a datetime when it turns back on automatically (server cron). */
  adminScheduledReopenAt: {
    type: Date,
    default: null
  },
  
  // Per-admin visibility (if empty, visible to all)
  visibleToAdmins: [{
    type: String // adminCode
  }],
  
  // Hidden from specific admins
  hiddenFromAdmins: [{
    type: String // adminCode
  }],
  
  // Category for grouping
  category: {
    type: String,
    enum: ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'STOCKS', 'INDICES', 'MCX', 'COMMODITY', 'CURRENCY', 'BSE', 'OTHER'],
    default: 'OTHER'
  },
  
  // Trading symbol from exchange (for Zerodha)
  tradingSymbol: {
    type: String,
    default: null
  },
  
  // Sort order
  sortOrder: {
    type: Number,
    default: 0
  },
  
  // Is this a popular/featured instrument
  isFeatured: {
    type: Boolean,
    default: false
  },
  
  // ==================== CIRCUIT BREAKER FIELDS ====================
  // Previous day close price (set daily before market open)
  previousDayClosePrice: {
    type: Number,
    default: 0
  },
  // Circuit limit percentage (2, 5, 10, or 20 - admin configurable per script)
  circuitLimitPercent: {
    type: Number,
    default: 10,
    enum: [2, 5, 10, 15, 20, 30]
  },
  // Upper circuit price = previousDayClosePrice * (1 + circuitLimitPercent/100)
  upperCircuit: {
    type: Number,
    default: 0
  },
  // Lower circuit price = previousDayClosePrice * (1 - circuitLimitPercent/100)
  lowerCircuit: {
    type: Number,
    default: 0
  },
  // True when price hits upper circuit
  upperCircuitHit: {
    type: Boolean,
    default: false
  },
  // True when price hits lower circuit
  lowerCircuitHit: {
    type: Boolean,
    default: false
  },
  // False when upperCircuitHit = true (only SELL allowed)
  allowBuy: {
    type: Boolean,
    default: true
  },
  // False when lowerCircuitHit = true (only BUY allowed)
  allowSell: {
    type: Boolean,
    default: true
  },
  // Contract size for margin/PnL calculation (for F&O)
  contractSize: {
    type: Number,
    default: 1
  },
  // Spread points (admin configurable)
  spreadPoints: {
    type: Number,
    default: 0
  },
  // Fixed margin per lot (if set, overrides exposure-based calculation)
  fixedMarginPerLot: {
    type: Number,
    default: 0
  },
  // Max allowed quantity per order
  maxAllowedQty: {
    type: Number,
    default: 10000
  },
  // Is script blocked for trading
  isBlocked: {
    type: Boolean,
    default: false
  },

  /**
   * Super-admin per-instrument trading economics (merged under user scriptSettings).
   * User scriptSettings still override any field you set here when both are present.
   */
  tradingDefaults: {
    enabled: { type: Boolean, default: false },
    blockTrading: { type: Boolean, default: false },
    notes: { type: String, default: '' },
    maxIntradayLeverage: { type: Number, default: null },
    maxCarryLeverage: { type: Number, default: null },
    exposureIntraday: { type: Number, default: null },
    exposureCarryForward: { type: Number, default: null },
    brokerage: {
      intradayFuture: { type: Number, default: null },
      carryFuture: { type: Number, default: null },
      optionBuyIntraday: { type: Number, default: null },
      optionBuyCarry: { type: Number, default: null },
      optionSellIntraday: { type: Number, default: null },
      optionSellCarry: { type: Number, default: null },
    },
    fixedMargin: {
      intradayFuture: { type: Number, default: null },
      carryFuture: { type: Number, default: null },
      optionBuyIntraday: { type: Number, default: null },
      optionBuyCarry: { type: Number, default: null },
      optionSellIntraday: { type: Number, default: null },
      optionSellCarry: { type: Number, default: null },
    },
    lotSettings: {
      maxLots: { type: Number, default: null },
      minLots: { type: Number, default: null },
      perOrderLots: { type: Number, default: null },
    },
    quantitySettings: {
      // Breakup quantity - maximum quantity per single order
      breakupQuantity: { type: Number, default: null }, // null = use admin setting
      // Max bid - maximum number of orders allowed
      maxBid: { type: Number, default: null } // null = use admin setting
    },
    spread: {
      buy: { type: Number, default: null },
      sell: { type: Number, default: null },
    },
    /** Added on top of script/segment brokerage (when tradingDefaults.enabled). */
    additionalCharges: {
      perTradeInr: { type: Number, default: null },
      perLotInr: { type: Number, default: null },
      perCroreInr: { type: Number, default: null },
      /** When false, per-trade amount is ignored (new UI). Omitted = legacy “apply if value > 0”. */
      perTradeEnabled: { type: Boolean, default: null },
      perLotEnabled: { type: Boolean, default: null },
      perCroreEnabled: { type: Boolean, default: null },
      /** Per-line amount unit (must match line semantics: trade & lot = INR, crore = PERCENT). */
      perTradeUnit: { type: String, enum: ['INR', 'PERCENT'], default: null },
      perLotUnit: { type: String, enum: ['INR', 'PERCENT'], default: null },
      perCroreUnit: { type: String, enum: ['INR', 'PERCENT'], default: null },
      /** @deprecated Use per-line units; kept for legacy reads in tradeService. */
      extraCommissionUnit: { type: String, enum: ['INR', 'PERCENT'], default: null },
    },
  },
}, { timestamps: true });

// Compound index for efficient queries
instrumentSchema.index({ exchange: 1, segment: 1, isEnabled: 1 });
instrumentSchema.index({ category: 1, isEnabled: 1 });
instrumentSchema.index({ isEnabled: 1, adminScheduledReopenAt: 1 });
instrumentSchema.index({ symbol: 'text', name: 'text' });

// Static method to get enabled instruments for a user's admin
instrumentSchema.statics.getEnabledForAdmin = async function(adminCode) {
  return this.find({
    isEnabled: true,
    $or: [
      { visibleToAdmins: { $size: 0 } }, // Visible to all
      { visibleToAdmins: adminCode } // Specifically visible to this admin
    ],
    hiddenFromAdmins: { $ne: adminCode } // Not hidden from this admin
  }).sort({ category: 1, sortOrder: 1, symbol: 1 });
};

// Static method to update price from WebSocket
instrumentSchema.statics.updatePrice = async function(token, priceData) {
  const { ltp, open, high, low, close, volume, bid, ask } = priceData;

  const change = ltp - close;
  const changePercent = close > 0 ? ((ltp - close) / close) * 100 : 0;

  const updateFields = {
    ltp,
    open,
    high,
    low,
    close,
    volume,
    change,
    changePercent: Math.round(changePercent * 100) / 100,
    lastUpdated: new Date()
  };

  // Update last bid/ask if provided and non-zero
  if (bid && bid > 0) {
    updateFields.lastBid = bid;
  }
  if (ask && ask > 0) {
    updateFields.lastAsk = ask;
  }

  return this.findOneAndUpdate(
    { token },
    updateFields,
    { new: true }
  );
};

export default mongoose.model('Instrument', instrumentSchema);
