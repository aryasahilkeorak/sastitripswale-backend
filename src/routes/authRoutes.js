import { Router } from 'express';
import * as auth from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';
import { makeUploader } from '../middleware/upload.js';
import {
  validate,
  registerRules,
  loginRules,
  forgotRules,
  resetRules,
} from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimiters.js';

const router = Router();
const avatarUpload = makeUploader('avatars');

router.post('/register', authLimiter, avatarUpload.single('avatar'), registerRules, validate, auth.register);
router.post('/login', authLimiter, loginRules, validate, auth.login);
router.post('/refresh', auth.refresh);
router.post('/logout', protect, auth.logout);
router.post('/change-password', protect, auth.changePassword);
router.get('/me', protect, auth.getMe);
router.post('/forgot-password', authLimiter, forgotRules, validate, auth.forgotPassword);
router.post('/reset-password', authLimiter, resetRules, validate, auth.resetPassword);

export default router;
