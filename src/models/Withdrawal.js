import mongoose from 'mongoose';

const { Schema } = mongoose;

// A member's request to cash out their wallet balance (referral rewards +,
// for influencers, commission earnings). Purely a request/ledger record -
// admin pays out manually (UPI/bank transfer) using the submitted details,
// then marks it paid here.
const withdrawalSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amountPaise: { type: Number, required: true, min: 10000 }, // ₹100 minimum
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
    upiId: { type: String, required: true, trim: true, maxlength: 100 },
    qrCodeUrl: { type: String, required: true },
    panNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'paid'], default: 'pending', index: true },
    adminNote: { type: String, trim: true, maxlength: 500 },
    // UTR / UPI reference number for the actual manual transfer admin made -
    // entered by admin when marking the request paid, shown to the member
    // as their transaction ID.
    transactionRef: { type: String, trim: true, maxlength: 100 },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
);

const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);
export default Withdrawal;
