import { Router } from 'express';
import authRoutes from './authRoutes.js';
import tripRoutes from './tripRoutes.js';
import groupTripRoutes from './groupTripRoutes.js';
import paymentRoutes from './paymentRoutes.js';
import memberRoutes from './memberRoutes.js';
import galleryRoutes from './galleryRoutes.js';
import reviewRoutes from './reviewRoutes.js';
import adminRoutes from './adminRoutes.js';
import contactRoutes from './contactRoutes.js';
import chatRoutes from './chatRoutes.js';
import clubRoutes from './clubRoutes.js';
import referralRoutes from './referralRoutes.js';
import placesRoutes from './placesRoutes.js';
import influencerRoutes from './influencerRoutes.js';
import walletRoutes from './walletRoutes.js';
import { getPublicStats, getCityStats } from '../controllers/statsController.js';
import { razorpayEnabled } from '../utils/razorpay.js';
import { env } from '../config/env.js';

const router = Router();

router.get('/stats', getPublicStats);
router.get('/stats/cities', getCityStats);

router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    razorpay: razorpayEnabled ? 'live' : 'test-mode',
    membershipFee: env.membershipFee,
  });
});

router.use('/auth', authRoutes);
router.use('/trips', tripRoutes);
router.use('/group-trips', groupTripRoutes);
router.use('/payments', paymentRoutes);
router.use('/members', memberRoutes);
router.use('/gallery', galleryRoutes);
router.use('/reviews', reviewRoutes);
router.use('/admin', adminRoutes);
router.use('/contact', contactRoutes);
router.use('/chat', chatRoutes);
router.use('/clubs', clubRoutes);
router.use('/referrals', referralRoutes);
router.use('/places', placesRoutes);
router.use('/influencers', influencerRoutes);
router.use('/wallet', walletRoutes);

export default router;
