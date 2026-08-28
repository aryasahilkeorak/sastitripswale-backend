// ============================================================
//  Auth controller - register, login, refresh, logout, me,
//  forgot/reset password. Dual JWT with rotating refresh tokens.
// ============================================================
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import User from '../models/User.js';
import PendingSignup from '../models/PendingSignup.js';
import { issueTokenPair, verifyRefreshToken, sha256, signTwoFactorToken, verifyTwoFactorToken } from '../utils/jwt.js';
import { sendPasswordResetEmail } from '../utils/email.js';
import { env } from '../config/env.js';
import { USERNAME_RX } from '../utils/username.js';

// GET /auth/check-username?username=xxx - live availability check for the
// signup form (Instagram-style) and the username field in Edit Profile.
// Public/unauthenticated - deliberately no membership/login gate, since
// this runs while someone is still filling out the signup form.
export const checkUsername = asyncHandler(async (req, res) => {
  const username = String(req.query.username || '').toLowerCase().trim();
  if (!username) return res.json({ success: true, available: false, reason: 'empty' });
  if (!USERNAME_RX.test(username)) {
    return res.json({ success: true, available: false, reason: 'invalid' });
  }
  const taken = await User.exists({ username });
  res.json({ success: true, available: !taken, reason: taken ? 'taken' : null });
});

// POST /auth/register - the real User account is NOT created here. It's
// only ever created once a membership/Trip Pass payment actually succeeds
// (see paymentController's completeCheckout / utils/pendingSignup.js), so
// an abandoned signup never permanently claims a username, email, or
// mobile number - not even against a repeat attempt by the same person.
// This just validates the details, hashes the password, and hands back a
// short-lived pendingToken the client carries through the plan/payment
// step.
export const register = asyncHandler(async (req, res) => {
  const b = req.body;
  const email = String(b.email).toLowerCase().trim();
  const username = String(b.username || '').toLowerCase().trim();
  if (!USERNAME_RX.test(username)) {
    throw ApiError.badRequest('Username must be 3-30 characters: lowercase letters, numbers, "_" or "." only');
  }

  // Only checked against REAL accounts - a still-unpaid pending signup
  // never blocks this, by design.
  const existing = await User.findOne({ $or: [{ email }, { mobile: b.mobile }, { username }] });
  if (existing) {
    // A matching email or mobile means this is really THEIR account (not
    // just a coincidental username collision with someone else) - a
    // distinct code so the client can point them at Log In instead of
    // just showing a generic error.
    if (existing.email === email || existing.mobile === b.mobile) {
      throw ApiError.conflict(
        'You already have an account with this email or mobile number - please log in instead.',
        'ACCOUNT_EXISTS'
      );
    }
    throw ApiError.conflict('That username is already taken');
  }

  const passwordHash = await bcrypt.hash(b.password, 12);
  const pending = await PendingSignup.create({
    token: PendingSignup.generateToken(),
    email,
    username,
    mobile: b.mobile,
    passwordHash,
    gender: b.gender || '',
    coTravelerPreference: b.coTravelerPreference || '',
    referralCode: b.referralCode ? String(b.referralCode).toUpperCase().trim() : '',
  });

  res.status(201).json({ success: true, pendingToken: pending.token });
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

// Generates a fresh reset token for `user` and emails the reset link -
// shared by forgotPassword and verifyIdentityForReset below, so both entry
// points end at the exact same "click the link in your email" step.
async function sendResetLink(user) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  user.resetTokenHash = sha256(rawToken);
  user.resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await user.save();
  const resetUrl = `${env.frontendUrls[0]}/reset-password?token=${rawToken}`;
  sendPasswordResetEmail(user, resetUrl).catch(() => {});
}

export const forgotPassword = asyncHandler(async (req, res) => {
  const email = String(req.body.email).toLowerCase().trim();
  const user = await User.findOne({ email });
  if (user) await sendResetLink(user);

  // Always 200 - anti-enumeration.
  res.json({
    success: true,
    message: 'If an account exists for that email, a reset link has been sent.',
  });
});

// POST /auth/verify-identity - an alternative to typing an email and
// waiting: proves who you are with email + date of birth instead, for a
// member who's lost access to their inbox too. Still ends the same way as
// forgotPassword above though - a link emailed to the account, not an
// immediate password change - so knowing/guessing these two fields alone
// (meaningfully weaker proof than controlling the inbox) can only ever
// trigger that email, never bypass it.
export const verifyIdentityForReset = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const dobRaw = req.body.dateOfBirth;
  const dob = dobRaw ? new Date(dobRaw) : null;

  let verified = false;
  if (email && dob && !Number.isNaN(dob.getTime())) {
    const user = await User.findOne({ email });
    if (user?.dateOfBirth && sameCalendarDate(user.dateOfBirth, dob)) {
      verified = true;
      await sendResetLink(user);
    }
  }

  // Same response shape either way beyond the `verified` flag itself - no
  // separate error path that could leak whether the email exists at all.
  res.json({ success: true, verified });
});

function sameCalendarDate(a, b) {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

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
