// ============================================================
//  Membership plan pricing.
//  Price depends on co-traveler preference + duration:
//    only male / only female  → 6m ₹199, 1y ₹299
//    male + female (both)     → 6m ₹299, 1y ₹499
// ============================================================
export const PLAN_PRICES = {
  single: { '6m': 199, '1y': 299 }, // only male OR only female
  both: { '6m': 299, '1y': 499 }, // male + female
};

export const DURATIONS = ['6m', '1y'];

export function tierForPreference(pref) {
  return pref === 'both' ? 'both' : 'single';
}

export function normalizeDuration(d) {
  return d === '1y' ? '1y' : '6m';
}

export function basePriceRupees(preference, duration) {
  const tier = tierForPreference(preference);
  return PLAN_PRICES[tier][normalizeDuration(duration)];
}

export function planLabel(preference, duration) {
  const who = preference === 'both' ? 'Male + Female' : preference === 'female' ? 'Only Female' : 'Only Male';
  const dur = normalizeDuration(duration) === '1y' ? '1 year' : '6 months';
  return `${who} · ${dur}`;
}

// Days in each duration (6m ≈ 182 days).
export function durationMs(duration) {
  return (normalizeDuration(duration) === '1y' ? 365 : 182) * 24 * 60 * 60 * 1000;
}

export default { PLAN_PRICES, DURATIONS, basePriceRupees, planLabel, durationMs };
