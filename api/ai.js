// Server-side AI gateway — supports Google Gemini (free tier) or Anthropic.
// Whichever key is present is used; Gemini is preferred when both exist.
// The key stays on the server and is never sent to the browser.
import { cors, readBody } from './_db.js';

// Tried in order. If Google retires one, the next is used automatically.
const GEMINI_MODELS = process.env.GEMINI_MODEL
  ? [process.env.GEMINI_MODEL]
  : ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash'];
const GEMINI_MODEL = GEMINI_MODELS[0];
const CLAUDE_MODEL = process.env.AI_MODEL || 'claude-sonnet-4-6';

function provider() {
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

async function askGemini({ prompt, system, attachment, maxTokens }) {
  const parts = [];
  if (attachment && attachment.b64 && attachment.mime) {
    parts.push({ inline_data: { mime_type: attachment.mime, data: attachment.b64 } });
  }
  parts.push({ text: prompt });

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 }
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  let lastError = 'No Gemini model responded.';
  for (const model of GEMINI_MODELS) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
      model + ':generateContent?key=' + encodeURIComponent(process.env.GEMINI_API_KEY.trim());

    let r, j;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      j = await r.json();
    } catch (e) {
      lastError = e.message;
      continue;
    }

    if (!r.ok) {
      lastError = (j.error && j.error.message) || ('Gemini request failed (' + r.status + ')');
      // a retired or unknown model: quietly try the next one
      if (/not found|no longer available|not supported|unsupported/i.test(lastError)) {
        console.log('Gemini model ' + model + ' unavailable, trying next.');
        continue;
      }
      return { ok: false, error: lastError };
    }

    const cand = (j.candidates || [])[0];
    const text = ((cand && cand.content && cand.content.parts) || [])
      .map(function (p) { return p.text || ''; }).join('\n').trim();
    if (!text && cand && cand.finishReason) {
      return { ok: false, error: 'Gemini stopped early: ' + cand.finishReason };
    }
    return { ok: true, text: text, provider: 'gemini', model: model };
  }
  return { ok: false, error: lastError };
}

async function askAnthropic({ prompt, system, attachment, maxTokens }) {
  const content = [];
  if (attachment && attachment.b64 && attachment.mime) {
    if (attachment.mime === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: attachment.b64 } });
    } else if (/^image\/(jpeg|png|gif|webp)$/.test(attachment.mime)) {
      content.push({ type: 'image', source: { type: 'base64', media_type: attachment.mime, data: attachment.b64 } });
    }
  }
  content.push({ type: 'text', text: prompt });

  const payload = { model: CLAUDE_MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: content }] };
  if (system) payload.system = system;

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
  if (!r.ok) return { ok: false, error: (j.error && j.error.message) || ('AI request failed (' + r.status + ')') };
  const text = (j.content || []).filter(function (c) { return c.type === 'text'; })
    .map(function (c) { return c.text; }).join('\n').trim();
  return { ok: true, text: text, provider: 'anthropic', model: CLAUDE_MODEL };
}

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const p = provider();

  if (req.method === 'GET') {
    return res.status(200).json({
      alive: true,
      configured: !!p,
      provider: p || 'none',
      model: p === 'gemini' ? GEMINI_MODEL : (p === 'anthropic' ? CLAUDE_MODEL : null),
      note: p
        ? ('AI is active using ' + (p === 'gemini' ? 'Google Gemini' : 'Anthropic Claude') + '.')
        : 'Add GEMINI_API_KEY (free tier) or ANTHROPIC_API_KEY in Vercel to switch AI features on.'
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  if (!p) {
    return res.status(200).json({ ok: false, notConfigured: true,
      error: 'AI is not configured on this site yet.' });
  }

  try {
    const body = readBody(req);
    const args = {
      prompt: String(body.prompt || ''),
      system: body.system ? String(body.system) : null,
      attachment: body.attachment || null,
      maxTokens: Math.min(parseInt(body.maxTokens, 10) || 1500, 8000)
    };

    if (args.attachment && args.attachment.mime &&
        !/^(application\/pdf|image\/(jpeg|png|gif|webp))$/.test(args.attachment.mime)) {
      return res.status(200).json({ ok: false,
        error: 'This file type (' + args.attachment.mime + ') cannot be read. Only PDF and image drawings can be analysed.' });
    }

    const out = p === 'gemini' ? await askGemini(args) : await askAnthropic(args);
    if (!out.ok) console.log('AI error:', out.error);
    return res.status(200).json(out);

  } catch (e) {
    console.log('AI HANDLER ERROR:', e.message);
    return res.status(200).json({ ok: false, error: e.message });
  }
}
