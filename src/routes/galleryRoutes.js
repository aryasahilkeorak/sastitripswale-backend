import { Router } from 'express';
import * as gallery from '../controllers/galleryController.js';
import { protect, attachUser } from '../middleware/auth.js';
import { makeUploader } from '../middleware/upload.js';

const router = Router();
const photo = makeUploader('gallery');

router.get('/', attachUser, gallery.getGallery);
router.post('/', protect, photo.single('photo'), gallery.uploadGalleryPhoto);

router.get('/:id/comments', gallery.listComments);
router.post('/:id/comments', protect, gallery.addComment);
router.delete('/:id/comments/:commentId', protect, gallery.deleteComment);
router.post('/:id/like', protect, gallery.toggleLike);
router.post('/:id/repost', protect, gallery.repostPhoto);

export default router;
