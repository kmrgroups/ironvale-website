/* The two pieces of furniture that belong to every screen: the strip that says
   the AI is working, and the round buttons that scroll to the top or bottom.

   Both live in chrome.js rather than in either page, and that is the point
   worth protecting. idms.html and index.html each load chrome.js, so one
   implementation reaches every screen of both — nobody has to remember to add a
   spinner to a new screen, and there is no second copy to drift. They were
   written into core.js first, which was wrong: the website does not load
   core.js at all, so half the platform would have got neither. The first three
   checks below are what caught that.

   What went wrong before the strip existed: a costing takes fifty seconds, and
   a screen where nothing moves for fifty seconds looks exactly like a screen
   where something has failed. People pressed the button again. That started a
   second call, and whichever answer came back last overwrote the other. So the
   checks below care most about the two things that make it trustworthy — that
   it goes UP whenever a call starts, and that it comes DOWN afterwards even
   when the call failed, because a strip that sticks is worse than no strip. */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const core = fs.readFileSync('core.js', 'utf8');
const chrome = fs.readFileSync('chrome.js', 'utf8');
const idms = fs.readFileSync('idms.html', 'utf8');
const site = fs.readFileSync('index.html', 'utf8');

const results = [];
const check = (n, c, x) => results.push([n, !!c, x === undefined ? '' : String(x)]);
const wait = ms => new Promise(r => setTimeout(r, ms));

const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => pageErrors.push(e.message));
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="pad"></div></body></html>',
  { runScripts: 'outside-only', url: 'https://example.test/idms.html', virtualConsole: vc });
const { window } = dom;

/* jsdom does no layout, so the page is as tall as we say it is. Everything the
   dock decides is decided from these three numbers. */
let scrollHeight = 4000, clientHeight = 800, pageY = 0;
Object.defineProperty(window.document.documentElement, 'scrollHeight', { get: () => scrollHeight, configurable: true });
Object.defineProperty(window.document.documentElement, 'clientHeight', { get: () => clientHeight, configurable: true });
Object.defineProperty(window, 'pageYOffset', { get: () => pageY, configurable: true });
const scrolled = [];
window.scrollTo = o => { scrolled.push(o); pageY = (o && o.top) || 0; };
window.matchMedia = q => ({ matches: false, media: q, addListener() {}, removeListener() {} });

/* Each call is held open on its OWN promise, so the test can let the first one
   finish while the second is still running. Holding both on one promise and
   releasing them together was the first version of this, and it could not fail:
   with two calls ending in the same tick, "remove this job" and "clear every
   job" look exactly alike. That is the whole bug this file is here to catch. */
let failNext = false;
const gates = [];
window.fetch = async () => {
  const gate = {}; gate.p = new Promise(r => { gate.open = r; });
  gates.push(gate);
  await gate.p;
  if (failNext) { failNext = false; return { ok: true, status: 200, json: async () => ({ ok: false, error: 'provider refused' }) }; }
  return { ok: true, status: 200, json: async () => ({ ok: true, text: 'done' }) };
};
const openGate = i => gates[i].open();

window.eval(chrome);
window.eval(core);
const C = window.Core;
const $ = s => window.document.querySelector(s);
await wait(50);

// ---------- both pages get it from the one file ----------
/* The reason this file exists at all. core.js is loaded by the IDMS and NOT by
   the website — index.html is a standalone page with its own AI gateway — so
   anything put in core.js reaches exactly half the platform. This was written
   in core.js first and the check below is what caught it. */
check('chrome.js is loaded by the IDMS', /<script src="\/chrome\.js"><\/script>/.test(idms));
check('…and by the website, which does NOT load core.js and so would otherwise miss out',
  /<script src="\/chrome\.js"><\/script>/.test(site));
check('…and the website really is standalone, which is why core.js was the wrong home',
  !/<script src="\/core\.js"><\/script>/.test(site));
check('neither page defines the strip itself', !/cai-busy/.test(idms) && !/cai-busy/.test(site));
check('neither page defines the scroll dock itself', !/cs-dock/.test(idms) && !/cs-dock/.test(site));
/* Both gateways must raise it, or half the AI work on the platform is silent. */
check('the IDMS gateway raises the strip around every AI call',
  /aiStart\(opts\.label\)/.test(core) && /finally \{ aiEnd\(job\); \}/.test(core));
check('…and so does the website\u2019s own separate gateway',
  /PageChrome\.aiBusy\.start\(opts\.label\)/.test(site) &&
  /finally\{ if\(job&&window\.PageChrome\) window\.PageChrome\.aiBusy\.end\(job\); \}/.test(site));
/* core.js must survive chrome.js being absent — a progress strip is worth
   having and it is not worth a broken IDMS. */
check('core.js guards every call into it, so a missing chrome.js breaks nothing',
  /try \{ return window\.PageChrome && window\.PageChrome\.aiBusy\.start/.test(core));

// ---------- the strip ----------
check('the strip is put up without either page asking for it', !!$('.cai-busy'));
check('…and starts out of the way', !$('.cai-busy').classList.contains('on'));
check('…and is announced to a screen reader rather than only drawn',
  $('.cai-busy').getAttribute('role') === 'status' &&
  $('.cai-busy').getAttribute('aria-live') === 'polite');

const call1 = C.callAI('hello', { label: 'Reading the drawing — RFQ-0001' });
await wait(30);
check('the strip goes up the moment an AI call starts', $('.cai-busy').classList.contains('on'));
check('…and names the job, not just "loading"',
  $('.cai-what').textContent.includes('Reading the drawing'), $('.cai-what').textContent);

/* Two calls at once is the ordinary case — a costing that triggers a price
   check, or an impatient second press. */
const call2 = C.callAI('hello again', { label: 'Checking market prices' });
await wait(30);
check('a second call in flight is counted, not lost',
  /2 running/.test($('.cai-what').textContent), $('.cai-what').textContent);

/* The first one finishes ALONE. This is the check that earns the depth counter:
   a flag, or an end() that clears the list, takes the strip down here — over a
   call that is still running, on the screen of somebody still waiting for it. */
openGate(0);
await call1;
await wait(40);
check('one call finishing does not take the strip down over the one still running',
  $('.cai-busy').classList.contains('on'), $('.cai-busy').className);
check('…and the strip now names the job that is actually still running',
  /Checking market prices/.test($('.cai-what').textContent) &&
  !/2 running/.test($('.cai-what').textContent), $('.cai-what').textContent);
check('…and exactly one job is left, not zero and not two', C.aiBusy.count() === 1, String(C.aiBusy.count()));

openGate(1);
await call2;
await wait(40);
check('the strip comes down once everything has finished', !$('.cai-busy').classList.contains('on'));

/* The one that matters most. A strip raised in a try and lowered on the happy
   path only would stay up for ever on the first failure — and a failure is
   exactly when someone is staring at the screen wondering what is happening. */
failNext = true;
let threw = false;
const call3 = C.callAI('this one fails', { label: 'Planning the route' }).catch(() => { threw = true; });
await wait(20);
openGate(2);
await call3;
await wait(40);
check('a call that fails still throws', threw);
check('…and the strip comes down anyway, rather than sticking on a failure',
  !$('.cai-busy').classList.contains('on'), $('.cai-busy').className);

/* Work that is not a single AI call still keeps someone waiting — converting a
   drawing, drawing a balloon overlay — so the handle is exported for it. */
check('the strip can be raised for work that is not one AI call', typeof C.aiBusy.start === 'function');
const h = C.aiBusy.start('Drawing the balloons');
await wait(20);
check('…and it shows that work by name',
  $('.cai-busy').classList.contains('on') && /balloons/.test($('.cai-what').textContent),
  $('.cai-what').textContent);
C.aiBusy.end(h);
await wait(20);
check('…and comes down when that work ends', !$('.cai-busy').classList.contains('on'));
check('nothing is left running behind it', C.aiBusy.count() === 0, String(C.aiBusy.count()));

// ---------- the scroll dock ----------
const up = $('.cs-up'), down = $('.cs-down');
check('both arrows are on the page', !!up && !!down);
check('…as round buttons with a drawn arrow, not a text character',
  !!up.querySelector('svg') && /border-radius:50%/.test(chrome));
check('…and they say what they do, for anyone not using a mouse',
  /top/i.test(up.getAttribute('aria-label') || '') && /bottom/i.test(down.getAttribute('aria-label') || ''));

pageY = 0;
window.dispatchEvent(new window.Event('scroll'));
await wait(20);
check('at the top of a long screen there is no "up" offered — it would do nothing',
  !up.classList.contains('on'));
check('…but "down" is', down.classList.contains('on'));

pageY = 2000;
window.dispatchEvent(new window.Event('scroll'));
await wait(20);
check('part way down, both are offered', up.classList.contains('on') && down.classList.contains('on'));

pageY = 3200;
window.dispatchEvent(new window.Event('scroll'));
await wait(20);
check('at the bottom, "down" is withdrawn', !down.classList.contains('on'));
check('…and "up" is still there', up.classList.contains('on'));

/* A short screen has nowhere to go, and two buttons that do nothing are two
   buttons people learn to ignore. */
scrollHeight = 900; clientHeight = 800; pageY = 0;
window.dispatchEvent(new window.Event('scroll'));
await wait(20);
check('on a screen that barely scrolls, neither arrow is shown',
  !up.classList.contains('on') && !down.classList.contains('on'));

/* An IDMS screen gets taller without anyone scrolling — expanding an RFQ row,
   running a report. No scroll or resize event fires for that, so the dock
   re-checks on a timer; without it the arrow never appears on the screens that
   need it most. */
scrollHeight = 5000;
await wait(750);
check('a screen that grows underneath you still gets its arrow, with no event to go on',
  down.classList.contains('on'), down.className);

scrollHeight = 4000; pageY = 2500;
window.dispatchEvent(new window.Event('scroll'));
await wait(20);
scrolled.length = 0;
up.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(20);
check('pressing "up" goes to the very top', scrolled.length === 1 && scrolled[0].top === 0,
  JSON.stringify(scrolled));
pageY = 0;
window.dispatchEvent(new window.Event('scroll'));
await wait(20);
scrolled.length = 0;
down.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(20);
check('pressing "down" goes to the very bottom',
  scrolled.length === 1 && scrolled[0].top === 4000, JSON.stringify(scrolled));

// ---------- neither belongs on paper ----------
const css = window.document.getElementById('core-scroll-dock').textContent;
check('neither the arrows nor the strip print on a quotation or a cost sheet',
  /@media print\{[^}]*cs-dock[^}]*cai-busy[^}]*display:none/.test(css.replace(/\s+/g, '')) ||
  /@media print/.test(css) && /cs-dock,\.cai-busy\{display:none/.test(css.replace(/\s+/g, '')),
  (css.match(/@media print[^}]*\}/) || [''])[0]);

check('no console errors throughout', pageErrors.length === 0, pageErrors.join(' | '));

const pass = results.filter(r => r[1]).length;
results.forEach(([n, c, x]) => console.log((c ? '  ok  ' : '  x   ') + ' ' + n + (c || !x ? '' : '   [' + x + ']')));
console.log('\n' + pass + ' passed, ' + (results.length - pass) + ' failed, of ' + results.length);
process.exit(results.length - pass ? 1 : 0);
