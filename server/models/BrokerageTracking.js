import mongoose from 'mongoose';

const brokerageTrackingSchema = new mongoose.Schema({
  // User who generated the winning brokerage
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userName: {
    type: String,
    required: true
  },
  userAdminCode: {
    type: String,
    required: true
  },
  
  // Amount details
  amount: {
    type: Number,
    required: true,
    default: 0
  },
  
  // Hierarchy tracking - which admin/broker/subbroker gets this brokerage
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  adminName: {
    type: String,
    required: true
  },
  adminCode: {
    type: String,
    required: true
  },
  adminRole: {
    type: String,
    enum: ['SUPER_ADMIN', 'ADMIN', 'BROKER', 'SUB_BROKER'],
    required: true
  },
  
  // Broker distribution tracking
  brokerShare: {
    type: Number,
    default: 0
  },
  subBrokerShare: {
    type: Number,
    default: 0
  },
  adminShare: {
    type: Number,
    default: 0
  },
  
  // Trade details
  tradeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Trade'
  },
  symbol: {
    type: String
  },
  segment: {
    type: String,
    enum: ['NSE', 'MCX', 'BFO', 'EQ', 'COMEX', 'FOREX', 'GLOBALINDEX']
  },
  
  // Status
  status: {
    type: String,
    enum: ['PENDING', 'DISTRIBUTED', 'FAILED'],
    default: 'PENDING'
  },
  
  // Metadata
  notes: {
    type: String,
    default: ''
  },
  
  createdAt: {
    type: Date,
    default: Date.now
  },
  distributedAt: {
    type: Date
  }
});

// Index for faster queries
brokerageTrackingSchema.index({ user: 1 });
brokerageTrackingSchema.index({ adminId: 1 });
brokerageTrackingSchema.index({ createdAt: -1 });
brokerageTrackingSchema.index({ status: 1 });

export default mongoose.model('BrokerageTracking', brokerageTrackingSchema);
