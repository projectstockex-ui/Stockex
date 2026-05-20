import mongoose from 'mongoose';

const walletLedgerSchema = new mongoose.Schema({
  // Owner type and ID
  ownerType: {
    type: String,
    enum: ['ADMIN', 'USER'],
    required: true
  },
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'ownerType'
  },
  
  // Admin code (for filtering)
  adminCode: {
    type: String,
    index: true
  },
  
  // Transaction type
  type: {
    type: String,
    enum: ['CREDIT', 'DEBIT'],
    required: true
  },
  
  // Reason for transaction
  reason: {
    type: String,
    enum: [
      'FUND_ADD',           // Admin adds fund to user
      'FUND_WITHDRAW',      // User withdraws fund
      'TRADING_FUND_ADD',   // Admin adds fund directly to trading wallet
      'TRADING_FUND_WITHDRAW', // Admin withdraws from trading wallet
      'TRADE_PNL',          // Trading profit/loss
      'BROKERAGE',          // Brokerage charges
      'PROFIT_SHARE',       // Profit share to admin
      'ADMIN_DEPOSIT',      // Super admin deposits to admin
      'ADMIN_WITHDRAW',     // Admin withdraws
      'ADMIN_TRANSFER',     // Admin to admin fund transfer
      'REFUND',             // Refund
      'ADJUSTMENT',         // Manual adjustment
      'BONUS',              // Bonus credit
      'PENALTY',            // Penalty debit
      'CRYPTO_TRANSFER',    // Transfer between main wallet and crypto wallet
      'FOREX_TRANSFER',     // Transfer between main wallet and forex wallet
      'MCX_TRANSFER',       // Transfer between main wallet and MCX wallet
      'INTERNAL_TRANSFER',  // Internal transfer between wallets
      'GAMES_TRANSFER',     // Transfer between main wallet and games wallet
      'WALLET_TRANSFER_DEBIT',  // Inter-wallet mesh transfer (debit leg) — see meta.transferId
      'WALLET_TRANSFER_CREDIT', // Inter-wallet mesh transfer (credit leg)
      'GAME_PROFIT',        // Game profit share distributed through hierarchy
      'REFERRAL_COMMISSION', // Credit to referrer from Super Admin's share of referred user's profit distribution
      'REFERRAL_COMMISSION_TRANSFER', // Debit from Super Admin pool for referral transfer out
      'PLATFORM_CHARGE_DEBIT',       // User main wallet — daily platform fee
      'PLATFORM_CHARGE_CREDIT'       // Super Admin wallet — daily platform fee collection
    ],
    required: true
  },
  
  // Amount
  amount: {
    type: Number,
    required: true
  },
  
  // Balance after transaction
  balanceAfter: {
    type: Number,
    required: true
  },
  
  // Reference to related document
  reference: {
    type: {
      type: String,
      enum: ['FundRequest', 'Trade', 'Position', 'Order', 'Manual'],
      default: 'Manual'
    },
    id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null
    }
  },
  
  // Description
  description: {
    type: String,
    default: ''
  },

  // Auto-square flag - true if this ledger entry is from an auto-squared trade
  isAutoSquare: {
    type: Boolean,
    default: false
  },

  // Performed by (admin who made the transaction)
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },

  /** GAME_PROFIT: effective share % of baseAmount (loss pool, win brokerage, or gross fee) */
  meta: {
    sharePercent: { type: Number },
    baseAmount: { type: Number },
    profitKind: { type: String },
    /** GameSettings key (e.g. niftyUpDown) for admin ledger game filter */
    gameKey: { type: String },
    /** Super Admin pool debit tagging (games client feed / audit) */
    poolDebitKind: { type: String },
    relatedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    /** Who received this GAME_PROFIT (SUB_BROKER / BROKER / ADMIN / SUPER_ADMIN) — for admin wallet ledger UI */
    hierarchyRole: { type: String },
    /** Payout to hierarchy member — tagged on Super Admin ADJUSTMENT debits (pool outflow) */
    hierarchyPayoutToRole: { type: String },
    /** REFERRAL_COMMISSION: wallet segment the referred user earned from (games/mcx/forex) */
    segment: { type: String },
    /** REFERRAL_COMMISSION_TRANSFER: client the Super Admin share is being routed to */
    referralClientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    /** Per-game stake/ticket referral (creditReferralPercentOfTotalStake); required for first-win-only queries */
    kind: { type: String },
    settlementDay: { type: String },
    sessionScope: { type: String },
    rewardPercent: { type: Number },
    referralBase: { type: String },
    totalStakeInSession: { type: Number },
    ticketPrice: { type: Number },
    referredUsername: { type: String },
    rank: { type: Number },
    /** Inter-wallet mesh transfers (WalletTransferService) — must persist or Mongoose strips them and history breaks */
    transferId: { type: String },
    sourceWallet: { type: String },
    targetWallet: { type: String },
    /** PLATFORM_CHARGE_* — IST calendar day charged */
    chargeDayKey: { type: String },
    sourceUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    /** EXTRA_CHARGE incentive (give-incentive) — trading vs games tagging for audits */
    incentiveScope: { type: String },
    /** give-incentive: main wallet vs temporary (games) wallet credit leg */
    incentiveWallet: { type: String },
  },
}, { timestamps: true });

// Index for faster queries
walletLedgerSchema.index({ ownerType: 1, ownerId: 1, createdAt: -1 });
walletLedgerSchema.index({ adminCode: 1, createdAt: -1 });
walletLedgerSchema.index({ reason: 1, createdAt: -1 });
walletLedgerSchema.index({ ownerType: 1, ownerId: 1, 'meta.gameKey': 1, createdAt: -1 });

export default mongoose.model('WalletLedger', walletLedgerSchema);
