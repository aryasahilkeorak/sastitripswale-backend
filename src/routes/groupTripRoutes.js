import { Router } from 'express';
import * as groupTrip from '../controllers/groupTripController.js';
import { protect, attachUser, requireMembership, requireProfileComplete, requireDocumentsVerified } from '../middleware/auth.js';
import { validate, groupTripRules } from '../middleware/validate.js';

const router = Router();

// Public / optional-auth
router.get('/', attachUser, groupTrip.getGroupTrips);
router.get('/my', protect, groupTrip.getMyGroupTrips);
router.get('/:id', attachUser, groupTrip.getGroupTrip);

// Membership required to create/join
router.post('/', protect, requireMembership, requireProfileComplete, requireDocumentsVerified, groupTripRules, validate, groupTrip.createGroupTrip);
router.put('/:id', protect, groupTrip.updateGroupTrip);
router.delete('/:id', protect, groupTrip.deleteGroupTrip);
// No requireDocumentsVerified here - this endpoint also withdraws a pending
// request / leaves the group, which must never be blocked by a document
// that went back to "pending" after a reupload. The check happens inside
// the controller, scoped to only the "send a new request" branch.
router.post('/:id/interest', protect, requireMembership, requireProfileComplete, groupTrip.requestToJoinGroup);
router.patch('/:id/requests/:userId', protect, requireMembership, groupTrip.respondToGroupRequest);

export default router;
