/* The three login tiers, and the one rule that matters most:
   **nobody but a Developer Admin can see or touch a Developer Admin login.**

   That rule is tested against the REAL auth handler, not a mock of what it is
   meant to do, for the same reason keybackuptest and flushservertest exist —
   this is an access boundary, and a boundary that is only described is not a
   boundary. The screen half is checked separately, in a booted page, because
   hiding a control and refusing the request are two different jobs and this
   round needed both.

   `MANAGES` in server/routes/auth.js is the whole rule:
     developer → developer, admin, staff
     admin     → admin, staff          (no developer, in any direction) */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const fake = pathToFileURL(process.cwd() + '/tests/fake-db.mjs').href;
/* notify.js is redirected too — auth.js imports it for the OTP paths, which
   this suite never walks, and letting it load would drag in a second copy of
   the database module the hook has just replaced. */
const notifyStub = 'data:text/javascript,' +
  encodeURIComponent('export async function sendNotification(){ return []; }');
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    const from = ctx.parentURL || '';
    if (spec === '../server/_db.js' && from.endsWith('/server/routes/auth.js'))
      return { url: ${JSON.stringify(fake)}, shortCircuit: true };
    if (spec === './notify.js' && from.endsWith('/server/routes/auth.js'))
      return { url: ${JSON.stringify(notifyStub)}, shortCircuit: true };
    return next(spec, ctx);
  }`));
const { db, scryptHash, newSalt } = await import(fake);
const handler = (await import('../server/routes/auth.js')).default;

function call(body, token) {
  return new Promise(resolve => {
    const req = { method: 'POST', headers: token ? { 'x-auth-token': token } : {}, body };
    const res = { statusCode: 200, setHeader() {},
      status(c) { this.statusCode = c; return this; },
      json(x) { resolve({ status: this.statusCode, json: x }); },
      end() { resolve({ status: this.statusCode }); } };
    handler(req, res).catch(e => resolve({ status: 500, json: { ok: false, error: e.message } }));
  });
}

const results = [];
const check = (n, c, x) => results.push([n, !!c, x || '']);
/* Every row this suite reaches for is one the code under test is supposed to
   have written or refused to write. A build that writes none of them must make
   these checks FAIL, not take the suite down before the first of them runs —
   a harness has to survive the very case it exists to catch. */
const U = n => db.users[n] || {};

/* three logins already on file, one of each tier */
const mk = (username, role, pass) => ({ username, role, active: true,
  pass_hash: scryptHash(pass, newSalt()), permissions: [], auth_methods: null });
db.users.devguy = mk('devguy', 'developer', 'devpassword');
db.users.dev2 = mk('dev2', 'developer', 'devpassword2');
db.users.clientadmin = mk('clientadmin', 'admin', 'adminpassword');
db.users.ravi = mk('ravi', 'staff', 'staffpassword');
db.sessions.DEVTOK = { username: 'devguy', role: 'developer' };
db.sessions.ADMTOK = { username: 'clientadmin', role: 'admin' };
db.sessions.STAFFTOK = { username: 'ravi', role: 'staff' };

// ---------- the tier a sign-in screen was on ----------
{
  const wrong = await call({ action: 'login', user: 'ravi', pass: 'staffpassword', tier: 'developer' });
  check('signing in as a User under the Developer Admin heading is refused',
    wrong.status === 403 && !wrong.json.token, wrong.status + ' ' + JSON.stringify(wrong.json).slice(0, 90));
  check('…and is told which heading to use instead, rather than a bare failure',
    /not a Developer Admin login/.test(wrong.json.error || '') && /User/.test(wrong.json.error || ''),
    wrong.json.error);
  const right = await call({ action: 'login', user: 'ravi', pass: 'staffpassword', tier: 'user' });
  check('the right heading signs in normally', right.status === 200 && !!right.json.token,
    JSON.stringify(right.json).slice(0, 80));
  /* the tier must never become a way to find out what kind of login a name is:
     a wrong password has to look identical whichever heading was chosen */
  const bad = await call({ action: 'login', user: 'devguy', pass: 'nottherightone', tier: 'user' });
  check('a wrong password says the same thing whatever tier was chosen, so the ' +
    'heading cannot be used to probe for a Developer Admin login',
    bad.status === 401 && /Incorrect username or password/.test(bad.json.error || '') &&
    !/Developer/.test(bad.json.error || ''), bad.json.error);
  const noTier = await call({ action: 'login', user: 'ravi', pass: 'staffpassword' });
  check('an old client that sends no tier at all still signs in',
    noTier.status === 200 && !!noTier.json.token, JSON.stringify(noTier.json).slice(0, 60));
}

// ---------- self sign-up ----------
{
  const r = await call({ action: 'signup', user: 'newfitter', pass: 'longenough1',
    email: 'f@works.test', note: 'CNC section', tier: 'user' });
  check('somebody can create their own login', r.status === 200 && r.json.ok, JSON.stringify(r.json).slice(0, 90));
  check('…but it arrives INACTIVE, so creating it grants nothing',
    U('newfitter').active === false,
    JSON.stringify(U('newfitter').active));
  check('…marked as a sign-up, so it can be told apart from one an administrator switched off',
    !!U('newfitter').signup_at);
  check('…at the User role, never anything higher',
    U('newfitter').role === 'staff', U('newfitter').role);
  check('…and nothing is signed in — no token comes back',
    !r.json.token, JSON.stringify(Object.keys(r.json)));
  const login = await call({ action: 'login', user: 'newfitter', pass: 'longenough1' });
  check('a login waiting for approval cannot sign in',
    login.status === 403 && !login.json.token, login.status + '');
  check('…and is told it is waiting, not that it was deactivated',
    /waiting for your developer administrator/i.test(login.json.error || ''), login.json.error);

  const dev = await call({ action: 'signup', user: 'sneaky', pass: 'longenough1', tier: 'developer' });
  check('a Developer Admin login cannot be created from the sign-in screen',
    dev.status === 403 && !db.users.sneaky, dev.status + ' ' + JSON.stringify(dev.json).slice(0, 80));
  const devByRole = await call({ action: 'signup', user: 'sneaky2', pass: 'longenough1', role: 'developer' });
  check('…nor by asking for the role instead of the tier',
    devByRole.status === 403 && !db.users.sneaky2, devByRole.status + '');

  const taken = await call({ action: 'signup', user: 'ravi', pass: 'longenough1' });
  check('a username already in use is refused rather than overwriting the login on file',
    taken.status === 409 && U('ravi').role === 'staff' && U('ravi').active === true,
    taken.status + '');
  const short = await call({ action: 'signup', user: 'shorty', pass: 'abc' });
  check('a password under eight characters is refused, the same rule as everywhere else',
    short.status === 400 && !db.users.shorty, short.status + '');

  /* Face ID at sign-up: the reading is attached to an account that cannot
     sign in yet, so it costs nothing and saves a second trip. */
  const face = await call({ action: 'signup', user: 'facefitter', pass: 'longenough1',
    descriptor: Array.from({ length: 128 }, (_, i) => i / 128) });
  check('a face registered during sign-up is stored against the new login',
    face.json.face === true && Array.isArray(U('facefitter').face_descriptor) &&
    U('facefitter').face_descriptor.length === 128,
    JSON.stringify(face.json).slice(0, 80));
  check('…on an account that still cannot sign in until it is approved',
    U('facefitter').active === false, JSON.stringify(U('facefitter').active));
}

// ---------- who may SEE whose login ----------
{
  const asDev = await call({ action: 'listUsers' }, 'DEVTOK');
  const devNames = (asDev.json.users || []).map(u => u.username);
  check('a Developer Admin sees every login, their own tier included',
    devNames.includes('devguy') && devNames.includes('clientadmin') && devNames.includes('ravi'),
    devNames.join(','));

  const asAdmin = await call({ action: 'listUsers' }, 'ADMTOK');
  const admNames = (asAdmin.json.users || []).map(u => u.username);
  check('a Client Admin can open the list at all', asAdmin.status === 200 && asAdmin.json.ok);
  /* the rule, stated as plainly as it can be: not greyed out, not listed as
     restricted — absent */
  check('…and a Developer Admin login is ABSENT from it, not merely hidden on screen',
    !admNames.includes('devguy') && !admNames.includes('dev2'), admNames.join(','));
  check('…while their own people are all there',
    admNames.includes('clientadmin') && admNames.includes('ravi'), admNames.join(','));
  check('…and the reply says which roles this account may manage, so the screen ' +
    'need not guess', Array.isArray(asAdmin.json.manages) &&
    !asAdmin.json.manages.includes('developer') && asAdmin.json.manages.includes('staff'),
    JSON.stringify(asAdmin.json.manages));

  const asStaff = await call({ action: 'listUsers' }, 'STAFFTOK');
  check('an ordinary User cannot open the list at all',
    asStaff.status === 403 && !asStaff.json.users, asStaff.status + '');
  const anon = await call({ action: 'listUsers' });
  check('nor can somebody with no session', anon.status === 403 && !anon.json.users, anon.status + '');
}

// ---------- who may CHANGE whose login ----------
{
  const hack = await call({ action: 'saveUser', username: 'devguy', role: 'staff' }, 'ADMTOK');
  check('a Client Admin cannot change a Developer Admin login',
    hack.status === 403 && U('devguy').role === 'developer',
    hack.status + ' role now ' + U('devguy').role);
  check('…and the refusal does not name it as a developer login',
    !/developer/i.test(hack.json.error || ''), hack.json.error);

  const grant = await call({ action: 'saveUser', username: 'newguy', role: 'developer',
    password: 'longenough1' }, 'ADMTOK');
  check('a Client Admin cannot hand out the Developer Admin role either',
    grant.status === 403 && !db.users.newguy, grant.status + '');

  const ok = await call({ action: 'saveUser', username: 'ravi', role: 'staff',
    email: 'ravi@works.test' }, 'ADMTOK');
  check('…but can manage their own people normally',
    ok.status === 200 && U('ravi').email === 'ravi@works.test',
    ok.status + ' ' + U('ravi').email);
  const peer = await call({ action: 'saveUser', username: 'secondadmin', role: 'admin',
    password: 'longenough1' }, 'ADMTOK');
  check('…including creating another Admin alongside them',
    peer.status === 200 && U('secondadmin').role === 'admin',
    peer.status + ' ' + JSON.stringify(U('secondadmin').role));

  const devMoves = await call({ action: 'saveUser', username: 'clientadmin', role: 'staff' }, 'DEVTOK');
  check('a Developer Admin can still change anybody',
    devMoves.status === 200 && U('clientadmin').role === 'staff', devMoves.status + '');
  await call({ action: 'saveUser', username: 'clientadmin', role: 'admin' }, 'DEVTOK');

  const del = await call({ action: 'deleteUser', username: 'dev2' }, 'ADMTOK');
  check('a Client Admin cannot delete a Developer Admin login either',
    del.status === 403 && !!db.users.dev2, del.status + '');
  const delOwn = await call({ action: 'deleteUser', username: 'ravi' }, 'ADMTOK');
  check('…but can remove one of their own', delOwn.status === 200 && !db.users.ravi, delOwn.status + '');
}

// ---------- the last Developer Admin ----------
{
  await call({ action: 'deleteUser', username: 'dev2' }, 'DEVTOK');
  const devs = Object.values(db.users).filter(u => u.role === 'developer').length;
  check('the fixture is now down to one Developer Admin login', devs === 1, String(devs));
  const demote = await call({ action: 'saveUser', username: 'devguy', role: 'staff' }, 'DEVTOK');
  check('the only Developer Admin login cannot be demoted — the server refuses it, ' +
    'not just the screen', demote.status === 400 && U('devguy').role === 'developer',
    demote.status + ' ' + U('devguy').role);
  check('…and says why, naming what would be lost',
    /only Developer Admin login/i.test(demote.json.error || ''), demote.json.error);
  db.sessions.DEV2TOK = { username: 'devguy', role: 'developer' };
  const rm = await call({ action: 'deleteUser', username: 'devguy' }, 'DEV2TOK');
  check('nor can it be deleted by another Developer Admin session',
    rm.status === 400 && !!db.users.devguy, rm.status + '');
}

// ================= the sign-in screen itself =================
{
  const html = fs.readFileSync('idms.html', 'utf8');
  const core = fs.readFileSync('core.js', 'utf8');
  const kpi = fs.readFileSync('kpi.js', 'utf8');
  const posts = [];
  const vc = new VirtualConsole();
  const pageErrors = [];
  vc.on('jsdomError', e => pageErrors.push(e.message));
  const dom = new JSDOM(html.replace(/<script src="\/(core|kpi|chrome|drawing-convert)\.js"><\/script>/g, ''),
    { runScripts: 'outside-only', url: 'https://example.test/idms.html', virtualConsole: vc });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.fetch = async (path, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : {};
    const url = String(path);
    const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
    if (url.startsWith('/api/auth')) {
      posts.push(body);
      if (body.action === 'session') return { ok: false, status: 401, json: async () => ({ error: 'no' }) };
      if (body.action === 'signup') return ok({ pending: true, user: body.user, face: !!body.descriptor,
        note: 'Your login has been created.' });
      return ok({});
    }
    if (url.startsWith('/api/content')) return ok({ data: { company: { legalName: 'Test Mfg' } } });
    return ok({});
  };
  window.eval(core); window.eval(kpi);
  window.eval(html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1]);
  const $ = id => window.document.getElementById(id);
  const click = el => el && el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await wait(150);

  const tiers = [...window.document.querySelectorAll('#g-tiers .g-tier')].map(t => t.dataset.tier);
  check('the sign-in screen offers all three logins to choose between',
    tiers.join(',') === 'user,admin,developer', tiers.join(','));
  check('User is the one it opens on — the tier most people are',
    ($('g-tiers').querySelector('.g-tier.on') || {}).dataset?.tier === 'user',
    ($('g-tiers').querySelector('.g-tier.on') || {}).outerHTML);
  check('creating a login and changing a password are offered on the User tier',
    $('g-selfservice').style.display !== 'none' && !!$('g-signup-link') && !!$('g-change-link'));

  click(window.document.querySelector('.g-tier[data-tier="developer"]'));
  await wait(60);
  /* the sign-in-screen half of "nobody can view or control the developer
     login": it is not advertised, not claimable and not resettable from here */
  check('choosing Developer Admin withdraws both of them entirely',
    $('g-selfservice').style.display === 'none', $('g-selfservice').style.display);
  click(window.document.querySelector('.g-tier[data-tier="admin"]'));
  await wait(60);
  check('choosing Admin offers them again — a client administrator may create their own',
    $('g-selfservice').style.display !== 'none', $('g-selfservice').style.display);

  posts.length = 0;
  click($('g-signup-link'));
  await wait(60);
  check('Create a login opens its own form in place of the sign-in fields',
    $('g-signup').classList.contains('on') && $('g-tabs').style.display === 'none');
  $('gs-user').value = 'newadmin'; $('gs-pass').value = 'longenough1';
  $('gs-pass2').value = 'different1';
  click($('gs-go'));
  await wait(120);
  check('two passwords that do not match are caught before anything is sent',
    posts.length === 0 && /do not match/.test($('gs-msg').textContent), $('gs-msg').textContent);
  $('gs-pass2').value = 'longenough1';
  $('gs-email').value = 'a@works.test';
  click($('gs-go'));
  await wait(150);
  const sent = posts.filter(p => p.action === 'signup')[0] || {};
  check('the sign-up is sent with the tier that was chosen',
    sent.user === 'newadmin' && sent.tier === 'admin', JSON.stringify(sent).slice(0, 110));
  check('…and with no face reading when none was captured',
    sent.descriptor === undefined, JSON.stringify(sent.descriptor));
  check('the screen says it is waiting for approval rather than claiming a sign-in',
    /created/i.test($('gs-msg').textContent) && !$('gate').classList.contains('gone'),
    $('gs-msg').textContent);

  posts.length = 0;
  click($('gs-back'));
  await wait(60);
  check('Back to sign in puts the sign-in fields back', !$('g-signup').classList.contains('on') &&
    $('g-tabs').style.display !== 'none');

  click($('g-change-link'));
  await wait(60);
  check('Change my password is its own form, usable without signing in first',
    $('g-changepass').classList.contains('on') && !!$('gc-old') && !!$('gc-new'));
  $('gc-user').value = 'ravi'; $('gc-old').value = 'oldpassword';
  $('gc-new').value = 'newpassword1'; $('gc-new2').value = 'typoinit1';
  click($('gc-go'));
  await wait(120);
  check('a mistyped confirmation is caught before anything is sent',
    posts.length === 0 && /do not match/.test($('gc-msg').textContent), $('gc-msg').textContent);
  $('gc-new2').value = 'newpassword1';
  click($('gc-go'));
  await wait(150);
  const ch = posts.filter(p => p.action === 'change')[0] || {};
  check('…and a matching pair goes through the existing change endpoint',
    ch.user === 'ravi' && ch.oldPass === 'oldpassword' && ch.newPass === 'newpassword1',
    JSON.stringify(ch).slice(0, 110));

  posts.length = 0;
  click($('gc-back'));
  await wait(60);
  click(window.document.querySelector('.g-tier[data-tier="developer"]'));
  await wait(60);
  $('g-user').value = 'devguy'; $('g-pass').value = 'devpassword';
  click($('g-go'));
  await wait(150);
  const li = posts.filter(p => p.action === 'login')[0] || {};
  check('signing in sends the chosen tier along, so the server can check it',
    li.tier === 'developer', JSON.stringify(li).slice(0, 90));

  check('no console errors while any of this ran', pageErrors.length === 0, pageErrors.join(' | '));
}

const failed = results.filter(([, ok]) => !ok);
for (const [n, ok, x] of results) console.log((ok ? '  ok  ' : '  X   ') + n + (ok ? '' : '   [' + x + ']'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, of ${results.length}`);
process.exit(failed.length ? 1 : 0);
