import mongoose from 'mongoose';

const { Schema } = mongoose;

const contactMessageSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    mobile: { type: String, trim: true, maxlength: 15 },
    email: { type: String, trim: true, lowercase: true, maxlength: 150 },
    subject: { type: String, trim: true, maxlength: 150 },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    handled: { type: Boolean, default: false },
    // Set only if the sender was logged in at submission time — lets an
    // admin reply in-app (chat) instead of just by email.
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

const ContactMessage = mongoose.model('ContactMessage', contactMessageSchema);
export default ContactMessage;
