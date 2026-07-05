import { Router } from 'express';
import * as trip from '../controllers/tripController.js';
import { protect, attachUser, requireMembership, requireProfileComplete } from '../middleware/auth.js';
import { makeUploader } from '../middleware/upload.js';
import { validate, tripRules } from '../middleware/validate.js';

const router = Router();
const cover = makeUploader('trips');
const photo = makeUploader('trips');

// Public / optional-auth
router.get('/', attachUser, trip.getTrips);
router.get('/my', protect, trip.getMyTrips);
router.get('/:id', attachUser, trip.getTrip);

// Membership required to create/join
router.post('/', protect, requireMembership, requireProfileComplete, cover.single('cover'), tripRules, validate, trip.createTrip);
router.put('/:id', protect, cover.single('cover'), trip.updateTrip);
router.delete('/:id', protect, trip.deleteTrip);
router.post('/:id/interest', protect, requireMembership, requireProfileComplete, trip.toggleInterest);
router.post('/:id/photos', protect, requireMembership, photo.single('photo'), trip.uploadTripPhoto);
router.post('/:id/expenses', protect, trip.addExpense);

export default router;
