/* Flush All Data / Flush All Settings, driven against the REAL handler in
   api/idms.js, not a mock of what it's supposed to do. tests/flushtest.mjs
   (the other flush test) only checks the client-side button gating by
   mocking fetch entirely, which is exactly why it did not catch a genuine
   production bug: the handler called sql.query(...), a method the actual
   Neon driver used in production does not expose. This test would have
   caught that, because it runs the actual function api/idms.js exports. */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const fake = pathToFileURL(process.cwd() + '/tests/fake-db.mjs').href;
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec === './_db.js' && ctx.parentURL && ctx.parentURL.endsWith('/api/idms.js')) return { url: ${JSON.stringify(fake)}, shortCircuit: true };
    return next(spec, ctx);
  }`));
const { db } = await import(fake);
const handler = (await import('../api/idms.js')).default;

function call({ method = 'GET', query = {}, headers = {}, body = {} }) {
  return new Promise(resolve => {
    /* idms.js opts into Vercel's built-in bodyParser (`config.api.bodyParser`),
       so by the time the handler runs, req.body is already the parsed object
       — not a stream to read, which is a different convention from
       api/device.js (devicetest.mjs's own call() helper), which reads a raw
       body itself. Mixing the two up here silently produced an empty {}
       body and "Unknown scope" instead of a real test of the scope logic. */
    const req = { method, query, headers, body };
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; },
      send(x) { resolve({ status: this.statusCode, text: String(x) }); }, json(x) { resolve({ status: this.statusCode, json: x }); },
      end() { resolve({ status: this.statusCode }); } };
    handler(req, res).catch(e => resolve({ status: 500, json: { ok: false, error: e.message } }));
  });
}

const results = [];
const check = (n, c, x) => results.push([n, !!c, x || '']);

db.sessions.DEV = { username: 'asha', role: 'developer' };
db.sessions.STAFF = { username: 'ravi', role: 'staff' };

// ---------- an ordinary login cannot flush anything ----------
let r = await call({ method: 'POST', query: { what: 'flush' }, headers: { 'x-auth-token': 'STAFF' },
  body: { scope: 'data', confirm: 'FLUSH ALL DATA' } });
check('a non-admin login is refused', r.status === 403, JSON.stringify(r));
check('nothing was touched by the refused attempt', db.idmsDocs.length === 1 && db.hrEmployees.length === 1);

// ---------- the wrong phrase is refused, even for an admin ----------
r = await call({ method: 'POST', query: { what: 'flush' }, headers: { 'x-auth-token': 'DEV' },
  body: { scope: 'data', confirm: 'flush all data' } });
check('a near-miss phrase is refused even for the developer login', r.status === 400, JSON.stringify(r));

// ---------- Flush All Data — the actual bug: this used to 500 ----------
r = await call({ method: 'POST', query: { what: 'flush' }, headers: { 'x-auth-token': 'DEV' },
  body: { scope: 'data', confirm: 'FLUSH ALL DATA' } });
check('Flush All Data succeeds against the real handler (this is the bug that shipped)',
  r.status === 200 && r.json && r.json.ok === true, JSON.stringify(r));
check('idms_docs is actually emptied', db.idmsDocs.length === 0);
check('idms_parts is actually emptied', db.idmsParts.length === 0);
check('hr_employees is actually emptied', db.hrEmployees.length === 0);
check('hr_punches is actually emptied', db.hrPunches.length === 0);
check('assets is actually emptied', db.assets.length === 0);
check('idms_audit is emptied and then carries exactly the flush\'s own entry — not left silently empty',
  db.idmsAudit.length === 1 && db.idmsAudit[0].kind === 'system' && db.idmsAudit[0].action === 'flush',
  JSON.stringify(db.idmsAudit));
check('company profile, settings and devices are NOT touched by a data flush',
  db.siteContent.length === 1 && db.idmsSettings.length === 1 && db.hrDevices.length === 1 && db.secrets.length === 1);

// ---------- Flush All Settings ----------
r = await call({ method: 'POST', query: { what: 'flush' }, headers: { 'x-auth-token': 'DEV' },
  body: { scope: 'settings', confirm: 'FLUSH ALL SETTINGS' } });
check('Flush All Settings succeeds against the real handler', r.status === 200 && r.json && r.json.ok === true, JSON.stringify(r));
check('site_content is emptied', db.siteContent.length === 0);
check('idms_settings is emptied', db.idmsSettings.length === 0);
check('secrets is emptied', db.secrets.length === 0);
check('login_codes is emptied', db.loginCodes.length === 0);
check('hr_devices is emptied', db.hrDevices.length === 0);
check('users/sessions are NOT touched — nobody gets locked out by this', Object.keys(db.sessions).length === 2);

const failed = results.filter(([, ok]) => !ok);
for (const [n, ok, x] of results) console.log((ok ? '  ok  ' : '  X   ') + n + (ok ? '' : '   [' + x + ']'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, of ${results.length}`);
process.exit(failed.length ? 1 : 0);
