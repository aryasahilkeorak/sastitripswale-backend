import asyncHandler from '../utils/asyncHandler.js';
import Review from '../models/Review.js';

export const getReviews = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const featuredOnly = req.query.featured === 'true';

  const filter = featuredOnly ? { isFeatured: true } : {};

  const [reviews, total, agg] = await Promise.all([
    Review.find(filter)
      .populate('user', 'fullName city avatarUrl isVerified')
      .sort({ isFeatured: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Review.countDocuments(filter),
    Review.aggregate([
      { $group: { _id: '$rating', count: { $sum: 1 } } },
    ]),
  ]);

  // Rating breakdown + average.
  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  let count = 0;
  for (const row of agg) {
    breakdown[row._id] = row.count;
    sum += row._id * row.count;
    count += row.count;
  }
  const average = count ? Number((sum / count).toFixed(2)) : 0;

  res.json({
    success: true,
    reviews,
    stats: { average, count, breakdown },
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const createReview = asyncHandler(async (req, res) => {
  const review = await Review.create({
    user: req.user._id,
    rating: Number(req.body.rating),
    message: req.body.message,
    tripDestination: req.body.tripDestination || req.body.destination || '',
  });
  await review.populate('user', 'fullName city avatarUrl isVerified');
  res.status(201).json({ success: true, review });
});
