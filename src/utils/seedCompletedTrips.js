// ============================================================
//  Additive script - adds 5 already-completed trips from last
//  weekend, using existing real users as organizers/members.
//  Safe to re-run: skips any trip that already exists for the
//  same organizer + destination + startDate.
//  Usage: npm run seed:completed
// ============================================================
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import User from '../models/User.js';
import Trip from '../models/Trip.js';
import TripInterest from '../models/TripInterest.js';
import Group from '../models/Group.js';
import { fetchDestinationPhoto } from './pexels.js';

// Real user _ids currently in the database (see prior investigation).
const USER_IDS = {
  sahil: '6a490d1f66e21e419ae66dd5', // Sahil Kashyap - Car, Mohali
  shyam: '6a4b9297556509a55b7b48fd', // shyambiharijha17
  anjali: '6a673db9f3064d36a3fdd849', // anjalirajput01a
  piyush: '6a756be370bd88efb247e1bb', // piyushpanwar919333 - Bike, Chandigarh
  sankit: '6a756ca770bd88efb247e23a', // sankitpanwar12
  manan: '6a756ce170bd88efb247e27e', // mananpandit5
  vansh: '6a756d8a70bd88efb247e3b2', // vansh gujjar - Saharanpur
  mahi: '6a756f2770bd88efb247e538', // mahisingh708267
  panwarsahil: '6a75ba5b06d9732244b3dfb9', // panwarsahil08
  tamanna: '6a75de6cc1abbcaefe16d4f0', // tamannasharma2442
};

const TRIPS = [
  {
    organizer: USER_IDS.sahil,
    members: [USER_IDS.shyam, USER_IDS.anjali],
    origin: 'Mohali',
    destination: 'Solan',
    description: 'Weekend car trip to Solan - great roads, chill stay.',
    startDate: '2026-08-15',
    endDate: '2026-08-16',
    budgetPerHead: 1200,
    totalSeats: 4,
    vehicleType: 'Car',
    tripType: 'car',
    budgetIncludes: 'fuel_toll_stay',
    pickupLocation: 'Mohali',
  },
  {
    organizer: USER_IDS.piyush,
    members: [USER_IDS.sankit, USER_IDS.manan],
    origin: 'Chandigarh',
    destination: 'Kasauli',
    description: 'Weekend bike ride to Kasauli - misty roads and pine forests.',
    startDate: '2026-08-15',
    endDate: '2026-08-16',
    budgetPerHead: 800,
    totalSeats: 4,
    vehicleType: 'Bike',
    tripType: 'bike',
    budgetIncludes: 'fuel_toll',
    pickupLocation: 'Chandigarh',
  },
  {
    organizer: USER_IDS.vansh,
    members: [USER_IDS.mahi, USER_IDS.panwarsahil],
    origin: 'Panchkula',
    destination: 'Shimla',
    description: 'Long weekend car trip to Shimla - Mall Road and Ridge walks.',
    startDate: '2026-08-14',
    endDate: '2026-08-16',
    budgetPerHead: 1500,
    totalSeats: 5,
    vehicleType: 'Car',
    tripType: 'car',
    budgetIncludes: 'fuel_toll_stay_food',
    pickupLocation: 'Panchkula',
  },
  {
    organizer: USER_IDS.tamanna,
    members: [USER_IDS.sahil, USER_IDS.piyush],
    origin: 'Chandigarh',
    destination: 'Morni Hills',
    description: 'Day-trip bike ride to Morni Hills - lake view and short trek.',
    startDate: '2026-08-16',
    endDate: '2026-08-16',
    budgetPerHead: 500,
    totalSeats: 4,
    vehicleType: 'Bike',
    tripType: 'bike',
    budgetIncludes: 'fuel_toll',
    pickupLocation: 'Chandigarh',
  },
  {
    organizer: USER_IDS.sankit,
    members: [USER_IDS.vansh, USER_IDS.mahi],
    origin: 'Mohali',
    destination: 'Kasauli',
    description: 'Weekend car trip to Kasauli - Gilbert Trail and sunset point.',
    startDate: '2026-08-15',
    endDate: '2026-08-16',
    budgetPerHead: 900,
    totalSeats: 4,
    vehicleType: 'Car',
    tripType: 'car',
    budgetIncludes: 'fuel_toll_stay',
    pickupLocation: 'Mohali',
  },
];

async function findOrCreateCompletedTrip(spec) {
  const startDate = new Date(spec.startDate);
  const endDate = new Date(spec.endDate);

  const existing = await Trip.findOne({
    organizer: spec.organizer,
    destination: spec.destination,
    startDate,
  });
  if (existing) {
    console.log(`↩️  Trip already exists, skipping: ${spec.origin} → ${spec.destination}`);
    return existing;
  }

  // Leave coverImageUrl empty if Pexels has nothing (e.g. no API key
  // configured) - DestinationImage resolves a real Wikipedia photo of the
  // place client-side, or falls back to a neutral placeholder. Never use a
  // random stock photo here; it reads as wrong for the actual destination.
  const coverImageUrl = (await fetchDestinationPhoto(spec.destination)) || '';

  const trip = await Trip.create({
    organizer: spec.organizer,
    origin: spec.origin,
    destination: spec.destination,
    description: spec.description,
    startDate,
    endDate,
    budgetPerHead: spec.budgetPerHead,
    totalSeats: spec.totalSeats,
    filledSeats: spec.members.length,
    vehicleType: spec.vehicleType,
    tripType: spec.tripType,
    budgetIncludes: spec.budgetIncludes,
    pickupLocation: spec.pickupLocation,
    coverImageUrl,
    status: 'completed',
  });

  await Group.create({
    name: trip.routeLabel,
    type: 'trip',
    trip: trip._id,
    owner: spec.organizer,
    members: [spec.organizer, ...spec.members],
  });

  for (const memberId of spec.members) {
    const existingInterest = await TripInterest.findOne({ trip: trip._id, user: memberId });
    if (existingInterest) continue;
    await TripInterest.create({ trip: trip._id, user: memberId, status: 'accepted', isCouple: false });
  }

  console.log(`✅ Created completed trip: ${spec.origin} → ${spec.destination} (${spec.vehicleType})`);
  return trip;
}

async function run() {
  await connectDB();

  const ids = Object.values(USER_IDS);
  const found = await User.find({ _id: { $in: ids } }).select('_id');
  if (found.length !== ids.length) {
    const foundSet = new Set(found.map((u) => String(u._id)));
    const missing = ids.filter((id) => !foundSet.has(id));
    throw new Error(`Missing expected user ids: ${missing.join(', ')}`);
  }

  for (const spec of TRIPS) {
    await findOrCreateCompletedTrip(spec);
  }

  console.log('\n✅ Completed-trip seed finished.');
  await disconnectDB();
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('Completed-trip seed failed:', err);
  process.exit(1);
});
