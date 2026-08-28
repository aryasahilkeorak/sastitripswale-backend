import { Router } from 'express';
import * as trip from '../controllers/tripController.js';
import { protect, attachUser, requireTripHostAccess, requireProfileComplete, requireVehicleVerified } from '../middleware/auth.js';
import { makeUploader } from '../middleware/upload.js';
import { validate, tripRules, reviewRules, memberReviewRules } from '../middleware/validate.js';

const router = Router();
const photo = makeUploader('trips');

// Public / optional-auth
router.get('/', attachUser, trip.getTrips);
router.get('/my', protect, trip.getMyTrips);
router.get('/:id', attachUser, trip.getTrip);

// A duration membership OR the relevant Trip Pass credit is required to
// create/join. respondToRequest and uploadTripPhoto need no separate gate
// here - both already verify the caller is the trip's organizer or an
// accepted member in the controller, which by definition means they
// already passed one of the two gates below to get there.
router.post('/estimate-cost', protect, requireTripHostAccess, trip.estimateCost);
// Hosting needs the full Verified Vehicle Owner tier - a plain Verified
// traveler can join trips but not organize one.
router.post('/', protect, requireTripHostAccess, requireProfileComplete, requireVehicleVerified, tripRules, validate, trip.createTrip);
router.put('/:id', protect, trip.updateTrip);
router.delete('/:id', protect, trip.deleteTrip);
// No requireTripJoinAccess/verification gate here - this same endpoint also
// handles withdrawing a pending request and leaving an accepted trip,
// neither of which should ever be blocked by a spent join credit or a
// verification tier that's since changed. Both checks happen inside the
// controller, scoped to only the "send a new request" branch.
router.post('/:id/interest', protect, requireProfileComplete, trip.requestToJoin);
router.patch('/:id/requests/:userId', protect, trip.respondToRequest);
router.post('/:id/photos', protect, photo.single('photo'), trip.uploadTripPhoto);
router.post('/:id/reviews', protect, reviewRules, validate, trip.createTripReview);
router.post('/:id/member-reviews', protect, memberReviewRules, validate, trip.rateMember);
router.post('/:id/expenses', protect, trip.addExpense);

export default router;
