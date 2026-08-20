// ============================================================
//  Travel clubs - persistent bikers/cars/offroading groups. A club IS a
//  Group document (type 'club') so it reuses the existing chat thread
//  (Message model, /chat/groups/:id/messages) for free - this controller
//  only adds the club-specific surface: discovery, admins, join requests.
// ============================================================
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import Group from '../models/Group.js';
import User from '../models/User.js';
import { notify } from '../utils/notify.js';
import { saveUpload } from '../utils/uploadStore.js';
import { findUserByIdentifier } from '../utils/findUserByIdentifier.js';

const MEMBER_FIELDS = 'fullName avatarUrl city isVerified role vehicleType';
const OWNER_FIELDS = 'fullName avatarUrl isVerified';
// Non-members get a small teaser of the roster (public directory info only,
// same fields already visible on the Members page) - the full list is a
// membership perk, not a secret, so this is just a taste, not a lockout.
const PREVIEW_MEMBER_COUNT = 6;

// A club that requires owning a "Bike" to create a bikers club, a "Car" for
// cars/offroading, and any vehicle at all for the catch-all "other" category -
// mirrors the request: "anyone who owns the vehicle can create a club".
const CATEGORY_VEHICLE = {
  bikers: ['Bike'],
  cars: ['Car'],
  offroading: ['Car'],
  other: ['Bike', 'Car', 'Bus', 'Other'],
};

function preview(club, viewerId) {
  const isMember = viewerId ? club.members.some((m) => String(m) === String(viewerId)) : false;
  const hasRequested = viewerId ? club.joinRequests.some((m) => String(m) === String(viewerId)) : false;
  return {
    _id: club._id,
    name: club.name,
    description: club.description || '',
    photoUrl: club.photoUrl || '',
    coverPhotoUrl: club.coverPhotoUrl || '',
    category: club.category,
    owner: club.owner,
    memberCount: club.members.length,
    isMember,
    isAdmin: viewerId ? club.isAdmin(viewerId) : false,
    isOwner: viewerId ? String(club.owner?._id || club.owner) === String(viewerId) : false,
    hasRequested,
    createdAt: club.createdAt,
  };
}

// GET /clubs - browse/discover (public, optional auth for isMember flags).
export const listClubs = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const { category, search } = req.query;

  const filter = { type: 'club' };
  if (category && category !== 'all') filter.category = category;
  if (search) filter.name = { $regex: search.trim(), $options: 'i' };

  const [clubs, total] = await Promise.all([
    Group.find(filter)
      .populate('owner', OWNER_FIELDS)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Group.countDocuments(filter),
  ]);

  res.json({
    success: true,
    clubs: clubs.map((c) => preview(c, req.user?._id)),
    page,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    total,
  });
});

// GET /clubs/:id - full detail for members/admins, preview for everyone else.
export const getClub = asyncHandler(async (req, res) => {
  const club = await Group.findOne({ _id: req.params.id, type: 'club' });
  if (!club) throw ApiError.notFound('Club not found');

  const viewerId = req.user?._id;
  // Compute every membership flag up front, while members/admins/joinRequests
  // are still raw ObjectIds - populating those arrays below turns entries
  // into full User docs, and `String(populatedDoc)` no longer matches a
  // plain id string, so these can't be recomputed after populate() runs.
  const isMember = viewerId ? club.hasMember(viewerId) : false;
  const isAdmin = viewerId ? club.isAdmin(viewerId) : false;
  const isOwner = viewerId ? String(club.owner) === String(viewerId) : false;
  const hasRequested = viewerId ? club.joinRequests.some((m) => String(m) === String(viewerId)) : false;

  await club.populate([{ path: 'owner', select: OWNER_FIELDS }]);

  const base = {
    _id: club._id,
    name: club.name,
    description: club.description || '',
    photoUrl: club.photoUrl || '',
    coverPhotoUrl: club.coverPhotoUrl || '',
    category: club.category,
    owner: club.owner,
    memberCount: club.members.length,
    isMember,
    isAdmin,
    isOwner,
    hasRequested,
    createdAt: club.createdAt,
  };

  if (!isMember) {
    const previewMembers = await User.find({ _id: { $in: club.members.slice(0, PREVIEW_MEMBER_COUNT) } }).select(MEMBER_FIELDS);
    return res.json({ success: true, club: { ...base, previewMembers } });
  }

  await club.populate([
    { path: 'members', select: MEMBER_FIELDS },
    { path: 'admins', select: MEMBER_FIELDS },
    ...(isAdmin ? [{ path: 'joinRequests', select: MEMBER_FIELDS }] : []),
  ]);

  res.json({
    success: true,
    club: {
      ...base,
      members: club.members,
      admins: club.admins,
      pendingRequests: isAdmin ? club.joinRequests : undefined,
    },
  });
});

// POST /clubs - create a club (membership + complete profile + vehicle
// ownership matching the chosen category required).
export const createClub = asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const category = String(req.body.category || '').trim();
  if (!name) throw ApiError.badRequest('Club name is required');
  if (!CATEGORY_VEHICLE[category]) throw ApiError.badRequest('Choose a valid club category');

  if (!req.user.hasVehicle || !CATEGORY_VEHICLE[category].includes(req.user.vehicleType)) {
    const needs = category === 'bikers' ? 'a bike' : category === 'other' ? 'a vehicle' : 'a car';
    throw ApiError.forbidden(`You need ${needs} on your profile to create a ${category} club`);
  }

  const photoFile = req.files?.photo?.[0];
  const coverFile = req.files?.cover?.[0];

  const club = await Group.create({
    name,
    description: String(req.body.description || '').trim().slice(0, 500),
    type: 'club',
    category,
    owner: req.user._id,
    admins: [req.user._id],
    members: [req.user._id],
    photoUrl: photoFile ? await saveUpload(photoFile, { owner: req.user._id, kind: 'club' }) : '',
    coverPhotoUrl: coverFile ? await saveUpload(coverFile, { owner: req.user._id, kind: 'club' }) : '',
  });

  res.status(201).json({ success: true, club: preview(club, req.user._id) });
});

// PATCH /clubs/:id - update name/description/photo (owner/admin only).
export const updateClub = asyncHandler(async (req, res) => {
  const club = await Group.findOne({ _id: req.params.id, type: 'club' });
  if (!club) throw ApiError.notFound('Club not found');
  if (!club.isAdmin(req.user._id)) throw ApiError.forbidden('Only club admins can update this club');

  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) throw ApiError.badRequest('Club name cannot be empty');
    club.name = name;
  }
  if (req.body.description !== undefined) {
    club.description = String(req.body.description).trim().slice(0, 500);
  }
  if (req.body.removePhoto === 'true' || req.body.removePhoto === true) {
    club.photoUrl = '';
  }
  if (req.body.removeCoverPhoto === 'true' || req.body.removeCoverPhoto === true) {
    club.coverPhotoUrl = '';
  }
  const photoFile = req.files?.photo?.[0];
  const coverFile = req.files?.cover?.[0];
  if (photoFile) {
    club.photoUrl = await saveUpload(photoFile, { owner: req.user._id, kind: 'club' });
  }
  if (coverFile) {
    club.coverPhotoUrl = await saveUpload(coverFile, { owner: req.user._id, kind: 'club' });
  }
  await club.save();

  res.json({ success: true, club: preview(club, req.user._id) });
});

// DELETE /clubs/:id - disband the club (owner only).
export const deleteClub = asyncHandler(async (req, res) => {
  const club = await Group.findOne({ _id: req.params.id, type: 'club' });
  if (!club) throw ApiError.notFound('Club not found');
  if (String(club.owner) !== String(req.user._id)) throw ApiError.forbidden('Only the club owner can disband it');
  await club.deleteOne();
  res.json({ success: true });
});

// POST /clubs/:id/join - request to join (toggle: calling again while
// pending withdraws the request). Membership itself only happens once an
// admin approves it via respondToRequest.
export const requestToJoin = asyncHandler(async (req, res) => {
  const club = await Group.findOne({ _id: req.params.id, type: 'club' });
  if (!club) throw ApiError.notFound('Club not found');
  if (club.hasMember(req.user._id)) throw ApiError.badRequest("You're already a member of this club");

  const alreadyRequested = club.joinRequests.some((m) => String(m) === String(req.user._id));
  if (alreadyRequested) {
    club.joinRequests = club.joinRequests.filter((m) => String(m) !== String(req.user._id));
    await club.save();
    return res.json({ success: true, requestStatus: null });
  }

  club.joinRequests.push(req.user._id);
  await club.save();

  [club.owner, ...club.admins]
    .filter((a, i, arr) => arr.findIndex((x) => String(x) === String(a)) === i)
    .forEach((adminId) => {
      notify(adminId, {
        type: 'club',
        title: 'New club join request',
        message: `${req.user.fullName} wants to join "${club.name}"`,
        meta: { groupId: String(club._id) },
      });
    });

  res.json({ success: true, requestStatus: 'pending' });
});

// PATCH /clubs/:id/requests/:userId - approve/reject a pending join request (admin only).
export const respondToRequest = asyncHandler(async (req, res) => {
  const club = await Group.findOne({ _id: req.params.id, type: 'club' });
  if (!club) throw ApiError.notFound('Club not found');
  if (!club.isAdmin(req.user._id)) throw ApiError.forbidden('Only club admins can manage join requests');

  const { userId } = req.params;
  const action = req.body.action === 'accept' ? 'accept' : 'reject';
  const wasPending = club.joinRequests.some((m) => String(m) === String(userId));
  if (!wasPending) throw ApiError.notFound('No pending request from that member');

  club.joinRequests = club.joinRequests.filter((m) => String(m) !== String(userId));
  if (action === 'accept' && !club.hasMember(userId)) club.members.push(userId);
  await club.save();

  notify(userId, {
    type: 'club',
    title: action === 'accept' ? 'Club request accepted' : 'Club request declined',
    message:
      action === 'accept'
        ? `You're now a member of "${club.name}"!`
        : `Your request to join "${club.name}" was declined.`,
    meta: { groupId: String(club._id) },
  });

  res.json({ success: true });
});

// POST /clubs/:id/members - add a member directly by User ID, username,
// mobile number, or email (admin only) - same as WhatsApp "add participant".
export const addMember = asyncHandler(async (req, res) => {
  const club = await Group.findOne({ _id: req.params.id, type: 'club' });
  if (!club) throw ApiError.notFound('Club not found');
  if (!club.isAdmin(req.user._id)) throw ApiError.forbidden('Only club admins can add members');

  const { identifier, userId, username, mobile, email } = req.body;
  const target = await findUserByIdentifier(identifier || userId || username || mobile || email);
  if (!target || !target.isActive) throw ApiError.notFound('No active member found for that ID, username, mobile number, or email');

  if (club.hasMember(target._id)) return res.json({ success: true, alreadyMember: true });

  club.members.push(target._id);
  club.joinRequests = club.joinRequests.filter((m) => String(m) !== String(target._id));
  await club.save();

  notify(target._id, {
    type: 'club',
    title: 'Added to a club',
    message: `${req.user.fullName} added you to "${club.name}"`,
    meta: { groupId: String(club._id) },
  });

  const populated = await club.populate('members', MEMBER_FIELDS);
  res.json({ success: true, members: populated.members });
});

// DELETE /clubs/:id/members/:userId - remove a member (admin) or leave (self).
export const removeMember = asyncHandler(async (req, res) => {
  const club = await Group.findOne({ _id: req.params.id, type: 'club' });
  if (!club) throw ApiError.notFound('Club not found');

  const targetId = req.params.userId;
  const isSelf = String(targetId) === String(req.user._id);
  if (!isSelf && !club.isAdmin(req.user._id)) throw ApiError.forbidden('Only club admins can remove members');
  if (String(club.owner) === String(targetId)) {
    throw ApiError.badRequest(isSelf ? 'Transfer or disband the club instead of leaving as owner' : 'The club owner cannot be removed');
  }

  club.members = club.members.filter((m) => String(m) !== String(targetId));
  club.admins = club.admins.filter((m) => String(m) !== String(targetId));
  await club.save();
  res.json({ success: true });
});

// POST /clubs/:id/admins/:userId - promote a member to admin (owner/admin only).
export const addAdmin = asyncHandler(async (req, res) => {
  const club = await Group.findOne({ _id: req.params.id, type: 'club' });
  if (!club) throw ApiError.notFound('Club not found');
  if (!club.isAdmin(req.user._id)) throw ApiError.forbidden('Only club admins can promote other admins');

  const targetId = req.params.userId;
  if (!club.hasMember(targetId)) throw ApiError.badRequest('Only existing club members can be made admin');
  if (!club.admins.some((a) => String(a) === String(targetId))) club.admins.push(targetId);
  await club.save();

  notify(targetId, {
    type: 'club',
    title: 'You are now a club admin',
    message: `${req.user.fullName} made you an admin of "${club.name}"`,
    meta: { groupId: String(club._id) },
  });

  res.json({ success: true });
});

// DELETE /clubs/:id/admins/:userId - demote an admin back to a regular
// member (owner only - the owner is always an admin and can't be demoted).
export const removeAdmin = asyncHandler(async (req, res) => {
  const club = await Group.findOne({ _id: req.params.id, type: 'club' });
  if (!club) throw ApiError.notFound('Club not found');
  if (String(club.owner) !== String(req.user._id)) throw ApiError.forbidden('Only the club owner can demote admins');
  if (String(club.owner) === String(req.params.userId)) throw ApiError.badRequest('The owner is always an admin');

  club.admins = club.admins.filter((a) => String(a) !== String(req.params.userId));
  await club.save();
  res.json({ success: true });
});
