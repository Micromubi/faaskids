// Small request helpers shared by the /api functions.
import crypto from 'node:crypto';

export const adminPin = () => process.env.APP_PIN || '1995';

export function isAdmin(req) {
  const given = String(req.headers['x-pin'] || '');
  const want = adminPin();
  return given.length === want.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

export function send(res, status, body, cache = 'no-store') {
  res.setHeader('Cache-Control', cache);
  return res.status(status).json(body);
}

export function fail(res, e) {
  const status = e.status || 500;
  return send(res, status, { error: e.message || 'Something went wrong', ...(e.extra || {}) });
}

export function httpError(status, message, extra) {
  const e = new Error(message);
  e.status = status;
  e.extra = extra;
  return e;
}

export async function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

export function jsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

/* ---------- signed customer sessions (after phone OTP) ---------- */
function secret() {
  return process.env.SESSION_SECRET ||
    crypto.createHash('sha256').update(`faaskids:${adminPin()}:${process.env.BLOB_STORE_ID || 'local'}`).digest('hex');
}
const b64 = s => Buffer.from(s).toString('base64url');
const sign = s => crypto.createHmac('sha256', secret()).update(s).digest('base64url');

export function makeSession(phone, days = 30) {
  const payload = b64(JSON.stringify({ p: phone, exp: Date.now() + days * 864e5 }));
  return `${payload}.${sign(payload)}`;
}

export function readSession(req) {
  const h = String(req.headers.authorization || '');
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  const [payload, sig] = tok.split('.');
  if (!payload || !sig) return null;
  const want = sign(payload);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data.p : null;
  } catch { return null; }
}

export const hash = s => crypto.createHash('sha256').update(s).digest('hex');
export const hmac = s => crypto.createHmac('sha256', secret()).update(s).digest('hex');
