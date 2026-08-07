import { Router } from 'express';
import * as member from '../controllers/memberController.js';
import { protect, attachUser, requireMembership } from '../middleware/auth.js';
import { makeUploader } from '../middleware/upload.js';

const router = Router();
const docs = makeUploader('documents', { docs: true });
const profileDocs = makeUploader('profile', { docs: true });

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
router.put(
  '/profile',
  protect,
  profileDocs.fields([
    { name: 'avatar', maxCount: 1 },
    { name: 'partnerDoc', maxCount: 1 },
  ]),
  member.updateProfile
);
router.put(
  '/complete-profile',
  protect,
  profileDocs.fields([
    { name: 'avatar', maxCount: 1 },
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

router.get('/:id', attachUser, member.getMember);
router.get('/:id/selfie', protect, member.getMemberSelfie);
router.post('/:id/block', protect, member.toggleBlock);
router.post('/:id/report', protect, member.reportUser);

export default router;
