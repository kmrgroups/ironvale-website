/* v111 tests. The controls are the point of these screens, so the fixture is
   built to try to break each one:
     - two parts, one in series production with no PFMEA (the finding)
     - a signatory list where one person may prepare and another may approve
     - an attempt to issue with the preparer as approver
     - an attempt to issue signed by somebody not on the list
     - an attempt to number a document with no format defined */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let docs = [], parts = [], idSeq = 1, serial = 0;
const settings = {};
const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

parts.push({ part_id: 'P1', part_no: 'PART-1', part_name: 'Housing', lifecycle: 'Series', data: {} });
parts.push({ part_id: 'P2', part_no: 'PART-2', part_name: 'Cover', lifecycle: 'APQP', data: {} });

// PART-1 has a routing and a control plan, but no PFMEA — the finding
docs.push({ doc_id: 'pr1', kind: 'process', part_id: 'P1', doc_no: 'OP10',
  data: { partId: 'P1', opNo: 10, name: 'Turning' } });
docs.push({ doc_id: 'pr2', kind: 'process', part_id: 'P1', doc_no: 'OP20',
  data: { partId: 'P1', opNo: 20, name: 'Milling' } });
docs.push({ doc_id: 'cp1', kind: 'control_plan', part_id: 'P1', doc_no: 'CP-1', status: 'Issued',
  data: { partId: 'P1', date: ago(30), revision: 2, preparedBy: 'S Rao' } });

const auditTrail = [
  { at: ago(1) + 'T09:30:00', who: 'tester', kind: 'part', ref: 'PART-1', action: 'updated',
    reason: 'lifecycle moved to Series',
    before_val: { lifecycle: 'PPAP' }, after_val: { lifecycle: 'Series' } },
  { at: ago(4) + 'T14:05:00', who: 'srao', kind: 'gauge', ref: 'GA-1', action: 'calibrated',
    reason: 'annual calibration', before_val: null, after_val: null }
];

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
  if (url.startsWith('/api/hr')) return ok({ employees: [], attendance: [] });
  if (url.startsWith('/api/rfqs')) return ok({ rfqs: [] });
  if (url.startsWith('/api/idms')) {
    if (url.includes('what=audit')) return ok({ audit: auditTrail });
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
        if (ex) { ex.data = d.data; ex.status = d.status; ex.doc_no = d.docNo || ex.doc_no; return ok({ docId: d.docId }); }
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
const input = el => el.dispatchEvent(new window.Event('input', { bubbles: true }));
const nav = id => click(window.document.querySelector('#menubar [data-s="' + id + '"]'));
const txt = el => el.textContent.replace(/\s+/g, ' ');

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(250);

// ================= document formats =================
nav('doc_format_master'); await wait(500);
click($('df-save')); await wait(250);
check('a format with no document kind is refused', /what kind/i.test(txt($('df-msg'))), txt($('df-msg')));

$('df-type').value = 'Procedure';
click($('df-save')); await wait(250);
check('a format with no prefix is refused', /prefix/i.test(txt($('df-msg'))), txt($('df-msg')));

$('df-level').value = '2';
$('df-prefix').value = 'TEST/QSP';
input($('df-prefix'));
check('the next number is shown before saving', /TEST\/QSP-001/.test(txt($('df-example'))), txt($('df-example')));

click($('df-save')); await wait(400);
check('the format saves', docs.filter(d => d.kind === 'docformat').length === 1, txt($('df-msg')));

$('df-level').value = '2'; $('df-type').value = 'procedure'; $('df-prefix').value = 'OTHER';
click($('df-save')); await wait(300);
check('two schemes for one kind of document are refused',
  /already a format/i.test(txt($('df-msg'))), txt($('df-msg')));

// ================= signatories =================
nav('signatories'); await wait(500);
$('sg-level').value = '2'; $('sg-type').value = 'Procedure';
$('sg-prep').value = 'S Rao';
$('sg-app').value = '';
click($('sg-save')); await wait(250);
check('a kind with nobody able to approve is refused',
  /able to approve/i.test(txt($('sg-msg'))), txt($('sg-msg')));

$('sg-app').value = 'S Rao';
click($('sg-save')); await wait(250);
check('one person as the only preparer and only approver is refused',
  /Nothing of this kind could then be issued/i.test(txt($('sg-msg'))), txt($('sg-msg')));

$('sg-rev').value = 'M Iyer';
$('sg-app').value = 'V Menon';
click($('sg-save')); await wait(400);
check('a workable signatory list saves', docs.filter(d => d.kind === 'signatory').length === 1, txt($('sg-msg')));

// ================= the register =================
nav('qms_level2'); await wait(600);
check('the level is named on the screen', /Level 2/.test(txt($('qd-title'))), txt($('qd-title')));

$('qd-doctitle').value = 'Control of documented information';
click($('qd-save')); await wait(250);
check('a document with no kind is refused', /what kind of document/i.test(txt($('qd-msg'))), txt($('qd-msg')));

$('qd-type').value = 'Work instruction';
click($('qd-save')); await wait(300);
check('a kind with no numbering format cannot be numbered',
  /no numbering format/i.test(txt($('qd-msg'))), txt($('qd-msg')));

$('qd-type').value = 'Procedure'; change($('qd-type')); await wait(200);
check('the signatory lists are offered once the kind is chosen',
  /S Rao/.test($('qd-prep-list').innerHTML) && /V Menon/.test($('qd-app-list').innerHTML),
  $('qd-app-list').innerHTML);

click($('qd-save')); await wait(450);
check('a draft takes the next number from the format',
  (docs.find(d => d.kind === 'qmsdoc') || { data: {} }).data.docNo === 'TEST/QSP-001',
  (docs.find(d => d.kind === 'qmsdoc') || { data: {} }).data.docNo);
check('the draft is not issued', (docs.find(d => d.kind === 'qmsdoc') || {}).status === 'Draft');
check('the serial moved on', (docs.find(d => d.kind === 'docformat') || { data: {} }).data.nextSerial === 2);

// open the draft and try to issue it badly
click($('qd-list').querySelector('.qd-edit')); await wait(250);
click($('qd-issue')); await wait(250);
check('issuing without three signatures is refused',
  /preparer, a reviewer and an approver/i.test(txt($('qd-msg'))), txt($('qd-msg')));

$('qd-prep').value = 'S Rao'; $('qd-rev').value = 'M Iyer'; $('qd-app').value = 'S Rao';
click($('qd-issue')); await wait(250);
check('the same person cannot prepare and approve',
  /cannot both prepare and approve/i.test(txt($('qd-msg'))), txt($('qd-msg')));

$('qd-app').value = 'Somebody Else';
click($('qd-issue')); await wait(250);
check('an approver who is not on the signatory list is refused',
  /not on the list of people who may approve/i.test(txt($('qd-msg'))), txt($('qd-msg')));

$('qd-app').value = 'V Menon';
click($('qd-issue')); await wait(500);
const issued = docs.find(d => d.kind === 'qmsdoc');
check('with three authorised signatures it issues', issued.status === 'Issued', txt($('qd-msg')));
check('issuing stamps revision 1', issued.data.revision === 1);
check('and the issue date', !!issued.data.issuedOn);
check('the number did not change on issue', issued.data.docNo === 'TEST/QSP-001');
check('the revision history is kept', (issued.data.history || []).length === 1);

// a second document takes the next serial, not the same one
click($('qd-clear')); await wait(100);
$('qd-type').value = 'Procedure'; $('qd-doctitle').value = 'Control of records';
click($('qd-save')); await wait(450);
check('the second document gets the next number, not a duplicate',
  docs.filter(d => d.kind === 'qmsdoc').map(d => d.data.docNo).join(',') === 'TEST/QSP-001,TEST/QSP-002',
  docs.filter(d => d.kind === 'qmsdoc').map(d => d.data.docNo).join(','));

// ================= master lists =================
nav('doc_master_pfmea'); await wait(600);
const pf = txt($('ml2-body'));
check('the PFMEA master list has a row per part', /PART-1/.test(pf) && /PART-2/.test(pf), pf.slice(0, 200));
check('parts with no PFMEA are shown as missing', /none on file/.test(pf), pf.slice(0, 300));
check('a part in series production with none is called out',
  /series production have none/i.test(txt($('ml2-msg'))) && /PART-1/.test(txt($('ml2-msg'))),
  txt($('ml2-msg')));

$('ml2-filter').value = 'missing'; change($('ml2-filter')); await wait(200);
check('the missing filter narrows the list',
  $('ml2-body').querySelectorAll('tbody tr').length === 2,
  'rows=' + $('ml2-body').querySelectorAll('tbody tr').length);

nav('doc_master_cp'); await wait(600);
const cp = txt($('ml2-body'));
check('the control plan list finds the one on file', /CP-1/.test(cp), cp.slice(0, 300));
check('and still reports the part without one', /none on file/.test(cp), cp.slice(0, 300));

nav('doc_master_pfd'); await wait(600);
check('the PFD list counts the routing operations',
  /2 operations/.test(txt($('ml2-body'))), txt($('ml2-body')).slice(0, 300));

// ================= audit trail =================
nav('compliance_audit_trail'); await wait(600);
const ct = txt($('ct-body'));
check('the trail is shown', /tester/.test(ct) && /srao/.test(ct), ct.slice(0, 250));
check('what changed is worked out from before and after',
  /changed: lifecycle/.test(ct), ct.slice(0, 400));
check('the reason is shown', /annual calibration/.test(ct), ct.slice(0, 400));
check('the screen says the trail cannot be edited',
  /can edit or remove/i.test(txt($('ct-msg'))), txt($('ct-msg')));

$('ct-q').value = 'gauge'; input($('ct-q')); await wait(200);
check('searching narrows the trail',
  $('ct-body').querySelectorAll('tbody tr').length === 1,
  'rows=' + $('ct-body').querySelectorAll('tbody tr').length);

$('ct-q').value = ''; input($('ct-q')); await wait(150);
$('ct-kind').value = 'part'; change($('ct-kind')); await wait(200);
check('filtering by kind of record works',
  $('ct-body').querySelectorAll('tbody tr').length === 1);

check('no page errors throughout', pageErrors.length === 0, pageErrors[0] || '');

let pass = 0, fail = 0;
for (const [n, okv, x] of results) { if (okv) pass++; else { fail++; console.log('  x ' + n + (x ? '   [' + x + ']' : '')); } }
console.log('\n' + pass + ' passed, ' + fail + ' failed, of ' + results.length);
process.exit(fail ? 1 : 0);
