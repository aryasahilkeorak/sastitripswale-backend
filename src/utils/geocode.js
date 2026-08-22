// Free geocoding via OpenStreetMap Nominatim, cached in CityGeo so we only
// ever hit the API once per distinct city name across the whole app.
import CityGeo from '../models/CityGeo.js';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'SastiTripWale/1.0 (contact: skashyap@appinfoinc.com)';

export async function geocodeCity(city, state = '') {
  const q = [city, state, 'India'].filter(Boolean).join(', ');
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=in`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Nominatim request failed: ${res.status}`);
  const results = await res.json();
  if (!results?.length) return null;
  return { lat: Number(results[0].lat), lng: Number(results[0].lon) };
}

// Fire-and-forget: looks up the CityGeo cache first, and only calls the
// geocoding API + saves a new entry if this exact city hasn't been resolved
// before. Never throws - callers should not await this on the request path.
export async function ensureCityGeocoded(city, state = '') {
  const cityN = String(city || '').trim();
  if (!cityN) return;
  try {
    const cityKey = cityN.toLowerCase();
    const existing = await CityGeo.findOne({ city: cityKey });
    if (existing) return;
    const coords = await geocodeCity(cityN, state);
    if (!coords) return;
    await CityGeo.findOneAndUpdate(
      { city: cityKey },
      { city: cityKey, state: state || '', lat: coords.lat, lng: coords.lng, resolvedAt: new Date() },
      { upsert: true }
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`ensureCityGeocoded('${city}') failed:`, err.message);
  }
}
