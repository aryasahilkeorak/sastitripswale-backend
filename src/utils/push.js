// ============================================================
//  Browser push (Web Push / VAPID). Best-effort - a failed or
//  expired subscription is dropped, but never breaks the caller.
// ============================================================
import webpush from 'web-push';
import { env } from '../config/env.js';
import PushSubscription from '../models/PushSubscription.js';

webpush.setVapidDetails(`mailto:${env.push.contactEmail}`, env.push.publicKey, env.push.privateKey);

export async function sendPush(userId, { title, message, meta = {} }) {
  const subs = await PushSubscription.find({ user: userId });
  if (!subs.length) return;

  const payload = JSON.stringify({ title, body: message, meta });
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
      } catch (err) {
        // 404/410 = the browser dropped this subscription - stop trying it.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await sub.deleteOne();
        } else {
          // eslint-disable-next-line no-console
          console.error('sendPush() failed:', err.message);
        }
      }
    })
  );
}

export default sendPush;
