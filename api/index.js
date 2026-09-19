// Vercel Hobby-compatible single-function API dispatcher.
// Route handlers are loaded lazily so one optional module cannot crash every API route.

export const config = { api: { bodyParser: false } };

async function prepareJsonBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
  if (req.body !== undefined) return;
  const ct = String(req.headers?.['content-type'] || '').toLowerCase();
  if (!ct.includes('application/json')) return;
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  req.body = raw ? JSON.parse(raw) : {};
}

async function getHandler(name) {
  switch (name) {
    case 'ai': return (await import('../server/routes/ai.js')).default;
    case 'assets': return (await import('../server/routes/assets.js')).default;
    case 'auth': return (await import('../server/routes/auth.js')).default;
    case 'cnc': return (await import('../server/routes/cnc.js')).default;
    case 'content': return (await import('../server/routes/content.js')).default;
    case 'device': return (await import('../server/routes/device.js')).default;
    case 'health': return (await import('../server/routes/health.js')).default;
    case 'hr': return (await import('../server/routes/hr.js')).default;
    case 'idms': return (await import('../server/routes/idms.js')).default;
    case 'mcp': return (await import('../server/routes/mcp.js')).default;
    case 'notify': return (await import('../server/routes/notify.js')).default;
    case 'orders': return (await import('../server/routes/orders.js')).default;
    case 'rfqs': return (await import('../server/routes/rfqs.js')).default;
    case 'settings': return (await import('../server/routes/settings.js')).default;
    default: return null;
  }
}

function routeName(req) {
  const q = req.query || {};
  if (q.route) {
    const first = String(q.route).split('/').find(Boolean);
    return first ? first.toLowerCase() : '';
  }
  const path = String(req.url || '').split('?')[0];
  const parts = path.split('/');
  return parts[1]?.toLowerCase() === 'api' && parts[2] ? parts[2].toLowerCase() : '';
}

function queryWithRouteRemoved(req) {
  const q = { ...(req.query || {}) };
  delete q.route;
  req.query = q;
  return req;
}

export default async function handler(req, res) {
  const name = routeName(req);
  let fn;
  try {
    fn = await getHandler(name);
  } catch (e) {
    console.error('API MODULE LOAD ERROR:', name, e);
    return res.status(500).json({ ok: false, error: `API module failed to load: ${name || 'unknown route'}` });
  }
  if (!fn) return res.status(404).json({ ok: false, error: `Unknown API route: ${name || 'missing'}` });
  if (name !== 'device' && name !== 'health') {
    try { await prepareJsonBody(req); }
    catch (e) { return res.status(400).json({ ok: false, error: 'Invalid JSON request body.' }); }
  }
  return fn(queryWithRouteRemoved(req), res);
}
