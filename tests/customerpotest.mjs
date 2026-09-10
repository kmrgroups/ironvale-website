/* Tests for Customer PO's three shapes and the Sales Plan they now compute,
   rather than being hand-typed:
     - a One-time PO carries its own quantity, price and delivery date
     - a Rate Contract PO carries only the part and price, no quantity/date
     - a Schedule is raised against a Rate Contract and MUST take its part
       identity and price from that contract, not from what is typed
     - the Sales Plan register sums real POs/schedules due in a month, and
       only falls back to a manually entered forecast when neither exists
     - an order saved before PO types existed (no poType at all) still counts
       as demand, so deploying this does not make existing POs vanish */
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
let custParts = [{ doc_id: 'cp1', doc_no: 'ALPHA-BR-9', data: {
  partId: 'p1', internalNo: 'PART-100', customerId: 'c1', customerName: 'Alpha Motors',
  custPartNo: 'ALPHA-BR-9', custPartName: 'Bracket Assy 9', price: 0, currency: 'INR' } }];
// A part needs an existing customer/part price link before a PO can be raised
// against it — that is already how the app worked; the link just needs to
// exist here the way a user would have created it on the Parts screen first.
let orders = [];
let salesPlans = [];
let invoices = [];
let idSeq = 1;

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
    if (opts.method === 'POST' && body.what === 'docs') {
      const id = 'd' + (idSeq++);
      const rec = { doc_id: id, doc_no: body.doc.docNo, data: body.doc.data };
      if (body.doc.kind === 'order') orders.push(rec);
      if (body.doc.kind === 'cust_part') custParts.push(rec);
      if (body.doc.kind === 'salesplan') salesPlans.push(rec);
      return ok({ docId: id });
    }
    if (url.includes('what=docNumber') || body.what === 'docNumber')
      return ok({ number: 'AUTO-' + (idSeq++) });
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
const change = el => el && el.dispatchEvent(new window.Event('change', { bubbles: true }));

await wait(150);
$('g-user').value = 'tester'; $('g-pass').value = 'password1';
click($('g-go')); await wait(300);

// ---- reached from the menu under its new name ----
const live = [...window.document.querySelectorAll('#menubar a[data-s]')].map(a => a.dataset.s);
check('Order Book is now labelled Customer PO', 
  [...window.document.querySelectorAll('#menubar a[data-s="sales_plan"]')][0].textContent.includes('Customer PO'));

click([...window.document.querySelectorAll('#menubar a[data-s]')].find(a => a.dataset.s === 'sales_plan'));
await wait(250);
check('the PO Type selector exists', !!$('so-potype'));
check('one-time is the default', $('so-potype').value === 'onetime');

// ---- 1. Rate Contract PO ----
$('so-potype').value = 'ratecontract'; change($('so-potype')); await wait(60);
check('quantity is hidden for a rate contract', $('so-qtywrap').style.display === 'none');
check('validity fields appear for a rate contract', $('so-validitywrap').style.display !== 'none');

$('so-cust').value = 'c1'; change($('so-cust')); await wait(60);
$('so-part').value = 'p1'; change($('so-part')); await wait(60);
$('so-po').value = 'RC-001';
$('so-custpartno').value = 'ALPHA-BR-9';
$('so-custpartname').value = 'Bracket Assy 9';
$('so-price').value = '250';
click($('so-save')); await wait(200);
check('the rate contract is saved with no quantity', orders.length === 1 && orders[0] && orders[0].data.qty === 0);
check('and with poType recorded', orders[0] && orders[0].data.poType === 'ratecontract');
const contractId = orders[0] ? orders[0].doc_id : null;

// ---- 2. Schedule against that contract ----
$('so-potype').value = 'schedule'; change($('so-potype')); await wait(60);
check('the contract dropdown offers the rate contract just created',
  [...$('so-contract').options].some(o => o.value === contractId));
$('so-cust').value = 'c1'; change($('so-cust')); await wait(60);
$('so-contract').value = contractId; change($('so-contract')); await wait(100);

check('customer part no. is pulled from the contract, not typed', $('so-custpartno').value === 'ALPHA-BR-9');
check('customer part name is pulled from the contract', $('so-custpartname').value === 'Bracket Assy 9');
check('price is pulled from the contract', $('so-price').value === '250');
check('those fields are locked, not editable', $('so-custpartno').readOnly && $('so-price').readOnly);

$('so-po').value = 'REL-01';
$('so-qty').value = '400';
$('so-due').value = thisMonth + '-20';
click($('so-save')); await wait(200);
check('the schedule is saved', orders.length === 2);
const sched = orders.find(o => o.data.poType === 'schedule');
check('with the contract price carried over, not retyped', sched && sched.data.price === 250);
check('and a reference back to the contract PO', sched && sched.data.scheduleAgainstPo === 'RC-001');

// ---- 3. a One-time PO for the same customer/part, different month ----
$('so-potype').value = 'onetime'; change($('so-potype')); await wait(60);
$('so-cust').value = 'c1'; change($('so-cust')); await wait(60);
$('so-part').value = 'p1'; change($('so-part')); await wait(60);
$('so-po').value = 'OT-001';
$('so-qty').value = '100';
$('so-price').value = '260';
$('so-due').value = thisMonth + '-10';
click($('so-save')); await wait(200);
check('the one-time PO is saved too', orders.length === 3);

// ---- Sales Plan should now show computed demand for this month: 400 + 100 = 500 ----
click([...window.document.querySelectorAll('#menubar a[data-s]')].find(a => a.dataset.s === 'sales_monthly_plan'));
await wait(250);
$('spm-filter-month').value = thisMonth; $('spm-filter-cust').value = '';
click($('spm-refresh')); await wait(150);

check('demand quantity is the schedule + the one-time PO, added automatically',
  /500/.test(txt($('spm-list'))), txt($('spm-list')).slice(0, 300));
check('customer part no. shows on the computed plan line', /ALPHA-BR-9/.test(txt($('spm-list'))));
check('customer part name shows on the computed plan line', /Bracket Assy 9/.test(txt($('spm-list'))));

// ---- a forecast is refused once a real PO covers that month ----
$('spm-cust').value = 'c1'; change($('spm-cust')); await wait(60);
$('spm-part').value = 'p1'; change($('spm-part')); await wait(60);
$('spm-month').value = thisMonth;
$('spm-firm').value = '999';
click($('spm-save')); await wait(150);
check('a forecast is refused when real demand already exists this month',
  /already a real Customer PO/i.test(txt($('spm-msg'))));
check('and nothing extra was saved', salesPlans.length === 0);

// ---- but a forecast for a month with no PO is accepted ----
const futureMonth = (() => { const d = new Date(); d.setMonth(d.getMonth() + 6);
  return d.toISOString().slice(0,7); })();
$('spm-month').value = futureMonth;
$('spm-firm').value = '80';
click($('spm-save')); await wait(150);
check('a forecast for a month with no PO is accepted', salesPlans.length === 1);

$('spm-filter-month').value = futureMonth;
click($('spm-refresh')); await wait(150);
check('the forecast appears in the register, marked as a forecast',
  /80/.test(txt($('spm-list'))) && /forecast/i.test(txt($('spm-list'))));

// ---- backward compatibility: an order with no poType at all still counts ----
orders.push({ doc_id: 'legacy1', doc_no: 'PO-OLD', data: {
  customerId: 'c1', customerName: 'Alpha Motors', partId: 'p1', partNo: 'PART-100', partName: 'Bracket',
  po: 'PO-OLD', qty: 50, price: 240, currency: 'INR', due: thisMonth + '-05' } });
$('spm-filter-month').value = thisMonth;
click($('spm-refresh')); await wait(150);
check('an order saved before PO types existed still counts as demand (500 + 50 = 550)',
  /550/.test(txt($('spm-list'))), txt($('spm-list')).slice(0, 300));

check('no page errors', pageErrors.length === 0, pageErrors.slice(0,3).join(' | '));
let pass = 0;
results.forEach(([n, c, x]) => { if (c) { pass++; console.log('  ok ' + n); } else console.log('  x ' + n + '   [' + x + ']'); });
console.log(`\n${pass} passed, ${results.length - pass} failed, of ${results.length}`);
process.exit(0);
