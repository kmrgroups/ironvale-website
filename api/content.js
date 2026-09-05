// Site content: anyone can read, only signed-in staff can write.
import { sql, ensureTables, checkToken, cors, readBody, tokenUser } from './_db.js';

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } };

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await ensureTables();

    if (req.method === 'GET') {
      const rows = await sql`SELECT data, updated_at FROM site_content WHERE id = 1`;
      return res.status(200).json({
        ok: true,
        data: rows.length ? rows[0].data : null,
        updatedAt: rows.length ? rows[0].updated_at : null
      });
    }

    if (req.method === 'POST') {
      const token = req.headers['x-auth-token'];
      if (!(await checkToken(token))) return res.status(401).json({ ok: false, error: 'Not signed in.' });

      const body = readBody(req);
      if (!body.data) return res.status(400).json({ ok: false, error: 'No data supplied.' });

      const previous = (await sql`SELECT data FROM site_content WHERE id = 1`)[0]?.data || {};
      await sql`
        INSERT INTO site_content (id, data, updated_at) VALUES (1, ${JSON.stringify(body.data)}::jsonb, now())
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
      `;
      const u = await tokenUser(token);
      await sql`INSERT INTO idms_audit (who, kind, ref, action, before_val, after_val, reason)
        VALUES (${u?.username || 'unknown'}, 'website_content', 'site_content', 'update',
          ${JSON.stringify(previous)}::jsonb, ${JSON.stringify(body.data)}::jsonb, ${String(body.reason||'')})`;
      return res.status(200).json({ ok: true, savedAt: new Date().toISOString() });
    }

    return res.status(405).json({ error: 'Use GET or POST' });
  } catch (e) {
    console.log('CONTENT ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
