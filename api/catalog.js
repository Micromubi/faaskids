// GET  /api/catalog            → public catalogue (cached briefly at the edge)
// GET  /api/catalog?promo=CODE → { promo } if the code exists (for the cart preview)
// GET  /api/catalog + x-pin    → full catalogue incl. promo codes (admin)
// POST /api/catalog + x-pin    → { op, ... } admin changes, see OPS below
import { getCatalog, mutateCatalog, publicCatalog, applyStock } from '../lib/store.js';
import { storageReady } from '../lib/blob.js';
import { isAdmin, send, fail, httpError, jsonBody } from '../lib/http.js';

const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const num = (v, min = 0) => Math.max(min, Math.round(Number(v) || 0));
const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);

function cleanProduct(input, existing) {
  const variantsIn = Array.isArray(input.variants) && input.variants.length ? input.variants : [{ id: 'std', label: '', stock: 0 }];
  const seen = new Set();
  const variants = variantsIn.map(v => {
    let id = str(v.id, 40) || slug(v.label) || 'std';
    while (seen.has(id)) id += '-x';
    seen.add(id);
    const cur = existing?.variants.find(x => x.id === id);
    // Stock edits are applied as a change from what the admin saw (_base), so
    // sales that happened while the form was open aren't wiped out.
    let stock = num(v.stock);
    if (cur && Number.isFinite(Number(v._base))) stock = Math.max(0, (cur.stock || 0) + (num(v.stock) - num(v._base)));
    return { id, label: str(v.label, 40), stock };
  });
  return {
    id: existing?.id || input.id,
    name: str(input.name, 120) || 'Untitled product',
    category: str(input.category, 40),
    price: num(input.price),
    compareAt: num(input.compareAt),
    description: str(input.description, 3000),
    images: (Array.isArray(input.images) ? input.images : []).map(u => str(u, 400)).filter(u => u.startsWith('/api/img?') || /^https:\/\//.test(u)).slice(0, 12),
    variants,
    tags: (Array.isArray(input.tags) ? input.tags : String(input.tags || '').split(',')).map(t => str(t, 30).toLowerCase()).filter(Boolean).slice(0, 20),
    featured: Boolean(input.featured),
    active: input.active !== false,
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now()
  };
}

const OPS = {
  saveProduct(c, { product }) {
    if (!product) throw httpError(400, 'missing product');
    const existing = c.products.find(p => p.id === product.id);
    let id = existing?.id || slug(product.name) || 'product';
    if (!existing) { let n = 2; const base = id; while (c.products.some(p => p.id === id)) id = `${base}-${n++}`; }
    const clean = cleanProduct({ ...product, id }, existing);
    if (existing) c.products[c.products.indexOf(existing)] = clean;
    else c.products.unshift(clean);
    return { saved: clean };
  },
  deleteProduct(c, { id }) {
    c.products = c.products.filter(p => p.id !== id);
    c.bundles = (c.bundles || []).map(b => ({ ...b, items: b.items.filter(x => x !== id) })).filter(b => b.items.length >= 2);
  },
  adjustStock(c, { productId, variantId, delta }) {
    applyStock(c, [{ productId, variantId, delta: Math.round(Number(delta) || 0) }]);
  },
  saveCategories(c, { categories }) {
    c.categories = (categories || []).map(x => ({ id: str(x.id, 40) || slug(x.name), name: str(x.name, 60), emoji: str(x.emoji, 8), image: str(x.image, 400) })).filter(x => x.id && x.name);
  },
  saveBundle(c, { bundle }) {
    const b = {
      id: str(bundle.id, 60) || slug(bundle.name) + '-' + Date.now().toString(36),
      name: str(bundle.name, 80) || 'Combo',
      description: str(bundle.description, 300),
      items: [...new Set((bundle.items || []).filter(id => c.products.some(p => p.id === id)))],
      type: bundle.type === 'fixed' ? 'fixed' : 'percent',
      value: num(bundle.value),
      active: bundle.active !== false
    };
    if (b.items.length < 2) throw httpError(400, 'A combo needs at least 2 products');
    c.bundles = (c.bundles || []).filter(x => x.id !== b.id);
    c.bundles.push(b);
  },
  deleteBundle(c, { id }) { c.bundles = (c.bundles || []).filter(b => b.id !== id); },
  savePromo(c, { promo, previousCode }) {
    const p = {
      code: str(promo.code, 30).toUpperCase().replace(/\s+/g, ''),
      type: ['percent', 'fixed', 'freeship'].includes(promo.type) ? promo.type : 'percent',
      value: num(promo.value),
      minSubtotal: num(promo.minSubtotal),
      expires: str(promo.expires, 10),
      active: promo.active !== false
    };
    if (!p.code) throw httpError(400, 'Code is required');
    c.promos = (c.promos || []).filter(x => x.code !== p.code && x.code !== previousCode);
    c.promos.push(p);
  },
  deletePromo(c, { code }) { c.promos = (c.promos || []).filter(p => p.code !== code); },
  saveSettings(c, { settings }) {
    const s = settings || {};
    c.settings = {
      ...c.settings,
      announcement: str(s.announcement, 200),
      freeDeliveryOver: num(s.freeDeliveryOver),
      lowStockAt: num(s.lowStockAt),
      whatsapp: str(s.whatsapp, 20).replace(/\D/g, ''),
      phoneDisplay: str(s.phoneDisplay, 30),
      instagram: str(s.instagram, 40).replace(/^@/, ''),
      bank: { name: str(s.bank?.name, 80), bank: str(s.bank?.bank, 60), number: str(s.bank?.number, 20) },
      zones: (s.zones || []).map(z => ({ id: str(z.id, 30) || slug(z.name), name: str(z.name, 80), fee: num(z.fee) })).filter(z => z.name)
    };
  }
};

export default async function handler(req, res) {
  try {
    if (!storageReady()) throw httpError(503, 'storage not set up');

    if (req.method === 'GET') {
      const c = await getCatalog();
      if (req.query.promo) {
        const code = String(req.query.promo).trim().toUpperCase();
        const promo = (c.promos || []).find(p => p.code === code && p.active !== false);
        return send(res, 200, { promo: promo || null });
      }
      if (req.headers['x-pin']) {
        if (!isAdmin(req)) return send(res, 401, { error: 'wrong pin' });
        return send(res, 200, c);
      }
      return send(res, 200, publicCatalog(c), 'public, max-age=0, s-maxage=10, stale-while-revalidate=60');
    }

    if (req.method === 'POST') {
      if (!isAdmin(req)) return send(res, 401, { error: 'wrong pin' });
      const body = jsonBody(req);
      if (body.op === 'auth') return send(res, 200, { ok: true });
      const op = OPS[body.op];
      if (!op) throw httpError(400, 'unknown op');
      let result;
      const catalog = await mutateCatalog(c => {
        c.bundles ||= []; c.promos ||= []; c.categories ||= [];
        result = op(c, body) || {};
        return c;
      });
      return send(res, 200, { ok: true, ...result, catalog });
    }

    return send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    return fail(res, e);
  }
}
