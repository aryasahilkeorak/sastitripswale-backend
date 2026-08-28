// ============================================================
//  Turns a paid-for pending signup into a real User - the account
//  is only ever created once a membership/Trip Pass payment
//  actually succeeds (see paymentController's completeCheckout).
//  Until then, nothing has claimed the username/email/mobile.
// ============================================================
import User from '../models/User.js';
import Follow from '../models/Follow.js';
import Setting from '../models/Setting.js';
import { assignReferralCode } from './referral.js';
import { notify } from './notify.js';
import { sendWelcomeEmail } from './email.js';

// `snapshot` is Payment.pendingSignup - captured at order-creation time so
// this never depends on the original PendingSignup row still existing (it
// only lives 2 hours; a slow/retried payment could easily outlast that).
export async function materializeAccount(snapshot) {
  // Re-checked now, not just trusted from signup time - another account
  // could have taken the same email/mobile in the meantime. A clashing
  // username is far more likely (two casual attempts, not two real
  // identities) and isn't identity-critical, so it gets a cheap fallback
  // instead of blocking an already-paid-for account.
  const identityTaken = await User.findOne({ $or: [{ email: snapshot.email }, { mobile: snapshot.mobile }] });
  if (identityTaken) {
    throw new Error(
      'An account with this email or mobile number was created elsewhere while your payment was processing. ' +
        'Your payment succeeded - please contact support with your payment reference to get your account set up.'
    );
  }

  let username = snapshot.username;
  if (await User.exists({ username })) {
    username = `${username}${Math.floor(1000 + Math.random() * 9000)}`;
  }

  const user = new User({
    fullName: snapshot.email.split('@')[0],
    email: snapshot.email,
    username,
    mobile: snapshot.mobile,
    gender: snapshot.gender,
    coTravelerPreference: snapshot.coTravelerPreference,
  });
  user.passwordHash = snapshot.passwordHash;
  await assignReferralCode(user);

  // Credit the referrer only while referrals are globally enabled - matches
  // the same check the old, immediate-registration flow used to make here.
  if (snapshot.referralCode) {
    const settings = await Setting.getSingleton();
    if (settings.referralEnabled) {
      const referrer = await User.findOne({ referralCode: snapshot.referralCode });
      if (referrer) {
        user.referredBy = referrer._id;
        referrer.referralCount += 1;
        await referrer.save();
      }
    }
  }

  await user.save();

  // New members auto-follow the platform founder(s) so they see founder
  // updates by default - one-directional, doesn't need the founder's approval.
  const founders = await User.find({ role: 'superadmin' }).select('_id');
  if (founders.length) {
    await Follow.insertMany(
      founders.map((f) => ({ follower: user._id, following: f._id })),
      { ordered: false }
    ).catch(() => {});
  }

  notify(user._id, {
    type: 'welcome',
    title: 'Welcome to SastiTripWale!',
    message: 'Your account is active - complete your profile to start planning and joining trips!',
  });
  sendWelcomeEmail(user).catch(() => {});

  return user;
}
