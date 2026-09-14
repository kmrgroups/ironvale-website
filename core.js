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
  function numberToWords(n, currency) {
    if (currency === 'USD') return dollarsToWords(n);
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
  /* A dollar invoice is read in the international scale — million, not lakh.
     Writing "Ten Lakh US Dollars" on an export invoice is the kind of thing a
     customer's accounts department sends back. */
  function dollarsToWords(n) {
    n = Math.round(num(n) * 100) / 100;
    const whole = Math.floor(n), cents = Math.round((n - whole) * 100);
    var r = whole, parts = [];
    const billion = Math.floor(r / 1000000000); r %= 1000000000;
    const million = Math.floor(r / 1000000); r %= 1000000;
    const thousand = Math.floor(r / 1000); r %= 1000;
    if (billion) parts.push(threeDigitWords(billion) + ' Billion');
    if (million) parts.push(threeDigitWords(million) + ' Million');
    if (thousand) parts.push(threeDigitWords(thousand) + ' Thousand');
    if (r) parts.push(threeDigitWords(r));
    var out = 'US Dollars ' + (parts.join(' ') || 'Zero');
    if (cents) out += ' and ' + twoDigitWords(cents) + ' Cents';
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
     The token lives in sessionStorage, so it dies with the browser and is
     never written anywhere a closed-and-reopened browser could find it.

     A tab opened from a tab that is already signed in (right-click → Open
     Link in New Tab / New Window, ctrl-click, middle-click) does NOT ask for
     a second sign-in — that was an explicit requirement, and it reverses the
     earlier one-sign-in-per-tab rule. It works by asking, not by storing:
     the new tab calls out on a same-origin BroadcastChannel and any tab of
     this system that is signed in answers with its token (see shareSession()
     and askOpenTabs() below). If no signed-in tab is open, nobody answers and
     the sign-in screen stands exactly as before.

     So the two standing rules still hold: the browser never saves or refills
     the sign-in, and opening the system with no signed-in tab already open
     signs nobody in. Closing the last tab is still signing out.

     checkSession() still asks the server whether a token is good, so a token
     handed over by another tab is checked before it is used, never trusted
     blindly. */
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
    const was = token;
    try {
      await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) });
    } catch (e) { /* the local token goes either way */ }
    setToken('');
    /* Every tab using this session is now holding a dead token. Tell them,
       so they return to the sign-in screen at once instead of failing on
       their next save with "your session has ended". */
    if (was) tabPost({ type: 'signed-out', token: was });
  }

  /* ---------------- sharing a session with tabs opened from this one -------
     One channel, same-origin only (the browser enforces that). Three messages:
       ask        a new tab asking whether anybody here is signed in
       answer     a signed-in tab replying, with its token, to that ask
       signed-out a tab that signed out, naming the token that is now dead
     A tab only answers while it is actually signed in to the app — a tab
     sitting on the sign-in screen has nothing to give. */
  const TAB_CHANNEL = 'idms-session';
  let tabChannel = null;
  try { tabChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(TAB_CHANNEL) : null; }
  catch (e) { tabChannel = null; }
  let shareWhile = null;             // () => boolean — is this tab signed in right now?
  let onSignedOutElsewhere = null;   // called when another tab ends the session we share
  function tabPost(msg) {
    try { if (tabChannel) tabChannel.postMessage(msg); } catch (e) { /* nothing to tell */ }
  }
  if (tabChannel) {
    tabChannel.addEventListener('message', ev => {
      const m = ev.data || {};
      if (m.type === 'ask' && token && shareWhile && shareWhile()) {
        tabPost({ type: 'answer', nonce: m.nonce, token: token });
      }
      if (m.type === 'signed-out' && m.token && m.token === token) {
        setToken('');
        if (onSignedOutElsewhere) onSignedOutElsewhere();
      }
    });
  }
  /* Called by a signed-in page: answer asks while isSignedIn() says so. */
  function shareSession(isSignedIn, signedOutElsewhere) {
    shareWhile = isSignedIn;
    onSignedOutElsewhere = signedOutElsewhere || null;
  }
  /* Called by a page as it opens: resolves with a token from an open,
     signed-in tab, or '' if none answers within waitMs. The first answer
     wins; every answer carries the same shared session anyway. */
  function askOpenTabs(waitMs) {
    return new Promise(resolve => {
      if (!tabChannel) return resolve('');
      const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
      let done = false;
      const finish = t => {
        if (done) return; done = true;
        try { tabChannel.removeEventListener('message', hear); } catch (e) {}
        resolve(t || '');
      };
      const hear = ev => {
        const m = ev.data || {};
        if (m.type === 'answer' && m.nonce === nonce && m.token) finish(m.token);
      };
      tabChannel.addEventListener('message', hear);
      tabPost({ type: 'ask', nonce: nonce });
      setTimeout(() => finish(''), waitMs || 600);
    });
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
    let dataUrl = await new Promise((ok, no) => {
      const r = new FileReader();
      r.onload = () => ok(r.result);
      r.onerror = () => no(new Error('The file could not be read.'));
      r.readAsDataURL(file);
    });
    /* Some files arrive with no type at all (a .docx saved by certain tools,
       a .csv on some Windows set-ups), which makes the data URL read
       "data:;base64," — the store refuses that, and the upload failed with a
       message about data URLs nobody could act on. Store it as a plain file. */
    if (/^data:;base64,/.test(String(dataUrl)))
      dataUrl = 'data:application/octet-stream;base64,' + String(dataUrl).slice(13);
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

  /* ---------------- QR codes, drawn here ----------------
     Invoices carry two: the e-invoice QR (the signed string the GST portal
     returns) and a UPI payment QR. Both hold figures that must not be sent to
     a third-party image service — an invoice value, two GSTINs, a bank's UPI
     handle — so the code is generated in the browser. This is the standard
     ISO/IEC 18004 construction in byte mode (the same algorithm as Project
     Nayuki's reference encoder): versions 1–40, Reed–Solomon error correction,
     all eight masks tried and the lowest-penalty one kept. Returns SVG markup
     with a four-module quiet zone, or '' if the text is too long for any
     version. */
  const QR_ECC_PER_BLOCK = [
    [-1,7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    [-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28],
    [-1,13,22,18,26,18,24,18,22,20,24,28,26,24,20,30,24,28,28,26,30,28,30,30,30,30,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    [-1,17,28,22,16,22,28,26,26,24,28,24,28,22,24,24,30,28,28,26,28,30,24,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30]];
  const QR_NUM_BLOCKS = [
    [-1,1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25],
    [-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49],
    [-1,1,1,2,2,4,4,6,6,8,8,8,10,12,16,12,17,16,18,21,20,23,23,25,27,29,34,34,35,38,40,43,45,48,51,53,56,59,62,65,68],
    [-1,1,1,2,4,4,4,5,6,8,8,11,11,16,16,18,16,19,21,25,25,25,34,30,32,35,37,40,42,45,48,51,54,57,60,63,66,70,74,77,81]];
  const QR_FORMAT_ECL = [1, 0, 3, 2];   // L, M, Q, H as written into the format bits

  function qrMatrix(text, eclIndex) {
    const ecl = eclIndex == null ? 1 : eclIndex;
    const bytes = Array.from(new TextEncoder().encode(String(text)));
    const rawModules = v => {
      let r = (16 * v + 128) * v + 64;
      if (v >= 2) { const na = Math.floor(v / 7) + 2; r -= (25 * na - 10) * na - 55; if (v >= 7) r -= 36; }
      return r;
    };
    const dataCodewords = v => Math.floor(rawModules(v) / 8) - QR_ECC_PER_BLOCK[ecl][v] * QR_NUM_BLOCKS[ecl][v];
    let ver = 0;
    for (let v = 1; v <= 40; v++) {
      const need = 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
      if (need <= dataCodewords(v) * 8) { ver = v; break; }
    }
    if (!ver) return null;

    /* the bit stream: byte mode, count, data, terminator, padding */
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(4, 4); push(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(b => push(b, 8));
    const cap = dataCodewords(ver) * 8;
    push(0, Math.min(4, cap - bits.length));
    push(0, (8 - bits.length % 8) % 8);
    for (let pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) push(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b);
    }

    /* Reed–Solomon over GF(256), polynomial 0x11D */
    const mul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z; };
    const divisor = deg => {
      const r = []; for (let i = 0; i < deg - 1; i++) r.push(0); r.push(1);
      let root = 1;
      for (let i = 0; i < deg; i++) {
        for (let j = 0; j < r.length; j++) { r[j] = mul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
        root = mul(root, 0x02);
      }
      return r;
    };
    const remainder = (dat, div) => {
      const r = div.map(() => 0);
      dat.forEach(b => { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= mul(c, f); }); });
      return r;
    };
    const numBlocks = QR_NUM_BLOCKS[ecl][ver], eccLen = QR_ECC_PER_BLOCK[ecl][ver];
    const rawCw = Math.floor(rawModules(ver) / 8);
    const numShort = numBlocks - rawCw % numBlocks, shortLen = Math.floor(rawCw / numBlocks);
    const div = divisor(eccLen), blocks = [];
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
      k += dat.length;
      const ecc = remainder(dat, div);
      if (i < numShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const all = [];
    for (let i = 0; i < blocks[0].length; i++)
      blocks.forEach((blk, j) => { if (i !== shortLen - eccLen || j >= numShort) all.push(blk[i]); });

    /* the grid */
    const size = ver * 4 + 17;
    const mod = [], fn = [];
    for (let y = 0; y < size; y++) { mod.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    const setF = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };
    const bit = (v, i) => ((v >>> i) & 1) !== 0;
    for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const align = [];
    if (ver > 1) {
      const na = Math.floor(ver / 7) + 2;
      const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2;
      align.push(6);
      for (let pos = size - 7; align.length < na; pos -= step) align.splice(1, 0, pos);
    }
    align.forEach((ay, i) => align.forEach((ax, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
        setF(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    const formatBits = mask => {
      const d = QR_FORMAT_ECL[ecl] << 3 | mask;
      let rem = d;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const b = (d << 10 | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) setF(8, i, bit(b, i));
      setF(8, 7, bit(b, 6)); setF(8, 8, bit(b, 7)); setF(7, 8, bit(b, 8));
      for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(b, i));
      for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(b, i));
      for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(b, i));
      setF(8, size - 8, true);
    };
    formatBits(0);
    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const b = ver << 12 | rem;
      for (let i = 0; i < 18; i++) {
        const a = size - 11 + i % 3, c = Math.floor(i / 3);
        setF(a, c, bit(b, i)); setF(c, a, bit(b, i));
      }
    }
    let n = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && n < all.length * 8) { mod[y][x] = bit(all[n >>> 3], 7 - (n & 7)); n++; }
      }
    }
    const applyMask = m => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        let inv;
        switch (m) {
          case 0: inv = (x + y) % 2 === 0; break;
          case 1: inv = y % 2 === 0; break;
          case 2: inv = x % 3 === 0; break;
          case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: inv = x * y % 2 + x * y % 3 === 0; break;
          case 6: inv = (x * y % 2 + x * y % 3) % 2 === 0; break;
          default: inv = ((x + y) % 2 + x * y % 3) % 2 === 0;
        }
        if (inv && !fn[y][x]) mod[y][x] = !mod[y][x];
      }
    };
    const penalty = () => {
      let score = 0;
      const addHist = (len, h) => { if (h[0] === 0) len += size; h.pop(); h.unshift(len); };
      const count = h => {
        const k = h[1], core = k > 0 && h[2] === k && h[3] === k * 3 && h[4] === k && h[5] === k;
        return (core && h[0] >= k * 4 && h[6] >= k ? 1 : 0) + (core && h[6] >= k * 4 && h[0] >= k ? 1 : 0);
      };
      const terminate = (color, len, h) => { if (color) { addHist(len, h); len = 0; } len += size; addHist(len, h); return count(h); };
      for (let pass = 0; pass < 2; pass++) {
        for (let a = 0; a < size; a++) {
          let color = false, run = 0; const h = [0, 0, 0, 0, 0, 0, 0];
          for (let b = 0; b < size; b++) {
            const cell = pass === 0 ? mod[a][b] : mod[b][a];
            if (cell === color) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
            else { addHist(run, h); if (!color) score += count(h) * 40; color = cell; run = 1; }
          }
          score += terminate(color, run, h) * 40;
        }
      }
      let dark = 0;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (mod[y][x]) dark++;
        if (y < size - 1 && x < size - 1) {
          const c = mod[y][x];
          if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) score += 3;
        }
      }
      const total = size * size;
      score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
      return score;
    };
    let best = 0, bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); formatBits(m);
      const s = penalty();
      if (s < bestScore) { best = m; bestScore = s; }
      applyMask(m);
    }
    applyMask(best); formatBits(best);
    return { size: size, version: ver, modules: mod };
  }

  function qrSvg(text, opts) {
    opts = opts || {};
    let q = qrMatrix(text, 1);
    if (!q) q = qrMatrix(text, 0);          // too long at M — L holds a little more
    if (!q) return '';
    const border = 4, dim = q.size + border * 2;
    let d = '';
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++)
      if (q.modules[y][x]) d += 'M' + (x + border) + ',' + (y + border) + 'h1v1h-1z';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim + '"' +
      ' shape-rendering="crispEdges"' + (opts.size ? ' width="' + opts.size + '" height="' + opts.size + '"' : '') +
      ' role="img" aria-label="' + esc(opts.label || 'QR code') + '">' +
      '<rect width="' + dim + '" height="' + dim + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }

  root.Core = {
    esc: esc, num: num, inr: inr, qty: qty, rate: rate, money: money, numberToWords: numberToWords,
    fmtDate: fmtDate, dayKey: dayKey,
    newId: newId, toast: toast,
    api: api, signIn: signIn, verifyCode: verifyCode, setToken: setToken, getToken: getToken,
    checkSession: checkSession, signOut: signOut,
    shareSession: shareSession, askOpenTabs: askOpenTabs, qrSvg: qrSvg,
    otpRequest: otpRequest, forgotStart: forgotStart, forgotReset: forgotReset,
    faceLogin: faceLogin, faceEnroll: faceEnroll, faceForget: faceForget,
    idms: idms, loadProfile: loadProfile, getProfile: getProfile, docNumber: docNumber,
    gstStateCode: gstStateCode, gstStateName: gstStateName, gstStates: GST_STATE,
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
