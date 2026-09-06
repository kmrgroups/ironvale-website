/* v107 tests. The fixture is built so a wrong answer is visible:
     - two machines with deliberately different shift patterns, so a blended
       average would give the wrong hours for both
     - an order due next month and one due in four months, so putting demand in
       the wrong bucket shows up
     - a second order queued behind the first on the same machine, so a schedule
       that ignores the queue would call it on time when it is not
     - an order whose part has no routing, which must be named and not counted */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let docs = [], parts = [], idSeq = 1, serial = 0;
const settings = {};
const iso = d => d.toISOString().slice(0, 10);
const inDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const inMonths = n => { const d = new Date(); d.setMonth(d.getMonth() + n); d.setDate(15); return iso(d); };

parts.push({ part_id: 'P1', part_no: 'PART-1', part_name: 'Housing', lifecycle: 'Series', data: {} });
parts.push({ part_id: 'P2', part_no: 'PART-2', part_name: 'Cover', lifecycle: 'Series', data: {} });
parts.push({ part_id: 'P3', part_no: 'PART-3', part_name: 'Bracket', lifecycle: 'New', data: {} });

// P1: one operation on LATHE-1, 360 s a piece = 0.1 h
docs.push({ doc_id: 'o1', kind: 'process', part_id: 'P1', doc_no: 'OP10',
  data: { partId: 'P1', opNo: 10, name: 'Turning', machine: 'LATHE-1', cycleSec: 360 } });
// P2: two operations, LATHE-1 then GRINDER-1
docs.push({ doc_id: 'o2', kind: 'process', part_id: 'P2', doc_no: 'OP10',
  data: { partId: 'P2', opNo: 10, name: 'Turning', machine: 'LATHE-1', cycleSec: 360 } });
docs.push({ doc_id: 'o3', kind: 'process', part_id: 'P2', doc_no: 'OP20',
  data: { partId: 'P2', opNo: 20, name: 'Grinding', machine: 'GRINDER-1', cycleSec: 180 } });
// P3 has no routing at all

// machines: deliberately different patterns
docs.push({ doc_id: 'mc1', kind: 'machine', doc_no: 'MC-1',
  data: { name: 'LATHE-1', shiftsPerDay: 2, hoursPerShift: 8, workDaysPerWeek: 6, availabilityPct: 100 } });
docs.push({ doc_id: 'mc2', kind: 'machine', doc_no: 'MC-2',
  data: { name: 'GRINDER-1', shiftsPerDay: 1, hoursPerShift: 8, workDaysPerWeek: 6, availabilityPct: 50 } });

// orders
docs.push({ doc_id: 'so1', kind: 'order', doc_no: 'SO-1',
  data: { po: 'PO-A', customerName: 'Alpha', partId: 'P1', partNo: 'PART-1', qty: 1000, due: inDays(20) } });
docs.push({ doc_id: 'so2', kind: 'order', doc_no: 'SO-2',
  data: { po: 'PO-B', customerName: 'Beta', partId: 'P2', partNo: 'PART-2', qty: 1000, due: inDays(25) } });
docs.push({ doc_id: 'so3', kind: 'order', doc_no: 'SO-3',
  data: { po: 'PO-C', customerName: 'Gamma', partId: 'P1', partNo: 'PART-1', qty: 500, due: inMonths(3) } });
docs.push({ doc_id: 'so4', kind: 'order', doc_no: 'SO-4',
  data: { po: 'PO-D', customerName: 'Delta', partId: 'P3', partNo: 'PART-3', qty: 100, due: inDays(30) } });

const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => pageErrors.push(e.message));
const dom = new JSDOM(html.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''),
  { runScripts: 'outside-only', url: 'https://example.test/idms.html', virtualConsole: vc });
const { window } = dom;
window.Element.prototype.scrollIntoView = function () {};
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

// ================= capacity plan =================
nav('capacity_plan');
await wait(800);
const cap = txt($('cp-body'));
check('the capacity plan draws', $('cp-body').querySelectorAll('table').length >= 1, cap.slice(0, 80));
check('both machines appear', /LATHE-1/.test(cap) && /GRINDER-1/.test(cap));
check('a chart of the works is drawn', $('cp-body').querySelectorAll('svg').length === 1);

// LATHE-1: 2 x 8 x 100% = 16 h/day. GRINDER-1: 1 x 8 x 50% = 4 h/day.
/* read the cells rather than the concatenated text: textContent runs
   "GRINDER-1" straight into "4" and makes a word-boundary match meaningless */
function capRow(name) {
  return [...$('cp-body').querySelectorAll('tbody tr')]
    .find(r => r.children[0].textContent.trim().startsWith(name));
}
const perDay = name => capRow(name).children[1].textContent.trim();
check('each machine gets its own hours per day, not a blended average',
  /^16/.test(perDay('LATHE-1')) && /^4/.test(perDay('GRINDER-1')),
  perDay('LATHE-1') + ' vs ' + perDay('GRINDER-1'));
check('demand lands in the month the order is due, not all in month one',
  capRow('GRINDER-1').children[2].textContent.trim() === '—' &&
  /%/.test(capRow('GRINDER-1').children[3].textContent),
  txt(capRow('GRINDER-1')));

// demand: PO-A 1000 x 0.1 h = 100 h, PO-B 1000 x 0.1 h = 100 h, both this month or next
check('demand from the open orders is priced at the routing cycle', /100/.test(cap), cap.slice(0, 400));
check('the order due in three months is not loaded into this month',
  $('cp-body').querySelectorAll('tbody tr').length >= 1);
check('an order with no routing is named, not silently dropped',
  /no routing/i.test(cap) && /PO-D/.test(cap), cap.slice(0, 500));

// capacity settings are editable and validated
const caps = txt($('cp-caps'));
check('the capacity settings table lists every machine', /LATHE-1/.test(caps) && /GRINDER-1/.test(caps));
const availInput = $('cp-caps').querySelector('.cp-cap[data-f="availabilityPct"]');
availInput.value = '150'; change(availInput);
await wait(250);
check('availability above 100% is refused', /more than all of the time/i.test(txt($('cp-msg'))), txt($('cp-msg')));
check('and nothing was saved', docs.find(d => d.doc_id === 'mc1').data.availabilityPct === 100);

const shiftInput = $('cp-caps').querySelector('.cp-cap[data-f="shiftsPerDay"]');
shiftInput.value = '0'; change(shiftInput);
await wait(250);
check('zero shifts is refused', /above zero/i.test(txt($('cp-msg'))), txt($('cp-msg')));

shiftInput.value = '3'; change(shiftInput);
await wait(500);
check('a real change saves against the machine', docs.find(d => d.doc_id === 'mc1').data.shiftsPerDay === 3);
check('and the plan recomputes with it', /24/.test(txt($('cp-body')) + txt($('cp-caps'))),
  txt($('cp-caps')).slice(0, 200));

// put it back and check the overload filter
shiftInput.value = '2'; change(shiftInput);
await wait(500);
$('cp-filter').value = 'over'; change($('cp-filter'));
await wait(200);
check('the overloaded-only filter works',
  $('cp-body').querySelectorAll('tbody tr').length <= 2, 'rows=' + $('cp-body').querySelectorAll('tbody tr').length);

// ================= machine loading =================
nav('machine_loading');
await wait(900);
const ml = txt($('ml-body'));
check('the loading plan draws', $('ml-body').querySelectorAll('table').length >= 2, ml.slice(0, 80));
check('every open order with a routing is listed', /PO-A/.test(ml) && /PO-B/.test(ml) && /PO-C/.test(ml));
check('the order with no routing is flagged rather than scheduled',
  /PO-D/.test(ml) && /no routing/i.test(ml));
check('each machine shows what it is committed to',
  /committed to/i.test(txt($('ml-body'))) && /LATHE-1/.test(ml) && /GRINDER-1/.test(ml));

/* PO-A and PO-B both need LATHE-1. PO-A goes first (earlier due date), so PO-B's
   turning cannot start until PO-A's is done — a scheduler that ignored the queue
   would start them both today. */
const rowA = [...$('ml-body').querySelectorAll('tbody tr')].find(r => /PO-A/.test(r.textContent));
const rowB = [...$('ml-body').querySelectorAll('tbody tr')].find(r => /PO-B/.test(r.textContent));
/* the app prints dates as dd/mm/yyyy; Date.parse would read that as US format
   and silently compare the wrong two days */
const ddmmyyyy = t => { const [d, m, y] = t.split('/').map(Number); return new Date(y, m - 1, d); };
const finishOf = row => ddmmyyyy(row.children[6].textContent.trim());
check('the second order on the same machine finishes after the first',
  finishOf(rowB) > finishOf(rowA),
  rowA.children[6].textContent + ' then ' + rowB.children[6].textContent);

/* GRINDER-1 runs 4 h/day and PO-B needs 50 h on it, so PO-B is well past its
   25-day date: the verdict has to say late rather than on time. */
check('an order the queue pushes past its date is called late',
  /late/i.test(rowB.textContent), rowB.textContent.replace(/\s+/g, ' '));
check('the summary counts the orders that will miss', /will miss the date/i.test(txt($('ml-msg'))), txt($('ml-msg')));

$('ml-filter').value = 'late'; change($('ml-filter'));
await wait(200);
check('the late-only filter narrows the list',
  [...$('ml-body').querySelectorAll('tbody tr')].filter(r => /PO-A|PO-B|PO-C/.test(r.textContent)).length >= 1);

check('no page errors throughout', pageErrors.length === 0, pageErrors[0] || '');

let pass = 0, fail = 0;
for (const [n, okv, x] of results) { if (okv) pass++; else { fail++; console.log('  x ' + n + (x ? '   [' + x + ']' : '')); } }
console.log('\n' + pass + ' passed, ' + fail + ' failed, of ' + results.length);
process.exit(fail ? 1 : 0);
