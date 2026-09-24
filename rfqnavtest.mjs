import fs from 'node:fs';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('./idms.html',import.meta.url),'utf8');
assert.ok(html.includes('data-nav="idms-screen"'));
assert.ok(html.includes('Menu items use one delegated capture-phase handler'));
assert.ok(html.includes("closest('.drop a[data-s]')"));
assert.ok(html.includes("if (s === 'rfq_pipeline') {"));
assert.ok(html.includes('RFQ Pipeline could not load'));
console.log('RFQ navigation source regression: PASS');
