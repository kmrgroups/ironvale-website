/* v113 tests. Yesterday is seeded with one of everything the board is supposed
   to notice — a failed check with no action, rejections, an overdue audit
   finding, a broken tool, downtime, an absence, a despatch and an overdue order
   — so a board that quietly drops one of them fails here rather than in a
   meeting. */
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
const YDAY = ago(1);

const employees = [
  { data: { empId: 'E1', name: 'R Kumar', designation: 'CNC Operator', department: 'Machining', status: 'Active' } },
  { data: { empId: 'E2', name: 'S Babu', designation: 'CNC Operator', department: 'Machining', status: 'Active' } }
];
const attendance = [
  { day: YDAY, empId: 'E1', status: 'Present' },
  { day: YDAY, empId: 'E2', status: 'Absent' }
];

parts.push({ part_id: 'P1', part_no: 'PART-1', part_name: 'Housing', lifecycle: 'Series', data: {} });

// production yesterday: 500 made, 20 rejected, 60 min downtime
docs.push({ doc_id: 'pd1', kind: 'production', part_id: 'P1', doc_no: 'PR-1',
  data: { partId: 'P1', date: YDAY, made: 500, rejected: 20, minutes: 480, runMinutes: 420,
    downtime: 60, plannedCycle: 48, machine: 'LATHE-1', operator: 'R Kumar',
    rejectReason: 'Burr not removed', downtimeReason: 'Machine breakdown' } });

// a check sheet with a failed item and nothing written against it
docs.push({ doc_id: 'cs1', kind: 'checksheet', doc_no: 'MCS-1', status: 'Signed off',
  data: { machineName: 'LATHE-1', date: YDAY, shift: 'A', checkedBy: 'R Kumar',
    items: [{ name: 'Coolant level and condition', result: 'Not OK', note: '' },
            { name: 'Air pressure', result: 'OK', note: '' }] } });
// and one left open
docs.push({ doc_id: 'cs2', kind: 'checksheet', doc_no: 'MCS-2', status: 'Open',
  data: { machineName: 'GRINDER-1', date: YDAY, shift: 'B', items: [] } });

// an overdue audit finding
docs.push({ doc_id: 'au1', kind: 'audit', doc_no: 'AUD-1', status: 'Carried out',
  data: { type: 'Process', area: 'OP10 Turning', plannedOn: ago(30), actualOn: ago(28),
    findings: [{ severity: 'Major', description: 'Setup approval not signed', owner: 'M Iyer',
      dueOn: ago(5), closedOn: '' }] } });

// an open non-conformance
docs.push({ doc_id: 'nc1', kind: 'ncr', doc_no: 'NCR-1', status: 'Open',
  data: { description: 'Oversize bore on 3 pieces', owner: 'S Rao', dueOn: ahead(4), raisedOn: ago(6) } });

// a tool broken yesterday
docs.push({ doc_id: 'tl1', kind: 'tool', doc_no: 'TOOL-1',
  data: { description: 'CNMG insert', expectedLife: 400, lifeUnit: 'pieces',
    history: [{ on: YDAY, event: 'Broken', qty: 120, cost: 450, by: 'R Kumar' }] } });

// a despatch yesterday and an order past its date
docs.push({ doc_id: 'dc1', kind: 'dc', doc_no: 'DC-1', data: { date: YDAY, qty: 300, po: 'PO-A' } });
docs.push({ doc_id: 'so1', kind: 'order', doc_no: 'SO-1',
  data: { po: 'PO-A', partId: 'P1', qty: 1000, due: ago(3), customerName: 'Alpha' } });

const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => pageErrors.push(e.message));
const dom = new JSDOM(html.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''),
  { runScripts: 'outside-only', url: 'https://example.test/idms.html', virtualConsole: vc });
const { window } = dom;
window.Element.prototype.scrollIntoView = function () {};
if (!window.CSS) window.CSS = {};
if (!window.CSS.escape) window.CSS.escape = s => String(s).replace(/["\\]/g, '\\$&');
const prompts = [];
window.prompt = () => (prompts.length ? prompts.shift() : null);
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
  if (url.startsWith('/api/hr?what=attendance')) return ok({ attendance });
  if (url.startsWith('/api/hr')) return ok({});
  if (url.startsWith('/api/rfqs')) return ok({ rfqs: [] });
  if (url.startsWith('/api/idms')) {
    if (url.includes('what=audit')) return ok({ audit: [] });
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
const col = title => [...$('dw-body').querySelectorAll('.dwm-col')]
  .find(c => c.querySelector('header b').textContent === title);

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(250);

// ================= the board =================
nav('dwm'); await wait(1100);
check('the board defaults to yesterday', $('dw-date').value === YDAY, $('dw-date').value);
check('all five columns are drawn',
  $('dw-body').querySelectorAll('.dwm-col').length === 5,
  'cols=' + $('dw-body').querySelectorAll('.dwm-col').length);

const S = txt(col('Safety')), Q = txt(col('Quality')), D = txt(col('Delivery')),
      Cc = txt(col('Cost')), P = txt(col('People'));

check('the failed check is on the safety column', /Coolant level/.test(S), S.slice(0, 200));
check('a failed check with no action says so',
  /nothing written against it/.test(S), S.slice(0, 250));
check('the unsigned sheet is counted', /not signed off/i.test(S), S.slice(0, 300));

check('rejections are worked out as ppm', /40000|40,000/.test(Q.replace(/\s/g, '')), Q.slice(0, 200));
check('the worst reject reason is named', /Burr not removed/.test(Q), Q.slice(0, 250));
check('the open non-conformance is counted', /Non-conformances open/.test(Q), Q.slice(0, 300));
check('the overdue audit finding is on the board',
  /Setup approval not signed/.test(Q), Q.slice(0, 400));

check('the despatch is shown', /Despatched yesterday/.test(D) && /300/.test(D), D.slice(0, 200));
check('the order past its date is counted', /past their date/i.test(D), D.slice(0, 250));

check('OEE is worked out from the bookings', /OEE yesterday/.test(Cc), Cc.slice(0, 200));
check('downtime is shown in hours', /1/.test(Cc) && /Downtime/.test(Cc), Cc.slice(0, 250));
check('the broken tool and what it cost are shown',
  /Tool broken/.test(Cc) && /450/.test(Cc), Cc.slice(0, 350));

check('attendance is read from the register', /1 present, 1 absent/.test(P), P);

check('the summary counts what needs talking about',
  /thing\(s\) to talk about/.test(txt($('dw-msg'))), txt($('dw-msg')));

// a day with nothing recorded must say so rather than show yesterday's figures
$('dw-date').value = ago(40); change($('dw-date')); await wait(900);
check('a day with nothing booked shows nothing rather than the last one',
  !/Burr not removed/.test(txt($('dw-body'))), txt($('dw-body')).slice(0, 200));
check('but findings still overdue today stay on the board',
  /Setup approval not signed/.test(txt($('dw-body'))), txt($('dw-body')).slice(0, 300));

// ================= raising an action =================
$('dw-date').value = YDAY; change($('dw-date')); await wait(900);
const act = [...$('dw-body').querySelectorAll('.dw-act')]
  .find(b => /Coolant/.test(b.dataset.t));
check('a failed check can be raised as an action', !!act);
click(act); await wait(600);
check('raising it opens the task list',
  window.document.querySelector('[data-panel="task_list"]').classList.contains('on'));
check('the action is prefilled with what it was about',
  /Coolant/.test($('tk-title').value), $('tk-title').value);
check('and with where it came from', /DWM/.test($('tk-src').value), $('tk-src').value);

// ================= the task list =================
$('tk-owner').value = ''; $('tk-due').value = '';
click($('tk-add')); await wait(250);
check('an action with no owner is refused', /owner/i.test(txt($('tk-msg'))), txt($('tk-msg')));

$('tk-owner').value = 'R Kumar'; $('tk-due').value = '';
click($('tk-add')); await wait(250);
check('an action with no date is refused', /never be overdue/i.test(txt($('tk-msg'))), txt($('tk-msg')));

$('tk-due').value = ahead(3);
click($('tk-add')); await wait(500);
check('the action is raised', docs.filter(d => d.kind === 'task').length === 1, txt($('tk-msg')));
check('it carries the source it came from',
  /DWM/.test((docs.find(d => d.kind === 'task') || { data: {} }).data.source || ''));

// actions that live elsewhere are shown but not copied
const els = txt($('tk-else'));
check('open non-conformances are shown as living elsewhere', /Oversize bore/.test(els), els.slice(0, 250));
check('open audit findings are shown too', /Setup approval/.test(els), els.slice(0, 300));
check('they are not copied onto the task list',
  docs.filter(d => d.kind === 'task').length === 1,
  'tasks=' + docs.filter(d => d.kind === 'task').length);
check('and each says where it lives', /audit/i.test(els) && /Non-conformance/.test(els));

// closing needs a note
prompts.push('');
click($('tk-list').querySelector('.tk-close')); await wait(300);
check('an action cannot be closed with nothing written against it',
  !(docs.find(d => d.kind === 'task') || { data: {} }).data.closedOn);

prompts.push('Coolant topped up and concentration checked; added to the weekly round');
click($('tk-list').querySelector('.tk-close')); await wait(450);
const task = docs.find(d => d.kind === 'task');
check('with a note it closes', !!task.data.closedOn, JSON.stringify(task.data).slice(0, 120));
check('what was done is kept', /Coolant topped up/.test(task.data.closedNote || ''));
check('and who closed it', task.data.closedBy === 'tester');

$('tk-filter').value = 'open'; change($('tk-filter')); await wait(200);
check('the closed action leaves the open list',
  !/Coolant/.test(txt($('tk-list'))) || /Nothing to show/.test(txt($('tk-list'))),
  txt($('tk-list')).slice(0, 150));

check('no page errors throughout', pageErrors.length === 0, pageErrors[0] || '');

let pass = 0, fail = 0;
for (const [n, okv, x] of results) { if (okv) pass++; else { fail++; console.log('  x ' + n + (x ? '   [' + x + ']' : '')); } }
console.log('\n' + pass + ' passed, ' + fail + ' failed, of ' + results.length);
process.exit(fail ? 1 : 0);
