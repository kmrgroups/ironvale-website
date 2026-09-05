// Customer production orders (POs) for the Production Planning module.
// Staff-only end to end — unlike RFQs, nothing here is public-facing.
import { sql, ensureTables, checkToken, cors, readBody } from './_db.js';

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await ensureTables();
    const token = req.headers['x-auth-token'];
    if (!(await checkToken(token)))
      return res.status(401).json({ ok: false, error: 'Not signed in.' });

    if (req.method === 'GET') {
      const rows = await sql`SELECT data FROM ppc_orders ORDER BY created_at DESC LIMIT 500`;
      return res.status(200).json({ ok: true, orders: rows.map(r => r.data) });
    }

    if (req.method === 'POST') {
      const body = readBody(req);
      const o = body.order || {};
      if (!o.ref || !o.customer || !o.partId)
        return res.status(400).json({ ok: false, error: 'Customer, part and reference are required.' });

      await sql`INSERT INTO ppc_orders (ref, data) VALUES (${o.ref}, ${JSON.stringify(o)}::jsonb)
                ON CONFLICT (ref) DO NOTHING`;
      return res.status(200).json({ ok: true, ref: o.ref });
    }

    if (req.method === 'PATCH') {
      const body = readBody(req);
      const ref = String(body.ref || '');

      if (body.remove) {
        await sql`DELETE FROM ppc_orders WHERE ref = ${ref}`;
        return res.status(200).json({ ok: true, removed: ref });
      }

      const rows = await sql`SELECT data FROM ppc_orders WHERE ref = ${ref}`;
      if (!rows.length) return res.status(404).json({ ok: false, error: 'Not found' });

      const merged = Object.assign({}, rows[0].data, body.patch || {});
      await sql`UPDATE ppc_orders SET data = ${JSON.stringify(merged)}::jsonb WHERE ref = ${ref}`;
      return res.status(200).json({ ok: true, order: merged });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.log('ORDERS ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
