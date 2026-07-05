// ============================================================
//  Payment controller — coupons + Razorpay membership flow.
//  Works with real Razorpay keys, and also in a TEST mode
//  (no keys) so the whole UI flow is usable out of the box.
// ============================================================
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import Payment from '../models/Payment.js';
import Coupon from '../models/Coupon.js';
import User from '../models/User.js';
import { env } from '../config/env.js';
import {
  createOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
  razorpayEnabled,
} from '../utils/razorpay.js';
import { notify } from '../utils/notify.js';
import { sendPaymentReceipt } from '../utils/email.js';
import { basePriceRupees, planLabel, durationMs, normalizeDuration } from '../utils/plans.js';

// Discount a base rupee price by an optional coupon → paise.
function priceWithCoupon(baseRupees, coupon) {
  let finalRupees = baseRupees;
  if (coupon) {
    if (coupon.discountPct) finalRupees = baseRupees * (1 - coupon.discountPct / 100);
    else if (coupon.discountAmt) finalRupees = baseRupees - coupon.discountAmt;
  }
  finalRupees = Math.max(0, finalRupees);
  return Math.round(finalRupees * 100); // paise
}

// The preference used for pricing: stored on the user, else request, else 'both'.
function preferenceFor(req) {
  return req.user.coTravelerPreference || req.body.preference || 'both';
}

async function activateMembership(user, payment) {
  const now = Date.now();
  // Extend from current expiry if still active (renewal), else from now.
  const from = user.membershipExpiresAt && user.membershipExpiresAt.getTime() > now
    ? user.membershipExpiresAt.getTime()
    : now;
  const duration = normalizeDuration(payment?.planDuration || '6m');

  user.membershipPaid = true;
  user.membershipPaidAt = new Date();
  user.membershipDuration = duration;
  user.membershipExpiresAt = new Date(from + durationMs(duration));
  await user.save();

  if (payment?.couponUsed) {
    await Coupon.updateOne({ code: payment.couponUsed }, { $inc: { usedCount: 1 } });
  }
  notify(user._id, {
    type: 'payment',
    title: 'Membership active ✅',
    message: 'Your membership is active. Complete your profile to start planning and joining trips!',
  });
  sendPaymentReceipt(user, payment).catch(() => {});
}

export const validateCoupon = asyncHandler(async (req, res) => {
  const code = String(req.body.code || '').toUpperCase().trim();
  const duration = normalizeDuration(req.body.duration);
  const preference = preferenceFor(req);
  const base = basePriceRupees(preference, duration);

  if (!code) throw ApiError.badRequest('Coupon code required');
  const coupon = await Coupon.findOne({ code });
  if (!coupon || !coupon.isUsable()) throw ApiError.badRequest('Invalid or expired coupon');

  const finalPaise = priceWithCoupon(base, coupon);
  res.json({
    success: true,
    coupon: code,
    discountPct: coupon.discountPct,
    discountAmt: coupon.discountAmt,
    baseRupees: base,
    finalAmountPaise: finalPaise,
    finalAmountRupees: finalPaise / 100,
    isFree: finalPaise === 0,
    label: planLabel(preference, duration),
  });
});

export const createOrderHandler = asyncHandler(async (req, res) => {
  const duration = normalizeDuration(req.body.duration);
  const preference = preferenceFor(req);
  const base = basePriceRupees(preference, duration);
  const planFields = { planDuration: duration, planPreference: preference };

  let coupon = null;
  let couponCode = null;
  if (req.body.coupon) {
    couponCode = String(req.body.coupon).toUpperCase().trim();
    coupon = await Coupon.findOne({ code: couponCode });
    if (!coupon || !coupon.isUsable()) throw ApiError.badRequest('Invalid or expired coupon');
  }

  const finalPaise = priceWithCoupon(base, coupon);

  // --- FREE path (100% coupon) ---
  if (finalPaise <= 0) {
    const payment = await Payment.create({
      user: req.user._id,
      amount: 0,
      status: 'success',
      purpose: 'membership',
      couponUsed: couponCode,
      ...planFields,
    });
    await activateMembership(req.user, payment);
    return res.json({
      success: true,
      isFree: true,
      message: 'Membership activated for free! 🎉',
      user: req.user.toPrivateJSON(),
      payment,
    });
  }

  // --- PAID path ---
  const receipt = `stw_${req.user._id}_${Date.now()}`;
  const order = await createOrder({ amountPaise: finalPaise, receipt });
  await Payment.create({
    user: req.user._id,
    amount: finalPaise,
    status: 'pending',
    purpose: 'membership',
    razorpayOrderId: order.id,
    couponUsed: couponCode,
    ...planFields,
  });

  res.json({
    success: true,
    isFree: false,
    testMode: order.__test === true || !razorpayEnabled,
    orderId: order.id,
    keyId: env.razorpay.keyId,
    amount: finalPaise,
    currency: 'INR',
    prefill: {
      name: req.user.fullName,
      email: req.user.email,
      contact: req.user.mobile,
    },
  });
});

export const verifyPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    throw ApiError.badRequest('Missing payment verification fields');
  }

  const payment = await Payment.findOne({
    razorpayOrderId: razorpay_order_id,
    user: req.user._id,
  });
  if (!payment) throw ApiError.notFound('Payment record not found');
  if (payment.status === 'success') return res.json({ success: true, alreadyDone: true });

  const valid = verifyPaymentSignature({
    orderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
    signature: razorpay_signature,
  });
  if (!valid) {
    payment.status = 'failed';
    await payment.save();
    throw ApiError.badRequest('Payment verification failed');
  }

  payment.status = 'success';
  payment.razorpayPaymentId = razorpay_payment_id;
  payment.razorpaySignature = razorpay_signature;
  await payment.save();
  await activateMembership(req.user, payment);

  res.json({ success: true });
});

// Used only when Razorpay keys are NOT configured, so the paid flow
// can still complete in local/test environments.
export const confirmTestPayment = asyncHandler(async (req, res) => {
  if (razorpayEnabled) {
    throw ApiError.badRequest('Test confirmation is disabled while Razorpay is live');
  }
  const payment = await Payment.findOne({ user: req.user._id, status: 'pending' }).sort({
    createdAt: -1,
  });
  if (!payment) throw ApiError.notFound('No pending payment to confirm');

  payment.status = 'success';
  payment.razorpayPaymentId = `test_${Date.now()}`;
  await payment.save();
  await activateMembership(req.user, payment);

  res.json({ success: true, testMode: true, user: req.user.toPrivateJSON() });
});

export const webhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const rawStr = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});

  if (!verifyWebhookSignature(rawStr, signature)) {
    return res.status(400).json({ received: false });
  }

  let event;
  try {
    event = JSON.parse(rawStr);
  } catch {
    return res.status(400).json({ received: false });
  }

  if (event.event === 'payment.captured') {
    const entity = event.payload?.payment?.entity || {};
    const payment = await Payment.findOne({ razorpayOrderId: entity.order_id });
    if (payment && payment.status !== 'success') {
      payment.status = 'success';
      payment.razorpayPaymentId = entity.id;
      await payment.save();
      const user = await User.findById(payment.user);
      if (user) await activateMembership(user, payment);
    }
  }

  // Always 200 quickly — Razorpay retries on non-200.
  res.status(200).json({ received: true });
});

export const getPaymentHistory = asyncHandler(async (req, res) => {
  const payments = await Payment.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json({ success: true, payments });
});
