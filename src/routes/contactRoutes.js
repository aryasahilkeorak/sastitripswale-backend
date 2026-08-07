import { Router } from 'express';
import { submitContact } from '../controllers/contactController.js';
import { validate, contactRules } from '../middleware/validate.js';
import { writeLimiter } from '../middleware/rateLimiters.js';
import { attachUser } from '../middleware/auth.js';

const router = Router();

router.post('/', attachUser, writeLimiter, contactRules, validate, submitContact);

export default router;
