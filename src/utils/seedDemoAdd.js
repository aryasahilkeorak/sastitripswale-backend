// ============================================================
//  Additive demo-data script — adds 5 demo members + 5 demo trips
//  WITHOUT touching any existing data (no wipe). Safe to re-run;
//  skips any user/trip that already exists.
//  Usage: npm run seed:demo
// ============================================================
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import User from '../models/User.js';
import Trip from '../models/Trip.js';
import Upload from '../models/Upload.js';

const avatar = (n) => `https://i.pravatar.cc/400?img=${n}`;
const cover = (seed) => `https://picsum.photos/seed/${seed}/900/560`;
const day = 24 * 60 * 60 * 1000;
const soon = (d) => new Date(Date.now() + d * day);

// 1x1 transparent PNG — stand-in "ID document" so the couples-mode demo
// account has a real partnerDocUrl to show off the feature end to end.
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

async function makePartnerDoc(ownerId) {
  const doc = await Upload.create({
    data: PLACEHOLDER_PNG,
    contentType: 'image/png',
    filename: 'demo-partner-id.png',
    size: PLACEHOLDER_PNG.length,
    owner: ownerId,
    kind: 'document',
  });
  return `/api/files/${doc._id}`;
}

async function findOrCreateUser(data, password) {
  const existing = await User.findOne({ $or: [{ email: data.email }, { mobile: data.mobile }] });
  if (existing) {
    console.log(`↩️  User already exists, skipping: ${data.email}`);
    return existing;
  }
  const user = new User({
    profileComplete: true,
    isVerified: true,
    coTravelerPreference: 'both',
    membershipPaid: true,
    membershipPaidAt: new Date(),
    membershipDuration: '1y',
    membershipExpiresAt: new Date(Date.now() + 365 * day),
    ...data,
  });
  await user.setPassword(password);
  await user.save();
  console.log(`✅ Created demo user: ${data.email}`);
  return user;
}

async function findOrCreateTrip(data) {
  const existing = await Trip.findOne({ organizer: data.organizer, destination: data.destination });
  if (existing) {
    console.log(`↩️  Trip already exists, skipping: ${data.origin} → ${data.destination}`);
    return existing;
  }
  const trip = await Trip.create(data);
  console.log(`✅ Created demo trip: ${data.origin} → ${data.destination}`);
  return trip;
}

async function run() {
  await connectDB();

  const rider = await findOrCreateUser(
    {
      fullName: 'Demo Rider',
      email: 'demo.rider@example.com',
      mobile: '9800000001',
      gender: 'Male',
      age: 27,
      city: 'Delhi',
      state: 'Delhi',
      profession: 'Photographer',
      bio: 'Demo account for testing — bike trips and mountain passes.',
      hasVehicle: true,
      vehicleType: 'Bike',
      vehicleModel: 'KTM Duke 390',
      travelInterests: ['Mountains', 'Road Trips', 'Photography'],
      relationshipStatus: 'single',
      avatarUrl: avatar(51),
    },
    'Demo@123'
  );

  const explorer = await findOrCreateUser(
    {
      fullName: 'Demo Explorer',
      email: 'demo.explorer@example.com',
      mobile: '9800000002',
      gender: 'Female',
      age: 25,
      city: 'Mumbai',
      state: 'Maharashtra',
      profession: 'Marketing Manager',
      bio: 'Demo account for testing — beach hopping and food trails.',
      hasVehicle: true,
      vehicleType: 'Car',
      vehicleModel: 'Maruti Swift',
      travelInterests: ['Beaches', 'Food Travel'],
      relationshipStatus: 'single',
      username: 'demo_explorer',
      avatarUrl: avatar(52),
    },
    'Demo@123'
  );

  const camper = await findOrCreateUser(
    {
      fullName: 'Demo Camper',
      email: 'demo.camper@example.com',
      mobile: '9800000003',
      gender: 'Male',
      age: 30,
      city: 'Bangalore',
      state: 'Karnataka',
      profession: 'Consultant',
      bio: 'Demo account for testing — camping and treks.',
      hasVehicle: true,
      vehicleType: 'Car',
      vehicleModel: 'Mahindra Scorpio',
      travelInterests: ['Camping', 'Trekking'],
      relationshipStatus: 'prefer_not_to_say',
      avatarUrl: avatar(53),
    },
    'Demo@123'
  );

  const coupleHost = await findOrCreateUser(
    {
      fullName: 'Demo Couple Host',
      email: 'demo.couplehost@example.com',
      mobile: '9800000004',
      gender: 'Male',
      age: 31,
      city: 'Chandigarh',
      state: 'Punjab',
      profession: 'Architect',
      bio: 'Demo account for testing — married, hosts Couples Mode trips.',
      hasVehicle: true,
      vehicleType: 'Car',
      vehicleModel: 'Hyundai Creta',
      travelInterests: ['Mountains', 'Road Trips'],
      relationshipStatus: 'married',
      partnerMobile: '9800000104',
      username: 'couplehost',
      avatarUrl: avatar(54),
    },
    'Demo@123'
  );
  if (!coupleHost.partnerDocUrl) {
    coupleHost.partnerDocUrl = await makePartnerDoc(coupleHost._id);
    await coupleHost.save();
  }

  const backpacker = await findOrCreateUser(
    {
      fullName: 'Demo Backpacker',
      email: 'demo.backpacker@example.com',
      mobile: '9800000005',
      gender: 'Female',
      age: 23,
      city: 'Pune',
      state: 'Maharashtra',
      profession: 'Student',
      bio: 'Demo account for testing — solo backpacking on a budget.',
      hasVehicle: false,
      travelInterests: ['Backpacking', 'Trekking'],
      relationshipStatus: 'in_a_relationship',
      username: 'demo_backpacker',
      avatarUrl: avatar(55),
    },
    'Demo@123'
  );

  await findOrCreateTrip({
    organizer: rider._id,
    origin: 'Delhi',
    viaStops: ['Manali'],
    destination: 'Kasol, HP',
    description: 'Demo trip — riverside camps and Parvati valley.',
    startDate: soon(14),
    endDate: soon(18),
    budgetPerHead: 7000,
    totalSeats: 6,
    filledSeats: 1,
    vehicleType: 'Bike',
    tripType: 'mountain',
    pickupLocation: 'Delhi',
    coverImageUrl: cover('demo-kasol'),
    status: 'upcoming',
  });

  await findOrCreateTrip({
    organizer: explorer._id,
    origin: 'Mumbai',
    viaStops: [],
    destination: 'Alibaug, Maharashtra',
    description: 'Demo trip — weekend beach getaway.',
    startDate: soon(9),
    endDate: soon(11),
    budgetPerHead: 3500,
    totalSeats: 5,
    filledSeats: 2,
    vehicleType: 'Car',
    tripType: 'beach',
    pickupLocation: 'Mumbai',
    coverImageUrl: cover('demo-alibaug'),
    status: 'upcoming',
  });

  await findOrCreateTrip({
    organizer: camper._id,
    origin: 'Bangalore',
    viaStops: ['Sakleshpur'],
    destination: 'Kudremukh, Karnataka',
    description: 'Demo trip — trek and camping under the stars.',
    startDate: soon(21),
    endDate: soon(23),
    budgetPerHead: 4200,
    totalSeats: 8,
    filledSeats: 3,
    vehicleType: 'Car',
    tripType: 'trek',
    pickupLocation: 'Bangalore',
    coverImageUrl: cover('demo-kudremukh'),
    status: 'upcoming',
  });

  await findOrCreateTrip({
    organizer: coupleHost._id,
    origin: 'Chandigarh',
    viaStops: [],
    destination: 'Shimla, HP',
    description: 'Demo trip — Couples Mode. Fuel & toll split with the host couple.',
    startDate: soon(16),
    endDate: soon(19),
    budgetPerHead: 2000,
    totalSeats: 4,
    filledSeats: 0,
    vehicleType: 'Car',
    tripType: 'mountain',
    pickupLocation: 'Chandigarh',
    coverImageUrl: cover('demo-shimla'),
    status: 'upcoming',
    isCouplesMode: true,
  });

  await findOrCreateTrip({
    organizer: backpacker._id,
    origin: 'Pune',
    viaStops: [],
    destination: 'Gokarna, Karnataka',
    description: 'Demo trip — budget backpacking, beach hopping.',
    startDate: soon(25),
    endDate: soon(29),
    budgetPerHead: 4800,
    totalSeats: 6,
    filledSeats: 1,
    vehicleType: 'Bus',
    tripType: 'beach',
    pickupLocation: 'Pune',
    coverImageUrl: cover('demo-gokarna'),
    status: 'upcoming',
  });

  console.log('\n✅ Demo data ready (existing data untouched).');
  console.log('   Password for all demo accounts: Demo@123');
  console.log('   demo.rider@example.com       — bike trips, single');
  console.log('   demo.explorer@example.com    — car/beach trips, username: demo_explorer');
  console.log('   demo.camper@example.com      — camping/treks');
  console.log('   demo.couplehost@example.com  — married, Couples Mode host, username: couplehost');
  console.log('   demo.backpacker@example.com  — backpacking, username: demo_backpacker\n');

  await disconnectDB();
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('Demo seed failed:', err);
  process.exit(1);
});
