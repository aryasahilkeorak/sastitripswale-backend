import mongoose from 'mongoose';

const { Schema } = mongoose;

// Caches geocoding results per city so we only ever call the (rate-limited,
// free) Nominatim API once per new city name, ever.
const cityGeoSchema = new Schema(
  {
    city: { type: String, required: true, unique: true, lowercase: true, trim: true },
    state: { type: String, trim: true, default: '' },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    resolvedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const CityGeo = mongoose.model('CityGeo', cityGeoSchema);
export default CityGeo;
