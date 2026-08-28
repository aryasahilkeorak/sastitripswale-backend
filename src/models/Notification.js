import mongoose from 'mongoose';

const { Schema } = mongoose;

const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: [
        'welcome',
        'trip_interest',
        'join_request',
        'join_accepted',
        'join_rejected',
        'payment',
        'connection',
        'verification',
        'system',
        'group',
        'message',
        'club',
        'follow',
        'message_request',
        'influencer',
        // Sent repeatedly (see utils/documentReminders.js) to a member who
        // still hasn't completed their profile - stops once profileComplete
        // flips true, since the sweep query itself excludes them then.
        'profile_reminder',
        // Admin-facing - only ever sent to admin/superadmin users, via
        // notifyAdmins() in utils/notify.js.
        'admin_document',
        'admin_query',
        'admin_influencer',
        'admin_withdrawal',
        'admin_report',
      ],
      default: 'system',
    },
    title: { type: String, required: true, maxlength: 200 },
    message: { type: String, required: true, maxlength: 1000 },
    isRead: { type: Boolean, default: false, index: true },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;
