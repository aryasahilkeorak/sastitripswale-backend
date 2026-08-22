// Small helper to create an in-app notification without repeating the shape.
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { hasPermission } from './permissions.js';
import { sendPush } from './push.js';

export async function notify(userId, { type, title, message, meta = {} }) {
  try {
    const n = await Notification.create({ user: userId, type, title, message, meta });
    // Fire the browser push in parallel - best-effort, never blocks the caller.
    sendPush(userId, { title, message, meta }).catch(() => {});
    return n;
  } catch (err) {
    // Notifications are best-effort - never break the main request.
    // eslint-disable-next-line no-console
    console.error('notify() failed:', err.message);
    return null;
  }
}

// Broadcasts a notification to every admin/superadmin who should hear about
// it - a member submitting documents, raising a query, applying as an
// influencer, requesting a withdrawal, or being reported. Super admins
// always get everything; a plain admin only gets it if granted the matching
// `permission` (see utils/permissions.js) - same gate as the admin routes
// themselves, so nobody sees a notification for a section they can't open.
// The shared support/service account is excluded - it's a bot, not staff.
export async function notifyAdmins({ type, title, message, meta = {}, permission } = {}) {
  try {
    const staff = await User.find({
      role: { $in: ['admin', 'superadmin'] },
      isServiceAccount: { $ne: true },
    }).select('_id role permissions');
    const targets = staff.filter((a) => !permission || hasPermission(a, permission));
    await Promise.all(targets.map((a) => notify(a._id, { type, title, message, meta })));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('notifyAdmins() failed:', err.message);
  }
}

export default notify;
