import crypto from 'crypto';
import User from '../models/User.js';

// 8 uppercase hex chars — short enough to share, plenty of space to avoid collisions.
export function generateReferralCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

// Assigns a unique referral code to `user` (mutates in place, does not save),
// retrying on the rare collision. Shared by register and the backfill script.
export async function assignReferralCode(user) {
  for (let i = 0; i < 5; i++) {
    const code = generateReferralCode();
    // eslint-disable-next-line no-await-in-loop
    const exists = await User.exists({ referralCode: code });
    if (!exists) {
      user.referralCode = code;
      return;
    }
  }
  throw new Error('Could not generate a unique referral code');
}
