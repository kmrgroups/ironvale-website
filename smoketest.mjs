/* Smoke test: boot idms.html in jsdom against an in-memory fake API.
   The stub behaves like the real endpoint — saving a doc with an existing
   docId updates it rather than inserting a second copy — because a stub that
   is kinder than the server hides exactly the bugs worth finding. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let docs = [];
let parts = [];
let idSeq = 1;
const settings = {};
let signedIn = false;

function isoDaysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10);
}

/* a small works: four months of production, an inward inspection, a despatch */
for (let i = 0; i < 8; i++) {
  docs.push({
    doc_id: 'p' + i, kind: 'production', part_id: 'PART1', doc_no: 'PR-' + i, data: {
      date: isoDaysAgo(i * 12), made: 100 + i, rejected: i % 3, minutes: 480,
      runMinutes: 440, downtime: 40, plannedCycle: 240, machine: 'CNC-0' + (i % 2),
      operator: i % 2 ? 'R Kumar' : 'S Babu', rejectReason: 'Burr not removed',
      downtimeReason: i % 2 ? 'Machine breakdown' : 'Tool change'
    }
  });
}
docs.push({ doc_id: 'i1', kind: 'inward', doc_no: 'IW-1', data: { date: isoDaysAgo(10), received: 500, accepted: 495, rejected: 5, supplier: 'Steelco' } });
docs.push({ doc_id: 'o1', kind: 'order', doc_no: 'SO-1', data: { po: 'PO-1', qty: 500, due: isoDaysAgo(5), customerName: 'Alpha' } });
docs.push({ doc_id: 'c1', kind: 'dc', doc_no: 'DC-1', data: { date: isoDaysAgo(8), qty: 200, po: 'PO-1' } });
docs.push({ doc_id: 'g1', kind: 'gauge', doc_no: 'GA-1', data: { name: 'Micrometer', lastCalibrated: isoDaysAgo(30), frequencyMonths: 6, history: [{ on: isoDaysAgo(30) }] } });
parts.push({ part_id: 'PART1', part_no: 'ELIX-PART-0001', part_name: 'Housing', lifecycle: 'Series', data: {} });

const virtualConsole = new VirtualConsole();
const errors = [];
virtualConsole.on('jsdomError', e => errors.push('jsdomError: ' + e.message));
virtualConsole.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''), {
  runScripts: 'outside-only', url: 'https://example.test/idms.html', virtualConsole
});
const { window } = dom;

window.fetch = async (path, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : {};
  const url = String(path);
  const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });

  if (url.startsWith('/api/auth')) {
    if (body.action === 'login') { signedIn = true; return ok({ token: 'TOK', user: 'tester', role: 'developer' }); }
    if (body.action === 'session') return signedIn ? ok({ user: 'tester', role: 'developer' }) : { ok: false, status: 401, json: async () => ({ error: 'Not signed in' }) };
    if (body.action === 'logout') { signedIn = false; return ok({}); }
    if (body.action === 'whoami') return ok({ user: { username: 'tester', role: 'developer' } });
    return ok({});
  }
  if (url.startsWith('/api/content')) return ok({ data: { company: { legalName: 'Test Manufacturing Pvt Ltd', addressLine: 'Mysuru', docPrefix: 'TEST' } } });
  if (url.startsWith('/api/hr?what=employees')) return ok({ employees: [{ data: { empId: 'E1', doj: isoDaysAgo(400) } }] });
  if (url.startsWith('/api/hr?what=attendance')) return ok({ attendance: [{ day: isoDaysAgo(20), status: 'Present' }, { day: isoDaysAgo(21), status: 'Absent' }] });
  if (url.startsWith('/api/rfqs')) return ok({ rfqs: [{ ref: 'RFQ-1', date: isoDaysAgo(15), status: 'Won' }, { ref: 'RFQ-2', date: isoDaysAgo(16), status: 'New' }] });
  if (url.startsWith('/api/idms')) {
    if (url.includes('what=settings')) {
      if (opts.method === 'POST') { settings[body.key] = body.data; return ok({}); }
      return ok({ settings });
    }
    if (url.includes('what=parts')) return ok({ parts });
    if (url.includes('what=docs')) {
      const kind = decodeURIComponent((url.match(/kind=([^&]+)/) || [, ''])[1]);
      return ok({ docs: kind ? docs.filter(d => d.kind === kind) : docs });
    }
    if (url.includes('what=audit')) return ok({ rows: [] });
    if (opts.method === 'POST' && body.what === 'docs') {
      const d = body.doc;
      if (d.docId) {                                    // update in place, like the server
        const ex = docs.find(x => x.doc_id === d.docId);
        if (ex) { ex.data = d.data; ex.status = d.status; return ok({ docId: d.docId }); }
      }
      const id = 'new' + (idSeq++);
      docs.push({ doc_id: id, kind: d.kind, part_id: d.partId, doc_no: d.docNo, status: d.status, data: d.data });
      return ok({ docId: id });
    }
    if (url.includes('what=serial')) return ok({ next: idSeq++ });
    return ok({});
  }
  return ok({});
};

window.eval(core);
window.eval(kpi);
const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1];
window.eval(inline);

const $ = id => window.document.getElementById(id);
const wait = ms => new Promise(r => setTimeout(r, ms));
/* navigate the way a person does: click the menu entry */
function nav(id) {
  const a = id === 'home'
    ? window.document.querySelector('#menubar [data-home]')
    : window.document.querySelector('#menubar [data-s="' + id + '"]');
  if (!a) throw new Error('no menu entry for ' + id);
  a.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}
const results = [];
function check(name, cond, extra) {
  results.push([name, !!cond, extra || '']);
}

await wait(120);

// ---- 1. the sign-in screen ----
check('gate is showing (no automatic sign-in)', $('gate').style.display !== 'none');
check('app is hidden until sign-in', $('app').style.display === 'none');
check('company name on the gate', /Test Manufacturing/.test($('g-co').textContent), $('g-co').textContent);
check('welcome message names the company', /Welcome to Test Manufacturing/.test($('g-welcome').textContent), $('g-welcome').textContent);
check('powered-by links to KMR Groups',
  /kmr-groups\.com/.test(window.document.querySelector('.gate .powered a').href));
check('password field is not autofilled by the browser',
  $('g-pass').getAttribute('autocomplete') === 'new-password');
check('no session token stored before sign-in', !window.sessionStorage.getItem('app_token'));

// ---- 2. sign in ----
$('g-user').value = 'tester'; $('g-pass').value = 'secret123';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(250);
check('signed in — app visible', $('app').style.display === '');

// ---- 3. the menu ----
const groups = [...window.document.querySelectorAll('#menubar .mgroup > a')].map(b => b.textContent.trim());
const want = ['Home', 'Top Management', 'QMS', 'Marketing', 'NPD', 'Purchase & SCM', 'PPC & MMD',
  'Production', 'Quality Assurance', 'Maintenance', 'HRM', 'Accounts', 'Admin'];
want.forEach(w => check('menu has ' + w, groups.some(g => g.includes(w)), groups.join(' | ')));
check('menu is in the asked-for order',
  want.slice(1).every((w, i) => groups.findIndex(g => g.includes(w)) > 0 &&
    groups.findIndex(g => g.includes(w)) === i + 1), groups.join(' | '));

// ---- 4. the home screen ----
check('no Change banner button on home', !$('bn-edit'));
check('no Quick Access shortcuts on home', !$('qa-grid'));
check('no sample-data card on home',
  !window.document.querySelector('[data-panel="home"] #demo-add'));
check('sample data moved to Admin',
  !!window.document.querySelector('[data-panel="admin_sample"] #demo-add'));

// ---- 5. top bar ----
check('Export/Import are off the top bar',
  !window.document.querySelector('.top #t-export') && !window.document.querySelector('.top #t-import'));
check('Export/Import live in Backup & Restore',
  !!window.document.querySelector('[data-panel="admin_backup"] #t-export') &&
  !!window.document.querySelector('[data-panel="admin_backup"] #t-import'));
check('database chip still reports', /connected/i.test($('t-dbtext').textContent), $('t-dbtext').textContent);

// ---- 6. every dashboard renders ----
const depts = window.KPIX.DEPTS.map(d => d.key);
for (const d of depts) {
  nav('dash_' + d);
  await wait(320);
  const body = $('kd-body');
  const svgs = body.querySelectorAll('svg').length;
  const empties = body.querySelectorAll('.kpi-empty').length;
  const bad = body.querySelectorAll('.note.bad').length;
  check('dashboard ' + d + ' renders cards', body.querySelectorAll('.kpi-card').length > 0 || svgs + empties > 0,
    'svg=' + svgs + ' empty=' + empties + ' errors=' + bad);
  check('dashboard ' + d + ' has no error notes', bad === 0, body.querySelector('.note.bad')?.textContent || '');
}

// ---- 7. derived charts actually drew from the seeded records ----
nav('dash_production');
await wait(400);
check('production dashboard drew charts from bookings', $('kd-body').querySelectorAll('svg').length >= 4,
  'svgs=' + $('kd-body').querySelectorAll('svg').length);
check('the loss pareto drew', /80% of the loss/.test($('kd-body').innerHTML));

nav('dash_topmgmt');
await wait(400);
check('scorecard radar drew', $('kd-body').querySelectorAll('polygon').length > 0);

// ---- 8. KPI entry saves and comes back ----
nav('kpi_entry');
await wait(250);
$('ke-dept').value = 'production';
$('ke-dept').dispatchEvent(new window.Event('change'));
await wait(250);
$('ke-kpi').value = 'prd_rework';
$('ke-kpi').dispatchEvent(new window.Event('change'));
await wait(250);
const inputs = [...$('ke-form').querySelectorAll('.kpi-in')];
check('entry grid has twelve months', inputs.length === 12, 'inputs=' + inputs.length);
inputs[0].value = '1500'; inputs[1].value = '900';
$('ke-save').dispatchEvent(new window.Event('click'));
await wait(350);
check('saving reports success', /Saved/.test($('ke-msg').textContent), $('ke-msg').textContent);
check('the KPI record was written', docs.some(d => d.kind === 'kpi' && d.data.kpiId === 'prd_rework'));

// saving again must update, not create a second record for the same year
$('ke-save').dispatchEvent(new window.Event('click'));
await wait(350);
check('saving twice does not duplicate the record',
  docs.filter(d => d.kind === 'kpi' && d.data.kpiId === 'prd_rework').length === 1,
  'count=' + docs.filter(d => d.kind === 'kpi').length);

nav('dash_production');
await wait(400);
check('the entered figure reaches the dashboard', /1,?500/.test($('kd-body').innerHTML));

// ---- 9. the website screens open in a frame ----
nav('admin_site');
await wait(120);
check('website content opens the admin panel in a frame', /embed=admin/.test($('em-frame').src), $('em-frame').src);
nav('emb_me');
await wait(120);
check('My Attendance opens in the IDMS', /embed=me/.test($('em-frame').src), $('em-frame').src);

// ---- 10. banner is set from Admin ----
nav('admin_banner');
await wait(150);
$('ab-url').value = 'https://example.test/banner.jpg';
$('ab-tag').value = 'Precision machining';
$('ab-url').dispatchEvent(new window.Event('input'));
$('ab-save').dispatchEvent(new window.Event('click'));
await wait(250);
check('banner saved from admin', settings.banner && settings.banner.image === 'https://example.test/banner.jpg',
  JSON.stringify(settings.banner || {}));
nav('home');
await wait(200);
check('home shows the saved banner', $('bn-img').style.display === '' && /banner\.jpg/.test($('bn-img').src));

// ---- diagnostics ----
console.log('\nWhat each dashboard drew:');
for (const d of depts) {
  nav('dash_' + d);
  await wait(320);
  const b = $('kd-body');
  console.log('  ' + d.padEnd(13) + ' cards=' + b.querySelectorAll('.kpi-card').length +
    ' charts=' + b.querySelectorAll('svg').length +
    ' waiting-for-data=' + b.querySelectorAll('.kpi-empty').length);
}
console.log('\nKPIs in the registry: ' + window.KPIX.KPIS.length +
  ', computed from records: ' + window.KPIX.KPIS.filter(k => k.derive).length);

// ---- report ----
let pass = 0, fail = 0;
for (const [name, okv, extra] of results) {
  if (okv) { pass++; } else { fail++; console.log('  ✗ ' + name + (extra ? '   [' + extra + ']' : '')); }
}
if (errors.length) { console.log('\nPage errors:'); errors.slice(0, 8).forEach(e => console.log('  ! ' + e)); }
console.log('\n' + pass + ' passed, ' + fail + ' failed, of ' + results.length);
process.exit(fail ? 1 : 0);
