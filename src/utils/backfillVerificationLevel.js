// ============================================================
//  Backfill script - computes verificationLevel for every existing
//  member from their already-reviewed documents (needed once, since
//  the tiered verification system is new and isVerified used to be
//  set manually by an admin).
//  Usage: npm run backfill:verification
// ============================================================
import { connectDB, disconnectDB } from '../config/db.js';
import User from '../models/User.js';
import { recomputeVerification } from './verification.js';

async function run() {
  await connectDB();

  const users = await User.find({ role: 'member' }).select('_id isVerified');
  console.log(`Recomputing verification tier for ${users.length} member(s)...`);

  let upgraded = 0;
  let downgraded = 0;
  for (const u of users) {
    const wasVerified = u.isVerified;
    // eslint-disable-next-line no-await-in-loop
    const result = await recomputeVerification(u._id);
    if (!result) continue;
    const isVerifiedNow = result.level !== 'none';
    if (isVerifiedNow && !wasVerified) upgraded += 1;
    else if (!isVerifiedNow && wasVerified) downgraded += 1;
  }

  console.log(`Done. ${upgraded} member(s) tiered up, ${downgraded} lost their badge (missing required documents - most likely the new mandatory live selfie).`);
  await disconnectDB();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
