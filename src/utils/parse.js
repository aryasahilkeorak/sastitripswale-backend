// Helpers for normalising multipart/form-data + query values.

export function toBool(v) {
  if (typeof v === 'boolean') return v;
  return ['true', '1', 'yes', 'on'].includes(String(v).toLowerCase());
}

// Accept a real array, a JSON array string, or a comma-separated string.
export function parseArray(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v !== 'string' || !v.trim()) return [];
  const s = v.trim();
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      return Array.isArray(arr) ? arr.filter(Boolean) : [];
    } catch {
      /* fall through */
    }
  }
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

// Build an object of only the keys present in `body` from `allowed`.
export function pick(body, allowed) {
  const out = {};
  for (const key of allowed) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}

export default { toBool, parseArray, pick };
