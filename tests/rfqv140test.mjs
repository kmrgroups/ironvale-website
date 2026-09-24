import fs from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url);
const html = fs.readFileSync(new URL('../idms.html', import.meta.url), 'utf8');
const vision = fs.readFileSync(new URL('../engineering-vision.js', import.meta.url), 'utf8');

assert.match(html, /id="rfq-place-ai"/, 'AI place-all control exists in balloon workspace');
assert.match(html, /async function rfqAutoLocateCharacteristics/, 'existing RFQs can be locally re-located');
assert.match(html, /await rfqAutoLocateCharacteristics\(r,rfqPlaceWork\)/, 'place screen runs local locator');
assert.match(html, /await rfqAutoLocateCharacteristics\(r,current\)/, 'print flow runs local locator');
assert.match(html, /source:'ai-suggested'/, 'AI fallback placement source exists');
assert.match(html, /source:'ai-callout'/, 'AI callout fallback placement exists');
assert.match(html, /source:'ai-feature-anchor'/, 'feature-anchor fallback exists');
assert.match(html, /aiSuggestedCalloutX/, 'original AI position is retained for review');
assert.match(html, /Dimension \/ characteristic text/, 'RFQ editor has direct dimension text box');
assert.match(html, /GD&amp;T \/ symbols/, 'RFQ editor has direct GD&T text box');
assert.match(html, /function rfqQuickSymbolBar/, 'RFQ editor symbol palette exists');
assert.match(html, /class="rpq-symb"/, 'symbol buttons are rendered in RFQ editor');

assert.match(vision, /expectedNumericParts/, 'vision matcher uses structured numeric signatures');
assert.match(vision, /vector-text-run\+numeric-signature/, 'vector PDF evidence is recorded');
assert.match(vision, /fmtHit/, 'formatted numeric matching is used for decimal-sensitive callouts');
assert.match(vision, /m\.score>=0\.66/, 'vector matcher accepts recoverable annotation hits');

console.log('rfqv140test: PASS');
