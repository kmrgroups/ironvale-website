/* Smoke test for index.html: the public site must have no staff entry points,
   the admin panel must only open when the IDMS opens it, and the drawing
   converter must refuse what it cannot convert with a sentence that says what
   to do instead. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = fs.readFileSync('index.html', 'utf8');
const conv = fs.readFileSync('drawing-convert.js', 'utf8');
const results = [];
const check = (n, c, x) => results.push([n, !!c, x || '']);
const wait = ms => new Promise(r => setTimeout(r, ms));

async function boot(url, token) {
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', e => errs.push(e.message));
  const dom = new JSDOM(html.replace('<script src="/drawing-convert.js"></script>', ''),
    { runScripts: 'outside-only', url, virtualConsole: vc });
  const { window } = dom;
  if (token) window.localStorage.setItem('app_token', token);
  window.fetch = async (path, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : {};
    const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
    if (String(path).startsWith('/api/auth')) {
      if (body.action === 'whoami') return ok({ user: { username: 'dev', role: 'developer' } });
      return ok({});
    }
    if (String(path).startsWith('/api/content')) return ok({ data: null });
    if (String(path).startsWith('/api/hr')) return ok({ items: [], employees: [], jobs: [] });
    if (String(path).startsWith('/api/rfqs')) return ok({ rfqs: [] });
    return ok({});
  };
  window.eval(conv);
  const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1];
  window.eval(inline);
  await wait(300);
  return { window, errs };
}

// ---------- 1. the public site ----------
{
  const { window, errs } = await boot('https://example.test/');
  const nav = window.document.getElementById('main-nav').innerHTML;
  const foot = window.document.getElementById('foot-links').innerHTML;
  check('no Operations menu at the top', !/Operations/i.test(nav), nav.slice(0, 200));
  check('no Operations links in the footer', !/Operations|RFQ Pipeline|HR &amp; People/i.test(foot));
  check('no My Attendance at the top', !/My Attendance/i.test(nav));
  check('no My Attendance in the footer', !/My Attendance/i.test(foot));
  check('no admin button on the page', !window.document.getElementById('admin-toggle'));
  check('admin panel stays shut', !window.document.getElementById('admin-panel').classList.contains('open'));
  check('the public sections are still there', /Contact/i.test(nav), nav.slice(0, 200));
  check('the RFQ form still exists', !!window.document.getElementById('rfq-form'));
  check('drawing upload accepts PDF and DXF',
    /\.pdf/.test(window.document.getElementById('rfq-file').accept) &&
    /\.dxf/.test(window.document.getElementById('rfq-file').accept));
  check('no page errors on the public site', errs.length === 0, errs[0] || '');
}

// ---------- 2. opened from the IDMS, signed in ----------
{
  const { window } = await boot('https://example.test/?embed=admin', 'TOK');
  await wait(250);
  check('embedded mode hides the public chrome', window.document.body.classList.contains('embedded'));
  check('the admin panel opens when the IDMS opens it',
    window.document.getElementById('admin-panel').classList.contains('open'));
}

// ---------- 3. opened without a session ----------
{
  const { window } = await boot('https://example.test/?embed=admin');
  await wait(250);
  check('no session means no admin panel',
    !window.document.getElementById('admin-panel').classList.contains('open'));
  check('and it says why', /Sign in first/.test(window.document.body.innerHTML));
}

// ---------- 4. the converter ----------
{
  const dom = new JSDOM('<body></body>', { runScripts: 'outside-only', url: 'https://example.test/' });
  dom.window.eval(conv);
  const DC = dom.window.DrawingConvert;
  const file = (name, type) => ({ name, type: type || '', size: 1000 });

  const cases = [
    ['drawing.dwg', /export the drawing as\s+PDF, DXF or JPEG/i, 'DWG is refused with what to do instead'],
    ['model.step', /PDF, DXF or JPEG/i, 'STEP is refused with what to do instead'],
    ['scan.tiff', /JPEG or PDF/i, 'TIFF is refused with what to do instead'],
    ['notes.docx', /PDF, DXF, JPEG or PNG/i, 'an unsupported type is refused clearly']
  ];
  for (const [name, re, label] of cases) {
    let msg = '';
    try { await DC.prepare(file(name)); } catch (e) { msg = e.message; }
    check(label, re.test(msg), msg);
  }
  check('a JPEG is accepted for conversion',
    !/cannot be converted/i.test(await DC.prepare(file('drg.jpg', 'image/jpeg')).then(() => '', e => e.message)),
    '');
  check('the size helper measures a data URL',
    DC.sizeOf('data:image/jpeg;base64,' + 'A'.repeat(4000)) === 3000);
}

let pass = 0, fail = 0;
for (const [n, ok, x] of results) { if (ok) pass++; else { fail++; console.log('  ✗ ' + n + (x ? '   [' + x + ']' : '')); } }
console.log('\n' + pass + ' passed, ' + fail + ' failed, of ' + results.length);
process.exit(fail ? 1 : 0);
