/* Tests for the Live Production setup guide and the gateway ingest contract.

   The reason this suite exists: the gateway posted to /api/cnc/state, which
   Vercel answers with a 404 because api/cnc.js is routed to /api/cnc and
   nothing below it. No machine reading could ever arrive, and the Live Monitor
   sat on "No CNC machines connected yet" forever with nothing to explain why.
   The last block here pins the URL shape so that cannot come back. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi  = fs.readFileSync('kpi.js', 'utf8');

const results = [];
const check = (n, c, x) => results.push([n, !!c, x || '']);
const wait = ms => new Promise(r => setTimeout(r, ms));

const settings = {};
let cncMachines = [];
let signedIn = false;

const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => pageErrors.push(e.message));

const dom = new JSDOM(html.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''),
  { runScripts: 'outside-only', url: 'https://works.example/idms.html', virtualConsole: vc });
const { window } = dom;

window.fetch = async (path, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : {};
  const url = String(path);
  const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
  if (url.startsWith('/api/auth')) {
    if (body.action === 'login') { signedIn = true; return ok({ token: 'T', user: 'tester', role: 'developer' }); }
    if (body.action === 'session') return signedIn ? ok({ user: 'tester', role: 'developer' })
      : { ok: false, status: 401, json: async () => ({ error: 'Not signed in' }) };
    return ok({});
  }
  if (url.startsWith('/api/content')) return ok({ data: { company: { legalName: 'Test Mfg', docPrefix: 'TEST' } } });
  if (url.startsWith('/api/cnc')) {
    if (url.includes('what=summary')) {
      const counts = cncMachines.reduce((a, m) => {
        const s = String((m.state || {}).status || 'UNKNOWN').toUpperCase(); a[s] = (a[s] || 0) + 1; return a; }, {});
      return ok({ summary: { machines: cncMachines, statusCounts: counts,
        totalPartCount: cncMachines.reduce((n, m) => n + Number((m.state || {}).partCount || 0), 0) } });
    }
    return ok({ machines: cncMachines });
  }
  if (url.startsWith('/api/idms')) {
    /* saveSetting() puts `what` in the BODY, not the query string. A stub that
       only looked at the URL silently dropped every write and made it look as
       though the app was not saving. */
    if (url.includes('what=settings') || body.what === 'settings') {
      if (opts.method === 'POST') { settings[body.key] = body.data; return ok({}); }
      return ok({ settings });
    }
    if (url.includes('what=parts')) return ok({ parts: [] });
    if (url.includes('what=docs')) return ok({ docs: [] });
    return ok({});
  }
  if (url.startsWith('/api/hr')) return ok({ employees: [], attendance: [] });
  return ok({});
};

window.eval(core); window.eval(kpi);
window.eval(html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1]);
window.Element.prototype.scrollIntoView = function () {};

const $ = id => window.document.getElementById(id);
const txt = el => (el ? el.textContent : '');
const click = el => el && el.dispatchEvent(new window.Event('click', { bubbles: true }));

await wait(150);
$('g-user').value = 'tester'; $('g-pass').value = 'password1';
click($('g-go')); await wait(300);

// ---- the menu ----
const live = [...window.document.querySelectorAll('#menubar a[data-s]')].map(a => a.dataset.s);
check('Live Production still offers the monitor', live.includes('cnc_live'));
check('Live Production now offers the setup guide', live.includes('cnc_setup'));

// ---- open it ----
click([...window.document.querySelectorAll('#menubar a[data-s]')].find(a => a.dataset.s === 'cnc_setup'));
await wait(250);
const panel = window.document.querySelector('.panel[data-panel="cnc_setup"]');
check('the guide opens', panel && panel.classList.contains('on'));
check('it is laid out as seven numbered steps',
  panel.querySelectorAll('.cs-step').length === 7, String(panel.querySelectorAll('.cs-step').length));

// ---- step 2: the key ----
click($('cs-genkey')); await wait(60);
const key = txt($('cs-keybox'));
check('a key is generated', key.length === 64, key.slice(0, 24));
check('the key is hex, not a guessable word', /^[0-9a-f]{64}$/.test(key));
click($('cs-genkey')); await wait(60);
check('a second press gives a different key', txt($('cs-keybox')) !== key);
check('step 2 is marked done once a key exists',
  window.document.querySelector('.cs-step[data-step="2"]').classList.contains('done'));

// ---- step 5: machines ----
check('the machine list starts empty and says so', /No machines added yet/.test(txt($('cs-mlist'))));

click($('cs-add-sim')); await wait(150);
check('a test machine can be added without knowing any CNC details',
  /Test machine/.test(txt($('cs-mlist'))));
click($('cs-add-sim')); await wait(120);
check('a second test machine is refused', /already on the list/i.test(txt($('cs-m-msg'))));

$('cs-m-name').value = 'Lathe 1'; $('cs-m-id').value = 'CNC-01';
$('cs-m-adapter').value = 'mtconnect'; $('cs-m-ip').value = '192.168.1.101'; $('cs-m-port').value = '5000';
click($('cs-m-add')); await wait(150);
check('a real machine can be added', /Lathe 1/.test(txt($('cs-mlist'))));
check('its address is assembled for the user',
  /192\.168\.1\.101:5000/.test(txt($('cs-mlist'))), txt($('cs-mlist')).slice(0, 200));

// a duplicate code would make two machines overwrite each other's readings
$('cs-m-name').value = 'Lathe 2'; $('cs-m-id').value = 'cnc-01';
$('cs-m-ip').value = '192.168.1.102';
click($('cs-m-add')); await wait(120);
check('a duplicate machine code is refused', /already used/i.test(txt($('cs-m-msg'))));
check('and the duplicate was not added', !/Lathe 2/.test(txt($('cs-mlist'))));

// a real machine with no address cannot be monitored
$('cs-m-name').value = 'Mill 1'; $('cs-m-id').value = 'CNC-09';
$('cs-m-ip').value = ''; $('cs-m-adapter').value = 'mtconnect';
click($('cs-m-add')); await wait(120);
check('a real machine with no IP address is refused', /IP address/i.test(txt($('cs-m-msg'))));

// ---- step 6: the generated file ----
const cfgText = txt($('cs-config'));
let cfg = null, cfgErr = '';
try { cfg = JSON.parse(cfgText); } catch (e) { cfgErr = e.message; }
check('the generated config.json is valid JSON', !!cfg, cfgErr);
check('it carries the key from step 2', cfg && cfg.machineGatewayKey === txt($('cs-keybox')));
check('it points at this deployment', cfg && cfg.idmsIngestUrl === 'https://works.example/api/cnc');
check('the ingest URL ends with /api/cnc and nothing after it',
  cfg && /\/api\/cnc$/.test(cfg.idmsIngestUrl), cfg && cfg.idmsIngestUrl);
check('it lists both machines', cfg && cfg.machines.length === 2);
check('the real machine carries a usable baseUrl',
  cfg && cfg.machines.some(m => m.baseUrl === 'http://192.168.1.101:5000'));

// ---- the list survives a reload ----
check('the machine list is saved so it need not be retyped',
  !!(settings.cnc_gateway && settings.cnc_gateway.machines.length === 2));
check('the secret key is NOT stored on the server',
  JSON.stringify(settings).indexOf(txt($('cs-keybox'))) === -1);

// ---- step 7: the check ----
click($('cs-check')); await wait(250);
check('with nothing connected it says so plainly',
  /Nothing has arrived yet/i.test(txt($('cs-check-result'))));
check('and it names the two things that usually cause it',
  /401/.test(txt($('cs-check-result'))) && /404/.test(txt($('cs-check-result'))));

cncMachines = [{ machine_id: 'CNC-01', name: 'Lathe 1', controller: 'FANUC',
  updated_at: new Date().toISOString(), state: { status: 'RUNNING', partCount: 42 } }];
click($('cs-check')); await wait(250);
check('once data arrives it confirms it is working', /It is working/i.test(txt($('cs-check-result'))));
check('and shows the part count it received', /42/.test(txt($('cs-check-result'))));
check('it still insists on a shift of verification first',
  /own counter/i.test(txt($('cs-check-result'))));

cncMachines[0].updated_at = new Date(Date.now() - 30 * 60000).toISOString();
click($('cs-check')); await wait(250);
check('a machine that has gone quiet is called out, not shown as live',
  /has it stopped/i.test(txt($('cs-check-result'))), txt($('cs-check-result')).slice(-160));

// ---- the live monitor still works ----
click([...window.document.querySelectorAll('#menubar a[data-s]')].find(a => a.dataset.s === 'cnc_live'));
await wait(250);
check('the live monitor draws the connected machine',
  /Lathe 1/.test(txt($('cnc-live-grid'))), txt($('cnc-live-grid')).slice(0, 140));

// ---- the gateway/API contract ----
const gw  = fs.readFileSync('machine-gateway/gateway.mjs', 'utf8');
const api = fs.readFileSync('api/cnc.js', 'utf8');
check('the gateway no longer posts to the path that 404s', !/push\('\/state'/.test(gw));
check('the gateway sends what=state on the query string', /what=' \+ encodeURIComponent\(what\)/.test(gw));
check('and also in the body, in case a proxy strips the query', /\{ what, \.\.\.payload \}/.test(gw));
check('the API still accepts exactly that', /what \|\| body\.what \|\| ''\) === 'state'/.test(api));
check('a dropped link does not kill the gateway', /IDMS unreachable/.test(gw));
check('a wrong key is explained, not just numbered', /does not match CNC_GATEWAY_KEY/.test(gw));

check('no page errors while doing all of this', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

let pass = 0;
results.forEach(([n, c, x]) => { if (c) { pass++; console.log('  ok ' + n); } else console.log('  x ' + n + '   [' + x + ']'); });
console.log(`\n${pass} passed, ${results.length - pass} failed, of ${results.length}`);
/* The live monitor reschedules itself every 5s, so the timer would hold node
   open for ever. Nothing is outstanding by this point. */
process.exit(0);
