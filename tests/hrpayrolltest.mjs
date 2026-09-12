/* HR & Payroll as a native IDMS workspace, its Attendance Register and
   Attendance Devices screens, and the Employee / device-log bulk uploads.

     - HR & Payroll is a tile workspace, not the framed website page; the old
       emb_hr address and permission still land on it
     - engine-backed screens open one HR tab at a time (?embed=hr&tab=…)
     - the register shows the month the way payroll will count it: device and
       hand marks, half days, late, missed punch, pending overtime, leave,
       holidays and weekly offs
     - a correction needs a reason and becomes a hand mark; overtime approval
       and "mark again" go to the device engine
     - devices: rules saved, a Hikvision terminal registered and its key shown,
       a push device refused without a serial
     - employee bulk upload refuses what would corrupt the master and builds a
       pay structure from CTC; a device log imports in one call */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi  = fs.readFileSync('kpi.js', 'utf8');
const site = fs.readFileSync('index.html', 'utf8');
const results = [];
const check = (n, c, x) => results.push([n, !!c, x || '']);
const wait = ms => new Promise(r => setTimeout(r, ms));
const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => { if (!/navigation|Not implemented: HTMLIFrame/i.test(e.message)) pageErrors.push(e.message); });
const dom = new JSDOM(html.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''),
  { runScripts: 'outside-only', url: 'https://works.example/idms.html', virtualConsole: vc });
const { window } = dom;
window.Element.prototype.scrollIntoView = function () {};
window.confirm = () => true;
let opened = [];
window.open = () => ({ document: { write: h => opened.push(h), close() {} }, print() {} });

const now = new Date();
const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const M = prev.getFullYear() + '-' + String(prev.getMonth() + 1).padStart(2, '0');
const D = n => M + '-' + String(n).padStart(2, '0');
const firstSunday = (() => { for (let d = 1; d <= 7; d++) if (new Date(D(d) + 'T00:00:00').getDay() === 0) return d; })();
const workday = n => { let d = n; while (new Date(D(d) + 'T00:00:00').getDay() === 0 || d === 15) d++; return d; };
const d1 = workday(2), d2 = workday(d1 + 1), d3 = workday(d2 + 1), d4 = workday(d3 + 1), d5 = workday(d4 + 1);

let employees = [
  { empId: 'ET001', name: 'Ravi Kumar', department: 'Production', shift: 'General', status: 'Active', biometricId: '1001' },
  { empId: 'ET002', name: 'Meena S', department: 'Quality', shift: 'Shift C', status: 'Active' },
  { empId: 'ET009', name: 'Gone Away', department: 'Production', status: 'Exited' }];
let attendance = [
  { empId: 'ET001', day: D(d1), status: 'Present', dayFraction: 1, source: 'device', inTime: '08:58', outTime: '18:31', otHours: 0, otPendingHours: 1, devices: ['ZK1'] },
  { empId: 'ET001', day: D(d2), status: 'Present', dayFraction: 0.5, source: 'device', inTime: '11:40', outTime: '17:30', late: true, lateMin: 160 },
  { empId: 'ET001', day: D(d3), status: 'Present', dayFraction: 1, source: 'device', inTime: '09:20', late: true, lateMin: 20, missedPunch: true },
  { empId: 'ET001', day: D(d4), status: 'Absent', dayFraction: 1 },
  { empId: 'ET002', day: D(d1), status: 'Present', dayFraction: 1, source: 'manual', correctedBy: 'asha' }];
const leave = [{ leave_id: 'LV1', emp_id: 'ET002', status: 'Approved', data: { type: 'CL', from: D(d2), to: D(d3) } }];
const content = { shifts: [{ code: 'GEN', name: 'General', start: '09:00', end: '17:30', breakMin: 30 },
                           { code: 'C', name: 'Shift C', start: '22:00', end: '06:00', breakMin: 30 }],
  holidays: [{ date: D(15), name: 'Festival' }], leavePolicy: { weekOff: [0], lateGraceMin: 10, halfDayAfterMin: 120 },
  hrMasters: { empIdPrefix: 'ET', empIdPad: 3, empIdNextSeq: 1 },
  salaryStructure: { basicPct: 50, daPct: 0, hraPct: 20, conveyance: 1600 } };
let devices = [
  { sn: 'ZK1', registered: true, data: { name: 'Main gate', type: 'biometric', vendor: 'ZKTeco', protocol: 'adms' }, lastSeen: new Date().toISOString(), punches: 40 },
  { sn: 'NEWZK9', registered: false, data: { protocol: 'adms' }, lastSeen: new Date().toISOString(), punches: 0 }];
const calls = [];
let settingsStore = {};
const orgRows = [{ doc_id: 'o1', data: { type: 'department', name: 'Production' } }, { doc_id: 'o2', data: { type: 'department', name: 'Quality' } },
                 { doc_id: 'o3', data: { type: 'designation', name: 'CNC Operator' } }];

window.fetch = async (path, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : {};
  const url = String(path);
  const method = opts.method || 'GET';
  calls.push({ url, method, body });
  const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
  if (url.startsWith('/api/auth')) return ok({ token: 'T', user: 'asha', role: 'developer' });
  if (url.startsWith('/api/content')) return ok({ data: content });
  if (url.startsWith('/api/hr')) {
    if (url.includes('what=employees') && method === 'GET') return ok({ employees });
    if (body.what === 'employees') { const i = employees.findIndex(e => e.empId === body.employee.empId);
      if (i >= 0) employees[i] = body.employee; else employees.push(body.employee); return ok({ empId: body.employee.empId }); }
    if (url.includes('what=attendance')) return ok({ attendance });
    if (body.what === 'attendance') { body.records.forEach(r => { const i = attendance.findIndex(a => a.empId === r.empId && a.day === r.day);
      if (i >= 0) attendance[i] = r; else attendance.push(r); }); return ok({ saved: body.records.length }); }
    if (url.includes('what=leave')) return ok({ leave });
    return ok({});
  }
  if (url.startsWith('/api/device')) {
    if (url.includes('what=devices') && method === 'GET') return ok({ devices });
    if (url.includes('what=devices') && method === 'POST') {
      const d = body.device; const sn = d.sn || 'DEV-ABC123';
      devices = devices.filter(x => x.sn !== sn).concat([{ sn, registered: true, data: d, punches: 0 }]);
      return ok({ sn, key: d.protocol === 'adms' ? '' : 'KEY-shown-once-123' });
    }
    if (url.includes('what=punches')) return ok({
      punches: [{ emp_id: 'ET001', user_id: '1001', device_sn: 'ZK1', punch_at: D(d1) + ' 18:31:00', method: 'fingerprint', direction: 'out' },
                { emp_id: 'ET001', user_id: '1001', device_sn: 'ZK1', punch_at: D(d1) + ' 08:58:00', method: 'fingerprint', direction: 'in' }],
      unmatched: [{ user_id: '7777', device_sn: 'ZK1', n: 3 }] });
    if (url.includes('what=approveOt')) { const a = attendance.find(x => x.empId === body.empId && x.day === body.day);
      Object.assign(a, { otHours: body.hours, otPendingHours: 0, otApprovedHours: body.hours }); return ok({}); }
    if (url.includes('what=reprocess')) return ok({ marked: 12, rematched: 3, keptManual: 1 });
    if (url.includes('what=import')) return ok({ received: body.punches.length, stored: body.punches.length, marked: 1, unmatched: [] });
    return ok({});
  }
  if (url.startsWith('/api/idms')) {
    if (url.includes('what=settings') && method !== 'POST') return ok({ settings: settingsStore });
    if (body.what === 'settings') { settingsStore[body.key] = body.data; return ok({}); }
    if (url.includes('kind=orgmaster')) return ok({ docs: orgRows });
    if (url.includes('what=parts')) return ok({ parts: [] });
    return ok({ docs: [] });
  }
  return ok({});
};

window.eval(core); window.eval(kpi);
window.eval(html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1]);
const $ = id => window.document.getElementById(id);
const click = el => el && el.dispatchEvent(new window.Event('click', { bubbles: true }));
const change = el => el && el.dispatchEvent(new window.Event('change', { bubbles: true }));
const go = s => { window.history.pushState(null, '', '#s=' + s); window.dispatchEvent(new window.PopStateEvent('popstate')); };
const onPanel = () => (window.document.querySelector('.panel.on') || {}).dataset?.panel;

await wait(150);
$('g-user').value = 'asha'; $('g-pass').value = 'password1';
click($('g-go')); await wait(400);

/* ---------------- the workspace ---------------- */
const hrm = [...window.document.querySelectorAll('.mgroup')].find(g => /HRM/.test(g.textContent));
check('HRM → HR & Payroll is the native workspace', !!hrm.querySelector('a[data-s="hr_payroll"]') && !hrm.querySelector('a[data-s="emb_hr"]'));
go('emb_hr'); await wait(400);
check('the old framed-page address lands on the native workspace', onPanel() === 'hr_payroll');
const tiles = [...window.document.querySelectorAll('.hp-tile')];
check('the workspace is square tiles with pictures', tiles.length >= 15 && tiles.every(t => t.querySelector('svg')));
['Attendance Register', 'Attendance Devices', 'Payroll', 'Employee Bulk Upload', 'Statutory & Masters', 'Leave & Permission']
  .forEach(n => check('tile: ' + n, tiles.some(t => t.textContent.includes(n))));
await wait(200);
check('today at a glance shows devices reporting and unmatched IDs', /1 \/ 1/.test($('hp-status').textContent) && /matched to nobody/.test($('hp-status').textContent) &&
  /not registered/.test($('hp-status').textContent), $('hp-status').textContent);

const tileByKey = k => window.document.querySelector('.hp-tile[data-key="' + k + '"]');
click(tileByKey('payroll')); await wait(100);
check('Payroll opens inside the workspace, one HR screen only', $('hp-frame').getAttribute('src') === '/?embed=hr&tab=payroll' && $('hp-v-frame').style.display === '');
check('the website hides its own tab bar for a one-screen embed', /body\.embed-onetab #hr-groups, body\.embed-onetab \.hr-tabbar\{display:none/.test(site) &&
  /embed==='hr'&&one/.test(site));
click($('hp-back')); await wait(100);
check('back returns to the tiles and unloads the frame', $('hp-home').style.display === '' && !$('hp-frame').getAttribute('src'));

click(tileByKey('empbulk')); await wait(300);
check('Employee Bulk Upload tile opens Bulk Upload on the Employees category', onPanel() === 'bulk_upload' && $('bu-kind').value === 'employee' && $('bu-work').style.display === '');
go('hr_payroll'); await wait(300);
click(tileByKey('emp')); await wait(300);
check('Employees tile opens the People screen', onPanel() === 'hrm');

/* ---------------- Attendance Register ---------------- */
go('hr_payroll'); await wait(300);
click(tileByKey('att')); await wait(100);
$('ha-month').value = M; change($('ha-month')); await wait(300);
const grid = $('ha-grid');
const rowOf = id => [...grid.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes(id));
const cellOf = (id, n) => rowOf(id).children[n].querySelector('.ha-c');
check('the register lists active employees, not an exited one', !!rowOf('ET001') && !!rowOf('ET002') && !rowOf('ET009'));
check('a device-marked day is P (device)', /\bp\b/.test(cellOf('ET001', d1).className) && cellOf('ET001', d1).classList.contains('dev'));
check('overtime waiting shows +1 under the day', rowOf('ET001').children[d1].textContent.includes('+1'));
check('a half day shows ½ and is late', cellOf('ET001', d2).textContent === '½' && cellOf('ET001', d2).classList.contains('late'));
check('a missed punch is flagged', cellOf('ET001', d3).classList.contains('miss'));
check('an absent mark shows A', cellOf('ET001', d4).textContent === 'A');
check('a hand-marked day shows as marked by hand', cellOf('ET002', d1).classList.contains('man'));
check('approved leave shows its code', cellOf('ET002', d2).textContent === 'CL');
check('a holiday shows H', cellOf('ET001', 15).textContent === 'H');
check('a weekly off shows W', cellOf('ET001', firstSunday).textContent === 'W');
check('an unmarked working day shows – (payroll counts it absent)', cellOf('ET001', d5).textContent === '–');
const n = new Date(prev.getFullYear(), prev.getMonth() + 1, 0).getDate();
check('present days count a half day as half (2.5), late 2, missed 1, OT waiting 1',
  rowOf('ET001').children[n + 1].textContent === '2.5' && rowOf('ET001').children[n + 2].textContent === '2' &&
  rowOf('ET001').children[n + 3].textContent === '1' && rowOf('ET001').children[n + 5].textContent === '1',
  [...rowOf('ET001').children].slice(n + 1).map(c => c.textContent).join('|'));

click(cellOf('ET001', d1)); await wait(200);
const det = $('ha-detail');
check('pressing a day shows its punches, in and out', /08:58/.test(det.textContent) && /18:31/.test(det.textContent) && /fingerprint/.test(det.textContent));
check('…who marked it', /Device \(ZK1\)/.test(det.textContent));
$('ha-othours').value = '1';
click($('ha-otok')); await wait(250);
check('approving overtime goes to the device engine', calls.some(c => c.url.includes('what=approveOt') && c.body.empId === 'ET001' && c.body.day === D(d1) && c.body.hours === 1));

click(cellOf('ET001', d5)); await wait(200);
$('ha-fix').value = 'P';
click($('ha-fixok')); await wait(150);
check('a correction without a reason is refused', !calls.some(c => c.body.what === 'attendance'));
$('ha-why').value = 'forgot to punch, confirmed by supervisor';
click($('ha-fixok')); await wait(300);
const fixed = calls.find(c => c.body.what === 'attendance');
check('a correction is saved as a hand mark with the reason', fixed && fixed.body.manual === true && fixed.body.records[0].source === 'manual' &&
  fixed.body.records[0].status === 'Present' && /forgot to punch/.test(fixed.body.reason));
check('…and the register now shows it', cellOf('ET001', d5).classList.contains('man'));

click($('ha-reprocess')); await wait(250);
check('mark the month again goes to the engine for the whole month', calls.some(c => c.url.includes('what=reprocess') && c.body.from === M + '-01') &&
  /12 day/.test($('ha-msg').textContent) && /3 punch/.test($('ha-msg').textContent));
$('ha-dept').value = 'Quality'; change($('ha-dept')); await wait(50);
check('the department filter narrows the register', !rowOf('ET001') && !!rowOf('ET002'));
opened = [];
click($('ha-print')); await wait(100);
check('the register prints', opened.join('').includes('Attendance Register'));

/* ---------------- Attendance Devices ---------------- */
click($('hp-back')); await wait(100);
click(tileByKey('dev')); await wait(400);
check('the device list shows a reporting device and one waiting to be registered',
  /Reporting/.test($('hd-list').textContent) && /Calling in — not registered/.test($('hd-list').textContent));
check('unmatched device IDs are named with what to do', /7777/.test($('hd-unmatched').textContent) && /Biometric \/ Face ID/.test($('hd-unmatched').textContent));
check('the shift choice comes from the HR shift master', [...$('hd-shift').options].some(o => o.value === 'C'));

$('hd-equip').value = 'face'; change($('hd-equip'));
$('hd-autoot').value = 'yes'; $('hd-otmin').value = '45';
click($('hd-savecfg')); await wait(200);
check('the plant rules are saved to the database', settingsStore.attendance_devices && settingsStore.attendance_devices.equipment === 'face' &&
  settingsStore.attendance_devices.policy.autoOt === true && settingsStore.attendance_devices.policy.otMinMinutes === 45);
check('choosing face equipment sets new devices to face', $('hd-type').value === 'face');

click([...$('hd-list').querySelectorAll('.hd-reg')][0]); await wait(50);
check('Register on a waiting device fills its serial into the form', $('hd-sn').value === 'NEWZK9');
$('hd-sn').value = ''; $('hd-name').value = 'Store door'; $('hd-make').value = 'eSSL'; change($('hd-make'));
click($('hd-save')); await wait(150);
check('a push device without a serial is refused', /serial number is needed/.test($('hd-msg').textContent));
$('hd-make').value = 'Hikvision'; change($('hd-make'));
check('choosing Hikvision switches the connection to Hikvision push', $('hd-proto').value === 'hik');
$('hd-name').value = 'Canteen face terminal';
click($('hd-save')); await wait(300);
check('a Hikvision terminal is registered', calls.some(c => c.url.includes('what=devices') && c.method === 'POST' && c.body.device.protocol === 'hik'));
check('its URL and key are shown once, on this site\'s own address', /https:\/\/works\.example\/api\/device\?proto=hik&amp;key=KEY-shown-once-123/.test($('hd-howto').innerHTML) &&
  /shown only once/.test($('hd-howto').textContent));
$('hd-proto').value = 'adms'; change($('hd-proto'));
check('the push instructions name this host, port 443 and HTTPS, and the plain-HTTP limitation',
  /works\.example/.test($('hd-howto').textContent) && /443/.test($('hd-howto').textContent) && /HTTPS/.test($('hd-howto').textContent) &&
  /Import Device Log/.test($('hd-howto').textContent));

/* ---------------- the step-by-step connect guide ---------------- */
const hdGuide = window.document.getElementById('hd-guide');
check('the guide is laid out as six numbered steps',
  hdGuide.querySelectorAll('.cs-step').length === 6, String(hdGuide.querySelectorAll('.cs-step').length));
check('step 1 is open by default',
  hdGuide.querySelector('.cs-step[data-hdstep="1"]').classList.contains('open'));
click(hdGuide.querySelector('.cs-step[data-hdstep="2"] .h'));
check('clicking a step heading opens it',
  hdGuide.querySelector('.cs-step[data-hdstep="2"]').classList.contains('open'));
click(hdGuide.querySelector('[data-hdnext="1"]'));
check('the "next" button on step 1 marks it done and opens step 2',
  hdGuide.querySelector('.cs-step[data-hdstep="1"]').classList.contains('done') &&
  hdGuide.querySelector('.cs-step[data-hdstep="2"]').classList.contains('open'));
check('the guide\'s own "next" buttons do not touch the CNC setup guide\'s steps',
  !window.document.querySelector('.panel[data-panel="cnc_setup"] .cs-step[data-step="1"]').classList.contains('done'));

/* ---------------- People: Biometric ID ---------------- */
go('hrm'); await wait(400);
check('People has a Bulk upload employees button', !!$('hr-bulk'));
check('the employee record has a Biometric / Face ID box', !!$('he-bio'));

/* ---------------- Employee bulk upload ---------------- */
async function upload(csv){
  const file = new window.File([csv], 'upload.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: async () => csv });
  Object.defineProperty($('bu-file'), 'files', { value: [file], configurable: true });
  $('bu-file').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(300);
}
const errs = () => [...$('bu-preview').querySelectorAll('.bu-row-err')].map(e => e.textContent).join(' | ');
go('bulk_upload'); await wait(300);
click(window.document.querySelector('#bu-tiles .bu-tile[data-kind="employee"]')); await wait(100);
check('the Employees tile says records land on People', /People/.test($('bu-workdest').textContent));
const H = 'EmpId,Name*,Designation,Department,DateOfJoining,DateOfBirth,Gender,Status,EmploymentType,Shift,BiometricId,Phone,Email,ReportsTo,Grade,Location,AnnualCTC,Basic,DA,HRA,Conveyance,Special,OtherAllowance,UAN,PFNumber,ESINumber,PAN,BankName,BankAccount,IFSC,PFApplicable,ESIApplicable,PTApplicable,TaxRegime';
const row = o => { const cols = H.split(','); return cols.map(c => (o[c.replace('*', '')] || '')).join(','); };
await upload([H,
  row({ Name: 'Anil Rao', Designation: 'CNC Operator', Department: 'Production', DateOfJoining: '01-09-2026', DateOfBirth: '14-02-1996', Shift: 'Shift C', BiometricId: '2001', AnnualCTC: '300000', PAN: 'ABCDE1234F', IFSC: 'HDFC0001234', UAN: '100200300400' }),
  row({ EmpId: 'ET001', Name: 'Duplicate Ravi' }),
  row({ Name: 'Same Device', BiometricId: '1001' }),
  row({ Name: 'Bad Pan', PAN: 'ABC123' }),
  row({ Name: 'Wrong Dept', Department: 'Marketing' }),
  row({ Name: 'Wrong Shift', Shift: 'Night' }),
  row({ Name: 'Too Young', DateOfJoining: '01-09-2026', DateOfBirth: '01-01-2015' }),
  row({ Name: 'Priya N', Department: 'quality', Basic: '20000', HRA: '8000', BiometricId: '2002', Status: 'Probation' })
].join('\n'));
const sum = $('bu-preview').querySelector('.bu-summary').textContent;
check('two employees ready, six refused', /2\s*ready/.test(sum) && /6\s*need fixing/.test(sum), sum + ' ' + errs());
check('an Employee ID on file is refused, never overwritten', /ET001 is already Ravi Kumar/.test(errs()));
check('a Biometric ID already used is refused', /Biometric ID 1001 already belongs to Ravi Kumar/.test(errs()));
check('a malformed PAN is refused', /PAN "ABC123"/.test(errs()));
check('a department not on the master is refused', /Department "Marketing" is not on the Department Master/.test(errs()));
check('a shift not on the shift master is refused', /Shift "Night" is not on the HR shift master/.test(errs()));
check('a child cannot be employed', /under 14/.test(errs()));
click($('bu-import')); await wait(400);
const added = employees.filter(e => e.name === 'Anil Rao' || e.name === 'Priya N');
check('both are saved to the HR employee master', added.length === 2);
const anil = added.find(e => e.name === 'Anil Rao') || {}, priya = added.find(e => e.name === 'Priya N') || {};
check('a blank Employee ID takes the next number in the HR series (ET001 used → ET002 used → ET003)', anil.empId === 'ET003', anil.empId);
check('the pay structure is built from CTC with the salary template', anil.structure && anil.structure.basic === 12500 && anil.structure.hra === 5000 &&
  anil.structure.conveyance === 1600 && anil.structure.special === 5900, JSON.stringify(anil.structure));
check('dates, shift, biometric ID and statutory IDs are stored', anil.doj === '2026-09-01' && anil.dob === '1996-02-14' && anil.shift === 'Shift C' &&
  anil.biometricId === '2001' && anil.pan === 'ABCDE1234F' && anil.pfApplicable === true);
check('a department is stored as the master spells it', priya.department === 'Quality' && priya.structure.basic === 20000 && priya.status === 'Probation');
check('after import there is a button to People', [...$('bu-msg').querySelectorAll('button')].some(b => /People/.test(b.textContent)) ||
  [...window.document.querySelectorAll('button')].some(b => b.textContent === 'Open People — HR records'));

/* ---------------- device log import ---------------- */
click($('bu-back')); await wait(50);
click(window.document.querySelector('#bu-tiles .bu-tile[data-kind="punches"]')); await wait(100);
await upload(['BiometricId*,DateTime*,Direction,DeviceSerial', `1001,${D(d5).split('-').reverse().join('-')} 08:59,In,ZK1`,
  `1001,${D(d5).split('-').reverse().join('-')} 17:34,Out,ZK1`, `9999,${D(d5).split('-').reverse().join('-')} 09:00,,`,
  `ET009,${D(d5).split('-').reverse().join('-')} 09:00,,`, `1001,31-02-2026 09:00,,`].join('\n'));
check('punches for unknown or exited people and impossible dates are refused', /No employee has Biometric ID or Employee ID "9999"/.test(errs()) &&
  /has exited/.test(errs()) && /is not DD-MM-YYYY HH:MM/.test(errs()), errs());
calls.length = 0;
click($('bu-import')); await wait(300);
const imp = calls.filter(c => c.url.includes('what=import'));
check('the good punches go to the device engine in one call', imp.length === 1 && imp[0].body.punches.length === 2 &&
  imp[0].body.punches[0].time === D(d5) + ' 08:59:00', JSON.stringify(imp.map(c => c.body)));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
let pass = 0;
for (const [nm, ok, x] of results) { console.log((ok ? '  ok ' : '  x  ') + nm + (ok ? '' : '   [' + x + ']')); if (ok) pass++; }
console.log(`\n${pass} passed, ${results.length - pass} failed, of ${results.length}`);
process.exit(0);
