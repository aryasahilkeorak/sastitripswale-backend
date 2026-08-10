import { geocodePlace } from './places.js';

// Free, keyless driving-route distance via OSRM's public demo server. Good
// enough for a cost *estimate*; it's a shared community server (not an SLA'd
// service), so this should stay a low-volume, on-demand calculation - never
// something called per-keystroke or in a loop.
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving/';

// Approximate India-wide averages (₹). Real prices vary by state and change
// often - these exist purely to produce a directional estimate, and are
// always surfaced to the host as "approx" so they know to sanity-check it.
export const FUEL_PRICE_PER_LITRE = { Petrol: 105, Diesel: 93, CNG: 85 }; // CNG priced per kg, treated as a litre-equivalent unit here
export const AVG_TOLL_PER_KM = 1.75; // national/state highway average

async function getRouteDistanceKm(placeNames) {
  const points = await Promise.all(placeNames.map(geocodePlace));
  if (points.some((p) => !p)) return null;
  if (points.length < 2) return null;

  const coordsStr = points.map((p) => `${p.lon},${p.lat}`).join(';');
  try {
    const res = await fetch(`${OSRM_URL}${coordsStr}?overview=false`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.[0]) return null;
    return data.routes[0].distance / 1000; // metres -> km
  } catch {
    return null;
  }
}

// { origin, viaStops, destination, mileageKmpl, fuelType } -> cost estimate
// for the ROUND TRIP (there and back) - the realistic cost to the vehicle
// owner for a group trip that returns to where it started. Returns null if
// any stop couldn't be geocoded or no route was found between them.
export async function estimateTripCost({ origin, viaStops = [], destination, mileageKmpl, fuelType }) {
  const stops = [origin, ...viaStops.filter(Boolean), destination].filter(Boolean);
  if (stops.length < 2) return null;

  const oneWayKm = await getRouteDistanceKm(stops);
  if (oneWayKm == null) return null;

  const roundTripKm = oneWayKm * 2;
  const pricePerLitre = FUEL_PRICE_PER_LITRE[fuelType] ?? FUEL_PRICE_PER_LITRE.Petrol;
  const litresNeeded = mileageKmpl > 0 ? roundTripKm / mileageKmpl : 0;
  const fuelCost = Math.round(litresNeeded * pricePerLitre);
  const tollCost = Math.round(roundTripKm * AVG_TOLL_PER_KM);

  return {
    oneWayKm: Math.round(oneWayKm * 10) / 10,
    roundTripKm: Math.round(roundTripKm * 10) / 10,
    fuelCost,
    tollCost,
    totalCost: fuelCost + tollCost,
    assumptions: {
      fuelPricePerLitre: pricePerLitre,
      avgTollPerKm: AVG_TOLL_PER_KM,
      roundTrip: true,
    },
  };
}

export default { estimateTripCost };
