import mongoose from 'mongoose';

const { Schema } = mongoose;

// One row per (user, photo) like - existence IS the like, no separate
// boolean. Toggled by creating/deleting this doc, see
// galleryController.toggleLike().
const photoLikeSchema = new Schema(
  {
    photo: { type: Schema.Types.ObjectId, ref: 'Gallery', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true }
);

photoLikeSchema.index({ photo: 1, user: 1 }, { unique: true });

const PhotoLike = mongoose.model('PhotoLike', photoLikeSchema);
export default PhotoLike;
