/* Tests for Bulk Upload — one CSV import engine shared by all eight masters,
   rather than eight separate screens that would each parse and preview a
   little differently. Nothing should be written to the server until Import
   is pressed, and every row's own pass/fail must be reported, not merged
   into one pass/fail for the whole file. */
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

let signedIn = false;
const saved = { customer: [], supplier: [], machine: [], rawmat: [], tool: [], gauge: [], bom: [], part: [] };
const existingCustomers = [{ data: { name: 'Existing Customer Ltd' } }];
const existingParts = [{ part_id: 'p1', part_no: 'PART-000100', part_name: 'Bracket', data: { drawingNo: '' } }];
const existingRawmats = [{ doc_id: 'rm1', doc_no: 'RM-050', data: { description: 'Existing Steel Bar' } }];

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
    if (url.includes('what=parts')) return ok({ parts: existingParts });
    if (url.includes('what=docs')) {
      const kind = url.match(/kind=([a-z]+)/)?.[1];
      if (kind === 'customer') return ok({ docs: existingCustomers });
      if (kind === 'rawmat') return ok({ docs: existingRawmats });
      if (kind === 'supplier' || kind === 'machine' || kind === 'tool' || kind === 'gauge' || kind === 'bom')
        return ok({ docs: [] });
      return ok({ docs: [] });
    }
    if (url.includes('what=settings')) return ok({ settings: {} });
    if (opts.method === 'POST' && body.what === 'docs') {
      saved[body.doc.kind] = saved[body.doc.kind] || [];
      saved[body.doc.kind].push(body.doc);
      return ok({ docId: 'new-' + saved[body.doc.kind].length });
    }
    if (opts.method === 'POST' && body.what === 'parts') {
      saved.part.push(body.part);
      return ok({ docId: 'new-part-' + saved.part.length });
    }
    if (opts.method === 'POST' && body.what === 'docNumber')
      return ok({ number: 'AUTO-' + Math.random().toString(36).slice(2, 7).toUpperCase() });
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

// ---- reachable from the menu ----
const live = [...window.document.querySelectorAll('#menubar a[data-s]')].map(a => a.dataset.s);
check('Bulk Upload is in the menu', live.includes('bulk_upload'));
check('Masters group exists with the moved screens',
  live.includes('entry_customer') && live.includes('entry_supplier') && live.includes('parts') &&
  live.includes('entry_machine') && live.includes('bom'));

click([...window.document.querySelectorAll('#menubar a[data-s]')].find(a => a.dataset.s === 'bulk_upload'));
await wait(200);
const panel = window.document.querySelector('.panel[data-panel="bulk_upload"]');
check('the panel opens', panel && panel.classList.contains('on'));

// ---- category list covers all eight ----
const kindOptions = [...$('bu-kind').options].map(o => o.value);
check('all eight master categories are offered',
  ['customer','supplier','parts','machine','tool','consumable','bom','gauge'].every(k => kindOptions.includes(k)),
  kindOptions.join(','));

// ---- template download builds a real CSV with the example row ----
let downloaded = null;
const realCreateElement = window.document.createElement.bind(window.document);
window.document.createElement = function(tag) {
  const el = realCreateElement(tag);
  if (tag === 'a') { const origClick = el.click.bind(el);
    el.click = function() { downloaded = { href: el.href, download: el.download }; }; }
  return el;
};
window.URL.createObjectURL = (blob) => { downloaded_blob = blob; return 'blob:fake'; };
window.URL.revokeObjectURL = () => {};
let downloaded_blob = null;
click($('bu-template'));
check('a template file is offered for download', !!downloaded && /customer-template\.csv/.test(downloaded.download));

// ---- a CSV with one good and one bad customer row ----
const csv = 'Name*,Code,GSTIN,PaymentTerms,BillingAddress,DespatchAddress,ContactPerson,Phone,Email\n' +
  'New Customer Pvt Ltd,,29AAAAA0000A1Z5,30 days,Chennai,Chennai,A Kumar,9000000000,a@x.example\n' +
  'Existing Customer Ltd,,,,,,,,\n' +
  ',,,,,,,9000000001,noname@x.example\n';   // blank name but a real row — should fail validation
const fakeFile = { name: 'customers.csv', text: async () => csv };
Object.defineProperty($('bu-file'), 'files', { value: [fakeFile], configurable: true });
$('bu-file').dispatchEvent(new window.Event('change'));
await wait(300);

check('the preview shows one row ready and two needing fixing',
  /1\s*ready to import/.test(txt($('bu-preview')).replace(/\s+/g, ' ')) &&
  /2\s*need fixing/.test(txt($('bu-preview')).replace(/\s+/g, ' ')),
  txt($('bu-preview')).slice(0, 300));
check('the duplicate-against-existing-records row is explained',
  /already exists/i.test(txt($('bu-preview'))));
check('the blank-name row is explained', /Name is required/i.test(txt($('bu-preview'))));
check('nothing was saved yet just from previewing', saved.customer.length === 0);

// ---- import the one good row ----
click($('bu-import')); await wait(300);
check('exactly one customer was actually saved', saved.customer.length === 1);
check('with the right name', saved.customer[0].data.name === 'New Customer Pvt Ltd');
check('the import result says so', /1 imported/i.test(txt($('bu-preview'))));

// ---- switch category: consumables route into the raw material master ----
$('bu-kind').value = 'consumable';
$('bu-kind').dispatchEvent(new window.Event('change'));
await wait(60);
check('the consumables hint explains it reuses Raw Material Master',
  /Raw Material Master/i.test(($('bu-kind').selectedOptions[0]||{}).text || ''));
const csv2 = 'Description*,Code,Form,Spec,Standard,Size,UOM,Rate,ReorderLevel,ShelfLifeDays\n' +
  'Grinding coolant 20L,,Component,,,20L can,Litre,150,10,180\n';
Object.defineProperty($('bu-file'), 'files', { value: [{ name: 'c.csv', text: async () => csv2 }], configurable: true });
$('bu-file').dispatchEvent(new window.Event('change'));
await wait(250);
click($('bu-import')); await wait(200);
check('a consumable is saved as a rawmat doc with Type forced to Consumable',
  saved.rawmat.length === 1 && saved.rawmat[0].data.type === 'Consumable');

// ---- BOM: grouped rows, one bill per part ----
$('bu-kind').value = 'bom';
$('bu-kind').dispatchEvent(new window.Event('change'));
await wait(60);
const csv3 = 'PartNo*,MaterialCode*,QtyPerPiece*,ScrapPercent\n' +
  'PART-000100,RM-050,0.4,2\n' +
  'PART-000100,RM-999,0.1,0\n' +   // unknown material — should fail
  'PART-999999,RM-050,0.2,0\n';    // unknown part — should fail
Object.defineProperty($('bu-file'), 'files', { value: [{ name: 'b.csv', text: async () => csv3 }], configurable: true });
$('bu-file').dispatchEvent(new window.Event('change'));
await wait(250);
check('BOM preview accepts the valid line and rejects the two bad ones',
  /1\s*ready to import/.test(txt($('bu-preview')).replace(/\s+/g, ' ')) &&
  /2\s*need fixing/.test(txt($('bu-preview')).replace(/\s+/g, ' ')),
  txt($('bu-preview')).replace(/\s+/g, ' ').slice(0, 200));
click($('bu-import')); await wait(250);
check('one bill of materials document was created', saved.bom.length === 1);
check('it carries the one valid line, grouped under its part',
  saved.bom[0].data.lines.length === 1 && saved.bom[0].data.partId === 'p1');

check('no page errors while doing all of this', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

let pass = 0;
results.forEach(([n, c, x]) => { if (c) { pass++; console.log('  ok ' + n); } else console.log('  x ' + n + '   [' + x + ']'); });
console.log(`\n${pass} passed, ${results.length - pass} failed, of ${results.length}`);
process.exit(0);
