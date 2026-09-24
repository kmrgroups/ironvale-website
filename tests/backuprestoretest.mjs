/* Fix 2/3 verification: Backup & Restore now also covers registered
   attendance devices (settings scope) and counters/attendance/leave/
   training/payruns/RFQs/PPC orders (data scope), several endpoints gained
   limit/offset so a backup can no longer silently truncate at the old
   per-screen cap, and restoring an RFQ must never resend a real
   notification to the customer or the owner.

   Part 1 drives the real server/routes/rfqs.js handler end to end (a
   module hook swaps its _db.js and notify.js imports for tiny in-memory/
   recording fakes — the same technique devicetest.mjs and
   flushservertest.mjs use, pointed at this checkout's real file, which
   lives under server/routes/ rather than api/). It proves the one thing
   that actually matters at the source: body.restore===true never reaches
   sendNotification, an ordinary public submission still does (so the fake
   cannot be trivially "always empty"), restore is refused unless signed
   in, restoring the same reference twice updates it rather than silently
   no-op-ing behind the public path's ON CONFLICT DO NOTHING, and the new
   GET limit/offset actually slices the result set rather than always
   answering with the same page.

   Part 2 drives the real idms.html Backup & Restore screen in jsdom (the
   same harness selfreloadtest.mjs uses, extended with a Blob/file-input
   capture so a download and an upload can be driven without a real
   browser). It proves the client side: the settings export/import
   round-trips registered devices, with the never-auto-reload-behind-a-
   one-time-key rule intact; the data export/import covers every new
   module end to end; bkFetchAll genuinely loops across more than one page
   for a collection bigger than its own page size, rather than the loop
   silently exiting after page one; and every RFQ the client restores is
   sent with restore:true. */
import fs from 'fs';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const results = [];
const check = (n, c, x) => results.push([n, !!c, x || '']);
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ==================== Part 1: server/routes/rfqs.js ==================== */
{
  const fakeDbSrc = `
    export const db = { sessions: {}, rfqs: {} };
    let seq = 0;
    export async function ensureTables() {}
    export function cors() {}
    export async function checkToken(t) { return !!db.sessions[t]; }
    export function readBody(req) { return req.body || {}; }
    export function sql(strings, ...vals) {
      const text = strings.join('?').replace(/\\s+/g, ' ').trim();
      const v = vals;
      const T = re => re.test(text);
      if (T(/^SELECT data FROM rfqs WHERE ref = \\?$/)) {
        const row = db.rfqs[v[0]];
        return row ? [{ data: row.data }] : [];
      }
      if (T(/^SELECT data FROM rfqs ORDER BY created_at DESC LIMIT \\? OFFSET \\?$/)) {
        const rows = Object.values(db.rfqs).sort((a, b) => b.created_at - a.created_at);
        return rows.slice(v[1], v[1] + v[0]).map(r => ({ data: r.data }));
      }
      if (T(/^INSERT INTO rfqs \\(ref, data\\) VALUES \\(\\?, \\?::jsonb\\) ON CONFLICT \\(ref\\) DO UPDATE SET data = \\?::jsonb$/)) {
        const [ref, dataStr] = v;
        const existing = db.rfqs[ref];
        db.rfqs[ref] = { data: JSON.parse(dataStr), created_at: existing ? existing.created_at : ++seq };
        return [];
      }
      if (T(/^INSERT INTO rfqs \\(ref, data\\) VALUES \\(\\?, \\?::jsonb\\) ON CONFLICT \\(ref\\) DO NOTHING$/)) {
        const [ref, dataStr] = v;
        if (!db.rfqs[ref]) db.rfqs[ref] = { data: JSON.parse(dataStr), created_at: ++seq };
        return [];
      }
      throw new Error('rfqs-fake-db: unrecognised statement: ' + text);
    }
  `;
  const fakeNotifySrc = `
    export const notifyCalls = [];
    export async function sendNotification(kind, payload, notifyEmail, notifyWhatsapp) {
      notifyCalls.push({ kind, payload, notifyEmail, notifyWhatsapp });
      return ['fake sent: ' + kind];
    }
  `;
  const fakeDbUrl = 'data:text/javascript,' + encodeURIComponent(fakeDbSrc);
  const fakeNotifyUrl = 'data:text/javascript,' + encodeURIComponent(fakeNotifySrc);

  register('data:text/javascript,' + encodeURIComponent(`
    export async function resolve(spec, ctx, next) {
      if (spec === '../server/_db.js' && ctx.parentURL && ctx.parentURL.endsWith('/server/routes/rfqs.js'))
        return { url: ${JSON.stringify(fakeDbUrl)}, shortCircuit: true };
      if (spec === './notify.js' && ctx.parentURL && ctx.parentURL.endsWith('/server/routes/rfqs.js'))
        return { url: ${JSON.stringify(fakeNotifyUrl)}, shortCircuit: true };
      return next(spec, ctx);
    }
  `));

  const { db } = await import(fakeDbUrl);
  const { notifyCalls } = await import(fakeNotifyUrl);
  const handler = (await import('../server/routes/rfqs.js')).default;

  function call({ method = 'GET', query = {}, headers = {}, body }) {
    return new Promise(resolve => {
      const req = { method, query, headers, body: body !== undefined ? body : {} };
      const res = {
        statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; },
        json(x) { resolve({ status: this.statusCode, json: x }); },
        end() { resolve({ status: this.statusCode }); }
      };
      handler(req, res);
    });
  }

  db.sessions.ADMIN = { username: 'asha', role: 'developer' };

  // An ordinary public submission still notifies — proves the fake is live, not just empty.
  let r = await call({ method: 'POST', body: { rfq: { ref: 'RFQ-NEW1', name: 'Anu', email: 'a@x.com' } } });
  check('an ordinary public RFQ submission is accepted', r.status === 200 && r.json.ok, JSON.stringify(r.json));
  check('…and does send the real owner + acknowledgement notifications',
    notifyCalls.length === 2 && notifyCalls[0].kind === 'rfq_received' && notifyCalls[1].kind === 'rfq_acknowledge',
    JSON.stringify(notifyCalls));

  notifyCalls.length = 0;

  // Restoring the same shape of record, flagged restore:true, must notify nobody at all.
  r = await call({ method: 'POST', headers: { 'x-auth-token': 'ADMIN' },
    body: { rfq: { ref: 'RFQ-OLD1', name: 'Priya', email: 'p@x.com', status: 'Won' }, restore: true } });
  check('a restored RFQ is accepted and reports restored:true', r.status === 200 && r.json.ok && r.json.restored === true, JSON.stringify(r.json));
  check('…and sends no notification of any kind', notifyCalls.length === 0, JSON.stringify(notifyCalls));

  // Restore is staff-only — an unauthenticated attempt is refused, and still sends nothing.
  r = await call({ method: 'POST', body: { rfq: { ref: 'RFQ-OLD2', name: 'X', email: 'x@x.com' }, restore: true } });
  check('an unauthenticated restore attempt is refused (401)', r.status === 401, JSON.stringify(r));
  check('…and still sends nothing', notifyCalls.length === 0);

  // Re-running the same backup must update the record, not silently no-op behind
  // the public path's ON CONFLICT DO NOTHING dedupe.
  r = await call({ method: 'POST', headers: { 'x-auth-token': 'ADMIN' },
    body: { rfq: { ref: 'RFQ-OLD1', name: 'Priya', email: 'p@x.com', status: 'Closed' }, restore: true } });
  check('restoring the same reference again updates it rather than silently no-op-ing',
    db.rfqs['RFQ-OLD1'] && db.rfqs['RFQ-OLD1'].data.status === 'Closed', JSON.stringify(db.rfqs['RFQ-OLD1']));
  check('…and still sends nothing on the re-run', notifyCalls.length === 0);

  // Pagination: GET must honour limit/offset, not just always answer the same page.
  // Explicit increasing created_at values make the DESC ordering deterministic.
  let seqv = 100;
  ['RFQ-PA', 'RFQ-PB', 'RFQ-PC'].forEach(ref => { db.rfqs[ref] = { data: { ref: ref }, created_at: ++seqv }; });
  r = await call({ method: 'GET', headers: { 'x-auth-token': 'ADMIN' }, query: { limit: '2', offset: '0' } });
  const page1 = (r.json.rfqs || []).map(x => x.ref);
  r = await call({ method: 'GET', headers: { 'x-auth-token': 'ADMIN' }, query: { limit: '2', offset: '2' } });
  const page2 = (r.json.rfqs || []).map(x => x.ref);
  check('GET honours limit — a page has no more than what was asked for', page1.length === 2, JSON.stringify(page1));
  check('GET honours offset — the second page is disjoint from the first',
    page2.length > 0 && page1.every(ref => !page2.includes(ref)), JSON.stringify({ page1, page2 }));
  r = await call({ method: 'GET', headers: { 'x-auth-token': 'ADMIN' } });
  check('GET with no limit still defaults sensibly (does not throw, returns everything on file)',
    Array.isArray(r.json.rfqs) && r.json.rfqs.length === Object.keys(db.rfqs).length);
}

/* ==================== Part 1b: server/routes/assets.js ==================== */
{
  const fakeDbSrc = `
    export const db = { sessions: {}, assets: {} };
    export async function ensureTables() {}
    export function cors() {}
    export async function checkToken(t) { return !!db.sessions[t]; }
    export function readBody(req) { return req.body || {}; }
    export function sql(strings, ...vals) {
      const text = strings.join('?').replace(/\\s+/g, ' ').trim();
      const v = vals;
      const T = re => re.test(text);
      /* One INSERT statement serves both an ordinary upload (fresh id, so the
         conflict branch never fires) and a restore (existing id, which it
         updates). A plain INSERT with no ON CONFLICT is deliberately NOT
         recognised here: if the upsert is ever reverted, the second restore
         of the same backup would hit a duplicate-key error rather than
         updating, and this fake would surface that as an unrecognised
         statement instead of quietly passing. */
      if (T(/^INSERT INTO assets \\(id, mime, data\\) VALUES \\(\\?, \\?, \\?\\) ON CONFLICT \\(id\\) DO UPDATE SET mime = \\?, data = \\?$/)) {
        const [id, mime, data] = v;
        db.assets[id] = { id, mime, data };
        return [];
      }
      if (T(/^SELECT mime, data FROM assets WHERE id = \\?$/)) {
        const a = db.assets[v[0]];
        return a ? [{ mime: a.mime, data: a.data }] : [];
      }
      if (T(/^SELECT id, mime, length\\(data\\) AS bytes, created_at FROM assets ORDER BY created_at DESC$/))
        return Object.values(db.assets).map(a => ({ id: a.id, mime: a.mime, bytes: a.data.length }));
      if (T(/^DELETE FROM assets WHERE id = \\?$/)) { delete db.assets[v[0]]; return []; }
      throw new Error('assets-fake-db: unrecognised statement: ' + text);
    }
  `;
  const fakeDbUrl = 'data:text/javascript,' + encodeURIComponent(fakeDbSrc);
  register('data:text/javascript,' + encodeURIComponent(`
    export async function resolve(spec, ctx, next) {
      if (spec === '../server/_db.js' && ctx.parentURL && ctx.parentURL.endsWith('/server/routes/assets.js'))
        return { url: ${JSON.stringify(fakeDbUrl)}, shortCircuit: true };
      return next(spec, ctx);
    }
  `));
  const { db } = await import(fakeDbUrl);
  const handler = (await import('../server/routes/assets.js')).default;

  function call({ method = 'GET', query = {}, headers = {}, body }) {
    return new Promise(resolve => {
      const req = { method, query, headers, body: body !== undefined ? body : {} };
      const res = {
        statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; },
        json(x) { resolve({ status: this.statusCode, json: x }); },
        send(x) { resolve({ status: this.statusCode, buf: x }); },
        end() { resolve({ status: this.statusCode }); }
      };
      handler(req, res);
    });
  }

  db.sessions.ADMIN = { username: 'asha', role: 'developer' };
  const onePxPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  // An ordinary upload (no id) still mints a fresh one, unaffected by the new code path.
  let r = await call({ method: 'POST', headers: { 'x-auth-token': 'ADMIN' },
    body: { dataUrl: 'data:image/png;base64,' + onePxPng } });
  check('an ordinary upload with no id is accepted and mints one', r.status === 200 && r.json.ok && r.json.id, JSON.stringify(r.json));
  check('…and is not the literal string "undefined" or empty', r.json.id !== 'undefined' && r.json.id.length > 0);

  // A restore-supplied id is honoured exactly, not replaced with a fresh one —
  // this is the whole point: every existing reference to that id must resolve.
  r = await call({ method: 'POST', headers: { 'x-auth-token': 'ADMIN' },
    body: { dataUrl: 'data:image/png;base64,' + onePxPng, id: 'restoredid123' } });
  check('a restore-supplied id is used exactly as given', r.status === 200 && r.json.id === 'restoredid123', JSON.stringify(r.json));
  check('…and the file is actually retrievable under that id afterwards',
    !!db.assets['restoredid123'], JSON.stringify(db.assets['restoredid123'] && db.assets['restoredid123'].mime));

  // Restoring the SAME backup twice (id already present) must update it, not
  // crash on a duplicate-key error the way a plain INSERT would.
  r = await call({ method: 'POST', headers: { 'x-auth-token': 'ADMIN' },
    body: { dataUrl: 'data:image/jpeg;base64,' + onePxPng, id: 'restoredid123' } });
  check('restoring the same file id again updates it rather than erroring as a duplicate',
    r.status === 200 && r.json.ok && db.assets['restoredid123'].mime === 'image/jpeg', JSON.stringify(r));

  // A malformed id (never produced by newId(), which is lowercase-alphanumeric
  // only) is not trusted blindly — a fresh id is minted instead.
  r = await call({ method: 'POST', headers: { 'x-auth-token': 'ADMIN' },
    body: { dataUrl: 'data:image/png;base64,' + onePxPng, id: '../../etc/passwd' } });
  check('a malformed id is rejected in favour of a freshly-minted one, not used verbatim',
    r.status === 200 && r.json.id !== '../../etc/passwd', JSON.stringify(r.json));

  // GET by id still serves the restored file back out correctly.
  r = await call({ method: 'GET', query: { id: 'restoredid123' } });
  check('the restored file is served back correctly', r.status === 200 && Buffer.isBuffer(r.buf) && r.buf.length > 0);
}

/* ==================== Part 2: idms.html Backup & Restore ==================== */
const html = fs.readFileSync('idms.html', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const kpi = fs.readFileSync('kpi.js', 'utf8');

function makeServer(state) {
  const ok = j => ({ ok: true, status: 200, json: async () => Object.assign({ ok: true }, j) });
  const no = () => ({ ok: false, status: 401, json: async () => ({ ok: false, error: 'Not signed in.' }) });
  const pagedOk = (all, field, q) => {
    const limit = parseInt(q.get('limit'), 10) || all.length;
    const offset = parseInt(q.get('offset'), 10) || 0;
    return ok({ [field]: all.slice(offset, offset + limit) });
  };
  return async (path, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : {};
    const method = opts.method || 'GET';
    const url = String(path);
    const u = new URL(url, 'https://works.example');
    const q = u.searchParams;
    const tok = (opts.headers || {})['X-Auth-Token'] || '';
    state.calls.push({ method, url, body, tok });

    if (url.startsWith('/api/auth')) {
      if (body.action === 'session') return state.liveTokens.has(tok) ? ok({ user: 'asha', role: 'developer' }) : no();
      if (body.action === 'logout') { state.liveTokens.delete(tok); return ok({}); }
      return ok({});
    }
    if (url.startsWith('/api/content')) {
      if (method === 'POST') { state.contentPosts = state.contentPosts || []; state.contentPosts.push(body); return ok({}); }
      return ok({ data: state.content || {} });
    }
    if (url.startsWith('/api/settings')) return ok({ settings: {} });

    if (url.startsWith('/api/device')) {
      if (q.get('what') === 'devices') {
        if (method === 'POST') {
          const queue = state.devicePostResponses || [];
          const resp = queue.shift() || { ok: true, sn: (body.device || {}).sn };
          return ok(resp);
        }
        return ok({ devices: state.devices || [] });
      }
      if (q.get('what') === 'punches') return ok({ punches: state.hrPunches || [] });
      return ok({});
    }

    if (url.startsWith('/api/idms')) {
      const what = q.get('what');
      if (method === 'POST') return ok({ value: 1 });
      if (what === 'parts') return pagedOk(state.parts || [], 'parts', q);
      if (what === 'docs') return pagedOk(state.docs || [], 'docs', q);
      if (what === 'serial') return ok({ counters: state.counters || [] });
      if (what === 'settings') return ok({ settings: state.idmsSettings || {} });
      return ok({});
    }

    if (url.startsWith('/api/hr')) {
      const what = q.get('what');
      if (method === 'POST') return ok({});
      if (what === 'employees') return pagedOk(state.hrEmployees || [], 'employees', q);
      if (what === 'items') return pagedOk(state.hrItems || [], 'items', q);
      if (what === 'leave') return pagedOk(state.hrLeave || [], 'leave', q);
      if (what === 'training') return pagedOk(state.hrTraining || [], 'records', q);
      if (what === 'payruns') return pagedOk(state.hrPayruns || [], 'payruns', q);
      if (what === 'attendance') return ok({ attendance: state.hrAttendance || [] });
      return ok({});
    }

    if (url.startsWith('/api/rfqs')) {
      if (method === 'POST') return ok({ ref: (body.rfq || {}).ref, restored: !!body.restore });
      return pagedOk(state.rfqs || [], 'rfqs', q);
    }

    if (url.startsWith('/api/orders')) {
      if (method === 'POST') return ok({});
      return ok({ orders: state.ppcOrders || [] });
    }

    if (url.startsWith('/api/assets')) {
      if (method === 'POST') {
        state.assetPosts = state.assetPosts || [];
        state.assetPosts.push(body);
        return ok({ id: body.id || 'MINTED-ID', url: '/api/assets?id=' + (body.id || 'MINTED-ID') });
      }
      if (q.get('id')) {
        const found = (state.assets || []).find(a => a.id === q.get('id'));
        if (!found) return { ok: false, status: 404, blob: async () => { throw new Error('not found'); } };
        // A real GET-by-id serves raw bytes, not JSON — .blob() is what the
        // client actually calls; the fake blob is unwrapped by the fake
        // FileReader below rather than needing real binary/Blob support.
        return { ok: true, status: 200, blob: async () => ({ __fakeDataUrl: found.dataUrl }) };
      }
      return ok({ assets: (state.assets || []).map(a => ({ id: a.id, mime: a.mime, bytes: a.bytes, created_at: a.created_at })) });
    }

    return ok({});
  };
}

async function openTab(state) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(html.replace(/<script src="\/(core|kpi)\.js"><\/script>/g, ''),
    { runScripts: 'outside-only', url: 'https://works.example/idms.html', virtualConsole: vc });
  const w = dom.window;
  w.Element.prototype.scrollIntoView = function () {};
  w.BroadcastChannel = BroadcastChannel;
  w.confirm = () => true;
  w.fetch = makeServer(state);

  // Capture a bkDownload() without needing jsdom's own Blob/File support.
  let lastBlobText = null;
  w.Blob = function (parts) { lastBlobText = parts.join(''); };
  w.URL.createObjectURL = function () { return 'blob:fake'; };
  w.URL.revokeObjectURL = function () {};

  // Asset export reads a fetched file back as a data: URL via
  // Blob→FileReader, exactly as Core.uploadFile() already does for a
  // locally-picked file. Rather than needing jsdom's own binary Blob
  // support, the fake fetch above hands back a {__fakeDataUrl} marker and
  // this reads it straight off, matching FileReader's real callback shape.
  w.FileReader = function () {
    this.readAsDataURL = blob => {
      Promise.resolve().then(() => {
        if (blob && typeof blob.__fakeDataUrl === 'string') { this.result = blob.__fakeDataUrl; if (this.onload) this.onload(); }
        else if (this.onerror) this.onerror(new Error('fake FileReader given a non-fake blob'));
      });
    };
  };

  // Feed a fake uploaded file to the next file <input>'s click(), the way
  // bkPickFile() opens one — no real file dialog exists in jsdom.
  let queuedFile = null;
  w.HTMLInputElement.prototype.click = function () {
    if (this.type === 'file' && queuedFile !== null) {
      const content = queuedFile; queuedFile = null;
      Object.defineProperty(this, 'files', { value: [{ text: () => Promise.resolve(content) }], configurable: true });
      this.dispatchEvent(new w.Event('change'));
    }
  };

  w.sessionStorage.setItem('app_token', state.token);
  w.sessionStorage.setItem('app_self_reload', String(Date.now()));
  state.liveTokens.add(state.token);

  w.eval(core); w.eval(kpi);
  w.eval(html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/)[1]);
  await wait(900); // let adoptOpenSession() validate the token and start() draw the app

  return {
    w, errors, $: id => w.document.getElementById(id),
    click(id) { this.$(id).dispatchEvent(new w.Event('click', { bubbles: true })); },
    lastDownload: () => (lastBlobText ? JSON.parse(lastBlobText) : null),
    queueFile(obj) { queuedFile = JSON.stringify(obj); }
  };
}

/* ---- Settings export: registered devices now ride along ---- */
{
  const state = { token: 'TOK-EXPORT-ADMIN', liveTokens: new Set(), calls: [],
    devices: [
      { sn: 'ADMS-1', data: { name: 'Gate fingerprint', protocol: 'adms', active: true }, hasKey: false },
      { sn: 'JSON-1', data: { name: 'Office face unit', protocol: 'json', active: true }, hasKey: true }
    ] };
  const A = await openTab(state);
  A.click('bk-exp-admin');
  await wait(400);
  check('settings export requests the registered-devices list',
    state.calls.some(c => c.method === 'GET' && c.url.startsWith('/api/device?what=devices')));
  const dl = A.lastDownload();
  check('settings export downloads a file at all', !!dl, JSON.stringify(dl));
  check('the downloaded file is scoped "settings"', dl && dl.scope === 'settings');
  check('…and carries both registered devices, by serial',
    dl && Array.isArray(dl.devices) && dl.devices.length === 2 &&
    dl.devices.some(d => d.sn === 'ADMS-1') && dl.devices.some(d => d.sn === 'JSON-1'),
    JSON.stringify(dl && dl.devices));
  check('the on-screen message names how many devices were included',
    /2 registered attendance device/.test(A.$('bk-msg').innerHTML), A.$('bk-msg').innerHTML);
}

/* ---- The settings half: one real defect, and one thing made honest ----

   THE DEFECT. Branding and website images came back broken. site_content holds
   only REFERENCES to pictures (/api/assets?id=…) while the bytes live in the
   assets table, which flushTable() puts in the DATA scope — so restoring a
   settings backup brought back every reference and none of the images, and the
   public site came up with broken pictures with nothing explaining why. The
   settings file now carries the files its own content points at. Proved by
   reintroducing it: with the assets left out, the three image checks below
   fail and the rest pass.

   THE OTHER. The export read `idmsSettings: settings` — a module-level
   variable belonging to the home screen rather than anything this function
   owns. It is filled during boot, so it mostly worked, and the check below
   would NOT have caught the old code; that was established by trying. It is
   read fresh now because a boot-time snapshot goes stale as soon as a setting
   is saved without a reload, which the invoice screen already works around by
   patching that same variable by hand. The checks below pin the fresh read so
   nobody reintroduces the dependency, not a bug they ever saw. */
{
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  const jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
  const state = { token: 'TOK-EXPORT-ADMIN-2', liveTokens: new Set(), calls: [], devices: [],
    /* the real shape: the logo and a capability image are references, not bytes */
    content: {
      company: { legalName: 'Test Mfg', letterheadLogo: '/api/assets?id=logo123' },
      capabilities: [{ id: 'c1', title: 'CNC turning', img: '/api/assets?id=capA' }],
      heroHeadline: 'no image in this one'
    },
    idmsSettings: { print_settings: { size: 'A4' }, invoice_settings: { upi: 'x@y' },
                    cnc_gateway: { machines: [] } },
    /* drawing789 belongs to a part, not to the website — it must NOT be pulled
       into the settings file just because it is in the same table */
    assets: [
      { id: 'logo123', mime: 'image/png', bytes: 20, dataUrl: png },
      { id: 'capA', mime: 'image/jpeg', bytes: 18, dataUrl: jpg },
      { id: 'drawing789', mime: 'image/jpeg', bytes: 18, dataUrl: jpg }
    ] };
  const A = await openTab(state);
  A.click('bk-exp-admin');

  await wait(500);
  const dl = A.lastDownload();
  check('the settings export reads the settings table at export time, not at boot',
    state.calls.some(c => c.method === 'GET' && c.url.includes('what=settings')));
  check('…and the settings themselves are in the file, not an empty object',
    dl && dl.idmsSettings && Object.keys(dl.idmsSettings).length === 3,
    JSON.stringify(dl && dl.idmsSettings));
  check('…including one a screen would be broken without (print settings)',
    dl && dl.idmsSettings.print_settings && dl.idmsSettings.print_settings.size === 'A4');
  check('the settings file carries the images its own content points at',
    dl && Array.isArray(dl.assets) && dl.assets.length === 2,
    JSON.stringify(dl && (dl.assets || []).map(a => a.id)));
  check('…the company logo, by its original id and with real bytes',
    dl && dl.assets.some(a => a.id === 'logo123' && a.dataUrl === png));
  check('…and an image referenced from deep inside an array of sections',
    dl && dl.assets.some(a => a.id === 'capA'));
  check('a part drawing is NOT dragged into the settings file — it is data',
    dl && !dl.assets.some(a => a.id === 'drawing789'));
  check('the message says how many images travelled with the settings',
    /2 branding\/website image/.test(A.$('bk-msg').innerHTML), A.$('bk-msg').innerHTML);
}

/* ---- Restoring a settings file puts those images back under their own ids,
   and an older file that has none says so rather than leaving broken
   pictures unexplained ---- */
{
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  const state = { token: 'TOK-RESTORE-IMG', liveTokens: new Set(), calls: [] };
  const A = await openTab(state);
  A.queueFile({
    scope: 'settings',
    content: { company: { legalName: 'Test Mfg', letterheadLogo: '/api/assets?id=logo123' } },
    idmsSettings: { print_settings: { size: 'A4' } },
    assets: [{ id: 'logo123', mime: 'image/png', bytes: 20, dataUrl: png }]
  });
  A.click('bk-imp-admin');
  await wait(700);
  const posts = state.assetPosts || [];
  check('a settings restore writes the image back',
    posts.some(p => p.id === 'logo123'), JSON.stringify(posts.map(p => p.id)));
  check('…under its ORIGINAL id, so the reference in the content still resolves',
    posts.some(p => p.id === 'logo123' && p.dataUrl === png));
  check('the idms settings in the file are written too',
    state.calls.some(c => c.method === 'POST' && c.url.startsWith('/api/idms')));
  check('the message counts the images it restored',
    /including 1 branding\/website image/.test(A.$('bk-msg').innerHTML), A.$('bk-msg').innerHTML);
}

{
  /* the file that caused the original report: references, no images */
  const state = { token: 'TOK-RESTORE-OLDFILE', liveTokens: new Set(), calls: [] };
  const A = await openTab(state);
  A.queueFile({
    scope: 'settings',
    content: { company: { legalName: 'Test Mfg', letterheadLogo: '/api/assets?id=logo123' },
               capabilities: [{ id: 'c1', img: '/api/assets?id=capA' }] },
    idmsSettings: {}
  });
  A.click('bk-imp-admin');
  await wait(700);
  const msg = A.$('bk-msg').innerHTML;
  check('an older settings file with no images is named as such, not left to be discovered',
    /2 image\(s\) this content points at are not in the file/.test(msg), msg);
  check('…and it says where the bytes actually are', /data JSON/.test(msg));
  check('…and it is not reported as a clean success', !/note good/.test(A.$('bk-msg').className),
    A.$('bk-msg').className);
}

/* ---- Settings restore: a device with no key on this deployment gets a
   brand-new one, shown once, and the page must NOT auto-reload behind it ---- */
{
  const state = { token: 'TOK-RESTORE-NEWKEY', liveTokens: new Set(), calls: [],
    devicePostResponses: [{ ok: true, sn: 'JSON-1', key: 'FRESH-KEY-XYZ-999' }] };
  const A = await openTab(state);
  A.queueFile({
    scope: 'settings',
    devices: [{ sn: 'JSON-1', data: { name: 'Office face unit', protocol: 'json', active: true } }]
  });
  A.click('bk-imp-admin');
  await wait(600);
  const msg = A.$('bk-msg').innerHTML;
  check('a freshly-minted device key is shown on screen', /FRESH-KEY-XYZ-999/.test(msg), msg);
  check('…and flagged as brand-new, needing to be copied down', /brand-new/i.test(msg), msg);
  check('the device restore actually posted to the devices endpoint',
    state.calls.some(c => c.method === 'POST' && c.url.startsWith('/api/device?what=devices') && c.body.device && c.body.device.sn === 'JSON-1'));
  check('a new-key restore does NOT mark itself for a self-triggered reload (must not hide the key behind an auto-reload)',
    A.w.sessionStorage.getItem('app_self_reload') === null,
    'app_self_reload = ' + A.w.sessionStorage.getItem('app_self_reload'));
}

/* ---- Settings restore, clean case: nothing needed a new key, so the
   usual self-authenticated reload is scheduled as before ---- */
{
  const state = { token: 'TOK-RESTORE-CLEAN', liveTokens: new Set(), calls: [],
    devicePostResponses: [{ ok: true, sn: 'ADMS-1' }] };
  const A = await openTab(state);
  A.queueFile({
    scope: 'settings',
    devices: [{ sn: 'ADMS-1', data: { name: 'Gate fingerprint', protocol: 'adms', active: true } }]
  });
  A.click('bk-imp-admin');
  await wait(600);
  const msg = A.$('bk-msg').innerHTML;
  check('a clean settings restore (no new keys) reports success and reloading', /Reloading/i.test(msg), msg);
  check('…and DOES mark the reload as self-triggered, so the boot sequence keeps this screen signed in',
    A.w.sessionStorage.getItem('app_self_reload') !== null);
}

/* ---- Data export: pagination genuinely spans more than one page, and
   every new module rides along with the field the restore side expects ---- */
{
  const bigParts = Array.from({ length: 2005 }, (_, i) => ({ part_id: 'P' + i, part_no: 'PN' + i }));
  const state = {
    token: 'TOK-EXPORT-DATA', liveTokens: new Set(), calls: [],
    parts: bigParts,
    docs: [{ doc_id: 'D1' }],
    hrEmployees: [{ empId: 'E1' }],
    hrItems: [{ item_id: 'I1' }],
    hrLeave: [{ leave_id: 'L1' }, { leave_id: 'L2' }],
    hrTraining: [{ rec_id: 'T1' }, { rec_id: 'T2' }],
    hrPayruns: [{ run_id: 'R1' }, { run_id: 'R2' }],
    hrAttendance: [{ id: 'E1|2026-01-01' }, { id: 'E1|2026-01-02' }, { id: 'E1|2026-01-03' }],
    hrPunches: [{ id: 'p1' }, { id: 'p2' }],
    rfqs: [{ ref: 'RFQ-1' }, { ref: 'RFQ-2' }],
    ppcOrders: [{ ref: 'PO-1' }],
    counters: [{ name: 'grn', value: 57 }, { name: 'inv', value: 12 }]
  };
  const A = await openTab(state);
  A.click('bk-exp-data');
  await wait(700);

  // Filtered on limit= specifically: boot itself makes an unrelated, unpaginated
  // what=parts call (a home-screen count) before the button is ever clicked,
  // which would otherwise land at index 0 and shift everything after it.
  const partCalls = state.calls.filter(c => c.method === 'GET' && c.url.startsWith('/api/idms?what=parts') && c.url.includes('limit='));
  const parseQ = url => Object.fromEntries(new URL(url, 'https://x').searchParams);
  check('a >2000-record collection is fetched across more than one page, not truncated at one',
    partCalls.length >= 2, 'calls: ' + partCalls.map(c => c.url).join(' | '));
  check('…the first page asks for the documented page size starting at offset 0',
    partCalls[0] && parseQ(partCalls[0].url).limit === '2000' && parseQ(partCalls[0].url).offset === '0',
    JSON.stringify(partCalls[0] && parseQ(partCalls[0].url)));
  check('…the second page continues from where the first left off',
    partCalls[1] && parseQ(partCalls[1].url).offset === '2000',
    JSON.stringify(partCalls[1] && parseQ(partCalls[1].url)));

  const dl = A.lastDownload();
  check('the export downloads a file at all', !!dl);
  check('every one of the 2005 parts survived the multi-page fetch — none lost, none duplicated',
    dl && dl.parts && dl.parts.length === 2005, dl && dl.parts && dl.parts.length);
  check('the export is scoped "data"', dl && dl.scope === 'data');
  check('counters are included', dl && dl.counters && dl.counters.length === 2);
  check('leave requests are included', dl && dl.hrLeave && dl.hrLeave.length === 2);
  check('training records are included', dl && dl.hrTraining && dl.hrTraining.length === 2);
  check('pay runs are included', dl && dl.hrPayruns && dl.hrPayruns.length === 2);
  check('attendance day-records are included', dl && dl.hrAttendance && dl.hrAttendance.length === 3);
  check('raw device punches are included for safekeeping', dl && dl.hrPunches && dl.hrPunches.length === 2);
  check('RFQs are included (previously exported but never restorable)', dl && dl.rfqs && dl.rfqs.length === 2);
  check('the legacy PPC order book is included too', dl && dl.ppcOrders && dl.ppcOrders.length === 1);
  check('attendance is fetched with a deliberately wide date range, not the screen\'s "recent" cap',
    state.calls.some(c => /\/api\/hr\?what=attendance&from=2000-01-01&to=2099-12-31/.test(c.url)));
  check('raw punches are likewise fetched with a wide date range',
    state.calls.some(c => c.url.startsWith('/api/device?what=punches') && c.url.includes('from=2000-01-01')));
}

/* ---- Data restore: the new fields actually get written back, in the
   shapes each endpoint expects, and RFQs are ALWAYS restored with
   restore:true so a historical enquiry can never resend a live
   notification ---- */
{
  const state = { token: 'TOK-IMPORT-DATA', liveTokens: new Set(), calls: [] };
  const A = await openTab(state);
  A.queueFile({
    scope: 'data',
    parts: [], docs: [], hrEmployees: [], hrItems: [],
    counters: [{ name: 'grn', value: 57 }, { name: 'inv', value: 12 }],
    hrAttendance: [{ id: 'E1|2026-01-01' }, { id: 'E1|2026-01-02' }, { id: 'E1|2026-01-03' }],
    hrLeave: [{ leave_id: 'L1', emp_id: 'E1', status: 'Approved', data: { from: '2026-01-01' } }],
    hrTraining: [{ rec_id: 'T1', kind: 'induction', status: 'Held', data: {} }],
    hrPayruns: [{ run_id: 'R1', period: '2026-01', status: 'Approved', data: {} }],
    rfqs: [{ ref: 'RFQ-OLD-1', name: 'Priya', email: 'p@x.com' }, { ref: 'RFQ-OLD-2', name: 'Rahul', email: 'r@x.com' }],
    ppcOrders: [{ ref: 'PO-OLD-1' }]
  });
  A.click('bk-imp-data');
  await wait(900);

  const postsTo = frag => state.calls.filter(c => c.method === 'POST' && c.url.startsWith(frag));

  const serialPosts = postsTo('/api/idms');
  check('counters are restored via the absolute-value serial "set" mode, not a relative bump',
    serialPosts.some(c => c.body.what === 'serial' && c.body.name === 'grn' && c.body.set === 57) &&
    serialPosts.some(c => c.body.what === 'serial' && c.body.name === 'inv' && c.body.set === 12),
    JSON.stringify(serialPosts.map(c => c.body)));

  const hrPosts = postsTo('/api/hr');
  check('attendance restores as one batched records:[] call carrying every day',
    hrPosts.some(c => c.body.what === 'attendance' && Array.isArray(c.body.records) && c.body.records.length === 3),
    JSON.stringify(hrPosts.filter(c => c.body.what === 'attendance')));
  check('leave requests are restored', hrPosts.some(c => c.body.what === 'leave' && c.body.leave && c.body.leave.leaveId === 'L1'));
  check('training records are restored', hrPosts.some(c => c.body.what === 'training' && c.body.record && c.body.record.recId === 'T1'));
  check('pay runs are restored', hrPosts.some(c => c.body.what === 'payruns' && c.body.payrun && c.body.payrun.runId === 'R1'));

  const rfqPosts = postsTo('/api/rfqs');
  check('exactly one restore POST per backed-up enquiry', rfqPosts.length === 2, JSON.stringify(rfqPosts.map(c => c.body)));
  check('EVERY restored RFQ is sent with restore:true — never a plain create',
    rfqPosts.every(c => c.body.restore === true), JSON.stringify(rfqPosts.map(c => c.body)));
  check('…carrying the actual backed-up reference for each',
    rfqPosts.some(c => c.body.rfq && c.body.rfq.ref === 'RFQ-OLD-1') && rfqPosts.some(c => c.body.rfq && c.body.rfq.ref === 'RFQ-OLD-2'));

  const orderPosts = postsTo('/api/orders');
  check('the legacy PPC order book restores too', orderPosts.some(c => c.body.order && c.body.order.ref === 'PO-OLD-1'));

  check('raw device punches are never written back (only the day-summaries are restored)',
    !state.calls.some(c => c.method === 'POST' && c.url.startsWith('/api/device')));

  const msg = A.$('bk-msg').innerHTML;
  check('the restore reports success with no failures', /Restored/.test(msg) && !/failed/i.test(msg), msg);
}

/* ---- Fix 4: pictures, videos and every other stored file ride along in
   the same JSON, as data: URLs, and come back under their original ids ---- */
{
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const mp4 = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE=';
  const state = {
    token: 'TOK-EXPORT-ASSETS', liveTokens: new Set(), calls: [],
    parts: [], docs: [],
    assets: [
      { id: 'logo123', mime: 'image/png', bytes: 95, dataUrl: png },
      { id: 'drawing456', mime: 'image/png', bytes: 95, dataUrl: png },
      { id: 'promo789', mime: 'video/mp4', bytes: 48, dataUrl: mp4 }
    ]
  };
  const A = await openTab(state);
  A.click('bk-exp-data');
  await wait(800);

  const dl = A.lastDownload();
  check('the data export lists the stored files',
    state.calls.some(c => c.method === 'GET' && c.url === '/api/assets'));
  check('…and fetches each one by id to read its bytes back',
    ['logo123', 'drawing456', 'promo789'].every(id =>
      state.calls.some(c => c.method === 'GET' && c.url === '/api/assets?id=' + id)));
  check('every stored file is carried in the JSON itself', dl && dl.assets && dl.assets.length === 3,
    JSON.stringify(dl && dl.assets && dl.assets.length));
  check('a picture is carried as its actual base64 content, not just a link',
    dl && dl.assets.some(a => a.id === 'logo123' && a.dataUrl === png),
    JSON.stringify(dl && dl.assets && dl.assets[0] && String(dl.assets[0].dataUrl).slice(0, 40)));
  check('a video is carried the same way', dl && dl.assets.some(a => a.id === 'promo789' && a.dataUrl === mp4));
  check('each file keeps the id every other record already points at',
    dl && dl.assets.every(a => ['logo123', 'drawing456', 'promo789'].includes(a.id)));
  check('the message says how many files went with it',
    /3 file\(s\)/.test(A.$('bk-msg').innerHTML), A.$('bk-msg').innerHTML);
}

/* An unreadable file must be named and skipped, never silently dropped and
   never allowed to fail the whole backup. */
{
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const state = {
    token: 'TOK-EXPORT-ASSET-GAP', liveTokens: new Set(), calls: [],
    parts: [], docs: [],
    assets: [{ id: 'logo123', mime: 'image/png', bytes: 95, dataUrl: png }]
  };
  const A = await openTab(state);
  /* 'gone999' is on the listing but has no readable content behind it — the
     row exists, the bytes do not. That is what a half-lost asset looks like,
     and the export must name it and carry on rather than stopping dead. */
  state.assets = state.assets.concat([{ id: 'gone999', mime: 'image/png', bytes: 95 }]);
  A.click('bk-exp-data');
  await wait(800);
  const dl = A.lastDownload();
  const msg = A.$('bk-msg').innerHTML;
  check('a file that cannot be read back is left out rather than breaking the export',
    dl && dl.assets && dl.assets.length === 1 && dl.assets[0].id === 'logo123', JSON.stringify(dl && dl.assets));
  check('…and the export says so, by name, instead of silently dropping it',
    /could not be read/i.test(msg) && /gone999/.test(msg), msg);
  check('…and the rest of the data export still completed', dl && dl.scope === 'data');
}

/* Restoring puts every file back under its original id, before the records
   that point at it. */
{
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const mp4 = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE=';
  const state = { token: 'TOK-IMPORT-ASSETS', liveTokens: new Set(), calls: [] };
  const A = await openTab(state);
  A.queueFile({
    scope: 'data',
    parts: [], docs: [],
    assets: [
      { id: 'logo123', mime: 'image/png', bytes: 95, dataUrl: png },
      { id: 'promo789', mime: 'video/mp4', bytes: 48, dataUrl: mp4 }
    ]
  });
  A.click('bk-imp-data');
  await wait(700);

  const posts = state.assetPosts || [];
  check('every file in the backup is posted back', posts.length === 2, JSON.stringify(posts.map(p => p.id)));
  check('…each under its ORIGINAL id, so existing references still resolve',
    posts.some(p => p.id === 'logo123') && posts.some(p => p.id === 'promo789'), JSON.stringify(posts.map(p => p.id)));
  check('…carrying the actual picture content', posts.some(p => p.id === 'logo123' && p.dataUrl === png));
  check('…and the actual video content', posts.some(p => p.id === 'promo789' && p.dataUrl === mp4));

  const assetCallIdx = state.calls.findIndex(c => c.method === 'POST' && c.url.startsWith('/api/assets'));
  const otherRestoreIdx = state.calls.findIndex(c => c.method === 'POST' && c.url.startsWith('/api/idms'));
  check('files are restored before the records that reference them',
    assetCallIdx >= 0 && (otherRestoreIdx === -1 || assetCallIdx < otherRestoreIdx));

  const msg = A.$('bk-msg').innerHTML;
  check('a file-only backup still counts as records to restore (not "carries no records")',
    !/carries no records/.test(msg) && /Restored/.test(msg), msg);
}

/* ---- Belt and braces: the shared pagination helper and the RFQ
   suppression flag are anchored in the source itself, so a future edit
   that drops one call site's wiring (while leaving the others working,
   which the scenarios above would not necessarily exercise again) is
   still caught. ---- */
check('bkFetchAll pages until a page comes back shorter than what was asked for',
  /page\.length\s*<\s*pageSize/.test(html));
check('the RFQ restore call in bk-imp-data always sets restore:true',
  /rfq:\s*dump\.rfqs\[i\],\s*restore:\s*true/.test(html));
check('every new data-export field has its own bkFetchAll or direct fetch call site',
  ['counters', 'hrLeave', 'hrTraining', 'hrPayruns', 'hrAttendance', 'hrPunches', 'rfqs', 'ppcOrders', 'assets']
    .every(f => new RegExp('dump\\.' + f + '\\s*=').test(html)));
check('the asset restore always sends the original id alongside the content',
  /dataUrl:\s*as2\.dataUrl,\s*id:\s*as2\.id/.test(html));
check('the server honours a restore-supplied asset id by upserting on it',
  /ON CONFLICT \(id\) DO UPDATE/.test(fs.readFileSync('server/routes/assets.js', 'utf8')));

let pass = 0;
for (const [n, ok, x] of results) { console.log((ok ? '  ok ' : '  x  ') + n + (ok ? '' : '   [' + x + ']')); if (ok) pass++; }
console.log(`\n${pass} passed, ${results.length - pass} failed, of ${results.length}`);
process.exit(0);
