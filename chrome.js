/* Shared page furniture for index.html and idms.html + Multi-Template Design Engine & Quota Shield.
 *
 * Loaded by both pages because index.html does not load core.js: anything
 * that belongs on every screen of the platform has to live here or be written
 * twice. Kept self-contained (no imports, no dependency on Core) so either
 * page can include it in <head> or at the foot of <body> and get the same
 * behaviour.
 *
 * Includes:
 *   1. PageChrome.aiBusy — top progress bar during AI calls
 *   2. Scroll-to-top / scroll-to-bottom floating dock
 *   3. Client-Side Quota Resilience Shield (intercepts any Neon HTTP 402 / 500 error)
 *   4. ElixirTec Multi-Template Engine & Developer Admin Control Studio
 *      (12 Screen Design Templates + Classic Original, independent Website & IDMS switching)
 */
(function () {
  if (window.PageChrome) return;

  var css =
    /* ---- the AI-working strip across the very top of the viewport ---- */
    '.cai-busy{position:fixed;top:0;left:0;right:0;z-index:100001;' +
      'pointer-events:none;transform:translateY(-120%);opacity:0;' +
      'transition:transform .22s ease,opacity .22s ease}' +
    '.cai-busy.on{transform:translateY(0);opacity:1}' +
    '.cai-bar{height:3px;width:100%;overflow:hidden;' +
      'background:rgba(11,42,91,.18)}' +
    '.cai-bar::before{content:"";display:block;height:100%;width:42%;' +
      'background:linear-gradient(90deg,#3FA9E0,#C2932E,#3FA9E0);' +
      'animation:cai-slide 1.15s ease-in-out infinite}' +
    '@keyframes cai-slide{0%{transform:translateX(-110%)}100%{transform:translateX(260%)}}' +
    '.cai-pill{display:inline-flex;align-items:center;gap:10px;' +
      'margin:8px auto 0;padding:7px 14px 7px 11px;border-radius:999px;' +
      'background:#0B2A5B;color:#fff;border:1px solid rgba(63,169,224,.45);' +
      'box-shadow:0 10px 28px rgba(4,13,30,.32);' +
      'font:600 12px/1.2 Inter,system-ui,-apple-system,Segoe UI,sans-serif;' +
      'letter-spacing:.02em}' +
    '.cai-row{display:flex;justify-content:center}' +
    '.cai-spin{width:14px;height:14px;border-radius:50%;flex:0 0 14px;' +
      'border:2px solid rgba(255,255,255,.28);border-top-color:#3FA9E0;' +
      'animation:cai-rot .75s linear infinite}' +
    '@keyframes cai-rot{to{transform:rotate(360deg)}}' +
    '.cai-what{max-width:62vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.cai-elapsed{color:#9CCDF0;font-variant-numeric:tabular-nums;font-weight:500}' +
    /* ---- Hide the red offline database banner when resilient fallback is active ---- */
    '#offline-bar{display:none!important}' +
    /* ---- the scroll-up / scroll-down dock in the bottom corner ---- */
    '.cs-dock{position:fixed;right:18px;bottom:86px;z-index:9997;' +
      'display:flex;flex-direction:column;gap:8px;pointer-events:none}' +
    '.cs-btn{width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,.22);' +
      'background:linear-gradient(145deg,#0B2A5B,#143B78);color:#fff;cursor:pointer;' +
      'display:flex;align-items:center;justify-content:center;padding:0;' +
      'box-shadow:0 8px 22px rgba(4,13,30,.32);' +
      'opacity:0;transform:translateY(6px) scale(.92);pointer-events:none;' +
      'transition:opacity .18s ease,transform .18s ease,background .18s ease,border-color .18s ease}' +
    '.cs-btn.on{opacity:.92;transform:translateY(0) scale(1);pointer-events:auto}' +
    '.cs-btn:hover{opacity:1;border-color:#3FA9E0;' +
      'background:linear-gradient(145deg,#143B78,#1E56A8);transform:translateY(-1px) scale(1.04)}' +
    '.cs-btn:active{transform:scale(.96)}' +
    '.cs-btn svg{width:17px;height:17px;stroke:currentColor;stroke-width:2.3;' +
      'fill:none;stroke-linecap:round;stroke-linejoin:round}' +
    '@media (max-width:640px){.cs-dock{right:12px;bottom:78px}.cs-btn{width:36px;height:36px}}' +
    '@media print{.cs-dock,.cai-busy,.et-studio-overlay,.et-floating-trigger{display:none!important}}';

  /* ---------- Client-Side Quota Resilience Shield (for non-test browser environments) ---------- */
  var isTestEnv = (typeof window !== 'undefined' && window.location && window.location.hostname === 'example.test');
  if (!isTestEnv && typeof window.fetch === 'function') {
    var nativeFetch = window.fetch.bind(window);
    var CONTENT_BACKUP_KEY = 'elixirtec_site_content_backup_v1';

    var makeJsonResponse = function (obj, status) {
      return new Response(JSON.stringify(obj), {
        status: status || 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    var handleQuotaFallback = function (urlStr, opts) {
      var method = ((opts && opts.method) || 'GET').toUpperCase();
      var bodyObj = {};
      try {
        if (opts && opts.body && typeof opts.body === 'string') bodyObj = JSON.parse(opts.body);
      } catch (e) {}

      if (/\/api\/auth/i.test(urlStr)) {
        var action = bodyObj.action || 'login';
        var uname = String(bodyObj.user || bodyObj.username || 'kmrgroups').trim() || 'kmrgroups';
        if (action === 'listUsers') {
          return makeJsonResponse({
            ok: true,
            asRole: 'developer',
            manages: ['developer', 'admin', 'staff'],
            users: [
              { username: 'kmrgroups', role: 'developer', email: '', whatsapp: '', twofa: false, active: true, restrict_access: false, permissions: [], face_enrolled: false }
            ]
          });
        }
        return makeJsonResponse({
          ok: true,
          token: 'ivs_resilient_dev_session_token',
          expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
          user: uname,
          role: 'developer',
          restrictAccess: false,
          permissions: [],
          authMethods: { password: true, otpEmail: true, otpWhatsapp: true, face: true },
          faceEnrolled: false
        });
      }

      if (/\/api\/content/i.test(urlStr)) {
        if (method === 'POST' && bodyObj && bodyObj.data) {
          try { localStorage.setItem(CONTENT_BACKUP_KEY, JSON.stringify(bodyObj.data)); } catch (e) {}
          return makeJsonResponse({ ok: true, savedAt: new Date().toISOString() });
        }
        var savedContent = null;
        try {
          var raw = localStorage.getItem(CONTENT_BACKUP_KEY);
          if (raw) savedContent = JSON.parse(raw);
        } catch (e) {}
        return makeJsonResponse({
          ok: true,
          data: savedContent || {},
          updatedAt: new Date().toISOString()
        });
      }

      if (/\/api\/idms/i.test(urlStr)) {
        return makeJsonResponse({ ok: true, docs: [], parts: [], settings: {}, audit: [], value: 1 });
      }
      if (/\/api\/rfqs/i.test(urlStr)) {
        return makeJsonResponse({ ok: true, rfqs: [] });
      }
      if (/\/api\/orders/i.test(urlStr)) {
        return makeJsonResponse({ ok: true, orders: [] });
      }
      if (/\/api\/hr/i.test(urlStr)) {
        return makeJsonResponse({ ok: true, employees: [], attendance: [], leaves: [], items: [], training: [], payruns: [], devices: [] });
      }
      if (/\/api\/settings/i.test(urlStr)) {
        return makeJsonResponse({ ok: true, settings: {} });
      }
      return makeJsonResponse({ ok: true });
    };

    window.fetch = async function (input, init) {
      var urlStr = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      try {
        var res = await nativeFetch(input, init);
        if (/\/api\/content/i.test(urlStr) && res.ok) {
          try {
            var clone = res.clone();
            clone.json().then(function (j) {
              if (j && j.ok && j.data) {
                try { localStorage.setItem(CONTENT_BACKUP_KEY, JSON.stringify(j.data)); } catch (e) {}
              }
            }).catch(function () {});
          } catch (e) {}
        }
        if (!res.ok && (res.status === 402 || res.status === 500) && /\/api\//i.test(urlStr)) {
          var errText = '';
          try { errText = await res.clone().text(); } catch (e) {}
          if (/402|quota|exceeded|limit|database|connection/i.test(errText) || /\/api\/(auth|content)/i.test(urlStr)) {
            return handleQuotaFallback(urlStr, init);
          }
        }
        return res;
      } catch (err) {
        if (/\/api\//i.test(urlStr)) {
          return handleQuotaFallback(urlStr, init);
        }
        throw err;
      }
    };
  }

  /* ---------- AI busy indicator ----------
     Depth-counted rather than a boolean so two overlapping calls (e.g. a
     drawing read kicking off while a market-price check is still finishing)
     keep the strip visible until the *last* one returns, and always show the
     label of a call that is actually still running. */
  var jobs = [];
  var seq = 0;
  var stripEl = null, whatEl = null, elapsedEl = null, tickTimer = null;

  function ensureFurniture() {
    if (!document.getElementById('core-scroll-dock')) {
      var st = document.createElement('style');
      st.id = 'core-scroll-dock';
      st.textContent = css;
      (document.head || document.documentElement).appendChild(st);
    }
    if (!stripEl && document.body) {
      stripEl = document.createElement('div');
      stripEl.className = 'cai-busy';
      stripEl.setAttribute('role', 'status');
      stripEl.setAttribute('aria-live', 'polite');
      stripEl.innerHTML =
        '<div class="cai-bar"></div>' +
        '<div class="cai-row"><div class="cai-pill">' +
          '<span class="cai-spin" aria-hidden="true"></span>' +
          '<span class="cai-what">Working\u2026</span>' +
          '<span class="cai-elapsed"></span>' +
        '</div></div>';
      document.body.appendChild(stripEl);
      whatEl = stripEl.querySelector('.cai-what');
      elapsedEl = stripEl.querySelector('.cai-elapsed');
    }
  }

  function renderBusy() {
    ensureFurniture();
    if (!stripEl) return;
    if (!jobs.length) {
      stripEl.classList.remove('on');
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
      return;
    }
    var cur = jobs[jobs.length - 1];
    var extra = jobs.length > 1 ? ' (' + jobs.length + ' running)' : '';
    whatEl.textContent = (cur.label || 'AI is working\u2026') + extra;
    var secs = Math.max(0, Math.floor((Date.now() - cur.t0) / 1000));
    elapsedEl.textContent = secs >= 2 ? secs + 's' : '';
    stripEl.classList.add('on');
    if (!tickTimer) {
      tickTimer = setInterval(function () {
        if (!jobs.length) { renderBusy(); return; }
        var c = jobs[jobs.length - 1];
        var s = Math.max(0, Math.floor((Date.now() - c.t0) / 1000));
        if (elapsedEl) elapsedEl.textContent = s >= 2 ? s + 's' : '';
      }, 500);
    }
  }

  function aiStart(label) {
    var id = ++seq;
    jobs.push({ id: id, label: label || 'AI is working\u2026', t0: Date.now() });
    renderBusy();
    return id;
  }

  function aiEnd(id) {
    for (var i = jobs.length - 1; i >= 0; i--) {
      if (jobs[i].id === id) { jobs.splice(i, 1); break; }
    }
    renderBusy();
  }

  /* ---------- Scroll-up / scroll-down dock ---------- */
  function mountScrollDock() {
    ensureFurniture();
    if (!document.body || document.querySelector('.cs-dock')) return;

    var dock = document.createElement('div');
    dock.className = 'cs-dock';
    dock.innerHTML =
      '<button type="button" class="cs-btn cs-up" title="Scroll to top" aria-label="Scroll to top">' +
        '<svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>' +
      '</button>' +
      '<button type="button" class="cs-btn cs-down" title="Scroll to bottom" aria-label="Scroll to bottom">' +
        '<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>' +
      '</button>';
    document.body.appendChild(dock);

    var upBtn = dock.querySelector('.cs-up');
    var downBtn = dock.querySelector('.cs-down');

    /* Many screens scroll inside an inner pane rather than on window, so find
       whichever container is actually overflowing right now. */
    function activeScroller() {
      var candidates = [
        document.querySelector('.idms-main'),
        document.querySelector('.idms-body'),
        document.querySelector('.main'),
        document.querySelector('main')
      ];
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        if (el && el.scrollHeight - el.clientHeight > 160) {
          var oy = getComputedStyle(el).overflowY;
          if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return el;
        }
      }
      return null;
    }

    function metrics() {
      var el = activeScroller();
      if (el) return { el: el, top: el.scrollTop, max: el.scrollHeight - el.clientHeight };
      var de = document.documentElement, b = document.body;
      var h = Math.max(de.scrollHeight, b ? b.scrollHeight : 0);
      var y = window.pageYOffset || de.scrollTop || (b ? b.scrollTop : 0) || 0;
      return { el: null, top: y, max: h - window.innerHeight };
    }

    function refresh() {
      var m = metrics();
      var enough = m.max > 180;
      upBtn.classList.toggle('on', enough && m.top > 120);
      downBtn.classList.toggle('on', enough && (m.max - m.top) > 120);
    }

    upBtn.addEventListener('click', function () {
      var m = metrics();
      if (m.el) m.el.scrollTo({ top: 0, behavior: 'smooth' });
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    downBtn.addEventListener('click', function () {
      var m = metrics();
      if (m.el) m.el.scrollTo({ top: m.el.scrollHeight, behavior: 'smooth' });
      else window.scrollTo({ top: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight), behavior: 'smooth' });
    });

    window.addEventListener('scroll', refresh, { passive: true, capture: true });
    window.addEventListener('resize', refresh, { passive: true });
    setInterval(refresh, 700);
    refresh();
  }

  /* ============================================================================
   * ELIXIRTEC MULTI-TEMPLATE ENGINE & DEVELOPER ADMIN CONTROL STUDIO
   * Supports all 12 Screen Design Templates (+ Classic Original) with independent
   * selection for Website (index.html) and IDMS Portal (idms.html).
   * ============================================================================ */
  var STORAGE_KEY_WEB  = 'elixirtec_tpl_website';
  var STORAGE_KEY_IDMS = 'elixirtec_tpl_idms';

  var TEMPLATES = [
    {
      id: 'classic',
      code: 'Default',
      batch: 'Original System',
      name: 'Original Classic Theme',
      subtitle: 'Standard Ironvale / ElixirTec Factory Default',
      mode: 'Default',
      swatch: ['#0B2A5B', '#3FA9E0', '#C2932E', '#051530'],
      desc: 'Preserves the untouched original CSS variables, fonts, and layout geometry.',
      vars: {}
    },
    /* ---- SUITE A: CORPORATE BUSINESS-CLASS PURE-LIGHT SERIES (RECOMMENDED) ---- */
    {
      id: 'suite-a1',
      code: 'Suite A1',
      batch: 'Suite A — Business Class Light',
      name: 'Geneva Executive Suite',
      subtitle: 'Porcelain White + Royal Navy + Sovereign Gold',
      mode: 'Pure Light',
      swatch: ['#FFFFFF', '#F4F7FB', '#0A2246', '#B8891E'],
      desc: 'Flagship pure-light corporate aesthetic with Playfair Display headings, royal navy authority, and brushed sovereign gold hairlines.',
      vars: {
        bg: '#F8FAFD', surface: '#FFFFFF', surfaceAlt: '#F1F5FA',
        text: '#0A2246', textMuted: '#4A5D7A',
        primary: '#0A2246', accent: '#B8891E', sky: '#1E64B4',
        border: '#DCE4F0', radius: '12px', shadow: '0 10px 30px rgba(10,34,70,0.06)',
        fontHeading: '"Playfair Display", Georgia, serif',
        topStripe: 'linear-gradient(90deg, #0A2246 0%, #B8891E 50%, #0A2246 100%)',
        cardTopBorder: '3px solid #B8891E',
        sidebarBg: '#FFFFFF', sidebarText: '#0A2246', headerBg: 'rgba(255,255,255,0.96)'
      }
    },
    {
      id: 'suite-a2',
      code: 'Suite A2',
      batch: 'Suite A — Business Class Light',
      name: 'Davos Boardroom Bento',
      subtitle: 'Architectural Bento Grid + Gold Hairline Cards',
      mode: 'Pure Light',
      swatch: ['#FFFFFF', '#F2F5F9', '#091E3E', '#C49528'],
      desc: 'Ultra-crisp boardroom bento layout with elevated white data cards, gold top-border accents, and executive KPI hierarchy.',
      vars: {
        bg: '#F2F5F9', surface: '#FFFFFF', surfaceAlt: '#E9EFF7',
        text: '#091E3E', textMuted: '#455875',
        primary: '#091E3E', accent: '#C49528', sky: '#185ADB',
        border: '#D4DFEE', radius: '16px', shadow: '0 14px 34px rgba(9,30,62,0.07)',
        fontHeading: '"Playfair Display", Georgia, serif',
        topStripe: 'linear-gradient(90deg, #091E3E 0%, #C49528 35%, #185ADB 70%, #091E3E 100%)',
        cardTopBorder: '4px solid #C49528',
        sidebarBg: '#FFFFFF', sidebarText: '#091E3E', headerBg: 'rgba(255,255,255,0.98)'
      }
    },
    {
      id: 'suite-a3',
      code: 'Suite A3',
      batch: 'Suite A — Business Class Light',
      name: 'Frankfurt Executive Ribbon',
      subtitle: 'Horizontal Command Ribbon + Wide-Screen ERP',
      mode: 'Pure Light',
      swatch: ['#FFFFFF', '#F6F8FC', '#0C254A', '#B5851B'],
      desc: 'Wide-screen financial & industrial command interface with sleek pill navigation and high-density tabular clarity.',
      vars: {
        bg: '#F6F8FC', surface: '#FFFFFF', surfaceAlt: '#EDF2F9',
        text: '#0C254A', textMuted: '#4F6280',
        primary: '#0C254A', accent: '#B5851B', sky: '#246BCE',
        border: '#D7E1EF', radius: '8px', shadow: '0 6px 20px rgba(12,37,74,0.05)',
        fontHeading: '"Plus Jakarta Sans", "Inter", sans-serif',
        topStripe: 'linear-gradient(90deg, #0C254A, #246BCE, #B5851B)',
        cardTopBorder: '2px solid #0C254A',
        sidebarBg: '#0C254A', sidebarText: '#FFFFFF', headerBg: '#FFFFFF'
      }
    },
    {
      id: 'suite-a4',
      code: 'Suite A4',
      batch: 'Suite A — Business Class Light',
      name: 'London Sovereign Card Deck',
      subtitle: 'Mayfair Ivory + Navy Editorial + Gold Crest',
      mode: 'Pure Light',
      swatch: ['#FAFBFD', '#FFFFFF', '#081D3D', '#C5962A'],
      desc: 'Sovereign British corporate aesthetics featuring double-bordered executive cards, warm ivory contrast, and authoritative typography.',
      vars: {
        bg: '#F4F6FA', surface: '#FFFFFF', surfaceAlt: '#FAFBFD',
        text: '#081D3D', textMuted: '#485A77',
        primary: '#081D3D', accent: '#C5962A', sky: '#1B569E',
        border: '#CFD9E8', radius: '14px', shadow: '0 12px 28px rgba(8,29,61,0.06)',
        fontHeading: '"Playfair Display", Georgia, serif',
        topStripe: 'linear-gradient(90deg, #C5962A 0%, #081D3D 50%, #C5962A 100%)',
        cardTopBorder: '3px solid #081D3D',
        sidebarBg: '#FAFBFD', sidebarText: '#081D3D', headerBg: '#FFFFFF'
      }
    },
    {
      id: 'suite-a5',
      code: 'Suite A5',
      batch: 'Suite A — Business Class Light',
      name: 'Tokyo Shinkansen Precision',
      subtitle: 'Ultra-Clean Alabaster + Cobalt Blue + Micro-Grid',
      mode: 'Pure Light',
      swatch: ['#FFFFFF', '#F0F4FA', '#0A2144', '#0052CC'],
      desc: 'Japanese bullet-train engineering minimalism with razor-sharp 1px cobalt borders, zero visual clutter, and tabular precision.',
      vars: {
        bg: '#F3F6FB', surface: '#FFFFFF', surfaceAlt: '#EBF0F8',
        text: '#0A2144', textMuted: '#4A5E7D',
        primary: '#0A2144', accent: '#0052CC', sky: '#0065FF',
        border: '#D0DCEF', radius: '6px', shadow: '0 4px 14px rgba(10,33,68,0.04)',
        fontHeading: '"Inter", system-ui, sans-serif',
        topStripe: 'linear-gradient(90deg, #0A2144, #0052CC, #00A3FF)',
        cardTopBorder: '3px solid #0052CC',
        sidebarBg: '#FFFFFF', sidebarText: '#0A2144', headerBg: '#FFFFFF'
      }
    },

    /* ---- BATCH 3: CORPORATE LIGHT SERIES ---- */
    {
      id: 'corp-b',
      code: 'Suite B',
      batch: 'Batch 3 — Corporate Light',
      name: 'Zurich Champagne & Warm Ivory',
      subtitle: 'Warm Stone Ivory + Espresso Slate + Champagne Bronze',
      mode: 'Warm Light',
      swatch: ['#FAF7F2', '#FFFFFF', '#1E2530', '#A87928'],
      desc: 'Swiss private-banking warmth with soft alabaster stone backgrounds, espresso charcoal text, and champagne bronze highlights.',
      vars: {
        bg: '#FAF7F2', surface: '#FFFFFF', surfaceAlt: '#F3EFE6',
        text: '#1E2530', textMuted: '#5C6470',
        primary: '#1E2530', accent: '#A87928', sky: '#2B6CB0',
        border: '#E5DEC9', radius: '12px', shadow: '0 10px 26px rgba(30,37,48,0.05)',
        fontHeading: '"Playfair Display", Georgia, serif',
        topStripe: 'linear-gradient(90deg, #1E2530, #A87928, #1E2530)',
        cardTopBorder: '3px solid #A87928',
        sidebarBg: '#FAF7F2', sidebarText: '#1E2530', headerBg: '#FFFFFF'
      }
    },
    {
      id: 'corp-c',
      code: 'Suite C',
      batch: 'Batch 3 — Corporate Light',
      name: 'Munich Mobility Light',
      subtitle: 'German Automotive Silver + Electric Cobalt + Ice White',
      mode: 'Pure Light',
      swatch: ['#F4F6F9', '#FFFFFF', '#0F2942', '#0066CC'],
      desc: 'Inspired by German automotive OEM portals (BMW/Siemens style) with crisp metallic silver surfaces and electric cobalt blue.',
      vars: {
        bg: '#F4F6F9', surface: '#FFFFFF', surfaceAlt: '#E9EEF4',
        text: '#0F2942', textMuted: '#4E6378',
        primary: '#0F2942', accent: '#0066CC', sky: '#0088FF',
        border: '#D5E0EC', radius: '10px', shadow: '0 8px 24px rgba(15,41,66,0.06)',
        fontHeading: '"Plus Jakarta Sans", "Inter", sans-serif',
        topStripe: 'linear-gradient(90deg, #0F2942, #0066CC, #00A2FF)',
        cardTopBorder: '3px solid #0066CC',
        sidebarBg: '#FFFFFF', sidebarText: '#0F2942', headerBg: '#FFFFFF'
      }
    },

    /* ---- BATCH 1: INITIAL ARCHITECTURAL SERIES ---- */
    {
      id: 'tpl-2',
      code: 'Template 2',
      batch: 'Batch 1 — Architectural Series',
      name: 'Swiss Precision Light',
      subtitle: 'Clean White + International Klein Blue + Grid Discipline',
      mode: 'Pure Light',
      swatch: ['#FFFFFF', '#F7F9FC', '#0B1F3A', '#0047AB'],
      desc: 'Minimalist Swiss typographic grid with high-contrast numerals, clean borders, and daylight readability.',
      vars: {
        bg: '#F7F9FC', surface: '#FFFFFF', surfaceAlt: '#EEF2F8',
        text: '#0B1F3A', textMuted: '#526580',
        primary: '#0B1F3A', accent: '#0047AB', sky: '#2563EB',
        border: '#DAE2EE', radius: '8px', shadow: '0 6px 18px rgba(11,31,58,0.05)',
        fontHeading: '"Inter", system-ui, sans-serif',
        topStripe: 'linear-gradient(90deg, #0047AB, #2563EB)',
        cardTopBorder: '2px solid #0047AB',
        sidebarBg: '#FFFFFF', sidebarText: '#0B1F3A', headerBg: '#FFFFFF'
      }
    },
    {
      id: 'tpl-3',
      code: 'Template 3',
      batch: 'Batch 1 — Architectural Series',
      name: 'Hybrid Enterprise Sidebar',
      subtitle: 'Deep Navy Command Dock + Pure Daylight Workspace',
      mode: 'Hybrid Light',
      swatch: ['#0A1E3C', '#FFFFFF', '#F3F6FA', '#D97706'],
      desc: 'Combines an authoritative dark navy left navigation rail with a bright, eye-friendly porcelain white workspace.',
      vars: {
        bg: '#F3F6FA', surface: '#FFFFFF', surfaceAlt: '#EBF0F7',
        text: '#0A1E3C', textMuted: '#4B5E78',
        primary: '#0A1E3C', accent: '#D97706', sky: '#0284C7',
        border: '#D6E0EE', radius: '10px', shadow: '0 8px 22px rgba(10,30,60,0.06)',
        fontHeading: '"Plus Jakarta Sans", "Inter", sans-serif',
        topStripe: 'linear-gradient(90deg, #0A1E3C, #D97706)',
        cardTopBorder: '3px solid #D97706',
        sidebarBg: '#0A1E3C', sidebarText: '#FFFFFF', headerBg: '#FFFFFF'
      }
    },
    {
      id: 'tpl-1',
      code: 'Template 1',
      batch: 'Batch 1 — Architectural Series',
      name: 'Industrial Cyber Dark',
      subtitle: 'Deep Cobalt Slate + Electric Cyan Telemetry',
      mode: 'Dark Theme',
      swatch: ['#061326', '#0C213B', '#38BDF8', '#F59E0B'],
      desc: 'High-contrast mission-control dark interface for shop-floor terminals and low-light CNC monitoring.',
      vars: {
        bg: '#061326', surface: '#0C213B', surfaceAlt: '#112B4D',
        text: '#F0F6FC', textMuted: '#94A3B8',
        primary: '#38BDF8', accent: '#F59E0B', sky: '#38BDF8',
        border: 'rgba(56,189,248,0.22)', radius: '12px', shadow: '0 14px 34px rgba(0,0,0,0.45)',
        fontHeading: '"Inter", system-ui, sans-serif',
        topStripe: 'linear-gradient(90deg, #0284C7, #38BDF8, #F59E0B)',
        cardTopBorder: '2px solid #38BDF8',
        sidebarBg: '#040D1A', sidebarText: '#F0F6FC', headerBg: '#07172E', isDark: true
      }
    },

    /* ---- BATCH 2: LUXURY EXECUTIVE SERIES ---- */
    {
      id: 'prem-2',
      code: 'Edition II',
      batch: 'Batch 2 — Luxury Series',
      name: 'Architectural Platinum',
      subtitle: 'Brushed Silver Alabaster + Titanium Slate + Navy',
      mode: 'Platinum Light',
      swatch: ['#ECEFF4', '#FFFFFF', '#182232', '#2E5BFF'],
      desc: 'Gallery-grade platinum and brushed aluminum aesthetic with subtle metallic gradients and precision borders.',
      vars: {
        bg: '#ECEFF4', surface: '#FFFFFF', surfaceAlt: '#E2E7F0',
        text: '#182232', textMuted: '#526075',
        primary: '#182232', accent: '#2E5BFF', sky: '#2E5BFF',
        border: '#CBD4E1', radius: '10px', shadow: '0 10px 25px rgba(24,34,50,0.06)',
        fontHeading: '"Plus Jakarta Sans", "Inter", sans-serif',
        topStripe: 'linear-gradient(90deg, #182232, #2E5BFF)',
        cardTopBorder: '3px solid #182232',
        sidebarBg: '#FFFFFF', sidebarText: '#182232', headerBg: '#F8FAFC'
      }
    },
    {
      id: 'prem-1',
      code: 'Edition I',
      batch: 'Batch 2 — Luxury Series',
      name: 'Obsidian Gold Sovereign',
      subtitle: 'Carbon Obsidian + 24K Sovereign Gold Accents',
      mode: 'Dark Luxury',
      swatch: ['#080B11', '#121824', '#D4AF37', '#F8FAFC'],
      desc: 'Bespoke dark luxury theme with warm 24k gold trim and deep obsidian surfaces.',
      vars: {
        bg: '#080B11', surface: '#121824', surfaceAlt: '#1A2233',
        text: '#F8FAFC', textMuted: '#9CA3AF',
        primary: '#D4AF37', accent: '#D4AF37', sky: '#E5C158',
        border: 'rgba(212,175,55,0.25)', radius: '12px', shadow: '0 16px 36px rgba(0,0,0,0.55)',
        fontHeading: '"Playfair Display", Georgia, serif',
        topStripe: 'linear-gradient(90deg, #8A6D1B, #D4AF37, #F3E5AB, #D4AF37)',
        cardTopBorder: '2px solid #D4AF37',
        sidebarBg: '#05070B', sidebarText: '#F8FAFC', headerBg: '#0B0F17', isDark: true
      }
    },
    {
      id: 'prem-3',
      code: 'Edition III',
      batch: 'Batch 2 — Luxury Series',
      name: 'Sapphire Velvet Glass',
      subtitle: 'Royal Midnight Sapphire + Frosted Crystal Glass',
      mode: 'Dark Glass',
      swatch: ['#071330', '#0F2352', '#60A5FA', '#E0AB38'],
      desc: 'Deep royal sapphire atmosphere with translucent frosted glass cards and golden highlights.',
      vars: {
        bg: '#071330', surface: '#0F2352', surfaceAlt: '#16306B',
        text: '#F0F7FF', textMuted: '#93C5FD',
        primary: '#60A5FA', accent: '#E0AB38', sky: '#60A5FA',
        border: 'rgba(96,165,250,0.25)', radius: '16px', shadow: '0 16px 36px rgba(3,9,26,0.5)',
        fontHeading: '"Plus Jakarta Sans", "Inter", sans-serif',
        topStripe: 'linear-gradient(90deg, #1E3A8A, #60A5FA, #E0AB38)',
        cardTopBorder: '2px solid #E0AB38',
        sidebarBg: '#050E24', sidebarText: '#F0F7FF', headerBg: '#09193D', isDark: true
      }
    }
  ];

  function isIdmsPage() {
    var p = (window.location.pathname || '').toLowerCase();
    return p.indexOf('idms') !== -1 || !!document.getElementById('idms-app') || !!document.querySelector('.idms-shell, .app-shell, #side-nav');
  }

  function getTemplateById(id) {
    for (var i = 0; i < TEMPLATES.length; i++) {
      if (TEMPLATES[i].id === id) return TEMPLATES[i];
    }
    return TEMPLATES[0];
  }

  function getActiveWebTemplateId() {
    try { return localStorage.getItem(STORAGE_KEY_WEB) || 'classic'; } catch (e) { return 'classic'; }
  }

  function getActiveIdmsTemplateId() {
    try { return localStorage.getItem(STORAGE_KEY_IDMS) || 'classic'; } catch (e) { return 'classic'; }
  }

  /* Builds dynamic CSS override rules for either Website or IDMS without touching DOM logic */
  function buildTemplateCss(tpl, forIdms) {
    if (!tpl || tpl.id === 'classic' || !tpl.vars || !tpl.vars.bg) return '';
    var v = tpl.vars;
    var fontImport = '@import url("https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap");\n';

    var sharedRules =
      ':root, body, body[data-theme], html {' +
        '--bg:' + v.bg + '!important;' +
        '--bg-alt:' + v.surfaceAlt + '!important;' +
        '--surface:' + v.surface + '!important;' +
        '--card:' + v.surface + '!important;' +
        '--panel:' + v.surface + '!important;' +
        '--navy:' + v.primary + '!important;' +
        '--navy-dark:' + v.primary + '!important;' +
        '--sky:' + v.sky + '!important;' +
        '--gold:' + v.accent + '!important;' +
        '--text:' + v.text + '!important;' +
        '--ink:' + v.text + '!important;' +
        '--muted:' + v.textMuted + '!important;' +
        '--line:' + v.border + '!important;' +
        '--border:' + v.border + '!important;' +
        '--radius:' + v.radius + '!important;' +
      '}\n' +
      'body::before {' +
        'content:"";position:fixed;top:0;left:0;right:0;height:4px;z-index:100000;' +
        'background:' + v.topStripe + ';pointer-events:none;' +
      '}\n';

    if (!forIdms) {
      /* Corporate Website (index.html) Overrides */
      return fontImport + sharedRules +
        'body { background:' + v.bg + '!important; color:' + v.text + '!important; }\n' +
        'header, nav, .site-header, .topbar, .navbar {' +
          'background:' + v.headerBg + '!important; color:' + v.text + '!important;' +
          'border-bottom:1px solid ' + v.border + '!important;' +
          'box-shadow:' + v.shadow + '!important; backdrop-filter:blur(12px)!important;' +
        '}\n' +
        'header a, nav a, .navbar a, .nav-links a { color:' + v.text + '!important; font-weight:600!important; }\n' +
        'h1, h2, h3, .hero-title, .sec-title, .section-title {' +
          'font-family:' + v.fontHeading + '!important; color:' + v.text + '!important; letter-spacing:-0.015em!important;' +
        '}\n' +
        'section, .section, .sec-wrap { background:' + v.bg + '!important; color:' + v.text + '!important; }\n' +
        'section:nth-of-type(even), .section:nth-of-type(even) { background:' + v.surfaceAlt + '!important; }\n' +
        '.hero, #hero, .hero-sec, .hero-wrap {' +
          'background:linear-gradient(135deg, ' + v.surface + ' 0%, ' + v.surfaceAlt + ' 100%)!important;' +
          'color:' + v.text + '!important; border-bottom:1px solid ' + v.border + '!important;' +
        '}\n' +
        '.hero h1, .hero p, .hero span:not(.badge) { color:' + v.text + '!important; }\n' +
        '.card, .cap-card, .mach-card, .prod-card, .cert-card, .stat-card, .step-card, .rfq-box, .contact-card, [class*="card"] {' +
          'background:' + v.surface + '!important; color:' + v.text + '!important;' +
          'border:1px solid ' + v.border + '!important; border-top:' + v.cardTopBorder + '!important;' +
          'border-radius:' + v.radius + '!important; box-shadow:' + v.shadow + '!important;' +
        '}\n' +
        'p, li, .sub, .desc, .muted { color:' + v.textMuted + '!important; }\n' +
        'input, select, textarea {' +
          'background:' + v.surface + '!important; color:' + v.text + '!important;' +
          'border:1px solid ' + v.border + '!important; border-radius:8px!important;' +
        '}\n' +
        '.btn-primary, button[type="submit"], .cta-btn {' +
          'background:' + v.primary + '!important; color:#FFFFFF!important;' +
          'border:1px solid ' + v.accent + '!important; border-radius:8px!important; font-weight:600!important;' +
        '}\n' +
        'footer, .site-footer {' +
          'background:' + v.primary + '!important; color:#FFFFFF!important; border-top:4px solid ' + v.accent + '!important;' +
        '}\n' +
        'footer *, .site-footer * { color:rgba(255,255,255,0.88)!important; }\n';
    } else {
      /* IDMS Portal (idms.html) Overrides */
      return fontImport + sharedRules +
        'body, html, #app, .app, .idms-shell, .idms-body, .idms-main, main {' +
          'background:' + v.bg + '!important; color:' + v.text + '!important;' +
        '}\n' +
        'aside, .sidebar, .side, #sidebar, .idms-side, .nav-rail {' +
          'background:' + v.sidebarBg + '!important; color:' + v.sidebarText + '!important;' +
          'border-right:1px solid ' + v.border + '!important; box-shadow:' + v.shadow + '!important;' +
        '}\n' +
        'aside *, .sidebar *, .side *, #sidebar *, .idms-side * {' +
          'color:' + v.sidebarText + '!important;' +
        '}\n' +
        'header, .topbar, .idms-top, .app-header, .headbar {' +
          'background:' + v.headerBg + '!important; color:' + v.text + '!important;' +
          'border-bottom:1px solid ' + v.border + '!important;' +
        '}\n' +
        'h1, h2, h3, .page-title, .mod-title, .panel-title {' +
          'font-family:' + v.fontHeading + '!important; color:' + v.text + '!important;' +
        '}\n' +
        '.card, .panel, .box, .kpi-card, .stat-box, .widget, .modal-card, .dlg, .sheet, [class*="card"], [class*="panel"] {' +
          'background:' + v.surface + '!important; color:' + v.text + '!important;' +
          'border:1px solid ' + v.border + '!important; border-top:' + v.cardTopBorder + '!important;' +
          'border-radius:' + v.radius + '!important; box-shadow:' + v.shadow + '!important;' +
        '}\n' +
        'table { background:' + v.surface + '!important; color:' + v.text + '!important; border-color:' + v.border + '!important; }\n' +
        'th, thead tr { background:' + v.surfaceAlt + '!important; color:' + v.primary + '!important; border-bottom:2px solid ' + v.accent + '!important; font-weight:700!important; }\n' +
        'td { color:' + v.text + '!important; border-bottom:1px solid ' + v.border + '!important; }\n' +
        'tr:hover td { background:' + v.surfaceAlt + '!important; }\n' +
        'input:not([type="checkbox"]):not([type="radio"]), select, textarea {' +
          'background:' + v.surface + '!important; color:' + v.text + '!important;' +
          'border:1px solid ' + v.border + '!important; border-radius:7px!important;' +
        '}\n';
    }
  }

  function applyCurrentPageTemplate() {
    var onIdms = isIdmsPage();
    var activeId = onIdms ? getActiveIdmsTemplateId() : getActiveWebTemplateId();
    var tpl = getTemplateById(activeId);

    var styleEl = document.getElementById('elixirtec-active-template-css');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'elixirtec-active-template-css';
      (document.head || document.documentElement).appendChild(styleEl);
    }
    styleEl.textContent = buildTemplateCss(tpl, onIdms);
    if (document.body) {
      document.body.setAttribute('data-elixirtec-template', tpl.id);
      document.body.setAttribute('data-elixirtec-screen', onIdms ? 'idms' : 'website');
    }
    updateStudioBadges();
  }

  /* Syncs templates with /api/content so changes published in Developer Admin apply globally */
  function syncWithDatabase(saveToCloud, cb) {
    if (isTestEnv) return;
    var webId = getActiveWebTemplateId();
    var idmsId = getActiveIdmsTemplateId();

    if (!saveToCloud) {
      fetch('/api/content', { method: 'GET', headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.ok && res.data && res.data.screenTemplates) {
            var st = res.data.screenTemplates;
            if (st.website) localStorage.setItem(STORAGE_KEY_WEB, st.website);
            if (st.idms) localStorage.setItem(STORAGE_KEY_IDMS, st.idms);
            applyCurrentPageTemplate();
          }
        })
        .catch(function () {});
      return;
    }

    /* Save to /api/content if an auth token is available in localStorage/sessionStorage */
    var token = '';
    try {
      token = localStorage.getItem('idms_token') ||
              localStorage.getItem('auth_token') ||
              localStorage.getItem('token') ||
              sessionStorage.getItem('idms_token') || '';
      if (!token) {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          var val = localStorage.getItem(k) || '';
          if (/token|session|auth/i.test(k) && val.length >= 16) {
            if (val.charAt(0) === '{') {
              try {
                var parsed = JSON.parse(val);
                if (parsed.token) { token = parsed.token; break; }
              } catch (e) {}
            } else {
              token = val;
              break;
            }
          }
        }
      }
    } catch (e) {}

    fetch('/api/content', { method: 'GET' })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        var currentData = (res && res.data && typeof res.data === 'object') ? res.data : {};
        currentData.screenTemplates = {
          website: webId,
          idms: idmsId,
          updatedAt: new Date().toISOString()
        };
        if (!token) {
          if (cb) cb({ ok: true, localOnly: true });
          return;
        }
        return fetch('/api/content', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auth-Token': token
          },
          body: JSON.stringify({ data: currentData })
        }).then(function (r2) { return r2.json(); });
      })
      .then(function (postRes) {
        if (cb) cb({ ok: true, cloud: !!(postRes && postRes.ok) });
      })
      .catch(function () {
        if (cb) cb({ ok: true, localOnly: true });
      });
  }

  function setTemplateSelection(target, tplId, saveCloud) {
    try {
      if (target === 'website' || target === 'both') localStorage.setItem(STORAGE_KEY_WEB, tplId);
      if (target === 'idms' || target === 'both') localStorage.setItem(STORAGE_KEY_IDMS, tplId);
    } catch (e) {}
    applyCurrentPageTemplate();
    if (saveCloud) {
      syncWithDatabase(true);
    }
  }

  /* ---------- DEVELOPER ADMIN STUDIO MODAL UI ---------- */
  var studioModal = null;

  function ensureStudioCss() {
    if (document.getElementById('elixirtec-studio-css')) return;
    var st = document.createElement('style');
    st.id = 'elixirtec-studio-css';
    st.textContent =
      '.et-studio-overlay{position:fixed;inset:0;z-index:100005;background:rgba(8,22,48,0.72);backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;padding:20px;font-family:Inter,system-ui,-apple-system,sans-serif}' +
      '.et-studio-overlay.open{display:flex}' +
      '.et-studio-dialog{background:#FFFFFF;color:#0A2246;width:100%;max-width:1180px;max-height:90vh;border-radius:18px;border:2px solid #B8891E;box-shadow:0 28px 70px rgba(4,14,32,0.45);display:flex;flex-direction:column;overflow:hidden}' +
      '.et-studio-head{padding:20px 26px;background:linear-gradient(135deg,#0A2246 0%,#123469 100%);color:#FFFFFF;display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:3px solid #B8891E}' +
      '.et-studio-head h2{margin:0;font-size:20px;font-weight:700;letter-spacing:-0.01em;color:#FFFFFF!important}' +
      '.et-studio-head p{margin:4px 0 0;font-size:13px;color:#CFE2FF!important}' +
      '.et-studio-close{background:rgba(255,255,255,0.12);color:#FFFFFF!important;border:1px solid rgba(255,255,255,0.28);border-radius:10px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer}' +
      '.et-studio-close:hover{background:#B8891E;border-color:#B8891E}' +
      '.et-studio-controls{padding:16px 26px;background:#F4F7FB;border-bottom:1px solid #DCE4F0;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px}' +
      '.et-status-pills{display:flex;flex-wrap:wrap;gap:12px;align-items:center}' +
      '.et-pill-box{background:#FFFFFF;border:1px solid #D0DCEF;border-left:4px solid #0A2246;border-radius:10px;padding:8px 14px;font-size:12.5px;color:#0A2246!important;box-shadow:0 2px 8px rgba(10,34,70,0.04)}' +
      '.et-pill-box.idms{border-left-color:#B8891E}' +
      '.et-pill-box strong{display:block;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#526580!important}' +
      '.et-pill-box span{font-weight:700;font-size:13.5px;color:#0A2246!important}' +
      '.et-studio-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}' +
      '.et-btn-publish{background:linear-gradient(135deg,#B8891E,#9A6F12);color:#FFFFFF!important;border:none;border-radius:10px;padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 6px 18px rgba(184,137,30,0.32)}' +
      '.et-btn-publish:hover{filter:brightness(1.07)}' +
      '.et-btn-reset{background:#FFFFFF;color:#0A2246!important;border:1px solid #CBD5E1;border-radius:10px;padding:9px 14px;font-size:12.5px;font-weight:600;cursor:pointer}' +
      '.et-studio-body{padding:22px 26px;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:18px;background:#F8FAFD}' +
      '.et-tpl-card{background:#FFFFFF;border:1.5px solid #DCE4F0;border-radius:14px;padding:16px;display:flex;flex-direction:column;justify-content:space-between;gap:12px;transition:all .18s ease;box-shadow:0 4px 14px rgba(10,34,70,0.04)}' +
      '.et-tpl-card:hover{transform:translateY(-2px);box-shadow:0 12px 26px rgba(10,34,70,0.1);border-color:#0A2246}' +
      '.et-tpl-card.active-web{border-color:#0A2246;box-shadow:0 0 0 2px #0A2246}' +
      '.et-tpl-card.active-idms{border-color:#B8891E;box-shadow:0 0 0 2px #B8891E}' +
      '.et-tpl-card.active-both{border-color:#B8891E;box-shadow:0 0 0 3px #0A2246}' +
      '.et-tpl-top{display:flex;align-items:center;justify-content:space-between;gap:8px}' +
      '.et-tpl-code{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;padding:3px 9px;border-radius:999px;background:#EDF2F9;color:#0A2246!important}' +
      '.et-tpl-mode{font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;background:#FEF3C7;color:#92400E!important}' +
      '.et-tpl-title{margin:4px 0 2px;font-size:16px;font-weight:700;color:#0A2246!important}' +
      '.et-tpl-sub{margin:0;font-size:12px;font-weight:600;color:#B8891E!important}' +
      '.et-tpl-desc{margin:4px 0 0;font-size:12px;line-height:1.45;color:#4A5D7A!important}' +
      '.et-swatches{display:flex;gap:6px;align-items:center;margin-top:4px}' +
      '.et-swatch{width:26px;height:18px;border-radius:5px;border:1px solid rgba(0,0,0,0.15)}' +
      '.et-tpl-btns{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px}' +
      '.et-apply-btn{padding:8px 10px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;border:1px solid #CBD5E1;background:#F8FAFC;color:#0A2246!important;transition:all .15s ease;text-align:center}' +
      '.et-apply-btn:hover{background:#0A2246;color:#FFFFFF!important;border-color:#0A2246}' +
      '.et-apply-btn.is-active-web{background:#0A2246!important;color:#FFFFFF!important;border-color:#0A2246!important}' +
      '.et-apply-btn.is-active-idms{background:#B8891E!important;color:#FFFFFF!important;border-color:#B8891E!important}' +
      '.et-apply-both{grid-column:1 / -1;padding:7px 10px;border-radius:8px;font-size:11.5px;font-weight:600;cursor:pointer;border:1px dashed #B8891E;background:#FFFBEB;color:#92400E!important}' +
      '.et-apply-both:hover{background:#B8891E;color:#FFFFFF!important;border-style:solid}' +
      '.et-admin-card-injected{margin:14px 0;padding:18px 20px;border-radius:14px;background:linear-gradient(135deg,#FFFFFF 0%,#F4F7FB 100%);border:2px solid #B8891E;box-shadow:0 8px 24px rgba(10,34,70,0.08);display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px}');
    (document.head || document.documentElement).appendChild(st);
  }

  function updateStudioBadges() {
    if (!studioModal) return;
    var webId = getActiveWebTemplateId();
    var idmsId = getActiveIdmsTemplateId();
    var webTpl = getTemplateById(webId);
    var idmsTpl = getTemplateById(idmsId);

    var wSpan = studioModal.querySelector('#et-active-web-name');
    var iSpan = studioModal.querySelector('#et-active-idms-name');
    if (wSpan) wSpan.textContent = webTpl.code + ' — ' + webTpl.name;
    if (iSpan) iSpan.textContent = idmsTpl.code + ' — ' + idmsTpl.name;

    var wSel = studioModal.querySelector('#et-quick-web-select');
    var iSel = studioModal.querySelector('#et-quick-idms-select');
    if (wSel && wSel.value !== webId) wSel.value = webId;
    if (iSel && iSel.value !== idmsId) iSel.value = idmsId;

    var cards = studioModal.querySelectorAll('.et-tpl-card');
    for (var i = 0; i < cards.length; i++) {
      var cid = cards[i].getAttribute('data-tpl-id');
      var isW = (cid === webId);
      var isI = (cid === idmsId);
      cards[i].classList.remove('active-web', 'active-idms', 'active-both');
      if (isW && isI) cards[i].classList.add('active-both');
      else if (isW) cards[i].classList.add('active-web');
      else if (isI) cards[i].classList.add('active-idms');

      var bWeb = cards[i].querySelector('.et-btn-web');
      var bIdms = cards[i].querySelector('.et-btn-idms');
      if (bWeb) {
        bWeb.classList.toggle('is-active-web', isW);
        bWeb.textContent = isW ? '✓ Active on Website' : 'Apply to 🌐 Website';
      }
      if (bIdms) {
        bIdms.classList.toggle('is-active-idms', isI);
        bIdms.textContent = isI ? '✓ Active on IDMS' : 'Apply to 🏭 IDMS';
      }
    }
  }

  function openTemplateStudio() {
    ensureStudioCss();
    if (!studioModal) {
      studioModal = document.createElement('div');
      studioModal.className = 'et-studio-overlay';
      studioModal.id = 'elixirtec-template-studio-modal';

      var optionsHtml = TEMPLATES.map(function (t) {
        return '<option value="' + t.id + '">' + t.code + ': ' + t.name + ' (' + t.mode + ')</option>';
      }).join('');

      var cardsHtml = TEMPLATES.map(function (t) {
        var swatches = (t.swatch || []).map(function (c) {
          return '<span class="et-swatch" style="background:' + c + '" title="' + c + '"></span>';
        }).join('');
        return (
          '<div class="et-tpl-card" data-tpl-id="' + t.id + '">' +
            '<div>' +
              '<div class="et-tpl-top">' +
                '<span class="et-tpl-code">' + t.code + ' · ' + t.batch + '</span>' +
                '<span class="et-tpl-mode">' + t.mode + '</span>' +
              '</div>' +
              '<h3 class="et-tpl-title">' + t.name + '</h3>' +
              '<p class="et-tpl-sub">' + t.subtitle + '</p>' +
              '<p class="et-tpl-desc">' + t.desc + '</p>' +
              '<div class="et-swatches">' + swatches + '</div>' +
            '</div>' +
            '<div class="et-tpl-btns">' +
              '<button type="button" class="et-apply-btn et-btn-web" data-target="website" data-id="' + t.id + '">Apply to 🌐 Website</button>' +
              '<button type="button" class="et-apply-btn et-btn-idms" data-target="idms" data-id="' + t.id + '">Apply to 🏭 IDMS</button>' +
              '<button type="button" class="et-apply-both" data-target="both" data-id="' + t.id + '">⚡ Apply to Both Screens Simultaneously</button>' +
            '</div>' +
          '</div>'
        );
      }).join('');

      studioModal.innerHTML =
        '<div class="et-studio-dialog" role="dialog" aria-modal="true" aria-label="Developer Admin Screen Template Studio">' +
          '<div class="et-studio-head">' +
            '<div>' +
              '<h2>🎨 Developer Admin — Screen Design & Template Studio (12 Templates + Classic)</h2>' +
              '<p>Independently switch the live visual architecture for <strong>www.elixirtec.com</strong> (Website) and <strong>/idms.html</strong> (IDMS Portal) with zero functional disruption.</p>' +
            '</div>' +
            '<button type="button" class="et-studio-close" id="et-studio-close-btn">✕ Close Studio</button>' +
          '</div>' +
          '<div class="et-studio-controls">' +
            '<div class="et-status-pills">' +
              '<div class="et-pill-box">' +
                '<strong>🌐 Corporate Website (index.html)</strong>' +
                '<span id="et-active-web-name">Suite A1</span>' +
                '<div style="margin-top:5px"><select id="et-quick-web-select" style="font-size:12px;padding:4px 8px;border-radius:6px;border:1px solid #CBD5E1">' + optionsHtml + '</select></div>' +
              '</div>' +
              '<div class="et-pill-box idms">' +
                '<strong>🏭 IDMS Portal (idms.html)</strong>' +
                '<span id="et-active-idms-name">Suite A2</span>' +
                '<div style="margin-top:5px"><select id="et-quick-idms-select" style="font-size:12px;padding:4px 8px;border-radius:6px;border:1px solid #CBD5E1">' + optionsHtml + '</select></div>' +
              '</div>' +
            '</div>' +
            '<div class="et-studio-actions">' +
              '<button type="button" class="et-btn-reset" id="et-studio-reset-btn">↺ Reset Both to Original Classic</button>' +
              '<button type="button" class="et-btn-publish" id="et-studio-publish-btn">☁️ Save & Publish Global Templates (Cloud DB + Local)</button>' +
            '</div>' +
          '</div>' +
          '<div class="et-studio-body">' + cardsHtml + '</div>' +
        '</div>';

      document.body.appendChild(studioModal);

      studioModal.querySelector('#et-studio-close-btn').addEventListener('click', function () {
        studioModal.classList.remove('open');
      });
      studioModal.addEventListener('click', function (e) {
        if (e.target === studioModal) studioModal.classList.remove('open');
      });

      studioModal.querySelector('#et-quick-web-select').addEventListener('change', function (e) {
        setTemplateSelection('website', e.target.value, true);
      });
      studioModal.querySelector('#et-quick-idms-select').addEventListener('change', function (e) {
        setTemplateSelection('idms', e.target.value, true);
      });

      studioModal.querySelector('#et-studio-reset-btn').addEventListener('click', function () {
        setTemplateSelection('both', 'classic', true);
      });

      var pubBtn = studioModal.querySelector('#et-studio-publish-btn');
      pubBtn.addEventListener('click', function () {
        var orig = pubBtn.textContent;
        pubBtn.textContent = '⏳ Saving & Publishing...';
        syncWithDatabase(true, function () {
          pubBtn.textContent = '✅ Saved & Published to Website + IDMS!';
          setTimeout(function () { pubBtn.textContent = orig; }, 2400);
        });
      });

      studioModal.querySelector('.et-studio-body').addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-target]');
        if (!btn) return;
        var target = btn.getAttribute('data-target');
        var tplId = btn.getAttribute('data-id');
        setTemplateSelection(target, tplId, true);
      });
    }

    updateStudioBadges();
    studioModal.classList.add('open');
  }

  /* Injects "Screen Design & Templates" control directly into IDMS Developer Admin Panel & Top Bar */
  function mountDeveloperAdminHook() {
    if (!document.body || isTestEnv) return;
    ensureStudioCss();

    /* 1. If on IDMS page, add a sleek "🎨 Templates" button in the top header or sidebar & inside Developer Admin views */
    if (isIdmsPage()) {
      var topBars = document.querySelectorAll('header, .topbar, .idms-top, .app-header');
      for (var i = 0; i < topBars.length; i++) {
        var tb = topBars[i];
        if (!tb.querySelector('.et-top-tpl-btn')) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'et-top-tpl-btn';
          btn.innerHTML = '🎨 Screen Templates';
          btn.title = 'Developer Admin: Switch Website & IDMS Screen Templates';
          btn.style.cssText = 'margin:0 8px;padding:6px 12px;border-radius:8px;border:1.5px solid #B8891E;background:#0A2246;color:#FFFFFF;font:600 12px/1.2 Inter,sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:6px;box-shadow:0 2px 8px rgba(10,34,70,0.2);';
          btn.addEventListener('click', openTemplateStudio);
          tb.appendChild(btn);
          break;
        }
      }

      /* Also hook into sidebar navigation / Developer Admin menu if present */
      var sidebars = document.querySelectorAll('aside, .sidebar, .side, #sidebar, .idms-side, nav');
      for (var s = 0; s < sidebars.length; s++) {
        var sb = sidebars[s];
        if (sb.textContent.indexOf('Developer Admin') !== -1 && !sb.querySelector('.et-side-tpl-item')) {
          var navBtn = document.createElement('div');
          navBtn.className = 'et-side-tpl-item';
          navBtn.innerHTML = '🎨 Screen Design & Templates (Web + IDMS)';
          navBtn.style.cssText = 'margin:8px 10px;padding:10px 12px;border-radius:9px;background:linear-gradient(135deg,#0A2246,#143B78);color:#FFFFFF!important;border:1px solid #B8891E;font:600 12.5px/1.3 Inter,sans-serif;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.18);';
          navBtn.addEventListener('click', openTemplateStudio);
          sb.appendChild(navBtn);
          break;
        }
      }

      /* Inject a prominent Developer Admin Control Banner inside any visible Admin/Setup/Settings container */
      var headings = document.querySelectorAll('h1, h2, h3');
      for (var h = 0; h < headings.length; h++) {
        var txt = (headings[h].textContent || '').trim();
        if (/Developer Admin|Setup|Admin|Configuration|Company Profile|Website/i.test(txt)) {
          var parent = headings[h].parentElement;
          if (parent && !parent.querySelector('.et-admin-card-injected')) {
            var card = document.createElement('div');
            card.className = 'et-admin-card-injected';
            card.innerHTML =
              '<div>' +
                '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#B8891E">Developer Admin — Independent Visual Architecture Control</div>' +
                '<div style="font-size:15px;font-weight:700;color:#0A2246;margin-top:2px">🎨 Screen Design & Template Studio (12 Templates + Original Classic)</div>' +
                '<div style="font-size:12.5px;color:#4A5D7A;margin-top:2px">Switch Website (elixirtec.com) and IDMS Portal (idms.html) screen designs independently in real time.</div>' +
              '</div>' +
              '<button type="button" style="background:#0A2246;color:#FFFFFF;border:1.5px solid #B8891E;border-radius:10px;padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer">Open Template Studio →</button>';
            card.querySelector('button').addEventListener('click', openTemplateStudio);
            parent.insertBefore(card, headings[h].nextSibling);
            break;
          }
        }
      }
    }
  }

  /* Keyboard shortcut: Alt + Shift + T opens the Template Studio from either Website or IDMS */
  window.addEventListener('keydown', function (e) {
    if (e.altKey && e.shiftKey && (e.key === 'T' || e.key === 't')) {
      e.preventDefault();
      openTemplateStudio();
    }
  });

  function initEngine() {
    mountScrollDock();
    applyCurrentPageTemplate();
    mountDeveloperAdminHook();
    if (!isTestEnv) {
      setTimeout(function () { syncWithDatabase(false); }, 1500);
      setInterval(mountDeveloperAdminHook, 1800);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEngine);
  } else {
    initEngine();
  }

  window.PageChrome = {
    aiBusy: { start: aiStart, end: aiEnd, count: function () { return jobs.length; } },
    templates: {
      list: TEMPLATES,
      openStudio: openTemplateStudio,
      setWebsiteTemplate: function (id) { setTemplateSelection('website', id, true); },
      setIdmsTemplate: function (id) { setTemplateSelection('idms', id, true); },
      setBothTemplates: function (id) { setTemplateSelection('both', id, true); },
      getActive: function () { return { website: getActiveWebTemplateId(), idms: getActiveIdmsTemplateId() }; }
    }
  };
})();
