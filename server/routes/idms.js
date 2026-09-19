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
import { sql, ensureTables, checkToken, checkRole, cors, readBody, tokenUser } from '../_db.js';

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
        /* offset is additive: every existing caller omits it (defaults to 0,
           identical to before), and Backup & Restore uses it to page through
           the whole table when there are more than 2000 of one kind — a
           single request's cap is right for a screen and wrong for an export
           that must carry everything. */
        const offset = Math.max(0, parseInt(q.offset, 10) || 0);
        let rows;
        if (kind && partId) {
          rows = await sql`SELECT * FROM idms_docs WHERE kind = ${kind} AND part_id = ${partId}
                           ORDER BY updated_at DESC LIMIT ${limit} OFFSET ${offset}`;
        } else if (kind) {
          rows = await sql`SELECT * FROM idms_docs WHERE kind = ${kind}
                           ORDER BY updated_at DESC LIMIT ${limit} OFFSET ${offset}`;
        } else if (partId) {
          // the digital thread: everything ever recorded against one part
          rows = await sql`SELECT * FROM idms_docs WHERE part_id = ${partId}
                           ORDER BY updated_at DESC LIMIT ${limit} OFFSET ${offset}`;
        } else {
          rows = await sql`SELECT * FROM idms_docs ORDER BY updated_at DESC LIMIT ${limit} OFFSET ${offset}`;
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
        /* Same additive limit/offset as docs above — every existing caller
           gets exactly the old 1000-row behaviour by omitting both. */
        const limit = Math.min(2000, Math.max(1, parseInt(q.limit, 10) || 1000));
        const offset = Math.max(0, parseInt(q.offset, 10) || 0);
        const rows = life
          ? await sql`SELECT * FROM idms_parts WHERE lifecycle = ${life}
                     ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
          : await sql`SELECT * FROM idms_parts ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
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
      if (body.set !== undefined) {
        /* Used only by Settings/Data Restore, to put a counter back to its
           exact recorded value rather than nudging it — nextSerial() only
           moves a counter forward, which cannot put one back down, and
           restoring documents numbered up to, say, -0042 must leave the
           counter AT 42, not wherever a relative bump happened to land it,
           or the very next document issued after a restore could reuse a
           number that is already on a restored record. Restricted to the
           same roles that may run a flush or a restore — a counter is not
           something an ordinary save should ever be able to set outright. */
        if (!(await checkRole(token, ['developer', 'admin'])))
          return res.status(403).json({ ok: false, error: 'Only an administrator may set a counter directly.' });
        const value = Math.max(0, parseInt(body.set, 10) || 0);
        await sql`INSERT INTO idms_counters (name, value) VALUES (${name}, ${value})
                  ON CONFLICT (name) DO UPDATE SET value = ${value}, updated_at = now()`;
        return res.status(200).json({ ok: true, name, value });
      }
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

    /* ---------------- flush: start over, deliberately hard to trigger by
       accident — a senior role, and the exact phrase the screen made the
       person type, checked again here rather than trusted from the client. */
    if (what === 'flush' && req.method === 'POST') {
      if (!(await checkRole(token, ['developer', 'admin'])))
        return res.status(403).json({ ok: false, error: 'Only an administrator may do this.' });
      const scope = String(body.scope || '');
      const confirm = String(body.confirm || '').trim();

      /* One literal DELETE per table, the same tagged-template `sql` used by
         every other query in this file — no `sql.query(...)`, which is not
         a method this driver actually exposes (interpolating a table name
         into a tagged template isn't possible either, since the template
         tag binds interpolated values as query parameters, not identifiers,
         so each table needs its own literal statement rather than a loop
         building the SQL text itself). */
      async function flushTable(t) {
        switch (t) {
          case 'idms_docs': return sql`DELETE FROM idms_docs`;
          case 'idms_parts': return sql`DELETE FROM idms_parts`;
          case 'idms_counters': return sql`DELETE FROM idms_counters`;
          case 'rfqs': return sql`DELETE FROM rfqs`;
          case 'hr_employees': return sql`DELETE FROM hr_employees`;
          case 'hr_attendance': return sql`DELETE FROM hr_attendance`;
          case 'hr_leave': return sql`DELETE FROM hr_leave`;
          case 'hr_training': return sql`DELETE FROM hr_training`;
          case 'hr_items': return sql`DELETE FROM hr_items`;
          case 'hr_payruns': return sql`DELETE FROM hr_payruns`;
          case 'hr_audit': return sql`DELETE FROM hr_audit`;
          case 'hr_punches': return sql`DELETE FROM hr_punches`;
          case 'ppc_orders': return sql`DELETE FROM ppc_orders`;
          /* NOT a plain wipe. The assets table holds two different things:
             attachments belonging to records (part drawings, PO documents) and
             the company's branding (logo, hero banner and video, every
             capability/gallery/founder/certificate image on the website).
             site_content stores those as REFERENCES — "/api/assets?id=…" — and
             site_content is deliberately not flushed by this scope, so wiping
             the table whole left the website and the admin editor pointing at
             files that no longer existed: every image on the public site broke,
             and the screen that would let you re-upload them showed broken
             thumbnails too. Flush Data's own hint promises in bold that it
             "does not touch your company profile, branding, users, keys or
             devices", and this is what made that untrue.

             Anything the website content still refers to is therefore kept.
             Expressed as one literal statement on purpose: no dynamic SQL, no
             array parameters, nothing driver-specific — this file has already
             cost one release to a driver method that turned out not to exist.
             COALESCE matters: with no site_content row the subquery is NULL,
             position(... in NULL) is NULL, and without it NOTHING would be
             deleted. Erring toward keeping an asset is the safe direction — a
             stray orphan row costs bytes, a missing logo costs the website. */
          case 'assets': return sql`DELETE FROM assets WHERE position(id in
            COALESCE((SELECT data::text FROM site_content WHERE id = 1), '')) = 0`;
          case 'site_content': return sql`DELETE FROM site_content`;
          case 'idms_settings': return sql`DELETE FROM idms_settings`;
          case 'secrets': return sql`DELETE FROM secrets`;
          case 'login_codes': return sql`DELETE FROM login_codes`;
          case 'hr_devices': return sql`DELETE FROM hr_devices`;
          default: throw new Error('Unknown table: ' + t);
        }
      }

      if (scope === 'data') {
        if (confirm !== 'FLUSH ALL DATA')
          return res.status(400).json({ ok: false, error: 'Type the confirmation phrase exactly.' });
        // records, and whatever is attached to them — not users, not company
        // profile/branding, not settings, not registered devices
        for (const t of ['idms_docs', 'idms_parts', 'idms_counters', 'rfqs',
          'hr_employees', 'hr_attendance', 'hr_leave', 'hr_training', 'hr_items',
          'hr_payruns', 'hr_audit', 'hr_punches', 'ppc_orders', 'assets']) {
          await flushTable(t);
        }
        // idms_audit last, and only after everything else is gone, so the one
        // thing left on record is the flush itself — never a silent wipe
        await sql`DELETE FROM idms_audit`;
        await audit(who, 'system', 'flush-data', 'flush', null, null,
          body.reason || 'Flushed all data and records');
        return res.status(200).json({ ok: true, flushed: 'data' });
      }

      if (scope === 'settings') {
        if (confirm !== 'FLUSH ALL SETTINGS')
          return res.status(400).json({ ok: false, error: 'Type the confirmation phrase exactly.' });
        // whatever makes this deployment look like THIS company — branding,
        // provider keys, registered devices — not users, and not a single
        // record of data; a fresh customer's data still needs Flush Data too
        for (const t of ['site_content', 'idms_settings', 'secrets', 'login_codes', 'hr_devices']) {
          await flushTable(t);
        }
        await audit(who, 'system', 'flush-settings', 'flush', null, null,
          body.reason || 'Flushed all settings and admin data for a fresh deploy');
        return res.status(200).json({ ok: true, flushed: 'settings' });
      }

      return res.status(400).json({ ok: false, error: 'Unknown scope — expected "data" or "settings".' });
    }

    return res.status(400).json({ ok: false, error: 'Unknown request: ' + what });
  } catch (e) {
    console.log('idms error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
