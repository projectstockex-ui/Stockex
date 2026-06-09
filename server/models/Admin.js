import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const generateLoginId = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

const generateReferralCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `REF${code}`;
};

// Generate unique admin code
const generateAdminCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'ADM';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

const adminSchema = new mongoose.Schema({
  // Role hierarchy: SUPER_ADMIN > ADMIN > BROKER > SUB_BROKER
  role: {
    type: String,
    enum: ['SUPER_ADMIN', 'ADMIN', 'BROKER', 'SUB_BROKER'],
    default: 'ADMIN'
  },
  
  // Unique admin code (auto-generated for ADMIN role)
  adminCode: {
    type: String,
    unique: true,
    sparse: true // Allows null for SUPER_ADMIN
  },
  
  // Basic Info
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  // Numeric login ID / code (4-6 digits)
  loginId: {
    type: String,
    unique: true,
    sparse: true
  },
  name: {
    type: String,
    default: ''
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  phone: {
    type: String,
    default: ''
  },
  // Legacy password field (deprecated)
  password: {
    type: String
  },
  // Secure PIN for login (4 digits)
  pin: {
    type: String,
    required: false // Made optional to allow charge settings updates
  },
  
  // Enhanced audit and tracking fields
  lastLoginAt: {
    type: Date,
    default: null
  },
  lastLoginIP: {
    type: String,
    default: ''
  },
  loginCount: {
    type: Number,
    default: 0
  },
  
  // Admin activity tracking
  totalUsersCreated: {
    type: Number,
    default: 0
  },
  totalTradesManaged: {
    type: Number,
    default: 0
  },
  totalBrokerageEarned: {
    type: Number,
    default: 0
  },
  
  // SuperAdmin specific fields
  superAdminSettings: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // Data access permissions
  dataAccessLevel: {
    type: String,
    enum: ['FULL', 'LIMITED', 'READ_ONLY'],
    default: 'FULL'
  },
  
  // Metadata for debugging and audit
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // Status
  status: {
    type: String,
    enum: ['ACTIVE', 'SUSPENDED', 'INACTIVE'],
    default: 'ACTIVE'
  },
  isActive: {
    type: Boolean,
    default: true
  },

  /**
   * When false, this admin is treated as a company employee: hierarchy brokerage
   * (trade close + game profit / win-brokerage splits) is credited to Super Admin instead.
   */
  receivesHierarchyBrokerage: {
    type: Boolean,
    default: true
  },

  /** Office vs outside partner — drives Extra Charges (give/take) and subtree transfer eligibility. */
  officePartnerType: {
    type: String,
    enum: ['INTERNAL', 'EXTERNAL'],
    default: 'EXTERNAL',
  },

  /**
   * Franchise root: when true, this admin's subtree (brokers/sub-brokers/users) forms an isolated unit.
   * Trading/games win-loss settles within the subtree only. Super Admin gets only platform charges,
   * not hierarchy profit shares from this tree.
   */
  isFranchiseRoot: {
    type: Boolean,
    default: false,
  },

  /**
   * Platform charges percentage: When isFranchiseRoot is true, this % of brokerage/P&L goes to SuperAdmin
   * as platform charges. The remaining stays within the franchise subtree.
   */
  platformChargesPercentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },

  /**
   * Admin-specific crypto trading timing.
   * When set, applies to this admin's entire hierarchy.
   * Format: HH:mm (24-hour format)
   */
  cryptoStartTime: {
    type: String,
    default: null,
  },
  cryptoEndTime: {
    type: String,
    default: null,
  },

  /**
   * Segment-specific referral distribution settings.
   * SuperAdmin can disable for any admin/broker/subbroker per segment.
   * Admin can disable for their brokers per segment.
   * Broker can disable for their subbrokers per segment.
   */
  referralDistributionEnabled: {
    games: {
      type: Boolean,
      default: true
    },
    /** Master toggle for NSE + MCX + crypto + forex trading referral */
    trading: {
      type: Boolean,
      default: true
    },
    mcx: {
      type: Boolean,
      default: true
    },
    crypto: {
      type: Boolean,
      default: true
    },
    forex: {
      type: Boolean,
      default: true
    }
  },
  
  // Demo Broker fields
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
  
  // Session token for single device login - only one active session at a time
  activeSessionToken: {
    type: String,
    default: null
  },
  lastLoginAt: {
    type: Date,
    default: null
  },
  
  // Admin Charges (for ADMIN role)
  charges: {
    brokerage: {
      type: Number,
      default: 0 // Per lot/trade - set by SuperAdmin
    },
    intradayLeverage: {
      type: Number,
      default: 1
    },
    deliveryLeverage: {
      type: Number,
      default: 1
    },
    optionBuyLeverage: {
      type: Number,
      default: 1
    },
    optionSellLeverage: {
      type: Number,
      default: 1
    },
    futuresLeverage: {
      type: Number,
      default: 1
    },
    withdrawalFee: {
      type: Number,
      default: 0
    },
    profitShare: {
      type: Number,
      default: 0 // Percentage
    },
    minWithdrawal: {
      type: Number,
      default: 0
    },
    maxWithdrawal: {
      type: Number,
      default: 0
    }
  },
  
  // Lot Management Settings
  lotSettings: {
    // NIFTY
    niftyMaxLotIntraday: { type: Number, default: 100 },
    niftyMaxLotCarryForward: { type: Number, default: 50 },
    niftyLotSize: { type: Number, default: 25 },
    // BANKNIFTY
    bankniftyMaxLotIntraday: { type: Number, default: 100 },
    bankniftyMaxLotCarryForward: { type: Number, default: 50 },
    bankniftyLotSize: { type: Number, default: 15 },
    // FINNIFTY
    finniftyMaxLotIntraday: { type: Number, default: 100 },
    finniftyMaxLotCarryForward: { type: Number, default: 50 },
    finniftyLotSize: { type: Number, default: 25 },
    // MIDCPNIFTY
    midcpniftyMaxLotIntraday: { type: Number, default: 100 },
    midcpniftyMaxLotCarryForward: { type: Number, default: 50 },
    midcpniftyLotSize: { type: Number, default: 50 },
    // EQUITY
    equityMaxQtyIntraday: { type: Number, default: 10000 },
    equityMaxQtyDelivery: { type: Number, default: 5000 },
    // Global
    maxOpenPositions: { type: Number, default: 20 },
    maxDailyTrades: { type: Number, default: 100 }
  },
  
  // Leverage Settings - Hierarchical leverage system
  // SuperAdmin sets maxLeverageFromParent for Admin, Admin sets for Broker, etc.
  leverageSettings: {
    // Max leverage this admin can use/assign (set by parent admin)
    maxLeverageFromParent: { type: Number, default: 1 }, // Set by SuperAdmin
    // Intraday (MIS) leverage - single value
    intradayLeverage: { type: Number, default: 1 },
    // Carry Forward (NRML) leverage - single value
    carryForwardLeverage: { type: Number, default: 1 },
    // Legacy - kept for backward compatibility
    maxLeverage: { type: Number, default: 1 }
  },
  
  // Trading Settings
  tradingSettings: {
    allowTradingOutsideMarketHours: { type: Boolean, default: false },
    autoSquareOffTime: { type: String, default: '15:15' }, // IST time for auto square off
    marginCallPercentage: { type: Number, default: 80 }, // % of margin used triggers warning
    autoClosePercentage: { type: Number, default: 100 }, // % of margin used triggers auto close
    minTradeValue: { type: Number, default: 100 },
    maxTradeValue: { type: Number, default: 10000000 }
  },
  
  // Charge Settings - Spread and Commission
  chargeSettings: {
    spread: { type: Number, default: 0 }, // Points added to buy, subtracted from sell
    commission: { type: Number, default: 0 }, //  per lot
    commissionType: { type: String, enum: ['PER_LOT', 'PER_TRADE', 'PER_CRORE'], default: 'PER_LOT' },
    perTradeCharge: { type: Number, default: 0 }, // Fixed charge per trade
    perCroreCharge: { type: Number, default: 0 }, // Charge per crore turnover
    perLotCharge: { type: Number, default: 0 } // Charge per lot
  },
  
  // Brokerage Caps - Set by parent admin (Super Admin/Admin) for child admins (Broker/Sub-Broker)
  // Child admin cannot charge less than min or more than max
  brokerageCaps: {
    // Per Lot caps
    perLot: {
      min: { type: Number, default: 0 },      // Minimum brokerage per lot
      max: { type: Number, default: 0 }       // Maximum brokerage per lot - set by SuperAdmin
    },
    // Per Crore caps
    perCrore: {
      min: { type: Number, default: 0 },      // Minimum brokerage per crore
      max: { type: Number, default: 0 }       // Maximum brokerage per crore - set by SuperAdmin
    },
    // Per Trade caps
    perTrade: {
      min: { type: Number, default: 0 },      // Minimum brokerage per trade
      max: { type: Number, default: 0 }       // Maximum brokerage per trade - set by SuperAdmin
    },
    // Parent share percentage for extra brokerage (only SuperAdmin ↔ Admin level)
    parentSharePercentage: { type: Number, default: 5 } // % of extra brokerage shared with parent
  },
  
  // Admin Wallet
  wallet: {
    balance: {
      type: Number,
      default: 0
    },
    blocked: {
      type: Number,
      default: 0
    },
    totalDeposited: {
      type: Number,
      default: 0
    },
    totalWithdrawn: {
      type: Number,
      default: 0
    },
    totalProfitShare: {
      type: Number,
      default: 0
    }
  },
  
  // Temporary Wallet - Holds brokerage from winning users until SuperAdmin releases it
  temporaryWallet: {
    balance: {
      type: Number,
      default: 0
    },
    totalEarned: {
      type: Number,
      default: 0
    },
    totalReleased: {
      type: Number,
      default: 0
    },
    lastReleasedAt: {
      type: Date,
      default: null
    }
  },
  
  // Statistics
  stats: {
    totalUsers: {
      type: Number,
      default: 0
    },
    activeUsers: {
      type: Number,
      default: 0
    },
    totalVolume: {
      type: Number,
      default: 0
    },
    totalBrokerage: {
      type: Number,
      default: 0
    },
    totalPnL: {
      type: Number,
      default: 0
    }
  },
  
  // Credit Mode: INFINITE = virtual credit, LIMITED = actual balance
  creditMode: {
    type: String,
    enum: ['INFINITE', 'LIMITED'],
    default: 'LIMITED'
  },
  
  // Book Type: A_BOOK = exchange, B_BOOK = admin takes opposite
  bookType: {
    type: String,
    enum: ['A_BOOK', 'B_BOOK'],
    default: 'B_BOOK'
  },
  
  // Admin P&L from trades (B_BOOK)
  tradingPnL: {
    realized: {
      type: Number,
      default: 0
    },
    unrealized: {
      type: Number,
      default: 0
    },
    todayRealized: {
      type: Number,
      default: 0
    }
  },
  
  // Created by - reference to parent in hierarchy
  // SUPER_ADMIN: null, ADMIN: SUPER_ADMIN, BROKER: ADMIN, SUB_BROKER: BROKER
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  
  // Parent ID for hierarchy chain (same as createdBy but clearer naming)
  parentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  
  // Hierarchy level (0 = SUPER_ADMIN, 1 = ADMIN, 2 = BROKER, 3 = SUB_BROKER)
  hierarchyLevel: {
    type: Number,
    default: 1
  },
  
  // Hierarchy path - array of ancestor IDs for efficient queries
  hierarchyPath: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }],
  referralCode: {
    type: String,
    unique: true,
    sparse: true
  },
  referralUrl: {
    type: String,
    default: ''
  },
  
  // Branding settings for login/register page
  branding: {
    brandName: {
      type: String,
      default: ''
    },
    logoUrl: {
      type: String,
      default: ''
    },
    welcomeTitle: {
      type: String,
      default: ''
    }
  },
  
  // Broker Certificate - Display on landing page (managed by SuperAdmin)
  certificate: {
    isVerified: {
      type: Boolean,
      default: false
    },
    showOnLandingPage: {
      type: Boolean,
      default: false
    },
    certificateNumber: {
      type: String,
      default: ''
    },
    verifiedAt: {
      type: Date,
      default: null
    },
    description: {
      type: String,
      default: ''
    },
    specialization: {
      type: String,
      default: '' // e.g., "Equity", "F&O", "Commodities"
    },
    yearsOfExperience: {
      type: Number,
      default: 0
    },
    totalClients: {
      type: Number,
      default: 0
    },
    rating: {
      type: Number,
      default: 5,
      min: 1,
      max: 5
    },
    displayOrder: {
      type: Number,
      default: 0 // For sorting on landing page
    }
  },

  // Broker location — State → City → Area (predefined list)
  stateName: { type: String, default: '' },
  stateCode: { type: String, default: '' },
  cityName: { type: String, default: '' }, // City name e.g. Bengaluru
  cityCode: { type: String, default: '' }, // City code e.g. BLR
  areaName: { type: String, default: '' },
  areaPincode: { type: String, default: '' },
  
  // Restrict Mode - Limit number of users under this admin
  // Set by Super Admin for Admin/Broker/SubBroker
  restrictMode: {
    enabled: { type: Boolean, default: false },     // Is restrict mode active
    maxUsers: { type: Number, default: 100 },       // Maximum users allowed (dynamic, set by Super Admin)
    currentUsers: { type: Number, default: 0 },     // Current user count (auto-updated)
    maxBrokers: { type: Number, default: 10 },      // Max brokers under this admin (for ADMIN role)
    currentBrokers: { type: Number, default: 0 },   // Current broker count
    maxSubBrokers: { type: Number, default: 20 },   // Max sub-brokers (for BROKER role)
    currentSubBrokers: { type: Number, default: 0 }, // Current sub-broker count
    /** For INTERNAL office admins: fixed monthly incentive amount. For EXTERNAL: brokerage charge amount. */
    monthlyIncentiveAmount: { type: Number, default: 0 },
    monthlyBrokerageCharge: { type: Number, default: 0 },
    /** Where monthly incentive gets credited for INTERNAL admins: 'games_and_trading' | 'trading' | 'games' */
    monthlyIncentiveScope: { type: String, default: 'games_and_trading' },
    /** Brokerage charge per crore turnover for BROKER and SUB_BROKER roles */
    brokerageChargePerCrore: { type: Number, default: 0 },
    /** Brokerage restriction settings - control if brokerage goes to admin or Super Admin */
    restrictBrokerage: {
      games: { type: Boolean, default: false },    // Restrict games brokerage
      trading: { type: Boolean, default: false },  // Restrict trading brokerage
    },
    /** Hierarchy inheritance mode - control if restrictions apply to child admins */
    hierarchyInheritanceMode: { 
      type: String, 
      enum: ['FULL_INHERITANCE', 'SELECTIVE_INHERITANCE'], 
      default: 'FULL_INHERITANCE' 
    },
  },
  
  // Referral eligibility settings - control when referral commissions are paid
  referralEligibility: {
    enabled: { type: Boolean, default: true },           // Enable referral eligibility checks
    thresholdAmount: { type: Number, default: 1000 },    // Threshold amount (1000 per crore)
    thresholdUnit: { type: String, default: 'PER_CRORE' }, // Unit: 'PER_CRORE' or 'ABSOLUTE'
  },
  
  // Permission flags - Set by parent admin (SuperAdmin for Admin, Admin for Broker, etc.)
  // Controls what this admin can modify vs locked to default values
  permissions: {
    canChangeBrokerage: { type: Boolean, default: false },      // Can change brokerage rates
    canChangeCharges: { type: Boolean, default: false },        // Can change charges/fees
    canChangeLeverage: { type: Boolean, default: false },       // Can change leverage settings
    canChangeLotSettings: { type: Boolean, default: false },    // Can change lot limits
    canChangeTradingSettings: { type: Boolean, default: false }, // Can change trading settings
    canCreateUsers: { type: Boolean, default: true },           // Can create users
    canManageFunds: { type: Boolean, default: true }            // Can add/withdraw funds
  },
  
  // Default settings applied from parent (locked values if no permission)
  defaultSettings: {
    brokerage: {
      perLot: { type: Number, default: 0 },
      perCrore: { type: Number, default: 0 },
      perTrade: { type: Number, default: 0 }
    },
    leverage: {
      intraday: { type: Number, default: 1 },
      carryForward: { type: Number, default: 1 }
    },
    charges: {
      depositFee: { type: Number, default: 0 },
      withdrawalFee: { type: Number, default: 0 },
      tradingFee: { type: Number, default: 0 }
    },
    lotSettings: {
      maxLotSize: { type: Number, default: 100 },
      minLotSize: { type: Number, default: 1 }
    },
    quantitySettings: {
      maxQuantity: { type: Number, default: 50000 },
      breakupQuantity: { type: Number, default: 5000 },
      maxLotQuantity: { type: Number, default: 0 }
    },
    autosquare: { type: Number, default: 0 } // Auto square at percentage loss (0 = disabled)
  },
  
  // Delivery Pledge Settings - Admin can override system defaults
  // % of delivery trade value added to user's pledge margin
  deliveryPledgeSettings: {
    enabled: { type: Boolean, default: true },
    buyPledgePercent: { type: Number, default: 50 }, // % of buy value added to pledge
    sellPledgePercent: { type: Number, default: 50 }, // % of sell value added to pledge
    maxPledgeAmount: { type: Number, default: 0 }, // Max pledge per user (0 = unlimited)
    haircutPercent: { type: Number, default: 10 } // Haircut % for margin calculation
  },

  // Segment Permissions - Admin sets these, they cascade to all users under this admin
  // SuperAdmin sets defaults, Admin/Broker/SubBroker can override for their users
  segmentPermissions: {
    type: Map,
    of: {
      enabled: { type: Boolean, default: false },
      commissionType: { type: String, enum: ['PER_LOT', 'PER_QUANTITY', 'PER_TRADE', 'PER_CRORE'], default: 'PER_LOT' },
      /** INR for PER_LOT/PER_TRADE; PER_CRORE uses PERCENT (% of notional) or legacy INR ( per crore). */
      commissionUnit: { type: String, enum: ['INR', 'PERCENT'], default: null },
      commissionLot: { type: Number, default: 0 },
      /** Commission for PER_CRORE ( per crore or % of turnover) - used when commissionType is PER_CRORE */
      commission: { type: Number, default: 0 },
      maxLots: { type: Number, default: 50 },
      minLots: { type: Number, default: 1 },
      exposureIntraday: { type: Number, default: 1 },
      exposureCarryForward: { type: Number, default: 1 },
      intradayLeverage: { type: Number, default: 1 },
      carryForwardLeverage: { type: Number, default: 1 },
      // Lot Mode Settings - applies when user trades in Lots mode
      lotSettings: {
        intradayLeverage: { type: Number, default: 1 },
        carryForwardLeverage: { type: Number, default: 1 },
        maxLots: { type: Number, default: 50 },
        minLots: { type: Number, default: 1 },
        breakupLots: { type: Number, default: 0 },
        notificationPercent: { type: Number },
        autosquarePercent: { type: Number },
      },
      // Quantity Mode Settings - applies when user trades in Quantity mode
      quantityModeSettings: {
        intradayLeverage: { type: Number, default: 1 },
        carryForwardLeverage: { type: Number, default: 1 },
        maxQuantity: { type: Number, default: 1000 },
        minQuantity: { type: Number, default: 1 },
        breakupQuantity: { type: Number, default: 0 },
        notificationPercent: { type: Number },
        autosquarePercent: { type: Number },
      },
      /** Legacy flat qty caps (breakup only in schema); UI may also use quantityModeSettings */
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
      allowClientIntradayOnly: { type: Boolean, default: true },
      defaultIntradayOnly: { type: Boolean, default: false },
      intradayOnlyLeverage: { type: Number },
      intradayOnlyMaxQty: { type: Number },
      allowLimitPendingOrders: { type: Boolean, default: true },
      // Crypto (USD spot): total client bid–ask width in  per coin (half applied to bid, half to ask vs exchange mid)
      cryptoSpreadInr: { type: Number },
      /** Binance USD spot: $ widened per side on client quotes (bid − n, ask + n). Unset = no spread until configured. */
      cryptoSpreadUsdPerSide: { type: Number },
      /** IST (HH:mm or HH:mm:ss) — earliest time this segment allows trading */
      cryptoStartTime: { type: String, default: '' },
      cryptoClosingTime: { type: String, default: '' },
      /** IST MCX session start (HH:mm or HH:mm:ss) — hierarchy → users */
      mcxStartTime: { type: String, default: '' },
      /** IST MCX session close — carry-forward + freeze at this time */
      mcxClosingTime: { type: String, default: '' },
      /** IST NSE/BSE session start (HH:mm or HH:mm:ss) — hierarchy → users */
      nseStartTime: { type: String, default: '' },
      /** IST NSE/BSE session close — carry-forward at this time */
      nseClosingTime: { type: String, default: '' },
      cryptoReferenceSymbol: { type: String, default: '' },
      /** @deprecated UI removed; kept for legacy DB docs. */
      cryptoPricePerLotInr: { type: Number, default: 0 },
      /** Reference lot count for segment lot-size rule (CRYPTOFUT / CRYPTOOPT). */
      cryptoLotSizeLots: { type: Number, default: 1 },
      /** Base quantity for `cryptoLotSizeLots`; per-1-lot size = quantity / lots when both > 0. */
      cryptoLotSizeQuantity: { type: Number, default: 0 },
      // Dynamic quantity limits - inherited by users
      maxIntradayQty: { type: Number, default: 2000 },
      maxCarryQty: { type: Number, default: 1000 },
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
    default: {}
  },

  /** Per segment key: field names explicitly saved for this admin (others inherit Super Admin defaults at merge). Omit field = legacy full overlay. */
  segmentExplicitKeys: {
    type: mongoose.Schema.Types.Mixed,
  },
  
  // Script Settings - Admin sets these, they cascade to all users under this admin
  // Override segment settings for specific scripts (e.g., GOLD, NIFTY, etc.)
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
        perOrderQuantity: { type: Number, default: 100 },
        // Breakup quantity - maximum quantity per single order
        breakupQuantity: { type: Number, default: 0 }, // 0 = no limit
        // Max bid - maximum number of orders allowed
        maxBid: { type: Number, default: 0 } // 0 = no limit
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

  // Trading Restrictions - Set by parent admin (SuperAdmin for Admin, Admin for Broker, Broker for SubBroker)
  // Child admin cannot set restrictions that are less restrictive than parent's restrictions
  restrictions: {
    intradayLimit: { type: Number, default: 0 }, // Maximum intraday position value ()
    carryforwardLimit: { type: Number, default: 0 }, // Maximum carryforward position value ()
    maxLot: { type: Number, default: 0 }, // Maximum lot size per order
    minLot: { type: Number, default: 0 }, // Minimum lot size per order
    breakupQuantity: { type: Number, default: 0 }, // Maximum breakup quantity per order
    maxPositionValue: { type: Number, default: 0 }, // Maximum total position value ()
    maxExposure: { type: Number, default: 0 }, // Maximum exposure ()
    // Trading permissions
    allowIntraday: { type: Boolean, default: true },
    allowCarryforward: { type: Boolean, default: true },
    allowShortSelling: { type: Boolean, default: true },
    allowOptions: { type: Boolean, default: true },
    allowFutures: { type: Boolean, default: true },
    allowCommodity: { type: Boolean, default: true },
    allowCrypto: { type: Boolean, default: true },
    /**
     * When true, all users under this admin’s hierarchy may trade only within each instrument’s day low–high.
     * When false, that subtree does not get hierarchy-wide low–high trading (segment groups may still apply).
     */
    allowWithinLowHigh: { type: Boolean, default: false },
    /** Merged with ancestors at trade time — blocks instrument for this admin’s entire subtree */
    instrumentDenylist: [
      {
        exchange: { type: String, trim: true, default: '' },
        segment: { type: String, trim: true, default: '' },
        symbol: { type: String, trim: true, default: '' },
        tradingSymbol: { type: String, trim: true, default: '' },
        /** Allow trades within low-high range when toggle is ON */
        allowWithinLowHigh: { type: Boolean, default: false },
        /** Block trades outside low-high range when toggle is ON */
        blockOutsideLowHigh: { type: Boolean, default: false },
      },
    ],
  },

  // Hierarchy patti: per-segment share for this admin vs parent (parent % = 100 − this admin %)
  pattiSharing: {
    enabled: { type: Boolean, default: false },
    appliedTo: { type: String, enum: ['ALL_TRADES', 'SPECIFIC_CLIENTS'], default: 'ALL_TRADES' },
    notes: { type: String, default: '' },
    segments: { type: mongoose.Schema.Types.Mixed, default: {} }
  },

  // Soft delete - timestamp when admin was deleted (moved to archive)
  deletedAt: {
    type: Date,
    default: null
  },

  // Who deleted this admin (for audit trail)
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  }
}, { timestamps: true });

// Pre-save: Hash password and generate admin code
adminSchema.pre('save', async function(next) {
  // Hash PIN if modified
  if (this.isModified('pin')) {
    this.pin = await bcrypt.hash(this.pin, 12);
  }
  // Hash legacy passwords if still used
  if (this.isModified('password') && this.password) {
    this.password = await bcrypt.hash(this.password, 12);
  }
  
  // Generate admin code for new admins (all roles)
  if (this.isNew && !this.adminCode) {
    let code = generateAdminCode();
    let exists = await mongoose.model('Admin').findOne({ adminCode: code });
    while (exists) {
      code = generateAdminCode();
      exists = await mongoose.model('Admin').findOne({ adminCode: code });
    }
    this.adminCode = code;
  }

  // Generate loginId if missing
  if (this.isNew && !this.loginId) {
    let loginId = generateLoginId();
    let exists = await mongoose.model('Admin').findOne({ loginId });
    while (exists) {
      loginId = generateLoginId();
      exists = await mongoose.model('Admin').findOne({ loginId });
    }
    this.loginId = loginId;
  }

  // Generate referral code if missing
  if (this.isNew && !this.referralCode) {
    let ref = generateReferralCode();
    let exists = await mongoose.model('Admin').findOne({ referralCode: ref });
    while (exists) {
      ref = generateReferralCode();
      exists = await mongoose.model('Admin').findOne({ referralCode: ref });
    }
    this.referralCode = ref;
  }

  // Always refresh referral URL
  if (this.referralCode) {
    const base = (process.env.APP_BASE_URL || process.env.FRONTEND_BASE_URL || process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
    this.referralUrl = `${base}/login?ref=${this.referralCode}`;
  }
  
  // Set hierarchy level based on role
  const hierarchyLevels = { 'SUPER_ADMIN': 0, 'ADMIN': 1, 'BROKER': 2, 'SUB_BROKER': 3 };
  this.hierarchyLevel = hierarchyLevels[this.role] || 1;
  
  // Set parentId same as createdBy for consistency
  if (this.isNew && this.createdBy && !this.parentId) {
    this.parentId = this.createdBy;
  }
  
  // Build hierarchy path for new admins
  if (this.isNew && this.parentId) {
    const parent = await mongoose.model('Admin').findById(this.parentId);
    if (parent) {
      this.hierarchyPath = [...(parent.hierarchyPath || []), parent._id];
    }
  }
  
  next();
});

// Compare pin
adminSchema.methods.comparePin = async function(candidatePin) {
  return await bcrypt.compare(candidatePin, this.pin);
};

// Compare password (legacy password-based login)
adminSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password) return false;
  return await bcrypt.compare(candidatePassword, this.password);
};

// Check if super admin
adminSchema.methods.isSuperAdmin = function() {
  return this.role === 'SUPER_ADMIN';
};

// Check if admin
adminSchema.methods.isAdmin = function() {
  return this.role === 'ADMIN';
};

// Check if broker
adminSchema.methods.isBroker = function() {
  return this.role === 'BROKER';
};

// Check if sub broker
adminSchema.methods.isSubBroker = function() {
  return this.role === 'SUB_BROKER';
};

// Get hierarchy level number
adminSchema.methods.getHierarchyLevel = function() {
  const levels = { 'SUPER_ADMIN': 0, 'ADMIN': 1, 'BROKER': 2, 'SUB_BROKER': 3 };
  return levels[this.role] || 1;
};

// Check if this admin can manage another admin (based on hierarchy)
adminSchema.methods.canManage = function(targetRole) {
  const hierarchy = ['SUPER_ADMIN', 'ADMIN', 'BROKER', 'SUB_BROKER'];
  const myLevel = hierarchy.indexOf(this.role);
  const targetLevel = hierarchy.indexOf(targetRole);
  return myLevel < targetLevel; // Can only manage roles below in hierarchy
};

// Get allowed child roles that this admin can create
adminSchema.methods.getAllowedChildRoles = function() {
  const childRoles = {
    'SUPER_ADMIN': ['ADMIN', 'BROKER', 'SUB_BROKER'],
    'ADMIN': ['BROKER', 'SUB_BROKER'],
    'BROKER': ['SUB_BROKER'],
    'SUB_BROKER': []
  };
  return childRoles[this.role] || [];
};

// Get available balance
adminSchema.methods.getAvailableBalance = function() {
  return this.wallet.balance - this.wallet.blocked;
};

// Index for faster queries (adminCode already indexed via unique: true)
adminSchema.index({ role: 1, status: 1 });
adminSchema.index({ parentId: 1 });
adminSchema.index({ hierarchyPath: 1 });
adminSchema.index({ createdBy: 1, role: 1 });

export default mongoose.model('Admin', adminSchema);
