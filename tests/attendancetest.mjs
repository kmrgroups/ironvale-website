/* Tests for the native Attendance & Pay Lookup panel, which replaced the
   "My Attendance" iframe. The iframe pointed at the website's own DOB-gated
   self-service form — fine for an employee scanning their ID card, useless
   for a manager who does not know anyone's date of birth. This panel calls
   the new role-gated /api/hr?what=lookup route instead, and reproduces the
   same present/leave/LOP reconciliation the employee sees of themselves, so
   the two screens cannot silently disagree. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi  = fs.readFileSync('kpi.js', 'utf8');

const results = [];
const check = (n, c, x) => results.push([n, !!c, x || '']);
const wait = ms => new Promise(r => setTimeout(r, ms));

const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => pageErrors.push(e.message));

const dom = new JSDOM(html.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''),
  { runScripts: 'outside-only', url: 'https://works.example/idms.html', virtualConsole: vc });
const { window } = dom;

let signedIn = false, lastLookupBody = null;
const employees = [
  { empId: 'E1', name: 'Asha Rao', designation: 'CNC Operator', department: 'Machining',
    doj: '2022-01-10', uan: 'UAN1', pfNumber: 'PF1', bankName: 'SBI', bankAcc: '000111', ifsc: 'SBIN0001' },
  { empId: 'E2', name: 'Bala Kumar', designation: 'Fitter', department: 'Maintenance' }
];
const attendance = [
  { day: '2026-08-01', status: 'Present', dayFraction: 1, otHours: 2 },
  { day: '2026-08-03', status: 'Absent' }
];
const leave = [{ from: '2026-08-05', to: '2026-08-05', type: 'CL', status: 'Approved' }];
const siteContent = { leavePolicy: { weekOff: [0], types: [{ code: 'CL', name: 'Casual Leave', annualDays: 12, paid: true }] },
  holidays: [{ date: '2026-08-15', name: 'Independence Day' }] };

window.fetch = async (path, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : {};
  const url = String(path);
  const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
  if (url.startsWith('/api/auth')) {
    if (body.action === 'login') { signedIn = true; return ok({ token: 'T', user: 'tester', role: 'developer' }); }
    if (body.action === 'session') return signedIn ? ok({ user: 'tester', role: 'developer' })
      : { ok: false, status: 401, json: async () => ({ error: 'Not signed in' }) };
    return ok({});
  }
  if (url.startsWith('/api/content')) return ok({ data: siteContent });
  if (url.startsWith('/api/hr')) {
    if (url.includes('what=employees')) return ok({ employees: employees.map(e => ({ data: e })) });
    if (body.what === 'lookup') {
      lastLookupBody = body;
      if (!opts.headers || !opts.headers['X-Auth-Token'])
        return { ok: false, status: 401, json: async () => ({ error: 'Sign in' }) };
      const e = employees.find(x => x.empId === body.empId);
      if (!e) return { ok: false, status: 404, json: async () => ({ error: 'No employee with that ID.' }) };
      return ok({ employee: e, attendance, leave, period: body.period || '2026-08' });
    }
    return ok({});
  }
  if (url.startsWith('/api/idms')) return ok({ parts: [], docs: [], settings: {} });
  return ok({});
};

window.eval(core); window.eval(kpi);
window.eval(html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1]);
window.Element.prototype.scrollIntoView = function () {};

const $ = id => window.document.getElementById(id);
const txt = el => (el ? el.textContent : '');
const click = el => el && el.dispatchEvent(new window.Event('click', { bubbles: true }));

await wait(150);
$('g-user').value = 'tester'; $('g-pass').value = 'password1';
click($('g-go')); await wait(300);

// ---- reached from the menu, not the frame ----
const live = [...window.document.querySelectorAll('#menubar a[data-s]')].map(a => a.dataset.s);
check('My Attendance is in the menu as a native screen', live.includes('attendance_lookup'));
check('the old iframe target is gone from the menu', !live.includes('emb_me'));

click([...window.document.querySelectorAll('#menubar a[data-s]')].find(a => a.dataset.s === 'attendance_lookup'));
await wait(250);
const panel = window.document.querySelector('.panel[data-panel="attendance_lookup"]');
check('the panel opens', panel && panel.classList.contains('on'));
check('it is not the embed panel', !window.document.querySelector('.panel[data-panel="embed"]').classList.contains('on'));

// ---- the employee picker ----
check('employees are listed for lookup, by name', /Asha Rao/.test(txt($('al-emp'))));
check('no date of birth is asked for anywhere on this screen',
  !/date of birth/i.test(panel.textContent) && !panel.querySelector('input[type="date"]#me-dob'));

// ---- no selection ----
click($('al-go')); await wait(80);
check('choosing nobody is refused with a plain message', /Choose an employee/i.test(txt($('al-msg'))));

// ---- a real lookup ----
$('al-emp').value = 'E1'; $('al-period').value = '2026-08';
click($('al-go')); await wait(200);

check('the lookup goes through the signed-in session, not a DOB',
  !!lastLookupBody && lastLookupBody.empId === 'E1' && !('dob' in lastLookupBody));
check('the employee name is shown', /Asha Rao/.test(txt($('al-result'))));
check('a present day is counted', /<b>1<\/b>\s*<span>Present<\/span>/.test(txt($('al-result')).replace(/\s+/g,' ')) || /Present/.test(txt($('al-result'))));
check('an absent day counts as loss of pay', /Loss of Pay/.test(txt($('al-result'))));
check('overtime hours came through', /OT Hours/.test(txt($('al-result'))) && /2/.test(txt($('al-result'))));
check('approved paid leave is reflected', /Paid Leave/.test(txt($('al-result'))));
check('leave balance is shown', /Casual Leave/.test(txt($('al-result'))));
check('bank and statutory details are shown', /SBIN0001/.test(txt($('al-result'))));
check('it points to HR & Payroll for the full payslip rather than guessing one',
  /HR &amp; Payroll|HR & Payroll/.test(txt($('al-result'))));
check('nothing on this screen is editable (no save button)', !$('al-result').querySelector('button'));

// ---- an employee whose id has since been removed server-side ----
// <select> has no such <option>, exactly as it would not once an employee is
// deleted between opening the dropdown and pressing Look up — add the option
// the same way the browser would if the list were stale, not by bypassing the UI.
const opt = window.document.createElement('option');
opt.value = 'E9'; opt.textContent = 'Gone — E9';
$('al-emp').appendChild(opt);
$('al-emp').value = 'E9';
click($('al-go')); await wait(150);
check('an unknown employee id is reported, not silently blanked', /No employee with that ID/i.test(txt($('al-msg'))));

check('no page errors while doing all of this', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

let pass = 0;
results.forEach(([n, c, x]) => { if (c) { pass++; console.log('  ok ' + n); } else console.log('  x ' + n + '   [' + x + ']'); });
console.log(`\n${pass} passed, ${results.length - pass} failed, of ${results.length}`);
process.exit(0);
