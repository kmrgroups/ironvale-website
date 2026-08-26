// Sends email (Resend) and WhatsApp (Meta Cloud API).
// Used by rfqs.js, and also reachable directly as a webhook at /api/notify.
import { cors, readBody } from './_db.js';

export async function sendNotification(event, payload = {}, notifyEmail, notifyWhatsapp) {
  const ownerEmail = notifyEmail || process.env.OWNER_EMAIL || '';
  const ownerWa    = notifyWhatsapp || process.env.OWNER_WHATSAPP || '';
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

  } else if (event === 'custom') {
    // free-form message composed by the site (quotation, clarification, etc.)
    toEmail = payload.to || '';
    toWa    = payload.whatsapp || '';
    subject = payload.subject || 'Message';
    text    = payload.text || '';

  } else {
    return [`unknown event: ${event}`];
  }

  // ---- EMAIL ----
  if (!toEmail) {
    results.push('EMAIL SKIPPED: no recipient.');
  } else if (!process.env.RESEND_API_KEY || !process.env.FROM_EMAIL) {
    results.push('EMAIL SKIPPED: RESEND_API_KEY or FROM_EMAIL missing.');
  } else {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY.trim()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: process.env.FROM_EMAIL.trim(),
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
  if (toWa && process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID) {
    const digits = String(toWa).replace(/\D/g, '');
    const url = `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`;
    const headers = {
      'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN.trim()}`,
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
      if (!r.ok) {
        const tpl = process.env.WHATSAPP_TEMPLATE || 'hello_world';
        r = await fetch(url, {
          method: 'POST', headers,
          body: JSON.stringify({
            messaging_product: 'whatsapp', to: digits,
            type: 'template', template: { name: tpl, language: { code: 'en_US' } }
          })
        });
        raw = await r.text();
        results.push(r.ok ? `WHATSAPP TEMPLATE SENT to ${digits}` : `WHATSAPP FAILED: ${raw}`);
      } else {
        results.push(`WHATSAPP SENT to ${digits}`);
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
        RESEND_API_KEY: process.env.RESEND_API_KEY ? 'present' : 'MISSING',
        FROM_EMAIL: process.env.FROM_EMAIL || 'MISSING',
        OWNER_EMAIL: process.env.OWNER_EMAIL || 'not set',
        WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN ? 'present' : 'not set',
        WHATSAPP_PHONE_ID: process.env.WHATSAPP_PHONE_ID || 'not set'
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
