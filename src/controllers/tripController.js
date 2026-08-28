// ============================================================
//  Trip controller.
// ============================================================
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import Trip from '../models/Trip.js';
import TripInterest from '../models/TripInterest.js';
import Gallery from '../models/Gallery.js';
import Review from '../models/Review.js';
import MemberReview from '../models/MemberReview.js';
import User from '../models/User.js';
import Group from '../models/Group.js';
import { saveUpload } from '../utils/uploadStore.js';
import { notify } from '../utils/notify.js';
import { sendJoinRequestEmail, sendJoinAcceptedEmail, sendJoinRejectedEmail } from '../utils/email.js';
import { fetchDestinationPhoto } from '../utils/pexels.js';
import { estimateTripCost } from '../utils/tripCost.js';
import { pick } from '../utils/parse.js';
import { sweepExpiredTrips, deleteTripCascade } from '../utils/tripLifecycle.js';
import { ensureCityGeocoded } from '../utils/geocode.js';

const rx = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
// The "Leaving from"/"Going to" fields are filled by PlaceAutocomplete's
// "City, State" suggestion labels, but trips just store the plain city a
// host typed (e.g. "Mohali") - matching against the full label would never
// find it. Match on the part before the first comma instead.
const primaryPlace = (s) => String(s).split(',')[0].trim();

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
  await sweepExpiredTrips();
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

  // Gender-restricted trips only show up for travelers with a matching
  // gender on file - everyone else (including logged-out visitors) only
  // sees 'Any' trips. Trips saved before this field existed have no
  // genderPreference at all, so treat "missing" the same as 'Any'.
  const visibleGenders = ['Any'];
  if (req.user?.gender === 'Male' || req.user?.gender === 'Female') visibleGenders.push(req.user.gender);
  filter.$and = [
    { $or: [{ genderPreference: { $exists: false } }, { genderPreference: { $in: visibleGenders } }] },
  ];

  // BlaBlaCar-style ride search: leaving from / going to / travel date / seats needed.
  if (from) filter.origin = rx(primaryPlace(from));
  if (to) filter.destination = rx(primaryPlace(to));
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
      .populate('organizer', 'fullName username city avatarUrl isVerified vehicleModel')
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
  await sweepExpiredTrips();
  const trips = await Trip.find({ organizer: req.user._id })
    .populate('organizer', 'fullName username city avatarUrl isVerified vehicleModel')
    .sort({ createdAt: -1 });
  const data = await attachCounts(trips, req.user._id);

  // Trips this member joined as a co-traveler (accepted, not organizer) -
  // powers the "Trips joined" section alongside "My Trips" (hosted) above.
  const joinedInterests = await TripInterest.find({ user: req.user._id, status: 'accepted' })
    .sort({ createdAt: -1 })
    .populate({
      path: 'trip',
      populate: { path: 'organizer', select: 'fullName username city avatarUrl isVerified vehicleModel' },
    });
  const joinedTripDocs = joinedInterests.map((i) => i.trip).filter(Boolean);
  const joinedTrips = await attachCounts(joinedTripDocs, req.user._id);

  res.json({ success: true, trips: data, joinedTrips });
});

const MEMBER_FIELDS = 'fullName username city avatarUrl isVerified vehicleModel';
const MEMBER_FIELDS_WITH_PARTNER = `${MEMBER_FIELDS} partnerMobile partnerDocUrl`;

export const getTrip = asyncHandler(async (req, res) => {
  await sweepExpiredTrips();
  const trip = await Trip.findById(req.params.id).populate(
    'organizer',
    'fullName username city avatarUrl isVerified profession vehicleType vehicleModel partnerMobile partnerDocUrl'
  );
  if (!trip) throw ApiError.notFound('Trip not found');

  const isOrganizer = req.user && String(trip.organizer._id) === String(req.user._id);
  const isAdmin = req.user && (req.user.role === 'admin' || req.user.role === 'superadmin');

  if (trip.genderPreference && trip.genderPreference !== 'Any' && !isOrganizer && !isAdmin) {
    if (req.user?.gender !== trip.genderPreference) {
      throw ApiError.forbidden(`This trip is only open to ${trip.genderPreference.toLowerCase()} travelers`);
    }
  }

  // Partner mobile/ID doc are safety info collected about someone who isn't
  // a registered user - only ever surfaced to admins, never to the organizer
  // or the public (the organizer only needs to know *who* they're travelling with).
  const memberSelect = isAdmin ? MEMBER_FIELDS_WITH_PARTNER : MEMBER_FIELDS;

  const [accepted, photos, reviews] = await Promise.all([
    TripInterest.find({ trip: trip._id, status: 'accepted' })
      .populate('user', memberSelect)
      .limit(12),
    Gallery.find({ trip: trip._id }).populate('user', 'fullName avatarUrl').sort({ createdAt: -1 }),
    Review.find({ trip: trip._id }).populate('user', 'fullName avatarUrl').sort({ createdAt: -1 }),
  ]);

  let requestStatus = null;
  if (req.user) {
    const mine = await TripInterest.findOne({ trip: trip._id, user: req.user._id }).select('status');
    requestStatus = mine?.status || null;
  }

  // Only travelers who were actually on the trip - organizer or an
  // accepted co-traveler - can leave a review, and only once it's over.
  const canReview = trip.status === 'completed' && (isOrganizer || requestStatus === 'accepted');
  const myReview = req.user ? reviews.find((r) => String(r.user?._id) === String(req.user._id)) || null : null;

  // Same eligibility as canReview, but for rating individual co-travelers
  // rather than the trip overall.
  const canRateMembers = canReview;
  const myMemberReviews = req.user
    ? await MemberReview.find({ trip: trip._id, rater: req.user._id }).select('ratee rating message')
    : [];

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
      reviews,
      canReview,
      myReview,
      canRateMembers,
      myMemberReviews,
    },
  });
});

// Fuel + toll estimate for the route a host is about to post - a planning
// aid, not something stored on the trip. Distance comes from OSRM (free,
// keyless routing over OpenStreetMap data); fuel/toll are approximated from
// the vehicle's mileage and India-wide average rates (see utils/tripCost.js).
export const estimateCost = asyncHandler(async (req, res) => {
  const { origin, viaStops, destination, mileageKmpl, fuelType, vehicleType } = req.body;
  if (!origin || !destination) throw ApiError.badRequest('Origin and destination are required');
  const mileage = Number(mileageKmpl);
  if (!mileage || mileage <= 0) throw ApiError.badRequest("Enter your vehicle's mileage (km/l)");

  const estimate = await estimateTripCost({
    origin,
    viaStops: Array.isArray(viaStops) ? viaStops : [],
    destination,
    mileageKmpl: mileage,
    fuelType,
    vehicleType,
  });
  if (!estimate) {
    throw ApiError.badRequest("Couldn't find a driving route between those places - check the spelling and try again");
  }
  res.json({ success: true, estimate });
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
  'budgetIncludes',
  'genderPreference',
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

  // A Trip Pass host (no active duration membership) spends one host
  // credit per trip created - requireTripHostAccess already confirmed
  // they have one. Full members don't touch their credit pool at all.
  const usingHostCredit = !req.user.hasActiveMembership();
  if (usingHostCredit) trip.creditConsumed = true;
  await trip.save();
  if (usingHostCredit) {
    req.user.hostCredits = Math.max(0, req.user.hostCredits - 1);
    await req.user.save();
  }

  // Auto-create the trip chat group with the organizer as owner/member.
  await Group.create({
    name: trip.routeLabel,
    type: 'trip',
    trip: trip._id,
    owner: req.user._id,
    members: [req.user._id],
  });

  await trip.populate('organizer', 'fullName username city avatarUrl isVerified vehicleModel');
  res.status(201).json({ success: true, trip: { ...trip.toJSON(), interestCount: 0, requestStatus: null } });
});

export const updateTrip = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.id);
  if (!trip) throw ApiError.notFound('Trip not found');
  const isOwner = String(trip.organizer) === String(req.user._id);
  if (!isOwner && req.user.role !== 'admin' && req.user.role !== 'superadmin') throw ApiError.forbidden('Not allowed');

  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  // filledSeats is derived from accepted TripInterest records - only admins
  // may override it directly (manual correction), never the organizer, who
  // could otherwise fake a "sold out" trip or overshoot totalSeats.
  const payload = pick(req.body, [...CREATE_FIELDS, 'status', ...(isAdmin ? ['filledSeats'] : [])]);

  // A completed trip's details are history - not editable by its organizer
  // (though they can still revert its status alone, e.g. if it was marked
  // completed by mistake, which is why this checks "any other field", not
  // "any change at all"). Admins keep full edit access for moderation.
  const changingMoreThanStatus = Object.keys(payload).some((k) => k !== 'status');
  if (trip.status === 'completed' && changingMoreThanStatus && !isAdmin) {
    throw ApiError.badRequest('A completed trip cannot be edited - change its status first if this was a mistake');
  }

  // Same bike-seat cap as trip creation (tripRules) - a bike only fits the
  // rider plus one pillion.
  const resultingVehicleType = payload.vehicleType ?? trip.vehicleType;
  const resultingTotalSeats = payload.totalSeats ?? trip.totalSeats;
  if (resultingVehicleType === 'Bike' && Number(resultingTotalSeats) > 1) {
    throw ApiError.badRequest('A bike trip can only have 1 seat for a co-traveler');
  }

  const destinationChanged = payload.destination && payload.destination !== trip.destination;
  const turningCouplesModeOn = payload.isCouplesMode && !trip.isCouplesMode;
  if (turningCouplesModeOn) {
    const organizerUser = isOwner ? req.user : await User.findById(trip.organizer);
    assertPartnerInfoOnFile(organizerUser);
  }
  Object.assign(trip, payload);
  if (destinationChanged) trip.coverImageUrl = await fetchDestinationPhoto(trip.destination);
  await trip.save();
  if (payload.status === 'completed') ensureCityGeocoded(trip.destination);
  res.json({ success: true, trip: trip.toJSON() });
});

export const deleteTrip = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.id);
  if (!trip) throw ApiError.notFound('Trip not found');
  const isOwner = String(trip.organizer) === String(req.user._id);
  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isOwner && !isAdmin) throw ApiError.forbidden('Not allowed');
  if (trip.status === 'completed' && !isAdmin) {
    throw ApiError.badRequest('A completed trip cannot be deleted - it may have photos, reviews, and ratings attached');
  }

  // Refund the host credit if the organizer paid for this trip with one
  // and nobody has joined yet - covers an honest mistake (wrong dates,
  // wrong destination) without letting a trip that already gained members
  // be deleted and "recreated" to farm free credits.
  if (trip.creditConsumed && (trip.filledSeats || 0) === 0 && isOwner) {
    await User.updateOne({ _id: trip.organizer }, { $inc: { hostCredits: 1 } });
  }

  await deleteTripCascade(trip);
  res.json({ success: true, message: 'Trip deleted' });
});

export const requestToJoin = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.id);
  if (!trip) throw ApiError.notFound('Trip not found');
  if (String(trip.organizer) === String(req.user._id)) {
    throw ApiError.badRequest("You can't join a trip you organize");
  }
  if (trip.genderPreference && trip.genderPreference !== 'Any' && req.user.gender !== trip.genderPreference) {
    throw ApiError.forbidden(`This trip is only open to ${trip.genderPreference.toLowerCase()} travelers`);
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
  // Refund the join credit it spent - nothing was ever actually joined.
  if (existing && existing.status === 'pending') {
    if (existing.creditConsumed) {
      req.user.joinCredits += 1;
      await req.user.save();
    }
    await existing.deleteOne();
    return res.json({
      success: true,
      requestStatus: null,
      filledSeats: trip.filledSeats,
      seatsLeft: trip.seatsLeft,
    });
  }

  // No existing request, or a previously-rejected one → (re-)request. This
  // is the one branch that actually spends a Trip Pass join credit (or
  // requires an active duration membership), so the access check happens
  // here rather than as a route-level gate - withdrawing/leaving above
  // must never be blocked by having 0 credits left.
  if (!req.user.hasTripJoinAccess()) {
    throw ApiError.forbidden('An active membership or a trip-joining credit is required', 'TRIP_JOIN_ACCESS_REQUIRED');
  }
  if (req.user.role === 'member' && (!req.user.verificationLevel || req.user.verificationLevel === 'none')) {
    throw ApiError.forbidden('Your profile needs to be admin-verified before you can join trips.', 'VERIFICATION_REQUIRED');
  }

  const isCouple = trip.isCouplesMode;
  if (isCouple) assertPartnerInfoOnFile(req.user);

  const usingJoinCredit = !req.user.hasActiveMembership();
  if (usingJoinCredit) {
    req.user.joinCredits = Math.max(0, req.user.joinCredits - 1);
    await req.user.save();
  }

  if (existing) {
    existing.status = 'pending';
    existing.isCouple = isCouple;
    existing.creditConsumed = usingJoinCredit;
    await existing.save();
  } else {
    await TripInterest.create({ trip: trip._id, user: req.user._id, status: 'pending', isCouple, creditConsumed: usingJoinCredit });
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
    // Belt-and-suspenders on top of the totalSeats cap enforced at
    // creation/edit time - a bike only fits the rider plus one pillion.
    if (trip.vehicleType === 'Bike' && (trip.filledSeats || 0) >= 1) {
      throw ApiError.badRequest('A bike trip can only have one co-traveler');
    }
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

    // Declined, not joined - refund the join credit it spent, if any.
    if (interest.creditConsumed && requester) {
      requester.joinCredits += 1;
      await requester.save();
    }

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

  // Only people who actually went on the trip - the organizer or an
  // accepted co-traveler - can add photos to it. Admins moderate (delete)
  // from the gallery instead of uploading on someone else's behalf.
  const isOrganizer = String(trip.organizer) === String(req.user._id);
  if (!isOrganizer) {
    const isMember = await TripInterest.exists({ trip: trip._id, user: req.user._id, status: 'accepted' });
    if (!isMember) throw ApiError.forbidden('Only trip members can add photos to this trip');
  }

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

export const createTripReview = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.id);
  if (!trip) throw ApiError.notFound('Trip not found');
  if (trip.status !== 'completed') {
    throw ApiError.badRequest('You can only review a trip after it has been completed');
  }

  // Same "actually went on the trip" check as uploadTripPhoto.
  const isOrganizer = String(trip.organizer) === String(req.user._id);
  if (!isOrganizer) {
    const isMember = await TripInterest.exists({ trip: trip._id, user: req.user._id, status: 'accepted' });
    if (!isMember) throw ApiError.forbidden('Only trip members can review this trip');
  }

  // Upsert so re-submitting edits a member's existing review instead of
  // hitting the {trip,user} unique index as a duplicate-key error.
  const review = await Review.findOneAndUpdate(
    { trip: trip._id, user: req.user._id },
    {
      trip: trip._id,
      user: req.user._id,
      rating: Number(req.body.rating),
      message: req.body.message,
      tripDestination: trip.destination,
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).populate('user', 'fullName city avatarUrl isVerified');

  res.status(201).json({ success: true, review });
});

// Rate a specific co-traveler from a completed trip - "how was it
// travelling with this person" - distinct from createTripReview above,
// which rates the trip as a whole.
export const rateMember = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.id);
  if (!trip) throw ApiError.notFound('Trip not found');
  if (trip.status !== 'completed') {
    throw ApiError.badRequest('You can only rate co-travelers after the trip has been completed');
  }

  const raterId = req.user._id;
  const rateeId = req.body.rateeId;
  if (String(rateeId) === String(raterId)) throw ApiError.badRequest("You can't rate yourself");

  const isOnTrip = async (userId) =>
    String(trip.organizer) === String(userId) ||
    (await TripInterest.exists({ trip: trip._id, user: userId, status: 'accepted' }));

  if (!(await isOnTrip(raterId))) throw ApiError.forbidden('Only trip members can rate co-travelers');
  if (!(await isOnTrip(rateeId))) throw ApiError.badRequest('That person was not on this trip');

  const review = await MemberReview.findOneAndUpdate(
    { trip: trip._id, rater: raterId, ratee: rateeId },
    { trip: trip._id, rater: raterId, ratee: rateeId, rating: Number(req.body.rating), message: req.body.message || '' },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  res.status(201).json({ success: true, review });
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
