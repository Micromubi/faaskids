// Catalog + orders on top of lib/blob.js.
import { readJSON, writeJSON, mutateJSON, listPaths, mapLimit, putBytes } from './blob.js';
import { seedCatalog } from './seed.js';
import { httpError } from './http.js';

export const CATALOG = 'store/catalog.json';
const orderPath = no => `store/orders/${no}.json`;

export async function getCatalog() {
  const { data } = await readJSON(CATALOG);
  return data || seedCatalog();
}

export function mutateCatalog(fn) {
  return mutateJSON(CATALOG, async c => {
    const next = await fn(c);
    delete next.demo; // once anything is saved, it's the real catalogue
    return next;
  }, seedCatalog);
}

/** What shoppers may see: hidden products and coupon codes removed (only the
 *  automatic website discount is public, since it needs no code). */
export const shopperPromo = ({ used, usedBy, maxUses, note, ...p }) => p;
export function publicCatalog(c) {
  const { promos, invoiceStock, ...rest } = c;
  return {
    ...rest,
    products: c.products.filter(p => p.active !== false),
    promos: (promos || []).filter(p => p.auto && p.active !== false).map(shopperPromo),
    settings: { ...c.settings, alertPhone: undefined, cardPayments: Boolean(process.env.PAYSTACK_SECRET_KEY) }
  };
}

/** Apply stock changes: deltas = [{productId, variantId, delta}]. Throws 409 if any goes negative. */
export function applyStock(c, deltas) {
  for (const d of deltas) {
    const p = c.products.find(x => x.id === d.productId);
    const v = p?.variants.find(x => x.id === d.variantId);
    if (!v) continue;
    const next = (v.stock || 0) + d.delta;
    if (next < 0) throw httpError(409, `${p.name}${v.label ? ' (' + v.label + ')' : ''} just sold out — only ${v.stock} left.`);
    v.stock = next;
  }
  return c;
}

/* ---------- orders ---------- */
export async function getOrder(no) {
  if (!/^FK-[\w-]+$/.test(no || '')) return null;
  return (await readJSON(orderPath(no))).data;
}

export async function createOrder(order) {
  // Fails if the number is already taken, so the caller can pick another.
  await putBytes(orderPath(order.no), Buffer.from(JSON.stringify(order)), 'application/json');
  return order;
}

export function mutateOrder(no, fn) {
  return mutateJSON(orderPath(no), async o => {
    if (!o) throw httpError(404, 'Order not found');
    return fn(o);
  });
}

export async function listOrders() {
  const paths = (await listPaths('store/orders/')).filter(p => p.endsWith('.json'));
  const orders = await mapLimit(paths, 16, async p => (await readJSON(p)).data);
  return orders.filter(Boolean).sort((a, b) => b.ts - a.ts);
}

export function newOrderNo() {
  const d = new Date();
  const day = d.getFullYear().toString().slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let r = '';
  for (let i = 0; i < 4; i++) r += abc[Math.floor(Math.random() * abc.length)];
  return `FK-${day}-${r}`;
}

export { writeJSON };
