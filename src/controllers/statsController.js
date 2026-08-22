// Public homepage stats - real aggregate counts from the database.
import asyncHandler from '../utils/asyncHandler.js';
import User from '../models/User.js';
import Trip from '../models/Trip.js';
import GroupTrip from '../models/GroupTrip.js';
import TripInterest from '../models/TripInterest.js';
import Connection from '../models/Connection.js';
import Gallery from '../models/Gallery.js';
import CityGeo from '../models/CityGeo.js';

export const getPublicStats = asyncHandler(async (req, res) => {
  const [members, trips, completedTrips, connections, travelers, photos, cities, states, pooledAgg] =
    await Promise.all([
      User.countDocuments({ role: 'member', isActive: true }),
      Trip.countDocuments({}),
      Trip.countDocuments({ status: 'completed' }),
      Connection.countDocuments({ status: 'accepted' }),
      TripInterest.countDocuments({}),
      Gallery.countDocuments({}),
      User.distinct('city', { city: { $nin: [null, ''] } }),
      User.distinct('state', { state: { $nin: [null, ''] } }),
      Trip.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: { $multiply: ['$budgetPerHead', '$filledSeats'] } } } },
      ]),
    ]);

  res.json({
    success: true,
    stats: {
      members,
      trips,
      completedTrips,
      connections,
      travelers, // total trip joins (interests)
      photos,
      cities: cities.length,
      states: states.length,
      pooledRupees: pooledAgg[0]?.total || 0,
    },
  });
});

// Cities covered, with member counts and cached lat/lng - powers the
// dots-on-a-map visual on the About page. Reads only from the CityGeo
// cache (never geocodes live), so this stays fast even with many members.
// Returns two layers: `cities` (where members live) and `tripDestinations`
// (places completed trips/group trips actually went to).
export const getCityStats = asyncHandler(async (req, res) => {
  const [memberCounts, tripCounts, groupTripCounts, geos] = await Promise.all([
    User.aggregate([
      { $match: { role: 'member', city: { $nin: [null, ''] } } },
      { $group: { _id: { $toLower: '$city' }, count: { $sum: 1 } } },
    ]),
    Trip.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: { $toLower: '$destination' }, count: { $sum: 1 } } },
    ]),
    GroupTrip.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: { $toLower: '$destination' }, count: { $sum: 1 } } },
    ]),
    CityGeo.find({}).select('city state lat lng'),
  ]);

  const countByCity = new Map(memberCounts.map((c) => [c._id, c.count]));
  const tripCountByPlace = new Map();
  for (const c of [...tripCounts, ...groupTripCounts]) {
    tripCountByPlace.set(c._id, (tripCountByPlace.get(c._id) || 0) + c.count);
  }

  const cities = geos
    .map((g) => ({ city: g.city, state: g.state, lat: g.lat, lng: g.lng, count: countByCity.get(g.city) || 0 }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);

  const tripDestinations = geos
    .map((g) => ({ city: g.city, state: g.state, lat: g.lat, lng: g.lng, count: tripCountByPlace.get(g.city) || 0 }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);

  res.json({ success: true, cities, tripDestinations });
});
