// Public homepage stats — real aggregate counts from the database.
import asyncHandler from '../utils/asyncHandler.js';
import User from '../models/User.js';
import Trip from '../models/Trip.js';
import TripInterest from '../models/TripInterest.js';
import Connection from '../models/Connection.js';
import Gallery from '../models/Gallery.js';

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
