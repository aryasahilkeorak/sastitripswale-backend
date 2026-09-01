// ============================================================
//  Chat controller - trip chats + custom groups + messages.
//  Messaging uses simple polling from the client (GET ?after=...).
// ============================================================
import mongoose from 'mongoose';
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import Group from '../models/Group.js';
import Message from '../models/Message.js';
import Gallery from '../models/Gallery.js';
import Trip from '../models/Trip.js';
import TripInterest from '../models/TripInterest.js';
import User from '../models/User.js';
import Connection from '../models/Connection.js';
import Follow from '../models/Follow.js';
import Block from '../models/Block.js';
import { notify } from '../utils/notify.js';
import { saveUpload } from '../utils/uploadStore.js';
import { findUserByIdentifier } from '../utils/findUserByIdentifier.js';
import { getSupportBotReply, FALLBACK_REPLY } from '../utils/supportBot.js';
import { matchFaqAnswer } from '../utils/supportFaq.js';
import { containsProfanity } from '../utils/profanityFilter.js';

const isId = (v) => mongoose.isValidObjectId(v);
const MEMBER_FIELDS = 'fullName avatarUrl city isVerified role isServiceAccount';

// Ensure the trip's group exists and its membership is in sync with
// (organizer + everyone who has shown interest). Handles legacy trips.
async function ensureTripGroup(trip) {
  const accepted = await TripInterest.find({ trip: trip._id, status: 'accepted' }).select('user');
  const memberIds = [...new Set([String(trip.organizer), ...accepted.map((i) => String(i.user))])];

  let group = await Group.findOne({ trip: trip._id });
  if (!group) {
    group = await Group.create({
      name: trip.routeLabel,
      type: 'trip',
      trip: trip._id,
      owner: trip.organizer,
      members: memberIds,
    });
  } else {
    group.members = memberIds;
    if (!group.name) group.name = trip.routeLabel;
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
      : Boolean(await TripInterest.exists({ trip: group.trip, user: userId, status: 'accepted' }));
    if (isOrganizer || hasInterest) {
      group.members.push(userId);
      await group.save();
      return;
    }
  }
  throw ApiError.forbidden('You are not a member of this chat');
}

// GET /chat/groups - groups I'm in.
export const getMyGroups = asyncHandler(async (req, res) => {
  const groups = await Group.find({ members: req.user._id })
    .populate('trip', 'origin viaStops destination coverImageUrl status')
    .populate('owner', 'fullName')
    .populate('members', MEMBER_FIELDS)
    .sort({ lastMessageAt: -1, updatedAt: -1 });

  res.json({
    success: true,
    groups: groups.map((g) => ({
      _id: g._id,
      name: g.name,
      photoUrl: g.photoUrl,
      type: g.type,
      trip: g.trip,
      owner: g.owner,
      isOwner: String(g.owner?._id || g.owner) === String(req.user._id),
      memberCount: g.members.length,
      // For DMs the client shows the *other* member, not the group's own name.
      members: g.type === 'dm' ? g.members : undefined,
      dmStatus: g.type === 'dm' ? g.dmStatus : undefined,
      requestedBy: g.type === 'dm' ? g.requestedBy : undefined,
      lastMessageAt: g.lastMessageAt,
      lastMessageText: g.lastMessageText,
      isUnread: (g.unreadFor || []).some((id) => String(id) === String(req.user._id)),
    })),
  });
});

// GET /chat/trip/:tripId - get (or create) the chat for a trip.
export const getTripGroup = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.tripId);
  if (!trip) throw ApiError.notFound('Trip not found');

  const group = await ensureTripGroup(trip);
  await ensureAccess(group, req.user._id); // organizer or interested only
  res.json({ success: true, groupId: group._id });
});

// Shared by getOrCreateDm and getOrCreateSupportChat below.
// Instagram-style message requests: anyone can DM anyone. If the two aren't
// already connected/following each other (and neither side is site admin
// support), the DM starts as a pending "request" - see sendMessage() below
// for how it becomes a normal chat.
async function findOrCreateDmGroup(user, otherId) {
  if (String(otherId) === String(user._id)) throw ApiError.badRequest("You can't message yourself");

  const other = await User.findById(otherId);
  if (!other || !other.isActive) throw ApiError.notFound('Member not found');

  const blocked = await Block.exists({
    $or: [
      { blocker: user._id, blocked: otherId },
      { blocker: otherId, blocked: user._id },
    ],
  });
  if (blocked) throw ApiError.forbidden('You cannot message this member');

  let group = await Group.findOne({ type: 'dm', members: { $all: [user._id, otherId] } });
  if (group && group.members.length !== 2) group = null; // defensive - DMs are always exactly 2 members
  if (!group) {
    // Admins act as official support and can message any member directly -
    // and messaging an admin/support account should likewise never sit as
    // a pending request. Otherwise, an existing accepted Connection or
    // either side already following the other skips the request step too.
    const isSupportSide = ['admin', 'superadmin'].includes(user.role) || ['admin', 'superadmin'].includes(other.role);
    const [connected, followed] = await Promise.all([
      Connection.exists({
        status: 'accepted',
        $or: [
          { sender: user._id, receiver: otherId },
          { sender: otherId, receiver: user._id },
        ],
      }),
      Follow.exists({
        $or: [
          { follower: user._id, following: otherId },
          { follower: otherId, following: user._id },
        ],
      }),
    ]);
    const startsAccepted = isSupportSide || Boolean(connected) || Boolean(followed);

    group = await Group.create({
      name: other.fullName,
      type: 'dm',
      owner: user._id,
      members: [user._id, otherId],
      dmStatus: startsAccepted ? 'accepted' : 'pending',
      requestedBy: startsAccepted ? undefined : user._id,
    });

    if (!startsAccepted) {
      notify(otherId, {
        type: 'message_request',
        title: 'New message request',
        message: `${user.fullName} sent you a message request`,
        meta: { groupId: String(group._id) },
      });
    }
  }

  return group;
}

// GET /chat/dm/:userId - get (or create) the 1-on-1 chat with any member.
export const getOrCreateDm = asyncHandler(async (req, res) => {
  // Accepts a raw user id (the normal case - clicking a member's profile,
  // a search result, etc) or any other identifier (@username, mobile,
  // email) - the same resolution "Add member" already offers, so the "New
  // chat" search box's manual-entry fallback works here too.
  const other = isId(req.params.userId) ? await User.findById(req.params.userId) : await findUserByIdentifier(req.params.userId);
  if (!other) throw ApiError.badRequest('Invalid member id');
  const group = await findOrCreateDmGroup(req.user, other._id);
  res.json({ success: true, groupId: group._id, dmStatus: group.dmStatus });
});

// GET /chat/support - get (or create) the chat with the site's designated
// support account (flagged isServiceAccount) - lets "Chat with us" work
// without the client needing to know any specific admin's user id.
export const getOrCreateSupportChat = asyncHandler(async (req, res) => {
  const support = await User.findOne({ isServiceAccount: true, isActive: true });
  if (!support) throw ApiError.notFound('Support chat is not available right now');
  const group = await findOrCreateDmGroup(req.user, support._id);
  res.json({ success: true, groupId: group._id, dmStatus: group.dmStatus });
});

// PATCH /chat/dm/:groupId/accept - explicitly accept a pending message
// request without needing to reply first.
export const acceptDm = asyncHandler(async (req, res) => {
  const group = await Group.findById(req.params.groupId);
  if (!group || group.type !== 'dm') throw ApiError.notFound('Chat not found');
  if (!group.hasMember(req.user._id)) throw ApiError.forbidden('Not allowed');
  if (String(group.requestedBy) === String(req.user._id)) {
    throw ApiError.badRequest("You can't accept your own request");
  }
  group.dmStatus = 'accepted';
  await group.save();
  res.json({ success: true });
});

// DELETE /chat/dm/:groupId - decline a pending message request (deletes it).
export const declineDm = asyncHandler(async (req, res) => {
  const group = await Group.findById(req.params.groupId);
  if (!group || group.type !== 'dm') throw ApiError.notFound('Chat not found');
  if (!group.hasMember(req.user._id)) throw ApiError.forbidden('Not allowed');
  if (String(group.requestedBy) === String(req.user._id)) {
    throw ApiError.badRequest("You can't decline your own request");
  }
  await Message.deleteMany({ group: group._id });
  await group.deleteOne();
  res.json({ success: true });
});

// GET /chat/groups/:groupId - group detail + members (members only).
export const getGroup = asyncHandler(async (req, res) => {
  // Check access on the raw (unpopulated) doc first - hasMember() compares
  // `String(m)` against each member, which only works while `members` still
  // holds plain ObjectIds; populating first breaks that comparison for
  // every group type (each entry becomes a populated User doc).
  const group = await Group.findById(req.params.groupId);
  if (!group) throw ApiError.notFound('Group not found');
  await ensureAccess(group, req.user._id);

  // Opening a conversation implicitly reads it - clear any manual "mark as
  // unread" flag for this member.
  if ((group.unreadFor || []).some((id) => String(id) === String(req.user._id))) {
    group.unreadFor = group.unreadFor.filter((id) => String(id) !== String(req.user._id));
    await group.save();
  }

  // Same rule as clubController.getClub: compute membership/admin flags
  // before populate() turns `owner`/`admins` into full User docs, since
  // String(populatedDoc) no longer matches a plain id string afterwards.
  const isOwner = String(group.owner) === String(req.user._id);
  const isAdmin = group.isAdmin(req.user._id);

  await group.populate([
    { path: 'members', select: MEMBER_FIELDS },
    { path: 'owner', select: 'fullName avatarUrl' },
    { path: 'trip', select: 'origin viaStops destination' },
  ]);

  res.json({
    success: true,
    group: {
      _id: group._id,
      name: group.name,
      description: group.description || '',
      photoUrl: group.photoUrl || '',
      coverPhotoUrl: group.coverPhotoUrl || '',
      type: group.type,
      trip: group.trip,
      owner: group.owner,
      isOwner,
      isAdmin,
      members: group.members,
    },
  });
});

// PATCH /chat/groups/:groupId/unread - manually flag a chat unread/read
// (WhatsApp-style toggle, not automatic read-tracking).
export const setUnread = asyncHandler(async (req, res) => {
  const group = await Group.findById(req.params.groupId);
  if (!group) throw ApiError.notFound('Group not found');
  if (!group.hasMember(req.user._id)) throw ApiError.forbidden('You are not a member of this chat');

  const unread = Boolean(req.body.unread);
  const already = (group.unreadFor || []).some((id) => String(id) === String(req.user._id));
  if (unread && !already) group.unreadFor.push(req.user._id);
  else if (!unread && already) group.unreadFor = group.unreadFor.filter((id) => String(id) !== String(req.user._id));
  await group.save();

  res.json({ success: true, isUnread: unread });
});

// PATCH /chat/groups/:groupId - rename, edit description, or set/remove the
// group photo and cover photo (owner/club-admin/site-admin). Not available
// for 1-on-1 DMs.
export const updateGroup = asyncHandler(async (req, res) => {
  const group = await Group.findById(req.params.groupId);
  if (!group) throw ApiError.notFound('Group not found');
  if (group.type === 'dm') throw ApiError.badRequest('Direct messages cannot be managed');
  const isSiteAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!group.isAdmin(req.user._id) && !isSiteAdmin) throw ApiError.forbidden('Only the group owner or an admin can update this group');

  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) throw ApiError.badRequest('Group name cannot be empty');
    group.name = name;
  }
  if (req.body.description !== undefined) {
    group.description = String(req.body.description).trim().slice(0, 500);
  }
  if (req.body.removePhoto === 'true' || req.body.removePhoto === true) {
    group.photoUrl = '';
  }
  if (req.body.removeCoverPhoto === 'true' || req.body.removeCoverPhoto === true) {
    group.coverPhotoUrl = '';
  }
  const photoFile = req.files?.photo?.[0];
  const coverFile = req.files?.cover?.[0];
  if (photoFile) {
    group.photoUrl = await saveUpload(photoFile, { owner: req.user._id, kind: 'group' });
  }
  if (coverFile) {
    group.coverPhotoUrl = await saveUpload(coverFile, { owner: req.user._id, kind: 'group' });
  }
  await group.save();

  res.json({
    success: true,
    group: {
      _id: group._id,
      name: group.name,
      description: group.description || '',
      photoUrl: group.photoUrl || '',
      coverPhotoUrl: group.coverPhotoUrl || '',
    },
  });
});

// POST /chat/groups - create a custom group with members by id.
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
        title: 'Added to a group',
        message: `${req.user.fullName} added you to "${name}"`,
        meta: { groupId: String(group._id) },
      });
    }
  });

  res.status(201).json({ success: true, groupId: group._id });
});

// POST /chat/groups/:groupId/members - add a member by User ID, username,
// mobile number, or email (owner/club-admin/site-admin).
export const addMember = asyncHandler(async (req, res) => {
  const group = await Group.findById(req.params.groupId);
  if (!group) throw ApiError.notFound('Group not found');
  if (group.type === 'dm') throw ApiError.badRequest('Direct messages cannot be managed');
  const isSiteAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!group.isAdmin(req.user._id) && !isSiteAdmin) throw ApiError.forbidden('Only the group owner or an admin can add members');

  const { userId, email, mobile, username, identifier } = req.body;
  let target = null;
  if (identifier) target = await findUserByIdentifier(identifier);
  else if (userId && isId(userId)) target = await User.findById(userId);
  else if (username) target = await User.findOne({ username: String(username).toLowerCase().trim().replace(/^@/, '') });
  else if (mobile) target = await User.findOne({ mobile: String(mobile).trim() });
  else if (email) target = await User.findOne({ email: String(email).toLowerCase().trim() });
  if (!target || !target.isActive) throw ApiError.notFound('No active member found for that ID, username, mobile number, or email');

  if (group.hasMember(target._id)) {
    return res.json({ success: true, alreadyMember: true });
  }
  group.members.push(target._id);
  await group.save();

  notify(target._id, {
    type: 'group',
    title: 'Added to a group',
    message: `${req.user.fullName} added you to "${group.name}"`,
    meta: { groupId: String(group._id) },
  });

  const populated = await group.populate('members', MEMBER_FIELDS);
  res.json({ success: true, members: populated.members });
});

// DELETE /chat/groups/:groupId/members/:userId - remove member (owner/admin) or leave (self).
export const removeMember = asyncHandler(async (req, res) => {
  const group = await Group.findById(req.params.groupId);
  if (!group) throw ApiError.notFound('Group not found');
  if (group.type === 'dm') throw ApiError.badRequest('Direct messages cannot be managed');

  const targetId = req.params.userId;
  const isSelf = String(targetId) === String(req.user._id);
  const isSiteAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isSelf && !group.isAdmin(req.user._id) && !isSiteAdmin) {
    throw ApiError.forbidden('Not allowed');
  }
  if (String(group.owner) === String(targetId)) {
    throw ApiError.badRequest('The owner cannot be removed');
  }

  group.members = group.members.filter((m) => String(m) !== String(targetId));
  group.admins = group.admins.filter((m) => String(m) !== String(targetId));
  await group.save();
  res.json({ success: true });
});

// Nested populate for a shared-photo message - kept here so getMessages and
// sendMessage attribute the photo identically.
const SHARED_PHOTO_POPULATE = {
  path: 'sharedPhoto',
  select: 'photoUrl caption user',
  populate: { path: 'user', select: 'fullName username' },
};

// GET /chat/groups/:groupId/messages?after=ISO - list messages (members only).
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
      .populate('sender', 'fullName avatarUrl role')
      .populate(SHARED_PHOTO_POPULATE);
  } else {
    const recent = await Message.find({ group: group._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('sender', 'fullName avatarUrl role')
      .populate(SHARED_PHOTO_POPULATE);
    messages = recent.reverse();
  }

  res.json({ success: true, messages });
});

// POST /chat/groups/:groupId/messages - send a message (members only).
// Body is normally just { text }, but a message can also (or instead) share
// a Gallery photo via { sharedPhotoId } - see the Lightbox's share action.
export const sendMessage = asyncHandler(async (req, res) => {
  const text = String(req.body.text || '').trim();
  const sharedPhotoId = req.body.sharedPhotoId ? String(req.body.sharedPhotoId) : null;
  if (!text && !sharedPhotoId) throw ApiError.badRequest('Message cannot be empty');
  if (text.length > 2000) throw ApiError.badRequest('Message too long');
  if (text && containsProfanity(text)) {
    throw ApiError.badRequest('Your message contains language that isn\'t allowed here - please rephrase it.', 'PROFANITY_BLOCKED');
  }

  let sharedPhoto = null;
  if (sharedPhotoId) {
    if (!mongoose.isValidObjectId(sharedPhotoId)) throw ApiError.badRequest('Invalid photo');
    sharedPhoto = await Gallery.findById(sharedPhotoId).select('_id');
    if (!sharedPhoto) throw ApiError.badRequest('Photo not found');
  }

  const group = await Group.findById(req.params.groupId);
  if (!group) throw ApiError.notFound('Group not found');
  await ensureAccess(group, req.user._id);

  // Instagram-style implicit accept: the recipient of a pending message
  // request sending anything (not just an explicit accept) turns it into a
  // normal chat. The original requester can keep messaging while pending.
  if (group.type === 'dm' && group.dmStatus === 'pending' && String(group.requestedBy) !== String(req.user._id)) {
    group.dmStatus = 'accepted';
  }

  const message = await Message.create({ group: group._id, sender: req.user._id, text, sharedPhoto: sharedPhoto?._id });
  group.lastMessageAt = message.createdAt;
  group.lastMessageText = text ? text.slice(0, 120) : 'Shared a photo';
  await group.save();
  await message.populate('sender', 'fullName avatarUrl role');
  await message.populate(SHARED_PHOTO_POPULATE);

  // AI auto-reply - only when someone messages the designated support
  // account with actual text (a pure photo share has nothing for the
  // FAQ/AI matcher to work with). Never triggers when the sender IS that
  // service account, so a human replying as it (to take over the
  // conversation) is never talked over by the bot - but any other sender,
  // including the founder's own superadmin account, gets a reply like
  // anyone else would.
  let autoReply = null;
  if (text && group.type === 'dm' && !req.user.isServiceAccount) {
    const otherId = group.members.find((m) => String(m) !== String(req.user._id));
    const other = otherId ? await User.findById(otherId).select('isServiceAccount') : null;

    if (other?.isServiceAccount) {
      // Predefined questions (the quick-question chips) get an instant,
      // exact canned answer - no AI call needed. Anything else tries the
      // AI bot, and only falls back to "please wait" if that's disabled
      // or fails.
      let replyText = matchFaqAnswer(text);
      if (!replyText) {
        const recent = await Message.find({ group: group._id }).sort({ createdAt: -1 }).limit(12);
        const history = recent
          .reverse()
          .map((m) => ({ role: String(m.sender) === String(otherId) ? 'assistant' : 'user', content: m.text }));
        while (history.length && history[0].role !== 'user') history.shift(); // API requires the first turn to be 'user'
        replyText = await getSupportBotReply(history);
      }

      const botMessage = await Message.create({
        group: group._id,
        sender: otherId,
        text: replyText || FALLBACK_REPLY,
        isAuto: true,
      });
      group.lastMessageAt = botMessage.createdAt;
      group.lastMessageText = botMessage.text.slice(0, 120);
      await group.save();
      await botMessage.populate('sender', 'fullName avatarUrl role');
      autoReply = botMessage;
    }
  }

  res.status(201).json({ success: true, message, autoReply });
});

// DELETE /chat/groups/:groupId/messages - clear this chat's message history
// (members only). The conversation itself stays in everyone's list - only
// its messages are wiped, since there's no per-member message visibility to
// clear just "your side" of it.
export const clearChat = asyncHandler(async (req, res) => {
  const group = await Group.findById(req.params.groupId);
  if (!group) throw ApiError.notFound('Group not found');
  if (!group.hasMember(req.user._id)) throw ApiError.forbidden('You are not a member of this chat');

  await Message.deleteMany({ group: group._id });
  group.lastMessageAt = undefined;
  group.lastMessageText = '';
  await group.save();

  res.json({ success: true });
});
