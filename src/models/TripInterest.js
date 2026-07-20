import mongoose from 'mongoose';

const { Schema } = mongoose;

const tripInterestSchema = new Schema(
  {
    trip: { type: Schema.Types.ObjectId, ref: 'Trip', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    isCouple: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// A user can only show interest once per trip.
tripInterestSchema.index({ trip: 1, user: 1 }, { unique: true });

const TripInterest = mongoose.model('TripInterest', tripInterestSchema);
export default TripInterest;
