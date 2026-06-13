import mongoose from 'mongoose';

const gameConfigSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: true },
  minTickets: { type: Number, default: 1 },
  maxTickets: { type: Number, default: 500 },
  winMultiplier: { type: Number, default: 2 }, // e.g., 2x for up/down
  brokeragePercent: { type: Number, default: 5 }, // Platform fee on winnings
  roundDuration: { type: Number, default: 60 }, // seconds
  cooldownBetweenRounds: { type: Number, default: 5 }, // seconds
  maxBetsPerRound: { type: Number, default: 100 }, // max bets user can place per round
  displayOrder: { type: Number, default: 0 },
  // Per-game ticket price ( per ticket); user API falls back to global tokenValue if unset
  ticketPrice: { type: Number },
  profitUserPercent: { type: Number, default: 0 },
  subBrokerShareToBroker: { type: Boolean, default: true },
  /** 0 = unlimited. Nifty/BTC Up/Down: max tickets staked on that side per window (IST day + window #). */
  maxTicketsUpPerWindow: { type: Number, default: 0 },
  maxTicketsDownPerWindow: { type: Number, default: 0 },
  /** 0 = unlimited. Nifty Bracket: max tickets on BUY vs SELL side per IST calendar day. */
  maxTicketsBuyPerDay: { type: Number, default: 0 },
  maxTicketsSellPerDay: { type: Number, default: 0 },
  // Referral distribution settings per game
  referralDistribution: {
    firstWinByTickets: { type: Number, default: 5 }, // % of first winning to referrer based on tickets
    winPercent: { type: Number, default: 5 }, // % of winning amount to referrer (per game)
    topRanksOnly: { type: Boolean, default: false }, // Only apply to top X ranks (for jackpot)
    topRanksCount: { type: Number, default: 3 } // Number of top ranks to apply (for jackpot)
  }
}, { _id: false });

const gameSettingsSchema = new mongoose.Schema({
  // Global Settings
  gamesEnabled: { type: Boolean, default: true },
  maintenanceMode: { type: Boolean, default: false },
  maintenanceMessage: { type: String, default: 'Games are under maintenance. Please try again later.' },
  
  // Token System (1 token = tokenValue in )
  tokenValue: { type: Number, default: 300 }, // 1 token = 300
  
  // Platform Commission
  platformCommission: { type: Number, default: 5 }, // Global platform fee %
  
  // Profit Distribution Hierarchy (% of win/brokerage amount)
  profitDistribution: {
    superAdminPercent: { type: Number, default: 40 },
    adminPercent: { type: Number, default: 30 },
    brokerPercent: { type: Number, default: 20 },
    subBrokerPercent: { type: Number, default: 10 }
    // Remaining (if any) auto goes to Super Admin
  },
  
  // Min/Max Global Limits
  globalMinTickets: { type: Number, default: 1 },
  globalMaxTickets: { type: Number, default: 1000 },
  dailyBetLimit: { type: Number, default: 500000 }, // Max a user can bet in a day
  dailyWinLimit: { type: Number, default: 1000000 }, // Max a user can win in a day

  /** Seconds after position expiry (window end / result minute) before unsettled stakes are refunded and removed */
  gamePositionExpiryGraceSeconds: { type: Number, default: 3600 },
  
  // Individual Game Settings
  games: {
    niftyUpDown: {
      ...gameConfigSchema.obj,
      name: { type: String, default: 'Nifty Up/Down' },
      description: { type: String, default: 'Predict if Nifty will go UP or DOWN' },
      winMultiplier: { type: Number, default: 1.95 },
      /** Seconds per leg: bet window length; LTP after bet; result one more leg later (default 900 = 15 min). */
      roundDuration: { type: Number, default: 900 },
      enabled: { type: Boolean, default: true },
      minTickets: { type: Number, default: 1 },
      maxTickets: { type: Number, default: 500 },
      /** If sum > 0, win fee is % of gross win (like Nifty Number); else brokeragePercent on profit only */
      grossPrizeSubBrokerPercent: { type: Number, default: 0 },
      grossPrizeBrokerPercent: { type: Number, default: 0 },
      grossPrizeAdminPercent: { type: Number, default: 0 },
      brokeragePercent: { type: Number, default: 5 },
      buySellRatioBrokerage: { type: Number, default: 16.67 },
      profitSubBrokerPercent: { type: Number, default: 10 },
      profitBrokerPercent: { type: Number, default: 20 },
      profitAdminPercent: { type: Number, default: 30 },
      startTime: { type: String, default: '09:15:00' },
      endTime: { type: String, default: '15:45:00' },
      /** % of total stake (all UP+DOWN legs) in a settled window; one referrer credit per window when there is a win */
      referralDistribution: {
        winPercent: { type: Number, default: 10 }
      }
    },
    niftyNumber: {
      ...gameConfigSchema.obj,
      name: { type: String, default: 'Nifty Number' },
      description: { type: String, default: 'Pick a decimal (.00-.99) of Nifty closing price' },
      winMultiplier: { type: Number, default: 9 },
      roundDuration: { type: Number, default: 86400 }, // 1 day in seconds
      enabled: { type: Boolean, default: true },
      minTickets: { type: Number, default: 1 },
      maxTickets: { type: Number, default: 100 },
      /** 0 when using grossPrize* hierarchy % of gross win slice; legacy setups may set >0 with gross all 0 */
      brokeragePercent: { type: Number, default: 0 },
      buySellRatioBrokerage: { type: Number, default: 16.67 },
      fixedProfit: { type: Number, default: 4000 }, // Fixed profit on win (gross before hierarchy / brokerage)
      /**
       * Hierarchy fees as % of winner gross slice G (fixedProfit × quantity), not % of ticket.
       * If sum > 0, declare uses these cuts from G and skips brokeragePercent for net prize (same as Nifty Jackpot).
       */
      grossPrizeSubBrokerPercent: { type: Number, default: 2 },
      grossPrizeBrokerPercent: { type: Number, default: 1 },
      grossPrizeAdminPercent: { type: Number, default: 0.5 },
      profitSubBrokerPercent: { type: Number, default: 10 },
      profitBrokerPercent: { type: Number, default: 20 },
      profitAdminPercent: { type: Number, default: 30 },
      resultTime: { type: String, default: '15:45' }, // IST — shown to users; admin declare-result applies win/loss
      maxBidTime: { type: String, default: '15:40' }, // Last time users can place bets
      betsPerDay: { type: Number, default: 10 }, // Max bets per user per day
      /** Max tickets per user on a single number (.00–.99) per IST day; 0 = unlimited */
      maxTicketsPerNumber: { type: Number, default: 2 },
      biddingStartTime: { type: String, default: '09:15' },
      biddingEndTime: { type: String, default: '15:24' },
      startTime: { type: String, default: '09:15:15' },
      endTime: { type: String, default: '15:45:00' },
      /** % of user's total Nifty Number stake for the declare day when they have a win; one referrer credit per user per day */
      referralDistribution: {
        winPercent: { type: Number, default: 10 }
      }
    },
    niftyJackpot: {
      ...gameConfigSchema.obj,
      name: { type: String, default: 'Nifty Jackpot' },
      description: { type: String, default: 'Bid and compete for top ranks to win prizes' },
      winMultiplier: { type: Number, default: 1.5 },
      roundDuration: { type: Number, default: 86400 },
      enabled: { type: Boolean, default: true },
      minTickets: { type: Number, default: 1 },
      maxTickets: { type: Number, default: 100 },
      /** 0 when using grossPrize* hierarchy % of winner slice (TC3-style); legacy setups may set >0 with gross all 0 */
      brokeragePercent: { type: Number, default: 0 },
      buySellRatioBrokerage: { type: Number, default: 16.67 },
      topWinners: { type: Number, default: 20 },
      prizeDistribution: { type: [Number], default: [45000, 10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000] },
      resultTime: { type: String, default: '15:45' },
      /**
       * With maxTicketsPerRequest ≤ 1: max separate bid submissions per user per IST day.
       * With larger requests: max total tickets staked that day (sum of amounts ÷ ticket price).
       */
      bidsPerDay: { type: Number, default: 100 },
      /** Max tickets per single POST /nifty-jackpot/bid; 1 = one ticket per request (scenario / UX default) */
      maxTicketsPerRequest: { type: Number, default: 1 },
      /**
       * Hierarchy fees as % of winner gross slice G (kitty % × pool), not % of ticket.
       * If sum > 0, declare uses these cuts from G and skips brokeragePercent for net prize.
       */
      grossPrizeSubBrokerPercent: { type: Number, default: 2 },
      grossPrizeBrokerPercent: { type: Number, default: 1 },
      grossPrizeAdminPercent: { type: Number, default: 0.5 },
      profitSubBrokerPercent: { type: Number, default: 10 },
      profitBrokerPercent: { type: Number, default: 20 },
      profitAdminPercent: { type: Number, default: 30 },
      biddingStartTime: { type: String, default: '00:00' },
      biddingEndTime: { type: String, default: '23:59' },
      /** Per-rank % of total pool (kitty); rank 1 default 45% — see server/utils/niftyJackpotPrize.js */
      prizePercentages: {
        type: mongoose.Schema.Types.Mixed,
        default: () => [
          { rank: '1st', percent: 45 },
          { rank: '2nd', percent: 10 },
          { rank: '3rd', percent: 3 },
          { rank: '4th', percent: 2 },
          { rank: '5th', percent: 1.5 },
          { rank: '6th', percent: 1 },
          { rank: '7th', percent: 1 },
          { rank: '8th-10th', percent: 0.75 },
          { rank: '11th-20th', percent: 0.5 },
        ],
      },
      brokerageDistribution: { type: mongoose.Schema.Types.Mixed },
      startTime: { type: String, default: '09:15:15' },
      endTime: { type: String, default: '15:45:00' },
      /** % of user's total jackpot stake for the declare day (when they win a prize); one credit per user per day; optional top-rank gate */
      referralDistribution: {
        winPercent: { type: Number, default: 5 },
        topRanksOnly: { type: Boolean, default: true },
        topRanksCount: { type: Number, default: 3 }
      }
    },
    niftyBracket: {
      ...gameConfigSchema.obj,
      name: { type: String, default: 'Nifty Bracket' },
      description: { type: String, default: 'Buy/Sell on bracket levels around Nifty price' },
      /** 1,000/ticket stake → 1,900 gross at 1.9x */
      ticketPrice: { type: Number, default: 1000 },
      winMultiplier: { type: Number, default: 1.9 },
      roundDuration: { type: Number, default: 300 }, // 5 min max wait
      enabled: { type: Boolean, default: true },
      minTickets: { type: Number, default: 1 },
      maxTickets: { type: Number, default: 250 },
      /** % of gross win to hierarchy (funded from SA pool); sum >0 enables gross-hierarchy path */
      grossPrizeSubBrokerPercent: { type: Number, default: 2 },
      grossPrizeBrokerPercent: { type: Number, default: 1 },
      grossPrizeAdminPercent: { type: Number, default: 1 },
      brokeragePercent: { type: Number, default: 5 },
      buySellRatioBrokerage: { type: Number, default: 16.67 },
      bracketGap: { type: Number, default: 20 }, // Points above/below spot (or entry) anchor
      /** Spread type: 'point' for fixed points, 'percentage' for percentage-based spread */
      bracketGapType: { type: String, enum: ['point', 'percentage'], default: 'point' },
      /** Percentage spread when bracketGapType is 'percentage' (e.g., 0.1 for 0.1%) */
      bracketGapPercent: { type: Number, default: 0.1 },
      /** If true, upper/lower are built from live Nifty spot at place time (ignores client entryPrice for centre) */
      bracketAnchorToSpot: { type: Boolean, default: true },
      /**
       * At result-time (session close): how to decide win/loss.
       * 'directionVsEntry' — BUY wins if settlement LTP is above your entry; SELL wins if LTP is below (typical 1D direction bet vs ref).
       * 'breakPastBands' — BUY only if LTP clears the upper target; SELL only if LTP is below the lower (stricter band breakout).
       */
      bracketSessionCloseRule: {
        type: String,
        enum: ['directionVsEntry', 'breakPastBands'],
        default: 'directionVsEntry',
      },
      /** For breakPastBands (and intraday touch): BUY wins if LTP > upperTarget; SELL if LTP < lowerTarget. For directionVsEntry: applies to LTP vs entry. */
      bracketStrictLtpComparison: { type: Boolean, default: true },
      expiryMinutes: { type: Number, default: 5 }, // Intraday mode: minutes until expiry
      settleAtResultTime: { type: Boolean, default: true }, // true = settle only at resultTime IST (e.g. 3:31)
      profitSubBrokerPercent: { type: Number, default: 10 },
      profitBrokerPercent: { type: Number, default: 20 },
      profitAdminPercent: { type: Number, default: 30 },
      resultTime: { type: String, default: '15:31' }, // IST settlement clock (LTP at/after this instant)
      biddingStartTime: { type: String, default: '09:15:29' },
      /** HH:mm → inclusive through end of that minute (e.g. 15:29 = …:15:29:59) */
      biddingEndTime: { type: String, default: '15:29' },
      startTime: { type: String, default: '09:15:15' },
      endTime: { type: String, default: '15:45:00' },
      /** % of trade stake on a winning bracket resolve; one referrer credit per resolved trade */
      referralDistribution: {
        winPercent: { type: Number, default: 2 }
      },
      /** Max tickets per single BUY/SELL order; 0 = unlimited (aside from maxTickets) */
      maxTicketsPerNumber: { type: Number, default: 2 },
    },
    btcUpDown: {
      ...gameConfigSchema.obj,
      name: { type: String, default: 'BTC Up/Down' },
      description: {
        type: String,
        default:
          'Predict BTC vs 15m windows (94 IST rounds/day by default). Winners receive full stake × multiplier; hierarchy from pool.',
      },
      winMultiplier: { type: Number, default: 1.95 },
      roundDuration: { type: Number, default: 60 },
      enabled: { type: Boolean, default: true },
      minTickets: { type: Number, default: 1 },
      maxTickets: { type: Number, default: 500 },
      grossPrizeSubBrokerPercent: { type: Number, default: 0 },
      grossPrizeBrokerPercent: { type: Number, default: 0 },
      grossPrizeAdminPercent: { type: Number, default: 0 },
      /** % of (grossWin − stake); total brokerage T debited from SA BTC pool for hierarchy split */
      brokeragePercent: { type: Number, default: 5 },
      buySellRatioBrokerage: { type: Number, default: 16.67 },
      /** % of T each (remainder of T → SA); used by distributeWinBrokerage with skipUserRebate for BTC */
      profitSubBrokerPercent: { type: Number, default: 5 },
      profitBrokerPercent: { type: Number, default: 1 },
      profitAdminPercent: { type: Number, default: 1 },
      startTime: { type: String, default: '00:00:01' },
      endTime: { type: String, default: '23:45:00' },
      allowedExpiryTimes: { type: [Number], default: [60, 120, 300, 600, 900] }, // 1m, 2m, 5m, 10m, 15m in seconds
      defaultExpiryTime: { type: Number, default: 60 }, // Default 1 minute
      /** % of total stake (all UP+DOWN legs) in a settled window; one referrer credit per window when there is a win */
      referralDistribution: {
        winPercent: { type: Number, default: 10 }
      }
    },
    btcJackpot: {
      ...gameConfigSchema.obj,
      name: { type: String, default: 'BTC Jackpot' },
      description: {
        type: String,
        default:
          'Predict BTC USD price, win from the Bank by ranking closest to the locked close after bidding ends. Top 20 share prizes; ties split equally.',
      },
      enabled: { type: Boolean, default: true },

      /**  per ticket — fixed stake; user only chooses predicted BTC price */
      ticketPrice: { type: Number, default: 500 },
      minTickets: { type: Number, default: 1 },
      /** 1 = one predicted-price ticket per request (scenario / UX default) */
      maxTicketsPerRequest: { type: Number, default: 1 },
      /** Max separate bids a user can place per IST day */
      bidsPerDay: { type: Number, default: 200 },
      /** Not used directly (prize from Bank share); kept for schema parity */
      maxTickets: { type: Number, default: 5000 },
      winMultiplier: { type: Number, default: 1 },
      roundDuration: { type: Number, default: 86400 },

      biddingStartTime: { type: String, default: '00:00' }, // HH:mm IST
      biddingEndTime: { type: String, default: '23:29' },   // inclusive through :59
      /** Legacy field; auto-settlement uses biddingEndTime (jackpot-only) or btcNumber.resultTime when both games run */
      resultTime: { type: String, default: '23:30' },

      topWinners: { type: Number, default: 20 },

      /** Per-rank % of the Bank (point 8). Sum of defaults = 100%. Admin can edit. */
      prizePercentages: {
        type: mongoose.Schema.Types.Mixed,
        default: () => [
          { rank: 1,  percent: 45  },
          { rank: 2,  percent: 10  },
          { rank: 3,  percent: 5   },
          { rank: 4,  percent: 2   },
          { rank: 5,  percent: 1.5 },
          { rank: 6,  percent: 1   },
          { rank: 7,  percent: 1   },
          { rank: 8,  percent: 0.75 },
          { rank: 9,  percent: 0.75 },
          { rank: 10, percent: 0.75 },
          { rank: 11, percent: 0.5 },
          { rank: 12, percent: 0.5 },
          { rank: 13, percent: 0.5 },
          { rank: 14, percent: 0.5 },
          { rank: 15, percent: 0.5 },
          { rank: 16, percent: 0.5 },
          { rank: 17, percent: 0.5 },
          { rank: 18, percent: 0.5 },
          { rank: 19, percent: 0.5 },
          { rank: 20, percent: 0.5 },
        ],
      },

      /**
       * Hierarchy brokerage (point 11) — % of each winner's grossPrize, funded from Super Admin.
       * These are NOT deducted from the user (point 13). Winner always receives full grossPrize.
       */
      hierarchy: {
        subBrokerPercent: { type: Number, default: 2 },
        brokerPercent:    { type: Number, default: 1 },
        adminPercent:     { type: Number, default: 0.5 },
      },

      /** % of user's total BTC Jackpot stake for the declare day when they win a prize; one credit per user per day */
      referralDistribution: {
        winPercent:    { type: Number, default: 5 },
        topRanksOnly:  { type: Boolean, default: true },
        topRanksCount: { type: Number, default: 3 },
      },
    },
    btcNumber: {
      ...gameConfigSchema.obj,
      name: { type: String, default: 'BTC Number' },
      description: { type: String, default: 'Pick a decimal (.00-.99) of BTC USDT spot at 23:30 IST' },
      winMultiplier: { type: Number, default: 9 },
      roundDuration: { type: Number, default: 86400 },
      enabled: { type: Boolean, default: true },
      minTickets: { type: Number, default: 1 },
      maxTickets: { type: Number, default: 100 },
      brokeragePercent: { type: Number, default: 0 },
      buySellRatioBrokerage: { type: Number, default: 16.67 },
      fixedProfit: { type: Number, default: 4000 },
      grossPrizeSubBrokerPercent: { type: Number, default: 2 },
      grossPrizeBrokerPercent: { type: Number, default: 1 },
      grossPrizeAdminPercent: { type: Number, default: 0.5 },
      profitSubBrokerPercent: { type: Number, default: 10 },
      profitBrokerPercent: { type: Number, default: 20 },
      profitAdminPercent: { type: Number, default: 30 },
      resultTime: { type: String, default: '23:30' },
      maxBidTime: { type: String, default: '23:25' },
      betsPerDay: { type: Number, default: 10 },
      /** Max tickets per user on a single number (.00–.99) per IST day; 0 = unlimited */
      maxTicketsPerNumber: { type: Number, default: 2 },
      biddingStartTime: { type: String, default: '00:00' },
      biddingEndTime: { type: String, default: '23:24' },
      startTime: { type: String, default: '00:00:01' },
      endTime: { type: String, default: '23:30:00' },
      /** % of user's total BTC Number stake for the declare day when they have a win; one referrer credit per user per day */
      referralDistribution: {
        winPercent: { type: Number, default: 10 },
      },
    },
  },
  
  // Referral & Bonus Settings
  referralBonus: {
    enabled: { type: Boolean, default: true },
    referrerBonus: { type: Number, default: 100 }, // Amount referrer gets
    refereeBonus: { type: Number, default: 50 }, // Amount new user gets
    minDepositRequired: { type: Number, default: 500 } // Min deposit to activate bonus
  },

  // Phone Verification Settings
  phoneVerification: {
    enabled: { type: Boolean, default: true }, // Enable/disable phone verification for registration
    requireForRegistration: { type: Boolean, default: true } // Require phone verification before account creation
  },

  /** Super Admin — who in the admin hierarchy may edit client segment/settings values */
  adminHierarchyClientSettings: {
    /** When true, Admin/Broker can edit segment settings for broker/sub-broker clients in their tree */
    allowEditSubordinateClientValues: { type: Boolean, default: false },
  },
  
  // First Deposit Bonus
  firstDepositBonus: {
    enabled: { type: Boolean, default: true },
    bonusPercent: { type: Number, default: 100 }, // 100% bonus on first deposit
    maxBonus: { type: Number, default: 5000 }, // Max bonus amount
    wageringRequirement: { type: Number, default: 3 } // 3x wagering to withdraw
  },
  
  // Loss Cashback
  lossCashback: {
    enabled: { type: Boolean, default: false },
    cashbackPercent: { type: Number, default: 5 }, // 5% of net losses
    minLoss: { type: Number, default: 1000 }, // Min loss to qualify
    maxCashback: { type: Number, default: 10000 }, // Max cashback per period
    period: { type: String, enum: ['daily', 'weekly', 'monthly'], default: 'weekly' }
  },
  
  // Risk Management
  riskManagement: {
    maxExposurePerUser: { type: Number, default: 100000 }, // Max total bets at risk
    maxWinPerRound: { type: Number, default: 500000 }, // Max payout per round
    autoSuspendOnLargeWin: { type: Boolean, default: true },
    largeWinThreshold: { type: Number, default: 100000 }, // Auto review wins above this
    suspiciousActivityAlert: { type: Boolean, default: true }
  },

  // Trading Hours (when games are available)
  tradingHours: {
    enabled: { type: Boolean, default: false }, // If true, games only available during hours
    startTime: { type: String, default: '09:15' }, // IST
    endTime: { type: String, default: '15:30' }, // IST
    weekendEnabled: { type: Boolean, default: false }
  }
}, {
  timestamps: true
});

// Ensure only one settings document exists
gameSettingsSchema.statics.getSettings = async function() {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }

  // Auto-heal new game blocks added to the schema after the singleton was created.
  // Mongoose only applies defaults on document creation, so existing documents don't
  // automatically pick up freshly-added game subschemas. We materialise them on first read
  // so admin toggle / settings screens never 404 with "Game not found".
  const KNOWN_GAMES = [
    'niftyUpDown',
    'btcUpDown',
    'niftyNumber',
    'niftyBracket',
    'niftyJackpot',
    'btcJackpot',
    'btcNumber',
  ];

  let mutated = false;
  if (!settings.games || typeof settings.games !== 'object') {
    settings.games = {};
    mutated = true;
  }

  // Build a fresh instance once; its nested subschemas will have all per-field defaults
  // materialised by Mongoose so we can copy whole blocks onto the singleton.
  const freshDefaults = new this({}).toObject();

  for (const key of KNOWN_GAMES) {
    if (!settings.games[key]) {
      const seed = freshDefaults?.games?.[key] || { enabled: true };
      settings.games[key] = seed;
      mutated = true;
    }
  }

  // Legacy Nifty Jackpot day-session window → 24h bidding (00:00–23:59 IST).
  const nj = settings.games?.niftyJackpot;
  if (
    nj &&
    (nj.biddingStartTime === '09:15' || nj.biddingStartTime === '09:15:00') &&
    (nj.biddingEndTime === '14:59' || nj.biddingEndTime === '14:59:00' || nj.biddingEndTime === '15:29')
  ) {
    nj.biddingStartTime = '00:00';
    nj.biddingEndTime = '23:59';
    mutated = true;
  }

  if (mutated) {
    settings.markModified('games');
    try {
      await settings.save();
    } catch (e) {
      console.warn('[GameSettings] auto-heal save failed:', e?.message || e);
    }
  }

  return settings;
};

const GameSettings = mongoose.model('GameSettings', gameSettingsSchema);

export default GameSettings;
