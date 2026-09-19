/* The bug being fixed: Flush, Settings Restore and Company Profile Save each
   reload the page right after proving the session is alive, but the page's
   own boot sequence — by design — revokes any leftover token when no other
   signed-in tab answers within 600ms (see "opening the system" in idms.html,
   and sessionsharetest.mjs), because a token surviving in a reloaded tab
   looks exactly like a token surviving a crash or a shared-PC handover, which
   must NOT resume on its own. That correct rule doesn't know the difference,
   so the very tab that just flushed/restored/saved was being caught in it
   too: the reload landed on the sign-in screen although a perfectly good,
   just-proven token still existed.

   The fix is a one-shot, short-lived hint — Core.markSelfReload() /
   Core.consumeSelfReloadHint(), sessionStorage-backed so it survives a
   same-tab reload but never a closed-and-reopened tab or a crash — which the
   three call sites set immediately before reloading, and which
   adoptOpenSession() spends to validate the leftover token directly instead
   of discarding it. This test drives that mechanism the way a real reload
   actually presents it: by seeding sessionStorage the way the browser leaves
   it (both keys survive a same-tab reload; only the token survives a crash
   or a fresh tab), never by calling the internal functions directly — so a
   regression in the wiring between core.js and idms.html would be caught
   here, not just a regression in the helper functions themselves. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi  = fs.readFileSync('kpi.js', 'utf8');
const results = [];
const check = (n, c, x) => results.push([n, !!c, x || '']);
const wait = ms => new Promise(r => setTimeout(r, ms));

const live = new Set();          // server-side sessions
const calls = [];
function server() {
  return async (path, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : {};
    const url = String(path);
    const tok = (opts.headers || {})['X-Auth-Token'] || '';
    const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
    const no = () => ({ ok: false, status: 401, json: async () => ({ ok: false, error: 'Your session has ended. Sign in again.' }) });
    if (url.startsWith('/api/auth')) {
      calls.push({ action: body.action, tok });
      if (body.action === 'session') return live.has(tok) ? ok({ user: 'asha', role: 'developer' }) : no();
      if (body.action === 'logout') { live.delete(tok); return ok({}); }
      return ok({});
    }
    if (url.startsWith('/api/content')) return ok({ data: {} });
    if (url.startsWith('/api/idms')) {
      if (!live.has(tok)) return no();
      if (url.includes('what=settings')) return ok({ settings: {} });
      if (url.includes('what=parts')) return ok({ parts: [] });
      return ok({ docs: [] });
    }
    return ok({});
  };
}

/* seed mimics exactly what sessionStorage holds at the moment a page loads:
   {app_token} alone is a leftover from a crash, a closed-and-reopened tab, or
   any other reason to distrust it; {app_token, app_self_reload} is what the
   three fixed call sites leave in place immediately before their own
   location.reload() — indistinguishable from the browser's point of view. */
async function openTab(seed) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(html.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''),
    { runScripts: 'outside-only', url: 'https://works.example/idms.html', virtualConsole: vc });
  const w = dom.window;
  w.Element.prototype.scrollIntoView = function () {};
  w.BroadcastChannel = BroadcastChannel;
  w.fetch = server();
  Object.keys(seed || {}).forEach(k => w.sessionStorage.setItem(k, seed[k]));
  w.eval(core); w.eval(kpi);
  w.eval(html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1]);
  return { w, errors, $: id => w.document.getElementById(id) };
}
const signedInView = t => t.$('app').style.display !== 'none' && t.$('gate').style.display === 'none';

/* ---- the fixed case: a reload right after Flush/Restore/Save leaves both
   the token and a fresh hint in sessionStorage ---- */
live.add('TOK1');
const A = await openTab({ app_token: 'TOK1', app_self_reload: String(Date.now()) });
await wait(900);
check('a self-triggered reload with a fresh hint stays signed in — no sign-in screen shown',
  signedInView(A));
check('it kept using the same token rather than being forced to sign in again',
  A.w.Core.getToken() === 'TOK1' && live.has('TOK1'));
check('the token was actually re-checked with the server, not just trusted blindly',
  calls.some(c => c.action === 'session' && c.tok === 'TOK1'));
check('the leftover token was NOT revoked',
  !calls.some(c => c.action === 'logout' && c.tok === 'TOK1'));
check('the hint is one-shot — spent, not left behind for a later reload to find',
  A.w.sessionStorage.getItem('app_self_reload') === null);

/* Tab A is still "open" (this process never tears jsdom windows down) and
   still answers the shared BroadcastChannel's "is anybody signed in?" ask —
   exactly the cross-tab sharing sessionsharetest.mjs covers. Left alone, A
   would silently hand its own token to every tab opened below and defeat
   the isolation those scenarios depend on, so it explicitly signs out first,
   the same way sessionsharetest.mjs retires a tab before its next scenario. */
const click = (t, el) => el.dispatchEvent(new t.w.Event('click', { bubbles: true }));
click(A, A.$('t-out')); await wait(300);

/* ---- unchanged behaviour: a leftover token with NO hint still signs nobody
   in — this is the crash / shared-PC-handover protection the fix must not
   weaken ---- */
live.add('STALE');
const B = await openTab({ app_token: 'STALE' });
await wait(900);
check('a leftover token with no self-reload hint still signs nobody in (unchanged security rule)',
  !signedInView(B));
check('and that leftover session is still ended on the server, exactly as before',
  !live.has('STALE'));

/* ---- an expired hint (older than the 15s window) must not be honoured
   either — a tab that sat reloaded-but-idle for a while must not resume on a
   technicality of stale sessionStorage ---- */
live.add('OLDTOK');
const C = await openTab({ app_token: 'OLDTOK', app_self_reload: String(Date.now() - 60000) });
await wait(900);
check('an expired self-reload hint (over 15s old) is not honoured',
  !signedInView(C));
check('and that token is revoked too, same as any other unproven leftover',
  !live.has('OLDTOK'));

/* ---- a hint with no token at all is inert ---- */
const D = await openTab({ app_self_reload: String(Date.now()) });
await wait(900);
check('a self-reload hint with no leftover token does nothing unexpected',
  !signedInView(D));

/* A is expected to carry exactly one jsdom "error": the navigation jsdom
   cannot perform, from the Sign Out click's own location.reload() above
   (see sessionsharetest.mjs, which treats the same message as proof a
   reload was requested, not a failure). B, C and D never sign out, so they
   should carry none at all. */
check('no unexpected script errors while any of this ran',
  [B, C, D].every(t => t.errors.length === 0) && A.errors.every(m => /navigation|reload/i.test(m)),
  JSON.stringify({ A: A.errors, B: B.errors, C: C.errors, D: D.errors }));

/* ---- the three real call sites actually set the hint before reloading — a
   regression here (someone editing nearby code and dropping the call) would
   not show up in any of the DOM-level checks above, since the fake server
   would still answer 'session' truthfully regardless of what set the hint.
   Asserted directly against the source instead. ---- */
function markedBeforeReload(ms) {
  const re = new RegExp('C\\.markSelfReload\\(\\);\\s*setTimeout\\(function\\(\\)\\{\\s*location\\.reload\\(\\);\\s*\\},\\s*' + ms + '\\)');
  return re.test(html);
}
check('the company-profile save success path marks the reload as self-triggered', markedBeforeReload(1400));
check('the settings-restore success path marks the reload as self-triggered', markedBeforeReload(1800));
check('the flush success path marks the reload as self-triggered', markedBeforeReload(1200));

/* ---- and the one reload that must NEVER be marked: an explicit Sign Out.
   Marking that one would mean a person who deliberately signs out on a
   shared PC gets silently signed back in by the reload their own click
   triggered — exactly the scenario the whole no-auto-signin design exists to
   prevent. ---- */
const tOutIdx = html.indexOf("getElementById('t-out').addEventListener");
const signOutSrc = html.slice(tOutIdx, tOutIdx + 300);
check('signing out does NOT mark its reload as self-triggered', tOutIdx > 0 && !/markSelfReload/.test(signOutSrc));

let pass = 0;
for (const [n, ok, x] of results) { console.log((ok ? '  ok ' : '  x  ') + n + (ok ? '' : '   [' + x + ']')); if (ok) pass++; }
console.log(`\n${pass} passed, ${results.length - pass} failed, of ${results.length}`);
process.exit(0);
