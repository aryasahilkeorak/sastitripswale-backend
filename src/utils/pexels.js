// ============================================================
//  Pexels — auto-fetch a destination photo by search query.
//  Never throws; callers get '' on any failure so a missing/rate-
//  limited key never blocks trip creation.
// ============================================================
import { env } from '../config/env.js';

export async function fetchDestinationPhoto(query) {
  if (!env.pexels.apiKey || !query) return '';
  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`;
    const res = await fetch(url, { headers: { Authorization: env.pexels.apiKey } });
    if (!res.ok) return '';
    const data = await res.json();
    return data.photos?.[0]?.src?.large || '';
  } catch {
    return '';
  }
}

export default { fetchDestinationPhoto };
