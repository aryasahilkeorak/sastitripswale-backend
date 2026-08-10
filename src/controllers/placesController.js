import asyncHandler from '../utils/asyncHandler.js';
import { searchIndianPlaces } from '../utils/places.js';

export const autocompletePlaces = asyncHandler(async (req, res) => {
  const suggestions = await searchIndianPlaces(String(req.query.q || ''));
  res.json({ success: true, suggestions });
});
