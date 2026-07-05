import { Router } from 'express';
import * as gallery from '../controllers/galleryController.js';
import { protect } from '../middleware/auth.js';
import { makeUploader } from '../middleware/upload.js';

const router = Router();
const photo = makeUploader('gallery');

router.get('/', gallery.getGallery);
router.post('/', protect, photo.single('photo'), gallery.uploadGalleryPhoto);

export default router;
