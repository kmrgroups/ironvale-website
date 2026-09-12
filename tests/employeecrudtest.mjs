/* People — HR records: manual Add, Edit and Delete. Add auto-assigns the
   Employee ID the same way Bulk Upload does (prefix + next free number
   against who is actually on file); Edit reuses the same save path; Delete
   requires a reason (the prompt() the rest of this codebase uses for every
   other deletion) and calls the PATCH remove path. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let employees = [
  { empId: 'EMP001', name: 'Asha Rao', designation: 'Supervisor', department: 'Quality',
    doj: '2024-01-10', status: 'Active', biometricId: '501' }
];
const calls = [];
let signedIn = false;
const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => pageErrors.push(e.message));
const dom = new JSDOM(html.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''),
  { runScripts: 'outside-only', url: 'https://example.test/idms.html', virtualConsole: vc });
const { window } = dom;
window.Element.prototype.scrollIntoView = function () {};
window.prompt = (msg) => window.__promptAnswer !== undefined ? window.__promptAnswer : 'testing deletion';

window.fetch = async (path, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : {};
  const url = String(path);
  const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
  if (url.startsWith('/api/auth')) {
    if (body.action === 'login') { signedIn = true; return ok({ token: 'T', user: 'tester', role: 'developer' }); }
    if (body.action === 'session') return signedIn ? ok({ user: 'tester', role: 'developer' }) : { ok: false, status: 401, json: async () => ({ error: 'Not signed in' }) };
    return ok({});
  }
  if (url.startsWith('/api/content')) return ok({ data: { company: { legalName: 'Test Mfg', docPrefix: 'TEST' },
    hrMasters: { empIdPrefix: 'EMP', empIdPad: 3, empIdNextSeq: 1 } } });
  if (url.startsWith('/api/rfqs')) return ok({ rfqs: [] });
  if (url.startsWith('/api/hr')) {
    if (url.includes('what=employees') && (!opts.method || opts.method === 'GET')) return ok({ employees });
    if (opts.method === 'POST' && body.what === 'employees') {
      calls.push({ kind: 'save', body });
      const i = employees.findIndex(e => e.empId === body.employee.empId);
      if (i >= 0) employees[i] = body.employee; else employees.push(body.employee);
      return ok({ empId: body.employee.empId });
    }
    if (opts.method === 'PATCH' && body.what === 'employees' && body.remove) {
      calls.push({ kind: 'delete', body });
      employees = employees.filter(e => e.empId !== body.empId);
      return ok({ removed: body.empId });
    }
    return ok({});
  }
  if (url.startsWith('/api/idms')) {
    if (url.includes('what=settings')) return ok({ settings: {} });
    if (url.includes('what=parts')) return ok({ parts: [] });
    if (url.includes('what=serial')) return ok({ next: 1 });
    if (url.includes('what=docs')) return ok({ docs: [] });
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
const set = (id, v) => { $(id).value = v; };

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(300);
nav('hrm');
await wait(300);

// ---------- Add ----------
check('the Add employee button exists', !!$('hr-add'));
click($('hr-add'));
await wait(150);
check('the record form opens', $('hr-record').style.display !== 'none');
check('a new Employee ID is auto-assigned, not left for the person to type',
  $('he-id').value === 'EMP002', $('he-id').value); // EMP001 already on file, so the next free one
check('the ID field stays read-only, same as Add a Part', $('he-id').readOnly);
check('the delete button is hidden for a record that does not exist yet',
  $('he-delete').style.display === 'none');

set('he-name', 'Vikram Shah'); set('he-desig', 'Machine Operator'); set('he-dept', 'Production');
click($('he-save'));
await wait(200);
const addCall = calls.find(c => c.kind === 'save' && c.body.employee.empId === 'EMP002');
check('saving a new record posts the auto-assigned ID and the typed fields', !!addCall,
  JSON.stringify(calls));
check('the reason recorded says it was added, not edited',
  addCall && addCall.body.reason === 'added in the IDMS', addCall && addCall.body.reason);
check('the new employee now appears in the list', employees.some(e => e.empId === 'EMP002'));
check('a success message says Added, not Saved', /Added/.test($('he-msg').textContent), $('he-msg').textContent);

// ---------- Edit an existing record ----------
calls.length = 0;
nav('hrm');
await wait(300);
const openBtn = window.document.querySelector('.hr-open[data-id="EMP001"]');
check('the existing employee is in the list to open', !!openBtn);
click(openBtn);
await wait(100);
check('the delete button is shown for an existing record', $('he-delete').style.display !== 'none');

// row-level Edit/Delete must work without opening the profile card first —
// the original ask was for these outside the profile, not only inside it
nav('hrm');
await wait(300);
const rowDelBtn = window.document.querySelector('.hr-row-del[data-id="EMP001"]');
check('a Delete button sits directly on the row, not only inside the opened profile', !!rowDelBtn);
check('an Edit button (not "Open") sits on the row too',
  window.document.querySelector('.hr-open[data-id="EMP001"]').textContent.trim() === 'Edit');

set('he-desig', 'Senior Supervisor');
click($('he-save'));
await wait(200);
const editCall = calls.find(c => c.kind === 'save' && c.body.employee.empId === 'EMP001');
check('editing posts the same employee id, not a new one', !!editCall, JSON.stringify(calls));
check('the reason says edited, not added', editCall && editCall.body.reason === 'edited in the IDMS');
check('the field actually changed is in the saved payload',
  editCall && editCall.body.employee.designation === 'Senior Supervisor');

// ---------- Delete ----------
calls.length = 0;
window.__promptAnswer = 'no longer with the company';
click($('he-delete'));
await wait(200);
const delCall = calls.find(c => c.kind === 'delete');
check('deleting calls the remove endpoint for the right employee', !!delCall && delCall.body.empId === 'EMP001',
  JSON.stringify(calls));
check('the typed reason is sent', delCall && delCall.body.reason === 'no longer with the company');
check('the employee is actually gone from the list now', !employees.some(e => e.empId === 'EMP001'));

// ---------- an empty reason cancels the delete, same as everywhere else ----------
calls.length = 0;
nav('hrm');
await wait(300);
click(window.document.querySelector('.hr-open[data-id="EMP002"]'));
await wait(100);
window.__promptAnswer = '';
click($('he-delete'));
await wait(150);
check('an empty reason does not delete anything', calls.length === 0, JSON.stringify(calls));
check('EMP002 is still on file', employees.some(e => e.empId === 'EMP002'));

check('no console errors while any of this ran', pageErrors.length === 0, pageErrors.join(' | '));

const failed = results.filter(([, ok]) => !ok);
for (const [n, ok, x] of results) console.log((ok ? '  ok  ' : '  X   ') + n + (ok ? '' : '   [' + x + ']'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, of ${results.length}`);
process.exit(failed.length ? 1 : 0);
