// ============================================================
//  Setting - a single global config document (key: 'global').
//  Add new site-wide flags here as needed.
// ============================================================
import mongoose from 'mongoose';

const { Schema } = mongoose;

// One tier of the referral reward ladder - e.g. { from: 1, to: 5, amountPaise: 5000 }
// pays ₹50 for the referrer's 1st through 5th successfully-converted referral.
// `to: null` means "and every one after this, forever" (the last/open-ended tier).
const referralTierSchema = new Schema(
  {
    from: { type: Number, required: true, min: 1 },
    to: { type: Number, default: null, min: 1 },
    amountPaise: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    referralEnabled: { type: Boolean, default: true },
    // Credited to the referrer's wallet once their referred member's
    // membership is actually paid (not at bare signup, to avoid rewarding
    // referrals that never convert). The reward amount depends on which
    // tier the referrer's Nth converted referral falls into - see
    // User.referralRewardsGiven and paymentController.activateMembership().
    referralTiers: {
      type: [referralTierSchema],
      default: () => [
        { from: 1, to: 5, amountPaise: 5000 },
        { from: 6, to: 10, amountPaise: 3000 },
        { from: 11, to: null, amountPaise: 2000 },
      ],
    },
  },
  { timestamps: true }
);

settingSchema.statics.getSingleton = async function getSingleton() {
  let doc = await this.findOne({ key: 'global' });
  if (!doc) doc = await this.create({ key: 'global' });
  return doc;
};

const Setting = mongoose.model('Setting', settingSchema);
export default Setting;
