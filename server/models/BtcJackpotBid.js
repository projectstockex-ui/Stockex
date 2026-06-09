import mongoose from 'mongoose';

/**
 * BTC Jackpot — one ticket per bid (one predicted BTC USD price each).
 * User can edit `predictedBtc` while status === 'pending', cannot cancel.
 */
const btcJackpotBidSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },

    /**  staked for this ticket (usually 1 × ticketPrice; supports multi-ticket if config opens it later) */
    amount: { type: Number, required: true, min: 1 },
    ticketCount: { type: Number, default: 1, min: 1 },
    ticketPrice: { type: Number, required: true }, // /ticket at bid time (audit)

    /** User's predicted BTC USD spot for this ticket — ranking key */
    predictedBtc: { type: Number, required: true, min: 1 },

    /** IST calendar day YYYY-MM-DD the bid belongs to */
    betDate: { type: String, required: true },
    /** HH:mm:ss IST at creation (audit + UI) */
    placedAtIst: { type: String, default: null },

    status: {
      type: String,
      enum: ['pending', 'won', 'lost', 'voided'],
      default: 'pending',
    },

    rank: { type: Number, default: null },
    isTied: { type: Boolean, default: false },
    tiedGroupSize: { type: Number, default: 1 },

    grossPrize: { type: Number, default: 0 },
    prize: { type: Number, default: 0 },
    brokerageDeducted: { type: Number, default: 0 },

    winnerBrokerageDistribution: {
      subBroker: {
        id: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
        name: String,
        amount: { type: Number, default: 0 },
      },
      broker: {
        id: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
        name: String,
        amount: { type: Number, default: 0 },
      },
      admin: {
        id: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
        name: String,
        amount: { type: Number, default: 0 },
      },
    },

    resultDeclaredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

btcJackpotBidSchema.index({ user: 1, betDate: 1 });
btcJackpotBidSchema.index({ betDate: 1, status: 1 });
btcJackpotBidSchema.index({ betDate: 1, predictedBtc: 1 });

const BtcJackpotBid = mongoose.model('BtcJackpotBid', btcJackpotBidSchema);
export default BtcJackpotBid;
