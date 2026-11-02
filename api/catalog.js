// GET  /api/catalog            → public catalogue (cached briefly at the edge)
// GET  /api/catalog?promo=CODE → { promo } if the code exists (for the cart preview)
// GET  /api/catalog + x-pin    → full catalogue incl. promo codes (admin)
// POST /api/catalog + x-pin    → { op, ... } admin changes, see OPS below
import crypto from 'node:crypto';
import { getCatalog, mutateCatalog, publicCatalog, applyStock, shopperPromo } from '../lib/store.js';
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

function cleanPromo(promo = {}) {
  return {
    code: str(promo.code, 30).toUpperCase().replace(/[^A-Z0-9-]/g, ''),
    type: ['percent', 'fixed', 'freeship'].includes(promo.type) ? promo.type : 'percent',
    value: num(promo.value),
    minSubtotal: num(promo.minSubtotal),
    expires: str(promo.expires, 10),
    maxUses: num(promo.maxUses),
    onePerCustomer: Boolean(promo.onePerCustomer),
    auto: Boolean(promo.auto),
    label: str(promo.label, 60),
    note: str(promo.note, 120),
    active: promo.active !== false
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
    const p = cleanPromo(promo);
    if (!p.code) throw httpError(400, 'Code is required');
    const old = (c.promos || []).find(x => x.code === (previousCode || p.code));
    if (c.promos.some(x => x.code === p.code && x !== old)) throw httpError(400, `${p.code} already exists`);
    Object.assign(p, { used: old?.used || 0, usedBy: old?.usedBy || [], createdAt: old?.createdAt || Date.now() });
    c.promos = c.promos.filter(x => x !== old);
    c.promos.push(p);
  },
  generatePromos(c, { template, count, prefix }) {
    const n = Math.min(200, Math.max(1, num(count)));
    const pre = str(prefix, 12).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'FK';
    const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const have = new Set(c.promos.map(p => p.code));
    const batch = `B${Date.now().toString(36).toUpperCase()}`;
    const codes = [];
    while (codes.length < n) {
      let r = '';
      for (let i = 0; i < 6; i++) r += abc[crypto.randomInt(abc.length)];
      const code = `${pre}-${r}`;
      if (have.has(code)) continue;
      have.add(code);
      codes.push(code);
      c.promos.push({ ...cleanPromo({ ...template, code, auto: false }), used: 0, usedBy: [], batch, createdAt: Date.now() });
    }
    return { codes };
  },
  /** Invoice tool sales take stock too. Idempotent per invoice number: the
   *  server remembers what each invoice took and only applies the difference. */
  invoiceStock(c, { invoiceNo, lines }) {
    const no = str(invoiceNo, 40);
    if (!no) throw httpError(400, 'missing invoice number');
    c.invoiceStock ||= {};
    const key = l => `${l.productId}|${l.variantId}`;
    const prev = new Map((c.invoiceStock[no]?.lines || []).map(l => [key(l), l.qty]));
    const next = new Map();
    for (const l of Array.isArray(lines) ? lines : []) {
      const p = c.products.find(x => x.id === l.productId);
      const v = p?.variants.find(x => x.id === l.variantId);
      if (v) next.set(key(l), (next.get(key(l)) || 0) + num(l.qty));
    }
    const deltas = [];
    for (const k of new Set([...prev.keys(), ...next.keys()])) {
      const d = (prev.get(k) || 0) - (next.get(k) || 0); // positive = give back
      if (d) { const [productId, variantId] = k.split('|'); deltas.push({ productId, variantId, delta: d }); }
    }
    // never block an invoice for a real sale: clamp at zero instead of failing
    for (const d of deltas) {
      const v = c.products.find(x => x.id === d.productId)?.variants.find(x => x.id === d.variantId);
      if (v) v.stock = Math.max(0, (v.stock || 0) + d.delta);
    }
    if (next.size) c.invoiceStock[no] = { ts: Date.now(), lines: [...next].map(([k, qty]) => { const [productId, variantId] = k.split('|'); return { productId, variantId, qty }; }) };
    else delete c.invoiceStock[no];
    const keys = Object.keys(c.invoiceStock);
    if (keys.length > 2000) keys.sort((a, b) => c.invoiceStock[a].ts - c.invoiceStock[b].ts).slice(0, keys.length - 2000).forEach(k => delete c.invoiceStock[k]);
    return { applied: deltas.length };
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
      alertPhone: str(s.alertPhone, 20),
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
        const promo = (c.promos || []).find(p => p.code === code && p.active !== false && !p.auto);
        return send(res, 200, { promo: promo ? shopperPromo(promo) : null });
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
