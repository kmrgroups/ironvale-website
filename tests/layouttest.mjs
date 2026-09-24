/* Two things reported from the live site that no jsdom suite could have caught,
   because both are questions about LAYOUT and jsdom does no layout. It reports
   every height as zero, so "does this menu run off the bottom of the screen"
   has no answer there. This suite drives real Chromium at real window sizes.

   1. "Some hidden text in the screen." The IDMS home banner showed a
      broken-image icon and half a sentence jammed under the menu bar. The
      sentence was the hero headline, sitting in the img's alt text, sliced in
      two by the container's line-height:0 — which is right for a picture and
      wrong for anything else. It read as a rendering fault. It was a missing
      file, and nothing on the screen said so.

   2. "Menu list getting hidden at the bottom of the pages." TWO faults, and
      the first version of this suite could only have caught one of them.

      The one it caught: HRM has 23 entries and hundreds of pixels of that
      list sat below the fold inside a scrolling box that only a thin
      scrollbar hinted at. Fixed by going wider — the screen is 1366 across
      and the column was 268.

      The one it MISSED, because it was driven against a synthetic page:
      `body` carries overflow-x:hidden, and per spec an element with one axis
      hidden has the other computed to auto — so body is a clipping box, only
      as tall as its content. On a screen with little content it was 468px on
      a 645px window, and the whole dropdown was sliced off at 468 with a flat
      edge. The menu was not too tall and it was not behind anything; it was
      cut off by the bottom of the page's own content.

      So this half now boots the REAL idms.html in a real browser with /api
      stubbed, rather than a hand-built shell carrying a copy of the menu CSS.
      A shell that omits one property of the real page cannot find a bug that
      lives in that property, and this one did exactly that.

   Run with `node tests/layouttest.mjs`. It skips itself, passing, if Playwright
   or its Chromium are not installed — a layout suite that cannot run must not
   fail the suite for everyone else. */
import fs from 'fs';
import path from 'path';

const results = [];
const check = (n, c, x) => results.push([n, !!c, x === undefined ? '' : String(x)]);
const done = () => {
  const pass = results.filter(r => r[1]).length;
  results.forEach(([n, c, x]) => console.log((c ? '  ok  ' : '  x   ') + ' ' + n + (c || !x ? '' : '   [' + x + ']')));
  console.log('\n' + pass + ' passed, ' + (results.length - pass) + ' failed, of ' + results.length);
  process.exit(results.length - pass ? 1 : 0);
};

let chromium, exe;
try {
  ({ chromium } = await import('playwright'));
  const root = '/opt/pw-browsers';
  exe = fs.readdirSync(root).filter(d => /^chromium-/.test(d))
    .map(d => path.join(root, d, 'chrome-linux', 'chrome')).find(p => fs.existsSync(p));
  if (!exe) throw new Error('no chromium under /opt/pw-browsers');
} catch (e) {
  console.log('  --   skipped: ' + e.message + ' (layout checks need a real browser)');
  console.log('\n0 passed, 0 failed, of 0');
  process.exit(0);
}

const idms = fs.readFileSync('idms.html', 'utf8');

// ---------- 1. the banner never leaves half a sentence on screen ----------
/* Asserted against the source, because the fault is in the ORDER of three
   statements and a rendered page cannot show that the handlers were attached
   before the src. A cached image fires load/error synchronously on assignment;
   setting src first means nobody is listening when it does. */
const loader = (idms.match(/if \(d\.heroBannerDataUrl\) \{[\s\S]*?\n      \} else \{/) || [''])[0];
check('the banner waits for the image to load before it is shown',
  /img\.onload = function\(\)\{ host\.style\.display = ''/.test(loader), loader.slice(0, 80));
check('…and a missing file hides it rather than leaving clipped alt text',
  /img\.onerror = function\(\)\{ host\.style\.display = 'none'/.test(loader));
check('…with the handlers attached BEFORE the src, or a cached image fires them first',
  loader.indexOf('img.onerror') < loader.indexOf('img.src = d.heroBannerDataUrl'),
  'onerror@' + loader.indexOf('img.onerror') + ' src@' + loader.indexOf('img.src = d.heroBannerDataUrl'));
check('…and the screen says the picture is missing instead of showing a gap',
  /id="hb-missing"/.test(idms) && /file behind it is no longer in storage/.test(idms));
check('…and points at the backup that puts the pictures back',
  /data-goto="admin_backup"/.test((idms.match(/id="hb-missing"[\s\S]{0,700}/) || [''])[0]));

const browser = await chromium.launch({ executablePath: exe });

/* No rendered reproduction of the banner symptom is attempted here. One was
   written and thrown away: an img with a dead src, alone in the shipped
   .hero-banner rule, did NOT clip the way the live screen did — the real one
   sits inside .app-body at a constrained width with a real headline, and the
   isolated version simply stretched. A harness tuned until it agrees with the
   diagnosis proves nothing; the five source checks above are what fail if the
   fix is reverted, and that was verified by reverting it. */

// ---------- 2. the real page, booted, with its dropdowns measured ----------
/* Serves the real files and stubs /api, so the page signs in and draws its own
   menu from its own MENU array. Nothing here is a copy of the app. */
const files = {
  '/idms.html': ['text/html', idms],
  '/core.js': ['application/javascript', fs.readFileSync('core.js')],
  '/kpi.js': ['application/javascript', fs.readFileSync('kpi.js')],
  '/chrome.js': ['application/javascript', fs.readFileSync('chrome.js')],
  '/core.css': ['text/css', fs.existsSync('core.css') ? fs.readFileSync('core.css') : ''],
  '/drawing-convert.js': ['application/javascript', 'window.DrawingConvert={};']
};
const stub = async route => {
  const u = new URL(route.request().url());
  if (files[u.pathname]) { const [t, body] = files[u.pathname]; return route.fulfill({ status: 200, contentType: t, body }); }
  if (u.pathname.startsWith('/api/')) {
    const post = route.request().postData();
    const b2 = post ? JSON.parse(post) : {};
    let j = { ok: true };
    if (u.pathname === '/api/auth') j = b2.action === 'login'
      ? { ok: true, token: 'T', user: 'tester', role: 'developer' }
      : { ok: true, user: 'tester', role: 'developer' };
    else if (u.pathname === '/api/content') j = { ok: true, data: { company: { legalName: 'Test Mfg' } } };
    else if (u.pathname === '/api/hr') j = { ok: true, employees: [], items: [], audit: [] };
    else if (u.pathname === '/api/idms') j = { ok: true, parts: [], docs: [], audit: [], settings: {}, counters: [] };
    else if (u.pathname === '/api/rfqs') j = { ok: true, rfqs: [] };
    else if (u.pathname === '/api/settings') j = { ok: true, settings: {} };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) });
  }
  return route.fulfill({ status: 404, body: '' });
};

const openIdms = async (w, h) => {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.route('**/*', stub);
  await page.goto('https://idms.test/idms.html');
  await page.waitForSelector('#g-user', { timeout: 15000 });
  await page.fill('#g-user', 'tester'); await page.fill('#g-pass', 'secret123');
  await page.click('#g-go');
  await page.waitForSelector('#menubar [data-gi]', { timeout: 15000 });
  await page.waitForTimeout(500);
  return page;
};

const measure = page => page.evaluate(() => {
  const bar = document.getElementById('menubar');
  const inside = (el, drop) => { for (let e = el; e; e = e.parentElement) if (e === drop) return true; return false; };
  const out = [];
  bar.querySelectorAll('.mgroup[data-gi]').forEach(g => {
    document.body.click();
    g.querySelector('a.mg-toggle').click();
    const drop = g.querySelector('.drop');
    const dr = drop.getBoundingClientRect();
    /* The question is not "does an overflow ancestor exist" — a position:fixed
       element is not clipped by one. It is "is this actually painted". */
    const seen = [4, 12, 28].map(dy => {
      const el = document.elementFromPoint(dr.left + dr.width / 2, dr.bottom - dy);
      return !!el && inside(el, drop);
    });
    out.push({
      name: g.querySelector('a').textContent.replace(/[^A-Za-z &]/g, '').trim(),
      bottomPainted: seen.every(Boolean),
      hidden: Math.max(0, drop.scrollHeight - drop.clientHeight),
      offBottom: Math.round(dr.bottom - window.innerHeight),
      offRight: Math.round(dr.right - window.innerWidth),
      offLeft: Math.round(-dr.left),
      bodyBottom: Math.round(document.body.getBoundingClientRect().bottom)
    });
  });
  return out;
});

/* The precondition that exposed the bug: a page whose content is SHORTER than
   the window, so body's own clipping box ends above the fold. It does not hold
   at every window size — on a short window the 468px body is taller than the
   viewport — so it is asserted once, over the sizes tested, rather than at each
   one. An earlier version checked it per size and failed at 460x, which was the
   assertion being wrong rather than the app. */
let shortPageSeen = '';
for (const [w, h] of [[1366, 645], [1366, 560], [1366, 460]]) {
  const page = await openIdms(w, h);
  const rows = await measure(page);
  check('at ' + w + 'x' + h + ': the real menu was drawn, all of it',
    rows.length >= 14, rows.length + ' groups');

  /* The one the synthetic shell could not see. body is short on a screen with
     little content, and an absolutely-positioned dropdown is cut off at its
     bottom edge — flat, rounded corners gone, exactly as reported. */
  const cut = rows.filter(r => !r.bottomPainted);
  check('at ' + w + 'x' + h + ': every dropdown is painted to its own bottom edge',
    cut.length === 0, cut.map(r => r.name).join(', ') +
      (rows[0] ? '  (body ends at ' + rows[0].bodyBottom + ', window is ' + h + ')' : ''));
  if (rows.length && rows[0].bodyBottom < h) shortPageSeen = w + 'x' + h + ' body=' + rows[0].bodyBottom;

  const hid = rows.filter(r => r.hidden > 0);
  check('at ' + w + 'x' + h + ': every entry of every menu is reachable without scrolling inside it',
    hid.length === 0, hid.map(r => r.name + ' hides ' + r.hidden + 'px').join(', '));

  const over = rows.filter(r => r.offBottom > 0);
  check('at ' + w + 'x' + h + ': no menu runs past the bottom of the window',
    over.length === 0, over.map(r => r.name + ' +' + r.offBottom).join(', '));

  const off = rows.filter(r => r.offRight > 0 || r.offLeft > 0);
  check('at ' + w + 'x' + h + ': no menu runs off the side either',
    off.length === 0, off.map(r => r.name + ' L' + r.offLeft + ' R' + r.offRight).join(', '));
  await page.close();
}

check('at least one window size gives a page shorter than the window — the case that exposed this',
  !!shortPageSeen, shortPageSeen || 'none of the tested sizes');

/* A fixed dropdown does not move with the page unless something moves it. */
{
  const page = await openIdms(1366, 645);
  const moved = await page.evaluate(async () => {
    const g = document.querySelector('#menubar .mgroup[data-gi]');
    g.querySelector('a.mg-toggle').click();
    const drop = g.querySelector('.drop');
    const before = Math.round(drop.getBoundingClientRect().top);
    const btnBefore = Math.round(g.getBoundingClientRect().bottom);
    document.body.style.minHeight = '3000px';
    window.scrollTo(0, 400);
    await new Promise(r => setTimeout(r, 250));
    return { before, btnBefore, after: Math.round(drop.getBoundingClientRect().top),
             btnAfter: Math.round(g.getBoundingClientRect().bottom) };
  });
  check('an open menu follows its button when the page scrolls under it',
    Math.abs((moved.after - moved.btnAfter) - (moved.before - moved.btnBefore)) <= 3,
    JSON.stringify(moved));
  await page.close();
}

// ---------- 3. the website gets the scroll arrows too ----------
/* Asked for directly. index.html does not load core.js, which is why the
   arrows live in chrome.js — this proves they actually arrive there. */
{
  const siteFiles = {
    '/': ['text/html', fs.readFileSync('index.html')],
    '/chrome.js': ['application/javascript', fs.readFileSync('chrome.js')],
    '/drawing-convert.js': ['application/javascript', 'window.DrawingConvert={};'],
    '/site.css': ['text/css', fs.existsSync('site.css') ? fs.readFileSync('site.css') : ''],
    '/core.css': ['text/css', fs.existsSync('core.css') ? fs.readFileSync('core.css') : '']
  };
  const page = await browser.newPage({ viewport: { width: 1366, height: 645 } });
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (siteFiles[u.pathname]) { const [t, body] = siteFiles[u.pathname]; return route.fulfill({ status: 200, contentType: t, body }); }
    if (u.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: { company: { legalName: 'Test Mfg' } }, rfqs: [], settings: {} }) });
    return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('') });
  });
  await page.goto('https://site.test/');
  await page.waitForTimeout(1200);
  const at = await page.evaluate(() => {
    const vis = el => { if (!el) return false; const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none'; };
    return { chrome: !!window.PageChrome, strip: !!document.querySelector('.cai-busy'),
      tall: document.documentElement.scrollHeight > window.innerHeight * 2,
      down: vis(document.querySelector('.cs-down')), up: vis(document.querySelector('.cs-up')) };
  });
  check('the website loads the shared chrome', at.chrome && at.strip, JSON.stringify(at));
  check('…and the website page really is long enough to need arrows', at.tall);
  check('at the top of the website, "down" is offered and "up" is not',
    at.down && !at.up, JSON.stringify(at));
  await page.evaluate(() => window.scrollTo(0, 2000));
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => {
    const up = document.querySelector('.cs-up');
    const r = up.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const inside = (e) => { for (let x = e; x; x = x.parentElement) if (x === up) return true; return false; };
    return { shown: getComputedStyle(up).display !== 'none', clickable: !!el && inside(el) };
  });
  check('…and after scrolling the website, "up" appears', after.shown);
  check('…where nothing is sitting on top of it', after.clickable);
  await page.close();
}

await browser.close();
done();
