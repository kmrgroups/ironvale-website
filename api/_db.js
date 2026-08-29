// Shared database helper for all API endpoints.
import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

export const sql = neon(process.env.DATABASE_URL);

export const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');

let ready = false;
export async function ensureTables() {
  if (ready) return;
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
  const rows = await sql`SELECT username, role FROM users WHERE pass_hash = ${token}`;
  if (rows.length) return rows[0];
  // legacy single-login fallback
  const old = await sql`SELECT user_name FROM auth WHERE id = 1 AND pass_hash = ${token}`;
  return old.length ? { username: old[0].user_name, role: 'developer' } : null;
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
