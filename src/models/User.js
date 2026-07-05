// ============================================================
//  User model — members and admins.
//  Sensitive fields (passwordHash, tokens, emergencyContact) use
//  `select: false` so they are never returned unless explicitly asked.
// ============================================================
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { Schema } = mongoose;

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

    passwordHash: { type: String, required: true, select: false },

    role: { type: String, enum: ['member', 'admin', 'superadmin'], default: 'member', index: true },

    gender: { type: String, enum: ['Male', 'Female', 'Prefer not to say', ''], default: '' },
    age: { type: Number, min: 18, max: 100 },
    city: { type: String, trim: true, maxlength: 80 },
    state: { type: String, trim: true, maxlength: 80 },
    profession: { type: String, trim: true, maxlength: 100 },
    bio: { type: String, maxlength: 1000 },
    avatarUrl: { type: String, default: '' },
    instagram: { type: String, trim: true },

    emergencyContact: { type: String, trim: true, select: false },

    hasVehicle: { type: Boolean, default: false },
    vehicleType: { type: String, enum: ['Bike', 'Car', 'Bus', 'Other', ''], default: '' },
    vehicleModel: { type: String, trim: true, maxlength: 100 },
    travelInterests: { type: [String], default: [] },
    drinks: { type: String, default: 'No' },
    smokes: { type: String, default: 'No' },

    // Who the user wants to travel with (drives membership pricing).
    // 'male' = only male, 'female' = only female, 'both' = male + female.
    coTravelerPreference: { type: String, enum: ['male', 'female', 'both', ''], default: '' },

    isVerified: { type: Boolean, default: false }, // admin sets after doc review
    membershipPaid: { type: Boolean, default: false },
    membershipPaidAt: { type: Date },
    membershipExpiresAt: { type: Date },
    membershipDuration: { type: String, enum: ['6m', '1y', ''], default: '' },

    // Full profile (name, city, interests, vehicle, ID doc) collected AFTER
    // payment. Until complete, the user cannot plan or join trips.
    profileComplete: { type: Boolean, default: false },

    isActive: { type: Boolean, default: true }, // false = banned

    // Security fields — never leaked
    refreshTokenHash: { type: String, select: false },
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
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

// Membership is active if paid and not expired.
userSchema.methods.hasActiveMembership = function hasActiveMembership() {
  if (this.role === 'admin' || this.role === 'superadmin') return true;
  if (!this.membershipPaid) return false;
  if (this.membershipExpiresAt && this.membershipExpiresAt.getTime() < Date.now()) return false;
  return true;
};

// Public projection — safe to send to ANY client (directory listings, etc.)
userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    fullName: this.fullName,
    role: this.role,
    gender: this.gender,
    age: this.age,
    city: this.city,
    state: this.state,
    profession: this.profession,
    bio: this.bio,
    avatarUrl: this.avatarUrl,
    instagram: this.instagram,
    hasVehicle: this.hasVehicle,
    vehicleType: this.vehicleType,
    vehicleModel: this.vehicleModel,
    travelInterests: this.travelInterests,
    coTravelerPreference: this.coTravelerPreference,
    isVerified: this.isVerified,
    createdAt: this.createdAt,
  };
};

// Private projection — safe to send to the OWNER (or admin).
userSchema.methods.toPrivateJSON = function toPrivateJSON() {
  return {
    ...this.toPublicJSON(),
    email: this.email,
    mobile: this.mobile,
    whatsapp: this.whatsapp,
    drinks: this.drinks,
    smokes: this.smokes,
    membershipPaid: this.membershipPaid,
    membershipPaidAt: this.membershipPaidAt,
    membershipExpiresAt: this.membershipExpiresAt,
    membershipDuration: this.membershipDuration,
    membershipActive: this.hasActiveMembership(),
    profileComplete: this.profileComplete,
    isActive: this.isActive,
    updatedAt: this.updatedAt,
  };
};

const User = mongoose.model('User', userSchema);
export default User;
