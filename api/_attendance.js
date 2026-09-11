// Attendance from biometric / face-recognition punches.
//
// No database and no network in this file: it only turns what a device sends
// into punches, and a person's punches for one working day into the attendance
// record payroll already reads. api/device.js does the storing. Keeping the
// arithmetic here means the tests exercise exactly the code that runs.
//
// The record written is the SAME shape the HR attendance sheet writes —
// { empId, day, status, dayFraction, otHours, late } — so the existing payroll
// (attendanceSummary / calcPayslip on the website) counts a device-marked day
// with no change. Everything else on it (in/out times, punches, flags) is extra
// detail for people, ignored by payroll.

const pad = n => String(n).padStart(2, '0');

/* 'YYYY-MM-DD HH:MM[:SS]' or 'YYYY-MM-DDTHH:MM…' (no zone) → minutes since
   1970-01-01 00:00 treated as wall-clock time. All working-day arithmetic is
   done on the plant's wall clock, never on UTC, so a night shift never lands
   on the wrong date because the server runs in another zone. */
export function wallMinutes(t) {
  const m = String(t || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  return Math.floor(ms / 60000);
}
export function wallString(mins) {
  const d = new Date(mins * 60000);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' +
    pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':00';
}
const hm = s => { const m = String(s || '').match(/^(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null; };

/* A timestamp that carries its own zone (Hikvision sends
   2026-09-11T09:02:11+05:30) is moved onto the plant's wall clock. */
export function toPlantWall(iso, plantOffsetMin) {
  const s = String(iso || '').trim();
  if (!/([zZ]|[+-]\d{2}:?\d{2})$/.test(s)) {
    /* no zone: it is already the plant's wall clock — just normalise it */
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
    return m ? m[1] + '-' + m[2] + '-' + m[3] + ' ' + pad(m[4]) + ':' + m[5] + ':' + (m[6] || '00') : null;
  }
  const ms = Date.parse(s);
  if (isNaN(ms)) return null;
  const d = new Date(ms + (Number(plantOffsetMin) || 0) * 60000);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' +
    pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
}

/* ---------------- what devices send ---------------- */

/* ZKTeco / eSSL / Identix / Realtime and other "ADMS push" (iclock) devices.
   One punch per line, tab separated: PIN, time, status, verify, workcode, …
   The time is the device's own wall clock. */
const ZK_VERIFY = { 0: 'password', 1: 'fingerprint', 2: 'card', 3: 'password', 4: 'card', 15: 'face', 25: 'palm' };
const ZK_STATUS = { 0: 'in', 1: 'out', 2: 'break-out', 3: 'break-in', 4: 'ot-in', 5: 'ot-out' };
export function parseAdmsAttlog(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach(line => {
    const f = line.split('\t');
    if (f.length < 2) return;
    const userId = String(f[0] || '').trim();
    const time = String(f[1] || '').trim();
    if (!userId || wallMinutes(time) === null) return;
    out.push({ userId, time: time.length === 16 ? time + ':00' : time.slice(0, 19),
      direction: ZK_STATUS[Number(f[2])] || '', method: ZK_VERIFY[Number(f[3])] || 'device' });
  });
  return out;
}

/* Hikvision face / fingerprint terminals (DS-K1T… and similar), "HTTP
   listening" event push. The event arrives as JSON, or as multipart form-data
   whose event_log part is that JSON. Only a person the terminal actually
   recognised has an employeeNoString; a stranger or a failed match has none
   and is not a punch. */
export function parseHikEvent(raw, contentType, plantOffsetMin) {
  let text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
  if (/multipart\/form-data/i.test(contentType || '')) {
    const start = text.indexOf('{'), end = text.lastIndexOf('}');
    text = start >= 0 && end > start ? text.slice(start, end + 1) : '';
  }
  let j;
  try { j = JSON.parse(text); } catch (e) { return []; }
  const events = Array.isArray(j) ? j : [j];
  const out = [];
  events.forEach(ev => {
    const a = (ev && (ev.AccessControllerEvent || ev.accessControllerEvent)) || null;
    if (!a) return;
    const userId = String(a.employeeNoString || a.employeeNo || '').trim();
    if (!userId || userId === '0') return;
    const time = toPlantWall(ev.dateTime || a.dateTime, plantOffsetMin);
    if (!time) return;
    const mode = String(a.currentVerifyMode || '').toLowerCase();
    const method = /face/.test(mode) ? 'face' : /finger|fp/.test(mode) ? 'fingerprint' : /card/.test(mode) ? 'card' : 'face';
    const st = String(a.attendanceStatus || '').toLowerCase();
    const direction = st === 'checkin' ? 'in' : st === 'checkout' ? 'out' : st === 'breakout' ? 'break-out'
      : st === 'breakin' ? 'break-in' : st === 'overtimein' ? 'ot-in' : st === 'overtimeout' ? 'ot-out' : '';
    out.push({ userId, time, direction, method });
  });
  return out;
}

/* Anything else — a vendor's own cloud webhook, a middleware such as eTimeTrack
   or BioStar, or the bulk upload of a device's exported log:
     { punches: [ { userId, time, direction?, method? }, … ] } */
export function parseJsonPunches(body, plantOffsetMin) {
  const list = Array.isArray(body) ? body : (body && (body.punches || (body.userId ? [body] : []))) || [];
  const out = [];
  list.forEach(p => {
    const userId = String((p && (p.userId || p.employeeNo || p.biometricId || p.pin)) || '').trim();
    const time = toPlantWall(p && (p.time || p.dateTime || p.punchTime), plantOffsetMin);
    if (!userId || !time) return;
    out.push({ userId, time, direction: String(p.direction || '').toLowerCase(),
      method: String(p.method || 'device').toLowerCase(), deviceSn: p.deviceSn || '' });
  });
  return out;
}

/* ---------------- shifts and the working day ---------------- */

/* The employee's shift, found by code or name in the shift master; the
   policy's default shift, or the first shift, when their record names none. */
export function shiftFor(emp, shifts, defaultCode) {
  const list = Array.isArray(shifts) && shifts.length ? shifts
    : [{ code: 'GEN', name: 'General', start: '09:00', end: '17:30', breakMin: 30 }];
  const want = String((emp && emp.shift) || '').trim().toLowerCase();
  const byKey = k => list.find(s => String(s.code || '').toLowerCase() === k || String(s.name || '').toLowerCase() === k);
  return (want && byKey(want)) || (defaultCode && byKey(String(defaultCode).toLowerCase())) || list[0];
}

/* Which working day a punch belongs to. On a shift that crosses midnight
   (22:00–06:00), a punch in the early hours is the end of the PREVIOUS day's
   shift — otherwise every night-shift worker would show as two half days. */
export function workDayFor(time, shift) {
  const t = wallMinutes(time);
  if (t === null) return '';
  const day = wallString(t).slice(0, 10);
  const s = hm(shift && shift.start), e = hm(shift && shift.end);
  if (s !== null && e !== null && e <= s) {
    const tod = t % 1440;
    if (tod < e + 240) return wallString(t - 1440).slice(0, 10);  // up to 4 h after shift end
  }
  return day;
}

/* ---------------- one person, one working day ---------------- */
export const DEFAULT_POLICY = {
  lateGraceMin: 10,        // from the leave policy on the HR masters
  halfDayAfterMin: 120,    // arriving later than this counts as half a day
  dedupeMinutes: 2,        // a second scan within this is the same punch
  otMinMinutes: 30,        // overtime shorter than this is not overtime
  otStepMinutes: 30,       // overtime is counted in these steps, rounded down
  autoOt: false,           // false: overtime waits for approval before payroll sees it
  missedPunch: 'present'   // a single punch: 'present' (flagged) or 'half'
};

export function summariseDay(punches, shift, day, policyIn) {
  const policy = Object.assign({}, DEFAULT_POLICY, policyIn || {});
  const times = punches.map(p => ({ p, t: wallMinutes(p.time) })).filter(x => x.t !== null)
    .sort((a, b) => a.t - b.t);
  const kept = [];
  times.forEach(x => {
    if (!kept.length || x.t - kept[kept.length - 1].t >= Number(policy.dedupeMinutes || 0)) kept.push(x);
  });
  if (!kept.length) return null;

  const dayStart = wallMinutes(day + ' 00:00');
  const s = hm(shift.start), e = hm(shift.end);
  const shiftStart = dayStart + (s === null ? 540 : s);
  let shiftEnd = dayStart + (e === null ? 1050 : e);
  if (shiftEnd <= shiftStart) shiftEnd += 1440;
  const breakMin = Number(shift.breakMin || 0);
  const shiftMin = Math.max(60, shiftEnd - shiftStart - breakMin);

  const first = kept[0].t, last = kept[kept.length - 1].t;
  const single = kept.length === 1;
  const span = single ? 0 : last - first;
  const worked = single ? 0 : Math.max(0, span - (span > 300 ? breakMin : 0));
  const lateMin = Math.max(0, first - shiftStart);
  const late = lateMin > Number(policy.lateGraceMin || 0);
  const earlyOutMin = single ? 0 : Math.max(0, shiftEnd - last);

  let dayFraction = 1;
  const reasons = [];
  if (lateMin > Number(policy.halfDayAfterMin || 0) && Number(policy.halfDayAfterMin || 0) > 0) {
    dayFraction = 0.5; reasons.push('arrived ' + lateMin + ' min after the shift started');
  }
  if (!single && worked < shiftMin / 2) { dayFraction = 0.5; reasons.push('worked ' + (Math.round(worked / 6) / 10) + ' h of a ' + (Math.round(shiftMin / 6) / 10) + ' h shift'); }
  if (single && policy.missedPunch === 'half') { dayFraction = 0.5; reasons.push('only one punch'); }

  const step = Math.max(1, Number(policy.otStepMinutes || 30));
  let otMin = single ? 0 : Math.max(0, worked - shiftMin);
  otMin = otMin >= Number(policy.otMinMinutes || 0) ? Math.floor(otMin / step) * step : 0;
  const otHours = Math.round(otMin / 6) / 10;

  return {
    status: 'Present', dayFraction,
    inTime: wallString(first).slice(11, 16), outTime: single ? '' : wallString(last).slice(11, 16),
    workedHours: Math.round(worked / 6) / 10, lateMin, late, earlyOutMin,
    otHours: policy.autoOt ? otHours : 0, otPendingHours: policy.autoOt ? 0 : otHours,
    missedPunch: single, halfDayReason: reasons.join('; '),
    punchCount: kept.length, methods: [...new Set(kept.map(x => x.p.method).filter(Boolean))],
    shift: shift.code || shift.name || ''
  };
}

/* The record to write, or null when it must not be written. A day somebody
   has marked or corrected by hand (source other than 'device') is never
   overwritten by a machine — the punches are still stored, and the day is
   flagged so HR can see the device disagrees. An approved overtime figure
   survives a later punch arriving for the same day. */
export function attendanceRecord(existing, summary, empId, day, deviceNames) {
  if (existing && existing.source && existing.source !== 'device') return null;
  if (existing && !existing.source) return null;       // written by the HR sheet before devices existed
  const rec = Object.assign({ id: empId + '|' + day, empId, day }, summary, {
    source: 'device', devices: deviceNames || [], markedAt: new Date().toISOString() });
  if (existing && existing.otApprovedHours !== undefined) {
    rec.otApprovedHours = existing.otApprovedHours;
    rec.otHours = existing.otApprovedHours;
    rec.otApprovedBy = existing.otApprovedBy || '';
  }
  return rec;
}
