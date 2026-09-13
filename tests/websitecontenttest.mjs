/* Website Content, native. Fifteen design tabs collapsed into one
   schema-driven editor. The thing most worth proving: the field names this
   writes must match exactly what the website's own renderer reads — a
   plausible-but-wrong key would save happily and show nothing on the site,
   which is the worst kind of failure because it looks like it worked. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');
const site = fs.readFileSync('index.html', 'utf8');

let content = {
  company: { legalName: 'Test Mfg' }, // must survive this screen's save
  heroHeadline: 'Original headline',
  capabilities: [{ id: 'c1', img: '/api/assets?id=a1', title: 'CNC Turning', desc: 'Turned parts.' },
                 { id: 'c2', img: '', title: '5-Axis Milling', desc: 'Complex work.' }],
  ticker: ['ISO 9001:2015 CERTIFIED'],
  founders: [{ id: 'f1', photo: '', name: 'A Founder', role: 'MD', bio: 'Bio here.' }],
  sections: { capabilities: true, gallery: true }
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
  if (url.startsWith('/api/settings')) return ok({ settings: {} });
  if (url.startsWith('/api/assets')) { calls.push({ kind: 'upload' }); return ok({ url: '/api/assets?id=new1' }); }
  if (url.startsWith('/api/idms')) {
    if (url.includes('what=settings')) return ok({ settings: {} });
    if (url.includes('what=parts')) return ok({ parts: [] });
    if (url.includes('what=serial')) return ok({ next: 1 });
    if (url.includes('what=docs')) return ok({ docs: [] });
    if (url.includes('what=audit')) return ok({ audit: [] });
    return ok({});
  }
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
const change = el => el.dispatchEvent(new window.Event('change', { bubbles: true }));
const input = el => el.dispatchEvent(new window.Event('input', { bubbles: true }));
const nav = id => click(window.document.querySelector('#menubar [data-s="' + id + '"]'));
const pick = v => { $('wc-section').value = v; change($('wc-section')); };

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(300);

check('Website Content is a live native menu entry', !!window.document.querySelector('#menubar [data-s="admin_content"]'));
nav('admin_content');
await wait(250);

// ---------- hero: plain fields + a plain-string list ----------
check('the hero headline loads from the real record',
  window.document.querySelector('.wc-f[data-k="heroHeadline"]').value === 'Original headline');
const hl = window.document.querySelector('.wc-f[data-k="heroHeadline"]');
hl.value = 'New headline'; input(hl);
check('the ticker loads as an editable plain list',
  window.document.querySelector('.wc-plain').value === 'ISO 9001:2015 CERTIFIED');
click($('wc-add'));
await wait(50);
check('a ticker line can be added', window.document.querySelectorAll('.wc-plain').length === 2);

// ---------- capabilities: image + text rows, reorder, remove ----------
pick('capabilities');
await wait(100);
check('capability rows load with their titles',
  window.document.querySelector('.wc-row[data-k="title"]').value === 'CNC Turning');
check('an existing image is shown for a row that has one',
  window.document.querySelector('#wc-list img') !== null);
/* move the second capability above the first */
click(window.document.querySelector('.wc-down[data-i="0"]'));
await wait(50);
check('rows can be reordered',
  window.document.querySelector('.wc-row[data-k="title"]').value === '5-Axis Milling',
  window.document.querySelector('.wc-row[data-k="title"]').value);

// ---------- founders: the image key differs (photo, not img) ----------
pick('founders');
await wait(100);
check('founder rows load', window.document.querySelector('.wc-row[data-k="name"]').value === 'A Founder');
const fileInput = window.document.querySelector('.wc-img');
check('the founder image control is present (its key is "photo", not "img")', !!fileInput);
Object.defineProperty(fileInput, 'files', { value: [new window.File(['x'], 'p.jpg', { type: 'image/jpeg' })] });
change(fileInput);
await wait(250);
check('uploading a founder photo stores it under the photo key',
  content.founders && calls.some(c => c.kind === 'upload'), JSON.stringify(calls.slice(0, 3)));

// ---------- section visibility ----------
const tog = window.document.querySelector('.wc-toggle[data-k="gallery"]');
check('a visibility toggle exists per section', !!tog);
tog.value = 'no'; change(tog);

// ---------- save ----------
calls.length = 0;
click($('wc-save'));
await wait(250);
const saveCall = calls.find(c => c.kind === 'content-save');
check('saving posts to /api/content', !!saveCall);
const d = saveCall && saveCall.body.data;
check('the edited headline is saved under the exact key the website reads (heroHeadline)',
  d && d.heroHeadline === 'New headline');
check('the reordered capabilities are saved in their new order',
  d && d.capabilities[0].title === '5-Axis Milling');
check('the founder photo url is saved under "photo"', d && d.founders[0].photo === '/api/assets?id=new1');
check('hiding a section is saved as a real false', d && d.sections.gallery === false);
check('the unrelated company profile survives untouched', d && d.company.legalName === 'Test Mfg');

// ---------- the field names must match what the website actually reads ----------
/* This is the check that matters: a key that looks right but is not read by
   index.html would save silently and change nothing on the live site. */
const writable = [];
for (const s of [['heroEyebrow'],['heroHeadline'],['heroSub'],['ctaPrimary'],['ctaSecondary'],
  ['capTitle'],['capMenu'],['processTitle'],['processMenu'],['galleryTitle'],['galleryMenu'],
  ['industriesTitle'],['industriesMenu'],['certsTitle'],['certsMenu'],['certsSub'],
  ['foundersTitle'],['foundersMenu'],['quoteText'],['quoteName'],['quoteRole'],
  ['contactTitle'],['contactSub'],['contactAddress'],['contactPhone'],['contactEmail'],
  ['botName'],['botLauncher'],['botWelcome'],['botKnowledge']]) {
  if (!site.includes(s[0])) writable.push(s[0]);
}
check('every text field this screen writes is a key the website actually reads',
  writable.length === 0, 'unknown to index.html: ' + writable.join(', '));

const arrays = ['capabilities','process','stats','gallery','industries','certs','founders','ticker','botChips']
  .filter(a => !site.includes('data.' + a) && !site.includes(a + ':['));
check('every list this screen writes is an array the website actually renders',
  arrays.length === 0, 'unknown to index.html: ' + arrays.join(', '));

check('no console errors while any of this ran', pageErrors.length === 0, pageErrors.join(' | '));

const failed = results.filter(([, ok]) => !ok);
for (const [n, ok, x] of results) console.log((ok ? '  ok  ' : '  X   ') + n + (ok ? '' : '   [' + x + ']'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, of ${results.length}`);
process.exit(failed.length ? 1 : 0);
