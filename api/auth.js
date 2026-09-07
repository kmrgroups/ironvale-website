// Sign in, two-step codes, forgot-password reset, face login and user management.
import { sql, hash, ensureTables, cors, readBody, tokenUser, checkRole,
         newSalt, scryptHash, passwordMatches, isLegacyHash,
         startSession, endSession, endAllSessions } from './_db.js';
import { sendNotification } from './notify.js';

const sixDigit = () => String(Math.floor(100000 + Math.random() * 900000));

/* authMethods is stored as JSONB and always has all four keys once a login
   goes through saveUser, but a row inserted before this shipped (or a stray
   NULL) should behave as "everything on" rather than "everything off" —
   an admin who never touched the new fields must not silently lock people out. */
function methodsOf(u) {
  const m = u && u.auth_methods;
  return {
    password: !m || m.password !== false,
    otpEmail: !m || m.otpEmail !== false,
    otpWhatsapp: !m || m.otpWhatsapp !== false,
    face: !m || m.face !== false
  };
}

/* purpose keeps a sign-in code and a password-reset code from being
   interchangeable — a code texted for one must never unlock the other. */
async function issueCode(user, purpose, channel) {
  const code = sixDigit();
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await sql`
    INSERT INTO login_codes (username, code_hash, expires_at, tries, purpose)
    VALUES (${user.username}, ${hash(code)}, ${expires}, 0, ${purpose || 'login'})
    ON CONFLICT (username) DO UPDATE
      SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
          tries = 0, purpose = EXCLUDED.purpose`;

  const sendEmail = channel !== 'whatsapp' && !!user.email;
  const sendWa = channel !== 'email' && !!user.whatsapp;
  const verb = purpose === 'reset' ? 'password reset code' : 'sign-in code';
  const text = `Your ${verb} is ${code}\n\nIt expires in 10 minutes.\n`
    + `If you did not request this, someone may have your password — change it as soon as you sign in.`;
  const results = await sendNotification('custom', {
    to: sendEmail ? user.email : '', whatsapp: sendWa ? user.whatsapp : '',
    subject: (purpose === 'reset' ? 'Password reset code: ' : 'Sign-in code: ') + code, text
  });
  /* sentTo used to be built from "did we try" (does the user have an email/WhatsApp
     number) rather than "did it work" — so the sign-in screen said "a code has been
     sent" even when Resend or the WhatsApp API had actually failed (bad API key,
     unverified sender domain, wrong phone ID, etc). That is why Forgot Password could
     appear to work while the 2FA and OTP-only screens looked broken: all three call
     this same function and are equally exposed to a delivery failure, but only this
     return value decides whether the person is told the truth about it. */
  const emailOk = sendEmail && results.some(r => r.startsWith('EMAIL SENT'));
  const waOk = sendWa && results.some(r => r.startsWith('WHATSAPP SENT') || r.startsWith('WHATSAPP TEMPLATE'));
  const sentTo = [emailOk ? 'email' : null, waOk ? 'WhatsApp' : null].filter(Boolean);
  return { results, sentTo };
}

/* Euclidean distance between two face-recognition descriptors (128-length
   float arrays from face-api.js). Lower is a closer match. 0.6 is
   face-api.js's own documented cut-off for "the same person" (see its
   FaceMatcher default) — this used to be set to 0.5, which is stricter
   than the model was ever tuned for and was rejecting genuine matches
   captured under ordinary webcam lighting rather than a studio photo. */
function faceDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; sum += d * d; }
  return Math.sqrt(sum);
}
const FACE_MATCH_THRESHOLD = 0.6;

function accessFields(u) {
  return { restrictAccess: !!u.restrict_access, permissions: u.permissions || [],
    authMethods: methodsOf(u), faceEnrolled: !!u.face_descriptor };
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

    /* ---------- sign in with a username and password ---------- */
    if (action === 'login') {
      const uname = String(body.user || '').trim();
      const rows = await sql`SELECT * FROM users WHERE username = ${uname}`;
      const u = rows[0];
      if (!u || !passwordMatches(body.pass, u.pass_hash))
        return res.status(401).json({ ok: false, error: 'Incorrect username or password.' });
      if (u.active === false)
        return res.status(403).json({ ok: false, error: 'This account has been deactivated. Contact your administrator.' });
      if (!methodsOf(u).password)
        return res.status(403).json({ ok: false, error: 'Password sign-in is turned off for this account. Use a One-Time Code or Face ID instead.' });

      /* an old unsalted hash is accepted once and immediately replaced, so
         nobody is locked out at cutover and nobody stays on the old scheme */
      if (isLegacyHash(u.pass_hash)) {
        const salt = newSalt();
        await sql`UPDATE users SET pass_hash = ${scryptHash(body.pass, salt)} WHERE username = ${u.username}`;
      }

      if (u.twofa && (u.email || u.whatsapp)) {
        const { sentTo, results } = await issueCode(u, 'login');
        if (!sentTo.length) {
          console.error('2FA code delivery failed for', u.username, results);
          return res.status(502).json({ ok: false,
            error: 'A sign-in code could not be delivered. Ask your administrator to check the email/WhatsApp setup in Admin → Setup, or sign in with One-Time Code / Face ID instead.' });
        }
        return res.status(200).json({ ok: true, needCode: true, user: u.username,
          sentTo, note: 'A 6-digit code has been sent to your ' + sentTo.join(' and ') + '.' });
      }
      const s = await startSession(u.username, u.role, req.headers['user-agent']);
      return res.status(200).json({ ok: true, token: s.token, expiresAt: s.expiresAt,
        user: u.username, role: u.role, ...accessFields(u) });
    }

    /* ---------- sign out ---------- */
    if (action === 'logout') {
      await endSession(token);
      return res.status(200).json({ ok: true });
    }

    /* ---------- is this session still good? ---------- */
    if (action === 'session') {
      const su = await tokenUser(token);
      if (!su) return res.status(401).json({ ok: false, error: 'Your session has ended. Sign in again.' });
      const u = (await sql`SELECT * FROM users WHERE username = ${su.username}`)[0];
      return res.status(200).json({ ok: true, user: su.username, role: su.role,
        ...(u ? accessFields(u) : {}) });
    }

    /* ---------- start an OTP-only sign-in (no password) ----------
       channel picks which registered contact to use — 'email', 'whatsapp',
       or left out to try both. */
    if (action === 'otpRequest') {
      const uname = String(body.user || '').trim();
      const u = (await sql`SELECT * FROM users WHERE username = ${uname}`)[0];
      if (!u) return res.status(404).json({ ok: false, error: 'Unknown user.' });
      if (u.active === false)
        return res.status(403).json({ ok: false, error: 'This account has been deactivated. Contact your administrator.' });
      const methods = methodsOf(u);
      const channel = body.channel === 'whatsapp' ? 'whatsapp' : body.channel === 'email' ? 'email' : null;
      if (channel === 'email' && (!methods.otpEmail || !u.email))
        return res.status(400).json({ ok: false, error: 'Email OTP is not available for this account.' });
      if (channel === 'whatsapp' && (!methods.otpWhatsapp || !u.whatsapp))
        return res.status(400).json({ ok: false, error: 'WhatsApp OTP is not available for this account.' });
      if (!channel && !((methods.otpEmail && u.email) || (methods.otpWhatsapp && u.whatsapp)))
        return res.status(400).json({ ok: false, error: 'No OTP method is set up for this account. Ask your administrator to add an email or WhatsApp number.' });
      const { sentTo, results } = await issueCode(u, 'login', channel);
      if (!sentTo.length) {
        console.error('OTP delivery failed for', u.username, channel || '(any)', results);
        return res.status(502).json({ ok: false,
          error: 'A code could not be delivered. Ask your administrator to check the email/WhatsApp setup in Admin → Setup.' });
      }
      return res.status(200).json({ ok: true, user: u.username, sentTo,
        note: 'A 6-digit code has been sent to your ' + sentTo.join(' and ') + '.' });
    }

    /* ---------- verify a sign-in code (2FA or OTP-only login) ---------- */
    if (action === 'verifyCode') {
      const uname = String(body.user || '').trim();
      const rows = await sql`SELECT * FROM login_codes WHERE username = ${uname}`;
      const c = rows[0];
      if (!c) return res.status(401).json({ ok: false, error: 'No code was requested. Sign in again.' });
      if (c.purpose && c.purpose !== 'login')
        return res.status(401).json({ ok: false, error: 'That code is for resetting your password. Use the Forgot Password screen instead.' });
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
      if (!u || u.active === false)
        return res.status(403).json({ ok: false, error: 'This account has been deactivated. Contact your administrator.' });
      const s = await startSession(u.username, u.role, req.headers['user-agent']);
      return res.status(200).json({ ok: true, token: s.token, expiresAt: s.expiresAt,
        user: u.username, role: u.role, ...accessFields(u) });
    }

    if (action === 'resendCode') {
      const uname = String(body.user || '').trim();
      const u = (await sql`SELECT * FROM users WHERE username = ${uname}`)[0];
      if (!u) return res.status(404).json({ ok: false, error: 'Unknown user.' });
      const { sentTo } = await issueCode(u, 'login');
      return res.status(200).json({ ok: true, sentTo });
    }

    /* ---------- face login — no password, no OTP ----------
       The client sends the 128-number descriptor it computed from the camera
       frame. There is no username: this is a 1-to-many match against every
       enrolled, active account that has Face ID switched on. */
    if (action === 'faceLogin') {
      const descriptor = body.descriptor;
      if (!Array.isArray(descriptor) || descriptor.length < 32)
        return res.status(400).json({ ok: false, error: 'No usable face reading was captured. Try again in better light.' });
      const rows = await sql`SELECT * FROM users WHERE face_descriptor IS NOT NULL AND active = true`;
      let best = null, bestDist = Infinity;
      for (const u of rows) {
        if (!methodsOf(u).face) continue;
        const d = faceDistance(descriptor, u.face_descriptor);
        if (d < bestDist) { bestDist = d; best = u; }
      }
      if (!best || bestDist > FACE_MATCH_THRESHOLD)
        return res.status(401).json({ ok: false, error: 'Face not recognised. Try again, or use another sign-in method.' });
      const s = await startSession(best.username, best.role, req.headers['user-agent']);
      return res.status(200).json({ ok: true, token: s.token, expiresAt: s.expiresAt,
        user: best.username, role: best.role, ...accessFields(best) });
    }

    /* ---------- enrol my own Face ID (must already be signed in) ---------- */
    if (action === 'faceEnroll') {
      const su = await tokenUser(token);
      if (!su) return res.status(401).json({ ok: false, error: 'Not signed in.' });
      const u = (await sql`SELECT * FROM users WHERE username = ${su.username}`)[0];
      if (!u || !methodsOf(u).face)
        return res.status(403).json({ ok: false, error: 'Face ID is turned off for this account. Ask your administrator to enable it.' });
      const descriptor = body.descriptor;
      if (!Array.isArray(descriptor) || descriptor.length < 32)
        return res.status(400).json({ ok: false, error: 'No usable face reading was captured. Try again in better light.' });
      await sql`UPDATE users SET face_descriptor = ${JSON.stringify(descriptor)}::jsonb, face_enrolled_at = now()
                WHERE username = ${su.username}`;
      return res.status(200).json({ ok: true });
    }

    /* ---------- remove my own Face ID enrolment ---------- */
    if (action === 'faceForget') {
      const su = await tokenUser(token);
      if (!su) return res.status(401).json({ ok: false, error: 'Not signed in.' });
      await sql`UPDATE users SET face_descriptor = NULL, face_enrolled_at = NULL WHERE username = ${su.username}`;
      return res.status(200).json({ ok: true });
    }

    /* ---------- forgot password: request an OTP (sent to email AND WhatsApp) ---------- */
    if (action === 'forgotStart') {
      const uname = String(body.user || '').trim();
      const u = (await sql`SELECT * FROM users WHERE username = ${uname}`)[0];
      /* deliberately vague on "unknown user" vs "no contact on file" — a
         username has to be typed either way, but the message never confirms
         which accounts exist */
      if (!u || u.active === false || (!u.email && !u.whatsapp))
        return res.status(200).json({ ok: true, sentTo: [],
          note: 'If that account exists and has a registered email or WhatsApp number, a code has been sent to it.' });
      const { sentTo } = await issueCode(u, 'reset');
      return res.status(200).json({ ok: true, sentTo,
        note: sentTo.length
          ? 'A password reset code has been sent to your ' + sentTo.join(' and ') + '.'
          : 'If that account exists and has a registered email or WhatsApp number, a code has been sent to it.' });
    }

    /* ---------- forgot password: verify the OTP and set a new password ---------- */
    if (action === 'forgotReset') {
      const uname = String(body.user || '').trim();
      const rows = await sql`SELECT * FROM login_codes WHERE username = ${uname}`;
      const c = rows[0];
      if (!c) return res.status(401).json({ ok: false, error: 'No reset code was requested. Start again.' });
      if (c.purpose !== 'reset')
        return res.status(401).json({ ok: false, error: 'That code was issued for signing in, not for a password reset. Request a new one.' });
      if (new Date(c.expires_at) < new Date())
        return res.status(401).json({ ok: false, error: 'That code has expired. Request a new one.' });
      if (c.tries >= 5)
        return res.status(401).json({ ok: false, error: 'Too many attempts. Request a new code.' });
      if (hash(String(body.code || '').trim()) !== c.code_hash) {
        await sql`UPDATE login_codes SET tries = tries + 1 WHERE username = ${uname}`;
        return res.status(401).json({ ok: false, error: 'That code is not right.' });
      }
      if (!body.newPass || String(body.newPass).length < 8)
        return res.status(400).json({ ok: false, error: 'New password must be at least 8 characters.' });

      const u = (await sql`SELECT * FROM users WHERE username = ${uname}`)[0];
      if (!u || u.active === false)
        return res.status(403).json({ ok: false, error: 'This account has been deactivated. Contact your administrator.' });
      const newHash = scryptHash(body.newPass, newSalt());
      await sql`UPDATE users SET pass_hash = ${newHash}, pass_changed_at = now(),
                pass_changed_by = 'self (forgot password)' WHERE username = ${uname}`;
      if (u.role === 'developer')
        await sql`UPDATE auth SET pass_hash = ${newHash} WHERE id = 1`;
      await sql`DELETE FROM login_codes WHERE username = ${uname}`;
      /* a reset is exactly when every existing session for that account should stop working */
      await endAllSessions(uname);
      const s = await startSession(uname, u.role, req.headers['user-agent']);
      return res.status(200).json({ ok: true, token: s.token, expiresAt: s.expiresAt,
        user: uname, role: u.role, ...accessFields({ ...u, pass_hash: newHash }) });
    }

    /* ---------- change your own password (already signed in) ---------- */
    if (action === 'change') {
      const uname = String(body.user || '').trim();
      const u = (await sql`SELECT * FROM users WHERE username = ${uname}`)[0];
      if (!u || !passwordMatches(body.oldPass, u.pass_hash))
        return res.status(401).json({ ok: false, error: 'Current password is incorrect.' });
      if (!body.newPass || String(body.newPass).length < 8)
        return res.status(400).json({ ok: false, error: 'New password must be at least 8 characters.' });

      const newUser = String(body.newUser || u.username).trim();
      const newHash = scryptHash(body.newPass, newSalt());
      await sql`UPDATE users SET username = ${newUser}, pass_hash = ${newHash},
                pass_changed_at = now(), pass_changed_by = 'self' WHERE username = ${uname}`;
      if (u.role === 'developer')
        await sql`UPDATE auth SET user_name = ${newUser}, pass_hash = ${newHash} WHERE id = 1`;
      /* changing a password ends every other session for that person — that is
         the whole point of changing it after a suspected compromise */
      await endAllSessions(uname);
      const s = await startSession(newUser, u.role, req.headers['user-agent']);
      return res.status(200).json({ ok: true, token: s.token, expiresAt: s.expiresAt,
        user: newUser, role: u.role, ...accessFields(u) });
    }

    /* ---------- recovery (deployer-level, outside the app entirely) ---------- */
    if (action === 'reset') {
      const recoveryCode = process.env.ADMIN_RECOVERY_CODE || '';
      if (!recoveryCode)
        return res.status(400).json({ ok: false, error: 'Password recovery is not set up. Ask whoever deployed the site to add an ADMIN_RECOVERY_CODE setting.' });
      if (String(body.recoveryCode || '') !== recoveryCode)
        return res.status(401).json({ ok: false, error: 'That recovery code is incorrect.' });
      if (!body.newUser || !body.newPass || String(body.newPass).length < 8)
        return res.status(400).json({ ok: false, error: 'Enter a username and a password of at least 8 characters.' });

      const newUser = String(body.newUser).trim(), newHash = scryptHash(body.newPass, newSalt());
      const dev = (await sql`SELECT username FROM users WHERE role = 'developer' LIMIT 1`)[0];
      if (dev) await sql`UPDATE users SET username = ${newUser}, pass_hash = ${newHash}, twofa = false,
                          active = true, pass_changed_at = now(), pass_changed_by = 'recovery'
                          WHERE username = ${dev.username}`;
      else await sql`INSERT INTO users (username, pass_hash, role, pass_changed_at, pass_changed_by)
                      VALUES (${newUser}, ${newHash}, 'developer', now(), 'recovery')`;
      await sql`UPDATE auth SET user_name = ${newUser}, pass_hash = ${newHash} WHERE id = 1`;
      /* a recovery is exactly when every existing session should stop working */
      await sql`DELETE FROM sessions`;
      const s = await startSession(newUser, 'developer', req.headers['user-agent']);
      return res.status(200).json({ ok: true, token: s.token, expiresAt: s.expiresAt,
        user: newUser, role: 'developer' });
    }

    /* ================= manage logins (developer/admin role only) =================
       Credentials, authentication options and per-user module access are
       created and changed only from here. The server enforces the role check
       on every one of these — the admin screen just makes the rules visible. */
    if (action === 'listUsers') {
      if (!(await checkRole(token, ['developer'])))
        return res.status(403).json({ ok: false, error: 'Only an administrator can manage users.' });
      const rows = await sql`SELECT username, role, email, whatsapp, twofa, active, auth_methods,
        restrict_access, permissions, (face_descriptor IS NOT NULL) AS face_enrolled,
        face_enrolled_at, pass_changed_at, pass_changed_by
        FROM users ORDER BY role, username`;
      return res.status(200).json({ ok: true, users: rows });
    }

    if (action === 'saveUser') {
      const admin = await checkRole(token, ['developer']);
      if (!admin)
        return res.status(403).json({ ok: false, error: 'Only an administrator can manage users.' });
      const uname = String(body.username || '').trim();
      if (!uname) return res.status(400).json({ ok: false, error: 'Username required.' });
      const role = ['developer', 'staff'].includes(body.role) ? body.role : 'staff';
      const email = String(body.email || '').trim();
      const wa = String(body.whatsapp || '').replace(/\D/g, '');
      const twofa = !!body.twofa;
      const active = body.active !== false;
      const restrictAccess = !!body.restrictAccess;
      const permissions = Array.isArray(body.permissions) ? body.permissions.map(String) : [];
      const am = body.authMethods || {};
      const authMethods = {
        password: am.password !== false, otpEmail: am.otpEmail !== false,
        otpWhatsapp: am.otpWhatsapp !== false, face: am.face !== false
      };

      const existing = (await sql`SELECT username, role FROM users WHERE username = ${uname}`)[0];
      if (existing) {
        if (body.password && String(body.password).length >= 8) {
          await sql`UPDATE users SET pass_hash = ${scryptHash(body.password, newSalt())},
            pass_changed_at = now(), pass_changed_by = ${'admin (' + admin.username + ')'}
            WHERE username = ${uname}`;
          /* a password set by an administrator ends that person's sessions too */
          await endAllSessions(uname);
        }
        await sql`UPDATE users SET role = ${role}, email = ${email}, whatsapp = ${wa}, twofa = ${twofa},
          active = ${active}, restrict_access = ${restrictAccess},
          permissions = ${JSON.stringify(permissions)}::jsonb,
          auth_methods = ${JSON.stringify(authMethods)}::jsonb
          WHERE username = ${uname}`;
        if (body.clearFace)
          await sql`UPDATE users SET face_descriptor = NULL, face_enrolled_at = NULL WHERE username = ${uname}`;
        /* deactivating, or turning off a method somebody was mid-session using,
           should take hold immediately rather than at the next natural sign-out */
        if (!active) await endAllSessions(uname);
      } else {
        if (!body.password || String(body.password).length < 8)
          return res.status(400).json({ ok: false, error: 'New logins need a password of at least 8 characters.' });
        await sql`INSERT INTO users (username, pass_hash, role, email, whatsapp, twofa, active,
                  restrict_access, permissions, auth_methods, pass_changed_at, pass_changed_by)
                  VALUES (${uname}, ${scryptHash(body.password, newSalt())}, ${role}, ${email}, ${wa}, ${twofa},
                  ${active}, ${restrictAccess}, ${JSON.stringify(permissions)}::jsonb,
                  ${JSON.stringify(authMethods)}::jsonb, now(), ${'admin (' + admin.username + ')'})`;
      }
      return res.status(200).json({ ok: true, saved: uname });
    }

    if (action === 'deleteUser') {
      const me = await checkRole(token, ['developer']);
      if (!me) return res.status(403).json({ ok: false, error: 'Only an administrator can manage users.' });
      const uname = String(body.username || '').trim();
      if (uname === me.username)
        return res.status(400).json({ ok: false, error: 'You cannot delete the login you are using.' });
      await sql`DELETE FROM users WHERE username = ${uname}`;
      /* a deleted login must stop working immediately, not when its session expires */
      await endAllSessions(uname);
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
