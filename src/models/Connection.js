import mongoose from 'mongoose';

const { Schema } = mongoose;

const connectionSchema = new Schema(
  {
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    receiver: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  },
  { timestamps: true }
);

connectionSchema.index({ sender: 1, receiver: 1 }, { unique: true });

const Connection = mongoose.model('Connection', connectionSchema);
export default Connection;
