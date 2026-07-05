// ============================================================
//  Auth controller — register, login, refresh, logout, me,
//  forgot/reset password. Dual JWT with rotating refresh tokens.
// ============================================================
import crypto from 'crypto';
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import User from '../models/User.js';
import { issueTokenPair, verifyRefreshToken, sha256 } from '../utils/jwt.js';
import { saveUpload } from '../utils/uploadStore.js';
import { toBool, parseArray } from '../utils/parse.js';
import { notify } from '../utils/notify.js';
import { sendWelcomeEmail, sendPasswordResetEmail } from '../utils/email.js';
import { env } from '../config/env.js';

export const register = asyncHandler(async (req, res) => {
  const b = req.body;
  const email = String(b.email).toLowerCase().trim();

  const existing = await User.findOne({ $or: [{ email }, { mobile: b.mobile }] });
  if (existing) throw ApiError.conflict('An account with that email or mobile already exists');

  const user = new User({
    fullName: (b.fullName && String(b.fullName).trim()) || email.split('@')[0],
    email,
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

  const pair = issueTokenPair(user);
  user.refreshTokenHash = pair.refreshTokenHash;
  await user.save();

  notify(user._id, {
    type: 'welcome',
    title: 'Welcome to SastiTripWale! 🔥',
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

  // Always 200 — anti-enumeration.
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
