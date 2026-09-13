/* RFQ Pipeline, Phase 1 (native). The one thing worth being exact about:
   rfqTriage() was ported line-for-line from the website's own triageRfqs(),
   so this seeds RFQs designed to hit several of its rules and checks the
   exact same flags come out — not just "something is flagged". Reading a
   drawing, costing, and the line-item quotation builder are Phase 2,
   explicitly not tested here because they don't exist here yet. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); };
let rfqs = [
  // received 10 days ago, never touched at all -> high: "Received ... untouched"
  { ref: 'RFQ-0001', name: 'Alpha Co', email: 'a@alpha.com', status: 'Received', createdAt: daysAgo(10), message: 'Need a quote' },
  // costed and quoted and numbered, drawing already read with a part number -> nothing flagged
  { ref: 'RFQ-0002', name: 'Beta Ltd', email: 'b@beta.com', status: 'Quote Drafted', createdAt: daysAgo(2),
    fileName: 'drawing.pdf', extract: { readAt: daysAgo(2), part: { number: 'P-123' }, missing: [] },
    costing: { material: { grade: 'EN8' } }, quoteDoc: { number: 'QTN-0002' } },
  // sent 20 days ago, no answer -> med: "Sent ... days ago with no answer"
  { ref: 'RFQ-0003', name: 'Gamma Inc', email: 'g@gamma.com', status: 'Approved & Sent', createdAt: daysAgo(20),
    costing: { material: { grade: 'SS304' } }, quoteDoc: { number: 'QTN-0003' } },
  // won, but never sent to IDMS -> high
  { ref: 'RFQ-0004', name: 'Delta Corp', email: 'd@delta.com', status: 'Won', createdAt: daysAgo(30),
    costing: { material: { grade: 'AL6061' } }, quoteDoc: { number: 'QTN-0004' } },
  // closed -> excluded from triage entirely, regardless of anything else about it
  { ref: 'RFQ-0005', name: 'Epsilon', email: 'e@epsilon.com', status: 'Closed', createdAt: daysAgo(60) }
];
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
  if (url.startsWith('/api/content')) return ok({ data: { company: { legalName: 'Test Mfg' } } });
  if (url.startsWith('/api/hr')) return ok({ employees: [], items: [] });
  if (url.startsWith('/api/settings')) return ok({ settings: {} });
  if (url.startsWith('/api/idms')) {
    if (url.includes('what=settings')) return ok({ settings: {} });
    if (url.includes('what=parts')) return ok({ parts: [] });
    if (url.includes('what=serial')) return ok({ next: 1 });
    if (url.includes('what=docs')) return ok({ docs: [] });
    if (url.includes('what=audit')) return ok({ audit: [] });
    return ok({});
  }
  if (url.startsWith('/api/rfqs')) {
    if (!opts.method || opts.method === 'GET') return ok({ rfqs });
    if (opts.method === 'PATCH') {
      calls.push({ kind: 'rfq-patch', body });
      const i = rfqs.findIndex(r => r.ref === body.ref);
      if (i < 0) return { ok: true, status: 200, json: async () => ({ ok: false, error: 'Not found' }) };
      if (body.remove) { rfqs.splice(i, 1); return ok({ removed: body.ref }); }
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
const change = el => el.dispatchEvent(new window.Event('change', { bubbles: true }));
const nav = id => click(window.document.querySelector('#menubar [data-s="' + id + '"]'));
window.prompt = () => 'no longer needed';

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(300);

check('RFQ Pipeline is a live native menu entry', !!window.document.querySelector('#menubar [data-s="rfq_pipeline"]'));
check('the old website-embed menu entry (emb_pipeline) is gone, not left as a second copy',
  !window.document.querySelector('#menubar [data-s="emb_pipeline"]'));
nav('rfq_pipeline');
await wait(250);

// ---------- KPI counts ----------
check('the KPI strip counts all 5 seeded RFQs', $('rp-kpi').textContent.includes('5'), $('rp-kpi').textContent);

// ---------- the list excludes Closed by default ----------
check('a Closed RFQ is not shown in the default (open) list', !$('rp-list').textContent.includes('RFQ-0005'));
check('an open RFQ is shown', $('rp-list').textContent.includes('RFQ-0001'));

// ---------- Triage: exact rules, ported line for line ----------
click($('rp-tri-run'));
await wait(100);
const triText = $('rp-tri-list').textContent;
check('RFQ-0001 (10 days untouched) is flagged high, "still untouched"',
  /RFQ-0001/.test(triText) && /untouched/.test(triText), triText);
check('RFQ-0003 (sent 20 days, no answer) is flagged, "no answer"',
  /RFQ-0003/.test(triText) && /no answer/.test(triText));
check('RFQ-0004 (won, never sent to IDMS) is flagged',
  /RFQ-0004/.test(triText) && /never sent to the IDMS/.test(triText));
check('RFQ-0002 (fully costed and quoted, numbered, recent) is NOT flagged at all',
  !/RFQ-0002/.test(triText));
check('RFQ-0005 (Closed) is excluded from triage entirely, regardless of its own state',
  !/RFQ-0005/.test(triText));

// ---------- AI prioritisation ----------
let aiCalled = false;
const realFetch = window.fetch;
window.fetch = async (path, opts) => {
  if (String(path).startsWith('/api/ai')) { aiCalled = true; return { ok: true, status: 200, json: async () => ({ ok: true, text: 'MATCH: n/a\nDeal with RFQ-0001 and RFQ-0004 first.' }) }; }
  return realFetch(path, opts);
};
click($('rp-tri-explain'));
await wait(200);
check('asking the AI to prioritise calls the AI gateway', aiCalled);
check('the narrative is shown once it returns', /Deal with RFQ-0001/.test($('rp-tri-narrative').textContent));
window.fetch = realFetch;

// ---------- stage change and delete, via the real shared endpoint ----------
calls.length = 0;
const stageSel = window.document.querySelector('.rp-stage[data-ref="RFQ-0001"]');
check('a stage selector is offered per RFQ', !!stageSel);
stageSel.value = 'Quote Drafted'; change(stageSel);
await wait(200);
const stageCall = calls.find(c => c.kind === 'rfq-patch' && c.body.ref === 'RFQ-0001');
check('changing the stage patches the real RFQ via /api/rfqs', !!stageCall && stageCall.body.patch.status === 'Quote Drafted',
  JSON.stringify(stageCall));

calls.length = 0;
click(window.document.querySelector('.rp-del[data-ref="RFQ-0002"]'));
await wait(200);
const delCall = calls.find(c => c.kind === 'rfq-patch' && c.body.remove);
check('deleting an RFQ calls remove on the real endpoint', !!delCall && delCall.body.ref === 'RFQ-0002');
check('it is actually gone from the list now', !rfqs.some(r => r.ref === 'RFQ-0002'));

check('no console errors while any of this ran', pageErrors.length === 0, pageErrors.join(' | '));

const failed = results.filter(([, ok]) => !ok);
for (const [n, ok, x] of results) console.log((ok ? '  ok  ' : '  X   ') + n + (ok ? '' : '   [' + x + ']'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, of ${results.length}`);
process.exit(failed.length ? 1 : 0);
