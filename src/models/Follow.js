import mongoose from 'mongoose';

const { Schema } = mongoose;

// One-directional, no-approval-needed relationship (Instagram-style) -
// deliberately separate from the mutual accept/reject Connection model,
// which keeps working exactly as it does today.
const followSchema = new Schema(
  {
    follower: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    following: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true }
);

followSchema.index({ follower: 1, following: 1 }, { unique: true });

const Follow = mongoose.model('Follow', followSchema);
export default Follow;
