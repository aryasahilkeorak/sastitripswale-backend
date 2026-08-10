// ============================================================
//  Referral controller - a member's own code/stats, and the
//  public on/off status the signup form checks before showing
//  the referral-code field.
// ============================================================
import asyncHandler from '../utils/asyncHandler.js';
import User from '../models/User.js';
import Setting from '../models/Setting.js';

export const getStatus = asyncHandler(async (req, res) => {
  const settings = await Setting.getSingleton();
  res.json({ success: true, enabled: settings.referralEnabled });
});

export const getMyReferral = asyncHandler(async (req, res) => {
  const settings = await Setting.getSingleton();
  const referredUsers = await User.find({ referredBy: req.user._id })
    .select('fullName avatarUrl createdAt')
    .sort({ createdAt: -1 });

  res.json({
    success: true,
    enabled: settings.referralEnabled,
    referralCode: req.user.referralCode || '',
    referralCount: req.user.referralCount || 0,
    referredUsers,
  });
});
