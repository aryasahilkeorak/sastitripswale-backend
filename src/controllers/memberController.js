// ============================================================
//  Member controller — directory, profiles, connections,
//  notifications, document upload.
// ============================================================
import mongoose from 'mongoose';
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import User from '../models/User.js';
import Trip from '../models/Trip.js';
import Connection from '../models/Connection.js';
import Notification from '../models/Notification.js';
import Document from '../models/Document.js';
import Gallery from '../models/Gallery.js';
import Block from '../models/Block.js';
import Report from '../models/Report.js';
import { saveUpload } from '../utils/uploadStore.js';
import { toBool, parseArray, pick } from '../utils/parse.js';
import { notify } from '../utils/notify.js';

const rx = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

// Build a map of "my connection status" against a set of other user ids.
async function connectionStatusMap(meId, otherIds) {
  if (!meId) return {};
  const conns = await Connection.find({
    $or: [
      { sender: meId, receiver: { $in: otherIds } },
      { receiver: meId, sender: { $in: otherIds } },
    ],
  });
  const map = {};
  for (const c of conns) {
    const other = String(c.sender) === String(meId) ? String(c.receiver) : String(c.sender);
    map[other] = {
      status: c.status,
      direction: String(c.sender) === String(meId) ? 'sent' : 'received',
      connectionId: c._id,
    };
  }
  return map;
}

export const getMembers = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 12));

  // Superadmins are shown too (tagged "Founder" on the frontend) — plain
  // admins stay out of the public directory.
  const filter = { isActive: true, role: { $in: ['member', 'superadmin'] } };
  if (req.query.vehicleType) filter.vehicleType = req.query.vehicleType;
  if (req.query.gender) filter.gender = req.query.gender;
  if (req.query.verified === 'true') filter.isVerified = true;
  if (req.query.search) {
    // Find a member by name, city, email, mobile, or exact user ID.
    const s = String(req.query.search).trim();
    const or = [
      { fullName: rx(s) },
      { city: rx(s) },
      { email: rx(s) },
      { mobile: rx(s) },
      { username: rx(s) },
    ];
    if (mongoose.isValidObjectId(s)) or.push({ _id: s });
    filter.$or = or;
  }

  const [users, total] = await Promise.all([
    User.find(filter).sort({ isVerified: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    User.countDocuments(filter),
  ]);

  const statusMap = await connectionStatusMap(req.user?._id, users.map((u) => u._id));

  const members = users.map((u) => ({
    ...u.toPublicJSON(),
    connection: statusMap[String(u._id)] || null,
    isSelf: req.user ? String(u._id) === String(req.user._id) : false,
  }));

  res.json({
    success: true,
    members,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const getMember = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user || !user.isActive) throw ApiError.notFound('Member not found');

  const [tripsOrganized, connectionCount, recentTrips, recentPhotos, photoCount, similar] = await Promise.all([
    Trip.countDocuments({ organizer: user._id }),
    Connection.countDocuments({
      $or: [{ sender: user._id }, { receiver: user._id }],
      status: 'accepted',
    }),
    Trip.find({ organizer: user._id })
      .sort({ createdAt: -1 })
      .limit(12)
      .select('origin viaStops destination coverImageUrl startDate endDate budgetPerHead status'),
    Gallery.find({ user: user._id }).sort({ createdAt: -1 }).limit(12).select('photoUrl caption category'),
    Gallery.countDocuments({ user: user._id }),
    // Other travelers who share at least one travel interest — used to
    // power the "Suggested travelers" rail on the member's profile page.
    user.travelInterests?.length
      ? User.find({
          _id: { $ne: user._id },
          isActive: true,
          role: { $in: ['member', 'superadmin'] },
          travelInterests: { $in: user.travelInterests },
        })
          .select('fullName avatarUrl city travelInterests isVerified')
          .limit(24)
      : [],
  ]);

  const suggested = similar
    .map((u) => ({
      id: u._id,
      fullName: u.fullName,
      avatarUrl: u.avatarUrl,
      city: u.city,
      isVerified: u.isVerified,
      sharedInterests: u.travelInterests.filter((t) => user.travelInterests.includes(t)),
    }))
    .sort((a, b) => b.sharedInterests.length - a.sharedInterests.length)
    .slice(0, 6);

  const statusMap = await connectionStatusMap(req.user?._id, [user._id]);
  const isBlockedByMe = req.user
    ? Boolean(await Block.exists({ blocker: req.user._id, blocked: user._id }))
    : false;

  res.json({
    success: true,
    member: {
      ...user.toPublicJSON(),
      stats: { tripsOrganized, connections: connectionCount, photos: photoCount },
      recentTrips,
      recentPhotos,
      suggested,
      connection: statusMap[String(user._id)] || null,
      isSelf: req.user ? String(user._id) === String(req.user._id) : false,
      isBlockedByMe,
    },
  });
});

// POST /members/:id/block — toggle blocking another member.
export const toggleBlock = asyncHandler(async (req, res) => {
  const targetId = req.params.id;
  if (String(targetId) === String(req.user._id)) throw ApiError.badRequest("You can't block yourself");
  const target = await User.findById(targetId);
  if (!target) throw ApiError.notFound('Member not found');

  const existing = await Block.findOne({ blocker: req.user._id, blocked: targetId });
  if (existing) {
    await existing.deleteOne();
    return res.json({ success: true, blocked: false });
  }
  await Block.create({ blocker: req.user._id, blocked: targetId });
  res.json({ success: true, blocked: true });
});

// POST /members/:id/report — flag a member's profile/behavior for admin review.
export const reportUser = asyncHandler(async (req, res) => {
  const targetId = req.params.id;
  if (String(targetId) === String(req.user._id)) throw ApiError.badRequest("You can't report yourself");
  const reason = String(req.body.reason || '').trim();
  if (!reason) throw ApiError.badRequest('Please describe the issue');
  const target = await User.findById(targetId);
  if (!target) throw ApiError.notFound('Member not found');

  const report = await Report.create({ reporter: req.user._id, reportedUser: targetId, reason });
  res.status(201).json({ success: true, reportId: report._id });
});

const PROFILE_FIELDS = [
  'fullName',
  'whatsapp',
  'gender',
  'city',
  'state',
  'profession',
  'bio',
  'instagram',
  'facebook',
  'twitter',
  'youtube',
  'linkedin',
  'vehicleType',
  'vehicleModel',
  'drinks',
  'smokes',
];

// Handled separately (needs its own regex validation), not blindly assigned.
const PARTNER_MOBILE_RX = /^[0-9]{10,15}$/;
const RELATIONSHIP_STATUSES = ['single', 'in_a_relationship', 'married', 'prefer_not_to_say', ''];
const USERNAME_RX = /^[a-z0-9_.]{3,30}$/;

// Aadhaar front+back are always mandatory; DL + RC (each front+back) are
// mandatory only for vehicle owners. PAN stays optional and single-sided.
const REQUIRED_DOC_FIELDS = [
  { field: 'aadhaarFront', docType: 'aadhaar', side: 'front', label: 'Aadhaar card (front)' },
  { field: 'aadhaarBack', docType: 'aadhaar', side: 'back', label: 'Aadhaar card (back)' },
];
const VEHICLE_DOC_FIELDS = [
  { field: 'dlFront', docType: 'driving_license', side: 'front', label: "Driving Licence (front)" },
  { field: 'dlBack', docType: 'driving_license', side: 'back', label: "Driving Licence (back)" },
  { field: 'rcFront', docType: 'rc', side: 'front', label: 'RC (front)' },
  { field: 'rcBack', docType: 'rc', side: 'back', label: 'RC (back)' },
];
const OPTIONAL_DOC_FIELDS = [{ field: 'pan', docType: 'pan', side: '', label: 'PAN' }];

export const updateProfile = asyncHandler(async (req, res) => {
  const user = req.user;

  if (req.body.email !== undefined) {
    const emailN = String(req.body.email).toLowerCase().trim();
    if (!emailN) throw ApiError.badRequest('Email cannot be empty');
    if (emailN !== user.email) {
      const exists = await User.findOne({ email: emailN, _id: { $ne: user._id } });
      if (exists) throw ApiError.conflict('That email is already in use');
      user.email = emailN;
    }
  }
  if (req.body.mobile !== undefined) {
    const mobileN = String(req.body.mobile).trim();
    if (!/^[0-9]{10,15}$/.test(mobileN)) throw ApiError.badRequest('Valid mobile number required');
    if (mobileN !== user.mobile) {
      const exists = await User.findOne({ mobile: mobileN, _id: { $ne: user._id } });
      if (exists) throw ApiError.conflict('That mobile number is already in use');
      user.mobile = mobileN;
    }
  }
  if (req.body.username !== undefined) {
    const usernameN = String(req.body.username).toLowerCase().trim();
    if (!usernameN) {
      user.username = undefined;
    } else if (usernameN !== user.username) {
      if (!USERNAME_RX.test(usernameN)) {
        throw ApiError.badRequest('Username must be 3-30 characters: letters, numbers, dots or underscores');
      }
      const exists = await User.findOne({ username: usernameN, _id: { $ne: user._id } });
      if (exists) throw ApiError.conflict('That username is already taken');
      user.username = usernameN;
    }
  }

  Object.assign(user, pick(req.body, PROFILE_FIELDS));
  if (req.body.age !== undefined && req.body.age !== '') user.age = Number(req.body.age);
  if (req.body.hasVehicle !== undefined) user.hasVehicle = toBool(req.body.hasVehicle);
  if (req.body.travelInterests !== undefined) user.travelInterests = parseArray(req.body.travelInterests);
  if (req.body.emergencyContact !== undefined) user.emergencyContact = req.body.emergencyContact;
  if (req.body.relationshipStatus !== undefined) {
    if (!RELATIONSHIP_STATUSES.includes(req.body.relationshipStatus)) {
      throw ApiError.badRequest('Invalid relationship status');
    }
    user.relationshipStatus = req.body.relationshipStatus;
  }
  if (req.body.partnerMobile !== undefined) {
    const partnerMobileN = String(req.body.partnerMobile).trim();
    if (partnerMobileN && !PARTNER_MOBILE_RX.test(partnerMobileN)) {
      throw ApiError.badRequest("Valid partner's mobile number required");
    }
    user.partnerMobile = partnerMobileN;
  }

  const files = req.files || {};
  if (files.avatar?.[0]) user.avatarUrl = await saveUpload(files.avatar[0], { owner: user._id, kind: 'avatar' });
  if (files.partnerDoc?.[0]) user.partnerDocUrl = await saveUpload(files.partnerDoc[0], { owner: user._id, kind: 'document' });

  await user.save();
  res.json({ success: true, user: user.toPrivateJSON() });
});

// Mandatory profile completion after payment. Accepts multipart with
// avatar + aadhaarFront/aadhaarBack (required) + pan (optional) + profile
// fields — plus dlFront/dlBack/rcFront/rcBack (required if hasVehicle).
export const completeProfile = asyncHandler(async (req, res) => {
  const user = req.user;
  const b = req.body;

  Object.assign(user, pick(b, PROFILE_FIELDS));
  if (b.age !== undefined && b.age !== '') user.age = Number(b.age);
  if (b.hasVehicle !== undefined) user.hasVehicle = toBool(b.hasVehicle);
  if (b.travelInterests !== undefined) user.travelInterests = parseArray(b.travelInterests);
  if (b.emergencyContact !== undefined) user.emergencyContact = b.emergencyContact;
  if (b.coTravelerPreference) user.coTravelerPreference = b.coTravelerPreference;
  if (b.relationshipStatus !== undefined) {
    if (!RELATIONSHIP_STATUSES.includes(b.relationshipStatus)) {
      throw ApiError.badRequest('Invalid relationship status');
    }
    user.relationshipStatus = b.relationshipStatus;
  }
  if (b.partnerMobile !== undefined) {
    const partnerMobileN = String(b.partnerMobile).trim();
    if (partnerMobileN && !PARTNER_MOBILE_RX.test(partnerMobileN)) {
      throw ApiError.badRequest("Valid partner's mobile number required");
    }
    user.partnerMobile = partnerMobileN;
  }

  const files = req.files || {};
  if (files.avatar?.[0]) user.avatarUrl = await saveUpload(files.avatar[0], { owner: user._id, kind: 'avatar' });
  if (files.partnerDoc?.[0]) user.partnerDocUrl = await saveUpload(files.partnerDoc[0], { owner: user._id, kind: 'document' });

  const docSpecs = [
    ...REQUIRED_DOC_FIELDS,
    ...OPTIONAL_DOC_FIELDS,
    ...(user.hasVehicle ? VEHICLE_DOC_FIELDS : []),
  ];
  const uploadedThisRequest = new Set();
  for (const spec of docSpecs) {
    const file = files[spec.field]?.[0];
    if (!file) continue;
    const fileUrl = await saveUpload(file, { owner: user._id, kind: 'document' });
    await Document.create({ user: user._id, docType: spec.docType, side: spec.side, fileUrl });
    uploadedThisRequest.add(spec.field);
  }

  // Validate everything required for a complete profile.
  const missing = [];
  if (!user.fullName || user.fullName.trim().length < 2) missing.push('full name');
  if (!user.city) missing.push('city');
  if (!user.gender) missing.push('gender');
  if (!user.travelInterests?.length) missing.push('at least one travel interest');
  if (user.hasVehicle && !user.vehicleType) missing.push('vehicle type');

  const requiredSpecs = [...REQUIRED_DOC_FIELDS, ...(user.hasVehicle ? VEHICLE_DOC_FIELDS : [])];
  for (const spec of requiredSpecs) {
    if (uploadedThisRequest.has(spec.field)) continue;
    const exists = await Document.exists({ user: user._id, docType: spec.docType, side: spec.side });
    if (!exists) missing.push(spec.label);
  }
  if (missing.length) throw ApiError.badRequest(`Please provide: ${missing.join(', ')}`);

  user.profileComplete = true;
  await user.save();
  res.json({ success: true, user: user.toPrivateJSON() });
});

export const uploadDocument = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Document file required');
  const docType = req.body.docType || 'aadhaar';
  const fileUrl = await saveUpload(req.file, { owner: req.user._id, kind: 'document' });
  const doc = await Document.create({
    user: req.user._id,
    docType,
    fileUrl,
  });
  res.status(201).json({ success: true, document: { id: doc._id, docType: doc.docType } });
});

// GET /members/documents — my own uploaded ID documents, with review status.
export const getMyDocuments = asyncHandler(async (req, res) => {
  const documents = await Document.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json({ success: true, documents });
});

// PUT /members/documents/:id — replace the file for a document the admin
// rejected. Resets it to 'pending' so it goes back into the review queue.
export const reuploadDocument = asyncHandler(async (req, res) => {
  const doc = await Document.findById(req.params.id);
  if (!doc) throw ApiError.notFound('Document not found');
  if (String(doc.user) !== String(req.user._id)) throw ApiError.forbidden('Not allowed');
  if (doc.status !== 'rejected') throw ApiError.badRequest('Only a rejected document can be re-uploaded');
  if (!req.file) throw ApiError.badRequest('Document file required');

  doc.fileUrl = await saveUpload(req.file, { owner: req.user._id, kind: 'document' });
  doc.status = 'pending';
  doc.isVerified = false;
  doc.verifiedBy = undefined;
  doc.verifiedAt = undefined;
  await doc.save();

  res.json({ success: true, document: doc });
});

export const sendConnection = asyncHandler(async (req, res) => {
  const receiverId = req.body.receiverId || req.body.receiver_id;
  if (!receiverId) throw ApiError.badRequest('receiverId required');
  if (String(receiverId) === String(req.user._id)) {
    throw ApiError.badRequest("You can't connect with yourself");
  }
  const receiver = await User.findById(receiverId);
  if (!receiver || !receiver.isActive) throw ApiError.notFound('Member not found');

  const blocked = await Block.exists({
    $or: [
      { blocker: req.user._id, blocked: receiverId },
      { blocker: receiverId, blocked: req.user._id },
    ],
  });
  if (blocked) throw ApiError.forbidden('You cannot connect with this member');

  let conn = await Connection.findOne({
    $or: [
      { sender: req.user._id, receiver: receiverId },
      { sender: receiverId, receiver: req.user._id },
    ],
  });
  if (conn) return res.json({ success: true, status: conn.status, connectionId: conn._id });

  conn = await Connection.create({ sender: req.user._id, receiver: receiverId });
  notify(receiverId, {
    type: 'connection',
    title: 'New connection request',
    message: `${req.user.fullName} wants to connect with you`,
    meta: { senderId: String(req.user._id), connectionId: String(conn._id) },
  });

  res.status(201).json({ success: true, status: 'pending', connectionId: conn._id });
});

export const respondConnection = asyncHandler(async (req, res) => {
  const action = req.body.action; // 'accept' | 'reject'
  if (!['accept', 'reject'].includes(action)) throw ApiError.badRequest('Invalid action');

  const conn = await Connection.findById(req.params.id);
  if (!conn) throw ApiError.notFound('Connection not found');
  if (String(conn.receiver) !== String(req.user._id)) {
    throw ApiError.forbidden('Only the recipient can respond');
  }

  conn.status = action === 'accept' ? 'accepted' : 'rejected';
  await conn.save();

  if (conn.status === 'accepted') {
    notify(conn.sender, {
      type: 'connection',
      title: 'Connection accepted',
      message: `${req.user.fullName} accepted your connection request`,
      meta: { userId: String(req.user._id) },
    });
  }

  res.json({ success: true, status: conn.status });
});

export const getConnections = asyncHandler(async (req, res) => {
  const conns = await Connection.find({
    $or: [{ sender: req.user._id }, { receiver: req.user._id }],
  })
    .populate('sender', 'fullName city avatarUrl isVerified whatsapp')
    .populate('receiver', 'fullName city avatarUrl isVerified whatsapp')
    .sort({ createdAt: -1 });

  res.json({ success: true, connections: conns });
});

export const getNotifications = asyncHandler(async (req, res) => {
  const notifications = await Notification.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .limit(50);
  const unread = await Notification.countDocuments({ user: req.user._id, isRead: false });
  res.json({ success: true, notifications, unread });
});

export const markNotificationsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ user: req.user._id, isRead: false }, { $set: { isRead: true } });
  res.json({ success: true });
});
