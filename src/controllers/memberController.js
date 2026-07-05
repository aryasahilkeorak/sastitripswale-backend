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
import { fileToUrl } from '../middleware/upload.js';
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

  const filter = { isActive: true, role: 'member' };
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

  const [tripsOrganized, connectionCount] = await Promise.all([
    Trip.countDocuments({ organizer: user._id }),
    Connection.countDocuments({
      $or: [{ sender: user._id }, { receiver: user._id }],
      status: 'accepted',
    }),
  ]);

  const statusMap = await connectionStatusMap(req.user?._id, [user._id]);

  res.json({
    success: true,
    member: {
      ...user.toPublicJSON(),
      stats: { tripsOrganized, connections: connectionCount },
      connection: statusMap[String(user._id)] || null,
      isSelf: req.user ? String(user._id) === String(req.user._id) : false,
    },
  });
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
  'vehicleType',
  'vehicleModel',
  'drinks',
  'smokes',
];

export const updateProfile = asyncHandler(async (req, res) => {
  const user = req.user;
  Object.assign(user, pick(req.body, PROFILE_FIELDS));
  if (req.body.age !== undefined && req.body.age !== '') user.age = Number(req.body.age);
  if (req.body.hasVehicle !== undefined) user.hasVehicle = toBool(req.body.hasVehicle);
  if (req.body.travelInterests !== undefined) user.travelInterests = parseArray(req.body.travelInterests);
  if (req.body.emergencyContact !== undefined) user.emergencyContact = req.body.emergencyContact;
  if (req.file) user.avatarUrl = fileToUrl(req.file);

  await user.save();
  res.json({ success: true, user: user.toPrivateJSON() });
});

// Mandatory profile completion after payment. Accepts multipart with
// avatar + aadhaar (required) + pan (optional) and profile fields.
export const completeProfile = asyncHandler(async (req, res) => {
  const user = req.user;
  const b = req.body;

  Object.assign(user, pick(b, PROFILE_FIELDS));
  if (b.age !== undefined && b.age !== '') user.age = Number(b.age);
  if (b.hasVehicle !== undefined) user.hasVehicle = toBool(b.hasVehicle);
  if (b.travelInterests !== undefined) user.travelInterests = parseArray(b.travelInterests);
  if (b.emergencyContact !== undefined) user.emergencyContact = b.emergencyContact;
  if (b.coTravelerPreference) user.coTravelerPreference = b.coTravelerPreference;

  const files = req.files || {};
  if (files.avatar?.[0]) user.avatarUrl = fileToUrl(files.avatar[0]);

  const docsToSave = [];
  if (files.aadhaar?.[0]) docsToSave.push({ docType: 'aadhaar', file: files.aadhaar[0] });
  if (files.pan?.[0]) docsToSave.push({ docType: 'pan', file: files.pan[0] });
  for (const d of docsToSave) {
    await Document.create({ user: user._id, docType: d.docType, fileUrl: fileToUrl(d.file) });
  }

  // Validate everything required for a complete profile.
  const missing = [];
  if (!user.fullName || user.fullName.trim().length < 2) missing.push('full name');
  if (!user.city) missing.push('city');
  if (!user.gender) missing.push('gender');
  if (!user.travelInterests?.length) missing.push('at least one travel interest');
  if (user.hasVehicle && !user.vehicleType) missing.push('vehicle type');
  const hasDoc = docsToSave.length > 0 || (await Document.exists({ user: user._id }));
  if (!hasDoc) missing.push('an ID document (Aadhaar)');
  if (missing.length) throw ApiError.badRequest(`Please provide: ${missing.join(', ')}`);

  user.profileComplete = true;
  await user.save();
  res.json({ success: true, user: user.toPrivateJSON() });
});

export const uploadDocument = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Document file required');
  const docType = req.body.docType || 'aadhaar';
  const doc = await Document.create({
    user: req.user._id,
    docType,
    fileUrl: fileToUrl(req.file),
  });
  res.status(201).json({ success: true, document: { id: doc._id, docType: doc.docType } });
});

export const sendConnection = asyncHandler(async (req, res) => {
  const receiverId = req.body.receiverId || req.body.receiver_id;
  if (!receiverId) throw ApiError.badRequest('receiverId required');
  if (String(receiverId) === String(req.user._id)) {
    throw ApiError.badRequest("You can't connect with yourself");
  }
  const receiver = await User.findById(receiverId);
  if (!receiver || !receiver.isActive) throw ApiError.notFound('Member not found');

  let conn = await Connection.findOne({ sender: req.user._id, receiver: receiverId });
  if (conn) return res.json({ success: true, status: conn.status, connectionId: conn._id });

  conn = await Connection.create({ sender: req.user._id, receiver: receiverId });
  notify(receiverId, {
    type: 'connection',
    title: 'New connection request 🤝',
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
      title: 'Connection accepted 🎉',
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
