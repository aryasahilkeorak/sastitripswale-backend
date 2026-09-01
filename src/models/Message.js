import mongoose from 'mongoose';

const { Schema } = mongoose;

const messageSchema = new Schema(
  {
    group: { type: Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Not unconditionally required - a photo-share message (see
    // `sharedPhoto`) can carry no text at all. chatController.sendMessage
    // enforces "text or a shared photo" up front; the pre-validate hook
    // below is a schema-level backstop against creating a genuinely empty
    // message some other way.
    text: { type: String, trim: true, maxlength: 2000, default: '' },
    // True for the support chat's AI-generated (or fallback) auto-reply -
    // lets the client label it distinctly from a real human admin message.
    isAuto: { type: Boolean, default: false },
    // Set when this message is sharing a Gallery photo (see
    // galleryController's Lightbox share action) rather than, or alongside,
    // plain text.
    sharedPhoto: { type: Schema.Types.ObjectId, ref: 'Gallery' },
  },
  { timestamps: true }
);

messageSchema.index({ group: 1, createdAt: 1 });

messageSchema.pre('validate', function enforceContent(next) {
  if (!this.text?.trim() && !this.sharedPhoto) {
    return next(new Error('Message must have text or a shared photo'));
  }
  next();
});

const Message = mongoose.model('Message', messageSchema);
export default Message;
