import mongoose from 'mongoose';

const { Schema } = mongoose;

const gallerySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    trip: { type: Schema.Types.ObjectId, ref: 'Trip' },
    photoUrl: { type: String, required: true },
    caption: { type: String, trim: true, maxlength: 300 },
    category: {
      type: String,
      enum: ['bike', 'car', 'mountain', 'beach', 'camp', 'group', 'other'],
      default: 'other',
      index: true,
    },
  },
  { timestamps: true }
);

const Gallery = mongoose.model('Gallery', gallerySchema);
export default Gallery;
