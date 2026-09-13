/* Company Profile, now editable natively rather than read-only pointing at
   the website's Site Admin. The two things that matter most: saving must
   send back the WHOLE site_content object (this endpoint overwrites
   everything, same risk as Statutory & Masters), and the image fields must
   use the website's own actual storage keys (company.letterheadLogo,
   company.signatureImg, company.sealImg) rather than invented ones — using
   the wrong key would silently show no logo despite one being "saved". */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let content = {
  pricing: { markupPct: 18 }, // unrelated website setting that must survive a save here
  hrMasters: { empIdPrefix: 'EMP' }, // ditto
  company: {
    legalName: 'Elixir Tec Corporation', displayName: 'Elixir Tec', taxNumber: '29ABCDE1234F1Z5',
    docPrefix: 'ELIX', addr1: 'Plot 12, Industrial Area', city: 'Mysuru', letterheadLogo: '/api/assets?id=logo1'
  }
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
const nav = id => click(window.document.querySelector('#menubar [data-s="' + id + '"]'));
const set = (id, v) => { $(id).value = v; };

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(300);

nav('profile');
await wait(200);

// ---------- existing values load into editable fields (not a read-only table) ----------
check('the legal name loads into an editable field', $('cp-legalName').value === 'Elixir Tec Corporation');
check('the tax number loads correctly', $('cp-taxNumber').value === '29ABCDE1234F1Z5');
check('the document prefix loads', $('cp-docPrefix').value === 'ELIX');
check('the existing logo preview shows, using the real storage key (company.letterheadLogo)',
  $('cp-logo-preview').style.display !== 'none' && $('cp-logo-preview').src.includes('logo1'));
check('"use website logo" defaults on when not explicitly turned off (matches the source\'s own default)',
  $('cp-use-website-logo').checked === true);

// ---------- edit some fields and save ----------
set('cp-city', 'Bengaluru'); input($('cp-city'));
set('cp-signatoryName', 'Vijay Kumar D P'); input($('cp-signatoryName'));
click($('cp-save'));
await wait(200);

const saveCall = calls.find(c => c.kind === 'content-save');
check('saving posts to /api/content', !!saveCall, JSON.stringify(calls).slice(0, 200));
check('the edited field is in the saved payload', saveCall && saveCall.body.data.company.city === 'Bengaluru');
check('the new field (signatory) is in the saved payload',
  saveCall && saveCall.body.data.company.signatoryName === 'Vijay Kumar D P');
check('a field never touched (legalName) survives unchanged',
  saveCall && saveCall.body.data.company.legalName === 'Elixir Tec Corporation');

// ---------- the critical one: unrelated website settings must not be clobbered ----------
check('unrelated pricing settings are NOT clobbered by saving the company profile',
  saveCall && saveCall.body.data.pricing && saveCall.body.data.pricing.markupPct === 18,
  saveCall && JSON.stringify(saveCall.body.data.pricing));
check('unrelated hrMasters settings are NOT clobbered either',
  saveCall && saveCall.body.data.hrMasters && saveCall.body.data.hrMasters.empIdPrefix === 'EMP');

check('no console errors while any of this ran', pageErrors.length === 0, pageErrors.join(' | '));

const failed = results.filter(([, ok]) => !ok);
for (const [n, ok, x] of results) console.log((ok ? '  ok  ' : '  X   ') + n + (ok ? '' : '   [' + x + ']'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, of ${results.length}`);
process.exit(failed.length ? 1 : 0);
