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
      },
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

export const deleteCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findByIdAndDelete(req.params.id);
  if (!coupon) throw ApiError.notFound('Coupon not found');
  res.json({ success: true });
});

export const getContactMessages = asyncHandler(async (req, res) => {
  const messages = await ContactMessage.find({}).sort({ createdAt: -1 }).limit(100);
  res.json({ success: true, messages });
});
