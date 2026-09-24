import fs from 'fs';
import assert from 'node:assert/strict';

const cfg = JSON.parse(fs.readFileSync('vercel.json','utf8'));
const rewrites = cfg.rewrites || [];

assert.equal(
  rewrites.some(r => r.source === '/idms.html' && r.destination === '/api/idms-screen'),
  false,
  'Vercel must not replace local /idms.html with the remote GitHub proxy'
);
assert.deepEqual(
  rewrites.find(r => r.source === '/idms'),
  { source: '/idms', destination: '/idms.html' },
  '/idms must resolve to the deployed local IDMS document'
);
assert.deepEqual(
  rewrites.find(r => r.source === '/idms/'),
  { source: '/idms/', destination: '/idms.html' },
  '/idms/ must resolve to the deployed local IDMS document'
);

const html = fs.readFileSync('idms.html','utf8');
assert.match(html, /\['rfq_pipeline','📨','RFQ Pipeline',1\]/,
  'The deployed IDMS source must declare the RFQ Pipeline menu entry');
assert.ok(html.includes("data-s=\"'+it[0]+'\""),
  'The menu renderer must emit data-s links');
assert.match(html, /if \(s === 'rfq_pipeline'\)/,
  'The deployed IDMS source must route rfq_pipeline');
assert.match(html, /async function loadRfqPipeline\(\)/,
  'The deployed IDMS source must contain the RFQ Pipeline loader');


assert.match(html, /id=\"nav-rfq-pipeline\" data-rfq-direct=\"1\"/,
  'The RFQ menu item must have a dedicated direct-navigation hook');
assert.match(html, /function openRfqPipelineDirect\(\)/,
  'The deployed IDMS source must contain a dedicated RFQ navigation function');
assert.match(html, /if \(s === 'rfq_pipeline'\) return openRfqPipelineDirect\(\)/,
  'navigate() must route RFQ through the dedicated path');
assert.match(html, /__idmsRfqDirectWired/,
  'Document capture must catch RFQ links outside the top menu');


assert.match(html, /onclick=\"return window\.openRfqPipelineDirect/,
  'The RFQ menu item must carry an inline browser-native fallback');
assert.match(html, /hashchange/,
  'RFQ must also open when the browser changes #s=rfq_pipeline natively');
assert.match(html, /__idmsRfqPointerWired/,
  'RFQ must have a pointerdown capture fallback for touch and mouse');

console.log('RFQ deployment/navigation source regression: PASS');
