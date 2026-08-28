// ============================================================
//  Auth middleware - protect, requireRole, requireMembership.
// ============================================================
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import { verifyAccessToken } from '../utils/jwt.js';
import User from '../models/User.js';
import { hasPermission } from '../utils/permissions.js';
import { getUnverifiedRequiredDocs } from '../utils/verification.js';

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

// Optional auth - attaches req.user if a valid token is present, else continues.
export const attachUser = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);
    if (user && user.isActive) req.user = user;
  } catch {
    /* ignore - treat as anonymous */
  }
  next();
});

// Same as attachUser, but also accepts the access token via ?token= - for
// the handful of routes a plain <img>/<a> tag hits directly, which can't
// send a custom Authorization header. Deliberately NOT used anywhere else:
// a query-string token shows up in browser history and server access logs,
// which is an acceptable tradeoff only for short-lived, read-only file URLs.
export const attachUserFromQuery = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const headerToken = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const token = headerToken || (typeof req.query.token === 'string' ? req.query.token : null);
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);
    if (user && user.isActive) req.user = user;
  } catch {
    /* ignore - treat as anonymous */
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

// Gates a specific admin capability for plain 'admin' accounts - super
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

// Trip-specific gate - unlike requireMembership above, this also passes a
// Trip Pass member who still has a host credit left, even without a
// duration membership. Safe to gate at the route level because creating a
// trip is always a single, credit-consuming action.
//
// There's no equivalent requireTripJoinAccess: POST /trips/:id/interest is
// also how a pending request gets withdrawn and an accepted one gets left
// - neither should ever be blocked by a spent join credit - so that check
// lives inside requestToJoin itself, scoped to only the branch that
// actually spends one. See tripController.js.
export const requireTripHostAccess = (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (!req.user.hasTripHostAccess()) {
    return next(ApiError.forbidden('An active membership or a trip-hosting credit is required', 'TRIP_HOST_ACCESS_REQUIRED'));
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

// Beyond requireProfileComplete (which only checks the documents were
// SUBMITTED) - blocks trip/club participation until an admin has actually
// VERIFIED every one of them. A rejected or still-pending document both
// count as "not verified" here; the member finds out which via GET
// /members/documents, same list the Dashboard "My Documents" card reads.
export const requireDocumentsVerified = asyncHandler(async (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (req.user.role === 'admin' || req.user.role === 'superadmin') return next();
  const unverified = await getUnverifiedRequiredDocs(req.user._id, req.user.hasVehicle);
  if (unverified.length) {
    return next(
      ApiError.forbidden(
        "Your documents are still awaiting admin verification - you'll be able to plan or join trips once they're approved.",
        'DOCUMENTS_NOT_VERIFIED'
      )
    );
  }
  next();
});

// Trip-specific: joining only needs the base "Verified" tier (Aadhaar + PAN
// + selfie, admin-approved); HOSTING needs the full "Verified Vehicle
// Owner" tier (the above plus Driving Licence + RC) - a normal verified
// traveler can join trips but not organize one. These tiers are granted
// either automatically (recomputeVerification, once all the relevant
// documents are verified) or manually by an admin (adminController.verifyUser).
export const requireVerifiedTraveler = (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (req.user.role === 'admin' || req.user.role === 'superadmin') return next();
  if (!req.user.verificationLevel || req.user.verificationLevel === 'none') {
    return next(
      ApiError.forbidden("Your profile needs to be admin-verified before you can join trips.", 'VERIFICATION_REQUIRED')
    );
  }
  next();
};

export const requireVehicleVerified = (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (req.user.role === 'admin' || req.user.role === 'superadmin') return next();
  if (req.user.verificationLevel !== 'vehicle_verified') {
    return next(
      ApiError.forbidden(
        'You need the Verified Vehicle Owner tier to host a trip - a Verified traveler can only join.',
        'VEHICLE_VERIFICATION_REQUIRED'
      )
    );
  }
  next();
};
