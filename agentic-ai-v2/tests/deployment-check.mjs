import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const api = path.join(root, 'api');
const files = fs.readdirSync(api).filter(f => f.endsWith('.js')).sort();
if (files.length > 12) throw new Error(`Vercel Hobby check failed: ${files.length} API function files found.`);
if (files.includes('_db.js') || files.includes('_attendance.js') || files.includes('agentic.js')) {
  throw new Error('Vercel Hobby check failed: shared/agentic helper was left under api/.');
}
if (!files.includes('ai.js')) throw new Error('Vercel Hobby check failed: api/ai.js missing.');
const v = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const rewrites = v.rewrites || [];
if (!rewrites.some(x => x.source === '/api/agentic' && String(x.destination).includes('/api/ai?mode=agentic'))) {
  throw new Error('Compatibility rewrite /api/agentic -> /api/ai?mode=agentic is missing.');
}
console.log(`Vercel Hobby deployment check OK: ${files.length} API function files.`);
console.log(files.join(', '));
