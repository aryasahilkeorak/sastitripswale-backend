// One-off: geocodes every distinct member city AND every distinct completed
// trip/group-trip destination that isn't already cached in CityGeo, so the
// About-page map isn't empty at launch. Safe to re-run any time - already
// cached places are skipped instantly.
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import User from '../models/User.js';
import Trip from '../models/Trip.js';
import GroupTrip from '../models/GroupTrip.js';
import CityGeo from '../models/CityGeo.js';
import { geocodeCity } from './geocode.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await mongoose.connect(env.mongoUri);

const memberCities = await User.distinct('city', { role: 'member', city: { $nin: [null, ''] } });
const tripDestinations = await Trip.distinct('destination', { status: 'completed', destination: { $nin: [null, ''] } });
const groupTripDestinations = await GroupTrip.distinct('destination', { status: 'completed', destination: { $nin: [null, ''] } });

const places = [...new Set([...memberCities, ...tripDestinations, ...groupTripDestinations])];
console.log(`Distinct places to check: ${places.length}`);

let resolved = 0;
let skipped = 0;
let failed = 0;

for (const place of places) {
  const key = place.trim().toLowerCase();
  if (!key) continue;
  const existing = await CityGeo.findOne({ city: key });
  if (existing) {
    skipped++;
    continue;
  }
  try {
    const coords = await geocodeCity(place);
    if (!coords) {
      console.log(`No result for "${place}"`);
      failed++;
      continue;
    }
    await CityGeo.findOneAndUpdate(
      { city: key },
      { city: key, lat: coords.lat, lng: coords.lng, resolvedAt: new Date() },
      { upsert: true }
    );
    resolved++;
    console.log(`${place} -> ${coords.lat}, ${coords.lng}`);
  } catch (err) {
    console.log(`Failed "${place}": ${err.message}`);
    failed++;
  }
  // Nominatim's usage policy caps free requests at ~1/sec.
  await sleep(1100);
}

console.log(`\nResolved ${resolved}, skipped ${skipped} (already cached), failed ${failed}.`);
await mongoose.disconnect();
