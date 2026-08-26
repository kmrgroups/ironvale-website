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
  await sql`CREATE TABLE IF NOT EXISTS auth (
    id INT PRIMARY KEY DEFAULT 1,
    user_name TEXT NOT NULL,
    pass_hash TEXT NOT NULL
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
  const rows = await sql`SELECT id FROM auth WHERE id = 1`;
  if (!rows.length) {
    const u = process.env.ADMIN_USER || 'admin';
    const p = process.env.ADMIN_PASS || 'changeme123';
    await sql`INSERT INTO auth (id, user_name, pass_hash) VALUES (1, ${u}, ${hash(p)})`;
  }
  ready = true;
}

export async function checkToken(token) {
  if (!token) return false;
  await ensureTables();
  const rows = await sql`SELECT pass_hash FROM auth WHERE id = 1`;
  return rows.length > 0 && rows[0].pass_hash === token;
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
