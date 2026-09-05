// Configuration entered from the admin panel.
// Values are stored in the database and always take priority over Vercel
// environment variables, so a site can be set up entirely from its own screen.
import { sql, ensureTables, checkToken, cors, readBody, clearSecretCache } from './_db.js';

// Only these may be set from the panel. Anything else is ignored.
const ALLOWED = [
  'RESEND_API_KEY', 'FROM_EMAIL', 'OWNER_EMAIL',
  'OPENROUTER_API_KEY', 'MISTRAL_API_KEY', 'GROQ_API_KEY',
  'GEMINI_API_KEY', 'ANTHROPIC_API_KEY',
  'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID', 'WHATSAPP_TEMPLATE', 'OWNER_WHATSAPP',
  'SITE_URL'
];

const mask = v => {
  const s = String(v || '');
  if (!s) return '';
  if (s.length <= 8) return '••••';
  return s.slice(0, 4) + '••••••' + s.slice(-4);
};

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await ensureTables();
    if (!(await checkToken(req.headers['x-auth-token'])))
      return res.status(401).json({ ok: false, error: 'Not signed in.' });

    if (req.method === 'GET') {
      const rows = await sql`SELECT name, value, updated_at FROM secrets`;
      const stored = {};
      rows.forEach(r => { stored[r.name] = { masked: mask(r.value), updatedAt: r.updated_at, source: 'panel' }; });

      const out = {};
      ALLOWED.forEach(k => {
        if (stored[k] && stored[k].masked) out[k] = stored[k];
        else if (process.env[k]) out[k] = { masked: mask(process.env[k]), source: 'vercel' };
        else out[k] = { masked: '', source: 'none' };
      });
      return res.status(200).json({ ok: true, settings: out });
    }

    if (req.method === 'POST') {
      const body = readBody(req);
      const name = String(body.name || '').trim();
      const value = String(body.value == null ? '' : body.value).trim();
      if (!ALLOWED.includes(name))
        return res.status(400).json({ ok: false, error: 'That setting cannot be changed here.' });

      if (!value) {
        await sql`DELETE FROM secrets WHERE name = ${name}`;
        clearSecretCache();
        return res.status(200).json({ ok: true, cleared: name });
      }
      await sql`
        INSERT INTO secrets (name, value, updated_at) VALUES (${name}, ${value}, now())
        ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
      clearSecretCache();
      return res.status(200).json({ ok: true, saved: name, masked: mask(value) });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.log('SETTINGS ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
