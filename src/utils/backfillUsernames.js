import mongoose from 'mongoose';
import { env } from '../config/env.js';
import User from '../models/User.js';
import { USERNAME_RX, slugifyName } from './username.js';

await mongoose.connect(env.mongoUri);

const users = await User.find({
  $or: [{ username: { $exists: false } }, { username: null }, { username: '' }],
}).select('_id fullName mobile username');

console.log(`Users missing a username: ${users.length}`);

let assigned = 0;
for (const user of users) {
  const base = slugifyName(user.fullName);
  const digits = String(user.mobile || '').replace(/\D/g, '');

  let candidate = null;
  for (let len = 2; len <= Math.max(5, digits.length); len++) {
    const suffix = digits.slice(-len) || String(len);
    const attempt = `${base}${suffix}`.slice(0, 30);
    if (!USERNAME_RX.test(attempt)) continue;
    const taken = await User.findOne({ username: attempt, _id: { $ne: user._id } }).select('_id');
    if (!taken) {
      candidate = attempt;
      break;
    }
  }
  // Astronomically unlikely fallback - every 2-len-of-mobile digit suffix collided.
  if (!candidate) {
    let n = 1;
    while (!candidate) {
      const attempt = `${base}${n}`.slice(0, 30);
      const taken = await User.findOne({ username: attempt, _id: { $ne: user._id } }).select('_id');
      if (!taken) candidate = attempt;
      n++;
    }
  }

  user.username = candidate;
  await user.save();
  assigned++;
  console.log(`${user.fullName} (${user.mobile}) -> ${candidate}`);
}

console.log(`\nAssigned usernames to ${assigned} users.`);

const stillMissing = await User.countDocuments({
  $or: [{ username: { $exists: false } }, { username: null }, { username: '' }],
});
console.log('Still missing a username (should be 0):', stillMissing);

await mongoose.disconnect();
