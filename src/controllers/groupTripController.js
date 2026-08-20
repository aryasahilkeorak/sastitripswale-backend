// ============================================================
//  Group trip controller - "Bikers Group" / "Cars Group" rides where
//  the vehicle count needed is computed from the target group size
//  (e.g. 3 people on bikes need 2 bikes), unlike a regular Trip which
//  is always exactly one vehicle.
// ============================================================
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import GroupTrip, { GROUP_VEHICLE_CAPACITY } from '../models/GroupTrip.js';
import GroupTripInterest from '../models/GroupTripInterest.js';
import { fetchDestinationPhoto } from '../utils/pexels.js';
import { pick } from '../utils/parse.js';

const MEMBER_FIELDS = 'fullName username city avatarUrl isVerified vehicleModel';

async function attachCounts(groupTrips, userId) {
  const ids = groupTrips.map((g) => g._id);
  const counts = await GroupTripInterest.aggregate([
    { $match: { groupTrip: { $in: ids }, status: 'accepted' } },
    { $group: { _id: '$groupTrip', count: { $sum: 1 } } },
  ]);
  const map = Object.fromEntries(counts.map((c) => [String(c._id), c.count]));
  let mine = new Map();
  if (userId) {
    const my = await GroupTripInterest.find({ groupTrip: { $in: ids }, user: userId }).select('groupTrip status');
    mine = new Map(my.map((i) => [String(i.groupTrip), i.status]));
  }
  return groupTrips.map((g) => ({
    ...g.toJSON(),
    interestCount: map[String(g._id)] || 0,
    requestStatus: mine.get(String(g._id)) || null,
  }));
}

export const getGroupTrips = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const { status, vehicleType, search } = req.query;

  const filter = {};
  filter.status = status || 'upcoming';
  if (vehicleType && GROUP_VEHICLE_CAPACITY[vehicleType]) filter.vehicleType = vehicleType;
  if (search) {
    const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ destination: rx }, { origin: rx }];
  }

  const [groupTrips, total] = await Promise.all([
    GroupTrip.find(filter)
      .populate('organizer', 'fullName username city avatarUrl isVerified vehicleModel')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    GroupTrip.countDocuments(filter),
  ]);

  const data = await attachCounts(groupTrips, req.user?._id);

  res.json({
    success: true,
    groupTrips: data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const getMyGroupTrips = asyncHandler(async (req, res) => {
  const groupTrips = await GroupTrip.find({ organizer: req.user._id })
    .populate('organizer', 'fullName username city avatarUrl isVerified vehicleModel')
    .sort({ createdAt: -1 });
  const data = await attachCounts(groupTrips, req.user._id);
  res.json({ success: true, groupTrips: data });
});

export const getGroupTrip = asyncHandler(async (req, res) => {
  const groupTrip = await GroupTrip.findById(req.params.id).populate(
    'organizer',
    'fullName username city avatarUrl isVerified vehicleType vehicleModel'
  );
  if (!groupTrip) throw ApiError.notFound('Group trip not found');

  const isOrganizer = req.user && String(groupTrip.organizer._id) === String(req.user._id);
  const isAdmin = req.user && (req.user.role === 'admin' || req.user.role === 'superadmin');

  const accepted = await GroupTripInterest.find({ groupTrip: groupTrip._id, status: 'accepted' })
    .populate('user', MEMBER_FIELDS)
    .limit(200);

  let requestStatus = null;
  if (req.user) {
    const mine = await GroupTripInterest.findOne({ groupTrip: groupTrip._id, user: req.user._id }).select('status');
    requestStatus = mine?.status || null;
  }

  let pendingRequests;
  if (isOrganizer || isAdmin) {
    const pending = await GroupTripInterest.find({ groupTrip: groupTrip._id, status: 'pending' })
      .populate('user', MEMBER_FIELDS)
      .sort({ createdAt: 1 });
    pendingRequests = pending.filter((i) => i.user).map((i) => i.user);
  }

  res.json({
    success: true,
    groupTrip: {
      ...groupTrip.toJSON(),
      interestCount: accepted.length,
      requestStatus,
      members: accepted.filter((i) => i.user).map((i) => i.user),
      pendingRequests,
    },
  });
});

const CREATE_FIELDS = [
  'vehicleType',
  'origin',
  'viaStops',
  'destination',
  'description',
  'startDate',
  'endDate',
  'budgetPerHead',
  'pickupLocation',
];

export const createGroupTrip = asyncHandler(async (req, res) => {
  const payload = pick(req.body, CREATE_FIELDS);
  const groupTrip = new GroupTrip({ ...payload, organizer: req.user._id });
  groupTrip.coverImageUrl = await fetchDestinationPhoto(groupTrip.destination);
  await groupTrip.save();
  await groupTrip.populate('organizer', 'fullName username city avatarUrl isVerified vehicleModel');
  res.status(201).json({ success: true, groupTrip: { ...groupTrip.toJSON(), interestCount: 0, requestStatus: null } });
});

export const updateGroupTrip = asyncHandler(async (req, res) => {
  const groupTrip = await GroupTrip.findById(req.params.id);
  if (!groupTrip) throw ApiError.notFound('Group trip not found');
  const isOwner = String(groupTrip.organizer) === String(req.user._id);
  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isOwner && !isAdmin) throw ApiError.forbidden('Not allowed');

  const payload = pick(req.body, [...CREATE_FIELDS, 'status']);

  const changingMoreThanStatus = Object.keys(payload).some((k) => k !== 'status');
  if (groupTrip.status === 'completed' && changingMoreThanStatus && !isAdmin) {
    throw ApiError.badRequest('A completed group trip cannot be edited - change its status first if this was a mistake');
  }

  const destinationChanged = payload.destination && payload.destination !== groupTrip.destination;
  Object.assign(groupTrip, payload);
  if (destinationChanged) groupTrip.coverImageUrl = await fetchDestinationPhoto(groupTrip.destination);
  await groupTrip.save();
  res.json({ success: true, groupTrip: groupTrip.toJSON() });
});

export const deleteGroupTrip = asyncHandler(async (req, res) => {
  const groupTrip = await GroupTrip.findById(req.params.id);
  if (!groupTrip) throw ApiError.notFound('Group trip not found');
  const isOwner = String(groupTrip.organizer) === String(req.user._id);
  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isOwner && !isAdmin) throw ApiError.forbidden('Not allowed');
  if (groupTrip.status === 'completed' && !isAdmin) {
    throw ApiError.badRequest('A completed group trip cannot be deleted');
  }

  await GroupTripInterest.deleteMany({ groupTrip: groupTrip._id });
  await groupTrip.deleteOne();
  res.json({ success: true, message: 'Group trip deleted' });
});

export const requestToJoinGroup = asyncHandler(async (req, res) => {
  const groupTrip = await GroupTrip.findById(req.params.id);
  if (!groupTrip) throw ApiError.notFound('Group trip not found');
  if (String(groupTrip.organizer) === String(req.user._id)) {
    throw ApiError.badRequest("You can't join a group trip you organize");
  }

  const existing = await GroupTripInterest.findOne({ groupTrip: groupTrip._id, user: req.user._id });

  // Already accepted -> this is "leave the group".
  if (existing && existing.status === 'accepted') {
    await existing.deleteOne();
    groupTrip.filledMembers = Math.max(0, (groupTrip.filledMembers || 0) - 1);
    await groupTrip.save();
    return res.json({
      success: true,
      requestStatus: null,
      filledMembers: groupTrip.filledMembers,
      vehiclesNeeded: groupTrip.vehiclesNeeded,
    });
  }

  // Already pending -> withdraw.
  if (existing && existing.status === 'pending') {
    await existing.deleteOne();
    return res.json({ success: true, requestStatus: null });
  }

  // No existing request, or a previously-rejected one -> (re-)request.
  if (existing) {
    existing.status = 'pending';
    await existing.save();
  } else {
    await GroupTripInterest.create({ groupTrip: groupTrip._id, user: req.user._id, status: 'pending' });
  }

  res.json({ success: true, requestStatus: 'pending' });
});

export const respondToGroupRequest = asyncHandler(async (req, res) => {
  const groupTrip = await GroupTrip.findById(req.params.id);
  if (!groupTrip) throw ApiError.notFound('Group trip not found');
  const isOwner = String(groupTrip.organizer) === String(req.user._id);
  if (!isOwner && req.user.role !== 'admin' && req.user.role !== 'superadmin') throw ApiError.forbidden('Not allowed');

  const action = req.body.action;
  if (!['accept', 'reject'].includes(action)) throw ApiError.badRequest('Action must be "accept" or "reject"');

  const interest = await GroupTripInterest.findOne({ groupTrip: groupTrip._id, user: req.params.userId, status: 'pending' });
  if (!interest) throw ApiError.notFound('No pending request found for that member');

  if (action === 'accept') {
    interest.status = 'accepted';
    await interest.save();
    groupTrip.filledMembers = (groupTrip.filledMembers || 0) + 1;
    await groupTrip.save();
  } else {
    interest.status = 'rejected';
    await interest.save();
  }

  res.json({
    success: true,
    status: interest.status,
    filledMembers: groupTrip.filledMembers,
    vehiclesNeeded: groupTrip.vehiclesNeeded,
  });
});
