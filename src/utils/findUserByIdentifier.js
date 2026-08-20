import mongoose from 'mongoose';
import User from '../models/User.js';

const isId = (v) => mongoose.isValidObjectId(v);

// Resolve a user from a single free-form identifier: exact User ID,
// @username, mobile number, or email - tried in that order. Shared by chat
// groups and travel clubs so "add a member" works the same everywhere.
export async function findUserByIdentifier(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (isId(v)) {
    const byId = await User.findById(v);
    if (byId) return byId;
  }
  const byUsername = await User.findOne({ username: v.toLowerCase().replace(/^@/, '') });
  if (byUsername) return byUsername;
  const byMobile = await User.findOne({ mobile: v });
  if (byMobile) return byMobile;
  if (v.includes('@')) {
    const byEmail = await User.findOne({ email: v.toLowerCase() });
    if (byEmail) return byEmail;
  }
  return null;
}

export default findUserByIdentifier;
