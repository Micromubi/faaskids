// GET /api/img?p=products/<file> — serves product photos from the private Blob
// store. File names are unique, so the edge can cache them forever.
import { getBytes, storageReady } from '../lib/blob.js';

export default async function handler(req, res) {
  const p = String(req.query.p || '');
  if (!storageReady() || !/^products\/[\w.-]+\.(jpg|png|webp)$/.test(p)) return res.status(404).end();
  try {
    const r = await getBytes(p);
    if (!r) return res.status(404).end();
    res.setHeader('Content-Type', r.contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.status(200).send(r.buf);
  } catch (e) {
    return res.status(502).end();
  }
}
