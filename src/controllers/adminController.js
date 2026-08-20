// ============================================================
//  Admin controller - dashboard stats + management actions.
//  All routes are protected by protect + requireRole('admin').
// ============================================================
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import User from '../models/User.js';
import Trip from '../models/Trip.js';
import Payment from '../models/Payment.js';
import Review from '../models/Review.js';
import Coupon from '../models/Coupon.js';
import Influencer from '../models/Influencer.js';
import Commission from '../models/Commission.js';
import TripInterest from '../models/TripInterest.js';
import ContactMessage from '../models/ContactMessage.js';
import Document from '../models/Document.js';
import Connection from '../models/Connection.js';
import Notification from '../models/Notification.js';
import Gallery from '../models/Gallery.js';
import Group from '../models/Group.js';
import Message from '../models/Message.js';
import Upload from '../models/Upload.js';
import Setting from '../models/Setting.js';
import Report from '../models/Report.js';
import Withdrawal from '../models/Withdrawal.js';
import GroupTrip from '../models/GroupTrip.js';
import GroupTripInterest from '../models/GroupTripInterest.js';
import Follow from '../models/Follow.js';
import Block from '../models/Block.js';
import MemberReview from '../models/MemberReview.js';
import PushSubscription from '../models/PushSubscription.js';
import { notify } from '../utils/notify.js';
import { recomputeVerification } from '../utils/verification.js';
import { vehiclesWithStatus } from './memberController.js';
import { sanitizePermissions, hasPermission } from '../utils/permissions.js';

const DOC_TYPE_LABEL = { aadhaar: 'Aadhaar', pan: 'PAN', voter_id: 'Voter ID', driving_license: 'Driving Licence', rc: 'RC', selfie: 'live selfie photo' };
const TIER_LABEL = { verified: 'Verified', vehicle_verified: 'Verified Vehicle Owner' };

const rx = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

// Turn sparse "$group by day" aggregation rows (only days with activity) into
// a gap-free daily series over the trailing `days` window, so a line chart
// never has to guess at missing dates.
function fillDailySeries(rows, days = 30) {
  const byDate = new Map(rows.map((r) => [r._id, r.count]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const date = d.toISOString().slice(0, 10);
    out.push({ date, count: byDate.get(date) || 0 });
  }
  return out;
}

export const getStats = asyncHandler(async (req, res) => {
  const [
    totalUsers,
    paidMembers,
    verifiedMembers,
    tripsByStatus,
    revenueAgg,
    reviewAgg,
    totalInterests,
    recentSignups,
    recentPayments,
    signupGrowth,
    tripGrowth,
    interestGrowth,
    activeRevenueAgg,
    openQueries,
  ] = await Promise.all([
    User.countDocuments({ role: 'member' }),
    User.countDocuments({ membershipPaid: true }),
    User.countDocuments({ isVerified: true }),
    Trip.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Payment.aggregate([
      { $match: { status: 'success' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Review.aggregate([{ $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } }]),
    TripInterest.countDocuments({}),
    User.find({ role: 'member' }).sort({ createdAt: -1 }).limit(10),
    Payment.find({ status: 'success' })
      .populate('user', 'fullName email')
      .sort({ createdAt: -1 })
      .limit(10),
    User.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Trip.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    TripInterest.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    // Revenue only from currently ACTIVE (non-banned) users.
    Payment.aggregate([
      { $match: { status: 'success' } },
      { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'u' } },
      { $unwind: '$u' },
      { $match: { 'u.isActive': true } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    ContactMessage.countDocuments({ handled: false }),
  ]);

  // Merge the three zero-filled daily series into one array the frontend can
  // plot directly as a multi-line chart: [{ date, signups, trips, interests }].
  const signupsByDay = fillDailySeries(signupGrowth);
  const tripsByDay = fillDailySeries(tripGrowth);
  const interestsByDay = fillDailySeries(interestGrowth);
  const growth = signupsByDay.map((row, i) => ({
    date: row.date,
    signups: row.count,
    trips: tripsByDay[i].count,
    interests: interestsByDay[i].count,
  }));

  const tripStatus = { upcoming: 0, ongoing: 0, completed: 0, cancelled: 0 };
  let totalTrips = 0;
  for (const row of tripsByStatus) {
    tripStatus[row._id] = row.count;
    totalTrips += row.count;
  }

  // Revenue figures are only sent to admins with the 'revenue' permission
  // (super admins always have it) - everyone else gets `payments: null`.
  const canSeeRevenue = hasPermission(req.user, 'revenue');

  res.json({
    success: true,
    stats: {
      users: { total: totalUsers, paid: paidMembers, verified: verifiedMembers },
      trips: { ...tripStatus, total: totalTrips },
      payments: canSeeRevenue
        ? {
            count: revenueAgg[0]?.count || 0,
            revenuePaise: revenueAgg[0]?.total || 0,
            revenueRupees: (revenueAgg[0]?.total || 0) / 100,
            activeRevenuePaise: activeRevenueAgg[0]?.total || 0,
            activeRevenueRupees: (activeRevenueAgg[0]?.total || 0) / 100,
          }
        : null,
      openQueries,
      reviews: {
        count: reviewAgg[0]?.count || 0,
        average: reviewAgg[0]?.avg ? Number(reviewAgg[0].avg.toFixed(2)) : 0,
      },
      interests: totalInterests,
      growth,
    },
    recentSignups: recentSignups.map((u) => u.toPublicJSON()),
    recentPayments: canSeeRevenue ? recentPayments : [],
  });
});

export const getUsers = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 20));

  // Super admins are managed from the dedicated Admins screen, not this list.
  const filter = { role: { $ne: 'superadmin' } };
  if (req.query.membershipPaid) filter.membershipPaid = req.query.membershipPaid === 'true';
  if (req.query.verified) filter.isVerified = req.query.verified === 'true';
  if (req.query.gender) filter.gender = req.query.gender;
  if (req.query.vehicleType) filter.vehicleType = req.query.vehicleType;
  if (req.query.search) {
    filter.$or = [
      { fullName: rx(req.query.search) },
      { email: rx(req.query.search) },
      { mobile: rx(req.query.search) },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    User.countDocuments(filter),
  ]);

  // Include admin-relevant private fields but never secrets.
  const rows = users.map((u) => ({
    ...u.toPrivateJSON(),
    role: u.role,
    isVerified: u.isVerified,
  }));

  res.json({
    success: true,
    users: rows,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const getUserDocuments = asyncHandler(async (req, res) => {
  const docs = await Document.find({ user: req.params.id }).sort({ createdAt: -1 });
  res.json({ success: true, documents: docs });
});

// PATCH /admin/documents/:id - accept or reject a single uploaded document.
// Rejected documents can be re-uploaded by the member from their dashboard.
export const reviewDocument = asyncHandler(async (req, res) => {
  const action = req.body.action;
  if (!['verify', 'reject'].includes(action)) throw ApiError.badRequest("Action must be 'verify' or 'reject'");

  const doc = await Document.findById(req.params.id);
  if (!doc) throw ApiError.notFound('Document not found');

  doc.status = action === 'verify' ? 'verified' : 'rejected';
  doc.isVerified = action === 'verify';
  doc.verifiedBy = req.user._id;
  doc.verifiedAt = new Date();
  await doc.save();

  const docLabel = `${DOC_TYPE_LABEL[doc.docType] || doc.docType}${doc.side ? ` (${doc.side})` : ''}`;
  notify(doc.user, {
    type: 'verification',
    title: action === 'verify' ? 'Document verified' : 'Document rejected',
    message:
      action === 'verify'
        ? `Your ${docLabel} has been verified.`
        : `Your ${docLabel} was rejected. Please re-upload it from your dashboard.`,
    meta: { documentId: String(doc._id), status: doc.status },
  });

  // A single doc review can flip the member's overall verification tier -
  // recompute it and let them know if their badge just changed.
  const result = await recomputeVerification(doc.user);
  if (result?.changed) {
    const { level, previous } = result;
    if (level === 'none') {
      notify(doc.user, {
        type: 'verification',
        title: 'Verified badge removed',
        message: 'One of your required documents needs attention - your verified badge has been removed until it is resolved.',
      });
    } else if (TIER_LABEL[level] && level !== previous) {
      notify(doc.user, {
        type: 'verification',
        title: `You're a ${TIER_LABEL[level]}!`,
        message:
          level === 'vehicle_verified'
            ? 'All your ID and vehicle documents are verified - you now have the Verified Vehicle Owner badge.'
            : 'Your ID documents are verified - you now have the Verified badge.',
      });
    }
  }

  res.json({ success: true, document: doc, verificationLevel: result?.level });
});

// Full detail for the "click a user" view - photo, docs, number, everything.
export const getUserDetail = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('+emergencyContact');
  if (!user) throw ApiError.notFound('User not found');

  const [documents, tripsOrganized, tripsJoined, payments, connections, vehicles] = await Promise.all([
    Document.find({ user: user._id }).sort({ createdAt: -1 }),
    Trip.countDocuments({ organizer: user._id }),
    TripInterest.countDocuments({ user: user._id }),
    Payment.find({ user: user._id }).sort({ createdAt: -1 }).limit(20),
    Connection.countDocuments({
      $or: [{ sender: user._id }, { receiver: user._id }],
      status: 'accepted',
    }),
    vehiclesWithStatus(user),
  ]);

  res.json({
    success: true,
    user: {
      ...user.toPrivateJSON(),
      role: user.role,
      isVerified: user.isVerified,
      verificationLevel: user.verificationLevel || 'none',
      emergencyContact: user.emergencyContact || '',
    },
    documents,
    vehicles,
    stats: { tripsOrganized, tripsJoined, connections },
    payments,
  });
});

// --- Super-admin only ---

export const getAdmins = asyncHandler(async (req, res) => {
  const admins = await User.find({ role: { $in: ['admin', 'superadmin'] } }).sort({ createdAt: -1 });
  res.json({ success: true, admins: admins.map((a) => ({ ...a.toPrivateJSON(), role: a.role })) });
});

export const createAdmin = asyncHandler(async (req, res) => {
  const { fullName, email, mobile, password } = req.body;
  if (!fullName || !email || !mobile || !password) {
    throw ApiError.badRequest('Full name, email, mobile and password are required');
  }
  if (String(password).length < 6) throw ApiError.badRequest('Password must be at least 6 characters');

  const emailN = String(email).toLowerCase().trim();
  const exists = await User.findOne({ $or: [{ email: emailN }, { mobile }] });
  if (exists) throw ApiError.conflict('Email or mobile already in use');

  // Super admins are never created through this panel - only directly
  // against the database - so every admin created here is a plain 'admin'.
  const admin = new User({
    fullName,
    email: emailN,
    mobile,
    role: 'admin',
    isVerified: true,
    membershipPaid: true,
    profileComplete: true,
    permissions: sanitizePermissions(req.body.permissions),
  });
  await admin.setPassword(password);
  await admin.save();
  res.status(201).json({ success: true, admin: { ...admin.toPrivateJSON(), role: admin.role } });
});

// Grant/revoke granular capabilities for a plain 'admin' account.
// Super-admins always have full access, so this only applies to 'admin'.
export const updateAdminPermissions = asyncHandler(async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) throw ApiError.notFound('User not found');
  if (target.role !== 'admin') {
    throw ApiError.badRequest('Only admin accounts have configurable permissions - super admins have full access');
  }
  target.permissions = sanitizePermissions(req.body.permissions);
  await target.save();
  res.json({ success: true, permissions: target.permissions });
});

// Change a user's role (promote/demote/revoke). Super-admin only.
// Super admin accounts are immutable here - can't be promoted to, or
// demoted/revoked from, 'superadmin' through this panel. That role can only
// be granted or removed directly against the database.
export const updateAdminRole = asyncHandler(async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) throw ApiError.notFound('User not found');
  if (String(target._id) === String(req.user._id)) {
    throw ApiError.badRequest("You can't change your own role");
  }
  if (target.role === 'superadmin') {
    throw ApiError.forbidden('Super admin accounts cannot be modified from here');
  }
  const role = req.body.role;
  if (!['member', 'admin'].includes(role)) throw ApiError.badRequest('Invalid role');

  target.role = role;
  if (role !== 'member') {
    target.membershipPaid = true;
    target.profileComplete = true;
  } else {
    target.refreshTokenHash = undefined; // sign the (now demoted) admin out
  }
  await target.save();
  res.json({ success: true, role: target.role });
});

export const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  if (String(user._id) === String(req.user._id)) {
    throw ApiError.badRequest("You can't delete your own account");
  }
  if (user.role === 'superadmin') throw ApiError.forbidden('A super admin cannot be deleted');
  if (user.role === 'admin' && req.user.role !== 'superadmin') {
    throw ApiError.forbidden('Only a super admin can delete an admin account');
  }

  // Cascade - trips organized (and their groups/messages/interests/photos)
  const trips = await Trip.find({ organizer: user._id }).select('_id');
  const tripIds = trips.map((t) => t._id);
  if (tripIds.length) {
    const groups = await Group.find({ trip: { $in: tripIds } }).select('_id');
    const gIds = groups.map((g) => g._id);
    await Promise.all([
      Message.deleteMany({ group: { $in: gIds } }),
      Group.deleteMany({ trip: { $in: tripIds } }),
      TripInterest.deleteMany({ trip: { $in: tripIds } }),
      Gallery.deleteMany({ trip: { $in: tripIds } }),
      Trip.deleteMany({ _id: { $in: tripIds } }),
    ]);
  }

  // Group-trips organized (a separate model from Trip - see GroupTrip.js)
  const groupTrips = await GroupTrip.find({ organizer: user._id }).select('_id');
  const groupTripIds = groupTrips.map((t) => t._id);
  await Promise.all([
    GroupTripInterest.deleteMany({ user: user._id }),
    GroupTripInterest.deleteMany({ groupTrip: { $in: groupTripIds } }),
    GroupTrip.deleteMany({ _id: { $in: groupTripIds } }),
  ]);

  // Custom groups and clubs owned by the user - delete outright, same as an
  // owner disbanding them (clubController.deleteClub has no cascade of its
  // own, so this is also the only place their Messages get cleaned up).
  const ownedGroups = await Group.find({ owner: user._id, type: { $in: ['custom', 'club'] } }).select('_id');
  const ownedGroupIds = ownedGroups.map((g) => g._id);

  // DMs the user is part of - a 1-on-1 chat can't meaningfully survive with
  // only one side left, so the whole conversation goes rather than leaving
  // a 1-member zombie DM.
  const dmGroups = await Group.find({ type: 'dm', members: user._id }).select('_id');
  const dmGroupIds = dmGroups.map((g) => g._id);

  const deletedGroupIds = [...ownedGroupIds, ...dmGroupIds];

  // Influencer profile, if any - Commission/Coupon rows reference it by its
  // own _id (not the user's), so it has to be looked up before deleting.
  const influencer = await Influencer.findOne({ user: user._id }).select('_id');

  await Promise.all([
    Message.deleteMany({ group: { $in: deletedGroupIds } }),
    Group.deleteMany({ _id: { $in: deletedGroupIds } }),
    // Every other group (trip/custom/club) they belong to but don't own -
    // just remove them from it instead of deleting the whole group.
    Group.updateMany(
      { _id: { $nin: deletedGroupIds } },
      { $pull: { members: user._id, admins: user._id, joinRequests: user._id } }
    ),
    Message.deleteMany({ sender: user._id }),
    TripInterest.deleteMany({ user: user._id }),
    Payment.deleteMany({ user: user._id }),
    Review.deleteMany({ user: user._id }),
    MemberReview.deleteMany({ $or: [{ rater: user._id }, { ratee: user._id }] }),
    Connection.deleteMany({ $or: [{ sender: user._id }, { receiver: user._id }] }),
    Follow.deleteMany({ $or: [{ follower: user._id }, { following: user._id }] }),
    Block.deleteMany({ $or: [{ blocker: user._id }, { blocked: user._id }] }),
    Report.deleteMany({ $or: [{ reporter: user._id }, { reportedUser: user._id }] }),
    Notification.deleteMany({ user: user._id }),
    Document.deleteMany({ user: user._id }),
    Gallery.deleteMany({ user: user._id }),
    Upload.deleteMany({ owner: user._id }),
    Withdrawal.deleteMany({ user: user._id }),
    PushSubscription.deleteMany({ user: user._id }),
    // Not required on ContactMessage - keep the message, just detach it.
    ContactMessage.updateMany({ user: user._id }, { user: null }),
    // Other members' referredBy pointing at this (now-deleted) referrer.
    User.updateMany({ referredBy: user._id }, { referredBy: null }),
    Influencer.deleteOne({ user: user._id }),
    Commission.deleteMany({ $or: [{ user: user._id }, ...(influencer ? [{ influencer: influencer._id }] : [])] }),
    ...(influencer ? [Coupon.updateMany({ influencer: influencer._id }, { influencer: null })] : []),
  ]);

  await user.deleteOne();
  res.json({ success: true, message: 'User and all their data have been deleted' });
});

// PATCH /admin/users/:id/verify - manual admin override of a member's
// verification tier (independent of the two normal-traveler/vehicle-owner
// document buttons in the review UI). Note: the next time any of this
// member's documents gets reviewed, recomputeVerification() will re-derive
// the tier from their actual documents and can override a manual grant that
// isn't backed by verified docs.
export const verifyUser = asyncHandler(async (req, res) => {
  const level = req.body.level;
  if (!['none', 'verified', 'vehicle_verified'].includes(level)) {
    throw ApiError.badRequest("level must be 'none', 'verified' or 'vehicle_verified'");
  }
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');

  user.verificationLevel = level;
  user.isVerified = level !== 'none';
  await user.save();

  if (level !== 'none') {
    notify(user._id, {
      type: 'verification',
      title: `You're a ${TIER_LABEL[level]}!`,
      message:
        level === 'vehicle_verified'
          ? 'An admin has verified your profile and vehicle documents - you now have the Verified Vehicle Owner badge.'
          : 'An admin has verified your profile - you now have the Verified badge.',
    });
  }
  res.json({ success: true, isVerified: user.isVerified, verificationLevel: user.verificationLevel });
});

export const toggleUserStatus = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  if (user.role === 'superadmin') throw ApiError.forbidden('A super admin cannot be banned');
  if (String(user._id) === String(req.user._id)) {
    throw ApiError.badRequest("You can't suspend your own account");
  }
  user.isActive = !user.isActive;
  if (!user.isActive) user.refreshTokenHash = undefined; // force logout
  await user.save();
  res.json({ success: true, isActive: user.isActive });
});

export const getAllTrips = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const trips = await Trip.find(filter)
    .populate('organizer', 'fullName email city')
    .sort({ createdAt: -1 });
  res.json({ success: true, trips });
});

export const updateTripStatus = asyncHandler(async (req, res) => {
  const allowed = ['upcoming', 'ongoing', 'completed', 'cancelled'];
  if (!allowed.includes(req.body.status)) throw ApiError.badRequest('Invalid status');
  const trip = await Trip.findByIdAndUpdate(
    req.params.id,
    { status: req.body.status },
    { new: true }
  );
  if (!trip) throw ApiError.notFound('Trip not found');
  res.json({ success: true, trip });
});

export const getAdminReviews = asyncHandler(async (req, res) => {
  const reviews = await Review.find({})
    .populate('user', 'fullName city')
    .sort({ createdAt: -1 })
    .limit(100);
  res.json({ success: true, reviews });
});

export const featureReview = asyncHandler(async (req, res) => {
  const review = await Review.findByIdAndUpdate(
    req.params.id,
    { isFeatured: req.body.featured !== false },
    { new: true }
  );
  if (!review) throw ApiError.notFound('Review not found');
  res.json({ success: true, review });
});

export const deleteReview = asyncHandler(async (req, res) => {
  const review = await Review.findByIdAndDelete(req.params.id);
  if (!review) throw ApiError.notFound('Review not found');
  res.json({ success: true });
});

export const getCoupons = asyncHandler(async (req, res) => {
  const coupons = await Coupon.find({}).sort({ createdAt: -1 });
  res.json({ success: true, coupons });
});

export const createCoupon = asyncHandler(async (req, res) => {
  const code = String(req.body.code || '').toUpperCase().trim();
  if (!code) throw ApiError.badRequest('Coupon code required');
  const exists = await Coupon.findOne({ code });
  if (exists) throw ApiError.conflict('Coupon code already exists');

  const coupon = await Coupon.create({
    code,
    discountPct: Number(req.body.discountPct) || 0,
    discountAmt: Number(req.body.discountAmt) || 0,
    maxUses: Number(req.body.maxUses) || 1000,
    expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : undefined,
  });
  res.status(201).json({ success: true, coupon });
});

export const toggleCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw ApiError.notFound('Coupon not found');
  coupon.isActive = !coupon.isActive;
  await coupon.save();
  res.json({ success: true, isActive: coupon.isActive });
});

export const updateCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  if (!coupon) throw ApiError.notFound('Coupon not found');
  if (req.body.code) coupon.code = String(req.body.code).toUpperCase().trim();
  if (req.body.discountPct !== undefined) coupon.discountPct = Number(req.body.discountPct) || 0;
  if (req.body.discountAmt !== undefined) coupon.discountAmt = Number(req.body.discountAmt) || 0;
  if (req.body.maxUses !== undefined) coupon.maxUses = Number(req.body.maxUses) || 0;
  if (req.body.isActive !== undefined) coupon.isActive = Boolean(req.body.isActive);
  if (req.body.expiresAt !== undefined) {
    coupon.expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : undefined;
  }
  await coupon.save();
  res.json({ success: true, coupon });
});

export const deleteCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findByIdAndDelete(req.params.id);
  if (!coupon) throw ApiError.notFound('Coupon not found');
  res.json({ success: true });
});

// ── Influencer/Promoter program ──────────────────────────────────────────

export const getInfluencers = asyncHandler(async (req, res) => {
  const influencers = await Influencer.find({})
    .sort({ createdAt: -1 })
    .populate('user', 'fullName username email mobile avatarUrl city');
  const coupons = await Coupon.find({ influencer: { $in: influencers.map((i) => i._id) } });
  const couponByInfluencer = Object.fromEntries(coupons.map((c) => [String(c.influencer), c]));

  res.json({
    success: true,
    influencers: influencers.map((i) => ({ ...i.toObject(), coupon: couponByInfluencer[String(i._id)] || null })),
  });
});

// PATCH /admin/influencers/:id - approve (issues the coupon) or reject.
export const respondToInfluencer = asyncHandler(async (req, res) => {
  const influencer = await Influencer.findById(req.params.id).populate('user', 'fullName username');
  if (!influencer) throw ApiError.notFound('Application not found');
  const action = req.body.action === 'approve' ? 'approve' : 'reject';

  if (action === 'reject') {
    influencer.status = 'rejected';
    influencer.reviewedBy = req.user._id;
    influencer.reviewedAt = new Date();
    await influencer.save();
    notify(influencer.user._id, {
      type: 'influencer',
      title: 'Influencer application declined',
      message: "Your influencer application wasn't approved this time.",
    });
    return res.json({ success: true, influencer });
  }

  // Approve: issue (or reuse) their personal coupon. Commission is set
  // manually by the admin based on the reach info collected at application
  // time (followers, avg reel views, dashboard screenshot, socials) -
  // policy caps it 10-30%.
  const discountPct = Math.max(0, Math.min(100, Number(req.body.discountPct) || 10));
  const commissionPct = Math.max(10, Math.min(30, Number(req.body.commissionPct) || 10));
  const handle = (influencer.user.username || influencer.user.fullName || 'promo').replace(/[^a-zA-Z0-9]/g, '');
  const suggestedCode = `${handle}${discountPct}`.toUpperCase();
  const code = String(req.body.couponCode || suggestedCode).toUpperCase().trim();
  if (!code) throw ApiError.badRequest('Coupon code required');

  let coupon = await Coupon.findOne({ influencer: influencer._id });
  if (!coupon) {
    const codeTaken = await Coupon.findOne({ code, influencer: { $ne: influencer._id } });
    if (codeTaken) throw ApiError.conflict('That coupon code is already in use');
    coupon = await Coupon.create({ code, discountPct, influencer: influencer._id });
  } else {
    coupon.code = code;
    coupon.discountPct = discountPct;
    coupon.isActive = true;
    await coupon.save();
  }

  influencer.status = 'approved';
  influencer.commissionPct = commissionPct;
  influencer.reviewedBy = req.user._id;
  influencer.reviewedAt = new Date();
  await influencer.save();

  notify(influencer.user._id, {
    type: 'influencer',
    title: "You're an approved influencer!",
    message: `Your coupon code is ${code} - ${discountPct}% off for customers, ${commissionPct}% commission for you.`,
  });

  res.json({ success: true, influencer, coupon });
});

// PUT /admin/influencers/:id - edit an approved influencer's discount%/commission%.
export const updateInfluencer = asyncHandler(async (req, res) => {
  const influencer = await Influencer.findById(req.params.id);
  if (!influencer) throw ApiError.notFound('Influencer not found');

  if (req.body.commissionPct !== undefined) {
    influencer.commissionPct = Math.max(10, Math.min(30, Number(req.body.commissionPct) || 10));
  }
  await influencer.save();

  const coupon = await Coupon.findOne({ influencer: influencer._id });
  if (coupon && req.body.discountPct !== undefined) {
    coupon.discountPct = Math.max(0, Math.min(100, Number(req.body.discountPct) || 0));
    await coupon.save();
  }

  res.json({ success: true, influencer, coupon });
});

// DELETE /admin/influencers/:id - revoke (deactivates their coupon too).
export const deleteInfluencer = asyncHandler(async (req, res) => {
  const influencer = await Influencer.findByIdAndDelete(req.params.id);
  if (!influencer) throw ApiError.notFound('Influencer not found');
  await Coupon.updateOne({ influencer: influencer._id }, { isActive: false });
  res.json({ success: true });
});

// GET /admin/commissions - full ledger, optionally filtered by influencer.
export const getCommissions = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.influencer) filter.influencer = req.query.influencer;
  const commissions = await Commission.find(filter)
    .sort({ createdAt: -1 })
    .populate({ path: 'influencer', populate: { path: 'user', select: 'fullName username avatarUrl' } })
    .populate('user', 'fullName')
    .populate('payment', 'amount planDuration planPreference');
  res.json({ success: true, commissions });
});

// PATCH /admin/commissions/:id - mark a ledger row as paid.
export const markCommissionPaid = asyncHandler(async (req, res) => {
  const commission = await Commission.findById(req.params.id);
  if (!commission) throw ApiError.notFound('Commission not found');
  commission.status = 'paid';
  await commission.save();
  res.json({ success: true, commission });
});

// GET /admin/withdrawals - every wallet withdrawal request, with the full
// submitted payout details (name/email/UPI/QR/PAN), optionally filtered
// by status.
export const getWithdrawals = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const withdrawals = await Withdrawal.find(filter)
    .sort({ createdAt: -1 })
    .populate('user', 'fullName username email avatarUrl isVerified')
    .populate('reviewedBy', 'fullName');
  res.json({ success: true, withdrawals });
});

// PATCH /admin/withdrawals/:id - approve / reject / mark paid.
// Rejecting refunds the reserved amount back to the member's wallet.
export const respondToWithdrawal = asyncHandler(async (req, res) => {
  const withdrawal = await Withdrawal.findById(req.params.id);
  if (!withdrawal) throw ApiError.notFound('Withdrawal request not found');

  const action = req.body.action;
  if (!['approve', 'reject', 'paid'].includes(action)) throw ApiError.badRequest('Invalid action');

  if (action === 'reject') {
    if (withdrawal.status !== 'pending') throw ApiError.conflict('Only a pending request can be declined');
    withdrawal.status = 'rejected';
    await User.updateOne({ _id: withdrawal.user }, { $inc: { walletBalancePaise: withdrawal.amountPaise } });
    notify(withdrawal.user, {
      type: 'system',
      title: 'Withdrawal declined',
      message: `Your ₹${(withdrawal.amountPaise / 100).toFixed(0)} withdrawal request was declined - the amount has been refunded to your wallet.`,
    });
  } else if (action === 'approve') {
    if (withdrawal.status !== 'pending') throw ApiError.conflict('Only a pending request can be approved');
    withdrawal.status = 'approved';
  } else {
    if (withdrawal.status !== 'approved') throw ApiError.conflict('Approve the request before marking it paid');
    const transactionRef = String(req.body.transactionRef || '').trim();
    if (!transactionRef) throw ApiError.badRequest('Enter the UPI/bank transaction reference (UTR) for this payout');
    withdrawal.status = 'paid';
    withdrawal.transactionRef = transactionRef;
    notify(withdrawal.user, {
      type: 'system',
      title: 'Withdrawal paid',
      message: `Your ₹${(withdrawal.amountPaise / 100).toFixed(0)} withdrawal has been paid out (Txn ID: ${transactionRef}). Please check your bank account.`,
    });
  }

  if (req.body.adminNote !== undefined) withdrawal.adminNote = String(req.body.adminNote).slice(0, 500);
  withdrawal.reviewedBy = req.user._id;
  withdrawal.reviewedAt = new Date();
  await withdrawal.save();
  res.json({ success: true, withdrawal });
});

// GET /admin/wallet-stats - totals for the admin Wallet dashboard.
export const getWalletStats = asyncHandler(async (req, res) => {
  const [paidAgg, pendingAgg, approvedAgg, outstandingAgg] = await Promise.all([
    Withdrawal.aggregate([{ $match: { status: 'paid' } }, { $group: { _id: null, total: { $sum: '$amountPaise' }, count: { $sum: 1 } } }]),
    Withdrawal.aggregate([{ $match: { status: 'pending' } }, { $group: { _id: null, total: { $sum: '$amountPaise' }, count: { $sum: 1 } } }]),
    Withdrawal.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, total: { $sum: '$amountPaise' }, count: { $sum: 1 } } }]),
    User.aggregate([{ $match: { walletBalancePaise: { $gt: 0 } } }, { $group: { _id: null, total: { $sum: '$walletBalancePaise' }, count: { $sum: 1 } } }]),
  ]);
  res.json({
    success: true,
    stats: {
      totalPaidPaise: paidAgg[0]?.total || 0,
      totalPaidCount: paidAgg[0]?.count || 0,
      totalPendingPaise: pendingAgg[0]?.total || 0,
      totalPendingCount: pendingAgg[0]?.count || 0,
      totalApprovedPaise: approvedAgg[0]?.total || 0,
      totalApprovedCount: approvedAgg[0]?.count || 0,
      totalOutstandingPaise: outstandingAgg[0]?.total || 0,
      usersWithBalance: outstandingAgg[0]?.count || 0,
    },
  });
});

export const getAdminGallery = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 24));

  const filter = {};
  if (req.query.category && req.query.category !== 'all') filter.category = req.query.category;

  const [photos, total] = await Promise.all([
    Gallery.find(filter)
      .populate('user', 'fullName email city')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Gallery.countDocuments(filter),
  ]);

  res.json({
    success: true,
    photos,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const deleteGalleryPhoto = asyncHandler(async (req, res) => {
  const photo = await Gallery.findById(req.params.id);
  if (!photo) throw ApiError.notFound('Photo not found');

  // The photo's bytes live in a separate Upload document - clean it up too.
  const match = /\/api\/files\/([a-f0-9]{24})/i.exec(photo.photoUrl || '');
  if (match) await Upload.deleteOne({ _id: match[1] });

  await photo.deleteOne();
  res.json({ success: true, message: 'Photo deleted' });
});

// POST /admin/gallery/bulk-delete - delete multiple selected photos at once.
export const bulkDeleteGalleryPhotos = asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(Boolean) : [];
  if (!ids.length) throw ApiError.badRequest('No photos selected');

  const photos = await Gallery.find({ _id: { $in: ids } }).select('photoUrl');
  const uploadIds = photos
    .map((p) => /\/api\/files\/([a-f0-9]{24})/i.exec(p.photoUrl || '')?.[1])
    .filter(Boolean);

  await Promise.all([
    Upload.deleteMany({ _id: { $in: uploadIds } }),
    Gallery.deleteMany({ _id: { $in: ids } }),
  ]);

  res.json({ success: true, deleted: photos.length });
});

export const getReports = asyncHandler(async (req, res) => {
  const reports = await Report.find({})
    .populate('reporter', 'fullName email avatarUrl')
    .populate('reportedUser', 'fullName email avatarUrl isActive')
    .sort({ status: 1, createdAt: -1 })
    .limit(200);
  res.json({ success: true, reports });
});

export const updateReport = asyncHandler(async (req, res) => {
  const report = await Report.findByIdAndUpdate(
    req.params.id,
    { status: req.body.status === 'open' ? 'open' : 'resolved' },
    { new: true }
  );
  if (!report) throw ApiError.notFound('Report not found');
  res.json({ success: true, report });
});

export const deleteReport = asyncHandler(async (req, res) => {
  const report = await Report.findByIdAndDelete(req.params.id);
  if (!report) throw ApiError.notFound('Report not found');
  res.json({ success: true });
});

export const getContactMessages = asyncHandler(async (req, res) => {
  const messages = await ContactMessage.find({})
    .populate('user', 'fullName isActive')
    .sort({ handled: 1, createdAt: -1 })
    .limit(200);

  // Older/anonymous submissions never had `user` set - best-effort match
  // them to an existing account by email/mobile so "Reply in chat" still
  // works instead of only being available for messages sent while logged in.
  await Promise.all(
    messages
      .filter((m) => !m.user)
      .map(async (m) => {
        const found = await User.findOne({
          $or: [...(m.email ? [{ email: m.email }] : []), ...(m.mobile ? [{ mobile: m.mobile }] : [])],
        }).select('fullName isActive');
        if (!found) return;
        m.user = found;
        await ContactMessage.updateOne({ _id: m._id }, { $set: { user: found._id } });
      })
  );

  res.json({ success: true, messages });
});

export const updateContactMessage = asyncHandler(async (req, res) => {
  const msg = await ContactMessage.findByIdAndUpdate(
    req.params.id,
    { handled: req.body.handled !== false },
    { new: true }
  );
  if (!msg) throw ApiError.notFound('Message not found');
  res.json({ success: true, message: msg });
});

export const deleteContactMessage = asyncHandler(async (req, res) => {
  const msg = await ContactMessage.findByIdAndDelete(req.params.id);
  if (!msg) throw ApiError.notFound('Message not found');
  res.json({ success: true });
});

// Site-wide settings (super-admin only)
export const getSettings = asyncHandler(async (req, res) => {
  const settings = await Setting.getSingleton();
  res.json({ success: true, settings: { referralEnabled: settings.referralEnabled, referralTiers: settings.referralTiers } });
});

export const toggleReferrals = asyncHandler(async (req, res) => {
  const settings = await Setting.getSingleton();
  settings.referralEnabled = !settings.referralEnabled;
  await settings.save();
  res.json({ success: true, referralEnabled: settings.referralEnabled });
});

// PATCH /admin/settings/referral-tiers - replace the whole reward ladder.
// Body: { tiers: [{ from, to (nullable), amountPaise }, ...] }, sorted by
// `from` ascending, no gaps required but ranges shouldn't overlap.
export const updateReferralTiers = asyncHandler(async (req, res) => {
  const raw = Array.isArray(req.body.tiers) ? req.body.tiers : [];
  if (!raw.length) throw ApiError.badRequest('At least one tier is required');

  const tiers = raw
    .map((t) => ({
      from: Math.max(1, Math.round(Number(t.from))),
      to: t.to === null || t.to === undefined || t.to === '' ? null : Math.max(1, Math.round(Number(t.to))),
      amountPaise: Math.max(0, Math.round(Number(t.amountPaise) || 0)),
    }))
    .sort((a, b) => a.from - b.from);

  for (const t of tiers) {
    if (!Number.isFinite(t.from) || (t.to !== null && !Number.isFinite(t.to))) {
      throw ApiError.badRequest('Each tier needs a valid "from" (and "to", if not open-ended)');
    }
    if (t.to !== null && t.to < t.from) throw ApiError.badRequest('A tier\'s "to" must be greater than or equal to its "from"');
  }
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].from <= (tiers[i - 1].to ?? Infinity)) {
      throw ApiError.badRequest('Tier ranges cannot overlap');
    }
  }

  const settings = await Setting.getSingleton();
  settings.referralTiers = tiers;
  await settings.save();
  res.json({ success: true, referralTiers: settings.referralTiers });
});
