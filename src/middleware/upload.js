// ============================================================
//  File uploads — Multer disk storage on THIS backend.
//  Files land in backend/uploads/<subfolder> and are served
//  statically at /uploads/... . Stored DB value is the relative
//  path (e.g. "/uploads/avatars/xyz.jpg").
// ============================================================
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// backend/uploads
export const UPLOAD_ROOT = path.resolve(__dirname, '../../', env.upload.dir);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
ensureDir(UPLOAD_ROOT);

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const DOC_TYPES = new Set([...IMAGE_TYPES, 'application/pdf']);

function makeStorage(subfolder) {
  return multer.diskStorage({
    destination(req, file, cb) {
      const dir = path.join(UPLOAD_ROOT, subfolder);
      ensureDir(dir);
      cb(null, dir);
    },
    filename(req, file, cb) {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
      const safe = crypto.randomBytes(16).toString('hex');
      cb(null, `${Date.now()}_${safe}${ext}`);
    },
  });
}

function fileFilter(allowed) {
  return (req, file, cb) => {
    if (allowed.has(file.mimetype)) return cb(null, true);
    cb(ApiError.badRequest(`Unsupported file type: ${file.mimetype}`));
  };
}

// Factory: makeUploader('avatars', { docs: false })
export function makeUploader(subfolder, { docs = false } = {}) {
  return multer({
    storage: makeStorage(subfolder),
    limits: { fileSize: env.upload.maxMb * 1024 * 1024, files: 10 },
    fileFilter: fileFilter(docs ? DOC_TYPES : IMAGE_TYPES),
  });
}

// Convert a stored multer file into a public relative URL path.
export function fileToUrl(file) {
  if (!file) return '';
  const rel = path.relative(UPLOAD_ROOT, file.path).split(path.sep).join('/');
  return `/${env.upload.dir}/${rel}`;
}

export default makeUploader;
