/* Website Theme & Preview, native. The editor is ours; the preview is the
   real website in a frame, because a theme preview that is not the actual
   site is lying about what will be published. The checks that matter:
   moving a control updates the preview immediately, nothing is published
   until Save, and saving does not disturb the rest of the shared record. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let content = {
  company: { legalName: 'Test Mfg' },          // must survive a theme save
  capabilities: [{ id: 'c1', title: 'Turning' }], // ditto
  sky: '#3FA9E0', navy: '#0B2A5B', gold: '#C2932E',
  glow: '#69C2ED', chatA: '#7B3FF2', chatB: '#4B1FA8',
  fontBase: 16, titleScale: 1, gutter: 26, sectionPad: 84, cardMin: 300, cardGap: 22,
  cardPad: 24, mediaH: 220, portraitH: 300, radius: 14, barHeight: 78, logoMax: 230,
  brandName: 'IRONVALE', brandSuffix: 'MANUFACTURING'
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
window.confirm = () => true;
window.open = () => null;

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
const input = el => el.dispatchEvent(new window.Event('input', { bubbles: true }));
const change = el => el.dispatchEvent(new window.Event('change', { bubbles: true }));
const nav = id => click(window.document.querySelector('#menubar [data-s="' + id + '"]'));

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(300);

check('Website Theme & Preview is a live native menu entry',
  !!window.document.querySelector('#menubar [data-s="admin_theme"]'));
nav('admin_theme');
await wait(250);

// ---------- controls load from the real record ----------
check('every colour gets a control', window.document.querySelectorAll('.th-colour').length === 6,
  String(window.document.querySelectorAll('.th-colour').length));
check('every spacing value gets a slider', window.document.querySelectorAll('.th-range').length === 12,
  String(window.document.querySelectorAll('.th-range').length));
check('the primary colour loads from the record',
  window.document.querySelector('.th-colour[data-k="sky"]').value === '#3fa9e0',
  window.document.querySelector('.th-colour[data-k="sky"]').value);
check('the brand name loads', $('th-brandName').value === 'IRONVALE');
check('nothing is flagged as unsaved on first open', $('th-dirty').style.display === 'none');

// ---------- the preview is the real site, not a mock ----------
check('the preview frame points at the actual website',
  /^\/\?preview=/.test($('th-frame').getAttribute('src') || ''), $('th-frame').getAttribute('src'));

/* give the frame a document so the CSS-variable push has somewhere to land —
   jsdom will not actually load the site, which is fine: what is being tested
   is that the screen writes the right variables, not that the site renders */
const frame = $('th-frame');
Object.defineProperty(frame, 'contentDocument', {
  value: window.document.implementation.createHTMLDocument('preview'), configurable: true });

// ---------- moving a control updates the preview immediately ----------
const skySwatch = window.document.querySelector('.th-colour[data-k="sky"]');
skySwatch.value = '#ff0000'; input(skySwatch);
await wait(50);
const pv = frame.contentDocument.documentElement.style;
check('changing a colour pushes it straight into the preview',
  pv.getPropertyValue('--sky') === '#ff0000', pv.getPropertyValue('--sky'));
check('the derived lighter shade is pushed too, so one colour sets a family',
  !!pv.getPropertyValue('--sky-light'), pv.getPropertyValue('--sky-light'));
check('the hex box mirrors the colour picker',
  window.document.querySelector('.th-colour-hex[data-k="sky"]').value === '#ff0000');
check('the screen now says there are unsaved changes', $('th-dirty').style.display !== 'none');

const radius = window.document.querySelector('.th-range[data-k="radius"]');
radius.value = '4'; input(radius);
await wait(50);
check('moving a slider pushes the new spacing into the preview',
  pv.getPropertyValue('--radius') === '4px', pv.getPropertyValue('--radius'));
check('the derived small radius follows it', pv.getPropertyValue('--radius-sm') === '3px',
  pv.getPropertyValue('--radius-sm'));
check('the slider read-out updates', /4px/.test(window.document.querySelector('.th-out[data-k="radius"]').textContent));

// ---------- nothing is published until Save ----------
check('no save has happened just from moving controls', calls.length === 0, JSON.stringify(calls));

// ---------- discard puts everything back ----------
click($('th-revert'));
await wait(100);
check('discarding restores the last saved colour',
  window.document.querySelector('.th-colour[data-k="sky"]').value === '#3fa9e0',
  window.document.querySelector('.th-colour[data-k="sky"]').value);
check('discarding clears the unsaved flag', $('th-dirty').style.display === 'none');

// ---------- save ----------
const gold = window.document.querySelector('.th-colour[data-k="gold"]');
gold.value = '#112233'; input(gold);
$('th-brandName').value = 'ELIXIR'; input($('th-brandName'));
await wait(50);
click($('wt-save'));
await wait(250);
const saveCall = calls.find(c => c.kind === 'content-save');
check('saving posts to /api/content', !!saveCall);
check('the changed colour is in the saved payload', saveCall && saveCall.body.data.gold === '#112233');
check('the changed brand name is saved', saveCall && saveCall.body.data.brandName === 'ELIXIR');
check('unrelated company details survive a theme save',
  saveCall && saveCall.body.data.company.legalName === 'Test Mfg');
check('unrelated website content survives a theme save',
  saveCall && saveCall.body.data.capabilities[0].title === 'Turning');
check('the unsaved flag clears once saved', $('th-dirty').style.display === 'none');

// ---------- reset restores defaults but still does not publish ----------
calls.length = 0;
click($('th-reset'));
await wait(100);
check('reset puts the original default colour back in the control',
  window.document.querySelector('.th-colour[data-k="sky"]').value === '#3fa9e0');
check('reset does not publish on its own — it waits for Save', calls.length === 0);

check('no console errors while any of this ran', pageErrors.length === 0, pageErrors.join(' | '));

const failed = results.filter(([, ok]) => !ok);
for (const [n, ok, x] of results) console.log((ok ? '  ok  ' : '  X   ') + n + (ok ? '' : '   [' + x + ']'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, of ${results.length}`);
process.exit(failed.length ? 1 : 0);
