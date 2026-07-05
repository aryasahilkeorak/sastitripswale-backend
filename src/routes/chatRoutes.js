import { Router } from 'express';
import * as chat from '../controllers/chatController.js';
import { protect, requireMembership } from '../middleware/auth.js';

const router = Router();

router.use(protect);

router.get('/groups', chat.getMyGroups);
router.post('/groups', requireMembership, chat.createGroup);
router.get('/trip/:tripId', chat.getTripGroup);
router.get('/groups/:groupId', chat.getGroup);
router.post('/groups/:groupId/members', chat.addMember);
router.delete('/groups/:groupId/members/:userId', chat.removeMember);
router.get('/groups/:groupId/messages', chat.getMessages);
router.post('/groups/:groupId/messages', chat.sendMessage);

export default router;
