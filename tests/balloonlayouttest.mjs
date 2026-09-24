/* Where the balloons actually land.

   Reported from the live site: "balloon drawing accuracy of marking is not
   correct." The sheet showed balloons piled on top of each other in the dense
   views, and it was impossible to tell which number belonged to which callout
   — so a wrong reading and a right one looked exactly the same.

   Two faults, and the second was what made the first unfixable:

   1. Every balloon was offset the same fixed distance above its callout, with
      nothing stopping two landing on the same spot. Dimensions cluster; that
      is what a drawing is. So the balloons clustered too.
   2. The leader had to be vertical, because it was drawn in an SVG whose
      viewBox was stretched to the sheet's aspect and any other angle skewed.
      That pinned each balloon directly above its callout — precisely where its
      neighbour wanted to be.

   Both need a PIXEL measurement of the rendered sheet, which nothing has until
   the image is on screen and which jsdom never has at all: it reports every
   width as zero, so "do these two balloons overlap" has no answer there. Hence
   a real browser.

   What is asserted is what a person needs from the sheet, not how the code
   works: no balloon covers another, no balloon covers the callout it numbers,
   every leader still reaches the point the AI actually gave, and nothing has
   been pushed off the sheet. It deliberately does NOT assert that the AI's
   coordinates are right — nothing in this layer can make them right. Spreading
   the balloons apart is what makes a wrong one visible and checkable instead of
   buried in a pile, and that is the whole claim.

   Skips itself, passing, without Playwright. */
import fs from 'fs';
import path from 'path';

const results = [];
const check = (n, c, x) => results.push([n, !!c, x === undefined ? '' : String(x)]);
const done = () => {
  const pass = results.filter(r => r[1]).length;
  results.forEach(([n, c, x]) => console.log((c ? '  ok  ' : '  x   ') + ' ' + n + (c || !x ? '' : '   [' + x + ']')));
  console.log('\n' + pass + ' passed, ' + (results.length - pass) + ' failed, of ' + results.length);
  process.exit(results.length - pass ? 1 : 0);
};

let chromium, exe;
try {
  ({ chromium } = await import('playwright'));
  const root = '/opt/pw-browsers';
  exe = fs.readdirSync(root).filter(d => /^chromium-/.test(d))
    .map(d => path.join(root, d, 'chrome-linux', 'chrome')).find(p => fs.existsSync(p));
  if (!exe) throw new Error('no chromium under /opt/pw-browsers');
} catch (e) {
  console.log('  --   skipped: ' + e.message + ' (balloon geometry needs a real browser)');
  console.log('\n0 passed, 0 failed, of 0');
  process.exit(0);
}

const idms = fs.readFileSync('idms.html', 'utf8');

/* The real layout pass and the real balloon CSS, lifted out of idms.html so
   this test cannot drift from the code it is checking. */
const layout = (idms.match(/function rfqBalloonLayoutJs\(\)\{\s*return ([\s\S]*?);\n  \}/) || [])[1];
check('the layout pass was found in idms.html', !!layout && layout.length > 800, String((layout || '').length));
if (!layout) done();
// it is a JS expression that concatenates the script text — evaluate it here
const script = new Function('return ' + layout)();
check('…and it evaluates to a real script', /getAttribute\("data-cx"\)/.test(script), script.slice(0, 60));

/* The print window's CSS is built by concatenating single-quoted fragments, so
   it is gathered the same way: take the region that defines the balloons and
   join every string literal in it. An earlier version split on '+' and got
   nothing usable — the balloons then rendered as plain inline spans, every
   geometry check failed at once, and the fault was in this test rather than in
   the code it was accusing. */
const blRegion = idms.slice(idms.indexOf("'.bl-ov{"), idms.indexOf(".bl-b.bl-sc") + 400)
  /* comments first: one of them contains an escaped apostrophe, and a scanner
     looking for string literals treats that as a quote, falls out of step and
     swallows the .bl-b rule whole. That is what made every balloon render as a
     plain inline span here while the real print window was fine. */
  .replace(/\/\*[\s\S]*?\*\//g, '');
const blCss = (blRegion.match(/'(?:[^'\\]|\\.)*'/g) || [])
  .map(t => t.slice(1, -1).replace(/\\'/g, "'")).join('');
check('the balloon CSS was found, and really is CSS',
  /\.bl-b\{/.test(blCss) && /border-radius:50%/.test(blCss) && /position:absolute/.test(blCss),
  blCss.slice(0, 70));

const browser = await chromium.launch({ executablePath: exe });

/* A deliberately nasty reading: eight characteristics, six of them clustered
   inside one small view the way real dimensions cluster, one hard against the
   top edge, one hard against the right. This is the case the old fixed offset
   could not survive. */
const CHARS = [
  { no: 1, x: 30, y: 40 }, { no: 2, x: 31, y: 41 }, { no: 3, x: 32, y: 40.5 },
  { no: 4, x: 30.5, y: 42 }, { no: 5, x: 33, y: 41.5 }, { no: 6, x: 31.5, y: 39 },
  { no: 7, x: 50, y: 2 }, { no: 8, x: 99, y: 60 }
];

const run = async (w, h) => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  /* a real bitmap so the image genuinely loads and has a real rendered size */
  const png = 'data:image/svg+xml;base64,' + Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#fff"/></svg>`
  ).toString('base64');
  await page.setContent(
    '<style>body{margin:0}.wrap{position:relative;display:inline-block;max-width:100%;}' +
    '.wrap img{display:block;max-width:100%;}' + blCss + '</style>' +
    '<div class="wrap"><img src="' + png + '" alt="drawing">' +
    '<svg class="bl-ov" preserveAspectRatio="none"></svg>' +
    CHARS.map(c => '<span class="bl-b" data-cx="' + c.x + '" data-cy="' + c.y +
      '" style="left:' + c.x + '%;top:' + c.y + '%;">' + c.no + '</span>').join('') +
    '</div>');
  await page.waitForFunction(() => document.querySelector('.wrap img').complete);
  await page.addScriptTag({ content: script });
  await page.waitForFunction(() => document.querySelector('.wrap[data-laid]'), null, { timeout: 4000 });
  const geo = await page.evaluate(() => {
    const wrap = document.querySelector('.wrap'), img = wrap.querySelector('img');
    const W = img.clientWidth, H = img.clientHeight;
    const wr = wrap.getBoundingClientRect();
    const balloons = [].slice.call(wrap.querySelectorAll('.bl-b')).map(b => {
      const r = b.getBoundingClientRect();
      return { no: b.textContent, cx: parseFloat(b.dataset.cx) / 100 * W, cy: parseFloat(b.dataset.cy) / 100 * H,
               x: r.left - wr.left + r.width / 2, y: r.top - wr.top + r.height / 2,
               w: r.width, h: r.height };
    });
    const lines = [].slice.call(wrap.querySelectorAll('.bl-l')).map(l => ({
      x1: +l.getAttribute('x1'), y1: +l.getAttribute('y1'), x2: +l.getAttribute('x2'), y2: +l.getAttribute('y2') }));
    const vb = wrap.querySelector('.bl-ov').getAttribute('viewBox');
    return { W, H, balloons, lines, vb };
  });
  await page.close();
  return geo;
};

/* Portrait and landscape: a stretched viewBox is exactly what made the leaders
   skew, so both aspects have to be checked, not just the one that looks right. */
for (const [w, h, label] of [[1000, 700, 'landscape'], [700, 1000, 'portrait'], [1600, 400, 'wide strip']]) {
  const g = await run(w, h);

  check(label + ': the overlay is measured in the sheet’s own pixels, not a stretched 0-100 box',
    g.vb === '0 0 ' + Math.round(g.W) + ' ' + Math.round(g.H), g.vb + ' vs ' + g.W + 'x' + g.H);

  /* the one that was actually reported */
  const overlaps = [];
  for (let i = 0; i < g.balloons.length; i++)
    for (let j = i + 1; j < g.balloons.length; j++) {
      const a = g.balloons[i], b = g.balloons[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < (a.w + b.w) / 2 - 1) overlaps.push(a.no + '/' + b.no + ' ' + Math.round(d) + 'px apart');
    }
  check(label + ': no balloon covers another, even where six callouts are on top of each other',
    overlaps.length === 0, overlaps.join(', '));

  const onOwn = g.balloons.filter(b => Math.hypot(b.x - b.cx, b.y - b.cy) < b.w / 2);
  check(label + ': no balloon sits on the callout it numbers, which would hide it',
    onOwn.length === 0, onOwn.map(b => b.no).join(', '));

  /* A balloon spread away from its callout is only readable if the leader says
     where it came from — and the leader must reach the AI's point exactly, or
     the sheet claims a characteristic was read somewhere it was not. */
  const strayed = g.balloons.filter(b => {
    const l = g.lines.find(l => Math.abs(l.x2 - b.x) < 1.5 && Math.abs(l.y2 - b.y) < 1.5);
    return !l || Math.hypot(l.x1 - b.cx, l.y1 - b.cy) > 0.5;
  });
  check(label + ': every balloon has a leader landing exactly on the point the AI gave',
    strayed.length === 0, strayed.map(b => b.no).join(', '));

  const far = g.balloons.filter(b => Math.hypot(b.x - b.cx, b.y - b.cy) > 70);
  check(label + ': no leader is too long to follow',
    far.length === 0, far.map(b => b.no + ' ' + Math.round(Math.hypot(b.x - b.cx, b.y - b.cy)) + 'px').join(', '));

  const off = g.balloons.filter(b => b.x - b.w / 2 < -1 || b.y - b.h / 2 < -1 ||
    b.x + b.w / 2 > g.W + 1 || b.y + b.h / 2 > g.H + 1);
  check(label + ': nothing is pushed off the sheet, including the two on its edges',
    off.length === 0, off.map(b => b.no + ' @' + Math.round(b.x) + ',' + Math.round(b.y)).join(', '));

  /* round at any aspect — an ellipse was the first version of this bug */
  const oval = g.balloons.filter(b => Math.abs(b.w - b.h) > 0.6);
  check(label + ': every balloon is still a circle, not squashed by the aspect',
    oval.length === 0, oval.map(b => b.no + ' ' + b.w + 'x' + b.h).join(', '));
}

/* Same reading, same sheet, same answer — a balloon sheet that moved its
   numbers between two prints of one enquiry could not be used as evidence. */
const a = await run(1000, 700), b = await run(1000, 700);
check('the same reading lays out identically every time',
  JSON.stringify(a.balloons.map(x => [x.no, Math.round(x.x), Math.round(x.y)])) ===
  JSON.stringify(b.balloons.map(x => [x.no, Math.round(x.x), Math.round(x.y)])));

await browser.close();
done();
