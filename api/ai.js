// Server-side AI gateway.
// Keeps the API key on the server — it is never sent to the browser.
// Handles plain text prompts and prompts with an attached drawing (PDF or image).
import { cors, readBody } from './_db.js';

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

const MODEL = process.env.AI_MODEL || 'claude-sonnet-4-6';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      alive: true,
      configured: !!process.env.ANTHROPIC_API_KEY,
      model: MODEL,
      note: process.env.ANTHROPIC_API_KEY
        ? 'AI is configured and ready.'
        : 'Add ANTHROPIC_API_KEY in Vercel to switch AI features on.'
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  if (!process.env.ANTHROPIC_API_KEY) {
    // Answered as 200 so the website can fall back gracefully instead of erroring.
    return res.status(200).json({ ok: false, notConfigured: true,
      error: 'AI is not configured on this site yet.' });
  }

  try {
    const body = readBody(req);
    const prompt = String(body.prompt || '');
    const maxTokens = Math.min(parseInt(body.maxTokens, 10) || 1500, 4000);

    // Build the message: optional attachment first, then the instruction.
    const content = [];
    const att = body.attachment;
    if (att && att.b64 && att.mime) {
      if (att.mime === 'application/pdf') {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: att.b64 } });
      } else if (/^image\/(jpeg|png|gif|webp)$/.test(att.mime)) {
        content.push({ type: 'image', source: { type: 'base64', media_type: att.mime, data: att.b64 } });
      } else {
        return res.status(200).json({ ok: false,
          error: `This file type (${att.mime}) cannot be read. Only PDF and image drawings can be analysed.` });
      }
    }
    content.push({ type: 'text', text: prompt });

    const payload = {
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content }]
    };
    if (body.system) payload.system = String(body.system);

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY.trim(),
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const j = await r.json();
    if (!r.ok) {
      console.log('AI error', r.status, JSON.stringify(j).slice(0, 400));
      return res.status(200).json({ ok: false,
        error: (j.error && j.error.message) || `AI request failed (${r.status})` });
    }

    const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    return res.status(200).json({ ok: true, text, usage: j.usage || null });

  } catch (e) {
    console.log('AI HANDLER ERROR:', e.message);
    return res.status(200).json({ ok: false, error: e.message });
  }
}
