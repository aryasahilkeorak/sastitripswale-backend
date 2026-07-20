// ============================================================
//  Seed script — demo data.
//  Usage:
//    npm run seed            (wipes + reseeds core collections)
//    npm run seed:destroy    (only wipes)
// ============================================================
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import { env } from '../config/env.js';
import User from '../models/User.js';
import Trip from '../models/Trip.js';
import TripInterest from '../models/TripInterest.js';
import Payment from '../models/Payment.js';
import Review from '../models/Review.js';
import Gallery from '../models/Gallery.js';
import Coupon from '../models/Coupon.js';
import Connection from '../models/Connection.js';
import Notification from '../models/Notification.js';
import Document from '../models/Document.js';
import ContactMessage from '../models/ContactMessage.js';
import Group from '../models/Group.js';
import Message from '../models/Message.js';
import Upload from '../models/Upload.js';

const avatar = (n) => `https://i.pravatar.cc/400?img=${n}`;
const cover = (seed) => `https://picsum.photos/seed/${seed}/900/560`;

async function makeUser(data, password) {
  // Seeded members are fully onboarded so demo logins can plan/join trips.
  const u = new User({
    profileComplete: true,
    coTravelerPreference: 'both',
    membershipDuration: '1y',
    membershipExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    ...data,
  });
  await u.setPassword(password);
  await u.save();
  return u;
}

async function wipe() {
  await Promise.all([
    User.deleteMany({}),
    Trip.deleteMany({}),
    TripInterest.deleteMany({}),
    Payment.deleteMany({}),
    Review.deleteMany({}),
    Gallery.deleteMany({}),
    Coupon.deleteMany({}),
    Connection.deleteMany({}),
    Notification.deleteMany({}),
    Document.deleteMany({}),
    ContactMessage.deleteMany({}),
    Group.deleteMany({}),
    Message.deleteMany({}),
    Upload.deleteMany({}),
  ]);
  console.log('🧹 Collections cleared');
}

async function seed() {
  await wipe();

  // --- Super Admin ---
  const admin = await makeUser(
    {
      fullName: 'STW Super Admin',
      email: env.seed.adminEmail,
      mobile: '9000000001',
      role: 'superadmin',
      city: 'Delhi',
      state: 'Delhi',
      isVerified: true,
      membershipPaid: true,
      membershipPaidAt: new Date(),
      avatarUrl: avatar(12),
    },
    env.seed.adminPassword
  );

  // --- Demo staff admin (non-super) ---
  await makeUser(
    {
      fullName: 'STW Staff Admin',
      email: 'staff@sastitripwale.com',
      mobile: '9000000005',
      role: 'admin',
      city: 'Mumbai',
      state: 'Maharashtra',
      isVerified: true,
      membershipPaid: true,
      membershipPaidAt: new Date(),
      avatarUrl: avatar(20),
    },
    'Admin@123'
  );

  // --- Members ---
  const members = await Promise.all([
    makeUser(
      {
        fullName: 'Rahul Sharma',
        email: 'rahul@example.com',
        mobile: '9000000002',
        gender: 'Male',
        age: 26,
        city: 'Delhi',
        state: 'Delhi',
        profession: 'Software Engineer',
        bio: 'Weekend rider. Royal Enfield. Mountains > everything.',
        hasVehicle: true,
        vehicleType: 'Bike',
        vehicleModel: 'RE Himalayan 411',
        travelInterests: ['Mountains', 'Road Trips', 'Photography'],
        isVerified: true,
        membershipPaid: true,
        membershipPaidAt: new Date(),
        avatarUrl: avatar(15),
      },
      'Travel@123'
    ),
    makeUser(
      {
        fullName: 'Priya Mehta',
        email: 'priya@example.com',
        mobile: '9000000003',
        gender: 'Female',
        age: 24,
        city: 'Mumbai',
        state: 'Maharashtra',
        profession: 'Designer',
        bio: 'Solo female traveler. Loves beaches and budget backpacking.',
        hasVehicle: true,
        vehicleType: 'Car',
        vehicleModel: 'Hyundai i20',
        travelInterests: ['Beaches', 'Backpacking', 'Food Travel'],
        isVerified: true,
        membershipPaid: true,
        membershipPaidAt: new Date(),
        avatarUrl: avatar(45),
      },
      'Travel@123'
    ),
    makeUser(
      {
        fullName: 'Arjun Nair',
        email: 'arjun@example.com',
        mobile: '9000000004',
        gender: 'Male',
        age: 29,
        city: 'Bangalore',
        state: 'Karnataka',
        profession: 'Entrepreneur',
        bio: 'SUV road trips and camping under the stars.',
        hasVehicle: true,
        vehicleType: 'Car',
        vehicleModel: 'Mahindra Thar',
        travelInterests: ['Camping', 'Trekking', 'Night Rides'],
        isVerified: true,
        membershipPaid: true,
        membershipPaidAt: new Date(),
        avatarUrl: avatar(33),
      },
      'Travel@123'
    ),
  ]);

  const [rahul, priya, arjun] = members;

  // --- Trips (upcoming) ---
  const day = 24 * 60 * 60 * 1000;
  const soon = (d) => new Date(Date.now() + d * day);

  const upcoming = [
    {
      organizer: rahul._id,
      origin: 'Delhi',
      viaStops: ['Shimla', 'Kaza'],
      destination: 'Spiti Valley, HP',
      description: 'High-altitude cold desert loop. Kaza, Key Monastery, Chandratal.',
      startDate: soon(20),
      endDate: soon(28),
      budgetPerHead: 14500,
      totalSeats: 8,
      filledSeats: 3,
      vehicleType: 'Bike',
      tripType: 'mountain',
      pickupLocation: 'Delhi',
      coverImageUrl: cover('spiti'),
      status: 'upcoming',
    },
    {
      organizer: priya._id,
      origin: 'Mumbai',
      viaStops: [],
      destination: 'Goa',
      description: 'North + South Goa. Beaches, cafes, sunsets, and shacks.',
      startDate: soon(12),
      endDate: soon(16),
      budgetPerHead: 6500,
      totalSeats: 6,
      filledSeats: 2,
      vehicleType: 'Car',
      tripType: 'beach',
      pickupLocation: 'Mumbai',
      coverImageUrl: cover('goa'),
      status: 'upcoming',
    },
    {
      organizer: arjun._id,
      origin: 'Manali',
      viaStops: ['Jispa', 'Sarchu'],
      destination: 'Leh, Ladakh',
      description: 'Khardung La, Pangong Tso, Nubra Valley. The ultimate ride.',
      startDate: soon(30),
      endDate: soon(40),
      budgetPerHead: 22000,
      totalSeats: 10,
      filledSeats: 5,
      vehicleType: 'Mixed',
      tripType: 'mountain',
      pickupLocation: 'Manali',
      coverImageUrl: cover('leh'),
      status: 'upcoming',
    },
    {
      organizer: rahul._id,
      origin: 'Jaipur',
      viaStops: [],
      destination: 'Jaisalmer, Rajasthan',
      description: 'Golden fort, Sam dunes, desert camping and folk music.',
      startDate: soon(18),
      endDate: soon(22),
      budgetPerHead: 8000,
      totalSeats: 6,
      filledSeats: 1,
      vehicleType: 'Car',
      tripType: 'car',
      pickupLocation: 'Jaipur',
      coverImageUrl: cover('jaisalmer'),
      status: 'upcoming',
    },
    {
      organizer: priya._id,
      origin: 'Bangalore',
      viaStops: [],
      destination: 'Gokarna, Karnataka',
      description: 'Beach hopping trek: Om, Kudle, Half-moon, Paradise.',
      startDate: soon(9),
      endDate: soon(13),
      budgetPerHead: 4500,
      totalSeats: 8,
      filledSeats: 4,
      vehicleType: 'Train',
      tripType: 'beach',
      pickupLocation: 'Bangalore',
      coverImageUrl: cover('gokarna'),
      status: 'upcoming',
    },
    {
      organizer: arjun._id,
      origin: 'Bangalore',
      viaStops: ['Mysore'],
      destination: 'Coorg, Karnataka',
      description: 'Misty hills, coffee estates, waterfalls and homestays.',
      startDate: soon(15),
      endDate: soon(18),
      budgetPerHead: 5500,
      totalSeats: 6,
      filledSeats: 2,
      vehicleType: 'Car',
      tripType: 'trek',
      pickupLocation: 'Bangalore',
      coverImageUrl: cover('coorg'),
      status: 'upcoming',
    },
  ];

  // --- Completed trips with expense breakdowns ---
  const completed = [
    {
      organizer: arjun._id,
      origin: 'Guwahati',
      viaStops: ['Shillong'],
      destination: 'Meghalaya',
      description: 'Living root bridges, Dawki river, Cherrapunji.',
      startDate: soon(-40),
      endDate: soon(-33),
      budgetPerHead: 16000,
      totalSeats: 8,
      filledSeats: 8,
      vehicleType: 'Car',
      tripType: 'mountain',
      coverImageUrl: cover('meghalaya'),
      status: 'completed',
      expenses: [
        { category: 'fuel', description: 'Diesel', amount: 3200 },
        { category: 'stay', description: 'Homestays x6', amount: 6500 },
        { category: 'food', description: 'Meals', amount: 3800 },
        { category: 'permits', description: 'Entry + boat', amount: 2500 },
      ],
    },
  ];

  const createdTrips = await Trip.insertMany([...upcoming, ...completed]);

  // A couple of accepted interests so seats + notifications look alive.
  await TripInterest.create({ trip: createdTrips[0]._id, user: priya._id, status: 'accepted' });
  await TripInterest.create({ trip: createdTrips[1]._id, user: rahul._id, status: 'accepted' });

  // --- Membership payments (for history realism) ---
  await Payment.insertMany(
    members.map((m) => ({
      user: m._id,
      amount: env.membershipFee * 100,
      status: 'success',
      purpose: 'membership',
      razorpayPaymentId: `seed_${m._id}`,
    }))
  );

  // --- Reviews ---
  await Review.insertMany([
    {
      user: rahul._id,
      rating: 5,
      message: 'Found an amazing group for Spiti. Split costs, made friends for life!',
      tripDestination: 'Spiti Valley',
      isFeatured: true,
    },
    {
      user: priya._id,
      rating: 5,
      message: 'As a solo female traveler, the women-safe verified groups gave me confidence.',
      tripDestination: 'Goa',
      isFeatured: true,
    },
    {
      user: arjun._id,
      rating: 5,
      message: 'Leh-Ladakh with 10 people cost me a third of what it would solo. Insane value.',
      tripDestination: 'Leh, Ladakh',
      isFeatured: true,
    },
  ]);

  // --- Gallery ---
  await Gallery.insertMany([
    { user: rahul._id, photoUrl: cover('g1'), caption: 'Spiti mornings', category: 'mountain' },
    { user: priya._id, photoUrl: cover('g2'), caption: 'Goa sunset', category: 'beach' },
    { user: arjun._id, photoUrl: cover('g3'), caption: 'Thar in the dunes', category: 'car' },
    { user: rahul._id, photoUrl: cover('g4'), caption: 'The tribe', category: 'group' },
    { user: arjun._id, photoUrl: cover('g5'), caption: 'Camp under stars', category: 'camp' },
    { user: rahul._id, photoUrl: cover('g6'), caption: 'Himalayan on the pass', category: 'bike' },
  ]);

  // --- Coupons ---
  await Coupon.insertMany([
    { code: 'FREEJOIN', discountPct: 100, maxUses: 100000 },
    { code: 'SAVE50', discountPct: 50, maxUses: 1000 },
    { code: 'FLAT30', discountAmt: 30, maxUses: 1000 },
    { code: 'WELCOME20', discountPct: 20, maxUses: 1000 },
  ]);

  console.log('\n✅ Seed complete');
  console.log('   Super Admin:', env.seed.adminEmail, '/', env.seed.adminPassword);
  console.log('   Staff Admin: staff@sastitripwale.com / Admin@123');
  console.log('   Member: rahul@example.com / Travel@123');
  console.log('   Member: priya@example.com / Travel@123');
  console.log('   Member: arjun@example.com / Travel@123');
  console.log('   Coupons: FREEJOIN (100%), SAVE50 (50%), FLAT30 (₹30), WELCOME20 (20%)\n');
}

async function main() {
  await connectDB();
  const destroyOnly = process.argv.includes('--destroy');
  if (destroyOnly) {
    await wipe();
    console.log('✅ Database wiped');
  } else {
    await seed();
  }
  await disconnectDB();
  await mongoose.connection.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
