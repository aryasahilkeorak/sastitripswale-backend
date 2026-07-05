// Persist an uploaded (in-memory) file into MongoDB and return its public URL.
import Upload from '../models/Upload.js';

export async function saveUpload(file, { owner, kind = 'other' } = {}) {
  if (!file || !file.buffer) return '';
  const doc = await Upload.create({
    data: file.buffer,
    contentType: file.mimetype,
    filename: file.originalname,
    size: file.size,
    owner,
    kind,
  });
  // Served by GET /api/files/:id (see app.js). The frontend imageUrl() helper
  // resolves this against the API origin.
  return `/api/files/${doc._id}`;
}

export default saveUpload;
