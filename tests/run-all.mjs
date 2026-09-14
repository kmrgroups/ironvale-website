/* Runs every suite from the repository root, so the relative
   readFileSync('index.html') calls inside each suite still resolve.

   Usage:  npm test        (or)  node tests/run-all.mjs
   Needs jsdom installed as a throwaway dev dependency — deliberately NOT in
   package.json, which has exactly one dependency and must keep it. */
import { execFileSync } from 'child_process';
import fs from 'fs';

const suites = fs.readdirSync('tests')
  .filter(f => f.endsWith('test.mjs'))
  .sort();

let failed = 0;
for (const s of suites) {
  process.stdout.write(s.padEnd(20));
  try {
    const out = execFileSync('node', ['tests/' + s], { encoding: 'utf8', timeout: 300000 });
    const line = (out.trim().split('\n').pop() || '').trim();
    console.log(line);
    if (!/ 0 failed/.test(line)) failed++;
  } catch (e) {
    console.log('CRASHED — ' + String((e.stdout || '') + (e.stderr || '')).trim().split('\n').pop());
    failed++;
  }
}
console.log('\n' + (failed ? failed + ' suite(s) need attention' : 'all suites clean'));
process.exit(failed ? 1 : 0);
