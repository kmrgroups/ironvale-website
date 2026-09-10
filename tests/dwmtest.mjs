/* v114 tests — the DWM board and the organisation chart, rebuilt.

   The DWM fixture puts today inside the month under test so the marking rules
   (only the month in progress, only days that have happened) can be exercised
   at all; and it checks the freeze — that changing an activity's frequency
   after a month has been marked cannot rewrite that month's adherence. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let docs = [], parts = [], idSeq = 1, serial = 0;
const settings = {};
const now = new Date();
const YEAR = now.getFullYear(), MONTH = now.getMonth() + 1;
const TODAY = now.getDate();
const MONTH_NAMES = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];

const employees = [
  { data: { empId: 'E1', name: 'R Kumar', designation: 'CNC Operator', department: 'Machining', status: 'Active' } },
  { data: { empId: 'E2', name: 'S Babu', designation: 'Shift Supervisor', department: 'Machining', status: 'Active' } },
  { data: { empId: 'E3', name: 'M Iyer', designation: 'Quality Engineer', department: 'Quality', status: 'Active' } },
  { data: { empId: 'E4', name: 'P Left', designation: 'CNC Operator', department: 'Machining', status: 'Left' } },
  { data: { empId: 'E5', name: 'K Nair', designation: 'Storekeeper', department: 'Machining', status: 'Active' } }
];

docs.push({ doc_id: 'om1', kind: 'orgmaster', doc_no: 'OM-1', data: { type: 'department', name: 'Machining' } });
docs.push({ doc_id: 'om2', kind: 'orgmaster', doc_no: 'OM-2', data: { type: 'department', name: 'Quality' } });
docs.push({ doc_id: 'om3', kind: 'orgmaster', doc_no: 'OM-3', data: { type: 'designation', name: 'CNC Operator', department: 'Machining' } });

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

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(250);

// ================= DWM: choosing whose board =================
nav('dwm'); await wait(700);
check('the board asks whose it is before anything else',
  $('dw-pick').style.display !== 'none' && $('dw-board').style.display === 'none');

click($('dw-open')); await wait(200);
check('a board with no name is refused', /whose board/i.test(txt($('dw-pickmsg'))), txt($('dw-pickmsg')));

$('dw-dept').value = 'Machining'; change($('dw-dept')); await wait(300);
const names = [...$('dw-emp').options].map(o => o.value);
check('the employee list is filtered to the department',
  names.includes('R Kumar') && !names.includes('M Iyer'), names.join(','));
check('somebody who has left is not offered a board', !names.includes('P Left'), names.join(','));

$('dw-emp').value = 'R Kumar'; change($('dw-emp')); await wait(400);
click($('dw-open')); await wait(500);
check('the board opens for that person',
  $('dw-board').style.display !== 'none' && /R Kumar/.test(txt($('dw-who'))), txt($('dw-who')));
check('and shows their department', /Machining/.test(txt($('dw-who'))), txt($('dw-who')));
check('an empty board says what to do',
  /Nothing on this board yet/.test(txt($('dw-body'))), txt($('dw-body')).slice(0, 120));

// ================= adding activities =================
$('dw-month').value = String(MONTH); change($('dw-month'));
$('dw-year').value = String(YEAR); change($('dw-year'));
await wait(300);

click($('dw-add')); await wait(200);
$('dw-a-name').value = ''; click($('dw-a-save')); await wait(200);
check('an activity with no description is refused',
  /what is done/i.test(txt($('dw-a-msg'))), txt($('dw-a-msg')));

$('dw-a-name').value = 'Line 5S check';
$('dw-a-freq').value = 'Daily'; change($('dw-a-freq'));
click($('dw-a-save')); await wait(500);
check('a daily activity is added',
  docs.filter(d => d.kind === 'dwm').length === 1, txt($('dw-a-msg')));

click($('dw-add')); await wait(100);
$('dw-a-name').value = 'Line 5S check';
click($('dw-a-save')); await wait(300);
check('the same activity cannot be added twice',
  /already on this board/i.test(txt($('dw-a-msg'))), txt($('dw-a-msg')));

$('dw-a-name').value = 'Layered process audit';
$('dw-a-freq').value = 'Monthly'; change($('dw-a-freq'));
await wait(100);
check('a monthly activity is forced onto the annual calendar',
  $('dw-a-cat').value === 'Annual' && $('dw-a-cat').disabled);
click($('dw-a-save')); await wait(300);
check('an annual activity with no months chosen is refused',
  /never comes due/i.test(txt($('dw-a-msg'))), txt($('dw-a-msg')));

[...window.document.querySelectorAll('.dw-mo')]
  .filter(c => c.value === MONTH_NAMES[MONTH - 1]).forEach(c => { c.checked = true; });
click($('dw-a-save')); await wait(500);
const dwmDocRec = docs.find(d => d.kind === 'dwm');
check('with months chosen it is added', (dwmDocRec.data.activities || []).length === 2);

// ================= the grid =================
const grid = () => $('dw-body').querySelector('.dwm-grid');
check('the grid is drawn', !!grid());
const daysInMonth = new Date(YEAR, MONTH, 0).getDate();
/* Activity, one th per day, then Plan / Actual / % — four fixed columns, not
   two, since Plan and Actual were added alongside the existing % column so the
   board matches the reference layout of showing the raw counts, not just the
   percentage. */
check('there is a column for every day of the month',
  grid() && grid().querySelectorAll('thead th').length === daysInMonth + 4,
  'cols=' + (grid() ? grid().querySelectorAll('thead th').length : 0));
check('the categories are shown as bands',
  /DEPARTMENT ACTIVITIES/i.test(txt(grid())) && /ANNUAL CALENDAR/i.test(txt(grid())),
  txt(grid()).slice(0, 160));

const sundays = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  .filter(d => new Date(YEAR, MONTH - 1, d).getDay() === 0);
const marked = [...grid().querySelectorAll('.dwm-cell.plan, .dwm-cell.done, .dwm-cell.conc')];
check('Sundays are not planned for a daily activity',
  sundays.every(sd => !marked.some(c => Number(c.dataset.d) === sd)),
  'sundays=' + sundays.join(','));

// ================= marking =================
const cellFor = day => [...grid().querySelectorAll('.dwm-cell[data-d="' + day + '"]')][0];
/* today may be a Sunday or a day nothing is planned on, so mark whatever the
   board itself says is markable rather than assuming a date */
const markable = [...grid().querySelectorAll('.dwm-cell[data-a]')];
const markDay = markable.length ? Number(markable[markable.length - 1].dataset.d) : 0;
let cell = markDay ? cellFor(markDay) : null;
if (cell && cell.dataset.a) {
  click(cell); await wait(450);
  check('a click marks the day done', txt(cellFor(markDay)) === '✔', txt(cellFor(markDay)));
  click(cellFor(markDay)); await wait(450);
  check('a second click marks it a concession', txt(cellFor(markDay)) === 'C', txt(cellFor(markDay)));
  click(cellFor(markDay)); await wait(450);
  check('a third click clears it back to planned', txt(cellFor(markDay)) === 'O', txt(cellFor(markDay)));
  click(cellFor(markDay)); await wait(450);
} else {
  check('a click marks the day done', false, 'no clickable cell for day ' + markDay);
  check('a second click marks it a concession', false, 'skipped');
  check('a third click clears it back to planned', false, 'skipped');
}

if (TODAY < daysInMonth) {
  const future = [...grid().querySelectorAll('.dwm-cell')]
    .filter(c => Number(c.dataset.d) > TODAY && c.dataset.a);
  check('a day that has not happened cannot be marked', future.length === 0,
    'clickable future cells=' + future.length);
} else {
  check('a day that has not happened cannot be marked', true, 'month ends today');
}

// a finished month is the record
$('dw-month').value = String(MONTH === 1 ? 12 : MONTH - 1);
if (MONTH === 1) $('dw-year').value = String(YEAR - 1);
change($('dw-month')); await wait(450);
check('a month that is not in progress says it cannot be marked',
  /cannot be marked/i.test(txt($('dw-body'))), txt($('dw-body')).slice(0, 200));
check('and has no clickable cells',
  $('dw-body').querySelectorAll('.dwm-cell[data-a]').length === 0);

$('dw-month').value = String(MONTH); $('dw-year').value = String(YEAR);
change($('dw-month')); await wait(450);

// ================= adherence =================
check('adherence is shown against the 98% target',
  /target 98%/.test(txt($('dw-body'))), txt($('dw-body')).slice(0, 200));
check('the three lists are scored separately',
  /Department/.test(txt($('dw-body'))) && /General/.test(txt($('dw-body'))) &&
  /Annual calendar/.test(txt($('dw-body'))));

// ================= the freeze =================
const dwmRec = docs.find(d => d.kind === 'dwm');
const monthKey = YEAR + '-' + String(MONTH).padStart(2, '0');
check('marking a month freezes its plan',
  !!(dwmRec.data.months && dwmRec.data.months[monthKey] &&
     Object.values(dwmRec.data.months[monthKey]).some(c => Array.isArray(c.plan))),
  JSON.stringify(dwmRec.data.months || {}).slice(0, 120));

const daily = dwmRec.data.activities.find(a => a.name === 'Line 5S check');
const frozen = ((dwmRec.data.months[monthKey] || {})[daily.id] || {}).plan;
if (frozen) {
  daily.freq = 'Weekly'; daily.day = 'Friday';   // somebody edits the frequency later
  change($('dw-month')); await wait(450);
  check('changing the frequency later cannot rewrite a month already marked',
    ((dwmRec.data.months[monthKey] || {})[daily.id] || {}).plan.length === frozen.length,
    'was ' + frozen.length);
} else {
  check('changing the frequency later cannot rewrite a month already marked', false, 'never froze');
}

const rmLink = [...$('dw-body').querySelectorAll('.dw-rm')].find(a => a.dataset.id === daily.id);
if (rmLink) {
  click(rmLink); await wait(450);
  check('an activity with days marked against it cannot be removed',
    dwmRec.data.activities.some(a => a.id === daily.id) && /adherence/i.test(txt($('dw-msg'))),
    txt($('dw-msg')).slice(0, 140));
} else {
  check('an activity with days marked against it cannot be removed', false, 'no remove link');
}

click($('dw-back')); await wait(450);
check('you can go back and pick somebody else',
  $('dw-pick').style.display !== 'none' && $('dw-board').style.display === 'none');

// ================= ORGANISATION CHART =================
nav('org_chart'); await wait(800);
check('an empty chart says to start at the top',
  /No chart yet/.test(txt($('oc-body'))), txt($('oc-body')).slice(0, 120));
check('the levels are shown as a legend',
  /Top management/.test(txt($('oc-legend'))) && /Contract labour/.test(txt($('oc-legend'))),
  txt($('oc-legend')).slice(0, 160));

click($('oc-add')); await wait(200);
$('oc-title').value = ''; click($('oc-save')); await wait(200);
check('a box with no post is refused', /Name the post/i.test(txt($('oc-fmsg'))), txt($('oc-fmsg')));

$('oc-title').value = 'Works Manager';
$('oc-ndept').value = 'Machining';
$('oc-who').value = 'S Babu';
$('oc-level').value = 'top';
$('oc-parent').value = '';
click($('oc-save')); await wait(700);
check('the top box is added', docs.filter(d => d.kind === 'orgnode').length === 1);

click($('oc-add')); await wait(200);
$('oc-title').value = 'Second Boss';
$('oc-parent').value = '';
click($('oc-save')); await wait(300);
check('a second box at the top is refused',
  /already a box at the top/i.test(txt($('oc-fmsg'))), txt($('oc-fmsg')));

const topId = docs.find(d => d.kind === 'orgnode').doc_id;
$('oc-title').value = 'CNC Operator';
$('oc-ndept').value = 'Machining';
$('oc-who').value = 'R Kumar';
$('oc-level').value = 'shopfloor';
$('oc-parent').value = topId;
click($('oc-save')); await wait(700);
check('a box below the top is added', docs.filter(d => d.kind === 'orgnode').length === 2);
check('the chart is drawn as a tree',
  $('oc-body').querySelectorAll('.oc-node').length === 2,
  'nodes=' + $('oc-body').querySelectorAll('.oc-node').length);

click($('oc-add')); await wait(200);
$('oc-title').value = 'Maintenance Fitter';
$('oc-ndept').value = 'Machining';
$('oc-who').value = 'Somebody Else';
$('oc-level').value = 'shopfloor';
$('oc-parent').value = topId;
click($('oc-save')); await wait(700);
check('a name that is not on the employee records is flagged',
  /not on the employee records/i.test(txt($('oc-body'))), txt($('oc-body')).slice(0, 300));

click($('oc-add')); await wait(200);
$('oc-title').value = 'Quality Engineer';
$('oc-ndept').value = 'Machining';
$('oc-who').value = 'M Iyer';
$('oc-level').value = 'staff';
$('oc-parent').value = topId;
click($('oc-save')); await wait(700);
check('a person whose record puts them elsewhere is flagged',
  /record says Quality/i.test(txt($('oc-body'))), txt($('oc-body')).slice(0, 400));

click($('oc-add')); await wait(200);
$('oc-title').value = 'Shift In-charge';
$('oc-ndept').value = 'Machining';
$('oc-who').value = '';
$('oc-level').value = 'middle';
$('oc-parent').value = topId;
click($('oc-save')); await wait(700);
check('a box with nobody in it is shown as vacant',
  /vacant/i.test(txt($('oc-body'))), txt($('oc-body')).slice(0, 300));

const kidId = docs.filter(d => d.kind === 'orgnode')
  .find(d => d.data.title === 'CNC Operator').doc_id;
const edLinks = [...$('oc-body').querySelectorAll('.oc-ed')];
const topEd = edLinks.find(a => a.dataset.id === topId);
if (topEd) {
  click(topEd); await wait(350);
  $('oc-parent').value = kidId;
  click($('oc-save')); await wait(400);
  check('a reporting line that closes a loop is refused',
    /circle/i.test(txt($('oc-fmsg'))), txt($('oc-fmsg')));
  click($('oc-cancel')); await wait(200);
} else {
  check('a reporting line that closes a loop is refused', false, 'no edit link for the top box');
}

const rmTop = [...$('oc-body').querySelectorAll('.oc-rm')].find(a => a.dataset.id === topId);
if (rmTop) {
  click(rmTop); await wait(450);
  check('a box that others report to cannot be removed',
    /reporting to nobody/i.test(txt($('oc-msg'))), txt($('oc-msg')).slice(0, 160));
} else {
  check('a box that others report to cannot be removed', false, 'no remove link for the top box');
}

check('everybody on the payroll but on no box is listed',
  /On the payroll, on no box/i.test(txt($('oc-body'))), txt($('oc-body')).slice(0, 200));

check('no page errors throughout', pageErrors.length === 0, pageErrors[0] || '');

let pass = 0, fail = 0;
for (const [n, okv, x] of results) { if (okv) pass++; else { fail++; console.log('  x ' + n + (x ? '   [' + x + ']' : '')); } }
console.log('\n' + pass + ' passed, ' + fail + ' failed, of ' + results.length);
process.exit(fail ? 1 : 0);
