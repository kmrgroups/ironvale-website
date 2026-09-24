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

async function boot(url, token, opts) {
  const { fetchImpl, setup } = opts || {};
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', e => errs.push(e.message));
  const dom = new JSDOM(html.replace('<script src="/drawing-convert.js"></script>', ''),
    { runScripts: 'outside-only', url, virtualConsole: vc });
  const { window } = dom;
  if (token) window.localStorage.setItem('app_token', token);
  window.fetch = fetchImpl || (async (path, o = {}) => {
    const body = o.body ? JSON.parse(o.body) : {};
    const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
    if (String(path).startsWith('/api/auth')) {
      if (body.action === 'whoami') return ok({ user: { username: 'dev', role: 'developer' } });
      return ok({});
    }
    if (String(path).startsWith('/api/content')) return ok({ data: null });
    if (String(path).startsWith('/api/hr')) return ok({ items: [], employees: [], jobs: [] });
    if (String(path).startsWith('/api/rfqs')) return ok({ rfqs: [] });
    return ok({});
  });
  window.eval(conv);
  const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1];
  window.eval(inline);
  /* Runs in the same tick as the eval above, before init()'s own awaits
     resolve — a caller that needs window.open mocked before a hash route
     fires (the #quote link, say) sets it here, not after boot() returns. */
  if (setup) setup(window);
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
  /* This used to keep its own navy "Admin" title bar with a second close
     button — a whole extra app window inside the IDMS's own frame, which is
     what made it read as a remote screen rather than part of the IDMS. The
     engine underneath (DEFAULTS, the live content object, every tab) stays on
     the website on purpose: it is the same code that renders the public site,
     and copying it into the IDMS would mean two renderers that could quietly
     drift apart. Only the window dressing goes. */
  const css = window.document.querySelector('style') ? [...window.document.querySelectorAll('style')]
    .map(s => s.textContent).join('\n') : '';
  check('the embedded admin panel no longer shows its own title bar',
    /body\.embedded \.admin-head h2\{display:none/.test(css));
  check('and no longer shows its own close button', /body\.embedded \.admin-head \.admin-close\{display:none/.test(css));
  check('Publish Changes is still there — it is a real action, not chrome',
    !!window.document.getElementById('publish-btn'));
}

// ---------- 2b. RFQ Pipeline and HR & Payroll opened from the IDMS ----------
{
  const { window } = await boot('https://example.test/?embed=pipeline', 'TOK');
  await wait(250);
  const css = [...window.document.querySelectorAll('style')].map(s => s.textContent).join('\n');
  check('the pipeline bar drops its own title', /body\.embedded \.staff-bar h2/.test(css));
  check('and Sign Out is hidden', /#staff-logout/.test(css) && /display:none !important/.test(
    css.match(/body\.embedded[^{]*#staff-logout[^{]*\{[^}]*\}/)?.[0] || ''));
  /* This is the bug this pass found: Sign Out and the IDMS both keep their
     session token under localStorage key 'app_token', same origin, same
     storage — so pressing it in here cleared the IDMS's own session too, with
     nothing to explain why the IDMS asked for a fresh sign-in shortly after.
     The button is hidden now; this pins that the two really do collide, so a
     reappearing Sign Out button here is treated as the regression it is. */
  window.localStorage.setItem('app_token', 'TOK');
  window.document.getElementById('staff-logout').click();
  check('confirmed: that button clears the same key the IDMS session uses',
    window.localStorage.getItem('app_token') === null);
}
{
  const { window } = await boot('https://example.test/?embed=hr', 'TOK');
  await wait(250);
  const css = [...window.document.querySelectorAll('style')].map(s => s.textContent).join('\n');
  check('HR & Payroll drops its own title too', /body\.embedded \.staff-bar h2/.test(css));
  check('Refresh remains — it is a real action, not chrome', !!window.document.getElementById('hr-refresh'));
}

// ---------- 3. opened without a session ----------
{
  const { window } = await boot('https://example.test/?embed=admin');
  await wait(250);
  check('no session means no admin panel',
    !window.document.getElementById('admin-panel').classList.contains('open'));
  check('and it says why', /Sign in first/.test(window.document.body.innerHTML));
}

// ---------- 3b. the quotation view link (#quote?ref=...&t=...) ----------
{
  const quoteDoc = {
    number: 'QTN-2026-0007', createdAt: '2026-02-01T10:00:00.000Z',
    qty: 250, unitPrice: 164.19, subtotal: 41047.50, taxLabel: 'GST', taxPct: 18, tax: 7388.55,
    total: 48436.05, currencySymbol: '₹', partLine: 'Shaft · D-4410', validityDays: 30,
    paymentTerms: '50% advance', publicToken: 'goodtoken123456789012'
  };
  const company = { legalName: 'Acme Precision', phone: '044-1234 5678', rfqEmail: 'sales@acme.test' };
  const rfqRecord = { ref: 'RFQ-9001', name: 'Beta Buyer', email: 'beta@customer.test',
    fileUrl: '/api/assets?id=drw9', quoteDoc };

  // Stands in for server/routes/rfqs.js's own gate: quoteDoc only comes back
  // when qtoken matches, otherwise the same bare status a plain ?ref= gets.
  const fetchImpl = async (path) => {
    const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
    const url = String(path);
    if (url.startsWith('/api/content')) return ok({ data: { company } });
    if (url.startsWith('/api/rfqs')) {
      const qs = new URLSearchParams(url.split('?')[1] || '');
      if (qs.get('ref') === 'RFQ-9001' && qs.get('qtoken') === quoteDoc.publicToken)
        return ok({ rfq: rfqRecord });
      return ok({ rfq: { ref: 'RFQ-9001', status: 'Approved & Sent', date: '2026-02-01' } });
    }
    if (url.startsWith('/api/hr')) return ok({ items: [], employees: [], jobs: [] });
    return ok({});
  };
  const openWith = arr => w => { w.open = () => ({ document: { write: h => arr.push(h), close(){} }, print(){} }); };

  let opened = [];
  const { window } = await boot('https://example.test/#quote?ref=RFQ-9001&t=' + quoteDoc.publicToken, null,
    { fetchImpl, setup: openWith(opened) });
  await wait(200);
  check('the quote-view link opens a document', opened.length === 1, String(opened.length));
  const doc = opened[0] || '';
  check('it shows the quotation number', /QTN-2026-0007/.test(doc));
  check('it shows who it was quoted to', /Beta Buyer/.test(doc));
  check('it shows the total, correctly formatted', /48,436\.05/.test(doc));
  check('it shows the company from Company Profile, not a hard-coded name', /Acme Precision/.test(doc));
  check('it links to the drawing on file', /api\/assets\?id=drw9/.test(doc));
  check('it can be saved as a PDF from the browser’s own print dialog',
    /Save as PDF \/ Print/.test(doc));

  // A wrong or missing token must not leak the price — same as the server.
  opened = [];
  const { window: w2 } = await boot('https://example.test/#quote?ref=RFQ-9001&t=wrongtoken', null,
    { fetchImpl, setup: openWith(opened) });
  await wait(200);
  check('a wrong token opens nothing', opened.length === 0);
  check('…and says the link is not valid, rather than staying silent',
    /not valid/.test(w2.document.getElementById('save-toast').textContent),
    w2.document.getElementById('save-toast').textContent);
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
