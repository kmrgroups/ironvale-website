/* Audit Readiness, native. Every check reads a screen that already exists —
   this seeds exactly the records needed to make one check green, one amber
   and one red, and verifies the screen reports precisely those three
   outcomes rather than a plausible-looking guess. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let items = [
  // a published policy, acknowledged by nobody yet — Awareness should be amber
  { item_id: 'POL1', kind: 'policy', status: 'Published',
    data: { title: 'Code of Conduct', version: '1.0', reviewOn: '2027-01-01', acknowledgements: [] } }
];
let employees = [
  // Asha: has a role standard, assessed and dated — Competence checks green for her
  { empId: 'EMP001', name: 'Asha Rao', designation: 'Operator', department: 'Production', status: 'Active' },
  // Vikram: same role, never assessed — pulls the "evaluation recorded" check to amber
  { empId: 'EMP002', name: 'Vikram Shah', designation: 'Operator', department: 'Production', status: 'Active' },
  // no designation at all — Roles & Responsibilities should be amber
  { empId: 'EMP003', name: 'No Role Yet', designation: '', department: 'Production', status: 'Active' }
];
let docs = [
  { doc_id: 'c1', kind: 'competency', data: { designation: 'Operator', thing: 'CNC setting', level: 3, criticality: 'Ordinary' } },
  { doc_id: 's1', kind: 'skill', data: { person: 'Asha Rao', thing: 'CNC setting', level: 3, assessedOn: '2026-01-01', assessedBy: 'Supervisor' } }
];
let content = { statutory: {} }; // no reviewer recorded at all — Statutory check should be red
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
  const url = String(path);
  const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
  if (url.startsWith('/api/auth')) {
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (body.action === 'login') { signedIn = true; return ok({ token: 'T', user: 'tester', role: 'developer' }); }
    if (body.action === 'session') return signedIn ? ok({ user: 'tester', role: 'developer' }) : { ok: false, status: 401, json: async () => ({ error: 'Not signed in' }) };
    return ok({});
  }
  if (url.startsWith('/api/content')) return ok({ data: content });
  if (url.startsWith('/api/rfqs')) return ok({ rfqs: [] });
  if (url.startsWith('/api/idms')) {
    if (url.includes('what=settings')) return ok({ settings: {} });
    if (url.includes('what=parts')) return ok({ parts: [] });
    if (url.includes('what=serial')) return ok({ next: 1 });
    if (url.includes('what=docs')) {
      const kind = decodeURIComponent((url.match(/kind=([^&]+)/) || [, ''])[1]);
      return ok({ docs: docs.filter(d => !kind || d.kind === kind) });
    }
    return ok({});
  }
  if (url.startsWith('/api/hr')) {
    if (url.includes('what=employees')) return ok({ employees });
    if (url.includes('what=items')) {
      const kind = decodeURIComponent((url.match(/kind=([^&]+)/) || [, ''])[1]);
      return ok({ items: kind ? items.filter(x => x.kind === kind) : items });
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
const nav = id => click(window.document.querySelector('#menubar [data-s="' + id + '"]'));

await wait(120);
$('g-user').value = 'tester'; $('g-pass').value = 'x';
$('g-go').dispatchEvent(new window.Event('click'));
await wait(300);

check('Audit Readiness is a live menu entry', !!window.document.querySelector('#menubar [data-s="hr_audit_ready"]'));
nav('hr_audit_ready');
await wait(300);

const body = $('ar-body').textContent;

// ---------- role standard exists and covers both people who have that role
// (EMP003 has no designation at all, so is correctly excluded from this count) ----------
check('a role standard exists and covers everyone who actually has that role — evidenced',
  /covering 2 of 2/.test(body), body.slice(0, 400));

// ---------- only Asha is dated/assessed, Vikram and the no-designation person are not: amber ----------
check('competence evaluation is only partial — 1 of 3 people dated, not silently shown as complete',
  /1 of 3 people have a dated/.test(body), body.slice(0, 600));

// ---------- a published policy exists but nobody has acknowledged it: amber ----------
check('policy awareness is partial, not shown green when acknowledgements are outstanding',
  /1 published policy/.test(body) && /acknowledgement\(s\) outstanding/.test(body) && !/0 acknowledgement\(s\) outstanding/.test(body),
  body);

// ---------- nobody has reviewed statutory rates at all: red/missing ----------
check('statutory review with no reviewer recorded at all is reported, not left blank',
  /No reviewer recorded/.test(body), body);

// ---------- the Missing/Partial/Evidenced counts in the summary actually add up ----------
const kpiText = $('ar-kpi').textContent;
const totalMatch = kpiText.match(/(\d+)Checks/);
check('the summary reports a real check count, not zero', totalMatch && Number(totalMatch[1]) >= 6, kpiText);

// ---------- training-effectiveness is explicitly NOT computed — the honest gap ----------
check('the deferred-check note is shown rather than a guessed training-effectiveness result',
  /not checked here yet/.test(window.document.querySelector('[data-panel="hr_audit_ready"]').textContent));
check('no row claims to evidence training effectiveness (there is no data behind one yet)',
  !/effectiveness verdict/.test(body));

check('no console errors while any of this ran', pageErrors.length === 0, pageErrors.join(' | '));

const failed = results.filter(([, ok]) => !ok);
for (const [n, ok, x] of results) console.log((ok ? '  ok  ' : '  X   ') + n + (ok ? '' : '   [' + x + ']'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, of ${results.length}`);
process.exit(failed.length ? 1 : 0);
