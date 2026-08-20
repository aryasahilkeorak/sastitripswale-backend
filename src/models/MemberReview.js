import mongoose from 'mongoose';

const { Schema } = mongoose;

// A rating one trip member leaves for another co-traveler (not the trip
// itself - see Review.js for that) - "how was it traveling with this
// person". Powers the aggregate rating shown on a member's profile.
const memberReviewSchema = new Schema(
  {
    trip: { type: Schema.Types.ObjectId, ref: 'Trip', required: true, index: true },
    rater: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ratee: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    message: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

// One rating per (trip, rater, ratee) - re-submitting edits it.
memberReviewSchema.index({ trip: 1, rater: 1, ratee: 1 }, { unique: true });

const MemberReview = mongoose.model('MemberReview', memberReviewSchema);
export default MemberReview;
