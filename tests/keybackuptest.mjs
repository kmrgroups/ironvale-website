/* Reading the connection keys back, driven against the REAL settings handler.

   This endpoint is the one place in the platform that hands a working provider
   key to a browser, so it is tested against the actual exported function
   rather than a mock of what it is meant to do — the same reason
   flushservertest.mjs exists. What has to hold:

     - the ordinary GET still masks everything, because a Backup & Restore
       file travels between deployments and inboxes;
     - only the administrator login can reveal, checked on the server, not
       just hidden in the screen;
     - a key set as a Vercel environment variable is never handed out — it is
       not this system's to give, and a flush cannot lose it anyway;
     - every reveal is audited by key NAME, never by value. An audit row
       holding the secrets would be a second copy of them in a table nobody
       can delete from. */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const fake = pathToFileURL(process.cwd() + '/tests/fake-db.mjs').href;
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec === '../server/_db.js' && ctx.parentURL && ctx.parentURL.endsWith('/server/routes/settings.js'))
      return { url: ${JSON.stringify(fake)}, shortCircuit: true };
    return next(spec, ctx);
  }`));
const { db } = await import(fake);
const handler = (await import('../server/routes/settings.js')).default;

function call({ method = 'GET', query = {}, headers = {}, body = {} }) {
  return new Promise(resolve => {
    const req = { method, query, headers, body };
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      send(x) { resolve({ status: this.statusCode, text: String(x) }); },
      json(x) { resolve({ status: this.statusCode, json: x }); },
      end() { resolve({ status: this.statusCode }); } };
    handler(req, res).catch(e => resolve({ status: 500, json: { ok: false, error: e.message } }));
  });
}

const results = [];
const check = (n, c, x) => results.push([n, !!c, x || '']);

const REAL_KEY = 're_liveKey_9f3a2b7c1d8e';
db.sessions.DEV = { username: 'asha', role: 'developer' };
db.sessions.STAFF = { username: 'ravi', role: 'staff' };
db.secretValues.RESEND_API_KEY = REAL_KEY;
db.secretValues.FROM_EMAIL = 'Test Mfg <sales@testmfg.test>';
db.secretValues.MISTRAL_API_KEY = 'mk-0011223344556677';
/* something that is in the table but not on the allow-list — an older
   deployment, a renamed setting — must not ride out in the export */
db.secretValues.LEGACY_SECRET = 'should-never-be-exported';
/* and one that lives on Vercel rather than in the table */
process.env.GROQ_API_KEY = 'gsk_fromVercel_998877';

// ---------- the ordinary GET is unchanged: masked, always ----------
let r = await call({ method: 'GET', headers: { 'x-auth-token': 'DEV' } });
check('the ordinary GET still answers', r.status === 200 && r.json.ok, JSON.stringify(r).slice(0, 120));
const plain = JSON.stringify(r.json);
check('it masks the key rather than returning it',
  !plain.includes(REAL_KEY) && /re_l••••••/.test(r.json.settings.RESEND_API_KEY.masked),
  r.json.settings.RESEND_API_KEY.masked);
check('it says where each one came from',
  r.json.settings.RESEND_API_KEY.source === 'panel' && r.json.settings.GROQ_API_KEY.source === 'vercel');

// ---------- reveal: who may, and who may not ----------
r = await call({ method: 'GET', query: { reveal: '1' }, headers: {} });
check('no session cannot reveal anything', r.status === 401, JSON.stringify(r));

const auditBefore = db.idmsAudit.length;
r = await call({ method: 'GET', query: { reveal: '1' }, headers: { 'x-auth-token': 'STAFF' } });
check('an ordinary login is refused by the server, not just by the screen', r.status === 403,
  JSON.stringify(r));
check('the refusal says who to ask', /administrator/i.test((r.json || {}).error || ''),
  (r.json || {}).error);
check('a refused attempt carries no keys at all', !JSON.stringify(r.json).includes(REAL_KEY));
check('and is not recorded as an export, because nothing was exported',
  db.idmsAudit.length === auditBefore, String(db.idmsAudit.length - auditBefore));

r = await call({ method: 'GET', query: { reveal: '1' }, headers: { 'x-auth-token': 'DEV' } });
check('the administrator gets the keys themselves', r.status === 200 && r.json.ok &&
  r.json.values.RESEND_API_KEY === REAL_KEY, JSON.stringify(r.json && r.json.values));
check('every panel-entered key comes back, not just the first',
  r.json.values.FROM_EMAIL === 'Test Mfg <sales@testmfg.test>' &&
  r.json.values.MISTRAL_API_KEY === 'mk-0011223344556677');
check('a setting the panel does not own is left out of the file',
  !('LEGACY_SECRET' in r.json.values), JSON.stringify(Object.keys(r.json.values)));
/* the boundary that matters most: an environment variable belongs to the
   deployment, not to whoever is pressing Download */
check('a key set on Vercel is never handed out',
  !('GROQ_API_KEY' in r.json.values) && !JSON.stringify(r.json).includes('gsk_fromVercel_998877'),
  JSON.stringify(Object.keys(r.json.values)));
check('it records who it was exported by', r.json.exportedBy === 'asha', r.json.exportedBy);

// ---------- the audit row ----------
const row = db.idmsAudit[db.idmsAudit.length - 1];
check('the reveal is written to the audit trail',
  db.idmsAudit.length === auditBefore + 1 && row.action === 'export' && row.kind === 'settings',
  JSON.stringify(row));
check('naming who did it', row.who === 'asha', row.who);
check('and saying plainly what it was',
  /downloaded for backup/.test(row.reason || ''), row.reason);
check('the trail records the key NAMES and not one key value',
  !JSON.stringify(row).includes(REAL_KEY) && !JSON.stringify(row).includes('mk-0011223344556677'),
  JSON.stringify(row));

// ---------- restoring goes back through the ordinary save ----------
db.secretValues = {};
r = await call({ method: 'POST', headers: { 'x-auth-token': 'DEV' },
  body: { name: 'RESEND_API_KEY', value: REAL_KEY } });
check('a key from a backup file is written back through the ordinary save',
  r.status === 200 && db.secretValues.RESEND_API_KEY === REAL_KEY, JSON.stringify(r.json));
check('and the live secret cache is dropped, so the next send uses it',
  db.secretCacheCleared > 0, String(db.secretCacheCleared));
r = await call({ method: 'POST', headers: { 'x-auth-token': 'DEV' },
  body: { name: 'LEGACY_SECRET', value: 'x' } });
check('a name the panel does not own is refused on restore, whatever the file says',
  r.status === 400 && !('LEGACY_SECRET' in db.secretValues), JSON.stringify(r.json));
r = await call({ method: 'POST', headers: {}, body: { name: 'RESEND_API_KEY', value: 'x' } });
check('and restoring needs a session at all', r.status === 401, JSON.stringify(r.json));

const failed = results.filter(([, ok]) => !ok);
for (const [n, ok, x] of results) console.log((ok ? '  ok  ' : '  X   ') + n + (ok ? '' : '   [' + x + ']'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, of ${results.length}`);
process.exit(failed.length ? 1 : 0);
