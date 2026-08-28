// ============================================================
//  Setting - a single global config document (key: 'global').
//  Add new site-wide flags here as needed.
// ============================================================
import mongoose from 'mongoose';

const { Schema } = mongoose;

// One tier of the referral reward ladder - e.g. { from: 1, to: 5, rewardPct: 50 }
// pays the referrer 50% of what the company actually collects (the referred
// member's discounted payment amount) for their 1st through 5th
// successfully-converted referral. `to: null` means "and every one after
// this, forever" (the last/open-ended tier).
const referralTierSchema = new Schema(
  {
    from: { type: Number, required: true, min: 1 },
    to: { type: Number, default: null, min: 1 },
    rewardPct: { type: Number, required: true, min: 0, max: 100 },
  },
  { _id: false }
);

const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    referralEnabled: { type: Boolean, default: true },
    // Automatic discount off the membership price for a new member's first
    // payment, applied when they signed up with someone else's referral
    // code (see paymentController.referralDiscountFor). One flat percentage
    // for everyone, regardless of who referred them or how many referrals
    // that referrer already has.
    referralDiscountPct: { type: Number, default: 10, min: 0, max: 100 },
    // Credited to the referrer's wallet once their referred member's
    // membership is actually paid (not at bare signup, to avoid rewarding
    // referrals that never convert) - a percentage of that payment (what
    // the company actually collected, after the discount above), not a
    // flat amount. The tier depends on which position the referrer's Nth
    // converted referral falls into - see User.referralRewardsGiven and
    // paymentController.activateMembership().
    referralTiers: {
      type: [referralTierSchema],
      default: () => [
        { from: 1, to: 5, rewardPct: 50 },
        { from: 6, to: 10, rewardPct: 30 },
        { from: 11, to: null, rewardPct: 20 },
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
