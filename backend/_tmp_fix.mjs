import mongoose from 'mongoose';
import { connectDB, disconnectDB } from './src/config/db.js';
import Payment from './src/models/Payment.js';

async function main() {
  await connectDB();
  const res = await Payment.updateMany({ status: 'success' }, { $set: { amount: 0 } });
  console.log('Matched:', res.matchedCount, 'Modified:', res.modifiedCount);
  const after = await Payment.find({}).lean();
  console.log(JSON.stringify(after, null, 2));
  await disconnectDB();
  await mongoose.connection.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
