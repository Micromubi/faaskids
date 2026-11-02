// Order side-effects shared by /api/orders and /api/paystack.
import { mutateOrder, getCatalog } from './store.js';
import { sendSms } from './sms.js';
import { fmt } from './pricing.js';

/** Mark an order paid once (safe to call repeatedly from webhook + redirect). */
export async function markPaid(no, payment = {}) {
  let changed = false;
  const order = await mutateOrder(no, o => {
    if (o.status === 'pending') {
      o.status = 'paid';
      o.paidAt = Date.now();
      o.history = [...(o.history || []), { status: 'paid', ts: o.paidAt }];
      changed = true;
    }
    o.payment = { ...o.payment, ...payment };
    return o;
  });
  if (changed) await Promise.race([notifyOwner(order, 'paid').catch(() => {}), new Promise(r => setTimeout(r, 3000))]);
  return order;
}

/** Text the shop owner about new / paid orders (needs Termii + Settings → alert phone). */
export async function notifyOwner(order, what) {
  const c = await getCatalog();
  const to = c.settings?.alertPhone;
  if (!to) return;
  const items = order.lines.reduce((s, l) => s + l.qty, 0);
  const text = what === 'paid'
    ? `FaasKids: ${order.no} PAID ${fmt(order.total)} (${order.payment?.method === 'card' ? 'Paystack' : 'transfer'}) — ${order.customer.name}. Ready to pack.`
    : `FaasKids: new order ${order.no} ${fmt(order.total)}, ${items} item(s) from ${order.customer.name} ${order.customer.phoneRaw}. ${order.payment?.method === 'card' ? 'Paying by card.' : 'Awaiting transfer.'}`;
  await sendSms(to.replace(/\D/g, '').replace(/^0/, '234'), text);
}
