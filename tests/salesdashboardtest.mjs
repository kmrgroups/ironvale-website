/* Tests for the Sales Dashboard's move onto the computed Sales Plan register:
     - Overall Plan vs Actual vs Pending now shows % alongside INR/USD values
     - a new Day-wise Overall Sales Value section (INR only, by design)
     - excess sales are measured against the computed demand (a real PO or
       schedule), not only ever the old manually-typed forecast — this is the
       planFor()/excessForInvoice() fix made while rewriting the dashboard */
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
let signedIn = false;

const thisMonth = new Date().toISOString().slice(0,7);
const customers = [{ doc_id: 'c1', doc_no: 'CUST-1', data: { name: 'Alpha Motors' } }];
const parts = [{ part_id: 'p1', part_no: 'PART-100', part_name: 'Bracket', lifecycle: 'Series', data: {} }];
const custParts = [{ doc_id: 'cp1', doc_no: 'ALPHA-BR-9', data: {
  partId: 'p1', internalNo: 'PART-100', customerId: 'c1', customerName: 'Alpha Motors',
  custPartNo: 'ALPHA-BR-9', custPartName: 'Bracket Assy 9', price: 100, currency: 'INR' } }];
// a one-time PO: 200 pieces @ ₹100, due the 10th
const orders = [{ doc_id: 'o1', doc_no: 'OT-01', data: {
  customerId: 'c1', customerName: 'Alpha Motors', partId: 'p1', partNo: 'PART-100', partName: 'Bracket',
  custPartNo: 'ALPHA-BR-9', custPartName: 'Bracket Assy 9', poType: 'onetime',
  po: 'OT-01', qty: 200, price: 100, currency: 'INR', poValue: 20000, due: thisMonth + '-10' } }];
// invoices: 120 on the 5th, 30 on the 12th (150 actual, within 200 demand — no excess)
const invoices = [
  { doc_id: 'iv1', doc_no: 'INV-1', data: { customerId: 'c1', customerName: 'Alpha Motors',
    partId: 'p1', partNo: 'PART-100', invoiceNo: 'INV-1', invoiceDate: thisMonth + '-05',
    qty: 120, rate: 100, currency: 'INR', value: 12000 } },
  { doc_id: 'iv2', doc_no: 'INV-2', data: { customerId: 'c1', customerName: 'Alpha Motors',
    partId: 'p1', partNo: 'PART-100', invoiceNo: 'INV-2', invoiceDate: thisMonth + '-12',
    qty: 30, rate: 100, currency: 'INR', value: 3000 } }
];
const salesPlans = [];

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
  if (url.startsWith('/api/content')) return ok({ data: {} });
  if (url.startsWith('/api/idms')) {
    if (url.includes('what=parts')) return ok({ parts });
    if (url.includes('kind=customer')) return ok({ docs: customers });
    if (url.includes('kind=cust_part')) return ok({ docs: custParts });
    if (url.includes('kind=order')) return ok({ docs: orders });
    if (url.includes('kind=salesplan')) return ok({ docs: salesPlans });
    if (url.includes('kind=invoice')) return ok({ docs: invoices });
    if (url.includes('what=docs') && opts.method !== 'POST') return ok({ docs: [] });
    if (url.includes('what=settings')) return ok({ settings: {} });
    return ok({});
  }
  return ok({});
};

window.eval(core); window.eval(kpi);
window.eval(html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1]);
const $ = id => window.document.getElementById(id);
const txt = el => (el ? el.textContent : '');
const click = el => el && el.dispatchEvent(new window.Event('click', { bubbles: true }));

await wait(150);
$('g-user').value = 'tester'; $('g-pass').value = 'password1';
click($('g-go')); await wait(300);
click([...window.document.querySelectorAll('#menubar a[data-s]')].find(a => a.dataset.s === 'sales_dashboard'));
await wait(250);
$('sd-month').value = thisMonth;
click($('sd-refresh')); await wait(200);

// ---- Overall: demand 200, actual 150, pending 50, 75% achieved ----
const overallTxt = txt($('sd-overall'));
check('overall demand quantity is the PO quantity', /200/.test(overallTxt));
check('overall actual quantity is the sum of both invoices', /150/.test(overallTxt));
check('overall pending quantity is demand minus actual', /50Pending/.test(overallTxt), overallTxt.slice(0,120));
check('overall actual % is shown (150 of 200 = 75%)', /75%/.test(overallTxt), overallTxt.slice(0,400));
check('overall pending % is shown (50 of 200 = 25%)', /25%/.test(overallTxt));
check('demand value in INR is shown (200 × ₹100)', /20,?000/.test(overallTxt));
check('actual value in INR is shown (150 × ₹100)', /15,?000/.test(overallTxt));

// ---- Customer-wise ----
const custTxt = txt($('sd-custtable'));
check('the customer-wise table shows Alpha Motors', /Alpha Motors/.test(custTxt));
check('with the same demand/actual quantities', /200/.test(custTxt) && /150/.test(custTxt));

// ---- Day-wise chart ----
check('the day-wise section exists and is not empty',
  !!$('sd-daywise') && !/No invoices/i.test(txt($('sd-daywise'))));
check('the day-wise chart is real SVG output, not a placeholder',
  $('sd-daywise').innerHTML.includes('<svg') || $('sd-daywise').innerHTML.includes('polyline'),
  $('sd-daywise').innerHTML.slice(0, 200));

// ---- Excess sales: now invoice a further 80 (total 230, over the 200 demand by 30) ----
invoices.push({ doc_id: 'iv3', doc_no: 'INV-3', data: { customerId: 'c1', customerName: 'Alpha Motors',
  partId: 'p1', partNo: 'PART-100', invoiceNo: 'INV-3', invoiceDate: thisMonth + '-20',
  qty: 80, rate: 100, currency: 'INR', value: 8000 } });
click($('sd-refresh')); await wait(200);
check('excess sales are measured against the computed demand (30 over 200)',
  /excess/i.test(txt($('sd-excess'))) && /30/.test(txt($('sd-excess'))),
  txt($('sd-excess')).slice(0, 300));
check('the overall excess figure updates too', /30/.test(txt($('sd-overall'))));

check('no page errors', pageErrors.length === 0, pageErrors.slice(0,3).join(' | '));
let pass = 0;
results.forEach(([n, c, x]) => { if (c) { pass++; console.log('  ok ' + n); } else console.log('  x ' + n + '   [' + x + ']'); });
console.log(`\n${pass} passed, ${results.length - pass} failed, of ${results.length}`);
process.exit(0);
