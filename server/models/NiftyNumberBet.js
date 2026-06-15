import mongoose from 'mongoose';

const niftyNumberBetSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // The decimal number user picked (.00 to .99)
  selectedNumber: {
    type: Number,
    required: true,
    min: 0,
    max: 99
  },
  // Bet amount (total = quantity * per-ticket price)
  amount: {
    type: Number,
    required: true,
    min: 1
  },
  // Number of bets/tickets for this number
  quantity: {
    type: Number,
    default: 1,
    min: 1
  },
  // Date of the bet (only date part, no time) for one-bet-per-day logic
  betDate: {
    type: String, // Format: YYYY-MM-DD
    required: true
  },
  // Status: pending (waiting for result), won, lost, expired (removed after deadline, stake refunded)
  status: {
    type: String,
    enum: ['pending', 'settling', 'won', 'lost', 'expired'],
    default: 'pending'
  },
  // The actual Nifty closing decimal (.00-.99)
  resultNumber: {
    type: Number,
    default: null
  },
  // Nifty closing price at result time
  closingPrice: {
    type: Number,
    default: null
  },
  // Profit if won (fixed profit from settings)
  profit: {
    type: Number,
    default: 0
  },
  // Admin who manages this user (for profit distribution)
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  // Profit distribution breakdown
  distribution: {
    adminShare: { type: Number, default: 0 },
    superAdminShare: { type: Number, default: 0 },
    platformShare: { type: Number, default: 0 }
  },
  // Result declared at
  resultDeclaredAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Index for fast lookup: multiple bets per user per day
niftyNumberBetSchema.index({ user: 1, betDate: 1 });
// Index for resolving all pending bets for a date
niftyNumberBetSchema.index({ betDate: 1, status: 1 });

const NiftyNumberBet = mongoose.model('NiftyNumberBet', niftyNumberBetSchema);

export default NiftyNumberBet;
