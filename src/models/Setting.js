// ============================================================
//  Setting — a single global config document (key: 'global').
//  Add new site-wide flags here as needed.
// ============================================================
import mongoose from 'mongoose';

const { Schema } = mongoose;

const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    referralEnabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

settingSchema.statics.getSingleton = async function getSingleton() {
  let doc = await this.findOne({ key: 'global' });
  if (!doc) doc = await this.create({ key: 'global' });
  return doc;
};

const Setting = mongoose.model('Setting', settingSchema);
export default Setting;
