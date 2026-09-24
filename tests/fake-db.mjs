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
  hrDevices: [1], idmsAudit: [1],
  /* the secrets table's actual contents, for the settings endpoint — kept
     apart from `secrets` above, which is the flush test's row counter */
  secretValues: {}, secretCacheCleared: 0,
  /* the users table, for the auth endpoint. A real little store rather than a
     stub answering {} to everything: every rule worth testing here is about
     what is already on file — who exists, at what role — so a stub would pass
     all of them while proving none. */
  users: {}, endedSessions: []
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
export function clearSecretCache() { db.secretCacheCleared++; }

/* ---- the password and session helpers auth.js imports ----
   Deliberately simple rather than real scrypt: these tests are about who may
   see and change whose login, not about the hashing, which sectest.mjs already
   covers against the real implementation. The SHAPES match — a salted hash
   string, an opaque random session token, a role carried on the session — so
   the handler's own logic runs unchanged. */
export function newSalt() { return 'salt' + (db.saltSeq = (db.saltSeq || 0) + 1); }
export function scryptHash(pass, salt) { return 'scrypt$' + salt + '$' + hash(salt + ':' + String(pass)); }
export function passwordMatches(pass, stored) {
  const m = String(stored || '').match(/^scrypt\$([^$]+)\$(.+)$/);
  if (!m) return hash(String(pass)) === stored;   // the legacy shape
  return hash(m[1] + ':' + String(pass)) === m[2];
}
export function isLegacyHash(stored) { return !/^scrypt\$/.test(String(stored || '')); }
export async function startSession(username, role) {
  const token = 'tok' + (db.tokSeq = (db.tokSeq || 0) + 1);
  db.sessions[token] = { username, role };
  return { token, expiresAt: '2099-01-01' };
}
export async function endSession(token) { delete db.sessions[token]; }
export async function endAllSessions(username) {
  db.endedSessions.push(username);
  Object.keys(db.sessions).forEach(t => { if (db.sessions[t].username === username) delete db.sessions[t]; });
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
  /* idms_settings by key — admin_access and anything else a screen stores */
  if (T(/^SELECT data FROM idms_settings WHERE key = \?$/))
    return db.settings[v[0]] !== undefined ? [{ data: db.settings[v[0]] }] : [];
  if (T(/^INSERT INTO idms_settings \(key, data\)/)) { db.settings[v[0]] = JSON.parse(v[1]); return []; }
  /* the secrets table — the settings endpoint's whole world */
  if (T(/^SELECT name, value, updated_at FROM secrets$/))
    return Object.keys(db.secretValues).map(n => ({ name: n, value: db.secretValues[n], updated_at: '2026-01-01' }));
  if (T(/^SELECT name, value FROM secrets$/))
    return Object.keys(db.secretValues).map(n => ({ name: n, value: db.secretValues[n] }));
  if (T(/^INSERT INTO secrets \(name, value, updated_at\)/)) { db.secretValues[v[0]] = v[1]; return []; }
  if (T(/^DELETE FROM secrets WHERE name = \?$/)) { delete db.secretValues[v[0]]; return []; }
  /* ---- the users table, for auth.js ---- */
  if (T(/^SELECT \* FROM users WHERE username = \?$/)) return db.users[v[0]] ? [db.users[v[0]]] : [];
  if (T(/^SELECT username, role FROM users WHERE username = \?$/))
    return db.users[v[0]] ? [{ username: v[0], role: db.users[v[0]].role }] : [];
  if (T(/^SELECT username FROM users WHERE username = \?$/))
    return db.users[v[0]] ? [{ username: v[0] }] : [];
  if (T(/^SELECT username FROM users WHERE role = 'developer'$/))
    return Object.values(db.users).filter(u => u.role === 'developer').map(u => ({ username: u.username }));
  if (T(/^SELECT username, role, email, whatsapp, twofa, active, auth_methods, restrict_access, permissions, \(face_descriptor IS NOT NULL\) AS face_enrolled, face_enrolled_at, pass_changed_at, pass_changed_by, signup_at, signup_note FROM users ORDER BY role, username$/))
    return Object.values(db.users)
      .sort((a, b) => (a.role + a.username).localeCompare(b.role + b.username))
      .map(u => ({ username: u.username, role: u.role, email: u.email || '', whatsapp: u.whatsapp || '',
        twofa: !!u.twofa, active: u.active !== false, auth_methods: u.auth_methods || null,
        restrict_access: !!u.restrict_access, permissions: u.permissions || [],
        face_enrolled: !!u.face_descriptor, face_enrolled_at: u.face_enrolled_at || null,
        pass_changed_at: u.pass_changed_at || null, pass_changed_by: u.pass_changed_by || '',
        signup_at: u.signup_at || null, signup_note: u.signup_note || '' }));
  if (T(/^INSERT INTO users \(username, pass_hash, role, email, whatsapp, active, signup_at, signup_note, face_descriptor, face_enrolled_at, pass_changed_at, pass_changed_by\)/)) {
    /* `false`, `now()` and `'self sign-up'` are literals in that statement, not
       bound values, so the parameters run uname, hash, role, email, whatsapp,
       note, face, faceAt — eight, not twelve. Getting this wrong fed an ISO
       date to JSON.parse and the handler reported it as a 500. */
    /* `active` is written as a LITERAL in that statement, so it is read back
       out of the statement text rather than assumed — a fake that hard-codes
       what the real code is supposed to say can never catch it saying
       something else. */
    db.users[v[0]] = { username: v[0], pass_hash: v[1], role: v[2], email: v[3], whatsapp: v[4],
      active: /VALUES \([^)]*?\btrue, now\(\)/.test(text),
      signup_at: new Date().toISOString(), signup_note: v[5],
      face_descriptor: v[6] ? JSON.parse(v[6]) : null, face_enrolled_at: v[7],
      pass_changed_by: 'self sign-up', permissions: [], auth_methods: null };
    return [];
  }
  if (T(/^INSERT INTO users \(username, pass_hash, role, email, whatsapp, twofa, active, restrict_access, permissions, auth_methods, pass_changed_at, pass_changed_by\)/)) {
    db.users[v[0]] = { username: v[0], pass_hash: v[1], role: v[2], email: v[3], whatsapp: v[4],
      twofa: v[5], active: v[6], restrict_access: v[7], permissions: JSON.parse(v[8]),
      auth_methods: JSON.parse(v[9]), pass_changed_by: v[10] };
    return [];
  }
  if (T(/^UPDATE users SET pass_hash = \?, pass_changed_at = now\(\), pass_changed_by = \? WHERE username = \?$/)) {
    Object.assign(db.users[v[2]], { pass_hash: v[0], pass_changed_by: v[1],
      pass_changed_at: new Date().toISOString() });
    return [];
  }
  if (T(/^UPDATE users SET role = \?, email = \?, whatsapp = \?, twofa = \?, active = \?, restrict_access = \?, permissions = \?::jsonb, auth_methods = \?::jsonb WHERE username = \?$/)) {
    Object.assign(db.users[v[8]], { role: v[0], email: v[1], whatsapp: v[2], twofa: v[3],
      active: v[4], restrict_access: v[5], permissions: JSON.parse(v[6]),
      auth_methods: JSON.parse(v[7]) });
    return [];
  }
  if (T(/^UPDATE users SET face_descriptor = NULL, face_enrolled_at = NULL WHERE username = \?$/)) {
    db.users[v[0]].face_descriptor = null; db.users[v[0]].face_enrolled_at = null; return [];
  }
  if (T(/^UPDATE users SET pass_hash = \? WHERE username = \?$/)) { db.users[v[1]].pass_hash = v[0]; return []; }
  if (T(/^DELETE FROM users WHERE username = \?$/)) { delete db.users[v[0]]; return []; }
  throw new Error('fake-db: unrecognised statement: ' + text);
}
