import mongoose from 'mongoose';

const { Schema } = mongoose;

// One ledger row per payment made with an influencer's coupon - created in
// paymentController.js's activateMembership(), alongside the existing
// Coupon.usedCount increment. Ledger only - no automated payout.
const commissionSchema = new Schema(
  {
    influencer: { type: Schema.Types.ObjectId, ref: 'Influencer', required: true, index: true },
    payment: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amountPaise: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['pending', 'paid'], default: 'pending', index: true },
  },
  { timestamps: true }
);

const Commission = mongoose.model('Commission', commissionSchema);
export default Commission;
