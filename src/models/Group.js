import mongoose from 'mongoose';

const { Schema } = mongoose;

// A chat group. Either auto-created for a trip (type 'trip') or a custom
// group created by a user who adds members by id (type 'custom').
const groupSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    type: { type: String, enum: ['trip', 'custom'], default: 'custom', index: true },
    trip: { type: Schema.Types.ObjectId, ref: 'Trip', index: true },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    members: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    lastMessageAt: { type: Date },
    lastMessageText: { type: String },
  },
  { timestamps: true }
);

groupSchema.index({ members: 1, lastMessageAt: -1 });

groupSchema.methods.hasMember = function hasMember(userId) {
  return this.members.some((m) => String(m) === String(userId));
};

const Group = mongoose.model('Group', groupSchema);
export default Group;
