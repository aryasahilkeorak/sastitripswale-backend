import { Router } from 'express';
import mongoose from 'mongoose';
import * as member from '../controllers/memberController.js';
import { protect, attachUser, requireMembership } from '../middleware/auth.js';
import { makeUploader } from '../middleware/upload.js';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';

const router = Router();
const docs = makeUploader('documents', { docs: true });
const profileDocs = makeUploader('profile', { docs: true });

// A member profile URL can carry either the Mongo _id or the member's
// @username (e.g. /members/aryasahilkeorak) - resolve it to a real _id
// once here so every :memberId route below can stay a plain ObjectId
// lookup. Scoped to its own param name (not ":id") so it never collides
// with the unrelated Document/Connection/Notification :id routes above.
router.param('memberId', async (req, res, next, value) => {
  if (mongoose.isValidObjectId(value)) {
    req.params.memberId = value;
    return next();
  }
  const user = await User.findOne({ username: String(value).toLowerCase().trim() }).select('_id');
  if (!user) return next(ApiError.notFound('Member not found'));
  req.params.memberId = String(user._id);
  next();
});

// Literal routes MUST come before "/:id"
router.get('/', attachUser, member.getMembers);
router.get('/notifications', protect, member.getNotifications);
router.patch('/notifications/read', protect, member.markNotificationsRead);
router.delete('/notifications', protect, member.clearNotifications);
router.patch('/notifications/:id/read', protect, member.markNotificationRead);
router.delete('/notifications/:id', protect, member.deleteNotification);
router.get('/push/vapid-key', member.getPushPublicKey);
router.post('/push/subscribe', protect, member.subscribePush);
router.post('/push/unsubscribe', protect, member.unsubscribePush);
router.get('/connections', protect, member.getConnections);
router.get('/match-suggestions', protect, member.getMatchSuggestions);
router.put(
  '/profile',
  protect,
  profileDocs.fields([
    { name: 'avatar', maxCount: 1 },
    { name: 'cover', maxCount: 1 },
    { name: 'partnerDoc', maxCount: 1 },
    { name: 'adminAvatar', maxCount: 1 },
  ]),
  member.updateProfile
);
router.put(
  '/complete-profile',
  protect,
  profileDocs.fields([
    { name: 'avatar', maxCount: 1 },
    { name: 'cover', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
    { name: 'aadhaarFront', maxCount: 1 },
    { name: 'aadhaarBack', maxCount: 1 },
    { name: 'pan', maxCount: 1 },
    { name: 'dlFront', maxCount: 1 },
    { name: 'dlBack', maxCount: 1 },
    { name: 'rcFront', maxCount: 1 },
    { name: 'rcBack', maxCount: 1 },
    { name: 'partnerDoc', maxCount: 1 },
  ]),
  member.completeProfile
);
router.post('/document', protect, docs.single('document'), member.uploadDocument);
router.get('/documents', protect, member.getMyDocuments);
router.put('/documents/:id', protect, docs.single('file'), member.reuploadDocument);
router.get('/vehicles', protect, member.getMyVehicles);
router.post(
  '/vehicles',
  protect,
  docs.fields([
    { name: 'rcFront', maxCount: 1 },
    { name: 'rcBack', maxCount: 1 },
  ]),
  member.addVehicle
);
router.post('/connect', protect, requireMembership, member.sendConnection);
router.patch('/connect/:id', protect, member.respondConnection);
router.delete('/connect/:id', protect, member.removeConnection);
router.delete('/followers/:followerId', protect, member.removeFollower);

router.get('/:memberId', attachUser, member.getMember);
router.get('/:memberId/selfie', protect, member.getMemberSelfie);
router.post('/:memberId/block', protect, member.toggleBlock);
router.post('/:memberId/report', protect, member.reportUser);
router.get('/:memberId/followers', attachUser, member.getFollowers);
router.get('/:memberId/following', attachUser, member.getFollowing);
router.post('/:memberId/follow', protect, member.followMember);
router.delete('/:memberId/follow', protect, member.unfollowMember);

export default router;
