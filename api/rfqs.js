// RFQs: anyone can submit or look up their own by reference.
// Only signed-in staff can list all or update.
import { sql, ensureTables, checkToken, cors, readBody } from './_db.js';
import { sendNotification } from './notify.js';

export const config = { api: { bodyParser: { sizeLimit: '12mb' } } };

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await ensureTables();
    const token = req.headers['x-auth-token'];

    // ---- GET ----
    // ?ref=RFQ-XXXX  → public: returns only status info for that one RFQ
    // no ref         → staff only: returns everything
    if (req.method === 'GET') {
      const ref = (req.query.ref || '').trim().toUpperCase();
      if (ref) {
        const rows = await sql`SELECT data FROM rfqs WHERE ref = ${ref}`;
        if (!rows.length) return res.status(404).json({ ok: false, error: 'Not found' });
        const d = rows[0].data;
        return res.status(200).json({
          ok: true,
          rfq: { ref: d.ref, status: d.status, date: d.date, approvedAt: d.approvedAt || null }
        });
      }
      if (!(await checkToken(token))) return res.status(401).json({ ok: false, error: 'Not signed in.' });
      const rows = await sql`SELECT data FROM rfqs ORDER BY created_at DESC LIMIT 500`;
      return res.status(200).json({ ok: true, rfqs: rows.map(r => r.data) });
    }

    // ---- POST : create a new RFQ (public) ----
    if (req.method === 'POST') {
      const body = readBody(req);
      const r = body.rfq || {};
      if (!r.ref || !r.name || !r.email)
        return res.status(400).json({ ok: false, error: 'Name, email and reference are required.' });

      await sql`INSERT INTO rfqs (ref, data) VALUES (${r.ref}, ${JSON.stringify(r)}::jsonb)
                ON CONFLICT (ref) DO NOTHING`;

      // alert the owner, and acknowledge to the customer
      // neither is allowed to block the submission itself
      let notifyResult = [];
      try {
        notifyResult = await sendNotification('rfq_received', {
          ref: r.ref, name: r.name, company: r.company, email: r.email,
          phone: r.phone, message: r.message, file: r.fileName,
          pipelineUrl: body.pipelineUrl || ''
        }, body.notifyEmail, body.notifyWhatsapp);
      } catch (e) { notifyResult = ['notify error: ' + e.message]; }

      if (body.acknowledge !== false) {
        try {
          const ack = await sendNotification('rfq_acknowledge', {
            ref: r.ref, name: r.name, email: r.email, phone: r.phone,
            message: r.message, company: body.companyName || '',
            trackUrl: body.trackUrl || ''
          });
          notifyResult = notifyResult.concat(ack.map(x => 'ack: ' + x));
        } catch (e) { notifyResult.push('ack error: ' + e.message); }
      }

      return res.status(200).json({ ok: true, ref: r.ref, notify: notifyResult });
    }

    // ---- PATCH : update status / quote (staff only) ----
    if (req.method === 'PATCH') {
      if (!(await checkToken(token))) return res.status(401).json({ ok: false, error: 'Not signed in.' });
      const body = readBody(req);
      const ref = String(body.ref || '').toUpperCase();

      if (body.remove) {
        await sql`DELETE FROM rfqs WHERE ref = ${ref}`;
        return res.status(200).json({ ok: true, removed: ref });
      }
      if (body.removeAll) {
        await sql`DELETE FROM rfqs`;
        return res.status(200).json({ ok: true, removedAll: true });
      }

      const rows = await sql`SELECT data FROM rfqs WHERE ref = ${ref}`;
      if (!rows.length) return res.status(404).json({ ok: false, error: 'Not found' });

      const merged = Object.assign({}, rows[0].data, body.patch || {});
      await sql`UPDATE rfqs SET data = ${JSON.stringify(merged)}::jsonb WHERE ref = ${ref}`;

      let notifyResult = [];
      if (body.notifyCustomer) {
        try {
          notifyResult = await sendNotification('quote_approved', {
            ref: merged.ref, quote: merged.quote,
            customer: { name: merged.name, email: merged.email, phone: merged.phone }
          }, body.notifyEmail, body.notifyWhatsapp);
        } catch (e) { notifyResult = ['notify error: ' + e.message]; }
      }

      return res.status(200).json({ ok: true, rfq: merged, notify: notifyResult });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.log('RFQ ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
