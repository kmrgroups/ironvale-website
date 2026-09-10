/* Tests for the edit/delete provisions added to Customer PO and Sales Plan:
     - Customer PO: an Edit button that loads a PO/contract/schedule back into
       the same form saveOrder() validates against, and saves as an update
       rather than a duplicate
     - Sales Plan: each computed row backed by real POs can be expanded to
       show, edit and remove the records behind it; a forecast-backed row can
       have its forecast removed the same way */
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
window.prompt = () => 'testing';
let signedIn = false;

const thisMonth = new Date().toISOString().slice(0,7);
const customers = [{ doc_id: 'c1', doc_no: 'CUST-1', data: { name: 'Alpha Motors' } }];
const parts = [{ part_id: 'p1', part_no: 'PART-100', part_name: 'Bracket', lifecycle: 'Series', data: {} }];
const custParts = [{ doc_id: 'cp1', doc_no: 'ALPHA-BR-9', data: {
  partId: 'p1', internalNo: 'PART-100', customerId: 'c1', customerName: 'Alpha Motors',
  custPartNo: 'ALPHA-BR-9', custPartName: 'Bracket Assy 9', price: 100, currency: 'INR' } }];
let orders = [{ doc_id: 'o1', doc_no: 'OT-01', data: {
  customerId: 'c1', customerName: 'Alpha Motors', partId: 'p1', partNo: 'PART-100', partName: 'Bracket',
  custPartNo: 'ALPHA-BR-9', custPartName: 'Bracket Assy 9', poType: 'onetime',
  po: 'OT-01', qty: 200, price: 100, currency: 'INR', poValue: 20000, due: thisMonth + '-10' } }];
let salesPlans = [];
let patched = [];

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
    if (url.includes('kind=invoice')) return ok({ docs: [] });
    if (url.includes('what=docs') && opts.method !== 'POST') return ok({ docs: [] });
    if (opts.method === 'PATCH' && body.what === 'docs') {
      patched.push(body);
      if (body.remove) {
        orders = orders.filter(o => o.doc_id !== body.docId);
        salesPlans = salesPlans.filter(p => p.doc_id !== body.docId);
      }
      return ok({});
    }
    if (opts.method === 'POST' && body.what === 'docs') {
      if (body.doc.docId) {
        const idx = orders.findIndex(o => o.doc_id === body.doc.docId);
        if (idx >= 0) { orders[idx] = { doc_id: body.doc.docId, doc_no: body.doc.docNo, data: body.doc.data }; return ok({ docId: body.doc.docId }); }
      }
      const id = 'new-' + Math.random().toString(36).slice(2,7);
      if (body.doc.kind === 'order') orders.push({ doc_id: id, doc_no: body.doc.docNo, data: body.doc.data });
      if (body.doc.kind === 'salesplan') salesPlans.push({ doc_id: id, doc_no: body.doc.docNo, data: body.doc.data });
      return ok({ docId: id });
    }
    if (url.includes('what=docNumber') || body.what === 'docNumber') return ok({ number: 'AUTO-1' });
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

// ================= Customer PO edit =================
click([...window.document.querySelectorAll('#menubar a[data-s]')].find(a => a.dataset.s === 'sales_plan'));
await wait(250);

check('an Edit button exists per order', /Edit/.test(txt($('so-list'))));
click(window.document.querySelector('.so-edit'));
await wait(250);

check('the form fills with the existing PO', $('so-po').value === 'OT-01' && $('so-qty').value === '200');
check('the save button now says Update PO', $('so-save').textContent === 'Update PO');
check('a Cancel edit button appears', $('so-cancel-edit').style.display !== 'none');

$('so-qty').value = '250';
click($('so-save')); await wait(250);
check('the same order was updated, not duplicated', orders.length === 1);
check('with the new quantity', orders[0].data.qty === 250);
check('the save button reverts after saving', $('so-save').textContent === 'Add PO');

// Cancel edit works too
click(window.document.querySelector('.so-edit'));
await wait(200);
click($('so-cancel-edit'));
await wait(60);
check('Cancel edit reverts the button label', $('so-save').textContent === 'Add PO');
check('and clears the form', $('so-po').value === '');

// ================= Sales Plan manage row =================
click([...window.document.querySelectorAll('#menubar a[data-s]')].find(a => a.dataset.s === 'sales_monthly_plan'));
await wait(250);
$('spm-filter-month').value = thisMonth;
click($('spm-refresh')); await wait(200);

check('a Manage button appears for a PO-backed row', /Manage/.test(txt($('spm-list'))));
click(window.document.querySelector('.spm-manage'));
await wait(150);
const manageRow = window.document.querySelector('.spm-managerow');
check('expanding Manage shows the underlying PO', manageRow && manageRow.style.display !== 'none' &&
  /OT-01/.test(txt(manageRow)));
check('an Edit link is offered for that PO', !!manageRow.querySelector('.spm-editorder'));
check('a Remove link is offered for that PO', !!manageRow.querySelector('.spm-delorder'));

click(manageRow.querySelector('.spm-delorder'));
await wait(250);
check('removing the order from Sales Plan actually removes it', orders.length === 0);
check('with a reason recorded', patched.some(p => p.remove && /order removed/.test(p.reason || '')));

// ================= Sales Plan: a forecast-backed row can be removed too =================
salesPlans.push({ doc_id: 'sp1', doc_no: 'SP-1', data: {
  customerId: 'c1', customerName: 'Alpha Motors', partId: 'p1', partNo: 'PART-100', partName: 'Bracket',
  custPartNo: 'ALPHA-BR-9', custPartName: 'Bracket Assy 9', month: thisMonth, firmQty: 40 } });
// re-navigate so the panel actually refetches salesPlans from the server,
// rather than just redrawing whatever it already had in memory
click([...window.document.querySelectorAll('#menubar a[data-s]')].find(a => a.dataset.s === 'sales_plan'));
await wait(150);
click([...window.document.querySelectorAll('#menubar a[data-s]')].find(a => a.dataset.s === 'sales_monthly_plan'));
await wait(250);
$('spm-filter-month').value = thisMonth;
click($('spm-refresh')); await wait(200);
check('the forecast-backed row also offers Manage', /Manage/.test(txt($('spm-list'))));
click(window.document.querySelector('.spm-manage'));
await wait(150);
const manageRow2 = window.document.querySelector('.spm-managerow');
check('the forecast is explained as not yet backed by a real PO', manageRow2 && /not yet backed/i.test(txt(manageRow2)));
click(manageRow2.querySelector('.spm-delforecast'));
await wait(250);
check('removing the forecast actually removes it', salesPlans.length === 0);

check('no page errors', pageErrors.length === 0, pageErrors.slice(0,3).join(' | '));
let pass = 0;
results.forEach(([n, c, x]) => { if (c) { pass++; console.log('  ok ' + n); } else console.log('  x ' + n + '   [' + x + ']'); });
console.log(`\n${pass} passed, ${results.length - pass} failed, of ${results.length}`);
process.exit(0);
