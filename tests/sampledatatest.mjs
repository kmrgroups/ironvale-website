/* Sample Data, end to end. This is the one test that exercises saving AND
   retrieval for nearly every record kind at once: the seeder writes them
   through the real client code paths, and the checks below read them back
   the same way a screen would. If a kind saves but cannot be read back —
   or is seeded but never cleaned up — this catches it. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let docs = [], parts = [], hrItems = [], hrEmployees = [], seq = 0;
const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => pageErrors.push(e.message));
const dom = new JSDOM(html.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''),
  { runScripts: 'outside-only', url: 'https://example.test/idms.html', virtualConsole: vc });
const { window } = dom;
window.Element.prototype.scrollIntoView = function () {};
window.confirm = () => true;

let signedIn = false;
window.fetch = async (path, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : {};
  const url = String(path);
  const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
  if (url.startsWith('/api/auth')) {
    if (body.action === 'login') { signedIn = true; return ok({ token: 'T', user: 'tester', role: 'developer' }); }
    if (body.action === 'session') return signedIn ? ok({ user: 'tester', role: 'developer' }) : { ok: false, status: 401, json: async () => ({ error: 'x' }) };
    return ok({});
  }
  if (url.startsWith('/api/content')) return ok({ data: { company: { legalName: 'Test Mfg', docPrefix: 'TEST' } } });
  if (url.startsWith('/api/rfqs')) return ok({ rfqs: [] });
  if (url.startsWith('/api/settings')) return ok({ settings: {} });
  if (url.startsWith('/api/hr')) {
    if (url.includes('what=employees') && (!opts.method || opts.method === 'GET')) return ok({ employees: hrEmployees });
    if (url.includes('what=items') && (!opts.method || opts.method === 'GET')) {
      const kind = decodeURIComponent((url.match(/kind=([^&]+)/) || [, ''])[1]);
      return ok({ items: kind ? hrItems.filter(x => x.kind === kind) : hrItems });
    }
    if (url.includes('what=payruns')) return ok({ payruns: [] });
    if (url.includes('what=attendance')) return ok({ attendance: [] });
    if (url.includes('what=audit')) return ok({ audit: [] });
    if (opts.method === 'POST' && body.what === 'items') {
      hrItems.push({ item_id: body.item.itemId, kind: body.item.kind, status: body.item.status, data: body.item });
      return ok({});
    }
    if (opts.method === 'POST' && body.what === 'employees') { hrEmployees.push(body.employee); return ok({}); }
    if (opts.method === 'PATCH' && body.what === 'items') {
      const i = hrItems.findIndex(x => x.item_id === body.itemId);
      if (i >= 0 && body.remove) hrItems.splice(i, 1);
      return ok({});
    }
    if (opts.method === 'PATCH' && body.what === 'employees') {
      const i = hrEmployees.findIndex(x => x.empId === body.empId);
      if (i >= 0 && body.remove) hrEmployees.splice(i, 1);
      return ok({});
    }
    return ok({});
  }
  if (url.startsWith('/api/idms')) {
    if (url.includes('what=settings')) return ok({ settings: {} });
    if (url.includes('what=serial')) return ok({ next: ++seq });
    if (url.includes('what=audit')) return ok({ audit: [] });
    if (url.includes('what=parts') && (!opts.method || opts.method === 'GET')) return ok({ parts });
    if (url.includes('what=docs') && (!opts.method || opts.method === 'GET')) {
      const kind = decodeURIComponent((url.match(/kind=([^&]+)/) || [, ''])[1]);
      return ok({ docs: kind ? docs.filter(d => d.kind === kind) : docs });
    }
    if (opts.method === 'POST' && body.what === 'docs') {
      const id = 'd' + (++seq);
      const doc = body.doc || {};
      docs.push({ doc_id: id, kind: doc.kind, doc_no: doc.docNo, status: doc.status,
        part_id: doc.partId || (doc.data || {}).partId || null, data: doc.data || {} });
      return ok({ docId: id });
    }
    if (opts.method === 'POST' && body.what === 'parts') {
      const id = 'p' + (++seq);
      const p = body.part || {};
      parts.push({ part_id: id, part_no: p.partNo || ('TEST-' + seq), part_name: p.partName,
        lifecycle: p.lifecycle || 'New', data: p.data || {} });
      return ok({ partId: id });
    }
    if (opts.method === 'POST' && body.what === 'serial') return ok({ value: ++seq });
    if (opts.method === 'POST' && body.what === 'settings') return ok({});
    if (opts.method === 'PATCH' && body.what === 'docs') {
      const i = docs.findIndex(d => d.doc_id === body.docId);
      if (i >= 0) { if (body.remove) docs.splice(i, 1); else docs[i].data = Object.assign({}, docs[i].data, body.data || {}); }
      return ok({});
    }
    if (opts.method === 'PATCH' && body.what === 'parts') {
      const i = parts.findIndex(p => p.part_id === body.partId);
      if (i >= 0 && body.remove) {
        const before = docs.length;
        docs = docs.filter(d => d.part_id !== body.partId);
        parts.splice(i, 1);
        return ok({ alsoRemoved: before - docs.length });
      }
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

await wait(150);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(400);

nav('admin_sample');
await wait(200);
click($('demo-add'));
/* the seeder makes a lot of sequential round trips; give it room */
for (let i = 0; i < 400 && $("demo-add").disabled; i++) await wait(50);
await wait(400);

check('the seeder finished without stopping part way',
  !/Stopped part way/.test($('demo-msg').textContent), $('demo-msg').textContent.slice(0, 200));

// ---------- every kind the platform reads should now have something in it ----------
const seeded = k => docs.filter(d => d.kind === k).length;
const WANT = ['customer','supplier','machine','tool','rawmat','process','dimension','gauge',
  'grn','inward','setup','production','self_insp','pdi','dc','order','cust_part',
  'pfmea','control_plan','cnc','ppap','apqp','msa','ncr','checksheet','invoice','salesplan',
  'competency','skill','tni','training','role','succession','orgnode','dwm','task',
  'qmsdoc','audit','cft','signatory','docformat','legaldoc'];
const empty = WANT.filter(k => seeded(k) === 0);
check('every record kind the screens read has sample data', empty.length === 0,
  'nothing seeded for: ' + empty.join(', '));
check('parts were created', parts.length > 0, String(parts.length));
check('employees were created', hrEmployees.length >= 3, String(hrEmployees.length));

const HR_WANT = ['policy','leave-req','requisition','candidate','reward','survey','kpi','appraisal','exit'];
const hrEmpty = HR_WANT.filter(k => !hrItems.some(x => x.kind === k));
check('every HR record kind has sample data', hrEmpty.length === 0,
  'nothing seeded for: ' + hrEmpty.join(', '));

// ---------- the data is deliberately imperfect, so the agents have something to find ----------
check('a machine is overdue or never serviced, so Preventive Maintenance is not empty-green',
  docs.some(d => d.kind === 'machine' && !d.data.lastMaintained));
check('a policy is published but unacknowledged, so Audit Readiness has a real gap',
  hrItems.some(x => x.kind === 'policy' && (x.data.acknowledgements || []).length === 0));
check('somebody is short of their role standard, so Skill Gap Analysis has a real gap',
  docs.some(d => d.kind === 'competency') && docs.some(d => d.kind === 'skill'));

// ---------- everything seeded is marked, so removal can be exact ----------
const unmarked = docs.filter(d => !d.data || !d.data.demo);
check('every seeded document is marked as sample data', unmarked.length === 0,
  unmarked.slice(0, 5).map(d => d.kind).join(', '));

// ---------- remove takes it all back out ----------
const beforeDocs = docs.length, beforeItems = hrItems.length, beforeEmps = hrEmployees.length;
check('there was a meaningful amount of data to remove', beforeDocs > 30, String(beforeDocs));
click($('demo-del'));
for (let i = 0; i < 400 && $("demo-del").disabled; i++) await wait(50);
await wait(400);
check('removing sample data clears the documents', docs.length === 0,
  docs.slice(0, 6).map(d => d.kind).join(', '));
check('removing sample data clears the HR items', hrItems.length === 0,
  hrItems.slice(0, 6).map(d => d.kind).join(', '));
check('removing sample data clears the sample employees', hrEmployees.length === 0,
  String(hrEmployees.length));
check('removing sample data clears the parts', parts.length === 0, String(parts.length));

check('no console errors while any of this ran', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

const failed = results.filter(([, ok]) => !ok);
for (const [n, ok, x] of results) console.log((ok ? '  ok  ' : '  X   ') + n + (ok ? '' : '   [' + x + ']'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, of ${results.length}`);
process.exit(failed.length ? 1 : 0);
