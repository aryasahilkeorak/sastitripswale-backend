import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import Gallery from '../models/Gallery.js';
import PhotoLike from '../models/PhotoLike.js';
import PhotoComment from '../models/PhotoComment.js';
import { saveUpload } from '../utils/uploadStore.js';
import { withLikedByMe } from '../utils/photoViewerContext.js';
import { GALLERY_USER_FIELDS, REPOST_POPULATE } from '../utils/galleryPopulate.js';
import { containsProfanity } from '../utils/profanityFilter.js';
import { notify } from '../utils/notify.js';

export const getGallery = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 24));

  const filter = {};
  if (req.query.category && req.query.category !== 'all') filter.category = req.query.category;

  const [photos, total] = await Promise.all([
    Gallery.find(filter)
      .populate('user', GALLERY_USER_FIELDS)
      .populate(REPOST_POPULATE)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Gallery.countDocuments(filter),
  ]);

  res.json({
    success: true,
    photos: await withLikedByMe(photos, req.user?._id),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const uploadGalleryPhoto = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Photo file required');
  const photoUrl = await saveUpload(req.file, { owner: req.user._id, kind: 'gallery' });
  const photo = await Gallery.create({
    user: req.user._id,
    photoUrl,
    caption: req.body.caption || '',
    location: req.body.location || '',
    category: req.body.category || 'other',
  });
  await photo.populate('user', GALLERY_USER_FIELDS);
  res.status(201).json({ success: true, photo });
});

// POST /gallery/:id/like - toggle. Idempotent via PhotoLike's unique
// (photo, user) index: a second tap hits the duplicate-key error and that
// path unlikes instead, rather than needing a separate "check first" query.
export const toggleLike = asyncHandler(async (req, res) => {
  const photo = await Gallery.findById(req.params.id).select('user likesCount');
  if (!photo) throw ApiError.notFound('Photo not found');

  try {
    await PhotoLike.create({ photo: photo._id, user: req.user._id });
    photo.likesCount += 1;
    await photo.save();
    if (String(photo.user) !== String(req.user._id)) {
      notify(photo.user, {
        type: 'photo',
        title: 'New like',
        message: `${req.user.fullName} liked your photo`,
        meta: { action: 'like', photoId: String(photo._id) },
      });
    }
    return res.json({ success: true, liked: true, likesCount: photo.likesCount });
  } catch (err) {
    if (err.code !== 11000) throw err;
    await PhotoLike.deleteOne({ photo: photo._id, user: req.user._id });
    photo.likesCount = Math.max(0, photo.likesCount - 1);
    await photo.save();
    return res.json({ success: true, liked: false, likesCount: photo.likesCount });
  }
});

// GET /gallery/:id/comments - public, same pagination shape as getGallery.
export const listComments = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

  const [comments, total] = await Promise.all([
    PhotoComment.find({ photo: req.params.id })
      .populate('user', 'fullName username avatarUrl')
      .sort({ createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    PhotoComment.countDocuments({ photo: req.params.id }),
  ]);

  res.json({ success: true, comments, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

export const addComment = asyncHandler(async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) throw ApiError.badRequest('Comment cannot be empty');
  if (text.length > 500) throw ApiError.badRequest('Comment too long');
  if (containsProfanity(text)) {
    throw ApiError.badRequest("Your comment contains language that isn't allowed here - please rephrase it.", 'PROFANITY_BLOCKED');
  }

  const photo = await Gallery.findById(req.params.id).select('user commentsCount');
  if (!photo) throw ApiError.notFound('Photo not found');

  const comment = await PhotoComment.create({ photo: photo._id, user: req.user._id, text });
  photo.commentsCount += 1;
  await photo.save();
  await comment.populate('user', 'fullName username avatarUrl');

  if (String(photo.user) !== String(req.user._id)) {
    notify(photo.user, {
      type: 'photo',
      title: 'New comment',
      message: `${req.user.fullName} commented on your photo`,
      meta: { action: 'comment', photoId: String(photo._id) },
    });
  }

  res.status(201).json({ success: true, comment, commentsCount: photo.commentsCount });
});

// DELETE /gallery/:id/comments/:commentId - the comment's own author, the
// photo's owner, or a site admin/superadmin can remove a comment.
export const deleteComment = asyncHandler(async (req, res) => {
  const comment = await PhotoComment.findById(req.params.commentId);
  if (!comment || String(comment.photo) !== String(req.params.id)) throw ApiError.notFound('Comment not found');

  const photo = await Gallery.findById(req.params.id).select('user commentsCount');
  const isCommentOwner = String(comment.user) === String(req.user._id);
  const isPhotoOwner = photo && String(photo.user) === String(req.user._id);
  const isSiteAdmin = ['admin', 'superadmin'].includes(req.user.role);
  if (!isCommentOwner && !isPhotoOwner && !isSiteAdmin) throw ApiError.forbidden('Not allowed');

  await comment.deleteOne();
  if (photo) {
    photo.commentsCount = Math.max(0, photo.commentsCount - 1);
    await photo.save();
  }
  res.json({ success: true });
});

// POST /gallery/:id/repost - "regram": a new Gallery doc owned by the
// reposter, always attributed to the ROOT original (a repost of a repost
// re-attributes rather than chaining).
export const repostPhoto = asyncHandler(async (req, res) => {
  const original = await Gallery.findById(req.params.id);
  if (!original) throw ApiError.notFound('Photo not found');
  if (String(original.user) === String(req.user._id)) throw ApiError.badRequest("You can't repost your own photo");

  const rootId = original.repostOf || original._id;
  const root = original.repostOf ? await Gallery.findById(rootId) : original;
  if (!root) throw ApiError.notFound('Photo not found');

  const alreadyReposted = await Gallery.findOne({ user: req.user._id, repostOf: rootId });
  if (alreadyReposted) throw ApiError.conflict("You've already reposted this photo");

  let created;
  try {
    created = await Gallery.create({
      user: req.user._id,
      photoUrl: root.photoUrl,
      caption: root.caption,
      category: root.category,
      location: root.location,
      repostOf: rootId,
    });
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict("You've already reposted this photo");
    throw err;
  }

  await Gallery.updateOne({ _id: rootId }, { $inc: { repostsCount: 1 } });
  await created.populate([
    { path: 'user', select: GALLERY_USER_FIELDS },
    REPOST_POPULATE,
  ]);

  if (String(root.user) !== String(req.user._id)) {
    notify(root.user, {
      type: 'photo',
      title: 'Your photo was reposted',
      message: `${req.user.fullName} reposted your photo`,
      meta: { action: 'repost', photoId: String(rootId) },
    });
  }

  res.status(201).json({ success: true, photo: created });
});
