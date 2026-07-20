import mongoose from 'mongoose';

const { Schema } = mongoose;

// A chat group. Auto-created for a trip (type 'trip'), a custom group
// created by a user who adds members by id (type 'custom'), or a 1-on-1
// direct message between two connected members (type 'dm').
const groupSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    photoUrl: { type: String, default: '' },
    type: { type: String, enum: ['trip', 'custom', 'dm'], default: 'custom', index: true },
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
