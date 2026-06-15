import mongoose from 'mongoose';

const niftyJackpotBidSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 1
  },
  /** Number of ticket units (amount / ticketPrice) for this bid */
  ticketCount: {
    type: Number,
    default: 1,
    min: 1
  },
  /** User's predicted NIFTY level for this ticket (used for ranking vs spot / locked close); display & audit */
  niftyPriceAtBid: {
    type: Number,
    default: null,
  },
  betDate: {
    type: String, // Format: YYYY-MM-DD
    required: true
  },
  // Rank assigned after result declaration (1 = highest bidder)
  rank: {
    type: Number,
    default: null
  },
  // Prize won based on rank (net after brokerage)
  prize: {
    type: Number,
    default: 0
  },
  // Gross prize before brokerage deduction
  grossPrize: {
    type: Number,
    default: 0
  },
  // Total brokerage deducted from winner's prize
  brokerageDeducted: {
    type: Number,
    default: 0
  },
  // Brokerage distribution to winner's hierarchy
  winnerBrokerageDistribution: {
    subBroker: {
      id: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
      name: String,
      amount: { type: Number, default: 0 }
    },
    broker: {
      id: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
      name: String,
      amount: { type: Number, default: 0 }
    },
    admin: {
      id: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
      name: String,
      amount: { type: Number, default: 0 }
    }
  },
  // Status: pending (waiting for result), won (in top N), lost, expired (removed after deadline, stake refunded)
  status: {
    type: String,
    enum: ['pending', 'settling', 'won', 'lost', 'expired'],
    default: 'pending'
  },
  // Admin who manages this user
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  // Profit distribution breakdown (for losing bids)
  distribution: {
    adminShare: { type: Number, default: 0 },
    superAdminShare: { type: Number, default: 0 },
    platformShare: { type: Number, default: 0 }
  },
  resultDeclaredAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Multiple one-ticket bids per user per day allowed
niftyJackpotBidSchema.index({ user: 1, betDate: 1 });
niftyJackpotBidSchema.index({ betDate: 1, status: 1 });
niftyJackpotBidSchema.index({ betDate: 1, niftyPriceAtBid: -1 });

const NiftyJackpotBid = mongoose.model('NiftyJackpotBid', niftyJackpotBidSchema);

export default NiftyJackpotBid;
