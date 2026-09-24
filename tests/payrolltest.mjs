/* Payroll, native. The engine itself was already proved byte-identical to
   the website's original across 10 edge cases before any UI was built on
   it (including both marginal-relief paths); this covers the screen around
   it — building a draft from real attendance, the numbers that reach the
   table, and the immutability rules that make an approved run a financial
   record rather than an editable draft. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

const period = '2026-08';
let employees = [
  // full month, low earner: gross 15,000 -> PF 12% of (8000 basic) = 960, ESI 0.75% of 15000 = 113 (ceil), PT 0
  { empId: 'ET001', name: 'Asha Rao', department: 'Production', status: 'Active', uan: 'U1', esiNumber: 'E1',
    structure: { basic: 8000, da: 0, hra: 3200, conveyance: 1600, special: 2200, otherAllow: 0 } },
  // no attendance marked at all -> included at full days but flagged as not from attendance
  { empId: 'ET002', name: 'Vikram Shah', department: 'Production', status: 'Active', uan: 'U2', esiNumber: 'E2',
    structure: { basic: 10000, da: 0, hra: 4000, conveyance: 1600, special: 2400, otherAllow: 0 } },
  // no salary structure -> must be flagged, not silently paid zero without notice
  { empId: 'ET003', name: 'No Structure', department: 'Stores', status: 'Active' },
  // exited -> must not appear on payroll at all
  { empId: 'ET004', name: 'Gone Already', department: 'Stores', status: 'Exited',
    structure: { basic: 9000, da: 0, hra: 3600, conveyance: 1600, special: 1800, otherAllow: 0 } }
];
// Asha: 28 present days of a 30-day month, 4 OT hours
let attendance = [];
for (let d = 1; d <= 28; d++)
  attendance.push({ empId: 'ET001', day: period + '-' + String(d).padStart(2, '0'), status: 'Present', dayFraction: 1, otHours: d === 1 ? 4 : 0 });

let payruns = [];
let content = {
  costBase: { hoursPerShift: 8 },
  statutory: {
    effectiveFrom: '2026-04-01', lastReviewedBy: 'CA Suresh', lastReviewedOn: '2026-04-01',
    pf: { enabled: true, employeePct: 12, employerPct: 12, wageCeiling: 15000, applyCeiling: true,
      epsPct: 8.33, epsCeiling: 15000, edliPct: 0.5, adminPct: 0.5 },
    esi: { enabled: true, employeePct: 0.75, employerPct: 3.25, grossLimit: 21000 },
    pt: { enabled: true, slabs: [{ upTo: 24999, amount: 0 }, { upTo: 999999999, amount: 200 }] },
    tds: { enabled: true, mode: 'manual', defaultRegime: 'New', cessPct: 4, slabsReviewedBy: 'CA Suresh' },
    lwf: { enabled: false }, ot: { multiplier: 2, basisComponents: 'basic+da' },
    gratuity: { accrualPct: 4.81 }, bonus: { accrualPct: 8.33, wageCeiling: 21000 }
  }
};
const calls = [];
let signedIn = false, role = 'developer';
const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => pageErrors.push(e.message));
const dom = new JSDOM(html.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''),
  { runScripts: 'outside-only', url: 'https://example.test/idms.html', virtualConsole: vc });
const { window } = dom;
window.Element.prototype.scrollIntoView = function () {};
window.confirm = () => true;
window.prompt = () => 'approved after checking every line';
let opened = [];
window.open = () => ({ document: { write: h => opened.push(h), close() {} }, print() {} });

window.fetch = async (path, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : {};
  const url = String(path);
  const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
  const err = m => ({ ok: true, status: 200, json: async () => ({ ok: false, error: m }) });
  if (url.startsWith('/api/auth')) {
    if (body.action === 'login') { signedIn = true; return ok({ token: 'T', user: 'tester', role }); }
    if (body.action === 'session') return signedIn ? ok({ user: 'tester', role }) : { ok: false, status: 401, json: async () => ({ error: 'Not signed in' }) };
    return ok({});
  }
  if (url.startsWith('/api/content')) return ok({ data: content });
  if (url.startsWith('/api/rfqs')) return ok({ rfqs: [] });
  if (url.startsWith('/api/settings')) return ok({ settings: {} });
  if (url.startsWith('/api/idms')) {
    if (url.includes('what=settings')) return ok({ settings: {} });
    if (url.includes('what=parts')) return ok({ parts: [] });
    if (url.includes('what=serial')) return ok({ next: 1 });
    if (url.includes('what=docs')) return ok({ docs: [] });
    if (url.includes('what=audit')) return ok({ audit: [] });
    return ok({});
  }
  if (url.startsWith('/api/hr')) {
    if (url.includes('what=employees')) return ok({ employees });
    if (url.includes('what=attendance')) return ok({ attendance });
    if (url.includes('what=payruns') && (!opts.method || opts.method === 'GET')) return ok({ payruns });
    if (url.includes('what=items')) return ok({ items: [] });
    if (opts.method === 'POST' && body.what === 'payruns') {
      calls.push({ kind: 'run-create', body });
      payruns.unshift({ run_id: body.payrun.runId, period: body.payrun.period,
        status: body.payrun.status, data: body.payrun, created_at: new Date().toISOString() });
      return ok({ runId: body.payrun.runId });
    }
    if (opts.method === 'PATCH' && body.what === 'payruns') {
      calls.push({ kind: 'run-patch', body });
      const i = payruns.findIndex(r => r.run_id === body.runId);
      if (i < 0) return err('Pay run not found.');
      // mirror the real server's immutability rules exactly
      if (payruns[i].status === 'Approved') {
        if (body.remove) return err('An approved pay run cannot be deleted. It is a financial record.');
        if (body.status && body.status !== 'Approved') return err('An approved pay run cannot be reopened. Create a correction run instead.');
      }
      if (body.status === 'Approved' && role !== 'developer') return err('Only an authorised login can approve a pay run.');
      if (body.remove) { payruns.splice(i, 1); return ok({ removed: body.runId }); }
      payruns[i] = Object.assign({}, payruns[i],
        { data: Object.assign({}, payruns[i].data, body.patch || {}), status: body.status || payruns[i].status });
      if (body.status) payruns[i].data.status = body.status;
      return ok({});
    }
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
const nav = id => click(window.document.querySelector('#menubar [data-s="' + id + '"]'));

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(300);

check('Payroll is a live native menu entry', !!window.document.querySelector('#menubar [data-s="hr_payroll_native"]'));
nav('hr_payroll_native');
await wait(300);

// ---------- the readiness guard ----------
check('an employee with no salary structure is warned about before anything is approved',
  /no salary structure/.test($('pr-guard').textContent), $('pr-guard').textContent);
check('only active employees are counted on payroll (the exited one is excluded)',
  $('pr-kpi').textContent.includes('3'), $('pr-kpi').textContent);

// ---------- build a draft ----------
$('pr-period').value = period;
$('pr-days').value = '30';
click($('pr-build'));
await wait(300);
const createCall = calls.find(c => c.kind === 'run-create');
check('building a draft creates a Draft run', !!createCall && createCall.body.payrun.status === 'Draft');
check('the exited employee is not given a payslip line',
  createCall && !createCall.body.payrun.lines.some(l => l.empId === 'ET004'),
  createCall && JSON.stringify(createCall.body.payrun.lines.map(l => l.empId)));
check('all three active employees get a line', createCall && createCall.body.payrun.lines.length === 3);

const ashaLine = createCall.body.payrun.lines.find(l => l.empId === 'ET001');
check('payable days come from the real attendance (28 present days), not assumed full month',
  ashaLine && ashaLine.payableDays === 28, ashaLine && String(ashaLine.payableDays));
check('overtime hours come from attendance too', ashaLine && ashaLine.otHours === 4);
check('someone with no attendance marked is flagged as not-from-attendance rather than dropped',
  createCall.body.payrun.lines.find(l => l.empId === 'ET002').fromAttendance === false);
check('the run records which rates it was built against',
  createCall.body.payrun.rulesReviewedBy === 'CA Suresh');

// ---------- the computed figures on screen ----------
await wait(200);
const runId = payruns[0].run_id;
const table = $('pr-list').textContent;
check('the run expands to show the pay register', /Asha Rao/.test(table), table.slice(0, 300));
/* Hand-calculated for Asha, 28/30 days of a 15,000 gross structure:
   factor 28/30 -> basic 7,467 da 0 hra 2,987 conv 1,493 special 2,053 = 14,000
   OT: (8000+0)/(30*8) = 33.33/hr * 2 = 66.67 * 4h = 267
   gross 14,267 -> PF 12% of 7,467 = 896 ; ESI ceil(14267*0.0075) = 108 ; PT 0 (below 24,999) */
check('Asha\'s gross is the pro-rated structure plus OT, to the rupee',
  /14,267/.test(table), table.slice(0, 600));
check('PF is 12% of pro-rated basic only', /896/.test(table));
check('ESI is charged (gross is under the 21,000 limit)', /108/.test(table));

// ---------- one employee's own payslip, not just the register ----------
check('a per-employee print button sits on the pay register',
  !!window.document.querySelector('.pr-line-print[data-run="' + runId + '"][data-emp="ET001"]'));
click(window.document.querySelector('.pr-line-print[data-run="' + runId + '"][data-emp="ET001"]'));
await wait(150);
const slipDoc = opened[0] || '';
check('the single payslip opens a document', !!slipDoc);
check('it is titled as a payslip for the period', /Payslip/.test(slipDoc));
check('it names the employee', /Asha Rao/.test(slipDoc));
check('it carries the same gross figure as the register', /14,267/.test(slipDoc), slipDoc.slice(0, 600));

// ---------- approve, then prove immutability ----------
calls.length = 0;
click(window.document.querySelector('.pr-approve[data-run="' + runId + '"]'));
await wait(300);
const approveCall = calls.find(c => c.kind === 'run-patch' && c.body.status === 'Approved');
check('approving sends the Approved status with a stated reason',
  !!approveCall && !!approveCall.body.reason, JSON.stringify(approveCall && approveCall.body.reason));
check('the run is now Approved', payruns[0].status === 'Approved');

await wait(200);
check('an approved run offers no Save, Approve or Discard button',
  !window.document.querySelector('.pr-save[data-run="' + runId + '"]') &&
  !window.document.querySelector('.pr-approve[data-run="' + runId + '"]') &&
  !window.document.querySelector('.pr-discard[data-run="' + runId + '"]'));
check('an approved run says plainly that it cannot be changed',
  /cannot be changed/.test($('pr-list').textContent));
check('an approved run can still be printed',
  !!window.document.querySelector('.pr-print[data-run="' + runId + '"]'));
check('its figures become read-only text, not editable inputs',
  !window.document.querySelector('.pr-line-in[data-run="' + runId + '"]'));

// ---------- a second run for an already-approved period is refused ----------
$('pr-period').value = period;
click($('pr-build'));
await wait(250);
check('a second run cannot be built for a period that already has an approved run',
  /already has an approved pay run/.test($('pr-msg').textContent), $('pr-msg').textContent);

check('no console errors while any of this ran', pageErrors.length === 0, pageErrors.join(' | '));

const failed = results.filter(([, ok]) => !ok);
for (const [n, ok, x] of results) console.log((ok ? '  ok  ' : '  X   ') + n + (ok ? '' : '   [' + x + ']'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, of ${results.length}`);
process.exit(failed.length ? 1 : 0);
