/* v108 tests for the competency chain. The fixture is arranged so a wrong
   answer shows:
     - one operator assessed below the level his role requires (a real gap)
     - one assessed at the level (no gap)
     - one never assessed at all, which must read "never" rather than level 0
     - a name on the skill matrix that matches no employee record, which must be
       reported rather than quietly producing no gaps
     - assessment history either side of a training date, so "level on the day"
       and "level now" are genuinely different numbers */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let docs = [], parts = [], idSeq = 1, serial = 0;
const settings = {};
const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const ahead = n => ago(-n);

const employees = [
  { data: { empId: 'E1', name: 'R Kumar', designation: 'CNC Operator', department: 'Machining', status: 'Active' } },
  { data: { empId: 'E2', name: 'S Babu', designation: 'CNC Operator', department: 'Machining', status: 'Active' } },
  { data: { empId: 'E3', name: 'P Anand', designation: 'CNC Operator', department: 'Machining', status: 'Active' } },
  { data: { empId: 'E4', name: 'M Iyer', designation: 'Fitter', department: 'Maintenance', status: 'Active' } }
];

docs.push({ doc_id: 'd1', kind: 'orgmaster', doc_no: 'MCH', data: { type: 'department', name: 'Machining' } });
docs.push({ doc_id: 'd2', kind: 'orgmaster', doc_no: 'MNT', data: { type: 'department', name: 'Maintenance' } });
docs.push({ doc_id: 'g1', kind: 'orgmaster', doc_no: 'W3', data: { type: 'designation', name: 'CNC Operator', department: 'Machining' } });
docs.push({ doc_id: 'g2', kind: 'orgmaster', doc_no: 'W4', data: { type: 'designation', name: 'Fitter', department: 'Maintenance' } });
docs.push({ doc_id: 'mc1', kind: 'machine', doc_no: 'MC-1', data: { name: 'LATHE-1' } });

// R Kumar was level 2 six months ago, raised to 3 last week (after the training)
docs.push({ doc_id: 'sk1', kind: 'skill', doc_no: 'SK-1',
  data: { person: 'R Kumar', thing: 'LATHE-1', level: 3, assessedOn: ago(7),
    history: [{ on: ago(180), level: 2 }, { on: ago(7), level: 3 }] } });
// S Babu is still level 2 — a real gap
docs.push({ doc_id: 'sk2', kind: 'skill', doc_no: 'SK-2',
  data: { person: 'S Babu', thing: 'LATHE-1', level: 2, assessedOn: ago(200),
    history: [{ on: ago(200), level: 2 }] } });
// a name on the matrix that is nobody on the roll
docs.push({ doc_id: 'sk3', kind: 'skill', doc_no: 'SK-3',
  data: { person: 'Ghost Worker', thing: 'LATHE-1', level: 4, assessedOn: ago(30), history: [] } });
// P Anand has never been assessed on anything

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
      const pid = decodeURIComponent((url.match(/partId=([^&]+)/) || [, ''])[1]);
      return ok({ docs: docs.filter(d => (!kind || d.kind === kind) && (!pid || d.part_id === pid)) });
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

// ================= gap analysis with nothing required =================
nav('gap_analysis'); await wait(500);
check('with no requirement set, the gap screen says what is missing',
  /Not enough to compare/.test(txt($('ga-body'))), txt($('ga-body')).slice(0, 80));

// ================= competency map =================
nav('competency_map'); await wait(500);
check('designations come from the organisation master', $('cm-desig').options.length === 2, $('cm-desig').innerHTML);
check('machines are offered rather than typed from memory',
  /LATHE-1/.test($('cm-things').innerHTML), $('cm-things').innerHTML);

$('cm-thing').value = '';
click($('cm-save')); await wait(250);
check('a requirement with no machine is refused', /Name the machine/.test(txt($('cm-msg'))), txt($('cm-msg')));

$('cm-desig').value = 'CNC Operator';
$('cm-thing').value = 'LATHE-1';
$('cm-level').value = '3';
$('cm-crit').value = 'Affects product quality';
click($('cm-save')); await wait(400);
check('a requirement saves', docs.filter(d => d.kind === 'competency').length === 1, txt($('cm-msg')));
check('it is listed against the role', /CNC Operator/.test(txt($('cm-list'))) && /LATHE-1/.test(txt($('cm-list'))));

// setting the same role/machine again changes it rather than adding a second
$('cm-thing').value = 'lathe-1';
$('cm-level').value = '4';
click($('cm-save')); await wait(400);
check('setting the same requirement twice changes it, not duplicates it',
  docs.filter(d => d.kind === 'competency').length === 1, txt($('cm-msg')));
check('and it says so', /already set/i.test(txt($('cm-msg'))), txt($('cm-msg')));

// put it back to 3
$('cm-thing').value = 'LATHE-1'; $('cm-level').value = '3';
click($('cm-save')); await wait(400);

// ================= gap analysis =================
nav('gap_analysis'); await wait(600);
const ga = txt($('ga-body'));
check('the gap analysis now has something to compare', !/Not enough/.test(ga), ga.slice(0, 60));
check('the operator below the required level shows a gap', /S Babu/.test(ga), ga.slice(0, 300));
check('somebody never assessed reads "never", not level zero', /never/.test(ga), ga.slice(0, 400));
check('a matrix name that is nobody on the roll is reported',
  /Ghost Worker/.test(ga) && /match no employee record/i.test(ga), ga.slice(0, 300));
check('the person already at the required level has no gap',
  !/R Kumar/.test(ga) || $('ga-filter').value === 'all', ga.slice(0, 200));
check('the summary counts the gaps', /gap/i.test(txt($('ga-msg'))), txt($('ga-msg')));

$('ga-filter').value = 'all'; change($('ga-filter')); await wait(200);
check('showing everything includes the person who meets the level',
  /R Kumar/.test(txt($('ga-body'))), txt($('ga-body')).slice(0, 300));

$('ga-dept').value = 'Maintenance'; change($('ga-dept')); await wait(200);
check('filtering by department excludes the machining crew',
  !/S Babu/.test(txt($('ga-body'))), txt($('ga-body')).slice(0, 200));

// ================= TNI =================
nav('tni'); await wait(600);
const tn = txt($('tn-derived'));
check('gaps arrive as needs without being retyped', /S Babu/.test(tn), tn.slice(0, 250));
check('a need with nothing planned against it says so', /nothing planned/i.test(tn));

$('tn-who').value = 'S Babu'; $('tn-topic').value = 'LATHE-1';
click($('tn-save')); await wait(300);
check('recording a need the gap analysis already found is refused',
  /already shows/i.test(txt($('tn-msg'))), txt($('tn-msg')));
check('and nothing was written', !docs.some(d => d.kind === 'tni'));

$('tn-topic').value = 'Fire safety refresher';
$('tn-src').value = 'Statutory or safety refresher';
$('tn-by').value = ahead(30);
click($('tn-save')); await wait(350);
check('a need from somewhere else is recorded', docs.filter(d => d.kind === 'tni').length === 1, txt($('tn-msg')));
check('it appears on the hand-recorded list', /Fire safety/.test(txt($('tn-list'))));

// ================= training plan =================
nav('training_plan_actual'); await wait(500);
$('tp-topic').value = 'Lathe operation';
click($('tp-save')); await wait(250);
check('a session with no planned date is refused', /planned date/i.test(txt($('tp-msg'))), txt($('tp-msg')));

$('tp-plan').value = ago(45);
$('tp-thing').value = 'LATHE-1';
$('tp-trainer').value = 'A Rao';
click($('tp-save')); await wait(400);
check('the session is planned', docs.filter(d => d.kind === 'training').length === 1, txt($('tp-msg')));

click($('tp-list').querySelector('.tp-open')); await wait(250);
$('tp-actual').value = ago(45);
click($('tp-complete')); await wait(300);
check('a session with no attendees cannot be marked held',
  /no attendees/i.test(txt($('tp-msg'))), txt($('tp-msg')));

$('tp-att').value = 'R Kumar';
click($('tp-add-att')); await wait(350);
check('an attendee is added', ((docs.find(d => d.kind === 'training') || { data: {} }).data.attendees || []).length === 1);
$('tp-att').value = 'r kumar';
click($('tp-add-att')); await wait(300);
check('the same attendee twice is refused', /already on the list/i.test(txt($('tp-msg'))), txt($('tp-msg')));

$('tp-actual').value = ahead(5);
click($('tp-complete')); await wait(300);
check('a session cannot be recorded as held in the future',
  /in the future/i.test(txt($('tp-msg'))), txt($('tp-msg')));

$('tp-actual').value = ago(45);
click($('tp-complete')); await wait(400);
check('with a date and an attendee it is marked held',
  (docs.find(d => d.kind === 'training') || { data: {} }).data.actualOn === ago(45), txt($('tp-msg')));

// ================= effectiveness =================
nav('training_effectiveness'); await wait(700);
const te = txt($('te-body'));
check('a session older than 30 days is offered for review', $('te-session').options.length === 1, $('te-session').innerHTML);
check('the level on the day is read from the assessment history', /2/.test(te), te.slice(0, 300));
check('the level now is read from the same record', /3/.test(te), te.slice(0, 300));
check('the movement is shown', /\+1/.test(te), te.slice(0, 300));

click($('te-save') || $('te-body')); await wait(200);
$('te-by').value = '';
click($('te-save')); await wait(250);
check('a review with nobody behind it is refused', /who reviewed/i.test(txt($('te-msg'))), txt($('te-msg')));

$('te-by').value = 'HR';
click($('te-save')); await wait(250);
check('an attendee with no verdict is refused', /no verdict/i.test(txt($('te-msg'))), txt($('te-msg')));

const verdict = $('te-body').querySelector('.te-v');
verdict.value = 'Effective — working at the required level';
click($('te-save')); await wait(250);
check('"effective" with no evidence is refused', /seen doing/i.test(txt($('te-msg'))), txt($('te-msg')));

$('te-body').querySelector('.te-e').value = 'Set and ran the job unsupervised on 12th';
click($('te-save')); await wait(400);
check('the review is recorded', /Review recorded/i.test(txt($('te-msg'))), txt($('te-msg')));
check('it is stored against the session',
  !!(docs.find(d => d.kind === 'training') || { data: {} }).data.effectiveness);
check('with the reviewer recorded',
  (docs.find(d => d.kind === 'training') || { data: {} }).data.effectivenessBy === 'HR');

// a session held this week must not be offered for review yet
docs.push({ doc_id: 'tr2', kind: 'training', doc_no: 'TRG-2', status: 'Held',
  data: { topic: 'Fresh session', plannedOn: ago(3), actualOn: ago(3), thing: 'LATHE-1',
    attendees: [{ name: 'S Babu', empId: 'E2' }] } });
nav('training_effectiveness'); await wait(700);
check('a session held three days ago is not offered for review',
  !/Fresh session/.test($('te-session').innerHTML), $('te-session').innerHTML);

// ================= the HR dashboard now counts training itself =================
nav('dash_hrm'); await wait(900);
const dash = txt($('kd-body'));
check('training plan vs actual is computed from the sessions, not entered',
  /Counted from the training sessions/.test(dash), dash.slice(0, 400));

check('no page errors throughout', pageErrors.length === 0, pageErrors[0] || '');

let pass = 0, fail = 0;
for (const [n, okv, x] of results) { if (okv) pass++; else { fail++; console.log('  x ' + n + (x ? '   [' + x + ']' : '')); } }
console.log('\n' + pass + ' passed, ' + fail + ' failed, of ' + results.length);
process.exit(fail ? 1 : 0);
