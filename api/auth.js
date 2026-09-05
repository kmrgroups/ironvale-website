// Sign in, two-step codes, password changes and user management.
import { sql, hash, ensureTables, cors, readBody, tokenUser, checkRole } from './_db.js';
import { sendNotification } from './notify.js';

const sixDigit = () => String(Math.floor(100000 + Math.random() * 900000));

async function issueCode(user) {
  const code = sixDigit();
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await sql`
    INSERT INTO login_codes (username, code_hash, expires_at, tries)
    VALUES (${user.username}, ${hash(code)}, ${expires}, 0)
    ON CONFLICT (username) DO UPDATE
      SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, tries = 0`;

  const text = `Your sign-in code is ${code}\n\nIt expires in 10 minutes.\n`
    + `If you did not try to sign in, someone has your password — change it.`;
  const results = await sendNotification('custom', {
    to: user.email || '', whatsapp: user.whatsapp || '',
    subject: 'Sign-in code: ' + code, text
  });
  return { results, sentTo: [user.email ? 'email' : null, user.whatsapp ? 'WhatsApp' : null].filter(Boolean) };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    await ensureTables();
    const body = readBody(req);
    const action = body.action || 'login';
    const token = req.headers['x-auth-token'];

    /* ---------- sign in ---------- */
    if (action === 'login') {
      const uname = String(body.user || '').trim();
      const rows = await sql`SELECT * FROM users WHERE username = ${uname}`;
      const u = rows[0];
      if (!u || hash(body.pass) !== u.pass_hash)
        return res.status(401).json({ ok: false, error: 'Incorrect username or password.' });

      if (u.twofa && (u.email || u.whatsapp)) {
        const { sentTo } = await issueCode(u);
        return res.status(200).json({ ok: true, needCode: true, user: u.username,
          sentTo, note: 'A 6-digit code has been sent to your ' + sentTo.join(' and ') + '.' });
      }
      return res.status(200).json({ ok: true, token: u.pass_hash, user: u.username, role: u.role });
    }

    /* ---------- verify the code ---------- */
    if (action === 'verifyCode') {
      const uname = String(body.user || '').trim();
      const rows = await sql`SELECT * FROM login_codes WHERE username = ${uname}`;
      const c = rows[0];
      if (!c) return res.status(401).json({ ok: false, error: 'No code was requested. Sign in again.' });
      if (new Date(c.expires_at) < new Date())
        return res.status(401).json({ ok: false, error: 'That code has expired. Sign in again.' });
      if (c.tries >= 5)
        return res.status(401).json({ ok: false, error: 'Too many attempts. Sign in again.' });

      if (hash(String(body.code || '').trim()) !== c.code_hash) {
        await sql`UPDATE login_codes SET tries = tries + 1 WHERE username = ${uname}`;
        return res.status(401).json({ ok: false, error: 'That code is not right.' });
      }
      await sql`DELETE FROM login_codes WHERE username = ${uname}`;
      const u = (await sql`SELECT * FROM users WHERE username = ${uname}`)[0];
      return res.status(200).json({ ok: true, token: u.pass_hash, user: u.username, role: u.role });
    }

    if (action === 'resendCode') {
      const uname = String(body.user || '').trim();
      const u = (await sql`SELECT * FROM users WHERE username = ${uname}`)[0];
      if (!u) return res.status(404).json({ ok: false, error: 'Unknown user.' });
      const { sentTo } = await issueCode(u);
      return res.status(200).json({ ok: true, sentTo });
    }

    /* ---------- change your own password ---------- */
    if (action === 'change') {
      const uname = String(body.user || '').trim();
      const u = (await sql`SELECT * FROM users WHERE username = ${uname}`)[0];
      if (!u || hash(body.oldPass) !== u.pass_hash)
        return res.status(401).json({ ok: false, error: 'Current password is incorrect.' });
      if (!body.newPass || String(body.newPass).length < 6)
        return res.status(400).json({ ok: false, error: 'New password must be at least 6 characters.' });

      const newUser = String(body.newUser || u.username).trim();
      const newHash = hash(body.newPass);
      await sql`UPDATE users SET username = ${newUser}, pass_hash = ${newHash} WHERE username = ${uname}`;
      if (u.role === 'developer')
        await sql`UPDATE auth SET user_name = ${newUser}, pass_hash = ${newHash} WHERE id = 1`;
      return res.status(200).json({ ok: true, token: newHash, user: newUser, role: u.role });
    }

    /* ---------- recovery ---------- */
    if (action === 'reset') {
      const recoveryCode = process.env.ADMIN_RECOVERY_CODE || '';
      if (!recoveryCode)
        return res.status(400).json({ ok: false, error: 'Password recovery is not set up. Ask whoever deployed the site to add an ADMIN_RECOVERY_CODE setting.' });
      if (String(body.recoveryCode || '') !== recoveryCode)
        return res.status(401).json({ ok: false, error: 'That recovery code is incorrect.' });
      if (!body.newUser || !body.newPass || String(body.newPass).length < 6)
        return res.status(400).json({ ok: false, error: 'Enter a username and a password of at least 6 characters.' });

      const newUser = String(body.newUser).trim(), newHash = hash(body.newPass);
      const dev = (await sql`SELECT username FROM users WHERE role = 'developer' LIMIT 1`)[0];
      if (dev) await sql`UPDATE users SET username = ${newUser}, pass_hash = ${newHash}, twofa = false WHERE username = ${dev.username}`;
      else await sql`INSERT INTO users (username, pass_hash, role) VALUES (${newUser}, ${newHash}, 'developer')`;
      await sql`UPDATE auth SET user_name = ${newUser}, pass_hash = ${newHash} WHERE id = 1`;
      return res.status(200).json({ ok: true, token: newHash, user: newUser, role: 'developer' });
    }

    /* ---------- manage logins (developer only) ---------- */
    if (action === 'listUsers') {
      if (!(await checkRole(token, ['developer'])))
        return res.status(403).json({ ok: false, error: 'Only the developer login can manage users.' });
      const rows = await sql`SELECT username, role, email, whatsapp, twofa FROM users ORDER BY role, username`;
      return res.status(200).json({ ok: true, users: rows });
    }

    if (action === 'saveUser') {
      if (!(await checkRole(token, ['developer'])))
        return res.status(403).json({ ok: false, error: 'Only the developer login can manage users.' });
      const uname = String(body.username || '').trim();
      if (!uname) return res.status(400).json({ ok: false, error: 'Username required.' });
      const role = ['developer', 'staff'].includes(body.role) ? body.role : 'staff';
      const email = String(body.email || '').trim();
      const wa = String(body.whatsapp || '').replace(/\D/g, '');
      const twofa = !!body.twofa;

      const existing = (await sql`SELECT username FROM users WHERE username = ${uname}`)[0];
      if (existing) {
        if (body.password && String(body.password).length >= 6) {
          await sql`UPDATE users SET pass_hash = ${hash(body.password)} WHERE username = ${uname}`;
        }
        await sql`UPDATE users SET role = ${role}, email = ${email}, whatsapp = ${wa}, twofa = ${twofa} WHERE username = ${uname}`;
      } else {
        if (!body.password || String(body.password).length < 6)
          return res.status(400).json({ ok: false, error: 'New logins need a password of at least 6 characters.' });
        await sql`INSERT INTO users (username, pass_hash, role, email, whatsapp, twofa)
                  VALUES (${uname}, ${hash(body.password)}, ${role}, ${email}, ${wa}, ${twofa})`;
      }
      return res.status(200).json({ ok: true, saved: uname });
    }

    if (action === 'deleteUser') {
      const me = await checkRole(token, ['developer']);
      if (!me) return res.status(403).json({ ok: false, error: 'Only the developer login can manage users.' });
      const uname = String(body.username || '').trim();
      if (uname === me.username)
        return res.status(400).json({ ok: false, error: 'You cannot delete the login you are using.' });
      await sql`DELETE FROM users WHERE username = ${uname}`;
      return res.status(200).json({ ok: true, removed: uname });
    }

    if (action === 'whoami') {
      const u = await tokenUser(token);
      return res.status(200).json({ ok: !!u, user: u });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.log('AUTH ERROR:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
