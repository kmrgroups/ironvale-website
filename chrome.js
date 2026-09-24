/* chrome.js — the furniture every screen has.

   Two things, and they are here rather than in either page because BOTH pages
   need them: idms.html and index.html. The website is a standalone file with
   its own AI gateway and does not load core.js, so anything put in core.js
   reaches exactly half the platform. This file is loaded by both.

   It has no dependencies, touches no data, and reads nothing from the server.
   If it fails to load, both pages carry on without it.

     1. "The AI is working" — one strip across the top of the window, raised by
        whichever AI gateway the page has. The screens used to disagree about
        what waiting looks like: some buttons renamed themselves ("Planning…"),
        some did nothing at all, and a costing that takes fifty seconds looked
        exactly like one that had silently failed. People pressed again, which
        started a second call, and the second answer overwrote the first.

     2. The scroll arrows — two round buttons in the corner. The IDMS screens
        are long (a twelve-operation cost sheet, the audit log, a quotation)
        and there was no way back to the top but a flick of the wheel.

     3. Multi-Template Screen Design Engine & Developer Admin Controller —
        Allows Developer Admin to switch between all 12 Corporate Business-Class
        & Luxury Templates (plus Original Classic) independently for Website
        (index.html) and IDMS (idms.html) without disturbing any functionality.

   Exposed as window.PageChrome so both gateways can raise the strip:
     var job = PageChrome.aiBusy.start('Reading the drawing');
     try { ... } finally { PageChrome.aiBusy.end(job); }
   Always in a finally. A strip that sticks after a failure is worse than no
   strip, because a failure is exactly when somebody is staring at the screen. */
(function () {
  'use strict';

/* ---------------- "the AI is working" ----------------
   Every AI call on this platform goes through callAI() below, so this is the
   one place that can know the AI is busy — and the only place that does not
   have to be remembered at each of the dozens of call sites.

   It exists because the screens disagreed with each other about what waiting
   looks like. Some buttons changed their own text ("Planning…"), some did
   nothing at all, and a costing that takes fifty seconds looked identical to
   one that had silently failed. People pressed the button again, which
   started a second call, and the second answer overwrote the first.

   So: one strip across the top of the window, for the whole platform. It
   names the job, counts the seconds, and survives overlapping calls — the
   counter is a depth, not a flag, so two calls in flight do not let the
   first one to finish clear the strip out from under the second. */
var aiJobs = [], aiEl = null, aiTick = null;
function aiEnsure() {
  if (aiEl || !document.body) return aiEl;
  injectStyle('core-ai-busy',
    '.cai-busy{position:fixed;left:0;right:0;top:0;z-index:99998;pointer-events:none;' +
      'display:none;font:500 13px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}' +
    '.cai-busy.on{display:block;}' +
    '.cai-bar{height:3px;width:100%;background:rgba(127,127,127,.18);overflow:hidden;}' +
    '.cai-bar i{display:block;height:100%;width:38%;border-radius:3px;' +
      'background:linear-gradient(90deg,#7c9cff,#2f6fed,#7c9cff);animation:cai-slide 1.15s ease-in-out infinite;}' +
    '@keyframes cai-slide{0%{transform:translateX(-100%);}100%{transform:translateX(320%);}}' +
    '.cai-pill{margin:8px auto 0;width:max-content;max-width:min(92vw,520px);' +
      'display:flex;align-items:center;gap:8px;padding:7px 14px;border-radius:999px;' +
      'background:rgba(20,26,40,.92);color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.28);}' +
    '.cai-dot{width:8px;height:8px;border-radius:50%;background:#7c9cff;flex:none;' +
      'animation:cai-pulse 1.1s ease-in-out infinite;}' +
    '@keyframes cai-pulse{0%,100%{opacity:.35;}50%{opacity:1;}}' +
    '.cai-what{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.cai-secs{opacity:.7;font-variant-numeric:tabular-nums;flex:none;}' +
    /* Someone who has asked for less movement still needs to know it is
       running — the animation goes, the strip does not. */
    '@media (prefers-reduced-motion: reduce){.cai-bar i{animation:none;width:100%;}' +
      '.cai-dot{animation:none;opacity:1;}}');
  aiEl = document.createElement('div');
  aiEl.className = 'cai-busy';
  aiEl.setAttribute('role', 'status');
  aiEl.setAttribute('aria-live', 'polite');
  aiEl.innerHTML = '<div class="cai-bar"><i></i></div>' +
    '<div class="cai-pill"><span class="cai-dot"></span>' +
    '<span class="cai-what"></span><span class="cai-secs"></span></div>';
  document.body.appendChild(aiEl);
  return aiEl;
}
function aiPaint() {
  const el = aiEnsure(); if (!el) return;
  if (!aiJobs.length) {
    el.classList.remove('on');
    if (aiTick) { clearInterval(aiTick); aiTick = null; }
    return;
  }
  const job = aiJobs[aiJobs.length - 1];
  const secs = Math.round((Date.now() - job.at) / 1000);
  /* The count is shown only while something is actually queued behind this
     one, because "(1 of 1)" is noise on the ordinary case. */
  el.querySelector('.cai-what').textContent = job.label +
    (aiJobs.length > 1 ? '  ·  ' + aiJobs.length + ' running' : '');
  el.querySelector('.cai-secs').textContent = secs >= 1 ? secs + 's' : '';
  el.classList.add('on');
}
function aiStart(label) {
  const job = { label: String(label || 'The AI is working…'), at: Date.now() };
  aiJobs.push(job);
  aiPaint();
  if (!aiTick) aiTick = setInterval(aiPaint, 1000);
  return job;
}
function aiEnd(job) {
  const i = aiJobs.indexOf(job);
  if (i >= 0) aiJobs.splice(i, 1);
  aiPaint();
}

/* ---------------- scroll to the top, or the bottom ----------------
   A round button in the corner, on every screen of both the website and the
   IDMS. The IDMS screens are long — a cost sheet with a twelve-operation
   route, the audit log, a full quotation — and there was no way back up but
   a flick of the wheel.

   Two details worth keeping:
   - It hides the arrow that would do nothing. At the top of a screen there
     is no "up" to offer, and a button that does nothing when pressed is a
     button people stop trusting.
   - The height of an IDMS screen changes without anyone scrolling: expanding
     an RFQ row, running a report, drawing a table. Scroll and resize events
     do not fire for any of that, so the visibility is also re-checked on a
     slow timer. It is two reads of scrollHeight a second and it is the only
     thing that catches a screen that just got taller underneath you. */
var dockEl = null;
function scrollDock() {
  if (dockEl || !document.body) return;
  injectStyle('core-scroll-dock',
    '.cs-dock{position:fixed;right:16px;bottom:18px;z-index:99997;display:flex;' +
      'flex-direction:column;gap:8px;}' +
    '.cs-dock button{width:40px;height:40px;border-radius:50%;border:1px solid rgba(0,0,0,.10);' +
      'background:rgba(255,255,255,.94);color:#1b2436;cursor:pointer;display:none;' +
      'align-items:center;justify-content:center;padding:0;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.18);backdrop-filter:blur(6px);' +
      'transition:transform .12s ease, background .12s ease;}' +
    '.cs-dock button.on{display:flex;}' +
    '.cs-dock button:hover{background:#fff;transform:translateY(-1px);}' +
    '.cs-dock button:active{transform:translateY(0);}' +
    '.cs-dock svg{width:18px;height:18px;display:block;}' +
    '@media (prefers-color-scheme: dark){.cs-dock button{background:rgba(32,38,52,.94);' +
      'color:#eef2f8;border-color:rgba(255,255,255,.14);}' +
      '.cs-dock button:hover{background:rgba(42,50,68,.98);}}' +
    /* out of the way of a thumb on a phone, where the corner is busiest */
    '@media (max-width:640px){.cs-dock{right:12px;bottom:12px;}' +
      '.cs-dock button{width:36px;height:36px;}}' +
    '@media print{.cs-dock,.cai-busy{display:none !important;}}');
  const arrow = up => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (up ? '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>'
        : '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>') + '</svg>';
  dockEl = document.createElement('div');
  dockEl.className = 'cs-dock';
  dockEl.innerHTML =
    '<button type="button" class="cs-up" title="Back to the top" aria-label="Scroll to the top">' + arrow(true) + '</button>' +
    '<button type="button" class="cs-down" title="Jump to the bottom" aria-label="Scroll to the bottom">' + arrow(false) + '</button>';
  document.body.appendChild(dockEl);

  const up = dockEl.querySelector('.cs-up'), down = dockEl.querySelector('.cs-down');
  const smooth = !window.matchMedia || !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const to = y => window.scrollTo({ top: y, behavior: smooth ? 'smooth' : 'auto' });
  up.addEventListener('click', () => to(0));
  down.addEventListener('click', () => to(document.documentElement.scrollHeight));
  function sync() {
    const d = document.documentElement;
    const y = window.pageYOffset || d.scrollTop || 0;
    const room = d.scrollHeight - d.clientHeight;
    /* under one screenful of slack there is nothing worth jumping to */
    const worth = room > 240;
    up.classList.toggle('on', worth && y > 160);
    down.classList.toggle('on', worth && y < room - 160);
  }
  window.addEventListener('scroll', sync, { passive: true });
  window.addEventListener('resize', sync, { passive: true });
  setInterval(sync, 600);
  sync();
}

function injectStyle(id, css) {
  var existing = document.getElementById(id);
  if (existing) {
    existing.textContent = css;
    return existing;
  }
  const s = document.createElement('style');
  s.id = id; s.textContent = css;
  (document.head || document.documentElement).appendChild(s);
  return s;
}

/* ============================================================================
   MULTI-TEMPLATE DESIGN ENGINE & DEVELOPER ADMIN CONTROLLER
   All 12 Templates (+ Original Classic) for Website (index.html) & IDMS (idms.html)
   ============================================================================ */
var STORAGE_KEY_WEB  = 'elixirtec_web_template_v1';
var STORAGE_KEY_IDMS = 'elixirtec_idms_template_v1';
var STORAGE_KEY_NAV  = 'elixirtec_idms_navmode_v1';

var TEMPLATES = [
  {
    id: 'default',
    code: 'Original',
    name: 'Original Classic Design',
    group: 'Current Default',
    desc: 'Your original untouched website and IDMS screen layout.',
    badge: 'DEFAULT',
    light: true,
    navDefault: 'ribbon',
    colors: { bg: '#F8FBFE', surface: '#FFFFFF', primary: '#0B2A5B', accent: '#C2932E', border: 'rgba(11,42,91,.12)' }
  },
  {
    id: 'A1',
    code: 'Suite A1',
    name: 'Geneva Executive Pearl & Royal Navy',
    group: 'Suite A • Corporate Business-Class (Light)',
    desc: 'Siemens AG / McKinsey style: Porcelain white, pearl grey, deep royal navy & brushed sovereign gold with single-row header & left IDMS sidebar.',
    badge: 'SUITE A',
    light: true,
    navDefault: 'sidebar',
    colors: { bg: '#F4F7FB', surface: '#FFFFFF', primary: '#0A2246', accent: '#B8891E', border: '#E2E8F0' }
  },
  {
    id: 'A2',
    code: 'Suite A2 ★',
    name: 'Davos Boardroom 4-Card Bento',
    group: 'Suite A • Corporate Business-Class (Light)',
    desc: 'McKinsey Digital / BCG style: 4-Card Executive Bento Hero + Left White IDMS Sidebar & Bento KPIs.',
    badge: 'RECOMMENDED',
    light: true,
    navDefault: 'sidebar',
    colors: { bg: '#EEF2F7', surface: '#FFFFFF', primary: '#0A2246', accent: '#B8891E', border: '#CBD5E1' }
  },
  {
    id: 'A3',
    code: 'Suite A3',
    name: 'Frankfurt Executive Ribbon & Trust Ledger',
    group: 'Suite A • Corporate Business-Class (Light)',
    desc: 'Bosch Global / ThyssenKrupp style: Split Hero with Royal Navy Trust Ledger + 100% Full-Width Single-Row Top Ribbon IDMS.',
    badge: 'FULL WIDTH',
    light: true,
    navDefault: 'ribbon',
    colors: { bg: '#F8FAFC', surface: '#FFFFFF', primary: '#0A2246', accent: '#C59B27', border: '#E2E8F0' }
  },
  {
    id: 'A4',
    code: 'Suite A4',
    name: 'London Sovereign Gold-Framed Cards',
    group: 'Suite A • Corporate Business-Class (Light)',
    desc: 'HSBC Premier / Rolls-Royce Report style: 1px Brushed-Gold Framed Cards + Detached Floating Left Navigation Dock in IDMS.',
    badge: 'SOVEREIGN',
    light: true,
    navDefault: 'floating',
    colors: { bg: '#EEF2F6', surface: '#FFFFFF', primary: '#0A2246', accent: '#B8891E', border: '#D9B14A' }
  },
  {
    id: 'A5',
    code: 'Suite A5',
    name: 'Tokyo 1px Architectural Hairline Grid',
    group: 'Suite A • Corporate Business-Class (Light)',
    desc: 'DMG MORI Light / Fanuc Corporate style: Crisp 1px architectural specification grid & high-density executive workspace.',
    badge: 'PRECISION',
    light: true,
    navDefault: 'sidebar',
    colors: { bg: '#FFFFFF', surface: '#F8FAFC', primary: '#0A2246', accent: '#B8891E', border: '#CBD5E1' }
  },
  {
    id: 'B',
    code: 'Suite B',
    name: 'Zurich Champagne Ivory & Sovereign Brass',
    group: 'Pure-Light Corporate Suites',
    desc: 'Rolex Corporate / Tata Sons style: Warm Champagne Alabaster Ivory (#FAF8F5), editorial serif headlines & single-row gold-ruled ribbon.',
    badge: 'IVORY LUXURY',
    light: true,
    navDefault: 'ribbon',
    colors: { bg: '#FAF8F5', surface: '#FFFFFF', primary: '#0A2246', accent: '#9A6F0B', border: '#E6DEC8' }
  },
  {
    id: 'C',
    code: 'Suite C',
    name: 'Munich Mobility Crystal & Royal Cobalt',
    group: 'Pure-Light Corporate Suites',
    desc: 'BMW Group / ThyssenKrupp style: Crystal white & soft ice-blue wash (#F0F7FF) with Royal Cobalt (#0D3B82) & gold highlights.',
    badge: 'DAYLIGHT SKY',
    light: true,
    navDefault: 'sidebar',
    colors: { bg: '#F0F7FF', surface: '#FFFFFF', primary: '#0D3B82', accent: '#B8891E', border: '#BAE6FD' }
  },
  {
    id: 'E2',
    code: 'Edition II',
    name: 'Architectural Platinum & CAD Blueprint',
    group: 'Light CAD & Blueprint Series',
    desc: 'Leica / Apple Industrial Design style: Milled anodized silver (#F5F7FA) with subtle engineering CAD coordinate grid lines.',
    badge: 'CAD LIGHT',
    light: true,
    navDefault: 'sidebar',
    colors: { bg: '#F5F7FA', surface: '#FFFFFF', primary: '#081C3A', accent: '#9C7412', border: '#CBD5E1' }
  },
  {
    id: 'T2',
    code: 'Template 02',
    name: 'Swiss Precision Light Bento',
    group: 'Light CAD & Blueprint Series',
    desc: 'Clean Swiss architectural grid with elevated white cards and single-row top ribbon navigation.',
    badge: 'SWISS LIGHT',
    light: true,
    navDefault: 'ribbon',
    colors: { bg: '#F8FAFC', surface: '#FFFFFF', primary: '#0B2A5B', accent: '#C2932E', border: '#E2E8F0' }
  },
  {
    id: 'T3',
    code: 'Template 03',
    name: 'Executive Hybrid Navy & Gold Drawer',
    group: 'Hybrid Navy & Gold',
    desc: 'Keeps signature Royal Navy (#0B2A5B) & Gold header/sidebar while upgrading the IDMS 17 modules into a sleek Royal Navy Left Drawer.',
    badge: 'NAVY DRAWER',
    light: true,
    navDefault: 'navy-sidebar',
    colors: { bg: '#F4F7FB', surface: '#FFFFFF', primary: '#0B2A5B', accent: '#C2932E', border: '#D8E2EF' }
  },
  {
    id: 'E1',
    code: 'Edition I',
    name: 'Obsidian & Liquid Gold',
    group: 'Dark & Midnight Series',
    desc: 'Porsche Engineering & Palantir Foundry dark obsidian carbon (#07090E) with 1px champagne-gold foil borders.',
    badge: 'DARK CARBON',
    light: false,
    navDefault: 'sidebar',
    colors: { bg: '#07090E', surface: '#0F1420', primary: '#F8FAFC', accent: '#D4AF37', border: 'rgba(212,175,55,0.28)' }
  },
  {
    id: 'E3',
    code: 'Edition III',
    name: 'Sapphire Velvet & Luminous Cyan',
    group: 'Dark & Midnight Series',
    desc: 'Rolls-Royce Power Systems deep midnight sapphire (#06152D) with luminous cyan (#38BDF8) and gold accents.',
    badge: 'SAPPHIRE',
    light: false,
    navDefault: 'ribbon',
    colors: { bg: '#06152D', surface: '#0B2144', primary: '#F8FAFC', accent: '#38BDF8', border: 'rgba(56,189,248,0.28)' }
  }
];

function isIdmsPage() {
  return /idms/i.test(location.pathname) || !!document.getElementById('menubar') || !!document.querySelector('.top .tsearch');
}

function getSavedState() {
  var web = 'default', idms = 'default', nav = 'auto';
  try {
    web  = localStorage.getItem(STORAGE_KEY_WEB)  || 'default';
    idms = localStorage.getItem(STORAGE_KEY_IDMS) || 'default';
    nav  = localStorage.getItem(STORAGE_KEY_NAV)  || 'auto';
  } catch (e) {}
  return { webTemplate: web, idmsTemplate: idms, idmsNavMode: nav };
}

function findTemplate(id) {
  for (var i = 0; i < TEMPLATES.length; i++) {
    if (TEMPLATES[i].id === id) return TEMPLATES[i];
  }
  return TEMPLATES[0];
}

function applyActiveTemplate() {
  var state = getSavedState();
  var onIdms = isIdmsPage();
  var activeId = onIdms ? state.idmsTemplate : state.webTemplate;
  var tpl = findTemplate(activeId);

  document.documentElement.setAttribute('data-et-screen', onIdms ? 'idms' : 'web');
  document.documentElement.setAttribute('data-et-template', tpl.id);

  if (tpl.id === 'default') {
    var oldStyle = document.getElementById('et-dynamic-template-css');
    if (oldStyle) oldStyle.textContent = '';
    document.documentElement.removeAttribute('data-et-navmode');
    return;
  }

  var navMode = state.idmsNavMode === 'auto' ? tpl.navDefault : state.idmsNavMode;
  document.documentElement.setAttribute('data-et-navmode', navMode);

  var c = tpl.colors;
  var isDark = !tpl.light;
  var isGoldFrame = (tpl.id === 'A4');
  var isCadGrid = (tpl.id === 'A5' || tpl.id === 'E2' || tpl.id === 'T2');
  var isNavySidebar = (navMode === 'navy-sidebar');

  var css = '';
  css += '@import url("https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;0,700;1,600&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap");\n';
  css += ':root {\n' +
    '  --paper: ' + c.bg + ' !important;\n' +
    '  --white: ' + c.surface + ' !important;\n' +
    '  --navy: ' + (isDark ? '#F8FAFC' : c.primary) + ' !important;\n' +
    '  --gold: ' + c.accent + ' !important;\n' +
    '  --line: ' + c.border + ' !important;\n' +
    '  --body: "Plus Jakarta Sans", "Work Sans", sans-serif !important;\n' +
    '}\n';

  if (isCadGrid) {
    css += 'body { background-image: linear-gradient(to right, rgba(10,34,70,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(10,34,70,0.04) 1px, transparent 1px) !important; background-size: 36px 36px !important; }\n';
  }

  if (!onIdms) {
    css +=
      'body { background: ' + c.bg + ' !important; color: ' + (isDark ? '#F1F5F9' : c.primary) + ' !important; }\n' +
      'header { background: ' + (isDark ? 'rgba(12,18,32,0.94)' : 'rgba(255,255,255,0.98)') + ' !important; border-bottom: 1px solid ' + c.border + ' !important; border-top: 4px solid ' + c.primary + ' !important; box-shadow: 0 4px 24px rgba(10,34,70,0.06) !important; }\n' +
      '.nav { max-width: 1440px !important; margin: 0 auto !important; padding: 10px 28px !important; display: flex !important; flex-wrap: nowrap !important; align-items: center !important; justify-content: space-between !important; gap: 18px !important; }\n' +
      '.nav-top { width: auto !important; flex: 0 0 auto !important; }\n' +
      '.nav-scroll { flex: 1 1 auto !important; width: auto !important; display: flex !important; justify-content: center !important; }\n' +
      'nav.links { flex-wrap: nowrap !important; gap: 4px !important; justify-content: center !important; overflow-x: auto !important; padding: 4px 0 !important; }\n' +
      'nav.links a { height: 36px !important; min-width: auto !important; padding: 0 13px !important; border-radius: 8px !important; background: transparent !important; border: 1px solid transparent !important; box-shadow: none !important; font-size: 13px !important; font-weight: 600 !important; color: ' + (isDark ? '#E2E8F0' : c.primary) + ' !important; }\n' +
      'nav.links a:hover { transform: translateY(-1px) !important; background: ' + (isDark ? 'rgba(255,255,255,0.08)' : '#F1F5F9') + ' !important; border-color: ' + c.border + ' !important; color: ' + c.accent + ' !important; box-shadow: none !important; }\n' +
      '.btn-gold, .nav-cta .btn { background: linear-gradient(180deg, #D9B14A 0%, #B8891E 100%) !important; color: #FFFFFF !important; border-radius: 10px !important; box-shadow: 0 4px 14px rgba(184,137,30,0.28) !important; font-weight: 700 !important; }\n' +
      'h1, .t-title { color: ' + (isDark ? '#FFFFFF' : c.primary) + ' !important; letter-spacing: -0.025em !important; ' + ((tpl.id === 'B' || tpl.id === 'A4' || tpl.id === 'E2') ? 'font-family: "Cormorant Garamond", Georgia, serif !important; font-weight: 700 !important;' : '') + ' }\n' +
      '.card, .job-item, .me-card { background: ' + c.surface + ' !important; border: ' + (isGoldFrame ? '1.5px solid #D9B14A' : '1px solid ' + c.border) + ' !important; border-radius: 16px !important; box-shadow: 0 2px 6px rgba(10,34,70,0.04), 0 16px 36px rgba(10,34,70,0.06) !important; }\n';
  }

  if (onIdms) {
    css +=
      'body { background: ' + c.bg + ' !important; color: ' + (isDark ? '#F1F5F9' : c.primary) + ' !important; }\n' +
      '.top { background: ' + (isDark ? '#0B111E' : '#FFFFFF') + ' !important; color: ' + (isDark ? '#FFFFFF' : c.primary) + ' !important; border-top: 4px solid ' + c.primary + ' !important; border-bottom: 1px solid ' + c.border + ' !important; padding: 10px 20px !important; box-shadow: 0 2px 14px rgba(10,34,70,0.05) !important; flex-wrap: nowrap !important; gap: 10px !important; overflow-x: auto !important; }\n' +
      '.top .id .co { color: ' + (isDark ? '#FFFFFF' : c.primary) + ' !important; font-size: 15.5px !important; }\n' +
      '.top .id .tag { color: ' + (isDark ? '#94A3B8' : '#64748B') + ' !important; opacity: 1 !important; }\n' +
      '.top .tdivider { background: ' + c.border + ' !important; }\n' +
      '.top .tsearch { width: 260px !important; }\n' +
      '.top .tsearch input { background: ' + (isDark ? 'rgba(255,255,255,0.07)' : '#F1F5F9') + ' !important; border: 1px solid ' + c.border + ' !important; color: ' + (isDark ? '#FFFFFF' : c.primary) + ' !important; border-radius: 9px !important; }\n' +
      '.top .tsearch input::placeholder { color: #64748B !important; }\n' +
      '.top .chip { background: ' + (isDark ? 'rgba(255,255,255,0.08)' : '#F8FAFC') + ' !important; border: 1px solid ' + c.border + ' !important; color: ' + (isDark ? '#E2E8F0' : c.primary) + ' !important; font-weight: 600 !important; white-space: nowrap !important; }\n' +
      '.top .chip.on { background: ' + (isDark ? 'rgba(16,185,129,0.15)' : '#ECFDF5') + ' !important; border-color: #A7F3D0 !important; color: #047857 !important; }\n' +
      '.top .who { background: ' + (isDark ? 'rgba(255,255,255,0.08)' : '#F1F5F9') + ' !important; border: 1px solid ' + c.border + ' !important; color: ' + (isDark ? '#FFFFFF' : c.primary) + ' !important; white-space: nowrap !important; }\n' +
      '.top .btn.ghost { background: #FFFFFF !important; color: ' + c.primary + ' !important; border: 1px solid ' + c.border + ' !important; border-radius: 9px !important; padding: 6px 14px !important; font-weight: 600 !important; white-space: nowrap !important; }\n' +
      '.top .btn.gold { background: linear-gradient(180deg, #D9B14A 0%, #B8891E 100%) !important; color: #FFFFFF !important; border: none !important; border-radius: 9px !important; padding: 6px 14px !important; font-weight: 700 !important; white-space: nowrap !important; }\n' +
      '.card, .stat .b, .cnc-machine, .bu-tile { background: ' + c.surface + ' !important; border: ' + (isGoldFrame ? '1.5px solid #D9B14A' : '1px solid ' + c.border) + ' !important; border-radius: 14px !important; box-shadow: 0 2px 6px rgba(10,34,70,0.04), 0 12px 28px rgba(10,34,70,0.05) !important; }\n';

    if (navMode === 'sidebar' || navMode === 'floating' || navMode === 'navy-sidebar') {
      var sbBg = isNavySidebar ? '#0A2246' : (isDark ? '#0F1420' : '#FFFFFF');
      var sbTxt = (isNavySidebar || isDark) ? '#F8FAFC' : c.primary;
      var sbHover = (isNavySidebar || isDark) ? 'rgba(255,255,255,0.1)' : '#F1F5F9';

      css +=
        '@media (min-width: 960px) {\n' +
        '  #app { display: grid !important; grid-template-columns: 245px minmax(0, 1fr) !important; grid-template-rows: auto 1fr !important; min-height: 100vh !important; }\n' +
        '  #chrome { grid-column: 1 / -1 !important; }\n' +
        '  #menubar { position: fixed !important; top: 63px !important; left: ' + (navMode === 'floating' ? '12px' : '0') + ' !important; bottom: ' + (navMode === 'floating' ? '12px' : '0') + ' !important; width: 240px !important; flex-direction: column !important; flex-wrap: nowrap !important; overflow-y: auto !important; background: ' + sbBg + ' !important; border-right: 1px solid ' + c.border + ' !important; ' + (navMode === 'floating' ? 'border-radius: 16px !important; border: 1px solid ' + c.border + ' !important; box-shadow: 0 12px 32px rgba(10,34,70,0.08) !important;' : '') + ' padding: 12px 10px !important; gap: 3px !important; z-index: 550 !important; }\n' +
        '  #menubar .mgroup { width: 100% !important; }\n' +
        '  #menubar .mgroup > a { width: 100% !important; justify-content: space-between !important; color: ' + sbTxt + ' !important; padding: 9px 12px !important; border-radius: 9px !important; font-size: 12.5px !important; }\n' +
        '  #menubar .mgroup > a:hover, #menubar .mgroup.open > a { background: ' + sbHover + ' !important; color: ' + ((isNavySidebar || isDark) ? '#D9B14A' : c.accent) + ' !important; }\n' +
        '  .app-body { grid-column: 2 / -1 !important; width: 100% !important; max-width: 100% !important; padding: 22px 28px 70px !important; }\n' +
        '  body.pipeline-focus #menubar { transform: translateX(-110%) !important; }\n' +
        '  body.pipeline-focus .app-body { grid-column: 1 / -1 !important; }\n' +
        '}\n';
    } else {
      css +=
        '#menubar { background: ' + (tpl.id === 'A3' ? '#0A2246' : c.surface) + ' !important; border-bottom: 2px solid ' + c.accent + ' !important; padding: 6px 18px !important; display: flex !important; flex-wrap: nowrap !important; overflow-x: auto !important; gap: 4px !important; }\n' +
        '#menubar .mgroup > a { white-space: nowrap !important; color: ' + (tpl.id === 'A3' ? '#FFFFFF' : c.primary) + ' !important; border-radius: 8px !important; padding: 7px 12px !important; }\n' +
        '#menubar .mgroup > a:hover, #menubar .mgroup.open > a { background: ' + (tpl.id === 'A3' ? '#D9B14A' : '#F1F5F9') + ' !important; color: ' + (tpl.id === 'A3' ? '#0A2246' : c.accent) + ' !important; }\n';
    }
  }

  injectStyle('et-dynamic-template-css', css);
}

function syncFromCloud() {
  fetch('/api/content')
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res && res.ok && res.data && res.data.screenTemplates) {
        var st = res.data.screenTemplates;
        var changed = false;
        try {
          if (st.webTemplate && localStorage.getItem(STORAGE_KEY_WEB) !== st.webTemplate) {
            localStorage.setItem(STORAGE_KEY_WEB, st.webTemplate);
            changed = true;
          }
          if (st.idmsTemplate && localStorage.getItem(STORAGE_KEY_IDMS) !== st.idmsTemplate) {
            localStorage.setItem(STORAGE_KEY_IDMS, st.idmsTemplate);
            changed = true;
          }
          if (st.idmsNavMode && localStorage.getItem(STORAGE_KEY_NAV) !== st.idmsNavMode) {
            localStorage.setItem(STORAGE_KEY_NAV, st.idmsNavMode);
            changed = true;
          }
        } catch (e) {}
        if (changed) applyActiveTemplate();
      }
    })
    .catch(function () {});
}

function saveTemplatesToCloud(webTpl, idmsTpl, navMode, statusEl) {
  try {
    localStorage.setItem(STORAGE_KEY_WEB, webTpl);
    localStorage.setItem(STORAGE_KEY_IDMS, idmsTpl);
    localStorage.setItem(STORAGE_KEY_NAV, navMode);
  } catch (e) {}
  applyActiveTemplate();

  if (statusEl) {
    statusEl.textContent = 'Saving to Neon Cloud Database…';
    statusEl.style.color = '#B8891E';
  }

  var token = null;
  try {
    token = sessionStorage.getItem('app_token') || localStorage.getItem('app_token');
  } catch (e) {}

  fetch('/api/content')
    .then(function (r) { return r.json(); })
    .then(function (res) {
      var payload = (res && res.data) ? res.data : {};
      payload.screenTemplates = {
        webTemplate: webTpl,
        idmsTemplate: idmsTpl,
        idmsNavMode: navMode,
        updatedAt: new Date().toISOString()
      };
      return fetch('/api/content', {
        method: 'POST',
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          token ? { 'Authorization': 'Bearer ' + token, 'x-auth-token': token } : {}
        ),
        body: JSON.stringify(payload)
      });
    })
    .then(function (r) {
      if (statusEl) {
        statusEl.textContent = r.ok
          ? '✓ Saved Globally! Website (' + webTpl + ') & IDMS (' + idmsTpl + ') are now live.'
          : '✓ Applied locally in browser (Sign in as Admin to sync to server).';
        statusEl.style.color = '#059669';
      }
    })
    .catch(function () {
      if (statusEl) {
        statusEl.textContent = '✓ Saved & active on this browser!';
        statusEl.style.color = '#059669';
      }
    });
}

function openDeveloperTemplateStudio() {
  var modal = document.getElementById('et-dev-template-modal');
  if (!modal) {
    injectStyle('et-dev-studio-css',
      '#et-dev-template-modal{position:fixed;inset:0;z-index:99990;background:rgba(10,34,70,0.62);backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;padding:20px;font-family:"Plus Jakarta Sans",system-ui,sans-serif;}' +
      '#et-dev-template-modal.open{display:flex;}' +
      '.et-studio-box{background:#FFFFFF;color:#0A2246;width:100%;max-width:1160px;max-height:90vh;border-radius:20px;border:1px solid #CBD5E1;box-shadow:0 25px 70px rgba(10,34,70,0.35);display:flex;flex-direction:column;overflow:hidden;}' +
      '.et-studio-head{background:linear-gradient(135deg,#0A2246,#123870);color:#FFFFFF;padding:18px 24px;display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #D9B14A;}' +
      '.et-studio-body{padding:22px 24px;overflow-y:auto;display:grid;grid-template-columns:1fr 1fr;gap:22px;background:#F8FAFC;}' +
      '@media(max-width:860px){.et-studio-body{grid-template-columns:1fr;}}' +
      '.et-studio-col{background:#FFFFFF;border:1px solid #E2E8F0;border-radius:16px;padding:18px;box-shadow:0 4px 14px rgba(10,34,70,0.04);}' +
      '.et-tpl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:10px;margin-top:12px;max-height:420px;overflow-y:auto;padding-right:4px;}' +
      '.et-tpl-card{border:1.5px solid #E2E8F0;border-radius:12px;padding:11px 12px;cursor:pointer;background:#FFFFFF;text-align:left;transition:.16s;}' +
      '.et-tpl-card:hover{border-color:#B8891E;transform:translateY(-1px);}' +
      '.et-tpl-card.active{border:2px solid #0A2246;background:#FEFCE8;box-shadow:0 4px 12px rgba(184,137,30,0.15);}' +
      '.et-studio-foot{background:#FFFFFF;border-top:1px solid #E2E8F0;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;}'
    );

    modal = document.createElement('div');
    modal.id = 'et-dev-template-modal';
    document.body.appendChild(modal);
  }

  var state = getSavedState();
  var selectedWeb = state.webTemplate;
  var selectedIdms = state.idmsTemplate;
  var selectedNav = state.idmsNavMode;

  function renderModalContent() {
    modal.innerHTML =
      '<div class="et-studio-box">' +
        '<div class="et-studio-head">' +
          '<div>' +
            '<div style="font-family:monospace;font-size:11px;letter-spacing:.16em;color:#D9B14A;text-transform:uppercase;font-weight:700;">Developer Admin • Multi-Template Control Engine</div>' +
            '<h3 style="margin:3px 0 0;font-size:19px;font-weight:800;color:#fff;">🎨 Screen Design &amp; Template Switcher (Website &amp; IDMS Independently)</h3>' +
          '</div>' +
          '<button type="button" id="et-studio-close" style="background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.25);color:#fff;width:34px;height:34px;border-radius:50%;font-size:16px;cursor:pointer;">✕</button>' +
        '</div>' +

        '<div class="et-studio-body">' +
          '<div class="et-studio-col">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;">' +
              '<div>' +
                '<span style="font-family:monospace;font-size:10.5px;color:#B8891E;font-weight:700;text-transform:uppercase;">01 / Public Website</span>' +
                '<h4 style="margin:2px 0 0;font-size:16px;font-weight:800;color:#0A2246;">🌐 www.elixirtec.com Template</h4>' +
              '</div>' +
              '<span style="padding:4px 10px;border-radius:99px;background:#EFF6FF;color:#0A2246;font-size:11px;font-weight:700;">Active: ' + selectedWeb + '</span>' +
            '</div>' +
            '<p style="font-size:12px;color:#64748B;margin:6px 0 10px;">Select the design template visitors see on <b>www.elixirtec.com</b> without affecting IDMS.</p>' +
            '<div class="et-tpl-grid">' +
              TEMPLATES.map(function (t) {
                var on = (t.id === selectedWeb);
                return '<div class="et-tpl-card ' + (on ? 'active' : '') + '" data-target="web" data-id="' + t.id + '">' +
                  '<div style="display:flex;justify-content:space-between;align-items:center;">' +
                    '<b style="font-size:12px;color:#0A2246;">' + t.code + '</b>' +
                    '<span style="font-family:monospace;font-size:9.5px;padding:1px 6px;border-radius:6px;background:' + (on ? '#0A2246' : '#F1F5F9') + ';color:' + (on ? '#D9B14A' : '#64748B') + ';font-weight:700;">' + t.badge + '</span>' +
                  '</div>' +
                  '<div style="font-size:12.5px;font-weight:700;color:#0A2246;margin-top:4px;">' + t.name + '</div>' +
                  '<div style="font-size:11px;color:#64748B;margin-top:3px;line-height:1.35;">' + t.desc + '</div>' +
                '</div>';
              }).join('') +
            '</div>' +
          '</div>' +

          '<div class="et-studio-col">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;">' +
              '<div>' +
                '<span style="font-family:monospace;font-size:10.5px;color:#B8891E;font-weight:700;text-transform:uppercase;">02 / IDMS Enterprise Portal</span>' +
                '<h4 style="margin:2px 0 0;font-size:16px;font-weight:800;color:#0A2246;">🏭 www.elixirtec.com/idms.html Template</h4>' +
              '</div>' +
              '<span style="padding:4px 10px;border-radius:99px;background:#FEF3C7;color:#9A6F0B;font-size:11px;font-weight:700;">Active: ' + selectedIdms + '</span>' +
            '</div>' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:6px 0 10px;padding:7px 10px;background:#F8FAFC;border-radius:8px;border:1px solid #E2E8F0;">' +
              '<span style="font-size:11.5px;font-weight:600;color:#0A2246;">17-Module Menu Layout:</span>' +
              '<select id="et-navmode-select" style="padding:4px 8px;border-radius:6px;border:1px solid #CBD5E1;font-size:11.5px;font-weight:600;color:#0A2246;">' +
                '<option value="auto" ' + (selectedNav === 'auto' ? 'selected' : '') + '>Auto (Match Template Default)</option>' +
                '<option value="sidebar" ' + (selectedNav === 'sidebar' ? 'selected' : '') + '>Docked White Left Sidebar (17 Modules)</option>' +
                '<option value="ribbon" ' + (selectedNav === 'ribbon' ? 'selected' : '') + '>Full-Width Single-Row Top Ribbon</option>' +
                '<option value="floating" ' + (selectedNav === 'floating' ? 'selected' : '') + '>Detached Floating Left Card Dock</option>' +
                '<option value="navy-sidebar" ' + (selectedNav === 'navy-sidebar' ? 'selected' : '') + '>Royal Navy Left Sidebar Drawer</option>' +
              '</select>' +
            '</div>' +
            '<div class="et-tpl-grid">' +
              TEMPLATES.map(function (t) {
                var on = (t.id === selectedIdms);
                return '<div class="et-tpl-card ' + (on ? 'active' : '') + '" data-target="idms" data-id="' + t.id + '">' +
                  '<div style="display:flex;justify-content:space-between;align-items:center;">' +
                    '<b style="font-size:12px;color:#0A2246;">' + t.code + '</b>' +
                    '<span style="font-family:monospace;font-size:9.5px;padding:1px 6px;border-radius:6px;background:' + (on ? '#0A2246' : '#F1F5F9') + ';color:' + (on ? '#D9B14A' : '#64748B') + ';font-weight:700;">' + t.badge + '</span>' +
                  '</div>' +
                  '<div style="font-size:12.5px;font-weight:700;color:#0A2246;margin-top:4px;">' + t.name + '</div>' +
                  '<div style="font-size:11px;color:#64748B;margin-top:3px;line-height:1.35;">' + t.desc + '</div>' +
                '</div>';
              }).join('') +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="et-studio-foot">' +
          '<div id="et-studio-status" style="font-size:12.5px;font-weight:600;color:#475569;">Click any template card above to preview live, then press Save &amp; Publish.</div>' +
          '<div style="display:flex;gap:10px;">' +
            '<a href="/" target="_blank" style="padding:10px 16px;border-radius:10px;border:1px solid #CBD5E1;background:#fff;color:#0A2246;font-size:12.5px;font-weight:700;text-decoration:none;">↗ Preview Website</a>' +
            '<button type="button" id="et-studio-save" style="padding:10px 22px;border-radius:10px;border:none;background:linear-gradient(180deg,#D9B14A,#B8891E);color:#fff;font-size:12.5px;font-weight:800;cursor:pointer;box-shadow:0 4px 14px rgba(184,137,30,0.3);">💾 Save &amp; Publish Both Templates</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    modal.querySelector('#et-studio-close').addEventListener('click', function () {
      modal.classList.remove('open');
    });

    modal.querySelector('#et-navmode-select').addEventListener('change', function (e) {
      selectedNav = e.target.value;
      try { localStorage.setItem(STORAGE_KEY_NAV, selectedNav); } catch (err) {}
      applyActiveTemplate();
    });

    modal.querySelectorAll('.et-tpl-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var target = card.getAttribute('data-target');
        var id = card.getAttribute('data-id');
        if (target === 'web') {
          selectedWeb = id;
          try { localStorage.setItem(STORAGE_KEY_WEB, selectedWeb); } catch (e) {}
        } else {
          selectedIdms = id;
          try { localStorage.setItem(STORAGE_KEY_IDMS, selectedIdms); } catch (e) {}
        }
        applyActiveTemplate();
        renderModalContent();
      });
    });

    modal.querySelector('#et-studio-save').addEventListener('click', function () {
      var statusEl = modal.querySelector('#et-studio-status');
      saveTemplatesToCloud(selectedWeb, selectedIdms, selectedNav, statusEl);
    });
  }

  renderModalContent();
  modal.classList.add('open');
}

function attachDeveloperAdminControls() {
  if (!isIdmsPage()) return;

  var themesWrap = document.getElementById('t-themes');
  if (themesWrap && !document.getElementById('t-dev-templates-btn')) {
    var btn = document.createElement('button');
    btn.id = 't-dev-templates-btn';
    btn.className = 'chip';
    btn.type = 'button';
    btn.title = 'Developer Admin: Switch Website & IDMS Screen Design Templates';
    btn.style.cssText = 'cursor:pointer;font-family:inherit;background:linear-gradient(180deg,#D9B14A,#B8891E);color:#fff;border:none;font-weight:700;';
    btn.innerHTML = '🎨 Screen Templates';
    btn.addEventListener('click', openDeveloperTemplateStudio);
    themesWrap.parentNode.insertBefore(btn, themesWrap.nextSibling);
  }

  var menubar = document.getElementById('menubar');
  if (menubar) {
    var groups = menubar.querySelectorAll('.mgroup');
    groups.forEach(function (g) {
      var label = (g.querySelector('a') || {}).textContent || '';
      if (/Developer Admin|Admin/i.test(label)) {
        var drop = g.querySelector('.drop');
        if (drop && !drop.querySelector('.et-dev-tpl-link')) {
          var item = document.createElement('a');
          item.className = 'et-dev-tpl-link';
          item.style.cssText = 'font-weight:700;color:#B8891E;border-bottom:1px solid rgba(10,34,70,0.08);margin-bottom:4px;';
          item.innerHTML = '<span>🎨 Screen Design &amp; Templates (Web + IDMS)</span><span class="soon" style="background:#FEF3C7;color:#9A6F0B;border-color:#FDE68A;">12 SUITES</span>';
          item.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            g.classList.remove('open');
            openDeveloperTemplateStudio();
          });
          drop.insertBefore(item, drop.firstChild);
        }
      }
    });
  }
}

/* Both are page furniture: they belong to every screen, so they are put up
   once when the document is ready rather than by each screen that wants them. */
function installChrome() {
  aiEnsure();
  scrollDock();
  applyActiveTemplate();
  syncFromCloud();
  attachDeveloperAdminControls();
  setInterval(attachDeveloperAdminControls, 1500);
}
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', installChrome);
else installChrome();

  window.PageChrome = {
    aiBusy: { start: aiStart, end: aiEnd, count: function () { return aiJobs.length; } },
    openTemplateStudio: openDeveloperTemplateStudio
  };
})();
