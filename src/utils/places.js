// City/place autocomplete + geocoding via OpenStreetMap's Nominatim search
// API - completely free, no API key or signup required. Restricted to India
// via `countrycodes=in`. Mirrors pexels.js's contract: never throws, returns
// a safe empty value on any upstream failure so a caller never has to
// special-case it.
//
// Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/)
// requires a descriptive User-Agent and caps free use at ~1 request/sec -
// fine here since the frontend already debounces keystrokes, and the trip
// cost estimator (utils/tripCost.js) only geocodes a handful of stops once
// per calculation, not per keystroke.
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const HEADERS = {
  'User-Agent': 'SastiTripsWale/1.0 (place autocomplete; contact: admin@sastitripwale.com)',
  'Accept-Language': 'en-IN',
};

function buildLabel(place) {
  const a = place.address || {};
  const locality = a.city || a.town || a.village || a.hamlet || a.city_district || a.county || a.state_district;
  const state = a.state;
  if (locality && state && locality !== state) return `${locality}, ${state}`;
  return locality || state || place.display_name;
}

async function rawSearch(query, limit) {
  const url =
    `${NOMINATIM_URL}?format=jsonv2&addressdetails=1&countrycodes=in&limit=${limit}` +
    `&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// Free, keyless India Post pincode lookup - used when the query looks like
// a PIN code instead of a place name. The API only resolves *exact* 6-digit
// codes (no partial/prefix search exists), so a partial code just yields no
// suggestions yet rather than an error - the frontend already shows a
// "type it manually" hint in that state.
const PINCODE_URL = 'https://api.postalpincode.in/pincode/';

async function searchByPincode(pincode) {
  if (!/^\d{6}$/.test(pincode)) return [];
  try {
    const res = await fetch(`${PINCODE_URL}${pincode}`);
    if (!res.ok) return [];
    const data = await res.json();
    const offices = data?.[0]?.Status === 'Success' ? data[0].PostOffice : null;
    if (!Array.isArray(offices)) return [];

    const seen = new Set();
    const results = [];
    for (const office of offices) {
      const label = [office.Name, office.District, office.State].filter(Boolean).join(', ');
      if (!label || seen.has(label)) continue;
      seen.add(label);
      results.push({ id: `${pincode}-${office.Name}`, label: `${label} – ${pincode}` });
      if (results.length >= 8) break;
    }
    return results;
  } catch {
    return [];
  }
}

export async function searchIndianPlaces(query) {
  const q = (query || '').trim();
  if (q.length < 2) return [];

  // Fully numeric input is treated as a PIN code search instead of a place
  // name - same input box, no separate field needed.
  if (/^\d+$/.test(q)) return searchByPincode(q);

  try {
    // Ask for more raw results than we'll show - settlement results get
    // filtered/deduped below, and without headroom a query that also
    // matches streets/shops/landmarks in a big city can crowd out smaller
    // towns and villages before filtering ever gets a chance to run.
    const data = await rawSearch(q, 20);

    // Keep settlements only (country/state/city/town/village/hamlet/...,
    // Nominatim's category: 'place' - called "category" in the jsonv2
    // format this uses, "class" only in the older v1 format) - drops
    // streets, shops, and other named landmarks that also match the text
    // search but aren't a "place" a trip starts/ends in. This is also what
    // makes villages/hamlets show up reliably instead of getting crowded
    // out by a big city's landmarks.
    const seen = new Set();
    const results = [];
    for (const place of data) {
      if (place.category !== 'place' && place.category !== 'boundary') continue;
      const label = buildLabel(place);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      results.push({ id: place.place_id, label });
      if (results.length >= 8) break;
    }
    return results;
  } catch {
    return [];
  }
}

// Resolves a free-text place name (as typed/picked in the autocomplete
// field) to its best-match coordinates, for the trip cost estimator's
// distance lookup. Returns null if it can't confidently resolve one.
export async function geocodePlace(query) {
  const q = (query || '').trim();
  if (!q) return null;
  try {
    const data = await rawSearch(q, 1);
    const place = data[0];
    if (!place) return null;
    return { lat: Number(place.lat), lon: Number(place.lon), label: buildLabel(place) };
  } catch {
    return null;
  }
}

export default { searchIndianPlaces, geocodePlace };
