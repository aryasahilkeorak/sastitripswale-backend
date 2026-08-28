// Nags a member with an incomplete profile to finish uploading their
// documents - repeats on a cooldown (not every sweep tick) until
// profileComplete flips true, at which point the query below simply stops
// selecting them. Mirrors utils/tripLifecycle.js's sweep pattern.
import User from '../models/User.js';
import Document from '../models/Document.js';
import Notification from '../models/Notification.js';
import { notify } from './notify.js';

// Once a day per user - frequent enough to nudge, not so often it reads as
// spam. The sweep itself can run more often (see server.js); this cooldown
// is what actually paces the notifications.
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

async function describeMissing(userId, hasVehicle) {
  const docs = await Document.find({ user: userId }).select('docType side');
  const has = (docType, side = '') => docs.some((d) => d.docType === docType && d.side === side);

  const missing = [];
  if (!has('selfie')) missing.push('your live selfie');
  if (!has('aadhaar', 'front') || !has('aadhaar', 'back')) missing.push('your Aadhaar card (front & back)');
  if (hasVehicle) {
    if (!has('driving_license', 'front') || !has('driving_license', 'back')) missing.push('your Driving Licence (front & back)');
    if (!has('rc', 'front') || !has('rc', 'back')) missing.push('your vehicle RC (front & back)');
  }
  return missing;
}

export async function sweepDocumentReminders() {
  const users = await User.find({
    isActive: true,
    role: 'member',
    isServiceAccount: { $ne: true },
    profileComplete: false,
  }).select('_id hasVehicle');

  if (!users.length) return { checked: 0, sent: 0 };

  const cutoff = new Date(Date.now() - REMINDER_COOLDOWN_MS);
  let sent = 0;

  for (const user of users) {
    // eslint-disable-next-line no-await-in-loop
    const recentlyReminded = await Notification.exists({
      user: user._id,
      type: 'profile_reminder',
      createdAt: { $gte: cutoff },
    });
    if (recentlyReminded) continue;

    // eslint-disable-next-line no-await-in-loop
    const missing = await describeMissing(user._id, user.hasVehicle);
    // Name/city/gender/interests are quick form fields with no "did they
    // bother" signal to nag about - only chase the parts that actually
    // require them to go find a physical document and take a photo.
    if (!missing.length) continue;

    // eslint-disable-next-line no-await-in-loop
    await notify(user._id, {
      type: 'profile_reminder',
      title: 'Finish setting up your profile',
      message: `Still need: ${missing.join(', ')} - upload to unlock trips and clubs.`,
      meta: {},
    });
    sent++;
  }

  return { checked: users.length, sent };
}

export default sweepDocumentReminders;
