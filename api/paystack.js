// GET  /api/paystack?reference=FK-…  → verify after the customer returns from Paystack
// POST /api/paystack                 → Paystack webhook (set this URL in the Paystack
//                                       dashboard → Settings → API Keys & Webhooks)
import { verifyPayment, validSignature, paystackReady } from '../lib/paystack.js';
import { markPaid } from '../lib/orders.js';
import { getOrder } from '../lib/store.js';
import { send, fail, httpError } from '../lib/http.js';

async function settle(reference) {
  const order = await getOrder(reference);
  if (!order) throw httpError(404, 'Order not found');
  const tx = await verifyPayment(reference);
  // only accept a successful charge for the full order amount
  if (tx.status === 'success' && tx.currency === 'NGN' && tx.amount >= Math.round(order.total * 100)) {
    return markPaid(order.no, { method: 'card', reference: tx.reference, channel: tx.channel, paidAmount: tx.amount / 100 });
  }
  return order;
}

async function readRaw(req) {
  if (req.rawBody) return req.rawBody; // local dev server
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  try {
    if (!paystackReady()) throw httpError(503, 'Paystack is not set up');
    if (req.method === 'GET') {
      const order = await settle(String(req.query.reference || ''));
      // minimal reply — anyone can call this with an order number
      return send(res, 200, { ok: true, no: order.no, status: order.status });
    }
    if (req.method === 'POST') {
      const raw = await readRaw(req); // don't touch req.body: the signature is over the exact bytes
      if (!validSignature(raw, req.headers['x-paystack-signature'])) return send(res, 401, { error: 'bad signature' });
      const event = JSON.parse(raw.toString('utf8'));
      if (event.event === 'charge.success' && event.data?.reference) await settle(event.data.reference).catch(() => {});
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    return fail(res, e);
  }
}
