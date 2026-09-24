/* Hybrid drawing evidence tests. These do not call external OCR; they test the
   deterministic text normalization and spatial matching layer. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../engineering-vision.js', import.meta.url), 'utf8');
const context = vm.createContext({
  window: {}, console, setTimeout, clearTimeout,
  Promise, Math, Number, String, Array, Object, Date, RegExp, Error
});
vm.runInContext(source, context, { filename:'engineering-vision.js' });
const V = context.window.EngineeringVision;
assert.ok(V, 'EngineeringVision global exists');
assert.equal(V.normalizeText('Ø16 ±0,05'), 'dia16 pm 0.05');
assert.equal(V.normalizeText('M34×0,75'), 'm34x0.75');
assert.ok(V.similarity('16±0.05', '16 0.05') > 0.6);

const lines = [
  { text:'40 0.16', x:24,y:17,w:8,h:2, words:[] },
  { text:'16 +0.05', x:31,y:21,w:9,h:2, words:[] },
  { text:'16 ±0.05', x:24,y:88,w:10,h:2, words:[] },
  { text:'M34 x 0.75', x:42,y:42,w:12,h:2, words:[] }
];
const m1 = V.matchCandidate({ calloutText:'16 +0.05', calloutX:35, calloutY:22, nominal:16, type:'Dimension' }, lines);
assert.equal(m1.line.text, '16 +0.05');
const m2 = V.matchCandidate({ calloutText:'16 ±0.05', calloutX:29, calloutY:89, nominal:16, type:'Dimension' }, lines);
assert.equal(m2.line.text, '16 ±0.05');
const m3 = V.matchCandidate({ calloutText:'M34x0.75', calloutX:48, calloutY:43, type:'Thread' }, lines);
assert.equal(m3.line.text, 'M34 x 0.75');
console.log('engineeringvisiontest: PASS');
