import { Router } from 'express';
import * as referral from '../controllers/referralController.js';
import { protect } from '../middleware/auth.js';

const router = Router();

router.get('/status', referral.getStatus);
router.get('/me', protect, referral.getMyReferral);

export default router;
