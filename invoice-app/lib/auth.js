const crypto = require('crypto');
const db = require('./db');

const SESSION_DAYS = 400;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;

const sha = s => crypto.createHash('sha256').update(s).digest('hex');

function requestCode(email) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpErr(400, 'Enter a valid email address');
  // one active code per email; max 5 fresh codes per hour
  const recent = db.prepare(
    'SELECT COUNT(*) n FROM login_codes WHERE email = ? AND expires_at > ?'
  ).get(email, Date.now() - 50 * 60 * 1000).n;
  if (recent >= 5) throw httpErr(429, 'Too many codes requested — wait a bit and try again');
  const code = String(crypto.randomInt(100000, 1000000));
  db.prepare('DELETE FROM login_codes WHERE email = ? AND expires_at < ?').run(email, Date.now());
  db.prepare('INSERT INTO login_codes (email, code_hash, expires_at) VALUES (?, ?, ?)')
    .run(email, sha(code), Date.now() + CODE_TTL_MS);
  return { email, code };
}

async function deliverCode(email, code) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { delivered: false }; // dev mode: caller shows the code on screen
  const from = process.env.MAIL_FROM || 'onboarding@resend.dev';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from, to: [email],
      subject: `${code} is your sign-in code`,
      text: `Your sign-in code is ${code}\n\nIt expires in 10 minutes. If you didn't request it, ignore this email.`
    })
  });
  if (!res.ok) throw httpErr(502, 'Could not send the email — try again');
  return { delivered: true };
}

function verifyCode(email, code) {
  email = String(email || '').trim().toLowerCase();
  code = String(code || '').trim();
  const row = db.prepare(
    'SELECT rowid, * FROM login_codes WHERE email = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1'
  ).get(email, Date.now());
  if (!row) throw httpErr(400, 'Code expired — request a new one');
  if (row.attempts >= 5) throw httpErr(429, 'Too many wrong tries — request a new code');
  if (sha(code) !== row.code_hash) {
    db.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE rowid = ?').run(row.rowid);
    throw httpErr(400, 'Wrong code — check the digits and try again');
  }
  db.prepare('DELETE FROM login_codes WHERE email = ?').run(email);

  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    const isFirst = db.prepare('SELECT COUNT(*) n FROM users').get().n === 0;
    const adminEnv = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const isAdmin = isFirst || (adminEnv && adminEnv === email) ? 1 : 0;
    const r = db.prepare('INSERT INTO users (email, is_admin, created_at) VALUES (?, ?, ?)')
      .run(email, isAdmin, Date.now());
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  }
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)')
    .run(sha(token), user.id, Date.now(), Date.now());
  return { user, token };
}

function setSessionCookie(res, token) {
  res.cookie('sid', token, {
    httpOnly: true, sameSite: 'lax', maxAge: SESSION_MS,
    secure: process.env.NODE_ENV === 'production'
  });
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/* Attaches req.user + req.business when a valid session cookie exists.
   Sliding expiry: cookie is re-issued and last_seen bumped on activity. */
function sessionMiddleware(req, res, next) {
  const token = readCookie(req, 'sid');
  if (token) {
    const sess = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha(token));
    if (sess) {
      req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(sess.user_id);
      req.business = db.prepare('SELECT * FROM businesses WHERE owner_user_id = ?').get(sess.user_id) || null;
      req.sessionTokenHash = sess.token_hash;
      if (Date.now() - sess.last_seen_at > 60 * 60 * 1000) {
        db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(Date.now(), sess.token_hash);
      }
      setSessionCookie(res, token);
    }
  }
  next();
}

const requireAuth = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: 'Sign in first' });
const requireBusiness = (req, res, next) =>
  req.business ? next() : res.status(409).json({ error: 'Finish setting up your business first' });
const requireAdmin = (req, res, next) =>
  req.user && req.user.is_admin ? next() : res.status(403).json({ error: 'Admins only' });

function signOut(req, res, everywhere) {
  if (req.sessionTokenHash) {
    if (everywhere) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id);
    else db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionTokenHash);
  }
  res.clearCookie('sid');
}

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

module.exports = {
  requestCode, deliverCode, verifyCode, setSessionCookie,
  sessionMiddleware, requireAuth, requireBusiness, requireAdmin, signOut, httpErr
};
