// ============================================================
//  Admin controller — dashboard stats + management actions.
//  All routes are protected by protect + requireRole('admin').
// ============================================================
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import User from '../models/User.js';
import Trip from '../models/Trip.js';
import Payment from '../models/Payment.js';
import Review from '../models/Review.js';
import Coupon from '../models/Coupon.js';
import TripInterest from '../models/TripInterest.js';
import ContactMessage from '../models/ContactMessage.js';
import Document from '../models/Document.js';
import Connection from '../models/Connection.js';
import Notification from '../models/Notification.js';
import Gallery from '../models/Gallery.js';
import Group from '../models/Group.js';
import Message from '../models/Message.js';
import Upload from '../models/Upload.js';
import { notify } from '../utils/notify.js';

const rx = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

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
    growth,
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

  const tripStatus = { upcoming: 0, ongoing: 0, completed: 0, cancelled: 0 };
  let totalTrips = 0;
  for (const row of tripsByStatus) {
    tripStatus[row._id] = row.count;
    totalTrips += row.count;
  }

  res.json({
    success: true,
    stats: {
      users: { total: totalUsers, paid: paidMembers, verified: verifiedMembers },
      trips: { ...tripStatus, total: totalTrips },
      payments: {
        count: revenueAgg[0]?.count || 0,
        revenuePaise: revenueAgg[0]?.total || 0,
        revenueRupees: (revenueAgg[0]?.total || 0) / 100,
        activeRevenuePaise: activeRevenueAgg[0]?.total || 0,
        activeRevenueRupees: (activeRevenueAgg[0]?.total || 0) / 100,
      },
      openQueries,
      reviews: {
        count: reviewAgg[0]?.count || 0,
        average: reviewAgg[0]?.avg ? Number(reviewAgg[0].avg.toFixed(2)) : 0,
      },
      interests: totalInterests,
      growth,
    },
    recentSignups: recentSignups.map((u) => u.toPublicJSON()),
    recentPayments,
  });
});

export const getUsers = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 20));

  const filter = {};
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

// Full detail for the "click a user" view — photo, docs, number, everything.
export const getUserDetail = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('+emergencyContact');
  if (!user) throw ApiError.notFound('User not found');

  const [documents, tripsOrganized, tripsJoined, payments, connections] = await Promise.all([
    Document.find({ user: user._id }).sort({ createdAt: -1 }),
    Trip.countDocuments({ organizer: user._id }),
    TripInterest.countDocuments({ user: user._id }),
    Payment.find({ user: user._id }).sort({ createdAt: -1 }).limit(20),
    Connection.countDocuments({
      $or: [{ sender: user._id }, { receiver: user._id }],
      status: 'accepted',
    }),
  ]);

  res.json({
    success: true,
    user: {
      ...user.toPrivateJSON(),
      role: user.role,
      isVerified: user.isVerified,
      emergencyContact: user.emergencyContact || '',
    },
    documents,
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

  const role = req.body.role === 'superadmin' ? 'superadmin' : 'admin';
  const admin = new User({
    fullName,
    email: emailN,
    mobile,
    role,
    isVerified: true,
    membershipPaid: true,
    profileComplete: true,
  });
  await admin.setPassword(password);
  await admin.save();
  res.status(201).json({ success: true, admin: { ...admin.toPrivateJSON(), role: admin.role } });
});

// Change a user's role (promote/demote/revoke). Super-admin only.
export const updateAdminRole = asyncHandler(async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) throw ApiError.notFound('User not found');
  if (String(target._id) === String(req.user._id)) {
    throw ApiError.badRequest("You can't change your own role");
  }
  const role = req.body.role;
  if (!['member', 'admin', 'superadmin'].includes(role)) throw ApiError.badRequest('Invalid role');

  // Never remove the last super admin.
  if (target.role === 'superadmin' && role !== 'superadmin') {
    const supers = await User.countDocuments({ role: 'superadmin' });
    if (supers <= 1) throw ApiError.badRequest('At least one super admin must remain');
  }

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

  // Cascade — trips organized (and their groups/messages/interests/photos)
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

  // Custom groups owned by the user
  const ownedGroups = await Group.find({ owner: user._id, type: 'custom' }).select('_id');
  const ogIds = ownedGroups.map((g) => g._id);

  await Promise.all([
    Message.deleteMany({ group: { $in: ogIds } }),
    Group.deleteMany({ _id: { $in: ogIds } }),
    Group.updateMany({ members: user._id }, { $pull: { members: user._id } }),
    Message.deleteMany({ sender: user._id }),
    TripInterest.deleteMany({ user: user._id }),
    Payment.deleteMany({ user: user._id }),
    Review.deleteMany({ user: user._id }),
    Connection.deleteMany({ $or: [{ sender: user._id }, { receiver: user._id }] }),
    Notification.deleteMany({ user: user._id }),
    Document.deleteMany({ user: user._id }),
    Gallery.deleteMany({ user: user._id }),
    Upload.deleteMany({ owner: user._id }),
  ]);

  await user.deleteOne();
  res.json({ success: true, message: 'User and all their data have been deleted' });
});

export const verifyUser = asyncHandler(async (req, res) => {
  const verified = req.body.verified !== false; // default true
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');

  user.isVerified = verified;
  await user.save();
  await Document.updateMany(
    { user: user._id },
    { $set: { isVerified: verified, verifiedBy: req.user._id, verifiedAt: new Date() } }
  );

  if (verified) {
    notify(user._id, {
      type: 'verification',
      title: 'Profile verified ✅',
      message: 'Your profile has been verified. You now have a verified badge!',
    });
  }
  res.json({ success: true, isVerified: user.isVerified });
});

export const toggleUserStatus = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
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

export const getContactMessages = asyncHandler(async (req, res) => {
  const messages = await ContactMessage.find({}).sort({ handled: 1, createdAt: -1 }).limit(200);
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
