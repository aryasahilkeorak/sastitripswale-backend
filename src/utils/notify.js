// Small helper to create an in-app notification without repeating the shape.
import Notification from '../models/Notification.js';
import { sendPush } from './push.js';

export async function notify(userId, { type, title, message, meta = {} }) {
  try {
    const n = await Notification.create({ user: userId, type, title, message, meta });
    // Fire the browser push in parallel — best-effort, never blocks the caller.
    sendPush(userId, { title, message, meta }).catch(() => {});
    return n;
  } catch (err) {
    // Notifications are best-effort — never break the main request.
    // eslint-disable-next-line no-console
    console.error('notify() failed:', err.message);
    return null;
  }
}

export default notify;
