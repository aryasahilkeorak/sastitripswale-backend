import PhotoLike from '../models/PhotoLike.js';

// Given a list of Gallery docs (or already-plain objects) and the id of the
// user viewing them (undefined for an anonymous viewer), returns NEW plain
// objects with `likedByMe` attached - one query total regardless of list
// size, so this is safe to call from every list-of-photos read path
// (public feed, a profile's recent photos, a trip's photos) without an N+1.
export async function withLikedByMe(photos, viewerId) {
  if (!viewerId || !photos.length) {
    return photos.map((p) => ({ ...(p.toObject ? p.toObject() : p), likedByMe: false }));
  }
  const liked = await PhotoLike.find({
    photo: { $in: photos.map((p) => p._id) },
    user: viewerId,
  }).select('photo');
  const likedSet = new Set(liked.map((l) => String(l.photo)));
  return photos.map((p) => {
    const obj = p.toObject ? p.toObject() : p;
    return { ...obj, likedByMe: likedSet.has(String(p._id)) };
  });
}

export default { withLikedByMe };
