/* The AI's reply, and what happens when it is not JSON.

   This suite exists because of one live failure that took two rounds to
   understand. The costing screen said:

     "The AI answered, but not in the shape the costing needs. It said:
      ```json { "material": { "name": "EN24 Alloy Steel", "grade": "EN24
      (817M40)", "stockForm": "Bright Bar", "stockSize": "Ø30 mm × 3000 mm",
      "cutLength": "120 mm (..."

   — and every character of that preview was valid JSON. The fault was
   further in than the preview reached, so there was no way to tell from the
   screen what had actually gone wrong. Two things came out of it, and both
   are pinned below.

   A. parseAiJson had to learn the bare words a model writes into a numeric
      schema — NaN, Infinity, undefined — and the unquoted keys of a
      JavaScript object literal. Hardening a character scanner is exactly the
      kind of change that breaks a neighbouring case silently, so the
      exponent checks here are not padding: the first version of the fix
      lifted the `e` out of 1e3 and quoted it, turning a good number into
      invalid JSON. That was caught by a test, not by reading the code.

   B. The reply itself is now kept and put on screen. A preview that stops
      before the fault is worse than nothing, because it looks like evidence.

   Half A drives the parser. Half B drives the real costing button, with a
   model answering something that genuinely cannot be repaired, and checks
   the reply reaches the screen. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi  = fs.readFileSync('kpi.js', 'utf8');

const results = [];
const check = (n, c, x) => results.push([n, !!c, x === undefined ? '' : String(x)]);
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ============================ Half A: the parser ============================ */
const plain = new JSDOM('<!doctype html><html><body></body></html>',
  { runScripts: 'outside-only', url: 'https://example.test/' });
plain.window.eval(core);
const P = plain.window.Core.parseAiJson;
const C = plain.window.Core;

const parses = s => { try { return { ok: true, v: P(s) }; } catch (e) { return { ok: false, why: e.message }; } };

/* --- the live failure, as close to the real reply as it can be written --- */
const liveReply = '```json\n' + `{
  "material": { "name": "EN24 Alloy Steel", "grade": "EN24 (817M40)",
    "stockForm": "Bright Bar", "stockSize": "Ø30 mm × 3000 mm",
    "cutLength": "120 mm", "finishWeight": 0.52, "blankWeight": 0.66,
    "rate": 142, "prepCostPerPart": NaN },
  "operations": [{ "op": 10, "process": "Turn", "setupMin": 45, "cycleMin": 3.2 }],
  "inspectionMinPerPart": 1.5, "notes": ""
}` + '\n```';
const live = parses(liveReply);
check('the reply that failed on the live site now parses', live.ok, live.why);
check('…and the field that broke it reads as "no value", not as a crash',
  live.ok && live.v.material.prepCostPerPart === null,
  live.ok && JSON.stringify(live.v.material.prepCostPerPart));
check('…while everything around it survives untouched',
  live.ok && live.v.material.grade === 'EN24 (817M40)' && live.v.material.rate === 142 &&
  live.v.operations[0].cycleMin === 3.2,
  live.ok && JSON.stringify(live.v.material.grade));

/* --- the rest of the bare-word family --- */
const inf = parses('{"life": Infinity, "wear": -Infinity, "note": undefined, "ok": true, "no": false, "n": null}');
check('Infinity becomes null', inf.ok && inf.v.life === null, inf.why);
check('-Infinity becomes null, not the "-null" a naive fix produces',
  inf.ok && inf.v.wear === null, inf.ok && JSON.stringify(inf.v.wear));
check('undefined becomes null', inf.ok && inf.v.note === null);
check('true, false and null are still literals, not strings',
  inf.ok && inf.v.ok === true && inf.v.no === false && inf.v.n === null,
  inf.ok && JSON.stringify([inf.v.ok, inf.v.no, inf.v.n]));

/* --- a JavaScript object literal, which models produce constantly --- */
const lit = parses('{ material: { grade: "EN24", rate: 142 }, confidence: High }');
check('unquoted keys are quoted', lit.ok && lit.v.material && lit.v.material.grade === 'EN24', lit.why);
check('a bare word used as a value becomes the string it was meant to be',
  lit.ok && lit.v.confidence === 'High', lit.ok && JSON.stringify(lit.v.confidence));

/* --- the regression the hardening itself introduced --- */
const exp = parses('{"a": 1e3, "b": 2.5E-4, "c": -1.5e+2, "d": 1E6}');
check('an exponent is part of the number, not a bare word (1e3)',
  exp.ok && exp.v.a === 1000, exp.ok ? JSON.stringify(exp.v) : exp.why);
check('…in every spelling of it (2.5E-4, -1.5e+2, 1E6)',
  exp.ok && exp.v.b === 0.00025 && exp.v.c === -150 && exp.v.d === 1000000,
  exp.ok && JSON.stringify([exp.v.b, exp.v.c, exp.v.d]));

/* --- an unescaped quote inside a string --- */
/* The SECOND live failure, and a different one: "Expected ',' or '}' after
   property value in JSON at position 5669". A drawing is full of inch marks
   and quoted callouts, so the model writes them into a string without
   escaping, the string ends early, and the rest of the text sits where JSON
   wants a comma. Not a truncated reply, not the model ignoring the format —
   one character several thousand in, which is why it was invisible. */
const inch = parses('{"material":{"stockSize":"Bar 1/2" dia x 3000 mm","rate":142},"ok":true}');
check('an inch mark inside a value no longer ends the string early',
  inch.ok && inch.v.material.stockSize === 'Bar 1/2" dia x 3000 mm', inch.ok ? JSON.stringify(inch.v) : inch.why);
check('…and everything after it survives', inch.ok && inch.v.material.rate === 142 && inch.v.ok === true);
const cls = parses('{"spec":"M34 x 0.75 "H" class thread","no":16}');
check('a quoted callout in the middle of a value is kept whole',
  cls.ok && cls.v.spec === 'M34 x 0.75 "H" class thread', cls.ok ? JSON.stringify(cls.v.spec) : cls.why);
const arr = parses('{"bom":[{"item":"3/4" hex bar","qty":1},{"item":"plate","qty":2}]}');
check('…including inside an array, where it used to swallow the rest',
  arr.ok && arr.v.bom.length === 2 && arr.v.bom[0].item === '3/4" hex bar',
  arr.ok ? JSON.stringify(arr.v) : arr.why);
/* The one risk of that rule: a genuinely missing comma looks like an embedded
   quote. It is told apart by what follows — "key": is a new member, not text. */
const nocomma = parses('{"a":"x" "b":"y"}');
check('a missing comma between members is repaired rather than merged into one string',
  nocomma.ok && nocomma.v.a === 'x' && nocomma.v.b === 'y',
  nocomma.ok ? JSON.stringify(nocomma.v) : nocomma.why);
/* …and a real closing quote must still close. These are the followers that
   prove it did not start escaping everything. */
const closers = parses('{ "a" : "b" , "c" : [ "d" , "e" ] , "f" : { "g" : "h" } }');
check('a real closing quote still closes, before , } ] and :',
  closers.ok && closers.v.a === 'b' && closers.v.c.length === 2 && closers.v.f.g === 'h',
  closers.ok ? JSON.stringify(closers.v) : closers.why);

/* --- the words must not be touched where they are legitimate text --- */
const str = parses('{"notes": "NaN is not a number and undefined behaviour is Infinity worse", "x": 1}');
/* --- a unit written after a number ---
   The live error, second time round: "Expected ',' or '}' after property value
   in JSON at position 5669". The parser read the number and then found its unit
   sitting after it. An estimator's schema is forty numeric fields and a model
   answering it writes the unit in about one field in twenty:

     "cutLength": 120 mm        "rate": 142/kg        "scrapPct": 5 %

   This was made WORSE by an earlier fix of mine here, not merely left alone:
   the guard that protects exponents (1e3) skipped the bare-word branch for ANY
   letter following a number, so a unit went straight through untouched. The
   guard now asks whether it is really an exponent — adjacent, e or E, followed
   by a digit — and anything else is taken as part of the value. */
const unit = parses('{"cutLength": 120 mm, "rate": 142, "note": "ok"}');
check('a unit written after a number no longer breaks the reply',
  unit.ok, unit.why);
check('…and the number keeps its unit rather than losing it',
  unit.ok && unit.v.cutLength === '120 mm', unit.ok && JSON.stringify(unit.v.cutLength));
check('…while the fields around it are untouched',
  unit.ok && unit.v.rate === 142 && unit.v.note === 'ok', unit.ok && JSON.stringify(unit.v));
[['142/kg', '{"rate": 142/kg}', 'rate'], ['5 %', '{"scrapPct": 5 %}', 'scrapPct'],
 ['0.52 approx', '{"weight": 0.52 approx}', 'weight'], ['60 deg', '{"angle": 60 deg}', 'angle'],
 ['500 to 800', '{"life": 500 to 800}', 'life']].forEach(([label, src, key]) => {
  const r = parses(src);
  check('…and in every other spelling of it: ' + label,
    r.ok && r.v[key] === label, r.ok ? JSON.stringify(r.v[key]) : r.why);
});
/* Every consumer of a numeric field runs it through C.num, so a value that
   arrives as "142/kg" still costs at 142 rather than zero. That is why the run
   is kept as a string instead of the unit being thrown away. */
check('a value that kept its unit still reads as its number downstream',
  C.num('142 per kg') === 142 && C.num('120 mm') === 120 && C.num('0.52 approx') === 0.52,
  [C.num('142 per kg'), C.num('120 mm'), C.num('0.52 approx')].join(' '));
/* Several bare words in a row are ONE value. Quoting each on its own — which is
   what the previous version did — produced "High" "Carbon" "Steel", three
   strings in a row, which is not JSON either. */
const words = parses('{"material": High Carbon Steel, "x": 1}');
check('several bare words in a row become one string, not three',
  words.ok && words.v.material === 'High Carbon Steel', words.ok ? JSON.stringify(words.v) : words.why);

check('the same words inside a string are left exactly as written',
  str.ok && str.v.notes === 'NaN is not a number and undefined behaviour is Infinity worse',
  str.ok ? JSON.stringify(str.v.notes) : str.why);

/* --- everything the parser already did must still work --- */
const olds = [
  ['a fenced block', '```json\n{"a":1}\n```', v => v.a === 1],
  ['a real newline inside a string', '{"a":"line one\nline two"}', v => v.a === 'line one\nline two'],
  ['// comments', '{"a":1, // the first\n"b":2}', v => v.a === 1 && v.b === 2],
  ['/* */ comments', '{"a":1, /* aside */ "b":2}', v => v.b === 2],
  ['prose after the closing brace', '{"a":1}\nI have assumed a sand casting.', v => v.a === 1],
  ['single-quoted strings', "{'a':'EN8'}", v => v.a === 'EN8'],
  ['trailing commas', '{"a":1,"b":[1,2,],}', v => v.b.length === 2],
  ['a truncated reply', '{"name":"Turn","ops":[{"op":10,"time":', v => v.name === 'Turn']
];
olds.forEach(([what, src, good]) => {
  const r = parses(src);
  check('still handled: ' + what, r.ok && good(r.v), r.ok ? JSON.stringify(r.v) : r.why);
});

/* --- and a reply that is genuinely beyond repair must still say so --- */
const bad = parses('I am not able to cost this part without the drawing.');
check('a reply with no JSON in it at all is rejected, not guessed at',
  !bad.ok && /no JSON/i.test(bad.why), bad.ok ? 'parsed!' : bad.why);
const broke = parses('{"material":{"name":"EN24"]}');
check('a structurally broken reply is rejected rather than silently half-read',
  !broke.ok, broke.ok ? JSON.stringify(broke.v) : broke.why);
/* The two failures need different fixes — a reply cut off at the token limit
   means the part is too big to plan in one pass, while invalid JSON means the
   model ignored the format — so the message has to distinguish them. Calling a
   broken reply "cut off" sent everyone to Re-plan route, which fixes only one. */
check('a broken reply is not described as a cut-off one',
  !broke.ok && /not valid JSON/.test(broke.why) && !/cut off/i.test(broke.why), broke.why);

/* ==================== Half B: the reply reaches the screen ==================== */
let rfqs = [{ ref: 'RFQ-9001', name: 'Alpha Co', email: 'buyer@acme.test', status: 'Received',
  createdAt: new Date().toISOString(), message: 'Need 500 off', qty: 500 }];
const calls = [];
let signedIn = false;
const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => pageErrors.push(e.message));
const dom = new JSDOM(html.replace(/<script src="\/(core|kpi|drawing-convert)\.js"><\/script>/g, ''),
  { runScripts: 'outside-only', url: 'https://example.test/idms.html', virtualConsole: vc });
const { window } = dom;
window.Element.prototype.scrollIntoView = function () {};

let aiReply = '';
window.fetch = async (path, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : {};
  const url = String(path);
  const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
  if (url.startsWith('/api/ai')) return ok({ text: aiReply });
  if (url.startsWith('/api/auth')) {
    if (body.action === 'login') { signedIn = true; return ok({ token: 'T', user: 'tester', role: 'developer' }); }
    if (body.action === 'session') return signedIn ? ok({ user: 'tester', role: 'developer' })
      : { ok: false, status: 401, json: async () => ({ error: 'Not signed in' }) };
    return ok({});
  }
  if (url.startsWith('/api/content')) return ok({ data: {
    company: { legalName: 'Test Mfg' },
    costBase: { workingDays: 300, shiftsPerDay: 2, hoursPerShift: 8, downtimePct: 15, powerTariff: 8.5,
      factoryRent: 150000, factoryArea: 5000, factoryOverhead: 200000, adminPct: 8, financePct: 2,
      scrapPct: 3, contingencyPct: 2, profitPct: 15 },
    machines: [{ id: 'M1', name: 'CNC Turn', type: 'Turning', cost: 2800000, lifeYears: 10, salvage: 250000,
      kw: 11, loadFactor: 55, area: 90, maintenance: 90000, operators: 1 }],
    labourGrades: [{ id: 'L1', grade: 'CNC Operator', wage: 28000, statutoryPct: 22, paidDays: 26, hoursPerDay: 8 }],
    materials: [{ name: 'EN8 Bright Bar', grade: 'EN8', rate: 85, unit: 'kg', density: 7.85 }],
    quoteCfg: { prefix: 'QTN', nextSeq: 1, seqPad: 4, currencySymbol: '₹', taxPercent: 18 }
  } });
  if (url.startsWith('/api/hr')) return ok({ employees: [], items: [] });
  if (url.startsWith('/api/settings')) return ok({ settings: {} });
  if (url.startsWith('/api/idms')) return ok({ parts: [], docs: [], audit: [], settings: {}, counters: [] });
  if (url.startsWith('/api/rfqs')) {
    if (!opts.method || opts.method === 'GET') return ok({ rfqs });
    if (opts.method === 'PATCH') {
      calls.push({ body });
      const i = rfqs.findIndex(r => r.ref === body.ref);
      if (i >= 0) rfqs[i] = Object.assign({}, rfqs[i], body.patch || {});
      return ok({ rfq: rfqs[i] });
    }
    return ok({});
  }
  return ok({});
};

window.eval(core); window.eval(kpi);
window.eval(html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1]);

const $ = id => window.document.getElementById(id);
const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(300);
click(window.document.querySelector('#menubar [data-s="rfq_pipeline"]'));
await wait(250);

/* a reply that cannot be repaired even after the hardening above — the model
   closed an object with the wrong bracket. Long enough that the old
   160-character preview would have stopped before the fault, which is the
   whole point. */
const UNREPAIRABLE = '{"material":{"name":"EN24 Alloy Steel","grade":"EN24 (817M40)",' +
  '"stockForm":"Bright Bar","stockSize":"30 mm dia x 3000 mm","cutLength":"120 mm",' +
  '"finishWeight":0.52,"blankWeight":0.66,"rate":142,"prepCostPerPart":18]}';
aiReply = UNREPAIRABLE;

const expand = () => {
  if (!window.document.querySelector('.rp-cost[data-ref="RFQ-9001"]')) {
    const head = window.document.querySelector('.rp-head[data-ref="RFQ-9001"]');
    if (head) click(head);
  }
};
expand();
await wait(200);
const costBtn = window.document.querySelector('.rp-cost[data-ref="RFQ-9001"]');
check('the costing button is on the row', !!costBtn);
calls.length = 0;
click(costBtn);
await wait(500);

const saved = (calls.find(c => c.body.patch && c.body.patch.costing) || {}).body;
const cs = saved && saved.patch.costing;
check('a failed costing is recorded against the RFQ rather than lost', !!cs,
  JSON.stringify(calls).slice(0, 200));
check('the stored failure carries the reply that caused it', !!(cs && cs.parseFail),
  cs && JSON.stringify(Object.keys(cs)));
check('…the whole reply, not a preview of it',
  cs && cs.parseFail && cs.parseFail.reply === UNREPAIRABLE,
  cs && cs.parseFail && (cs.parseFail.reply || '').length + ' of ' + UNREPAIRABLE.length);
check('…with the character count, so a truncated reply is recognisable as one',
  cs && cs.parseFail && cs.parseFail.chars === UNREPAIRABLE.length,
  cs && cs.parseFail && String(cs.parseFail.chars));
check('…and what the parser itself objected to',
  cs && cs.parseFail && /JSON/.test(cs.parseFail.why || ''),
  cs && cs.parseFail && cs.parseFail.why);
check('…and when it happened', cs && cs.parseFail && !!cs.parseFail.at, cs && cs.parseFail && cs.parseFail.at);
check('the message sends the reader to the reply instead of straight to Re-plan',
  cs && /what the AI actually sent/i.test(cs.error || ''), cs && cs.error);

await wait(250);
expand();
await wait(250);
const pane = window.document.getElementById('rp-list').innerHTML;
check('the reply is on screen, behind a disclosure rather than in the way',
  /<details/.test(pane) && /What the AI actually sent/.test(pane));
check('…the disclosure says how much there is to read',
  new RegExp(UNREPAIRABLE.length + ' characters').test(pane),
  (pane.match(/What the AI actually sent[^<]*/) || [''])[0]);
check('…and the reply itself is really rendered, not just referred to',
  pane.includes('EN24 (817M40)') && pane.includes('prepCostPerPart'),
  pane.includes('EN24 (817M40)') + '/' + pane.includes('prepCostPerPart'));
/* The live screenshot showed this button stuck on "Planning…" with the error
   printed beneath it, so there was no way to try again without reloading. */
const after = window.document.querySelector('.rp-cost[data-ref="RFQ-9001"]');
check('the button is given back, not left reading "Planning…"',
  after && !/Planning/i.test(after.textContent) && !after.disabled, after && after.textContent);
check('…and it invites another go', after && /try again/i.test(after.textContent), after && after.textContent);

/* a later failure of a different kind must not inherit the last reply */
aiReply = '';
calls.length = 0;
click(window.document.querySelector('.rp-cost[data-ref="RFQ-9001"]'));
await wait(500);
const cs2 = ((calls.find(c => c.body.patch && c.body.patch.costing) || {}).body || {}).patch;
check('a failure with no reply at all is reported as that',
  cs2 && /did not answer|no response/i.test(cs2.costing.error || ''), cs2 && cs2.costing.error);
check('…and does not show the previous reply as if it were this one',
  cs2 && !cs2.costing.parseFail, cs2 && JSON.stringify(cs2.costing.parseFail || null));

check('no console errors throughout', pageErrors.length === 0, pageErrors.join(' | '));

const pass = results.filter(r => r[1]).length;
results.forEach(([n, c, x]) => console.log((c ? '  ok  ' : '  x   ') + ' ' + n + (c || !x ? '' : '   [' + x + ']')));
console.log('\n' + pass + ' passed, ' + (results.length - pass) + ' failed, of ' + results.length);
process.exit(results.length - pass ? 1 : 0);
