/* Bulk upload of Customer POs and Sales Plan forecasts, reached from the
   Masters menu.
     - both open the one Bulk Upload screen with their category chosen
     - a rate contract and a schedule against it can arrive in the same file
     - the Customer PO screen's own refusals apply row by row: unknown
       customer, part not linked, a schedule that brings its own price, a PO
       number already on file, a delivery date before the PO date
     - a forecast is refused for a month a real PO or a tentative already
       covers, and for a month already over
     - DD-MM-YYYY dates are read day first */
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

const now = new Date();
const mk = (y, m) => y + '-' + String(m + 1).padStart(2, '0');
const monthPlus = k => { const d = new Date(now.getFullYear(), now.getMonth() + k, 1); return mk(d.getFullYear(), d.getMonth()); };
const ddmmyyyy = ym => '15-' + ym.slice(5, 7) + '-' + ym.slice(0, 4);

const customers = [{ doc_id: 'c1', doc_no: 'ALPH-001', data: { name: 'Alpha Motors', code: 'ALPH-001' } }];
const parts = [{ part_id: 'p1', part_no: 'PART-100', part_name: 'Bracket', data: {} },
               { part_id: 'p2', part_no: 'PART-200', part_name: 'Shaft', data: {} },
               { part_id: 'p3', part_no: 'PART-300', part_name: 'Not linked', data: {} }];
const custParts = [
  { doc_id: 'cp1', data: { partId: 'p1', internalNo: 'PART-100', customerId: 'c1', custPartNo: 'AL-BR-9', custPartName: 'Bracket Assy', price: 100 } },
  { doc_id: 'cp2', data: { partId: 'p2', internalNo: 'PART-200', customerId: 'c1', custPartNo: 'AL-SH-1', custPartName: 'Drive Shaft', price: 50 } }];
let orders = [{ doc_id: 'o1', data: { customerId: 'c1', partId: 'p1', poType: 'onetime', po: 'PO-EXISTING', qty: 100, price: 100,
  due: monthPlus(1) + '-10', tent1: 80, tent2: 0 } }];
let salesPlans = [{ doc_id: 'sp1', data: { customerId: 'c1', partId: 'p2', month: monthPlus(4), firmQty: 10 } }];
let saved = [];
let idSeq = 1;

window.fetch = async (path, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : {};
  const url = String(path);
  const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
  if (url.startsWith('/api/auth')) {
    if (body.action === 'login') { signedIn = true; return ok({ token: 'T', user: 'tester', role: 'developer' }); }
    if (body.action === 'session') return ok({ user: 'tester', role: 'developer' });
    return ok({});
  }
  if (url.startsWith('/api/content')) return ok({ data: {} });
  if (url.startsWith('/api/idms')) {
    if (url.includes('what=parts')) return ok({ parts });
    if (url.includes('kind=customer')) return ok({ docs: customers });
    if (url.includes('kind=cust_part')) return ok({ docs: custParts });
    if (url.includes('kind=order')) return ok({ docs: orders });
    if (url.includes('kind=salesplan')) return ok({ docs: salesPlans });
    if (url.includes('what=settings')) return ok({ settings: {} });
    if (url.includes('what=docs') && opts.method !== 'POST') return ok({ docs: [] });
    if (opts.method === 'POST' && body.what === 'docs') {
      const id = 'n' + (idSeq++);
      saved.push({ doc_id: id, kind: body.doc.kind, data: body.doc.data });
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
const go = s => click([...window.document.querySelectorAll('#menubar a[data-s]')].find(a => a.dataset.s === s));

async function upload(csv){
  const file = new window.File([csv], 'upload.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: async () => csv });
  Object.defineProperty($('bu-file'), 'files', { value: [file], configurable: true });
  $('bu-file').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(250);
  return [...$('bu-preview').querySelectorAll('tbody tr')];
}
const rowErrors = () => [...$('bu-preview').querySelectorAll('.bu-row-err')].map(e => e.textContent);

await wait(150);
$('g-user').value = 'tester'; $('g-pass').value = 'password1';
click($('g-go')); await wait(300);

const masters = [...window.document.querySelectorAll('.mgroup')].find(g => /Masters/.test(g.textContent));
check('Masters has a Customer PO bulk upload entry', !!masters && !!masters.querySelector('a[data-s="bulk_po"]'));
check('Masters has a Sales Plan bulk upload entry', !!masters && !!masters.querySelector('a[data-s="bulk_salesplan"]'));

go('bulk_po'); await wait(200);
check('it opens the Bulk Upload screen', window.document.querySelector('.panel.on') && window.document.querySelector('.panel.on').dataset.panel === 'bulk_upload');
check('with Customer PO already chosen', $('bu-kind').value === 'order', $('bu-kind').value);
check('the column notes are shown (dates are DD-MM-YYYY)', /DD-MM-YYYY/.test($('bu-kindhint').textContent));

const M1 = monthPlus(1), M2 = monthPlus(2);
const csv = [
  'POType*,Customer*,PartNo,PONumber*,PODate,Quantity,Price,Currency,DeliveryDate,ValidFrom,ValidTo,AgainstRateContract,TentativeQty1,TentativeQty2',
  `Rate Contract,Alpha Motors,AL-SH-1,RC-NEW,01-04-2026,,52.50,INR,,01-04-2026,,,,`,                 // 1 ok
  `Schedule,ALPH-001,,REL-1,,300,,,${ddmmyyyy(M1)},,,RC-NEW,120,`,                                     // 2 ok, against row 1
  `One-time,Alpha Motors,PART-100,PO-777,02-09-2026,500,101.25,INR,${ddmmyyyy(M2)},,,,200,150`,         // 3 ok, by internal no.
  `One-time,Nobody Ltd,PART-100,PO-1,,10,5,,${ddmmyyyy(M1)},,,,,`,                                     // 4 unknown customer
  `One-time,Alpha Motors,PART-300,PO-2,,10,5,,${ddmmyyyy(M1)},,,,,`,                                   // 5 part not linked
  `Schedule,Alpha Motors,,REL-2,,50,60,,${ddmmyyyy(M1)},,,RC-NEW,,`,                                   // 6 schedule with its own price
  `One-time,Alpha Motors,PART-100,PO-EXISTING,,10,100,,${ddmmyyyy(M1)},,,,,`,                          // 7 already on file
  `One-time,Alpha Motors,PART-100,PO-3,20-09-2026,10,100,,10-09-2026,,,,,`,                            // 8 delivery before PO date
  `One-time,Alpha Motors,PART-100,PO-4,31-02-2026,10,100,,${ddmmyyyy(M1)},,,,,`,                       // 9 impossible date
  `Rate Contract,Alpha Motors,AL-SH-1,RC-2,,5,52,,,,,,,`,                                              // 10 RC with a quantity
  `One-time,Alpha Motors,PART-100,PO-777,02-09-2026,500,101.25,INR,${ddmmyyyy(M2)},,,,,`               // 11 repeated in file
].join('\n');
const rows = await upload(csv);
const errs = rowErrors().join(' | ');
const summary = $('bu-preview').querySelector('.bu-summary').textContent;
check('three rows are ready and eight need fixing', /3\s*ready/.test(summary) && /8\s*need fixing/.test(summary), summary);
check('an unknown customer is named', /No customer named or coded "Nobody Ltd"/.test(errs));
check('a part not linked to the customer is refused', /PART-300" is not linked to Alpha Motors/.test(errs));
check('a schedule bringing its own price is refused', /takes its price from the contract \(52\.50\)/.test(errs), errs);
check('a PO number already on file is refused', /PO PO-EXISTING already exists for this part/.test(errs));
check('a delivery date before the PO date is refused', /delivery date is before the PO date/.test(errs));
check('an impossible date is refused, not rolled into March', /PO date "31-02-2026" is not a date/.test(errs));
check('a rate contract with a quantity is refused', /rate contract carries no quantity/.test(errs));
check('a row repeated in the same file is caught', /Repeated within this file/.test(errs));

click($('bu-import')); await wait(400);
const po = saved.filter(s => s.kind === 'order');
check('three POs are imported', po.length === 3, po.length);
const rc = po.find(s => s.data.po === 'RC-NEW'), sch = po.find(s => s.data.po === 'REL-1'), ot = po.find(s => s.data.po === 'PO-777');
check('the rate contract has no quantity and no delivery date', rc && rc.data.poType === 'ratecontract' && rc.data.qty === 0 && rc.data.due === '');
check('the schedule points at the contract imported just before it', sch && rc && sch.data.scheduleAgainst === rc.doc_id && sch.data.scheduleAgainstPo === 'RC-NEW');
check('and takes the contract price', sch && sch.data.price === 52.5);
check('the part came from the contract', sch && sch.data.partId === 'p2' && sch.data.custPartNo === 'AL-SH-1');
check('DD-MM-YYYY is read day first', ot && ot.data.orderedOn === '2026-09-02' && ot.data.due === M2 + '-15', ot && (ot.data.orderedOn + ' ' + ot.data.due));
check('value and tentatives are saved like the screen saves them', ot && ot.data.poValue === 50625 && ot.data.tent1 === 200 && ot.data.tent2 === 150);
check('found by internal part number, it still records the customer part number', ot && ot.data.custPartNo === 'AL-BR-9');

/* ---- Sales Plan forecasts ---- */
go('bulk_salesplan'); await wait(200);
check('Sales Plan bulk upload opens with its category chosen', $('bu-kind').value === 'salesplan');
const fcsv = [
  'Customer*,PartNo*,Month*,ForecastQty*',
  `Alpha Motors,PART-100,${monthPlus(3)},400`,                                   // ok
  `Alpha Motors,AL-SH-1,${MONTHS_NAME(monthPlus(5))},250`,                        // ok, month name
  `Alpha Motors,PART-100,${M1},90`,                                               // real PO due
  `Alpha Motors,PART-100,${M2},90`,                                               // tentative on PO-EXISTING
  `Alpha Motors,AL-SH-1,${monthPlus(4)},10`,                                       // forecast already on file
  `Alpha Motors,PART-100,${monthPlus(-1)},10`,                                     // already over
  `Alpha Motors,PART-100,Smarch 2026,10`                                          // not a month
].join('\n');
function MONTHS_NAME(ym){ return ['January','February','March','April','May','June','July','August','September','October','November','December'][+ym.slice(5)-1] + ' ' + ym.slice(0,4); }
await upload(fcsv);
const ferrs = rowErrors().join(' | ');
const fsum = $('bu-preview').querySelector('.bu-summary').textContent;
check('two forecasts are ready, five refused', /2\s*ready/.test(fsum) && /5\s*need fixing/.test(fsum), fsum + ' ' + ferrs);
check('a month a real PO covers is refused', /PO PO-EXISTING is due for this part/.test(ferrs));
check('a month a tentative covers is refused', /already carries a tentative quantity/.test(ferrs));
check('a forecast already on file is refused', /already on file — remove it on the Sales Plan screen first/.test(ferrs));
check('a month already over is refused', /is already over/.test(ferrs));
check('something that is not a month is refused', /"Smarch 2026" is not a month/.test(ferrs));
saved = [];
click($('bu-import')); await wait(300);
const fc = saved.filter(s => s.kind === 'salesplan');
check('two forecasts are imported in the shape the Sales Plan reads', fc.length === 2 && fc.every(f => f.data.firmQty > 0 && /^\d{4}-\d{2}$/.test(f.data.month)),
  JSON.stringify(fc.map(f => f.data)));
check('a month name is stored as YYYY-MM', fc.some(f => f.data.month === monthPlus(5)));
check('the Sales Plan screen links to the forecast upload', !!$('spm-bulk'));
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

let pass = 0;
for (const [n, ok, x] of results) { console.log((ok ? '  ok ' : '  x  ') + n + (ok ? '' : '   [' + x + ']')); if (ok) pass++; }
console.log(`\n${pass} passed, ${results.length - pass} failed, of ${results.length}`);
