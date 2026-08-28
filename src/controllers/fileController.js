// Serve a file stored in MongoDB. Mounted at GET /api/files/:id.
// Profile/trip/gallery imagery is meant to be publicly viewable, but ID
// documents and wallet QR codes are sensitive and must never be reachable
// by a bare permanent URL - only the owner, an admin, or (for a member's
// live verification selfie specifically) an accepted connection may view
// them, mirroring the check memberController's getMemberSelfie already does
// before ever handing this URL out.
import mongoose from 'mongoose';
import Upload from '../models/Upload.js';
import Document from '../models/Document.js';
import Connection from '../models/Connection.js';

const PUBLIC_KINDS = new Set(['avatar', 'cover', 'trip', 'gallery', 'group', 'club']);

export async function getFile(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
    const file = await Upload.findById(req.params.id);
    if (!file) return res.status(404).end();

    const isPublic = PUBLIC_KINDS.has(file.kind);
    if (!isPublic) {
      const userId = req.user?._id;
      const isOwner = Boolean(userId) && String(file.owner) === String(userId);
      const isAdmin = Boolean(req.user) && ['admin', 'superadmin'].includes(req.user.role);
      let authorized = isOwner || isAdmin;

      if (!authorized && userId && file.kind === 'document') {
        const doc = await Document.findOne({ fileUrl: `/api/files/${file._id}`, docType: 'selfie' });
        if (doc) {
          const conn = await Connection.findOne({
            status: 'accepted',
            $or: [
              { sender: userId, receiver: file.owner },
              { sender: file.owner, receiver: userId },
            ],
          });
          authorized = Boolean(conn);
        }
      }

      if (!authorized) return res.status(403).end();
    }

    res.set('Content-Type', file.contentType || 'application/octet-stream');
    res.set(
      'Cache-Control',
      isPublic ? 'public, max-age=604800, immutable' : 'private, no-store'
    );
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    return res.send(file.data);
  } catch {
    return res.status(500).end();
  }
}

export default getFile;
