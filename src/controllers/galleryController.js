import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import Gallery from '../models/Gallery.js';
import { fileToUrl } from '../middleware/upload.js';

export const getGallery = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 24));

  const filter = {};
  if (req.query.category && req.query.category !== 'all') filter.category = req.query.category;

  const [photos, total] = await Promise.all([
    Gallery.find(filter)
      .populate('user', 'fullName city avatarUrl')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Gallery.countDocuments(filter),
  ]);

  res.json({
    success: true,
    photos,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const uploadGalleryPhoto = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Photo file required');
  const photo = await Gallery.create({
    user: req.user._id,
    photoUrl: fileToUrl(req.file),
    caption: req.body.caption || '',
    category: req.body.category || 'other',
  });
  await photo.populate('user', 'fullName city avatarUrl');
  res.status(201).json({ success: true, photo });
});
