import { geocodePlace } from './places.js';

// Free, keyless driving-route distance + geometry via OSRM's public demo
// server. Good enough for a cost *estimate*; it's a shared community server
// (not an SLA'd service), so this should stay a low-volume, on-demand
// calculation - never something called per-keystroke or in a loop.
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving/';

// Free, keyless OpenStreetMap query API - used to find real toll booths
// (barrier=toll_booth, how NHAI plazas are tagged in India) near the
// computed route, instead of guessing tolls from a flat per-km rate. It's
// a shared community service that occasionally 504s under load, so two
// mirrors of the same public dataset are tried before giving up.
const OVERPASS_URLS = ['https://overpass-api.de/api/interpreter', 'https://lz4.overpass-api.de/api/interpreter'];
const TOLL_PROXIMITY_KM = 1; // a toll booth this close to the path counts as "on this route"
const FETCH_TIMEOUT_MS = 12000;

// Overpass's public instances do strict content negotiation and 406 a
// request that doesn't send an explicit Accept/User-Agent (Node's fetch
// default headers aren't enough) - send both on every call to these APIs.
const REQUEST_HEADERS = { Accept: 'application/json, text/plain, */*', 'User-Agent': 'SastiTripsWale-CostEstimator/1.0' };

// Approximate India-wide averages (₹). Real prices vary by state and change
// often - these exist purely to produce a directional estimate, and are
// always surfaced to the host as "approx" so they know to sanity-check it.
export const FUEL_PRICE_PER_LITRE = { Petrol: 105, Diesel: 93, CNG: 85 }; // CNG priced per kg, treated as a litre-equivalent unit here

// Fallback toll averages per km, by vehicle class - only used if the live
// OSM toll-booth lookup below fails (Overpass unreachable/timed out).
// Two-wheelers are exempt from toll on nearly all Indian highways, so
// bikes never carry a toll cost either way.
export const AVG_TOLL_PER_KM = { Bike: 0, Car: 2.5, Bus: 4, Mixed: 2.5, Train: 0, '': 2.5 };

// Approximate one-way charge per toll plaza, by vehicle class - used to
// price the ACTUAL toll booths found on the route via OpenStreetMap.
const TOLL_PLAZA_RATE = { Bike: 0, Car: 75, Bus: 150, Mixed: 75, Train: 0, '': 75 };

async function fetchWithTimeout(url, options, ms = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Returns { distanceKm, coords } where coords is the full [lon,lat] path,
// or null if any stop couldn't be geocoded or no route was found.
async function getRouteGeometry(placeNames) {
  const points = await Promise.all(placeNames.map(geocodePlace));
  if (points.some((p) => !p)) return null;
  if (points.length < 2) return null;

  const coordsStr = points.map((p) => `${p.lon},${p.lat}`).join(';');
  try {
    const res = await fetchWithTimeout(`${OSRM_URL}${coordsStr}?overview=full&geometries=geojson`, { headers: REQUEST_HEADERS });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.[0]) return null;
    return {
      distanceKm: data.routes[0].distance / 1000,
      coords: data.routes[0].geometry.coordinates, // [[lon, lat], ...]
    };
  } catch {
    return null;
  }
}

// Queries real toll-booth nodes (OpenStreetMap) within the route's bounding
// box, then keeps only the ones actually close to the path - a bbox alone
// can span other nearby roads. Returns null (not 0) on any failure, so the
// caller can tell "no tolls found" apart from "couldn't check."
async function countTollBoothsOnRoute(coords) {
  if (!coords?.length) return null;

  let south = 90, north = -90, west = 180, east = -180;
  for (const [lon, lat] of coords) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
  }
  const pad = 0.05; // ~5km buffer around the route's bounding box
  south -= pad;
  west -= pad;
  north += pad;
  east += pad;

  const query = `[out:json][timeout:20];node["barrier"="toll_booth"](${south},${west},${north},${east});out body;`;

  let data = null;
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...REQUEST_HEADERS },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) continue;
      data = await res.json();
      break;
    } catch {
      // try the next mirror
    }
  }
  if (!data) return null;

  try {
    const booths = data.elements || [];
    if (!booths.length) return 0;

    // OSM commonly tags one toll_booth node per carriageway/lane at the
    // same physical plaza (seen ~10-15m apart in practice) - merge nodes
    // within 300m of each other so one real plaza isn't counted twice.
    const plazas = [];
    for (const b of booths) {
      const merged = plazas.find((p) => haversineKm(p.lat, p.lon, b.lat, b.lon) <= 0.3);
      if (!merged) plazas.push({ lat: b.lat, lon: b.lon });
    }

    // Downsample a long route's polyline so checking distance-to-path
    // doesn't mean hundreds of haversine calls per plaza found.
    const step = Math.max(1, Math.floor(coords.length / 500));
    const sampled = coords.filter((_, i) => i % step === 0);

    let count = 0;
    for (const plaza of plazas) {
      const onRoute = sampled.some(([lon, lat]) => haversineKm(lat, lon, plaza.lat, plaza.lon) <= TOLL_PROXIMITY_KM);
      if (onRoute) count += 1;
    }
    return count;
  } catch {
    return null;
  }
}

// { origin, viaStops, destination, mileageKmpl, fuelType, vehicleType } ->
// cost estimate for the ROUND TRIP (there and back) - the realistic cost to
// the vehicle owner for a group trip that returns to where it started.
// Bikes are toll-exempt on nearly all Indian highways, so a Bike estimate
// is fuel-only. Every other vehicle type gets a toll estimate priced off
// real toll-booth locations on the route (OpenStreetMap/Overpass), falling
// back to a per-km approximation only if that lookup can't be reached.
// Returns null if any stop couldn't be geocoded or no route was found.
export async function estimateTripCost({ origin, viaStops = [], destination, mileageKmpl, fuelType, vehicleType = '' }) {
  const stops = [origin, ...viaStops.filter(Boolean), destination].filter(Boolean);
  if (stops.length < 2) return null;

  const route = await getRouteGeometry(stops);
  if (!route) return null;

  const oneWayKm = route.distanceKm;
  const roundTripKm = oneWayKm * 2;
  const pricePerLitre = FUEL_PRICE_PER_LITRE[fuelType] ?? FUEL_PRICE_PER_LITRE.Petrol;
  const litresNeeded = mileageKmpl > 0 ? roundTripKm / mileageKmpl : 0;
  const fuelCost = Math.round(litresNeeded * pricePerLitre);

  const tollExempt = vehicleType === 'Bike';
  const tollPerKm = AVG_TOLL_PER_KM[vehicleType] ?? AVG_TOLL_PER_KM[''];
  let tollCost = 0;
  let tollSource = 'exempt';
  let tollBoothCount;

  if (!tollExempt) {
    const boothCount = await countTollBoothsOnRoute(route.coords);
    if (boothCount != null) {
      const perPlaza = TOLL_PLAZA_RATE[vehicleType] ?? TOLL_PLAZA_RATE[''];
      tollCost = Math.round(boothCount * perPlaza * 2); // charged each way
      tollSource = 'osm';
      tollBoothCount = boothCount;
    } else {
      tollCost = Math.round(roundTripKm * tollPerKm);
      tollSource = 'approx';
    }
  }

  return {
    oneWayKm: Math.round(oneWayKm * 10) / 10,
    roundTripKm: Math.round(roundTripKm * 10) / 10,
    fuelCost,
    tollCost,
    totalCost: fuelCost + tollCost,
    assumptions: {
      fuelPricePerLitre: pricePerLitre,
      tollExempt,
      tollSource, // 'osm' (real toll booths found) | 'approx' (fallback) | 'exempt'
      tollBoothCount,
      avgTollPerKm: tollPerKm,
      roundTrip: true,
    },
  };
}

export default { estimateTripCost };
