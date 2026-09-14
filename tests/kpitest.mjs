/* KPI & Appraisal, native. The one thing worth being paranoid about here:
   an auto-source KPI must compute its number from the SAME records the
   screens that own that data already show, not a second calculation that
   could quietly disagree — so this seeds real competency/skill/employee/task
   records and checks the auto values against them by hand. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let items = [];
let employees = [
  { empId: 'EMP001', name: 'Asha Rao', designation: 'Operator', department: 'Production', status: 'Active' },
  { empId: 'EMP002', name: 'Vikram Shah', designation: 'Operator', department: 'Production', status: 'Active' },
  { empId: 'EMP003', name: 'Left Long Ago', designation: 'Operator', department: 'Production', status: 'Exited' }
];
let docs = [
  // one competency requirement for 'Operator': needs level 3 in 'CNC setting'
  { doc_id: 'c1', kind: 'competency', data: { designation: 'Operator', thing: 'CNC setting', level: 3, criticality: 'Ordinary' } },
  // Asha assessed at level 3 (met); Vikram never assessed (gap)
  { doc_id: 's1', kind: 'skill', data: { person: 'Asha Rao', thing: 'CNC setting', level: 3, on: '2026-01-01' } },
  // two tasks, one closed
  { doc_id: 't1', kind: 'task', status: 'Closed', data: { title: 'Fix fixture' } },
  { doc_id: 't2', kind: 'task', status: 'Open', data: { title: 'Order tooling' } }
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
window.prompt = () => 'reason given';

window.fetch = async (path, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : {};
  const url = String(path);
  const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
  if (url.startsWith('/api/auth')) {
    if (body.action === 'login') { signedIn = true; return ok({ token: 'T', user: 'tester', role: 'developer' }); }
    if (body.action === 'session') return signedIn ? ok({ user: 'tester', role: 'developer' }) : { ok: false, status: 401, json: async () => ({ error: 'Not signed in' }) };
    return ok({});
  }
  if (url.startsWith('/api/content')) return ok({ data: { company: { legalName: 'Test Mfg', docPrefix: 'TEST' } } });
  if (url.startsWith('/api/rfqs')) return ok({ rfqs: [] });
  if (url.startsWith('/api/idms')) {
    if (url.includes('what=settings')) return ok({ settings: {} });
    if (url.includes('what=parts')) return ok({ parts: [] });
    if (url.includes('what=serial')) return ok({ next: 1 });
    if (url.includes('what=docs')) {
      const kind = decodeURIComponent((url.match(/kind=([^&]+)/) || [, ''])[1]);
      return ok({ docs: docs.filter(d => !kind || d.kind === kind) });
    }
    return ok({});
  }
  if (url.startsWith('/api/hr')) {
    if (url.includes('what=employees') && (!opts.method || opts.method === 'GET')) return ok({ employees });
    if (url.includes('what=items') && (!opts.method || opts.method === 'GET')) return ok({ items });
    if (opts.method === 'POST' && body.what === 'items') {
      calls.push({ kind: 'item-save', body });
      items.push({ item_id: body.item.itemId, kind: body.item.kind, status: body.item.status, data: body.item });
      return ok({ itemId: body.item.itemId });
    }
    if (opts.method === 'PATCH' && body.what === 'items') {
      calls.push({ kind: 'item-patch', body });
      const i = items.findIndex(x => x.item_id === body.itemId);
      if (i < 0) return { ok: true, status: 200, json: async () => ({ ok: false, error: 'Not found.' }) };
      if (body.remove) { items.splice(i, 1); return ok({ removed: body.itemId }); }
      const merged = Object.assign({}, items[i].data, body.patch || {});
      if (body.status) merged.status = body.status;
      items[i] = Object.assign({}, items[i], { data: merged, status: body.status || items[i].status });
      return ok({ item: merged });
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
const set = (id, v) => { $(id).value = v; };

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(300);

check('KPI & Appraisal is a live menu entry', !!window.document.querySelector('#menubar [data-s="hr_kpi"]'));
nav('hr_kpi');
await wait(250);

// ---------- a manual KPI ----------
set('kp-name', 'Customer complaints'); set('kp-target', '2'); set('kp-unit', 'per month');
window.document.getElementById('kp-direction').value = 'lower';
click($('kp-add'));
await wait(200);
const manualCall = calls.find(c => c.kind === 'item-save' && c.body.item.name === 'Customer complaints');
check('a manual KPI is saved with source=manual', !!manualCall && manualCall.body.item.source === 'manual', JSON.stringify(manualCall));
check('a manual KPI shows an editable Actual field',
  window.document.querySelector('.kp-actual[data-id="' + items.find(i => i.data.name === 'Customer complaints').item_id + '"]') !== null);

// ---------- an attrition KPI: 1 of 3 employees exited = 33.3% ----------
calls.length = 0;
set('kp-name', 'Attrition'); set('kp-target', '10'); set('kp-unit', '%');
window.document.getElementById('kp-source').value = 'attrition';
click($('kp-add'));
await wait(200);
const kpiText = $('kp-list').textContent;
check('attrition is computed as 1 of 3 records, not guessed or left blank',
  /33\.3/.test(kpiText), kpiText);

// ---------- a competency KPI: 1 of 1 requirement met (Asha), Vikram/exited not counted wrongly ----------
calls.length = 0;
set('kp-name', 'Competency coverage'); set('kp-target', '100'); set('kp-unit', '%');
window.document.getElementById('kp-source').value = 'competency';
click($('kp-add'));
await wait(200);
check('competency auto-value matches computeGaps() exactly: 1 of 2 requirements met (Asha met, Vikram gap)',
  /1 of 2 role requirement/.test($('kp-list').textContent), $('kp-list').textContent);

// ---------- a tasks KPI: 1 of 2 closed = 50% ----------
calls.length = 0;
set('kp-name', 'Task closure'); set('kp-target', '80'); set('kp-unit', '%');
window.document.getElementById('kp-source').value = 'tasks';
click($('kp-add'));
await wait(200);
check('tasks auto-value reads the real Task List docs: 1 of 2 closed',
  /1 of 2 task\(s\) closed/.test($('kp-list').textContent), $('kp-list').textContent);

// ---------- editing a manual KPI's actual ----------
calls.length = 0;
const manualId = items.find(i => i.data.name === 'Customer complaints').item_id;
const actualInput = window.document.querySelector('.kp-actual[data-id="' + manualId + '"]');
actualInput.value = '1';
actualInput.dispatchEvent(new window.Event('change', { bubbles: true }));
await wait(200);
const actualPatch = calls.find(c => c.kind === 'item-patch' && c.body.itemId === manualId);
check('typing an actual value patches the KPI', actualPatch && actualPatch.body.patch.actual === 1, JSON.stringify(actualPatch));

// ---------- appraisal: competency table must match computeGaps() for that employee ----------
calls.length = 0;
window.document.getElementById('ap-emp').value = 'EMP001';
set('ap-period', 'FY 2026-27');
click($('ap-add'));
await wait(200);
const apprCall = calls.find(c => c.kind === 'item-save' && c.body.item.kind === 'appraisal');
check('starting an appraisal posts it at Self Assessment', !!apprCall && apprCall.body.item.status === 'Self Assessment');
check('Asha (EMP001) shows her competency as met, matching Skill Gap Analysis',
  /CNC setting/.test($('ap-list').textContent) && /1\/1 met/.test($('ap-list').textContent), $('ap-list').textContent);

// ---------- approving requires a rating ----------
calls.length = 0;
const apprId = items.find(i => i.kind === 'appraisal').item_id;
const approveBtn = window.document.querySelector('.ap-approve[data-id="' + apprId + '"]');
click(approveBtn);
await wait(100);
check('approving without a rating is refused', calls.length === 0, JSON.stringify(calls));

// set a rating, then approve
const ratingSel = window.document.querySelector('.ap-in[data-id="' + apprId + '"][data-k="rating"]');
ratingSel.value = 'Meets'; ratingSel.dispatchEvent(new window.Event('input', { bubbles: true }));
click(window.document.querySelector('.ap-save[data-id="' + apprId + '"]'));
await wait(200);
click(window.document.querySelector('.ap-approve[data-id="' + apprId + '"]'));
await wait(200);
const approveCall = calls.find(c => c.kind === 'item-patch' && c.body.status === 'Approved');
check('approving with a rating set succeeds', !!approveCall, JSON.stringify(calls));

check('no console errors while any of this ran', pageErrors.length === 0, pageErrors.join(' | '));

const failed = results.filter(([, ok]) => !ok);
for (const [n, ok, x] of results) console.log((ok ? '  ok  ' : '  X   ') + n + (ok ? '' : '   [' + x + ']'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, of ${results.length}`);
process.exit(failed.length ? 1 : 0);
