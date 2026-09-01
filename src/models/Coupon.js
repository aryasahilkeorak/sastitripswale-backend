import mongoose from 'mongoose';
import { PLAN_KEYS } from '../utils/plans.js';

const { Schema } = mongoose;

// Per-plan override of `discountPct` below - only ever set for an
// influencer's coupon (see `influencer` field), so a promoter's code can be
// worth more on a pricier plan than a cheaper one. Left unset entirely for
// plain admin-created coupons, which always use the flat `discountPct`.
const discountPctsSchema = new Schema(
  PLAN_KEYS.reduce((paths, key) => {
    paths[key] = { type: Number, min: 0, max: 100 };
    return paths;
  }, {}),
  { _id: false }
);

const couponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    // For a plain coupon, the actual discount. For an influencer's coupon,
    // the headline figure shown in public/summary views (the highest of
    // `discountPcts`' per-plan values) - the plan actually being bought
    // always resolves through `discountPcts` first, see
    // paymentController.couponDiscountPct().
    discountPct: { type: Number, default: 0, min: 0, max: 100 },
    discountPcts: { type: discountPctsSchema },
    discountAmt: { type: Number, default: 0, min: 0 }, // fixed rupee discount
    maxUses: { type: Number, default: 1000, min: 0 },
    usedCount: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    expiresAt: { type: Date },
    // Set only for an approved influencer's personal coupon - unset for
    // plain admin-created coupons. Drives commission accrual in
    // paymentController.js's activateMembership().
    influencer: { type: Schema.Types.ObjectId, ref: 'Influencer' },
  },
  { timestamps: true }
);

couponSchema.methods.isUsable = function isUsable() {
  if (!this.isActive) return false;
  if (this.maxUses > 0 && this.usedCount >= this.maxUses) return false;
  if (this.expiresAt && this.expiresAt.getTime() < Date.now()) return false;
  return true;
};

const Coupon = mongoose.model('Coupon', couponSchema);
export default Coupon;
