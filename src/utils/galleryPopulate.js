// Shared populate shapes for Gallery docs, so the public feed, a profile's
// recent photos, and a trip's photos all attribute a repost identically.
export const GALLERY_USER_FIELDS = 'fullName username city avatarUrl isVerified';

export const REPOST_POPULATE = {
  path: 'repostOf',
  select: 'photoUrl caption',
  populate: { path: 'user', select: 'fullName username' },
};

export default { GALLERY_USER_FIELDS, REPOST_POPULATE };
