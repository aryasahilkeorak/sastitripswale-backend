import { Router } from 'express';
import authRoutes from './authRoutes.js';
import tripRoutes from './tripRoutes.js';
import paymentRoutes from './paymentRoutes.js';
import memberRoutes from './memberRoutes.js';
import galleryRoutes from './galleryRoutes.js';
import reviewRoutes from './reviewRoutes.js';
import adminRoutes from './adminRoutes.js';
import contactRoutes from './contactRoutes.js';
import chatRoutes from './chatRoutes.js';
import { razorpayEnabled } from '../utils/razorpay.js';
import { env } from '../config/env.js';

const router = Router();

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
router.use('/payments', paymentRoutes);
router.use('/members', memberRoutes);
router.use('/gallery', galleryRoutes);
router.use('/reviews', reviewRoutes);
router.use('/admin', adminRoutes);
router.use('/contact', contactRoutes);
router.use('/chat', chatRoutes);

export default router;
