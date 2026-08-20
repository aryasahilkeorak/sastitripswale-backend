// ============================================================
//  JWT helpers - dual token system (short access + long refresh).
//  Refresh tokens are additionally stored as a SHA-256 hash on the
//  user document so they can be revoked (logout / password reset).
// ============================================================
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env.js';

export function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role },
    env.jwt.accessSecret,
    { expiresIn: env.jwt.accessExpires }
  );
}

export function signRefreshToken(user) {
  return jwt.sign(
    { sub: String(user._id), type: 'refresh' },
    env.jwt.refreshSecret,
    { expiresIn: env.jwt.refreshExpires }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwt.refreshSecret);
}

// Short-lived token proving "password already verified" for an admin
// account with 2FA enabled - issued instead of real tokens by /auth/login,
// exchanged for real tokens by /auth/verify-2fa once the PIN checks out.
export function signTwoFactorToken(user) {
  return jwt.sign(
    { sub: String(user._id), type: '2fa_pending' },
    env.jwt.accessSecret,
    { expiresIn: '5m' }
  );
}

export function verifyTwoFactorToken(token) {
  const payload = jwt.verify(token, env.jwt.accessSecret);
  if (payload.type !== '2fa_pending') throw new Error('Not a 2FA token');
  return payload;
}

// Hash a refresh/reset token for at-rest storage.
export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

// Issue a fresh pair AND return the hash to persist.
export function issueTokenPair(user) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  return { accessToken, refreshToken, refreshTokenHash: sha256(refreshToken) };
}
