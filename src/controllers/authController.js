// ============================================================
//  Auth controller - register, login, refresh, logout, me,
//  forgot/reset password. Dual JWT with rotating refresh tokens.
// ============================================================
import crypto from 'crypto';
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import User from '../models/User.js';
import Setting from '../models/Setting.js';
import Follow from '../models/Follow.js';
import { issueTokenPair, verifyRefreshToken, sha256, signTwoFactorToken, verifyTwoFactorToken } from '../utils/jwt.js';
import { saveUpload } from '../utils/uploadStore.js';
import { toBool, parseArray } from '../utils/parse.js';
import { notify } from '../utils/notify.js';
import { sendWelcomeEmail, sendPasswordResetEmail } from '../utils/email.js';
import { env } from '../config/env.js';
import { assignReferralCode } from '../utils/referral.js';
import { USERNAME_RX } from '../utils/username.js';

export const register = asyncHandler(async (req, res) => {
  const b = req.body;
  const email = String(b.email).toLowerCase().trim();
  const username = String(b.username || '').toLowerCase().trim();
  if (!USERNAME_RX.test(username)) {
    throw ApiError.badRequest('Username must be 3-30 characters: lowercase letters, numbers, "_" or "." only');
  }

  const existing = await User.findOne({ $or: [{ email }, { mobile: b.mobile }, { username }] });
  if (existing) {
    throw ApiError.conflict(
      existing.username === username ? 'That username is already taken' : 'An account with that email or mobile already exists'
    );
  }

  const user = new User({
    fullName: (b.fullName && String(b.fullName).trim()) || email.split('@')[0],
    email,
    username,
    mobile: b.mobile,
    whatsapp: b.whatsapp,
    gender: b.gender,
    coTravelerPreference: b.coTravelerPreference,
    age: b.age ? Number(b.age) : undefined,
    city: b.city,
    state: b.state,
    profession: b.profession,
    bio: b.bio,
    instagram: b.instagram,
    emergencyContact: b.emergencyContact,
    hasVehicle: toBool(b.hasVehicle),
    vehicleType: b.vehicleType,
    vehicleModel: b.vehicleModel,
    drinks: b.drinks || 'No',
    smokes: b.smokes || 'No',
    travelInterests: parseArray(b.travelInterests),
  });
  await user.setPassword(b.password);
  if (req.file) user.avatarUrl = await saveUpload(req.file, { owner: user._id, kind: 'avatar' });
  await assignReferralCode(user);

  // Credit the referrer only while referrals are globally enabled - an
  // incoming code is otherwise ignored (not an error) so old shared links
  // don't break signup while the feature is paused.
  const submittedCode = b.referralCode ? String(b.referralCode).toUpperCase().trim() : '';
  if (submittedCode) {
    const settings = await Setting.getSingleton();
    if (settings.referralEnabled) {
      const referrer = await User.findOne({ referralCode: submittedCode });
      if (referrer) {
        user.referredBy = referrer._id;
        referrer.referralCount += 1;
        await referrer.save();
      }
    }
  }

  const pair = issueTokenPair(user);
  user.refreshTokenHash = pair.refreshTokenHash;
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
    message: 'Complete your membership and start exploring trips.',
  });
  sendWelcomeEmail(user).catch(() => {});

  res.status(201).json({
    success: true,
    user: user.toPrivateJSON(),
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
  });
});

export const login = asyncHandler(async (req, res) => {
  const email = String(req.body.email).toLowerCase().trim();
  const user = await User.findOne({ email }).select('+passwordHash +refreshTokenHash');

  // Generic message to avoid user enumeration.
  if (!user) throw ApiError.unauthorized('Invalid email or password');
  const ok = await user.comparePassword(req.body.password);
  if (!ok) throw ApiError.unauthorized('Invalid email or password');
  if (!user.isActive) throw ApiError.forbidden('Your account has been suspended');

  // Admin/superadmin with 2FA (PIN) enabled - password alone isn't enough.
  // Hold off on issuing real tokens until /auth/verify-2fa confirms the PIN.
  if (user.twoFactorEnabled && user.role !== 'member') {
    return res.json({
      success: true,
      twoFactorRequired: true,
      twoFactorToken: signTwoFactorToken(user),
    });
  }

  const pair = issueTokenPair(user);
  user.refreshTokenHash = pair.refreshTokenHash;
  await user.save();

  res.json({
    success: true,
    user: user.toPrivateJSON(),
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
  });
});

// POST /auth/verify-2fa - exchanges a password-verified pending token + the
// admin's 6-digit PIN for a real token pair.
export const verifyTwoFactor = asyncHandler(async (req, res) => {
  const { twoFactorToken, pin } = req.body;
  if (!twoFactorToken || !pin) throw ApiError.badRequest('PIN required');

  let payload;
  try {
    payload = verifyTwoFactorToken(twoFactorToken);
  } catch {
    throw ApiError.unauthorized('2FA session expired, please log in again');
  }

  const user = await User.findById(payload.sub).select('+mpinHash +refreshTokenHash');
  if (!user || !user.isActive || !user.twoFactorEnabled) {
    throw ApiError.unauthorized('2FA session expired, please log in again');
  }

  const ok = await user.compareMpin(String(pin));
  if (!ok) throw ApiError.unauthorized('Incorrect PIN');

  const pair = issueTokenPair(user);
  user.refreshTokenHash = pair.refreshTokenHash;
  await user.save();

  res.json({
    success: true,
    user: user.toPrivateJSON(),
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
  });
});

// POST /auth/2fa/setup - enable 2FA / (re)set the PIN for the logged-in
// admin. Re-confirms the current password so a hijacked-but-unlocked
// session can't silently take over the PIN.
export const setupTwoFactor = asyncHandler(async (req, res) => {
  const { password, pin } = req.body;
  if (!/^[0-9]{6}$/.test(String(pin || ''))) throw ApiError.badRequest('PIN must be exactly 6 digits');

  const user = await User.findById(req.user._id).select('+passwordHash');
  const ok = await user.comparePassword(password);
  if (!ok) throw ApiError.unauthorized('Current password is incorrect');

  await user.setMpin(String(pin));
  user.twoFactorEnabled = true;
  await user.save();
  res.json({ success: true, message: 'Two-factor authentication enabled', user: user.toPrivateJSON() });
});

// POST /auth/2fa/disable
export const disableTwoFactor = asyncHandler(async (req, res) => {
  const { password } = req.body;
  const user = await User.findById(req.user._id).select('+passwordHash');
  const ok = await user.comparePassword(password);
  if (!ok) throw ApiError.unauthorized('Current password is incorrect');

  user.twoFactorEnabled = false;
  user.mpinHash = undefined;
  await user.save();
  res.json({ success: true, message: 'Two-factor authentication disabled', user: user.toPrivateJSON() });
});

export const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw ApiError.unauthorized('Refresh token required');

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized('Invalid or expired session');
  }

  const user = await User.findById(payload.sub).select('+refreshTokenHash');
  if (!user || !user.isActive || !user.refreshTokenHash) {
    throw ApiError.unauthorized('Session expired, please log in again');
  }
  // Constant-time compare of stored hash.
  const submitted = sha256(refreshToken);
  const a = Buffer.from(user.refreshTokenHash);
  const c = Buffer.from(submitted);
  if (a.length !== c.length || !crypto.timingSafeEqual(a, c)) {
    // Token reuse / mismatch → revoke everything.
    user.refreshTokenHash = undefined;
    await user.save();
    throw ApiError.unauthorized('Session revoked, please log in again');
  }

  const pair = issueTokenPair(user);
  user.refreshTokenHash = pair.refreshTokenHash;
  await user.save();

  res.json({ success: true, accessToken: pair.accessToken, refreshToken: pair.refreshToken });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    throw ApiError.badRequest('Current and new password are required');
  }
  if (String(newPassword).length < 6) {
    throw ApiError.badRequest('New password must be at least 6 characters');
  }

  const user = await User.findById(req.user._id).select('+passwordHash');
  const ok = await user.comparePassword(currentPassword);
  if (!ok) throw ApiError.unauthorized('Current password is incorrect');

  await user.setPassword(newPassword);
  await user.save();
  res.json({ success: true, message: 'Password updated' });
});

export const logout = asyncHandler(async (req, res) => {
  req.user.refreshTokenHash = undefined;
  await req.user.save();
  res.json({ success: true, message: 'Logged out' });
});

export const getMe = asyncHandler(async (req, res) => {
  res.json({ success: true, user: req.user.toPrivateJSON() });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const email = String(req.body.email).toLowerCase().trim();
  const user = await User.findOne({ email });

  if (user) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    user.resetTokenHash = sha256(rawToken);
    user.resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();
    const resetUrl = `${env.frontendUrls[0]}/reset-password?token=${rawToken}`;
    sendPasswordResetEmail(user, resetUrl).catch(() => {});
  }

  // Always 200 - anti-enumeration.
  res.json({
    success: true,
    message: 'If an account exists for that email, a reset link has been sent.',
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  const hash = sha256(token);
  const user = await User.findOne({
    resetTokenHash: hash,
    resetTokenExpires: { $gt: new Date() },
  }).select('+resetTokenHash +resetTokenExpires');

  if (!user) throw ApiError.badRequest('Invalid or expired reset link');

  await user.setPassword(password);
  user.resetTokenHash = undefined;
  user.resetTokenExpires = undefined;
  user.refreshTokenHash = undefined; // sign out everywhere
  await user.save();

  res.json({ success: true, message: 'Password updated. Please log in.' });
});
