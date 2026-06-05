import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const walletTransactionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['deposit', 'withdraw', 'credit', 'debit'],
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Generate unique user ID
const generateUserId = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `USR${timestamp}${random}`;
};

const userSchema = new mongoose.Schema({
  // Unique user ID
  userId: {
    type: String,
    unique: true
  },
  
  // Admin code - links user to their creator (can be changed by Super Admin for transfers)
  adminCode: {
    type: String,
    required: false,
    index: true
  },
  
  // Reference to the admin/broker/sub-broker who directly manages this user
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: false // Not required for demo accounts
  },
  
  // Demo Account Fields
  isDemo: {
    type: Boolean,
    default: false
  },
  demoExpiresAt: {
    type: Date,
    default: null
  },
  demoCreatedAt: {
    type: Date,
    default: null
  },
  convertedToRealAt: {
    type: Date,
    default: null
  },
  
  // Role of the creator (ADMIN, BROKER, or SUB_BROKER)
  creatorRole: {
    type: String,
    enum: ['SUPER_ADMIN', 'ADMIN', 'BROKER', 'SUB_BROKER'],
    default: 'ADMIN'
  },

  /** Franchise brokerage charge per crore turnover (set by parent admin/broker/sub-broker). */
  franchiseChargePerCrore: {
    type: Number,
    default: 0,
  },
  
  // Hierarchy path - array of all ancestor admin IDs (for efficient queries)
  // e.g., [superAdminId, adminId, brokerId] for a user created by broker
  hierarchyPath: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }],
  
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  fullName: {
    type: String,
    default: ''
  },
  phone: {
    type: String,
    default: ''
  },
  phoneVerified: {
    type: Boolean,
    default: false
  },
  role: {
    type: String,
    default: 'user'
  },
  
  // Trading status
  tradingStatus: {
    type: String,
    enum: ['ACTIVE', 'BLOCKED', 'SUSPENDED'],
    default: 'ACTIVE'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // Session token for single device login - only one active session at a time
  activeSessionToken: {
    type: String,
    default: null
  },
  // Login status - true when user is logged in, false when logged out
  isLogin: {
    type: Boolean,
    default: false
  },
  lastLoginAt: {
    type: Date,
    default: null
  },
  lastLoginDevice: {
    type: String,
    default: null
  },
  // Enhanced Wallet System - TradePro Trading Engine
  wallet: {
    // Cash Balance (Free Balance) - Main wallet where admin deposits funds
    cashBalance: {
      type: Number,
      default: 0
    },
    // Trading Balance - Funds available for trading (transferred from main wallet)
    // Formula: depositTotal - withdrawalTotal + totalRealizedPnL - totalCommissions
    tradingBalance: {
      type: Number,
      default: 0
    },
    // Equity - Real-time value (balance + unrealizedPnL)
    // Recalculated on EVERY price tick
    equity: {
      type: Number,
      default: 0
    },
    // Used Margin - SUM of all open position margins
    usedMargin: {
      type: Number,
      default: 0
    },
    // Free Margin - equity - usedMargin (available for new trades)
    freeMargin: {
      type: Number,
      default: 0
    },
    // Margin Level - (equity / usedMargin) * 100
    // Infinity when usedMargin = 0, display as '--' in UI
    marginLevel: {
      type: Number,
      default: null
    },
    // Margin Call Active - true when marginLevel <= 100%
    marginCallActive: {
      type: Boolean,
      default: false
    },
    // Collateral Value (Stocks pledged, FD, etc.)
    collateralValue: {
      type: Number,
      default: 0
    },
    // Total Unrealized P&L - SUM of unrealized PnL of all open positions
    totalUnrealizedPnL: {
      type: Number,
      default: 0
    },
    // Total Realized P&L - SUM of realized PnL of all closed positions today
    totalRealizedPnL: {
      type: Number,
      default: 0
    },
    // Total Commissions paid
    totalCommissions: {
      type: Number,
      default: 0
    },
    // Deposit Total - Sum of all deposits
    depositTotal: {
      type: Number,
      default: 0
    },
    // Withdrawal Total - Sum of all withdrawals
    withdrawalTotal: {
      type: Number,
      default: 0
    },
    // Realized P&L - Booked profit/loss from closed trades (legacy)
    realizedPnL: {
      type: Number,
      default: 0
    },
    // Unrealized P&L - Live profit/loss from open positions (MTM) (legacy)
    unrealizedPnL: {
      type: Number,
      default: 0
    },
    // Today's Realized P&L
    todayRealizedPnL: {
      type: Number,
      default: 0
    },
    // Today's Unrealized P&L
    todayUnrealizedPnL: {
      type: Number,
      default: 0
    },
    // Legacy balance field for backward compatibility
    balance: {
      type: Number,
      default: 0
    },
    // Blocked margin (legacy)
    blocked: {
      type: Number,
      default: 0
    },
    // Legacy — migrated to nseBseWallet.profitBlocked
    mainWalletBlocked: { type: Boolean, default: false },
    tradingWalletBlocked: { type: Boolean, default: false },
    // Last wallet recalculation timestamp
    lastUpdatedAt: {
      type: Date,
      default: Date.now
    },
    transactions: [walletTransactionSchema]
  },
  
  // Separate Crypto Wallet - Spot trading with margin monitoring
  cryptoWallet: {
    // Crypto balance in INR (notional vs USDT quotes at execution time)
    balance: {
      type: Number,
      default: 0
    },
    // Equity - balance + totalUnrealizedPnL
    equity: {
      type: Number,
      default: 0
    },
    // Used Margin - SUM of all open crypto position margins
    usedMargin: {
      type: Number,
      default: 0
    },
    // Free Margin - equity - usedMargin
    freeMargin: {
      type: Number,
      default: 0
    },
    // Margin Level - (equity / usedMargin) * 100
    marginLevel: {
      type: Number,
      default: null
    },
    // Margin Call Active
    marginCallActive: {
      type: Boolean,
      default: false
    },
    // Total Unrealized P&L
    totalUnrealizedPnL: {
      type: Number,
      default: 0
    },
    // Total Realized P&L
    totalRealizedPnL: {
      type: Number,
      default: 0
    },
    // Total Commissions
    totalCommissions: {
      type: Number,
      default: 0
    },
    // Deposit Total
    depositTotal: {
      type: Number,
      default: 0
    },
    // Withdrawal Total
    withdrawalTotal: {
      type: Number,
      default: 0
    },
    // Realized P&L from crypto trades (legacy)
    realizedPnL: {
      type: Number,
      default: 0
    },
    // Unrealized P&L from open crypto positions (legacy)
    unrealizedPnL: {
      type: Number,
      default: 0
    },
    // Today's Realized P&L
    todayRealizedPnL: {
      type: Number,
      default: 0
    },
    // Last updated timestamp
    lastUpdatedAt: {
      type: Date,
      default: Date.now
    },
    /** Baseline for ledger % autosquare (e.g. ₹1L → floor ₹10k at 90% loss) */
    ledgerReferenceBalance: { type: Number, default: 0 },
    ledgerAutosquareActive: { type: Boolean, default: false },
    ledgerAutosquaredAt: { type: Date, default: null },
    profitBlocked: { type: Boolean, default: false },
  },

  // Synthetic forex wallet (INR) — same economics pattern as cryptoWallet
  forexWallet: {
    balance: { type: Number, default: 0 },
    equity: { type: Number, default: 0 },
    usedMargin: { type: Number, default: 0 },
    freeMargin: { type: Number, default: 0 },
    marginLevel: { type: Number, default: null },
    marginCallActive: { type: Boolean, default: false },
    totalUnrealizedPnL: { type: Number, default: 0 },
    totalRealizedPnL: { type: Number, default: 0 },
    totalCommissions: { type: Number, default: 0 },
    depositTotal: { type: Number, default: 0 },
    withdrawalTotal: { type: Number, default: 0 },
    realizedPnL: { type: Number, default: 0 },
    unrealizedPnL: { type: Number, default: 0 },
    todayRealizedPnL: { type: Number, default: 0 },
    lastUpdatedAt: { type: Date, default: Date.now },
    /** Baseline for ledger % autosquare (e.g. ₹1L → floor ₹10k at 90% loss) */
    ledgerReferenceBalance: { type: Number, default: 0 },
    ledgerAutosquareActive: { type: Boolean, default: false },
    ledgerAutosquaredAt: { type: Date, default: null },
    profitBlocked: { type: Boolean, default: false },
  },
  
  // Delivery Pledge - Margin from delivery (CNC) trades
  // NEW LOGIC:
  // 1. NSE/BSE Cash segment: 1:1 leverage (no leverage, full amount deducted)
  // 2. When user BUYS stock in Cash segment, stock is auto-pledged to StockEx
  // 3. User gets X% (dynamic, default 50%) of stock value as pledge margin for NFO/Futures ONLY
  // 4. Pledge margin can ONLY be used for margin requirement in Futures/NFO
  // 5. Pledge margin CANNOT be used to cover losses - losses must come from actual wallet
  deliveryPledge: {
    // Total pledged amount available as margin for NFO/Futures ONLY
    balance: {
      type: Number,
      default: 0
    },
    // Amount currently used as margin for open NFO/Futures positions
    usedMargin: {
      type: Number,
      default: 0
    },
    // Total value of delivery holdings (stocks held)
    holdingsValue: {
      type: Number,
      default: 0
    },
    // Pledge margin percent (dynamic, set by admin)
    marginPercent: {
      type: Number,
      default: 50
    },
    // History of pledge additions
    lastUpdated: {
      type: Date,
      default: Date.now
    }
  },
  
  // Separate MCX Wallet - For MCX Futures and Options trading only
  mcxWallet: {
    // MCX Trading Balance in INR
    balance: {
      type: Number,
      default: 0
    },
    // Equity - balance + totalUnrealizedPnL
    equity: {
      type: Number,
      default: 0
    },
    // Used Margin - Currently blocked for open MCX positions
    usedMargin: {
      type: Number,
      default: 0
    },
    // Free Margin - equity - usedMargin
    freeMargin: {
      type: Number,
      default: 0
    },
    // Margin Level - (equity / usedMargin) * 100
    marginLevel: {
      type: Number,
      default: null
    },
    // Margin Call Active
    marginCallActive: {
      type: Boolean,
      default: false
    },
    // Total Unrealized P&L
    totalUnrealizedPnL: {
      type: Number,
      default: 0
    },
    // Total Realized P&L
    totalRealizedPnL: {
      type: Number,
      default: 0
    },
    // Total Commissions
    totalCommissions: {
      type: Number,
      default: 0
    },
    // Deposit Total
    depositTotal: {
      type: Number,
      default: 0
    },
    // Withdrawal Total
    withdrawalTotal: {
      type: Number,
      default: 0
    },
    // Realized P&L from MCX trades (legacy)
    realizedPnL: {
      type: Number,
      default: 0
    },
    // Unrealized P&L from open MCX positions (legacy)
    unrealizedPnL: {
      type: Number,
      default: 0
    },
    // Today's Realized P&L
    todayRealizedPnL: {
      type: Number,
      default: 0
    },
    // Today's Unrealized P&L
    todayUnrealizedPnL: {
      type: Number,
      default: 0
    },
    // Last updated timestamp
    lastUpdatedAt: {
      type: Date,
      default: Date.now
    },
    /** Baseline for ledger % autosquare (e.g. ₹1L → floor ₹10k at 90% loss) */
    ledgerReferenceBalance: { type: Number, default: 0 },
    ledgerAutosquareActive: { type: Boolean, default: false },
    ledgerAutosquaredAt: { type: Date, default: null },
    profitBlocked: { type: Boolean, default: false },
  },

  // NSE & BSE only — cash for NSE/BSE/NFO equity & derivatives (not main deposit wallet)
  nseBseWallet: {
    balance: { type: Number, default: 0 },
    usedMargin: { type: Number, default: 0 },
    realizedPnL: { type: Number, default: 0 },
    unrealizedPnL: { type: Number, default: 0 },
    todayRealizedPnL: { type: Number, default: 0 },
    todayUnrealizedPnL: { type: Number, default: 0 },
    depositTotal: { type: Number, default: 0 },
    withdrawalTotal: { type: Number, default: 0 },
    /** Baseline for ledger % autosquare (e.g. ₹1L → floor ₹10k at 90% loss) */
    ledgerReferenceBalance: { type: Number, default: 0 },
    ledgerAutosquareActive: { type: Boolean, default: false },
    ledgerAutosquaredAt: { type: Date, default: null },
    lastUpdatedAt: { type: Date, default: Date.now },
    profitBlocked: { type: Boolean, default: false },
  },
  
  // Separate Games Wallet - For fantasy trading/games
  gamesWallet: {
    // Games Balance in INR
    balance: {
      type: Number,
      default: 0
    },
    // Used Margin - Currently in play
    usedMargin: {
      type: Number,
      default: 0
    },
    // Realized P&L from games
    realizedPnL: {
      type: Number,
      default: 0
    },
    // Unrealized P&L from active games
    unrealizedPnL: {
      type: Number,
      default: 0
    },
    // Today's Realized P&L
    todayRealizedPnL: {
      type: Number,
      default: 0
    },
    // Today's Unrealized P&L
    todayUnrealizedPnL: {
      type: Number,
      default: 0
    },
    profitBlocked: { type: Boolean, default: false },
  },
  // Margin Settings
  marginSettings: {
    // Equity Intraday Leverage (e.g., 5 means 5x)
    equityIntradayLeverage: {
      type: Number,
      default: 5
    },
    // F&O Leverage
    foLeverage: {
      type: Number,
      default: 1
    },
    // Max loss percentage before RMS kicks in
    maxLossPercent: {
      type: Number,
      default: 80 // 80% of margin
    },
    // Auto square-off enabled
    autoSquareOff: {
      type: Boolean,
      default: true
    }
  },
  // RMS (Risk Management) Settings
  rmsSettings: {
    // Is RMS active for this user
    isActive: {
      type: Boolean,
      default: true
    },
    // Last RMS check timestamp
    lastCheck: {
      type: Date,
      default: null
    },
    // RMS triggered count today
    triggeredCount: {
      type: Number,
      default: 0
    },
    // Is trading blocked due to RMS
    tradingBlocked: {
      type: Boolean,
      default: false
    },
    blockReason: {
      type: String,
      default: null
    }
  },
  
  // ========== NEW USER SETTINGS ==========
  
  // Account Settings
  settings: {
    // Margin Type: 'exposure' or 'margin'
    marginType: {
      type: String,
      enum: ['exposure', 'margin'],
      default: 'exposure'
    },
    
    // Ledger Balance Close % - Close positions when loss reaches X% of ledger
    ledgerBalanceClosePercent: {
      type: Number,
      default: 90
    },
    
    // Profit Trade Hold Min Seconds
    profitTradeHoldSeconds: {
      type: Number,
      default: 0
    },
    
    // Loss Trade Hold Min Seconds
    lossTradeHoldSeconds: {
      type: Number,
      default: 0
    },
    
    // Toggle Settings
    isActivated: {
      type: Boolean,
      default: true
    },
    isReadOnly: {
      type: Boolean,
      default: false
    },
    isDemo: {
      type: Boolean,
      default: false
    },
    intradaySquare: {
      type: Boolean,
      default: false
    },
    blockLimitAboveBelowHighLow: {
      type: Boolean,
      default: false
    },
    blockLimitBetweenHighLow: {
      type: Boolean,
      default: false
    }
  },

  /** Instrument tokens where user traded inside Super Admin LTP ±% bracket (dynamic limit applies). */
  ltpBracketTokens: {
    type: [String],
    default: [],
    index: true,
  },

  // Segment Permissions - Detailed settings for each segment
  segmentPermissions: {
    type: Map,
    of: {
      enabled: { type: Boolean, default: false },
      commissionType: { type: String, enum: ['PER_LOT', 'PER_QUANTITY', 'PER_TRADE', 'PER_CRORE'], default: 'PER_LOT' },
      commissionUnit: { type: String, enum: ['INR', 'PERCENT'], default: null },
      commissionLot: { type: Number, default: 0 },
      /** Commission for PER_CRORE (₹ per crore or % of turnover) - used when commissionType is PER_CRORE */
      commission: { type: Number, default: 0 },
      maxLots: { type: Number, default: 50 },
      minLots: { type: Number, default: 1 },
      // Nested lot settings for separate lot mode configuration
      lotSettings: {
        intradayLeverage: { type: Number, default: 1 },
        carryForwardLeverage: { type: Number, default: 1 },
        maxLots: { type: Number, default: 50 },
        minLots: { type: Number, default: 1 },
        breakupLots: { type: Number, default: 0 },
        notificationPercent: { type: Number },
        autosquarePercent: { type: Number },
      },
      // Nested quantity mode settings for separate quantity mode configuration
      quantityModeSettings: {
        intradayLeverage: { type: Number, default: 1 },
        carryForwardLeverage: { type: Number, default: 1 },
        maxQuantity: { type: Number, default: 1000 },
        minQuantity: { type: Number, default: 1 },
        breakupQuantity: { type: Number, default: 0 },
        notificationPercent: { type: Number },
        autosquarePercent: { type: Number },
      },
      quantitySettings: {
        breakupQuantity: { type: Number, default: 0 },
        maxQuantity: { type: Number },
        minQuantity: { type: Number },
        maxLotQuantity: { type: Number },
        maxBid: { type: Number },
      },
      // Toggle to enable/disable Lot Settings mode for this segment
      enableLotSettings: { type: Boolean, default: false },
      // Toggle to enable/disable Quantity Settings mode for this segment
      enableQuantitySettings: { type: Boolean, default: false },
      exposureIntraday: { type: Number, default: 1 },
      exposureCarryForward: { type: Number, default: 1 },
      intradayLeverage: { type: Number, default: 1 },
      carryForwardLeverage: { type: Number, default: 1 },
      allowClientIntradayOnly: { type: Boolean, default: true },
      defaultIntradayOnly: { type: Boolean, default: false },
      intradayOnlyLeverage: { type: Number },
      intradayOnlyMaxQty: { type: Number },
      allowLimitPendingOrders: { type: Boolean, default: true },
      cryptoSpreadInr: { type: Number },
      cryptoSpreadUsdPerSide: { type: Number },
      /** IST earliest trading start (HH:mm or HH:mm:ss). Empty = no gate. */
      cryptoStartTime: { type: String, default: '' },
      /** IST session end hint (HH:mm or HH:mm:ss). */
      cryptoClosingTime: { type: String, default: '' },
      /** Base symbol (legacy; optional). */
      cryptoReferenceSymbol: { type: String, default: '' },
      /** @deprecated */
      cryptoPricePerLotInr: { type: Number, default: 0 },
      cryptoLotSizeLots: { type: Number, default: 1 },
      cryptoLotSizeQuantity: { type: Number, default: 0 },
      // Dynamic quantity limits - adjusts with P&L
      maxIntradayQty: { type: Number, default: 2000 },
      maxCarryQty: { type: Number, default: 1000 },
      // Current available quantity (starts at max, adjusts with P&L)
      availableIntradayQty: { type: Number, default: 2000 },
      availableCarryQty: { type: Number, default: 1000 },
      // Option Buy Settings
      optionBuy: {
        allowed: { type: Boolean, default: true },
        commissionType: { type: String, enum: ['PER_LOT', 'PER_QUANTITY', 'PER_TRADE', 'PER_CRORE'], default: 'PER_LOT' },
        commissionUnit: { type: String, enum: ['INR', 'PERCENT'], default: null },
        commission: { type: Number, default: 0 },
        strikeSelection: { type: Number, default: 50 },
        intradayLeverage: { type: Number, default: 1 },
        carryForwardLeverage: { type: Number, default: 1 },
        maxExchangeLots: { type: Number, default: 100 },
      },
      optionSell: {
        allowed: { type: Boolean, default: true },
        commissionType: { type: String, enum: ['PER_LOT', 'PER_QUANTITY', 'PER_TRADE', 'PER_CRORE'], default: 'PER_LOT' },
        commissionUnit: { type: String, enum: ['INR', 'PERCENT'], default: null },
        commission: { type: Number, default: 0 },
        strikeSelection: { type: Number, default: 50 },
        intradayLeverage: { type: Number, default: 1 },
        carryForwardLeverage: { type: Number, default: 1 },
        maxExchangeLots: { type: Number, default: 100 },
      }
    },
    default: {} // Inherited from parent admin at creation time
  },

  /** Per segment key: explicit user overrides (same semantics as Admin.segmentExplicitKeys). Omit = legacy full overlay on user slice. */
  segmentExplicitKeys: {
    type: mongoose.Schema.Types.Mixed,
  },
  
  // Global Script Settings - Override segment settings for specific scripts (applies to all segments)
  scriptSettings: {
    type: Map,
    of: {
      lotSettings: {
        maxLots: { type: Number, default: 50 },
        minLots: { type: Number, default: 1 },
        perOrderLots: { type: Number, default: 10 }
      },
      quantitySettings: {
        maxQuantity: { type: Number, default: 1000 },
        minQuantity: { type: Number, default: 1 },
        perOrderQuantity: { type: Number, default: 100 }
      },
      fixedMargin: {
        intradayFuture: { type: Number, default: 0 },
        carryFuture: { type: Number, default: 0 },
        optionBuyIntraday: { type: Number, default: 0 },
        optionBuyCarry: { type: Number, default: 0 },
        optionSellIntraday: { type: Number, default: 0 },
        optionSellCarry: { type: Number, default: 0 }
      },
      brokerage: {
        intradayFuture: { type: Number, default: 0 },
        carryFuture: { type: Number, default: 0 },
        optionBuyIntraday: { type: Number, default: 0 },
        optionBuyCarry: { type: Number, default: 0 },
        optionSellIntraday: { type: Number, default: 0 },
        optionSellCarry: { type: Number, default: 0 }
      },
      spread: {
        buy: { type: Number, default: 0 },
        sell: { type: Number, default: 0 }
      },
      blocked: { type: Boolean, default: false }
    },
    default: {}
  },
  
  // Leverage Settings - Set by parent admin/broker for this user
  leverageSettings: {
    intradayLeverage: { type: Number, default: 10 }, // Intraday (MIS) leverage - single value
    carryForwardLeverage: { type: Number, default: 5 }, // Carry Forward (NRML) leverage - single value
    maxLeverage: { type: Number, default: 10 } // Legacy - kept for backward compatibility
  },
  
  // Allowed Segments (simplified list)
  allowedSegments: [{
    type: String,
    enum: ['NSE', 'MCX', 'BFO', 'EQ', 'COMEX', 'FOREX', 'GLOBALINDEX']
  }],
  
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  
  // Referral System
  referralCode: {
    type: String,
    unique: true,
    sparse: true
  },
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // Track first-time wins for referral rewards
  referralStats: {
    /** Per GameSettings key (e.g. btcUpDown); first successful win in that game triggers one referral. */
    firstGameWinByGame: {
      type: Object,
      default: {},
    },
    firstGameWin: {
      type: Boolean,
      default: false
    },
    firstTradingWin: {
      type: Boolean,
      default: false
    },
    totalReferralEarnings: {
      type: Number,
      default: 0
    }
  },

  // Soft delete - timestamp when user was deleted (moved to archive)
  deletedAt: {
    type: Date,
    default: null
  },

  // Who deleted this user (for audit trail)
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },

  // Hierarchical Wallet Permissions
  // Stores which parent users have what level of access to this user's wallet
  walletPermissions: {
    type: Map,
    of: {
      parentUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      parentType: { type: String, enum: ['SUPERADMIN', 'ADMIN', 'BROKER', 'SUB_BROKER', 'CLIENT'], default: 'ADMIN' },
      canDeposit: { type: Boolean, default: false },
      canWithdraw: { type: Boolean, default: false },
      canView: { type: Boolean, default: true }
    },
    default: {}
  }
}, { timestamps: true });

// Virtual: Calculate Available Margin
userSchema.virtual('availableMargin').get(function() {
  return this.wallet.cashBalance 
    + this.wallet.collateralValue 
    + Math.max(0, this.wallet.unrealizedPnL) // Only add unrealized profit
    - Math.abs(Math.min(0, this.wallet.unrealizedPnL)) // Subtract unrealized loss
    - this.wallet.usedMargin;
});

// Virtual: Total Balance (for display)
userSchema.virtual('totalBalance').get(function() {
  return this.wallet.cashBalance + this.wallet.realizedPnL;
});

// Method: Check if user can place order
userSchema.methods.canPlaceOrder = function(requiredMargin) {
  if (this.rmsSettings.tradingBlocked) return { allowed: false, reason: this.rmsSettings.blockReason };
  if (!this.isActive) return { allowed: false, reason: 'Account is inactive' };
  
  const available = this.wallet.cashBalance 
    + this.wallet.collateralValue 
    + Math.max(0, this.wallet.unrealizedPnL)
    - Math.abs(Math.min(0, this.wallet.unrealizedPnL))
    - this.wallet.usedMargin;
  
  if (available < requiredMargin) {
    return { allowed: false, reason: 'Insufficient margin', available, required: requiredMargin };
  }
  
  return { allowed: true, available };
};

// Method: Block margin for order
userSchema.methods.blockMargin = function(amount) {
  this.wallet.usedMargin += amount;
  return this.save();
};

// Method: Release margin
userSchema.methods.releaseMargin = function(amount) {
  this.wallet.usedMargin = Math.max(0, this.wallet.usedMargin - amount);
  return this.save();
};

// Method: Update unrealized P&L
userSchema.methods.updateUnrealizedPnL = function(amount) {
  this.wallet.unrealizedPnL = amount;
  this.wallet.todayUnrealizedPnL = amount;
  return this.save();
};

// Method: Book realized P&L
userSchema.methods.bookRealizedPnL = function(amount) {
  this.wallet.realizedPnL += amount;
  this.wallet.todayRealizedPnL += amount;
  this.wallet.cashBalance += amount; // Add to cash balance
  return this.save();
};

userSchema.pre('save', async function(next) {
  // Generate userId for new users
  if (this.isNew && !this.userId) {
    let id = generateUserId();
    let exists = await mongoose.model('User').findOne({ userId: id });
    while (exists) {
      id = generateUserId();
      exists = await mongoose.model('User').findOne({ userId: id });
    }
    this.userId = id;
  }
  
  // Hash password if modified
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 12);
  }
  
  // Prevent wallet balances from going negative
  if (this.wallet) {
    if (this.wallet.cashBalance < 0) this.wallet.cashBalance = 0;
    if (this.wallet.tradingBalance < 0) this.wallet.tradingBalance = 0;
    if (this.wallet.balance < 0) this.wallet.balance = 0;
    if (this.wallet.usedMargin < 0) this.wallet.usedMargin = 0;
    if (this.wallet.blocked < 0) this.wallet.blocked = 0;
  }
  if (this.cryptoWallet && this.cryptoWallet.balance < 0) {
    this.cryptoWallet.balance = 0;
  }
  if (this.forexWallet && this.forexWallet.balance < 0) {
    this.forexWallet.balance = 0;
  }
  if (this.mcxWallet) {
    if (this.mcxWallet.balance < 0) this.mcxWallet.balance = 0;
    if (this.mcxWallet.usedMargin < 0) this.mcxWallet.usedMargin = 0;
  }
  if (this.nseBseWallet) {
    if (this.nseBseWallet.balance < 0) this.nseBseWallet.balance = 0;
    if (this.nseBseWallet.usedMargin < 0) this.nseBseWallet.usedMargin = 0;
  }
  if (this.gamesWallet) {
    if (this.gamesWallet.balance < 0) this.gamesWallet.balance = 0;
    if (this.gamesWallet.usedMargin < 0) this.gamesWallet.usedMargin = 0;
  }
  
  next();
});

// Index for faster queries
userSchema.index({ adminCode: 1, isActive: 1 });
userSchema.index({ adminCode: 1, tradingStatus: 1 });
userSchema.index({ hierarchyPath: 1 });
userSchema.index({ creatorRole: 1 });
userSchema.index({ admin: 1, creatorRole: 1 });
userSchema.index({ isDemo: 1, demoExpiresAt: 1 });

userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model('User', userSchema);
