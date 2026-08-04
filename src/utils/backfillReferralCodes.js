// ============================================================
//  Backfill script — assigns a referral code to every existing
//  user who doesn't already have one (accounts created before
//  the referral system existed).
//  Usage: npm run backfill:referrals
// ============================================================
import { connectDB, disconnectDB } from '../config/db.js';
import User from '../models/User.js';
import { assignReferralCode } from './referral.js';

async function run() {
  await connectDB();

  const users = await User.find({
    $or: [{ referralCode: { $exists: false } }, { referralCode: null }, { referralCode: '' }],
  });
  console.log(`Found ${users.length} user(s) without a referral code.`);

  let updated = 0;
  for (const user of users) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await assignReferralCode(user);
      // eslint-disable-next-line no-await-in-loop
      await user.save();
      updated += 1;
    } catch (err) {
      console.warn(`  ⚠️  Skipped ${user.email}: ${err.message}`);
    }
  }

  console.log(`Assigned referral codes to ${updated}/${users.length} user(s).`);
  await disconnectDB();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
