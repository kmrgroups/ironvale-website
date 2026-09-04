/* ============================================================================
   core.js — the plumbing shared by the website and the IDMS.

   Nothing here knows the name of a company. The letterhead on every printed
   document is read from the site profile in the database, so one build serves
   any customer.

   Exposed as window.Core so both pages can use it without a build step.
   ========================================================================= */
(function (root) {
  'use strict';

  /* ---------------- small helpers ---------------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const num = v => {
    const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
  };

  const inr = n => num(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

  /* Whole numbers are right for a count of parts and wrong for everything else.
     A price of 82.50 must not print as 83, and 0.42 kg must not print as 0.
     qty() keeps up to three decimals but drops trailing zeros, so 500 stays
     500 and 0.425 stays 0.425. rate() always shows two. */
  const qty = n => {
    const v = num(n);
    return v.toLocaleString('en-IN', { maximumFractionDigits: 3 });
  };
  const rate = n => num(n).toLocaleString('en-IN',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = n => '₹' + num(n).toLocaleString('en-IN',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fmtDate = d => {
    if (!d) return '—';
    const x = new Date(d);
    return isNaN(x) ? String(d) : x.toLocaleDateString('en-GB');
  };
  const dayKey = d => {
    const x = new Date(d);
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') +
      '-' + String(x.getDate()).padStart(2, '0');
  };

  /* An id that stays unique even when several people create records in the
     same millisecond. Serial numbers that must not collide come from the
     database counter instead — see Core.serial(). */
  const newId = prefix => prefix + '-' + Date.now().toString(36).toUpperCase() +
    Math.random().toString(36).slice(2, 5).toUpperCase();

  function toast(msg) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('on'), 3200);
  }

  /* ---------------- session ---------------- */
  const TOKEN_KEY = 'app_token';
  let token = '';
  try { token = sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { token = ''; }

  function setToken(t) {
    token = t || '';
    try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); }
    catch (e) { /* private browsing — the token simply lives for this page only */ }
  }
  const getToken = () => token;

  /* ---------------- the one way this app talks to the server ----------------
     Every failure comes back as a thrown Error with a sentence a person can
     act on, so no caller has to guess what a bare 500 meant. */
  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (token) headers['X-Auth-Token'] = token;
    let res;
    try {
      res = await fetch(path, Object.assign({}, opts, { headers }));
    } catch (e) {
      throw new Error('No connection to the server. Check the network and try again.');
    }
    let json = null;
    try { json = await res.json(); } catch (e) { json = null; }
    if (res.status === 401) {
      setToken('');
      throw new Error((json && json.error) || 'Your session has ended. Sign in again.');
    }
    if (!res.ok || (json && json.ok === false)) {
      throw new Error((json && json.error) || ('The server refused that request (' + res.status + ').'));
    }
    return json || {};
  }

  /* The login API expects `user` and `pass`, and may answer with needCode when
     two-factor is switched on for that account — in which case the caller must
     follow up with verifyCode. */
  async function signIn(user, pass) {
    const j = await api('/api/auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'login', user: user, pass: pass })
    });
    if (j.token) setToken(j.token);
    return j;                      // { token, user, role } or { needCode:true, user, sentTo }
  }
  async function verifyCode(user, code) {
    const j = await api('/api/auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'verifyCode', user: user, code: code })
    });
    if (j.token) setToken(j.token);
    return j;
  }

  /* ---------------- IDMS shorthands ---------------- */
  const idms = {
    docs: (kind, partId) => api('/api/idms?what=docs' +
      (kind ? '&kind=' + encodeURIComponent(kind) : '') +
      (partId ? '&partId=' + encodeURIComponent(partId) : '')).then(j => j.docs || []),
    saveDoc: (doc, reason) => api('/api/idms', {
      method: 'POST', body: JSON.stringify({ what: 'docs', doc: doc, reason: reason || '' })
    }),
    patchDoc: patch => api('/api/idms', {
      method: 'PATCH', body: JSON.stringify(Object.assign({ what: 'docs' }, patch))
    }),
    parts: lifecycle => api('/api/idms?what=parts' +
      (lifecycle ? '&lifecycle=' + encodeURIComponent(lifecycle) : '')).then(j => j.parts || []),
    savePart: (part, reason) => api('/api/idms', {
      method: 'POST', body: JSON.stringify({ what: 'parts', part: part, reason: reason || '' })
    }),
    setLifecycle: (partId, lifecycle, reason) => api('/api/idms', {
      method: 'PATCH',
      body: JSON.stringify({ what: 'parts', partId: partId, lifecycle: lifecycle, reason: reason || '' })
    }),
    settings: () => api('/api/idms?what=settings').then(j => j.settings || {}),
    saveSetting: (key, data) => api('/api/idms', {
      method: 'POST', body: JSON.stringify({ what: 'settings', key: key, data: data })
    }),
    audit: ref => api('/api/idms?what=audit' + (ref ? '&ref=' + encodeURIComponent(ref) : ''))
      .then(j => j.audit || []),
    /* A number nobody else can be given at the same moment. */
    serial: (name, by) => api('/api/idms', {
      method: 'POST', body: JSON.stringify({ what: 'serial', name: name, by: by || 1 })
    }).then(j => j.value)
  };

  /* ---------------- the company profile ----------------
     Read once from the site content. Nothing in this file, or any screen that
     uses it, may hard-code a company name, address, GSTIN or document prefix. */
  let profile = null;
  async function loadProfile() {
    if (profile) return profile;
    let d = {};
    try { d = (await api('/api/content')).data || {}; } catch (e) { d = {}; }
    const co = d.company || {};
    profile = {
      name: co.legalName || co.displayName || d.brandName || '',
      address: [co.addressLine, co.city, co.state, co.country].filter(Boolean).join(', '),
      pin: co.pin || '',
      gstin: co.gstin || '',
      logo: d.logoDataUrl || '',
      /* the prefix that used to be hard-coded into every document number */
      docPrefix: (co.docPrefix || co.shortName ||
        (co.legalName || d.brandName || 'DOC').replace(/[^A-Za-z]/g, '').slice(0, 4)).toUpperCase()
    };
    return profile;
  }
  const getProfile = () => profile || { name: '', address: '', gstin: '', logo: '', docPrefix: 'DOC' };

  /* A document number built from the profile and a database counter, e.g.
     ELIX-GRN-0042. No company initials appear anywhere in the code. */
  async function docNumber(kind, pad) {
    const p = await loadProfile();
    const n = await idms.serial(kind);
    return p.docPrefix + '-' + String(kind).toUpperCase() + '-' +
      String(n).padStart(pad || 4, '0');
  }

  /* ---------------- printing ----------------
     One print engine for every report in both applications. The letterhead is
     the profile, so a report never carries another company's name. */
  function openReport(report) {
    const p = getProfile();
    const w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups for this site to print.'); return; }
    const sections = (report.sections || []).map(sec => {
      if (sec.type === 'pairs') {
        return '<h2>' + esc(sec.title || '') + '</h2><table class="pairs">' +
          (sec.rows || []).map(r => '<tr><th>' + esc(r[0]) + '</th><td>' +
            (r[1] == null ? '—' : r[1]) + '</td></tr>').join('') + '</table>';
      }
      if (sec.type === 'table') {
        const cols = sec.columns || [];
        return '<h2>' + esc(sec.title || '') + '</h2><table class="' + (sec.dense ? 'dense' : '') + '">' +
          '<thead><tr>' + cols.map(c => '<th class="' + (c.align || '') + '">' +
            esc(c.label) + '</th>').join('') + '</tr></thead><tbody>' +
          ((sec.rows || []).length ? (sec.rows || []).map(r => '<tr>' + r.map((cell, i) => {
            const o = (cell && typeof cell === 'object') ? cell : { v: cell };
            return '<td class="' + ((cols[i] || {}).align || '') + ' ' + (o.cls || '') + '">' +
              (o.v == null ? '—' : o.v) + '</td>';
          }).join('') + '</tr>').join('')
            : '<tr><td colspan="' + cols.length + '">Nothing recorded.</td></tr>') +
          '</tbody></table>' + (sec.note ? '<p class="note">' + esc(sec.note) + '</p>' : '');
      }
      if (sec.type === 'text') return '<h2>' + esc(sec.title || '') + '</h2><p>' + esc(sec.body || '') + '</p>';
      /* a section that is already laid out — a flow diagram, a chart. The caller
         owns the markup; the letterhead and footer are still ours. */
      if (sec.type === 'html') return (sec.title ? '<h2>' + esc(sec.title) + '</h2>' : '') +
        (sec.html || '');
      return '';
    }).join('');

    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' +
      esc(report.title || 'Report') + '</title><style>' +
      '@page{size:A4 ' + (report.landscape ? 'landscape' : 'portrait') + ';margin:12mm;}' +
      '*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
      'body{font-family:Arial,Helvetica,sans-serif;font-size:9pt;color:#12233f;line-height:1.5;}' +
      '.lh{display:flex;justify-content:space-between;align-items:center;gap:14px;' +
      'border-bottom:2.2pt solid #0B2A5B;padding-bottom:9px;}' +
      '.lh img{max-height:16mm;max-width:46mm;object-fit:contain;}' +
      '.lh .co{font-size:13pt;font-weight:800;color:#0B2A5B;}' +
      '.lh .rt{text-align:right;font-size:7.4pt;color:#41567E;}' +
      'h1{font-size:13pt;text-align:center;margin:12px 0 3px;letter-spacing:.5pt;}' +
      '.sub{text-align:center;font-size:8pt;color:#7C8CAB;margin-bottom:12px;}' +
      'h2{font-size:8.4pt;text-transform:uppercase;letter-spacing:.6pt;color:#8E6A19;' +
      'border-bottom:.7pt solid #dbe3ee;padding-bottom:3px;margin:13px 0 6px;}' +
      'table{width:100%;border-collapse:collapse;font-size:8pt;}' +
      'th,td{border-bottom:.6pt solid #e6ecf4;padding:4px 5px;text-align:left;vertical-align:top;}' +
      'thead th{background:#0B2A5B;color:#fff;font-size:7.2pt;text-transform:uppercase;letter-spacing:.4pt;}' +
      'table.pairs th{width:34%;background:#f4f8fc;color:#41567E;font-weight:600;}' +
      'th.r,td.r{text-align:right;} th.c,td.c{text-align:center;}' +
      'table.dense{font-size:5.6pt;table-layout:fixed;}' +
      'table.dense th{padding:3px 1px;font-size:5.2pt;text-align:center;}' +
      'table.dense td{padding:3px 1px;text-align:center;}' +
      'p.note{font-size:7pt;color:#7C8CAB;margin-top:5px;line-height:1.45;}' +
      '.ft{margin-top:16px;border-top:.7pt solid #dbe3ee;padding-top:6px;' +
      'font-size:6.8pt;color:#93a2b8;display:flex;justify-content:space-between;}' +
      '</style></head><body>' +
      '<div class="lh">' +
      (p.logo ? '<img src="' + p.logo + '">' : '<div class="co">' + esc(p.name) + '</div>') +
      '<div class="rt">' + (p.logo ? '<b>' + esc(p.name) + '</b><br>' : '') +
      esc(p.address) + (p.pin ? ' - ' + esc(p.pin) : '') +
      (p.gstin ? '<br>GSTIN: ' + esc(p.gstin) : '') + '</div></div>' +
      '<h1>' + esc(report.title || '') + '</h1>' +
      '<div class="sub">' + esc(report.subtitle || '') + '</div>' +
      sections +
      '<div class="ft"><span>' + esc(report.kind || 'Record') + ' — system generated</span>' +
      '<span>' + new Date().toLocaleString('en-GB') + '</span></div>' +
      '</body></html>');
    w.document.close();
    setTimeout(() => { try { w.print(); } catch (e) { /* the user can print manually */ } }, 350);
  }

  /* ---------------- browser tab icon ----------------
     Follows the logo from the site profile. A logo is wide and often has a
     transparent background, which makes a poor icon, so it is drawn centred on
     a square white tile first. Every existing icon link is removed rather than
     another added — with several <link rel="icon"> tags the browser picks one
     of its own accord and the bundled file wins. */
  let faviconFor = null;
  function applyFavicon(href) {
    document.querySelectorAll('link[rel~="icon"],link[rel="shortcut icon"],link[rel="apple-touch-icon"]')
      .forEach(l => l.parentNode.removeChild(l));
    const link = document.createElement('link');
    link.rel = 'icon'; link.type = 'image/png'; link.sizes = '64x64'; link.href = href;
    document.head.appendChild(link);
    const touch = document.createElement('link');
    touch.rel = 'apple-touch-icon'; touch.href = href;
    document.head.appendChild(touch);
  }
  function bundledFavicon() {
    document.querySelectorAll('link[rel~="icon"],link[rel="shortcut icon"],link[rel="apple-touch-icon"]')
      .forEach(l => l.parentNode.removeChild(l));
    const l = document.createElement('link');
    l.rel = 'icon'; l.type = 'image/svg+xml'; l.href = '/favicon.svg';
    document.head.appendChild(l);
  }
  function setFavicon(src) {
    if (faviconFor === (src || '')) return;
    faviconFor = src || '';
    if (!src) { bundledFavicon(); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const S = 64, c = document.createElement('canvas');
        c.width = S; c.height = S;
        const x = c.getContext('2d');
        x.fillStyle = '#ffffff'; x.fillRect(0, 0, S, S);
        const pad = 4, box = S - pad * 2;
        const r = Math.min(box / img.width, box / img.height);
        const w = Math.max(1, img.width * r), h = Math.max(1, img.height * r);
        x.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
        applyFavicon(c.toDataURL('image/png'));
      } catch (e) { applyFavicon(src); }   // tainted canvas — use the file as it is
    };
    img.onerror = () => bundledFavicon();
    img.src = src;
  }

  /* ---------------- the AI gateway ----------------
     The key lives on the server; the browser never sees it. Errors are surfaced
     rather than swallowed, because a silently empty PFMEA is worse than a
     visible failure. */
  async function callAI(prompt, opts) {
    opts = opts || {};
    const res = await fetch('/api/ai', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt, system: opts.system,
        attachment: opts.attachment, maxTokens: opts.maxTokens || 2000 })
    });
    const j = await res.json();
    if (j.ok && j.text) return j.text;
    if (j.notConfigured)
      throw new Error('No AI provider is configured. Add a key in Site Admin on the website.');
    const tried = (j.attempts && j.attempts.length)
      ? '\n\nModels tried:\n• ' + j.attempts.slice(0, 6).join('\n• ') : '';
    throw new Error((j.error || 'The AI did not answer.') + tried);
  }

  /* ---------------- tolerant reader for AI replies ----------------
     Models put real line breaks inside quoted strings, which JSON.parse
     rejects outright. Escape the control characters that sit inside a string
     before parsing, and drop a trailing comma. */
  function parseAiJson(text) {
    let t = String(text == null ? '' : text).replace(/```json|```/g, '').trim();
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b < a) throw new Error('The reply was not JSON.');
    t = t.slice(a, b + 1);
    let out = '', inStr = false, escNext = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i], code = t.charCodeAt(i);
      if (escNext) { out += c; escNext = false; continue; }
      if (c === '\\') { out += c; escNext = true; continue; }
      if (c === '"') { inStr = !inStr; out += c; continue; }
      if (inStr && code < 0x20) {
        out += c === '\n' ? '\\n' : c === '\r' ? '\\r' : c === '\t' ? '\\t' : ' ';
        continue;
      }
      out += c;
    }
    out = out.replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(out);
  }

  function stripMarkup(t) {
    return String(t == null ? '' : t)
      .replace(/```[a-z]*|```/gi, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/^\s*#{1,6}\s*/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /* ---------------- live camera ----------------
     A camera only opens on https. On plain http the box says so rather than
     failing with nothing on screen. Returns a data URL, or null if cancelled. */
  function capturePhoto() {
    return new Promise(resolve => {
      const secure = location.protocol === 'https:' ||
        location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      const wrap = document.createElement('div');
      wrap.className = 'cam-modal';
      wrap.innerHTML = '<div class="cam-box">' +
        '<h4 style="margin-bottom:10px;">Take a photo</h4>' +
        '<video class="cam-v" autoplay playsinline muted></video>' +
        '<img class="shot" style="display:none;">' +
        '<div class="hint cam-msg" style="margin:10px 0;">Face the camera in good light.</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
        '<button class="btn gold cam-shoot">Capture</button>' +
        '<button class="btn cam-again" style="display:none;">Retake</button>' +
        '<button class="btn green cam-use" style="display:none;">Use this photo</button>' +
        '<button class="btn cam-x">Cancel</button></div></div>';
      document.body.appendChild(wrap);
      const v = wrap.querySelector('.cam-v'), img = wrap.querySelector('.shot'),
        msg = wrap.querySelector('.cam-msg'), bShoot = wrap.querySelector('.cam-shoot'),
        bAgain = wrap.querySelector('.cam-again'), bUse = wrap.querySelector('.cam-use'),
        bX = wrap.querySelector('.cam-x');
      let stream = null, shot = null;
      const stop = () => { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } };
      const close = r => { stop(); wrap.remove(); resolve(r || null); };
      const fail = t => { msg.textContent = t; msg.style.color = 'var(--bad)'; bShoot.disabled = true; };

      if (!secure) fail('A camera can only be opened over https. Use a file instead.');
      else if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
        fail('This browser cannot open a camera. Use a file instead.');
      else navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
        .then(st => { stream = st; v.srcObject = st; })
        .catch(e => fail('The camera did not open: ' + (e.message || e.name) +
          '. Allow camera access for this site.'));

      bShoot.addEventListener('click', () => {
        const w = v.videoWidth, h = v.videoHeight;
        if (!w) { fail('The camera has not started yet. Wait a moment.'); return; }
        const cv = document.createElement('canvas');
        cv.width = 600; cv.height = 720;
        const x = cv.getContext('2d');
        const srcH = Math.min(h, w * (720 / 600)), srcW = srcH * (600 / 720);
        x.translate(cv.width, 0); x.scale(-1, 1);
        x.drawImage(v, (w - srcW) / 2, (h - srcH) / 2, srcW, srcH, 0, 0, cv.width, cv.height);
        shot = cv.toDataURL('image/jpeg', 0.85);
        img.src = shot; img.style.display = ''; v.style.display = 'none';
        stop();
        msg.textContent = 'Use this one, or take it again.';
        bShoot.style.display = 'none'; bAgain.style.display = ''; bUse.style.display = '';
      });
      bAgain.addEventListener('click', () => {
        img.style.display = 'none'; v.style.display = ''; shot = null;
        bShoot.style.display = ''; bAgain.style.display = 'none'; bUse.style.display = 'none';
        msg.textContent = 'Face the camera in good light.'; msg.style.color = '';
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
          .then(st => { stream = st; v.srcObject = st; })
          .catch(e => fail('The camera did not reopen: ' + e.message));
      });
      bUse.addEventListener('click', () => close(shot));
      bX.addEventListener('click', () => close(null));
      wrap.addEventListener('click', e => { if (e.target === wrap) close(null); });
    });
  }

  root.Core = {
    esc: esc, num: num, inr: inr, qty: qty, rate: rate, money: money,
    fmtDate: fmtDate, dayKey: dayKey,
    newId: newId, toast: toast,
    api: api, signIn: signIn, verifyCode: verifyCode, setToken: setToken, getToken: getToken,
    idms: idms, loadProfile: loadProfile, getProfile: getProfile, docNumber: docNumber,
    openReport: openReport, callAI: callAI, parseAiJson: parseAiJson, stripMarkup: stripMarkup,
    setFavicon: setFavicon,
    capturePhoto: capturePhoto
  };
})(window);
