/* Six screens moved natively off the website's developer-only HR engine:
   Audit Trail, Policies, Leave & Permission, Engagement, Exit & F&F,
   Control Tower. All reuse the existing generic /api/hr?what=items
   endpoint (kinds: policy, leave-req, reward, survey, exit) and the
   existing /api/hr?what=audit endpoint — no new server storage. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let items = [];
let employees = [
  { empId: 'EMP001', name: 'Asha Rao', status: 'Active', designation: 'Operator', department: 'Production',
    doj: '2018-01-15', structure: { basic: 20000, da: 0, hra: 8000, conveyance: 1600, special: 2000 } },
  { empId: 'EMP002', name: 'Vikram Shah', status: 'Active' }
];
let auditRows = [{ who: 'tester', what: 'employee.update', ref: 'EMP001', reason: 'edited', at: new Date().toISOString() }];
const calls = [];
let signedIn = false;
const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => pageErrors.push(e.message));
const dom = new JSDOM(html.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''),
  { runScripts: 'outside-only', url: 'https://example.test/idms.html', virtualConsole: vc });
const { window } = dom;
window.Element.prototype.scrollIntoView = function () {};
window.confirm = () => true;
window.prompt = (m) => window.__promptAnswer !== undefined ? window.__promptAnswer : 'reason given';
let opened = [];
window.open = () => ({ document: { write: h => opened.push(h), close() {} }, print() {} });

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
    if (url.includes('what=docs')) return ok({ docs: [] });
    return ok({});
  }
  if (url.startsWith('/api/hr')) {
    if (url.includes('what=audit')) { calls.push({ kind: 'audit-read' }); return ok({ audit: auditRows }); }
    if (url.includes('what=employees') && (!opts.method || opts.method === 'GET')) return ok({ employees });
    if (opts.method === 'POST' && body.what === 'employees') {
      calls.push({ kind: 'emp-save', body });
      const i = employees.findIndex(e => e.empId === body.employee.empId);
      if (i >= 0) employees[i] = body.employee; else employees.push(body.employee);
      return ok({ empId: body.employee.empId });
    }
    if (url.includes('what=items') && (!opts.method || opts.method === 'GET')) {
      const kind = (url.match(/kind=([^&]+)/) || [, ''])[1];
      const filtered = kind ? items.filter(x => x.kind === kind) : items;
      return ok({ items: filtered });
    }
    if (opts.method === 'POST' && body.what === 'items') {
      calls.push({ kind: 'item-save', body });
      const it = body.item;
      items.push({ item_id: it.itemId, kind: it.kind, status: it.status, data: it });
      return ok({ itemId: it.itemId });
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

// ---------- all six are live, findable menu entries ----------
['hr_audit_trail', 'hr_policies', 'hr_leave', 'hr_engage', 'hr_exit', 'hr_tower'].forEach(id => {
  check(id + ' is a live menu entry', !!window.document.querySelector('#menubar [data-s="' + id + '"]'));
});

// ---------- Audit Trail ----------
nav('hr_audit_trail');
await wait(200);
check('the audit endpoint is called', calls.some(c => c.kind === 'audit-read'));
check('the audit row is shown', /employee\.update/.test($('hat-body').textContent));
check('the reason is shown', /edited/.test($('hat-body').textContent));

// ---------- Policies ----------
calls.length = 0;
nav('hr_policies');
await wait(200);
set('pl-title', 'Code of Conduct'); set('pl-ver', '1.0'); set('pl-body', 'Behave professionally.');
click($('pl-create'));
await wait(200);
const polCall = calls.find(c => c.kind === 'item-save' && c.body.item.kind === 'policy');
check('drafting a policy posts it as Draft', !!polCall && polCall.body.item.status === 'Draft', JSON.stringify(calls));
check('a success message is shown', /Saved as draft/i.test($('pl-msg').textContent));
const polId = items.find(i => i.kind === 'policy').item_id;
check('the draft appears in the list, not yet published', /Code of Conduct/.test($('pl-list').textContent) && /Draft/.test($('pl-list').textContent));

calls.length = 0;
const pubBtn = window.document.querySelector('.pl-pub[data-p="' + polId + '"]');
check('a Draft offers Publish', !!pubBtn);
click(pubBtn);
await wait(200);
const pubCall = calls.find(c => c.kind === 'item-patch' && c.body.status === 'Published');
check('publishing patches status to Published', !!pubCall, JSON.stringify(calls));

// ---------- Leave ----------
calls.length = 0;
nav('hr_leave');
await wait(200);
check('the employee picker is filled', $('lv-emp').options.length === 2, $('lv-emp').innerHTML);
$('lv-emp').value = 'EMP001';
set('lv-from', '2026-10-01'); set('lv-to', '2026-10-03'); set('lv-reason', 'Family function');
click($('lv-apply'));
await wait(200);
const leaveCall = calls.find(c => c.kind === 'item-save' && c.body.item.kind === 'leave-req');
check('applying posts a Pending leave-req', !!leaveCall && leaveCall.body.item.status === 'Pending', JSON.stringify(calls));

calls.length = 0;
await wait(100);
const leaveId = items.find(i => i.kind === 'leave-req').item_id;
const appBtn = window.document.querySelector('.lv-app[data-id="' + leaveId + '"]');
check('a Pending request offers Approve', !!appBtn);
click(appBtn);
await wait(200);
const appCall = calls.find(c => c.kind === 'item-patch' && c.body.status === 'Approved');
check('approving patches status to Approved, by the person who did it', !!appCall && /approved by/.test(appCall.body.reason),
  JSON.stringify(calls));

// ---------- Engagement ----------
calls.length = 0;
nav('hr_engage');
await wait(200);
$('eg-rw-emp').value = 'EMP002';
set('eg-rw-type', 'Best Kaizen'); set('eg-rw-period', 'Sep 2026'); set('eg-rw-note', 'Reduced changeover time');
click($('eg-rw-add'));
await wait(200);
const rwCall = calls.find(c => c.kind === 'item-save' && c.body.item.kind === 'reward');
check('recording recognition posts a reward item', !!rwCall, JSON.stringify(calls));
check('the recognition appears in the list', /Best Kaizen/.test($('eg-rw-list').textContent));

calls.length = 0;
set('eg-sv-title', 'Engagement Pulse'); set('eg-sv-qs', 'How happy are you at work?\nDo you feel heard?');
click($('eg-sv-add'));
await wait(200);
const svCall = calls.find(c => c.kind === 'item-save' && c.body.item.kind === 'survey');
check('creating a survey posts it with both questions split out',
  !!svCall && svCall.body.item.questions.length === 2, JSON.stringify(calls));

// ---------- Exit ----------
calls.length = 0;
nav('hr_exit');
await wait(200);
$('ex-emp').value = 'EMP001';
set('ex-lwd', '2026-11-15'); set('ex-reason', 'Better opportunity');
click($('ex-add'));
await wait(200);
const exCall = calls.find(c => c.kind === 'item-save' && c.body.item.kind === 'exit');
check('recording an exit posts it In Progress', !!exCall && exCall.body.item.status === 'In Progress', JSON.stringify(calls));
check('the settlement is now calculated on screen',
  /calculated on each exit below/.test(window.document.querySelector('[data-panel="hr_exit"]').textContent));

calls.length = 0;
await wait(100);
const exitId = items.find(i => i.kind === 'exit').item_id;
const clrSel = window.document.querySelector('.ex-clr[data-id="' + exitId + '"][data-k="Tools returned"]');
check('a clearance selector is offered for each checklist item', !!clrSel);
clrSel.value = 'yes'; clrSel.dispatchEvent(new window.Event('change', { bubbles: true }));
await wait(50);
click(window.document.querySelector('.ex-save[data-id="' + exitId + '"]'));
await wait(200);
const exSaveCall = calls.find(c => c.kind === 'item-patch' && c.body.itemId === exitId);
check('saving the exit patches its clearance', exSaveCall && exSaveCall.body.patch.clearance['Tools returned'] === 'yes',
  JSON.stringify(exSaveCall));

// ---------- relieving letter, built from the same figures shown on screen ----------
opened.length = 0;
click(window.document.querySelector('.ex-print[data-id="' + exitId + '"]'));
await wait(150);
const relDoc = opened[0] || '';
check('the relieving letter opens a document', !!relDoc);
check('it is titled as a relieving certificate', /Relieving/.test(relDoc));
check('it names the employee', /Asha Rao/.test(relDoc));
check('the final salary is pro-rated by day worked in the exit month (15 of 30 days · 31,600 gross)',
  /15,800|15800/.test(relDoc), relDoc.slice(0, 2000));

// ---------- settling an exit must mark the employee Exited, not just the exit record ----------
calls.length = 0;
click(window.document.querySelector('.ex-settle[data-id="' + exitId + '"]'));
await wait(200);
const settleEmpCall = calls.find(c => c.kind === 'emp-save' && c.body.employee.empId === 'EMP001');
check('marking an exit settled also updates the employee record', !!settleEmpCall, JSON.stringify(calls));
check('the employee is set to Exited, not left Active', settleEmpCall && settleEmpCall.body.employee.status === 'Exited',
  settleEmpCall && settleEmpCall.body.employee.status);
const settleItemCall = calls.find(c => c.kind === 'item-patch' && c.body.status === 'Settled');
check('the exit record itself is marked Settled', !!settleItemCall);

// ---------- Control Tower ----------
nav('hr_tower');
await wait(250);
check('the tower reads a live summary, not a static page',
  /On leave today/.test($('tw-body').textContent) && /Exits in progress/.test($('tw-body').textContent));

check('no console errors while any of this ran', pageErrors.length === 0, pageErrors.join(' | '));

const failed = results.filter(([, ok]) => !ok);
for (const [n, ok, x] of results) console.log((ok ? '  ok  ' : '  X   ') + n + (ok ? '' : '   [' + x + ']'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, of ${results.length}`);
process.exit(failed.length ? 1 : 0);
