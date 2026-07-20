import { Router } from 'express';
import * as admin from '../controllers/adminController.js';
import { protect, requireRole, requirePermission } from '../middleware/auth.js';

const router = Router();

// Every admin route requires an admin or super-admin.
router.use(protect, requireRole('admin', 'superadmin'));

const superOnly = requireRole('superadmin');
const perm = requirePermission;

router.get('/stats', admin.getStats);

// Users
router.get('/users', perm('users'), admin.getUsers);
router.get('/users/:id', perm('users'), admin.getUserDetail);
router.get('/users/:id/documents', perm('users'), admin.getUserDocuments);
router.patch('/documents/:id', perm('users'), admin.reviewDocument);
router.patch('/users/:id/verify', perm('users'), admin.verifyUser);
router.patch('/users/:id/toggle', perm('users'), admin.toggleUserStatus);
router.delete('/users/:id', perm('users'), admin.deleteUser); // controller further restricts deleting admin accounts to super-admins

// Admin management (super-admin only)
router.get('/admins', superOnly, admin.getAdmins);
router.post('/admins', superOnly, admin.createAdmin);
router.patch('/admins/:id', superOnly, admin.updateAdminRole);
router.patch('/admins/:id/permissions', superOnly, admin.updateAdminPermissions);

// Trips
router.get('/trips', perm('trips'), admin.getAllTrips);
router.patch('/trips/:id/status', perm('trips'), admin.updateTripStatus);

// Reviews
router.get('/reviews', perm('reviews'), admin.getAdminReviews);
router.patch('/reviews/:id/feature', perm('reviews'), admin.featureReview);
router.delete('/reviews/:id', perm('reviews'), admin.deleteReview);

// Coupons
router.get('/coupons', perm('coupons'), admin.getCoupons);
router.post('/coupons', perm('coupons'), admin.createCoupon);
router.put('/coupons/:id', perm('coupons'), admin.updateCoupon);
router.patch('/coupons/:id', perm('coupons'), admin.toggleCoupon);
router.delete('/coupons/:id', perm('coupons'), admin.deleteCoupon);

// Gallery
router.get('/gallery', perm('gallery'), admin.getAdminGallery);
router.delete('/gallery/:id', perm('gallery'), admin.deleteGalleryPhoto);

// Contact / help / complaints
router.get('/contact-messages', perm('messages'), admin.getContactMessages);
router.patch('/contact-messages/:id', perm('messages'), admin.updateContactMessage);
router.delete('/contact-messages/:id', perm('messages'), admin.deleteContactMessage);

// User reports (from a member's profile "Report user" menu item)
router.get('/reports', perm('messages'), admin.getReports);
router.patch('/reports/:id', perm('messages'), admin.updateReport);
router.delete('/reports/:id', perm('messages'), admin.deleteReport);

export default router;
