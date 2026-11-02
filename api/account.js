// Customer order tracking with a one-time code sent to their phone — no sign-up.
//
// POST /api/account { action:'send',   phone }        → texts a 6-digit code
// POST /api/account { action:'verify', phone, code }  → { token } (30-day session)
// GET  /api/account  Authorization: Bearer <token>    → { phone, orders }
//
// SMS goes through Termii (popular in Nigeria). Set TERMII_API_KEY and
// TERMII_SENDER_ID in Vercel. Until then the API runs in TEST MODE and returns
// the code in the response so the flow can be tried internally.
import crypto from 'node:crypto';
import { readJSON, writeJSON, remove, storageReady } from '../lib/blob.js';
import { listOrders } from '../lib/store.js';
import { normalizePhone } from '../lib/pricing.js';
import { sendSms as termii } from '../lib/sms.js';
import { send, fail, httpError, jsonBody, makeSession, readSession, hash, hmac } from '../lib/http.js';

const OTP_TTL = 10 * 60e3;
const RESEND_AFTER = 45e3;
const MAX_TRIES = 5;
const otpPath = phone => `store/otp/${hash(phone).slice(0, 32)}.json`;
const testMode = () => !process.env.TERMII_API_KEY;

const ordersFor = async phone => (await listOrders()).filter(o => o.customer?.phone === phone);

export default async function handler(req, res) {
  try {
    if (!storageReady()) throw httpError(503, 'storage not set up');

    if (req.method === 'GET') {
      const phone = readSession(req);
      if (!phone) return send(res, 401, { error: 'Please verify your phone number again' });
      const orders = (await ordersFor(phone)).map(({ adminNote, ...o }) => o);
      return send(res, 200, { phone, orders });
    }

    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    const body = jsonBody(req);
    const phone = normalizePhone(body.phone);
    if (phone.length < 10) throw httpError(400, 'Please enter a valid phone number');

    if (body.action === 'send') {
      const { data: prev, etag } = await readJSON(otpPath(phone));
      if (prev && Date.now() - prev.sentAt < RESEND_AFTER) {
        throw httpError(429, `Please wait ${Math.ceil((RESEND_AFTER - (Date.now() - prev.sentAt)) / 1000)}s before asking for a new code`);
      }
      // Only text numbers that have ordered — keeps SMS costs from strangers at zero.
      // The reply is the same either way so it doesn't reveal who is a customer.
      const known = (await ordersFor(phone)).length > 0;
      const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
      await writeJSON(otpPath(phone), { h: hmac(`${phone}:${code}`), exp: Date.now() + OTP_TTL, tries: 0, sentAt: Date.now() }, etag);
      if (known && !testMode()) await termii(phone, `Your FaasKids code is ${code}. It expires in 10 minutes. Don't share it with anyone.`).catch(() => { throw httpError(502, 'Could not send the code right now — please try again shortly.'); });
      return send(res, 200, {
        ok: true,
        message: 'If this number has FaasKids orders, a 6-digit code is on its way by SMS.',
        ...(testMode() ? { testMode: true, testCode: known ? code : null } : {})
      });
    }

    if (body.action === 'verify') {
      const { data: otp, etag } = await readJSON(otpPath(phone));
      const code = String(body.code || '').replace(/\D/g, '');
      if (!otp || Date.now() > otp.exp) throw httpError(400, 'That code has expired — request a new one');
      if (otp.tries >= MAX_TRIES) throw httpError(429, 'Too many attempts — request a new code');
      const ok = otp.h.length === 64 && crypto.timingSafeEqual(Buffer.from(otp.h), Buffer.from(hmac(`${phone}:${code}`)));
      if (!ok) {
        await writeJSON(otpPath(phone), { ...otp, tries: otp.tries + 1 }, etag);
        throw httpError(400, `Wrong code — ${MAX_TRIES - otp.tries - 1} tries left`);
      }
      await remove(otpPath(phone));
      return send(res, 200, { ok: true, token: makeSession(phone), phone });
    }

    throw httpError(400, 'unknown action');
  } catch (e) {
    return fail(res, e);
  }
}
