/* RFQ Pipeline → Move to PPC & MMD copies the costing into the masters.
   The fixture already holds one material, spelt differently from the costing,
   and one operation number, so "linked, not duplicated" and "never
   overwritten" are both tested against real existing records; and the button
   is pressed twice to prove the second press creates nothing. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let rfqs = [
  { ref: 'RFQ-8001', name: 'R. Sharma', company: 'Alpha Co', email: 'buyer@alpha.test',
    status: 'Won', createdAt: '2026-01-02T00:00:00.000Z', idmsParts: ['P1'],
    extract: { part: { number: 'CP-1', name: 'Pivot Shaft', drawingNumber: 'DRG-1' } },
    quoteDoc: { number: 'QTN-1' },
    costing: {
      material: { grade: 'EN8', stockForm: 'Round bar', stockSize: 'dia 25 x 3000', blankWeight: 0.42, rate: 78 },
      bom: [],
      operations: [
        { op: 10, process: 'CNC turning', machineType: 'Turning', setupMin: 45, cycleMin: 2.5 },
        { op: 20, process: 'Drilling', machineType: 'VMC', setupMin: 20, cycleMin: 1 },
        { op: 30, process: 'Zinc plating (job work)', machineType: '', setupMin: 0, cycleMin: 0 }],
      tooling: [{ op: 10, item: 'Carbide insert', spec: 'CNMG 120408', unitCost: 450, life: 600 }],
      jigFixtures: [{ op: 20, item: 'Drilling jig', spec: '4 holes', unitCost: 18000, life: 50000 }],
      gauges: [{ op: 10, item: 'Plug gauge', spec: 'Ø8.5 H7', unitCost: 3500, life: 100000 }],
      consumables: [{ item: 'Coolant', spec: 'Soluble 6%', costPerPart: 0.4 }]
    } }
];
/* ---- the fake IDMS: stores what it is given, returns it on the next read ---- */
const store = { docs: [], parts: [{ part_id: 'P1', part_no: 'TEST-PART-0001', part_name: 'Pivot Shaft', lifecycle: 'New', data: {} }], serial: {}, writes: [] };
/* already on file: the bar, spelt differently from the costing, and Op 10 */
store.docs.push({ doc_id: 'rm-1', kind: 'rawmat', part_id: '', doc_no: 'TEST-RM-0001', status: 'Active',
  data: { description: 'EN8 bright bar Ø25', type: 'Raw material', spec: 'en8', form: 'Bar', size: 'Ø25 × 3000', uom: 'Kg' } });
store.docs.push({ doc_id: 'op-1', kind: 'process', part_id: 'P1', doc_no: '10', status: 'Active',
  data: { partId: 'P1', opNo: 10, name: 'Turning (approved)', where: 'in' } });
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
const msg = ref => ($('rp-msg-' + ref) || {}).textContent || '';
window.prompt = () => 'x'; window.confirm = () => true;
const of = k => store.docs.filter(d => d.kind === k);

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(300);
click(qs('#menubar [data-s="rfq_pipeline"]'));
await wait(300);
if (!qs('.rp-stage[data-ref="RFQ-8001"]')) { click(qs('.rp-head[data-ref="RFQ-8001"]')); await wait(250); }

check('a won enquiry already moved to NPD offers Move to PPC & MMD', !!qs('.rp-ppc[data-ref="RFQ-8001"]'));
check('the button says what it copies and where', /BOM → BOM Master/.test(qs('.rp-head[data-ref="RFQ-8001"]').parentNode.textContent));
click(qs('.rp-ppc[data-ref="RFQ-8001"]'));
await wait(1500);

check('raw material already on file (spelt differently) is linked, not duplicated',
  of('rawmat').filter(d => (d.data.type || 'Raw material') === 'Raw material').length === 1, JSON.stringify(of('rawmat').map(d => d.data.description)));
const bom = of('bom')[0];
check('BOM Master: the part gets a BOM line on that material at the blank weight per piece',
  bom && bom.part_id === 'P1' && bom.data.lines.length === 1 && bom.data.lines[0].materialId === 'rm-1' && bom.data.lines[0].qtyPer === 0.42,
  JSON.stringify(bom && bom.data));
const ops = of('process').filter(d => d.part_id === 'P1');
check('Process Master: Op 20 and Op 30 are added, the approved Op 10 is not overwritten',
  ops.length === 3 && ops.find(d => d.data.opNo === 10).data.name === 'Turning (approved)', ops.map(d => d.data.opNo + ' ' + d.data.name).join('; '));
check('a job-work operation is marked sub-contract', ops.find(d => d.data.opNo === 30).data.where === 'sub');
check('routing from the costing is provisional and AI proposed', ops.find(d => d.data.opNo === 20).data.aiProposed && ops.find(d => d.data.opNo === 20).data.provisional);
const tool = of('tool')[0], jig = of('jig')[0], gauge = of('gauge')[0];
const con = of('rawmat').find(d => d.data.type === 'Consumable');
check('Tool Master: a tool card with an auto-generated code', tool && /-TOOL-\d{4}$/.test(tool.doc_no) && /CNMG/.test(tool.data.description), tool && tool.doc_no);
check('Jig & Fixture Master: tied to the part and Op 20, auto code JF', jig && /-JF-\d{4}$/.test(jig.doc_no) && jig.part_id === 'P1' && jig.data.opNo === 20 && jig.status === 'Provisional', jig && jig.doc_no);
check('Gauge Master: with its range, auto code GAUGE', gauge && /-GAUGE-\d{4}$/.test(gauge.doc_no) && gauge.data.range === 'Ø8.5 H7', gauge && gauge.doc_no);
check('Consumables Master: type Consumable with its own CON code', con && /-CON-\d{4}$/.test(con.doc_no), con && con.doc_no);
check('everything created says which enquiry it came from', [tool, jig, gauge, con].every(d => d.data.fromRfq === 'RFQ-8001'));
check('PPC & MMD is notified and the transfer is recorded on the enquiry', !!rfqs[0].ppcNotifiedAt && !!rfqs[0].ppcTransfer);
check('the screen reports what was created and what was linked', /Created/.test(msg('RFQ-8001')) && /linked/.test(msg('RFQ-8001')), msg('RFQ-8001').slice(0, 200));

const before = store.docs.length;
if (!qs('.rp-stage[data-ref="RFQ-8001"]')) { click(qs('.rp-head[data-ref="RFQ-8001"]')); await wait(250); }
click(qs('.rp-ppc-again[data-ref="RFQ-8001"]'));
await wait(1500);
check('pressing it again creates nothing new', store.docs.length === before && of('bom')[0].data.lines.length === 1,
  before + ' → ' + store.docs.length);
check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

let failed = 0;
for (const [n, ok, x] of results) { if (!ok) failed++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  — ' + x)); }
console.log(results.length - failed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
