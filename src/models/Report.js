import mongoose from 'mongoose';

const { Schema } = mongoose;

// A member reporting another member's profile/behavior for admin review.
const reportSchema = new Schema(
  {
    reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reportedUser: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    status: { type: String, enum: ['open', 'resolved'], default: 'open', index: true },
  },
  { timestamps: true }
);

const Report = mongoose.model('Report', reportSchema);
export default Report;
