// ============================================================
//  Chat controller — trip chats + custom groups + messages.
//  Messaging uses simple polling from the client (GET ?after=...).
// ============================================================
import mongoose from 'mongoose';
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import Group from '../models/Group.js';
import Message from '../models/Message.js';
import Trip from '../models/Trip.js';
import TripInterest from '../models/TripInterest.js';
import User from '../models/User.js';
import { notify } from '../utils/notify.js';

const isId = (v) => mongoose.isValidObjectId(v);
const MEMBER_FIELDS = 'fullName avatarUrl city isVerified';

// Ensure the trip's group exists and its membership is in sync with
// (organizer + everyone who has shown interest). Handles legacy trips.
async function ensureTripGroup(trip) {
  const interested = await TripInterest.find({ trip: trip._id }).select('user');
  const memberIds = [...new Set([String(trip.organizer), ...interested.map((i) => String(i.user))])];

  let group = await Group.findOne({ trip: trip._id });
  if (!group) {
    group = await Group.create({
      name: trip.title || trip.destination,
      type: 'trip',
      trip: trip._id,
      owner: trip.organizer,
      members: memberIds,
    });
  } else {
    group.members = memberIds;
    if (!group.name) group.name = trip.title || trip.destination;
    await group.save();
  }
  return group;
}

// Authorise access to a group. For trip groups, fall back to a live
// organizer/interest check and self-heal membership.
async function ensureAccess(group, userId) {
  if (group.hasMember(userId)) return;
  if (group.type === 'trip') {
    const isOrganizer = String(group.owner) === String(userId);
    const hasInterest = isOrganizer
      ? false
      : Boolean(await TripInterest.exists({ trip: group.trip, user: userId }));
    if (isOrganizer || hasInterest) {
      group.members.push(userId);
      await group.save();
      return;
    }
  }
  throw ApiError.forbidden('You are not a member of this chat');
}

// GET /chat/groups — groups I'm in.
export const getMyGroups = asyncHandler(async (req, res) => {
  const groups = await Group.find({ members: req.user._id })
    .populate('trip', 'destination title coverImageUrl status')
    .populate('owner', 'fullName')
    .sort({ lastMessageAt: -1, updatedAt: -1 });

  res.json({
    success: true,
    groups: groups.map((g) => ({
      _id: g._id,
      name: g.name,
      type: g.type,
      trip: g.trip,
      owner: g.owner,
      isOwner: String(g.owner?._id || g.owner) === String(req.user._id),
      memberCount: g.members.length,
      lastMessageAt: g.lastMessageAt,
      lastMessageText: g.lastMessageText,
    })),
  });
});

// GET /chat/trip/:tripId — get (or create) the chat for a trip.
export const getTripGroup = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.tripId);
  if (!trip) throw ApiError.notFound('Trip not found');

  const group = await ensureTripGroup(trip);
  await ensureAccess(group, req.user._id); // organizer or interested only
  res.json({ success: true, groupId: group._id });
});

// GET /chat/groups/:groupId — group detail + members (members only).
export const getGroup = asyncHandler(async (req, res) => {
  const group = await Group.findById(req.params.groupId)
    .populate('members', MEMBER_FIELDS)
    .populate('owner', 'fullName avatarUrl')
    .populate('trip', 'destination title');
  if (!group) throw ApiError.notFound('Group not found');
  await ensureAccess(group, req.user._id);

  res.json({
    success: true,
    group: {
      _id: group._id,
      name: group.name,
      type: group.type,
      trip: group.trip,
      owner: group.owner,
      isOwner: String(group.owner?._id || group.owner) === String(req.user._id),
      members: group.members,
    },
  });
});

// POST /chat/groups — create a custom group with members by id.
export const createGroup = asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw ApiError.badRequest('Group name is required');

  const rawIds = Array.isArray(req.body.memberIds)
    ? req.body.memberIds
    : String(req.body.memberIds || '')
        .split(/[\s,]+/)
        .filter(Boolean);

  const valid = rawIds.filter(isId);
  const found = valid.length ? await User.find({ _id: { $in: valid }, isActive: true }).select('_id') : [];
  const memberIds = [...new Set([String(req.user._id), ...found.map((u) => String(u._id))])];

  const group = await Group.create({
    name,
    type: 'custom',
    owner: req.user._id,
    members: memberIds,
  });

  // Notify the added members.
  found.forEach((u) => {
    if (String(u._id) !== String(req.user._id)) {
      notify(u._id, {
        type: 'group',
        title: 'Added to a group 💬',
        message: `${req.user.fullName} added you to "${name}"`,
        meta: { groupId: String(group._id) },
      });
    }
  });

  res.status(201).json({ success: true, groupId: group._id });
});

// POST /chat/groups/:groupId/members — add a member by userId or email (owner/admin).
export const addMember = asyncHandler(async (req, res) => {
  const group = await Group.findById(req.params.groupId);
  if (!group) throw ApiError.notFound('Group not found');
  const isOwner = String(group.owner) === String(req.user._id);
  if (!isOwner && req.user.role !== 'admin') throw ApiError.forbidden('Only the group owner can add members');

  const { userId, email } = req.body;
  let target = null;
  if (userId && isId(userId)) target = await User.findById(userId);
  else if (email) target = await User.findOne({ email: String(email).toLowerCase().trim() });
  if (!target || !target.isActive) throw ApiError.notFound('No active user found for that id/email');

  if (group.hasMember(target._id)) {
    return res.json({ success: true, alreadyMember: true });
  }
  group.members.push(target._id);
  await group.save();

  notify(target._id, {
    type: 'group',
    title: 'Added to a group 💬',
    message: `${req.user.fullName} added you to "${group.name}"`,
    meta: { groupId: String(group._id) },
  });

  const populated = await group.populate('members', MEMBER_FIELDS);
  res.json({ success: true, members: populated.members });
});

// DELETE /chat/groups/:groupId/members/:userId — remove member (owner/admin) or leave (self).
export const removeMember = asyncHandler(async (req, res) => {
  const group = await Group.findById(req.params.groupId);
  if (!group) throw ApiError.notFound('Group not found');

  const targetId = req.params.userId;
  const isOwner = String(group.owner) === String(req.user._id);
  const isSelf = String(targetId) === String(req.user._id);
  if (!isOwner && !isSelf && req.user.role !== 'admin') {
    throw ApiError.forbidden('Not allowed');
  }
  if (String(group.owner) === String(targetId)) {
    throw ApiError.badRequest('The owner cannot be removed');
  }

  group.members = group.members.filter((m) => String(m) !== String(targetId));
  await group.save();
  res.json({ success: true });
});

// GET /chat/groups/:groupId/messages?after=ISO — list messages (members only).
export const getMessages = asyncHandler(async (req, res) => {
  const group = await Group.findById(req.params.groupId);
  if (!group) throw ApiError.notFound('Group not found');
  await ensureAccess(group, req.user._id);

  let messages;
  if (req.query.after) {
    const after = new Date(req.query.after);
    messages = await Message.find({ group: group._id, createdAt: { $gt: after } })
      .sort({ createdAt: 1 })
      .limit(100)
      .populate('sender', 'fullName avatarUrl');
  } else {
    const recent = await Message.find({ group: group._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('sender', 'fullName avatarUrl');
    messages = recent.reverse();
  }

  res.json({ success: true, messages });
});

// POST /chat/groups/:groupId/messages — send a message (members only).
export const sendMessage = asyncHandler(async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) throw ApiError.badRequest('Message cannot be empty');
  if (text.length > 2000) throw ApiError.badRequest('Message too long');

  const group = await Group.findById(req.params.groupId);
  if (!group) throw ApiError.notFound('Group not found');
  await ensureAccess(group, req.user._id);

  const message = await Message.create({ group: group._id, sender: req.user._id, text });
  group.lastMessageAt = message.createdAt;
  group.lastMessageText = text.slice(0, 120);
  await group.save();

  await message.populate('sender', 'fullName avatarUrl');
  res.status(201).json({ success: true, message });
});
