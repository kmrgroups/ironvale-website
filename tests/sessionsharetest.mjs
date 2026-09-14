/* Opening a menu link in a new tab or window from a signed-in tab carries the
   same session across instead of asking for a second sign-in — while opening
   the system with no signed-in tab open still signs nobody in.

   Each "tab" is its own jsdom window. They share Node's BroadcastChannel, which
   behaves like the browser's: same channel name, same process, every other
   instance hears a message. */
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
let seq = 0;
function server(win) {
  return async (path, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : {};
    const url = String(path);
    const tok = (opts.headers || {})['X-Auth-Token'] || '';
    const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
    const no = () => ({ ok: false, status: 401, json: async () => ({ ok: false, error: 'Your session has ended. Sign in again.' }) });
    if (url.startsWith('/api/auth')) {
      calls.push({ action: body.action, tok });
      if (body.action === 'login') { const t = 'TOK' + (++seq); live.add(t); return ok({ token: t, user: 'asha', role: 'developer' }); }
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

async function openTab(hash, leftoverToken) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(html.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''),
    { runScripts: 'outside-only', url: 'https://works.example/idms.html' + (hash || ''), virtualConsole: vc });
  const w = dom.window;
  w.Element.prototype.scrollIntoView = function () {};
  w.BroadcastChannel = BroadcastChannel;
  w.fetch = server(w);
  if (leftoverToken) w.sessionStorage.setItem('app_token', leftoverToken);
  w.eval(core); w.eval(kpi);
  w.eval(html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1]);
  return { w, errors, $: id => w.document.getElementById(id) };
}
const signedInView = t => t.$('app').style.display !== 'none' && t.$('gate').style.display === 'none';
const click = (t, el) => el.dispatchEvent(new t.w.Event('click', { bubbles: true }));

/* ---- tab A: opened fresh, nobody else open → sign-in screen stands ---- */
const A = await openTab('');
await wait(900);
check('a tab opened with no signed-in tab open shows the sign-in screen', !signedInView(A));
A.$('g-user').value = 'asha'; A.$('g-pass').value = 'password1';
click(A, A.$('g-go')); await wait(300);
check('tab A signs in by hand', signedInView(A) && A.w.Core.getToken() === 'TOK1');

/* ---- tab B: "Open Link in New Tab" on a menu item, while A is signed in ---- */
const B = await openTab('#s=sales_plan');
await wait(900);
check('the new tab does not ask for a sign-in', signedInView(B));
check('it carries the same session, not a new one', B.w.Core.getToken() === 'TOK1' && live.size === 1);
check('the session was checked with the server before it was used',
  calls.some(c => c.action === 'session' && c.tok === 'TOK1'));
check('it lands on the screen the link named', B.w.document.querySelector('.panel.on') &&
  B.w.document.querySelector('.panel.on').dataset.panel === 'sales_plan');
check('the token is in the new tab\'s sessionStorage, so framed screens can use it',
  B.w.sessionStorage.getItem('app_token') === 'TOK1');
check('nothing was put in localStorage', A.w.localStorage.getItem('app_token') === null && B.w.localStorage.getItem('app_token') === null);

/* ---- a third tab opened from either of them joins the same session ---- */
const G = await openTab('#s=home');
await wait(900);
check('a third tab joins the same session too', signedInView(G) && G.w.Core.getToken() === 'TOK1');

/* ---- signing out in A ends the shared session in every tab ---- */
click(A, A.$('t-out')); await wait(300);
check('the session is ended on the server', !live.has('TOK1'));
check('tabs B and G are told, and drop the dead token at once', B.w.Core.getToken() === '' && G.w.Core.getToken() === '' && B.w.sessionStorage.getItem('app_token') === null);
check('and tab B goes back to the sign-in screen (reload requested)', B.errors.some(m => /navigation|reload/i.test(m)), B.errors.join(' | '));

/* ---- a reopened tab with a leftover token, and no signed-in tab open ---- */
live.add('STALE');
const D = await openTab('', 'STALE');
await wait(900);
check('with no signed-in tab open, a leftover token signs nobody in', !signedInView(D));
check('and the leftover session is ended on the server', !live.has('STALE'));

/* ---- a tab on the sign-in screen never answers ---- */
const E = await openTab('');
await wait(900);
check('a new tab next to tabs that are only on the sign-in screen is not signed in', !signedInView(E) && E.w.Core.getToken() === '');

/* ---- the website, framed inside the IDMS, reads the IDMS session ---- */
const site = fs.readFileSync('index.html', 'utf8');
check('the framed website reads the tab session (sessionStorage) when embedded',
  /EMBED_MODE&&sessionStorage\.getItem\(TOKEN_KEY\)/.test(site));
check('and never writes the IDMS token to localStorage when embedded', /if\(!EMBED_MODE&&t\) localStorage\.setItem/.test(site));

let pass = 0;
for (const [n, ok, x] of results) { console.log((ok ? '  ok ' : '  x  ') + n + (ok ? '' : '   [' + x + ']')); if (ok) pass++; }
console.log(`\n${pass} passed, ${results.length - pass} failed, of ${results.length}`);
process.exit(0);
