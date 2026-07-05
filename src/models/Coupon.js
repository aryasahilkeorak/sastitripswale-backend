import mongoose from 'mongoose';

const { Schema } = mongoose;

const couponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    discountPct: { type: Number, default: 0, min: 0, max: 100 },
    discountAmt: { type: Number, default: 0, min: 0 }, // fixed rupee discount
    maxUses: { type: Number, default: 1000, min: 0 },
    usedCount: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    expiresAt: { type: Date },
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
