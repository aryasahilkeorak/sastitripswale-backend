// Small helper to create an in-app notification without repeating the shape.
import Notification from '../models/Notification.js';

export async function notify(userId, { type, title, message, meta = {} }) {
  try {
    return await Notification.create({ user: userId, type, title, message, meta });
  } catch (err) {
    // Notifications are best-effort — never break the main request.
    // eslint-disable-next-line no-console
    console.error('notify() failed:', err.message);
    return null;
  }
}

export default notify;
