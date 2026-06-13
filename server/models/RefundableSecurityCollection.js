import mongoose from 'mongoose';

/** Each time fund transfer clears part of a broker's refundable security. */
const refundableSecurityCollectionSchema = new mongoose.Schema(
  {
    depositId: { type: mongoose.Schema.Types.ObjectId, ref: 'RefundableSecurityDeposit', required: true, index: true },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
    adminCode: { type: String, required: true, index: true },
    brokerName: { type: String, default: '' },
    role: { type: String, enum: ['ADMIN', 'BROKER', 'SUB_BROKER'], required: true },
    amount: { type: Number, required: true, min: 0 },
    transferAmount: { type: Number, default: 0, min: 0 },
    collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
    source: { type: String, default: 'ADMIN_DEPOSIT' },
    description: { type: String, default: '' },
    stateName: { type: String, default: '' },
    stateCode: { type: String, default: '' },
    cityName: { type: String, default: '' },
    cityCode: { type: String, default: '' },
    areaName: { type: String, default: '' },
    areaPincode: { type: String, default: '' },
  },
  { timestamps: true },
);

export default mongoose.model('RefundableSecurityCollection', refundableSecurityCollectionSchema);
