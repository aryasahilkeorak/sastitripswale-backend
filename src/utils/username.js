// ============================================================
//  Shared @username rules - lowercase letters/digits/underscore/dot,
//  3-30 chars, no spaces. Used at registration (required) and profile
//  edit (optional change), plus the backfill script for pre-existing
//  members who signed up before username was required.
// ============================================================
export const USERNAME_RX = /^[a-z0-9_.]{3,30}$/;

// Turn a display name into a valid username base (letters/digits only,
// spaces and punctuation stripped) - never the whole answer by itself
// since it isn't guaranteed unique.
export function slugifyName(fullName) {
  const slug = String(fullName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 25);
  return slug.length >= 3 ? slug : `${slug}member`.slice(0, 25);
}
