import fs from 'fs';
import path from 'path';
const root = path.resolve('.');
const api = path.join(root, 'api');
const funcs = fs.readdirSync(api).filter(f => /\.(js|mjs|ts|tsx)$/.test(f));
const bad = funcs.filter(f => f !== 'index.js');
if (funcs.length !== 1 || bad.length) {
  console.error(`FAIL: Vercel function files found: ${funcs.join(', ')}`);
  process.exit(1);
}
const v = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const routes = new Set((v.rewrites || []).map(x => x.source));
for (const r of ['/api/ai','/api/assets','/api/auth','/api/cnc','/api/content','/api/device','/api/hr','/api/idms','/api/notify','/api/orders','/api/rfqs','/api/settings']) {
  if (!routes.has(r)) { console.error(`FAIL: missing rewrite ${r}`); process.exit(1); }
}
console.log('PASS: Vercel Hobby deployment exposes exactly 1 Serverless Function and all 12 API routes are rewritten to it.');
