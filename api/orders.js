// POST  /api/orders            → place an order (public). Re-prices from the live
//                                catalogue and reserves stock atomically.
// GET   /api/orders + x-pin    → all orders (admin)
// PATCH /api/orders + x-pin    → { no, status?, adminNote?, tracking? } (admin)
import { getCatalog, mutateCatalog, applyStock, createOrder, mutateOrder, getOrder, listOrders, newOrderNo } from '../lib/store.js';
import { storageReady } from '../lib/blob.js';
import { priceCart, normalizePhone } from '../lib/pricing.js';
import { isAdmin, send, fail, httpError, jsonBody } from '../lib/http.js';
import { paystackReady, initPayment } from '../lib/paystack.js';
import { notifyOwner } from '../lib/orders.js';

export const STATUSES = ['pending', 'paid', 'packed', 'shipped', 'delivered', 'cancelled'];
const HOLDS_STOCK = s => s !== 'cancelled';
const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);

async function placeOrder(body) {
  const customer = {
    name: str(body.customer?.name, 80),
    phone: normalizePhone(body.customer?.phone),
    phoneRaw: str(body.customer?.phone, 30),
    email: str(body.customer?.email, 120),
    address: str(body.customer?.address, 300),
    city: str(body.customer?.city, 80),
    state: str(body.customer?.state, 40),
    note: str(body.customer?.note, 500)
  };
  if (!customer.name) throw httpError(400, 'Please enter your name');
  if (customer.phone.length < 10) throw httpError(400, 'Please enter a valid phone number');
  const method = body.payment === 'card' ? 'card' : 'transfer';
  if (method === 'card' && !paystackReady()) throw httpError(400, 'Card payment isn’t available yet — please choose bank transfer');
  if (method === 'card' && !/^\S+@\S+\.\S+$/.test(customer.email)) throw httpError(400, 'Please enter your email for the card receipt');
  const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, 50);
  if (!lines.length) throw httpError(400, 'Your bag is empty');

  let quote;
  // Price + reserve stock in one compare-and-swap on the catalogue.
  await mutateCatalog(c => {
    quote = priceCart(c, lines, { promoCode: body.promoCode, zoneId: body.zoneId, promos: c.promos, phone: customer.phone });
    if (!quote.lines.length) throw httpError(400, 'Those items are no longer available');
    if (quote.errors.length) throw httpError(409, quote.errors.join(' · '), { quote });
    if (!quote.zone) throw httpError(400, 'Please choose a delivery option');
    if (quote.zone.id !== 'pickup' && !customer.address) throw httpError(400, 'Please enter a delivery address');
    // a code the shopper typed that can't be used → tell them (don't silently swap discounts)
    if (body.promoCode && quote.promoError && !/bigger/.test(quote.promoError)) throw httpError(400, quote.promoError + ' — remove it in your bag to continue');
    if (quote.promo) {
      const pr = c.promos.find(x => x.code === quote.promo.code);
      if (pr) { pr.used = (pr.used || 0) + 1; pr.usedBy = [...(pr.usedBy || []), customer.phone].slice(-5000); }
    }
    applyStock(c, quote.lines.map(l => ({ productId: l.productId, variantId: l.variantId, delta: -l.qty })));
    // learn what sells together → powers "Frequently bought together"
    const ids = [...new Set(quote.lines.map(l => l.productId))].sort();
    c.pairs ||= {};
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) c.pairs[`${ids[i]}|${ids[j]}`] = (c.pairs[`${ids[i]}|${ids[j]}`] || 0) + 1;
    return c;
  });

  const now = Date.now();
  const order = {
    no: '',
    ts: now,
    source: 'web',
    status: 'pending',
    history: [{ status: 'pending', ts: now }],
    customer,
    zone: quote.zone,
    lines: quote.lines.map(({ stock, error, ...l }) => l),
    subtotal: quote.subtotal,
    bundles: quote.bundles,
    bundleSaving: quote.bundleSaving,
    promo: quote.promo,
    deliveryFee: quote.deliveryFee,
    total: quote.total,
    payment: { method }
  };
  for (let i = 0; i < 5; i++) {
    order.no = newOrderNo();
    try { await createOrder(order); break; } catch (e) { if (i === 4) {
      // couldn't save — give the stock back
      await mutateCatalog(c => applyStock(c, order.lines.map(l => ({ productId: l.productId, variantId: l.variantId, delta: l.qty })))).catch(() => {});
      throw e;
    } }
  }
  await Promise.race([notifyOwner(order, 'new').catch(() => {}), new Promise(r => setTimeout(r, 3000))]);
  return order;
}

async function updateOrder(body) {
  const { no } = body;
  const status = body.status && STATUSES.includes(body.status) ? body.status : null;
  const before = await getOrder(no);
  if (!before) throw httpError(404, 'Order not found');
  // Cancelling gives the stock back; un-cancelling takes it again (and fails if it's gone).
  let restock = 0;
  if (status && HOLDS_STOCK(before.status) && !HOLDS_STOCK(status)) restock = 1;
  if (status && !HOLDS_STOCK(before.status) && HOLDS_STOCK(status)) restock = -1;
  const moveStock = sign => mutateCatalog(c => applyStock(c, before.lines.map(l => ({ productId: l.productId, variantId: l.variantId, delta: sign * l.qty }))));
  if (restock === -1) await moveStock(-1);
  const order = await mutateOrder(no, o => {
    if (status && status !== o.status) {
      o.status = status;
      o.history = [...(o.history || []), { status, ts: Date.now() }];
      if (status === 'paid') o.paidAt = Date.now();
    }
    if (body.adminNote !== undefined) o.adminNote = str(body.adminNote, 1000);
    if (body.tracking !== undefined) o.tracking = str(body.tracking, 200);
    return o;
  });
  if (restock === 1) await moveStock(1);
  if (restock && before.promo) {
    // a cancelled order gives its coupon use back (and takes it again if re-opened)
    await mutateCatalog(c => {
      const pr = (c.promos || []).find(x => x.code === before.promo.code);
      if (pr) {
        pr.used = Math.max(0, (pr.used || 0) - restock);
        if (restock === 1) { const i = (pr.usedBy || []).lastIndexOf(before.customer.phone); if (i >= 0) pr.usedBy.splice(i, 1); }
        else pr.usedBy = [...(pr.usedBy || []), before.customer.phone];
      }
      return c;
    }).catch(() => {});
  }
  return order;
}

export default async function handler(req, res) {
  try {
    if (!storageReady()) throw httpError(503, 'storage not set up');

    if (req.method === 'POST') {
      const body = jsonBody(req);
      const order = await placeOrder(body);
      const c = await getCatalog();
      let payUrl = null;
      if (order.payment.method === 'card') {
        const origin = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
        try {
          const p = await initPayment({ email: order.customer.email, amount: order.total, reference: order.no, callbackUrl: `${origin}/shop.html?paid=${order.no}`, metadata: { order: order.no, phone: order.customer.phoneRaw } });
          payUrl = p.authorization_url;
        } catch (e) { /* order still stands — customer can pay by transfer */ }
      }
      return send(res, 200, { ok: true, order, payUrl, bank: c.settings.bank, whatsapp: c.settings.whatsapp });
    }

    if (!isAdmin(req)) return send(res, 401, { error: 'wrong pin' });

    if (req.method === 'GET') return send(res, 200, await listOrders());
    if (req.method === 'PATCH') return send(res, 200, { ok: true, order: await updateOrder(jsonBody(req)) });

    return send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    return fail(res, e);
  }
}
