// Server-side AI gateway.
// Supports several providers. Whichever key is present is used, in this order:
//   OPENROUTER_API_KEY  – free, no card, many free vision models
//   GROQ_API_KEY        – free, no card, fast
//   GEMINI_API_KEY      – free tier (some accounts are blocked by Google)
//   ANTHROPIC_API_KEY   – paid, best quality on difficult drawings
// Keys stay on the server and are never sent to the browser.
import { cors, readBody, getSecret } from './_db.js';

const CLAUDE_MODEL = process.env.AI_MODEL || 'claude-sonnet-4-6';

// Keys pasted from a website often carry invisible whitespace, quotes or a
// stray "Bearer " prefix. Clean all of that before use.
function cleanKey(v) {
  return String(v || '')
    .replace(/[\r\n\t]/g, '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/^Bearer\s+/i, '')
    .trim();
}
let cache = {};   // discovered model lists, per provider

async function providers() {
  const list = [];
  if (await getSecret('OPENROUTER_API_KEY')) list.push('openrouter');
  if (await getSecret('MISTRAL_API_KEY')) list.push('mistral');
  if (await getSecret('GROQ_API_KEY')) list.push('groq');
  if (await getSecret('GEMINI_API_KEY')) list.push('gemini');
  if (await getSecret('ANTHROPIC_API_KEY')) list.push('anthropic');
  return list;
}

/* ---------------- OpenRouter (free vision models) ---------------- */
async function openrouterModels() {
  if (cache.openrouter) return cache.openrouter;
  try {
    const r = await fetch('https://openrouter.ai/api/v1/models');
    const j = await r.json();
    const free = (j.data || [])
      .filter(m => {
        const p = m.pricing || {};
        const isFree = String(p.prompt) === '0' && String(p.completion) === '0';
        const mods = (m.architecture && m.architecture.input_modalities) || [];
        return isFree && mods.includes('image');
      })
      .map(m => m.id);
    // prefer bigger, well-known vision models
    const score = id => {
      let s = 0;
      if (/qwen.*vl/i.test(id)) s += 40;              // strong at documents
      if (/llama-4|llama4|maverick|scout/i.test(id)) s += 35;
      if (/gemini/i.test(id)) s += 30;
      if (/pixtral|mistral/i.test(id)) s += 25;
      if (/llama-3\.2.*vision/i.test(id)) s += 20;
      if (/intern|glm|minicpm/i.test(id)) s += 10;
      if (/\b(7b|8b|small|mini|tiny|nano)\b/i.test(id)) s -= 12;  // too small for drawings
      if (/note|inkling|preview/i.test(id)) s -= 15;   // experimental
      return s;
    };
    free.sort((a, b) => score(b) - score(a));
    if (free.length) { cache.openrouter = free; return free; }
  } catch (e) { console.log('OpenRouter discovery failed:', e.message); }
  return [
    'meta-llama/llama-4-scout:free',
    'qwen/qwen2.5-vl-72b-instruct:free',
    'meta-llama/llama-3.2-11b-vision-instruct:free'
  ];
}

/* ---------------- Groq (free, fast) ---------------- */
async function groqModels(key, needsVision) {
  const cacheKey = needsVision ? 'groqVision' : 'groqText';
  if (cache[cacheKey]) return cache[cacheKey];
  try {
    const r = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': 'Bearer ' + key }
    });
    const j = await r.json();
    let ids = (j.data || []).map(m => m.id).filter(Boolean);

    // drop things that cannot do chat completions
    ids = ids.filter(id => !/whisper|tts|guard|embed|distil-whisper/i.test(id));

    const looksVision = id => /vision|scout|maverick|llama-4|llama4|vl\b|llava|multimodal|qwen3|qwen2\.5|compound|pixtral|gemma-3/i.test(id);
    if (needsVision) {
      const v = ids.filter(looksVision);
      if (v.length) ids = v;
    }

    const score = id => {
      let s = 0;
      if (/maverick/i.test(id)) s += 40;
      if (/scout/i.test(id)) s += 35;
      if (/qwen/i.test(id)) s += 32;
      if (/compound(?!-mini)/i.test(id)) s += 18;
      if (/gemma-3/i.test(id)) s += 20;
      if (/gpt-oss|orpheus|allam|whisper/i.test(id)) s -= 30;
      if (/llama-4|llama4/i.test(id)) s += 30;
      if (/vision/i.test(id)) s += 25;
      if (/70b|90b|120b/i.test(id)) s += 15;
      if (/17b|32b/i.test(id)) s += 10;
      if (/8b|7b|1b|3b/i.test(id)) s -= 10;
      if (/preview|deprecated/i.test(id)) s -= 8;
      if (/instant/i.test(id)) s -= 5;
      return s;
    };
    ids.sort((a, b) => score(b) - score(a));
    if (ids.length) { cache[cacheKey] = ids; return ids; }
  } catch (e) { console.log('Groq discovery failed:', e.message); }
  return ['meta-llama/llama-4-maverick-17b-128e-instruct',
          'meta-llama/llama-4-scout-17b-16e-instruct'];
}

/* ---------------- Gemini ---------------- */
async function geminiModels(key) {
  if (cache.gemini) return cache.gemini;
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': key }
    });
    const j = await r.json();
    if (!r.ok || !j.models) return null;
    const usable = j.models
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => String(m.name || '').replace(/^models\//, ''))
      .filter(n => /^gemini/.test(n) && !/embedding|aqa|image|tts|audio|native|live|robotics|computer-use/i.test(n));
    const score = n => {
      const ver = parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0');
      let s = 0;
      if (/flash/.test(n)) s += 40;
      if (/lite/.test(n)) s += 8;
      if (/latest/.test(n)) s += 6;
      if (/preview|exp/.test(n)) s -= 25;
      if (/pro/.test(n)) s -= 15;
      return s + ver;
    };
    usable.sort((a, b) => score(b) - score(a));
    if (usable.length) { cache.gemini = usable; return usable; }
  } catch (e) { console.log('Gemini discovery failed:', e.message); }
  return null;
}

/* ---------------- OpenAI-compatible call (OpenRouter + Groq) ---------------- */
async function askOpenAICompatible(base, key, models, args, extraHeaders) {
  const content = [];
  if (args.attachment && args.attachment.b64 && args.attachment.mime) {
    if (/^image\//.test(args.attachment.mime)) {
      content.push({ type: 'image_url',
        image_url: { url: 'data:' + args.attachment.mime + ';base64,' + args.attachment.b64 } });
    } else {
      return { ok: false, error: 'This provider can read image drawings (JPG/PNG) but not PDF. Please upload the drawing as an image.' };
    }
  }
  content.push({ type: 'text', text: args.prompt });

  const messages = [];
  if (args.system) messages.push({ role: 'system', content: args.system });
  messages.push({ role: 'user', content: content.length === 1 ? args.prompt : content });

  const attempts = [];
  let lastError = 'No model responded.';
  for (const model of models.slice(0, 6)) {
    try {
      const r = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: Object.assign({
          'Authorization': 'Bearer ' + key,
          'Content-Type': 'application/json'
        }, extraHeaders || {}),
        body: JSON.stringify({ model, messages, max_tokens: args.maxTokens, temperature: 0.2 })
      });
      const j = await r.json();
      if (!r.ok) {
        lastError = (j.error && (j.error.message || j.error)) || ('Request failed (' + r.status + ')');
        attempts.push(model + ': ' + lastError);
        continue;
      }
      const text = ((j.choices || [])[0] || {}).message;
      const out = text && (typeof text.content === 'string' ? text.content
        : (text.content || []).map(c => c.text || '').join('\n'));
      if (out && out.trim()) return { ok: true, text: out.trim(), model };
      lastError = 'Empty response.';
      attempts.push(model + ': empty response');
    } catch (e) {
      lastError = e.message;
      attempts.push(model + ': ' + e.message);
    }
  }
  return { ok: false, error: lastError, attempts };
}

/* ---------------- Gemini call ---------------- */
async function askGemini(args) {
  const key = cleanKey(await getSecret('GEMINI_API_KEY'));
  const parts = [];
  if (args.attachment && args.attachment.b64 && args.attachment.mime) {
    parts.push({ inline_data: { mime_type: args.attachment.mime, data: args.attachment.b64 } });
  }
  parts.push({ text: args.prompt });
  const body = { contents: [{ role: 'user', parts }],
    generationConfig: { maxOutputTokens: args.maxTokens, temperature: 0.2 } };
  if (args.system) body.systemInstruction = { parts: [{ text: args.system }] };

  const candidates = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL]
    : ((await geminiModels(key)) || ['gemini-3.5-flash-lite', 'gemini-3.5-flash']);

  const attempts = [];
  let lastError = 'No Gemini model responded.';
  for (const model of candidates.slice(0, 8)) {
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body)
      });
      const j = await r.json();
      if (!r.ok) {
        lastError = (j.error && j.error.message) || ('Gemini failed (' + r.status + ')');
        attempts.push(model + ': ' + lastError);
        continue;
      }
      const cand = (j.candidates || [])[0];
      const text = ((cand && cand.content && cand.content.parts) || [])
        .map(p => p.text || '').join('\n').trim();
      if (text) return { ok: true, text, model };
      lastError = 'Gemini returned nothing' + (cand && cand.finishReason ? ' (' + cand.finishReason + ')' : '');
      attempts.push(model + ': ' + lastError);
    } catch (e) {
      lastError = e.message; attempts.push(model + ': ' + e.message);
    }
  }
  return { ok: false, error: lastError, attempts };
}

/* ---------------- Anthropic call ---------------- */
async function askAnthropic(args) {
  const content = [];
  const a = args.attachment;
  if (a && a.b64 && a.mime) {
    if (a.mime === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.b64 } });
    } else if (/^image\/(jpeg|png|gif|webp)$/.test(a.mime)) {
      content.push({ type: 'image', source: { type: 'base64', media_type: a.mime, data: a.b64 } });
    }
  }
  content.push({ type: 'text', text: args.prompt });
  const payload = { model: CLAUDE_MODEL, max_tokens: args.maxTokens, messages: [{ role: 'user', content }] };
  if (args.system) payload.system = args.system;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': cleanKey(await getSecret('ANTHROPIC_API_KEY')),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const j = await r.json();
  if (!r.ok) return { ok: false, error: (j.error && j.error.message) || ('Request failed (' + r.status + ')') };
  const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
  return { ok: true, text, model: CLAUDE_MODEL };
}

async function runProvider(name, args) {
  if (name === 'openrouter') {
    return askOpenAICompatible('https://openrouter.ai/api/v1',
      cleanKey(await getSecret('OPENROUTER_API_KEY')), await openrouterModels(), args,
      { 'HTTP-Referer': process.env.SITE_URL || 'https://www.elixirtec.com', 'X-Title': 'RFQ Engine' });
  }
  if (name === 'mistral') {
    const key = cleanKey(await getSecret('MISTRAL_API_KEY'));
    const models = process.env.MISTRAL_MODEL ? [process.env.MISTRAL_MODEL]
      : ['pixtral-12b-2409', 'mistral-small-latest', 'pixtral-large-latest', 'mistral-medium-latest'];
    return askOpenAICompatible('https://api.mistral.ai/v1', key, models, args, {});
  }
  if (name === 'groq') {
    const key = cleanKey(await getSecret('GROQ_API_KEY'));
    const needsVision = !!(args.attachment && args.attachment.b64);
    const models = process.env.GROQ_MODEL ? [process.env.GROQ_MODEL]
      : await groqModels(key, needsVision);
    return askOpenAICompatible('https://api.groq.com/openai/v1', key, models, args, {});
  }
  if (name === 'gemini') return askGemini(args);
  if (name === 'anthropic') return askAnthropic(args);
  return { ok: false, error: 'Unknown provider' };
}

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const list = await providers();

  if (req.method === 'GET') {
    const info = { alive: true, configured: list.length > 0, providers: list };
    const peek = v => {
      const k = cleanKey(v);
      if (!k) return 'not set';
      return 'length ' + k.length + ', starts "' + k.slice(0, 7) + '"';
    };
    info.keys = {
      OPENROUTER_API_KEY: peek(await getSecret('OPENROUTER_API_KEY')),
      MISTRAL_API_KEY: peek(await getSecret('MISTRAL_API_KEY')),
      GROQ_API_KEY: peek(await getSecret('GROQ_API_KEY')),
      GEMINI_API_KEY: peek(await getSecret('GEMINI_API_KEY')),
      ANTHROPIC_API_KEY: peek(await getSecret('ANTHROPIC_API_KEY'))
    };
    if (list.includes('openrouter')) info.openrouterFreeVisionModels = (await openrouterModels()).slice(0, 8);
    if (list.includes('groq')) {
      const k = cleanKey(await getSecret('GROQ_API_KEY'));
      info.groqVisionModels = (await groqModels(k, true)).slice(0, 6);
      info.groqAllModels = (await groqModels(k, false)).slice(0, 10);
    }
    if (list.includes('gemini')) info.geminiModels = (await geminiModels(cleanKey(await getSecret('GEMINI_API_KEY'))) || []).slice(0, 8);
    info.note = list.length
      ? 'AI is active. Providers tried in order: ' + list.join(' → ')
      : 'Add MISTRAL_API_KEY (free tier, no card) in Vercel to switch AI features on.';
    return res.status(200).json(info);
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  if (!list.length) {
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

    // try each configured provider until one succeeds
    const allAttempts = [];
    for (const name of list) {
      const out = await runProvider(name, args);
      if (out.ok) return res.status(200).json({ ok: true, text: out.text, provider: name, model: out.model });
      allAttempts.push(name + ' → ' + out.error);
      if (out.attempts) out.attempts.slice(0, 3).forEach(a => allAttempts.push('   ' + a));
      console.log('Provider ' + name + ' failed: ' + out.error);
    }
    return res.status(200).json({ ok: false,
      error: 'No AI provider could complete the request.', attempts: allAttempts });

  } catch (e) {
    console.log('AI HANDLER ERROR:', e.message);
    return res.status(200).json({ ok: false, error: e.message });
  }
}
