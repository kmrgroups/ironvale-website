/* v112 tests. The fixture puts the screens in the states where they have to
   refuse something:
     - a single developer login, so demoting it must be blocked
     - a tool with a short expected life, so exceeding it must be flagged
     - a check sheet with a failed item and no action, so signing off must fail */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let docs = [], parts = [], idSeq = 1, serial = 0;
const settings = {};
const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

let users = [
  { username: 'tester', role: 'developer', email: 'dev@test', whatsapp: '', twofa: false },
  { username: 'srao', role: 'staff', email: '', whatsapp: '9000000000', twofa: true }
];

parts.push({ part_id: 'P1', part_no: 'PART-1', part_name: 'Housing', lifecycle: 'Series', data: {} });
docs.push({ doc_id: 'mc1', kind: 'machine', doc_no: 'MC-1', data: { name: 'LATHE-1' } });
docs.push({ doc_id: 'mc2', kind: 'machine', doc_no: 'MC-2', data: { name: 'GRINDER-1' } });

const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => pageErrors.push(e.message));
const dom = new JSDOM(html.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''),
  { runScripts: 'outside-only', url: 'https://example.test/idms.html', virtualConsole: vc });
const { window } = dom;
window.Element.prototype.scrollIntoView = function () {};
if (!window.CSS) window.CSS = {};
if (!window.CSS.escape) window.CSS.escape = s => String(s).replace(/["\\]/g, '\\$&');
let confirmAnswer = true;
window.confirm = () => confirmAnswer;
const prompts = [];
window.prompt = () => (prompts.length ? prompts.shift() : null);
let signedIn = false;

window.fetch = async (path, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : {};
  const url = String(path);
  const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
  const err = m => ({ ok: false, status: 400, json: async () => ({ error: m }) });
  if (url.startsWith('/api/auth')) {
    if (body.action === 'login') { signedIn = true; return ok({ token: 'T', user: 'tester', role: 'developer' }); }
    if (body.action === 'session') return signedIn ? ok({ user: 'tester', role: 'developer' }) : { ok: false, status: 401, json: async () => ({ error: 'Not signed in' }) };
    if (body.action === 'whoami') return ok({ user: { username: 'tester', role: 'developer' } });
    if (body.action === 'listUsers') return ok({ users });
    if (body.action === 'saveUser') {
      const u = users.find(x => x.username === body.username);
      if (u) { u.role = body.role; u.email = body.email; u.whatsapp = body.whatsapp; u.twofa = !!body.twofa; }
      else {
        if (!body.password || body.password.length < 8) return err('New logins need a password of at least 8 characters.');
        users.push({ username: body.username, role: body.role, email: body.email, whatsapp: body.whatsapp, twofa: !!body.twofa });
      }
      return ok({ saved: body.username });
    }
    if (body.action === 'deleteUser') {
      if (body.username === 'tester') return err('You cannot delete the login you are using.');
      users = users.filter(x => x.username !== body.username);
      return ok({ removed: body.username });
    }
    return ok({});
  }
  if (url.startsWith('/api/content')) return ok({ data: { company: { legalName: 'Test Mfg', docPrefix: 'TEST' } } });
  if (url.startsWith('/api/hr')) return ok({ employees: [], attendance: [] });
  if (url.startsWith('/api/rfqs')) return ok({ rfqs: [] });
  if (url.startsWith('/api/idms')) {
    if (url.includes('what=audit')) return ok({ audit: [] });
    if (url.includes('what=settings')) { if (opts.method === 'POST') { settings[body.key] = body.data; return ok({}); } return ok({ settings }); }
    if (url.includes('what=parts')) return ok({ parts });
    if (url.includes('what=serial')) return ok({ next: ++serial });
    if (url.includes('what=docs')) {
      const kind = decodeURIComponent((url.match(/kind=([^&]+)/) || [, ''])[1]);
      return ok({ docs: docs.filter(d => !kind || d.kind === kind) });
    }
    if (opts.method === 'POST' && body.what === 'docs') {
      const d = body.doc;
      if (d.docId) {
        const ex = docs.find(x => x.doc_id === d.docId);
        if (ex) { ex.data = d.data; ex.status = d.status; return ok({ docId: d.docId }); }
      }
      const id = 'n' + (idSeq++);
      docs.push({ doc_id: id, kind: d.kind, part_id: d.partId, doc_no: d.docNo, status: d.status, data: d.data });
      return ok({ docId: id });
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
const change = el => el.dispatchEvent(new window.Event('change', { bubbles: true }));
const nav = id => click(window.document.querySelector('#menubar [data-s="' + id + '"]'));
const txt = el => el.textContent.replace(/\s+/g, ' ');

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(250);

// ================= user management =================
nav('users'); await wait(500);
check('the developer sees the screen', $('us-form').style.display !== 'none');
check('the logins are listed', /tester/.test(txt($('us-list'))) && /srao/.test(txt($('us-list'))));
check('your own login is marked and cannot be removed from the list',
  /this is you/.test(txt($('us-list'))) &&
  ![...$('us-list').querySelectorAll('.us-del')].some(b => b.dataset.u === 'tester'));
/* The screens say "administrator" to the user even though the role is stored as
   'developer'; the wording was changed deliberately and the test lagged behind. */
check('a single administrator login is called out',
  /one administrator login/i.test(txt($('us-list'))), txt($('us-list')).slice(-160));

click($('us-save')); await wait(250);
check('a login with no username is refused', /username is needed/i.test(txt($('us-msg'))), txt($('us-msg')));

$('us-name').value = 'newperson';
click($('us-save')); await wait(250);
check('a new login with no password is refused',
  /at least eight/i.test(txt($('us-msg'))), txt($('us-msg')));

$('us-pass').value = 'longenoughpassword';
$('us-email').value = 'new@test';
click($('us-save')); await wait(450);
check('a proper new login is created', users.some(u => u.username === 'newperson'), txt($('us-msg')));
check('it is created as staff, not developer',
  (users.find(u => u.username === 'newperson') || {}).role === 'staff');

/* changing an existing login's password has its own length check */
click([...$('us-list').querySelectorAll('.us-edit')].find(b => b.dataset.u === 'newperson'));
await wait(200);
$('us-pass').value = 'short';
click($('us-save')); await wait(250);
check('a short new password on an existing login is refused',
  /too short/i.test(txt($('us-msg'))), txt($('us-msg')));

// demoting the only developer must be blocked before it reaches the server
click([...$('us-list').querySelectorAll('.us-edit')].find(b => b.dataset.u === 'tester'));
await wait(200);
$('us-role').value = 'staff';
click($('us-save')); await wait(300);
check('the only administrator login cannot be demoted',
  /only administrator login/i.test(txt($('us-msg'))), txt($('us-msg')));
check('and the role was not changed',
  (users.find(u => u.username === 'tester') || {}).role === 'developer');

// with a second developer it becomes allowed
$('us-name').value = 'seconddev'; $('us-role').value = 'developer';
$('us-pass').value = 'anotherlongpassword';
click($('us-save')); await wait(450);
check('a second developer can be created',
  (users.find(u => u.username === 'seconddev') || {}).role === 'developer', txt($('us-msg')));

click([...$('us-list').querySelectorAll('.us-del')].find(b => b.dataset.u === 'srao'));
await wait(400);
check('a login can be removed', !users.some(u => u.username === 'srao'), txt($('us-msg')));

// ================= tool history =================
nav('report_tool_history'); await wait(500);
click($('th-save')); await wait(250);
check('a tool with no description is refused', /needs a description/i.test(txt($('th-msg'))), txt($('th-msg')));

$('th-desc').value = 'CNMG 120408 insert';
$('th-machine').value = 'LATHE-1';
$('th-part').value = 'P1';
$('th-life').value = '400';
$('th-unit').value = 'pieces';
click($('th-save')); await wait(450);
check('the tool card is opened', docs.filter(d => d.kind === 'tool').length === 1, txt($('th-msg')));
check('it is listed', /CNMG/.test(txt($('th-list'))), txt($('th-list')).slice(0, 150));

click($('th-list').querySelector('.th-open')); await wait(250);
$('th-ev').value = 'Issued to the machine';
$('th-qty').value = '0';
$('th-cost').value = '450';
$('th-by').value = '';
click($('th-add')); await wait(250);
check('an event with nobody against it is refused', /Say who/i.test(txt($('th-msg'))), txt($('th-msg')));

$('th-by').value = 'R Kumar';
click($('th-add')); await wait(450);
check('the issue is recorded',
  ((docs.find(d => d.kind === 'tool') || { data: {} }).data.history || []).length === 1, txt($('th-msg')));

$('th-ev').value = 'Broken'; $('th-qty').value = '300'; $('th-cost').value = '';
$('th-by').value = 'R Kumar';
click($('th-add')); await wait(300);
check('a breakage with no cost is refused',
  /Put a cost against it/i.test(txt($('th-msg'))), txt($('th-msg')));

$('th-cost').value = '450';
click($('th-add')); await wait(500);
const tool = docs.find(d => d.kind === 'tool');
check('the breakage is recorded', (tool.data.history || []).length === 2);
check('the tool status follows the event', tool.status === 'Broken');
check('the money spent on it is added up', /900/.test(txt($('th-card-body'))), txt($('th-card-body')).slice(0, 200));

/* push it past its expected life. Every field is set again because the card is
   redrawn after each event — which is right: a form that keeps the last person's
   name in it is how the wrong name ends up on a record. */
$('th-ev').value = 'Issued to the machine'; $('th-qty').value = '200';
$('th-cost').value = '450'; $('th-by').value = 'S Babu';
click($('th-add')); await wait(500);
check('a tool past its expected life is flagged',
  /more than its expected life/i.test(txt($('th-card-body'))), txt($('th-card-body')).slice(0, 250));

// ================= the production dashboard counts the tool money =================
nav('dash_production'); await wait(1200);
const prod = txt($('kd-body'));
check('tool breakage cost is computed from the cards',
  /Added up from the breakages recorded/.test(prod), prod.slice(0, 400));
check('tool consumption cost is computed too, without double-counting breakages',
  /not counted twice/.test(prod), prod.slice(0, 600));

// ================= machine check sheet =================
nav('report_machine_checksheet'); await wait(600);
check('machines are offered', $('cs-machine').options.length === 2, $('cs-machine').innerHTML);
check('the sheet opens with the standard checks',
  $('cs-body').querySelectorAll('.cs-r').length === 10,
  'rows=' + $('cs-body').querySelectorAll('.cs-r').length);

const rs = [...$('cs-body').querySelectorAll('.cs-r')];
rs.forEach((s, i) => { if (i < 9) s.value = 'OK'; });
$('cs-by').value = 'R Kumar';
click($('cs-close')); await wait(300);
check('a blank check is not treated as a pass',
  /no answer/i.test(txt($('cs-msg'))), txt($('cs-msg')));

rs[9].value = 'Not OK';
click($('cs-close')); await wait(300);
check('a failed check with no action cannot be signed off',
  /nothing written against them/i.test(txt($('cs-msg'))), txt($('cs-msg')));

$('cs-body').querySelector('.cs-n[data-i="9"]').value = 'Swarf cleared, told maintenance, ran the shift';
click($('cs-close')); await wait(500);
const sheet = docs.find(d => d.kind === 'checksheet');
check('with the failure answered it signs off', sheet && sheet.status === 'Signed off', txt($('cs-msg')));
check('the failed item and its action are on the record',
  (sheet.data.items || []).some(i => i.result === 'Not OK' && /maintenance/.test(i.note)));
check('it appears in the recent sheets', /LATHE-1/.test(txt($('cs-list'))), txt($('cs-list')).slice(0, 150));
check('a signed-off sheet cannot be edited',
  [...$('cs-body').querySelectorAll('.cs-r')].every(s => s.disabled));

// changing the check list is per machine and sticks
prompts.push('Oil level\nAir pressure\nGuards in place');
click($('cs-edit-list')); await wait(450);
check('the check list is saved against the machine',
  ((docs.find(d => d.doc_id === 'mc1') || { data: {} }).data.checks || []).length === 3);

$('cs-machine').value = 'mc2'; change($('cs-machine')); await wait(400);
check('another machine keeps the standard list until it is changed',
  $('cs-body').querySelectorAll('.cs-r').length === 10,
  'rows=' + $('cs-body').querySelectorAll('.cs-r').length);

check('no page errors throughout', pageErrors.length === 0, pageErrors[0] || '');

let pass = 0, fail = 0;
for (const [n, okv, x] of results) { if (okv) pass++; else { fail++; console.log('  x ' + n + (x ? '   [' + x + ']' : '')); } }
console.log('\n' + pass + ' passed, ' + fail + ' failed, of ' + results.length);
process.exit(fail ? 1 : 0);
