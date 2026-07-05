// ============================================================
//  Trip controller.
// ============================================================
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import Trip from '../models/Trip.js';
import TripInterest from '../models/TripInterest.js';
import Gallery from '../models/Gallery.js';
import User from '../models/User.js';
import Group from '../models/Group.js';
import Message from '../models/Message.js';
import { fileToUrl } from '../middleware/upload.js';
import { notify } from '../utils/notify.js';
import { sendTripInterestEmail } from '../utils/email.js';
import { pick } from '../utils/parse.js';

const rx = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

const SORTmap = {
  budget_asc: { budgetPerHead: 1 },
  budget_desc: { budgetPerHead: -1 },
  date_asc: { startDate: 1 },
  date_desc: { startDate: -1 },
};

async function attachCounts(trips, userId) {
  const ids = trips.map((t) => t._id);
  const counts = await TripInterest.aggregate([
    { $match: { trip: { $in: ids } } },
    { $group: { _id: '$trip', count: { $sum: 1 } } },
  ]);
  const map = Object.fromEntries(counts.map((c) => [String(c._id), c.count]));
  let mine = new Set();
  if (userId) {
    const my = await TripInterest.find({ trip: { $in: ids }, user: userId }).select('trip');
    mine = new Set(my.map((i) => String(i.trip)));
  }
  return trips.map((t) => ({
    ...t.toJSON(),
    interestCount: map[String(t._id)] || 0,
    isInterested: mine.has(String(t._id)),
  }));
}

export const getTrips = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const { status, type, minBudget, maxBudget, search, sort } = req.query;

  const filter = {};
  if (status) filter.status = status;
  if (type && type !== 'all') {
    if (type === 'budget') filter.budgetPerHead = { $lt: 3000 };
    else filter.tripType = type;
  }
  if (minBudget) filter.budgetPerHead = { ...filter.budgetPerHead, $gte: Number(minBudget) };
  if (maxBudget) filter.budgetPerHead = { ...filter.budgetPerHead, $lte: Number(maxBudget) };
  if (search) filter.$or = [{ destination: rx(search) }, { title: rx(search) }];

  const sortObj = SORTmap[sort] || { createdAt: -1 };

  const [trips, total] = await Promise.all([
    Trip.find(filter)
      .populate('organizer', 'fullName city avatarUrl isVerified')
      .sort(sortObj)
      .skip((page - 1) * limit)
      .limit(limit),
    Trip.countDocuments(filter),
  ]);

  const data = await attachCounts(trips, req.user?._id);

  res.json({
    success: true,
    trips: data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const getMyTrips = asyncHandler(async (req, res) => {
  const trips = await Trip.find({ organizer: req.user._id })
    .populate('organizer', 'fullName city avatarUrl isVerified')
    .sort({ createdAt: -1 });
  const data = await attachCounts(trips, req.user._id);
  res.json({ success: true, trips: data });
});

export const getTrip = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.id).populate(
    'organizer',
    'fullName city avatarUrl isVerified profession vehicleType'
  );
  if (!trip) throw ApiError.notFound('Trip not found');

  const [interests, photos, interestCount] = await Promise.all([
    TripInterest.find({ trip: trip._id })
      .populate('user', 'fullName city avatarUrl isVerified')
      .limit(12),
    Gallery.find({ trip: trip._id }).sort({ createdAt: -1 }),
    TripInterest.countDocuments({ trip: trip._id }),
  ]);

  let isInterested = false;
  if (req.user) {
    isInterested = Boolean(await TripInterest.exists({ trip: trip._id, user: req.user._id }));
  }

  res.json({
    success: true,
    trip: {
      ...trip.toJSON(),
      interestCount,
      isInterested,
      members: interests.map((i) => i.user).filter(Boolean),
      photos,
    },
  });
});

const CREATE_FIELDS = [
  'title',
  'destination',
  'description',
  'startDate',
  'endDate',
  'budgetPerHead',
  'totalSeats',
  'vehicleType',
  'tripType',
  'pickupLocation',
  'whatsappGroup',
];

export const createTrip = asyncHandler(async (req, res) => {
  const payload = pick(req.body, CREATE_FIELDS);
  const trip = new Trip({ ...payload, organizer: req.user._id });
  if (req.file) trip.coverImageUrl = fileToUrl(req.file);
  await trip.save();

  // Auto-create the trip chat group with the organizer as owner/member.
  await Group.create({
    name: trip.title || trip.destination,
    type: 'trip',
    trip: trip._id,
    owner: req.user._id,
    members: [req.user._id],
  });

  await trip.populate('organizer', 'fullName city avatarUrl isVerified');
  res.status(201).json({ success: true, trip: { ...trip.toJSON(), interestCount: 0, isInterested: false } });
});

export const updateTrip = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.id);
  if (!trip) throw ApiError.notFound('Trip not found');
  const isOwner = String(trip.organizer) === String(req.user._id);
  if (!isOwner && req.user.role !== 'admin') throw ApiError.forbidden('Not allowed');

  const payload = pick(req.body, [...CREATE_FIELDS, 'status', 'filledSeats']);
  Object.assign(trip, payload);
  if (req.file) trip.coverImageUrl = fileToUrl(req.file);
  await trip.save();
  res.json({ success: true, trip: trip.toJSON() });
});

export const deleteTrip = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.id);
  if (!trip) throw ApiError.notFound('Trip not found');
  const isOwner = String(trip.organizer) === String(req.user._id);
  if (!isOwner && req.user.role !== 'admin') throw ApiError.forbidden('Not allowed');

  const grp = await Group.findOne({ trip: trip._id });
  await Promise.all([
    TripInterest.deleteMany({ trip: trip._id }),
    Gallery.deleteMany({ trip: trip._id }),
    grp ? Message.deleteMany({ group: grp._id }) : Promise.resolve(),
  ]);
  if (grp) await grp.deleteOne();
  await trip.deleteOne();
  res.json({ success: true, message: 'Trip deleted' });
});

export const toggleInterest = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.id);
  if (!trip) throw ApiError.notFound('Trip not found');
  if (String(trip.organizer) === String(req.user._id)) {
    throw ApiError.badRequest("You can't join a trip you organize");
  }

  const existing = await TripInterest.findOne({ trip: trip._id, user: req.user._id });
  if (existing) {
    await existing.deleteOne();
    trip.filledSeats = Math.max(0, (trip.filledSeats || 0) - 1);
    await trip.save();
    await Group.updateOne({ trip: trip._id }, { $pull: { members: req.user._id } });
    return res.json({
      success: true,
      interested: false,
      filledSeats: trip.filledSeats,
      seatsLeft: trip.seatsLeft,
    });
  }

  if (trip.seatsLeft <= 0) throw ApiError.badRequest('This trip is already full');

  await TripInterest.create({ trip: trip._id, user: req.user._id });
  trip.filledSeats = (trip.filledSeats || 0) + 1;
  await trip.save();
  // Add the joiner to the trip chat group.
  await Group.updateOne({ trip: trip._id }, { $addToSet: { members: req.user._id } });

  // Non-blocking side effects.
  notify(trip.organizer, {
    type: 'trip_interest',
    title: 'New trip interest 🔥',
    message: `${req.user.fullName} showed interest in your ${trip.destination} trip`,
    meta: { tripId: String(trip._id), userId: String(req.user._id) },
  });
  User.findById(trip.organizer)
    .then((organizer) => organizer && sendTripInterestEmail(organizer, req.user, trip))
    .catch(() => {});

  res.json({
    success: true,
    interested: true,
    filledSeats: trip.filledSeats,
    seatsLeft: trip.seatsLeft,
  });
});

export const uploadTripPhoto = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.id);
  if (!trip) throw ApiError.notFound('Trip not found');
  if (!req.file) throw ApiError.badRequest('Photo file required');

  const photo = await Gallery.create({
    user: req.user._id,
    trip: trip._id,
    photoUrl: fileToUrl(req.file),
    caption: req.body.caption || trip.destination,
    category: req.body.category || trip.tripType || 'group',
  });
  res.status(201).json({ success: true, photo });
});

export const addExpense = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.id);
  if (!trip) throw ApiError.notFound('Trip not found');
  const isOwner = String(trip.organizer) === String(req.user._id);
  if (!isOwner && req.user.role !== 'admin') throw ApiError.forbidden('Not allowed');

  trip.expenses.push({
    category: req.body.category,
    description: req.body.description,
    amount: Number(req.body.amount),
    addedBy: req.user._id,
  });
  await trip.save();
  res.status(201).json({ success: true, trip: trip.toJSON() });
});
