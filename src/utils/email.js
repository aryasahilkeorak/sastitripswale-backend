// ============================================================
//  Email — Nodemailer with a safe fallback.
//  If SMTP creds are not configured, emails are logged to the
//  console instead of failing, so the app runs out of the box.
// ============================================================
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transporter = null;
if (env.email.enabled) {
  transporter = nodemailer.createTransport({
    host: env.email.host,
    port: env.email.port,
    secure: env.email.port === 465,
    auth: { user: env.email.user, pass: env.email.pass },
  });
}

// Base HTML wrapper — dark navy + fire gradient, matches the site theme.
function wrap(title, bodyHtml) {
  return `
  <div style="background:#06070d;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#131624;border:1px solid rgba(255,255,255,0.08);border-radius:20px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#ff6b00,#e040fb);padding:22px 28px;">
        <h1 style="margin:0;color:#06070d;font-size:20px;font-weight:800;">SastiTripWale</h1>
      </div>
      <div style="padding:28px;color:#f0f2ff;line-height:1.7;">
        <h2 style="margin:0 0 14px;font-size:18px;color:#f0f2ff;">${title}</h2>
        <div style="color:#a8b0cc;font-size:14px;">${bodyHtml}</div>
      </div>
      <div style="padding:16px 28px;border-top:1px solid rgba(255,255,255,0.08);color:#5a6380;font-size:12px;">
        Travel Together • Split Expenses • Make New Travel Friends<br/>
        This is an automated message from SastiTripWale.
      </div>
    </div>
  </div>`;
}

async function send({ to, subject, html }) {
  if (!transporter) {
    // Dev fallback — do not fail the request just because email is off.
    // eslint-disable-next-line no-console
    console.log(`\n📧 [email disabled] To: ${to} | Subject: ${subject}`);
    return { queued: false, logged: true };
  }
  await transporter.sendMail({ from: env.email.from, to, subject, html });
  return { queued: true };
}

export function sendWelcomeEmail(user) {
  return send({
    to: user.email,
    subject: 'Welcome to the SastiTripWale tribe! 🔥',
    html: wrap(
      `Welcome aboard, ${user.fullName}!`,
      `<p>You're now part of India's verified travel community.</p>
       <p><b>Next steps:</b></p>
       <ul>
         <li>Complete your membership to unlock trips</li>
         <li>Browse upcoming trips and show interest</li>
         <li>Plan your own trip and find co-travelers</li>
       </ul>
       <p>Ride safe, travel cheap. 🏍️</p>`
    ),
  });
}

export function sendPaymentReceipt(user, payment) {
  const rupees = (payment.amount / 100).toLocaleString('en-IN');
  return send({
    to: user.email,
    subject: 'Your SastiTripWale membership is active ✅',
    html: wrap(
      'Payment received',
      `<p>Hi ${user.fullName}, your membership is now <b>active</b>.</p>
       <p><b>Amount:</b> ₹${rupees}<br/>
       <b>Reference:</b> ${payment.razorpayPaymentId || payment._id}<br/>
       <b>Date:</b> ${new Date(payment.createdAt || Date.now()).toLocaleString('en-IN')}</p>
       <p>Time to find your tribe. 🎒</p>`
    ),
  });
}

export function sendJoinRequestEmail(organizer, requester, trip) {
  return send({
    to: organizer.email,
    subject: `${requester.fullName} wants to join your ${trip.destination} trip!`,
    html: wrap(
      'New join request 🔥',
      `<p>Hi ${organizer.fullName},</p>
       <p><b>${requester.fullName}</b> (${requester.city || 'India'}) requested to join your trip to
       <b>${trip.destination}</b>.</p>
       <p>Review the request on your trip page to accept or decline.</p>`
    ),
  });
}

export function sendJoinAcceptedEmail(requester, organizer, trip) {
  return send({
    to: requester.email,
    subject: `You're in! ${trip.destination} trip request accepted`,
    html: wrap(
      "You're in! 🎉",
      `<p>Hi ${requester.fullName},</p>
       <p><b>${organizer.fullName}</b> accepted your request to join the trip to
       <b>${trip.destination}</b>.</p>
       <p>You've been added to the trip chat group — say hi!</p>`
    ),
  });
}

export function sendJoinRejectedEmail(requester, organizer, trip) {
  return send({
    to: requester.email,
    subject: `Update on your ${trip.destination} trip request`,
    html: wrap(
      'Request declined',
      `<p>Hi ${requester.fullName},</p>
       <p><b>${organizer.fullName}</b> wasn't able to accept your request to join the trip to
       <b>${trip.destination}</b> this time.</p>
       <p>Browse other upcoming trips — your next adventure is waiting. 🎒</p>`
    ),
  });
}

export function sendPasswordResetEmail(user, resetUrl) {
  return send({
    to: user.email,
    subject: 'Reset your SastiTripWale password',
    html: wrap(
      'Password reset requested',
      `<p>Hi ${user.fullName}, click the button below to reset your password.
       This link expires in 1 hour.</p>
       <p style="margin:22px 0;">
         <a href="${resetUrl}" style="background:linear-gradient(135deg,#ff6b00,#e040fb);color:#06070d;
            padding:12px 26px;border-radius:999px;font-weight:700;text-decoration:none;">Reset Password</a>
       </p>
       <p style="color:#5a6380;">If you didn't request this, you can safely ignore this email.</p>`
    ),
  });
}

export default {
  sendWelcomeEmail,
  sendPaymentReceipt,
  sendJoinRequestEmail,
  sendJoinAcceptedEmail,
  sendJoinRejectedEmail,
  sendPasswordResetEmail,
};
