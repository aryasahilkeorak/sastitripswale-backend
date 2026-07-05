import { Router } from 'express';
import * as pay from '../controllers/paymentController.js';
import { protect } from '../middleware/auth.js';

const router = Router();

router.post('/validate-coupon', protect, pay.validateCoupon);
router.post('/create-order', protect, pay.createOrderHandler);
router.post('/verify', protect, pay.verifyPayment);
router.post('/confirm-test', protect, pay.confirmTestPayment);
router.get('/history', protect, pay.getPaymentHistory);

// Public webhook (verified via signature inside the handler; raw body captured globally)
router.post('/webhook', pay.webhook);

export default router;
