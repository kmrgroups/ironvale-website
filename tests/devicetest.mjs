/* Attendance from biometric and face-recognition terminals.

   Part 1 drives the pure rules in api/_attendance.js: parsing what ZKTeco/eSSL
   (ADMS), Hikvision and generic devices send; first-in/last-out; late, half
   day, overtime; night shifts that cross midnight.

   Part 2 drives the real api/device.js handler end to end against an in-memory
   database (tests/fake-db.mjs, swapped in for _db.js with a module hook): an
   unregistered device is refused and keeps its punches, a registered one is
   marked, a re-sent log is not doubled, a hand-marked day is never
   overwritten, a later Biometric ID re-matches earlier punches. */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const results = [];
const check = (n, c, x) => results.push([n, !!c, x || '']);

const A = await import('../api/_attendance.js');

/* ---------------- parsers ---------------- */
const zk = A.parseAdmsAttlog('1001\t2026-09-10 08:58:12\t0\t1\t0\t0\n1001\t2026-09-10 17:40:03\t1\t15\t0\t0\n\nbad line\n');
check('ADMS: two punches parsed from an ATTLOG body, blank and bad lines ignored', zk.length === 2);
check('ADMS: fingerprint and face verify codes are told apart', zk[0].method === 'fingerprint' && zk[1].method === 'face');
check('ADMS: check-in and check-out statuses are read', zk[0].direction === 'in' && zk[1].direction === 'out');

const hikJson = JSON.stringify({ ipAddress: '10.0.0.5', dateTime: '2026-09-10T03:30:00Z', eventType: 'AccessControllerEvent',
  AccessControllerEvent: { employeeNoString: '2002', name: 'Asha', currentVerifyMode: 'face', attendanceStatus: 'checkIn' } });
const hik = A.parseHikEvent(hikJson, 'application/json', 330);
check('Hikvision JSON: a recognised face is a punch', hik.length === 1 && hik[0].userId === '2002' && hik[0].method === 'face');
check('Hikvision: a UTC time is moved onto the plant clock (+05:30)', hik[0].time === '2026-09-10 09:00:00', hik[0] && hik[0].time);
const multipart = '--MIME_boundary\r\nContent-Disposition: form-data; name="event_log"\r\nContent-Type: application/json\r\n\r\n' +
  JSON.stringify({ dateTime: '2026-09-10T18:05:00+05:30', AccessControllerEvent: { employeeNoString: '2002', currentVerifyMode: 'cardOrFaceOrFp' } }) +
  '\r\n--MIME_boundary\r\nContent-Disposition: form-data; name="Picture"; filename="p.jpg"\r\n\r\n\xff\xd8binary\r\n--MIME_boundary--';
const hik2 = A.parseHikEvent(Buffer.from(multipart, 'latin1'), 'multipart/form-data; boundary=MIME_boundary', 330);
check('Hikvision multipart: the event_log JSON is found beside the photo', hik2.length === 1 && hik2[0].time === '2026-09-10 18:05:00', JSON.stringify(hik2));
check('Hikvision: a stranger (no employee number) is not a punch',
  A.parseHikEvent(JSON.stringify({ dateTime: '2026-09-10T09:00:00+05:30', AccessControllerEvent: { employeeNoString: '', currentVerifyMode: 'face' } }), 'application/json', 330).length === 0);
check('Hikvision: a heartbeat is not a punch', A.parseHikEvent(JSON.stringify({ eventType: 'heartBeat' }), 'application/json', 330).length === 0);
const gen = A.parseJsonPunches({ punches: [{ userId: 'E7', time: '2026-09-10 09:01' }, { userId: '', time: 'x' }] }, 330);
check('JSON: a punch with no zone is taken as plant time; an empty one is dropped', gen.length === 1 && gen[0].time === '2026-09-10 09:01:00');

/* ---------------- shifts and working days ---------------- */
const shifts = [{ code: 'GEN', name: 'General', start: '09:00', end: '17:30', breakMin: 30 },
                { code: 'C', name: 'Shift C', start: '22:00', end: '06:00', breakMin: 30 }];
check('shift found by name', A.shiftFor({ shift: 'shift c' }, shifts).code === 'C');
check('shift found by code', A.shiftFor({ shift: 'GEN' }, shifts).code === 'GEN');
check('no shift on the record → the default, else the first', A.shiftFor({}, shifts, 'C').code === 'C' && A.shiftFor({}, shifts).code === 'GEN');
check('night shift: a 05:50 punch belongs to the previous day', A.workDayFor('2026-09-11 05:50:00', shifts[1]) === '2026-09-10');
check('night shift: a 21:55 punch belongs to its own day', A.workDayFor('2026-09-10 21:55:00', shifts[1]) === '2026-09-10');
check('day shift: an early punch stays on its own day', A.workDayFor('2026-09-11 05:50:00', shifts[0]) === '2026-09-11');

/* ---------------- one day ---------------- */
const P = (...t) => t.map(x => ({ time: '2026-09-10 ' + x + ':00', method: 'fingerprint' }));
const gen1 = shifts[0];
let s = A.summariseDay(P('08:55', '08:56', '17:35'), gen1, '2026-09-10', {});
check('first in, last out; a double scan within 2 min is one punch', s.inTime === '08:55' && s.outTime === '17:35' && s.punchCount === 2, JSON.stringify(s));
check('an on-time full day is Present, one whole day, not late', s.status === 'Present' && s.dayFraction === 1 && !s.late);
s = A.summariseDay(P('09:25', '17:30'), gen1, '2026-09-10', { lateGraceMin: 10 });
check('25 min after a 10-min grace is late', s.late && s.lateMin === 25 && s.dayFraction === 1);
s = A.summariseDay(P('11:30', '17:30'), gen1, '2026-09-10', { halfDayAfterMin: 120 });
check('arriving after the half-day limit is half a day, with the reason', s.dayFraction === 0.5 && /arrived 150 min/.test(s.halfDayReason));
s = A.summariseDay(P('09:00', '12:00'), gen1, '2026-09-10', {});
check('working less than half the shift is half a day', s.dayFraction === 0.5 && /worked/.test(s.halfDayReason));
s = A.summariseDay(P('09:00'), gen1, '2026-09-10', {});
check('a single punch is present but flagged as a missed punch', s.missedPunch && s.dayFraction === 1 && s.outTime === '');
check('…or half a day when the plant chooses that', A.summariseDay(P('09:00'), gen1, '2026-09-10', { missedPunch: 'half' }).dayFraction === 0.5);
s = A.summariseDay(P('09:00', '20:10'), gen1, '2026-09-10', {});
// worked 11h10 − 30 break = 10h40; shift 8h → 2h40 → 2.5h in 30-min steps
check('overtime is counted in 30-minute steps and waits for approval by default', s.otPendingHours === 2.5 && s.otHours === 0, JSON.stringify(s));
check('…and goes straight to payroll when the plant counts it automatically',
  A.summariseDay(P('09:00', '20:10'), gen1, '2026-09-10', { autoOt: true }).otHours === 2.5);
check('under 30 minutes over is not overtime', A.summariseDay(P('09:00', '17:55'), gen1, '2026-09-10', {}).otPendingHours === 0);
const night = [{ time: '2026-09-10 21:52:00' }, { time: '2026-09-11 06:04:00' }];
s = A.summariseDay(night, shifts[1], '2026-09-10', {});
check('a night shift across midnight is one full day', s.dayFraction === 1 && s.inTime === '21:52' && s.outTime === '06:04' && !s.late, JSON.stringify(s));

/* ---------------- what gets written ---------------- */
const sum = A.summariseDay(P('09:00', '17:30'), gen1, '2026-09-10', {});
const rec = A.attendanceRecord(null, sum, 'E1', '2026-09-10', ['ZK1']);
check('the record has the fields payroll reads (status, dayFraction, otHours, late)',
  rec.id === 'E1|2026-09-10' && rec.status === 'Present' && rec.dayFraction === 1 && rec.otHours === 0 && rec.late === false && rec.source === 'device');
check('a day marked on the HR sheet (no source) is never overwritten', A.attendanceRecord({ status: 'Absent' }, sum, 'E1', '2026-09-10') === null);
check('a day corrected by hand is never overwritten', A.attendanceRecord({ status: 'Present', source: 'manual' }, sum, 'E1', '2026-09-10') === null);
check('approved overtime survives a later punch', A.attendanceRecord({ source: 'device', otApprovedHours: 2 }, sum, 'E1', '2026-09-10').otHours === 2);

/* ================= Part 2: the endpoint ================= */
const fake = pathToFileURL(process.cwd() + '/tests/fake-db.mjs').href;
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec === './_db.js' && ctx.parentURL && ctx.parentURL.endsWith('/api/device.js')) return { url: ${JSON.stringify(fake)}, shortCircuit: true };
    return next(spec, ctx);
  }`));
const { db } = await import(fake);
const handler = (await import('../api/device.js')).default;

function call({ method = 'GET', query = {}, headers = {}, body = '' }) {
  return new Promise(resolve => {
    const buf = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = { method, query, headers, async *[Symbol.asyncIterator]() { if (buf.length) yield buf; } };
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; },
      send(x) { resolve({ status: this.statusCode, text: String(x) }); }, json(x) { resolve({ status: this.statusCode, json: x }); },
      end() { resolve({ status: this.statusCode }); } };
    handler(req, res);
  });
}

db.content = { shifts, leavePolicy: { lateGraceMin: 10, halfDayAfterMin: 120 } };
db.employees = [
  { empId: 'ET001', name: 'Ravi', shift: 'General', status: 'Active', biometricId: '1001' },
  { empId: 'ET002', name: 'Meena', shift: 'Shift C', status: 'Active' },            // no biometric ID: matched by Employee ID
  { empId: 'ET009', name: 'Left', status: 'Exited', biometricId: '1009' }];
db.sessions.ADMIN = { username: 'asha', role: 'developer' };
db.sessions.STAFF = { username: 'hr1', role: 'staff' };

let r = await call({ query: { proto: 'adms', op: 'cdata', SN: 'ZK-AAA1', options: 'all' } });
check('an unregistered ADMS device is refused (so it keeps its punches)', r.status === 403 && /not registered/.test(r.text));
check('…but it is recorded, so HR can see it and register it', db.devices['ZK-AAA1'] && db.devices['ZK-AAA1'].registered === false);

r = await call({ method: 'POST', query: { what: 'devices' }, headers: { 'x-auth-token': 'STAFF' }, body: { device: { sn: 'ZK-AAA1', protocol: 'adms' } } });
check('only the administrator login can register a device', r.status === 403);
r = await call({ method: 'POST', query: { what: 'devices' }, headers: { 'x-auth-token': 'ADMIN' },
  body: { device: { sn: 'ZK-AAA1', name: 'Main gate', type: 'biometric', protocol: 'adms', vendor: 'ZKTeco' } } });
check('the administrator registers it', r.status === 200 && db.devices['ZK-AAA1'].registered === true);

r = await call({ query: { proto: 'adms', op: 'cdata', SN: 'ZK-AAA1', options: 'all' } });
check('the registered device gets the ADMS options on handshake', r.status === 200 && /GET OPTION FROM: ZK-AAA1/.test(r.text) && /Realtime=1/.test(r.text));
r = await call({ query: { proto: 'adms', op: 'getrequest', SN: 'ZK-AAA1' } });
check('getrequest is answered OK (no commands queued)', r.status === 200 && r.text === 'OK');

const log = ['1001\t2026-09-10 08:58:00\t0\t1', '1001\t2026-09-10 18:31:00\t1\t1',
  'ET002\t2026-09-10 21:50:00\t0\t15', 'ET002\t2026-09-11 06:02:00\t1\t15',
  '7777\t2026-09-10 09:00:00\t0\t1', '1009\t2026-09-10 09:00:00\t0\t1'].join('\n');
r = await call({ method: 'POST', query: { proto: 'adms', op: 'cdata', SN: 'ZK-AAA1', table: 'ATTLOG' }, body: log });
check('ATTLOG upload is answered OK: <count>', r.status === 200 && r.text === 'OK: 6', r.text);
const d1 = db.attendance['ET001|2026-09-10'];
check('attendance is marked automatically from the fingerprint punches', d1 && d1.status === 'Present' && d1.inTime === '08:58' && d1.outTime === '18:31', JSON.stringify(d1));
check('overtime from the punches is held for approval (1.0 h)', d1 && d1.otPendingHours === 1 && d1.otHours === 0, d1 && JSON.stringify(d1));
const d2 = db.attendance['ET002|2026-09-10'];
check('a night-shift face punch pair is one day, matched by Employee ID', d2 && d2.dayFraction === 1 && d2.outTime === '06:02' && !db.attendance['ET002|2026-09-11']);
check('an unknown user ID is stored, not dropped, and marks nobody', Object.values(db.punches).some(p => p.user_id === '7777' && p.emp_id === '') && !Object.keys(db.attendance).some(k => k.startsWith('|')));
check('an exited employee is not marked', !db.attendance['ET009|2026-09-10']);

await call({ method: 'POST', query: { proto: 'adms', op: 'cdata', SN: 'ZK-AAA1', table: 'ATTLOG' }, body: log });
check('the same log sent again adds no punches', Object.keys(db.punches).length === 6 && db.devices['ZK-AAA1'].punches === 6);

// a day HR marked by hand
db.attendance['ET001|2026-09-11'] = { id: 'ET001|2026-09-11', empId: 'ET001', day: '2026-09-11', status: 'Absent', dayFraction: 1 };
await call({ method: 'POST', query: { proto: 'adms', op: 'cdata', SN: 'ZK-AAA1', table: 'ATTLOG' }, body: '1001\t2026-09-11 09:02:00\t0\t1\n1001\t2026-09-11 17:31:00\t1\t1' });
const d3 = db.attendance['ET001|2026-09-11'];
check('a hand-marked day is not overwritten by the device', d3.status === 'Absent' && !d3.source);
check('…but what the device saw is noted on it', d3.deviceIn === '09:02' && d3.devicePunches === 2);

// Hikvision face terminal with a key
r = await call({ method: 'POST', query: { what: 'devices' }, headers: { 'x-auth-token': 'ADMIN' },
  body: { device: { name: 'Canteen face terminal', type: 'face', protocol: 'hik', vendor: 'Hikvision' } } });
check('a key-based device gets a generated serial and a key, shown once', r.status === 200 && /^DEV-/.test(r.json.sn) && r.json.key.length > 20);
const hikKey = r.json.key, hikSn = r.json.sn;
check('only the hash of the key is stored', db.devices[hikSn].data.keyHash && !JSON.stringify(db.devices[hikSn]).includes(hikKey));
r = await call({ method: 'POST', query: { proto: 'hik', key: 'wrong' }, headers: { 'content-type': 'application/json' }, body: hikJson });
check('a wrong key is refused', r.status === 401);
db.employees.push({ empId: 'ET003', name: 'Asha', shift: 'General', status: 'Active', biometricId: '2002' });
r = await call({ method: 'POST', query: { proto: 'hik', key: hikKey }, headers: { 'content-type': 'application/json' }, body: hikJson });
check('the face terminal marks attendance with the right key', r.status === 200 && r.json.marked === 1 && db.attendance['ET003|2026-09-10'] && db.attendance['ET003|2026-09-10'].methods.includes('face'), JSON.stringify(r.json));

// re-matching after a biometric ID is added
db.employees.push({ empId: 'ET004', name: 'New starter', shift: 'General', status: 'Active', biometricId: '7777' });
r = await call({ method: 'POST', query: { what: 'reprocess' }, headers: { 'x-auth-token': 'ADMIN' }, body: { from: '2026-09-10', to: '2026-09-10' } });
check('marking a period again re-matches punches to a newly added Biometric ID', r.status === 200 && r.json.rematched === 1 && db.attendance['ET004|2026-09-10'], JSON.stringify(r.json));

// overtime approval
r = await call({ method: 'POST', query: { what: 'approveOt' }, headers: { 'x-auth-token': 'ADMIN' }, body: { empId: 'ET001', day: '2026-09-10', hours: 1 } });
check('approving overtime puts it where payroll reads it', r.status === 200 && db.attendance['ET001|2026-09-10'].otHours === 1 && db.attendance['ET001|2026-09-10'].otApprovedBy === 'asha');
await call({ method: 'POST', query: { what: 'reprocess' }, headers: { 'x-auth-token': 'ADMIN' }, body: { from: '2026-09-10', to: '2026-09-10' } });
check('…and survives the day being marked again', db.attendance['ET001|2026-09-10'].otHours === 1);

// import from a device's exported log
r = await call({ method: 'POST', query: { what: 'import' }, headers: { 'x-auth-token': 'STAFF' },
  body: { punches: [{ userId: '1001', time: '2026-09-12 09:00' }, { userId: '1001', time: '2026-09-12 17:35' }] } });
check('an exported device log imported from Bulk Upload marks attendance the same way', r.status === 200 && db.attendance['ET001|2026-09-12'] && db.attendance['ET001|2026-09-12'].outTime === '17:35');
check('every administrator action is audited', ['device.register', 'attendance.reprocess', 'attendance.ot.approve', 'punches.import'].every(w => db.audit.some(a => a.what === w)));
r = await call({ query: { what: 'devices' } });
check('the device list needs a sign-in', r.status === 401);
r = await call({ query: { what: 'devices' }, headers: { 'x-auth-token': 'STAFF' } });
check('the device list never returns a key hash', r.status === 200 && !JSON.stringify(r.json).includes('keyHash'));

let pass = 0;
for (const [n, ok, x] of results) { console.log((ok ? '  ok ' : '  x  ') + n + (ok ? '' : '   [' + x + ']')); if (ok) pass++; }
console.log(`\n${pass} passed, ${results.length - pass} failed, of ${results.length}`);
