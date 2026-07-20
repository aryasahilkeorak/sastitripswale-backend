import mongoose from 'mongoose';

const { Schema } = mongoose;

// ID documents (Aadhaar/PAN/etc.) uploaded for admin verification.
const documentSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    docType: {
      type: String,
      enum: ['aadhaar', 'pan', 'voter_id', 'driving_license', 'rc'],
      required: true,
    },
    // Aadhaar/DL/RC are uploaded as two separate photos; single-sided
    // documents (PAN) leave this blank.
    side: { type: String, enum: ['front', 'back', ''], default: '' },
    fileUrl: { type: String, required: true },
    isVerified: { type: Boolean, default: false },
    status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    verifiedAt: { type: Date },
  },
  { timestamps: true }
);

const Document = mongoose.model('Document', documentSchema);
export default Document;
