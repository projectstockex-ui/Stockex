import mongoose from 'mongoose';
import { MARKET_WATCH_SEGMENTS } from '../constants/marketWatchSegments.js';

const groupSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    sortOrder: { type: Number, default: 0 },
    groupType: {
      type: String,
      enum: ['sector', 'index', 'commodity', 'forex', 'crypto', 'custom'],
      default: 'custom',
    },
    /** Canonical underlyings (e.g. HDFCBANK, GOLD) — contracts matched by inferUnderlying */
    underlyings: [{ type: String, trim: true }],
    /** Admin UI: include this group in the grouping list (does not control client trading by itself). */
    enabled: { type: Boolean, default: true },
    /** When false, users cannot open new trades on instruments in this group. */
    allowClientTrading: { type: Boolean, default: true },
    /** When true, orders for instruments in this group must be within day low–high */
    allowWithinLowHigh: { type: Boolean, default: false },
  },
  { _id: true }
);

const segmentGroupingSchema = new mongoose.Schema(
  {
    displaySegment: {
      type: String,
      required: true,
      unique: true,
      enum: MARKET_WATCH_SEGMENTS,
    },
    groups: [groupSchema],
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

segmentGroupingSchema.index({ displaySegment: 1 });

export default mongoose.model('SegmentGrouping', segmentGroupingSchema);
