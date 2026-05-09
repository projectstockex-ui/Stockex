import mongoose from 'mongoose';

const pattiSharingSchema = new mongoose.Schema({
  broker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  brokerPercentage: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
    default: 50
  },
  superAdminPercentage: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
    default: 50
  },
  isActive: {
    type: Boolean,
    default: true
  },
  appliedTo: {
    type: String,
    enum: ['ALL_CLIENTS', 'SPECIFIC_CLIENTS'],
    default: 'ALL_CLIENTS'
  },
  specificClients: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  segments: {
    EQUITY: { enabled: { type: Boolean, default: true }, brokerPercentage: { type: Number, default: 50 } },
    FNO: { enabled: { type: Boolean, default: true }, brokerPercentage: { type: Number, default: 50 } },
    MCX: { enabled: { type: Boolean, default: true }, brokerPercentage: { type: Number, default: 50 } },
    CURRENCY: { enabled: { type: Boolean, default: true }, brokerPercentage: { type: Number, default: 50 } }
  },
  notes: {
    type: String,
    default: ''
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  }
}, {
  timestamps: true
});

// Ensure broker percentage + superAdmin percentage = 100
pattiSharingSchema.pre('save', function(next) {
  this.superAdminPercentage = 100 - this.brokerPercentage;
  
  // Also update segment percentages
  const segments = ['EQUITY', 'FNO', 'MCX', 'CURRENCY'];
  segments.forEach(seg => {
    if (this.segments && this.segments[seg]) {
      this.segments[seg].superAdminPercentage = 100 - (this.segments[seg].brokerPercentage || 50);
    }
  });
  
  next();
});

// Index for faster queries
pattiSharingSchema.index({ broker: 1 });
pattiSharingSchema.index({ isActive: 1 });

const PattiSharing = mongoose.model('PattiSharing', pattiSharingSchema);

export default PattiSharing;
