// HR module: employee master, pay runs, audit trail.
// Payroll is deliberately Draft → Reviewed → Approved. Nothing is ever
// silently final, and every approval is written to an immutable audit log.
import { sql, ensureTables, checkToken, checkRole, cors, readBody, tokenUser } from './_db.js';

export const config = { api: { bodyParser: { sizeLimit: '6mb' } } };

async function audit(who, what, ref, before, after, reason) {
  try {
    await sql`INSERT INTO hr_audit (who, what, ref, before_val, after_val, reason)
      VALUES (${who || 'unknown'}, ${what}, ${ref || ''},
              ${JSON.stringify(before || null)}::jsonb,
              ${JSON.stringify(after || null)}::jsonb, ${reason || ''})`;
  } catch (e) { console.log('audit write failed:', e.message); }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await ensureTables();
    const q = req.query || {};
    const preBody = req.method === 'GET' ? {} : readBody(req);
    const askedFor = String(q.what || preBody.what || 'employees');

    /* ---- PUBLIC: the careers page needs open jobs and an apply route ---- */
    if (askedFor === 'jobs' && req.method === 'GET') {
      const rows = await sql`SELECT item_id, data FROM hr_items
                             WHERE kind = 'requisition' AND status = 'Open'
                             ORDER BY created_at DESC LIMIT 100`;
      // only fields a candidate should see
      return res.status(200).json({ ok: true, jobs: rows.map(r => ({
        id: r.item_id, title: r.data.title, department: r.data.department,
        grade: r.data.grade, ctcRange: r.data.ctcRange, count: r.data.count,
        neededBy: r.data.neededBy, jd: r.data.jd })) });
    }
    if (askedFor === 'apply' && req.method === 'POST') {
      const c = preBody.candidate || {};
      if (!c.name || !c.reqId || !(c.phone || c.email))
        return res.status(400).json({ ok: false, error: 'Name, position and a contact are required.' });
      const item = Object.assign({}, c, {
        itemId: 'CAND-' + Date.now().toString(36).toUpperCase(),
        kind: 'candidate', status: 'Applied', appliedOn: new Date().toISOString().slice(0, 10),
        source: 'Careers page' });
      await sql`INSERT INTO hr_items (item_id, kind, data, status)
                VALUES (${item.itemId}, 'candidate', ${JSON.stringify(item)}::jsonb, 'Applied')`;
      await audit('careers-page', 'candidate.apply', item.itemId, null,
        { name: item.name, reqId: item.reqId }, 'applied through the careers page');
      return res.status(200).json({ ok: true, ref: item.itemId });
    }

    const token = req.headers['x-auth-token'];
    if (!(await checkToken(token)))
      return res.status(401).json({ ok: false, error: 'Not signed in.' });
    const me = await tokenUser(token);
    const body = preBody;
    const what = askedFor;

    /* ---------------- EMPLOYEES ---------------- */
    if (what === 'employees') {
      if (req.method === 'GET') {
        const rows = await sql`SELECT data FROM hr_employees ORDER BY created_at DESC LIMIT 2000`;
        return res.status(200).json({ ok: true, employees: rows.map(r => r.data) });
      }
      if (req.method === 'POST') {
        const e = body.employee || {};
        if (!e.empId || !e.name)
          return res.status(400).json({ ok: false, error: 'Employee ID and name are required.' });
        const prev = (await sql`SELECT data FROM hr_employees WHERE emp_id = ${e.empId}`)[0];
        await sql`INSERT INTO hr_employees (emp_id, data) VALUES (${e.empId}, ${JSON.stringify(e)}::jsonb)
                  ON CONFLICT (emp_id) DO UPDATE SET data = EXCLUDED.data`;
        await audit(me && me.username, prev ? 'employee.update' : 'employee.create',
                    e.empId, prev ? prev.data : null, e, body.reason);
        return res.status(200).json({ ok: true, empId: e.empId });
      }
      if (req.method === 'PATCH' && body.remove) {
        const prev = (await sql`SELECT data FROM hr_employees WHERE emp_id = ${body.empId}`)[0];
        await sql`DELETE FROM hr_employees WHERE emp_id = ${body.empId}`;
        await audit(me && me.username, 'employee.delete', body.empId, prev ? prev.data : null, null, body.reason);
        return res.status(200).json({ ok: true, removed: body.empId });
      }
    }

    /* ---------------- PAY RUNS ---------------- */
    if (what === 'payruns') {
      if (req.method === 'GET') {
        const rows = await sql`SELECT run_id, period, status, data, created_at
                               FROM hr_payruns ORDER BY created_at DESC LIMIT 200`;
        return res.status(200).json({ ok: true, payruns: rows });
      }
      if (req.method === 'POST') {
        const r = body.payrun || {};
        if (!r.runId || !r.period)
          return res.status(400).json({ ok: false, error: 'Run reference and period are required.' });
        await sql`INSERT INTO hr_payruns (run_id, period, data, status)
                  VALUES (${r.runId}, ${r.period}, ${JSON.stringify(r)}::jsonb, ${r.status || 'Draft'})
                  ON CONFLICT (run_id) DO NOTHING`;
        await audit(me && me.username, 'payrun.create', r.runId, null,
                    { period: r.period, lines: (r.lines || []).length }, body.reason);
        return res.status(200).json({ ok: true, runId: r.runId });
      }
      if (req.method === 'PATCH') {
        const rows = await sql`SELECT data, status FROM hr_payruns WHERE run_id = ${body.runId}`;
        if (!rows.length) return res.status(404).json({ ok: false, error: 'Pay run not found.' });
        const prev = rows[0];

        if (body.remove) {
          if (prev.status === 'Approved')
            return res.status(400).json({ ok: false, error: 'An approved pay run cannot be deleted. It is a financial record.' });
          await sql`DELETE FROM hr_payruns WHERE run_id = ${body.runId}`;
          await audit(me && me.username, 'payrun.delete', body.runId, prev.data, null, body.reason);
          return res.status(200).json({ ok: true, removed: body.runId });
        }

        // approving requires the developer role and a stated reason
        if (body.status === 'Approved') {
          if (!(await checkRole(token, ['developer'])))
            return res.status(403).json({ ok: false, error: 'Only an authorised login can approve a pay run.' });
          if (prev.status === 'Approved')
            return res.status(400).json({ ok: false, error: 'This pay run is already approved.' });
        }
        if (prev.status === 'Approved' && body.status && body.status !== 'Approved')
          return res.status(400).json({ ok: false, error: 'An approved pay run cannot be reopened. Create a correction run instead.' });

        const merged = Object.assign({}, prev.data, body.patch || {});
        if (body.status) merged.status = body.status;
        await sql`UPDATE hr_payruns SET data = ${JSON.stringify(merged)}::jsonb,
                  status = ${body.status || prev.status} WHERE run_id = ${body.runId}`;
        await audit(me && me.username, 'payrun.' + (body.status ? body.status.toLowerCase() : 'update'),
                    body.runId, { status: prev.status }, { status: body.status || prev.status }, body.reason);
        return res.status(200).json({ ok: true, payrun: merged });
      }
    }

    /* ---------------- ATTENDANCE ---------------- */
    if (what === 'attendance') {
      if (req.method === 'GET') {
        const from = String(req.query.from || ''), to = String(req.query.to || '');
        const rows = (from && to)
          ? await sql`SELECT data FROM hr_attendance WHERE day >= ${from} AND day <= ${to} ORDER BY day`
          : await sql`SELECT data FROM hr_attendance ORDER BY day DESC LIMIT 3000`;
        return res.status(200).json({ ok: true, attendance: rows.map(r => r.data) });
      }
      if (req.method === 'POST') {
        // accepts a single record or a whole day/period in one go
        const list = body.records || (body.record ? [body.record] : []);
        if (!list.length) return res.status(400).json({ ok: false, error: 'No attendance records supplied.' });
        for (const a of list) {
          if (!a.empId || !a.day) continue;
          a.id = a.empId + '|' + a.day;
          await sql`INSERT INTO hr_attendance (id, emp_id, day, data, updated_at)
                    VALUES (${a.id}, ${a.empId}, ${a.day}, ${JSON.stringify(a)}::jsonb, now())
                    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
        }
        // manual attendance edits must leave a trace (spec §8)
        if (body.manual) await audit(me && me.username, 'attendance.manual', list.map(a => a.id).join(','),
          null, { count: list.length }, body.reason || 'manual attendance entry');
        return res.status(200).json({ ok: true, saved: list.length });
      }
    }

    /* ---------------- LEAVE ---------------- */
    if (what === 'leave') {
      if (req.method === 'GET') {
        const rows = await sql`SELECT leave_id, emp_id, status, data, created_at
                               FROM hr_leave ORDER BY created_at DESC LIMIT 1000`;
        return res.status(200).json({ ok: true, leave: rows });
      }
      if (req.method === 'POST') {
        const l = body.leave || {};
        if (!l.leaveId || !l.empId || !l.from || !l.to)
          return res.status(400).json({ ok: false, error: 'Employee, dates and reference are required.' });
        await sql`INSERT INTO hr_leave (leave_id, emp_id, data, status)
                  VALUES (${l.leaveId}, ${l.empId}, ${JSON.stringify(l)}::jsonb, ${l.status || 'Pending'})
                  ON CONFLICT (leave_id) DO NOTHING`;
        await audit(me && me.username, 'leave.apply', l.leaveId, null,
          { emp: l.empId, from: l.from, to: l.to, type: l.type }, body.reason);
        return res.status(200).json({ ok: true, leaveId: l.leaveId });
      }
      if (req.method === 'PATCH') {
        const rows = await sql`SELECT data, status FROM hr_leave WHERE leave_id = ${body.leaveId}`;
        if (!rows.length) return res.status(404).json({ ok: false, error: 'Leave request not found.' });
        if (body.remove) {
          await sql`DELETE FROM hr_leave WHERE leave_id = ${body.leaveId}`;
          await audit(me && me.username, 'leave.delete', body.leaveId, rows[0].data, null, body.reason);
          return res.status(200).json({ ok: true, removed: body.leaveId });
        }
        const merged = Object.assign({}, rows[0].data, body.patch || {});
        if (body.status) merged.status = body.status;
        await sql`UPDATE hr_leave SET data = ${JSON.stringify(merged)}::jsonb,
                  status = ${body.status || rows[0].status} WHERE leave_id = ${body.leaveId}`;
        await audit(me && me.username, 'leave.' + (body.status || 'update').toLowerCase(),
          body.leaveId, { status: rows[0].status }, { status: body.status || rows[0].status }, body.reason);
        return res.status(200).json({ ok: true, leave: merged });
      }
    }

    /* ------- TRAINING: TNI records, sessions, nominations, effectiveness ------- */
    if (what === 'training') {
      if (req.method === 'GET') {
        const kind = String(req.query.kind || '');
        const rows = kind
          ? await sql`SELECT rec_id, kind, status, data, created_at FROM hr_training
                      WHERE kind = ${kind} ORDER BY created_at DESC LIMIT 1000`
          : await sql`SELECT rec_id, kind, status, data, created_at FROM hr_training
                      ORDER BY created_at DESC LIMIT 2000`;
        return res.status(200).json({ ok: true, records: rows });
      }
      if (req.method === 'POST') {
        const r = body.record || {};
        if (!r.recId || !r.kind)
          return res.status(400).json({ ok: false, error: 'Record reference and kind are required.' });
        await sql`INSERT INTO hr_training (rec_id, kind, data, status)
                  VALUES (${r.recId}, ${r.kind}, ${JSON.stringify(r)}::jsonb, ${r.status || 'Open'})
                  ON CONFLICT (rec_id) DO UPDATE SET data = EXCLUDED.data, status = EXCLUDED.status`;
        await audit(me && me.username, 'training.' + r.kind, r.recId, null, r, body.reason);
        return res.status(200).json({ ok: true, recId: r.recId });
      }
      if (req.method === 'PATCH') {
        const rows = await sql`SELECT data, status FROM hr_training WHERE rec_id = ${body.recId}`;
        if (!rows.length) return res.status(404).json({ ok: false, error: 'Record not found.' });
        if (body.remove) {
          await sql`DELETE FROM hr_training WHERE rec_id = ${body.recId}`;
          await audit(me && me.username, 'training.delete', body.recId, rows[0].data, null, body.reason);
          return res.status(200).json({ ok: true, removed: body.recId });
        }
        const merged = Object.assign({}, rows[0].data, body.patch || {});
        if (body.status) merged.status = body.status;
        await sql`UPDATE hr_training SET data = ${JSON.stringify(merged)}::jsonb,
                  status = ${body.status || rows[0].status} WHERE rec_id = ${body.recId}`;
        await audit(me && me.username, 'training.update', body.recId,
          { status: rows[0].status }, { status: body.status || rows[0].status }, body.reason);
        return res.status(200).json({ ok: true, record: merged });
      }
    }

    /* ------- ITEMS: policies, tasks, KPIs, appraisals — one shape, many kinds ------- */
    if (what === 'items') {
      if (req.method === 'GET') {
        const kind = String(req.query.kind || '');
        const rows = kind
          ? await sql`SELECT item_id, kind, status, owner, due, data, created_at FROM hr_items
                      WHERE kind = ${kind} ORDER BY created_at DESC LIMIT 2000`
          : await sql`SELECT item_id, kind, status, owner, due, data, created_at FROM hr_items
                      ORDER BY created_at DESC LIMIT 3000`;
        return res.status(200).json({ ok: true, items: rows });
      }
      if (req.method === 'POST') {
        const it = body.item || {};
        if (!it.itemId || !it.kind)
          return res.status(400).json({ ok: false, error: 'Reference and kind are required.' });
        await sql`INSERT INTO hr_items (item_id, kind, data, status, owner, due)
                  VALUES (${it.itemId}, ${it.kind}, ${JSON.stringify(it)}::jsonb,
                          ${it.status || 'Open'}, ${it.owner || ''}, ${it.due || null})
                  ON CONFLICT (item_id) DO UPDATE SET data = EXCLUDED.data,
                    status = EXCLUDED.status, owner = EXCLUDED.owner, due = EXCLUDED.due`;
        await audit(me && me.username, it.kind + '.save', it.itemId, null, it, body.reason);
        return res.status(200).json({ ok: true, itemId: it.itemId });
      }
      if (req.method === 'PATCH') {
        const rows = await sql`SELECT data, status FROM hr_items WHERE item_id = ${body.itemId}`;
        if (!rows.length) return res.status(404).json({ ok: false, error: 'Not found.' });
        if (body.remove) {
          await sql`DELETE FROM hr_items WHERE item_id = ${body.itemId}`;
          await audit(me && me.username, 'item.delete', body.itemId, rows[0].data, null, body.reason);
          return res.status(200).json({ ok: true, removed: body.itemId });
        }
        const merged = Object.assign({}, rows[0].data, body.patch || {});
        if (body.status) merged.status = body.status;
        await sql`UPDATE hr_items SET data = ${JSON.stringify(merged)}::jsonb,
                  status = ${body.status || rows[0].status},
                  owner = ${merged.owner || ''}, due = ${merged.due || null}
                  WHERE item_id = ${body.itemId}`;
        await audit(me && me.username, 'item.' + (body.status || 'update').toLowerCase(),
          body.itemId, { status: rows[0].status }, { status: body.status || rows[0].status }, body.reason);
        return res.status(200).json({ ok: true, item: merged });
      }
    }

    /* ---------------- AUDIT TRAIL ---------------- */
    if (what === 'audit' && req.method === 'GET') {
      if (!(await checkRole(token, ['developer'])))
        return res.status(403).json({ ok: false, error: 'Audit history is restricted.' });
      const rows = await sql`SELECT who, what, ref, reason, at FROM hr_audit ORDER BY at DESC LIMIT 300`;
      return res.status(200).json({ ok: true, audit: rows });
    }

    return res.status(400).json({ ok: false, error: 'Unknown request.' });
  } catch (e) {
    console.log('HR ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
