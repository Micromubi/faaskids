// Local preview without Vercel: `npm run dev` → http://localhost:3000
// Stores everything in ./.localstore instead of Vercel Blob.
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.FAASKIDS_LOCAL_STORE ||= path.join(root, '.localstore');
const PORT = Number(process.env.PORT || 3000);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) {
      const file = path.join(root, url.pathname + '.js');
      const { default: handler } = await import(pathToFileURL(file).href);
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks);
      const ct = req.headers['content-type'] || '';
      req.query = Object.fromEntries(url.searchParams);
      req.body = ct.includes('json') ? (raw.length ? JSON.parse(raw) : {}) : raw;
      res.status = c => { res.statusCode = c; return res; };
      res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
      res.send = b => { res.end(b); return res; };
      return await handler(req, res);
    }
    let p = path.join(root, decodeURIComponent(url.pathname));
    if (!p.startsWith(root)) throw new Error('bad path');
    if ((await fs.stat(p).catch(() => null))?.isDirectory()) p = path.join(p, 'index.html');
    const buf = await fs.readFile(p);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  } catch (e) {
    if (!res.headersSent) res.writeHead(e.code === 'ENOENT' ? 404 : 500);
    res.end(String(e.message));
  }
}).listen(PORT, () => console.log(`FaasKids dev server → http://localhost:${PORT}`));
