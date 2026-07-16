import { list, put, del } from '@vercel/blob';

const PREFIX = 'faaskids-history';

async function readHistory() {
  const { blobs } = await list({ prefix: PREFIX });
  if (!blobs.length) return { entries: [], blobs: [] };
  const newest = [...blobs].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0];
  const res = await fetch(newest.url);
  const entries = res.ok ? await res.json() : [];
  return { entries: Array.isArray(entries) ? entries : [], blobs };
}

async function writeHistory(entries, oldBlobs) {
  if (entries.length) {
    await put(`${PREFIX}-${Date.now()}.json`, JSON.stringify(entries), {
      access: 'public',
      contentType: 'application/json'
    });
  }
  await Promise.all(oldBlobs.map(b => del(b.url).catch(() => {})));
}

export default async function handler(req, res) {
  if (req.headers['x-pin'] !== (process.env.APP_PIN || '1995')) {
    return res.status(401).json({ error: 'wrong pin' });
  }
  if (!process.env.BLOB_STORE_ID) {
    return res.status(503).json({ error: 'storage not set up' });
  }

  try {
    if (req.method === 'GET') {
      const { entries } = await readHistory();
      return res.status(200).json(entries);
    }

    if (req.method === 'POST') {
      const entry = req.body;
      if (!entry || typeof entry.no !== 'string' || !entry.no) {
        return res.status(400).json({ error: 'bad entry' });
      }
      const { entries, blobs } = await readHistory();
      const merged = entries.filter(e => e.no !== entry.no);
      merged.unshift(entry);
      merged.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      if (merged.length > 500) merged.length = 500;
      await writeHistory(merged, blobs);
      return res.status(200).json({ ok: true, count: merged.length });
    }

    if (req.method === 'DELETE') {
      const no = req.query.no;
      const { entries, blobs } = await readHistory();
      const merged = no ? entries.filter(e => e.no !== no) : [];
      await writeHistory(merged, blobs);
      return res.status(200).json({ ok: true, count: merged.length });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
