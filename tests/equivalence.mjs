/* Equivalence harness. Boots two builds of the site against one identical fake
   server, walks every live menu screen and compares the rendered markup.

   Usage:  node tests/equivalence.mjs <original-dir> <new-dir>

   This is the check that makes a refactor safe to believe: the work is only
   correct if what the user sees is what it was. It reports which screens differ,
   which ids moved, and which screens threw while drawing.
   Needs jsdom, like the other suites. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const wait = ms => new Promise(r => setTimeout(r, ms));

/* Screens are drawn by async handlers, so a screen that throws surfaces as an
   unhandled rejection rather than at the click. Record and carry on: the point
   is to compare every screen that CAN draw, and to name the ones that cannot. */
const thrown = [];
process.on('unhandledRejection', e => thrown.push(String(e && e.message || e)));

async function render(dir) {
  const html = fs.readFileSync(dir + '/idms.html', 'utf8');
  const core = fs.readFileSync(dir + '/core.js', 'utf8');
  const kpi  = fs.readFileSync(dir + '/kpi.js', 'utf8');
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', e => errs.push(e.message));
  const dom = new JSDOM(html, { runScripts: 'outside-only',
    url: 'https://example.test/idms.html', virtualConsole: vc });
  const { window } = dom;
  const docs = [], parts = [];
  window.fetch = async (path, opts = {}) => {
    const p = String(path);
    const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
    if (p.startsWith('/api/auth')) return ok({ user: 'dev', role: 'developer', token: 'T' });
    if (p.startsWith('/api/content')) return ok({ data: { company: { legalName: 'Acme Mfg',
      addressLine: 'Mysuru', docPrefix: 'ACME' } } });
    if (p.startsWith('/api/idms')) {
      if (p.includes('what=parts')) return ok({ parts });
      if (p.includes('what=settings')) return ok({ settings: {} });
      if (p.includes('what=audit')) return ok({ audit: [] });
      return ok({ docs, serial: 1, number: 'ACME-X-0001' });
    }
    if (p.startsWith('/api/hr')) return ok({ items: [], employees: [], attendance: [], leave: [] });
    return ok({});
  };
  window.eval(core); window.eval(kpi);
  const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g).pop()
                     .replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
  window.eval(inline);
  await wait(400);
  // sign in
  window.sessionStorage.setItem('app_token', 'T');
  const $ = id => window.document.getElementById(id);
  $('g-user').value = 'dev'; $('g-pass').value = 'password1';
  $('g-go').dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(500);

  const out = {};
  const links = [...window.document.querySelectorAll('#menubar a[data-s]')]
    .filter(a => !a.querySelector('.soon'));
  for (const a of links) {
    const target = a.dataset.s;
    try { a.dispatchEvent(new window.Event('click', { bubbles: true })); }
    catch (e) { out[target] = 'THREW: ' + e.message; continue; }
    await wait(90);
    const panel = window.document.querySelector('.panel.on');
    out[target] = panel ? panel.innerHTML : '(no panel)';
  }
  return { out, errs, count: links.length, thrown: thrown.splice(0) };
}

const A = await render(process.argv[2] || '../ironvale-universal-original');
const B = await render(process.argv[3] || '.');
console.log(`screens walked: original ${A.count}, restructured ${B.count}`);
const keys = [...new Set([...Object.keys(A.out), ...Object.keys(B.out)])];
let diff = 0;
/* The live-production screen stamps the wall clock into its markup, so the two
   runs differ by the seconds between them. Normalise time-of-day before
   comparing — a clock tick is not a rendering difference. */
const norm = t => String(t).replace(/\d{1,2}:\d{2}:\d{2}\s*[AP]M/g, '<TIME>')
                           .replace(/\d{2}:\d{2}:\d{2}/g, '<TIME>');
for (const k of keys) {
  if (norm(A.out[k]) !== norm(B.out[k])) {
    diff++;
    console.log(`  DIFFERS: ${k}`);
    if (process.env.FULL) {
      const A2 = norm(A.out[k] || ''), B2 = norm(B.out[k] || '');
      const only = (x, y) => [...new Set((x.match(/id="[^"]+"/g) || []))].filter(t => !y.includes(t));
      console.log('     ids only in original :', only(A2, B2).slice(0, 8));
      console.log('     ids only in new      :', only(B2, A2).slice(0, 8));
      console.log('     length orig/new      :', A2.length, '/', B2.length);
    }
    const a = (A.out[k] || ''), b = (B.out[k] || '');
    let i = 0; while (i < a.length && a[i] === b[i]) i++;
    console.log(`     orig: ...${a.slice(Math.max(0, i - 60), i + 90)}`);
    console.log(`     new : ...${b.slice(Math.max(0, i - 60), i + 90)}`);
  }
}
console.log(`\n${keys.length - diff}/${keys.length} screens render identically`);
console.log(`\nscreens that threw while drawing — original: ${A.thrown.length}, restructured: ${B.thrown.length}`);
if (A.thrown.length) console.log('  original :', [...new Set(A.thrown)].slice(0, 5));
if (B.thrown.length) console.log('  restructured:', [...new Set(B.thrown)].slice(0, 5));
console.log(`jsdom errors — original: ${A.errs.length}, restructured: ${B.errs.length}`);
if (B.errs.length) console.log(B.errs.slice(0, 3));
