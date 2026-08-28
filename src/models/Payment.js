import mongoose from 'mongoose';

const { Schema } = mongoose;

// Snapshot of a not-yet-existing member's signup details, embedded on a
// payment created for a brand-new signup (see PendingSignup.js) - captured
// at order-creation time so materializeAccount() never depends on that
// separate, TTL'd row still existing by the time payment actually confirms.
const pendingSignupSnapshotSchema = new Schema(
  {
    email: String,
    username: String,
    mobile: String,
    passwordHash: String,
    gender: String,
    coTravelerPreference: String,
    referralCode: String,
  },
  { _id: false }
);

const paymentSchema = new Schema(
  {
    // Unset until the payment actually succeeds, for a brand-new signup
    // (pendingSignupToken set instead) - see completeCheckout.
    user: { type: Schema.Types.ObjectId, ref: 'User', required: false, index: true },
    // Proves ownership of a not-yet-materialized signup's payment (no JWT
    // exists yet to check req.user against) - see paymentController's
    // assertOwnsPayment. Kept even after the account is created, as a
    // permanent record of which payment brought this member in.
    pendingSignupToken: { type: String, default: '' },
    pendingSignup: { type: pendingSignupSnapshotSchema, default: undefined },
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
    // True when `amount` reflects Setting.referralDiscountPct auto-applied
    // for a referred member's first payment, rather than a real Coupon -
    // see paymentController.referralDiscountFor. Lets activateMembership
    // mark User.referralDiscountUsed only once the payment actually succeeds.
    referralDiscountApplied: { type: Boolean, default: false },
    // Duration-membership plan this payment activates (purpose: 'membership').
    planDuration: { type: String, enum: ['6m', '1y', ''], default: '' },
    planPreference: { type: String, enum: ['male', 'female', 'both', ''], default: '' },
    // Trip Pass tier this payment tops up (purpose: 'trip_pack') - 1/2/3
    // host+join credits per utils/plans.js's TRIP_PACK_PRICES. No coupon
    // is ever accepted for this purpose - see createOrderHandler.
    packTier: { type: Number, enum: [1, 2, 3, null], default: null },
  },
  { timestamps: true }
);

const Payment = mongoose.model('Payment', paymentSchema);
export default Payment;
