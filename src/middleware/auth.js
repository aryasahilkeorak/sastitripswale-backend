// ============================================================
//  Auth middleware — protect, requireRole, requireMembership.
// ============================================================
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import { verifyAccessToken } from '../utils/jwt.js';
import User from '../models/User.js';
import { hasPermission } from '../utils/permissions.js';

export const protect = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) throw ApiError.unauthorized('Authentication required');

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw ApiError.unauthorized('Access token expired', 'TOKEN_EXPIRED');
    }
    throw ApiError.unauthorized('Invalid token');
  }

  // Load fresh so banned/deleted users are rejected immediately.
  const user = await User.findById(payload.sub);
  if (!user) throw ApiError.unauthorized('User no longer exists');
  if (!user.isActive) throw ApiError.forbidden('Your account has been suspended');

  req.user = user;
  next();
});

// Optional auth — attaches req.user if a valid token is present, else continues.
export const attachUser = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);
    if (user && user.isActive) req.user = user;
  } catch {
    /* ignore — treat as anonymous */
  }
  next();
});

export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden('You do not have permission for this action'));
    }
    next();
  };

// Gates a specific admin capability for plain 'admin' accounts — super
// admins always pass. See utils/permissions.js for valid keys.
export const requirePermission = (key) => (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (!hasPermission(req.user, key)) {
    return next(ApiError.forbidden(`You don't have permission to manage ${key}`));
  }
  next();
};

export const requireMembership = (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (!req.user.hasActiveMembership()) {
    return next(ApiError.forbidden('An active membership is required', 'MEMBERSHIP_REQUIRED'));
  }
  next();
};

// Blocks trip create/join until the user has completed their profile
// (name, city, interests, vehicle info, ID document).
export const requireProfileComplete = (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (req.user.role === 'admin' || req.user.role === 'superadmin') return next();
  if (!req.user.profileComplete) {
    return next(ApiError.forbidden('Complete your profile to plan or join trips', 'PROFILE_INCOMPLETE'));
  }
  next();
};
