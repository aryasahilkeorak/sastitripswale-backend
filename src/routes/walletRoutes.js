import { Router } from 'express';
import * as wallet from '../controllers/walletController.js';
import { protect } from '../middleware/auth.js';
import { makeUploader } from '../middleware/upload.js';

const router = Router();
const uploader = makeUploader('wallet');

router.get('/me', protect, wallet.getMyWallet);
router.post('/withdraw', protect, uploader.single('qrCode'), wallet.requestWithdrawal);

export default router;
