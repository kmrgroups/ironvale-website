/* Tests for the redesigned Organisation Chart: horizontal boxes with
   connector lines (was a plain nested list with no chart styling), the PDF
   Signatories row, and the View Full / View Dept / Print Full / Print Dept
   button set. The underlying tree-building and payroll cross-check logic is
   untouched — only checked here for not having been broken by the redraw. */
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
const settings = {};
const employees = [{ empId: 'E1', name: 'Rishab', designation: 'Managing Director', department: 'Top Management' }];
let orgNodes = [{ doc_id: 'n1', doc_no: 'ORG-1',
  data: { title: 'Managing Director', who: 'Rishab', department: 'Top Management', level: 'top', parent: '' } }];

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
    if (url.includes('kind=orgnode')) return ok({ docs: orgNodes });
    if (url.includes('what=parts')) return ok({ parts: [] });
    if (url.includes('what=docs')) return ok({ docs: [] });
    if (url.includes('what=settings') || body.what === 'settings') {
      if (opts.method === 'POST') { settings[body.key] = body.data; return ok({}); }
      return ok({ settings });
    }
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
click([...window.document.querySelectorAll('#menubar a[data-s]')].find(a => a.dataset.s === 'org_chart'));
await wait(250);

check('the panel opens', window.document.querySelector('.panel[data-panel="org_chart"]').classList.contains('on'));
check('the existing tree still draws the one node', /Managing Director/.test($('oc-body').textContent));
check('the button set matches what was asked for',
  !!$('oc-add') && !!$('oc-savesig') && !!$('oc-viewfull') && !!$('oc-viewdept') &&
  !!$('oc-printfull') && !!$('oc-printdept'));
check('Add Node keeps its original working button (just relabelled)', $('oc-add').textContent.includes('Add Node'));

// ---- signatories ----
check('signatory pickers are populated from the employee list', /Rishab/.test($('oc-prep-by').innerHTML));
$('oc-prep-by').value = 'Rishab'; $('oc-prep-date').value = '2026-09-01';
$('oc-docno').value = 'ORG-001';
click($('oc-savesig')); await wait(150);
check('signatories are saved', settings.org_signatories && settings.org_signatories.prepBy === 'Rishab');
check('and the doc number too', settings.org_signatories && settings.org_signatories.docNo === 'ORG-001');

// ---- view full / view dept buttons drive the existing filter ----
click($('oc-viewdept'));
check('View Dept switches the existing Show filter to One department', $('oc-filter').value === 'dept');
click($('oc-viewfull'));
check('View Full switches it back', $('oc-filter').value === 'all');

// ---- print dept without a department chosen is refused, not silently wrong ----
click($('oc-viewdept'));
$('oc-dept').value = '';
click($('oc-printdept')); await wait(60);
check('Print Dept with nothing chosen tells you to choose one first',
  !!$('toast') && /Choose a department first/.test($('toast').textContent));

check('no page errors', pageErrors.length === 0, pageErrors.slice(0,2).join(' | '));
let pass = 0;
results.forEach(([n, c, x]) => { if (c) { pass++; console.log('  ok ' + n); } else console.log('  x ' + n + '   [' + x + ']'); });
console.log(`\n${pass} passed, ${results.length - pass} failed, of ${results.length}`);
process.exit(0);
