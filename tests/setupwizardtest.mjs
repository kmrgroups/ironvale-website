/* Setup Wizard. The one thing worth being paranoid about, same as Company
   Profile and Statutory & Masters before it: Step 1 saves to /api/content,
   which overwrites the WHOLE site_content record — so saving a company name
   here must never wipe out unrelated settings that live in the same blob. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let content = {
  pricing: { markupPct: 18 }, // must survive Step 1's save
  company: {}, // empty on purpose — a brand new deployment
  statutory: {}, hrMasters: {}
};
let users = [{ username: 'tester', role: 'developer' }];
let docs = [{ doc_id: 'c1', kind: 'customer', data: { name: 'Existing Co' } }];
let parts = [];
let secrets = {}; // /api/settings' own store — separate from site_content
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
    if (body.action === 'listUsers') return ok({ users });
    if (body.action === 'saveUser') {
      calls.push({ kind: 'user-save', body });
      users.push({ username: body.username, role: body.role });
      return ok({});
    }
    return ok({});
  }
  if (url.startsWith('/api/rfqs')) return ok({ rfqs: [] });
  if (url.startsWith('/api/hr')) return ok({ employees: [], items: [] });
  if (url.startsWith('/api/idms')) {
    if (url.includes('what=settings')) return ok({ settings: {} });
    if (url.includes('what=parts')) return ok({ parts });
    if (url.includes('what=serial')) return ok({ next: 1 });
    if (url.includes('what=docs')) {
      const kind = decodeURIComponent((url.match(/kind=([^&]+)/) || [, ''])[1]);
      return ok({ docs: docs.filter(d => !kind || d.kind === kind) });
    }
    if (url.includes('what=audit')) return ok({ audit: [] });
    return ok({});
  }
  if (url.startsWith('/api/content')) {
    if (!opts.method || opts.method === 'GET') return ok({ data: content });
    if (opts.method === 'POST') { calls.push({ kind: 'content-save', body }); content = body.data; return ok({}); }
    return ok({});
  }
  if (url.startsWith('/api/settings')) {
    if (!opts.method || opts.method === 'GET') {
      var out = {};
      Object.keys(secrets).forEach(function(k){ out[k] = { masked: secrets[k].slice(0,4) + '••••', source: 'panel' }; });
      return ok({ settings: out });
    }
    if (opts.method === 'POST') { calls.push({ kind: 'setting-save', body }); secrets[body.name] = body.value; return ok({}); }
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
const set = (id, v) => { $(id).value = v; };

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(300);

check('the Setup Wizard is a live menu entry', !!window.document.querySelector('#menubar [data-s="admin_wizard"]'));
nav('admin_wizard');
await wait(250);

// ---------- starts on step 1, Back hidden, dots reflect nothing done yet ----------
check('step 1 is shown first', window.document.querySelector('.wiz-step[data-wiz="1"]').classList.contains('on'));
check('Back is hidden on the first step', window.getComputedStyle($('wiz-back')).visibility === 'hidden');
check('the company step is not marked done yet (nothing entered)',
  !window.document.querySelector('.wiz-dot[data-wiz-dot="1"]').classList.contains('done'));

// ---------- Step 1: incomplete fields refused, then a proper save ----------
set('wz-legalName', 'New Co');
click($('wiz-next'));
await wait(150);
check('moving on without a document prefix is refused', /prefix are needed/i.test($('wz1-msg').textContent));

set('wz-docPrefix', 'newco'); set('wz-city', 'Pune');
click($('wiz-next'));
await wait(200);
const step1Save = calls.find(c => c.kind === 'content-save');
check('a complete step 1 saves to /api/content', !!step1Save, JSON.stringify(calls));
check('the prefix is upper-cased on save', step1Save && step1Save.body.data.company.docPrefix === 'NEWCO');
check('unrelated pricing settings survive the save', step1Save && step1Save.body.data.pricing.markupPct === 18);
check('it advances to step 2 on success', window.document.querySelector('.wiz-step[data-wiz="2"]').classList.contains('on'));

// ---------- Step 2: shows the current user, only one login exists ----------
await wait(150);
check('the signed-in user is named', $('wz2-me').textContent === 'tester');
check('only one login is flagged as worth adding a second of',
  /only your own/.test($('wz2-status').textContent), $('wz2-status').textContent);

// add a second login
set('wz-u-name', 'estimator1');
click($('wz-u-add'));
await wait(150);
check('adding with too short a password is refused', /at least 8/i.test($('wz2-msg').textContent));
set('wz-u-pass', 'longenoughpass');
click($('wz-u-add'));
await wait(200);
const userCall = calls.find(c => c.kind === 'user-save');
check('a valid new login is created via the shared auth endpoint', !!userCall && userCall.body.username === 'estimator1');
check('it defaults to staff, not administrator', userCall && userCall.body.role === 'staff');

// ---------- Step 3: real master counts, not invented ----------
click($('wiz-next'));
await wait(200);
check('step 3 shows the real customer count (1 seeded)', /1<\/b><span>Customers/.test($('wz3-stat').innerHTML) || $('wz3-stat').textContent.includes('1'), $('wz3-stat').textContent);
check('step 3 shows zero parts, honestly, not a guess', $('wz3-stat').textContent.includes('0'));

// ---------- Step 6: Connections — status reflects what's actually saved ----------
click(window.document.querySelector('.wiz-dot[data-wiz-dot="6"]'));
await wait(200);
check('the connections step shows nothing saved yet, honestly', /Nothing saved in this group yet/.test($('wz-set-email-status').textContent));

set('wz-set-RESEND_API_KEY', 're_testkey1234');
set('wz-set-FROM_EMAIL', 'Test Co <sales@test.com>');
click(window.document.querySelector('[data-wz-save-group="email"]'));
await wait(200);
const settingCalls = calls.filter(c => c.kind === 'setting-save');
check('saving the email group posts each typed key to /api/settings',
  settingCalls.some(c => c.body.name === 'RESEND_API_KEY' && c.body.value === 're_testkey1234') &&
  settingCalls.some(c => c.body.name === 'FROM_EMAIL'), JSON.stringify(settingCalls));
check('an untouched key in the same group (OWNER_EMAIL) is not sent', !settingCalls.some(c => c.body.name === 'OWNER_EMAIL'));
check('the status line reflects the saved key, masked, not in the clear',
  /RESEND_API_KEY/.test($('wz-set-email-status').textContent) && !$('wz-set-email-status').textContent.includes('re_testkey1234'),
  $('wz-set-email-status').textContent);

// ---------- readiness badges: "could actually work", not "something was typed" ----------
/* the email group save above included FROM_EMAIL as well as the key, so email
   is legitimately Ready here — asserting Incomplete would have been asserting
   my own mistaken assumption rather than the behaviour */
check('email shows Ready once both a key and a sender address are saved',
  $('wz-badge-email').textContent === 'Ready', $('wz-badge-email').textContent);
check('AI shows Not set up when no provider key exists at all',
  $('wz-badge-ai').textContent === 'Not set up', $('wz-badge-ai').textContent);
set('wz-set-WHATSAPP_TOKEN', 'tok123');
click(window.document.querySelector('[data-wz-save-group="whatsapp"]'));
await wait(250);
check('WhatsApp with only a token is Incomplete, not Ready — it needs the phone id and template too',
  $('wz-badge-whatsapp').textContent === 'Incomplete', $('wz-badge-whatsapp').textContent);

// ---------- the live test buttons ----------
let notifyCalls = [];
const realFetch = window.fetch;
window.fetch = async (path, opts) => {
  if (String(path).startsWith('/api/notify')) {
    notifyCalls.push(opts && opts.body ? JSON.parse(opts.body) : {});
    return { ok: true, status: 200, json: async () => ({ ok: true, results: ['EMAIL SENT to you@test.com'] }) };
  }
  return realFetch(path, opts);
};
set('wz-set-OWNER_EMAIL', 'you@test.com');
click($('wz-test-email'));
await wait(250);
check('the test email actually goes through /api/notify', notifyCalls.length === 1, JSON.stringify(notifyCalls));
check('it is addressed to the alert address typed in',
  notifyCalls[0] && notifyCalls[0].payload.to === 'you@test.com');
check('the result is reported back on screen', /EMAIL SENT/.test($('wz-test-email-result').textContent),
  $('wz-test-email-result').textContent);

notifyCalls = [];
click($('wz-test-wa'));
await wait(250);
check('a WhatsApp test with no number saved refuses rather than sending nowhere',
  /Enter your WhatsApp number/.test($('wz-test-wa-result').textContent) && notifyCalls.length === 0,
  $('wz-test-wa-result').textContent);
window.fetch = realFetch;

// ---------- Step 7 (jump via dots): summary reflects real state ----------
click(window.document.querySelector('.wiz-dot[data-wiz-dot="7"]'));
await wait(150);
check('jumping via the dots works, not just Next', window.document.querySelector('.wiz-step[data-wiz="7"]').classList.contains('on'));
check('the company step is now shown as done in the final summary',
  /✓/.test($('wz6-summary').textContent) && $('wz6-summary').textContent.includes('Company profile'));
check('the masters step is correctly shown as NOT done (parts and machines are still zero)',
  /✗/.test($('wz6-summary').textContent));
check('the connections step is shown as done now that a key is saved',
  $('wz6-summary').textContent.includes('Email or AI connected'));

check('no console errors while any of this ran', pageErrors.length === 0, pageErrors.join(' | '));

const failed = results.filter(([, ok]) => !ok);
for (const [n, ok, x] of results) console.log((ok ? '  ok  ' : '  X   ') + n + (ok ? '' : '   [' + x + ']'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, of ${results.length}`);
process.exit(failed.length ? 1 : 0);
