// ============================================================
//  Granular permissions a super admin can grant to a plain 'admin'.
//  Super admins always have every permission implicitly — this list
//  only restricts/expands what a non-super admin can do.
// ============================================================
export const ADMIN_PERMISSIONS = [
  'users', // verify/ban/delete members, view details & documents
  'trips', // change trip status
  'coupons', // create/edit/delete/toggle coupons
  'reviews', // feature/delete reviews
  'messages', // manage contact/help queries
  'gallery', // delete gallery photos
  'revenue', // see revenue figures on the dashboard
];

export function sanitizePermissions(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((p) => ADMIN_PERMISSIONS.includes(p)))];
}

export function hasPermission(user, key) {
  if (!user) return false;
  if (user.role === 'superadmin') return true;
  return user.role === 'admin' && Array.isArray(user.permissions) && user.permissions.includes(key);
}

export default { ADMIN_PERMISSIONS, sanitizePermissions, hasPermission };
