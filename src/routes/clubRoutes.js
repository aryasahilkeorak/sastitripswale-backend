import { Router } from 'express';
import * as club from '../controllers/clubController.js';
import { protect, attachUser, requireMembership, requireProfileComplete } from '../middleware/auth.js';
import { makeUploader } from '../middleware/upload.js';
import { validate, clubRules } from '../middleware/validate.js';

const router = Router();
const clubUploader = makeUploader('clubs');
const clubPhotos = clubUploader.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'cover', maxCount: 1 },
]);

// Public browse/discovery.
router.get('/', attachUser, club.listClubs);
router.get('/:id', attachUser, club.getClub);

// Membership + complete profile (+ vehicle ownership, checked in the
// controller) required to create a club.
router.post('/', protect, requireMembership, requireProfileComplete, clubPhotos, clubRules, validate, club.createClub);
router.patch('/:id', protect, clubPhotos, club.updateClub);
router.delete('/:id', protect, club.deleteClub);

router.post('/:id/join', protect, requireMembership, requireProfileComplete, club.requestToJoin);
router.patch('/:id/requests/:userId', protect, club.respondToRequest);

router.post('/:id/members', protect, club.addMember);
router.delete('/:id/members/:userId', protect, club.removeMember);

router.post('/:id/admins/:userId', protect, club.addAdmin);
router.delete('/:id/admins/:userId', protect, club.removeAdmin);

export default router;
