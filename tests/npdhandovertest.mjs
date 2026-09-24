/* Won → NPD: the handover that creates the customer, the part and the priced
   link from a won quotation.

   This is the spine CLAUDE.md describes — "the customer part number is the
   thread ... created once, on the website, at the moment a quotation is won" —
   except the website screen that did it is no longer on the menu, so the
   native pipeline could mark an enquiry Won and create nothing at all.

   The fake IDMS below is a real little store rather than a stub that answers
   {} to everything, because every rule worth testing here is about what is
   ALREADY on file: a drawing that is already a part, a customer who is already
   linked to it at a price. A stub that always returns empty would pass every
   one of those checks while proving none of them. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

const quote = (n, price) => ({
  number: 'QTN-2026-' + n, createdAt: '2026-02-01T10:00:00.000Z',
  qty: 500, unitPrice: price, subtotal: price * 500, taxLabel: 'GST', taxPct: 18,
  tax: price * 500 * 0.18, total: price * 500 * 1.18, currencySymbol: '₹',
  partLine: 'Pivot Shaft', validityDays: 30, paymentTerms: '50% advance',
  publicToken: 'tok' + n + '0000000000000000'
});
const reading = (custNo, drg) => ({
  readAt: '01/02/2026', part: { number: custNo, name: 'Pivot Shaft', drawingNumber: drg, revision: 'B' },
  requirements: [], characteristics: [], missing: []
});

let rfqs = [
  // the main case: won, quoted, drawing read
  { ref: 'RFQ-7001', name: 'R. Sharma', company: 'Alpha Co', email: 'buyer@alpha.test', phone: '98765 43210',
    address: 'Plot 12, Industrial Area', city: 'Pune', gstin: '27ABCDE1234F1Z5',
    status: 'Won', createdAt: '2026-01-02T00:00:00.000Z', message: '500 off',
    fileName: 'pivot.jpg', fileUrl: '/api/assets?id=drw7001',
    extract: reading('CP-88', 'DRG-5150'),
    costing: { material: { grade: 'EN8' }, operations: [
      { op: 10, process: 'Turn', machineType: 'Turning', setupMin: 60, cycleMin: 4.5,
        labourGrade: 'CNC Operator', dims: [
          { char: 'Ø17.5 ground diameter', nominal: 17.5, tolPlus: '+0.02', tolMinus: '-0.02',
            unit: 'mm', cls: 'CC', gauge: 'Micrometer', frequency: '5/shift' },
          { char: 'Overall length 92', nominal: 92, tolPlus: '+0.1', tolMinus: '-0.1', unit: 'mm' }] },
      { op: 20, process: 'Grind', machineType: 'Grinding', setupMin: 30, cycleMin: 2,
        labourGrade: 'CNC Operator', dims: [] }] },
    quoteDoc: quote('7001', 164.19) },
  // quoted and sent, but NOT won — nothing should be offered yet
  { ref: 'RFQ-7002', name: 'B. Rao', company: 'Beta Ltd', email: 'b@beta.test',
    status: 'Approved & Sent', createdAt: '2026-01-05T00:00:00.000Z',
    extract: reading('CP-99', 'DRG-6000'), costing: { material: {}, operations: [] },
    quoteDoc: quote('7002', 90) },
  // won with no quotation at all — there is no agreed price to link at
  { ref: 'RFQ-7003', name: 'C. Iyer', company: 'Gamma Inc', email: 'c@gamma.test',
    status: 'Won', createdAt: '2026-01-06T00:00:00.000Z' },
  // a second customer winning the SAME drawing — one drawing is one part
  { ref: 'RFQ-7004', name: 'D. Kumar', company: 'Delta Corp', email: 'd@delta.test',
    status: 'Won', createdAt: '2026-01-07T00:00:00.000Z',
    extract: reading('DX-1', 'DRG-5150'), costing: { material: { grade: 'EN8' }, operations: [] },
    quoteDoc: quote('7004', 171.5) },
  // the same customer winning it again — one customer, one live price
  { ref: 'RFQ-7005', name: 'R. Sharma', company: 'Alpha Co', email: 'buyer@alpha.test',
    status: 'Won', createdAt: '2026-01-08T00:00:00.000Z',
    extract: reading('CP-88', 'DRG-5150'), costing: { material: { grade: 'EN8' }, operations: [] },
    quoteDoc: quote('7005', 180) },
  // costed, not won, and its drawing is already a part on file — the route
  // must find that part by its drawing number without a handover stamp
  { ref: 'RFQ-7007', name: 'E. Nair', company: 'Epsilon Pvt', email: 'e@epsilon.test',
    status: 'Quote Drafted', createdAt: '2026-01-10T00:00:00.000Z',
    extract: reading('EP-4', 'DRG-5150'),
    costing: { material: { grade: 'EN8' }, operations: [
      { op: 30, process: 'Deburr', machineType: 'Bench', setupMin: 5, cycleMin: 1, dims: [] }] } },
  // won, quoted, but nobody's name on it
  { ref: 'RFQ-7006', name: '', company: '', email: 'x@nowhere.test',
    status: 'Won', createdAt: '2026-01-09T00:00:00.000Z',
    extract: reading('', 'DRG-7777'), costing: { material: {}, operations: [] },
    quoteDoc: quote('7006', 55) }
];

/* ---- the fake IDMS: stores what it is given, returns it on the next read ---- */
const store = { docs: [], parts: [], serial: {}, writes: [] };
const patches = [];

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
    if (body.action === 'session') return signedIn ? ok({ user: 'tester', role: 'developer' })
      : { ok: false, status: 401, json: async () => ({ error: 'Not signed in' }) };
    return ok({});
  }
  if (url.startsWith('/api/content')) return ok({ data: {
    company: { legalName: 'Test Mfg', phone: '044-2345 6789', rfqEmail: 'sales@testmfg.test' },
    quoteSender: 'Marketing Team',
    quoteCfg: { prefix: 'QTN', currencySymbol: '₹', currency: 'INR', validityDays: 30,
      showTax: true, taxLabel: 'GST', taxPercent: 18, paymentTerms: '50% advance' },
    costBase: {}, machines: [], labourGrades: [], materials: []
  } });
  if (url.startsWith('/api/hr')) return ok({ employees: [], items: [] });
  if (url.startsWith('/api/settings')) return ok({ settings: {} });

  if (url.startsWith('/api/idms')) {
    if (!opts.method || opts.method === 'GET') {
      if (url.includes('what=parts')) return ok({ parts: store.parts });
      if (url.includes('what=docs')) {
        const kind = (url.match(/kind=([^&]*)/) || [])[1];
        return ok({ docs: kind ? store.docs.filter(d => d.kind === decodeURIComponent(kind)) : store.docs });
      }
      if (url.includes('what=settings')) return ok({ settings: {} });
      if (url.includes('what=audit')) return ok({ audit: [] });
      return ok({});
    }
    if (opts.method === 'POST') {
      /* the real endpoint issues the serial inside Postgres and returns its
         value — a stub returning the wrong key would give every part the
         number "…-PART-undefined" and look like it worked */
      if (body.what === 'serial') {
        store.serial[body.name] = (store.serial[body.name] || 0) + (body.by || 1);
        return ok({ value: store.serial[body.name] });
      }
      if (body.what === 'parts') {
        const p = body.part || {};
        const partId = 'P' + (store.parts.length + 1);
        store.parts.push({ part_id: partId, part_no: p.partNo, part_name: p.partName,
          lifecycle: p.lifecycle, customer: p.customer || '', quote_ref: p.quoteRef || '',
          data: p.data || {} });
        store.writes.push({ kind: 'part', reason: body.reason || '', part: p });
        return ok({ partId });
      }
      if (body.what === 'docs') {
        const d = body.doc || {};
        const docId = d.docId || (d.kind + '-' + (store.docs.length + 1));
        store.docs = store.docs.filter(x => x.doc_id !== docId);
        store.docs.push({ doc_id: docId, kind: d.kind, part_id: d.partId || '',
          doc_no: d.docNo || '', status: d.status || '', data: d.data || {} });
        store.writes.push({ kind: d.kind, reason: body.reason || '', data: d.data || {} });
        return ok({ docId });
      }
      return ok({});
    }
    return ok({});
  }

  if (url.startsWith('/api/rfqs')) {
    if (!opts.method || opts.method === 'GET') return ok({ rfqs });
    if (opts.method === 'PATCH') {
      patches.push(body);
      const i = rfqs.findIndex(r => r.ref === body.ref);
      if (i < 0) return { ok: true, status: 200, json: async () => ({ ok: false, error: 'Not found' }) };
      rfqs[i] = Object.assign({}, rfqs[i], body.patch || {});
      return ok({ rfq: rfqs[i] });
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
const qs = s => window.document.querySelector(s);
const npdIn = (ref, k) => qs('.rp-npdin[data-ref="' + ref + '"][data-k="' + k + '"]');
const msg = ref => ($('rp-msg-' + ref) || {}).textContent || '';
async function open(ref) {
  /* the list redraws on every reload and keeps whichever row was open, so
     only click when this row is not the open one */
  if (!qs('.rp-stage[data-ref="' + ref + '"]')) {
    click(qs('.rp-head[data-ref="' + ref + '"]'));
    await wait(200);
  }
}
window.prompt = () => 'no longer needed';
window.confirm = () => true;

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(300);
click(window.document.querySelector('#menubar [data-s="rfq_pipeline"]'));
await wait(300);

// ---------- it is offered on a won enquiry and nowhere else ----------
await open('RFQ-7002');
check('an enquiry that is not Won is offered nothing to move',
  !qs('.rp-npd[data-ref="RFQ-7002"]') &&
  !/New product development/.test(qs('.rp-head[data-ref="RFQ-7002"]').parentNode.textContent));

await open('RFQ-7003');
check('a won enquiry with no quotation says to draft it first, rather than offering the button',
  !qs('.rp-npd[data-ref="RFQ-7003"]') &&
  /Draft the quotation first/.test(qs('.rp-head[data-ref="RFQ-7003"]').parentNode.textContent),
  qs('.rp-head[data-ref="RFQ-7003"]').parentNode.textContent.slice(-160));

await open('RFQ-7001');
check('a won, quoted enquiry offers Move to NPD', !!qs('.rp-npd[data-ref="RFQ-7001"]'));
check('the part name comes from the drawing reading, not retyped',
  npdIn('RFQ-7001', 'name').value === 'Pivot Shaft', npdIn('RFQ-7001', 'name').value);
check('so do the drawing number, the revision and their own part number',
  npdIn('RFQ-7001', 'drg').value === 'DRG-5150' && npdIn('RFQ-7001', 'rev').value === 'B' &&
  npdIn('RFQ-7001', 'custno').value === 'CP-88');
check('the raw material comes from the costing',
  npdIn('RFQ-7001', 'rm').value === 'EN8', npdIn('RFQ-7001', 'rm').value);
check('HSN starts empty — nothing on a drawing states it',
  npdIn('RFQ-7001', 'hsn').value === '');

// ---------- the refusals, before anything is written ----------
click(qs('.rp-npd[data-ref="RFQ-7001"]'));
await wait(250);
check('no HSN is refused by name', /HSN/.test(msg('RFQ-7001')), msg('RFQ-7001'));
check('…and nothing at all was created', store.writes.length === 0, JSON.stringify(store.writes));

npdIn('RFQ-7001', 'hsn').value = '84829900';
npdIn('RFQ-7001', 'name').value = '';
click(qs('.rp-npd[data-ref="RFQ-7001"]'));
await wait(250);
check('a part with no name is refused', /name/.test(msg('RFQ-7001')) && store.writes.length === 0);
npdIn('RFQ-7001', 'name').value = 'Pivot Shaft';

window.confirm = () => false;
click(qs('.rp-npd[data-ref="RFQ-7001"]'));
await wait(250);
check('declining the confirmation creates nothing', store.writes.length === 0);
window.confirm = () => true;

// ---------- the handover itself ----------
click(qs('.rp-npd[data-ref="RFQ-7001"]'));
await wait(700);

const cust = store.docs.filter(d => d.kind === 'customer')[0];
check('the customer is created from the enquiry', !!cust && cust.data.name === 'Alpha Co',
  JSON.stringify(cust && cust.data.name));
check('with the contact, phone, email, GSTIN and address off the enquiry',
  cust && cust.data.contact === 'R. Sharma' && cust.data.phone === '98765 43210' &&
  cust.data.email === 'buyer@alpha.test' && cust.data.gstin === '27ABCDE1234F1Z5' &&
  /Plot 12/.test(cust.data.billing) && /Pune/.test(cust.data.billing),
  JSON.stringify(cust && cust.data));
check('and a code in the same shape the Customer screen builds',
  cust && /^ALPH-\d{3}$/.test(cust.data.code), cust && cust.data.code);

const part = store.parts[0];
check('the part is created', !!part && part.part_name === 'Pivot Shaft');
/* CLAUDE.md's two hard rules in one assertion: the prefix comes from the site
   profile (never hard-coded) and the serial comes from the database */
check('its number is the profile prefix plus a serial issued by the database',
  part && part.part_no === 'TEST-PART-0001', part && part.part_no);
check('it starts at stage New, ready for APQP', part && part.lifecycle === 'New');
check('it carries the drawing number, revision, UOM and raw material',
  part && part.data.drawingNo === 'DRG-5150' && part.data.drawingRev === 'B' &&
  part.data.uom === 'Nos' && part.data.rawMaterial === 'EN8', JSON.stringify(part && part.data));
check('and the customer’s own drawing file, so it is one click away on Parts',
  part && part.data.drawingFile && part.data.drawingFile.url === '/api/assets?id=drw7001',
  JSON.stringify(part && part.data.drawingFile));
check('it records which enquiry and quotation it came from',
  part && part.data.rfqRef === 'RFQ-7001', JSON.stringify(part && part.data.rfqRef));

const link = store.docs.filter(d => d.kind === 'cust_part')[0];
check('the priced link is created between that customer and that part',
  link && link.data.customerName === 'Alpha Co' && link.data.partId === part.part_id);
check('at the quoted price, in the quotation’s currency',
  link && link.data.price === 164.19 && link.data.currency === 'INR',
  JSON.stringify(link && [link.data.price, link.data.currency]));
check('carrying the HSN that was typed in, their part number and the quotation reference',
  link && link.data.hsn === '84829900' && link.data.custPartNo === 'CP-88' &&
  link.data.quoteRef === 'QTN-2026-7001', JSON.stringify(link && link.data));
/* toISOString().slice(0,10) is a day behind all night in Asia/Kolkata, and
   this dates a price — Core.dayKey is the local-date helper */
const today = new Date();
const localToday = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') +
  '-' + String(today.getDate()).padStart(2, '0');
check('the price is effective from today in local time, not UTC',
  link && link.data.effectiveFrom === localToday, link && link.data.effectiveFrom);

check('every record written carries an audit reason naming the quotation',
  store.writes.length === 3 && store.writes.every(w => /QTN-2026-7001/.test(w.reason)),
  JSON.stringify(store.writes.map(w => w.reason)));

const won = patches.filter(p => p.ref === 'RFQ-7001').pop();
check('the enquiry is marked Won and stamped with the part it produced',
  won && won.patch.status === 'Won' && (won.patch.idmsParts || [])[0] === part.part_id,
  JSON.stringify(won && won.patch.idmsParts));
/* the triage rule "won, but never sent to the IDMS" reads idmsParts — a
   different field name here would leave every transferred enquiry flagged */
check('which is the same field the triage rule reads, so it stops flagging it',
  'idmsParts' in (won ? won.patch : {}));
check('and a log line says what happened',
  won && /part TEST-PART-0001 created/.test((won.patch.log || [])[0] || ''),
  won && (won.patch.log || [])[0]);
check('the message points at where the part now lives',
  /Parts Addition/.test(msg('RFQ-7001')) && /TEST-PART-0001/.test(msg('RFQ-7001')),
  msg('RFQ-7001'));

// ---------- doing it twice ----------
await open('RFQ-7001');
check('once moved, the button is replaced by a confirmation rather than offered again',
  !qs('.rp-npd[data-ref="RFQ-7001"]') &&
  /1 part\(s\) created in the IDMS/.test(qs('.rp-head[data-ref="RFQ-7001"]').parentNode.textContent),
  qs('.rp-head[data-ref="RFQ-7001"]').parentNode.textContent.slice(-200));

// ---------- a second customer, the same drawing ----------
const writesBefore = store.writes.length;
await open('RFQ-7004');
npdIn('RFQ-7004', 'hsn').value = '84829900';
click(qs('.rp-npd[data-ref="RFQ-7004"]'));
await wait(700);
check('the same drawing does not become a second part',
  store.parts.length === 1, String(store.parts.length));
check('the second customer is linked to the part already on file',
  store.docs.filter(d => d.kind === 'cust_part').length === 2 &&
  store.docs.filter(d => d.kind === 'cust_part')[1].data.customerName === 'Delta Corp' &&
  store.docs.filter(d => d.kind === 'cust_part')[1].data.partId === part.part_id);
check('at their own agreed price, not the first customer’s',
  store.docs.filter(d => d.kind === 'cust_part')[1].data.price === 171.5,
  String(store.docs.filter(d => d.kind === 'cust_part')[1].data.price));
check('so one part carries one APQP record however many customers buy it',
  store.writes.length === writesBefore + 2, // the new customer and the new link, no new part
  String(store.writes.length - writesBefore));
check('and the message says it linked rather than created',
  /Linked to the part already on file/.test(msg('RFQ-7004')), msg('RFQ-7004'));

// ---------- the same customer, the same part, a second time ----------
const linksBefore = store.docs.filter(d => d.kind === 'cust_part').length;
await open('RFQ-7005');
npdIn('RFQ-7005', 'hsn').value = '84829900';
click(qs('.rp-npd[data-ref="RFQ-7005"]'));
await wait(700);
check('a customer already linked to this part is not given a second price',
  store.docs.filter(d => d.kind === 'cust_part').length === linksBefore,
  String(store.docs.filter(d => d.kind === 'cust_part').length));
check('…and is told why, rather than it happening silently',
  /already linked/.test(msg('RFQ-7005')) && /which one to invoice/.test(msg('RFQ-7005')),
  msg('RFQ-7005'));
check('the enquiry is still marked as moved, so it stops being flagged as not sent',
  ((patches.filter(p => p.ref === 'RFQ-7005').pop() || {}).patch || {}).idmsParts !== undefined);

// ---------- an enquiry with nobody's name on it ----------
await open('RFQ-7006');
npdIn('RFQ-7006', 'hsn').value = '84829900';
npdIn('RFQ-7006', 'name').value = 'Mystery Part';
const before7006 = store.writes.length;
click(qs('.rp-npd[data-ref="RFQ-7006"]'));
await wait(300);
check('an enquiry with no customer name on it is refused',
  /no customer name/i.test(msg('RFQ-7006')), msg('RFQ-7006'));
check('…and nothing is created from it',
  store.writes.length === before7006, String(store.writes.length - before7006));

/* ---------- the two seams joined up ----------
   rfqRouteToPart has always refused with "a part is created when the
   quotation is won ... so mark this enquiry Won first, then send the route
   across" — advice that was impossible to follow, because marking it Won
   created nothing. This is the pair working: move to NPD, then send the
   route to the part that move created. */
await open('RFQ-7001');
check('the route can still be sent from a costed enquiry', !!qs('.rp-topart[data-ref="RFQ-7001"]'));
click(qs('.rp-topart[data-ref="RFQ-7001"]'));
await wait(900);
const ops = store.docs.filter(d => d.kind === 'process');
const dims = store.docs.filter(d => d.kind === 'dimension');
check('the route lands on the part the handover created, rather than being refused',
  ops.length === 2 && ops.every(o => o.part_id === part.part_id),
  JSON.stringify(ops.map(o => [o.part_id, o.data.opNo])));
check('with the operation numbers, machine times and names off the costing',
  ops[0] && ops[0].data.opNo === 10 && ops[0].data.name === 'Turn' &&
  ops[0].data.setupMin === 60 && ops[0].data.cycleSec === 270,
  JSON.stringify(ops[0] && ops[0].data));
check('the characteristics land under their own operation',
  dims.length === 2 && dims.every(d => d.part_id === part.part_id) &&
  dims[0].data.description === 'Ø17.5 ground diameter' && dims[0].data.opNo === 10,
  JSON.stringify(dims.map(d => d.data.description)));
check('the critical characteristic keeps its class, its gauge and its frequency',
  dims[0] && dims[0].data.cls === 'CC' && dims[0].data.gauge === 'Micrometer' &&
  dims[0].data.frequency === '5/shift');
/* everything an agent writes goes through review — CLAUDE.md's third agent rule */
check('all of it is marked AI proposed, so it waits on Review Agent Work',
  ops.every(o => o.data.aiProposed) && dims.every(d => d.data.aiProposed));
check('and the enquiry records which part the route went to',
  ((patches.filter(p => p.ref === 'RFQ-7001').pop() || {}).patch || {}).routeSentTo === part.part_id);
check('the message says what went across, not that no part could be found',
  /2 operation\(s\) and 2 characteristic\(s\)/.test(msg('RFQ-7001')) &&
  !/No part on file/.test(msg('RFQ-7001')), msg('RFQ-7001'));

/* ---------- a part somebody added by hand is still findable ----------
   The drawing-number fallback in rfqRouteToPart read `drawingNumber` on the
   customer link — a field nothing in this codebase writes (the Parts screen
   stores `drawingNo` on the part, the link stores `custDrawingNo`). So it
   could never match, and an enquiry for a drawing already on file as a part
   was told no part matched it unless the handover had stamped the enquiry.
   Driven here against a part created earlier in this run, from an enquiry
   that has no handover stamp at all. */
await open('RFQ-7007');
const opsBefore = store.docs.filter(d => d.kind === 'process').length;
click(qs('.rp-topart[data-ref="RFQ-7007"]'));
await wait(900);
const newOps = store.docs.filter(d => d.kind === 'process').slice(opsBefore);
check('an enquiry with no handover stamp still finds the part by its drawing number',
  newOps.length === 1 && newOps[0].part_id === part.part_id,
  msg('RFQ-7007'));
check('…and the operation lands with its own number rather than overwriting one in use',
  newOps[0] && newOps[0].data.opNo === 30 && newOps[0].data.name === 'Deburr',
  JSON.stringify(newOps[0] && newOps[0].data));
check('it is not refused with "no part on file", which is what used to happen',
  !/No part on file/.test(msg('RFQ-7007')), msg('RFQ-7007'));

check('no console errors while any of this ran', pageErrors.length === 0, pageErrors.join(' | '));

const failed = results.filter(([, ok]) => !ok);
for (const [n, ok, x] of results) console.log((ok ? '  ok  ' : '  X   ') + n + (ok ? '' : '   [' + x + ']'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, of ${results.length}`);
process.exit(failed.length ? 1 : 0);
