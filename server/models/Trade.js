import mongoose from 'mongoose';

// Generate unique trade ID
const generateTradeId = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `TRD${timestamp}${random}`;
};

const tradeSchema = new mongoose.Schema({
  // Unique trade ID
  tradeId: {
    type: String,
    unique: true
  },
  
  // User and Admin linkage
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userId: {
    type: String,
    required: true
  },
  adminCode: {
    type: String,
    required: true,
    index: true
  },
  
  // Instrument details
  segment: {
    type: String,
    enum: ['EQUITY', 'FNO', 'MCX', 'COMMODITY', 'FOREX', 'CURRENCY', 'NSEFUT', 'NSEOPT', 'MCXFUT', 'MCXOPT', 'NSE-EQ', 'BSE-FUT', 'BSE-OPT', 'CDS', 'CRYPTOFUT', 'CRYPTOOPT', 'FOREXFUT', 'FOREXOPT'],
    required: true
  },
  instrumentType: {
    type: String,
    enum: ['STOCK', 'FUTURES', 'OPTIONS', 'CURRENCY', 'CRYPTO'],
    required: true
  },
  symbol: {
    type: String,
    required: true
  },
  token: {
    type: String,
    default: null
  },
  // For crypto - trading pair (e.g., BTCUSDT)
  pair: {
    type: String,
    default: null
  },
  isCrypto: {
    type: Boolean,
    default: false
  },
  isForex: {
    type: Boolean,
    default: false
  },
  exchange: {
    type: String,
    enum: ['NSE', 'BSE', 'NFO', 'MCX', 'BINANCE', 'CDS', 'BFO', 'FOREX'],
    default: 'NSE'
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
  
  // Trade details
  side: {
    type: String,
    enum: ['BUY', 'SELL'],
    required: true
  },
  productType: {
    type: String,
    enum: ['CNC', 'MIS', 'NRML', 'INTRADAY', 'DELIVERY', 'CARRYFORWARD'],
    default: 'INTRADAY'
  },
  intradayOnly: {
    type: Boolean,
    default: false
  },
  orderType: {
    type: String,
    enum: ['MARKET', 'LIMIT', 'SL', 'SL-M'],
    default: 'MARKET'
  },
  quantity: {
    type: Number,
    required: true
  },
  lotSize: {
    type: Number,
    default: 1
  },
  lots: {
    type: Number,
    default: 1
  },
  
  // Prices
  entryPrice: {
    type: Number,
    required: true
  },
  limitPrice: {
    type: Number,
    default: null
  },
  triggerPrice: {
    type: Number,
    default: null
  },
  exitPrice: {
    type: Number,
    default: null
  },
  currentPrice: {
    type: Number,
    default: null
  },
  marketPrice: {
    type: Number,
    default: null
  },
  effectiveExitPrice: {
    type: Number,
    default: null
  },
  
  // Stop Loss & Target
  stopLoss: {
    type: Number,
    default: null
  },
  target: {
    type: Number,
    default: null
  },
  trailingStopLoss: {
    type: Number,
    default: null
  },
  
  // Margin & Leverage
  marginUsed: {
    type: Number,
    default: 0
  },
  // Pledge margin used for NFO/Futures trades (from delivery pledge)
  // This is tracked separately so losses come from wallet, not pledge
  pledgeMarginUsed: {
    type: Number,
    default: 0
  },
  leverage: {
    type: Number,
    default: 1
  },
  effectiveMargin: {
    type: Number,
    default: 0
  },
  
  // Status
  status: {
    type: String,
    enum: ['OPEN', 'CLOSED', 'PENDING', 'CANCELLED', 'TRIGGERED'],
    default: 'OPEN'
  },
  closeReason: {
    type: String,
    enum: ['MANUAL', 'RMS', 'TIME_BASED', 'EXPIRY', 'ADMIN', 'NETTING', null],
    default: null
  },
  // Track if trade was auto-squared (but not closed, moved to auto-square tab)
  isAutoSquared: {
    type: Boolean,
    default: false
  },
  autoSquaredAt: {
    type: Date,
    default: null
  },
  // Who/what closed the position (for TradePro engine)
  closedBy: {
    type: String,
    enum: ['USER', 'STOP_OUT', 'MARGIN_CALL', 'DAILY_LIMIT', 'EOD_SQUAREOFF', 'ADMIN', 'SYSTEM', null],
    default: null
  },
  // Contract size for PnL calculation
  contractSize: {
    type: Number,
    default: 1
  },
  // Required margin for this position
  requiredMargin: {
    type: Number,
    default: 0
  },
  
  // Charges - Spread and Commission
  spread: {
    type: Number,
    default: 0
  },
  commission: {
    type: Number,
    default: 0
  },
  /** Client brokerage for entry+exit collected once at open; close path applies 0 brokerage for these trades */
  brokeragePrepaidRoundTrip: {
    type: Boolean,
    default: false
  },
  totalCharges: {
    type: Number,
    default: 0
  },
  
  // P&L
  unrealizedPnL: {
    type: Number,
    default: 0
  },
  realizedPnL: {
    type: Number,
    default: 0
  },
  pnl: {
    type: Number,
    default: 0
  },
  
  // Charges
  charges: {
    brokerage: { type: Number, default: 0 },
    exchange: { type: Number, default: 0 },
    gst: { type: Number, default: 0 },
    sebi: { type: Number, default: 0 },
    stamp: { type: Number, default: 0 },
    stt: { type: Number, default: 0 },
    total: { type: Number, default: 0 }
  },
  
  // Net P&L after charges
  netPnL: {
    type: Number,
    default: 0
  },
  
  // Book type for admin settlement
  bookType: {
    type: String,
    enum: ['A_BOOK', 'B_BOOK'],
    default: 'B_BOOK'
  },
  
  // Admin P&L (opposite of user P&L in B_BOOK)
  adminPnL: {
    type: Number,
    default: 0
  },
  
  // Timestamps
  openedAt: {
    type: Date,
    default: Date.now
  },
  closedAt: {
    type: Date,
    default: null
  },
  
  // Intraday to Carry Forward conversion fields
  convertedFromIntraday: {
    type: Boolean,
    default: false
  },
  conversionTime: {
    type: Date,
    default: null
  },
  conversionDetails: {
    additionalMarginDeducted: { type: Number, default: 0 },
    deductedFromProfit: { type: Number, default: 0 },
    deductedFromBalance: { type: Number, default: 0 }
  },
  partialClose: {
    closedQuantity: { type: Number, default: 0 },
    closedLots: { type: Number, default: 0 },
    closedPnL: { type: Number, default: 0 },
    closeReason: { type: String, default: null }
  }
}, { timestamps: true });

// Pre-save: Generate trade ID
tradeSchema.pre('save', async function(next) {
  if (this.isNew && !this.tradeId) {
    let id = generateTradeId();
    let exists = await mongoose.model('Trade').findOne({ tradeId: id });
    while (exists) {
      id = generateTradeId();
      exists = await mongoose.model('Trade').findOne({ tradeId: id });
    }
    this.tradeId = id;
  }
  next();
});

// Method: Calculate unrealized P&L
tradeSchema.methods.calculateUnrealizedPnL = function(currentPrice) {
  if (this.status !== 'OPEN') return 0;
  
  const multiplier = this.side === 'BUY' ? 1 : -1;
  const priceDiff = (currentPrice - this.entryPrice) * multiplier;
  const pnl = priceDiff * this.quantity;
  
  this.currentPrice = currentPrice;
  this.unrealizedPnL = pnl;
  return pnl;
};

// Method: Close trade
tradeSchema.methods.closeTrade = function(exitPrice, reason = 'MANUAL') {
  if (this.status !== 'OPEN') return this;
  
  const multiplier = this.side === 'BUY' ? 1 : -1;
  const priceDiff = (exitPrice - this.entryPrice) * multiplier;
  const grossPnL = priceDiff * this.quantity;
  
  this.exitPrice = exitPrice;
  this.status = 'CLOSED';
  this.closeReason = reason;
  this.closedAt = new Date();
  this.realizedPnL = grossPnL;
  this.pnl = grossPnL;
  this.unrealizedPnL = 0;
  
  // Net P&L after charges
  this.netPnL = grossPnL - this.charges.total;
  
  // Admin P&L (opposite in B_BOOK)
  if (this.bookType === 'B_BOOK') {
    this.adminPnL = -this.netPnL;
  } else {
    this.adminPnL = 0; // A_BOOK goes to exchange
  }
  
  return this;
};

// Indexes for faster queries
tradeSchema.index({ user: 1, status: 1 });
tradeSchema.index({ user: 1, status: 1, closedAt: -1 }); // For trade history
tradeSchema.index({ adminCode: 1, status: 1 });
tradeSchema.index({ adminCode: 1, status: 1, closedAt: -1 }); // For admin P&L
tradeSchema.index({ symbol: 1, status: 1 });
tradeSchema.index({ token: 1, status: 1 }); // For price updates by token
tradeSchema.index({ openedAt: -1 });
tradeSchema.index({ closedAt: -1 });
tradeSchema.index({ isCrypto: 1, status: 1 }); // For crypto trades

export default mongoose.model('Trade', tradeSchema);
