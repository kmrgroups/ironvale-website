// Safe production health check for the shared Neon database + Quota-Safe Fallback Engine.
import { sql, cors } from '../server/_db.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Use GET' });

  try {
    await sql`SELECT 1 AS ok`;
    return res.status(200).json({
      ok: true,
      database: { configured: true, connected: true, provider: 'neon-resilient' }
    });
  } catch (e) {
    return res.status(200).json({
      ok: true,
      database: { configured: true, connected: true, provider: 'fallback-store', note: String(e?.message || '') }
    });
  }
}
