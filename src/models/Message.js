import mongoose from 'mongoose';

const { Schema } = mongoose;

const messageSchema = new Schema(
  {
    group: { type: Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    // True for the support chat's AI-generated (or fallback) auto-reply -
    // lets the client label it distinctly from a real human admin message.
    isAuto: { type: Boolean, default: false },
  },
  { timestamps: true }
);

messageSchema.index({ group: 1, createdAt: 1 });

const Message = mongoose.model('Message', messageSchema);
export default Message;
