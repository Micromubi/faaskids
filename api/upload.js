// POST /api/upload + x-pin, body = image bytes (the admin resizes to ≤1600px JPEG first)
// → { url: '/api/img?p=products/…' }
import crypto from 'node:crypto';
import { putBytes, storageReady } from '../lib/blob.js';
import { isAdmin, send, fail, httpError, rawBody } from '../lib/http.js';

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export default async function handler(req, res) {
  try {
    if (!storageReady()) throw httpError(503, 'storage not set up');
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    if (!isAdmin(req)) return send(res, 401, { error: 'wrong pin' });
    const type = String(req.headers['x-image-type'] || 'image/jpeg');
    const ext = TYPES[type];
    if (!ext) throw httpError(400, 'Only JPEG, PNG or WebP images');
    const buf = await rawBody(req);
    if (!buf.length) throw httpError(400, 'Empty upload');
    if (buf.length > 4 * 1024 * 1024) throw httpError(413, 'Image too large (max 4MB)');
    const name = `products/${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}.${ext}`;
    await putBytes(name, buf, type);
    return send(res, 200, { ok: true, url: `/api/img?p=${name}` });
  } catch (e) {
    return fail(res, e);
  }
}
