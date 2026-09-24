import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('./idms.html', 'utf8');
const start = html.indexOf('  function rfqDecimal(v){');
const end = html.indexOf('  function rfqMergeChars(first, extra){', start);
if (start < 0 || end < 0) throw new Error('RFQ numeric functions not found');
const source = html.slice(start, end);
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(source, ctx);

if (typeof ctx.rfqDecimal !== 'function') throw new Error('rfqDecimal missing');
if (typeof ctx.rfqNormalizeTolerance !== 'function') throw new Error('rfqNormalizeTolerance missing');

const a = { nominal:'1,6', upper:'+0,5', lower:0, calloutText:'16 +0.05/0' };
ctx.rfqNormalizeTolerance(a);
if (a.nominal !== 1.6) throw new Error(`decimal parse failed: ${a.nominal}`);
if (a.upper !== 0.05 || a.lower !== 0) throw new Error(`one-sided tolerance failed: ${a.upper}/${a.lower}`);

const b = { nominal:'16', upper:'0.05', lower:'0.05', calloutText:'16 ±0.05' };
ctx.rfqNormalizeTolerance(b);
if (b.upper !== 0.05 || b.lower !== -0.05) throw new Error(`plus-minus failed: ${b.upper}/${b.lower}`);

const c = { nominal:'40', calloutText:'40 -0.16/0' };
ctx.rfqNormalizeTolerance(c);
if (c.upper !== 0 || c.lower !== -0.16) throw new Error(`lower-only tolerance failed: ${c.upper}/${c.lower}`);

console.log('RFQ runtime numeric fix: PASS');
