import { Router } from 'express';
import * as chat from '../controllers/chatController.js';
import { protect, requireMembership } from '../middleware/auth.js';
import { makeUploader } from '../middleware/upload.js';

const router = Router();
const groupUploader = makeUploader('groups');
const groupPhotos = groupUploader.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'cover', maxCount: 1 },
]);

router.use(protect);

router.get('/groups', chat.getMyGroups);
router.post('/groups', requireMembership, chat.createGroup);
router.get('/trip/:tripId', chat.getTripGroup);
router.get('/support', chat.getOrCreateSupportChat);
router.get('/dm/:userId', chat.getOrCreateDm);
router.patch('/dm/:groupId/accept', chat.acceptDm);
router.delete('/dm/:groupId', chat.declineDm);
router.get('/groups/:groupId', chat.getGroup);
router.patch('/groups/:groupId', groupPhotos, chat.updateGroup);
router.patch('/groups/:groupId/unread', chat.setUnread);
router.post('/groups/:groupId/members', chat.addMember);
router.delete('/groups/:groupId/members/:userId', chat.removeMember);
router.get('/groups/:groupId/messages', chat.getMessages);
router.post('/groups/:groupId/messages', chat.sendMessage);
router.delete('/groups/:groupId/messages', chat.clearChat);

export default router;
