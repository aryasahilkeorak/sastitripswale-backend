import { Router } from 'express';
import * as member from '../controllers/memberController.js';
import { protect, attachUser, requireMembership } from '../middleware/auth.js';
import { makeUploader } from '../middleware/upload.js';

const router = Router();
const avatar = makeUploader('avatars');
const docs = makeUploader('documents', { docs: true });
const profileDocs = makeUploader('profile', { docs: true });

// Literal routes MUST come before "/:id"
router.get('/', attachUser, member.getMembers);
router.get('/notifications', protect, member.getNotifications);
router.patch('/notifications/read', protect, member.markNotificationsRead);
router.get('/connections', protect, member.getConnections);
router.put('/profile', protect, avatar.single('avatar'), member.updateProfile);
router.put(
  '/complete-profile',
  protect,
  profileDocs.fields([
    { name: 'avatar', maxCount: 1 },
    { name: 'aadhaar', maxCount: 1 },
    { name: 'pan', maxCount: 1 },
  ]),
  member.completeProfile
);
router.post('/document', protect, docs.single('document'), member.uploadDocument);
router.post('/connect', protect, requireMembership, member.sendConnection);
router.patch('/connect/:id', protect, member.respondConnection);

router.get('/:id', attachUser, member.getMember);

export default router;
