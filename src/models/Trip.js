import mongoose from 'mongoose';

const { Schema } = mongoose;

const expenseSchema = new Schema(
  {
    category: { type: String, enum: ['fuel', 'stay', 'food', 'permits', 'misc'], default: 'misc' },
    description: { type: String, trim: true },
    amount: { type: Number, required: true, min: 0 },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

const tripSchema = new Schema(
  {
    organizer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    origin: { type: String, required: true, trim: true, maxlength: 200 },
    viaStops: { type: [String], default: [] },
    destination: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, maxlength: 4000 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    budgetPerHead: { type: Number, required: true, min: 0 },
    totalSeats: { type: Number, required: true, min: 1, default: 4 },
    filledSeats: { type: Number, default: 0, min: 0 },
    vehicleType: {
      type: String,
      enum: ['Bike', 'Car', 'Bus', 'Train', 'Mixed', ''],
      default: '',
    },
    tripType: {
      type: String,
      enum: ['bike', 'car', 'trek', 'beach', 'mountain', 'mixed', ''],
      default: 'mixed',
      index: true,
    },
    pickupLocation: { type: String, trim: true },
    isCouplesMode: { type: Boolean, default: false },
    coverImageUrl: { type: String, default: '' },
    status: {
      type: String,
      enum: ['upcoming', 'ongoing', 'completed', 'cancelled'],
      default: 'upcoming',
      index: true,
    },
    expenses: { type: [expenseSchema], default: [] },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

tripSchema.virtual('seatsLeft').get(function seatsLeft() {
  // In couples mode the host couple occupies 2 seats without booking a TripInterest.
  const reserved = this.isCouplesMode ? 2 : 0;
  return Math.max(0, (this.totalSeats || 0) - reserved - (this.filledSeats || 0));
});

tripSchema.virtual('routeLabel').get(function routeLabel() {
  return [this.origin, ...(this.viaStops || []), this.destination].filter(Boolean).join(' → ');
});

const Trip = mongoose.model('Trip', tripSchema);
export default Trip;
