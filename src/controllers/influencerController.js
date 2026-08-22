// ============================================================
//  Influencer/Promoter program - member-facing endpoints.
//  Admin approval, coupon issuance, and the commission ledger live in
//  adminController.js; commission accrual itself happens in
//  paymentController.js's activateMembership().
// ============================================================
import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import Influencer from '../models/Influencer.js';
import Coupon from '../models/Coupon.js';
import Commission from '../models/Commission.js';
import { saveUpload } from '../utils/uploadStore.js';
import { notifyAdmins } from '../utils/notify.js';

// Sent as flat top-level fields (instagram, facebook, ...) rather than a
// nested object, since the apply request is multipart/form-data (screenshot
// upload) and FormData doesn't nest cleanly.
const SOCIAL_KEYS = ['instagram', 'facebook', 'twitter', 'youtube', 'linkedin'];

function parseSocialLinks(body) {
  const links = {};
  for (const key of SOCIAL_KEYS) {
    const v = String(body[key] || '').trim();
    if (v) links[key] = v.slice(0, 200);
  }
  return links;
}

const PUBLIC_INFLUENCER_FIELDS = 'fullName username avatarUrl city bio isVerified';
const REFERRAL_FIELDS = 'fullName username avatarUrl';
const MAX_VIDEOS = 12;

// Accepts a YouTube or Instagram URL, returns { platform, url } or null.
function parseVideoUrl(raw) {
  const url = String(raw || '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') {
      return { platform: 'youtube', url };
    }
    if (host === 'instagram.com') {
      return { platform: 'instagram', url };
    }
  } catch {
    return null;
  }
  return null;
}

// POST /influencers/apply - self-apply (member, not yet an influencer).
// Reach proof (followers, avg reel views, a dashboard screenshot, and at
// least one social link) is required so admin can set a fair commission %
// (10-30%) without going back and forth with the applicant.
export const applyInfluencer = asyncHandler(async (req, res) => {
  const reason = String(req.body.reason || '').trim();
  if (!reason) throw ApiError.badRequest('Tell us a bit about why you want to promote SastiTripsWale');

  const totalFollowers = Math.max(0, Math.round(Number(req.body.totalFollowers)));
  const avgReelViews = Math.max(0, Math.round(Number(req.body.avgReelViews)));
  if (!Number.isFinite(totalFollowers) || totalFollowers <= 0) throw ApiError.badRequest('Enter your total follower count');
  if (!Number.isFinite(avgReelViews) || avgReelViews <= 0) throw ApiError.badRequest('Enter your average views per reel/video');

  const socialLinks = parseSocialLinks(req.body);
  if (!Object.keys(socialLinks).length) throw ApiError.badRequest('Add at least one social media profile link');

  const existing = await Influencer.findOne({ user: req.user._id });
  const screenshotFile = req.file;
  if (!screenshotFile && !existing?.dashboardScreenshotUrl) {
    throw ApiError.badRequest('Upload a screenshot of your analytics dashboard showing your reach over the last 6 months');
  }
  const dashboardScreenshotUrl = screenshotFile
    // 'document' kind - skips compression, same as ID verification docs, so
    // the stats/numbers in the screenshot stay legible.
    ? await saveUpload(screenshotFile, { owner: req.user._id, kind: 'document' })
    : existing?.dashboardScreenshotUrl || '';

  if (existing) {
    if (existing.status === 'approved') throw ApiError.conflict("You're already an approved influencer");
    if (existing.status === 'pending') throw ApiError.conflict('Your application is already under review');
    // Previously rejected - let them re-apply by resetting to pending.
    existing.status = 'pending';
    existing.appliedReason = reason.slice(0, 1000);
    existing.totalFollowers = totalFollowers;
    existing.avgReelViews = avgReelViews;
    existing.dashboardScreenshotUrl = dashboardScreenshotUrl;
    existing.socialLinks = socialLinks;
    existing.reviewedBy = undefined;
    existing.reviewedAt = undefined;
    await existing.save();
    notifyAdmins({
      type: 'admin_influencer',
      title: 'New influencer application',
      message: `${req.user.fullName} re-applied to become an influencer`,
      meta: { userId: String(req.user._id) },
      permission: 'influencers',
    });
    return res.status(201).json({ success: true, influencer: existing });
  }

  const influencer = await Influencer.create({
    user: req.user._id,
    appliedReason: reason.slice(0, 1000),
    totalFollowers,
    avgReelViews,
    dashboardScreenshotUrl,
    socialLinks,
  });
  notifyAdmins({
    type: 'admin_influencer',
    title: 'New influencer application',
    message: `${req.user.fullName} applied to become an influencer`,
    meta: { userId: String(req.user._id) },
    permission: 'influencers',
  });
  res.status(201).json({ success: true, influencer });
});

// GET /influencers/me - my own application/status + coupon + earnings + ledger.
export const getMyInfluencerProfile = asyncHandler(async (req, res) => {
  const influencer = await Influencer.findOne({ user: req.user._id });
  if (!influencer) return res.json({ success: true, influencer: null });

  const coupon = influencer.status === 'approved' ? await Coupon.findOne({ influencer: influencer._id }) : null;
  const commissions = await Commission.find({ influencer: influencer._id })
    .sort({ createdAt: -1 })
    .limit(100)
    .populate('user', REFERRAL_FIELDS);

  res.json({
    success: true,
    influencer: {
      ...influencer.toObject(),
      coupon: coupon
        ? { code: coupon.code, discountPct: coupon.discountPct, discountAmt: coupon.discountAmt, isActive: coupon.isActive, usedCount: coupon.usedCount }
        : null,
      commissions,
    },
  });
});

// POST /influencers/me/videos - link a YouTube/Instagram video (approved influencers only).
export const addInfluencerVideo = asyncHandler(async (req, res) => {
  const influencer = await Influencer.findOne({ user: req.user._id });
  if (!influencer || influencer.status !== 'approved') throw ApiError.forbidden('Only approved influencers can add videos');
  if (influencer.videos.length >= MAX_VIDEOS) throw ApiError.badRequest(`You can add up to ${MAX_VIDEOS} videos`);

  const parsed = parseVideoUrl(req.body.url);
  if (!parsed) throw ApiError.badRequest('Enter a valid YouTube or Instagram video link');

  influencer.videos.push(parsed);
  await influencer.save();
  res.status(201).json({ success: true, videos: influencer.videos });
});

// DELETE /influencers/me/videos/:videoId
export const removeInfluencerVideo = asyncHandler(async (req, res) => {
  const influencer = await Influencer.findOne({ user: req.user._id });
  if (!influencer) throw ApiError.notFound('Influencer profile not found');
  influencer.videos = influencer.videos.filter((v) => String(v._id) !== req.params.videoId);
  await influencer.save();
  res.json({ success: true, videos: influencer.videos });
});

// GET /influencers - public directory of approved influencers, with the
// coupon code + discount visitors would actually use (never commissionPct).
export const listPublicInfluencers = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 24));

  const [influencers, total] = await Promise.all([
    Influencer.find({ status: 'approved' })
      .sort({ totalEarnedPaise: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('user', PUBLIC_INFLUENCER_FIELDS),
    Influencer.countDocuments({ status: 'approved' }),
  ]);

  const coupons = await Coupon.find({ influencer: { $in: influencers.map((i) => i._id) } }).select('influencer code discountPct discountAmt');
  const couponByInfluencer = Object.fromEntries(coupons.map((c) => [String(c.influencer), c]));

  res.json({
    success: true,
    influencers: influencers
      .filter((i) => i.user)
      .map((i) => ({
        id: i.user._id,
        fullName: i.user.fullName,
        username: i.user.username,
        avatarUrl: i.user.avatarUrl,
        city: i.user.city,
        bio: i.user.bio,
        isVerified: i.user.isVerified,
        coupon: couponByInfluencer[String(i._id)]
          ? {
              code: couponByInfluencer[String(i._id)].code,
              discountPct: couponByInfluencer[String(i._id)].discountPct,
              discountAmt: couponByInfluencer[String(i._id)].discountAmt,
            }
          : null,
      })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});
