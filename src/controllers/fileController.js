// Serve a file stored in MongoDB. Mounted at GET /api/files/:id.
import mongoose from 'mongoose';
import Upload from '../models/Upload.js';

export async function getFile(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
    const file = await Upload.findById(req.params.id);
    if (!file) return res.status(404).end();

    res.set('Content-Type', file.contentType || 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=604800, immutable'); // 7 days
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    return res.send(file.data);
  } catch {
    return res.status(500).end();
  }
}

export default getFile;
