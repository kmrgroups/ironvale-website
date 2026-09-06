/* Tests for the modules added in v105. The stub updates a doc in place when a
   docId is sent, exactly as the server does — a stub that inserts instead would
   have hidden the "saving twice duplicates the record" class of bug. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let docs = [], parts = [], idSeq = 1, serial = 0;
const settings = {};
const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const ahead = n => ago(-n);

parts.push({ part_id: 'P1', part_no: 'TEST-PART-0001', part_name: 'Housing', lifecycle: 'APQP', customer: 'Alpha', quote_ref: 'Q-77', data: {} });
docs.push({ doc_id: 'g1', kind: 'grn', doc_no: 'GRN-1', data: { supplier: 'Steelco', description: 'EN8 bright bar', received: 500 } });
docs.push({ doc_id: 'g2', kind: 'grn', doc_no: 'GRN-2', data: { supplier: 'Steel Co.', description: 'EN8 bright bar', received: 200 } });
docs.push({ doc_id: 'cp1', kind: 'cust_part', part_id: 'P1', doc_no: 'ALPHA-9', data: { partId: 'P1', custPartNo: 'ALPHA-9', custDrawingNo: 'DRG-441', price: 82.5 } });
docs.push({ doc_id: 'pr1', kind: 'process', part_id: 'P1', doc_no: 'OP10', data: { opNo: 10, name: 'Turning', machine: 'CNC-01' } });
docs.push({ doc_id: 'dm1', kind: 'dimension', part_id: 'P1', data: { processId: 'pr1', name: 'OD', cls: 'CC', gauge: 'Micrometer', frequency: '5/shift' } });

const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => pageErrors.push(e.message));

const dom = new JSDOM(html.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''),
  { runScripts: 'outside-only', url: 'https://example.test/idms.html', virtualConsole: vc });
const { window } = dom;
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
  if (url.startsWith('/api/hr?what=employees')) return ok({ employees: [
    { data: { empId: 'E1', designation: 'CNC Operator', department: 'Machining', status: 'Active' } },
    { data: { empId: 'E2', designation: 'CNC Operator', department: 'Machining', status: 'Active' } },
    { data: { empId: 'E3', designation: 'Fitter', department: 'Maintenance', status: 'Active' } }] });
  if (url.startsWith('/api/hr')) return ok({ attendance: [] });
  if (url.startsWith('/api/rfqs')) return ok({ rfqs: [] });
  if (url.startsWith('/api/idms')) {
    if (url.includes('what=settings')) { if (opts.method === 'POST') { settings[body.key] = body.data; return ok({}); } return ok({ settings }); }
    if (url.includes('what=parts')) return ok({ parts });
    if (url.includes('what=serial')) return ok({ next: ++serial });
    if (url.includes('what=docs')) {
      const kind = decodeURIComponent((url.match(/kind=([^&]+)/) || [, ''])[1]);
      const pid = decodeURIComponent((url.match(/partId=([^&]+)/) || [, ''])[1]);
      return ok({ docs: docs.filter(d => (!kind || d.kind === kind) && (!pid || d.part_id === pid)) });
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

/* jsdom has no scrollIntoView; the app is right to call it, the harness is what
   is missing. Stubbing it beats weakening the code to suit the test. */
window.Element.prototype.scrollIntoView = function () {};

const $ = id => window.document.getElementById(id);
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, c, x) => results.push([n, !!c, x || '']);
const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const change = el => el.dispatchEvent(new window.Event('change', { bubbles: true }));
function nav(id) {
  const a = window.document.querySelector('#menubar [data-s="' + id + '"]');
  if (!a) throw new Error('no menu entry for ' + id);
  click(a);
}

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'secret123';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(250);

// ================= supplier master =================
nav('entry_supplier');
await wait(250);
check('supplier screen is live', window.document.querySelector('[data-panel="entry_supplier"]').classList.contains('on'));
check('names on the receipts are offered for adoption',
  $('su-unknown').querySelectorAll('.su-adopt').length === 2,
  $('su-unknown').textContent.slice(0, 90));

click($('su-unknown').querySelector('.su-adopt'));
check('adopting fills the name', $('su-name').value.length > 0, $('su-name').value);
$('su-status').value = 'Approved';
$('su-cert').value = 'IATF 16949';
$('su-certtill').value = ago(10);                       // expired
click($('su-save'));
await wait(250);
check('approved on an expired certificate is refused', /expired/i.test($('su-msg').textContent), $('su-msg').textContent);
check('and nothing was written', !docs.some(d => d.kind === 'supplier'));

$('su-certtill').value = ahead(200);
click($('su-save'));
await wait(300);
check('a valid certificate saves', docs.filter(d => d.kind === 'supplier').length === 1, $('su-msg').textContent);
check('the code came from the database', /TEST-SUP-/.test((docs.find(d => d.kind === 'supplier') || {}).doc_no || ''),
  (docs.find(d => d.kind === 'supplier') || {}).doc_no);

$('su-name').value = 'steelco';                          // same supplier, different case
click($('su-save'));
await wait(250);
check('the same supplier twice is refused', /already on the panel/i.test($('su-msg').textContent), $('su-msg').textContent);
check('still one supplier', docs.filter(d => d.kind === 'supplier').length === 1);

nav('entry_supplier'); await wait(250);
check('one name adopted leaves one to adopt', $('su-unknown').querySelectorAll('.su-adopt').length === 1);
check('the panel lists receipts against the supplier', /Steelco/.test($('su-list').textContent));

// ================= raw material master =================
nav('entry_rawmat');
await wait(250);
check('material descriptions from receipts are offered', $('rm-unknown').querySelectorAll('.rm-adopt').length === 1);
check('the supplier picker is filled from the panel', $('rm-sup').options.length === 2, $('rm-sup').innerHTML.slice(0, 80));
click($('rm-unknown').querySelector('.rm-adopt'));
$('rm-spec').value = 'EN8'; $('rm-size').value = 'D32 x 3000'; $('rm-rate').value = '78.50';
click($('rm-save'));
await wait(300);
check('material saves', docs.filter(d => d.kind === 'rawmat').length === 1, $('rm-msg').textContent);
$('rm-desc').value = 'EN8 BRIGHT BAR';
click($('rm-save'));
await wait(250);
check('the same material twice is refused', /already on the list/i.test($('rm-msg').textContent), $('rm-msg').textContent);
check('the rate kept its paise', (docs.find(d => d.kind === 'rawmat') || { data: {} }).data.rate === 78.5);

// ================= organisation masters =================
nav('dept_master'); await wait(200);
$('om-name').value = 'Machining'; $('om-code').value = 'MCH';
click($('om-save')); await wait(300);
check('department saves', docs.some(d => d.kind === 'orgmaster' && d.data.type === 'department'));

nav('desig_master'); await wait(250);
check('designation form offers the departments', $('om-dept').options.length === 2, $('om-dept').innerHTML);
$('om-name').value = 'CNC Operator'; $('om-code').value = 'W3'; $('om-dept').value = 'Machining';
click($('om-save')); await wait(300);
check('designation saves', docs.some(d => d.kind === 'orgmaster' && d.data.type === 'designation'));

nav('position_master'); await wait(250);
$('om-name').value = 'CNC Operator — Cell 1'; $('om-dept').value = 'Machining'; $('om-count').value = '4';
click($('om-save')); await wait(250);
check('a position with no designation is refused', /needs a designation/i.test($('om-msg').textContent), $('om-msg').textContent);
$('om-desig').value = 'CNC Operator';
click($('om-save')); await wait(350);
check('position saves', docs.some(d => d.kind === 'orgmaster' && d.data.type === 'position'), $('om-msg').textContent);
check('filled is counted from the employee records, not typed',
  /<td class="r">2<\/td>/.test($('om-list').innerHTML), $('om-list').textContent.replace(/\s+/g, ' ').slice(0, 160));
check('vacancy follows from it', /<td class="r">2<\/td>/.test($('om-list').innerHTML));

// ================= APQP =================
nav('apqp');
await wait(300);
$('ap-part').value = 'P1';
change($('ap-part'));
await wait(600);
check('the programme opens for the part', /TEST-PART-0001/.test($('ap-body').textContent), $('ap-body').textContent.slice(0, 80));
check('all five phases are drawn', $('ap-body').querySelectorAll('.ap-gate').length === 5);
check('the routing is read as evidence', /operations on the routing/.test($('ap-body').textContent));
check('the quotation on the part is read as evidence', /Q-77/.test($('ap-body').textContent));
check('a missing PFMEA is reported, not assumed',/No PFMEA yet/.test($('ap-body').textContent));
check('evidence lines carry no tick box',
  $('ap-body').querySelectorAll('input[type="checkbox"]').length === 0);

// signing off with work outstanding must be refused, and must name what is missing
$('ap-body').querySelector('.ap-gate-by[data-p="1"]').value = '';
click($('ap-body').querySelector('.ap-gate[data-p="1"]'));
await wait(200);
check('a sign-off with no name is refused', /needs a name/i.test($('ap-msg').textContent), $('ap-msg').textContent);

$('ap-body').querySelector('.ap-gate-by[data-p="1"]').value = 'A Rao';
click($('ap-body').querySelector('.ap-gate[data-p="1"]'));
await wait(300);
check('a phase with outstanding work is refused', /cannot be signed off/i.test($('ap-msg').textContent), $('ap-msg').textContent.slice(0, 90));
check('and the outstanding lines are named', /bill of materials/i.test($('ap-msg').textContent));
check('nothing was signed off', !docs.some(d => d.kind === 'apqp' && Object.keys(d.data.gates || {}).length));

// fill in the manual lines of phase 1, then it should sign off
for (const inp of $('ap-body').querySelectorAll('.ap-in[data-f="actual"]')) { inp.value = ago(3); change(inp); }
await wait(500);
check('entered dates are saved as they are typed', docs.some(d => d.kind === 'apqp'));
$('ap-body').querySelector('.ap-gate-by[data-p="1"]').value = 'A Rao';
click($('ap-body').querySelector('.ap-gate[data-p="1"]'));
await wait(400);
check('phase 1 signs off once nothing is outstanding', /signed off/i.test($('ap-msg').textContent), $('ap-msg').textContent.slice(0, 90));
check('the sign-off carries the name',
  (((docs.find(d => d.kind === 'apqp') || { data: {} }).data.gates || {})['1'] || {}).by === 'A Rao');
check('one APQP record for the part, not one per save', docs.filter(d => d.kind === 'apqp').length === 1);

// a phase whose evidence never arrives still cannot be signed
$('ap-body').querySelector('.ap-gate-by[data-p="4"]').value = 'A Rao';
click($('ap-body').querySelector('.ap-gate[data-p="4"]'));
await wait(300);
check('validation phase stays shut while the records are empty',
  /cannot be signed off/i.test($('ap-msg').textContent), $('ap-msg').textContent.slice(0, 80));

// ================= the menu no longer lists a screen twice =================
const menuText = $('menubar').textContent;
check('MSA is on the menu once', (menuText.match(/MSA/g) || []).length === 1, (menuText.match(/MSA[^\n]{0,18}/g)||[]).join(' | '));
const soon = [...window.document.querySelectorAll('#menubar .drop a')].filter(a => a.querySelector('.soon'));
check('the pending list is down to 7', soon.length === 7, 'soon=' + soon.length);
/* named rather than counted, so this does not go red every time one is built */
['entry_supplier','entry_rawmat','apqp','dept_master','desig_master','position_master',
 'bom','sheet_rawmat','report_control_charts','capacity_plan','machine_loading',
 'competency_map','gap_analysis','tni','training_plan_actual','training_effectiveness',
 'org_chart','roles_resp','succession_plan','audits','cft_master',
 'qms_level1','qms_level2','qms_level3','qms_level4','doc_format_master','signatories',
 'doc_master_pfd','doc_master_pfmea','doc_master_cp','compliance_audit_trail',
 'users','report_tool_history','report_machine_checksheet','dwm','task_list'].forEach(id => {
  const a = window.document.querySelector('#menubar [data-s="' + id + '"]');
  check(id + ' is no longer marked soon', a && !a.querySelector('.soon'));
});

check('no page errors throughout', pageErrors.length === 0, pageErrors[0] || '');

let pass = 0, fail = 0;
for (const [n, okv, x] of results) { if (okv) pass++; else { fail++; console.log('  x ' + n + (x ? '   [' + x + ']' : '')); } }
console.log('\n' + pass + ' passed, ' + fail + ' failed, of ' + results.length);
process.exit(fail ? 1 : 0);
