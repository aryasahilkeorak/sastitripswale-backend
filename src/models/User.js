// ============================================================
//  User model - members and admins.
//  Sensitive fields (passwordHash, tokens, emergencyContact) use
//  `select: false` so they are never returned unless explicitly asked.
// ============================================================
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { Schema } = mongoose;

// A member can register more than one vehicle (e.g. a bike and a car).
// Each one needs its own RC (front+back, uploaded as Document records
// tagged with this subdocument's _id) before it counts toward the
// "Verified Vehicle Owner" tier.
const vehicleSchema = new Schema(
  {
    vehicleType: { type: String, enum: ['Bike', 'Car', 'Bus', 'Other'], required: true },
    brand: { type: String, trim: true, maxlength: 60 },
    vehicleModel: { type: String, trim: true, maxlength: 100 },
    year: { type: Number, min: 1980, max: 2100 },
    // Real-world km/l (or km/kg for CNG) the owner reports - used to
    // suggest a fuel cost estimate when they host a trip in this vehicle.
    mileageKmpl: { type: Number, min: 0, max: 200 },
    fuelType: { type: String, enum: ['Petrol', 'Diesel', 'CNG', 'Electric', ''], default: '' },
    regNumber: { type: String, trim: true, uppercase: true, maxlength: 20, required: true },
  },
  { timestamps: true }
);

const userSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 150,
    },
    mobile: { type: String, required: true, unique: true, trim: true, maxlength: 15 },
    whatsapp: { type: String, trim: true, maxlength: 15 },
    // Handle used to find/add this member to chat groups (distinct from the
    // Mongo _id shown as "User ID" elsewhere). Optional, set from Settings.
    username: { type: String, trim: true, lowercase: true, maxlength: 30, unique: true, sparse: true },

    passwordHash: { type: String, required: true, select: false },

    role: { type: String, enum: ['member', 'admin', 'superadmin'], default: 'member', index: true },
    // Granular access for a plain 'admin' (ignored for 'superadmin', who
    // always has full access). See utils/permissions.js for the valid keys.
    permissions: {
      type: [String],
      enum: ['users', 'trips', 'coupons', 'reviews', 'messages', 'gallery', 'revenue', 'influencers', 'wallet'],
      default: [],
    },

    gender: { type: String, enum: ['Male', 'Female', 'Prefer not to say', ''], default: '' },
    age: { type: Number, min: 18, max: 100 },
    // Optional - collected only so a member who's lost access to their
    // email can still verify their identity for a password reset (see
    // authController.verifyIdentityForReset). Not shown publicly.
    dateOfBirth: { type: Date, default: null },
    city: { type: String, trim: true, maxlength: 80 },
    state: { type: String, trim: true, maxlength: 80 },
    profession: { type: String, trim: true, maxlength: 100 },
    bio: { type: String, maxlength: 1000 },
    avatarUrl: { type: String, default: '' },
    coverUrl: { type: String, default: '' },
    // Separate photo for admin/superadmin accounts, shown only in the admin
    // panel (AdminLayout header, Admin Profile) and as the public "Founder"
    // photo on the About page - deliberately distinct from `avatarUrl`,
    // which is this person's personal photo everywhere they appear as a
    // regular member (directory, chat, trips). Admin/superadmin only;
    // ignored for plain members. Falls back to `avatarUrl` when unset.
    adminAvatarUrl: { type: String, default: '' },
    // Social handles only (no full URLs) - the frontend prefixes the
    // platform's base URL when rendering a clickable link.
    instagram: { type: String, trim: true },
    facebook: { type: String, trim: true },
    twitter: { type: String, trim: true },
    youtube: { type: String, trim: true },
    linkedin: { type: String, trim: true },

    emergencyContact: { type: String, trim: true, select: false },

    hasVehicle: { type: Boolean, default: false },
    // Kept for backwards compatibility (first/primary vehicle, used by the
    // "Bike/Car Owners" directory filters) - `vehicles` below is the
    // full, multi-vehicle list.
    vehicleType: { type: String, enum: ['Bike', 'Car', 'Bus', 'Other', ''], default: '' },
    vehicleModel: { type: String, trim: true, maxlength: 100 },
    // Real-world mileage/fuel/year for the primary vehicle above - powers an
    // accurate trip fuel-cost suggestion on Plan a Trip instead of a guess
    // from the model name (see suggestMileageForUser on the frontend).
    vehicleYear: { type: Number, min: 1980, max: 2100 },
    mileageKmpl: { type: Number, min: 0, max: 200 },
    fuelType: { type: String, enum: ['Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid', ''], default: '' },
    vehicles: { type: [vehicleSchema], default: [] },
    travelInterests: { type: [String], default: [] },
    // Lifestyle habits - shown on the public profile (like travelInterests)
    // so co-travelers can match on them, e.g. deciding whether a trip/room
    // is a comfortable fit. 'No' is the only value NOT counted as a match.
    drinks: { type: String, enum: ['No', 'Occasionally', 'Yes', ''], default: 'No' },
    smokes: { type: String, enum: ['No', 'Occasionally', 'Yes', ''], default: 'No' },

    // Who the user wants to travel with (drives membership pricing).
    // 'male' = only male, 'female' = only female, 'both' = male + female.
    coTravelerPreference: { type: String, enum: ['male', 'female', 'both', ''], default: '' },

    // Drives whether Couples Mode (partner details, couple trips) is offered.
    relationshipStatus: {
      type: String,
      enum: ['single', 'in_a_relationship', 'married', 'prefer_not_to_say', ''],
      default: '',
    },

    // Collected once (in profile, not per-trip) so a couple's safety info
    // - mobile + gov ID - only ever needs to be uploaded a single time.
    // Only ever exposed to the user themself and to admins.
    partnerMobile: { type: String, trim: true, maxlength: 15 },
    partnerDocUrl: { type: String, default: '' },

    isVerified: { type: Boolean, default: false }, // true whenever verificationLevel !== 'none'
    // Computed automatically from reviewed documents - see utils/verification.js.
    // 'verified' = Aadhaar + PAN + live selfie all verified.
    // 'vehicle_verified' = the above, plus Driving Licence + at least one vehicle's RC.
    verificationLevel: { type: String, enum: ['none', 'verified', 'vehicle_verified'], default: 'none' },
    membershipPaid: { type: Boolean, default: false },
    membershipPaidAt: { type: Date },
    membershipExpiresAt: { type: Date },
    // 'lifetime' - staff (admin/superadmin) accounts, granted on promotion,
    // never expires (membershipExpiresAt stays unset for these).
    membershipDuration: { type: String, enum: ['6m', '1y', 'lifetime', ''], default: '' },
    // Coupon code applied on the payment that (most recently) activated
    // membership - kept on the user itself so admin views don't depend on
    // a Payment record still existing.
    couponUsed: { type: String, trim: true, uppercase: true, default: '' },

    // Trip Pass (pay-per-trip) credits - an alternative to the duration
    // membership above, for members who just want a handful of trips.
    // Two independent pools: hostCredits gates creating a trip, joinCredits
    // gates joining one. Buying a pack tops these up (see utils/plans.js);
    // hasTripHostAccess()/hasTripJoinAccess() below combine these with the
    // duration membership so either kind of plan unlocks trip actions.
    hostCredits: { type: Number, default: 0, min: 0 },
    joinCredits: { type: Number, default: 0, min: 0 },

    // Referral system - every user gets their own code; referredBy/referralCount
    // track who invited whom. See utils/referral.js for code generation.
    referralCode: { type: String, unique: true, sparse: true, uppercase: true, trim: true },
    referredBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    referralCount: { type: Number, default: 0, min: 0 },
    // Set once the referral reward has actually been credited (on the
    // referred member's first paid activation) - prevents re-crediting on
    // membership renewals or repeat payments.
    referralRewardCredited: { type: Boolean, default: false },
    // How many referral rewards THIS user (as a referrer) has been paid so
    // far - determines which tier in Setting.referralTiers their next
    // converted referral falls into (see paymentController.activateMembership).
    referralRewardsGiven: { type: Number, default: 0, min: 0 },
    // Set once THIS user (as a referred member) has actually used their
    // Setting.referralDiscountPct discount on a paid activation - the
    // discount only ever applies to their first membership payment.
    referralDiscountUsed: { type: Boolean, default: false },

    // Wallet - a running balance in paise, credited from referral rewards
    // and (for influencers) commission payouts; debited when a withdrawal
    // request is submitted. See models/Withdrawal.js for the payout flow.
    // "Lifetime earnings" (balance + everything ever withdrawn) is derived
    // on read in walletController - not stored separately.
    walletBalancePaise: { type: Number, default: 0, min: 0 },

    // Full profile (name, city, interests, vehicle, ID doc) collected AFTER
    // payment. Until complete, the user cannot plan or join trips.
    profileComplete: { type: Boolean, default: false },

    isActive: { type: Boolean, default: true }, // false = banned

    // Utility admin/support accounts (e.g. a shared "Support" inbox) that
    // should never appear as a member card - even if role is 'superadmin'
    // and would otherwise show up tagged "Founder" in the directory.
    isServiceAccount: { type: Boolean, default: false },

    // Security fields - never leaked
    refreshTokenHash: { type: String, select: false },
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },

    // 2FA (admin/superadmin only) - a 6-digit PIN acting as the second
    // factor after password. Set via setMpin()/POST /auth/2fa/setup.
    twoFactorEnabled: { type: Boolean, default: false },
    mpinHash: { type: String, select: false },
  },
  { timestamps: true }
);

userSchema.index({ isActive: 1 });
userSchema.index({ city: 1 });

// --- Password helpers ---
userSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(plain, 12);
};

userSchema.methods.comparePassword = async function comparePassword(plain) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(plain, this.passwordHash);
};

// --- 2FA PIN helpers ---
userSchema.methods.setMpin = async function setMpin(pin) {
  this.mpinHash = await bcrypt.hash(pin, 12);
};

userSchema.methods.compareMpin = async function compareMpin(pin) {
  if (!this.mpinHash) return false;
  return bcrypt.compare(pin, this.mpinHash);
};

// Membership is active if paid and not expired.
userSchema.methods.hasActiveMembership = function hasActiveMembership() {
  if (this.role === 'admin' || this.role === 'superadmin') return true;
  if (!this.membershipPaid) return false;
  if (this.membershipExpiresAt && this.membershipExpiresAt.getTime() < Date.now()) return false;
  return true;
};

// Trip-level access: the unlimited duration membership above always
// qualifies; otherwise a Trip Pass member needs an actual credit left in
// the relevant pool. Used to gate hosting/joining independently of each
// other - a user can run out of one and still have the other.
userSchema.methods.hasTripHostAccess = function hasTripHostAccess() {
  return this.hasActiveMembership() || this.hostCredits > 0;
};
userSchema.methods.hasTripJoinAccess = function hasTripJoinAccess() {
  return this.hasActiveMembership() || this.joinCredits > 0;
};

// Public projection - safe to send to ANY client (directory listings, etc.)
userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    fullName: this.fullName,
    username: this.username || '',
    role: this.role,
    gender: this.gender,
    age: this.age,
    city: this.city,
    state: this.state,
    profession: this.profession,
    bio: this.bio,
    avatarUrl: this.avatarUrl,
    coverUrl: this.coverUrl || '',
    adminAvatarUrl: this.adminAvatarUrl || '',
    instagram: this.instagram,
    facebook: this.facebook,
    twitter: this.twitter,
    youtube: this.youtube,
    linkedin: this.linkedin,
    hasVehicle: this.hasVehicle,
    vehicleType: this.vehicleType,
    vehicleModel: this.vehicleModel,
    travelInterests: this.travelInterests,
    // drinks/smokes are deliberately NOT in this projection - they're only
    // safe to reveal to the profile owner or a viewer who shares the same
    // habit (see getMember in memberController.js), never to any client.
    coTravelerPreference: this.coTravelerPreference,
    isVerified: this.isVerified,
    verificationLevel: this.verificationLevel || 'none',
    createdAt: this.createdAt,
  };
};

// Private projection - safe to send to the OWNER (or admin).
userSchema.methods.toPrivateJSON = function toPrivateJSON() {
  return {
    ...this.toPublicJSON(),
    drinks: this.drinks || 'No',
    smokes: this.smokes || 'No',
    email: this.email,
    mobile: this.mobile,
    whatsapp: this.whatsapp,
    dateOfBirth: this.dateOfBirth || null,
    permissions: this.permissions || [],
    membershipPaid: this.membershipPaid,
    membershipPaidAt: this.membershipPaidAt,
    membershipExpiresAt: this.membershipExpiresAt,
    membershipDuration: this.membershipDuration,
    membershipActive: this.hasActiveMembership(),
    couponUsed: this.couponUsed || '',
    hostCredits: this.hostCredits || 0,
    joinCredits: this.joinCredits || 0,
    referralCode: this.referralCode || '',
    referralCount: this.referralCount || 0,
    walletBalancePaise: this.walletBalancePaise || 0,
    relationshipStatus: this.relationshipStatus || '',
    partnerMobile: this.partnerMobile || '',
    partnerDocUrl: this.partnerDocUrl || '',
    vehicleYear: this.vehicleYear || null,
    mileageKmpl: this.mileageKmpl || null,
    fuelType: this.fuelType || '',
    vehicles: this.vehicles || [],
    profileComplete: this.profileComplete,
    isActive: this.isActive,
    twoFactorEnabled: this.twoFactorEnabled || false,
    updatedAt: this.updatedAt,
  };
};

const User = mongoose.model('User', userSchema);
export default User;
