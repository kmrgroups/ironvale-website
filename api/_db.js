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
