import mongoose from 'mongoose';
import { env } from '../config/env.js';
import User from '../models/User.js';

await mongoose.connect(env.mongoUri);

const staff = await User.find({ role: { $in: ['admin', 'superadmin'] } });
console.log(`Staff accounts: ${staff.length}`);

let updated = 0;
for (const u of staff) {
  u.membershipPaid = true;
  u.membershipPaidAt = u.membershipPaidAt || u.createdAt || new Date();
  u.membershipDuration = 'lifetime';
  u.membershipExpiresAt = undefined;
  u.profileComplete = true;
  await u.save();
  updated++;
  console.log(`${u.fullName} (${u.role}) -> lifetime paid`);
}

console.log(`\nUpdated ${updated} staff accounts.`);
await mongoose.disconnect();
