// Sends email (Resend) and WhatsApp (Meta Cloud API).
// Used by rfqs.js, and also reachable directly as a webhook at /api/notify.
import { cors, readBody, getSecret } from './_db.js';

export async function sendNotification(event, payload = {}, notifyEmail, notifyWhatsapp) {
  const ownerEmail = notifyEmail || (await getSecret('OWNER_EMAIL')) || '';
  const ownerWa    = notifyWhatsapp || (await getSecret('OWNER_WHATSAPP')) || '';
  const pipeline   = payload.pipelineUrl || '';
  const results    = [];

  let toEmail = '', toWa = '', subject = '', text = '';

  if (event === 'rfq_received') {
    toEmail = ownerEmail; toWa = ownerWa;
    subject = `New RFQ ${payload.ref} — ${payload.name || 'Unknown'}`;
    text = [
      `NEW RFQ RECEIVED`,
      `Reference: ${payload.ref}`,
      `Received:  ${new Date().toLocaleString()}`,
      ``,
      `Name:    ${payload.name || '-'}`,
      `Company: ${payload.company || '-'}`,
      `Email:   ${payload.email || '-'}`,
      `Phone:   ${payload.phone || '-'}`,
      ``,
      `Requirement:`,
      `${payload.message || '-'}`,
      payload.file ? `\nAttachment: ${payload.file}` : '',
      ``,
      pipeline
        ? `------------------------------\nOPEN THE RFQ PIPELINE:\n${pipeline}\n(sign in with your staff username and password)\n------------------------------`
        : `Open the RFQ Pipeline from the RFQ Pipeline button on your website.`
    ].filter(Boolean).join('\n');

  } else if (event === 'quote_approved') {
    const c = payload.customer || {};
    toEmail = c.email || ''; toWa = c.phone || '';
    subject = `Your quotation — ${payload.ref}`;
    text = [
      `Dear ${c.name || 'Customer'},`, ``,
      `Please find your quotation below.`, ``,
      payload.quote || '', ``,
      `Reference: ${payload.ref}`,
      `You can track this enquiry on our website using the reference above.`
    ].join('\n');

  } else if (event === 'rfq_acknowledge') {
    // automatic reply to the customer, clearly marked as machine-generated
    toEmail = payload.email || '';
    toWa    = payload.phone || '';
    subject = `We have received your enquiry — ${payload.ref}`;
    text = [
      `Dear ${payload.name || 'Sir/Madam'},`,
      ``,
      `Thank you for your enquiry. It has been received and logged.`,
      ``,
      `Reference:  ${payload.ref}`,
      `Received:   ${new Date().toLocaleString()}`,
      payload.message ? `\nYour requirement:\n${payload.message}` : '',
      ``,
      `Our estimating team is reviewing it and will respond with a quotation`,
      `or any clarification we need.`,
      payload.trackUrl ? `\nYou can check progress at any time using your reference:\n${payload.trackUrl}` : '',
      ``,
      payload.company ? `${payload.company}` : '',
      ``,
      `———————————————————————————————`,
      `This acknowledgement was generated automatically by our system.`,
      `Please do not reply to this message — a member of our team will`,
      `contact you directly.`,
      `———————————————————————————————`
    ].filter(l => l !== '').join('\n');

  } else if (event === 'custom') {
    // free-form message composed by the site (quotation, clarification, etc.)
    // With no explicit recipient, it goes to the owner — that is how internal
    // alerts such as "new job application" reach the recruiter.
    toEmail = payload.to || ownerEmail || '';
    toWa    = payload.whatsapp || ownerWa || '';
    subject = payload.subject || 'Message';
    text    = payload.text || '';

  } else {
    return [`unknown event: ${event}`];
  }

  // ---- EMAIL ----
  if (!toEmail) {
    results.push('EMAIL SKIPPED: no recipient.');
  } else if (!(await getSecret('RESEND_API_KEY')) || !(await getSecret('FROM_EMAIL'))) {
    results.push('EMAIL SKIPPED: Resend API key or sender address not set — open Setup in the admin panel.');
  } else {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${await getSecret('RESEND_API_KEY')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: await getSecret('FROM_EMAIL'),
          to: [toEmail.trim()],
          subject, text
        })
      });
      const raw = await r.text();
      console.log('Resend', r.status, raw);
      results.push(r.ok ? `EMAIL SENT to ${toEmail}` : `EMAIL FAILED (${r.status}): ${raw}`);
    } catch (e) { results.push(`EMAIL ERROR: ${e.message}`); }
  }

  // ---- WHATSAPP ----
  const waToken = await getSecret('WHATSAPP_TOKEN'), waPhone = await getSecret('WHATSAPP_PHONE_ID');
  if (toWa && waToken && waPhone) {
    const digits = String(toWa).replace(/\D/g, '');
    const url = `https://graph.facebook.com/v21.0/${waPhone}/messages`;
    const headers = {
      'Authorization': `Bearer ${waToken}`,
      'Content-Type': 'application/json'
    };
    try {
      let r = await fetch(url, {
        method: 'POST', headers,
        body: JSON.stringify({
          messaging_product: 'whatsapp', to: digits,
          type: 'text', text: { body: text.slice(0, 4000) }
        })
      });
      let raw = await r.text();
      const idOf = txt => {
        try { const j = JSON.parse(txt); return (j.messages && j.messages[0] && j.messages[0].id) || ''; }
        catch (e) { return ''; }
      };
      const waIdOf = txt => {
        try { const j = JSON.parse(txt); return (j.contacts && j.contacts[0] && j.contacts[0].wa_id) || ''; }
        catch (e) { return ''; }
      };

      if (!r.ok) {
        const tpl = (await getSecret('WHATSAPP_TEMPLATE')) || 'hello_world';
        console.log('WhatsApp free-form refused, trying template ' + tpl + ':', raw);
        r = await fetch(url, {
          method: 'POST', headers,
          body: JSON.stringify({
            messaging_product: 'whatsapp', to: digits,
            type: 'template', template: { name: tpl, language: { code: 'en_US' } }
          })
        });
        raw = await r.text();
        results.push(r.ok
          ? `WHATSAPP TEMPLATE "${tpl}" SENT to ${digits} (delivered to ${waIdOf(raw) || '?'}, id ${idOf(raw) || '?'})`
          : `WHATSAPP FAILED: ${raw}`);
      } else {
        const delivered = waIdOf(raw);
        const mismatch = delivered && delivered !== digits;
        results.push(`WHATSAPP SENT to ${digits}`
          + (delivered ? ` — Meta delivered to ${delivered}${mismatch ? ' (DIFFERENT NUMBER — check the recipient you registered)' : ''}` : '')
          + ` — id ${idOf(raw) || '?'}`);
        console.log('WhatsApp accepted:', raw);
      }
    } catch (e) { results.push(`WHATSAPP ERROR: ${e.message}`); }
  } else {
    results.push('WHATSAPP SKIPPED (not configured)');
  }

  console.log('NOTIFY RESULTS:', JSON.stringify(results));
  return results;
}

// Direct webhook use + a self-check page
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      alive: true,
      checks: {
        DATABASE_URL: process.env.DATABASE_URL ? 'present' : 'MISSING',
        RESEND_API_KEY: (await getSecret('RESEND_API_KEY')) ? 'present' : 'MISSING',
        FROM_EMAIL: (await getSecret('FROM_EMAIL')) || 'MISSING',
        OWNER_EMAIL: (await getSecret('OWNER_EMAIL')) || 'not set',
        WHATSAPP_TOKEN: (await getSecret('WHATSAPP_TOKEN')) ? 'present' : 'not set',
        WHATSAPP_PHONE_ID: (await getSecret('WHATSAPP_PHONE_ID')) || 'not set'
      }
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  try {
    const body = readBody(req);
    const results = await sendNotification(body.event, body.payload || {}, body.notifyEmail, body.notifyWhatsapp);
    return res.status(200).json({ ok: true, results });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
