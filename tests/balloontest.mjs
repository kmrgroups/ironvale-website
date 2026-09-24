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

/* a well-formed reply that simply found nothing — not a parse failure */
const AI_NOTHING = JSON.stringify({ part:{}, requirements: [], characteristics: [],
  criticalCharacteristics: [], missing: ['The drawing could not be read'], notes: '' });
let AI_EMPTY = false;
/* set by the GOST/European section near the end, so that reading can be
   driven through the real reader rather than asserted against a rebuild */
let AI_OVERRIDE = null;
/* What the completeness pass answers. 'add' returns two genuinely new ones and
   one the first pass already had written differently (Ø vs "Dia"), which is
   the duplicate the merge has to catch itself rather than trust the model to
   have left out. */
/* 'none' for the body of this suite, so every existing check still describes
   one reading; the merge gets its own section below where it is switched on. */
let SECOND_MODE = 'none';
const AI_SECOND = JSON.stringify({ characteristics: [
  { no: 1, type: 'Dimension', feature: 'Chamfer 1 x 45 both ends', nominal: 1, upper: null, lower: null, unit: 'mm', x: 20, y: 70 },
  { no: 2, type: 'Finish', feature: 'Surface finish Ra 1.6 on bore', spec: 'Ra 1.6', x: 55, y: 30 },
  /* the same characteristic the first pass already found, written the way a
     second look would write it. The merge has to recognise it, not the model. */
  { no: 3, type: 'Dimension', feature: 'Dia 17.5 ground diameter', nominal: 17.5, upper: 0.01, lower: -0.01, unit: 'mm', x: 32, y: 44 }
] });
/* real bytes, so the base64 the client produces can be checked against them */
const DRAWING_BYTES = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x2A, 0x7B]);
const DRAWING_B64 = Buffer.from(DRAWING_BYTES).toString('base64');
const ASSETS = {
  drw1: { mime: 'image/jpeg', bytes: DRAWING_BYTES },
  pdf1: { mime: 'application/pdf', bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) }
};
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
    /* the attachment is recorded, because THIS is the assertion whose absence
       let the drawing reader ship without ever sending a drawing */
    calls.push({ kind: 'ai', prompt: body.prompt || '', maxTokens: body.maxTokens,
                 attachment: body.attachment, attachmentUrl: body.attachmentUrl });
    /* The reading is now TWO calls: the extraction, then a check of that
       extraction for what it missed. They are told apart by the prompt,
       because that is the only thing that distinguishes them in real life. */
    if (/for COMPLETENESS/.test(body.prompt || '')) {
      if (SECOND_MODE === 'fail') return { ok: true, status: 200, json: async () => ({ ok: false, error: 'provider timed out' }) };
      if (SECOND_MODE === 'none') return ok({ text: '{"characteristics":[]}' });
      return ok({ text: AI_SECOND });
    }
    return ok({ text: AI_OVERRIDE || (AI_EMPTY ? AI_NOTHING : AI_READING) });
  }
  /* the stored drawing, served the way /api/assets really serves it: raw
     bytes, not JSON. The client fetches this and base64s it itself. */
  if (url.startsWith('/api/assets?id=')) {
    const id = url.split('id=')[1];
    const a = ASSETS[id];
    if (!a) return { ok: false, status: 404, blob: async () => { throw new Error('not found'); } };
    return { ok: true, status: 200, blob: async () => new window.Blob([a.bytes], { type: a.mime }) };
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
const aiCall = calls.find(c => c.kind === 'ai') || {};
const readPrompt = aiCall.prompt || '';
/* the completeness pass is a second call with its own prompt, and it has to
   carry the same number rules — a correction that reads 1,6 as sixteen puts
   the misreading back in on the way out */
const secondPrompt = ((calls.filter(c => c.kind === 'ai' && /for COMPLETENESS/.test(c.prompt || ''))[0]) || {}).prompt || '';

/* ---------- the drawing actually reaches the AI ----------
   This is the assertion whose absence caused everything else. The reader
   called C.callAI with `attachmentUrl`, which Core.callAI does not read, and
   with a URL string where /api/ai wants {b64, mime}. So a vision model was
   handed a prompt and no image and answered with empty arrays, which the
   screen reported as "nothing could be read from this drawing".

   Every earlier test of this chain mocked the AI reply — stubbing out
   precisely the step that was broken — so the whole feature could pass its
   tests while never once sending a drawing. These four checks look at what
   left the browser, not at what came back. */
check('the drawing is sent to the AI at all', !!aiCall.attachment,
  'attachment=' + String(JSON.stringify(aiCall.attachment)) +
  ' attachmentUrl=' + String(JSON.stringify(aiCall.attachmentUrl)));
check('…under the key Core.callAI actually reads, not attachmentUrl',
  aiCall.attachment !== undefined && aiCall.attachmentUrl === undefined);
/* String(...) not JSON.stringify(...).slice — JSON.stringify(undefined) is
   undefined, not '"undefined"', so the diagnostic threw and took the whole
   suite down instead of reporting the failure it exists to catch. A harness
   has to survive the very case it is testing for. */
check('…as the {b64, mime} shape /api/ai expects, not a URL string',
  aiCall.attachment && typeof aiCall.attachment === 'object' &&
  typeof aiCall.attachment.b64 === 'string' && aiCall.attachment.mime === 'image/jpeg',
  String(JSON.stringify(aiCall.attachment)).slice(0, 90));
check('…carrying the real bytes of the stored file, bit for bit',
  aiCall.attachment && aiCall.attachment.b64 === DRAWING_B64,
  'got ' + String(aiCall.attachment && aiCall.attachment.b64) + ', want ' + DRAWING_B64);
/* the KEY, not the word — the comment above rfqDrawingSrc() explains the bug
   by name and should go on saying it */
check('no code passes attachmentUrl as an option any more',
  !/attachmentUrl\s*:/.test(html.replace(/\/\*[\s\S]*?\*\//g, '')));

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

/* Four misreadings off one real drawing, all of them about how the figure is
   printed rather than what it says. The prompt is one half of the answer and
   the code below is the other — an instruction is a request. */
check('the prompt says a comma is a decimal point, not a thousands separator',
  /A COMMA IS A DECIMAL POINT/.test(readPrompt) && /"1,6" is one point six/.test(readPrompt),
  (readPrompt.match(/A COMMA[^\n]{0,90}/) || [])[0]);
check('it says a deviation printed below the line is a MINUS deviation',
  /BELOW THE LINE IS NEGATIVE/.test(readPrompt) && /lower \n?-?0?\.?16|lower -0\.16/.test(readPrompt),
  (readPrompt.match(/BELOW THE LINE[^\n]{0,120}/) || [])[0]);
check('it says a fit class stays with the characteristic rather than being dropped',
  /FIT CLASS IS PART OF THE CHARACTERISTIC/.test(readPrompt) && /⌀6H7/.test(readPrompt));
check('it names the GD&T symbols so ⊥ is not reported as concentricity',
  /⊥ PERPENDICULARITY/.test(readPrompt) && /never concentricity/.test(readPrompt),
  (readPrompt.match(/⊥[^\n]{0,60}/) || [])[0]);
check('it tells the reader to work every view, section and detail before answering',
  /every view, every section, every detail/.test(readPrompt));
check('the completeness pass is told the same number rules, not just the first pass',
  /a comma is a decimal point/.test(secondPrompt) && /is the lower one and is MINUS/.test(secondPrompt) &&
  /⊥ is perpendicularity/.test(secondPrompt),
  secondPrompt.slice(-260));
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
/* Where a balloon ENDS UP is decided in the print window once the sheet has
   loaded and its real pixel size is known — offsetting, spreading the balloons
   apart and drawing the leaders all need that measurement, and jsdom has none.
   The geometry is checked in balloonlayouttest.mjs, in a real browser.

   What this suite checks is the contract the markup has to honour for that
   pass to be possible at all: the callout point is carried on each balloon as
   data, and the pass that uses it is actually in the document. */
check('each balloon carries the point on the sheet it is about',
  (bl.match(/data-cx="/g) || []).length === 5 && (bl.match(/data-cy="/g) || []).length === 5,
  (bl.match(/data-cx="[0-9.]+" data-cy="[0-9.]+"/g) || []).join(' '));
check('the callout point is the AI\u2019s own reading, carried through unrounded',
  /data-cx="32" data-cy="44"/.test(bl), (bl.match(/data-cx="32"[^>]*/) || [''])[0]);
check('the layout pass that places them is in the printed document',
  /getAttribute\("data-cx"\)/.test(bl) && /class="bl-l"/.test(bl));
check('…and it runs on load, on a cached image, and again before printing',
  /img\.complete&&img\.naturalWidth/.test(bl) && /addEventListener\("load",run\)/.test(bl) &&
  /beforeprint/.test(bl));
check('the sheet says a balloon position is a reading and not a measurement',
  /not a measurement/.test(bl) && /follow each leader/.test(bl));
check('...but is listed underneath by number, not dropped',
  /could not be placed on the drawing/.test(bl) && /<b>4<\/b> — Material grade/.test(bl));
/* A balloon at x=118 is off the right-hand edge of the sheet, where it is
   invisible and reads as a missing characteristic. The markup clamps the
   CALLOUT onto the sheet; the layout pass then keeps the balloon inside it. */
check('a callout beyond the edge of the sheet is pulled back onto it',
  /data-cx="99"/.test(bl) && !/data-cx="118"/.test(bl),
  (bl.match(/data-cx="[0-9.]+"/g) || []).join(' '));
check('a drawing that will not load says so instead of showing bare balloons',
  /id="bl-noimg"/.test(bl) && /nothing to sit on/.test(bl));
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

/* ---------- when the reading comes back empty ----------
   The live deployment hit this: "Nothing could be read from this drawing." on a
   .jpg, with no link to the file and nothing saying what to do. Almost always
   the file is the problem — a photo of a screen, a faint scan, the wrong page —
   and until the attachment was a link there was no way to check that from here. */
{
  AI_EMPTY = true;
  click(window.document.querySelector('.rp-read[data-ref="RFQ-B001"]'));
  await wait(450);
  const empty = $('rp-list').innerHTML;
  check('an empty reading says the file is the likely cause, not just "nothing"',
    /found nothing it could quote from/.test(empty), empty.slice(0, 120));
  check('…and names the things actually worth checking',
    /photo of a screen/.test(empty) && /wrong\s*\n?\s*page/.test(empty.replace(/\s+/g, ' ')));
  check('…and says a PDF or CAD file has to be converted first',
    /converted to an image/.test(empty));
  check('the attachment is a link, so the file itself can be opened and checked',
    /<a href="\/api\/assets\?id=drw1"[^>]*target="_blank"/.test(empty), '');
  AI_EMPTY = false;
}

/* ---------- both halves of the platform store the drawing differently ----------
   The website inlines it on the RFQ record as a data: URL (`fileDataUrl`);
   the IDMS form puts it in the assets table and keeps a link (`fileUrl`).
   Neither side read the other's field, so a website enquiry opened in the
   IDMS had no attachment at all — no link, no balloon drawing, and a reader
   that had nothing to fetch. Both shapes must work: there are already
   enquiries on file in each. */
{
  rfqs.push({ ref: 'RFQ-WEB1', name: 'Website Co', email: 'w@web.test', status: 'Received',
    createdAt: new Date().toISOString(), message: 'From the public form',
    fileName: 'web-drawing.jpg',
    fileDataUrl: 'data:image/jpeg;base64,' + DRAWING_B64 });
  click(window.document.querySelector('#menubar [data-s="rfq_pipeline"]'));
  await wait(300);
  click(window.document.querySelector('.rp-head[data-ref="RFQ-WEB1"]'));
  await wait(200);
  check('a website-submitted enquiry shows its attachment as a link',
    /web-drawing\.jpg/.test($('rp-list').innerHTML));
  calls.length = 0;
  click(window.document.querySelector('.rp-read[data-ref="RFQ-WEB1"]'));
  await wait(450);
  const webCall = calls.find(c => c.kind === 'ai') || {};
  check('…and its inlined drawing reaches the AI as bytes, same as a linked one',
    webCall.attachment && webCall.attachment.b64 === DRAWING_B64,
    'got ' + String(webCall.attachment && webCall.attachment.b64));
}

/* ---------- a PDF is refused, not sent and reported as an empty reading ----------
   The reader is given images. Sending a PDF and then saying "nothing could be
   read" sent everyone looking at the drawing when the file type was the
   problem all along. */
{
  rfqs.push({ ref: 'RFQ-PDF1', name: 'Pdf Co', email: 'p@pdf.test', status: 'Received',
    createdAt: new Date().toISOString(), message: 'A PDF',
    fileName: 'drawing.pdf', fileUrl: '/api/assets?id=pdf1' });
  click(window.document.querySelector('#menubar [data-s="rfq_pipeline"]'));
  await wait(300);
  click(window.document.querySelector('.rp-head[data-ref="RFQ-PDF1"]'));
  await wait(200);
  calls.length = 0;
  click(window.document.querySelector('.rp-read[data-ref="RFQ-PDF1"]'));
  await wait(450);
  check('a PDF is not sent to the AI at all', !calls.some(c => c.kind === 'ai'),
    String(calls.length) + ' call(s)');
  const pdfMsg = $('rp-list').innerHTML;
  check('…and the refusal names the file type rather than blaming the drawing',
    /application\/pdf/.test(pdfMsg) && /cannot look at/.test(pdfMsg), pdfMsg.slice(0, 160));
  check('…and points at the form that converts it', /New Enquiry/.test(pdfMsg));
}

/* ---------- a reference to a file that has gone missing ----------
   Exactly what Flush Data produced: the record still names the drawing, the
   bytes are gone. That must read as a storage problem, not an AI one. */
{
  rfqs.push({ ref: 'RFQ-GONE1', name: 'Gone Co', email: 'g@gone.test', status: 'Received',
    createdAt: new Date().toISOString(), message: 'missing file',
    fileName: 'lost.jpg', fileUrl: '/api/assets?id=nosuchasset' });
  click(window.document.querySelector('#menubar [data-s="rfq_pipeline"]'));
  await wait(300);
  click(window.document.querySelector('.rp-head[data-ref="RFQ-GONE1"]'));
  await wait(200);
  click(window.document.querySelector('.rp-read[data-ref="RFQ-GONE1"]'));
  await wait(450);
  check('a drawing whose file has gone says so as a storage problem',
    /could not be read back/.test($('rp-list').innerHTML),
    $('rp-list').innerHTML.slice(0, 160));
}

// ---------- the second look for what the first pass missed ----------
/* Asked for directly: the reading must list everything on the drawing. One
   pass does not — chamfers, radii, threads, finish symbols and written notes
   are what it drops, and a characteristic that was never extracted leaves no
   trace on the sheet, because nothing draws a balloon that does not exist.
   So the model is shown its own list and asked the narrower question. */
{
  /* the earlier sections left another row open, so this one is re-opened */
  const openB1 = async () => {
    click(window.document.querySelector('#menubar [data-s="rfq_pipeline"]'));
    await wait(300);
    if (!window.document.querySelector('.rp-read[data-ref="RFQ-B001"]')) {
      click(window.document.querySelector('.rp-head[data-ref="RFQ-B001"]'));
      await wait(250);
    }
  };
  SECOND_MODE = 'add';
  await openB1();
  calls.length = 0;
  click(window.document.querySelector('.rp-read[data-ref="RFQ-B001"]'));
  await wait(700);
  const ai = calls.filter(c => c.kind === 'ai');
  check('reading a drawing now takes a second look for what was missed', ai.length === 2,
    String(ai.length));
  const chk = ai[1] || {};
  check('…and the second look is given the drawing too, not just the list',
    !!(chk.attachment && chk.attachment.b64), JSON.stringify(Object.keys(chk.attachment || {})));
  check('…it is shown what was already found, so it is checking rather than extracting again',
    /ALREADY LISTED/.test(chk.prompt) && /Overall length/.test(chk.prompt));
  check('…and is pointed at what a first pass actually drops',
    /chamfers/i.test(chk.prompt) && /corner and fillet radii/i.test(chk.prompt) &&
    /surface finish symbols/i.test(chk.prompt) && /thread callouts/i.test(chk.prompt));
  check('…and told not to invent anything, same as the first pass',
    /NEVER invent anything that is not on the drawing/.test(chk.prompt));

  /* read back off the record the PATCH actually wrote, which is what a
     deployment would hold. The guard is not decoration: an earlier version of
     this block reached into an undefined result and CRASHED the suite instead
     of reporting the failure it existed to catch. */
  const ex = (rfqs.find(r => r.ref === 'RFQ-B001') || {}).extract || {};
  check('the reading is saved with both passes merged', !!ex.characteristics,
    JSON.stringify(Object.keys(ex)));
  const feats = (ex.characteristics || []).map(c => c.feature);
  check('everything the first pass found survives untouched',
    ['Ø17.5 ground diameter', 'Overall length', 'Runout of Ø17.5 to datum A-B',
     'Material grade', 'Surface finish on ground diameter', 'General tolerance ISO 2768-m']
      .every(f => feats.includes(f)), JSON.stringify(feats));
  check('…and what the second look found is added',
    feats.includes('Chamfer 1 x 45 both ends') && feats.includes('Surface finish Ra 1.6 on bore'),
    JSON.stringify(feats));
  /* The model was told not to repeat what was listed. It did anyway, written a
     different way — which is what models do, and why this is checked here and
     not left to the prompt. Two rows for one dimension means the part gets
     measured twice and the report carries a characteristic that never existed. */
  check('a characteristic returned twice in different words is merged, not listed twice',
    !feats.includes('Dia 17.5 ground diameter') &&
    feats.filter(f => /^(Ø|Dia )17\.5 ground diameter$/i.test(f)).length === 1,
    JSON.stringify(feats));
  check('…so exactly two were really added', feats.length === 8, String(feats.length));
  check('the numbers are rebuilt with no gap and no repeat',
    JSON.stringify(ex.characteristics.map(c => c.no)) === JSON.stringify([1,2,3,4,5,6,7,8]),
    JSON.stringify(ex.characteristics.map(c => c.no)));
  check('the screen says how many the first pass missed',
    /2 more found on a second look/.test($('rp-list').innerHTML),
    ($('rp-list').innerHTML.match(/[0-9]+ more found[^<]*/) || [''])[0]);

  /* A second look that adds nothing is a reading two looks agree on — worth
     saying, and not the same thing as one that never ran. */
  SECOND_MODE = 'none';
  await openB1();
  calls.length = 0;
  click(window.document.querySelector('.rp-read[data-ref="RFQ-B001"]'));
  await wait(700);
  check('a second look that finds nothing says so rather than staying silent',
    /nothing further was found/.test($('rp-list').innerHTML));

  /* The one that matters most. A completeness pass that can lose the reading
     is worse than no completeness pass, so a failure must leave the first
     reading exactly as it was — and must not be mistaken for a clean check. */
  SECOND_MODE = 'fail';
  await openB1();
  calls.length = 0;
  click(window.document.querySelector('.rp-read[data-ref="RFQ-B001"]'));
  await wait(700);
  const after = (rfqs.find(r => r.ref === 'RFQ-B001') || {}).extract || {};
  check('a failed second look leaves the first reading whole', !after.error &&
    (after.characteristics || []).length === 6,
    (after.error || '') + ' n=' + (after.characteristics || []).length);
  check('…and the part details survive it', (after.part || {}).drawingNumber === 'D-4410',
    JSON.stringify(after.part || null));
  check('…and the screen says this sheet has had only one look',
    /did not complete/.test($('rp-list').innerHTML) && /single reading/.test($('rp-list').innerHTML),
    ($('rp-list').innerHTML.match(/did not complete[^<]*/) || [''])[0]);
  SECOND_MODE = 'none';
}

// ---------- placing the balloons by hand ----------
/* The layout pass cannot make a wrong coordinate right, and rendering a real
   sheet showed a third of the balloons pointing into empty space. Somebody has
   to check this sheet against the drawing anyway; letting them drag is the only
   thing here that produces a sheet that is actually correct. */
{
  /* openB1 belongs to the block above, so this one opens the row itself */
  const openRow = async () => {
    click(window.document.querySelector('#menubar [data-s="rfq_pipeline"]'));
    await wait(300);
    if (!window.document.querySelector('.rp-place[data-ref="RFQ-B001"]')) {
      click(window.document.querySelector('.rp-head[data-ref="RFQ-B001"]'));
      await wait(250);
    }
  };
  await openRow();
  /* Mocked BEFORE the screen opens, not after: the default balloon offset and
     every leader are worked out from the sheet's real pixel box, so a sheet
     that measures 0x0 at draw time is not the case under test. jsdom lays
     nothing out, so this stands in for a rendered sheet. */
  const box = { left: 0, top: 0, width: 1000, height: 500 };
  $('rfq-place-sheet').getBoundingClientRect = () => box;
  const placeBtn = window.document.querySelector('.rp-place[data-ref="RFQ-B001"]');
  check('the enquiry offers a way to place the balloons by hand', !!placeBtn);
  click(placeBtn);
  await wait(250);
  const pane = $('rfq-place');
  check('…which opens on the enquiry\u2019s own drawing', pane.style.display !== 'none' &&
    /api\/assets\?id=drw1/.test($('rfq-place-img').src || ''),
    pane.style.display + ' ' + ($('rfq-place-img').src || ''));
  const sheet = $('rfq-place-sheet'), tray = $('rfq-place-tray');
  check('every placed characteristic is a draggable balloon',
    sheet.querySelectorAll('.pl-b').length === 5, String(sheet.querySelectorAll('.pl-b').length));
  /* The half no re-read can recover: a balloon that was never drawn cannot be
     noticed as missing on the sheet, so it has to be somewhere visible. */
  check('…and the one the AI could not place is in the tray, not lost',
    tray.querySelectorAll('.pl-t').length === 1 &&
    /Material grade/.test(tray.textContent), tray.textContent.trim().slice(0, 60));
  check('…and the screen says how many still need placing, out of how many total',
    /1 of 6 not placed/.test($('rfq-place-left').textContent), $('rfq-place-left').textContent);
  check('saving is offered only once something has moved', $('rfq-place-save').disabled);

  /* ---- the leader, and the two ends it now has ----
     A characteristic used to carry one x/y meaning both "where the feature is"
     and "where the number sits", which is why a balloon could only ever be ON
     its own callout. The ANCHOR stays where the AI read the callout; the
     BALLOON starts clear of it and is dragged wherever it reads best, and the
     line between them follows at any angle. */
  const b1 = sheet.querySelector('.pl-b[data-no="1"]');
  /* Null-safe on purpose: with no anchor at all — the model this replaced —
     every check below has to REPORT that, not crash the suite before the
     first of them runs. This harness has made that mistake twice before. */
  const a1 = sheet.querySelector('.pl-a[data-no="1"]') || { style: {}, dispatchEvent(){}, };
  check('every balloon has an anchor at the other end of its leader',
    sheet.querySelectorAll('.pl-a').length === 5, String(sheet.querySelectorAll('.pl-a').length));
  check('the anchor sits exactly where the AI said the callout was',
    a1.style.left === '32%' && a1.style.top === '44%', a1.style.left + ' ' + a1.style.top);
  check('…and the balloon starts clear of it rather than on top of it',
    b1.style.left !== a1.style.left || b1.style.top !== a1.style.top,
    b1.style.left + ' ' + b1.style.top + ' vs ' + a1.style.left + ' ' + a1.style.top);
  check('a leader is drawn for every placed balloon',
    $('rfq-place-ov').querySelectorAll('line').length === 5,
    String($('rfq-place-ov').querySelectorAll('line').length));
  /* jsdom has no PointerEvent and `target` is read-only on an Event, so the
     coordinates are attached to a bubbling Event and `target` is left to the
     dispatch itself — which is what sets it correctly anyway. */
  const ptr = (t, el, x, y) => {
    const ev = new window.Event(t, { bubbles: true });
    Object.defineProperty(ev, 'clientX', { value: x });
    Object.defineProperty(ev, 'clientY', { value: y });
    Object.defineProperty(ev, 'pointerId', { value: 1 });
    el.dispatchEvent(ev);
  };
  b1.setPointerCapture = () => {};
  ptr('pointerdown', b1, 320, 220);
  ptr('pointermove', sheet, 700, 100);
  ptr('pointerup', sheet, 700, 100);
  await wait(60);
  check('dragging a balloon moves it', b1.style.left === '70%' && b1.style.top === '20%',
    b1.style.left + ' ' + b1.style.top);
  /* the point of the two-point model: moving the number does not move what
     the line points at */
  check('…and the anchor stays on the feature it points at',
    a1.style.left === '32%' && a1.style.top === '44%', a1.style.left + ' ' + a1.style.top);
  {
    const l = $('rfq-place-ov').querySelector('line');
    check('…and the leader now runs between the two, at whatever angle that is',
      l && Math.abs(parseFloat(l.getAttribute('x2')) - 320) < 0.5 &&
      Math.abs(parseFloat(l.getAttribute('y2')) - 220) < 0.5 &&
      parseFloat(l.getAttribute('x1')) !== parseFloat(l.getAttribute('x2')),
      l && [l.getAttribute('x1'), l.getAttribute('y1'), l.getAttribute('x2'), l.getAttribute('y2')].join(','));
  }
  /* the other end, dragged on its own — repointing the leader without
     disturbing a number that is already where it reads well */
  a1.setPointerCapture = () => {};
  ptr('pointerdown', a1, 320, 220);
  ptr('pointermove', sheet, 400, 300);
  ptr('pointerup', sheet, 400, 300);
  await wait(60);
  check('the anchor can be dragged on its own to re-point the leader',
    a1.style.left === '40%' && a1.style.top === '60%', a1.style.left + ' ' + a1.style.top);
  check('…without moving the balloon it belongs to',
    b1.style.left === '70%' && b1.style.top === '20%', b1.style.left + ' ' + b1.style.top);
  check('…and saving is now offered', !$('rfq-place-save').disabled);
  check('…and it says the move is not saved yet',
    /not saved yet/.test($('rfq-place-msg').textContent), $('rfq-place-msg').textContent);

  calls.length = 0;
  click($('rfq-place-save'));
  await wait(450);
  const saved = (rfqs.find(x => x.ref === 'RFQ-B001') || {}).extract || {};
  const c1 = (saved.characteristics || []).find(c => c.no === 1) || {};
  check('the balloon position is written to the enquiry, not kept on screen only',
    c1.bx === 70 && c1.by === 20, JSON.stringify([c1.bx, c1.by]));
  check('…and the anchor is saved separately, where it was dragged to',
    c1.x === 40 && c1.y === 60, JSON.stringify([c1.x, c1.y]));
  /* This screen moves balloons. It must not quietly edit what the drawing says. */
  check('…and the reading itself is untouched by a move',
    c1.feature === 'Ø17.5 ground diameter' && c1.nominal === 17.5 && c1.cls === 'CC',
    JSON.stringify([c1.feature, c1.nominal, c1.cls]));
  check('…and every other characteristic is left where it was',
    (saved.characteristics || []).length === 6 &&
    (saved.characteristics.find(c => c.no === 2) || {}).x === 50,
    JSON.stringify((saved.characteristics || []).map(c => [c.no, c.x])));
  check('the sheet records who placed them and when',
    saved.placedBy && saved.placedBy.by && saved.placedBy.at, JSON.stringify(saved.placedBy || null));

  /* The two claims must not print alike: "a model guessed where these are" and
     "a named person put them there" carry different weight on an FAI sheet. */
  printed.length = 0;
  await openRow();
  click(window.document.querySelector('.rp-balloon[data-ref="RFQ-B001"]'));
  await wait(250);
  const sheetHtml = (printed[printed.length - 1] || {}).html || '';
  check('a hand-placed sheet says so rather than claiming the AI placed them',
    /Checked by /.test(sheetHtml) &&
    !/the position of every balloon are the AI/.test(sheetHtml),
    (sheetHtml.match(/Checked by[^<]*/) || [''])[0].slice(0, 70));
  /* …but placing a balloon does not check a tolerance, and the sheet must not
     let anyone think it did. */
  check('…and still says the VALUES are the AI\u2019s and unverified',
    /its values are still the AI/.test(sheetHtml));
  check('…and the printed sheet keeps the leader that was set, both ends of it',
    /data-cx="40" data-cy="60" data-bx="70" data-by="20"/.test(sheetHtml),
    (sheetHtml.match(/data-cx="[0-9.]+" data-cy="[0-9.]+"( data-bx="[0-9.]+" data-by="[0-9.]+")?/g) || []).join(' '));
  check('…and the layout pass is told to leave a hand-placed balloon alone',
    /data-bx/.test(sheetHtml) && /p\.fixed/.test(sheetHtml),
    /p\.fixed/.test(sheetHtml) ? 'pinned' : 'layout would move it');

  /* the other half of the placement UI: dragging the one item the AI could
     not place at all, from the tray onto the sheet. This is what makes an
     unplaced characteristic recoverable at all, and it is the exact path
     that used to mis-count once the tray held every row instead of only
     the unplaced ones — a tray row must turn into a placed legend row in
     place, not disappear from the list. */
  const trayRow = tray.querySelector('.pl-t[data-no]');
  check('the one the AI could not place is still waiting in the tray',
    !!trayRow, tray.textContent.trim().slice(0, 60));
  const trayNo = trayRow && trayRow.dataset.no;
  const store = {};
  const dt = { setData: (k, v) => { store[k] = v; }, getData: k => store[k] || '' };
  const dragEv = (t, el) => {
    const ev = new window.Event(t, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    Object.defineProperty(ev, 'clientX', { value: 900 });
    Object.defineProperty(ev, 'clientY', { value: 425 });
    el.dispatchEvent(ev);
  };
  dragEv('dragstart', trayRow);
  dragEv('drop', sheet);
  await wait(60);
  check('dragging it from the tray onto the sheet places it',
    !!sheet.querySelector('.pl-b[data-no="' + trayNo + '"]'), String(trayNo));
  check('…and its legend row turns into a found row instead of vanishing',
    tray.querySelectorAll('.pl-row.pl-on').length === 6 && tray.querySelectorAll('.pl-row.pl-off').length === 0,
    tray.querySelectorAll('.pl-row.pl-on').length + ' on / ' + tray.querySelectorAll('.pl-row').length + ' total');
  check('…and the count now says every characteristic is placed',
    /All 6 characteristics are on the drawing/.test($('rfq-place-left').textContent),
    $('rfq-place-left').textContent);

  /* the reverse lookup: clicking a legend row finds its balloon on a sheet
     that may have many others, by a brief highlight that then clears. */
  const foundRow = tray.querySelector('.pl-row.pl-on[data-no="' + trayNo + '"]');
  click(foundRow);
  await wait(60);
  check('clicking a placed row highlights its balloon',
    !!sheet.querySelector('.pl-b[data-no="' + trayNo + '"].pl-hi'));
  await wait(1500);
  check('…and the highlight clears on its own',
    !sheet.querySelector('.pl-b.pl-hi'));

  click($('rfq-place-close'));
  await wait(60);
  check('closing puts the drawing away', $('rfq-place').style.display === 'none');
}

/* ---------- correcting the reading itself ----------
   Every round so far could only move a balloon. The faults that actually cost
   money are in the WORDS: a thread read as a diameter with a tolerance, a
   chamfer never read at all, a line on the list that is not on the drawing.
   None of those is reachable by dragging, and no amount of prompt work fixes
   one that has already been read wrongly — only a person looking at the sheet
   can. These checks are on the record that gets written, because that is what
   the drawing-data table, the printed sheet, the costing and the part handover
   all read afterwards. */
{
  window.confirm = () => true;
  /* Null-safe throughout. Every control below is one this round added, so a
     build without it must make these checks FAIL — not crash the suite before
     the first of them runs, which is a mistake this harness has now made
     three times. */
  const clickIf = el => { if (el) click(el); };
  const fld = id => $(id) || { value: '', focus(){}, setSelectionRange(){} };
  const qs = sel => (($('rfq-place-edit') || document.createElement('div')).querySelector(sel) || null);
  const openPlace = async () => {
    clickIf(window.document.querySelector('#menubar [data-s="rfq_pipeline"]'));
    await wait(300);
    if (!window.document.querySelector('.rp-place[data-ref="RFQ-B001"]')) {
      clickIf(window.document.querySelector('.rp-head[data-ref="RFQ-B001"]'));
      await wait(250);
    }
    $('rfq-place-sheet').getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 500 });
    clickIf(window.document.querySelector('.rp-place[data-ref="RFQ-B001"]'));
    await wait(250);
  };
  await openPlace();
  const tray = $('rfq-place-tray');
  const startCount = tray.querySelectorAll('.pl-row').length;

  // ---- edit one the AI read wrongly ----
  check('every row in the list offers Edit and Delete',
    tray.querySelectorAll('.pl-row .pl-edit').length === startCount &&
    tray.querySelectorAll('.pl-row .pl-del').length === startCount,
    tray.querySelectorAll('.pl-edit').length + '/' + startCount);
  clickIf(tray.querySelector('.pl-row[data-no="2"] .pl-edit'));
  await wait(80);
  check('Edit opens the characteristic in a form, in place of the list',
    $('rfq-place-edit').style.display !== 'none' && $('rfq-place-tray').style.display === 'none' &&
    !!$('ple-feature'), $('rfq-place-edit').style.display);
  check('the form is filled from the reading, not blank',
    fld('ple-feature').value === 'Overall length' && fld('ple-nominal').value === '120' &&
    fld('ple-lower').value === '-0.1',
    JSON.stringify([fld('ple-feature').value, fld('ple-nominal').value, fld('ple-lower').value]));
  check('every field of the reading is editable, not only the text',
    !!$('ple-type') && !!$('ple-upper') && !!$('ple-unit') && !!$('ple-gdt') &&
    !!$('ple-spec') && !!$('ple-cls') && !!$('ple-where'));
  /* the misreading found by rendering a real sheet: M34 x 0.75 came back as a
     diameter with a tolerance, and nothing downstream can recover from it */
  fld('ple-feature').value = 'M34 x 0,75 thread, full depth';
  fld('ple-type').value = 'Thread';
  fld('ple-spec').value = 'M34x0.75';
  fld('ple-nominal').value = '34';
  fld('ple-upper').value = '';
  fld('ple-lower').value = '';
  clickIf($('ple-apply'));
  await wait(80);
  check('applying puts the list back',
    $('rfq-place-tray').style.display !== 'none' && $('rfq-place-edit').style.display === 'none');
  check('…and the corrected wording is in the list straight away',
    /M34 x 0.75 thread/.test(tray.textContent), tray.textContent.slice(0, 160));
  /* The description stays in the drawing's own words, commas and all — that is
     what the column is for. It is the NUMERIC fields that go through the
     decimal reader, so a comma typed by a person means what one read off the
     sheet means, and "1,0" is one rather than ten. */
  check('…in the drawing\'s own words, comma and all',
    /M34 x 0,75 thread/.test(tray.textContent), (tray.textContent.match(/M34[^\n]{0,34}/) || [''])[0]);
  check('…and the tolerance it never had is gone',
    !/120 \+0\.3/.test(tray.textContent), (tray.textContent.match(/120[^\n]{0,20}/) || [''])[0]);

  // ---- the symbol palette ----
  clickIf(tray.querySelector('.pl-row[data-no="1"] .pl-edit'));
  await wait(80);
  const feat = fld('ple-feature');
  check('the form offers a palette of drawing symbols',
    $('rfq-place-edit').querySelectorAll('.pl-symb').length > 20,
    String($('rfq-place-edit').querySelectorAll('.pl-symb').length));
  check('…including the GD&T controls a keyboard has no key for',
    ['⊥','∥','⌖','◎','⌭','⏥','↗','⌰','Ⓜ'].every(sym =>
      !!$('rfq-place-edit').querySelector('.pl-symb[data-sym="' + sym + '"]')),
    [...$('rfq-place-edit').querySelectorAll('.pl-symb')].map(b => b.dataset.sym).join(''));
  feat.value = 'AB';
  feat.focus();
  feat.setSelectionRange(1, 1);
  const md = el => el.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  const symD = qs('.pl-symb[data-sym="⌀"]'); if (symD) md(symD);
  await wait(40);
  check('a symbol is inserted at the caret, not appended to the end',
    feat.value === 'A⌀B', JSON.stringify(feat.value));
  const gdtBox = fld('ple-gdt');
  gdtBox.value = ''; gdtBox.focus();
  const symP = qs('.pl-symb[data-sym="⊥"]'); if (symP) md(symP);
  await wait(40);
  gdtBox.value = gdtBox.value + ' 0,01 A';
  check('the GD&T box takes a symbol of its own',
    gdtBox.value === '⊥ 0,01 A', JSON.stringify(gdtBox.value));
  feat.value = 'Ø17.5 ground diameter';
  clickIf($('ple-apply'));
  await wait(80);

  // ---- add one the AI never read ----
  clickIf($('rfq-place-add'));
  await wait(80);
  check('Add opens a blank characteristic ready to describe',
    !!$('ple-feature') && fld('ple-feature').value === '', JSON.stringify(fld('ple-feature').value));
  const wasRows = tray.querySelectorAll('.pl-row').length;
  fld('ple-feature').value = '';
  clickIf($('ple-apply'));
  await wait(60);
  check('a characteristic with no description is refused — the balloon number would mean nothing',
    !!$('ple-feature') && /needs a description/.test($('rfq-place-msg').textContent),
    $('rfq-place-msg').textContent);
  fld('ple-feature').value = 'Chamfer 1 x 45 both ends';
  fld('ple-nominal').value = '1,0';
  fld('ple-where').value = 'left end, detail B';
  clickIf($('ple-apply'));
  await wait(80);
  check('…and one that is described is added to the list',
    tray.querySelectorAll('.pl-row').length === wasRows &&
    /Chamfer 1 x 45 both ends/.test(tray.textContent),
    tray.querySelectorAll('.pl-row').length + ' rows');
  check('…numbered next in sequence, and waiting to be placed',
    !!tray.querySelector('.pl-row.pl-off[data-no="' + wasRows + '"]'),
    [...tray.querySelectorAll('.pl-row')].map(r => r.dataset.no).join(','));

  // ---- delete one that is not on the drawing ----
  const beforeDel = [...tray.querySelectorAll('.pl-row')].length;
  clickIf(tray.querySelector('.pl-row[data-no="3"] .pl-del'));
  await wait(80);
  check('Delete removes it from the list',
    tray.querySelectorAll('.pl-row').length === beforeDel - 1,
    tray.querySelectorAll('.pl-row').length + ' of ' + beforeDel);
  check('…and the numbers close up, so no balloon points at the wrong row',
    [...tray.querySelectorAll('.pl-row')].map(r => Number(r.dataset.no))
      .join(',') === Array.from({ length: beforeDel - 1 }, (_, i) => i + 1).join(','),
    [...tray.querySelectorAll('.pl-row')].map(r => r.dataset.no).join(','));

  // ---- nothing reaches the enquiry until Save ----
  const mid = (rfqs.find(x => x.ref === 'RFQ-B001') || {}).extract || {};
  check('none of this has touched the enquiry yet',
    (mid.characteristics || []).length === startCount &&
    !/M34/.test(JSON.stringify(mid.characteristics || [])),
    (mid.characteristics || []).length + ' on file');

  calls.length = 0;
  clickIf($('rfq-place-save'));
  await wait(450);
  const after = (rfqs.find(x => x.ref === 'RFQ-B001') || {}).extract || {};
  const chars = after.characteristics || [];
  check('Save writes the corrected list to the enquiry',
    chars.length === beforeDel - 1, chars.length + ' saved');
  const thread = chars.find(c => /M34/.test(c.feature || '')) || {};
  check('the corrected characteristic is a thread now, with no invented tolerance',
    thread.type === 'Thread' && thread.nominal === 34 &&
    thread.upper == null && thread.lower == null,
    JSON.stringify([thread.type, thread.nominal, thread.upper, thread.lower]));
  const added = chars.find(c => /Chamfer 1 x 45/.test(c.feature || '')) || {};
  check('the added characteristic is on file, with its comma decimal read as 1',
    added.nominal === 1 && added.locationNote === 'left end, detail B',
    JSON.stringify([added.nominal, added.locationNote]));
  check('…and it records that a person added it, not the AI',
    !!added.addedBy, JSON.stringify(added.addedBy));
  check('the saved numbers are 1..n with no gap and no repeat',
    chars.map(c => c.no).join(',') === chars.map((c, i) => i + 1).join(','),
    chars.map(c => c.no).join(','));
  check('the sheet records how many were read and how many are listed now',
    after.placedBy && after.placedBy.was === startCount && after.placedBy.now === chars.length,
    JSON.stringify(after.placedBy || null));

  // ---- and it reaches every table that reads the list ----
  await wait(200);
  if (!window.document.querySelector('.rp-place[data-ref="RFQ-B001"]')) {
    clickIf(window.document.querySelector('.rp-head[data-ref="RFQ-B001"]'));
    await wait(250);
  }
  const table = $('rp-list').textContent;
  check('the drawing-data table on the enquiry shows the correction',
    /M34 x 0.75 thread/.test(table) && /Chamfer 1 x 45/.test(table),
    table.slice(0, 200));
  check('…and reports the new count, not the count the AI read',
    new RegExp('Drawing data — ' + chars.length + ' characteristic').test(table),
    (table.match(/Drawing data — [^\n]{0,30}/) || [''])[0]);
  printed.length = 0;
  clickIf(window.document.querySelector('.rp-ddprint[data-ref="RFQ-B001"]'));
  await wait(250);
  const dd = (printed[printed.length - 1] || {}).html || '';
  check('the printed drawing data carries it too',
    /M34 x 0.75 thread/.test(dd) && /Chamfer 1 x 45/.test(dd), dd.slice(0, 120));
  printed.length = 0;
  clickIf(window.document.querySelector('.rp-balloon[data-ref="RFQ-B001"]'));
  await wait(250);
  const bs = (printed[printed.length - 1] || {}).html || '';
  check('and so does the balloon drawing',
    /M34 x 0.75 thread/.test(bs) && /Chamfer 1 x 45/.test(bs), bs.slice(0, 120));
  /* A sheet somebody dragged into shape and a sheet whose values somebody
     read through are different claims, and the count alone cannot tell them
     apart — correcting one line and adding another leaves it unchanged. */
  check('…which now says the list itself was corrected, not only dragged about',
    /The list itself was corrected/.test(bs) && /written or corrected by hand/.test(bs),
    (bs.match(/Checked by[^<]{0,240}/) || [''])[0]);
}

/* ---------- a European / GOST drawing, read through the real reader ----------
   The prompt above asks for all of this; this section is the half that holds
   when the model does not. Every value below comes back the way a model that
   read the sheet honestly would write it — as the string it saw — and the
   check is on the rendered Size & tolerance column, which is what an
   inspector measures to.

   Core.num() is exactly wrong for these: it strips everything that is not a
   digit, a dot or a minus, so "1,6" arrives as SIXTEEN. That is the reported
   misreading, and no amount of prompting removes it. */
{
  AI_OVERRIDE = JSON.stringify({
    part: { number: 'G-100', name: 'Bush', drawingNumber: 'G-100', revision: '1' },
    requirements: [],
    characteristics: [
      { no: 1, type: 'Dimension', feature: '⌀6H7 bore', nominal: '6',
        upper: '0,012', lower: '0', unit: 'mm', gdt: '', spec: '', cls: '',
        x: '30', y: '40', locationNote: 'section A-A' },
      /* the subscript case: one deviation, printed low, therefore minus */
      { no: 2, type: 'Dimension', feature: 'Outside diameter', nominal: '40',
        upper: '0', lower: '-0,16', unit: 'mm', gdt: '', spec: '', cls: '',
        x: '45', y: '55', locationNote: 'main view' },
      { no: 3, type: 'Finish', feature: 'Surface finish on bore', nominal: '1,6',
        upper: null, lower: null, unit: 'µm', gdt: '', spec: 'Ra 1,6', cls: '',
        x: '52', y: '22', locationNote: 'finish symbol' },
      { no: 4, type: 'GD&T', feature: 'Perpendicularity of face B to datum A',
        nominal: null, upper: null, lower: null, gdt: '⊥ 0.01 A', spec: '', cls: '',
        x: '64', y: '62', locationNote: 'feature control frame' }
    ],
    criticalCharacteristics: [], missing: [], notes: ''
  });
  calls.length = 0;
  if (!window.document.querySelector('.rp-read[data-ref="RFQ-B001"]')) {
    click(window.document.querySelector('.rp-head[data-ref="RFQ-B001"]'));
    await wait(200);
  }
  click(window.document.querySelector('.rp-read[data-ref="RFQ-B001"]'));
  await wait(500);
  const g = $('rp-list').textContent;
  const saved = (rfqs.find(r => r.ref === 'RFQ-B001') || {}).extract || {};
  const byNo = n => (saved.characteristics || []).find(c => c.no === n) || {};

  check('a comma decimal is read as a decimal, not as a whole number',
    byNo(3).nominal === 1.6, JSON.stringify(byNo(3).nominal));
  check('…so the finish prints as 1.6 µm and never as 16 µm',
    /1\.6 µm/.test(g) && !/\b16 µm/.test(g), (g.match(/[\d.]+ µm/g) || []).join(', '));
  check('a comma decimal in a deviation is read the same way',
    byNo(1).upper === 0.012, JSON.stringify(byNo(1).upper));
  check('a deviation printed below the line stays negative through the reading',
    byNo(2).lower === -0.16 && byNo(2).upper === 0,
    JSON.stringify([byNo(2).upper, byNo(2).lower]));
  check('…and prints as 40 0/-0.16, not 40 0/-16',
    /40 0\/-0\.16 mm/.test(g), (g.match(/40 [^|]{0,18}/) || [''])[0]);
  check('the fit class stays on the characteristic rather than being dropped',
    /⌀6H7/.test(g) && byNo(1).feature === '⌀6H7 bore', byNo(1).feature);
  check('a perpendicularity callout is shown as the symbol it is',
    /⊥ 0\.01 A/.test(g) && /Perpendicularity/i.test(g),
    (g.match(/⊥[^|]{0,30}/) || [''])[0]);
  check('a position given as a string still places the balloon',
    byNo(1).x === 30 && byNo(1).y === 40, JSON.stringify([byNo(1).x, byNo(1).y]));
  AI_OVERRIDE = null;
}

check('no console errors while any of this ran', pageErrors.length === 0, pageErrors.join(' | '));

const pass = results.filter(r => r[1]).length;
results.forEach(([n, c, x]) => console.log((c ? '  ok  ' : '  FAIL') + '  ' + n + (c || !x ? '' : '  [' + x + ']')));
console.log('\n' + pass + ' passed, ' + (results.length - pass) + ' failed, of ' + results.length);
process.exit(results.length - pass ? 1 : 0);
