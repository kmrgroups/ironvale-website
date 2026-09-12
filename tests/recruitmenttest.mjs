/* Native Recruitment (requisitions + candidates), reusing the existing
   generic /api/hr?what=items endpoint — no server changes, so this checks
   the client wiring and the AI-reply parsing, not new storage logic. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let items = [];
let employees = [];
let idSeq = 1;
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
window.prompt = () => 'no longer needed';

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
    hrMasters: { empIdPrefix: 'EMP', empIdPad: 3, empIdNextSeq: 1 },
    salaryStructure: { basicPct: 50, daPct: 0, hraPct: 20, conveyance: 1600 } } });
  if (url.startsWith('/api/rfqs')) return ok({ rfqs: [] });
  if (url.startsWith('/api/idms')) {
    if (url.includes('what=settings')) return ok({ settings: {} });
    if (url.includes('what=parts')) return ok({ parts: [] });
    if (url.includes('what=serial')) return ok({ next: 1 });
    if (url.includes('what=docs')) return ok({ docs: [] });
    return ok({});
  }
  if (url.startsWith('/api/ai')) {
    calls.push({ kind: 'ai', body });
    // a realistic MATCH/VERDICT/DETAIL reply, as callAI would hand back
    return ok({ text: 'MATCH: 62\nVERDICT: Partially meets the requirements — interview to clarify CNC experience\n' +
      'DETAIL:\nRequirements evidenced\n- ITI qualification\nRequirements not evidenced\n- 2 years CNC experience\n' +
      'Gaps to probe at interview\n- depth of CNC exposure\nThree questions to ask\n1. Describe your CNC work' });
  }
  if (url.startsWith('/api/hr')) {
    if (url.includes('what=items') && (!opts.method || opts.method === 'GET')) return ok({ items });
    if (url.includes('what=employees') && (!opts.method || opts.method === 'GET')) return ok({ employees });
    if (opts.method === 'POST' && body.what === 'items') {
      calls.push({ kind: 'item-save', body });
      const it = body.item;
      const i = items.findIndex(x => x.item_id === it.itemId);
      const row = { item_id: it.itemId, kind: it.kind, status: it.status, data: it };
      if (i >= 0) items[i] = row; else items.push(row);
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
    if (opts.method === 'POST' && body.what === 'employees') {
      calls.push({ kind: 'emp-save', body });
      employees.push(body.employee);
      return ok({ empId: body.employee.empId });
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
const change = el => el.dispatchEvent(new window.Event('change', { bubbles: true }));
const nav = id => click(window.document.querySelector('#menubar [data-s="' + id + '"]'));
const set = (id, v) => { $(id).value = v; };

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(300);

check('Recruitment is a live, findable menu entry',
  !!window.document.querySelector('#menubar [data-s="recruitment"]'));
nav('recruitment');
await wait(200);
check('the panel opens', window.document.querySelector('[data-panel="recruitment"]').classList.contains('on'));

// ---------- raise a requisition ----------
set('rc-rq-title', 'CNC Operator'); set('rc-rq-dept', 'Production');
set('rc-rq-jd', 'Must know G-code and have 2 years CNC experience.');
click($('rc-rq-create'));
await wait(200);
const reqCall = calls.find(c => c.kind === 'item-save' && c.body.item.kind === 'requisition');
check('raising a requisition posts it as a requisition item', !!reqCall, JSON.stringify(calls));
check('the requisition carries the typed JD',
  reqCall && reqCall.body.item.jd.includes('G-code'));
check('a success message is shown', /raised/i.test($('rc-rq-msg').textContent));
check('the requisition now appears in the list', /CNC Operator/.test($('rc-req-list').textContent));

// ---------- add a candidate ----------
calls.length = 0;
const reqId = items.find(i => i.kind === 'requisition').item_id;
$('rc-cd-req').value = reqId;
set('rc-cd-name', 'Vikram Shah'); set('rc-cd-qual', 'ITI');
set('rc-cd-exp', '1'); set('rc-cd-ectc', '25000');
click($('rc-cd-add'));
await wait(200);
const candCall = calls.find(c => c.kind === 'item-save' && c.body.item.kind === 'candidate');
check('adding a candidate posts it against the chosen requisition',
  !!candCall && candCall.body.item.reqId === reqId, JSON.stringify(calls));
check('a success message is shown', /added/i.test($('rc-cd-msg').textContent));
check('the candidate now appears in the list', /Vikram Shah/.test($('rc-cand-list').textContent));

// ---------- expand it, screen against the role ----------
calls.length = 0;
const candId = items.find(i => i.kind === 'candidate').item_id;
click(window.document.querySelector('.rc-cand-head[data-cand="' + candId + '"]'));
await wait(100);
check('expanding shows the screening button', !!window.document.querySelector('.rc-cd-screen[data-id="' + candId + '"]'));
click(window.document.querySelector('.rc-cd-screen[data-id="' + candId + '"]'));
await wait(250);
const aiCall = calls.find(c => c.kind === 'ai');
check('screening calls the AI gateway', !!aiCall, JSON.stringify(calls));
check('the JD text reaches the prompt', aiCall && /G-code/.test(aiCall.body.prompt || JSON.stringify(aiCall.body)));
const patchAfterScreen = calls.find(c => c.kind === 'item-patch' && c.body.patch && c.body.patch.matchPct !== undefined);
check('the parsed match percentage is saved', patchAfterScreen && patchAfterScreen.body.patch.matchPct === 62,
  JSON.stringify(patchAfterScreen));
check('a candidate still at Applied moves to Screened once screened',
  patchAfterScreen && patchAfterScreen.body.status === 'Screened');
check('the AI never decides the outcome — no auto stage jump to Selected/Rejected',
  patchAfterScreen && patchAfterScreen.body.status !== 'Selected' && patchAfterScreen.body.status !== 'Rejected');

// ---------- move the stage by hand, then convert to employee ----------
calls.length = 0;
await wait(150);
const stageSel = window.document.querySelector('.rc-cd-stage[data-id="' + candId + '"]');
check('the stage selector is present after re-render', !!stageSel);
stageSel.value = 'Selected'; change(stageSel);
await wait(200);
const stageCall = calls.find(c => c.kind === 'item-patch' && c.body.status === 'Selected');
check('changing the stage patches the item with the new status', !!stageCall, JSON.stringify(calls));

calls.length = 0;
await wait(150);
var joinBtn = window.document.querySelector('.rc-cd-join[data-id="' + candId + '"]');
check('Convert to employee is offered once Selected', !!joinBtn);
click(joinBtn);
await wait(250);
const empCall = calls.find(c => c.kind === 'emp-save');
check('converting creates a real employee record', !!empCall, JSON.stringify(calls));
check('the employee gets an auto-assigned ID, same scheme as Add Employee',
  empCall && empCall.body.employee.empId === 'EMP001', empCall && empCall.body.employee.empId);
check('the employee carries the candidate\'s name', empCall && empCall.body.employee.name === 'Vikram Shah');
const linkPatch = calls.find(c => c.kind === 'item-patch' && c.body.status === 'Joined');
check('the candidate record is linked back to the new employee id and marked Joined',
  linkPatch && linkPatch.body.patch.empId === 'EMP001', JSON.stringify(linkPatch));

check('no console errors while any of this ran', pageErrors.length === 0, pageErrors.join(' | '));

const failed = results.filter(([, ok]) => !ok);
for (const [n, ok, x] of results) console.log((ok ? '  ok  ' : '  X   ') + n + (ok ? '' : '   [' + x + ']'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, of ${results.length}`);
process.exit(failed.length ? 1 : 0);
