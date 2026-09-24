// Configuration entered from the admin panel.
// Values are stored in the database and always take priority over Vercel
// environment variables, so a site can be set up entirely from its own screen.
import { sql, ensureTables, checkToken, checkRole, cors, readBody, clearSecretCache } from '../server/_db.js';

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

    /* ---- GET ?reveal=1 : the keys themselves, for the owner's own backup ----
       Everything else in this file hands back masked values only, and that
       stays true: a backup JSON travels between deployments and inboxes, so
       Backup & Restore must never carry a working key.
       But a flush wipes this table, and a key nobody can read back is a key
       that has to be reissued at every provider — which is what actually
       happened to a live deployment. So there is exactly one way to read them
       in the clear, and it is deliberately narrow:
         - the administrator role only, checked here, not just in the screen;
         - panel-entered keys only. A Vercel environment variable is not this
           system's to hand out, and a flush cannot lose it anyway;
         - written to the audit trail, so an export is a recorded act rather
           than an invisible one. The NAMES are recorded, never the values —
           an audit row holding the secrets would simply be a second copy of
           them, in a table nobody can delete from. */
    if (req.method === 'GET' && String(req.query.reveal || '') === '1') {
      const who = await checkRole(req.headers['x-auth-token'], ['developer']);
      if (!who) return res.status(403).json({ ok: false,
        error: 'Only an administrator can read these keys back. Ask whoever set the system up.' });
      const rows = await sql`SELECT name, value FROM secrets`;
      const values = {};
      rows.forEach(r => { if (ALLOWED.includes(r.name) && r.value) values[r.name] = r.value; });
      try {
        await sql`INSERT INTO idms_audit (who, kind, ref, action, before_val, after_val, reason)
          VALUES (${who.username || 'unknown'}, ${'settings'}, ${'connections'}, ${'export'},
                  ${null}::jsonb, ${JSON.stringify({ keys: Object.keys(values) })}::jsonb,
                  ${'connection keys downloaded for backup'})`;
      } catch (e) { console.log('settings export audit write failed:', e.message); }
      return res.status(200).json({ ok: true, values, exportedBy: who.username || '' });
    }

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
