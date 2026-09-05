// Shared database helper for all API endpoints.
import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

export const sql = neon(process.env.DATABASE_URL);

export const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');

/* ---------------- passwords ----------------
   The old scheme was an unsalted single-round SHA-256, and the value it produced
   was ALSO used as the session token. Two consequences: a stolen token was a
   permanent credential that could not be revoked, and the users table was a
   plaintext-equivalent password list for any password in a rainbow table.

   Passwords are now scrypt with a per-user salt. Old hashes are still accepted
   on sign-in and silently upgraded, so nobody is locked out at cutover — but a
   legacy hash is never issued as a token again. */
export function newSalt() { return crypto.randomBytes(16).toString('hex'); }

export function scryptHash(password, salt) {
  return 'scrypt$' + salt + '$' +
    crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}

export function passwordMatches(password, stored) {
  if (!stored) return false;
  if (stored.startsWith('scrypt$')) {
    const [, salt] = stored.split('$');
    const want = Buffer.from(stored, 'utf8');
    const got = Buffer.from(scryptHash(password, salt), 'utf8');
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  }
  // legacy unsalted sha256 — accepted once, then upgraded by the caller
  const a = Buffer.from(hash(password), 'utf8'), b = Buffer.from(stored, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export const isLegacyHash = stored => !!stored && !String(stored).startsWith('scrypt$');

/* ---------------- sessions ----------------
   An opaque random token with a server-side expiry that can be revoked. It is
   not derived from the password and tells an attacker nothing. */
const SESSION_DAYS = 7;
export function newToken() { return crypto.randomBytes(32).toString('hex'); }

export async function startSession(username, role, agent) {
  await ensureTables();
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await sql`INSERT INTO sessions (token, username, role, expires_at, user_agent)
            VALUES (${token}, ${username}, ${role || 'staff'}, ${expires},
                    ${String(agent || '').slice(0, 200)})`;
  // housekeeping, cheap and keeps the table from growing without bound
  await sql`DELETE FROM sessions WHERE expires_at < now()`;
  return { token, expiresAt: expires };
}

export async function endSession(token) {
  if (!token) return;
  await ensureTables();
  await sql`DELETE FROM sessions WHERE token = ${token}`;
}

export async function endAllSessions(username) {
  await ensureTables();
  await sql`DELETE FROM sessions WHERE username = ${username}`;
}

let ready = false;
export async function ensureTables() {
  if (ready) return;
  await sql`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    created_at TIMESTAMPTZ DEFAULT now(),
    last_seen TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    user_agent TEXT
  )`;
  await sql`CREATE INDEX IF NOT EXISTS sessions_user ON sessions (username)`;
  await sql`CREATE TABLE IF NOT EXISTS site_content (
    id INT PRIMARY KEY DEFAULT 1,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS rfqs (
    ref TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS hr_employees (
    emp_id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS hr_attendance (
    id TEXT PRIMARY KEY,
    emp_id TEXT NOT NULL,
    day DATE NOT NULL,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS hr_att_emp_day ON hr_attendance (emp_id, day)`;
  await sql`CREATE TABLE IF NOT EXISTS hr_leave (
    leave_id TEXT PRIMARY KEY,
    emp_id TEXT NOT NULL,
    data JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending',
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS hr_training (
    rec_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    data JSONB NOT NULL,
    status TEXT DEFAULT 'Open',
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS hr_items (
    item_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    data JSONB NOT NULL,
    status TEXT DEFAULT 'Open',
    owner TEXT DEFAULT '',
    due DATE,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS hr_items_kind ON hr_items (kind, status)`;
  await sql`CREATE TABLE IF NOT EXISTS hr_payruns (
    run_id TEXT PRIMARY KEY,
    period TEXT NOT NULL,
    data JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'Draft',
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS hr_audit (
    id BIGSERIAL PRIMARY KEY,
    who TEXT, what TEXT, ref TEXT,
    before_val JSONB, after_val JSONB,
    reason TEXT, at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS ppc_orders (
    ref TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  /* ---------------------------------------------------------------
     IDMS — the manufacturing system that runs alongside the website.
     One generic document store keyed by kind, exactly as hr_items works,
     so a new module needs no migration. part_id on every row is what
     makes the digital thread real: one query returns everything ever
     recorded against a customer part number.
     ---------------------------------------------------------------- */
  await sql`CREATE TABLE IF NOT EXISTS idms_parts (
    part_id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL DEFAULT 'default',
    customer TEXT DEFAULT '',
    part_no TEXT DEFAULT '',
    part_name TEXT DEFAULT '',
    lifecycle TEXT NOT NULL DEFAULT 'New',
    quote_ref TEXT DEFAULT '',
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idms_parts_life ON idms_parts (lifecycle, customer)`;

  await sql`CREATE TABLE IF NOT EXISTS idms_docs (
    doc_id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL DEFAULT 'default',
    kind TEXT NOT NULL,
    part_id TEXT DEFAULT '',
    doc_no TEXT DEFAULT '',
    rev TEXT DEFAULT '0',
    status TEXT NOT NULL DEFAULT 'Draft',
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    updated_by TEXT DEFAULT ''
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idms_docs_kind ON idms_docs (kind, status)`;
  await sql`CREATE INDEX IF NOT EXISTS idms_docs_part ON idms_docs (part_id)`;

  /* Serials are incremented in the database, not in a browser variable —
     two people saving a GRN at the same moment must not get one number. */
  await sql`CREATE TABLE IF NOT EXISTS idms_counters (
    name TEXT PRIMARY KEY,
    value BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS idms_settings (
    key TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS idms_audit (
    id BIGSERIAL PRIMARY KEY,
    who TEXT, kind TEXT, ref TEXT, action TEXT,
    before_val JSONB, after_val JSONB,
    reason TEXT, at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idms_audit_ref ON idms_audit (kind, ref)`;

  await sql`CREATE TABLE IF NOT EXISTS auth (
    id INT PRIMARY KEY DEFAULT 1,
    user_name TEXT NOT NULL,
    pass_hash TEXT NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    pass_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    email TEXT DEFAULT '',
    whatsapp TEXT DEFAULT '',
    twofa BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS login_codes (
    username TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    tries INT DEFAULT 0
  )`;
  await sql`CREATE TABLE IF NOT EXISTS secrets (
    name TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    mime TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  // seed the first login if none exists
  const rows = await sql`SELECT id, user_name, pass_hash FROM auth WHERE id = 1`;
  if (!rows.length) {
    const u = process.env.ADMIN_USER || 'admin';
    const p = process.env.ADMIN_PASS || 'changeme123';
    await sql`INSERT INTO auth (id, user_name, pass_hash) VALUES (1, ${u}, ${hash(p)})`;
  }

  // move the original single login into the new users table, as developer
  const uCount = await sql`SELECT count(*)::int AS n FROM users`;
  if (!uCount[0] || uCount[0].n === 0) {
    const legacy = (await sql`SELECT user_name, pass_hash FROM auth WHERE id = 1`)[0];
    if (legacy) {
      await sql`INSERT INTO users (username, pass_hash, role, twofa)
                VALUES (${legacy.user_name}, ${legacy.pass_hash}, 'developer', false)
                ON CONFLICT (username) DO NOTHING`;
    }
    // a separate pipeline-only login, so staff never reach the admin panel
    const sp = process.env.STAFF_PASS || 'pipeline123';
    await sql`INSERT INTO users (username, pass_hash, role, twofa)
              VALUES ('staff', ${hash(sp)}, 'staff', false)
              ON CONFLICT (username) DO NOTHING`;
  }
  ready = true;
}

export async function tokenUser(token) {
  if (!token) return null;
  await ensureTables();
  /* A session token only. The old behaviour — resolving a caller by matching the
     token against users.pass_hash — is deliberately gone: it made the password
     verifier and the session token the same value. Do not reinstate it. */
  const rows = await sql`
    SELECT username, role FROM sessions
    WHERE token = ${token} AND expires_at > now()`;
  if (!rows.length) return null;
  // touch it, so an active session does not expire mid-shift
  await sql`UPDATE sessions SET last_seen = now() WHERE token = ${token}`;
  return rows[0];
}
export async function checkToken(token) {
  return !!(await tokenUser(token));
}
export async function checkRole(token, roles) {
  const u = await tokenUser(token);
  return u && roles.includes(u.role) ? u : null;
}

export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token');
}

export function readBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
}


/* Settings entered in the admin panel take priority over Vercel environment
   variables, so a site can be configured entirely from its own screen. */
let secretCache = null, secretCacheAt = 0;
export async function getSecret(name) {
  const now = Date.now();
  if (!secretCache || now - secretCacheAt > 30000) {
    try {
      await ensureTables();
      const rows = await sql`SELECT name, value FROM secrets`;
      secretCache = {};
      rows.forEach(r => { secretCache[r.name] = r.value; });
      secretCacheAt = now;
    } catch (e) { secretCache = secretCache || {}; }
  }
  const fromDb = secretCache[name];
  if (fromDb && String(fromDb).trim()) return String(fromDb).trim();
  return String(process.env[name] || '').trim();
}
export function clearSecretCache() { secretCache = null; }
