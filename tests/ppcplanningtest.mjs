/* PPC Planning Module (MRP). The fixture is built so a wrong answer shows:
     - PART-1 has stock at all five stages with different figures, so a column
       read from the wrong source, or a stage left out of Overall, is visible
     - PART-1 has two deliveries in the month: the first is partly invoiced and
       fully covered by stock, the second takes only what the first left — a plan
       that counted stock per line would cover both
     - PART-1 and PART-2 share one raw material, so the RM available to the later
       delivery is what the earlier one left
     - PART-3 has no bill of materials, which must be named, not treated as zero */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let docs = [], parts = [], idSeq = 1, serial = 0;
const settings = {};
const today = new Date();
const month = today.toISOString().slice(0, 7);
const day = n => month + '-' + String(n).padStart(2, '0');
const past = today.toISOString().slice(0, 10) >= day(1) ? day(1) : day(1);   // production dated the 1st
const add = (kind, part_id, data, status, doc_no) =>
  docs.push({ doc_id: 'd' + (idSeq++), kind, part_id: part_id || '', doc_no: doc_no || kind.toUpperCase() + idSeq, status: status || '', data });

parts.push({ part_id: 'P1', part_no: 'PART-1', part_name: 'Housing', lifecycle: 'Series', data: {} });
parts.push({ part_id: 'P2', part_no: 'PART-2', part_name: 'Cover', lifecycle: 'Series', data: {} });
parts.push({ part_id: 'P3', part_no: 'PART-3', part_name: 'Bracket', lifecycle: 'Series', data: {} });

add('customer', '', { name: 'Alpha Motors' }, 'Active', 'CUS-1');
const CUST = docs[0].doc_id;
add('cust_part', 'P1', { partId: 'P1', customerId: CUST, custPartNo: 'AM-HSG-01', custPartName: 'Housing LH', price: 100 });

// routing for P1: three operations
[10, 20, 30].forEach(op => add('process', 'P1', { partId: 'P1', opNo: op, name: 'Op ' + op, cycleSec: 60 }));
// production on P1 (dated the 1st, so today or earlier)
add('production', 'P1', { partId: 'P1', opNo: 10, made: 500, rejected: 20, good: 480, date: past });
add('production', 'P1', { partId: 'P1', opNo: 20, made: 400, rejected: 10, good: 390, date: past });
add('production', 'P1', { partId: 'P1', opNo: 30, made: 300, rejected: 0, good: 300, date: past });
// WIP = (480-400) + (390-300) = 170 ; FI = 300 - 200 offered = 100
add('pdi', 'P1', { partId: 'P1', offered: 200, accepted: 190, despatched: 40 }, 'Cleared');   // FG = 150
// 120 out to a supplier on a returnable challan, 50 back on a GRN, not yet inspected
add('dc', 'P1', { returnable: 'yes', lines: [{ partId: 'P1', qty: 120 }] }, 'Returnable');
add('grn', 'P1', { description: 'Housing back from plating', qty: 50, accepted: 50, date: past });
// overall = 150 + 100 + 70 + 170 + 50 = 540

// raw material: one bar shared by P1 and P2
add('rawmat', '', { description: 'EN8 Bar 40', code: 'RM-0001', spec: 'EN8 Dia 40', uom: 'Kg', opening: 400, rate: 80, moq: 20, leadDays: 7 }, 'Active', 'RM-0001');
const M1 = docs[docs.length - 1].doc_id;
add('grn', '', { description: 'EN8 Bar 40', qty: 100, accepted: 100, date: past });
// P1 consumes 0.5 kg + 10% scrap = 0.55 kg a piece at op 10: 500 x 0.55 = 275 → balance 400+100-275 = 225
add('bom', 'P1', { partId: 'P1', lines: [{ materialId: M1, qtyPer: 0.5, scrapPct: 10 }] });
add('bom', 'P2', { partId: 'P2', lines: [{ materialId: M1, qtyPer: 1, scrapPct: 0 }] });

// demand this month
add('order', 'P1', { customerId: CUST, customerName: 'Alpha Motors', partId: 'P1', partNo: 'PART-1', po: 'PO-A', poType: 'onetime', qty: 400, due: day(10), price: 100 });
add('order', 'P2', { customerId: CUST, customerName: 'Alpha Motors', partId: 'P2', partNo: 'PART-2', po: 'PO-B', poType: 'onetime', qty: 100, due: day(15), price: 50, custPartNo: 'AM-CVR', custPartName: 'Cover' });
add('order', 'P3', { customerId: CUST, customerName: 'Alpha Motors', partId: 'P3', partNo: 'PART-3', po: 'PO-C', poType: 'onetime', qty: 50, due: day(20), price: 20 });
add('order', 'P1', { customerId: CUST, customerName: 'Alpha Motors', partId: 'P1', partNo: 'PART-1', po: 'SCH-D', poType: 'schedule', qty: 600, due: day(25), price: 100 });
// P4: 10 in-house → 20 job work → 30 in-house
parts.push({ part_id: 'P4', part_no: 'PART-4', part_name: 'Yoke', lifecycle: 'Series', data: {} });
add('process', 'P4', { partId: 'P4', opNo: 10, name: 'Turn', where: 'in' });
add('process', 'P4', { partId: 'P4', opNo: 20, name: 'Zinc plating', where: 'sub' });
add('process', 'P4', { partId: 'P4', opNo: 30, name: 'Assembly', where: 'in' });
add('production', 'P4', { partId: 'P4', opNo: 10, made: 100, rejected: 0, good: 100, date: past });
add('dc', 'P4', { returnable: 'yes', date: past, lines: [{ partId: 'P4', qty: 80 }] }, 'Returnable');
add('grn', 'P4', { description: 'Yoke back from plating', qty: 60, accepted: 55, rejected: 5, inspected: true, date: past });
add('production', 'P4', { partId: 'P4', opNo: 30, made: 40, rejected: 0, good: 40, date: past });
// WIP = (100 - 80) + (55 - 40) = 35 ; FI = 40 ; Supplier = 80 - 60 = 20 ; Incoming = 0 → 95
add('order', 'P4', { customerId: CUST, customerName: 'Alpha Motors', partId: 'P4', partNo: 'PART-4', po: 'PO-E', poType: 'onetime', qty: 200, due: day(12), price: 30 });
// 50 kg of the bar on order, after the receipt on the 1st
add('rmpo', '', { supplier: 'Steel Co', date: day(2), lines: [{ materialId: M1, qty: 50, rate: 80 }] }, 'Open', 'RMPO-1');
// 100 of PART-1 already invoiced this month
add('invoice', '', { customerId: CUST, customerName: 'Alpha Motors', invoiceNo: 'INV-1', invoiceDate: day(2),
  lines: [{ partId: 'P1', partNo: 'PART-1', qty: 100, rate: 100 }] });

const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => { if (!/navigation to another Document/.test(e.message)) pageErrors.push(e.message); });
const dom = new JSDOM(html.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''),
  { runScripts: 'outside-only', url: 'https://example.test/idms.html', virtualConsole: vc });
const { window } = dom;
window.Element.prototype.scrollIntoView = function () {};
window.URL.createObjectURL = () => 'blob:x'; window.URL.revokeObjectURL = () => {};
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
    if (url.includes('what=serial') || body.what === 'serial') { ++serial; return ok({ next: serial, value: serial }); }
    if (opts.method === 'POST' && body.what === 'parts') {
      const pp = body.part; const ex = parts.find(x => x.part_id === pp.partId);
      if (ex) { ex.data = pp.data; return ok({ partId: pp.partId }); }
      return ok({});
    }
    if (opts.method === 'PATCH' && body.what === 'docs' && body.remove) { docs = docs.filter(x => x.doc_id !== body.docId); return ok({ removed: true }); }
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
      if (body.what === 'parts') {}
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
const nav = id => click(window.document.querySelector('#menubar [data-s="' + id + '"]'));
const txt = el => el.textContent.replace(/\s+/g, ' ').trim();
const num = t => Number(String(t).replace(/[^\d.\-]/g, '')) ;

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(250);
window.confirm = () => true;
let promptAnswer = 'test reason';
window.prompt = () => promptAnswer;

check('the PPC & MMD menu carries the Planning Module',
  !!window.document.querySelector('#menubar [data-s="ppc_planning"]'));
nav('ppc_planning');
await wait(400);
check('the screen opens', window.document.querySelector('.panel.on') &&
  window.document.querySelector('.panel.on').dataset.panel === 'ppc_planning');
check('the month defaults to this month', $('mrp-month').value === month, $('mrp-month').value);

click($('mrp-run'));
await wait(1000);

const cellsOf = re => [...[...$('mrp-grid').querySelectorAll('tbody tr')].find(r => re.test(r.textContent)).children].map(td => txt(td));
const rows = [...$('mrp-grid').querySelectorAll('tbody tr')];
const heads = [...$('mrp-grid').querySelectorAll('thead tr')[1].children].map(th => txt(th));
check('every column asked for is on the table',
  ['Part No', 'Customer Part No', 'Customer Part Name', 'Delivery Date', 'PO / Schedule Qty', 'FG Stock', 'FI Stock',
   'Supplier Stock', 'WIP Stock', 'Incoming Insp. Stock', 'Overall Stock', 'Net Requirement', 'Balance to start 1st Op',
   'Start 1st Op by', 'RM Code', 'RM Specification / Description', 'RM per Part', 'UOM', 'Total RM Required',
   'RM Available Stock', 'RM On Order', 'RM Balance to Purchase', 'Order by', 'Actions'].every(h => heads.some(x => x.startsWith(h))), heads.join(' | '));
check('the headings are frozen (sticky) and the first two columns too',
  /position:sticky/.test(html.replace(/\s/g, '')) && !!$('mrp-grid').querySelector('thead .fz1') && !!$('mrp-grid').querySelector('tbody .fz2'));
check('one row per demand line', rows.length === 5, 'rows=' + rows.length);

let c = cellsOf(/PO-A/);
check('customer part number and name come from the customer/part link', c[1] === 'AM-HSG-01' && /Housing LH/.test(c[2]), c.slice(0, 3).join(' | '));
check('FG = PDI accepted − despatched (150)', num(c[5]) === 150, c[5]);
check('FI = OK at the last op − offered to PDI (100)', num(c[6]) === 100, c[6]);
check('Supplier = returnable challans − received back (70)', num(c[7]) === 70, c[7]);
check('WIP = each stage net of what the next took (170)', num(c[8]) === 170, c[8]);
check('Incoming = part GRNs not inspected (50)', num(c[9]) === 50, c[9]);
check('Overall = the five added, each piece once (540)', num(c[10]) === 540, c[10]);
check('the partly despatched, fully stocked delivery needs nothing started', num(c[11]) === 0 && /covered/.test(c[12]), c[11] + ' / ' + c[12]);

let d = cellsOf(/SCH-D/);
check('the later delivery only gets the stock the earlier one left (240)', /same part/.test(d[5]) && num(d[6].split('left')[0]) === 240, d[5] + ' / ' + d[6]);
check('net requirement = 600 − 240 = 360', num(d[7]) === 360, d[7]);
check('with no rejection allowance or batch size, start = net (360)', num(d[8]) === 360, d[8]);
check('RM per part is gross, scrap included (0.55)', /^0\.55/.test(d[12]), d[12]);
check('total RM required = 360 × 0.55 = 198', num(d[14]) === 198, d[14]);
check('RM available is what PART-2 left of the shared bar (125)', num(d[15]) === 125, d[15]);
check('RM on order is the open PO balance (50)', num(d[16]) === 50, d[16]);
check('RM balance to purchase = 198 − 125 − 50 = 23', num(d[17]) === 23, d[17]);

const e = cellsOf(/PO-E/);
check('job work: WIP counts pieces before and after the supplier, each once (35)', num(e[8]) === 35, e[8]);
check('job work: FI = OK at the last in-house op (40)', num(e[6]) === 40, e[6]);
check('job work: Supplier = 80 sent − 60 back (20)', num(e[7]) === 20, e[7]);
check('job work: nothing inspected is left in Incoming (0)', num(e[9]) === 0, e[9]);
check('job work: overall 95, start 105', num(e[10]) === 95 && num(e[12]) === 105, e[10] + ' / ' + e[12]);
check('rejected at inspection is shown for information, not counted', /PART-4.*?5/.test(txt($('mrp-stock'))));

check('a part with no bill of materials is named, not treated as zero',
  /no bill of materials/i.test(txt([...$('mrp-grid').querySelectorAll('tbody tr')].find(r => /PO-C/.test(r.textContent)))) && /PART-3/.test(txt($('mrp-summary'))));
const b1 = [...$('mrp-buy').querySelector('tbody tr').children].map(td => txt(td));
check('purchase list: 298 required − 225 on hand − 50 on order = 23 net, rounded up to the 20 MOQ = 40',
  b1[0] === 'RM-0001' && num(b1[3]) === 298 && num(b1[5]) === 225 && num(b1[6]) === 50 && num(b1[8]) === 23 && num(b1[10]) === 40, b1.join(' | '));

// ---------- Edit: part master parameters and BOM from the plan ----------
click([...$('mrp-grid').querySelectorAll('.mrp-e')].find(b => b.dataset.k === docs.find(x => x.kind === 'order' && x.data.po === 'SCH-D').doc_id));
await wait(200);
check('Edit opens the line editor', /Edit — PART-1/.test(txt($('mrp-editor'))));
$('mrp-p-rej').value = '10'; $('mrp-p-lot').value = '50'; $('mrp-p-lead').value = '5';
$('mrp-e-qty').value = '650';
click($('mrp-e-save'));
await wait(300);
check('a changed quantity with no reason is refused', /why/i.test(txt($('mrp-e-msg'))), txt($('mrp-e-msg')));
$('mrp-e-why').value = 'Customer phoned an increase';
click($('mrp-e-save'));
await wait(1300);
check('part master parameters are written to the part', parts.find(x => x.part_id === 'P1').data.lotSize === 50 &&
  parts.find(x => x.part_id === 'P1').data.rejectionPct === 10, JSON.stringify(parts.find(x => x.part_id === 'P1').data));
const adj = docs.find(x => x.kind === 'ppc_adj');
check('the quantity change is a planner adjustment, the PO is untouched',
  adj && Object.values(adj.data.lines)[0].qty === 650 && docs.find(x => x.kind === 'order' && x.data.po === 'SCH-D').data.qty === 600);
d = cellsOf(/SCH-D/);
check('adjusted line shows the new qty marked ✎', /650 ✎/.test(d[4]), d[4]);
check('net 650 − 240 = 410; ÷ 0.9 = 455.6 → 456; to the 50 batch = 500', num(d[7]) === 410 && parseFloat(d[8].replace(/,/g,'')) === 500, d[7] + ' / ' + d[8]);
check('start by = delivery − 5 days lead time', d[9].slice(0, 10) === (() => { const x = new Date(day(25) + 'T00:00:00'); x.setDate(x.getDate() - 5);
  return String(x.getDate()).padStart(2, '0') + '/' + String(x.getMonth() + 1).padStart(2, '0') + '/' + x.getFullYear(); })(), d[9]);
check('RM follows the start quantity: 500 × 0.55 = 275', num(d[14]) === 275, d[14]);

// ---------- Delete (exclude) and restore ----------
click([...$('mrp-grid').querySelectorAll('.mrp-d')].find(b => b.dataset.k === docs.find(x => x.kind === 'order' && x.data.po === 'PO-C').doc_id));
await wait(1000);
check('Delete excludes the line from the plan, not the PO', ![...$('mrp-grid').querySelectorAll('tbody tr')].some(r => /PO-C/.test(r.textContent)) &&
  /PO-C/.test(txt($('mrp-excluded'))) && docs.some(x => x.kind === 'order' && x.data.po === 'PO-C'));
click($('mrp-excluded').querySelector('.mrp-restore'));
await wait(1000);
check('and Restore puts it back', [...$('mrp-grid').querySelectorAll('tbody tr')].some(r => /PO-C/.test(r.textContent)));

// ---------- Add a manual line ----------
click($('mrp-add'));
await wait(200);
$('mrp-a-part').value = 'P2'; $('mrp-a-due').value = day(28); $('mrp-a-qty').value = '30';
click($('mrp-a-save'));
await wait(200);
check('a manual line without a reason is refused', /what this demand is for/i.test(txt($('mrp-e-msg'))));
$('mrp-a-note').value = 'PPAP samples';
click($('mrp-a-save'));
await wait(1000);
const man = cellsOf(/PPAP samples/);
check('Add creates a manual demand line in the plan', /Manual/.test(man[3]) && num(man[4]) === 30, man.slice(0, 5).join(' | '));

// ---------- stock counts ----------
const fgBox = $('mrp-stock').querySelector('.mrp-cnt[data-pid="P1"][data-k="fg"]');
fgBox.value = '0';
click($('mrp-count-save'));
await wait(300);
check('a count with nobody against it is refused', /who counted/i.test(txt($('mrp-count-msg'))), txt($('mrp-count-msg')));
$('mrp-count-by').value = 'Stores';
click($('mrp-count-save'));
await wait(1200);
const cnt = docs.find(x => x.kind === 'part_stock' && x.part_id === 'P1');
check('the count is saved against the part', cnt && cnt.data.fg === 0 && cnt.data.by === 'Stores' && cnt.data.fi === null, JSON.stringify(cnt && cnt.data));
check('the counted figure is marked as counted', /counted/.test(txt([...$('mrp-grid').querySelectorAll('tbody tr')].find(r => /PO-A/.test(r.textContent)))));

// ---------- release ----------
click($('mrp-release'));
await wait(900);
const rel = docs.find(x => x.kind === 'ppc_plan' && x.status === 'Released');
check('Release saves a frozen snapshot', rel && rel.data.rows.length >= 5 && rel.data.columns.length === 26, rel ? rel.data.rows.length + ' rows' : 'none');
check('and locks editing', !$('mrp-grid').querySelector('.mrp-e') && $('mrp-add').disabled && /Released/.test(txt($('mrp-released'))));
click($('mrp-reopen'));
await wait(500);
check('Reopen for revision unlocks it', !!$('mrp-grid').querySelector('.mrp-e') && !$('mrp-add').disabled);

let csvOk = true; try { click($('mrp-csv')); } catch (e2) { csvOk = false; }
check('export to CSV runs', csvOk);

nav('sales_monthly_plan');
await wait(500);
click($('spm-run-planning'));
await wait(1300);
check('Run Planning on the Sales Plan opens and runs the module',
  window.document.querySelector('.panel.on').dataset.panel === 'ppc_planning' && $('mrp-grid'));

// ---------- masters ----------
nav('sheet_rawmat');
await wait(700);
check('Raw Material Stock shows the same balance (225)', /225/.test(txt($('st-body'))), txt($('st-body')).slice(0, 300));
check('a part coming back from job work is not listed as an unknown material', !/Yoke back from plating/.test(txt($('st-body'))));

nav('entry_rawmat');
await wait(500);
$('rm-desc').value = 'en8   bar-40';
click($('rm-save'));
await wait(300);
check('a material spelt differently is still refused as a duplicate', /already on the list as <b>|already on the list/.test($('rm-msg').innerHTML), txt($('rm-msg')));

nav('jig_master');
await wait(400);
$('jf-desc').value = 'Drilling jig 4 holes'; $('jf-part').value = 'P1'; $('jf-op').value = '20';
click($('jf-save'));
await wait(400);
const jig = docs.find(x => x.kind === 'jig');
check('a jig gets an auto-generated JF code', jig && /-JF-\d{4}$/.test(jig.doc_no), jig && jig.doc_no);
$('jf-desc').value = 'drilling  JIG — 4 holes'; $('jf-part').value = 'P1'; $('jf-op').value = '20';
click($('jf-save'));
await wait(300);
check('the same jig on the same part and op is refused', /already on file/.test(txt($('jf-msg'))) && docs.filter(x => x.kind === 'jig').length === 1, txt($('jf-msg')));

nav('consumables_master');
await wait(400);
check('Consumables Master opens the material master filtered to consumables',
  /Consumables Master/.test(txt($('rm-title'))) && $('rm-type').value === 'Consumable');

nav('rm_po');
await wait(500);
const po1 = [...$('po-list').querySelector('tbody tr').children].map(td => txt(td));
check('RM Purchase Orders lists the open PO with its open balance', po1[0] === 'RMPO-1' && num(po1[4]) === 50 && num(po1[5]) === 0 && num(po1[6]) === 50, po1.join(' | '));

check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

let failed = 0;
for (const [n, ok, x] of results) { if (!ok) failed++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  — ' + x)); }
console.log(results.length - failed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
