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

  /* Amount in words, Indian numbering (crore/lakh) — for the statutory
     "Amount in Words" line on a tax invoice. Whole rupees only; paise are
     printed separately when present, the way a tax invoice states them. */
  const ONES = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten',
    'Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const TENS = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  function twoDigitWords(n) {
    if (n < 20) return ONES[n];
    return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  }
  function threeDigitWords(n) {
    var out = '';
    if (n >= 100) { out += ONES[Math.floor(n / 100)] + ' Hundred'; n %= 100; if (n) out += ' '; }
    if (n) out += twoDigitWords(n);
    return out;
  }
  function numberToWords(n) {
    n = Math.round(num(n) * 100) / 100;
    const rupees = Math.floor(n), paise = Math.round((n - rupees) * 100);
    if (rupees === 0 && paise === 0) return 'Indian Rupees Zero Only';
    var r = rupees, parts = [];
    const crore = Math.floor(r / 10000000); r %= 10000000;
    const lakh = Math.floor(r / 100000); r %= 100000;
    const thousand = Math.floor(r / 1000); r %= 1000;
    const hundred = r;
    if (crore) parts.push(threeDigitWords(crore) + ' Crore');
    if (lakh) parts.push(threeDigitWords(lakh) + ' Lakh');
    if (thousand) parts.push(threeDigitWords(thousand) + ' Thousand');
    if (hundred) parts.push(threeDigitWords(hundred));
    var out = 'Indian Rupees ' + (parts.join(' ') || 'Zero');
    if (paise) out += ' and ' + threeDigitWords(paise) + ' Paise';
    return out + ' Only';
  }

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

  /* ---------------- session ----------------
     sessionStorage, deliberately, so a session belongs to ONE tab. Opening a
     menu link in a new tab or window (right-click → Open Link in New Tab)
     starts a fresh top-level browsing context with its own, empty
     sessionStorage, so that tab asks for a sign-in of its own even though it
     is the same person in the same browser.

     This reverses an earlier choice of localStorage, which was made so a
     token would survive exactly that. It was changed on an explicit
     requirement: a second tab must not inherit the first tab's session. It
     also matches the standing requirement that the sign-in is never saved by
     the browser and never auto-logs-in on opening.

     Consequence worth knowing: closing and reopening the tab now signs the
     person out, and so does a browser restart. That is the intended trade.
     checkSession() still asks the server whether the token is good, so a
     revoked or expired session is caught either way — this only changes where
     the token lives, not whether it is trusted blindly.

     The website (index.html) keeps its own token under this same key name in
     localStorage; the two no longer collide, because they are now different
     storage areas entirely. */
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
  /* Ask the server whether this session is still good. A revoked or expired
     token looks exactly like a valid one from here, so never assume it is. */
  async function checkSession() {
    if (!token) return null;
    try {
      const j = await api('/api/auth', { method: 'POST',
        body: JSON.stringify({ action: 'session' }) });
      if (j && j.ok) return { user: j.user, role: j.role };
    } catch (e) {
      /* a rejected token is gone; a network failure is not a reason to sign
         somebody out, so only clear it when the server actually says no */
      if (/session has ended|Not signed in/i.test(e.message || '')) setToken('');
      return null;
    }
    setToken('');
    return null;
  }

  async function signOut() {
    try {
      await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) });
    } catch (e) { /* the local token goes either way */ }
    setToken('');
  }

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

  /* Sign in with a one-time code and no password. channel is 'email',
     'whatsapp', or left out to try whichever contacts are on file. The code
     itself is still submitted through verifyCode() above. */
  async function otpRequest(user, channel) {
    return api('/api/auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'otpRequest', user: user, channel: channel || '' })
    });
  }

  /* Forgot password: request a reset code (sent to email and WhatsApp), then
     submit it with a new password. A successful reset signs the person in. */
  async function forgotStart(user) {
    return api('/api/auth', {
      method: 'POST', body: JSON.stringify({ action: 'forgotStart', user: user })
    });
  }
  async function forgotReset(user, code, newPass) {
    const j = await api('/api/auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'forgotReset', user: user, code: code, newPass: newPass })
    });
    if (j.token) setToken(j.token);
    return j;
  }

  /* Face ID. Enrolling and forgetting need an existing session; signing in
     with a face does not — it is a 1-to-many match done on the server. */
  async function faceLogin(descriptor) {
    const j = await api('/api/auth', {
      method: 'POST', body: JSON.stringify({ action: 'faceLogin', descriptor: descriptor })
    });
    if (j.token) setToken(j.token);
    return j;
  }
  async function faceEnroll(descriptor) {
    return api('/api/auth', {
      method: 'POST', body: JSON.stringify({ action: 'faceEnroll', descriptor: descriptor })
    });
  }
  async function faceForget() {
    return api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'faceForget' }) });
  }

  /* ---------------- IDMS read de-duplication ----------------
     Why this exists. Screens read the same tables over and over: 'process' is
     fetched from 27 places in idms.html, 'dimension' from 17, 'production' from
     13. A screen that gathers six tables used to make six round trips even when
     two of them wanted the same table.

     What this does, and deliberately all it does: if a read is ALREADY IN FLIGHT
     when an identical read is asked for, both callers get the same promise. One
     request, one moment, two readers.

     What it deliberately does NOT do is hold answers after they resolve. A
     time-based cache was tried and removed: it makes one user's screen show
     another user's superseded figure for as long as the cache lives, and on a
     shop floor two people working the same part is the ordinary case, not the
     exception. A stale control plan or stock balance is exactly the class of
     error this system exists to prevent. The saving that mattered was the
     duplicate-and-concurrent one, and that is kept here in full.

     This is what makes Promise.all() over a screen's reads free to write: batch
     the reads, and repeats within the batch cost nothing. */
  const inFlight = new Map();

  function sharedGet(key, fetcher) {
    const live = inFlight.get(key);
    if (live) return live;
    const p = fetcher().finally(() => { inFlight.delete(key); });
    inFlight.set(key, p);
    return p;
  }

  /* ---------------- IDMS shorthands ---------------- */
  const idms = {
    docs: (kind, partId) => sharedGet('docs|' + (kind || '') + '|' + (partId || ''), () =>
      api('/api/idms?what=docs' +
        (kind ? '&kind=' + encodeURIComponent(kind) : '') +
        (partId ? '&partId=' + encodeURIComponent(partId) : '')).then(j => j.docs || [])),
    saveDoc: (doc, reason) => api('/api/idms', {
      method: 'POST', body: JSON.stringify({ what: 'docs', doc: doc, reason: reason || '' })
    }),
    patchDoc: patch => api('/api/idms', {
      method: 'PATCH', body: JSON.stringify(Object.assign({ what: 'docs' }, patch))
    }),
    parts: lifecycle => sharedGet('parts|' + (lifecycle || ''), () =>
      api('/api/idms?what=parts' +
        (lifecycle ? '&lifecycle=' + encodeURIComponent(lifecycle) : '')).then(j => j.parts || [])),
    savePart: (part, reason) => api('/api/idms', {
      method: 'POST', body: JSON.stringify({ what: 'parts', part: part, reason: reason || '' })
    }),
    removePart: (partId, reason) =>
      api('/api/idms', { method:'PATCH', body: JSON.stringify({ what:'parts', partId,
        remove:true, reason }) }),
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

  /* ---------------- file storage ----------------
     Files go to the same assets table the website uses, so a PPAP attachment is
     served by a short public link that can be opened from any machine. */
  async function uploadFile(file) {
    if (file.size > 6 * 1024 * 1024)
      throw new Error('That file is ' + Math.round(file.size / 1048576) + 'MB. The limit is 6MB.');
    const dataUrl = await new Promise((ok, no) => {
      const r = new FileReader();
      r.onload = () => ok(r.result);
      r.onerror = () => no(new Error('The file could not be read.'));
      r.readAsDataURL(file);
    });
    const j = await api('/api/assets', { method:'POST', body: JSON.stringify({ dataUrl: dataUrl }) });
    return { url: j.url || j.src || ('/api/assets?id=' + j.id), id: j.id,
             name: file.name, size: file.size, mime: file.type };
  }

  /* ---------------- the company profile ----------------
     Read once from the site content. Nothing in this file, or any screen that
     uses it, may hard-code a company name, address, GSTIN or document prefix. */
  /* GST state codes — the first two digits of any GSTIN, standard nationwide.
     Used to work out a state name from a GSTIN, and to tell same-state
     (CGST+SGST) apart from inter-state (IGST) without a separate state field
     having to be typed anywhere a GSTIN already exists. */
  const GST_STATE = { '01':'Jammu and Kashmir','02':'Himachal Pradesh','03':'Punjab','04':'Chandigarh',
    '05':'Uttarakhand','06':'Haryana','07':'Delhi','08':'Rajasthan','09':'Uttar Pradesh','10':'Bihar',
    '11':'Sikkim','12':'Arunachal Pradesh','13':'Nagaland','14':'Manipur','15':'Mizoram','16':'Tripura',
    '17':'Meghalaya','18':'Assam','19':'West Bengal','20':'Jharkhand','21':'Odisha','22':'Chhattisgarh',
    '23':'Madhya Pradesh','24':'Gujarat','25':'Daman and Diu','26':'Dadra and Nagar Haveli','27':'Maharashtra',
    '28':'Andhra Pradesh (old)','29':'Karnataka','30':'Goa','31':'Lakshadweep','32':'Kerala','33':'Tamil Nadu',
    '34':'Puducherry','35':'Andaman and Nicobar Islands','36':'Telangana','37':'Andhra Pradesh',
    '38':'Ladakh','97':'Other Territory' };
  function gstStateCode(gstin){ return /^[0-9]{2}/.test(gstin||'') ? String(gstin).slice(0,2) : ''; }
  function gstStateName(gstin){ return GST_STATE[gstStateCode(gstin)] || ''; }

  let profile = null;
  async function loadProfile() {
    if (profile) return profile;
    let d = {};
    try { d = (await api('/api/content')).data || {}; } catch (e) { d = {}; }
    const co = d.company || {};
    const gstin = co.taxNumber || co.gstin || '';
    profile = {
      name: co.legalName || co.displayName || d.brandName || '',
      addr1: co.addr1 || '', addr2: co.addr2 || '', city: co.city || '',
      state: co.state || '', country: co.country || '', pin: co.pin || '',
      address: [co.addr1, co.addr2, co.city, co.state, co.country].filter(Boolean).join(', '),
      gstin: gstin, taxLabel: co.taxLabel || 'GSTIN',
      stateCode: gstStateCode(gstin), stateName: co.state || gstStateName(gstin),
      pan: co.panNumber || '', panLabel: co.panLabel || 'PAN',
      iec: co.iec || '', cin: co.cin || '',
      phone: co.phone || co.mobile || '', email: co.email || '', website: co.website || '',
      bankShow: !!co.bankShow, bankName: co.bankName || '', bankBranch: co.bankBranch || '',
      bankAccName: co.bankAccName || '', bankAccNo: co.bankAccNo || '', bankIfsc: co.bankIfsc || '',
      signatoryName: co.signatoryName || '', signatoryTitle: co.signatoryTitle || '',
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
      (p.gstin ? '<br>' + esc(p.taxLabel || 'GSTIN') + ': ' + esc(p.gstin) : '') +
      (p.pan ? ' &nbsp; ' + esc(p.panLabel || 'PAN') + ': ' + esc(p.pan) : '') +
      ((p.phone || p.email) ? '<br>' + [p.phone, p.email].filter(Boolean).map(esc).join(' · ') : '') +
      '</div></div>' +
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
    let res;
    try {
      res = await fetch('/api/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt, system: opts.system,
          attachment: opts.attachment, maxTokens: opts.maxTokens || 2000 })
      });
    } catch (e) {
      /* the request never left the browser — a dropped connection, not the AI */
      throw new Error('Could not reach the server — the request never left this browser. ' +
        'Check the internet connection and try again. Nothing is wrong with the AI settings.');
    }
    let j;
    try { j = await res.json(); }
    catch (e) { throw new Error('The server answered but not with a result (' + res.status + '). ' +
      'If this keeps happening, check the deployment.'); }
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
/* Reads JSON out of an AI reply. Models break it in five ways that all turn up
     in practice, and each one used to lose the whole answer:
       1. fenced in ```json blocks
       2. real line breaks inside quoted strings
       3. // and /* *\/ comments, which JSON does not allow
       4. prose after the closing brace ("I have assumed a sand casting {blank}")
       5. cut off mid-way because the reply hit the token limit
     The scan below walks the text once, tracking whether it is inside a string,
     so it can strip comments safely, stop at the real end of the object, and
     close anything left open by a truncated reply. */
  function parseAiJson(text){
    let t = String(text == null ? '' : text).replace(/```[a-z]*\n?|```/gi, '').trim();
    const start = t.search(/[{[]/);
    if (start < 0) throw new Error('The reply contained no JSON at all.');
    t = t.slice(start);

    let out = '', inStr = false, esc = false, quote = '"';
    const stack = [];
    let truncated = true;

    for (let i = 0; i < t.length; i++) {
      const c = t[i], code = t.charCodeAt(i);

      if (inStr) {
        if (esc) { out += c; esc = false; continue; }
        if (c === '\\') { out += c; esc = true; continue; }
        if (c === quote) { inStr = false; out += '"'; continue; }
        // a real newline or tab inside a string is not legal JSON
        if (code < 0x20) { out += c === '\n' ? '\\n' : c === '\r' ? '\\r' : c === '\t' ? '\\t' : ' '; continue; }
        if (c === '"') { out += '\\"'; continue; }   // a double quote inside a single-quoted string
        out += c;
        continue;
      }

      // outside a string: comments are stripped rather than passed to the parser
      if (c === '/' && t[i + 1] === '/') { while (i < t.length && t[i] !== '\n') i++; continue; }
      if (c === '/' && t[i + 1] === '*') { i += 2; while (i < t.length && !(t[i] === '*' && t[i + 1] === '/')) i++; i++; continue; }

      if (c === '"' || c === "'") { inStr = true; quote = c; out += '"'; continue; }
      if (c === '{' || c === '[') { stack.push(c === '{' ? '}' : ']'); out += c; continue; }
      if (c === '}' || c === ']') {
        stack.pop(); out += c;
        if (!stack.length) { truncated = false; break; }   // the object ended; ignore any prose after it
        continue;
      }
      out += c;
    }

    // a reply that ran out of tokens leaves a string and some brackets open
    if (truncated) {
      if (inStr) out += '"';
      // drop whatever fragment was half-written: a trailing comma, or a key
      // whose value never arrived. Closing brackets over "time": produces
      // {"name":"Turn","time"} which is not JSON either.
      for (let n = 0; n < 5; n++) {
        const before = out;
        out = out.replace(/,\s*$/, '')
                 .replace(/"(?:[^"\\]|\\.)*"\s*:\s*$/, '');
        /* a trailing string inside an object is a key whose colon never arrived
           — unless a colon precedes it, in which case it is a value that was
           cut short and is worth keeping. Inside an array it is an element. */
        if (stack[stack.length - 1] === '}' && !/:\s*"(?:[^"\\]|\\.)*"\s*$/.test(out))
          out = out.replace(/"(?:[^"\\]|\\.)*"\s*$/, '');
        out = out.replace(/,\s*$/, '');
        if (out === before) break;
      }
      while (stack.length) out += stack.pop();
    }
    out = out.replace(/,(\s*[}\]])/g, '$1');              // trailing commas

    try { return JSON.parse(out); }
    catch (e) {
      throw new Error((truncated
        ? 'The reply was cut off before it finished, and could not be repaired. '
        : 'The reply was not valid JSON. ') + e.message);
    }
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

  /* ---------------- Face ID: live, automatic scan ----------------
     Modelled on how Face ID behaves on a phone: the camera opens on its own,
     a ring shows where to put your face, the ring fills in as you hold
     still, and the scan fires by itself — nobody presses a shutter button.
     Model loading, live detection, steadiness, capture and result feedback
     all live in this one function so sign-in and enrolment behave the same. */
  let faceApiReady = null;
  function loadFaceApi() {
    if (faceApiReady) return faceApiReady;
    faceApiReady = new Promise((resolve, reject) => {
      if (window.faceapi) return resolve(window.faceapi);
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.js';
      s.onload = () => {
        const base = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
        Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(base),
          faceapi.nets.faceLandmark68Net.loadFromUri(base),
          faceapi.nets.faceRecognitionNet.loadFromUri(base)
        ]).then(() => resolve(window.faceapi)).catch(reject);
      };
      s.onerror = () => reject(new Error('Could not load the Face ID component. Check your internet connection.'));
      document.head.appendChild(s);
    });
    return faceApiReady;
  }
  function averageDescriptors(list) {
    const len = list[0].length, out = new Array(len).fill(0);
    list.forEach(d => { for (let i = 0; i < len; i++) out[i] += d[i]; });
    for (let i = 0; i < len; i++) out[i] /= list.length;
    return out;
  }
  const FACEID_STEADY_TARGET = 9;    // ~9 well-framed frames in a row before it captures
  const FACEID_MAX_RETRIES = 5;      // after this many misses, say so instead of just looping forever

  /* processFn(descriptor) runs once a steady, well-framed face has been
     captured, and must return (or resolve to) {ok:true, message} on success
     or {ok:false, message} on failure — throwing works too. On failure the
     scan just starts looking again on its own, the way Face ID quietly
     retries rather than making you tap a button after a missed read.
     Resolves with processFn's return value once ok, or null on cancel. */
  function scanFace(processFn, opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.className = 'faceid-modal';
      wrap.innerHTML =
        '<div class="faceid-box">' +
          '<h4>' + esc(opts.title || 'Face ID') + '</h4>' +
          '<div class="faceid-stage">' +
            '<video class="faceid-v" autoplay playsinline muted></video>' +
            '<svg class="faceid-ring" viewBox="0 0 200 200">' +
              '<ellipse class="ring-bg" cx="100" cy="100" rx="76" ry="92"></ellipse>' +
              '<ellipse class="ring-prog" cx="100" cy="100" rx="76" ry="92"></ellipse>' +
            '</svg>' +
            '<div class="faceid-result">' +
              '<svg class="ico-ok" viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M14 27l8 8 16-16"/></svg>' +
              '<svg class="ico-bad" viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M18 18l16 16M34 18L18 34"/></svg>' +
            '</div>' +
          '</div>' +
          '<div class="faceid-status">Starting camera…</div>' +
          '<button type="button" class="btn faceid-cancel">Cancel</button>' +
        '</div>';
      document.body.appendChild(wrap);

      const v = wrap.querySelector('.faceid-v');
      const ringProg = wrap.querySelector('.ring-prog');
      const stage = wrap.querySelector('.faceid-stage');
      const status = wrap.querySelector('.faceid-status');
      const bCancel = wrap.querySelector('.faceid-cancel');

      // Approximate perimeter of the guide ellipse (rx=76, ry=92) — exact
      // to the eye is all a progress ring needs.
      const RING_LEN = Math.PI * (3 * (76 + 92) - Math.sqrt((3 * 76 + 92) * (76 + 3 * 92)));
      ringProg.style.strokeDasharray = String(RING_LEN);
      ringProg.style.strokeDashoffset = String(RING_LEN);

      let stream = null, loopTimer = null, done = false;
      let steady = 0, lastBox = null, busy = false, retries = 0;

      const setStatus = (t, isErr) => { status.textContent = t; status.classList.toggle('err', !!isErr); };
      const setRing = (frac, cls) => {
        ringProg.style.strokeDashoffset = String(RING_LEN * (1 - Math.max(0, Math.min(1, frac))));
        ringProg.classList.toggle('ok', cls === 'ok');
        ringProg.classList.toggle('warn', cls === 'warn');
      };
      const stop = () => {
        if (loopTimer) clearTimeout(loopTimer);
        if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
      };
      const close = result => { if (done) return; done = true; stop(); wrap.remove(); resolve(result || null); };

      bCancel.addEventListener('click', () => close(null));
      wrap.addEventListener('click', e => { if (e.target === wrap) close(null); });

      const secure = location.protocol === 'https:' ||
        location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      if (!secure) { setStatus('Face ID needs a secure (https) connection.', true); bCancel.textContent = 'Close'; return; }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus('This browser cannot open a camera.', true); bCancel.textContent = 'Close'; return;
      }

      navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 640 } }, audio: false
      }).then(async st => {
        if (done) { st.getTracks().forEach(t => t.stop()); return; }
        stream = st; v.srcObject = st;
        try { await v.play(); } catch (e) {}
        setStatus('Loading Face ID…');
        await loadFaceApi();
        if (done) return;
        setStatus('Position your face in the frame');
        tick();
      }).catch(e => {
        setStatus('Camera access was blocked: ' + (e.message || e.name) + '. Allow camera access and try again.', true);
        bCancel.textContent = 'Close';
      });

      function schedule() { loopTimer = setTimeout(tick, 90); }

      async function tick() {
        if (done) return;
        if (busy || !v.videoWidth) return schedule();
        let det = null;
        try {
          det = await faceapi.detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }));
        } catch (e) { det = null; }
        if (done) return;

        if (!det) {
          steady = 0; lastBox = null; setRing(0);
          setStatus('Position your face in the frame');
          return schedule();
        }

        const vw = v.videoWidth, vh = v.videoHeight;
        // Video is shown mirrored (CSS scaleX(-1)); flip x so "centred"
        // matches what the person actually sees on screen.
        const cx = 1 - (det.box.x + det.box.width / 2) / vw;
        const cy = (det.box.y + det.box.height / 2) / vh;
        const areaFrac = (det.box.width * det.box.height) / (vw * vh);

        let msg = null;
        if (areaFrac < 0.10) msg = 'Move a little closer';
        else if (areaFrac > 0.55) msg = 'Move back a little';
        else if (cx < 0.32 || cx > 0.68 || cy < 0.16 || cy > 0.84) msg = 'Center your face in the frame';

        if (msg) {
          steady = Math.max(0, steady - 1); lastBox = det.box;
          setRing(steady / FACEID_STEADY_TARGET, 'warn');
          setStatus(msg);
          return schedule();
        }

        // Well framed — now confirm it's actually steady, not just a face
        // passing through the frame.
        const moved = lastBox ? Math.hypot(det.box.x - lastBox.x, det.box.y - lastBox.y) / vw : 1;
        lastBox = det.box;
        steady = moved > 0.05 ? Math.max(0, steady - 1) : steady + 1;
        setRing(steady / FACEID_STEADY_TARGET);
        setStatus(steady < FACEID_STEADY_TARGET ? 'Hold still…' : 'Scanning…');

        if (steady >= FACEID_STEADY_TARGET) { busy = true; await capture(); busy = false; }
        schedule();
      }

      async function capture() {
        setRing(1, 'ok'); setStatus('Scanning…');
        const shots = [];
        for (let i = 0; i < 3 && !done; i++) {
          try {
            const d = await faceapi.detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
              .withFaceLandmarks().withFaceDescriptor();
            if (d) shots.push(Array.from(d.descriptor));
          } catch (e) {}
          if (!done) await new Promise(r => setTimeout(r, 110));
        }
        if (done) return;
        if (shots.length < 2) {
          steady = 0; setRing(0);
          setStatus('That was too quick — hold still a moment.');
          return;
        }
        const descriptor = averageDescriptors(shots);
        setStatus('Checking…');
        let outcome;
        try { outcome = await processFn(descriptor); }
        catch (e) { outcome = { ok: false, message: e.message }; }
        if (done) return;

        if (outcome && outcome.ok) {
          stage.classList.add('show-ok');
          setStatus(outcome.message || 'Done');
          setTimeout(() => close(outcome), 700);
        } else {
          stage.classList.add('show-bad');
          setStatus((outcome && outcome.message) || 'Face not recognised.', true);
          retries++;
          setTimeout(() => {
            if (done) return;
            stage.classList.remove('show-bad');
            steady = 0; setRing(0);
            setStatus(retries >= FACEID_MAX_RETRIES
              ? 'Still no match. Try again, or use another sign-in method.'
              : 'Position your face in the frame');
          }, 1100);
        }
      }
    });
  }

  root.Core = {
    esc: esc, num: num, inr: inr, qty: qty, rate: rate, money: money, numberToWords: numberToWords,
    fmtDate: fmtDate, dayKey: dayKey,
    newId: newId, toast: toast,
    api: api, signIn: signIn, verifyCode: verifyCode, setToken: setToken, getToken: getToken,
    checkSession: checkSession, signOut: signOut,
    otpRequest: otpRequest, forgotStart: forgotStart, forgotReset: forgotReset,
    faceLogin: faceLogin, faceEnroll: faceEnroll, faceForget: faceForget,
    idms: idms, loadProfile: loadProfile, getProfile: getProfile, docNumber: docNumber,
    gstStateCode: gstStateCode, gstStateName: gstStateName,
    openReport: openReport, callAI: callAI, uploadFile: uploadFile,
    parseAiJson: parseAiJson, stripMarkup: stripMarkup,
    setFavicon: setFavicon,
    capturePhoto: capturePhoto, scanFace: scanFace,
    /* Lets a page start downloading the face-recognition model in the
       background (e.g. while the sign-in screen is idle) instead of only
       starting once someone actually clicks Face ID. loadFaceApi() already
       memoizes on faceApiReady, so calling it here just means scanFace()
       finds the model already loaded (or loading) instead of starting cold. */
    preloadFaceApi: loadFaceApi
  };
})(window);
