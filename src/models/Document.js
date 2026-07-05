import mongoose from 'mongoose';

const { Schema } = mongoose;

// ID documents (Aadhaar/PAN/etc.) uploaded for admin verification.
const documentSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    docType: {
      type: String,
      enum: ['aadhaar', 'pan', 'voter_id', 'driving_license'],
      required: true,
    },
    fileUrl: { type: String, required: true },
    isVerified: { type: Boolean, default: false },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    verifiedAt: { type: Date },
  },
  { timestamps: true }
);

const Document = mongoose.model('Document', documentSchema);
export default Document;
