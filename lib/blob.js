// Storage helpers for the shop: JSON documents in the private Vercel Blob store.
//
// Reads bypass the CDN cache (useCache:false) so we always see the latest version,
// and writes use the blob ETag (ifMatch) as a compare-and-swap, so two requests
// changing the same document (e.g. two customers buying the last backpack) can't
// silently overwrite each other — the loser re-reads and tries again.
//
// For local development set FAASKIDS_LOCAL_STORE=/some/dir and documents are kept
// on disk instead (see scripts/dev.js).

import { get, put, del, list, BlobPreconditionFailedError } from '@vercel/blob';
import { getVercelOidcToken } from '@vercel/oidc';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const LOCAL = process.env.FAASKIDS_LOCAL_STORE;

export function storageReady() {
  return Boolean(LOCAL || process.env.BLOB_STORE_ID);
}

async function auth() {
  return { storeId: process.env.BLOB_STORE_ID, oidcToken: await getVercelOidcToken() };
}

/* ---------- local filesystem stand-in ---------- */
const localPath = p => path.join(LOCAL, p);
const etagOf = buf => crypto.createHash('md5').update(buf).digest('hex');

async function localGet(p) {
  try {
    const buf = await fs.readFile(localPath(p));
    return { buf, etag: etagOf(buf) };
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}
async function localPut(p, buf, { ifMatch, allowOverwrite }) {
  const cur = await localGet(p);
  if (cur && !allowOverwrite) throw new Error('blob already exists');
  if (ifMatch && (!cur || cur.etag !== ifMatch)) throw new BlobPreconditionFailedError();
  await fs.mkdir(path.dirname(localPath(p)), { recursive: true });
  await fs.writeFile(localPath(p), buf);
}
async function localList(prefix) {
  const dir = localPath(prefix);
  const out = [];
  async function walk(d) {
    let entries = [];
    try { entries = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else out.push(path.relative(LOCAL, full).split(path.sep).join('/'));
    }
  }
  await walk(dir.endsWith('/') ? dir : path.dirname(dir));
  return out.filter(p => p.startsWith(prefix));
}

/* ---------- raw bytes ---------- */
export async function getBytes(pathname, { fresh = false } = {}) {
  if (LOCAL) {
    const r = await localGet(pathname);
    return r && { buf: r.buf, etag: r.etag, contentType: guessType(pathname) };
  }
  const r = await get(pathname, { access: 'private', useCache: !fresh, ...(await auth()) });
  if (!r || r.statusCode !== 200) return null;
  const buf = Buffer.from(await new Response(r.stream).arrayBuffer());
  return { buf, etag: r.blob.etag, contentType: r.blob.contentType };
}

export async function putBytes(pathname, buf, contentType, { ifMatch, allowOverwrite = false } = {}) {
  if (LOCAL) return localPut(pathname, buf, { ifMatch, allowOverwrite });
  await put(pathname, buf, {
    access: 'private',
    contentType,
    addRandomSuffix: false,
    allowOverwrite,
    ...(ifMatch ? { ifMatch } : {}),
    ...(await auth())
  });
}

export async function remove(pathname) {
  if (LOCAL) return fs.rm(localPath(pathname), { force: true });
  await del(pathname, await auth()).catch(() => {});
}

export async function listPaths(prefix) {
  if (LOCAL) return localList(prefix);
  const a = await auth();
  const paths = [];
  let cursor;
  do {
    const r = await list({ prefix, cursor, limit: 1000, ...a });
    r.blobs.forEach(b => paths.push(b.pathname));
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return paths;
}

function guessType(p) {
  if (p.endsWith('.json')) return 'application/json';
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/* ---------- JSON documents ---------- */
export async function readJSON(pathname) {
  const r = await getBytes(pathname, { fresh: true });
  if (!r) return { data: null, etag: null };
  return { data: JSON.parse(r.buf.toString('utf8')), etag: r.etag };
}

export async function writeJSON(pathname, data, etag) {
  const buf = Buffer.from(JSON.stringify(data));
  await putBytes(pathname, buf, 'application/json', etag ? { ifMatch: etag, allowOverwrite: true } : {});
}

/**
 * Read-modify-write with retries. `fn(current)` returns the new document
 * (it may mutate and return the same object) or throws to abort.
 * `fallback()` supplies the document when it doesn't exist yet.
 */
export async function mutateJSON(pathname, fn, fallback = () => null) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, etag } = await readJSON(pathname);
    const next = await fn(data ?? fallback());
    try {
      await writeJSON(pathname, next, etag);
      return next;
    } catch (e) {
      const conflict = e instanceof BlobPreconditionFailedError || (!etag && /exist/i.test(e.message || ''));
      if (!conflict) throw e;
      await new Promise(r => setTimeout(r, 40 + Math.random() * 120 * (attempt + 1)));
    }
  }
  throw new Error('Store is busy — please try again.');
}

/** Run async fn over items with limited parallelism. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const ix = i++;
      out[ix] = await fn(items[ix], ix);
    }
  }));
  return out;
}
