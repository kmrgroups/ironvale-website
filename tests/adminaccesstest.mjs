/* Client Admin vs Developer Admin.

   Two halves, because the feature has two: the rule about which admin screens
   a non-administrator is offered (the menu, in a real page), and the rule
   about who may change that rule (the real /api/idms handler — a setting
   anyone could rewrite would be decoration, not a control).

   What this does NOT claim, and the screen says so too: this is not the guard
   on anything dangerous. Managing logins, flushing and revealing the keys each
   carry their own server-side role check, tested where they live. */
import fs from 'fs';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------- server half
const fake = pathToFileURL(process.cwd() + '/tests/fake-db.mjs').href;
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec === '../server/_db.js' && ctx.parentURL && ctx.parentURL.endsWith('/server/routes/idms.js'))
      return { url: ${JSON.stringify(fake)}, shortCircuit: true };
    return next(spec, ctx);
  }`));
const { db } = await import(fake);
const handler = (await import('../server/routes/idms.js')).default;

const results = [];
const check = (n, c, x) => results.push([n, !!c, x || '']);

function call({ method = 'GET', query = {}, headers = {}, body = {} }) {
  return new Promise(resolve => {
    const req = { method, query, headers, body };
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      send(x) { resolve({ status: this.statusCode, text: String(x) }); },
      json(x) { resolve({ status: this.statusCode, json: x }); },
      end() { resolve({ status: this.statusCode }); } };
    handler(req, res).catch(e => resolve({ status: 500, json: { ok: false, error: e.message } }));
  });
}

db.sessions.DEV = { username: 'asha', role: 'developer' };
db.sessions.STAFF = { username: 'ravi', role: 'staff' };
const auditBefore = db.idmsAudit.length;

let r = await call({ method: 'POST', query: { what: 'settings' }, headers: { 'x-auth-token': 'STAFF' },
  body: { what: 'settings', key: 'admin_access', data: { developerOnly: [] } } });
check('an ordinary login cannot rewrite the admin-access rule', r.status === 403, JSON.stringify(r));
check('and nothing was stored by the refused attempt', db.settings.admin_access === undefined);

/* an ordinary setting is untouched by this — a works preference is not an
   access control, and every screen that saves one must keep working */
r = await call({ method: 'POST', query: { what: 'settings' }, headers: { 'x-auth-token': 'STAFF' },
  body: { what: 'settings', key: 'theme', data: { name: 'slate' } } });
check('an ordinary setting can still be saved by anyone signed in',
  r.status === 200 && db.settings.theme.name === 'slate', JSON.stringify(r));

r = await call({ method: 'POST', query: { what: 'settings' }, headers: { 'x-auth-token': 'DEV' },
  body: { what: 'settings', key: 'admin_access', data: { developerOnly: ['users', 'admin_backup'] } } });
check('the administrator can set it', r.status === 200 &&
  db.settings.admin_access.developerOnly.join() === 'users,admin_backup', JSON.stringify(r));
const row = db.idmsAudit[db.idmsAudit.length - 1];
check('changing who can reach an admin screen is audited',
  db.idmsAudit.length === auditBefore + 1 && row.kind === 'settings' && row.ref === 'admin_access' &&
  row.who === 'asha', JSON.stringify(row));

// ---------------------------------------------------------------- screen half
const { JSDOM, VirtualConsole } = await import('jsdom');
const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

/* one booted page per role, because what a login is offered is decided at
   sign-in and drawn once */
async function boot(role, adminAccess, url) {
  const idmsSettings = adminAccess ? { admin_access: adminAccess } : {};
  const saved = [];
  let signedIn = false;
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', e => errs.push(e.message));
  const dom = new JSDOM(html.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''),
    { runScripts: 'outside-only', url: url || 'https://example.test/idms.html', virtualConsole: vc });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.fetch = async (path, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : {};
    const url = String(path);
    const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
    if (url.startsWith('/api/auth')) {
      if (body.action === 'login') { signedIn = true; return ok({ token: 'T', user: 'u', role }); }
      if (body.action === 'session') return signedIn ? ok({ user: 'u', role })
        : { ok: false, status: 401, json: async () => ({ error: 'Not signed in' }) };
      if (body.action === 'listUsers') return ok({ users: [{ username: 'u', role }] });
      return ok({});
    }
    if (url.startsWith('/api/content')) return ok({ data: { company: { legalName: 'Test Mfg' } } });
    if (url.startsWith('/api/settings')) return ok({ settings: {} });
    if (url.startsWith('/api/hr')) return ok({ employees: [], items: [] });
    if (url.startsWith('/api/rfqs')) return ok({ rfqs: [] });
    if (url.startsWith('/api/idms')) {
      if (!opts.method || opts.method === 'GET') {
        if (url.includes('what=settings')) return ok({ settings: idmsSettings });
        if (url.includes('what=parts')) return ok({ parts: [] });
        if (url.includes('what=docs')) return ok({ docs: [] });
        if (url.includes('what=audit')) return ok({ audit: [] });
        return ok({});
      }
      if (body.what === 'settings') { saved.push(body); idmsSettings[body.key] = body.data; return ok({}); }
      return ok({});
    }
    return ok({});
  };
  window.eval(core); window.eval(kpi);
  window.eval(html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1]);
  const wait = ms => new Promise(res => setTimeout(res, ms));
  await wait(120);
  window.document.getElementById('g-user').value = 'u';
  window.document.getElementById('g-pass').value = 'x';
  window.document.getElementById('g-go').dispatchEvent(new window.Event('click'));
  await wait(350);
  return { window, saved, errs, wait };
}
const groupsOf = w => [...w.document.querySelectorAll('#menubar .mgroup > a')].map(a => a.textContent.trim());
const hasEntry = (w, s) => !!w.document.querySelector('#menubar [data-s="' + s + '"]');

// ---------- the administrator sees the split ----------
{
  const { window, saved, errs, wait } = await boot('developer');
  const groups = groupsOf(window);
  check('the admin menu is split in two', groups.some(g => /^⚙ Admin/.test(g)) &&
    groups.some(g => /Developer Admin/.test(g)), groups.join(' | '));
  check('Developer Admin comes straight after Admin, not somewhere random',
    groups.findIndex(g => /Developer Admin/.test(g)) ===
    groups.findIndex(g => /^⚙ Admin/.test(g)) + 1, groups.join(' | '));
  /* the four screens that cost somebody a day if pressed by mistake */
  ['users', 'admin_backup', 'admin_sample', 'admin_wizard',
   'admin_theme', 'admin_content', 'admin_banner', 'profile'].forEach(s => {
    const grp = window.document.querySelector('#menubar [data-s="' + s + '"]').closest('.mgroup');
    check(s + ' sits under Developer Admin by default',
      /Developer Admin/.test(grp.querySelector('a').textContent), grp.querySelector('a').textContent);
  });
  ['legal_docs', 'admin_quoting', 'dept_master', 'login_screen'].forEach(s => {
    const grp = window.document.querySelector('#menubar [data-s="' + s + '"]').closest('.mgroup');
    check(s + ' stays with the company’s own administrator',
      !/Developer Admin/.test(grp.querySelector('a').textContent), grp.querySelector('a').textContent);
  });
  check('the administrator can still reach everything in both halves',
    hasEntry(window, 'users') && hasEntry(window, 'admin_backup') && hasEntry(window, 'profile'));

  // ---------- and can move a screen either way ----------
  window.document.querySelector('#menubar [data-s="users"]')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(300);
  check('User Management offers the classification grid',
    window.document.getElementById('us-access-card').style.display !== 'none');
  const boxes = [...window.document.querySelectorAll('#us-access-grid .us-access')];
  check('the grid lists every screen in the admin menu, so a new one cannot slip through unclassified',
    boxes.length === 14, String(boxes.length));
  check('the ones kept back are exactly the developer-side screens',
    boxes.filter(b => !b.checked).map(b => b.value).sort().join() ===
    'admin_backup,admin_banner,admin_content,admin_sample,admin_theme,admin_wizard,profile,users',
    boxes.filter(b => !b.checked).map(b => b.value).join());

  /* hand Sample Data over, and take the theme editor back */
  boxes.filter(b => b.value === 'admin_sample')[0].checked = true;
  boxes.filter(b => b.value === 'admin_theme')[0].checked = false;
  window.document.getElementById('us-access-save')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(350);
  const post = saved.filter(s => s.key === 'admin_access').pop();
  check('saving stores the screens kept back, not the ones shared',
    post && post.data.developerOnly.indexOf('admin_sample') === -1 &&
    post.data.developerOnly.indexOf('admin_theme') !== -1 &&
    post.data.developerOnly.indexOf('users') !== -1,
    JSON.stringify(post && post.data));
  const after = window.document.querySelector('#menubar [data-s="admin_sample"]').closest('.mgroup');
  check('the menu redraws immediately — Sample Data moves across',
    !/Developer Admin/.test(after.querySelector('a').textContent), after.querySelector('a').textContent);
  const themeGrp = window.document.querySelector('#menubar [data-s="admin_theme"]').closest('.mgroup');
  check('…and the theme editor moves the other way',
    /Developer Admin/.test(themeGrp.querySelector('a').textContent));
  check('the screen says which ones are kept back',
    /Backup & Restore/.test(window.document.getElementById('us-access-msg').textContent),
    window.document.getElementById('us-access-msg').textContent);

  /* a reset that published itself would be a trap — same rule as the theme editor */
  const savesBefore = saved.length;
  window.document.getElementById('us-access-reset')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(150);
  check('Back to the suggested split changes the screen and saves nothing',
    saved.length === savesBefore &&
    [...window.document.querySelectorAll('#us-access-grid .us-access')]
      .filter(b => !b.checked).map(b => b.value).sort().join() ===
      'admin_backup,admin_banner,admin_content,admin_sample,admin_theme,admin_wizard,profile,users');
  check('and says so, rather than letting somebody think it is done',
    /Nothing is changed until/.test(window.document.getElementById('us-access-msg').textContent));
  check('no console errors while any of this ran', errs.length === 0, errs.join(' | '));
}

// ---------- an ordinary login is offered only the client half ----------
{
  /* restrictAccess is off — the default, and the case that was wrong: with it
     off, isPermitted returned true for everything, so every staff login was
     being offered User Management and Backup & Restore in its own menu */
  const { window, errs } = await boot('staff');
  const groups = groupsOf(window);
  check('a staff login is offered no Developer Admin menu at all',
    !groups.some(g => /Developer Admin/.test(g)), groups.join(' | '));
  check('User Management is not in their menu', !hasEntry(window, 'users'));
  check('nor is Backup & Restore, which holds both flushes', !hasEntry(window, 'admin_backup'));
  check('nor the wizard that holds the connection keys', !hasEntry(window, 'admin_wizard'));
  check('Company Profile is kept back too now — it is the letterhead on every document',
    !hasEntry(window, 'profile') && !hasEntry(window, 'admin_theme') && !hasEntry(window, 'admin_content'));
  check('but the client half is still theirs',
    hasEntry(window, 'legal_docs') && hasEntry(window, 'admin_quoting') && hasEntry(window, 'dept_master'));
  check('the ordinary working menus are untouched',
    hasEntry(window, 'parts') && hasEntry(window, 'rfq_pipeline') && hasEntry(window, 'hrm'));
  check('no console errors for the staff login either', errs.length === 0, errs.join(' | '));
}

// ---------- the menu is not the only gate ----------
{
  /* a hidden entry is not a lock: an old bookmark, or "open in a new tab" on
     a link somebody was sent, lands straight on #s=<screen>. go() asks
     isPermitted the same way the menu does, so it ends up on Home instead. */
  const { window } = await boot('staff', null, 'https://example.test/idms.html#s=users');
  const showing = w => [...w.document.querySelectorAll('.panel.on')].map(p => p.dataset.panel).join(',');
  check('a staff login opening a Developer Admin screen by its address lands on Home',
    showing(window) === 'home', showing(window));
  const { window: w2 } = await boot('staff', null, 'https://example.test/idms.html#s=legal_docs');
  check('…while a client-half screen opens exactly as it should',
    showing(w2) === 'legal_docs', showing(w2));
}

// ---------- the stored rule is what decides it, not the default ----------
{
  const { window } = await boot('staff', { developerOnly: ['legal_docs'] });
  check('a screen the administrator kept back is gone from the staff menu',
    !hasEntry(window, 'legal_docs'), 'legal_docs still listed');
  check('and one they shared is offered, even though it is kept back by default',
    hasEntry(window, 'users') && hasEntry(window, 'admin_backup'),
    'users/backup missing after being shared');
}

// ---------- a stale entry cannot lock away a working screen ----------
{
  const { window } = await boot('staff', { developerOnly: ['parts', 'hrm', 'users'] });
  check('a rule naming a screen outside the admin menu is ignored rather than obeyed',
    hasEntry(window, 'parts') && hasEntry(window, 'hrm'), 'a working screen was hidden');
  check('while the admin screen in the same rule is still kept back', !hasEntry(window, 'users'));
}

const failed = results.filter(([, ok]) => !ok);
for (const [n, ok, x] of results) console.log((ok ? '  ok  ' : '  X   ') + n + (ok ? '' : '   [' + x + ']'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, of ${results.length}`);
process.exit(failed.length ? 1 : 0);
