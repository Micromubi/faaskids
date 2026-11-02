// Product reviews from verified buyers.
// GET    /api/reviews                 → { summary: { productId: { avg, count } } }
// GET    /api/reviews?product=ID      → { reviews: [...] } newest first
// GET    /api/reviews?mine=1  (Bearer) → products this customer can review
// POST   /api/reviews  (Bearer)        → { productId, rating, text, name }
// GET    /api/reviews?all=1 + x-pin   → every review (admin)
// DELETE /api/reviews?id=… + x-pin    → remove a review (admin)
import crypto from 'node:crypto';
import { readJSON, mutateJSON, storageReady } from '../lib/blob.js';
import { listOrders } from '../lib/store.js';
import { isAdmin, send, fail, httpError, jsonBody, readSession } from '../lib/http.js';

const PATH = 'store/reviews.json';
const REVIEWABLE = ['paid', 'packed', 'shipped', 'delivered'];
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const publicReview = ({ phone, ...r }) => r;

async function boughtBy(phone) {
  const ids = new Set();
  (await listOrders()).filter(o => o.customer?.phone === phone && REVIEWABLE.includes(o.status))
    .forEach(o => o.lines.forEach(l => ids.add(l.productId)));
  return ids;
}

export default async function handler(req, res) {
  try {
    if (!storageReady()) throw httpError(503, 'storage not set up');
    const all = async () => (await readJSON(PATH)).data || [];

    if (req.method === 'GET') {
      if (req.query.all) {
        if (!isAdmin(req)) return send(res, 401, { error: 'wrong pin' });
        return send(res, 200, { reviews: await all() });
      }
      if (req.query.mine) {
        const phone = readSession(req);
        if (!phone) return send(res, 401, { error: 'Please verify your phone number again' });
        const list = await all();
        const done = new Set(list.filter(r => r.phone === phone).map(r => r.productId));
        return send(res, 200, { canReview: [...await boughtBy(phone)].filter(id => !done.has(id)), reviewed: [...done] });
      }
      const list = (await all()).filter(r => !r.hidden);
      if (req.query.product) {
        return send(res, 200, { reviews: list.filter(r => r.productId === req.query.product).sort((a, b) => b.ts - a.ts).map(publicReview) },
          'public, max-age=0, s-maxage=30, stale-while-revalidate=300');
      }
      const summary = {};
      list.forEach(r => { const s = (summary[r.productId] ||= { sum: 0, count: 0 }); s.sum += r.rating; s.count++; });
      Object.values(summary).forEach(s => { s.avg = Math.round(s.sum / s.count * 10) / 10; delete s.sum; });
      return send(res, 200, { summary }, 'public, max-age=0, s-maxage=30, stale-while-revalidate=300');
    }

    if (req.method === 'POST') {
      const phone = readSession(req);
      if (!phone) return send(res, 401, { error: 'Please verify your phone number again' });
      const b = jsonBody(req);
      const rating = Math.round(Number(b.rating));
      if (!(rating >= 1 && rating <= 5)) throw httpError(400, 'Please choose 1 to 5 stars');
      if (!(await boughtBy(phone)).has(b.productId)) throw httpError(403, 'You can review items once your order is paid');
      const review = {
        id: crypto.randomBytes(6).toString('hex'),
        productId: str(b.productId, 80), rating,
        text: str(b.text, 1000), name: str(b.name, 40) || 'FaasKids parent',
        phone, ts: Date.now(), verified: true
      };
      await mutateJSON(PATH, list => [...list.filter(r => !(r.phone === phone && r.productId === review.productId)), review], () => []);
      return send(res, 200, { ok: true, review: publicReview(review) });
    }

    if (req.method === 'DELETE' || req.method === 'PATCH') {
      if (!isAdmin(req)) return send(res, 401, { error: 'wrong pin' });
      const id = String(req.query.id || '');
      await mutateJSON(PATH, list => req.method === 'DELETE'
        ? list.filter(r => r.id !== id)
        : list.map(r => r.id === id ? { ...r, hidden: !r.hidden } : r), () => []);
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    return fail(res, e);
  }
}
