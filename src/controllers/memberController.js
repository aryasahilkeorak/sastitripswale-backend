// ============================================================
//  Member controller - directory, profiles, connections,
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
import PushSubscription from '../models/PushSubscription.js';
import { saveUpload } from '../utils/uploadStore.js';
import { toBool, parseArray, pick } from '../utils/parse.js';
import { notify } from '../utils/notify.js';
import { env } from '../config/env.js';

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

  // Superadmins are shown too (tagged "Founder" on the frontend) - plain
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

  // Directory order: the Founder (superadmin) always leads, then the most
  // "active" travelers - accepted connections first, trips organized next -
  // then verified, then newest.
  const [agg] = await User.aggregate([
    { $match: filter },
    { $addFields: { founderRank: { $cond: [{ $eq: ['$role', 'superadmin'] }, 0, 1] } } },
    {
      $lookup: {
        from: 'connections',
        let: { uid: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$status', 'accepted'] },
                  { $or: [{ $eq: ['$sender', '$$uid'] }, { $eq: ['$receiver', '$$uid'] }] },
                ],
              },
            },
          },
          { $count: 'count' },
        ],
        as: '_connections',
      },
    },
    { $addFields: { connectionsCount: { $ifNull: [{ $arrayElemAt: ['$_connections.count', 0] }, 0] } } },
    { $lookup: { from: 'trips', localField: '_id', foreignField: 'organizer', as: '_trips' } },
    { $addFields: { tripsCount: { $size: '$_trips' } } },
    { $sort: { founderRank: 1, connectionsCount: -1, tripsCount: -1, isVerified: -1, createdAt: -1 } },
    {
      $facet: {
        data: [{ $skip: (page - 1) * limit }, { $limit: limit }, { $project: { _id: 1 } }],
        totalCount: [{ $count: 'count' }],
      },
    },
  ]);

  const orderedIds = agg.data.map((d) => d._id);
  const total = agg.totalCount[0]?.count || 0;
  const usersById = new Map((await User.find({ _id: { $in: orderedIds } })).map((u) => [String(u._id), u]));
  const users = orderedIds.map((id) => usersById.get(String(id))).filter(Boolean);

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
    // Other travelers who share at least one travel interest - used to
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

// GET /members/:id/selfie - the member's live verification photo. Visible
// only to the member themself, admins, or a member they're connected with
// (accepted connection) - never to the public or a stranger.
export const getMemberSelfie = asyncHandler(async (req, res) => {
  const targetId = req.params.id;
  const isSelf = String(req.user._id) === String(targetId);
  const isAdmin = ['admin', 'superadmin'].includes(req.user.role);

  let authorized = isSelf || isAdmin;
  if (!authorized) {
    const conn = await Connection.findOne({
      status: 'accepted',
      $or: [
        { sender: req.user._id, receiver: targetId },
        { sender: targetId, receiver: req.user._id },
      ],
    });
    authorized = Boolean(conn);
  }
  if (!authorized) throw ApiError.forbidden('Connect with this member to view their verification photo');

  const doc = await Document.findOne({ user: targetId, docType: 'selfie' }).sort({ createdAt: -1 });
  if (!doc) throw ApiError.notFound('No verification photo on file');

  res.json({ success: true, url: doc.fileUrl, status: doc.status });
});

// POST /members/:id/block - toggle blocking another member.
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

// POST /members/:id/report - flag a member's profile/behavior for admin review.
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

// Aadhaar front+back and a live selfie are always mandatory; DL + RC (each
// front+back) are mandatory only for vehicle owners. PAN stays optional and
// single-sided (but is required to reach the "Verified" badge tier).
const REQUIRED_DOC_FIELDS = [
  { field: 'aadhaarFront', docType: 'aadhaar', side: 'front', label: 'Aadhaar card (front)' },
  { field: 'aadhaarBack', docType: 'aadhaar', side: 'back', label: 'Aadhaar card (back)' },
  { field: 'selfie', docType: 'selfie', side: '', label: 'Live selfie photo' },
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
// fields - plus dlFront/dlBack/rcFront/rcBack (required if hasVehicle).
export const completeProfile = asyncHandler(async (req, res) => {
  const user = req.user;
  const b = req.body;

  Object.assign(user, pick(b, PROFILE_FIELDS));
  if (b.age !== undefined && b.age !== '') user.age = Number(b.age);
  if (b.hasVehicle !== undefined) user.hasVehicle = toBool(b.hasVehicle);
  if (b.travelInterests !== undefined) user.travelInterests = parseArray(b.travelInterests);
  if (b.emergencyContact !== undefined) user.emergencyContact = b.emergencyContact;
  if (b.coTravelerPreference) {
    if (user.gender === 'Male' && b.coTravelerPreference === 'female') {
      throw ApiError.badRequest('A male member cannot select a female-only preference');
    }
    if (user.gender === 'Female' && b.coTravelerPreference === 'male') {
      throw ApiError.badRequest('A female member cannot select a male-only preference');
    }
    user.coTravelerPreference = b.coTravelerPreference;
  }
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

// GET /members/documents - my own uploaded ID documents, with review status.
export const getMyDocuments = asyncHandler(async (req, res) => {
  const documents = await Document.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json({ success: true, documents });
});

// PUT /members/documents/:id - replace the file for a document the admin
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

const VEHICLE_TYPES = ['Bike', 'Car', 'Bus', 'Other'];

// Attaches each vehicle's live RC review status (derived from its two RC
// Documents) without storing it redundantly on the vehicle itself. Exported
// so the admin controller can show the same per-vehicle status.
export async function vehiclesWithStatus(user) {
  if (!user.vehicles?.length) return [];
  const ids = user.vehicles.map((v) => v._id);
  const docs = await Document.find({ user: user._id, docType: 'rc', vehicle: { $in: ids } });
  return user.vehicles.map((v) => {
    const vDocs = docs.filter((d) => String(d.vehicle) === String(v._id));
    const front = vDocs.find((d) => d.side === 'front');
    const back = vDocs.find((d) => d.side === 'back');
    let status = 'pending';
    if (front?.status === 'rejected' || back?.status === 'rejected') status = 'rejected';
    else if (front?.status === 'verified' && back?.status === 'verified') status = 'verified';
    return {
      id: v._id,
      vehicleType: v.vehicleType,
      brand: v.brand || '',
      vehicleModel: v.vehicleModel || '',
      year: v.year || null,
      mileageKmpl: v.mileageKmpl || null,
      fuelType: v.fuelType || '',
      regNumber: v.regNumber,
      addedAt: v.createdAt,
      status,
    };
  });
}

// GET /members/vehicles - the signed-in member's registered vehicles, each
// with its own RC verification status.
export const getMyVehicles = asyncHandler(async (req, res) => {
  const vehicles = await vehiclesWithStatus(req.user);
  res.json({ success: true, vehicles });
});

// POST /members/vehicles - register another vehicle. The RC (front+back) is
// mandatory every time - without it a new vehicle can never be verified.
const FUEL_TYPES = ['Petrol', 'Diesel', 'CNG', 'Electric'];
const CURRENT_YEAR = new Date().getFullYear();

export const addVehicle = asyncHandler(async (req, res) => {
  const { vehicleType, brand, vehicleModel, year, mileageKmpl, fuelType, regNumber } = req.body;
  if (!VEHICLE_TYPES.includes(vehicleType)) throw ApiError.badRequest('Select a valid vehicle type');
  if (!regNumber || !String(regNumber).trim()) throw ApiError.badRequest('Vehicle registration number is required');

  const yearNum = year ? Number(year) : undefined;
  if (yearNum !== undefined && (Number.isNaN(yearNum) || yearNum < 1980 || yearNum > CURRENT_YEAR)) {
    throw ApiError.badRequest(`Enter a valid model year (1980–${CURRENT_YEAR})`);
  }
  const mileageNum = mileageKmpl ? Number(mileageKmpl) : undefined;
  if (mileageNum !== undefined && (Number.isNaN(mileageNum) || mileageNum <= 0 || mileageNum > 200)) {
    throw ApiError.badRequest('Enter a valid mileage (km/l)');
  }
  if (fuelType && !FUEL_TYPES.includes(fuelType)) throw ApiError.badRequest('Select a valid fuel type');

  const files = req.files || {};
  if (!files.rcFront?.[0] || !files.rcBack?.[0]) {
    throw ApiError.badRequest('RC (front and back) is required to add a vehicle');
  }

  const user = req.user;
  user.vehicles.push({
    vehicleType,
    brand: (brand || '').trim(),
    vehicleModel: (vehicleModel || '').trim(),
    year: yearNum,
    mileageKmpl: mileageNum,
    fuelType: fuelType || '',
    regNumber: String(regNumber).trim(),
  });
  const vehicle = user.vehicles[user.vehicles.length - 1];
  // Keep the legacy single-vehicle fields pointed at *a* vehicle so the
  // existing "Bike/Car Owners" directory filters keep working for members
  // who only ever add one.
  if (!user.hasVehicle) {
    user.hasVehicle = true;
    user.vehicleType = vehicleType;
    user.vehicleModel = vehicle.vehicleModel;
  }
  await user.save();

  const [rcFrontUrl, rcBackUrl] = await Promise.all([
    saveUpload(files.rcFront[0], { owner: user._id, kind: 'document' }),
    saveUpload(files.rcBack[0], { owner: user._id, kind: 'document' }),
  ]);
  await Document.create({ user: user._id, docType: 'rc', side: 'front', fileUrl: rcFrontUrl, vehicle: vehicle._id });
  await Document.create({ user: user._id, docType: 'rc', side: 'back', fileUrl: rcBackUrl, vehicle: vehicle._id });

  res.status(201).json({
    success: true,
    vehicle: {
      id: vehicle._id,
      vehicleType: vehicle.vehicleType,
      brand: vehicle.brand,
      vehicleModel: vehicle.vehicleModel,
      year: vehicle.year,
      mileageKmpl: vehicle.mileageKmpl,
      fuelType: vehicle.fuelType,
      regNumber: vehicle.regNumber,
      status: 'pending',
    },
  });
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

// DELETE /members/connect/:id - either side of an accepted (or pending)
// connection can remove it - "Disconnect" / withdraw a request.
export const removeConnection = asyncHandler(async (req, res) => {
  const conn = await Connection.findById(req.params.id);
  if (!conn) throw ApiError.notFound('Connection not found');
  const isParty = [String(conn.sender), String(conn.receiver)].includes(String(req.user._id));
  if (!isParty) throw ApiError.forbidden('Not allowed');
  await conn.deleteOne();
  res.json({ success: true });
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

// PATCH /members/notifications/:id/read - mark a single notification read,
// used when the member clicks into it to view the related content.
export const markNotificationRead = asyncHandler(async (req, res) => {
  const n = await Notification.findOne({ _id: req.params.id, user: req.user._id });
  if (!n) throw ApiError.notFound('Notification not found');
  if (!n.isRead) {
    n.isRead = true;
    await n.save();
  }
  res.json({ success: true });
});

// DELETE /members/notifications/:id - clear a single notification.
export const deleteNotification = asyncHandler(async (req, res) => {
  const result = await Notification.deleteOne({ _id: req.params.id, user: req.user._id });
  if (!result.deletedCount) throw ApiError.notFound('Notification not found');
  res.json({ success: true });
});

// DELETE /members/notifications - clear every notification for this member.
export const clearNotifications = asyncHandler(async (req, res) => {
  await Notification.deleteMany({ user: req.user._id });
  res.json({ success: true });
});

// GET /members/push/vapid-key - public, needed by the browser before it can
// create a push subscription.
export const getPushPublicKey = asyncHandler(async (req, res) => {
  res.json({ success: true, publicKey: env.push.publicKey });
});

// POST /members/push/subscribe - save (or refresh) this browser's push
// subscription so future notify() calls can reach it.
export const subscribePush = asyncHandler(async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) throw ApiError.badRequest('Invalid push subscription');

  await PushSubscription.findOneAndUpdate(
    { endpoint },
    { user: req.user._id, endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
    { upsert: true }
  );
  res.status(201).json({ success: true });
});

// POST /members/push/unsubscribe - stop notifying this browser (e.g. user
// disabled notifications, or logged out).
export const unsubscribePush = asyncHandler(async (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) await PushSubscription.deleteOne({ endpoint, user: req.user._id });
  res.json({ success: true });
});
