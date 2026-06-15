import mongoose from 'mongoose';

const btcNumberBetSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  selectedNumber: {
    type: Number,
    required: true,
    min: 0,
    max: 99,
  },
  amount: {
    type: Number,
    required: true,
    min: 1,
  },
  quantity: {
    type: Number,
    default: 1,
    min: 1,
  },
  betDate: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'settling', 'won', 'lost', 'expired'],
    default: 'pending',
  },
  resultNumber: {
    type: Number,
    default: null,
  },
  /** BTC/USDT spot at result time (decimal drives winning .00–.99) */
  closingPrice: {
    type: Number,
    default: null,
  },
  profit: {
    type: Number,
    default: 0,
  },
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null,
  },
  distribution: {
    adminShare: { type: Number, default: 0 },
    superAdminShare: { type: Number, default: 0 },
    platformShare: { type: Number, default: 0 },
  },
  resultDeclaredAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

btcNumberBetSchema.index({ user: 1, betDate: 1 });
btcNumberBetSchema.index({ betDate: 1, status: 1 });

const BtcNumberBet = mongoose.model('BtcNumberBet', btcNumberBetSchema);

export default BtcNumberBet;
