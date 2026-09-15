// Safe production health check for the shared Neon database.
// Never returns DATABASE_URL or any other secret.
import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Use GET' });

  const hasDatabaseUrl = !!String(process.env.DATABASE_URL || '').trim();
  if (!hasDatabaseUrl) {
    return res.status(500).json({
      ok: false,
      database: { configured: false, connected: false },
      error: 'DATABASE_URL is not configured in the running Vercel environment.'
    });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`SELECT 1 AS ok`;
    return res.status(200).json({
      ok: true,
      database: { configured: true, connected: rows?.[0]?.ok === 1, provider: 'neon' }
    });
  } catch (e) {
    console.error('HEALTH DATABASE ERROR:', e);
    const message = String(e?.message || 'Database connection failed.');
    return res.status(500).json({
      ok: false,
      database: { configured: true, connected: false, provider: 'neon' },
      error: message
    });
  }
}
