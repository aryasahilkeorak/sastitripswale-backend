import { Router } from 'express';
import * as auth from '../controllers/authController.js';
import { protect, requireRole } from '../middleware/auth.js';
import { makeUploader } from '../middleware/upload.js';
import {
  validate,
  registerRules,
  loginRules,
  forgotRules,
  resetRules,
  verifyTwoFactorRules,
  setupTwoFactorRules,
} from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimiters.js';

const router = Router();
const avatarUpload = makeUploader('avatars');

router.post('/register', authLimiter, avatarUpload.single('avatar'), registerRules, validate, auth.register);
router.post('/login', authLimiter, loginRules, validate, auth.login);
router.post('/verify-2fa', authLimiter, verifyTwoFactorRules, validate, auth.verifyTwoFactor);
router.post('/refresh', auth.refresh);
router.post('/logout', protect, auth.logout);
router.post('/change-password', protect, auth.changePassword);
router.get('/me', protect, auth.getMe);
router.post('/forgot-password', authLimiter, forgotRules, validate, auth.forgotPassword);
router.post('/reset-password', authLimiter, resetRules, validate, auth.resetPassword);

// 2FA (6-digit PIN) setup - admin/superadmin only.
router.post('/2fa/setup', protect, requireRole('admin', 'superadmin'), setupTwoFactorRules, validate, auth.setupTwoFactor);
router.post('/2fa/disable', protect, requireRole('admin', 'superadmin'), auth.disableTwoFactor);

export default router;
