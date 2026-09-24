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
  if (document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id; s.textContent = css;
  (document.head || document.documentElement).appendChild(s);
}

/* Both are page furniture: they belong to every screen, so they are put up
   once when the document is ready rather than by each screen that wants them. */
function installChrome() { aiEnsure(); scrollDock(); }
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', installChrome);
else installChrome();

  window.PageChrome = {
    aiBusy: { start: aiStart, end: aiEnd, count: function () { return aiJobs.length; } }
  };
})();
