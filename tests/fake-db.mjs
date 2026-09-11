/* An in-memory stand-in for api/_db.js, used only by devicetest.mjs so the real
   device endpoint can be driven end to end without a database. It answers the
   handful of statements api/device.js issues, matched on their text; anything
   it does not recognise throws, so a new query cannot pass silently. */
import crypto from 'crypto';
export const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
export const db = { devices: {}, punches: {}, attendance: {}, employees: [], settings: {}, content: {}, audit: [], sessions: {} };
export async function ensureTables() {}
export function cors() {}
export async function tokenUser(t) { return db.sessions[t] || null; }

export function sql(strings, ...vals) {
  const text = strings.join('?').replace(/\s+/g, ' ').trim();
  const v = vals;
  const T = re => re.test(text);
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
