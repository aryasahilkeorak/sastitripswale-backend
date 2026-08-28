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

// ============================================================
//  Trip Pass (pay-per-trip) plan - a lightweight alternative to the
//  duration plans above, for members who just want to try a handful of
//  trips. Flat price regardless of co-traveler preference (unlike the
//  duration plans). Each tier grants that many HOST credits and that many
//  JOIN credits - two separate pools, e.g. tier 2 = 2 host + 2 join
//  credits, not 2 total. Buying tops up existing credits rather than
//  resetting them, same as how duration-plan renewals extend from the
//  current expiry rather than discarding remaining time.
// ============================================================
export const TRIP_PACK_TIERS = [1, 2, 3];
export const TRIP_PACK_PRICES = { 1: 29, 2: 49, 3: 59 };

export function normalizeTripPackTier(tier) {
  const n = Number(tier);
  return TRIP_PACK_TIERS.includes(n) ? n : 1;
}

export function tripPackPriceRupees(tier) {
  return TRIP_PACK_PRICES[normalizeTripPackTier(tier)];
}

export function tripPackLabel(tier) {
  const n = normalizeTripPackTier(tier);
  return `Trip Pass - ${n} host + ${n} join credit${n > 1 ? 's' : ''}`;
}

export default {
  PLAN_PRICES,
  DURATIONS,
  basePriceRupees,
  planLabel,
  durationMs,
  TRIP_PACK_TIERS,
  TRIP_PACK_PRICES,
  tripPackPriceRupees,
  tripPackLabel,
};
