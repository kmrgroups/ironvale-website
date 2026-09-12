/* An in-memory stand-in for api/_db.js, used by devicetest.mjs (the device
   endpoint end to end) and flushservertest.mjs (the real flush handler in
   api/idms.js end to end). It answers the handful of statements those two
   endpoints issue, matched on their text; anything it does not recognise
   throws, so a new query can never pass silently. */
import crypto from 'crypto';
export const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
export const db = {
  devices: {}, punches: {}, attendance: {}, employees: [], settings: {}, content: {}, audit: [], sessions: {},
  /* one array per table the flush endpoint can wipe, plus idmsAudit for the
     self-log entry it writes afterwards — real row counts, so a test can
     assert both "this got emptied" and "that did not" */
  idmsDocs: [1], idmsParts: [1], idmsCounters: [1], rfqs: [1], hrEmployees: [1], hrAttendance: [1],
  hrLeave: [1], hrTraining: [1], hrItems: [1], hrPayruns: [1], hrAuditRows: [1], hrPunches: [1],
  ppcOrders: [1], assets: [1], siteContent: [1], idmsSettings: [1], secrets: [1], loginCodes: [1],
  hrDevices: [1], idmsAudit: [1]
};
export async function ensureTables() {}
export function cors() {}
export async function tokenUser(t) { return db.sessions[t] || null; }
export async function checkToken(t) { return !!(await tokenUser(t)); }
export function readBody(req) { return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
export async function checkRole(t, roles) {
  const u = db.sessions[t];
  return u && roles.includes(u.role) ? u : null;
}

const FLUSH_TABLE_KEY = {
  idms_docs: 'idmsDocs', idms_parts: 'idmsParts', idms_counters: 'idmsCounters', rfqs: 'rfqs',
  hr_employees: 'hrEmployees', hr_attendance: 'hrAttendance', hr_leave: 'hrLeave',
  hr_training: 'hrTraining', hr_items: 'hrItems', hr_payruns: 'hrPayruns', hr_audit: 'hrAuditRows',
  hr_punches: 'hrPunches', ppc_orders: 'ppcOrders', assets: 'assets', site_content: 'siteContent',
  idms_settings: 'idmsSettings', secrets: 'secrets', login_codes: 'loginCodes', hr_devices: 'hrDevices',
  idms_audit: 'idmsAudit'
};

export function sql(strings, ...vals) {
  const text = strings.join('?').replace(/\s+/g, ' ').trim();
  const v = vals;
  const T = re => re.test(text);
  const delMatch = text.match(/^DELETE FROM (\w+)$/);
  if (delMatch && FLUSH_TABLE_KEY[delMatch[1]]) { db[FLUSH_TABLE_KEY[delMatch[1]]].length = 0; return []; }
  if (T(/^INSERT INTO idms_audit \(who, kind, ref, action, before_val, after_val, reason\)/)) {
    db.idmsAudit.push({ who: v[0], kind: v[1], ref: v[2], action: v[3], reason: v[6] });
    return [];
  }
  if (T(/^SELECT data FROM idms_settings WHERE key = 'attendance_devices'/))
    return db.settings.attendance_devices ? [{ data: db.settings.attendance_devices }] : [];
  if (T(/^SELECT data FROM site_content WHERE id = 1/)) return [{ data: db.content }];
  if (T(/^SELECT data FROM hr_employees$/)) return db.employees.map(e => ({ data: e }));
  if (T(/^INSERT INTO hr_devices \(sn, data, last_seen, last_ip\)/)) {
    const [sn, data, ip] = v;
    if (!db.devices[sn]) db.devices[sn] = { sn, registered: false, data: JSON.parse(data), punches: 0 };
    db.devices[sn].last_seen = new Date(); db.devices[sn].last_ip = ip;
    return [db.devices[sn]];
  }
  if (T(/^INSERT INTO hr_devices \(sn, registered, data\)/)) {
    const [sn, data] = v;
    db.devices[sn] = Object.assign(db.devices[sn] || { sn, punches: 0 }, { registered: true, data: JSON.parse(data) });
    return [];
  }
  if (T(/^SELECT data FROM hr_devices WHERE sn = \?/)) return db.devices[v[0]] ? [db.devices[v[0]]] : [];
  if (T(/^SELECT sn, registered, data FROM hr_devices WHERE data->>'keyHash' = \?/))
    return Object.values(db.devices).filter(d => d.data.keyHash === v[0]);
  if (T(/^UPDATE hr_devices SET last_seen = now\(\), last_ip = \? WHERE sn = \?/)) return [];
  if (T(/^UPDATE hr_devices SET punches = punches \+ \? WHERE sn = \?/)) { if (db.devices[v[1]]) db.devices[v[1]].punches += v[0]; return []; }
  if (T(/^SELECT sn, registered, data, last_seen, last_ip, punches, created_at FROM hr_devices/)) return Object.values(db.devices);
  if (T(/^DELETE FROM hr_devices WHERE sn = \?/)) { delete db.devices[v[0]]; return []; }
  if (T(/^INSERT INTO hr_punches/)) {
    const [id, emp_id, user_id, device_sn, punch_at, method, direction, source] = v;
    if (db.punches[id]) return [];
    db.punches[id] = { id, emp_id, user_id, device_sn, punch_at, method, direction, source };
    return [{ id }];
  }
  if (T(/^SELECT punch_at, method, direction, device_sn FROM hr_punches WHERE emp_id = \? AND punch_at >= \? AND punch_at < \? ORDER BY punch_at/))
    return Object.values(db.punches).filter(p => p.emp_id === v[0] && p.punch_at >= v[1] && p.punch_at < v[2])
      .sort((a, b) => a.punch_at.localeCompare(b.punch_at));
  if (T(/^SELECT id, emp_id, user_id, punch_at FROM hr_punches WHERE punch_at >= \? AND punch_at < \?/))
    return Object.values(db.punches).filter(p => p.punch_at >= v[0] && p.punch_at < v[1]);
  if (T(/^UPDATE hr_punches SET emp_id = \? WHERE id = \?/)) { db.punches[v[1]].emp_id = v[0]; return []; }
  if (T(/^SELECT emp_id, user_id, device_sn, punch_at, method, direction, source FROM hr_punches/))
    return Object.values(db.punches);
  if (T(/^SELECT user_id, device_sn, count\(\*\)::int AS n/))
    return Object.values(db.punches).filter(p => !p.emp_id).map(p => ({ user_id: p.user_id, device_sn: p.device_sn, n: 1 }));
  if (T(/^SELECT data FROM hr_attendance WHERE id = \?/)) return db.attendance[v[0]] ? [{ data: db.attendance[v[0]] }] : [];
  if (T(/^UPDATE hr_attendance SET data = \?::jsonb/)) { db.attendance[v[1]] = JSON.parse(v[0]); return []; }
  if (T(/^INSERT INTO hr_attendance/)) { db.attendance[v[0]] = JSON.parse(v[3]); return []; }
  if (T(/^INSERT INTO hr_audit/)) { db.audit.push({ who: v[0], what: v[1], ref: v[2] }); return []; }
  throw new Error('fake-db: unrecognised statement: ' + text);
}
