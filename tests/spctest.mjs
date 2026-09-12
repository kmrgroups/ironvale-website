/* SPC — Control Charts. Covers what materialtest.mjs's smaller control-chart
   check does not: Pp/Ppk (performance capability, built on overall sigma
   rather than the short-term sigma Cp/Cpk use) and the Western Electric zone
   tests (Zone A, Zone B) and the six-point trend rule, on top of the
   beyond-limits and run-of-seven checks materialtest.mjs already covers.

   The second characteristic's 20 readings below were built by running the
   exact same formulas used in idms.html against candidate data until one
   data set genuinely triggered all three new checks plus a beyond-limits
   point, so every expected value here is a hand-checked fact about that
   data, not a guess at what the screen ought to say. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

let docs = [], parts = [], idSeq = 1, serial = 0;
const settings = {};
const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

parts.push({ part_id: 'P1', part_no: 'TEST-0002', part_name: 'Flange', lifecycle: 'Series', data: {} });

docs.push({ doc_id: 'op10', kind: 'process', part_id: 'P1', doc_no: 'OP10',
  data: { partId: 'P1', opNo: 10, name: 'Turning' } });

/* 10 steady readings, 6 strictly increasing (the trend), 4 steady again —
   engineered so the trend segment also lands in Zone A/B without ever
   needing a wild outlier the way materialtest.mjs's data set does. */
const readings = [
  10.00, 9.99, 10.01, 10.00, 9.99, 10.01, 10.00, 9.99, 10.01, 10.00,
  10.02, 10.04, 10.06, 10.08, 10.10, 10.12,
  10.00, 9.99, 10.01, 10.00
];
docs.push({ doc_id: 'si1', kind: 'self_insp', part_id: 'P1', doc_no: 'SI-1', status: 'Closed',
  data: { partId: 'P1', processId: 'op10', opNo: 10, date: ago(6), shift: 'A', operator: 'S Patel',
    machine: 'VMC-2',
    chars: [{ balloon: 'B1', description: 'Flatness', nominal: 10, upper: 0.2, lower: -0.2, unit: 'mm', gauge: 'Dial gauge' }],
    rounds: readings.map((r, i) => ({ at: String(8 + i).padStart(2, '0') + ':00', readings: [String(r)], containment: '' })) } });

const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => pageErrors.push(e.message));
const dom = new JSDOM(html.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''),
  { runScripts: 'outside-only', url: 'https://example.test/idms.html', virtualConsole: vc });
const { window } = dom;
window.Element.prototype.scrollIntoView = function () {};
let signedIn = false;

window.fetch = async (path, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : {};
  const url = String(path);
  const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
  if (url.startsWith('/api/auth')) {
    if (body.action === 'login') { signedIn = true; return ok({ token: 'T', user: 'tester', role: 'developer' }); }
    if (body.action === 'session') return signedIn ? ok({ user: 'tester', role: 'developer' }) : { ok: false, status: 401, json: async () => ({ error: 'Not signed in' }) };
    return ok({});
  }
  if (url.startsWith('/api/content')) return ok({ data: { company: { legalName: 'Test Mfg', docPrefix: 'TEST' } } });
  if (url.startsWith('/api/hr')) return ok({ employees: [], attendance: [] });
  if (url.startsWith('/api/rfqs')) return ok({ rfqs: [] });
  if (url.startsWith('/api/idms')) {
    if (url.includes('what=settings')) { if (opts.method === 'POST') { settings[body.key] = body.data; return ok({}); } return ok({ settings }); }
    if (url.includes('what=parts')) return ok({ parts });
    if (url.includes('what=serial')) return ok({ next: ++serial });
    if (url.includes('what=docs')) {
      const kind = decodeURIComponent((url.match(/kind=([^&]+)/) || [, ''])[1]);
      const pid = decodeURIComponent((url.match(/partId=([^&]+)/) || [, ''])[1]);
      return ok({ docs: docs.filter(d => (!kind || d.kind === kind) && (!pid || d.part_id === pid)) });
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
await wait(300);

// ---- the menu itself now says SPC, not just Control Charts ----
check('the menu entry now reads SPC — Control Charts',
  /SPC.*Control Charts/.test(txt(window.document.querySelector('#menubar [data-s="report_control_charts"]'))),
  txt(window.document.querySelector('#menubar [data-s="report_control_charts"]')));

nav('report_control_charts');
await wait(400);
check('the panel heading also says SPC',
  /SPC/.test(txt(window.document.querySelector('.panel[data-panel="report_control_charts"] h4'))));

$('cc-part').value = 'P1'; change($('cc-part'));
await wait(500);
click($('cc-run'));
await wait(400);
const cc = txt($('cc-body'));

check('a chart is drawn', $('cc-body').querySelectorAll('svg').length === 2,
  'svgs=' + $('cc-body').querySelectorAll('svg').length);
check('every reading is counted', /20 readings/.test(cc), cc.slice(0, 200));

// ---- hand-checked facts about this exact data set ----
check('the point beyond the control limits is still caught',
  /outside the control limits/.test(cc), cc.slice(0, 500));
check('the Zone A pattern (2 of 3 beyond 2 sigma) is caught',
  /Zone A/.test(cc), cc.slice(0, 900));
check('the Zone B pattern (4 of 5 beyond 1 sigma) is caught',
  /Zone B/.test(cc), cc.slice(0, 900));
check('the six-point trend is caught',
  /trending the same direction/.test(cc), cc.slice(0, 1200));
check('nothing here is outside the (loose) drawing tolerance',
  !/outside the drawing tolerance/.test(cc));

// ---- capability: both potential (Cp/Cpk) and performance (Pp/Ppk) ----
check('Cp/Cpk (potential capability) is reported', /\bCp\b/.test(cc) && /\bCpk\b/.test(cc), cc.slice(-500));
check('Pp/Ppk (performance capability) is reported alongside it',
  /\bPp\b/.test(cc) && /\bPpk\b/.test(cc), cc.slice(-500));
check('performance capability is explained as distinct from potential capability',
  /performance:/.test(cc) && /potential:/.test(cc));
/* hand-calculated from the readings above: Cpk ≈ 3.20, Ppk ≈ 1.54 — a gap of
   about 1.65, comfortably past the 0.2 threshold the screen itself warns at */
check('the Cpk-vs-Ppk gap on this drifting data is flagged',
  /has not held that steady/.test(cc), cc.slice(-700));

// ---- the print report picks up the same new figures ----
let opened = [];
window.open = () => ({ document: { write: h => opened.push(h), close() {} }, print() {} });
click($('cc-print'));
await wait(100);
check('the printed report includes overall sigma and both capability pairs',
  opened.join('').includes('Sigma, overall') &&
  opened.join('').includes('Cp (potential)') && opened.join('').includes('Pp (performance)'),
  opened.join('').slice(0, 300));

check('no console errors while any of this ran', pageErrors.length === 0, pageErrors.join(' | '));

const failed = results.filter(([, ok]) => !ok);
for (const [n, ok, x] of results) console.log((ok ? '  ok  ' : '  X   ') + n + (ok ? '' : '   [' + x + ']'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, of ${results.length}`);
process.exit(failed.length ? 1 : 0);
