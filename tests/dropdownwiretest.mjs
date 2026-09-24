/* Machines used to be free text on Production Entry, Setup Approval and Self
   Inspection — wired to nothing, so the same machine spelled two ways split
   reports the same way the Machine Addition screen's own hint warns about for
   routings. These stay free text (refusing an unrecognised machine mid-shift
   would stop the floor working) but now suggest from the Machine Addition
   master, the same pattern the GRN screen already used for suppliers. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi  = fs.readFileSync('kpi.js', 'utf8');
const results = [];
const check = (n, c, x) => results.push([n, !!c, x || '']);
const wait = ms => new Promise(r => setTimeout(r, ms));
const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => pageErrors.push(e.message));

const dom = new JSDOM(html.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''),
  { runScripts: 'outside-only', url: 'https://works.example/idms.html', virtualConsole: vc });
const { window } = dom;
let signedIn = false;
const machines = [{ doc_id: 'm1', data: { name: 'CNC Lathe 3' } }, { doc_id: 'm2', data: { name: 'VMC 1' } }];

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
  if (url.startsWith('/api/content')) return ok({ data: {} });
  if (url.startsWith('/api/idms')) {
    if (url.includes('kind=machine')) return ok({ docs: machines });
    if (url.includes('what=parts')) return ok({ parts: [] });
    if (url.includes('what=docs')) return ok({ docs: [] });
    if (url.includes('what=settings')) return ok({ settings: {} });
    return ok({});
  }
  return ok({});
};

window.eval(core); window.eval(kpi);
window.eval(html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1]);
const $ = id => window.document.getElementById(id);
const click = el => el && el.dispatchEvent(new window.Event('click', { bubbles: true }));

await wait(150);
$('g-user').value = 'tester'; $('g-pass').value = 'password1';
click($('g-go')); await wait(300);

for (const [panelId, listId] of [['entry_prod','pe-machine-list'],
                                  ['report_setup_approval','su-machine-list'],
                                  ['report_self_inspection','si-machine-list']]) {
  click([...window.document.querySelectorAll('#menubar a[data-s]')].find(a => a.dataset.s === panelId));
  await wait(200);
  const opts = [...$(listId).querySelectorAll('option')].map(o => o.value);
  check(panelId + ': machine master suggestions are offered',
    opts.includes('CNC Lathe 3') && opts.includes('VMC 1'), opts.join(','));
  check(panelId + ': the field stays free text, not a locked dropdown',
    $(listId.replace('-list','')).tagName === 'INPUT');
}

check('no page errors', pageErrors.length === 0, pageErrors.slice(0,2).join(' | '));
let pass = 0;
results.forEach(([n, c, x]) => { if (c) { pass++; console.log('  ok ' + n); } else console.log('  x ' + n + '   [' + x + ']'); });
console.log(`\n${pass} passed, ${results.length - pass} failed, of ${results.length}`);
process.exit(0);
