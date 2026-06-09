import mongoose from 'mongoose';

/** Initial refundable security deposited when a broker/sub-broker is created. */
const refundableSecurityDepositSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
    adminCode: { type: String, required: true, index: true },
    brokerName: { type: String, default: '' },
    role: { type: String, enum: ['BROKER', 'SUB_BROKER'], required: true },
    cityCode: { type: String, default: '' },
    cityName: { type: String, default: '' },
    amount: { type: Number, required: true, min: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

export default mongoose.model('RefundableSecurityDeposit', refundableSecurityDepositSchema);
