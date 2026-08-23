// Sign in and change password.
import { sql, hash, ensureTables, cors, readBody } from './_db.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    await ensureTables();
    const body = readBody(req);
    const action = body.action || 'login';

    const rows = await sql`SELECT user_name, pass_hash FROM auth WHERE id = 1`;
    const current = rows[0];

    if (action === 'login') {
      const ok = current
        && String(body.user).trim() === current.user_name
        && hash(body.pass) === current.pass_hash;
      if (!ok) return res.status(401).json({ ok: false, error: 'Incorrect username or password.' });
      // the token is simply the stored hash — it changes whenever the password changes
      return res.status(200).json({ ok: true, token: current.pass_hash, user: current.user_name });
    }

    if (action === 'change') {
      const ok = current
        && String(body.user).trim() === current.user_name
        && hash(body.oldPass) === current.pass_hash;
      if (!ok) return res.status(401).json({ ok: false, error: 'Current password is incorrect.' });
      if (!body.newPass || String(body.newPass).length < 6)
        return res.status(400).json({ ok: false, error: 'New password must be at least 6 characters.' });

      const newUser = String(body.newUser || current.user_name).trim();
      const newHash = hash(body.newPass);
      await sql`UPDATE auth SET user_name = ${newUser}, pass_hash = ${newHash} WHERE id = 1`;
      return res.status(200).json({ ok: true, token: newHash, user: newUser });
    }

    if (action === 'reset') {
      // Recovery does not require the old password — only the separate recovery
      // code set as an environment variable when the site was deployed.
      const recoveryCode = process.env.ADMIN_RECOVERY_CODE || '';
      if (!recoveryCode) {
        return res.status(400).json({ ok: false, error: 'Password recovery is not set up for this site. Ask whoever deployed it to add an ADMIN_RECOVERY_CODE setting.' });
      }
      if (String(body.recoveryCode || '') !== recoveryCode) {
        return res.status(401).json({ ok: false, error: 'That recovery code is incorrect.' });
      }
      if (!body.newUser || !body.newPass || String(body.newPass).length < 6) {
        return res.status(400).json({ ok: false, error: 'Enter a username and a password of at least 6 characters.' });
      }
      const newUser = String(body.newUser).trim();
      const newHash = hash(body.newPass);
      await sql`UPDATE auth SET user_name = ${newUser}, pass_hash = ${newHash} WHERE id = 1`;
      return res.status(200).json({ ok: true, token: newHash, user: newUser });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.log('AUTH ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
