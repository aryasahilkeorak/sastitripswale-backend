// ============================================================
//  Backfill script - corrects the invalid combination where a
//  member's co-traveler preference conflicts with their own
//  gender (e.g. a Male member set to "female"-only). Widens
//  those accounts to "both" so they're no longer excluded from
//  a group that matches their own gender.
//  Usage: npm run backfill:cotraveler
// ============================================================
import { connectDB, disconnectDB } from '../config/db.js';
import User from '../models/User.js';

async function run() {
  await connectDB();

  const result = await User.updateMany(
    {
      $or: [
        { gender: 'Male', coTravelerPreference: 'female' },
        { gender: 'Female', coTravelerPreference: 'male' },
      ],
    },
    { $set: { coTravelerPreference: 'both' } }
  );

  console.log(`Fixed ${result.modifiedCount} user(s) with a gender-conflicting co-traveler preference.`);
  await disconnectDB();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
