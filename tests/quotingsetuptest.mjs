/* Quoting & Costing Setup, native. Same whole-object-preserving save
   pattern as Company Profile and Statutory & Masters before it — checked
   again here since it's the exact same risk every time a new admin screen
   is added to this shared record. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let content = {
  company: { legalName: 'Test Mfg' }, // must survive this screen's save
  costBase: { workingDays: 300, shiftsPerDay: 2, downtimePct: 15 },
  quoteCfg: { prefix: 'QTN', currency: 'INR', showTax: true, taxPercent: 18 },
  machines: [{ name: 'VMC-01', type: 'VMC', cost: 4500000, lifeYears: 10, salvage: 400000,
    kw: 15, loadFactor: 60, area: 120, maintenance: 120000, operators: 1 }],
  labourGrades: [{ grade: 'CNC Operator', wage: 28000, statutoryPct: 22, paidDays: 26, hoursPerDay: 8 }],
  materials: [{ name: 'EN8 Bright Bar', grade: 'EN8', rate: 85, unit: 'kg', density: 7.85,
    leadTimeDays: 7, confidence: 'Manual' }]
};
const calls = [];
let signedIn = false;
const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => pageErrors.push(e.message));
const dom = new JSDOM(html.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''),
  { runScripts: 'outside-only', url: 'https://example.test/idms.html', virtualConsole: vc });
const { window } = dom;
window.Element.prototype.scrollIntoView = function () {};

window.fetch = async (path, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : {};
  const url = String(path);
  const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
  if (url.startsWith('/api/auth')) {
    if (body.action === 'login') { signedIn = true; return ok({ token: 'T', user: 'tester', role: 'developer' }); }
    if (body.action === 'session') return signedIn ? ok({ user: 'tester', role: 'developer' }) : { ok: false, status: 401, json: async () => ({ error: 'Not signed in' }) };
    return ok({});
  }
  if (url.startsWith('/api/rfqs')) return ok({ rfqs: [] });
  if (url.startsWith('/api/hr')) return ok({ employees: [], items: [] });
  if (url.startsWith('/api/idms')) {
    if (url.includes('what=settings')) return ok({ settings: {} });
    if (url.includes('what=parts')) return ok({ parts: [] });
    if (url.includes('what=serial')) return ok({ next: 1 });
    if (url.includes('what=docs')) return ok({ docs: [] });
    if (url.includes('what=audit')) return ok({ audit: [] });
    return ok({});
  }
  if (url.startsWith('/api/settings')) return ok({ settings: {} });
  if (url.startsWith('/api/content')) {
    if (!opts.method || opts.method === 'GET') return ok({ data: content });
    if (opts.method === 'POST') { calls.push({ kind: 'content-save', body }); content = body.data; return ok({}); }
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
const input = el => el.dispatchEvent(new window.Event('input', { bubbles: true }));
const nav = id => click(window.document.querySelector('#menubar [data-s="' + id + '"]'));
const set = (id, v) => { $(id).value = v; };

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(300);

check('Quoting & Costing Setup is a live menu entry', !!window.document.querySelector('#menubar [data-s="admin_quoting"]'));
nav('admin_quoting');
await wait(250);

// ---------- existing values load ----------
check('cost base loads', $('qs-cb-workingDays').value === '300');
check('quotation prefix loads', $('qs-qc-prefix').value === 'QTN');
check('show-tax toggle reflects true correctly', $('qs-qc-showTax').value === 'yes');
check('the existing machine loads into the table',
  window.document.querySelector('.qs-mc-f[data-k="name"]').value === 'VMC-01');
check('the existing labour grade loads', window.document.querySelector('.qs-lb-f[data-k="grade"]').value === 'CNC Operator');
check('the existing material loads', window.document.querySelector('.qs-mt-f[data-k="name"]').value === 'EN8 Bright Bar');

// ---------- add a machine, edit a field, delete the labour grade ----------
click($('qs-mc-add'));
await wait(50);
check('a new machine row is added', window.document.querySelectorAll('.qs-mc-f[data-k="name"]').length === 2);
const newMachineName = window.document.querySelectorAll('.qs-mc-f[data-k="name"]')[1];
newMachineName.value = 'CNC-TURN-02'; input(newMachineName);

click(window.document.querySelector('.qs-lb-del'));
await wait(50);
check('deleting the only labour grade leaves the table empty', window.document.querySelectorAll('.qs-lb-f').length === 0);

click($('qs-lb-add'));
await wait(50);
check('a fresh labour grade can be added back', window.document.querySelectorAll('.qs-lb-f[data-k="grade"]').length === 1);

// ---------- edit cost base and quotation fields, then save ----------
set('qs-cb-downtimePct', '18'); input($('qs-cb-downtimePct'));
window.document.getElementById('qs-qc-showTax').value = 'no';
click($('qs-save'));
await wait(200);

const saveCall = calls.find(c => c.kind === 'content-save');
check('saving posts to /api/content', !!saveCall, JSON.stringify(calls).slice(0, 200));
check('the edited downtime % is a real number, not a string', saveCall && saveCall.body.data.costBase.downtimePct === 18,
  saveCall && typeof saveCall.body.data.costBase.downtimePct);
check('the show-tax toggle is saved as boolean false', saveCall && saveCall.body.data.quoteCfg.showTax === false);
check('the added machine is in the saved payload', saveCall && saveCall.body.data.machines.some(m => m.name === 'CNC-TURN-02'));
check('the deleted-then-readded labour grade array has exactly one entry',
  saveCall && saveCall.body.data.labourGrades.length === 1);

// ---------- quoting parts, with their own BOM and routing ----------
click($('qs-pt-add'));
await wait(80);
check('a quoting part can be added',
  !!window.document.querySelector('.qs-pt[data-k="partNo"]'));
const ptNo = window.document.querySelector('.qs-pt[data-k="partNo"]');
ptNo.value = 'Q-1001'; input(ptNo);
click(window.document.querySelector('.qs-bom-add'));
await wait(80);
const bomItem = window.document.querySelector('.qs-bom[data-k="item"]');
check('a bill of materials line can be added to that part', !!bomItem);
bomItem.value = 'EN8 bar'; input(bomItem);
const bomQty = window.document.querySelector('.qs-bom[data-k="qtyPerPart"]');
bomQty.value = '1.4'; input(bomQty);
click(window.document.querySelector('.qs-rt-add'));
await wait(80);
const rtProc = window.document.querySelector('.qs-rt[data-k="process"]');
check('a routing operation can be added to that part', !!rtProc);
rtProc.value = 'Turn'; input(rtProc);
check('the first operation is numbered 10 automatically',
  window.document.querySelector('.qs-rt[data-k="op"]').value === '10');

calls.length = 0;
click($('qs-save'));
await wait(250);
const partSave = calls.find(c => c.kind === 'content-save');
const savedPart = partSave && partSave.body.data.parts && partSave.body.data.parts[0];
check('the quoting part is saved under data.parts', !!savedPart,
  partSave && JSON.stringify(partSave.body.data.parts || []).slice(0, 120));
check('its part number is saved', savedPart && savedPart.partNo === 'Q-1001');
check('its bill of materials is saved with a real number for quantity',
  savedPart && savedPart.bom.length === 1 && savedPart.bom[0].qtyPerPart === 1.4,
  savedPart && JSON.stringify(savedPart.bom));
check('its routing is saved', savedPart && savedPart.routing.length === 1 &&
  savedPart.routing[0].process === 'Turn');

// ---------- the critical one: unrelated company profile must not be clobbered ----------
check('the unrelated company profile survives this save untouched',
  saveCall && saveCall.body.data.company.legalName === 'Test Mfg', saveCall && JSON.stringify(saveCall.body.data.company));

check('no console errors while any of this ran', pageErrors.length === 0, pageErrors.join(' | '));

const failed = results.filter(([, ok]) => !ok);
for (const [n, ok, x] of results) console.log((ok ? '  ok  ' : '  X   ') + n + (ok ? '' : '   [' + x + ']'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, of ${results.length}`);
process.exit(failed.length ? 1 : 0);
