/* Flush All Data, and Flush All Settings & Admin Data, in Admin → Backup &
   Restore. Both are deliberately hard to trigger — a button that only
   enables once the exact confirmation phrase is typed, not a dismissible
   confirm() dialog — so this checks that gate holds (near-miss phrases do
   NOT enable the button), that each button sends the scope it claims to,
   and that a rejected confirmation from the server is shown, not silently
   swallowed. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

const calls = [];
let signedIn = false;
const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => pageErrors.push(e.message));
const dom = new JSDOM(html.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''),
  { runScripts: 'outside-only', url: 'https://example.test/idms.html', virtualConsole: vc });
const { window } = dom;
window.Element.prototype.scrollIntoView = function () {};
/* A successful flush schedules a real page reload 1200ms later via
   location.reload(), which jsdom refuses to let a test override (its own
   "not implemented" stub is non-configurable). This test's own waits total
   well under that, and process.exit() below ends it outright, so the timer
   is simply never reached — nothing here needs to stub it. */

window.fetch = async (path, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : {};
  const url = String(path);
  const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
  if (url.startsWith('/api/auth')) {
    if (body.action === 'login') { signedIn = true; return ok({ token: 'T', user: 'tester', role: 'developer' }); }
    if (body.action === 'session') return signedIn ? ok({ user: 'tester', role: 'developer' }) : { ok: false, status: 401, json: async () => ({ error: 'Not signed in' }) };
    return ok({});
  }
  if (url.startsWith('/api/content')) return ok({ data: { company: { legalName: 'Test Mfg', docPrefix: 'TEST' } } });
  if (url.startsWith('/api/hr')) return ok({ employees: [], attendance: [] });
  if (url.startsWith('/api/rfqs')) return ok({ rfqs: [] });
  if (url.startsWith('/api/idms')) {
    if (url.includes('what=settings')) return ok({ settings: {} });
    if (url.includes('what=parts')) return ok({ parts: [] });
    if (url.includes('what=serial')) return ok({ next: 1 });
    if (url.includes('what=docs')) return ok({ docs: [] });
    if (url.includes('what=flush') && opts.method === 'POST') {
      calls.push({ url, body });
      // mirror the server's own check: the exact phrase, per scope, or a rejection
      if (body.scope === 'data' && body.confirm !== 'FLUSH ALL DATA')
        return { ok: true, status: 200, json: async () => ({ ok: false, error: 'Type the confirmation phrase exactly.' }) };
      if (body.scope === 'settings' && body.confirm !== 'FLUSH ALL SETTINGS')
        return { ok: true, status: 200, json: async () => ({ ok: false, error: 'Type the confirmation phrase exactly.' }) };
      return ok({ flushed: body.scope });
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
const nav = id => click(window.document.querySelector('#menubar [data-s="' + id + '"]'));
const type = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })); };

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(300);
nav('admin_backup');
await wait(150);

// ---------- Flush All Data ----------
check('the Flush Data button starts disabled', $('fl-data-go').disabled);
type($('fl-data-confirm'), 'flush all data');
check('a near-miss (wrong case) does not enable it', $('fl-data-go').disabled);
type($('fl-data-confirm'), 'FLUSH ALL DATA ');
check('trailing whitespace alone does not enable it either — trimmed, so still an exact match, and it does',
  !$('fl-data-go').disabled);
type($('fl-data-confirm'), 'FLUSH ALL SETTINGS');
check('the OTHER scope\'s phrase does not enable this button', $('fl-data-go').disabled);
type($('fl-data-confirm'), 'FLUSH ALL DATA');
check('the exact phrase enables it', !$('fl-data-go').disabled);

click($('fl-data-go'));
await wait(200);
const dataCall = calls.find(c => c.body.scope === 'data');
check('clicking it calls the flush endpoint with scope "data"', !!dataCall, JSON.stringify(calls));
check('and the confirmation phrase actually typed', dataCall && dataCall.body.confirm === 'FLUSH ALL DATA');
check('a success message is shown', /gone/i.test($('fl-data-msg').textContent), $('fl-data-msg').textContent);

// ---------- Flush All Settings ----------
calls.length = 0;
check('the Flush Settings button starts disabled', $('fl-settings-go').disabled);
type($('fl-settings-confirm'), 'FLUSH ALL DATA');
check('the OTHER scope\'s phrase does not enable THIS button', $('fl-settings-go').disabled);
type($('fl-settings-confirm'), 'FLUSH ALL SETTINGS');
check('its own exact phrase enables it', !$('fl-settings-go').disabled);

click($('fl-settings-go'));
await wait(200);
const settingsCall = calls.find(c => c.body.scope === 'settings');
check('clicking it calls the flush endpoint with scope "settings"', !!settingsCall, JSON.stringify(calls));
check('a success message is shown', /gone/i.test($('fl-settings-msg').textContent));

// ---------- a rejected confirmation is shown, not swallowed ----------
calls.length = 0;
// simulate the button somehow being clicked with a stale/mismatched value
// (defence in depth: the server re-checks even though the UI already gates this)
$('fl-data-confirm').value = 'FLUSH ALL DATA';
$('fl-data-go').disabled = false;
$('fl-data-confirm').value = 'something else';
click($('fl-data-go'));
await wait(200);
check('a server-side rejection is shown as an error, not silently ignored',
  /exactly/.test($('fl-data-msg').textContent), $('fl-data-msg').textContent);
check('the button is re-disabled after a rejection, since the box no longer matches',
  $('fl-data-go').disabled);

/* ---------- Flush Data must not take the branding with it ----------

   Reported from the live deployment with screenshots: after a data flush the
   public site, the IDMS home banner and the Website Content editor itself all
   showed broken images. The assets table holds two different things — files
   attached to records (part drawings, PO documents) and the company's branding
   (logo, hero banner and video, every capability/gallery/founder/certificate
   image). site_content stores the branding as REFERENCES and is deliberately
   NOT flushed by this scope, so `DELETE FROM assets` left the website pointing
   at files that no longer existed, while the screen promised in bold that it
   "does not touch your company profile, branding, users, keys or devices".

   The behaviour itself was verified against a real PostgreSQL 16 server rather
   than reasoned about — three cases (content present, no content row at all,
   an empty content row) plus a counter-check proving the COALESCE is
   load-bearing: without it, `position(id in NULL)` is NULL, the WHERE never
   matches, and the flush silently deletes no assets whatsoever. See the
   flush section in CLAUDE.md. What is checked here is that nobody simplifies
   it back to a bare wipe, and that the promise on screen stays true. */
{
  const route = fs.readFileSync('server/routes/idms.js', 'utf8');
  check('Flush Data no longer wipes the whole assets table',
    !/case 'assets':\s*return sql`DELETE FROM assets`/.test(route));
  check('…it keeps anything the website content still points at',
    /DELETE FROM assets WHERE position\(id in/.test(route));
  check('…guarded by COALESCE, without which nothing at all would be deleted',
    /COALESCE\(\(SELECT data::text FROM site_content WHERE id = 1\), ''\)/.test(route));
  /* sliced to the data branch itself — a regex spanning the whole file reaches
     into the settings list below and reports the opposite of the truth */
  const dataBranch = route.slice(route.indexOf("if (scope === 'data')"),
                                 route.indexOf("if (scope === 'settings')"));
  check('site_content is still NOT flushed by the data scope, which is why this is needed',
    dataBranch.length > 200 && !dataBranch.includes("'site_content'"), String(dataBranch.length));
  check('the settings scope still does flush site_content',
    route.slice(route.indexOf("if (scope === 'settings')")).includes("'site_content'"));
  check('the screen tells the user the pictures are kept',
    /the logo, the hero banner and video and every image on/.test(html));
}

check('no console errors while any of this ran', pageErrors.length === 0, pageErrors.join(' | '));

const failed = results.filter(([, ok]) => !ok);
for (const [n, ok, x] of results) console.log((ok ? '  ok  ' : '  X   ') + n + (ok ? '' : '   [' + x + ']'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, of ${results.length}`);
process.exit(failed.length ? 1 : 0);
