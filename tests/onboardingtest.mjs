/* Covers three additions to Recruitment, all reusing existing generic
   endpoints (no new tables, no new routes beyond the two public
   'onboarding' cases in api/hr.js):

   1. Candidate source (Careers/Portal/Consultancy/Referral/Direct) —
      non-careers sources skip straight to Interview.
   2. Offer letter — a projected TDS section using the same slab/rebate/
      surcharge engine Payroll already runs, not a separate AI guess.
   3. Self-fill onboarding: HR sends a token link (idms.html, native
      Recruitment) -> candidate fills it in (index.html, public) ->
      HR reviews and approves -> an employee record is created, merging
      what the candidate submitted, the same way Convert-to-Employee
      already builds one.

   Part A drives idms.html. Part B drives index.html for the public,
   token-gated form. Both mock /api/hr the same way the real handler
   answers so this checks the client wiring, not the server logic
   (api/hr.js's own two new public cases are plain enough to read). */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const idmsHtml = fs.readFileSync('idms.html', 'utf8');
const indexHtml = fs.readFileSync('index.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');
const conv = fs.readFileSync('drawing-convert.js', 'utf8');

const results = [];
const check = (n, c, x) => results.push([n, !!c, x || '']);
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ================= PART A — idms.html, HR side ================= */
{
  let items = [
    { item_id: 'REQ1', kind: 'requisition', status: 'Open',
      data: { itemId: 'REQ1', kind: 'requisition', status: 'Open', title: 'CNC Operator', department: 'Production' } }
  ];
  let employees = [];
  const calls = [];
  let signedIn = false;
  const vc = new VirtualConsole();
  const pageErrors = [];
  vc.on('jsdomError', e => pageErrors.push(e.message));
  const dom = new JSDOM(idmsHtml.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''),
    { runScripts: 'outside-only', url: 'https://example.test/idms.html', virtualConsole: vc });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.confirm = () => true;
  window.prompt = () => 'please attach a clearer bank proof';
  let opened = [];
  window.open = () => ({ document: { write: h => opened.push(h), close() {} }, print() {} });

  window.fetch = async (path, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : {};
    const url = String(path);
    const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
    if (url.startsWith('/api/auth')) {
      if (body.action === 'login') { signedIn = true; return ok({ token: 'T', user: 'tester', role: 'developer' }); }
      if (body.action === 'session') return signedIn ? ok({ user: 'tester', role: 'developer' }) : { ok: false, status: 401, json: async () => ({ error: 'Not signed in' }) };
      return ok({});
    }
    if (url.startsWith('/api/content')) return ok({ data: {
      company: { legalName: 'Test Mfg', docPrefix: 'TEST' },
      hrMasters: { empIdPrefix: 'EMP', empIdPad: 3, empIdNextSeq: 1 },
      salaryStructure: { basicPct: 50, daPct: 0, hraPct: 20, conveyance: 1600 },
      statutory: {
        pf: { employeePct: 12, employerPct: 12, wageCeiling: 15000 },
        esi: { employeePct: 0.75, employerPct: 3.25, grossLimit: 21000 },
        pt: { slabs: [{ upTo: 15000, amount: 0 }, { upTo: 9999999, amount: 200 }] },
        gratuity: { accrualPct: 4.81 }, bonus: { accrualPct: 8.33, wageCeiling: 7000 },
        tds: { enabled: true, defaultRegime: 'New', cessPct: 4, slabsReviewedBy: 'CA Rao',
          regimes: { New: { standardDeduction: 75000, rebateLimit: 700000, rebateAmount: 25000,
            slabs: [{ upTo: 300000, rate: 0 }, { upTo: 600000, rate: 5 }, { upTo: 900000, rate: 10 },
                     { upTo: 1200000, rate: 15 }, { upTo: 1500000, rate: 20 }, { upTo: 99999999, rate: 30 }],
            surcharge: [] } } }
      } } });
    if (url.startsWith('/api/rfqs')) return ok({ rfqs: [] });
    if (url.startsWith('/api/idms')) {
      if (url.includes('what=settings')) return ok({ settings: {} });
      if (url.includes('what=parts')) return ok({ parts: [] });
      if (url.includes('what=serial')) return ok({ next: 1 });
      if (url.includes('what=docs')) return ok({ docs: [] });
      return ok({});
    }
    if (url.startsWith('/api/ai')) { calls.push({ kind: 'ai', body }); return ok({ text: 'MATCH: 70\nVERDICT: fine\nDETAIL:\nok' }); }
    if (url.startsWith('/api/hr')) {
      if (url.includes('what=items') && (!opts.method || opts.method === 'GET')) return ok({ items });
      if (url.includes('what=employees') && (!opts.method || opts.method === 'GET')) return ok({ employees });
      if (opts.method === 'POST' && body.what === 'items') {
        calls.push({ kind: 'item-save', body });
        const it = body.item;
        const i = items.findIndex(x => x.item_id === it.itemId);
        const row = { item_id: it.itemId, kind: it.kind, status: it.status, data: it };
        if (i >= 0) items[i] = row; else items.push(row);
        return ok({ itemId: it.itemId });
      }
      if (opts.method === 'PATCH' && body.what === 'items') {
        calls.push({ kind: 'item-patch', body });
        const i = items.findIndex(x => x.item_id === body.itemId);
        if (i < 0) return { ok: true, status: 200, json: async () => ({ ok: false, error: 'Not found.' }) };
        if (body.remove) { items.splice(i, 1); return ok({ removed: body.itemId }); }
        const merged = Object.assign({}, items[i].data, body.patch || {});
        if (body.status) merged.status = body.status;
        items[i] = Object.assign({}, items[i], { data: merged, status: body.status || items[i].status });
        return ok({ item: merged });
      }
      if (opts.method === 'POST' && body.what === 'employees') {
        calls.push({ kind: 'emp-save', body });
        employees.push(body.employee);
        return ok({ empId: body.employee.empId });
      }
      return ok({});
    }
    if (url.startsWith('/api/notify')) { calls.push({ kind: 'notify', body }); return ok({ results: [] }); }
    return ok({});
  };

  window.eval(core); window.eval(kpi);
  window.eval(idmsHtml.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1]);

  const $ = id => window.document.getElementById(id);
  const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const change = el => el.dispatchEvent(new window.Event('change', { bubbles: true }));
  const nav = id => click(window.document.querySelector('#menubar [data-s="' + id + '"]'));
  const set = (id, v) => { $(id).value = v; };

  await wait(120);
  $('g-user').value = 'tester'; $('g-pass').value = 'x';
  $('g-go').dispatchEvent(new window.Event('click'));
  await wait(300);
  nav('recruitment');
  await wait(200);

  // ---------- source / direct entry ----------
  const reqId = items.find(i => i.kind === 'requisition').item_id;
  $('rc-cd-req').value = reqId;
  $('rc-cd-source').value = 'Job Portal'; change($('rc-cd-source'));
  await wait(50);
  check('choosing a non-careers source reveals the source-reference field',
    $('rc-cd-srcref-wrap').style.display !== 'none');
  set('rc-cd-name', 'Vikram Shah'); set('rc-cd-phone', '9876543210');
  set('rc-cd-srcref', 'Naukri — REF999');
  calls.length = 0;
  click($('rc-cd-add'));
  await wait(200);
  const candSave = calls.find(c => c.kind === 'item-save' && c.body.item.kind === 'candidate');
  check('a portal-sourced candidate is created', !!candSave, JSON.stringify(calls));
  check('a portal-sourced candidate starts straight at Interview, skipping screening',
    candSave && candSave.body.item.status === 'Interview', candSave && candSave.body.item.status);
  check('the source and its reference are recorded',
    candSave && candSave.body.item.source === 'Job Portal' && candSave.body.item.sourceRef === 'Naukri — REF999');
  check('the source shows up on the candidate card', /Job Portal/.test($('rc-cand-list').textContent));

  const candId = items.find(i => i.kind === 'candidate').item_id;

  // ---------- careers-sourced control: still starts at Applied ----------
  $('rc-cd-source').value = 'Careers Website'; change($('rc-cd-source'));
  $('rc-cd-req').value = reqId;
  set('rc-cd-name', 'Anita Rao'); set('rc-cd-phone', '9000000000');
  calls.length = 0;
  click($('rc-cd-add'));
  await wait(200);
  const careersSave = calls.find(c => c.kind === 'item-save' && c.body.item.kind === 'candidate' && c.body.item.name === 'Anita Rao');
  check('a careers-sourced candidate still starts at Applied, unchanged',
    careersSave && careersSave.body.item.status === 'Applied', careersSave && careersSave.body.item.status);

  // ---------- offer + projected TDS ----------
  click(window.document.querySelector('.rc-cand-head[data-cand="' + candId + '"]'));
  await wait(100);
  const offerInput = window.document.querySelector('.rc-cd-in[data-id="' + candId + '"][data-k="offerCtc"]');
  offerInput.value = '600000';
  offerInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  click(window.document.querySelector('.rc-cd-save[data-id="' + candId + '"]'));
  await wait(200);
  opened.length = 0;
  click(window.document.querySelector('.rc-cd-offer[data-id="' + candId + '"]'));
  await wait(150);
  const offerDoc = opened[0] || '';
  check('the offer letter includes a projected income tax (TDS) section',
    /Projected income tax/.test(offerDoc), offerDoc.slice(0, 300));
  check('the TDS section states it is provisional, not a final figure',
    /[Pp]rovisional/.test(offerDoc));
  check('the TDS section uses the same statutory config as Payroll, not an invented rate',
    /New regime/.test(offerDoc) || /standard deduction/i.test(offerDoc), offerDoc);

  // ---------- send onboarding link ----------
  calls.length = 0;
  const sendBtn = window.document.querySelector('.rc-cd-onb-send[data-id="' + candId + '"]');
  check('a Send onboarding link button is offered once an offer exists', !!sendBtn);
  click(sendBtn);
  await wait(200);
  const onbSave = calls.find(c => c.kind === 'item-save' && c.body.item.kind === 'onboarding');
  check('sending the link creates an onboarding record', !!onbSave, JSON.stringify(calls));
  check('the onboarding record starts as Sent with a token and a link', onbSave &&
    onbSave.body.item.status === 'Sent' && !!onbSave.body.item.token && !!onbSave.body.item.linkUrl);
  check('the onboarding record is tied back to the candidate',
    onbSave && onbSave.body.item.candId === candId);

  const onbId = items.find(i => i.kind === 'onboarding').item_id;
  const onbToken = items.find(i => i.kind === 'onboarding').data.token;

  // ---------- simulate the candidate having submitted (the public route's job,
  // covered in Part B below) so the review screen can be exercised here ----------
  const onbRow = items.find(i => i.item_id === onbId);
  onbRow.status = 'Submitted';
  onbRow.data = Object.assign({}, onbRow.data, { status: 'Submitted', submittedAt: '2026-09-10', formData: {
    name: 'Vikram Shah', dob: '1998-04-11', address: '12 MG Road, Bengaluru',
    emergencyName: 'Suresh Shah', emergencyPhone: '9999999999', education: 'ITI Fitter',
    pan: 'ABCDE1234F', aadhaar: '123412341234', bankName: 'HDFC', bankAcc: '00011122233', ifsc: 'HDFC0001234',
    nomineeName: 'Suresh Shah', nomineeRelation: 'Father', consent: true, dpdpConsent: true
  } });

  nav('recruitment');
  await wait(200);
  click(window.document.querySelector('.rc-cand-head[data-cand="' + candId + '"]'));
  await wait(100);
  check('a Submitted onboarding record shows a Review submission button',
    !!window.document.querySelector('.rc-cd-onb-review[data-id="' + onbId + '"]'));
  click(window.document.querySelector('.rc-cd-onb-review[data-id="' + onbId + '"]'));
  await wait(100);
  const cardHtml = $('rc-cand-list').textContent;
  check('the review panel shows what the candidate submitted', /HDFC0001234/.test(cardHtml) && /ABCDE1234F/.test(cardHtml));

  // ---------- approve: creates the employee, merging onboarding data ----------
  calls.length = 0;
  const approveBtn = window.document.querySelector('.rc-cd-onb-approve[data-id="' + onbId + '"]');
  check('an Approve — create employee record button is offered', !!approveBtn);
  click(approveBtn);
  await wait(250);
  const empCall = calls.find(c => c.kind === 'emp-save');
  check('approving creates a real employee record', !!empCall, JSON.stringify(calls));
  check('the employee record carries the candidate-submitted PAN and bank details',
    empCall && empCall.body.employee.pan === 'ABCDE1234F' && empCall.body.employee.bankAcc === '00011122233');
  check('the employee record carries the nominee details the candidate gave',
    empCall && empCall.body.employee.nomineeName === 'Suresh Shah');
  const candJoinedPatch = calls.find(c => c.kind === 'item-patch' && c.body.status === 'Joined');
  check('the candidate is marked Joined and linked to the new employee',
    candJoinedPatch && !!candJoinedPatch.body.patch.empId);
  const onbApprovedPatch = calls.find(c => c.kind === 'item-patch' && c.body.itemId === onbId && c.body.status === 'Approved');
  check('the onboarding record itself is marked Approved', !!onbApprovedPatch, JSON.stringify(calls));

  // ---------- request changes, on a second candidate ----------
  calls.length = 0;
  $('rc-cd-source').value = 'Employee Referral'; change($('rc-cd-source'));
  $('rc-cd-req').value = reqId;
  set('rc-cd-name', 'Deepak Kumar'); set('rc-cd-phone', '9111111111'); set('rc-cd-srcref', 'Priya Nair — EMP002');
  click($('rc-cd-add'));
  await wait(200);
  const cand2Id = items.find(i => i.kind === 'candidate' && i.data.name === 'Deepak Kumar').item_id;
  check('a referred candidate also skips straight to Interview',
    items.find(i => i.item_id === cand2Id).status === 'Interview');
  const items2 = items; // keep a manual onboarding record to exercise reject
  items2.push({ item_id: 'ONB2', kind: 'onboarding', status: 'Submitted',
    data: { itemId: 'ONB2', kind: 'onboarding', status: 'Submitted', candId: cand2Id, candidateName: 'Deepak Kumar',
      token: 'tok2', formData: { name: 'Deepak Kumar', dob: '1997-01-01', consent: true, bankAcc: '111', pan: 'X' } } });
  nav('recruitment'); await wait(200);
  click(window.document.querySelector('.rc-cand-head[data-cand="' + cand2Id + '"]'));
  await wait(100);
  click(window.document.querySelector('.rc-cd-onb-review[data-id="ONB2"]'));
  await wait(100);
  calls.length = 0;
  const rejectBtn = window.document.querySelector('.rc-cd-onb-reject[data-id="ONB2"]');
  check('a Request changes button is offered on a submitted record', !!rejectBtn);
  click(rejectBtn);
  await wait(200);
  const rejectPatch = calls.find(c => c.kind === 'item-patch' && c.body.itemId === 'ONB2');
  check('requesting changes sends the record back with HR\'s note, not silently',
    rejectPatch && rejectPatch.body.status === 'Changes Requested' &&
    /clearer bank proof/.test(rejectPatch.body.patch.hrNote), JSON.stringify(rejectPatch));
  check('no employee is created when changes are requested instead of approved',
    !calls.find(c => c.kind === 'emp-save'));

  check('no console errors while any of Part A ran', pageErrors.length === 0, pageErrors.join(' | '));
}

/* ================= PART B — index.html, the public onboarding page ================= */
async function bootPublic(url, mockGet) {
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', e => errs.push(e.message));
  const calls = [];
  const dom = new JSDOM(indexHtml.replace('<script src="/drawing-convert.js"></script>', ''),
    { runScripts: 'outside-only', url, virtualConsole: vc });
  const { window } = dom;
  window.fetch = async (path, opts = {}) => {
    const url2 = String(path);
    const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
    if (url2.startsWith('/api/auth')) return ok({});
    if (url2.startsWith('/api/content')) return ok({ data: null });
    if (url2.startsWith('/api/hr')) {
      if (url2.includes('what=onboarding') && (!opts.method || opts.method === 'GET')) return ok(mockGet());
      if (opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        calls.push(body);
        return ok({});
      }
      return ok({ items: [], employees: [], jobs: [] });
    }
    if (url2.startsWith('/api/rfqs')) return ok({ rfqs: [] });
    return ok({});
  };
  window.eval(conv);
  const inline = indexHtml.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1];
  window.eval(inline);
  await wait(300);
  return { window, errs, calls };
}

{
  const { window, errs } = await bootPublic('https://example.test/?onboard=tok1', () => ({
    status: 'Sent', candidateName: 'Vikram Shah', designation: 'CNC Operator', hrNote: '', formData: null
  }));
  await wait(150);
  check('the onboarding page opens for a valid, unfilled link',
    window.document.getElementById('onboard-page').classList.contains('open'));
  check('the candidate\'s name is greeted on the form',
    /Vikram Shah/.test(window.document.getElementById('onb-body').textContent));
  check('the name field is pre-filled from the candidate record',
    window.document.getElementById('onb-name').value === 'Vikram Shah');
  check('a required field (date of birth) is present', !!window.document.getElementById('onb-dob'));
  check('document upload fields are present', !!window.document.getElementById('onb-idProofUrl'));
  check('the consent declaration checkbox is present', !!window.document.getElementById('onb-consent'));

  // submitting without required fields should not call the server
  const submitBtn = window.document.getElementById('onb-submit');
  submitBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(100);
  check('an empty required field blocks submission with a message, not a silent failure',
    window.document.getElementById('onb-msg').textContent.length > 0);
  check('no console errors on an incomplete submit attempt', errs.length === 0, errs.join(' | '));
}

{
  const { window, calls } = await bootPublic('https://example.test/?onboard=tok1', () => ({
    status: 'Sent', candidateName: 'Vikram Shah', designation: 'CNC Operator', hrNote: '', formData: null
  }));
  await wait(150);
  const set = (id, v) => { window.document.getElementById(id).value = v; };
  set('onb-dob', '1998-04-11'); set('onb-address', '12 MG Road, Bengaluru');
  set('onb-emergencyName', 'Suresh Shah'); set('onb-emergencyPhone', '9999999999');
  set('onb-education', 'ITI Fitter'); set('onb-pan', 'ABCDE1234F'); set('onb-aadhaar', '123412341234');
  set('onb-bankName', 'HDFC'); set('onb-bankAcc', '00011122233'); set('onb-ifsc', 'HDFC0001234');
  window.document.getElementById('onb-consent').checked = true;
  window.document.getElementById('onb-submit').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(200);
  check('a fully filled-in form submits to the public onboarding route',
    calls.length > 0 && calls[0].what === 'onboarding' && calls[0].token === 'tok1', JSON.stringify(calls));
  check('the submitted data carries the candidate-entered PAN and bank details',
    calls[0] && calls[0].formData.pan === 'ABCDE1234F' && calls[0].formData.bankAcc === '00011122233');
  check('the consent declaration is included and true',
    calls[0] && calls[0].formData.consent === true);
}

{
  const { window } = await bootPublic('https://example.test/?onboard=tok1', () => ({
    status: 'Submitted', candidateName: 'Vikram Shah'
  }));
  await wait(150);
  check('a Submitted link shows a waiting message instead of the form',
    /waiting for HR to review/i.test(window.document.getElementById('onb-body').textContent));
  check('no form fields are shown once already submitted', !window.document.getElementById('onb-dob'));
}

{
  const { window } = await bootPublic('https://example.test/?onboard=tok1', () => ({
    status: 'Approved', candidateName: 'Vikram Shah'
  }));
  await wait(150);
  check('an Approved link shows a welcome message', /all set/i.test(window.document.getElementById('onb-body').textContent));
}

{
  const { window } = await bootPublic('https://example.test/?onboard=badtoken', () => ({
    ok: false, error: 'This onboarding link is not valid. Please ask HR to send it again.'
  }));
  await wait(150);
  check('an invalid token shows a clear, non-generic error instead of a blank or crashed page',
    /not valid/i.test(window.document.getElementById('onb-body').textContent));
}

const failed = results.filter(([, ok]) => !ok);
for (const [n, ok, x] of results) console.log((ok ? '  ok  ' : '  X   ') + n + (ok ? '' : '   [' + x + ']'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, of ${results.length}`);
process.exit(failed.length ? 1 : 0);
