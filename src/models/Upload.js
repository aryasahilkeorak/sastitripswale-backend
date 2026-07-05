import mongoose from 'mongoose';

const { Schema } = mongoose;

// Stores the actual file bytes in MongoDB (survives Render redeploys, unlike
// disk storage). Files are capped at ~5MB by the upload middleware, well under
// MongoDB's 16MB document limit.
const uploadSchema = new Schema(
  {
    data: { type: Buffer, required: true },
    contentType: { type: String, required: true },
    filename: { type: String },
    size: { type: Number },
    owner: { type: Schema.Types.ObjectId, ref: 'User' },
    kind: {
      type: String,
      enum: ['avatar', 'document', 'trip', 'gallery', 'other'],
      default: 'other',
    },
  },
  { timestamps: true }
);

const Upload = mongoose.model('Upload', uploadSchema);
export default Upload;
