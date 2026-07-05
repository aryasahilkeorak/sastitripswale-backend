import mongoose from 'mongoose';

const { Schema } = mongoose;

const paymentSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 0 }, // in paise (₹1 = 100 paise)
    currency: { type: String, default: 'INR' },
    purpose: { type: String, default: 'membership' },
    status: {
      type: String,
      enum: ['pending', 'success', 'failed'],
      default: 'pending',
      index: true,
    },
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String },
    couponUsed: { type: String },
    // Membership plan this payment activates.
    planDuration: { type: String, enum: ['6m', '1y', ''], default: '' },
    planPreference: { type: String, enum: ['male', 'female', 'both', ''], default: '' },
  },
  { timestamps: true }
);

const Payment = mongoose.model('Payment', paymentSchema);
export default Payment;
