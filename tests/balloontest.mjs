/* Balloon drawing, and the structured drawing-data list behind it.

   This is new work, not a repair: before it, reading a drawing produced
   `requirements` — a flat list mixing a bore diameter, a material grade and a
   plating spec into one column of prose, with no item numbers, so nothing
   could be balloon-numbered against it and nothing could be inspected from it.

   The things worth proving here are the ones that would be wrong quietly:
   a signed deviation printed with the wrong sign, a characteristic the AI
   could not place being silently dropped instead of listed, a balloon drawn
   outside the image, and the draft warning going missing from a sheet that
   somebody might hand to a customer. The AI reply below is deliberately
   awkward — a ± pair, an asymmetric pair, a limit read as a plain size, an
   unplaced characteristic, and a position beyond the edge of the sheet. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let rfqs = [
  { ref: 'RFQ-B001', name: 'Balloon Co', email: 'b@balloon.test', status: 'Received',
    createdAt: new Date().toISOString(), message: 'Shaft, 500 off',
    fileName: 'shaft.jpg', fileUrl: '/api/assets?id=drw1' }
];

/* What the reader is asked for, answered the way a model really answers it —
   fenced, with a line of prose in front, and with one entry the model admits
   it could not place. */
const AI_READING = 'Here is what I can read from the drawing.\n```json\n' + JSON.stringify({
  part: { number: 'SH-4410', name: 'Drive shaft', drawingNumber: 'D-4410', revision: 'C' },
  requirements: [
    { category: 'Quantity', requirement: '500 off', source: 'note', confidence: 'High' }
  ],
  characteristics: [
    { no: 1, type: 'Dimension', feature: 'Ø17.5 ground diameter', nominal: 17.5,
      upper: 0.01, lower: -0.01, unit: 'mm', gdt: '', spec: '', cls: 'CC',
      x: 32, y: 44, locationNote: 'left of centre' },
    { no: 2, type: 'Dimension', feature: 'Overall length', nominal: 120,
      upper: 0.3, lower: -0.1, unit: 'mm', gdt: '', spec: '', cls: '',
      x: 50, y: 88, locationNote: 'bottom dimension line' },
    { no: 3, type: 'GD&T', feature: 'Runout of Ø17.5 to datum A-B', nominal: null,
      upper: null, lower: null, gdt: '⌭0.05 A-B', spec: '', cls: 'SC',
      x: 118, y: 40, locationNote: 'feature control frame, right' },
    { no: 4, type: 'Material', feature: 'Material grade', nominal: null, upper: null, lower: null,
      gdt: '', spec: 'EN8D', cls: '', x: null, y: null, locationNote: 'title block' },
    { no: 5, type: 'Finish', feature: 'Surface finish on ground diameter', nominal: 0.8,
      upper: null, lower: null, unit: 'µm', gdt: '', spec: 'Ra 0.8 max', cls: '',
      x: 36, y: 30, locationNote: 'finish symbol' },
    /* hard against the top edge: offsetting the balloon upward as usual would
       put it off the sheet, so this one must go the other way */
    { no: 6, type: 'Note', feature: 'General tolerance ISO 2768-m', nominal: null,
      upper: null, lower: null, gdt: '', spec: 'ISO 2768-m', cls: '',
      x: 60, y: 5, locationNote: 'note above the title block' }
  ],
  criticalCharacteristics: ['Ø17.5 ground diameter'],
  missing: ['Heat treatment hardness is not stated'],
  notes: 'Title block partly obscured.'
}) + '\n```';

const calls = [];
let signedIn = false;
const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => pageErrors.push(e.message));
const dom = new JSDOM(html.replace(/<script src="\/(core|kpi|drawing-convert)\.js"><\/script>/g, ''),
  { runScripts: 'outside-only', url: 'https://example.test/idms.html', virtualConsole: vc });
const { window } = dom;
window.Element.prototype.scrollIntoView = function () {};

/* Every print opens its own window. Capture what gets written rather than
   asserting on a screen that never renders. */
const printed = [];
window.open = () => {
  const doc = { html: '', write(s) { this.html += s; }, close() {} };
  printed.push(doc);
  return { document: doc, print() {}, focus() {} };
};

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
  if (url.startsWith('/api/ai')) {
    calls.push({ kind: 'ai', prompt: body.prompt || '', maxTokens: body.maxTokens });
    return ok({ text: AI_READING });
  }
  if (url.startsWith('/api/content')) return ok({ data: {
    company: { legalName: 'Test Mfg' },
    costBase: { workingDays: 300, shiftsPerDay: 2, hoursPerShift: 8 },
    machines: [{ id: 'M1', name: 'CNC Turn', type: 'Turning' }],
    labourGrades: [{ id: 'L1', grade: 'CNC Operator' }],
    materials: [{ name: 'EN8 Bright Bar', grade: 'EN8', rate: 85, unit: 'kg' }],
    quoteCfg: { prefix: 'QTN', currencySymbol: '₹' }
  } });
  if (url.startsWith('/api/hr')) return ok({ employees: [], items: [] });
  if (url.startsWith('/api/settings')) return ok({ settings: {} });
  if (url.startsWith('/api/idms')) {
    if (url.includes('what=parts')) return ok({ parts: [] });
    if (url.includes('what=docs')) return ok({ docs: [] });
    if (url.includes('what=audit')) return ok({ audit: [] });
    if (url.includes('what=settings')) return ok({ settings: {} });
    return ok({});
  }
  if (url.startsWith('/api/rfqs')) {
    if (!opts.method || opts.method === 'GET') return ok({ rfqs });
    if (opts.method === 'PATCH') {
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
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, c, x) => results.push([n, !!c, x || '']);
const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(300);

click(window.document.querySelector('#menubar [data-s="rfq_pipeline"]'));
await wait(250);
click(window.document.querySelector('.rp-head[data-ref="RFQ-B001"]'));
await wait(200);

// ---------- the prompt actually asks for what the feature needs ----------
click(window.document.querySelector('.rp-read[data-ref="RFQ-B001"]'));
await wait(400);
const readPrompt = (calls.find(c => c.kind === 'ai') || {}).prompt || '';
check('the drawing prompt asks for a numbered characteristic list',
  /"characteristics"/.test(readPrompt));
check('it asks for GD&T as a callout of its own', /GD&T/.test(readPrompt));
check('it asks for the material grade and the finish spec as characteristics',
  /Material/.test(readPrompt) && /Finish/.test(readPrompt));
check('it asks for a position on the sheet so a balloon can be placed',
  /percentage across/.test(readPrompt));
check('it forbids guessing a position rather than leaving it unplaced',
  /null rather than guessing/.test(readPrompt));
check('it refuses to let the AI decide CC/SC itself',
  /do not decide this yourself/i.test(readPrompt));
check('the reading is given room to finish (more than the old 3000 tokens)',
  (calls.find(c => c.kind === 'ai') || {}).maxTokens >= 6000);

// ---------- the reading was stored, fenced reply and all ----------
const stored = rfqs[0].extract || {};
check('the fenced reply with prose in front of it still parsed',
  !stored.error && !!stored.part, stored.error || '');
check('all six characteristics were stored', (stored.characteristics || []).length === 6);

// ---------- the on-screen drawing data table ----------
const detail = $('rp-list').textContent;
check('the Drawing data section is shown with its count',
  /Drawing data — 6 characteristic\(s\)/.test(detail), detail.slice(0, 200));
check('a GD&T callout is shown as read, not reworded', detail.includes('⌭0.05 A-B'));
check('the material grade appears as a characteristic in its own right',
  detail.includes('EN8D'));
check('the finish spec appears as a characteristic in its own right',
  detail.includes('Ra 0.8 max'));
check('a symmetric tolerance prints as ± once, not as +x/-x',
  /17\.5 ±0\.01 mm/.test(detail), (detail.match(/17\.5[^|]{0,18}/) || [''])[0]);
check('an asymmetric tolerance keeps both signs the right way round',
  /120 \+0\.3\/-0\.1 mm/.test(detail), (detail.match(/120[^|]{0,18}/) || [''])[0]);
check('the screen says the reading is the AI\'s and must be checked',
  /check it against the drawing/i.test($('rp-list').innerHTML));
check('the one unplaced characteristic is counted on screen',
  /1 of these could not be placed/.test(detail));

// ---------- the balloon drawing ----------
check('a Balloon drawing button is offered once there are characteristics',
  !!window.document.querySelector('.rp-balloon[data-ref="RFQ-B001"]'));
printed.length = 0;
click(window.document.querySelector('.rp-balloon[data-ref="RFQ-B001"]'));
await wait(150);
const bl = (printed[0] || {}).html || '';
check('the balloon drawing opened a printable sheet', bl.length > 500);
check('it shows the customer\'s own drawing image', bl.includes('/api/assets?id=drw1'));
check('it draws a balloon for each characteristic it could place',
  (bl.match(/class="bl-b/g) || []).length === 5, String((bl.match(/class="bl-b/g) || []).length));
check('the unplaced characteristic gets NO balloon', !/>4<\/span>/.test(bl));
/* A balloon drawn inside a viewBox stretched to the image's aspect comes out
   as an oval — fat on a landscape sheet. The balloons are sized in px for
   exactly that reason, so this checks the px circle rather than an SVG shape. */
check('a balloon is a real circle, not squashed by the image aspect',
  /\.bl-b\{[^}]*width:22px;height:22px;[^}]*border-radius:50%/.test(bl));
/* The AI is asked for the position of the callout itself, so a balloon drawn
   there hides the dimension it numbers — the title block read "MAT( 4 )D"
   instead of EN8D until this was fixed. */
check('a balloon is offset clear of the callout rather than drawn over it',
  /left:32%;top:35%/.test(bl), (bl.match(/left:32%;top:[0-9.]+%/) || [''])[0]);
check('a leader line joins the balloon back to the point it came from',
  (bl.match(/class="bl-l"/g) || []).length === 5);
check('an offset that would run off the top of the sheet goes downward instead',
  /left:60%;top:14%/.test(bl), (bl.match(/left:60%;top:[0-9.]+%/) || [''])[0]);
check('...but is listed underneath by number, not dropped',
  /could not be placed on the drawing/.test(bl) && /<b>4<\/b> — Material grade/.test(bl));
/* A balloon at x=118 would otherwise be drawn off the right-hand edge of the
   sheet, where it is invisible and reads as a missing characteristic. */
check('a position beyond the edge of the sheet is pulled back onto it',
  /left:97%/.test(bl) && !/left:118%/.test(bl), (bl.match(/left:[0-9.]+%;top:[0-9.]+%/g)||[]).join(' '));
check('a critical characteristic is drawn differently from an ordinary one',
  /bl-b bl-cc/.test(bl) && /bl-b bl-sc/.test(bl));
check('the balloon numbers match the table numbers',
  />1<\/span>/.test(bl) && />3<\/span>/.test(bl));
check('the sheet carries the draft warning in full',
  /Draft — read by AI, not yet verified/.test(bl));
check('the sheet names the part, drawing and revision', /D-4410/.test(bl) && /Rev C/.test(bl));
check('the sheet carries the company name from the profile, not a hard-coded one',
  /Test Mfg/.test(bl));

// ---------- the drawing data sheet on its own ----------
printed.length = 0;
click(window.document.querySelector('.rp-ddprint[data-ref="RFQ-B001"]'));
await wait(150);
const dd = (printed[0] || {}).html || '';
check('Print drawing data opens a report', dd.length > 500);
check('it lists every characteristic including the unplaced one',
  /Ø17\.5 ground diameter/.test(dd) && /Material grade/.test(dd));
check('it carries what the drawing does not state, for clarification',
  /Heat treatment hardness is not stated/.test(dd));
check('it carries the same draft warning', /Draft — read by AI, not yet verified/.test(dd));

check('no console errors while any of this ran', pageErrors.length === 0, pageErrors.join(' | '));

const pass = results.filter(r => r[1]).length;
results.forEach(([n, c, x]) => console.log((c ? '  ok  ' : '  FAIL') + '  ' + n + (c || !x ? '' : '  [' + x + ']')));
console.log('\n' + pass + ' passed, ' + (results.length - pass) + ' failed, of ' + results.length);
process.exit(results.length - pass ? 1 : 0);
