// ============================================================
//  Wallet - referral rewards + influencer commission earnings, with a
//  member-initiated withdrawal request flow. Admin approves/pays out
//  manually (UPI/bank transfer) using the submitted details - see
//  adminController.js for the review side.
// ============================================================
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import Withdrawal from '../models/Withdrawal.js';
import Influencer from '../models/Influencer.js';
import { saveUpload } from '../utils/uploadStore.js';

const MIN_WITHDRAWAL_PAISE = 10000; // ₹100
const PAN_RX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

// GET /wallet/me - my balance + my own withdrawal history.
// "Lifetime earnings" = current balance + everything ever withdrawn (except
// rejected requests, which were refunded back into the balance) - so it
// always reflects total earnings regardless of how much has been cashed out.
export const getMyWallet = asyncHandler(async (req, res) => {
  const balancePaise = req.user.walletBalancePaise || 0;
  const [withdrawals, withdrawnAgg] = await Promise.all([
    Withdrawal.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50),
    Withdrawal.aggregate([
      { $match: { user: req.user._id, status: { $ne: 'rejected' } } },
      { $group: { _id: null, total: { $sum: '$amountPaise' } } },
    ]),
  ]);

  res.json({
    success: true,
    balancePaise,
    lifetimeEarningsPaise: balancePaise + (withdrawnAgg[0]?.total || 0),
    withdrawals,
  });
});

// POST /wallet/withdraw - request a payout (multipart: qrCode image field).
export const requestWithdrawal = asyncHandler(async (req, res) => {
  const user = req.user;
  const isApprovedInfluencer = await Influencer.exists({ user: user._id, status: 'approved' });
  if (!user.isVerified && !isApprovedInfluencer) {
    throw ApiError.forbidden('Only verified members or approved influencers can withdraw wallet earnings');
  }

  const amountPaise = Math.round(Number(req.body.amountPaise));
  if (!amountPaise || amountPaise < MIN_WITHDRAWAL_PAISE) {
    throw ApiError.badRequest('Minimum withdrawal amount is ₹100');
  }
  if (amountPaise > (user.walletBalancePaise || 0)) {
    throw ApiError.badRequest('Withdrawal amount exceeds your wallet balance');
  }

  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const upiId = String(req.body.upiId || '').trim();
  const panNumber = String(req.body.panNumber || '').trim().toUpperCase();
  if (!name) throw ApiError.badRequest('Name is required');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw ApiError.badRequest('A valid email is required');
  if (!upiId) throw ApiError.badRequest('UPI ID is required');
  if (!PAN_RX.test(panNumber)) throw ApiError.badRequest('Enter a valid PAN number');
  if (!req.file) throw ApiError.badRequest("Upload a QR code image of your bank/UPI account");

  const qrCodeUrl = await saveUpload(req.file, { owner: user._id, kind: 'qr' });

  const withdrawal = await Withdrawal.create({
    user: user._id,
    amountPaise,
    name,
    email,
    upiId,
    qrCodeUrl,
    panNumber,
  });

  // Reserve the amount immediately so the same balance can't be requested
  // twice across overlapping pending requests - refunded if admin rejects.
  user.walletBalancePaise = (user.walletBalancePaise || 0) - amountPaise;
  await user.save();

  res.status(201).json({ success: true, withdrawal, balancePaise: user.walletBalancePaise });
});
