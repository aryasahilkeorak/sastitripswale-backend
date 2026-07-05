// ============================================================
//  Razorpay integration with signature verification.
//  If keys are not configured the app falls back to TEST mode:
//  orders are still created (mock ids) so the whole UI flow works,
//  but verification is skipped. Switch to real by setting env keys.
// ============================================================
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { env } from '../config/env.js';

let client = null;
if (env.razorpay.enabled) {
  client = new Razorpay({
    key_id: env.razorpay.keyId,
    key_secret: env.razorpay.keySecret,
  });
}

export const razorpayEnabled = env.razorpay.enabled;

// Create an order (real when keys present, otherwise a deterministic mock).
export async function createOrder({ amountPaise, receipt }) {
  if (client) {
    return client.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt,
      payment_capture: 1,
    });
  }
  // TEST mode mock order — mirrors the shape the frontend needs.
  return {
    id: `order_test_${receipt}`,
    amount: amountPaise,
    currency: 'INR',
    receipt,
    status: 'created',
    __test: true,
  };
}

// Verify the checkout signature: HMAC_SHA256(order_id|payment_id, secret).
export function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (!env.razorpay.keySecret) return false;
  const expected = crypto
    .createHmac('sha256', env.razorpay.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return timingSafeEqualHex(expected, signature);
}

// Verify a webhook payload signature.
export function verifyWebhookSignature(rawBody, signature) {
  if (!env.razorpay.webhookSecret) return false;
  const expected = crypto
    .createHmac('sha256', env.razorpay.webhookSecret)
    .update(rawBody)
    .digest('hex');
  return timingSafeEqualHex(expected, signature);
}

function timingSafeEqualHex(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export default { createOrder, verifyPaymentSignature, verifyWebhookSignature, razorpayEnabled };
