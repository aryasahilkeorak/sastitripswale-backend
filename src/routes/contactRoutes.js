import { Router } from 'express';
import { submitContact } from '../controllers/contactController.js';
import { validate, contactRules } from '../middleware/validate.js';
import { writeLimiter } from '../middleware/rateLimiters.js';

const router = Router();

router.post('/', writeLimiter, contactRules, validate, submitContact);

export default router;
