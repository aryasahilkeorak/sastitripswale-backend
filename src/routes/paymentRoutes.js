import { Router } from 'express';
import * as pay from '../controllers/paymentController.js';
import { protect, attachUser } from '../middleware/auth.js';

const router = Router();

// attachUser (not protect) on the checkout endpoints - a brand-new signup
// has no JWT yet (their account doesn't exist until payment succeeds), so
// these authorize via req.user when present, else a pendingToken in the
// body. See paymentController's resolveActor / assertOwnsPayment.
router.post('/validate-coupon', attachUser, pay.validateCoupon);
router.post('/create-order', attachUser, pay.createOrderHandler);
router.post('/verify', attachUser, pay.verifyPayment);
router.post('/confirm-test', attachUser, pay.confirmTestPayment);
router.get('/history', protect, pay.getPaymentHistory);

// Public webhook (verified via signature inside the handler; raw body captured globally)
router.post('/webhook', pay.webhook);

export default router;
