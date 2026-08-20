import { Router } from 'express';
import * as influencer from '../controllers/influencerController.js';
import { protect, attachUser } from '../middleware/auth.js';
import { makeUploader } from '../middleware/upload.js';

const router = Router();
const screenshotUploader = makeUploader('influencers');

router.get('/', attachUser, influencer.listPublicInfluencers);
router.post('/apply', protect, screenshotUploader.single('screenshot'), influencer.applyInfluencer);
router.get('/me', protect, influencer.getMyInfluencerProfile);
router.post('/me/videos', protect, influencer.addInfluencerVideo);
router.delete('/me/videos/:videoId', protect, influencer.removeInfluencerVideo);

export default router;
