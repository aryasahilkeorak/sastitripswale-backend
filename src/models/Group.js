import mongoose from 'mongoose';

const { Schema } = mongoose;

// A chat group. Auto-created for a trip (type 'trip'), a custom group
// created by a user who adds members by id (type 'custom'), a 1-on-1 direct
// message between two connected members (type 'dm'), or a persistent travel
// club (type 'club' - bikers/cars/offroading, see clubController.js). A club
// IS a Group under the hood, so it gets the same members list, photo,
// description, and the existing /chat/groups/:id message thread for free -
// `admins` and `joinRequests` are the only club-specific additions.
const groupSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    photoUrl: { type: String, default: '' },
    // Club-only banner image shown above the profile photo (Facebook-group
    // style). Harmless/unused on other group types.
    coverPhotoUrl: { type: String, default: '' },
    type: { type: String, enum: ['trip', 'custom', 'dm', 'club'], default: 'custom', index: true },
    category: { type: String, enum: ['bikers', 'cars', 'offroading', 'other'], default: undefined },
    trip: { type: Schema.Types.ObjectId, ref: 'Trip', index: true },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    admins: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    members: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    // Pending "request to join" for public clubs - admins accept/reject.
    joinRequests: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    // DM-only (Instagram-style message requests): a DM between two members
    // who aren't already connected/following starts 'pending' - the
    // recipient replying (or explicitly accepting) flips it to 'accepted'.
    // Meaningless/unused for every other group type.
    dmStatus: { type: String, enum: ['accepted', 'pending'], default: 'accepted' },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    lastMessageAt: { type: Date },
    lastMessageText: { type: String },
    // Members who manually flagged this chat "unread" (WhatsApp-style toggle,
    // not automatic read-tracking) - cleared for a member as soon as they
    // open the conversation.
    unreadFor: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

groupSchema.index({ members: 1, lastMessageAt: -1 });
groupSchema.index({ type: 1, category: 1 });

groupSchema.methods.hasMember = function hasMember(userId) {
  return this.members.some((m) => String(m) === String(userId));
};

groupSchema.methods.isAdmin = function isAdmin(userId) {
  return (
    String(this.owner) === String(userId) || this.admins.some((a) => String(a) === String(userId))
  );
};

const Group = mongoose.model('Group', groupSchema);
export default Group;
