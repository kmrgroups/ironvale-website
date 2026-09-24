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
  { ref: 'RFQ-0001', name: 'Alpha Co', email: 'buyer@acme.test', status: 'Received', createdAt: daysAgo(10), message: 'Need a quote' },
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
  if (url.startsWith('/api/content')) return ok({ data: {
    company: { legalName: 'Test Mfg', phone: '044-2345 6789', rfqEmail: 'sales@testmfg.test' },
    quoteSender: 'Marketing Team',
    costBase: { workingDays: 300, shiftsPerDay: 2, hoursPerShift: 8, downtimePct: 15, powerTariff: 8.5,
      factoryRent: 150000, factoryArea: 5000, factoryOverhead: 200000, adminPct: 8, financePct: 2,
      scrapPct: 3, contingencyPct: 2, profitPct: 15 },
    machines: [{ id: 'M1', name: 'CNC Turn', type: 'Turning', cost: 2800000, lifeYears: 10, salvage: 250000,
      kw: 11, loadFactor: 55, area: 90, maintenance: 90000, operators: 1 }],
    labourGrades: [{ id: 'L1', grade: 'CNC Operator', wage: 28000, statutoryPct: 22, paidDays: 26, hoursPerDay: 8 }],
    /* leadTimeDays is what makes a real lead time quotable: 7 days for this
       material to come in, plus the works' own 14-day production allowance
       below, is 21 — and 21 is what the quotation must say instead of the
       "[x]" a model wrote into its covering prose. */
    materials: [{ name: 'EN8 Bright Bar', grade: 'EN8', rate: 85, unit: 'kg', density: 7.85, leadTimeDays: 7 }],
    quoteCfg: { prefix: 'QTN', numberFormat: '{PREFIX}-{YYYY}-{SEQ}', nextSeq: 7, seqPad: 4,
      currencySymbol: '₹', validityDays: 30, leadTimeDays: 14, showTax: true, taxLabel: 'GST', taxPercent: 18,
      paymentTerms: '50% advance' }
  } });
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
/* the stage selector now lives inside the expandable detail, so open it first —
   Phase 2 moved per-RFQ controls off the collapsed row */
click(window.document.querySelector('.rp-head[data-ref="RFQ-0001"]'));
await wait(150);
const stageSel = window.document.querySelector('.rp-stage[data-ref="RFQ-0001"]');
check('a stage selector is offered per RFQ', !!stageSel);
stageSel.value = 'Quote Drafted'; change(stageSel);
await wait(200);
const stageCall = calls.find(c => c.kind === 'rfq-patch' && c.body.ref === 'RFQ-0001');
check('changing the stage patches the real RFQ via /api/rfqs', !!stageCall && stageCall.body.patch.status === 'Quote Drafted',
  JSON.stringify(stageCall));

calls.length = 0;
click(window.document.querySelector('.rp-head[data-ref="RFQ-0002"]'));
await wait(150);
click(window.document.querySelector('.rp-del[data-ref="RFQ-0002"]'));
await wait(200);
const delCall = calls.find(c => c.kind === 'rfq-patch' && c.body.remove);
check('deleting an RFQ calls remove on the real endpoint', !!delCall && delCall.body.ref === 'RFQ-0002');
check('it is actually gone from the list now', !rfqs.some(r => r.ref === 'RFQ-0002'));

// ---------- Phase 2: costing computed from OUR rates, not the AI's ----------
calls.length = 0;
let aiPrompts = [];
const realFetch2 = window.fetch;
window.fetch = async (path, opts) => {
  if (String(path).startsWith('/api/ai')) {
    const b = opts && opts.body ? JSON.parse(opts.body) : {};
    aiPrompts.push(b.prompt || '');
    // a realistic route reply — note it supplies NO machine/labour prices
    return { ok: true, status: 200, json: async () => ({ ok: true, text: JSON.stringify({
      material: { name: 'EN8 Bright Bar', grade: 'EN8', blankWeight: 1.2, finishWeight: 0.9, rate: 999, source: 'Market estimate' },
      operations: [{ op: 10, process: 'Turn', machineType: 'Turning', setupMin: 60, cycleMin: 4.5, labourGrade: 'CNC Operator' }],
      tooling: [], consumables: [], packaging: { costPerPart: 0 }, freight: { costPerPart: 0 },
      specialProcesses: [], inspectionMinPerPart: 1, assumptions: ['Bar stock available'], notes: ''
    }) }) };
  }
  return realFetch2(path, opts);
};
click(window.document.querySelector('.rp-head[data-ref="RFQ-0001"]'));
await wait(150);
click(window.document.querySelector('.rp-cost[data-ref="RFQ-0001"]'));
await wait(350);
const costCall = calls.find(c => c.kind === 'rfq-patch' && c.body.patch && c.body.patch.costing);
check('costing is saved against the RFQ', !!costCall, JSON.stringify(calls).slice(0, 250));
const savedCost = costCall && costCall.body.patch.costing;
check('the material rate comes from OUR price book (85), not the AI\'s figure (999)',
  savedCost && savedCost.material.rate === 85, savedCost && String(savedCost.material.rate));
check('the price source records that it came from the company price book',
  savedCost && /price book/i.test(savedCost.material.rateSource));
check('the AI\'s machine type was matched to a real machine of ours',
  savedCost && savedCost.operations[0].machineId === 'M1');
check('the prompt tells the AI not to price machine time, labour or overhead',
  /Do NOT price machine time, labour or overhead/.test(aiPrompts.join('')));
check('the prompt lists only our real machines',
  /CNC Turn \| type: Turning/.test(aiPrompts.join('')));

// ---------- Phase 2: quotation drafted from the computed cost ----------
await wait(200);
calls.length = 0;
aiPrompts = [];
window.fetch = async (path, opts) => {
  if (String(path).startsWith('/api/ai')) {
    const b = opts && opts.body ? JSON.parse(opts.body) : {};
    aiPrompts.push(b.prompt || '');
    return { ok: true, status: 200, json: async () => ({ ok: true, text: 'We are pleased to quote for the component as detailed.' }) };
  }
  return realFetch2(path, opts);
};
/* the costing save reloads the list, which leaves the row expanded already —
   clicking the header again would collapse it, so only expand if needed */
if (!window.document.querySelector('.rp-quote[data-ref="RFQ-0001"]')){
  click(window.document.querySelector('.rp-head[data-ref="RFQ-0001"]'));
  await wait(200);
}
const quoteBtn = window.document.querySelector('.rp-quote[data-ref="RFQ-0001"]');
check('a quotation can be drafted once costed', !!quoteBtn);
click(quoteBtn);
await wait(350);
const quoteCall = calls.find(c => c.kind === 'rfq-patch' && c.body.patch && c.body.patch.quoteDoc);
check('the quotation is saved against the RFQ', !!quoteCall, JSON.stringify(calls).slice(0, 250));
const q = quoteCall && quoteCall.body.patch.quoteDoc;
check('the quotation number follows our configured format and sequence',
  q && q.number === 'QTN-' + new Date().getFullYear() + '-0007', q && q.number);
check('tax is applied at our configured rate, not one the AI chose', q && q.taxPct === 18);
check('the total is subtotal plus that tax',
  q && Math.abs(q.total - (q.subtotal + q.subtotal * 0.18)) < 0.011,
  q && (q.subtotal + ' -> ' + q.total));

/* ---------- the printed line must multiply out to the printed subtotal ----------
   It did not. The unit price was rounded to whole rupees while the subtotal
   came from the unrounded line total, so a real quotation printed
   500 × ₹164.00 = ₹82,000.00 above a subtotal of ₹82,097.00 — ₹97 appearing
   nowhere on the page, on the one document that goes to a customer and the
   one a customer actually checks. Only rendering the document showed it. */
check('the unit price keeps its paise rather than being rounded to whole rupees',
  q && Math.round(q.unitPrice * 100) === q.unitPrice * 100 && q.unitPrice % 1 !== 0,
  q && String(q.unitPrice));
check('quantity × unit price equals the subtotal exactly, as the customer will check',
  q && Math.abs(q.qty * q.unitPrice - q.subtotal) < 0.005,
  q && (q.qty + ' x ' + q.unitPrice + ' = ' + (q.qty * q.unitPrice) + ', subtotal ' + q.subtotal));

check('prose from the AI IS used as the covering note',
  q && /pleased to quote/.test(String(q.body || '')), q && String(q.body || '').slice(0, 60));

/* ---------- a stray model reply never rides out on the customer's copy ----------
   Whatever came back was printed verbatim, so a quotation was seen carrying
   {"coveringNote":"…","leadTimeDays":21} above its terms — on the one document
   that leaves the company. Driven here with a model that really answers in
   JSON, rather than asserted against a mock that cannot produce the fault. */
{
  calls.length = 0;
  window.fetch = async (path, opts) => {
    if (String(path).startsWith('/api/ai'))
      return { ok: true, status: 200, json: async () => ({ ok: true,
        text: '```json\n{"coveringNote":"Thank you for the enquiry.","leadTimeDays":21}\n```' }) };
    return realFetch2(path, opts);
  };
  const again = window.document.querySelector('.rp-quote[data-ref="RFQ-0001"]');
  if (again) { click(again); await wait(400); }
  const jc = calls.find(c => c.kind === 'rfq-patch' && c.body.patch && c.body.patch.quoteDoc);
  const jq = jc && jc.body.patch.quoteDoc;
  check('a JSON reply is dropped rather than printed as the covering note',
    jq && !String(jq.body || '').trim(), jq && String(jq.body || '').slice(0, 70));
  check('…and the quotation is still drafted, with its price and terms intact',
    jq && jq.total > 0 && /50% advance/.test(jq.paymentTerms || ''),
    jq && String(jq.total));
}
/* A real quotation went out reading "Best regards, [Your Name], [Company
   Name]" above the figures, with the company's own signature added
   underneath it — the model had written its own sign-off and nobody had told
   it not to. The prompt now says so, and the reply is stripped as well,
   because an instruction is a request and this is the part that holds. */
{
  calls.length = 0;
  const signOffPrompts = [];
  window.fetch = async (path, opts) => {
    if (String(path).startsWith('/api/ai')) {
      const b = opts && opts.body ? JSON.parse(opts.body) : {};
      signOffPrompts.push(b.prompt || '');
      return { ok: true, status: 200, json: async () => ({ ok: true, text:
        'Thank you for your enquiry. We confirm receipt and are reviewing feasibility.\n\n' +
        'Best regards,\n[Your Name]\n[Company Name]\nSales Department' }) };
    }
    return realFetch2(path, opts);
  };
  const b4 = window.document.querySelector('.rp-quote[data-ref="RFQ-0001"]');
  if (b4) { click(b4); await wait(400); }
  const sc = calls.find(c => c.kind === 'rfq-patch' && c.body.patch && c.body.patch.quoteDoc);
  const sq = sc && sc.body.patch.quoteDoc;
  check('the AI is told not to sign off or use placeholders — the signature is ours to add',
    /Do NOT write a greeting, a sign-off/.test(signOffPrompts.join('')) &&
    /\[Your Name\]/.test(signOffPrompts.join('')),
    (signOffPrompts[0] || '').slice(-200));
  check('a model that signs off anyway has its sign-off stripped',
    sq && !/Best regards/i.test(String(sq.body || '')), sq && String(sq.body || ''));
  check('…and its unfilled placeholders with it',
    sq && !/\[Your Name\]/.test(String(sq.body || '')) &&
    !/\[Company Name\]/.test(String(sq.body || '')), sq && String(sq.body || ''));
  check('while the real covering prose survives',
    sq && /confirm receipt and are reviewing feasibility/.test(String(sq.body || '')),
    sq && String(sq.body || ''));
}

/* ---------- the default mail body, and the "[x]" that reached a customer ----------
   Reported from a live deployment with the Gmail screenshot: the quotation
   email carried a Subject: line inside its own body, a second "Dear Raja,"
   under the real one, "Lead time: [x] weeks", and "Total: ₹2,799.8" — a
   money figure a rupee-and-eighty-paise short of being readable. All four are
   in one place, the builder, so they are checked together here on the text
   that Send actually uses: the live textarea, not a rebuild of it. */
{
  calls.length = 0;
  /* The customer's drawing, so the mail has a real one to link to. Set here
     rather than in the fixture at the top: RFQ-0001 is the "received and
     never touched" case the triage checks above depend on, and giving it an
     attachment up there would change what triage says about it. */
  rfqs.find(r => r.ref === 'RFQ-0001').fileUrl = '/api/assets?id=drw-0001';
  /* A model writing the whole email rather than the body paragraphs it was
     asked for — subject line, greeting, sign-off, template hole and all.
     This is the reply shape that produced the screenshot. */
  window.fetch = async (path, opts) => {
    if (String(path).startsWith('/api/ai'))
      return { ok: true, status: 200, json: async () => ({ ok: true, text:
        'Subject: Quotation for your enquiry\n\n' +
        'Dear Raja,\n\n' +
        'We are pleased to offer the following for your requirement.\n' +
        'Lead time: [X] weeks from receipt of order.\n\n' +
        'Best regards,\n[Your Name]\n[Company Name]' }) };
    return realFetch2(path, opts);
  };
  const b5 = window.document.querySelector('.rp-quote[data-ref="RFQ-0001"]');
  if (b5) { click(b5); await wait(400); }
  const mailBox = window.document.querySelector('.rp-maildraft[data-ref="RFQ-0001"]');
  check('the mail draft is rebuilt for the fresh quotation', !!mailBox);
  const draft = mailBox ? mailBox.value : '';

  check('the model\'s own Subject: line does not survive into the body',
    !/^Subject:/mi.test(draft), draft.slice(0, 120));
  check('there is exactly one greeting, not the model\'s as well as ours',
    (draft.match(/^Dear /gm) || []).length === 1, JSON.stringify((draft.match(/^Dear .*/gm) || [])));
  check('no unfilled template hole reaches the customer anywhere in the mail',
    !/\[[^\]\n]{1,60}\]/.test(draft), (draft.match(/\[[^\]\n]{1,60}\]/) || [])[0]);
  check('the model\'s sign-off is gone and ours is the only one',
    !/Best regards/i.test(draft) && /Marketing Team/.test(draft), draft.slice(-200));
  check('the prose the model was actually asked for survives',
    /pleased to offer the following/.test(draft), draft.slice(0, 200));

  /* Lead time: a real figure, from the matched material's 7 days plus the
     works' own 14-day allowance. Not a placeholder, and not silence either —
     silence is what the old builder gave, because q.leadTime was a field
     nothing on this side ever wrote. */
  check('the mail quotes a real lead time worked out from the price book and our allowance',
    /Lead time: 21 days from receipt of your purchase order/.test(draft),
    (draft.match(/Lead time:[^\n]*/) || [])[0]);
  const lq = (calls.find(c => c.kind === 'rfq-patch' && c.body.patch && c.body.patch.quoteDoc) || {});
  check('…and it is stamped onto the quotation, so a later change of allowance cannot rewrite it',
    lq.body && /^21 days/.test(String(lq.body.patch.quoteDoc.leadTime || '')),
    lq.body && JSON.stringify(lq.body.patch.quoteDoc.leadTime));

  check('the mail carries the reference and the quotation number',
    /Reference: RFQ-0001/.test(draft) && /Quotation No: QTN-/.test(draft), draft.slice(0, 300));
  check('it links the customer to the quotation itself and to their own drawing',
    /Quotation \(view, print or save as PDF\): https?:\/\/[^\s]+#quote\?ref=/.test(draft) &&
    /Your drawing on file: /.test(draft),
    (draft.match(/^(Quotation \(|Your drawing)[^\n]*/gm) || []).join(' | '));
  check('the signature is last, after the links and the closing line',
    draft.lastIndexOf('Marketing Team') > draft.lastIndexOf('Your drawing on file'),
    String(draft.lastIndexOf('Marketing Team')) + ' vs ' + String(draft.lastIndexOf('Your drawing on file')));
}

/* The covering paragraph is allowed to be absent — the AI can be down, and a
   reply that is JSON, a refusal, or nothing but placeholders is now stripped
   to nothing. What must never happen is the mail opening straight onto a
   price table, which is exactly what stripping introduced. */
{
  calls.length = 0;
  window.fetch = async (path, opts) => {
    if (String(path).startsWith('/api/ai'))
      return { ok: true, status: 200, json: async () => ({ ok: true,
        text: 'I cannot help with that request.' }) };
    return realFetch2(path, opts);
  };
  const b6 = window.document.querySelector('.rp-quote[data-ref="RFQ-0001"]');
  if (b6) { click(b6); await wait(400); }
  const ec = calls.find(c => c.kind === 'rfq-patch' && c.body.patch && c.body.patch.quoteDoc);
  check('a refusal is dropped, leaving no covering note at all',
    ec && !String(ec.body.patch.quoteDoc.body || '').trim(),
    ec && JSON.stringify(ec.body.patch.quoteDoc.body));
  const bare = window.document.querySelector('.rp-maildraft[data-ref="RFQ-0001"]');
  const bt = bare ? bare.value : '';
  check('the mail still opens with a sentence of our own rather than a bare price table',
    /Thank you for your enquiry RFQ-0001\. We are pleased to submit our quotation/.test(bt),
    bt.split('\n\n')[1]);
  check('…and that opening comes before the numbers, not after them',
    bt.indexOf('Thank you for your enquiry') < bt.indexOf('Unit price:'),
    bt.slice(0, 200));
}

check('our payment terms are carried onto the quotation', q && /50% advance/.test(q.paymentTerms));
check('the AI was asked for covering text only, and told not to restate the price',
  /Do not restate the price/.test(aiPrompts.join('')));

// ---------- item 6 of the same round: the mail draft is editable, with an AI rewrite ----------
{
  window.confirm = () => true; // an unmocked confirm() logs a jsdom "not implemented" error
  const ta = window.document.querySelector('.rp-maildraft[data-ref="RFQ-0001"]');
  check('the quotation panel offers an editable mail draft', !!ta);
  const preFill = ta ? ta.value : '';
  check('a freshly drafted quote pre-fills the draft from the same text Send would build',
    /^Dear Alpha Co,/.test(preFill), preFill.slice(0, 40));
  check('the pre-filled draft carries the reference and quotation number',
    /Reference: RFQ-0001/.test(preFill) && /Quotation No: QTN-/.test(preFill));
  check('the pre-filled draft carries the full signature block',
    /Marketing Team/.test(preFill) && /Test Mfg/.test(preFill) &&
    /044-2345 6789/.test(preFill) && /sales@testmfg\.test/.test(preFill));
  check('the pre-filled draft carries the customer’s view-quotation link',
    /\/#quote\?ref=RFQ-0001&t=/.test(preFill), preFill.slice(-200));

  /* leaving the box saves quietly — no reload, so a person's place mid-edit
     is never lost under them */
  calls.length = 0;
  ta.value = 'CUSTOM EDITED DRAFT — hand-typed by staff.';
  ta.dispatchEvent(new window.Event('blur'));
  await wait(150);
  const saveCall = calls.find(c => c.kind === 'rfq-patch' && c.body.patch && c.body.patch.quoteDoc);
  check('leaving the box patches the hand edit onto the quotation',
    !!saveCall && saveCall.body.patch.quoteDoc.mailDraft === 'CUSTOM EDITED DRAFT — hand-typed by staff.',
    JSON.stringify(saveCall && saveCall.body.patch.quoteDoc.mailDraft));
  check('saving the draft does not redraw the list out from under the person editing it',
    window.document.querySelector('.rp-maildraft[data-ref="RFQ-0001"]') === ta);
  check('a quiet confirmation appears next to this RFQ',
    /Draft saved/.test($('rp-msg-RFQ-0001').textContent));

  /* "Rewrite professionally with AI" — keeps every fact, only reworks the wording */
  calls.length = 0;
  const rewritePrompts = [];
  window.fetch = async (path, opts) => {
    if (String(path).startsWith('/api/ai')) {
      const b = opts && opts.body ? JSON.parse(opts.body) : {};
      rewritePrompts.push(b.prompt || '');
      return { ok: true, status: 200, json: async () => ({ ok: true,
        text: 'Dear Alpha Co,\n\nRewritten in polished business English.\n\nRegards,\nMarketing Team' }) };
    }
    return realFetch2(path, opts);
  };
  const rewriteBtn = window.document.querySelector('.rp-rewrite[data-ref="RFQ-0001"]');
  check('a rewrite button sits next to the draft', !!rewriteBtn);
  click(rewriteBtn);
  await wait(250);
  check('the AI was handed exactly what was in the box, not a freshly rebuilt draft',
    rewritePrompts.join('').includes('CUSTOM EDITED DRAFT — hand-typed by staff.'));
  check('the AI was told to keep every fact and change only the wording',
    /Keep every fact exactly as given/.test(rewritePrompts.join('')));
  check('the rewritten text replaces the box',
    ta.value === 'Dear Alpha Co,\n\nRewritten in polished business English.\n\nRegards,\nMarketing Team');
  const rewriteSaveCall = calls.find(c => c.kind === 'rfq-patch' && c.body.patch && c.body.patch.quoteDoc);
  check('the rewrite is saved the same quiet way a hand edit is',
    !!rewriteSaveCall && rewriteSaveCall.body.patch.quoteDoc.mailDraft === ta.value);

  /* an empty box is refused without ever reaching the AI */
  calls.length = 0; rewritePrompts.length = 0;
  ta.value = '   ';
  click(rewriteBtn);
  await wait(150);
  check('rewriting an empty draft never calls the AI', rewritePrompts.length === 0);
  check('…and says so next to the RFQ', /Nothing in the box/.test($('rp-msg-RFQ-0001').textContent));

  /* Send uses exactly what is on screen — edited, rewritten or untouched —
     never a copy silently rebuilt behind the person's back */
  ta.value = 'FINAL SEND TEXT — this exact sentence must reach the customer, nothing regenerated.';
  calls.length = 0;
  const sendBodies = [];
  window.fetch = async (path, opts) => {
    if (String(path).startsWith('/api/notify')) {
      sendBodies.push(opts && opts.body ? JSON.parse(opts.body) : {});
      return { ok: true, status: 200, json: async () => ({ ok: true, results: ['EMAIL SENT to buyer@acme.test'] }) };
    }
    return realFetch2(path, opts);
  };
  click(window.document.querySelector('.rp-send[data-ref="RFQ-0001"]'));
  await wait(300);
  check('sending uses the live text in the box, byte for byte, not a regenerated copy',
    !!sendBodies[0] && sendBodies[0].payload.text ===
      'FINAL SEND TEXT — this exact sentence must reach the customer, nothing regenerated.',
    sendBodies[0] && sendBodies[0].payload.text);

  /* Redraft starts the box over — a new quotation document must not carry the
     last hand edit or AI rewrite forward as if it were still current */
  calls.length = 0;
  window.fetch = async (path, opts) => {
    if (String(path).startsWith('/api/ai'))
      return { ok: true, status: 200, json: async () => ({ ok: true, text: 'Fresh redraft covering text, never seen before.' }) };
    return realFetch2(path, opts);
  };
  if (!window.document.querySelector('.rp-quote[data-ref="RFQ-0001"]')){
    click(window.document.querySelector('.rp-head[data-ref="RFQ-0001"]'));
    await wait(200);
  }
  click(window.document.querySelector('.rp-quote[data-ref="RFQ-0001"]'));
  await wait(350);
  const redraftCall = calls.find(c => c.kind === 'rfq-patch' && c.body.patch && c.body.patch.quoteDoc);
  check('a redraft saves a genuinely new quotation document', !!redraftCall, JSON.stringify(calls).slice(0, 200));
  check('…carrying no leftover hand-edited or rewritten draft',
    !!redraftCall && redraftCall.body.patch.quoteDoc.mailDraft === undefined,
    redraftCall && JSON.stringify(redraftCall.body.patch.quoteDoc.mailDraft));
  const ta2 = window.document.querySelector('.rp-maildraft[data-ref="RFQ-0001"]');
  check('so the box on screen starts over from the new draft, not the old one',
    !!ta2 && !ta2.value.includes('FINAL SEND TEXT') && !ta2.value.includes('Rewritten in polished'),
    ta2 && ta2.value.slice(0, 60));
  check('…built from the freshly drafted covering text',
    !!ta2 && ta2.value.includes('Fresh redraft covering text, never seen before.'));
}

// ---------- sending the quotation to the customer ----------
calls.length = 0;
let notifyBodies = [];
let notifyOk = true;
window.fetch = async (path, opts) => {
  if (String(path).startsWith('/api/notify')) {
    notifyBodies.push(opts && opts.body ? JSON.parse(opts.body) : {});
    return { ok: true, status: 200, json: async () => ({ ok: true,
      results: notifyOk ? ['EMAIL SENT to buyer@acme.test'] : ['EMAIL FAILED: no API key'] }) };
  }
  return realFetch2(path, opts);
};
if (!window.document.querySelector('.rp-send[data-ref="RFQ-0001"]')){
  click(window.document.querySelector('.rp-head[data-ref="RFQ-0001"]'));
  await wait(200);
}
/* a send is gated behind a confirm() — prove that refusing it sends nothing */
window.confirm = () => false;
click(window.document.querySelector('.rp-send[data-ref="RFQ-0001"]'));
await wait(200);
check('declining the confirmation sends nothing at all', notifyBodies.length === 0);

window.confirm = () => true;
click(window.document.querySelector('.rp-send[data-ref="RFQ-0001"]'));
await wait(300);
check('confirming sends through /api/notify', notifyBodies.length === 1, JSON.stringify(notifyBodies));
const sentBody = notifyBodies[0] || {};
check('it is addressed to the customer on the enquiry',
  sentBody.payload && sentBody.payload.to === 'buyer@acme.test', JSON.stringify(sentBody.payload && sentBody.payload.to));
check('the subject carries the quotation number',
  sentBody.payload && /QTN-/.test(sentBody.payload.subject), sentBody.payload && sentBody.payload.subject);
check('the body carries the total, not just the covering text',
  sentBody.payload && /Total:/.test(sentBody.payload.text));
check('the body carries our payment terms',
  sentBody.payload && /50% advance/.test(sentBody.payload.text));
/* items 3+4 of the balloon/RFQ feedback round: the sender must be a real,
   complete signature (team, company, phone, email from Company Profile —
   never a bare name), and it must read at the END of the mail, after the
   covering text and the numbers, not stitched in ahead of them. */
{
  const mail = sentBody.payload.text;
  check('it opens with a greeting to the customer',
    /^Dear /.test(mail), mail.slice(0, 40));
  check('the signature names the sender, the company, a number and an email',
    /Marketing Team/.test(mail) && /Test Mfg/.test(mail) &&
    /044-2345 6789/.test(mail) && /sales@testmfg\.test/.test(mail),
    mail.slice(-160));
  const totalAt = mail.indexOf('Total:');
  const signAt = mail.indexOf('Marketing Team');
  check('the covering text and the numbers both come before the signature',
    totalAt > -1 && signAt > -1 && totalAt < signAt,
    'Total: @' + totalAt + ' Marketing Team @' + signAt);
  check('the mail reads as paragraphs, not one run-on block',
    /\n\n/.test(mail), JSON.stringify(mail.slice(0, 120)));
}
const sentCall = calls.find(c => c.kind === 'rfq-patch' && c.body.patch && c.body.patch.quoteDoc);
check('the quotation is marked as sent, with who and when',
  sentCall && sentCall.body.patch.quoteDoc.sentAt && sentCall.body.patch.quoteDoc.sentTo === 'buyer@acme.test');
check('a successful send moves the stage to Approved & Sent',
  sentCall && sentCall.body.patch.status === 'Approved & Sent', sentCall && sentCall.body.patch.status);
/* item 5 of the same round: there is no server-side PDF pipeline on either
   channel, so what the customer actually gets is a link to view/print the
   quotation — and that link must carry an unguessable token, never just
   the reference, since references are often close to sequential. */
const quoteToken = sentCall && sentCall.body.patch.quoteDoc.publicToken;
check('sending stamps the quotation with a public view token',
  !!quoteToken && quoteToken.length >= 16, quoteToken);
check('the mail links to the public quote-view page with that exact token',
  sentBody.payload && sentBody.payload.text.includes('/#quote?ref=RFQ-0001&t=' + quoteToken),
  sentBody.payload && sentBody.payload.text);

/* "Send again" must reuse the same link rather than quietly breaking one
   already forwarded or bookmarked. */
calls.length = 0; notifyBodies = [];
if (!window.document.querySelector('.rp-send[data-ref="RFQ-0001"]')){
  click(window.document.querySelector('.rp-head[data-ref="RFQ-0001"]'));
  await wait(200);
}
click(window.document.querySelector('.rp-send[data-ref="RFQ-0001"]'));
await wait(300);
const againCall = calls.find(c => c.kind === 'rfq-patch' && c.body.patch && c.body.patch.quoteDoc);
check('sending again keeps the same public token',
  againCall && againCall.body.patch.quoteDoc.publicToken === quoteToken,
  JSON.stringify([quoteToken, againCall && againCall.body.patch.quoteDoc.publicToken]));

/* a refusal from the server must surface, not be swallowed as success */
calls.length = 0; notifyBodies = []; notifyOk = false;
if (!window.document.querySelector('.rp-send[data-ref="RFQ-0001"]')){
  click(window.document.querySelector('.rp-head[data-ref="RFQ-0001"]'));
  await wait(200);
}
click(window.document.querySelector('.rp-send[data-ref="RFQ-0001"]'));
await wait(300);
check('a failed send is reported, not silently treated as sent',
  /Not sent/.test($('rp-msg-RFQ-0001').textContent), $('rp-msg-RFQ-0001').textContent);
check('a failed send does not mark the quotation as sent',
  !calls.some(c => c.kind === 'rfq-patch' && c.body.patch && c.body.patch.quoteDoc));
window.fetch = realFetch2;

/* ---------- money is C.rate, never C.qty ----------
   C.qty keeps three decimals and drops a trailing zero, so 2799.80 prints as
   "₹2,799.8" — which is exactly what the reporter's screenshot showed on the
   Total line. The figures are set here rather than taken from whatever the
   costing happens to produce, because a cost that lands on two non-zero paise
   passes under either formatter and proves nothing: every value below ends in
   a zero paise or has none at all, which is the case that tells them apart. */
{
  const g3 = rfqs.find(r => r.ref === 'RFQ-0003');
  /* This is a quotation ALREADY ON FILE — drafted before any of this round's
     work, which is the case the reporter is actually looking at. So it keeps
     the model's untidy covering note verbatim and carries no leadTime field
     at all, because nothing on this side ever wrote one. Both are cleaned and
     filled at render time, not only at draft time; a fix that only ran when a
     quotation was newly drafted would leave every existing one exactly as it
     was on the screenshot. */
  g3.costing = { material: { grade: 'SS304', leadDays: 10 } };
  g3.quoteDoc = { number: 'QTN-2026-0003', createdAt: '01/09/2026',
    qty: 500, unitPrice: 4.70, subtotal: 2350, taxLabel: 'GST', taxPct: 18,
    tax: 423, total: 2773, currencySymbol: '₹', validityDays: 30,
    partLine: 'SHAFT · DRG-77',
    body: 'Subject: Quotation QTN-2026-0003\n\nDear Gamma Inc,\n\n' +
      'We are pleased to offer the below against your enquiry.\n' +
      'Lead time: [x] weeks.\n\nBest regards,\n[Your Name]\n[Company Name]' };
  /* away and back, so the screen reloads from the server and picks the
     amended record up the way it would in use */
  nav('dashboard'); await wait(200);
  nav('rfq_pipeline'); await wait(350);
  const sel = $('rp-filter');
  if (sel) { sel.value = ''; change(sel); await wait(150); }
  click(window.document.querySelector('.rp-head[data-ref="RFQ-0003"]'));
  await wait(200);
  const box = window.document.querySelector('.rp-maildraft[data-ref="RFQ-0003"]');
  check('the sent quotation still offers its mail draft', !!box);
  const t = box ? box.value : '';
  check('a unit price of 4.70 prints as ₹4.70, not ₹4.7',
    /Unit price: ₹4\.70$/m.test(t), (t.match(/Unit price:[^\n]*/) || [])[0]);
  check('a whole-rupee subtotal still prints its paise',
    /Subtotal: ₹2,350\.00$/m.test(t), (t.match(/Subtotal:[^\n]*/) || [])[0]);
  check('so does the tax line',
    /GST @ 18%: ₹423\.00$/m.test(t), (t.match(/GST @ 18%:[^\n]*/) || [])[0]);
  check('and the total — the line a customer reads first',
    /Total: ₹2,773\.00$/m.test(t), (t.match(/Total:[^\n]*/) || [])[0]);

  /* the same record proves the two render-time fixes, because it is the
     "already on file" case they exist for */
  check('a quotation already on file has the model\'s Subject: line cleaned off when it is sent',
    !/^Subject:/mi.test(t), t.slice(0, 120));
  check('…and its duplicate greeting, its sign-off and its placeholders',
    (t.match(/^Dear /gm) || []).length === 1 && !/Best regards/i.test(t) &&
    !/\[[^\]\n]{1,60}\]/.test(t),
    JSON.stringify([(t.match(/^Dear .*/gm) || []), (t.match(/\[[^\]\n]{1,60}\]/) || [])[0]]));
  check('…while the sentence the customer is meant to read survives',
    /pleased to offer the below against your enquiry/.test(t), t.slice(0, 260));
  check('a lead time it never carried is worked out for it — 10 days material plus our 14',
    /Lead time: 24 days from receipt of your purchase order/.test(t),
    (t.match(/Lead time:[^\n]*/) || [])[0]);

  /* The printed quotation is the other half of the same report — the
     reporter saw "[x]" on the PDF as well as in the mail, and the two must
     never disagree about a commercial term anyway. Captured by standing in
     for the print window rather than by rebuilding the document here. */
  let printed = '';
  window.open = () => ({ document: { write: h => { printed += h; }, close(){} }, close(){} });
  click(window.document.querySelector('.rp-quoteprint[data-ref="RFQ-0003"]'));
  await wait(200);
  check('the quotation document is produced', printed.length > 500, String(printed.length));
  check('the printed quotation carries the same 24-day lead time as the mail',
    /Lead Time<\/th><td>24 days from receipt of your purchase order</.test(printed),
    (printed.match(/Lead Time<\/th><td>[^<]*/) || [])[0]);
  check('no unfilled template hole is printed on the customer\'s copy either',
    !/\[[^\]\n]{1,60}\]/.test(printed.replace(/<style[\s\S]*?<\/style>/g, '')),
    (printed.replace(/<style[\s\S]*?<\/style>/g, '').match(/\[[^\]\n]{1,60}\]/) || [])[0]);
  check('and the covering note on it is the prose, not the model\'s whole email',
    /pleased to offer the below against your enquiry/.test(printed) &&
    !/Best regards/i.test(printed),
    (printed.match(/class="notes">[^<]*/) || [])[0]);
}

check('no console errors while any of this ran', pageErrors.length === 0, pageErrors.join(' | '));

const failed = results.filter(([, ok]) => !ok);
for (const [n, ok, x] of results) console.log((ok ? '  ok  ' : '  X   ') + n + (ok ? '' : '   [' + x + ']'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, of ${results.length}`);
process.exit(failed.length ? 1 : 0);
