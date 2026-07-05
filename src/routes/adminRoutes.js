import { Router } from 'express';
import * as admin from '../controllers/adminController.js';
import { protect, requireRole } from '../middleware/auth.js';

const router = Router();

// Every admin route is double-protected.
router.use(protect, requireRole('admin'));

router.get('/stats', admin.getStats);

router.get('/users', admin.getUsers);
router.get('/users/:id/documents', admin.getUserDocuments);
router.patch('/users/:id/verify', admin.verifyUser);
router.patch('/users/:id/toggle', admin.toggleUserStatus);

router.get('/trips', admin.getAllTrips);
router.patch('/trips/:id/status', admin.updateTripStatus);

router.get('/reviews', admin.getAdminReviews);
router.patch('/reviews/:id/feature', admin.featureReview);

router.get('/coupons', admin.getCoupons);
router.post('/coupons', admin.createCoupon);
router.patch('/coupons/:id', admin.toggleCoupon);
router.delete('/coupons/:id', admin.deleteCoupon);

router.get('/contact-messages', admin.getContactMessages);

export default router;
