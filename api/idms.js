// IDMS — the manufacturing system that runs alongside the website.
//
// Everything the Key Process screens used to keep in browser localStorage lives
// here instead, so the data is shared between machines, survives a cleared
// cache, and is not capped at the browser's 5MB. Nothing is company-specific:
// document prefixes, letterhead and logo come from the site profile, so the
// same code serves any customer.
//
// Deletions and status changes are written to idms_audit and never undone
// silently — a quality system that cannot say who changed a control plan is
// not worth having.
import { sql, ensureTables, checkToken, checkRole, cors, readBody, tokenUser } from './_db.js';

export const config = { api: { bodyParser: { sizeLimit: '6mb' } } };

async function audit(who, kind, ref, action, before, after, reason) {
  try {
    await sql`INSERT INTO idms_audit (who, kind, ref, action, before_val, after_val, reason)
      VALUES (${who || 'unknown'}, ${kind || ''}, ${ref || ''}, ${action || ''},
              ${JSON.stringify(before || null)}::jsonb,
              ${JSON.stringify(after || null)}::jsonb, ${reason || ''})`;
  } catch (e) { console.log('idms audit write failed:', e.message); }
}

const id = p => p + '-' + Date.now().toString(36).toUpperCase() +
  Math.random().toString(36).slice(2, 5).toUpperCase();

/* A serial that two people cannot take at the same moment. The increment
   happens inside the database, and the row is created on first use. */
async function nextSerial(name, by = 1) {
  const rows = await sql`
    INSERT INTO idms_counters (name, value) VALUES (${name}, ${by})
    ON CONFLICT (name) DO UPDATE
      SET value = idms_counters.value + ${by}, updated_at = now()
    RETURNING value`;
  return Number(rows[0].value);
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await ensureTables();
    const q = req.query || {};
    const body = req.method === 'GET' ? {} : readBody(req);
    const what = String(q.what || body.what || 'docs');
    const token = req.headers['x-auth-token'] || body.token || q.token || '';

    // IDMS holds live manufacturing records. Nothing here is public.
    const user = await tokenUser(token);
    if (!user) return res.status(401).json({ ok: false, error: 'Sign in to use the IDMS.' });
    const who = user.username;

    /* ---------------- documents: every module's data ---------------- */
    if (what === 'docs') {
      if (req.method === 'GET') {
        const kind = String(q.kind || '');
        const partId = String(q.partId || '');
        const limit = Math.min(2000, Math.max(1, parseInt(q.limit, 10) || 500));
        let rows;
        if (kind && partId) {
          rows = await sql`SELECT * FROM idms_docs WHERE kind = ${kind} AND part_id = ${partId}
                           ORDER BY updated_at DESC LIMIT ${limit}`;
        } else if (kind) {
          rows = await sql`SELECT * FROM idms_docs WHERE kind = ${kind}
                           ORDER BY updated_at DESC LIMIT ${limit}`;
        } else if (partId) {
          // the digital thread: everything ever recorded against one part
          rows = await sql`SELECT * FROM idms_docs WHERE part_id = ${partId}
                           ORDER BY updated_at DESC LIMIT ${limit}`;
        } else {
          rows = await sql`SELECT * FROM idms_docs ORDER BY updated_at DESC LIMIT ${limit}`;
        }
        return res.status(200).json({ ok: true, docs: rows });
      }

      if (req.method === 'POST') {
        const d = body.doc || {};
        if (!d.kind) return res.status(400).json({ ok: false, error: 'A document needs a kind.' });
        const docId = d.docId || id(String(d.kind).toUpperCase().slice(0, 6));
        const prev = (await sql`SELECT * FROM idms_docs WHERE doc_id = ${docId}`)[0] || null;
        await sql`
          INSERT INTO idms_docs (doc_id, kind, part_id, doc_no, rev, status, data, updated_by)
          VALUES (${docId}, ${d.kind}, ${d.partId || ''}, ${d.docNo || ''},
                  ${String(d.rev || '0')}, ${d.status || 'Draft'},
                  ${JSON.stringify(d.data || {})}::jsonb, ${who})
          ON CONFLICT (doc_id) DO UPDATE SET
            part_id = EXCLUDED.part_id, doc_no = EXCLUDED.doc_no, rev = EXCLUDED.rev,
            status = EXCLUDED.status, data = EXCLUDED.data,
            updated_at = now(), updated_by = EXCLUDED.updated_by`;
        await audit(who, d.kind, docId, prev ? 'update' : 'create',
          prev && prev.data, d.data, body.reason || '');
        return res.status(200).json({ ok: true, docId });
      }

      if (req.method === 'PATCH') {
        const docId = String(body.docId || '');
        if (!docId) return res.status(400).json({ ok: false, error: 'Which document?' });
        const prev = (await sql`SELECT * FROM idms_docs WHERE doc_id = ${docId}`)[0];
        if (!prev) return res.status(404).json({ ok: false, error: 'No such document.' });

        if (body.remove) {
          // deleting a quality record needs a stated reason and a senior role
          if (!(await checkRole(token, ['developer', 'admin'])))
            return res.status(403).json({ ok: false, error: 'Only an administrator may delete a record.' });
          if (!String(body.reason || '').trim())
            return res.status(400).json({ ok: false, error: 'State a reason for the deletion.' });
          await sql`DELETE FROM idms_docs WHERE doc_id = ${docId}`;
          await audit(who, prev.kind, docId, 'delete', prev.data, null, body.reason);
          return res.status(200).json({ ok: true, removed: true });
        }

        const nextData = body.patch !== undefined ? body.patch : prev.data;
        const nextStatus = body.status || prev.status;
        const nextRev = body.rev !== undefined ? String(body.rev) : prev.rev;
        await sql`UPDATE idms_docs SET data = ${JSON.stringify(nextData)}::jsonb,
                  status = ${nextStatus}, rev = ${nextRev},
                  updated_at = now(), updated_by = ${who}
                  WHERE doc_id = ${docId}`;
        await audit(who, prev.kind, docId,
          body.status && body.status !== prev.status ? 'status:' + body.status : 'update',
          prev.data, nextData, body.reason || '');
        return res.status(200).json({ ok: true });
      }
    }

    /* ---------------- parts: the spine of the whole system ---------------- */
    if (what === 'parts') {
      if (req.method === 'GET') {
        const life = String(q.lifecycle || '');
        const rows = life
          ? await sql`SELECT * FROM idms_parts WHERE lifecycle = ${life} ORDER BY created_at DESC LIMIT 1000`
          : await sql`SELECT * FROM idms_parts ORDER BY created_at DESC LIMIT 1000`;
        return res.status(200).json({ ok: true, parts: rows });
      }
      if (req.method === 'POST') {
        const p = body.part || {};
        if (!p.partNo && !p.partName)
          return res.status(400).json({ ok: false, error: 'A part needs a number or a name.' });
        const partId = p.partId || id('PART');
        const prev = (await sql`SELECT * FROM idms_parts WHERE part_id = ${partId}`)[0] || null;
        await sql`
          INSERT INTO idms_parts (part_id, customer, part_no, part_name, lifecycle, quote_ref, data)
          VALUES (${partId}, ${p.customer || ''}, ${p.partNo || ''}, ${p.partName || ''},
                  ${p.lifecycle || 'New'}, ${p.quoteRef || ''}, ${JSON.stringify(p.data || {})}::jsonb)
          ON CONFLICT (part_id) DO UPDATE SET
            customer = EXCLUDED.customer, part_no = EXCLUDED.part_no,
            part_name = EXCLUDED.part_name, lifecycle = EXCLUDED.lifecycle,
            quote_ref = EXCLUDED.quote_ref, data = EXCLUDED.data, updated_at = now()`;
        await audit(who, 'part', partId, prev ? 'update' : 'create', prev, p, body.reason || '');
        return res.status(200).json({ ok: true, partId });
      }
      if (req.method === 'PATCH') {
        const partId = String(body.partId || '');
        const prev = (await sql`SELECT * FROM idms_parts WHERE part_id = ${partId}`)[0];
        if (!prev) return res.status(404).json({ ok: false, error: 'No such part.' });

        if (body.remove) {
          // a part carries an APQP history, so deleting one is an administrator's
          // decision with a reason, and everything hanging off it goes too --
          // otherwise the orphans stay and quietly count towards nothing
          if (!(await checkRole(token, ['developer', 'admin'])))
            return res.status(403).json({ ok: false, error: 'Only an administrator may delete a part.' });
          if (!String(body.reason || '').trim())
            return res.status(400).json({ ok: false, error: 'State a reason for the deletion.' });
          const kids = await sql`SELECT doc_id, kind FROM idms_docs WHERE part_id = ${partId}`;
          await sql`DELETE FROM idms_docs WHERE part_id = ${partId}`;
          await sql`DELETE FROM idms_parts WHERE part_id = ${partId}`;
          await audit(who, 'part', partId, 'delete', prev, null,
            body.reason + ' (with ' + kids.length + ' related record(s))');
          return res.status(200).json({ ok: true, removed: true, alsoRemoved: kids.length });
        }

        const life = body.lifecycle || prev.lifecycle;
        await sql`UPDATE idms_parts SET lifecycle = ${life},
                  data = ${JSON.stringify(body.patch !== undefined ? body.patch : prev.data)}::jsonb,
                  updated_at = now() WHERE part_id = ${partId}`;
        await audit(who, 'part', partId, 'lifecycle:' + life, prev, { lifecycle: life },
          body.reason || '');
        return res.status(200).json({ ok: true });
      }
    }

    /* ---------------- serial numbers ---------------- */
    if (what === 'serial' && req.method === 'POST') {
      const name = String(body.name || '').trim();
      if (!name) return res.status(400).json({ ok: false, error: 'Which counter?' });
      const value = await nextSerial(name, Math.max(1, parseInt(body.by, 10) || 1));
      return res.status(200).json({ ok: true, name, value });
    }
    if (what === 'serial' && req.method === 'GET') {
      const rows = await sql`SELECT name, value FROM idms_counters ORDER BY name`;
      return res.status(200).json({ ok: true, counters: rows });
    }

    /* ---------------- settings: print, home screen, prefixes ---------------- */
    if (what === 'settings') {
      if (req.method === 'GET') {
        const rows = await sql`SELECT key, data FROM idms_settings`;
        const out = {};
        rows.forEach(r => { out[r.key] = r.data; });
        return res.status(200).json({ ok: true, settings: out });
      }
      if (req.method === 'POST') {
        const key = String(body.key || '').trim();
        if (!key) return res.status(400).json({ ok: false, error: 'Which setting?' });
        await sql`INSERT INTO idms_settings (key, data) VALUES (${key}, ${JSON.stringify(body.data || {})}::jsonb)
                  ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
        return res.status(200).json({ ok: true });
      }
    }

    /* ---------------- audit trail ---------------- */
    if (what === 'audit' && req.method === 'GET') {
      const ref = String(q.ref || '');
      const rows = ref
        ? await sql`SELECT * FROM idms_audit WHERE ref = ${ref} ORDER BY at DESC LIMIT 500`
        : await sql`SELECT * FROM idms_audit ORDER BY at DESC LIMIT 500`;
      return res.status(200).json({ ok: true, audit: rows });
    }

    return res.status(400).json({ ok: false, error: 'Unknown request: ' + what });
  } catch (e) {
    console.log('idms error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
