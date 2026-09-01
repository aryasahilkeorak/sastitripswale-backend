import mongoose from 'mongoose';
import { PLAN_KEYS } from '../utils/plans.js';

const { Schema } = mongoose;

// A promo video the influencer has linked (YouTube or Instagram) - shown as
// an embedded iframe on their own dashboard tab.
const videoSchema = new Schema(
  {
    url: { type: String, required: true, trim: true, maxlength: 500 },
    platform: { type: String, enum: ['youtube', 'instagram'], required: true },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

// A member's application/status in the Influencer/Promoter program. Once
// approved, the linked Coupon (Coupon.influencer -> this doc) carries the
// customer-facing discount; `commissionPct`/`commissionPcts` here are the
// influencer's own cut, kept separate since they must never be exposed
// publicly.
const influencerSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    appliedReason: { type: String, trim: true, maxlength: 1000 },
    // Reach proof collected at application time, so admin has enough to set
    // a fair commission % without back-and-forth.
    totalFollowers: { type: Number, min: 0, default: 0 },
    avgReelViews: { type: Number, min: 0, default: 0 },
    // Screenshot of their platform's analytics dashboard showing reach over
    // the last 6 months - an Upload doc URL, same as any other image field.
    dashboardScreenshotUrl: { type: String, default: '' },
    socialLinks: {
      instagram: { type: String, trim: true, default: '' },
      facebook: { type: String, trim: true, default: '' },
      twitter: { type: String, trim: true, default: '' },
      youtube: { type: String, trim: true, default: '' },
      linkedin: { type: String, trim: true, default: '' },
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    // The headline figure shown in public/summary views (the highest of
    // `commissionPcts`' per-plan values) - actual commission accrual always
    // resolves through `commissionPcts` first, see
    // paymentController.activateMembership().
    commissionPct: { type: Number, min: 0, max: 100, default: 0 },
    // Per-plan commission %, e.g. a bigger cut on the ₹499 plan than the
    // ₹199 one - policy caps each 10-30% (enforced in adminController.js).
    commissionPcts: {
      type: new Schema(
        PLAN_KEYS.reduce((paths, key) => {
          paths[key] = { type: Number, min: 0, max: 100 };
          return paths;
        }, {}),
        { _id: false }
      ),
    },
    totalEarnedPaise: { type: Number, default: 0, min: 0 },
    videos: { type: [videoSchema], default: [] },
  },
  { timestamps: true }
);

const Influencer = mongoose.model('Influencer', influencerSchema);
export default Influencer;
