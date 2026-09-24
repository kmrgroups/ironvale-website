/* New Enquiry — the two things a live deployment found.

   1. A successful enquiry was announced as a failure. The save worked, the
      record was on file, and then `wireGoto(...)` ran — a function that has
      never existed anywhere in this codebase. Under 'use strict' that is a
      ReferenceError, it was raised INSIDE the try that reports failure, and
      the outer catch turned it into "Not created — wireGoto is not defined"
      over an enquiry that had been created. People then entered it again.

   2. A PDF taken over the phone could never be read. The public form on the
      website converts PDF/DXF/PNG to JPEG in the browser before upload,
      because the drawing reader is given images and not PDFs. This screen
      handed the file straight to Core.uploadFile(). The upload succeeded, the
      enquiry saved, everything looked right — and "Read drawing with AI"
      could not read it, days later, with nothing to say why.

   Both are the same class of failure: the visible outcome disagreeing with
   the real one. So the checks below are all about what the screen SAYS
   against what actually happened. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

const posted = [];
const uploaded = [];
let signedIn = false;
const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => pageErrors.push(e.message));
const dom = new JSDOM(html.replace(/<script src="\/(core|kpi|drawing-convert)\.js"><\/script>/g, ''),
  { runScripts: 'outside-only', url: 'https://example.test/idms.html', virtualConsole: vc });
const { window } = dom;
window.Element.prototype.scrollIntoView = function () {};

/* The real converter is a browser module leaning on canvas and pdf.js, neither
   of which jsdom has. What matters here is the contract the screen depends on:
   prepare() either returns a JPEG data URL, or rejects with a sentence. Both
   sides are driven below. */
let convertMode = 'ok';
window.DrawingConvert = {
  MAX_EDGE: 2200,
  sizeOf: d => Math.round((String(d).length - (String(d).indexOf(',') + 1)) * 0.75),
  loadPdfLib: async () => ({}),
  prepare: async (file, opts) => {
    if (convertMode === 'refuse')
      throw new Error('A STEP file cannot be converted in a web browser.');
    if (convertMode === 'huge')
      return { dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(6 * 1024 * 1024),
               fileName: 'big.jpg', note: 'Converted.', pages: 1, page: 1, converted: true };
    return { dataUrl: 'data:image/jpeg;base64,PAGE' + ((opts && opts.page) || 1) + 'AAAA',
             fileName: String(file.name).replace(/\.[^.]+$/, '') + '.jpg',
             note: 'Page ' + ((opts && opts.page) || 1) + ' converted to JPEG.',
             pages: convertMode === 'multipage' ? 3 : 1,
             page: (opts && opts.page) || 1, converted: true };
  }
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
  if (url.startsWith('/api/assets')) {
    if (opts.method === 'POST') {
      uploaded.push(body);
      return ok({ id: 'AST' + uploaded.length, url: '/api/assets?id=AST' + uploaded.length });
    }
    return ok({ assets: [] });
  }
  if (url.startsWith('/api/content')) return ok({ data: {
    company: { legalName: 'Test Mfg' },
    costBase: {}, machines: [], labourGrades: [], materials: [], quoteCfg: { prefix: 'QTN' }
  } });
  if (url.startsWith('/api/hr')) return ok({ employees: [], items: [] });
  if (url.startsWith('/api/settings')) return ok({ settings: {} });
  if (url.startsWith('/api/idms')) return ok({ parts: [], docs: [], audit: [], settings: {}, counters: [] });
  if (url.startsWith('/api/rfqs')) {
    if (opts.method === 'POST') { posted.push(body); return ok({ ref: (body.rfq || {}).ref }); }
    return ok({ rfqs: [] });
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
/* A real File, not a stand-in object. The converted path never touches
   FileReader (it posts the data URL straight to /api/assets), but the FALLBACK
   path — a file that could not be converted, which must still be attached —
   goes through Core.uploadFile() and therefore through readAsDataURL, which
   refuses anything that is not a genuine Blob. A plain {name,type,size} stand-in
   passed every converted case and failed every fallback case, which is exactly
   the half of this feature worth testing. */
const pick = (input, name, type) => {
  const f = new window.File([new Uint8Array([1, 2, 3, 4])], name, { type: type || '' });
  Object.defineProperty(input, 'files', { configurable: true, value: [f] });
  change(input);
};

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(300);
click(window.document.querySelector('#menubar [data-s="rfq_new"]'));
await wait(250);

check('New Enquiry is a live menu entry', !!window.document.querySelector('#menubar [data-s="rfq_new"]'));

// ---------- the crash that reported success as failure ----------
check('wireGoto is not called anywhere — it has never been defined',
  !/[^a-zA-Z.]wireGoto\s*\(/.test(html.replace(/\/\*[\s\S]*?\*\//g, '')));

/* ---------- the form asks only what the website asks ----------
   Three fields here used to ask the person on the phone to copy out what is
   already printed on the drawing: the part name, the customer's part number
   and the drawing number. Two versions of the same fact, and no way to tell
   which was right when they disagreed. They are gone; the reading in the
   pipeline supplies all three. Quantity is the one that stays, because it is
   the one a drawing cannot tell you. */
['rn-part', 'rn-partno', 'rn-drawing'].forEach(id =>
  check('“' + id + '” is gone from the form — it comes off the drawing now', !$(id)));
check('quantity is still asked, because no drawing can state the order quantity', !!$('rn-qty'));
check('the free-text field matches the wording the website uses',
  /Project Details/.test(html) && /Material, quantity, target tolerance, timeline/.test(html));
check('…and the screen says where those three now come from',
  /come off the drawing itself/.test(html));

$('rn-name').value = 'Ravi Kumar';
$('rn-email').value = 'ravi@customer.test';
$('rn-msg').value = 'Drive shaft, EN8D';
$('rn-qty').value = '500';
$('rn-company').value = 'Customer Pvt Ltd';
posted.length = 0;
click($('rn-save'));
await wait(500);

check('the enquiry actually reached the server', posted.length === 1,
  JSON.stringify(posted.map(p => (p.rfq || {}).ref)));
/* The quantity used to survive only as a line of prose inside the message, so
   the costing planned a 500-off job as a single piece unless somebody noticed
   and retyped it. It is now a field on the record that the costing reads. */
check('the quantity is carried as a number on the record, not only as prose',
  posted[0] && (posted[0].rfq || {}).qty === 500, posted[0] && JSON.stringify((posted[0].rfq||{}).qty));
check('the message is the customer’s own words, with no part name prepended',
  posted[0] && /^Drive shaft, EN8D/.test((posted[0].rfq || {}).message || ''),
  posted[0] && JSON.stringify((posted[0].rfq || {}).message));
const box = $('rn-msg-box');
check('the screen reports it as created, not as a failure',
  /created/.test(box.innerHTML) && !/Not created/.test(box.innerHTML), box.innerHTML.slice(0, 160));
check('…and says so in the good style, not the error style',
  /good/.test(box.className), box.className);
check('the reference shown is the one that was saved',
  box.innerHTML.includes((posted[0].rfq || {}).ref));
check('the link on to the pipeline is present', /data-goto="rfq_pipeline"/.test(box.innerHTML));
/* The link is the thing that used to throw. It must be wired, and wiring it
   must not be able to take the confirmation down with it. */
const link = box.querySelector('[data-goto="rfq_pipeline"]');
check('…and clicking it navigates rather than throwing', (() => {
  try { click(link); return true; } catch (e) { return false; }
})());
await wait(200);
check('no page error was raised by the save at all', pageErrors.length === 0, pageErrors.join(' | '));

// a genuine failure must still read as one
click(window.document.querySelector('#menubar [data-s="rfq_new"]'));
await wait(200);
const realFetch = window.fetch;
window.fetch = async (p, o = {}) => {
  if (String(p).startsWith('/api/rfqs') && o.method === 'POST')
    return { ok: false, status: 500, json: async () => ({ error: 'the database is unreachable' }) };
  return realFetch(p, o);
};
$('rn-name').value = 'Second Person';
$('rn-email').value = 's@customer.test';
$('rn-msg').value = 'Bracket';
click($('rn-save'));
await wait(500);
check('a save that really fails is still reported as a failure',
  /Not created/.test($('rn-msg-box').innerHTML), $('rn-msg-box').innerHTML.slice(0, 140));
check('…and names the reason', /unreachable/.test($('rn-msg-box').innerHTML));
window.fetch = realFetch;

/* Removing "Part or description *" removed the only thing that stopped an
   empty enquiry being raised. Something has to take its place, or the pipeline
   fills with rows that cannot be read and cannot be costed — so the rule is
   now "a drawing, or the customer's words, or neither and we stop here". */
click(window.document.querySelector('#menubar [data-s="rfq_new"]'));
await wait(200);
posted.length = 0;
$('rn-name').value = 'Third Person';
$('rn-email').value = 't@customer.test';
$('rn-msg').value = '';
click($('rn-save'));
await wait(400);
check('an enquiry with neither a drawing nor any details is turned back',
  posted.length === 0 && /Attach the drawing/.test($('rn-msg-box').innerHTML),
  $('rn-msg-box').innerHTML.slice(0, 120));
check('…and the reason names the drawing as where the part details come from',
  /taken from the drawing/.test($('rn-msg-box').innerHTML));
/* …but the customer's words alone are enough. The website accepts exactly
   that, and this form is not allowed to be stricter than the public one. */
$('rn-msg').value = 'Turned bush, 20 off, brass';
click($('rn-save'));
await wait(400);
check('the customer’s words alone are enough, as on the website',
  posted.length === 1, String(posted.length));

// ---------- the attachment is converted, as on the website ----------
check('idms.html loads the same converter the public form uses',
  /<script src="\/drawing-convert\.js"><\/script>/.test(html));

click(window.document.querySelector('#menubar [data-s="rfq_new"]'));
await wait(200);
uploaded.length = 0;
convertMode = 'ok';
pick($('rn-file'), 'shaft-drawing.pdf', 'application/pdf');
await wait(400);
check('a PDF is converted before upload, not sent as a PDF',
  uploaded.length === 1 && /^data:image\/jpeg/.test(uploaded[0].dataUrl),
  JSON.stringify(uploaded.map(u => String(u.dataUrl).slice(0, 24))));
check('what is attached is the converted JPEG, under a .jpg name',
  /shaft-drawing\.jpg/.test($('rn-file-msg').innerHTML), $('rn-file-msg').innerHTML);
check('the converted image is shown so it can be checked before sending',
  $('rn-file-prev').style.display !== 'none' &&
  /^data:image\/jpeg/.test($('rn-file-prev').src));
check('the screen says it will be readable', /read automatically/.test($('rn-file-status').textContent),
  $('rn-file-status').textContent);

// multi-page: the drawing is not always page 1
click(window.document.querySelector('#menubar [data-s="rfq_new"]'));
await wait(200);
uploaded.length = 0;
convertMode = 'multipage';
pick($('rn-file'), 'assembly.pdf', 'application/pdf');
await wait(400);
check('a multi-page PDF offers a page chooser',
  $('rn-file-pagerow').style.display !== 'none' && $('rn-file-page').options.length === 3);
$('rn-file-page').value = '2';
change($('rn-file-page'));
await wait(400);
check('choosing another page converts and uploads that page instead',
  uploaded.length === 2 && /PAGE2/.test(uploaded[1].dataUrl),
  JSON.stringify(uploaded.map(u => String(u.dataUrl).slice(20, 32))));

// a file that cannot be converted is still attached, with the reason said
click(window.document.querySelector('#menubar [data-s="rfq_new"]'));
await wait(200);
uploaded.length = 0;
convertMode = 'refuse';
pick($('rn-file'), 'model.step', '');
await wait(400);
check('a file that cannot be converted is still attached rather than dropped',
  uploaded.length === 1, String(uploaded.length));
check('…and the reason is put on screen',
  /cannot be converted in a web browser/.test($('rn-file-status').textContent),
  $('rn-file-status').textContent);
check('…and it says the file goes with the enquiry anyway',
  /still be attached/.test($('rn-file-status').textContent));

// an oversized conversion is refused before anything is uploaded
click(window.document.querySelector('#menubar [data-s="rfq_new"]'));
await wait(200);
uploaded.length = 0;
convertMode = 'huge';
pick($('rn-file'), 'giant.pdf', 'application/pdf');
await wait(500);
check('a converted image over the limit is named with its size',
  /over the 3MB limit/.test($('rn-file-status').textContent), $('rn-file-status').textContent);
check('…and the oversized image is not uploaded',
  !uploaded.some(u => String(u.dataUrl).length > 1000000), String(uploaded.length));

check('no console errors throughout', pageErrors.length === 0, pageErrors.join(' | '));

const pass = results.filter(r => r[1]).length;
results.forEach(([n, c, x]) => console.log((c ? '  ok  ' : '  x   ') + ' ' + n + (c || !x ? '' : '   [' + x + ']')));
console.log('\n' + pass + ' passed, ' + (results.length - pass) + ' failed, of ' + results.length);
process.exit(results.length - pass ? 1 : 0);
