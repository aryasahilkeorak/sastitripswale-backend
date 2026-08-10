import { Router } from 'express';
import { autocompletePlaces } from '../controllers/placesController.js';
import { generalLimiter } from '../middleware/rateLimiters.js';

const router = Router();

router.get('/autocomplete', generalLimiter, autocompletePlaces);

export default router;
