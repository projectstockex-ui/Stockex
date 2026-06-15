import mongoose from 'mongoose';

const referralSchema = new mongoose.Schema({
  referrer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  referredUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  referralCode: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['PENDING', 'ACTIVE', 'COMPLETED'],
    default: 'PENDING'
  },
  earnings: {
    type: Number,
    default: 0
  },
  // Track first-time wins
  firstGameWin: {
    credited: {
      type: Boolean,
      default: false
    },
    amount: {
      type: Number,
      default: 0
    },
    creditedAt: {
      type: Date,
      default: null
    },
    gameName: {
      type: String,
      default: null
    }
  },
  firstTradingWin: {
    credited: {
      type: Boolean,
      default: false
    },
    amount: {
      type: Number,
      default: 0
    },
    creditedAt: {
      type: Date,
      default: null
    }
  },
  tradingReferralCount: {
    type: Number,
    default: 0
  },
  tradingReferrals: [
    {
      tradeId: { type: String, default: null },
      amount: { type: Number, default: 0 },
      brokerageAmount: { type: Number, default: 0 },
      segment: { type: String, default: 'trading' },
      creditedAt: { type: Date, default: Date.now }
    }
  ],
  createdAt: {
    type: Date,
    default: Date.now
  },
  activatedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Index for efficient queries
referralSchema.index({ referrer: 1, status: 1 });
referralSchema.index({ referredUser: 1 });

const Referral = mongoose.model('Referral', referralSchema);

export default Referral;
