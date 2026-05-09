import mongoose from 'mongoose';

const watchlistItemSchema = new mongoose.Schema({
  token: { type: String },  // Not required for crypto (uses pair instead)
  symbol: { type: String, required: true },
  name: { type: String },
  exchange: { type: String },
  segment: { type: String },
  displaySegment: { type: String },
  instrumentType: { type: String },
  optionType: { type: String },
  strike: { type: Number },
  expiry: { type: Date },
  lotSize: { type: Number, default: 1 },
  tradingSymbol: { type: String },
  category: { type: String },
  pair: { type: String },
  isCrypto: { type: Boolean, default: false },
  isForex: { type: Boolean, default: false }
}, { _id: false });

const watchlistSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  segment: {
    type: String,
    required: true,
    enum: ['NSEFUT', 'NSEOPT', 'MCXFUT', 'MCXOPT', 'NSE-EQ', 'BSE-FUT', 'BSE-OPT', 'CRYPTOFUT', 'CRYPTOOPT', 'FOREX', 'FOREXFUT', 'FOREXOPT', 'CDS', 'FAVORITES']
  },
  instruments: [watchlistItemSchema]
}, { timestamps: true });

// Compound index for efficient queries
watchlistSchema.index({ userId: 1, segment: 1 }, { unique: true });

const Watchlist = mongoose.model('Watchlist', watchlistSchema);

export default Watchlist;
