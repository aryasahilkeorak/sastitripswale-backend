import { Router } from 'express';
import * as review from '../controllers/reviewController.js';
import { protect } from '../middleware/auth.js';
import { validate, reviewRules } from '../middleware/validate.js';

const router = Router();

router.get('/', review.getReviews);
router.post('/', protect, reviewRules, validate, review.createReview);

export default router;
