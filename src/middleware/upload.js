// ============================================================
//  File uploads — Multer MEMORY storage. The buffer is then
//  persisted into MongoDB via utils/uploadStore.saveUpload().
// ============================================================
import multer from 'multer';
import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const DOC_TYPES = new Set([...IMAGE_TYPES, 'application/pdf']);

function fileFilter(allowed) {
  return (req, file, cb) => {
    if (allowed.has(file.mimetype)) return cb(null, true);
    cb(ApiError.badRequest(`Unsupported file type: ${file.mimetype}`));
  };
}

// Factory kept API-compatible with the old disk version: makeUploader('avatars')
// The first arg (subfolder) is ignored now that files live in the DB.
export function makeUploader(_subfolder, { docs = false } = {}) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.upload.maxMb * 1024 * 1024, files: 10 },
    fileFilter: fileFilter(docs ? DOC_TYPES : IMAGE_TYPES),
  });
}

export default makeUploader;
