import { Router } from 'express';
import * as admin from '../controllers/adminController.js';
import { protect, requireRole } from '../middleware/auth.js';

const router = Router();

// Every admin route requires an admin or super-admin.
router.use(protect, requireRole('admin', 'superadmin'));

const superOnly = requireRole('superadmin');

router.get('/stats', admin.getStats);

// Users
router.get('/users', admin.getUsers);
router.get('/users/:id', admin.getUserDetail);
router.get('/users/:id/documents', admin.getUserDocuments);
router.patch('/users/:id/verify', admin.verifyUser);
router.patch('/users/:id/toggle', admin.toggleUserStatus);
router.delete('/users/:id', superOnly, admin.deleteUser); // super-admin only

// Admin management (super-admin only)
router.get('/admins', superOnly, admin.getAdmins);
router.post('/admins', superOnly, admin.createAdmin);
router.patch('/admins/:id', superOnly, admin.updateAdminRole);

// Trips
router.get('/trips', admin.getAllTrips);
router.patch('/trips/:id/status', admin.updateTripStatus);

// Reviews
router.get('/reviews', admin.getAdminReviews);
router.patch('/reviews/:id/feature', admin.featureReview);
router.delete('/reviews/:id', admin.deleteReview);

// Coupons
router.get('/coupons', admin.getCoupons);
router.post('/coupons', admin.createCoupon);
router.put('/coupons/:id', admin.updateCoupon);
router.patch('/coupons/:id', admin.toggleCoupon);
router.delete('/coupons/:id', admin.deleteCoupon);

// Contact / help / complaints
router.get('/contact-messages', admin.getContactMessages);
router.patch('/contact-messages/:id', admin.updateContactMessage);
router.delete('/contact-messages/:id', admin.deleteContactMessage);

export default router;
