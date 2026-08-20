import mongoose from 'mongoose';

const { Schema } = mongoose;

const groupTripInterestSchema = new Schema(
  {
    groupTrip: { type: Schema.Types.ObjectId, ref: 'GroupTrip', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  },
  { timestamps: true }
);

// A user can only show interest once per group trip.
groupTripInterestSchema.index({ groupTrip: 1, user: 1 }, { unique: true });

const GroupTripInterest = mongoose.model('GroupTripInterest', groupTripInterestSchema);
export default GroupTripInterest;
