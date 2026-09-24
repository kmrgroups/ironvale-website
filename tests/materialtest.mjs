/* v106 tests. The arithmetic these three screens do is the whole point of them,
   so the fixtures are built to make a wrong answer visible:
     - production booked against THREE operations, so consuming per booking
       instead of at the first operation alone would treble the consumption
     - one receipt inspected and one not, so counting both as stock shows up
     - readings with a deliberate outlier and a deliberate run of seven */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let docs = [], parts = [], idSeq = 1, serial = 0;
const settings = {};
const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

parts.push({ part_id: 'P1', part_no: 'TEST-0001', part_name: 'Housing', lifecycle: 'Series', data: {} });

// routing: three operations
[[10, 'Turning'], [20, 'Milling'], [30, 'Grinding']].forEach(([no, name], i) => {
  docs.push({ doc_id: 'op' + no, kind: 'process', part_id: 'P1', doc_no: 'OP' + no,
    data: { partId: 'P1', opNo: no, name } });
});

// two receipts of the same material: one accepted at inspection, one not yet inspected
docs.push({ doc_id: 'g1', kind: 'grn', doc_no: 'GRN-1',
  data: { supplier: 'Steelco', description: 'EN8 bright bar', qty: 1000, accepted: 990, rejected: 10, inspected: true, date: ago(20) } });
docs.push({ doc_id: 'g2', kind: 'grn', doc_no: 'GRN-2',
  data: { supplier: 'Steelco', description: 'EN8 bright bar', qty: 500, date: ago(2) } });
// a receipt whose description matches nothing on the master
docs.push({ doc_id: 'g3', kind: 'grn', doc_no: 'GRN-3',
  data: { supplier: 'Steelco', description: 'EN9 mystery bar', qty: 300, accepted: 300, inspected: true, date: ago(3) } });

// 100 pieces booked at EVERY operation — material is eaten once, at op 10
[10, 20, 30].forEach(no => {
  docs.push({ doc_id: 'pd' + no, kind: 'production', part_id: 'P1', doc_no: 'PR-' + no,
    data: { partId: 'P1', processId: 'op' + no, opNo: no, made: 100, rejected: 0, date: ago(5) } });
});

// self-inspection readings: 8 tame, one wild, then seven above average
const readings = [10.00, 10.01, 9.99, 10.02, 9.98, 10.01, 9.99, 10.00, 10.9,
  10.05, 10.06, 10.05, 10.07, 10.06, 10.05, 10.06,
  10.00, 9.99, 10.01, 10.00, 9.98, 10.02];
docs.push({ doc_id: 'si1', kind: 'self_insp', part_id: 'P1', doc_no: 'SI-1', status: 'Closed',
  data: { partId: 'P1', processId: 'op10', opNo: 10, date: ago(6), shift: 'A', operator: 'R Kumar',
    machine: 'CNC-01',
    chars: [{ balloon: 'B1', description: 'OD', nominal: 10, upper: 0.05, lower: -0.05, unit: 'mm', gauge: 'Micrometer' }],
    rounds: readings.map((r, i) => ({ at: String(8 + i).padStart(2, '0') + ':00', readings: [String(r)], containment: '' })) } });

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

// ---------- a bill of materials needs the material master first ----------
nav('bom'); await wait(300);
$('bm-part').value = 'P1'; change($('bm-part'));
await wait(300);
check('with no material master the BOM says so instead of an empty grid',
  /No materials on the master/.test(txt($('bm-body'))), txt($('bm-body')).slice(0, 70));

// add two materials
docs.push({ doc_id: 'm1', kind: 'rawmat', doc_no: 'TEST-RM-0001',
  data: { description: 'EN8 bright bar', spec: 'EN8', size: 'D32', uom: 'Kg', rate: 80, reorder: 200, opening: 0 } });
docs.push({ doc_id: 'm2', kind: 'rawmat', doc_no: 'TEST-RM-0002',
  data: { description: 'Packing carton', uom: 'Nos', reorder: 50 } });   // no rate on purpose

nav('bom'); await wait(300);
$('bm-part').value = 'P1'; change($('bm-part'));
await wait(350);
click($('bm-add')); await wait(80);
check('a line can be added', $('bm-body').querySelectorAll('.bm-mat').length === 1);

// 2 kg per piece with 5% scrap = 2.1 kg gross, at Rs 80 = Rs 168.00
const qty = $('bm-body').querySelector('.bm-in[data-f="qtyPer"]');
qty.value = '2'; change(qty); await wait(80);
const scrap = $('bm-body').querySelector('.bm-in[data-f="scrapPct"]');
scrap.value = '5'; change(scrap); await wait(120);
check('gross per piece includes the scrap allowance', /2\.1/.test(txt($('bm-body'))), txt($('bm-body')).slice(0, 200));
check('material cost per piece is worked out', /168\.00/.test(txt($('bm-body'))), txt($('bm-body')).slice(-160));

// a second line on the same material must be refused
click($('bm-add')); await wait(120);
click($('bm-save')); await wait(300);
check('the same material twice is refused', /twice/i.test(txt($('bm-msg'))), txt($('bm-msg')));
check('nothing was saved', !docs.some(d => d.kind === 'bom'));

// point the second line at the carton, 1 per piece
const sel2 = $('bm-body').querySelectorAll('.bm-mat')[1];
sel2.value = 'm2'; change(sel2); await wait(150);
const qty2 = $('bm-body').querySelectorAll('.bm-in[data-f="qtyPer"]')[1];
qty2.value = '0'; change(qty2); await wait(120);
click($('bm-save')); await wait(250);
check('a zero-quantity line is refused', /above zero/i.test(txt($('bm-msg'))), txt($('bm-msg')));
qty2.value = '1'; change(qty2); await wait(120);
check('a material with no rate is flagged, not treated as free',
  /no standard rate/i.test(txt($('bm-body'))), txt($('bm-body')).slice(-200));
click($('bm-save')); await wait(350);
check('the bill saves', docs.filter(d => d.kind === 'bom').length === 1, txt($('bm-msg')));
click($('bm-save')); await wait(350);
check('saving twice updates the same bill', docs.filter(d => d.kind === 'bom').length === 1);

// ---------- stock ----------
nav('sheet_rawmat'); await wait(700);
const stock = txt($('st-body'));
check('stock counts only the inspected receipt', /990/.test(stock), stock.slice(0, 300));
check('the uninspected receipt is shown apart', /500/.test(stock));
check('consumption is counted once, not once per operation',
  /210/.test(stock) && !/630/.test(stock), stock.slice(0, 400));
check('balance = opening + accepted - consumed', /780/.test(stock), stock.slice(0, 400));
check('a receipt matching no material is reported, not dropped',
  /EN9 mystery bar/.test(stock), stock.slice(0, 200));
check('stock value uses the master rate', /62,400|62400/.test(stock.replace(/\s/g, '')), stock.slice(0, 300));
check('below-reorder materials are counted', /At or below reorder/.test(stock));

// opening balance is the one thing typed
const openInput = $('st-body').querySelector('.st-open');
openInput.value = '100'; change(openInput);
await wait(600);
check('the opening balance saves against the material',
  (docs.find(d => d.doc_id === 'm1') || { data: {} }).data.opening === 100);
check('and the balance moves with it', /880/.test(txt($('st-body'))), txt($('st-body')).slice(0, 300));

// ---------- control charts ----------
nav('report_control_charts'); await wait(400);
$('cc-part').value = 'P1'; change($('cc-part'));
await wait(500);
check('the characteristic list is built from the recorded readings',
  /OD/.test($('cc-char').textContent), $('cc-char').textContent);
click($('cc-run'));
await wait(400);
const cc = txt($('cc-body'));
check('a chart is drawn', $('cc-body').querySelectorAll('svg').length === 2,
  'svgs=' + $('cc-body').querySelectorAll('svg').length);
check('every reading is counted', /22 readings/.test(cc), cc.slice(0, 200));
check('the outlier is caught', /outside the control limits/.test(cc), cc.slice(0, 400));
check('the run of seven on one side is caught', /run of seven/i.test(cc), cc.slice(0, 500));
check('readings outside the drawing tolerance are called out separately',
  /outside the drawing tolerance/.test(cc), cc.slice(0, 600));
check('capability is reported now there are twenty-plus readings',
  /Cpk/.test(cc) && !/needs 20/.test(cc), cc.slice(0, 300));

// with too few readings, capability must be withheld rather than guessed
$('cc-from').value = ago(6); $('cc-to').value = ago(6);
docs.find(d => d.doc_id === 'si1').data.rounds = readings.slice(0, 6).map((r, i) => ({ at: '0' + i + ':00', readings: [String(r)] }));
$('cc-part').value = 'P1'; change($('cc-part'));
await wait(500);
click($('cc-run')); await wait(400);
check('capability is withheld below twenty readings',
  /Capability is not shown/.test(txt($('cc-body'))), txt($('cc-body')).slice(0, 260));
check('but the chart is still drawn', $('cc-body').querySelectorAll('svg').length === 2);

check('no page errors throughout', pageErrors.length === 0, pageErrors[0] || '');

let pass = 0, fail = 0;
for (const [n, okv, x] of results) { if (okv) pass++; else { fail++; console.log('  x ' + n + (x ? '   [' + x + ']' : '')); } }
console.log('\n' + pass + ' passed, ' + fail + ' failed, of ' + results.length);
process.exit(fail ? 1 : 0);
