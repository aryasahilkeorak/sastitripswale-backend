// ============================================================
//  Payment controller - coupons + Razorpay membership flow.
//  Works with real Razorpay keys, and also in a TEST mode
//  (no keys) so the whole UI flow is usable out of the box.
//
//  Two kinds of caller ("actor") hit these endpoints:
//   - an already-authenticated member (req.user) - renewing, buying a
//     Trip Pass, upgrading, etc.
//   - a brand-new signup who hasn't paid yet, so no User account exists -
//     identified only by the pendingToken from /auth/register (see
//     PendingSignup.js). Their real account is created right here, the
//     moment their payment actually succeeds (see completeCheckout) -
//     never before, so an abandoned signup never reserves a username.
// ============================================================
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import Payment from '../models/Payment.js';
import Coupon from '../models/Coupon.js';
import User from '../models/User.js';
import PendingSignup from '../models/PendingSignup.js';
import Influencer from '../models/Influencer.js';
import Commission from '../models/Commission.js';
import Setting from '../models/Setting.js';
import { env } from '../config/env.js';
import {
  createOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
  razorpayEnabled,
} from '../utils/razorpay.js';
import { notify } from '../utils/notify.js';
import { sendPaymentReceipt } from '../utils/email.js';
import { issueTokenPair } from '../utils/jwt.js';
import { materializeAccount } from '../utils/pendingSignup.js';
import {
  basePriceRupees,
  planLabel,
  durationMs,
  normalizeDuration,
  normalizeTripPackTier,
  tripPackPriceRupees,
} from '../utils/plans.js';

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

// Discount a base rupee price by a flat percentage → paise.
function priceWithPct(baseRupees, pct) {
  return Math.round(Math.max(0, baseRupees * (1 - pct / 100)) * 100);
}

// Resolves the caller of a pre-payment endpoint (validate-coupon,
// create-order): either an already-authenticated user, or a brand-new
// signup's still-live PendingSignup row (found by the pendingToken the
// client got back from /auth/register). Post-payment endpoints
// (verify/confirm-test/webhook) never call this - see assertOwnsPayment.
async function resolveActor(req) {
  if (req.user) return { user: req.user };
  const token = req.body?.pendingToken;
  if (!token) throw ApiError.unauthorized('Authentication required');
  const pending = await PendingSignup.findOne({ token });
  if (!pending) throw ApiError.badRequest('Your signup session has expired - please sign up again.');
  return { pending };
}

// The preference used for pricing: stored on the user/pending signup, else
// request, else 'both'.
function preferenceFor(req, actor) {
  return actor.user?.coTravelerPreference || actor.pending?.coTravelerPreference || req.body.preference || 'both';
}

// Resolves who referred `actor` right now - an existing user's fixed
// `referredBy`, or a pending signup's plain `referralCode` string,
// re-matched against a real member fresh (nothing was locked in for a
// signup that hasn't paid yet). Also carries whether the one-time referral
// discount has already been spent.
async function referrerFor(actor) {
  if (actor.user) {
    if (!actor.user.referredBy) return null;
    const referrer = await User.findById(actor.user.referredBy).select('referralCode username');
    return referrer ? { referrer, alreadyUsed: actor.user.referralDiscountUsed } : null;
  }
  if (!actor.pending.referralCode) return null;
  const referrer = await User.findOne({ referralCode: actor.pending.referralCode }).select('referralCode username');
  return referrer ? { referrer, alreadyUsed: false } : null;
}

// Whether `actor` currently has an unused referral discount to spend, and
// if so, how much.
function referralDiscountPct(referrerInfo, settings) {
  if (!referrerInfo || referrerInfo.alreadyUsed) return 0;
  if (!settings.referralEnabled || !settings.referralDiscountPct) return 0;
  return settings.referralDiscountPct;
}

// As above, but additionally requires `submittedCode` to match the
// referralCode of whoever actually referred `actor` - for the checkout box
// where a typed-in code might be a real Coupon, this member's own referrer,
// or neither. Returns the referrer's username too, so the UI can credit
// them by name ("you used username's referral code") rather than just
// echoing the code back.
async function referralDiscountForCode(actor, submittedCode, settings) {
  if (!submittedCode) return null;
  const referrerInfo = await referrerFor(actor);
  const pct = referralDiscountPct(referrerInfo, settings);
  if (!pct) return null;
  if (referrerInfo.referrer.referralCode !== submittedCode) return null;
  return { pct, referrerUsername: referrerInfo.referrer.username || '' };
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
  user.couponUsed = payment?.couponUsed || '';
  if (payment?.referralDiscountApplied) user.referralDiscountUsed = true;
  await user.save();

  if (payment?.couponUsed) {
    const coupon = await Coupon.findOneAndUpdate(
      { code: payment.couponUsed },
      { $inc: { usedCount: 1 } },
      { new: false }
    );
    // Influencer coupon + a real (non-zero) payment amount → accrue a
    // commission ledger row. Free (100%-off) coupons still count toward
    // usedCount above but never generate a commission - there's no payment
    // amount to take a cut of.
    if (coupon?.influencer && payment.amount > 0) {
      const influencer = await Influencer.findOne({ _id: coupon.influencer, status: 'approved' });
      if (influencer && influencer.commissionPct > 0) {
        const amountPaise = Math.round(payment.amount * (influencer.commissionPct / 100));
        if (amountPaise > 0) {
          await Commission.create({
            influencer: influencer._id,
            payment: payment._id,
            user: user._id,
            amountPaise,
          });
          influencer.totalEarnedPaise += amountPaise;
          await influencer.save();
          await User.updateOne({ _id: influencer.user }, { $inc: { walletBalancePaise: amountPaise } });
        }
      }
    }
  }

  // Referral reward - credited to the referrer's wallet the first time this
  // referred member actually pays (never at bare signup, and never twice).
  // It's a percentage of what the company actually collected from this
  // payment (payment.amount, already net of any referral discount/coupon),
  // not a flat amount - the tier depends on which position the referrer's
  // Nth converted referral (their own referralRewardsGiven + 1) falls into -
  // see Setting.referralTiers.
  if (user.referredBy && !user.referralRewardCredited && payment?.amount > 0) {
    const settings = await Setting.getSingleton();
    if (settings.referralEnabled) {
      const referrer = await User.findById(user.referredBy).select('referralRewardsGiven');
      if (referrer) {
        const position = referrer.referralRewardsGiven + 1;
        const tier = settings.referralTiers.find((t) => position >= t.from && (t.to == null || position <= t.to));
        const amountPaise = tier?.rewardPct ? Math.round(payment.amount * (tier.rewardPct / 100)) : 0;
        if (amountPaise > 0) {
          await User.updateOne(
            { _id: user.referredBy },
            { $inc: { walletBalancePaise: amountPaise, referralRewardsGiven: 1 } }
          );
          user.referralRewardCredited = true;
          await user.save();
          notify(user.referredBy, {
            type: 'system',
            title: 'Referral reward credited',
            message: `You earned ₹${(amountPaise / 100).toFixed(0)} in your wallet - someone you referred just activated their membership.`,
          });
        }
      }
    }
  }

  notify(user._id, {
    type: 'payment',
    title: 'Membership active',
    message: 'Your membership is active. Complete your profile to start planning and joining trips!',
  });
  sendPaymentReceipt(user, payment).catch(() => {});
}

// Trip Pass (pay-per-trip) activation - tops up host/join credits instead
// of setting a membership expiry. Deliberately simpler than
// activateMembership above: no coupons are ever accepted for this
// purpose (enforced in createOrderHandler), so there's no discount/free
// path, and referral-reward crediting stays scoped to duration-membership
// purchases only, not credit top-ups.
async function activateTripPack(user, payment) {
  const tier = normalizeTripPackTier(payment.packTier);
  user.hostCredits += tier;
  user.joinCredits += tier;
  await user.save();

  notify(user._id, {
    type: 'payment',
    title: 'Trip Pass credits added',
    message: `${tier} host credit${tier > 1 ? 's' : ''} and ${tier} join credit${tier > 1 ? 's' : ''} added to your account.`,
  });
  sendPaymentReceipt(user, payment).catch(() => {});
}

// Runs post-payment activation for a payment that just transitioned to
// 'success'. For a brand-new signup (payment.pendingSignupToken set, no
// payment.user yet) this is the ONE place the real account gets created -
// see materializeAccount - before the usual activation runs against it.
// For an already-existing user, it's unchanged from before: just fetch and
// activate. Callers (verify/confirm-test/webhook) only invoke this once,
// guarded by the pending→success transition, so activation never double-runs.
async function completeCheckout(payment) {
  let user;
  if (payment.pendingSignupToken && !payment.user) {
    user = await materializeAccount(payment.pendingSignup);
    payment.user = user._id;
    await payment.save();
    PendingSignup.deleteOne({ token: payment.pendingSignupToken }).catch(() => {});
  } else {
    user = await User.findById(payment.user);
  }
  if (!user) return null;
  if (payment.purpose === 'trip_pack') await activateTripPack(user, payment);
  else await activateMembership(user, payment);
  return user;
}

// Authorizes verify/confirm-test/webhook against the payment record itself,
// never the (possibly-since-expired or not-yet-issued) PendingSignup/JWT -
// a not-yet-materialized signup has no JWT to check, and once materialized
// the pendingSignupToken is kept on the payment permanently for exactly
// this purpose.
function assertOwnsPayment(req, payment) {
  if (payment.pendingSignupToken) {
    if (!req.body.pendingToken || req.body.pendingToken !== payment.pendingSignupToken) {
      throw ApiError.notFound('Payment record not found');
    }
    return;
  }
  if (!req.user || String(payment.user) !== String(req.user._id)) {
    throw ApiError.notFound('Payment record not found');
  }
}

export const validateCoupon = asyncHandler(async (req, res) => {
  const actor = await resolveActor(req);
  const code = String(req.body.code || '').toUpperCase().trim();
  const duration = normalizeDuration(req.body.duration);
  const preference = preferenceFor(req, actor);
  const base = basePriceRupees(preference, duration);

  if (!code) throw ApiError.badRequest('Coupon code required');
  const coupon = await Coupon.findOne({ code });

  if (coupon && coupon.isUsable()) {
    const finalPaise = priceWithCoupon(base, coupon);
    return res.json({
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
  }

  // Not a real coupon - is it actually the code of whoever referred this
  // member? If so it still "applies" here, as their automatic referral
  // discount rather than a Coupon record.
  const settings = await Setting.getSingleton();
  const referral = await referralDiscountForCode(actor, code, settings);
  if (referral) {
    const finalPaise = priceWithPct(base, referral.pct);
    return res.json({
      success: true,
      coupon: code,
      discountPct: referral.pct,
      discountAmt: null,
      baseRupees: base,
      finalAmountPaise: finalPaise,
      finalAmountRupees: finalPaise / 100,
      isFree: finalPaise === 0,
      label: planLabel(preference, duration),
      isReferral: true,
      referrerUsername: referral.referrerUsername,
    });
  }

  throw ApiError.badRequest('Invalid or expired coupon');
});

// Trip Pass order - flat price per tier (utils/plans.js), no coupon
// applicable, no free path. Delegated to from createOrderHandler below
// rather than living on its own route, so /payments/verify,
// /payments/confirm-test, and the webhook can all stay single entry
// points that branch on the resulting Payment's `purpose` field.
//
// Deliberately a plain async function, NOT wrapped in asyncHandler - it's
// only ever called from within createOrderHandler's own asyncHandler
// wrapper, so a thrown error here rejects createOrderHandler's promise and
// reaches asyncHandler's catch(next) normally. Wrapping it again would call
// asyncHandler's inner catch(next) with `next` as undefined, since this is
// invoked directly rather than by Express.
async function createTripPackOrder(req, res, actor) {
  if (req.body.coupon) throw ApiError.badRequest('Coupons are not applicable to Trip Pass purchases');

  const tier = normalizeTripPackTier(req.body.packTier);
  const finalPaise = tripPackPriceRupees(tier) * 100;

  const identity = actor.user
    ? { user: actor.user._id }
    : { pendingSignupToken: actor.pending.token, pendingSignup: pendingSnapshot(actor.pending) };

  const receipt = `stw_pack_${receiptId(actor)}_${Date.now()}`;
  const order = await createOrder({ amountPaise: finalPaise, receipt });
  await Payment.create({
    ...identity,
    amount: finalPaise,
    status: 'pending',
    purpose: 'trip_pack',
    packTier: tier,
    razorpayOrderId: order.id,
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
      name: actor.user?.fullName || '',
      email: actor.user?.email || actor.pending.email,
      contact: actor.user?.mobile || actor.pending.mobile,
    },
  });
}

// A short, receipt-safe identifier for `actor` - Razorpay caps `receipt` at
// 56 chars total, and a PendingSignup's full token (64 hex chars) alone
// blows past that, so it's truncated here (it's just a reference string,
// not a security check - ownership is proven separately, see
// assertOwnsPayment).
function receiptId(actor) {
  return actor.user ? actor.user._id : actor.pending.token.slice(0, 24);
}

// Trims a PendingSignup doc down to the plain snapshot object embedded on
// its Payment - see Payment.pendingSignup.
function pendingSnapshot(pending) {
  return {
    email: pending.email,
    username: pending.username,
    mobile: pending.mobile,
    passwordHash: pending.passwordHash,
    gender: pending.gender,
    coTravelerPreference: pending.coTravelerPreference,
    referralCode: pending.referralCode,
  };
}

export const createOrderHandler = asyncHandler(async (req, res) => {
  const actor = await resolveActor(req);
  if (req.body.planType === 'trip_pack') return createTripPackOrder(req, res, actor);

  const duration = normalizeDuration(req.body.duration);
  const preference = preferenceFor(req, actor);
  const base = basePriceRupees(preference, duration);
  const planFields = { planDuration: duration, planPreference: preference };

  const settings = await Setting.getSingleton();
  let coupon = null;
  let couponCode = null;
  let referralPct = null;
  if (req.body.coupon) {
    couponCode = String(req.body.coupon).toUpperCase().trim();
    coupon = await Coupon.findOne({ code: couponCode });
    if (!coupon || !coupon.isUsable()) {
      // Not a real coupon - fall back to checking whether it's actually
      // this member's own referral discount instead.
      const referral = await referralDiscountForCode(actor, couponCode, settings);
      if (!referral) throw ApiError.badRequest('Invalid or expired coupon');
      referralPct = referral.pct;
      coupon = null;
      couponCode = null;
    }
  } else {
    // No coupon code submitted at all - still auto-apply an unused
    // referral discount, so it's never missed just because the checkout
    // step didn't re-send the code.
    referralPct = referralDiscountPct(await referrerFor(actor), settings) || null;
  }

  const finalPaise = referralPct ? priceWithPct(base, referralPct) : priceWithCoupon(base, coupon);
  const referralDiscountApplied = referralPct != null;

  const identity = actor.user
    ? { user: actor.user._id }
    : { pendingSignupToken: actor.pending.token, pendingSignup: pendingSnapshot(actor.pending) };

  // --- FREE path (100% coupon or 100% referral discount) ---
  if (finalPaise <= 0) {
    const payment = await Payment.create({
      ...identity,
      amount: 0,
      status: 'success',
      purpose: 'membership',
      couponUsed: couponCode,
      referralDiscountApplied,
      ...planFields,
    });
    const user = await completeCheckout(payment);
    const body = {
      success: true,
      isFree: true,
      message: 'Membership activated for free!',
      user: user.toPrivateJSON(),
      payment,
    };
    // Brand-new signup - they have no session yet, so this is the only
    // response that will ever hand them one for the free path.
    if (!actor.user) {
      const pair = issueTokenPair(user);
      user.refreshTokenHash = pair.refreshTokenHash;
      await user.save();
      body.accessToken = pair.accessToken;
      body.refreshToken = pair.refreshToken;
    }
    return res.json(body);
  }

  // --- PAID path ---
  // Razorpay rejects orders under 100 paise (₹1) - a heavily-discounted
  // coupon/referral discount could otherwise leave a sub-rupee amount here.
  if (finalPaise < 100) throw ApiError.badRequest('Order amount must be at least ₹1');

  const receipt = `stw_${receiptId(actor)}_${Date.now()}`;
  const order = await createOrder({ amountPaise: finalPaise, receipt });
  await Payment.create({
    ...identity,
    amount: finalPaise,
    status: 'pending',
    purpose: 'membership',
    razorpayOrderId: order.id,
    couponUsed: couponCode,
    referralDiscountApplied,
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
      name: actor.user?.fullName || '',
      email: actor.user?.email || actor.pending.email,
      contact: actor.user?.mobile || actor.pending.mobile,
    },
  });
});

export const verifyPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    throw ApiError.badRequest('Missing payment verification fields');
  }

  const payment = await Payment.findOne({ razorpayOrderId: razorpay_order_id });
  if (!payment) throw ApiError.notFound('Payment record not found');
  assertOwnsPayment(req, payment);

  if (payment.status !== 'success') {
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
    await completeCheckout(payment);
  }

  if (!payment.pendingSignupToken) return res.json({ success: true });

  // Brand-new signup, verified here (or a racing webhook already got to it
  // first - either way completeCheckout above only ran once) - the client
  // has no session yet since this is the first time an account has existed
  // for them at all, so issue one now.
  const user = await User.findById(payment.user);
  const pair = issueTokenPair(user);
  user.refreshTokenHash = pair.refreshTokenHash;
  await user.save();
  res.json({ success: true, user: user.toPrivateJSON(), accessToken: pair.accessToken, refreshToken: pair.refreshToken });
});

// Used only when Razorpay keys are NOT configured, so the paid flow
// can still complete in local/test environments.
export const confirmTestPayment = asyncHandler(async (req, res) => {
  if (razorpayEnabled) {
    throw ApiError.badRequest('Test confirmation is disabled while Razorpay is live');
  }

  const payment = req.body.pendingToken
    ? await Payment.findOne({ pendingSignupToken: req.body.pendingToken, status: 'pending' }).sort({ createdAt: -1 })
    : req.user
      ? await Payment.findOne({ user: req.user._id, status: 'pending' }).sort({ createdAt: -1 })
      : null;
  if (!payment) throw ApiError.notFound('No pending payment to confirm');
  assertOwnsPayment(req, payment);

  payment.status = 'success';
  payment.razorpayPaymentId = `test_${Date.now()}`;
  await payment.save();
  await completeCheckout(payment);

  if (!payment.pendingSignupToken) {
    return res.json({ success: true, testMode: true, user: req.user.toPrivateJSON() });
  }
  const user = await User.findById(payment.user);
  const pair = issueTokenPair(user);
  user.refreshTokenHash = pair.refreshTokenHash;
  await user.save();
  res.json({
    success: true,
    testMode: true,
    user: user.toPrivateJSON(),
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
  });
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
      await completeCheckout(payment).catch(() => {});
    }
  }

  // Always 200 quickly - Razorpay retries on non-200.
  res.status(200).json({ received: true });
});

export const getPaymentHistory = asyncHandler(async (req, res) => {
  const payments = await Payment.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json({ success: true, payments });
});
