/* Engineering drawing regression guard.
   This is a source-level gate for the failure modes found on the supplied
   GOST-style drawing: signed one-sided tolerances, ± tolerances, two different
   16 mm callouts, GD&T symbol naming, and balloon targeting. It deliberately
   does not pretend to validate an AI vision answer; that requires the real
   drawing and model at runtime. */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../idms.html', import.meta.url), 'utf8');

assert.match(html, /function rfqCharKey\(c\)[\s\S]*?locationNote[\s\S]*?upper[\s\S]*?lower/, 'duplicate identity must include context and signed tolerance');
assert.match(html, /function rfqBalloonTarget\(c\)[\s\S]*?validationStatus[\s\S]*?verified-callout/, 'automatic balloons must require verified callout coordinates');
assert.match(html, /calloutX\/calloutY are the PRIMARY BALLOON TARGET/, 'verifier must distinguish printed callout from feature anchor');
assert.match(html, /anchorX\/anchorY are the actual/, 'feature anchor must remain separate from callout position');
assert.match(html, /±0\.05 means upper \+0\.05 and lower -0\.05/, 'signed plus/minus rule must be explicit');
assert.match(html, /perpendicularity 0\.01 to datum A — never concentricity/, 'known GD&T confusion must be guarded');
assert.match(html, /c\.calloutX == null \|\| c\.calloutY == null/, 'missing callout coordinate must block auto-ballooning');
assert.match(html, /function rfqNormalizeSemantic\(c\)[\s\S]*?rfqLooksThread/, 'semantic normalization must exist before ballooning');
assert.match(html, /calloutText.*evidenceText.*calloutBBox/, 'automatic ballooning must require visible callout evidence');
assert.match(html, /Do not create a diameter unless the visible callout contains/, 'diameter type must be symbol-driven');
assert.match(html, /M34x0\.75, keep it as one Thread characteristic/, 'thread must not split into diameter plus thread');
assert.match(html, /0\.8x45°.*one characteristic/, 'chamfer must not split into size plus standalone angle');

assert.match(html, /function rfqStrictEvidenceSanitize\(chars\)/, 'strict explicit-callout evidence gate must exist');
assert.match(html, /derived\/inferred characteristic/, 'derived dimensions must be rejected');
assert.match(html, /concentricity has no visible concentricity symbol/, 'datum-only concentricity must be rejected');
assert.match(html, /function rfqDrawingReadyForExport\(r\)/, 'hard export readiness gate must exist');
assert.match(html, /NOT VERIFIED — DO NOT USE FOR INSPECTION/, 'unsafe drawings must carry an inspection warning');
assert.match(html, /Adversarial final coverage audit/, 'final coverage audit must exist');

// Ground truth captured from the supplied validation drawing.
const expected = [
  ['40', 0, -0.16],
  ['16', 0.05, 0],
  ['Ø32', 0.16, 0],
  ['Ø6H7', null, null],
  ['Ø25', 0.13, 0],
  ['M34×0.75', null, null],
  ['10', null, null],
  ['15', 0, -0.11],
  ['28', 0, -0.13],
  ['0.8×45°', null, null],
  ['⊥ 0.01 A', null, null],
  ['Ø42', 0, -0.16],
  ['36', null, null],
  ['Ø22', null, null],
  ['135°', null, null],
  ['16±0.05', 0.05, -0.05],
  ['Ra10', null, null],
  ['D16T / GOST 4784-97', null, null],
  ['0.07 kg', null, null],
];
assert.equal(expected[1][0], '16');
assert.notDeepEqual(expected[1].slice(1), expected[15].slice(1), 'the two 16 mm callouts must not be treated as duplicates');
assert.equal(expected[10][0], '⊥ 0.01 A');
assert.equal(expected[15][2], -0.05);

console.log('engineeringdrawingregression: PASS');
