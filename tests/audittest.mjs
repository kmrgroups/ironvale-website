/* v110 tests. The fixture is arranged so the two independence rules and the
   closure arithmetic are all checkable:
     - one auditor qualified for process audits but working in Machining
     - one auditor qualified for process audits working in Quality
     - one CFT member qualified for nothing
     - a lapsed qualification
   and afterwards an audit with two findings, one closed and one left overdue,
   so the QMS dashboard has something with a known right answer to count. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let docs = [], parts = [], idSeq = 1, serial = 0;
const settings = {};
const iso = d => d.toISOString().slice(0, 10);
const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const ahead = n => ago(-n);

const employees = [
  { data: { empId: 'E1', name: 'S Rao', designation: 'QA Engineer', department: 'Quality', status: 'Active' } },
  { data: { empId: 'E2', name: 'M Iyer', designation: 'Shift Supervisor', department: 'Machining', status: 'Active' } },
  { data: { empId: 'E3', name: 'K Das', designation: 'Storekeeper', department: 'Stores', status: 'Active' } }
];
docs.push({ doc_id: 'd1', kind: 'orgmaster', doc_no: 'MCH', data: { type: 'department', name: 'Machining' } });
docs.push({ doc_id: 'd2', kind: 'orgmaster', doc_no: 'QLT', data: { type: 'department', name: 'Quality' } });

const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => pageErrors.push(e.message));
const dom = new JSDOM(html.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''),
  { runScripts: 'outside-only', url: 'https://example.test/idms.html', virtualConsole: vc });
const { window } = dom;
window.Element.prototype.scrollIntoView = function () {};
if (!window.CSS) window.CSS = {};
if (!window.CSS.escape) window.CSS.escape = s => String(s).replace(/["\\]/g, '\\$&');
let signedIn = false;
const prompts = [];
window.prompt = () => prompts.length ? prompts.shift() : null;

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
  if (url.startsWith('/api/hr?what=employees')) return ok({ employees });
  if (url.startsWith('/api/hr')) return ok({ attendance: [] });
  if (url.startsWith('/api/rfqs')) return ok({ rfqs: [] });
  if (url.startsWith('/api/idms')) {
    if (url.includes('what=settings')) { if (opts.method === 'POST') { settings[body.key] = body.data; return ok({}); } return ok({ settings }); }
    if (url.includes('what=parts')) return ok({ parts });
    if (url.includes('what=serial')) return ok({ next: ++serial });
    if (url.includes('what=docs')) {
      const kind = decodeURIComponent((url.match(/kind=([^&]+)/) || [, ''])[1]);
      return ok({ docs: docs.filter(d => !kind || d.kind === kind) });
    }
    if (opts.method === 'POST' && body.what === 'docs') {
      const d = body.doc;
      if (d.docId) {
        const ex = docs.find(x => x.doc_id === d.docId);
        if (ex) { ex.data = d.data; ex.status = d.status; return ok({ docId: d.docId }); }
      }
      const id = 'n' + (idSeq++);
      docs.push({ doc_id: id, kind: d.kind, part_id: d.partId, doc_no: d.docNo, status: d.status, data: d.data });
      return ok({ docId: id });
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
const txt = el => el.textContent.replace(/\s+/g, ' ');
const tick = (host, value) => {
  const cb = [...$(host).querySelectorAll('.cf-q')].find(c => c.value === value);
  cb.checked = true;
};

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(250);

// ================= CFT members =================
nav('cft_master'); await wait(600);
check('the qualification tick boxes are offered', $('cf-quals').querySelectorAll('.cf-q').length === 7,
  'boxes=' + $('cf-quals').querySelectorAll('.cf-q').length);

$('cf-who').value = 'Nobody Here';
click($('cf-save')); await wait(300);
check('somebody who does not work here cannot join the team',
  /not on the employee records/i.test(txt($('cf-msg'))), txt($('cf-msg')));

$('cf-who').value = 'S Rao';
tick('cf-quals', 'Process');
$('cf-on').value = '';
click($('cf-save')); await wait(300);
check('a qualification with no date is refused', /when they were qualified/i.test(txt($('cf-msg'))), txt($('cf-msg')));

$('cf-on').value = ago(200);
$('cf-fn').value = 'Quality';
click($('cf-save')); await wait(400);
check('a qualified member is saved', docs.filter(d => d.kind === 'cft').length === 1, txt($('cf-msg')));
check('their department comes from their employee record',
  (docs.find(d => d.kind === 'cft') || { data: {} }).data.department === 'Quality');

// a second member: qualified for process audits but working in Machining
$('cf-who').value = 'M Iyer'; $('cf-on').value = ago(100); $('cf-fn').value = 'Production';
tick('cf-quals', 'Process');
click($('cf-save')); await wait(400);
check('a second member is saved', docs.filter(d => d.kind === 'cft').length === 2);

// a third: on the team, qualified for nothing
$('cf-who').value = 'K Das'; $('cf-fn').value = 'PPC';
click($('cf-save')); await wait(400);
check('somebody can be on the team without being an auditor',
  docs.filter(d => d.kind === 'cft').length === 3, txt($('cf-msg')));

$('cf-who').value = 'S Rao'; $('cf-on').value = ago(50);
click($('cf-save')); await wait(300);
check('the same person twice is refused', /already on the team/i.test(txt($('cf-msg'))), txt($('cf-msg')));

// ================= audit register =================
nav('audits'); await wait(700);
check('the audit kinds are offered', $('au-new-type').options.length === 10, $('au-new-type').innerHTML);

$('au-new-type').value = 'Process'; change($('au-new-type')); await wait(200);
check('only qualified auditors are offered for a process audit',
  $('au-auditor').options.length === 3, $('au-auditor').innerHTML);   // placeholder + 2 qualified
check('the unqualified member is not offered', !/K Das/.test($('au-auditor').innerHTML));

$('au-area').value = 'OP10 Turning';
$('au-dept').value = 'Machining';
$('au-plan').value = '';
$('au-auditor').value = 'S Rao';
click($('au-add')); await wait(250);
check('an audit with no planned date is refused', /planned date/i.test(txt($('au-msg'))), txt($('au-msg')));

$('au-plan').value = ago(30);
$('au-auditor').value = 'M Iyer';            // works in Machining — the department being audited
click($('au-add')); await wait(300);
check('nobody audits their own department', /own department/i.test(txt($('au-msg'))), txt($('au-msg')));
check('and nothing was written', !docs.some(d => d.kind === 'audit'));

$('au-new-type').value = 'Layout'; change($('au-new-type')); await wait(200);
check('nobody qualified for a layout audit is offered',
  /nobody is qualified/i.test($('au-auditor').textContent), $('au-auditor').textContent);

$('au-new-type').value = 'Process'; change($('au-new-type')); await wait(200);
$('au-auditor').value = 'S Rao';
$('au-auditee').value = 'M Iyer';
click($('au-add')); await wait(400);
check('an independent qualified auditor is accepted',
  docs.filter(d => d.kind === 'audit').length === 1, txt($('au-msg')));
check('the audit is listed in the plan', /OP10 Turning/.test(txt($('au-list'))), txt($('au-list')).slice(0, 200));
check('an audit past its date with no result is shown overdue',
  /overdue/i.test(txt($('au-list'))), txt($('au-list')).slice(0, 300));

click($('au-list').querySelector('.au-open')); await wait(250);
check('findings cannot be recorded before the audit happened',
  /has not happened/i.test(txt($('au-detail'))), txt($('au-detail')).slice(0, 200));

$('au-actual').value = ahead(5);
click($('au-conduct')); await wait(250);
check('an audit cannot be recorded as done in the future',
  /in the future/i.test(txt($('au-msg'))), txt($('au-msg')));

$('au-actual').value = ago(28);
click($('au-conduct')); await wait(400);
check('recording it as carried out opens the findings',
  !!$('au-add-find'), txt($('au-detail')).slice(0, 120));

$('au-find').value = 'Setup approval not signed before first piece';
$('au-owner').value = '';
click($('au-add-find')); await wait(250);
check('a finding with no owner is refused', /owner/i.test(txt($('au-msg'))), txt($('au-msg')));

$('au-owner').value = 'M Iyer';
$('au-due').value = '';
click($('au-add-find')); await wait(250);
check('a finding with no closing date is refused',
  /never be overdue/i.test(txt($('au-msg'))), txt($('au-msg')));

$('au-due').value = ago(3);                  // due three days ago = overdue once open
$('au-sev').value = 'Major';
click($('au-add-find')); await wait(450);
check('the finding is recorded',
  ((docs.find(d => d.kind === 'audit') || { data: {} }).data.findings || []).length === 1, txt($('au-msg')));
check('it shows as overdue while open', /overdue/i.test(txt($('au-detail'))), txt($('au-detail')).slice(0, 400));

// a second finding, which will be closed
$('au-find').value = 'Gauge identification missing';
$('au-owner').value = 'S Rao';
$('au-due').value = ahead(20);
$('au-sev').value = 'Minor';
click($('au-add-find')); await wait(450);
check('a second finding is recorded',
  ((docs.find(d => d.kind === 'audit') || { data: {} }).data.findings || []).length === 2);

// closing needs a root cause, an action and a verifier
prompts.push('');
click([...$('au-detail').querySelectorAll('.au-close')][1]); await wait(250);
check('a finding cannot be closed without a root cause',
  ((docs.find(d => d.kind === 'audit') || { data: {} }).data.findings[1].closedOn || '') === '');

prompts.push('Identification labels were never issued for the new gauges',
  'Labels printed and applied; added to the gauge issue checklist', 'S Rao');
click([...$('au-detail').querySelectorAll('.au-close')][1]); await wait(500);
const audit = docs.find(d => d.kind === 'audit');
check('with a cause, an action and a verifier it closes',
  !!audit.data.findings[1].closedOn, JSON.stringify(audit.data.findings[1]).slice(0, 120));
check('the verifier is recorded', audit.data.findings[1].verifiedBy === 'S Rao');
check('the audit stays open while one finding is open', audit.status === 'Carried out');

// ================= the QMS dashboard now counts it =================
/* a product audit as well, so the dashboard has to keep the two kinds apart
   rather than counting every audit under every heading */
docs.push({ doc_id: 'aud2', kind: 'audit', doc_no: 'AUD-2', status: 'Carried out',
  data: { type: 'Product', area: 'Housing', department: 'Quality', auditor: 'S Rao',
    plannedOn: ago(20), actualOn: ago(19), findings: [] } });

nav('dash_qms'); await wait(1200);
const dash = txt($('kd-body'));
check('process audit plan vs actual is computed from the register',
  /Counted from the audit register/.test(dash), dash.slice(0, 300));
check('the closure figures are computed too',
  /Counted from the findings on the audit register/.test(dash), dash.slice(0, 600));
function qmsCard(title) {
  return [...$('kd-body').querySelectorAll('.kpi-card')]
    .find(c => c.querySelector('h4').textContent.startsWith(title));
}
check('the process audit card draws from the register',
  !!qmsCard('Process audit —').querySelector('svg'));
check('the process closure card draws from the findings',
  !!qmsCard('Process audit NC closure').querySelector('svg'));
check('the product audit card draws too', !!qmsCard('Product audit —').querySelector('svg'));
/* the point of the type split: a process audit must not be counted as an IQA */
check('an audit of one kind is not counted under another',
  !!qmsCard('IQA audit').querySelector('.kpi-empty'),
  txt(qmsCard('IQA audit')).slice(0, 80));
check('a kind with no audits says so rather than showing zero',
  /No records/.test(txt(qmsCard('Dock audit'))), txt(qmsCard('Dock audit')).slice(0, 90));

check('no page errors throughout', pageErrors.length === 0, pageErrors[0] || '');

let pass = 0, fail = 0;
for (const [n, okv, x] of results) { if (okv) pass++; else { fail++; console.log('  x ' + n + (x ? '   [' + x + ']' : '')); } }
console.log('\n' + pass + ' passed, ' + fail + ' failed, of ' + results.length);
process.exit(fail ? 1 : 0);
