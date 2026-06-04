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
  /** Granular keys: NSEFUT, NSEOPT, MCXFUT, CRYPTOFUT, etc. (see pattiSharingSegments.js) */
  segments: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({}),
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
  next();
});

// Index for faster queries
pattiSharingSchema.index({ broker: 1 });
pattiSharingSchema.index({ isActive: 1 });

const PattiSharing = mongoose.model('PattiSharing', pattiSharingSchema);

export default PattiSharing;
