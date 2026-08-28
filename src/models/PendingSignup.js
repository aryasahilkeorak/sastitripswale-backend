// ============================================================
//  PendingSignup - a signup that hasn't paid yet.
//  Holds everything needed to create the real User once a
//  membership/Trip Pass payment actually succeeds (see
//  utils/pendingSignup.js and paymentController's create-order/
//  verify/confirm-test/webhook). Nothing here reserves a
//  username/email/mobile against the real Users collection, so
//  an abandoned attempt never blocks anyone - including the same
//  person retrying with the same details - it just expires away.
// ============================================================
import mongoose from 'mongoose';
import crypto from 'crypto';

const { Schema } = mongoose;

const pendingSignupSchema = new Schema(
  {
    token: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    username: { type: String, required: true, lowercase: true, trim: true },
    mobile: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    gender: { type: String, default: '' },
    coTravelerPreference: { type: String, default: '' },
    referralCode: { type: String, default: '' },
  },
  { timestamps: true }
);

// Auto-expire an abandoned signup after 2 hours - plenty of time to finish
// checkout, short enough that this is never a real "reservation" the way
// an actual User account would be.
pendingSignupSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2 * 60 * 60 });

pendingSignupSchema.statics.generateToken = function generateToken() {
  return crypto.randomBytes(32).toString('hex');
};

export default mongoose.model('PendingSignup', pendingSignupSchema);
