/* v109 tests. The fixture is set so the derived answers are checkable:
     - one department with two designations, one of them short of its sanctioned
       strength, so the chart must show a vacancy rather than a full box
     - one employee whose department is not on the masters, who must be reported
       as unplaceable rather than dropped
     - three candidates for one post at three different competence levels, so
       readiness must come out ready / ready with training / not ready
     - a sole incumbent, so naming them as their own successor must be refused */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let docs = [], parts = [], idSeq = 1, serial = 0;
const settings = {};
const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

const employees = [
  { data: { empId: 'E1', name: 'R Kumar', designation: 'CNC Operator', department: 'Machining', status: 'Active' } },
  { data: { empId: 'E2', name: 'S Babu', designation: 'CNC Operator', department: 'Machining', status: 'Active' } },
  { data: { empId: 'E3', name: 'P Anand', designation: 'CNC Operator', department: 'Machining', status: 'Active' } },
  { data: { empId: 'E4', name: 'M Iyer', designation: 'Shift Supervisor', department: 'Machining', status: 'Active' } },
  // department not on the masters — must be reported, not dropped
  { data: { empId: 'E5', name: 'K Das', designation: 'Storekeeper', department: 'Stores', status: 'Active' } }
];

docs.push({ doc_id: 'd1', kind: 'orgmaster', doc_no: 'MCH',
  data: { type: 'department', name: 'Machining', code: 'MCH', reportsTo: 'V Menon' } });
docs.push({ doc_id: 'g1', kind: 'orgmaster', doc_no: 'W3',
  data: { type: 'designation', name: 'CNC Operator', code: 'W3', department: 'Machining' } });
docs.push({ doc_id: 'g2', kind: 'orgmaster', doc_no: 'S1',
  data: { type: 'designation', name: 'Shift Supervisor', code: 'S1', department: 'Machining' } });
// five sanctioned operators, three in post => two vacancies
docs.push({ doc_id: 'p1', kind: 'orgmaster', doc_no: 'POS-1',
  data: { type: 'position', name: 'CNC Operator — Cell 1', department: 'Machining', designation: 'CNC Operator', sanctioned: 5 } });
// one supervisor sanctioned, one in post
docs.push({ doc_id: 'p2', kind: 'orgmaster', doc_no: 'POS-2',
  data: { type: 'position', name: 'Shift Supervisor', department: 'Machining', designation: 'Shift Supervisor', sanctioned: 1 } });

docs.push({ doc_id: 'mc1', kind: 'machine', doc_no: 'MC-1', data: { name: 'LATHE-1' } });

// what a supervisor must be able to do: level 4 on the lathe, and it matters
docs.push({ doc_id: 'c1', kind: 'competency', doc_no: 'CMP-1',
  data: { designation: 'Shift Supervisor', thing: 'LATHE-1', level: 4, criticality: 'Affects product quality' } });

// three operators at three levels
docs.push({ doc_id: 'sk1', kind: 'skill', doc_no: 'SK-1',
  data: { person: 'R Kumar', thing: 'LATHE-1', level: 4, assessedOn: ago(20), history: [{ on: ago(20), level: 4 }] } });
docs.push({ doc_id: 'sk2', kind: 'skill', doc_no: 'SK-2',
  data: { person: 'S Babu', thing: 'LATHE-1', level: 3, assessedOn: ago(20), history: [{ on: ago(20), level: 3 }] } });
docs.push({ doc_id: 'sk3', kind: 'skill', doc_no: 'SK-3',
  data: { person: 'P Anand', thing: 'LATHE-1', level: 1, assessedOn: ago(20), history: [{ on: ago(20), level: 1 }] } });

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

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(250);

/* The organisation chart moved to a decided-and-checked model in v114 and is
   covered by dwmtest.mjs; what remains here is the rest of the org thread. */

// ================= roles and responsibilities =================
nav('roles_resp'); await wait(600);
check('designations are offered', $('rr-desig').options.length === 2, $('rr-desig').innerHTML);
$('rr-desig').value = 'Shift Supervisor'; change($('rr-desig')); await wait(300);
check('the competence section is read from the competency map',
  /LATHE-1/.test(txt($('rr-comp'))) && /4/.test(txt($('rr-comp'))), txt($('rr-comp')).slice(0, 200));
check('who holds the role is read from the employee records',
  /M Iyer/.test(txt($('rr-holders'))), txt($('rr-holders')));

click($('rr-issue')); await wait(300);
check('a sheet with no purpose cannot be issued', /why the post exists/i.test(txt($('rr-msg'))), txt($('rr-msg')));

$('rr-purpose').value = 'Run the shift to the control plan and the plan for the day.';
click($('rr-issue')); await wait(300);
check('a sheet with no responsibilities cannot be issued',
  /nothing it is answerable for/i.test(txt($('rr-msg'))), txt($('rr-msg')));

$('rr-resp').value = 'Setup approval before the first piece\nDaily production booking\nContainment of any rejection';
$('rr-auth').value = 'Stop the line\nHold a suspect lot';
click($('rr-save')); await wait(350);
check('it saves as a draft', docs.filter(d => d.kind === 'role').length === 1, txt($('rr-msg')));
check('the draft is not marked issued',
  (docs.find(d => d.kind === 'role') || {}).status === 'Draft');

click($('rr-issue')); await wait(400);
check('with a purpose, duties and a competency requirement it issues',
  (docs.find(d => d.kind === 'role') || {}).status === 'Issued', txt($('rr-msg')));
check('issuing records a revision', (docs.find(d => d.kind === 'role') || { data: {} }).data.revision === 1);

// a role with no competency set cannot be issued
$('rr-desig').value = 'CNC Operator'; change($('rr-desig')); await wait(300);
$('rr-purpose').value = 'Machine parts to the drawing.';
$('rr-resp').value = 'Run the job to the routing';
click($('rr-issue')); await wait(300);
check('a role with no competence set against it cannot be issued',
  /no competence set/i.test(txt($('rr-msg'))), txt($('rr-msg')));

// ================= succession =================
nav('succession_plan'); await wait(700);
check('positions are offered', $('sp-pos').options.length === 2, $('sp-pos').innerHTML);
$('sp-pos').value = 'p2'; change($('sp-pos')); await wait(400);
check('the post shows who is in it', /M Iyer/.test(txt($('sp-body'))), txt($('sp-body')).slice(0, 200));

$('sp-cand').value = 'Nobody Here';
click($('sp-add')); await wait(300);
check('a candidate who does not work here is refused',
  /not on the employee records/i.test(txt($('sp-msg'))), txt($('sp-msg')));

$('sp-cand').value = 'M Iyer';
click($('sp-add')); await wait(300);
check('the sole incumbent cannot be their own successor',
  /own successor/i.test(txt($('sp-msg'))), txt($('sp-msg')));

$('sp-cand').value = 'R Kumar';       // level 4 = meets the requirement
click($('sp-add')); await wait(400);
check('a candidate who meets every requirement is ready now',
  /ready now/i.test(txt($('sp-body'))), txt($('sp-body')).slice(0, 400));

$('sp-cand').value = 'S Babu';        // level 3 against 4, but it is a quality item
click($('sp-add')); await wait(400);
check('one level short on something that affects quality is not ready',
  /not ready/i.test(txt($('sp-body'))), txt($('sp-body')).slice(0, 500));
check('what is short is spelled out',
  /has 3, needs 4/.test(txt($('sp-body'))), txt($('sp-body')).slice(0, 500));

$('sp-cand').value = 'r kumar';
click($('sp-add')); await wait(300);
check('the same candidate twice is refused', /already named/i.test(txt($('sp-msg'))), txt($('sp-msg')));

$('sp-by').value = '';
click($('sp-save')); await wait(250);
check('a review with nobody behind it is refused', /who reviewed/i.test(txt($('sp-msg'))), txt($('sp-msg')));
$('sp-by').value = 'V Menon';
click($('sp-save')); await wait(400);
check('the review is recorded',
  !!(docs.find(d => d.kind === 'succession') || { data: {} }).data.reviewedOn, txt($('sp-msg')));

// the operator post has nobody named and three in post — not a risk;
// the supervisor post has one in post and now a ready candidate — not a risk either
check('the exposure list clears once somebody ready is named',
  /Every sanctioned post/.test(txt($('sp-risk'))), txt($('sp-risk')).slice(0, 200));

// remove the ready candidate and the post becomes exposed again
click($('sp-body').querySelector('.sp-rm')); await wait(500);
check('removing the ready candidate puts the post back on the exposure list',
  /Shift Supervisor/.test(txt($('sp-risk'))), txt($('sp-risk')).slice(0, 250));

// an empty plan cannot be signed off
$('sp-pos').value = 'p1'; change($('sp-pos')); await wait(400);
$('sp-by').value = 'V Menon';
click($('sp-save')); await wait(300);
check('an empty succession plan cannot be signed off',
  /nothing to review/i.test(txt($('sp-msg'))), txt($('sp-msg')));

check('no page errors throughout', pageErrors.length === 0, pageErrors[0] || '');

let pass = 0, fail = 0;
for (const [n, okv, x] of results) { if (okv) pass++; else { fail++; console.log('  x ' + n + (x ? '   [' + x + ']' : '')); } }
console.log('\n' + pass + ' passed, ' + fail + ' failed, of ' + results.length);
process.exit(fail ? 1 : 0);
