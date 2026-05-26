import mongoose from 'mongoose';

// System-wide default settings for each role
// SuperAdmin can set these defaults which cascade down to all admins/users
const systemSettingsSchema = new mongoose.Schema({
  // Singleton document identifier
  settingsType: {
    type: String,
    default: 'global',
    unique: true
  },
  
  // Default settings for ADMIN role
  adminDefaults: {
    brokerage: {
      perLot: { type: Number, default: 20 },
      perCrore: { type: Number, default: 100 },
      perTrade: { type: Number, default: 10 }
    },
    leverage: {
      intraday: { type: Number, default: 10 },
      carryForward: { type: Number, default: 5 }
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
      maxQuantity: { type: Number, default: 50000 }, // Overall max quantity limit (total exposure)
      breakupQuantity: { type: Number, default: 5000 }, // Breakup quantity per single order
      maxLotQuantity: { type: Number, default: 0 } // Maximum lots per single order (0 = no limit)
    },
    autosquare: { type: Number, default: 0 }, // Auto square at loss percentage (0 = disabled)
    // Permissions - whether Admin can change these settings
    permissions: {
      canChangeBrokerage: { type: Boolean, default: true },
      canChangeCharges: { type: Boolean, default: true },
      canChangeLeverage: { type: Boolean, default: true },
      canChangeLotSettings: { type: Boolean, default: true },
      canChangeTradingSettings: { type: Boolean, default: true },
      canChangeQuantitySettings: { type: Boolean, default: true }
    }
  },
  
  // Default settings for BROKER role
  brokerDefaults: {
    brokerage: {
      perLot: { type: Number, default: 25 },
      perCrore: { type: Number, default: 120 },
      perTrade: { type: Number, default: 15 }
    },
    leverage: {
      intraday: { type: Number, default: 8 },
      carryForward: { type: Number, default: 4 }
    },
    charges: {
      depositFee: { type: Number, default: 0 },
      withdrawalFee: { type: Number, default: 0 },
      tradingFee: { type: Number, default: 0 }
    },
    lotSettings: {
      maxLotSize: { type: Number, default: 50 },
      minLotSize: { type: Number, default: 1 }
    },
    quantitySettings: {
      maxQuantity: { type: Number, default: 25000 },
      breakupQuantity: { type: Number, default: 2500 },
      maxLotQuantity: { type: Number, default: 0 }
    },
    autosquare: { type: Number, default: 0 },
    // Permissions - whether Broker can change these settings
    permissions: {
      canChangeBrokerage: { type: Boolean, default: false },
      canChangeCharges: { type: Boolean, default: false },
      canChangeLeverage: { type: Boolean, default: false },
      canChangeLotSettings: { type: Boolean, default: false },
      canChangeTradingSettings: { type: Boolean, default: false },
      canChangeQuantitySettings: { type: Boolean, default: false }
    }
  },
  
  // Default settings for SUB_BROKER role
  subBrokerDefaults: {
    brokerage: {
      perLot: { type: Number, default: 30 },
      perCrore: { type: Number, default: 150 },
      perTrade: { type: Number, default: 20 }
    },
    leverage: {
      intraday: { type: Number, default: 5 },
      carryForward: { type: Number, default: 3 }
    },
    charges: {
      depositFee: { type: Number, default: 0 },
      withdrawalFee: { type: Number, default: 0 },
      tradingFee: { type: Number, default: 0 }
    },
    lotSettings: {
      maxLotSize: { type: Number, default: 25 },
      minLotSize: { type: Number, default: 1 }
    },
    quantitySettings: {
      maxQuantity: { type: Number, default: 10000 },
      breakupQuantity: { type: Number, default: 1000 },
      maxLotQuantity: { type: Number, default: 0 }
    },
    autosquare: { type: Number, default: 0 },
    // Permissions - whether SubBroker can change these settings
    permissions: {
      canChangeBrokerage: { type: Boolean, default: false },
      canChangeCharges: { type: Boolean, default: false },
      canChangeLeverage: { type: Boolean, default: false },
      canChangeLotSettings: { type: Boolean, default: false },
      canChangeTradingSettings: { type: Boolean, default: false },
      canChangeQuantitySettings: { type: Boolean, default: false }
    }
  },
  
  // Default settings for USER (applied via their parent admin)
  userDefaults: {
    brokerage: {
      perLot: { type: Number, default: 30 },
      perCrore: { type: Number, default: 150 },
      perTrade: { type: Number, default: 20 }
    },
    leverage: {
      intraday: { type: Number, default: 5 },
      carryForward: { type: Number, default: 3 }
    },
    charges: {
      depositFee: { type: Number, default: 0 },
      withdrawalFee: { type: Number, default: 0 },
      tradingFee: { type: Number, default: 0 }
    },
    lotSettings: {
      maxLotSize: { type: Number, default: 10 },
      minLotSize: { type: Number, default: 1 }
    },
    quantitySettings: {
      maxQuantity: { type: Number, default: 5000 },
      breakupQuantity: { type: Number, default: 500 }
    }
  },
  
  // MLM-style Brokerage Sharing Percentages
  // When a user trades, brokerage is distributed up the hierarchy
  // Example: User pays 100 brokerage -> SubBroker gets 30%, Broker gets 25%, Admin gets 25%, SuperAdmin gets 20%
  brokerageSharing: {
    // SuperAdmin's share of total brokerage (remaining after all levels)
    superAdminShare: { type: Number, default: 20 }, // 20%
    
    // Admin's share of brokerage from their direct users and downline
    adminShare: { type: Number, default: 25 }, // 25%
    
    // Broker's share of brokerage from their direct users and downline
    brokerShare: { type: Number, default: 25 }, // 25%
    
    // SubBroker's share of brokerage from their direct users
    subBrokerShare: { type: Number, default: 30 }, // 30%
    
    // Enable/disable brokerage sharing
    enabled: { type: Boolean, default: true },
    
    // Sharing mode: 'PERCENTAGE' = each level gets % of total, 'CASCADING' = each level gets % of remaining
    mode: { type: String, enum: ['PERCENTAGE', 'CASCADING'], default: 'PERCENTAGE' }
  },
  
  // Note: Profit/Loss sharing is NOT distributed through hierarchy like brokerage.
  // P&L goes only to the user's direct parent admin.
  // For P&L sharing between admin levels, use Patti Sharing feature.
  
  // Segment-wise default settings (margin, leverage per segment)
  segmentDefaults: {
    EQUITY: {
      enabled: { type: Boolean, default: true },
      intradayLeverage: { type: Number, default: 5 },
      deliveryLeverage: { type: Number, default: 1 },
      marginRequired: { type: Number, default: 20 }, // percentage
      lotSize: { type: Number, default: 1 },
      intradayMaxLots: { type: Number, default: 10000 },
      intradayBreakupLots: { type: Number, default: 1000 },
      carryForwardMaxLots: { type: Number, default: 5000 },
      carryForwardBreakupLots: { type: Number, default: 500 },
      brokeragePerLot: { type: Number, default: 20 },
      brokeragePerCrore: { type: Number, default: 100 },
      // Admin-style fields for inheritance
      commissionType: { type: String, enum: ['PER_LOT', 'PER_TRADE', 'PER_CRORE'], default: 'PER_CRORE' },
      commissionUnit: { type: String, enum: ['INR', 'PERCENT'], default: null },
      maxExchangeLots: { type: Number, default: 10000 },
      maxLots: { type: Number, default: 500 },
      minLots: { type: Number, default: 1 },
      orderLots: { type: Number, default: 100 }
    },
    FNO: {
      enabled: { type: Boolean, default: true },
      intradayLeverage: { type: Number, default: 10 },
      carryForwardLeverage: { type: Number, default: 5 },
      marginRequired: { type: Number, default: 10 },
      lotSize: { type: Number, default: 50 },
      intradayMaxLots: { type: Number, default: 100 },
      intradayBreakupLots: { type: Number, default: 10 },
      carryForwardMaxLots: { type: Number, default: 50 },
      carryForwardBreakupLots: { type: Number, default: 5 },
      brokeragePerLot: { type: Number, default: 20 },
      brokeragePerCrore: { type: Number, default: 100 },
      commissionType: { type: String, enum: ['PER_LOT', 'PER_QUANTITY', 'PER_TRADE', 'PER_CRORE'], default: 'PER_LOT' },
      commissionUnit: { type: String, enum: ['INR', 'PERCENT'], default: null },
      maxExchangeLots: { type: Number, default: 500 },
      maxLots: { type: Number, default: 100 },
      minLots: { type: Number, default: 1 },
      orderLots: { type: Number, default: 25 },
      optionBuy: {
        allowed: { type: Boolean, default: true },
        commissionType: { type: String, enum: ['PER_LOT', 'PER_QUANTITY', 'PER_TRADE', 'PER_CRORE'], default: 'PER_LOT' },
        commissionUnit: { type: String, enum: ['INR', 'PERCENT'], default: null },
        commission: { type: Number, default: 20 },
        strikeSelection: { type: Number, default: 50 },
        maxExchangeLots: { type: Number, default: 500 }
      },
      optionSell: {
        allowed: { type: Boolean, default: true },
        commissionType: { type: String, enum: ['PER_LOT', 'PER_QUANTITY', 'PER_TRADE', 'PER_CRORE'], default: 'PER_LOT' },
        commissionUnit: { type: String, enum: ['INR', 'PERCENT'], default: null },
        commission: { type: Number, default: 20 },
        strikeSelection: { type: Number, default: 50 },
        maxExchangeLots: { type: Number, default: 500 }
      }
    },
    MCX: {
      enabled: { type: Boolean, default: true },
      intradayLeverage: { type: Number, default: 8 },
      carryForwardLeverage: { type: Number, default: 4 },
      marginRequired: { type: Number, default: 12 },
      // Quantity-based settings (no lots for MCX)
      intradayMaxQuantity: { type: Number, default: 5000 },
      intradayBreakupQuantity: { type: Number, default: 500 },
      carryForwardMaxQuantity: { type: Number, default: 2500 },
      carryForwardBreakupQuantity: { type: Number, default: 250 },
      minQuantity: { type: Number, default: 1 },
      orderQuantity: { type: Number, default: 100 },
      // Brokerage settings
      brokeragePerQuantity: { type: Number, default: 0.25 },
      brokeragePerCrore: { type: Number, default: 120 },
      commissionType: { type: String, enum: ['PER_QUANTITY', 'PER_TRADE', 'PER_CRORE'], default: 'PER_QUANTITY' },
      commissionUnit: { type: String, enum: ['INR', 'PERCENT'], default: 'INR' },
      maxExchangeQuantity: { type: Number, default: 10000 },
      // Brokerage charge by Super Admin (the brokerage that Super Admin charges)
      superAdminBrokerageCharge: { type: Number, default: 25 },
      // Incentive given by Super Admin (the incentive/rebate that Super Admin provides)
      superAdminIncentive: { type: Number, default: 0 },
      // Super Admin settings in crores
      superAdminBrokerageChargeInCrore: { type: Number, default: 0 },
      superAdminIncentiveInCrore: { type: Number, default: 0 },
      optionBuy: {
        allowed: { type: Boolean, default: true },
        commissionType: { type: String, enum: ['PER_QUANTITY', 'PER_TRADE', 'PER_CRORE'], default: 'PER_QUANTITY' },
        commissionUnit: { type: String, enum: ['INR', 'PERCENT'], default: 'INR' },
        commission: { type: Number, default: 25 },
        strikeSelection: { type: Number, default: 50 },
        maxExchangeQuantity: { type: Number, default: 10000 }
      },
      optionSell: {
        allowed: { type: Boolean, default: true },
        commissionType: { type: String, enum: ['PER_QUANTITY', 'PER_TRADE', 'PER_CRORE'], default: 'PER_QUANTITY' },
        commissionUnit: { type: String, enum: ['INR', 'PERCENT'], default: 'INR' },
        commission: { type: Number, default: 25 },
        strikeSelection: { type: Number, default: 50 },
        maxExchangeQuantity: { type: Number, default: 10000 }
      }
    },
    CURRENCY: {
      enabled: { type: Boolean, default: true },
      intradayLeverage: { type: Number, default: 10 },
      carryForwardLeverage: { type: Number, default: 5 },
      marginRequired: { type: Number, default: 10 },
      lotSize: { type: Number, default: 1000 },
      intradayMaxLots: { type: Number, default: 100 },
      intradayBreakupLots: { type: Number, default: 10 },
      carryForwardMaxLots: { type: Number, default: 50 },
      carryForwardBreakupLots: { type: Number, default: 5 },
      brokeragePerLot: { type: Number, default: 20 },
      brokeragePerCrore: { type: Number, default: 100 },
      commissionType: { type: String, enum: ['PER_LOT', 'PER_QUANTITY', 'PER_TRADE', 'PER_CRORE'], default: 'PER_LOT' },
      commissionUnit: { type: String, enum: ['INR', 'PERCENT'], default: null },
      maxExchangeLots: { type: Number, default: 100 },
      maxLots: { type: Number, default: 50 },
      minLots: { type: Number, default: 1 },
      orderLots: { type: Number, default: 10 }
    }
  },
  
  // Instrument-wise default settings (for popular instruments)
  instrumentDefaults: {
    NIFTY: {
      enabled: { type: Boolean, default: true },
      intradayLeverage: { type: Number, default: 15 },
      carryForwardLeverage: { type: Number, default: 8 },
      marginRequired: { type: Number, default: 7 },
      lotSize: { type: Number, default: 25 },
      intradayMaxLots: { type: Number, default: 100 },
      intradayBreakupLots: { type: Number, default: 10 },
      carryForwardMaxLots: { type: Number, default: 50 },
      carryForwardBreakupLots: { type: Number, default: 5 },
      brokeragePerLot: { type: Number, default: 20 }
    },
    BANKNIFTY: {
      enabled: { type: Boolean, default: true },
      intradayLeverage: { type: Number, default: 12 },
      carryForwardLeverage: { type: Number, default: 6 },
      marginRequired: { type: Number, default: 8 },
      lotSize: { type: Number, default: 15 },
      intradayMaxLots: { type: Number, default: 100 },
      intradayBreakupLots: { type: Number, default: 10 },
      carryForwardMaxLots: { type: Number, default: 50 },
      carryForwardBreakupLots: { type: Number, default: 5 },
      brokeragePerLot: { type: Number, default: 20 }
    },
    FINNIFTY: {
      enabled: { type: Boolean, default: true },
      intradayLeverage: { type: Number, default: 12 },
      carryForwardLeverage: { type: Number, default: 6 },
      marginRequired: { type: Number, default: 8 },
      lotSize: { type: Number, default: 25 },
      intradayMaxLots: { type: Number, default: 100 },
      intradayBreakupLots: { type: Number, default: 10 },
      carryForwardMaxLots: { type: Number, default: 50 },
      carryForwardBreakupLots: { type: Number, default: 5 },
      brokeragePerLot: { type: Number, default: 20 }
    },
    MIDCPNIFTY: {
      enabled: { type: Boolean, default: true },
      intradayLeverage: { type: Number, default: 10 },
      carryForwardLeverage: { type: Number, default: 5 },
      marginRequired: { type: Number, default: 10 },
      lotSize: { type: Number, default: 50 },
      intradayMaxLots: { type: Number, default: 100 },
      intradayBreakupLots: { type: Number, default: 10 },
      carryForwardMaxLots: { type: Number, default: 50 },
      carryForwardBreakupLots: { type: Number, default: 5 },
      brokeragePerLot: { type: Number, default: 20 }
    },
    SENSEX: {
      enabled: { type: Boolean, default: true },
      intradayLeverage: { type: Number, default: 12 },
      carryForwardLeverage: { type: Number, default: 6 },
      marginRequired: { type: Number, default: 8 },
      lotSize: { type: Number, default: 10 },
      intradayMaxLots: { type: Number, default: 100 },
      intradayBreakupLots: { type: Number, default: 10 },
      carryForwardMaxLots: { type: Number, default: 50 },
      carryForwardBreakupLots: { type: Number, default: 5 },
      brokeragePerLot: { type: Number, default: 20 }
    },
    CRUDEOIL: {
      enabled: { type: Boolean, default: true },
      intradayLeverage: { type: Number, default: 8 },
      carryForwardLeverage: { type: Number, default: 4 },
      marginRequired: { type: Number, default: 12 },
      lotSize: { type: Number, default: 100 },
      intradayMaxLots: { type: Number, default: 50 },
      intradayBreakupLots: { type: Number, default: 5 },
      carryForwardMaxLots: { type: Number, default: 25 },
      carryForwardBreakupLots: { type: Number, default: 3 },
      brokeragePerLot: { type: Number, default: 25 }
    },
    GOLD: {
      enabled: { type: Boolean, default: true },
      intradayLeverage: { type: Number, default: 8 },
      carryForwardLeverage: { type: Number, default: 4 },
      marginRequired: { type: Number, default: 12 },
      lotSize: { type: Number, default: 100 },
      intradayMaxLots: { type: Number, default: 50 },
      intradayBreakupLots: { type: Number, default: 5 },
      carryForwardMaxLots: { type: Number, default: 25 },
      carryForwardBreakupLots: { type: Number, default: 3 },
      brokeragePerLot: { type: Number, default: 25 }
    },
    SILVER: {
      enabled: { type: Boolean, default: true },
      intradayLeverage: { type: Number, default: 8 },
      carryForwardLeverage: { type: Number, default: 4 },
      marginRequired: { type: Number, default: 12 },
      lotSize: { type: Number, default: 30 },
      intradayMaxLots: { type: Number, default: 50 },
      intradayBreakupLots: { type: Number, default: 5 },
      carryForwardMaxLots: { type: Number, default: 25 },
      carryForwardBreakupLots: { type: Number, default: 3 },
      brokeragePerLot: { type: Number, default: 25 }
    },
    NATURALGAS: {
      enabled: { type: Boolean, default: true },
      intradayLeverage: { type: Number, default: 6 },
      carryForwardLeverage: { type: Number, default: 3 },
      marginRequired: { type: Number, default: 15 },
      lotSize: { type: Number, default: 1250 },
      intradayMaxLots: { type: Number, default: 25 },
      intradayBreakupLots: { type: Number, default: 5 },
      carryForwardMaxLots: { type: Number, default: 10 },
      carryForwardBreakupLots: { type: Number, default: 2 },
      brokeragePerLot: { type: Number, default: 25 }
    }
  },
  
  // Delivery Pledge Settings - % of delivery trade value added to pledge margin
  // When user buys/sells in delivery (CNC), this % of trade value is added to deliveryPledge
  // User can use deliveryPledge as margin for trading any instrument
  deliveryPledgeSettings: {
    enabled: { type: Boolean, default: true },
    // % of buy value added to pledge (e.g., 50 means 50% of ₹100,000 = ₹50,000 pledge)
    buyPledgePercent: { type: Number, default: 50 },
    // % of sell value added to pledge
    sellPledgePercent: { type: Number, default: 50 },
    // Maximum pledge amount per user (0 = unlimited)
    maxPledgeAmount: { type: Number, default: 0 },
    // Haircut % - reduction in pledge value for margin calculation (e.g., 10% haircut)
    haircutPercent: { type: Number, default: 10 }
  },

  // Admin Segment Permissions Defaults - SAME structure as Admin.segmentPermissions
  // These are the master defaults that all admins inherit when they haven't set their own
  // Uses the same segment keys as Admin model: NSEFUT, NSEOPT, MCXFUT, MCXOPT, NSE-EQ, BSE-FUT, BSE-OPT, FOREX
  adminSegmentDefaults: {
    type: Map,
    of: {
      enabled: { type: Boolean, default: false },
      maxExchangeLots: { type: Number, default: 100 },
      commissionType: { type: String, enum: ['PER_LOT', 'PER_QUANTITY', 'PER_TRADE', 'PER_CRORE'], default: 'PER_LOT' },
      commissionUnit: { type: String, enum: ['INR', 'PERCENT'], default: null },
      commissionLot: { type: Number, default: 0 },
      /** Commission for PER_CRORE (₹ per crore or % of turnover) - used when commissionType is PER_CRORE */
      commission: { type: Number, default: 0 },
      maxLots: { type: Number, default: 50 },
      minLots: { type: Number, default: 1 },
      orderLots: { type: Number, default: 10 },
      quantitySettings: {
        breakupQuantity: { type: Number, default: 0 },
        maxBid: { type: Number, default: 0 },
      },
      exposureIntraday: { type: Number, default: 1 },
      exposureCarryForward: { type: Number, default: 1 },
      /** If false, users cannot enable “Intraday only” on dashboard; hierarchy/User can override. */
      allowClientIntradayOnly: { type: Boolean, default: true },
      /** When true, new orders are marked intraday-only (EOD auto square). Set in Super Admin defaults + hierarchy; clients do not choose. */
      defaultIntradayOnly: { type: Boolean, default: false },
      cryptoSpreadInr: { type: Number },
      cryptoSpreadUsdPerSide: { type: Number },
      /** IST (HH:mm or HH:mm:ss) — earliest time users may trade CRYPTOFUT/CRYPTOOPT; empty = no start gate */
      cryptoStartTime: { type: String, default: '' },
      /** IST session close hint (HH:mm or HH:mm:ss) - for crypto segments */
      cryptoClosingTime: { type: String, default: '' },
      /** IST session close time (HH:mm or HH:mm:ss) - generic closing time for all segments (NSE, MCX, BSE, etc.) */
      closingTime: { type: String, default: '' },
      cryptoReferenceSymbol: { type: String, default: '' },
      /** @deprecated */
      cryptoPricePerLotInr: { type: Number, default: 0 },
      cryptoLotSizeLots: { type: Number, default: 1 },
      cryptoLotSizeQuantity: { type: Number, default: 0 },
      // Dynamic quantity limits - user's max quantity that adjusts with P&L
      maxIntradayQty: { type: Number, default: 2000 }, // Max shares/quantity for intraday
      maxCarryQty: { type: Number, default: 1000 }, // Max shares/quantity for carry forward
      optionBuy: {
        allowed: { type: Boolean, default: true },
        commissionType: { type: String, enum: ['PER_LOT', 'PER_QUANTITY', 'PER_TRADE', 'PER_CRORE'], default: 'PER_LOT' },
        commissionUnit: { type: String, enum: ['INR', 'PERCENT'], default: null },
        commission: { type: Number, default: 0 },
        strikeSelection: { type: Number, default: 50 },
        maxExchangeLots: { type: Number, default: 100 },
        intradayLeverage: { type: Number, default: 1 },
        carryForwardLeverage: { type: Number, default: 1 },
      },
      optionSell: {
        allowed: { type: Boolean, default: true },
        commissionType: { type: String, enum: ['PER_LOT', 'PER_QUANTITY', 'PER_TRADE', 'PER_CRORE'], default: 'PER_LOT' },
        commissionUnit: { type: String, enum: ['INR', 'PERCENT'], default: null },
        commission: { type: Number, default: 0 },
        strikeSelection: { type: Number, default: 50 },
        maxExchangeLots: { type: Number, default: 100 },
        intradayLeverage: { type: Number, default: 1 },
        carryForwardLeverage: { type: Number, default: 1 },
      }
    },
    default: {}
  },

  // Admin Script Settings Defaults - SAME structure as Admin.scriptSettings
  adminScriptDefaults: {
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

  /** Self-serve demo user trial (days until convert-to-real or account deletion) */
  demoAccountSettings: {
    /** Trial length in calendar days (e.g. 7 or 15) */
    trialDays: { type: Number, default: 7 },
    /** Initial virtual balance for new demo users */
    demoBalance: { type: Number, default: 1000000 },
  },

  /** Daily platform fee (Super Admin): debit user main wallet, credit active Super Admin wallet; IST cron */
  platformCharges: {
    enabled: { type: Boolean, default: false },
    dailyAmountInr: { type: Number, default: 25 },
    /** First N IST calendar days from signup are free; billing starts on calendar day N+1 */
    graceDays: { type: Number, default: 15 },
  },

  // Notification Settings
  notificationSettings: {
    marginWarningThreshold: { type: Number, default: 70 }, // % margin usage to trigger warning
    marginDangerThreshold: { type: Number, default: 90 }, // % margin usage for danger alert
    autoSquareOffThreshold: { type: Number, default: 100 }, // % margin usage for auto square off
    enableMarginNotifications: { type: Boolean, default: true },
    enableTradeNotifications: { type: Boolean, default: true },
    enableLoginNotifications: { type: Boolean, default: false },
    notifyAdminOnUserMarginWarning: { type: Boolean, default: true }, // Notify parent admin when user hits margin warning
    notifyAdminOnUserDanger: { type: Boolean, default: true } // Notify parent admin when user hits danger level
  },
  
  // Last updated by
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, {
  timestamps: true,
  /** Ensure Maps (e.g. adminSegmentDefaults) serialize as plain objects in JSON responses */
  toJSON: { flattenMaps: true },
  toObject: { flattenMaps: true },
});

// Static method to get or create the singleton settings document
// Returns a full Mongoose document so callers can use .save() / .markModified()
systemSettingsSchema.statics.getSettings = async function() {
  let settings = await this.findOne({ settingsType: 'global' });
  if (!settings) {
    settings = await this.create({ settingsType: 'global' });
  }
  return settings;
};

export default mongoose.model('SystemSettings', systemSettingsSchema);
