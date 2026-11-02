// Paystack (cards, bank, USSD, transfer) — enabled when PAYSTACK_SECRET_KEY is set.
import crypto from 'node:crypto';

const KEY = () => process.env.PAYSTACK_SECRET_KEY;
export const paystackReady = () => Boolean(KEY());

async function call(path, init = {}) {
  const r = await fetch('https://api.paystack.co' + path, {
    ...init,
    headers: { Authorization: `Bearer ${KEY()}`, 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.status === false) throw new Error(data.message || 'Paystack error ' + r.status);
  return data.data;
}

export function initPayment({ email, amount, reference, callbackUrl, metadata }) {
  return call('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({ email, amount: Math.round(amount * 100), reference, callback_url: callbackUrl, currency: 'NGN', metadata })
  });
}

export const verifyPayment = reference => call('/transaction/verify/' + encodeURIComponent(reference));

export function validSignature(raw, signature) {
  if (!KEY() || !signature) return false;
  const want = crypto.createHmac('sha512', KEY()).update(raw).digest('hex');
  return want.length === String(signature).length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(String(signature)));
}
