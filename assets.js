// Image / video storage, separate from the content record.
// POST (signed in): send a data URL, get back a short link.
// GET  (public):    serves the file itself, cached by the browser.
import { sql, ensureTables, checkToken, cors, readBody } from './_db.js';

export const config = { api: { bodyParser: { sizeLimit: '8mb' } } };

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await ensureTables();

    // ---------- serve a stored file ----------
    if (req.method === 'GET') {
      const id = String(req.query.id || '').trim();
      if (!id) {
        // no id: report how much is stored, useful for housekeeping
        if (!(await checkToken(req.headers['x-auth-token'])))
          return res.status(400).json({ error: 'Missing id' });
        const rows = await sql`SELECT id, mime, length(data) AS bytes, created_at FROM assets ORDER BY created_at DESC`;
        const total = rows.reduce((t, r) => t + Number(r.bytes || 0), 0);
        return res.status(200).json({ ok: true, count: rows.length, totalBytes: total, assets: rows });
      }
      const rows = await sql`SELECT mime, data FROM assets WHERE id = ${id}`;
      if (!rows.length) return res.status(404).json({ error: 'Not found' });

      const buf = Buffer.from(rows[0].data, 'base64');
      res.setHeader('Content-Type', rows[0].mime || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Content-Length', buf.length);
      return res.status(200).send(buf);
    }

    // ---------- store a new file ----------
    if (req.method === 'POST') {
      if (!(await checkToken(req.headers['x-auth-token'])))
        return res.status(401).json({ ok: false, error: 'Not signed in.' });

      const body = readBody(req);
      const dataUrl = String(body.dataUrl || '');
      const m = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
      if (!m) return res.status(400).json({ ok: false, error: 'Expected a base64 data URL.' });

      const mime = m[1], b64 = m[2];
      const bytes = Math.round(b64.length * 0.75);
      if (bytes > 6 * 1024 * 1024)
        return res.status(413).json({ ok: false, error: 'That file is larger than 6 MB.' });

      const id = newId();
      await sql`INSERT INTO assets (id, mime, data) VALUES (${id}, ${mime}, ${b64})`;
      return res.status(200).json({ ok: true, id, url: `/api/assets?id=${id}`, bytes });
    }

    // ---------- remove ----------
    if (req.method === 'DELETE') {
      if (!(await checkToken(req.headers['x-auth-token'])))
        return res.status(401).json({ ok: false, error: 'Not signed in.' });
      const id = String(req.query.id || '').trim();
      await sql`DELETE FROM assets WHERE id = ${id}`;
      return res.status(200).json({ ok: true, removed: id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.log('ASSET ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
