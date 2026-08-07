// ============================================================
//  Two-tier verification, computed from reviewed documents.
//  'verified'         — Aadhaar (front+back) + PAN + live selfie, all verified.
//  'vehicle_verified' — the above, plus Driving Licence (front+back) and
//                        at least one vehicle's RC (front+back).
// ============================================================
import Document from '../models/Document.js';
import User from '../models/User.js';

const NORMAL_REQUIRED = [
  ['aadhaar', 'front'],
  ['aadhaar', 'back'],
  ['pan', ''],
  ['selfie', ''],
];
const VEHICLE_EXTRA_REQUIRED = [
  ['driving_license', 'front'],
  ['driving_license', 'back'],
  ['rc', 'front'],
  ['rc', 'back'],
];

function hasAllVerified(docs, specs) {
  return specs.every(([docType, side]) => docs.some((d) => d.docType === docType && d.side === side && d.status === 'verified'));
}

// Recomputes and persists `verificationLevel` (+ the derived `isVerified`
// flag) for a user, based on their current Document statuses. Call this
// after any document review. Returns null if the user no longer exists.
export async function recomputeVerification(userId) {
  const [docs, user] = await Promise.all([
    Document.find({ user: userId }).select('docType side status'),
    User.findById(userId),
  ]);
  if (!user) return null;

  const isNormal = hasAllVerified(docs, NORMAL_REQUIRED);
  const isVehicle = isNormal && hasAllVerified(docs, VEHICLE_EXTRA_REQUIRED);
  const level = isVehicle ? 'vehicle_verified' : isNormal ? 'verified' : 'none';

  const previous = user.verificationLevel || 'none';
  const desiredIsVerified = level !== 'none';
  // Write whenever either field is out of sync — not just on a tier
  // transition — so a stale/manually-set isVerified (e.g. from before this
  // tiered system existed) always gets corrected to match reality.
  if (previous !== level || user.isVerified !== desiredIsVerified) {
    user.verificationLevel = level;
    user.isVerified = desiredIsVerified;
    await user.save();
  }
  return { level, previous, changed: previous !== level };
}

export default recomputeVerification;
