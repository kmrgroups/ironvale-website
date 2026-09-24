// RFQs: anyone can submit or look up their own by reference.
// Only signed-in staff can list all or update.
import { sql, ensureTables, checkToken, cors, readBody } from '../server/_db.js';
import { sendNotification } from './notify.js';

export const config = { api: { bodyParser: { sizeLimit: '12mb' } } };

const genId = p => p + '-' + Date.now().toString(36).toUpperCase() +
  Math.random().toString(36).slice(2, 5).toUpperCase();

/* ---- spam screening for the public RFQ form ----
   Decided here, server-side, because anything checked only in the page's own
   JS is a check a script posting straight to this endpoint never runs at
   all. Three independent, cheap signals, any one of which is enough on its
   own:
     - a honeypot field a person never sees but a form-filling bot fills
     - the form answered in less time than a person can type a name and
       email in, however it got filled
     - too many submissions from the same address in a short window
   None of this is shown to the customer or written into the RFQ record
   itself; a caught submission is simply never saved. */
async function isSpamRfq(req, body) {
  const hp = String(body.hp || '').trim();
  if (hp) return true;

  const ms = Number(body.formMs);
  if (Number.isFinite(ms) && ms >= 0 && ms < 600) return true;

  try {
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const recent = await sql`SELECT count(*)::int AS n FROM idms_docs
      WHERE kind = 'rfq_ip_log' AND data->>'ip' = ${ip} AND created_at > now() - interval '30 minutes'`;
    await sql`INSERT INTO idms_docs (doc_id, kind, status, data, updated_by)
      VALUES (${genId('IPLOG')}, 'rfq_ip_log', 'Logged',
        ${JSON.stringify({ ip, at: new Date().toISOString() })}::jsonb, 'system')`;
    // Five in thirty minutes is generous for a genuine customer (one
    // enquiry, maybe a retry) and quick for a bot to burn through.
    if (recent[0] && recent[0].n >= 5) return true;
  } catch (e) {
    // If the rate-limit check itself fails, that must never block a real
    // enquiry — the honeypot and timing checks above are the safety net.
    console.log('rfq rate-limit check failed:', e.message);
  }
  return false;
}

/* Puts a freshly-received RFQ on the bell of everyone who can act on it, and
   opens one chat thread against it so the conversation about that enquiry has
   a single place to live from the first minute — this is IN ADDITION to the
   existing email/WhatsApp alert above, which goes to one owner address and
   cannot be replied to inside the IDMS. Best-effort: a failure here must
   never stop the RFQ itself from being recorded. */
async function notifyStaffOfNewRfq(r) {
  try {
    const staff = await sql`SELECT username FROM users WHERE active = true AND role IN ('admin','developer')`;
    const names = staff.map(s => s.username);
    if (!names.length) return;
    const title = 'New RFQ ' + r.ref + (r.name ? ' — ' + r.name : '');
    const bodyText = String(r.message || '').slice(0, 140);
    for (const toUser of names) {
      await sql`INSERT INTO idms_docs (doc_id, kind, status, data, updated_by)
        VALUES (${genId('NOTIF')}, 'notification', 'Unread',
          ${JSON.stringify({ toUser, type: 'rfq', title, body: bodyText,
            link: 'rfq:' + r.ref, fromUser: 'system', createdAt: new Date().toISOString() })}::jsonb,
          'system')`;
    }
    const threadId = genId('CHAT');
    await sql`INSERT INTO idms_docs (doc_id, kind, status, data, updated_by)
      VALUES (${threadId}, 'chat_thread', 'Open',
        ${JSON.stringify({ subject: 'RFQ ' + r.ref + (r.name ? ' — ' + r.name : ''),
          participants: names, refType: 'rfq', refId: r.ref,
          createdBy: 'system', createdAt: new Date().toISOString() })}::jsonb, 'system')`;
  } catch (e) { console.log('rfq staff-notify failed:', e.message); }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await ensureTables();
    const token = req.headers['x-auth-token'];

    // ---- GET ----
    // ?ref=RFQ-XXXX               → public: returns only status info for that one RFQ
    // ?ref=RFQ-XXXX&qtoken=...    → public: also returns the quotation itself,
    //                                but only when qtoken matches the random
    //                                token that quote was sent out under —
    //                                see rfqSendQuote() in idms.html. The
    //                                reference alone must never be enough:
    //                                references are often close to sequential,
    //                                and this is the one place a bare GET can
    //                                return somebody else's price.
    // no ref                      → staff only: returns everything
    if (req.method === 'GET') {
      const ref = (req.query.ref || '').trim().toUpperCase();
      if (ref) {
        const rows = await sql`SELECT data FROM rfqs WHERE ref = ${ref}`;
        if (!rows.length) return res.status(404).json({ ok: false, error: 'Not found' });
        const d = rows[0].data;
        const out = { ref: d.ref, status: d.status, date: d.date, approvedAt: d.approvedAt || null };
        const qtoken = String(req.query.qtoken || '').trim();
        if (qtoken && d.quoteDoc && d.quoteDoc.publicToken && qtoken === d.quoteDoc.publicToken) {
          out.name = d.name || ''; out.email = d.email || ''; out.fileUrl = d.fileUrl || '';
          out.quoteDoc = d.quoteDoc;
        }
        return res.status(200).json({ ok: true, rfq: out });
      }
      if (!(await checkToken(token))) return res.status(401).json({ ok: false, error: 'Not signed in.' });
      const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit, 10) || 500));
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const rows = await sql`SELECT data FROM rfqs ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
      return res.status(200).json({ ok: true, rfqs: rows.map(r => r.data) });
    }

    // ---- POST : create a new RFQ (public), or restore one from a backup (staff only) ----
    if (req.method === 'POST') {
      const body = readBody(req);
      const r = body.rfq || {};
      if (!r.ref || !r.name || !r.email)
        return res.status(400).json({ ok: false, error: 'Name, email and reference are required.' });

      // Restoring a historical enquiry from Backup & Restore must never
      // resend a real notification to the customer or the owner — that
      // would spam both with an email/WhatsApp message about an enquiry
      // that may be years old. Staff-only, writes the record exactly as
      // backed up, and returns immediately without calling sendNotification.
      if (body.restore === true) {
        if (!(await checkToken(token))) return res.status(401).json({ ok: false, error: 'Not signed in.' });
        await sql`INSERT INTO rfqs (ref, data) VALUES (${r.ref}, ${JSON.stringify(r)}::jsonb)
                  ON CONFLICT (ref) DO UPDATE SET data = ${JSON.stringify(r)}::jsonb`;
        return res.status(200).json({ ok: true, ref: r.ref, restored: true });
      }

      // ---- spam screening, public submissions only ----
      // Decided here, not in the browser: a script posting straight to this
      // endpoint skips whatever the page's JS does, so the page's checks are
      // only ever a first pass, never the actual gate.
      if (!(await checkToken(token))) {
        const blocked = await isSpamRfq(req, body);
        if (blocked) {
          // A real "received" reply, not a 4xx: telling a bot it was refused
          // just teaches it to retry with different values. The ref is
          // returned but nothing is written to the rfqs table, so it leads
          // nowhere on Track your RFQ either.
          return res.status(200).json({ ok: true, ref: r.ref, blocked: true });
        }
      }

      await sql`INSERT INTO rfqs (ref, data) VALUES (${r.ref}, ${JSON.stringify(r)}::jsonb)
                ON CONFLICT (ref) DO NOTHING`;

      // bell + chat thread inside the IDMS. Awaited — a serverless function's
      // background work does not survive past the response — but wrapped in
      // its own try/catch above, so it can never fail the submission itself.
      await notifyStaffOfNewRfq(r);

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
