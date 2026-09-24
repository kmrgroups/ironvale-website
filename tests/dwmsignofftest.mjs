/* Tests for the DWM sign-off row (Prepared/Reviewed/Approved By), added to
   match the reference layout, plus the Plan/Actual columns already covered
   by dwmtest.mjs's column-count check. Saved on the DWM document itself
   (one board per person), not as a single shared default — a different
   employee's board must not inherit another's sign-off. */
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
const employees = [{ empId: 'E1', name: 'Meena Iyer', department: 'Production', status: 'Active' },
                    { empId: 'E2', name: 'Raj Kumar', department: 'Production', status: 'Active' }];
let dwmDocs = [];

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
  if (url.startsWith('/api/hr')) return ok({ employees: employees.map(e => ({ data: e })) });
  if (url.startsWith('/api/idms')) {
    if (url.includes('kind=dwm')) return ok({ docs: dwmDocs });
    if (url.includes('what=parts')) return ok({ parts: [] });
    if (url.includes('what=docs') && opts.method !== 'POST') return ok({ docs: [] });
    if (opts.method === 'POST' && body.what === 'docs' && body.doc && body.doc.kind === 'dwm') {
      let existing = dwmDocs.find(d => d.doc_id === body.doc.docId);
      if (existing) { existing.data = body.doc.data; return ok({ docId: existing.doc_id }); }
      const id = 'dwm-' + (dwmDocs.length + 1);
      dwmDocs.push({ doc_id: id, doc_no: body.doc.docNo, data: body.doc.data });
      return ok({ docId: id });
    }
    if (url.includes('what=docNumber') || body.what === 'docNumber') return ok({ number: 'DWM-AUTO' });
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
click([...window.document.querySelectorAll('#menubar a[data-s]')].find(a => a.dataset.s === 'dwm'));
await wait(250);

check('the sign-off row exists', !!$('dw-prep') && !!$('dw-rev') && !!$('dw-app') && !!$('dw-savesig'));

$('dw-dept').value = 'Production'; $('dw-dept').dispatchEvent(new window.Event('change'));
await wait(100);
$('dw-emp').value = 'Meena Iyer';
click($('dw-open')); await wait(200);

check('opening a board with nothing saved starts with blank sign-off fields',
  $('dw-prep').value === '' && $('dw-rev').value === '' && $('dw-app').value === '');

$('dw-prep').value = 'Meena Iyer'; $('dw-rev').value = 'Line Supervisor'; $('dw-app').value = 'Plant Head';
click($('dw-savesig')); await wait(200);
check('sign-off is saved', dwmDocs.length === 1 && dwmDocs[0].data.signatories.prepBy === 'Meena Iyer');
check('confirmation is shown', /Saved/.test($('dw-sigmsg').textContent));

// leave and come back — the saved board should show its own sign-off, not a shared default
click($('dw-back')); await wait(100);
$('dw-emp').value = 'Meena Iyer';
click($('dw-open')); await wait(200);
check('reopening the same board restores its own sign-off', $('dw-prep').value === 'Meena Iyer');

// a different employee's board is independent
click($('dw-back')); await wait(100);
$('dw-emp').value = 'Raj Kumar';
click($('dw-open')); await wait(200);
check("a different employee's board does not inherit the first one's sign-off",
  $('dw-prep').value === '' && $('dw-rev').value === '');

check('no page errors', pageErrors.length === 0, pageErrors.slice(0,2).join(' | '));
let pass = 0;
results.forEach(([n, c, x]) => { if (c) { pass++; console.log('  ok ' + n); } else console.log('  x ' + n + '   [' + x + ']'); });
console.log(`\n${pass} passed, ${results.length - pass} failed, of ${results.length}`);
process.exit(0);
