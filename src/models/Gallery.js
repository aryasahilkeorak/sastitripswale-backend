import mongoose from 'mongoose';

const { Schema } = mongoose;

const gallerySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    trip: { type: Schema.Types.ObjectId, ref: 'Trip' },
    photoUrl: { type: String, required: true },
    caption: { type: String, trim: true, maxlength: 300 },
    location: { type: String, trim: true, maxlength: 120, default: '' },
    category: {
      type: String,
      enum: ['bike', 'car', 'mountain', 'beach', 'camp', 'group', 'other'],
      default: 'other',
      index: true,
    },
    likesCount: { type: Number, default: 0, min: 0 },
    commentsCount: { type: Number, default: 0, min: 0 },
    repostsCount: { type: Number, default: 0, min: 0 },
    // Always the ROOT original photo, never a chain - set once at repost
    // creation time (see galleryController.repostPhoto) and never
    // re-derived afterwards.
    repostOf: { type: Schema.Types.ObjectId, ref: 'Gallery', index: true },
  },
  { timestamps: true }
);

// One repost per (user, root photo) - a second attempt hits this instead of
// silently duplicating the post.
gallerySchema.index(
  { user: 1, repostOf: 1 },
  { unique: true, partialFilterExpression: { repostOf: { $exists: true } } }
);

const Gallery = mongoose.model('Gallery', gallerySchema);
export default Gallery;
