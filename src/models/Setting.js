// ============================================================
//  Setting - a single global config document (key: 'global').
//  Add new site-wide flags here as needed.
// ============================================================
import mongoose from 'mongoose';
import { PLAN_KEYS } from '../utils/plans.js';

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

// One discount percentage per membership plan (utils/plans.js PLAN_KEYS,
// e.g. 'single_6m', 'both_1y') - built dynamically off PLAN_KEYS so the two
// stay in sync.
const referralDiscountsSchema = new Schema(
  PLAN_KEYS.reduce((paths, key) => {
    paths[key] = { type: Number, default: 10, min: 0, max: 100 };
    return paths;
  }, {}),
  { _id: false }
);

const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    referralEnabled: { type: Boolean, default: true },
    // Automatic discount off the membership price for a new member's first
    // payment, applied when they signed up with someone else's referral
    // code (see paymentController.referralDiscountFor) - a separate
    // percentage per membership plan, so e.g. the ₹499 plan can carry a
    // different discount than the ₹199 one. Same for everyone regardless of
    // who referred them or how many referrals that referrer already has.
    referralDiscounts: { type: referralDiscountsSchema, default: () => ({}) },
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

// Set once a legacy single-percentage document (pre-per-plan discounts) has
// been migrated, so the extra raw-collection check below only runs once per
// server process rather than on every call.
let referralDiscountsMigrated = false;

settingSchema.statics.getSingleton = async function getSingleton() {
  let doc = await this.findOne({ key: 'global' });
  if (!doc) doc = await this.create({ key: 'global' });

  if (!referralDiscountsMigrated) {
    // Carry forward an old flat `referralDiscountPct` (from before discounts
    // were per-plan) as the starting value for every plan, so upgrading
    // doesn't silently reset everyone's discount back to the schema default.
    const raw = await this.collection.findOne(
      { key: 'global' },
      { projection: { referralDiscounts: 1, referralDiscountPct: 1 } }
    );
    if (raw && raw.referralDiscounts === undefined && typeof raw.referralDiscountPct === 'number') {
      const legacyPct = raw.referralDiscountPct;
      doc.referralDiscounts = PLAN_KEYS.reduce((acc, key) => {
        acc[key] = legacyPct;
        return acc;
      }, {});
      await doc.save();
    }
    referralDiscountsMigrated = true;
  }

  return doc;
};

const Setting = mongoose.model('Setting', settingSchema);
export default Setting;
