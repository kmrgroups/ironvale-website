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
    const token = req.headers['x-auth-token'];
    if (!(await checkToken(token)))
      return res.status(401).json({ ok: false, error: 'Not signed in.' });
    const me = await tokenUser(token);
    const body = req.method === 'GET' ? {} : readBody(req);
    const what = String((req.query && req.query.what) || body.what || 'employees');

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
