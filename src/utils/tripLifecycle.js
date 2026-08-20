// ============================================================
//  Trip lifecycle sweep - runs a trip's end date past "now" into either
//  'completed' (someone actually joined) or full removal (nobody did).
// ============================================================
import Trip from '../models/Trip.js';
import TripInterest from '../models/TripInterest.js';
import Gallery from '../models/Gallery.js';
import Group from '../models/Group.js';
import Message from '../models/Message.js';

export async function deleteTripCascade(trip) {
  const grp = await Group.findOne({ trip: trip._id });
  await Promise.all([
    TripInterest.deleteMany({ trip: trip._id }),
    Gallery.deleteMany({ trip: trip._id }),
    grp ? Message.deleteMany({ group: grp._id }) : Promise.resolve(),
  ]);
  if (grp) await grp.deleteOne();
  await trip.deleteOne();
}

// A trip whose endDate has passed is either wrapped up (marked 'completed',
// if at least one accepted member actually rode along) or was never used
// (nobody accepted) and gets pruned entirely, cascading the same way a
// manual delete does, so it stops showing up in listings or the database.
export async function sweepExpiredTrips(now = new Date()) {
  const due = await Trip.find({ endDate: { $lt: now }, status: { $in: ['upcoming', 'ongoing'] } });

  let completed = 0;
  let removed = 0;
  for (const trip of due) {
    if (trip.filledSeats > 0) {
      trip.status = 'completed';
      await trip.save();
      completed += 1;
    } else {
      await deleteTripCascade(trip);
      removed += 1;
    }
  }
  return { completed, removed };
}
