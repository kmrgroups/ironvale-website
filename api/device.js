// Attendance terminals: fingerprint (biometric) and face-recognition devices.
//
// Three ways a device can deliver punches, because the equipment a works buys
// decides which one it speaks:
//
//   ADMS push ("iclock")  ZKTeco, eSSL, Identix, Realtime and most fingerprint /
//                         face terminals sold in India. The device is given
//                         this site's address and port 443 and calls
//                         /iclock/cdata itself (vercel.json rewrites that path
//                         here). It is identified by its serial number, which
//                         must be registered in the IDMS first.
//   Hikvision             Face terminals' "HTTP listening" event push, to
//                         /api/device?proto=hik&key=<device key>.
//   JSON                  Anything else — a vendor cloud webhook or middleware
//                         (BioStar, COSEC, eTimeTrack) — posting
//                         { punches:[{userId,time}] } with the device key.
//
// Each punch is stored once (hr_punches), matched to an employee by the
// Biometric ID on their record (their Employee ID when that is blank), and the
// working day is worked out again from ALL of that person's punches for the day
// — first in, last out, late, half day, overtime — into hr_attendance, which
// payroll already reads. The rules for that live in _attendance.js.
//
// A day marked or corrected by hand is never overwritten by a device.
import crypto from 'crypto';
import { sql, ensureTables, cors, tokenUser, hash } from './_db.js';
import { parseAdmsAttlog, parseHikEvent, parseJsonPunches, shiftFor, workDayFor,
  summariseDay, attendanceRecord, DEFAULT_POLICY, wallMinutes, wallString } from './_attendance.js';

/* Devices post text and multipart bodies; read the raw bytes ourselves. */
export const config = { api: { bodyParser: false } };

async function rawBody(req) {
  const chunks = [];
  try { for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); } catch (e) { /* already read */ }
  if (chunks.length) return Buffer.concat(chunks);
  try {
    const b = req.body;
    if (b == null) return Buffer.alloc(0);
    if (Buffer.isBuffer(b)) return b;
    return Buffer.from(typeof b === 'string' ? b : JSON.stringify(b));
  } catch (e) { return Buffer.alloc(0); }
}

async function hrAudit(who, what, ref, after, reason) {
  try {
    await sql`INSERT INTO hr_audit (who, what, ref, before_val, after_val, reason)
      VALUES (${who || 'unknown'}, ${what}, ${ref || ''}, ${null}::jsonb, ${JSON.stringify(after || null)}::jsonb, ${reason || ''})`;
  } catch (e) { console.log('audit write failed:', e.message); }
}

/* The plant's rules: device settings from the IDMS, late/half-day from the HR
   leave policy, shifts from the HR shift master. Nothing hard-coded for a
   company — the defaults are only what applies before anybody sets them. */
async function loadRules() {
  const s = (await sql`SELECT data FROM idms_settings WHERE key = 'attendance_devices'`)[0];
  const cfg = (s && s.data) || {};
  const c = (await sql`SELECT data FROM site_content WHERE id = 1`)[0];
  const d = (c && c.data) || {};
  const lp = d.leavePolicy || {};
  const policy = Object.assign({}, DEFAULT_POLICY,
    { lateGraceMin: lp.lateGraceMin != null ? Number(lp.lateGraceMin) : DEFAULT_POLICY.lateGraceMin,
      halfDayAfterMin: lp.halfDayAfterMin != null ? Number(lp.halfDayAfterMin) : DEFAULT_POLICY.halfDayAfterMin },
    cfg.policy || {});
  return { policy, shifts: d.shifts || [], defaultShift: cfg.defaultShift || '',
    tzOffsetMin: cfg.tzOffsetMin != null ? Number(cfg.tzOffsetMin) : 330 };
}

function dayShift(day, n) { return wallString(wallMinutes(day + ' 00:00') + n * 1440).slice(0, 10); }

async function employeesByUser() {
  const emps = (await sql`SELECT data FROM hr_employees`).map(r => r.data);
  const byUser = {};
  emps.forEach(e => { const k = String(e.biometricId || '').trim().toUpperCase(); if (k) byUser[k] = e; });
  emps.forEach(e => { const k = String(e.empId || '').trim().toUpperCase(); if (k && !byUser[k]) byUser[k] = e; });
  return byUser;
}

/* Work out one person's day again from every punch they have for it. */
async function remark(affected, rules) {
  let marked = 0, keptManual = 0;
  for (const key of Object.keys(affected)) {
    const a = affected[key];
    const rows = await sql`SELECT punch_at, method, direction, device_sn FROM hr_punches
      WHERE emp_id = ${a.emp.empId} AND punch_at >= ${dayShift(a.day, -1) + ' 00:00:00'}
        AND punch_at < ${dayShift(a.day, 2) + ' 00:00:00'} ORDER BY punch_at`;
    const mine = rows.map(r => ({ time: r.punch_at, method: r.method, direction: r.direction, deviceSn: r.device_sn }))
      .filter(p => workDayFor(p.time, a.shift) === a.day);
    const sum = summariseDay(mine, a.shift, a.day, rules.policy);
    if (!sum) continue;
    const ex = (await sql`SELECT data FROM hr_attendance WHERE id = ${key}`)[0];
    const rec = attendanceRecord(ex ? ex.data : null, sum, a.emp.empId, a.day,
      [...new Set(mine.map(p => p.deviceSn).filter(Boolean))]);
    if (!rec) {
      /* a hand-marked day: keep it, but note what the device saw */
      const noted = Object.assign({}, ex.data, { deviceIn: sum.inTime, deviceOut: sum.outTime,
        devicePunches: sum.punchCount, deviceWorkedHours: sum.workedHours });
      await sql`UPDATE hr_attendance SET data = ${JSON.stringify(noted)}::jsonb WHERE id = ${key}`;
      keptManual++;
      continue;
    }
    await sql`INSERT INTO hr_attendance (id, emp_id, day, data, updated_at)
      VALUES (${key}, ${a.emp.empId}, ${a.day}, ${JSON.stringify(rec)}::jsonb, now())
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
    marked++;
  }
  return { marked, keptManual };
}

export async function ingest(punches, source, sn) {
  const out = { received: punches.length, stored: 0, marked: 0, keptManual: 0, unmatched: [] };
  if (!punches.length) return out;
  const rules = await loadRules();
  const byUser = await employeesByUser();
  const affected = {}, unmatched = new Set();
  for (const p of punches) {
    const emp = byUser[String(p.userId).toUpperCase()] || null;
    const deviceSn = p.deviceSn || sn || '';
    const id = deviceSn + '|' + p.userId + '|' + p.time;
    const r = await sql`INSERT INTO hr_punches (id, emp_id, user_id, device_sn, punch_at, method, direction, source)
      VALUES (${id}, ${emp ? emp.empId : ''}, ${p.userId}, ${deviceSn}, ${p.time}, ${p.method || ''},
              ${p.direction || ''}, ${source})
      ON CONFLICT (id) DO NOTHING RETURNING id`;
    if (r.length) out.stored++;
    if (!emp) { unmatched.add(p.userId); continue; }
    if (emp.status === 'Exited') continue;
    const shift = shiftFor(emp, rules.shifts, rules.defaultShift);
    const day = workDayFor(p.time, shift);
    affected[emp.empId + '|' + day] = { emp, day, shift };
  }
  if (sn && out.stored) await sql`UPDATE hr_devices SET punches = punches + ${out.stored} WHERE sn = ${sn}`;
  Object.assign(out, await remark(affected, rules));
  out.unmatched = [...unmatched];
  return out;
}

/* A device calling in is recorded even before it is registered, so HR can see
   it arrive and approve it rather than type a serial number off a sticker. */
async function seen(sn, ip, protocol) {
  const rows = await sql`INSERT INTO hr_devices (sn, data, last_seen, last_ip)
    VALUES (${sn}, ${JSON.stringify({ protocol, name: '' })}::jsonb, now(), ${ip})
    ON CONFLICT (sn) DO UPDATE SET last_seen = now(), last_ip = EXCLUDED.last_ip
    RETURNING sn, registered, data`;
  return rows[0];
}
function ipAllowed(list, ip) {
  const allow = String(list || '').split(/[\s,]+/).filter(Boolean);
  return !allow.length || allow.includes(ip);
}

function admsOptions(sn) {
  return ['GET OPTION FROM: ' + sn, 'ATTLOGStamp=None', 'OPERLOGStamp=9999', 'ATTPHOTOStamp=None',
    'ErrorDelay=30', 'Delay=10', 'TransTimes=00:00;14:05', 'TransInterval=1',
    'TransFlag=TransData AttLog', 'Realtime=1', 'Encrypt=None', 'ServerVer=IDMS'].join('\n');
}

async function adms(req, res, q) {
  res.setHeader('Content-Type', 'text/plain');
  const sn = String(q.SN || q.sn || '').trim();
  const op = String(q.op || 'cdata').toLowerCase().replace(/\.aspx$/, '');
  if (!sn) return res.status(400).send('ERROR: no serial number');
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const dev = await seen(sn, ip, 'adms');
  /* Not registered, switched off, or calling from an address it is not allowed
     to: refuse. A refused device keeps its punches and sends them again later,
     so nothing is lost while HR registers it. */
  if (!dev.registered) return res.status(403).send('ERROR: device ' + sn + ' is not registered in the IDMS');
  if ((dev.data || {}).active === false) return res.status(403).send('ERROR: device switched off in the IDMS');
  if (!ipAllowed((dev.data || {}).allowIp, ip)) return res.status(403).send('ERROR: address not allowed');

  if (req.method === 'GET' && op === 'cdata') return res.status(200).send(admsOptions(sn));
  if (op === 'getrequest' || op === 'devicecmd') return res.status(200).send('OK');
  if (req.method === 'POST' && op === 'cdata') {
    const table = String(q.table || '').toUpperCase();
    const text = (await rawBody(req)).toString('utf8');
    if (table !== 'ATTLOG') return res.status(200).send('OK');   // user lists, photos, operation logs
    const punches = parseAdmsAttlog(text).map(p => Object.assign(p, { deviceSn: sn }));
    await ingest(punches, 'adms', sn);
    return res.status(200).send('OK: ' + punches.length);
  }
  return res.status(200).send('OK');
}

async function keyed(req, res, q, proto) {
  const key = String(req.headers['x-device-key'] || q.key || '').trim();
  if (!key) return res.status(401).json({ ok: false, error: 'Device key missing.' });
  const rows = await sql`SELECT sn, registered, data FROM hr_devices WHERE data->>'keyHash' = ${hash(key)}`;
  const dev = rows[0];
  if (!dev || !dev.registered) return res.status(401).json({ ok: false, error: 'Unknown device key.' });
  if ((dev.data || {}).active === false) return res.status(403).json({ ok: false, error: 'Device switched off in the IDMS.' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (!ipAllowed((dev.data || {}).allowIp, ip)) return res.status(403).json({ ok: false, error: 'Address not allowed.' });
  await sql`UPDATE hr_devices SET last_seen = now(), last_ip = ${ip} WHERE sn = ${dev.sn}`;
  const rules = await loadRules();
  const raw = await rawBody(req);
  let punches;
  if (proto === 'hik') punches = parseHikEvent(raw, req.headers['content-type'], rules.tzOffsetMin);
  else {
    let body = {};
    try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch (e) { return res.status(400).json({ ok: false, error: 'Body is not JSON.' }); }
    punches = parseJsonPunches(body, rules.tzOffsetMin);
  }
  punches.forEach(p => { p.deviceSn = dev.sn; });
  const r = await ingest(punches, proto, dev.sn);
  return res.status(200).json(Object.assign({ ok: true }, r));
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    await ensureTables();
    const q = req.query || {};
    const proto = String(q.proto || '');
    if (proto === 'adms') return await adms(req, res, q);
    if (proto === 'hik' || proto === 'json') return await keyed(req, res, q, proto);

    /* ---- everything below is the IDMS, signed in ---- */
    const me = await tokenUser(req.headers['x-auth-token'] || '');
    if (!me) return res.status(401).json({ ok: false, error: 'Not signed in.' });
    const what = String(q.what || '');
    const readJson = async () => { try { return JSON.parse((await rawBody(req)).toString('utf8') || '{}'); } catch (e) { return {}; } };
    const admin = me.role === 'developer';

    if (what === 'devices' && req.method === 'GET') {
      const rows = await sql`SELECT sn, registered, data, last_seen, last_ip, punches, created_at
        FROM hr_devices ORDER BY registered, last_seen DESC NULLS LAST`;
      return res.status(200).json({ ok: true, devices: rows.map(r => {
        const d = Object.assign({}, r.data); const hasKey = !!d.keyHash; delete d.keyHash;
        return { sn: r.sn, registered: r.registered, data: d, hasKey, lastSeen: r.last_seen, lastIp: r.last_ip,
          punches: Number(r.punches || 0) };
      }) });
    }

    if (what === 'devices' && req.method === 'POST') {
      if (!admin) return res.status(403).json({ ok: false, error: 'Registering an attendance device needs the administrator login — it decides whose attendance counts.' });
      const body = await readJson();
      const d = body.device || {};
      const protocol = ['adms', 'hik', 'json'].includes(d.protocol) ? d.protocol : 'adms';
      let sn = String(d.sn || '').trim();
      if (!sn && protocol !== 'adms') sn = 'DEV-' + crypto.randomBytes(3).toString('hex').toUpperCase();
      if (!sn) return res.status(400).json({ ok: false, error: 'The serial number is needed — it is how the device identifies itself.' });
      if (!/^[A-Za-z0-9._\-]{3,40}$/.test(sn)) return res.status(400).json({ ok: false, error: 'A serial number is letters, digits, dots and dashes only.' });
      const prev = (await sql`SELECT data FROM hr_devices WHERE sn = ${sn}`)[0];
      const data = { name: String(d.name || '').slice(0, 80), vendor: String(d.vendor || '').slice(0, 40),
        type: d.type === 'face' ? 'face' : d.type === 'both' ? 'both' : 'biometric', protocol,
        location: String(d.location || '').slice(0, 80), allowIp: String(d.allowIp || '').slice(0, 200),
        active: d.active !== false, keyHash: prev && prev.data ? prev.data.keyHash || '' : '' };
      let key = '';
      if (protocol !== 'adms' && (body.newKey || !data.keyHash)) {
        key = crypto.randomBytes(18).toString('base64url');
        data.keyHash = hash(key);
      }
      await sql`INSERT INTO hr_devices (sn, registered, data) VALUES (${sn}, true, ${JSON.stringify(data)}::jsonb)
        ON CONFLICT (sn) DO UPDATE SET registered = true, data = EXCLUDED.data`;
      await hrAudit(me.username, prev ? 'device.update' : 'device.register', sn,
        { name: data.name, type: data.type, protocol }, body.reason || 'attendance device registered');
      return res.status(200).json({ ok: true, sn, key });   // the key is shown once and never stored in clear
    }

    if (what === 'devices' && req.method === 'PATCH') {
      if (!admin) return res.status(403).json({ ok: false, error: 'Removing an attendance device needs the administrator login.' });
      const body = await readJson();
      await sql`DELETE FROM hr_devices WHERE sn = ${String(body.sn || '')}`;
      await hrAudit(me.username, 'device.remove', body.sn, null, body.reason || 'attendance device removed');
      return res.status(200).json({ ok: true });
    }

    if (what === 'punches' && req.method === 'GET') {
      const from = String(q.from || ''), to = String(q.to || '');
      const emp = String(q.empId || '');
      const rows = emp
        ? await sql`SELECT emp_id, user_id, device_sn, punch_at, method, direction, source FROM hr_punches
            WHERE emp_id = ${emp} AND punch_at >= ${from + ' 00:00:00'} AND punch_at <= ${to + ' 23:59:59'} ORDER BY punch_at DESC LIMIT 2000`
        : await sql`SELECT emp_id, user_id, device_sn, punch_at, method, direction, source FROM hr_punches
            WHERE punch_at >= ${from + ' 00:00:00'} AND punch_at <= ${to + ' 23:59:59'} ORDER BY punch_at DESC LIMIT 2000`;
      const unmatched = await sql`SELECT user_id, device_sn, count(*)::int AS n, max(punch_at) AS last
        FROM hr_punches WHERE emp_id = '' GROUP BY user_id, device_sn ORDER BY max(punch_at) DESC LIMIT 200`;
      return res.status(200).json({ ok: true, punches: rows, unmatched });
    }

    /* the bulk upload of a device's exported log comes through the same engine */
    if (what === 'import' && req.method === 'POST') {
      const body = await readJson();
      const rules = await loadRules();
      const list = parseJsonPunches(body, rules.tzOffsetMin).slice(0, 2000);
      list.forEach(p => { if (!p.deviceSn) p.deviceSn = 'IMPORT'; });
      const r = await ingest(list, 'import', '');
      await hrAudit(me.username, 'punches.import', '', { received: r.received, stored: r.stored, marked: r.marked },
        body.reason || 'device log imported');
      return res.status(200).json(Object.assign({ ok: true }, r));
    }

    /* Mark a period again — after a Biometric ID is added to an employee (their
       earlier punches were unmatched), after a shift change, or after the
       late / half-day rules change. Hand-marked days are still left alone. */
    if (what === 'reprocess' && req.method === 'POST') {
      if (!admin) return res.status(403).json({ ok: false, error: 'Marking a period again needs the administrator login.' });
      const body = await readJson();
      const from = String(body.from || ''), to = String(body.to || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from)
        return res.status(400).json({ ok: false, error: 'Choose a from and to date.' });
      const rules = await loadRules();
      const byUser = await employeesByUser();
      const rows = await sql`SELECT id, emp_id, user_id, punch_at FROM hr_punches
        WHERE punch_at >= ${dayShift(from, -1) + ' 00:00:00'} AND punch_at < ${dayShift(to, 2) + ' 00:00:00'}`;
      const affected = {};
      let rematched = 0;
      for (const r of rows) {
        const emp = byUser[String(r.user_id).toUpperCase()] || null;
        if (emp && emp.empId !== r.emp_id) {
          await sql`UPDATE hr_punches SET emp_id = ${emp.empId} WHERE id = ${r.id}`;
          rematched++;
        }
        if (!emp || emp.status === 'Exited') continue;
        const shift = shiftFor(emp, rules.shifts, rules.defaultShift);
        const day = workDayFor(r.punch_at, shift);
        if (day >= from && day <= to) affected[emp.empId + '|' + day] = { emp, day, shift };
      }
      const r = await remark(affected, rules);
      await hrAudit(me.username, 'attendance.reprocess', from + '..' + to, Object.assign({ rematched }, r),
        body.reason || 'attendance marked again from punches');
      return res.status(200).json(Object.assign({ ok: true, rematched }, r));
    }

    /* Overtime from punches waits for a person to approve it (unless the plant
       has chosen to count it automatically), because payroll pays it. */
    if (what === 'approveOt' && req.method === 'POST') {
      if (!admin) return res.status(403).json({ ok: false, error: 'Approving overtime needs the administrator login — it is paid.' });
      const body = await readJson();
      const id = String(body.empId || '') + '|' + String(body.day || '');
      const ex = (await sql`SELECT data FROM hr_attendance WHERE id = ${id}`)[0];
      if (!ex) return res.status(404).json({ ok: false, error: 'No attendance for that person and day.' });
      const hours = Math.max(0, Number(body.hours) || 0);
      const rec = Object.assign({}, ex.data, { otHours: hours, otApprovedHours: hours, otPendingHours: 0,
        otApprovedBy: me.username });
      await sql`UPDATE hr_attendance SET data = ${JSON.stringify(rec)}::jsonb, updated_at = now() WHERE id = ${id}`;
      await hrAudit(me.username, 'attendance.ot.approve', id, { hours }, body.reason || 'overtime approved');
      return res.status(200).json({ ok: true, record: rec });
    }

    return res.status(400).json({ ok: false, error: 'Unknown request.' });
  } catch (e) {
    console.log('DEVICE ERROR:', e.message);
    if (String((req.query || {}).proto || '') === 'adms') return res.status(500).send('ERROR');
    return res.status(500).json({ ok: false, error: e.message });
  }
}
