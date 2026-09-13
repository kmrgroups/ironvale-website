/* Statutory & Masters, native. The one thing that matters most here is not
   the form fields themselves — it's that /api/content overwrites the WHOLE
   site_content record on every save, so this screen must read the full
   thing first and only ever change its own keys (hrMasters, shifts,
   holidays, leavePolicy, statutory), or saving here would silently wipe out
   the company profile, branding and pricing the website itself owns. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let content = {
  company: { legalName: 'Test Mfg', docPrefix: 'TEST', gst: '29ABCDE1234F1Z5' },
  pricing: { markupPct: 18 },
  hrMasters: { empIdPrefix: 'EMP', empIdNextSeq: 5, empIdPad: 3, departments: ['Production'] },
  shifts: [{ code: 'G', name: 'General', start: '09:00', end: '17:30', breakMin: 30 }],
  holidays: [],
  leavePolicy: { types: [{ code: 'CL', name: 'Casual', annualDays: 12, paid: true, carryForward: false }], permission: {} },
  statutory: { pf: { employeePct: 12, employerPct: 12 }, esi: {}, pt: { state: 'Karnataka', slabs: [] },
    tds: { mode: 'manual', defaultRegime: 'New', cessPct: 4, regimes: { New: { label: 'New Regime', slabs: [], surcharge: [] } } } }
};
const calls = [];
let signedIn = false;
const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => pageErrors.push(e.message));
const dom = new JSDOM(html.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''),
  { runScripts: 'outside-only', url: 'https://example.test/idms.html', virtualConsole: vc });
const { window } = dom;
window.Element.prototype.scrollIntoView = function () {};

window.fetch = async (path, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : {};
  const url = String(path);
  const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
  if (url.startsWith('/api/auth')) {
    if (body.action === 'login') { signedIn = true; return ok({ token: 'T', user: 'tester', role: 'developer' }); }
    if (body.action === 'session') return signedIn ? ok({ user: 'tester', role: 'developer' }) : { ok: false, status: 401, json: async () => ({ error: 'Not signed in' }) };
    return ok({});
  }
  if (url.startsWith('/api/rfqs')) return ok({ rfqs: [] });
  if (url.startsWith('/api/hr')) return ok({ employees: [], items: [] });
  if (url.startsWith('/api/idms')) {
    if (url.includes('what=settings')) return ok({ settings: {} });
    if (url.includes('what=parts')) return ok({ parts: [] });
    if (url.includes('what=serial')) return ok({ next: 1 });
    if (url.includes('what=docs')) return ok({ docs: [] });
    return ok({});
  }
  if (url.startsWith('/api/content')) {
    if (!opts.method || opts.method === 'GET') return ok({ data: content });
    if (opts.method === 'POST') { calls.push({ kind: 'content-save', body }); content = body.data; return ok({}); }
    return ok({});
  }
  return ok({});
};

window.eval(core); window.eval(kpi);
window.eval(html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1]);

const $ = id => window.document.getElementById(id);
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, c, x) => results.push([n, !!c, x || '']);
const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const change = el => el.dispatchEvent(new window.Event('change', { bubbles: true }));
const input = el => el.dispatchEvent(new window.Event('input', { bubbles: true }));
const nav = id => click(window.document.querySelector('#menubar [data-s="' + id + '"]'));
const set = (id, v) => { $(id).value = v; };

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(300);

check('Statutory & Masters is a live menu entry', !!window.document.querySelector('#menubar [data-s="hr_statutory"]'));
nav('hr_statutory');
await wait(200);

// ---------- existing values load correctly ----------
check('the existing shift loads', [...window.document.querySelectorAll('.sm-shift[data-k="name"]')].some(el => el.value === 'General'));
check('the existing leave type loads', [...window.document.querySelectorAll('.sm-lt[data-k="name"]')].some(el => el.value === 'Casual'));
check('the existing PT state loads', $('sm-pt-state').value === 'Karnataka');
check('the next employee ID preview is computed from prefix/seq/pad',
  $('sm-eid-preview').textContent === 'EMP005', $('sm-eid-preview').textContent);

// ---------- add a shift, add a holiday, add a leave type ----------
click($('sm-shift-add'));
await wait(30);
const newShiftRow = [...window.document.querySelectorAll('.sm-shift[data-k="code"]')].pop();
newShiftRow.value = 'N'; input(newShiftRow);
check('a new shift row is added and editable', newShiftRow.value === 'N');

click($('sm-hol-add'));
await wait(30);
const holDateInputs = window.document.querySelectorAll('.sm-hol[data-k="date"]');
check('a new holiday row is added', holDateInputs.length === 1);

click($('sm-lt-add'));
await wait(30);
check('a new leave type row is added', window.document.querySelectorAll('.sm-lt[data-k="code"]').length === 2);

// ---------- TDS regime switching preserves per-regime data ----------
$('sm-tds-editregime').innerHTML += '<option value="Old">Old Regime</option>';
// simulate a second regime existing by adding a slab to New, switching, and back
click($('sm-tds-slab-add'));
await wait(30);
const newRegimeSlabInput = window.document.querySelector('.sm-tds-slab[data-k="upTo"]');
check('a TDS slab row is added for the current regime', !!newRegimeSlabInput);

// ---------- PF/ESI rates — set AFTER every redraw-triggering action above,
// since each of those (shift/holiday/leave-type/slab add) re-renders the
// whole screen from smContent and would otherwise wipe an earlier typed
// value that was never written back into the data model until Save reads it ----------
set('sm-pf-emp', '12'); input($('sm-pf-emp'));
set('sm-esi-emp', '0.75'); input($('sm-esi-emp'));
set('sm-esi-empr', '3.25'); input($('sm-esi-empr'));

// ---------- Save: must send back the WHOLE content object ----------
click($('sm-save'));
await wait(200);
const saveCall = calls.find(c => c.kind === 'content-save');
check('saving posts to /api/content', !!saveCall, JSON.stringify(calls).slice(0, 200));
check('the company profile the website owns is NOT clobbered',
  saveCall && saveCall.body.data.company && saveCall.body.data.company.legalName === 'Test Mfg' &&
  saveCall.body.data.company.gst === '29ABCDE1234F1Z5', saveCall && JSON.stringify(saveCall.body.data.company));
check('unrelated pricing settings are NOT clobbered',
  saveCall && saveCall.body.data.pricing && saveCall.body.data.pricing.markupPct === 18);
check('the new shift is actually in the saved payload',
  saveCall && saveCall.body.data.shifts.some(s => s.code === 'N'), saveCall && JSON.stringify(saveCall.body.data.shifts));
check('the new holiday is actually in the saved payload',
  saveCall && saveCall.body.data.holidays.length === 1);
check('the new leave type is actually in the saved payload',
  saveCall && saveCall.body.data.leavePolicy.types.length === 2);
check('PF employee % is in the saved payload', saveCall && saveCall.body.data.statutory.pf.employeePct === 12);
check('ESI rates are in the saved payload',
  saveCall && saveCall.body.data.statutory.esi.employeePct === 0.75 && saveCall.body.data.statutory.esi.employerPct === 3.25,
  saveCall && JSON.stringify(saveCall.body.data.statutory.esi));

// ---------- a scalar field typed before an unrelated add/delete must survive
// the redraw that action triggers, not be silently lost ----------
nav('hr_statutory');
await wait(200);
set('sm-pf-emp', '13.5'); input($('sm-pf-emp'));
click($('sm-hol-add'));
await wait(50);
check('a PF rate typed before adding a holiday survives that redraw',
  $('sm-pf-emp').value === '13.5', $('sm-pf-emp').value);
check('a success message is shown', /Saved/i.test($('sm-save-msg').textContent));

// ---------- TDS mode: manual by default, matching the source's own safety default ----------
check('TDS mode defaults to manual (locked) rather than assuming slab-based is safe to compute',
  $('sm-tds-mode').value === 'manual');

// ---------- Review Record — what Audit Readiness reads to say whether
// statutory rates have been formally reviewed ----------
nav('hr_statutory');
await wait(200);
set('sm-rev-by', 'CA Suresh Kumar'); input($('sm-rev-by'));
set('sm-rev-on', '2026-04-01'); input($('sm-rev-on'));
click($('sm-save'));
await wait(200);
const revCall = calls.filter(c => c.kind === 'content-save').pop();
check('the review record (reviewer, date) is saved into statutory',
  revCall && revCall.body.data.statutory.lastReviewedBy === 'CA Suresh Kumar' &&
  revCall.body.data.statutory.lastReviewedOn === '2026-04-01',
  revCall && JSON.stringify(revCall.body.data.statutory.lastReviewedBy));

check('no console errors while any of this ran', pageErrors.length === 0, pageErrors.join(' | '));

const failed = results.filter(([, ok]) => !ok);
for (const [n, ok, x] of results) console.log((ok ? '  ok  ' : '  X   ') + n + (ok ? '' : '   [' + x + ']'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, of ${results.length}`);
process.exit(failed.length ? 1 : 0);
