import mongoose from 'mongoose';

/** Initial refundable security deposited when a broker/sub-broker is created. */
const refundableSecurityDepositSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
    adminCode: { type: String, required: true, index: true },
    brokerName: { type: String, default: '' },
    role: { type: String, enum: ['BROKER', 'SUB_BROKER'], required: true },
    stateName: { type: String, default: '' },
    stateCode: { type: String, default: '' },
    cityName: { type: String, default: '' },
    cityCode: { type: String, default: '' },
    areaName: { type: String, default: '' },
    areaPincode: { type: String, default: '' },
    amount: { type: Number, required: true, min: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

export default mongoose.model('RefundableSecurityDeposit', refundableSecurityDepositSchema);
