/* Sales Invoice against Customer PO, the full tax-invoice document, PO
   documents on the Customer PO register, tentative month names, and a revised
   PO no longer counting twice.

     - the PO dropdown lists every live PO / schedule / open rate contract for
       the customer and part, earliest-due-with-quantity-left first, and never
       a superseded one
     - PO number, PO date and rate come from the chosen PO
     - the saved invoice and the printed document carry every section of the
       tax-invoice format, with the arithmetic checked
     - refusals: a malformed IRN, a second currency on one invoice */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi  = fs.readFileSync('kpi.js', 'utf8');
const results = [];
const check = (n, c, x) => results.push([n, !!c, x || '']);
const wait = ms => new Promise(r => setTimeout(r, ms));
const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => pageErrors.push(e.message));

const dom = new JSDOM(html.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''),
  { runScripts: 'outside-only', url: 'https://works.example/idms.html', virtualConsole: vc });
const { window } = dom;
window.Element.prototype.scrollIntoView = function () {};
window.TextEncoder = TextEncoder;
window.prompt = () => 'testing';
let printed = [];
window.open = () => ({ document: { write: h => printed.push(h), close() {} }, print() {} });
let signedIn = false;

const today = new Date();
const iso = d => d.toISOString().slice(0, 10);
const plus = n => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
const thisMonth = iso(today).slice(0, 7);

const customers = [{ doc_id: 'c1', doc_no: 'ALPH-001', data: { name: 'Alpha Motors', code: 'ALPH-001',
  gstin: '29AABCA1234F1Z5', terms: '45 days', billing: 'Plot 4, Peenya, Bengaluru', despatch: 'Gate 2, Hosur Road plant',
  contact: 'R. Rao', phone: '9800000000', email: 'buy@alpha.example' } }];
const parts = [{ part_id: 'p1', part_no: 'PART-100', part_name: 'Bracket', lifecycle: 'Series',
  data: { drawingNo: 'DWG-77', drawingRev: 'C', uom: 'Nos' } },
  { part_id: 'p2', part_no: 'PART-200', part_name: 'Shaft', lifecycle: 'Series', data: { drawingNo: 'DWG-88', drawingRev: 'A' } }];
let custParts = [
  { doc_id: 'cp1', data: { partId: 'p1', internalNo: 'PART-100', customerId: 'c1', customerName: 'Alpha Motors',
    custPartNo: 'AL-BR-9', custPartName: 'Bracket Assy 9', hsn: '87089900', price: 100, currency: 'INR' } },
  { doc_id: 'cp2', data: { partId: 'p2', internalNo: 'PART-200', customerId: 'c1', customerName: 'Alpha Motors',
    custPartNo: 'AL-SH-1', custPartName: 'Drive Shaft', hsn: '84834000', price: 50, currency: 'INR' } }];
let orders = [
  // the later PO — must NOT be pre-selected
  { doc_id: 'o-late', doc_no: 'SO-2', data: { customerId: 'c1', customerName: 'Alpha Motors', partId: 'p1', partNo: 'PART-100',
    poType: 'onetime', po: 'PO-LATE', qty: 500, price: 104, currency: 'INR', due: plus(40), orderedOn: plus(-5),
    custPartNo: 'AL-BR-9', custPartName: 'Bracket Assy 9' } },
  // the earliest due with quantity left — pre-selected
  { doc_id: 'o-early', doc_no: 'SO-1', data: { customerId: 'c1', customerName: 'Alpha Motors', partId: 'p1', partNo: 'PART-100',
    poType: 'onetime', po: 'PO-EARLY', qty: 300, price: 101.5, currency: 'INR', due: plus(10), orderedOn: plus(-20),
    custPartNo: 'AL-BR-9', custPartName: 'Bracket Assy 9', tent1: 150, tent2: 0,
    poFile: { url: '/api/assets?id=abc', name: 'PO-EARLY.pdf', mime: 'application/pdf' } } },
  // superseded by o-early's revision history — never offered, never demand
  { doc_id: 'o-old', doc_no: 'SO-0', data: { customerId: 'c1', customerName: 'Alpha Motors', partId: 'p1', partNo: 'PART-100',
    poType: 'onetime', po: 'PO-EARLY', qty: 300, price: 99, currency: 'INR', due: plus(10), orderedOn: plus(-25),
    obsolete: true, supersededBy: 'o-early' } },
  // a rate contract and a schedule for the shaft
  { doc_id: 'rc1', doc_no: 'SO-3', data: { customerId: 'c1', customerName: 'Alpha Motors', partId: 'p2', partNo: 'PART-200',
    poType: 'ratecontract', po: 'RC-9', qty: 0, price: 52, currency: 'INR', orderedOn: plus(-90), validTo: '' ,
    custPartNo: 'AL-SH-1', custPartName: 'Drive Shaft' } },
  { doc_id: 'sch1', doc_no: 'SO-4', data: { customerId: 'c1', customerName: 'Alpha Motors', partId: 'p2', partNo: 'PART-200',
    poType: 'schedule', po: 'REL-3', qty: 200, price: 52, currency: 'INR', due: plus(5), orderedOn: '',
    scheduleAgainst: 'rc1', scheduleAgainstPo: 'RC-9', custPartNo: 'AL-SH-1', custPartName: 'Drive Shaft' } }];
let invoices = [];
let settingsStore = {};
let patched = [];
let idSeq = 1;
const company = { legalName: 'Works Test Pvt Ltd', addr1: 'Plot 12, KIADB', city: 'Mysuru', state: 'Karnataka', pin: '570016',
  taxNumber: '29AAACW1234F1Z9', phone: '0821-000000', email: 'accounts@works.example', website: 'works.example',
  bankShow: true, bankName: 'Test Bank', bankBranch: 'Hebbal', bankAccName: 'Works Test Pvt Ltd', bankAccNo: '000111222333',
  bankIfsc: 'TEST0000123' };

window.fetch = async (path, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : {};
  const url = String(path);
  const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
  if (url.startsWith('/api/auth')) {
    if (body.action === 'login') { signedIn = true; return ok({ token: 'T', user: 'tester', role: 'developer' }); }
    if (body.action === 'session') return signedIn ? ok({ user: 'tester', role: 'developer' })
      : { ok: false, status: 401, json: async () => ({ error: 'Not signed in' }) };
    return ok({});
  }
  if (url.startsWith('/api/content')) return ok({ data: { company } });
  if (url.startsWith('/api/idms')) {
    if (url.includes('what=parts')) return ok({ parts });
    if (url.includes('kind=customer')) return ok({ docs: customers });
    if (url.includes('kind=cust_part')) return ok({ docs: custParts });
    if (url.includes('kind=order')) return ok({ docs: orders });
    if (url.includes('kind=salesplan')) return ok({ docs: [] });
    if (url.includes('kind=invoice')) return ok({ docs: invoices });
    if (url.includes('what=settings') && opts.method !== 'POST') return ok({ settings: settingsStore });
    if (opts.method === 'POST' && body.what === 'settings') { settingsStore[body.key] = body.data; return ok({}); }
    if (url.includes('what=docs') && opts.method !== 'POST' && opts.method !== 'PATCH') return ok({ docs: [] });
    if (opts.method === 'PATCH' && body.what === 'docs') { patched.push(body); return ok({}); }
    if (opts.method === 'POST' && body.what === 'docs') {
      const id = 'd' + (idSeq++);
      const rec = { doc_id: id, doc_no: body.doc.docNo, data: body.doc.data };
      if (body.doc.kind === 'invoice') invoices.push(rec);
      if (body.doc.kind === 'order') orders.push(rec);
      return ok({ docId: id });
    }
    if (body.what === 'serial') return ok({ value: idSeq++ });
    return ok({});
  }
  return ok({});
};

window.eval(core); window.eval(kpi);
window.eval(html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1]);
const $ = id => window.document.getElementById(id);
const click = el => el && el.dispatchEvent(new window.Event('click', { bubbles: true }));
const change = el => el && el.dispatchEvent(new window.Event('change', { bubbles: true }));
const input = el => el && el.dispatchEvent(new window.Event('input', { bubbles: true }));
const go = s => click([...window.document.querySelectorAll('#menubar a[data-s]')].find(a => a.dataset.s === s));

await wait(150);
$('g-user').value = 'tester'; $('g-pass').value = 'password1';
click($('g-go')); await wait(300);

/* ================= Customer PO register ================= */
go('sales_plan'); await wait(300);
const reg = $('so-list');
const earlyRow = [...reg.querySelectorAll('tr')].find(tr => tr.textContent.includes('PO-EARLY'));
check('the register has a PO document column', /PO document/.test(reg.querySelector('thead').textContent));
check('a PO with a document offers View', !!earlyRow && [...earlyRow.querySelectorAll('a')].some(a => a.textContent === 'View' && a.target === '_blank'));
check('and Download under the uploaded file name',
  !!earlyRow && [...earlyRow.querySelectorAll('a')].some(a => a.textContent === 'Download' && a.getAttribute('download') === 'PO-EARLY.pdf'));
const lateRow = [...reg.querySelectorAll('tr')].find(tr => tr.textContent.includes('PO-LATE'));
check('a PO with no document offers Attach instead', !!lateRow && !!lateRow.querySelector('.so-attach'));
check('the header and body have the same number of cells',
  reg.querySelector('thead tr').children.length === earlyRow.children.length,
  reg.querySelector('thead tr').children.length + ' vs ' + (earlyRow && earlyRow.children.length));
click([...window.document.querySelectorAll('.so-tab')].find(b => b.dataset.tab === 'obsolete')); await wait(80);
const obsRow = [...reg.querySelectorAll('tbody tr')][0];
check('the Obsolete tab lines up too', obsRow && reg.querySelector('thead tr').children.length === obsRow.children.length);
click([...window.document.querySelectorAll('.so-tab')].find(b => b.dataset.tab === 'live')); await wait(80);

// tentative labels carry month names
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const nameOf = (y, m) => MONTHS[m] + (y !== today.getFullYear() ? ' ' + y : '');
const nm = k => { const d = new Date(today.getFullYear(), today.getMonth() + k, 1); return nameOf(d.getFullYear(), d.getMonth()); };
check('with no delivery date, tentative 1 is named after next month', $('so-t1-label').textContent === 'Tentative — ' + nm(1), $('so-t1-label').textContent);
check('and tentative 2 after the month after', $('so-t2-label').textContent === 'Tentative — ' + nm(2), $('so-t2-label').textContent);
$('so-due').value = '2026-12-15'; change($('so-due'));
check('a December delivery names January and February of the next year',
  $('so-t1-label').textContent === 'Tentative — ' + nameOf(2027, 0) && $('so-t2-label').textContent === 'Tentative — ' + nameOf(2027, 1),
  $('so-t1-label').textContent + ' / ' + $('so-t2-label').textContent);
check('the tentative labels no longer say "next month"', !/id="so-t[12]-label">[^<]*next month/i.test(html));
check('a Bulk upload POs shortcut is on the screen', !!$('so-bulk'));

/* ================= superseded POs do not count twice ================= */
go('sales_monthly_plan'); await wait(300);
const planRowTxt = [...$('spm-list').querySelectorAll('tr')].map(tr => tr.textContent).join(' | ');
const monthOfEarly = plus(10).slice(0, 7);
if (monthOfEarly === thisMonth) {
  check('Sales Plan counts the revised PO once (300), not with its superseded copy (600)',
    /300/.test(planRowTxt) && !/600/.test(planRowTxt), planRowTxt.slice(0, 300));
} else {
  check('Sales Plan counts the revised PO once (skipped: due next month)', true);
}

/* ================= Sales Invoice ================= */
go('sales_invoice'); await wait(400);
$('iv-cust').value = 'c1'; change($('iv-cust')); await wait(60);
check('payment terms fill from the customer', $('iv-terms').value === '45 days');
check('due date is worked out from the terms', $('iv-due').value === (() => { const d = new Date(iso(today) + 'T00:00:00'); d.setDate(d.getDate() + 45); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })(), $('iv-due').value);
check('place of supply defaults to the customer GSTIN state (29)', $('iv-pos').value === '29');
check('same state as the company → CGST + SGST', /CGST \+ SGST/.test($('iv-taxsplit').value), $('iv-taxsplit').value);
check('ship-to fills from the customer despatch address', $('iv-shipaddr').value === 'Gate 2, Hosur Road plant');

$('iv-part').value = 'p1'; change($('iv-part')); await wait(60);
const poOpts = [...$('iv-po').options];
check('the PO dropdown lists both live POs for the customer and part plus a no-PO choice',
  poOpts.filter(o => o.value).length === 2 && poOpts.some(o => !o.value), poOpts.map(o => o.textContent).join(' || '));
check('a superseded PO is never offered', !poOpts.some(o => o.value === 'o-old'));
check('the earliest-due PO with quantity left is pre-selected', $('iv-po').value === 'o-early', $('iv-po').value);
check('the option names the PO date and what is left to invoice', /PO-EARLY/.test(poOpts[0].textContent) && /300 of 300 left/.test(poOpts[0].textContent), poOpts[0].textContent);
check('the hint says several POs are on file', /2 POs are on file/.test($('iv-pohint').textContent));
check('rate comes from the chosen PO, not the price list', $('iv-rate').value === '101.5', $('iv-rate').value);
$('iv-po').value = 'o-late'; change($('iv-po'));
check('choosing the other PO changes the rate to that PO', $('iv-rate').value === '104', $('iv-rate').value);
$('iv-po').value = 'o-early'; change($('iv-po'));
$('iv-qty').value = '120'; $('iv-batch').value = 'B-2291'; $('iv-heat').value = 'H-77'; $('iv-material').value = 'EN8';
$('iv-mfgdate').value = plus(-2); $('iv-inspection').value = 'Approved'; $('iv-boxes').value = 'Box 1–4'; $('iv-challan').value = 'DC-88';
click($('iv-addline')); await wait(60);
check('the line is added', window.document.querySelectorAll('#iv-lines tbody tr').length === 1);
check('header PO No. is pulled from the line', $('iv-custpo').value === 'PO-EARLY', $('iv-custpo').value);
check('header PO date is pulled from the Customer PO', $('iv-custpodate').value === new Date(plus(-20)).toLocaleDateString('en-GB'), $('iv-custpodate').value);
$('iv-part').value = 'p1'; change($('iv-part')); await wait(30);
check('choosing the part again shows 180 left on that PO, counting the line not yet saved', /180 of 300 left/.test($('iv-po').options[0].textContent), $('iv-po').options[0].textContent);
$('iv-part').value = ''; change($('iv-part'));

// second line: the shaft against its schedule
$('iv-part').value = 'p2'; change($('iv-part')); await wait(60);
check('for a schedule, the dropdown offers the schedule before its rate contract',
  $('iv-po').options[0].value === 'sch1' && $('iv-po').options[1].value === 'rc1',
  [...$('iv-po').options].map(o => o.value).join(','));
$('iv-qty').value = '40';
click($('iv-addline')); await wait(60);
check('header shows each PO when the lines are on different POs', $('iv-custpo').value === 'PO-EARLY, RC-9 / Sch. REL-3', $('iv-custpo').value);
check('and the PO date says per line', /per line/.test($('iv-custpodate').value));

// a different currency on the same invoice is refused
$('iv-part').value = 'p1'; change($('iv-part')); await wait(30);
$('iv-po').value = 'o-late'; change($('iv-po'));
$('iv-qty').value = '5'; $('iv-currency').value = 'USD';
click($('iv-addline')); await wait(30);
check('a second currency on one invoice is refused', /one currency/.test($('iv-linemsg').textContent));
$('iv-currency').value = 'INR'; $('iv-qty').value = ''; $('iv-part').value = ''; change($('iv-part'));

// charges
$('iv-discount').value = '180'; $('iv-freight').value = '500'; input($('iv-freight'));
// items: 120 × 101.5 = 12180 ; 40 × 52 = 2080 ; goods 14260 ; taxable 14260 − 180 + 500 = 14580 ; CGST 9% 1312.20 ; SGST 1312.20
check('the on-screen totals show the taxable value with discount and freight in it', /14,580\.00/.test($('iv-totals').textContent), $('iv-totals').textContent);

// an IRN that is not 64 hex characters is refused
$('iv-irn').value = 'abc123';
click($('iv-save')); await wait(120);
check('a malformed IRN is refused', /64 letters and numbers/.test($('iv-msg').textContent), $('iv-msg').textContent);
const IRN = 'a'.repeat(32) + '0123456789abcdef0123456789abcdef';
$('iv-irn').value = IRN; $('iv-ackno').value = '112410000123456'; $('iv-ackdate').value = plus(0) + 'T10:15';
$('iv-einvqr').value = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjQ0NDQwNUM3ODFFNDgyNTA3MkIzNENBNEY4QkRDNjA2Qzg2QjU3MjAiLCJ0eXAiOiJKV1QiLCJ4NXQiOiJSRVFGeDRIa2dsQnlzMHlrLUwzR0JzaHJWeUEifQ.' + 'x'.repeat(600);
$('ivs-upi').value = 'workstest@okbank'; $('ivs-jur').value = 'Mysuru'; $('ivs-copies').value = '3';
click($('ivs-save')); await wait(80);
check('invoice settings are saved to the database', settingsStore.invoice_settings && settingsStore.invoice_settings.upi === 'workstest@okbank');
printed = [];
click($('iv-save')); await wait(400);
check('the invoice is saved', invoices.length === 1, $('iv-msg').textContent);
const inv = invoices[0] ? invoices[0].data : {};
check('each line carries the PO it was raised against', inv.lines && inv.lines[0].poDocId === 'o-early' && inv.lines[0].po === 'PO-EARLY');
check('the schedule line carries its contract and release', inv.lines && inv.lines[1].po === 'RC-9 / Sch. REL-3');
check('taxable value = goods − discount + freight', inv.subtotal === 14580, inv.subtotal);
check('CGST and SGST are 9% each of the taxable value', inv.cgstValue === 1312.2 && inv.sgstValue === 1312.2, inv.cgstValue + ' ' + inv.sgstValue);
check('grand total adds up', inv.totalValue === 17204.4, inv.totalValue);
check('tax is summarised per HSN code and the rows add up to the total',
  inv.hsnSummary && inv.hsnSummary.length === 2 &&
  Math.round(inv.hsnSummary.reduce((t, r) => t + r.taxable, 0) * 100) / 100 === 14580);
check('customer PAN is taken from the GSTIN', inv.pan === 'AABCA1234F', inv.pan);
check('the e-invoice details are kept', inv.einvoice && inv.einvoice.irn === IRN && inv.einvoice.ackNo === '112410000123456');

const doc = printed.join('');
check('the invoice document opened for printing', doc.length > 1000);
const need = ['TAX INVOICE', 'Invoice Details', 'Customer PO No.', 'PO Date', 'Payment Terms', 'Due Date', 'Place of Supply',
  'State Code', 'Reverse Charge', 'Currency', 'E-Invoice Details', 'IRN', 'Ack. No.', 'Ack. Date', 'Bill To', 'Customer Code',
  'Ship To', 'Delivery Location', 'Item / Product Details', 'Drawing No. / Rev.', 'HSN/SAC', 'UOM', 'Taxable Value',
  'Tax Details', 'CGST %', 'SGST Amount', 'IGST Amount', 'Cess', 'Totals', 'Total Quantity', 'Total Discount', 'Freight',
  'Packing / Forwarding', 'Other Charges', 'SGST / UTGST', 'GRAND TOTAL', 'Amount in Words',
  'Manufacturing / Traceability Details', 'Batch / Lot No.', 'Heat No.', 'Material Grade', 'Manufacturing Date',
  'Inspection Status', 'Packing / Box No.', 'Delivery Challan No.', 'Bank / Payment Details', 'IFSC', 'UPI ID',
  'Terms &amp; Conditions', 'Declaration', 'Authorised Signatory', 'Designation', 'Place', 'computer-generated Tax Invoice',
  'Thank you for your business'];
const missing = need.filter(k => !doc.includes(k));
check('every section and field of the tax-invoice format is on the document', !missing.length, missing.join(', '));
check('company state and state code are on the letterhead', /State: Karnataka/.test(doc) && /State Code: 29/.test(doc));
check('company PAN is worked out from its GSTIN when not entered', /AAACW1234F/.test(doc));
check('company website is on the letterhead', /Website: works\.example/.test(doc));
check('amount in words is in Indian rupees', /Indian Rupees Seventeen Thousand Two Hundred Four and Forty Paise Only/.test(doc));
check('the PO number per line is printed when lines are on different POs', /PO RC-9 \/ Sch\. REL-3/.test(doc));
check('traceability values are printed', /B-2291/.test(doc) && /H-77/.test(doc) && /EN8/.test(doc) && /DC-88/.test(doc));
check('the jurisdiction term is added from the settings', /jurisdiction of Mysuru/.test(doc));
check('three copies print when set: original, duplicate, triplicate',
  /Original for Recipient/.test(doc) && /Duplicate for Transporter/.test(doc) && /Triplicate for Supplier/.test(doc));
check('an e-invoice QR and a UPI QR are drawn in the page (no outside QR service)',
  (doc.match(/aria-label="e-invoice QR code"/g) || []).length === 3 && (doc.match(/aria-label="UPI payment QR code"/g) || []).length === 3 &&
  !/qrserver|googleapis/.test(doc));
check('every table cell has a border and long values wrap inside it',
  /th,td\{border:\.7pt solid #000/.test(doc) && /table-layout:fixed/.test(doc) && /overflow-wrap:anywhere/.test(doc));
fs.writeFileSync('/tmp/invoice-print.html', doc);

check('after saving, the PO dropdown knows 120 were invoiced on PO-EARLY', (() => {
  $('iv-cust').value = 'c1'; change($('iv-cust'));
  $('iv-part').value = 'p1'; change($('iv-part'));
  return /180 of 300 left/.test($('iv-po').options[0].textContent);
})(), $('iv-po').options[0] && $('iv-po').options[0].textContent);

// an old invoice saved before the full layout still prints
printed = [];
window.eval(''); // no-op
const oldInv = { doc_id: 'old', data: { invoiceNo: 'INV-OLD', invoiceDate: plus(-40), customerName: 'Alpha Motors', gstin: '29AABCA1234F1Z5',
  currency: 'INR', sameState: true, taxPct: 18, subtotal: 1000, totalValue: 1180,
  lines: [{ partNo: 'PART-100', partName: 'Bracket', qty: 10, rate: 100, value: 1000, hsn: '87089900' }] } };
invoices.push(oldInv);
go('sales_plan'); await wait(200); go('sales_invoice'); await wait(400);
const reprint = [...window.document.querySelectorAll('.iv-reprint')].find(b => b.dataset.id === 'old');
click(reprint); await wait(200);
check('an invoice saved before these fields existed still prints, with its tax worked out',
  printed.join('').includes('INV-OLD') && /1,180\.00/.test(printed.join('')));

if (process.env.STRESS) {
  const long = 'Precision Machined Steering Knuckle Housing Assembly with Integrated Bearing Seat and Anti-Rotation Feature';
  const stressLines = Array.from({ length: 6 }, (_, i) => ({ partNo: 'PART-00000' + i, partName: long,
    custPartNo: 'CUSTPARTNUMBER-VERY-LONG-00' + i + '-REV-XYZ', custPartName: long + ' ' + i, hsn: '8708' + (9900 + i),
    drawingNo: 'DRG-ABCDEFGHIJKLMNOP-00' + i, drawingRev: 'AB12', uom: 'Nos', qty: 123456.789, rate: 98765.43,
    value: 12193263111.11, po: 'RC-4500012345678 / Sch. RELEASE-000' + i, poDate: plus(-3),
    batch: 'BATCH-2026-09-LONGLOT-NUMBER-' + i, heat: 'HEAT-99887766554433', material: 'EN19 / 42CrMo4 QT hardened and tempered',
    mfgDate: plus(-1), inspection: 'Accepted under deviation', boxes: 'Boxes 1 to 250 of consignment 77/2026', challan: 'DC-2026-000123456' }));
  invoices.push({ doc_id: 'stress', data: { invoiceNo: 'INV-STRESS-2026-000001', invoiceDate: plus(0), dueDate: plus(90),
    customerName: 'Very Long Customer Name International Automotive Components Private Limited (Unit 3)', customerCode: 'CUST-LONG-CODE-000123',
    gstin: '', billingAddress: 'Survey No. 123/4A, Phase III, Industrial Development Area, Near Railway Overbridge, Some Very Long Locality Name, Chennai 600058',
    contact: 'Mr. Venkatanarasimharajuvaripeta Subramanian', phone: '+91 98765 43210, +91 44 1234 5678', email: 'purchase.department.very.long.address@customer-example.co.in',
    currency: 'USD', custPo: 'RC-4500012345678 / Sch. RELEASE-0000, RC-4500012345678 / Sch. RELEASE-0001', paymentTerms: '90 days from date of receipt of material at plant',
    placeOfSupply: 'Other Countries', placeOfSupplyCode: '96', reverseCharge: 'No', sameState: false, lines: stressLines,
    einvoice: { irn: 'f'.repeat(64), ackNo: '112410000123456789', ackDate: plus(0) + 'T23:59', signedQr: 'x'.repeat(1800) } } });
  go('sales_plan'); await wait(200); go('sales_invoice'); await wait(400);
  printed = [];
  click([...window.document.querySelectorAll('.iv-reprint')].find(b => b.dataset.id === 'stress')); await wait(300);
  fs.writeFileSync('/tmp/invoice-stress.html', printed.join(''));
}
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

let pass = 0;
for (const [n, ok, x] of results) { console.log((ok ? '  ok ' : '  x  ') + n + (ok ? '' : '   [' + x + ']')); if (ok) pass++; }
console.log(`\n${pass} passed, ${results.length - pass} failed, of ${results.length}`);
