import mongoose from 'mongoose';

const { Schema } = mongoose;

// A flat comment on a Gallery photo - no replies/threading, no editing
// (delete-and-repost is the only "correction" path, same as most of this
// app's other short-message models e.g. MemberReview/Review).
const photoCommentSchema = new Schema(
  {
    photo: { type: Schema.Types.ObjectId, ref: 'Gallery', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

photoCommentSchema.index({ photo: 1, createdAt: 1 });

const PhotoComment = mongoose.model('PhotoComment', photoCommentSchema);
export default PhotoComment;
