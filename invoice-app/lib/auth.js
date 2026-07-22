const crypto = require('crypto');
const db = require('./db');

const SESSION_DAYS = 400;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

const sha = s => crypto.createHash('sha256').update(s).digest('hex');

/* salted code hashing: stored as "salt:hash" */
function hashCode(code) {
  const salt = crypto.randomBytes(8).toString('hex');
  return salt + ':' + sha(salt + code);
}
function checkCode(code, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, h] = stored.split(':');
  return sha(salt + code) === h;
}
const genTempCode = () => String(crypto.randomInt(100000, 1000000));

/* brute-force limiting per business name: 10 tries / 15 min */
const attempts = new Map();
function tooMany(key) {
  const a = attempts.get(key);
  return a && a.count >= 10 && Date.now() < a.resetAt;
}
function recordFail(key) {
  let a = attempts.get(key);
  if (!a || Date.now() > a.resetAt) a = { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
  a.count++;
  attempts.set(key, a);
}

function validCode(code) {
  return typeof code === 'string' && code.trim().length >= 4 && code.trim().length <= 32;
}

/* Sign in with business name + personal code. The code identifies the member. */
function login(businessName, code) {
  const bname = String(businessName || '').trim();
  code = String(code || '').trim();
  if (!bname) throw httpErr(400, 'Enter your business name');
  if (!validCode(code)) throw httpErr(400, 'Code must be 4–32 characters');
  const key = bname.toLowerCase();
  if (tooMany(key)) throw httpErr(429, 'Too many attempts — wait 15 minutes and try again');

  const bizs = db.prepare('SELECT id FROM businesses WHERE name = ? COLLATE NOCASE').all(bname);
  for (const b of bizs) {
    const members = db.prepare('SELECT * FROM members WHERE business_id = ?').all(b.id);
    for (const m of members) {
      if (checkCode(code, m.code_hash)) {
        attempts.delete(key);
        return { member: m, token: createSession(m.id), mustChange: !!m.must_change };
      }
    }
  }
  recordFail(key);
  throw httpErr(401, 'Business name or code is incorrect');
}

function createSession(memberId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, member_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)')
    .run(sha(token), memberId, Date.now(), Date.now());
  return token;
}

function createMember(businessId, label, role, code, opts = {}) {
  const r = db.prepare(`INSERT INTO members (business_id, label, code_hash, role, is_admin, must_change, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(businessId, label, hashCode(code), role, opts.isAdmin ? 1 : 0, opts.mustChange ? 1 : 0, Date.now());
  return r.lastInsertRowid;
}

/* change own code; current code must match (for the forced first-login change,
   "current" is the temporary code they just signed in with) */
function setCode(member, currentCode, newCode) {
  if (!checkCode(String(currentCode || '').trim(), member.code_hash))
    throw httpErr(400, 'Current code is incorrect');
  newCode = String(newCode || '').trim();
  if (!validCode(newCode)) throw httpErr(400, 'New code must be 4–32 characters');
  // a code must stay unique within the business — it is the identity
  const siblings = db.prepare('SELECT id, code_hash FROM members WHERE business_id = ? AND id != ?')
    .all(member.business_id, member.id);
  if (siblings.some(s => checkCode(newCode, s.code_hash)))
    throw httpErr(400, 'That code is already used by someone on this team — pick a different one');
  db.prepare('UPDATE members SET code_hash = ?, must_change = 0 WHERE id = ?')
    .run(hashCode(newCode), member.id);
}

function resetMemberCode(memberId) {
  const temp = genTempCode();
  db.prepare('UPDATE members SET code_hash = ?, must_change = 1 WHERE id = ?').run(hashCode(temp), memberId);
  db.prepare('DELETE FROM sessions WHERE member_id = ?').run(memberId);
  return temp;
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

/* Attaches req.member, req.business, req.role from the session cookie.
   Sliding expiry: cookie re-issued and last_seen bumped on activity. */
function sessionMiddleware(req, res, next) {
  const token = readCookie(req, 'sid');
  if (token) {
    const sess = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha(token));
    if (sess) {
      const member = db.prepare('SELECT * FROM members WHERE id = ?').get(sess.member_id);
      if (member) {
        req.member = member;
        req.role = member.role;
        req.business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(member.business_id) || null;
        req.sessionTokenHash = sess.token_hash;
        if (Date.now() - sess.last_seen_at > 60 * 60 * 1000) {
          db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(Date.now(), sess.token_hash);
        }
        setSessionCookie(res, token);
      }
    }
  }
  next();
}

const requireAuth = (req, res, next) =>
  req.member ? next() : res.status(401).json({ error: 'Sign in first' });
const requireBusiness = (req, res, next) =>
  req.business ? next() : res.status(409).json({ error: 'No business on this account' });
const requireAdmin = (req, res, next) =>
  req.member && req.member.is_admin ? next() : res.status(403).json({ error: 'Admins only' });

function signOut(req, res, everywhere) {
  if (req.sessionTokenHash) {
    if (everywhere) db.prepare('DELETE FROM sessions WHERE member_id = ?').run(req.member.id);
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
  login, createSession, createMember, setCode, resetMemberCode, genTempCode, hashCode,
  setSessionCookie, sessionMiddleware, requireAuth, requireBusiness, requireAdmin, signOut, httpErr, validCode
};
