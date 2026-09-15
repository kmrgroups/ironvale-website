// Vercel Hobby-compatible single-function API dispatcher.
// All application API routes are implemented in server/routes/*.js so Vercel
// sees exactly one Serverless Function. Route handlers keep their existing
// request/response contracts; this file only selects the correct handler.
import ai from '../server/routes/ai.js';
import assets from '../server/routes/assets.js';
import auth from '../server/routes/auth.js';
import cnc from '../server/routes/cnc.js';
import content from '../server/routes/content.js';
import device from '../server/routes/device.js';
import hr from '../server/routes/hr.js';
import idms from '../server/routes/idms.js';
import notify from '../server/routes/notify.js';
import orders from '../server/routes/orders.js';
import rfqs from '../server/routes/rfqs.js';
import settings from '../server/routes/settings.js';

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

const handlers = { ai, assets, auth, cnc, content, device, hr, idms, notify, orders, rfqs, settings };

function routeName(req) {
  const q = req.query || {};
  if (q.route) return String(q.route).replace(/^\/+|\/+$/g, '').split('/')[0];
  const path = String(req.url || '').split('?')[0];
  const m = path.match(/^\/api\/([^/]+)/i);
  return m ? m[1].toLowerCase() : '';
}

function queryWithRouteRemoved(req) {
  // Vercel's rewrite passes the original query plus route=. Preserve all
  // application query parameters and hide only the dispatcher parameter.
  const q = { ...(req.query || {}) };
  delete q.route;
  req.query = q;
  return req;
}

export default async function handler(req, res) {
  const name = routeName(req);
  const fn = handlers[name];
  if (!fn) return res.status(404).json({ ok: false, error: `Unknown API route: ${name || 'missing'}` });
  // The device route deliberately consumes raw request bytes. Every other
  // application route uses JSON bodies through the shared readBody() helper.
  if (name !== 'device') {
    try { await prepareJsonBody(req); }
    catch (e) { return res.status(400).json({ ok: false, error: 'Invalid JSON request body.' }); }
  }
  return fn(queryWithRouteRemoved(req), res);
}
