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
import { saveUpload } from '../utils/uploadStore.js';
import { notify } from '../utils/notify.js';
import { sendJoinRequestEmail, sendJoinAcceptedEmail, sendJoinRejectedEmail } from '../utils/email.js';
import { fetchDestinationPhoto } from '../utils/pexels.js';
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
    { $match: { trip: { $in: ids }, status: 'accepted' } },
    { $group: { _id: '$trip', count: { $sum: 1 } } },
  ]);
  const map = Object.fromEntries(counts.map((c) => [String(c._id), c.count]));
  let mine = new Map();
  if (userId) {
    const my = await TripInterest.find({ trip: { $in: ids }, user: userId }).select('trip status');
    mine = new Map(my.map((i) => [String(i.trip), i.status]));
  }
  return trips.map((t) => ({
    ...t.toJSON(),
    interestCount: map[String(t._id)] || 0,
    requestStatus: mine.get(String(t._id)) || null,
  }));
}

export const getTrips = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const { status, type, minBudget, maxBudget, search, sort, from, to, date, seats } = req.query;

  const filter = {};
  if (status) filter.status = status;
  if (type && type !== 'all') {
    if (type === 'budget') filter.budgetPerHead = { $lt: 3000 };
    else if (type === 'couples') filter.isCouplesMode = true;
    else filter.tripType = type;
  }
  if (minBudget) filter.budgetPerHead = { ...filter.budgetPerHead, $gte: Number(minBudget) };
  if (maxBudget) filter.budgetPerHead = { ...filter.budgetPerHead, $lte: Number(maxBudget) };
  if (search) filter.$or = [{ destination: rx(search) }, { origin: rx(search) }];

  // BlaBlaCar-style ride search: leaving from / going to / travel date / seats needed.
  if (from) filter.origin = rx(from);
  if (to) filter.destination = rx(to);
  if (date) {
    const d = new Date(date);
    if (!Number.isNaN(d.getTime())) {
      filter.startDate = { $lte: d };
      filter.endDate = { $gte: d };
    }
  }
  if (seats) {
    const n = Number(seats);
    if (n > 0) {
      filter.$expr = {
        $gte: [
          { $subtract: ['$totalSeats', { $add: [{ $cond: ['$isCouplesMode', 2, 0] }, '$filledSeats'] }] },
          n,
        ],
      };
    }
  }

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

const MEMBER_FIELDS = 'fullName city avatarUrl isVerified';
const MEMBER_FIELDS_WITH_PARTNER = `${MEMBER_FIELDS} partnerMobile partnerDocUrl`;

export const getTrip = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.id).populate(
    'organizer',
    'fullName city avatarUrl isVerified profession vehicleType partnerMobile partnerDocUrl'
  );
  if (!trip) throw ApiError.notFound('Trip not found');

  const isOrganizer = req.user && String(trip.organizer._id) === String(req.user._id);
  const isAdmin = req.user && (req.user.role === 'admin' || req.user.role === 'superadmin');
  // Partner mobile/ID doc are safety info collected about someone who isn't
  // a registered user — only ever surfaced to admins, never to the organizer
  // or the public (the organizer only needs to know *who* they're travelling with).
  const memberSelect = isAdmin ? MEMBER_FIELDS_WITH_PARTNER : MEMBER_FIELDS;

  const [accepted, photos] = await Promise.all([
    TripInterest.find({ trip: trip._id, status: 'accepted' })
      .populate('user', memberSelect)
      .limit(12),
    Gallery.find({ trip: trip._id }).sort({ createdAt: -1 }),
  ]);

  let requestStatus = null;
  if (req.user) {
    const mine = await TripInterest.findOne({ trip: trip._id, user: req.user._id }).select('status');
    requestStatus = mine?.status || null;
  }

  const withCoupleFlag = (i) => ({ ...i.user.toObject(), isCouple: i.isCouple });

  let pendingRequests;
  if (isOrganizer || isAdmin) {
    const pending = await TripInterest.find({ trip: trip._id, status: 'pending' })
      .populate('user', memberSelect)
      .sort({ createdAt: 1 });
    pendingRequests = pending.filter((i) => i.user).map(withCoupleFlag);
  }

  const tripJson = trip.toJSON();
  if (!isOrganizer && !isAdmin && tripJson.organizer) {
    delete tripJson.organizer.partnerMobile;
    delete tripJson.organizer.partnerDocUrl;
  }

  res.json({
    success: true,
    trip: {
      ...tripJson,
      interestCount: accepted.length,
      requestStatus,
      members: accepted.filter((i) => i.user).map(withCoupleFlag),
      pendingRequests,
      photos,
    },
  });
});

const CREATE_FIELDS = [
  'origin',
  'viaStops',
  'destination',
  'description',
  'startDate',
  'endDate',
  'budgetPerHead',
  'totalSeats',
  'vehicleType',
  'tripType',
  'pickupLocation',
  'isCouplesMode',
];

function assertPartnerInfoOnFile(user) {
  if (!user.partnerMobile || !user.partnerDocUrl) {
    throw ApiError.badRequest(
      "Add your partner's mobile number and ID document in your profile before using Couples Mode"
    );
  }
}

export const createTrip = asyncHandler(async (req, res) => {
  const payload = pick(req.body, CREATE_FIELDS);
  if (payload.isCouplesMode === true || payload.isCouplesMode === 'true') assertPartnerInfoOnFile(req.user);
  const trip = new Trip({ ...payload, organizer: req.user._id });
  trip.coverImageUrl = await fetchDestinationPhoto(trip.destination);
  await trip.save();

  // Auto-create the trip chat group with the organizer as owner/member.
  await Group.create({
    name: trip.routeLabel,
    type: 'trip',
    trip: trip._id,
    owner: req.user._id,
    members: [req.user._id],
  });

  await trip.populate('organizer', 'fullName city avatarUrl isVerified');
  res.status(201).json({ success: true, trip: { ...trip.toJSON(), interestCount: 0, requestStatus: null } });
});

export const updateTrip = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.id);
  if (!trip) throw ApiError.notFound('Trip not found');
  const isOwner = String(trip.organizer) === String(req.user._id);
  if (!isOwner && req.user.role !== 'admin' && req.user.role !== 'superadmin') throw ApiError.forbidden('Not allowed');

  const payload = pick(req.body, [...CREATE_FIELDS, 'status', 'filledSeats']);
  const destinationChanged = payload.destination && payload.destination !== trip.destination;
  const turningCouplesModeOn = payload.isCouplesMode && !trip.isCouplesMode;
  if (turningCouplesModeOn) {
    const organizerUser = isOwner ? req.user : await User.findById(trip.organizer);
    assertPartnerInfoOnFile(organizerUser);
  }
  Object.assign(trip, payload);
  if (destinationChanged) trip.coverImageUrl = await fetchDestinationPhoto(trip.destination);
  await trip.save();
  res.json({ success: true, trip: trip.toJSON() });
});

export const deleteTrip = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.id);
  if (!trip) throw ApiError.notFound('Trip not found');
  const isOwner = String(trip.organizer) === String(req.user._id);
  if (!isOwner && req.user.role !== 'admin' && req.user.role !== 'superadmin') throw ApiError.forbidden('Not allowed');

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

export const requestToJoin = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.id);
  if (!trip) throw ApiError.notFound('Trip not found');
  if (String(trip.organizer) === String(req.user._id)) {
    throw ApiError.badRequest("You can't join a trip you organize");
  }

  const existing = await TripInterest.findOne({ trip: trip._id, user: req.user._id });

  // Already accepted → this is "leave the trip".
  if (existing && existing.status === 'accepted') {
    const seatsToFree = existing.isCouple ? 2 : 1;
    await existing.deleteOne();
    trip.filledSeats = Math.max(0, (trip.filledSeats || 0) - seatsToFree);
    await trip.save();
    await Group.updateOne({ trip: trip._id }, { $pull: { members: req.user._id } });
    return res.json({
      success: true,
      requestStatus: null,
      filledSeats: trip.filledSeats,
      seatsLeft: trip.seatsLeft,
    });
  }

  // Already pending → withdraw the request (no seats were ever reserved).
  if (existing && existing.status === 'pending') {
    await existing.deleteOne();
    return res.json({
      success: true,
      requestStatus: null,
      filledSeats: trip.filledSeats,
      seatsLeft: trip.seatsLeft,
    });
  }

  // No existing request, or a previously-rejected one → (re-)request.
  const isCouple = trip.isCouplesMode;
  if (isCouple) assertPartnerInfoOnFile(req.user);

  if (existing) {
    existing.status = 'pending';
    existing.isCouple = isCouple;
    await existing.save();
  } else {
    await TripInterest.create({ trip: trip._id, user: req.user._id, status: 'pending', isCouple });
  }

  // Non-blocking side effects.
  notify(trip.organizer, {
    type: 'join_request',
    title: 'New join request',
    message: `${req.user.fullName} wants to join your ${trip.destination} trip`,
    meta: { tripId: String(trip._id), userId: String(req.user._id) },
  });
  User.findById(trip.organizer)
    .then((organizer) => organizer && sendJoinRequestEmail(organizer, req.user, trip))
    .catch(() => {});

  res.json({
    success: true,
    requestStatus: 'pending',
    filledSeats: trip.filledSeats,
    seatsLeft: trip.seatsLeft,
  });
});

export const respondToRequest = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.id);
  if (!trip) throw ApiError.notFound('Trip not found');
  const isOwner = String(trip.organizer) === String(req.user._id);
  if (!isOwner && req.user.role !== 'admin' && req.user.role !== 'superadmin') throw ApiError.forbidden('Not allowed');

  const action = req.body.action;
  if (!['accept', 'reject'].includes(action)) throw ApiError.badRequest('Action must be "accept" or "reject"');

  const interest = await TripInterest.findOne({ trip: trip._id, user: req.params.userId, status: 'pending' });
  if (!interest) throw ApiError.notFound('No pending request found for that member');

  const requester = await User.findById(req.params.userId);

  if (action === 'accept') {
    const seats = interest.isCouple ? 2 : 1;
    if (trip.seatsLeft < seats) throw ApiError.badRequest('Not enough seats left to accept this request');
    interest.status = 'accepted';
    await interest.save();
    trip.filledSeats = (trip.filledSeats || 0) + seats;
    await trip.save();
    await Group.updateOne({ trip: trip._id }, { $addToSet: { members: interest.user } });

    notify(interest.user, {
      type: 'join_accepted',
      title: "You're in!",
      message: `${req.user.fullName} accepted your request to join the ${trip.destination} trip`,
      meta: { tripId: String(trip._id) },
    });
    if (requester) sendJoinAcceptedEmail(requester, req.user, trip).catch(() => {});
  } else {
    interest.status = 'rejected';
    await interest.save();

    notify(interest.user, {
      type: 'join_rejected',
      title: 'Request declined',
      message: `${req.user.fullName} declined your request to join the ${trip.destination} trip`,
      meta: { tripId: String(trip._id) },
    });
    if (requester) sendJoinRejectedEmail(requester, req.user, trip).catch(() => {});
  }

  res.json({
    success: true,
    status: interest.status,
    filledSeats: trip.filledSeats,
    seatsLeft: trip.seatsLeft,
  });
});

export const uploadTripPhoto = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.id);
  if (!trip) throw ApiError.notFound('Trip not found');
  if (!req.file) throw ApiError.badRequest('Photo file required');

  const photoUrl = await saveUpload(req.file, { owner: req.user._id, kind: 'trip' });
  const photo = await Gallery.create({
    user: req.user._id,
    trip: trip._id,
    photoUrl,
    caption: req.body.caption || trip.destination,
    category: req.body.category || trip.tripType || 'group',
  });
  res.status(201).json({ success: true, photo });
});

export const addExpense = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.id);
  if (!trip) throw ApiError.notFound('Trip not found');
  const isOwner = String(trip.organizer) === String(req.user._id);
  if (!isOwner && req.user.role !== 'admin' && req.user.role !== 'superadmin') throw ApiError.forbidden('Not allowed');

  trip.expenses.push({
    category: req.body.category,
    description: req.body.description,
    amount: Number(req.body.amount),
    addedBy: req.user._id,
  });
  await trip.save();
  res.status(201).json({ success: true, trip: trip.toJSON() });
});
