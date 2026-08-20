import mongoose from 'mongoose';

const { Schema } = mongoose;

// How many people one vehicle can carry on a group ride - drives the
// "X vehicles needed" calculation (e.g. 3 people on bikes need 2 bikes,
// since one bike only fits a rider + 1 pillion).
export const GROUP_VEHICLE_CAPACITY = { Bike: 2, Car: 4 };

const groupTripSchema = new Schema(
  {
    organizer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    vehicleType: { type: String, enum: Object.keys(GROUP_VEHICLE_CAPACITY), required: true, index: true },
    origin: { type: String, required: true, trim: true, maxlength: 200 },
    viaStops: { type: [String], default: [] },
    destination: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, maxlength: 4000 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    budgetPerHead: { type: Number, required: true, min: 0 },
    // Accepted co-travelers only (organizer excluded) - same convention
    // as Trip.filledSeats. No target/cap on group size - the vehicle
    // count is simply recomputed as people join.
    filledMembers: { type: Number, default: 0, min: 0 },
    pickupLocation: { type: String, trim: true },
    coverImageUrl: { type: String, default: '' },
    status: {
      type: String,
      enum: ['upcoming', 'ongoing', 'completed', 'cancelled'],
      default: 'upcoming',
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

groupTripSchema.virtual('currentHeadcount').get(function currentHeadcount() {
  return 1 + (this.filledMembers || 0);
});

groupTripSchema.virtual('vehiclesNeeded').get(function vehiclesNeeded() {
  const capacity = GROUP_VEHICLE_CAPACITY[this.vehicleType] || 1;
  return Math.max(1, Math.ceil(this.currentHeadcount / capacity));
});

groupTripSchema.virtual('routeLabel').get(function routeLabel() {
  return [this.origin, ...(this.viaStops || []), this.destination].filter(Boolean).join(' → ');
});

const GroupTrip = mongoose.model('GroupTrip', groupTripSchema);
export default GroupTrip;
