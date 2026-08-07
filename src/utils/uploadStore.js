// Persist an uploaded (in-memory) file into MongoDB and return its public URL.
import { createRequire } from 'module';
import Upload from '../models/Upload.js';

// sharp's ESM wrapper uses `import pkg from "./package.json" with {...}`,
// an import-attributes syntax that needs Node 20.10+/22+ — require() it via
// its CJS entry instead so this works on older Node 20.x too.
const require = createRequire(import.meta.url);
const sharp = require('sharp');

const COMPRESSIBLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_DIMENSION = 1600;

// Downscale + re-encode photos before they ever hit the database — these
// are user-uploaded phone photos that can easily be 4-8MB each, and every
// one is stored as raw bytes in a MongoDB document. Documents (Aadhaar/PAN/
// etc.) and non-image files (PDFs) pass through untouched — a compression
// artifact on an ID document could make it unreadable during review.
async function compressImage(buffer, mimetype) {
  try {
    let pipeline = sharp(buffer)
      .rotate() // apply EXIF orientation, then drop the tag
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true });
    pipeline = mimetype === 'image/png' ? pipeline.png({ compressionLevel: 8 }) : pipeline.jpeg({ quality: 78, mozjpeg: true });
    const outBuffer = await pipeline.toBuffer();
    return { buffer: outBuffer, contentType: mimetype === 'image/png' ? 'image/png' : 'image/jpeg' };
  } catch {
    // Corrupt/unsupported image data — store the original rather than fail the upload.
    return { buffer, contentType: mimetype };
  }
}

export async function saveUpload(file, { owner, kind = 'other', compress } = {}) {
  if (!file || !file.buffer) return '';
  // Default: compress everything EXCEPT ID/verification documents (Aadhaar,
  // PAN, DL, RC, the live selfie) — those need to stay full-resolution for
  // an admin to actually read/verify them. Callers can still force either way.
  const shouldCompress = compress ?? kind !== 'document';
  let { buffer, mimetype } = file;
  if (shouldCompress && COMPRESSIBLE_TYPES.has(mimetype)) {
    ({ buffer, contentType: mimetype } = await compressImage(buffer, mimetype));
  }
  const doc = await Upload.create({
    data: buffer,
    contentType: mimetype,
    filename: file.originalname,
    size: buffer.length,
    owner,
    kind,
  });
  // Served by GET /api/files/:id (see app.js). The frontend imageUrl() helper
  // resolves this against the API origin.
  return `/api/files/${doc._id}`;
}

export default saveUpload;
